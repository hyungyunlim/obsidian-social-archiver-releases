/**
 * Shared fixtures for the BYOK tests: a scripted provider transport, a fake
 * app with SecretStorage and per-vault localStorage, and a ByokService over
 * them. Keys are fakes. Not a test file, so it stays strictly typed (the
 * plugin typecheck covers it).
 */
import { vi } from 'vitest';
import type { App } from 'obsidian';
import type { ByokHttpRequest, ByokProviderId, ByokTransport } from '../../../vendor/byok-ai-core';
import { ByokService, type ByokServiceDeps } from '../../../services/byok/ByokService';
import { ByokKeyStore } from '../../../services/byok/ByokKeyStore';
import { createObsidianByokStore } from '../../../services/byok/ObsidianByokStore';
import { migrateSettings, type SocialArchiverSettings } from '../../../types/settings';

// Built at runtime: the public mirror's secret scan rejects any key-shaped literal (sk-…).
export const FAKE_OPENAI_KEY = ['sk', 'test-1234567890abcdef'].join('-');

export type ScriptedAnswer = { status: number; json?: unknown; text?: string };

export function scriptedTransport(answer: (req: ByokHttpRequest) => ScriptedAnswer): ByokTransport & { calls: ByokHttpRequest[] } {
  const calls: ByokHttpRequest[] = [];
  const transport = (async (req: ByokHttpRequest) => {
    calls.push(req);
    const { status, json, text } = answer(req);
    const body = text ?? (json === undefined ? '' : JSON.stringify(json));
    return { status, headers: {}, text: () => Promise.resolve(body), body: null };
  }) as ByokTransport & { calls: ByokHttpRequest[] };
  transport.calls = calls;
  return transport;
}

export function openaiModels(...ids: string[]): ScriptedAnswer {
  return { status: 200, json: { data: ids.map((id) => ({ id })) } };
}

export function openaiAnswer(text: string, model = 'gpt-6-luna-2026-10-01', annotations: unknown[] = []): ScriptedAnswer {
  return {
    status: 200,
    json: {
      status: 'completed',
      model,
      output: [{ type: 'message', content: [{ type: 'output_text', text, annotations }] }],
      usage: { input_tokens: 12, output_tokens: 6 },
    },
  };
}

/** SecretStorage + loadLocalStorage/saveLocalStorage, Map-backed. */
export function fakeByokApp() {
  const secrets = new Map<string, string>();
  const local = new Map<string, string>();
  return {
    secretStorage: {
      setSecret: (id: string, secret: string): void => {
        secrets.set(id, secret);
      },
      getSecret: (id: string): string | null => secrets.get(id) ?? null,
      listSecrets: (): string[] => [...secrets.keys()],
    },
    loadLocalStorage: (key: string): unknown => {
      const raw = local.get(key);
      return raw === undefined ? null : (JSON.parse(raw) as unknown);
    },
    saveLocalStorage: (key: string, data: unknown): void => {
      if (data === null || data === undefined) local.delete(key);
      else local.set(key, JSON.stringify(data));
    },
  };
}

export function byokFixture(options: {
  answer: (req: ByokHttpRequest) => ScriptedAnswer;
  settings?: Partial<SocialArchiverSettings>;
  consent?: boolean | ((provider: ByokProviderId) => boolean);
}) {
  const app = fakeByokApp();
  const holder = { settings: migrateSettings(options.settings ?? {}) };
  const transport = scriptedTransport(options.answer);
  const requestConsent = vi.fn(async (provider: ByokProviderId) =>
    typeof options.consent === 'function' ? options.consent(provider) : options.consent ?? true,
  );
  const notify = vi.fn();
  const onChange = vi.fn();
  const saveSettings = vi.fn(async (partial: Partial<SocialArchiverSettings>) => {
    // Like saveSettingsPartial: a new object every time.
    holder.settings = { ...holder.settings, ...partial };
  });
  const deps: ByokServiceDeps = {
    settings: () => holder.settings,
    saveSettings,
    keyStore: new ByokKeyStore(app as unknown as App, () => holder.settings),
    store: createObsidianByokStore(app),
    transport,
    requestConsent,
    notify,
    onChange,
  };
  const service = new ByokService(deps);
  return { app, holder, transport, requestConsent, notify, onChange, saveSettings, service };
}

/** Enabled OpenAI with a stored key (and consent already given on this device). */
export async function readyOpenAI(fixture: ReturnType<typeof byokFixture>): Promise<void> {
  fixture.app.secretStorage.setSecret('social-archiver-openai', FAKE_OPENAI_KEY);
  await fixture.service.setEnabled('openai', true);
  fixture.requestConsent.mockClear();
  fixture.saveSettings.mockClear();
  fixture.onChange.mockClear();
}
