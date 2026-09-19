import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  NOT_READY_RETRY_MS,
  RESTART_BASE_MS,
  STOP_GRACE_MS,
  StandaloneCliExecutorSupervisor,
  executorArgs,
  executorEnv,
  restartDelayMs,
  type ChildLike,
  type CliExecutorLaunch,
  type SpawnOptionsLike,
} from '../../../plugin/executor/StandaloneCliExecutorSupervisor';

class FakeChild extends EventEmitter implements ChildLike {
  pid = 4242;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed: NodeJS.Signals[] = [];
  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.killed.push(signal);
    return true;
  }
  line(obj: Record<string, unknown>): void {
    this.stdout.emit('data', Buffer.from(`${JSON.stringify(obj)}\n`));
  }
  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.emit('exit', code, signal);
  }
}

interface Harness {
  supervisor: StandaloneCliExecutorSupervisor;
  spawned: Array<{ file: string; args: string[]; options: SpawnOptionsLike; child: FakeChild }>;
  timers: Array<{ fn: () => void; ms: number; id: number }>;
  fire: (index: number) => void;
}

function harness(): Harness {
  const spawned: Harness['spawned'] = [];
  const timers: Harness['timers'] = [];
  let nextId = 1;
  const supervisor = new StandaloneCliExecutorSupervisor({
    spawn: (file, args, options) => {
      const child = new FakeChild();
      spawned.push({ file, args, options, child });
      return child;
    },
    schedule: (fn, ms) => {
      const id = nextId++;
      timers.push({ fn, ms, id });
      return id;
    },
    clearSchedule: (handle) => {
      const index = timers.findIndex((t) => t.id === handle);
      if (index >= 0) timers.splice(index, 1);
    },
    now: () => 1_000,
    env: { PATH: '/usr/bin', HOME: '/Users/me' },
    extendedPath: '/opt/homebrew/bin:/usr/bin',
  });
  return {
    supervisor,
    spawned,
    timers,
    fire: (index) => {
      const timer = timers.splice(index, 1)[0];
      timer?.fn();
    },
  };
}

const launch: CliExecutorLaunch = {
  binaryPath: '/opt/homebrew/bin/social-archiver',
  token: 'tok_secret',
  configDir: '/Users/me/Library/Application Support/obsidian-social-archiver/cli-executor/v1',
  outputLanguage: 'ko',
};

describe('executorArgs / executorEnv', () => {
  it('runs the legacy watch loop with JSON output and passes the token only through the environment', () => {
    expect(executorArgs(launch)).toEqual(['executor', '--watch', '--format', 'json', '--language', 'ko', '--poll', '15']);
    const env = executorEnv(launch, { PATH: '/usr/bin', HOME: '/Users/me' }, '/opt/homebrew/bin:/usr/bin');
    expect(env.SOCIAL_ARCHIVER_TOKEN).toBe('tok_secret');
    expect(env.SOCIAL_ARCHIVER_CONFIG_DIR).toBe(launch.configDir);
    expect(env.SOCIAL_ARCHIVER_NO_DESKTOP_CREDENTIALS).toBe('1');
    expect(env.PATH).toBe('/opt/homebrew/bin:/usr/bin');
    expect(env.HOME).toBe('/Users/me');
  });

  it('backs off exponentially up to a minute', () => {
    expect(restartDelayMs(1)).toBe(RESTART_BASE_MS);
    expect(restartDelayMs(2)).toBe(RESTART_BASE_MS * 2);
    expect(restartDelayMs(10)).toBe(60_000);
  });
});

describe('StandaloneCliExecutorSupervisor', () => {
  it('spawns the executor and tracks registration and watching', async () => {
    const h = harness();
    await h.supervisor.start(launch);
    expect(h.spawned).toHaveLength(1);
    expect(h.spawned[0]!.file).toBe(launch.binaryPath);
    expect(h.spawned[0]!.args[0]).toBe('executor');
    expect(h.supervisor.getSnapshot().state).toBe('starting');

    const child = h.spawned[0]!.child;
    child.line({ event: 'registered', clientId: 'cli_1', provider: 'claude', providers: [{ id: 'apple', available: true, authenticated: true }] });
    child.line({ event: 'watching', pollSeconds: 15 });
    const snap = h.supervisor.getSnapshot();
    expect(snap.state).toBe('running');
    expect(snap.clientId).toBe('cli_1');
    expect(snap.provider).toBe('claude');
    expect(snap.providers[0]?.id).toBe('apple');
  });

  it('handles partial stdout chunks', async () => {
    const h = harness();
    await h.supervisor.start(launch);
    const child = h.spawned[0]!.child;
    child.stdout.emit('data', '{"event":"regis');
    child.stdout.emit('data', 'tered","clientId":"cli_2"}\n{"event":"watching"}\n');
    expect(h.supervisor.getSnapshot().clientId).toBe('cli_2');
    expect(h.supervisor.getSnapshot().state).toBe('running');
  });

  it('restarts with backoff after an unexpected exit', async () => {
    const h = harness();
    await h.supervisor.start(launch);
    h.spawned[0]!.child.exit(1);
    expect(h.supervisor.getSnapshot().state).toBe('crashed');
    expect(h.supervisor.getSnapshot().restarts).toBe(1);
    expect(h.timers[0]?.ms).toBe(RESTART_BASE_MS);
    h.fire(0);
    expect(h.spawned).toHaveLength(2);
    h.spawned[1]!.child.exit(1);
    expect(h.timers[0]?.ms).toBe(RESTART_BASE_MS * 2);
  });

  it('stops retrying when the CLI rejects the token', async () => {
    const h = harness();
    await h.supervisor.start(launch);
    const child = h.spawned[0]!.child;
    child.line({ ok: false, error: { code: 'AUTH_REQUIRED', message: 'Not authenticated.' } });
    child.exit(1);
    expect(h.supervisor.getSnapshot().state).toBe('auth_required');
    expect(h.supervisor.getSnapshot().lastError).toBe('Not authenticated.');
    expect(h.timers).toHaveLength(0);
    expect(h.supervisor.isActive()).toBe(false);
  });

  it('waits five minutes when no provider is ready', async () => {
    const h = harness();
    await h.supervisor.start(launch);
    const child = h.spawned[0]!.child;
    child.line({ ok: false, error: { code: 'SERVICE_NOT_READY', message: 'No ready provider' } });
    child.exit(1);
    expect(h.supervisor.getSnapshot().state).toBe('not_ready');
    expect(h.timers[0]?.ms).toBe(NOT_READY_RETRY_MS);
    expect(h.supervisor.isActive()).toBe(true);
  });

  it('stops with SIGTERM, escalates to SIGKILL, and does not restart', async () => {
    const h = harness();
    await h.supervisor.start(launch);
    const child = h.spawned[0]!.child;
    const stopping = h.supervisor.stop();
    expect(child.killed).toEqual(['SIGTERM']);
    expect(h.timers[0]?.ms).toBe(STOP_GRACE_MS);
    child.exit(0, 'SIGTERM');
    await stopping;
    expect(h.supervisor.getSnapshot().state).toBe('stopped');
    expect(h.timers).toHaveLength(0);
    expect(h.spawned).toHaveLength(1);
  });

  it('restarts the child when the token changes and is a no-op for the same launch', async () => {
    const h = harness();
    await h.supervisor.start(launch);
    await h.supervisor.start(launch);
    expect(h.spawned).toHaveLength(1);
    const restarting = h.supervisor.start({ ...launch, token: 'tok_new' });
    h.spawned[0]!.child.exit(0, 'SIGTERM');
    await restarting;
    expect(h.spawned).toHaveLength(2);
    expect(h.spawned[1]!.options.env.SOCIAL_ARCHIVER_TOKEN).toBe('tok_new');
  });

  it('reports a spawn failure as crashed and schedules a retry', async () => {
    const timers: Array<{ ms: number }> = [];
    const supervisor = new StandaloneCliExecutorSupervisor({
      spawn: () => {
        throw new Error('ENOENT');
      },
      schedule: (_fn, ms) => {
        timers.push({ ms });
        return timers.length;
      },
      clearSchedule: vi.fn(),
      now: () => 0,
      env: {},
    });
    await supervisor.start(launch);
    expect(supervisor.getSnapshot().state).toBe('crashed');
    expect(supervisor.getSnapshot().lastError).toBe('ENOENT');
    expect(timers[0]?.ms).toBe(RESTART_BASE_MS);
  });
});
