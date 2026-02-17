/**
 * ProcessManager - Centralized management of spawned child processes
 *
 * Tracks all child processes (yt-dlp, faster-whisper, etc.) and provides
 * cleanup on plugin unload or view close.
 */

// Type-only import replaced with inline interface
interface ChildProcess {
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: 'close' | 'error', listener: (...args: unknown[]) => void): this;
}

export interface ManagedProcess {
  id: string;
  process: ChildProcess;
  type: 'transcription' | 'download' | 'ai-comment' | 'other';
  description?: string;
  startedAt: Date;
}

class ProcessManagerSingleton {
  private processes: Map<string, ManagedProcess> = new Map();
  private idCounter = 0;

  /**
   * Register a child process for tracking
   * @returns Process ID for later reference
   */
  register(
    process: ChildProcess,
    type: ManagedProcess['type'],
    description?: string
  ): string {
    const id = `proc_${++this.idCounter}_${Date.now()}`;

    this.processes.set(id, {
      id,
      process,
      type,
      description,
      startedAt: new Date(),
    });

    // Auto-unregister when process exits
    process.on('close', () => {
      this.unregister(id);
    });

    process.on('error', () => {
      this.unregister(id);
    });

    console.debug(`[ProcessManager] Registered ${type} process: ${id}${description ? ` (${description})` : ''}`);
    return id;
  }

  /**
   * Unregister a process (called automatically on exit)
   */
  unregister(id: string): void {
    if (this.processes.has(id)) {
      this.processes.delete(id);
      console.debug(`[ProcessManager] Unregistered process: ${id}`);
    }
  }

  /**
   * Kill a specific process by ID
   */
  kill(id: string): boolean {
    const managed = this.processes.get(id);
    if (managed) {
      try {
        managed.process.kill('SIGTERM');
        this.processes.delete(id);
        console.debug(`[ProcessManager] Killed process: ${id}`);
        return true;
      } catch (error) {
        console.warn(`[ProcessManager] Failed to kill process ${id}:`, error);
        return false;
      }
    }
    return false;
  }

  /**
   * Kill all processes of a specific type
   */
  killByType(type: ManagedProcess['type']): number {
    let killed = 0;
    for (const [id, managed] of this.processes.entries()) {
      if (managed.type === type) {
        if (this.kill(id)) {
          killed++;
        }
      }
    }
    console.debug(`[ProcessManager] Killed ${killed} ${type} processes`);
    return killed;
  }

  /**
   * Kill all tracked processes (called on plugin unload)
   */
  killAll(): number {
    const count = this.processes.size;
    if (count === 0) return 0;

    console.debug(`[ProcessManager] Killing all ${count} processes...`);

    for (const [id, managed] of this.processes.entries()) {
      try {
        managed.process.kill('SIGTERM');
      } catch (error) {
        console.warn(`[ProcessManager] Failed to kill process ${id}:`, error);
      }
    }

    this.processes.clear();
    console.debug(`[ProcessManager] All processes killed`);
    return count;
  }

  /**
   * Get count of active processes
   */
  getActiveCount(): number {
    return this.processes.size;
  }

  /**
   * Get count of active processes by type
   */
  getActiveCountByType(type: ManagedProcess['type']): number {
    let count = 0;
    for (const managed of this.processes.values()) {
      if (managed.type === type) count++;
    }
    return count;
  }

  /**
   * Check if any processes are running
   */
  hasActiveProcesses(): boolean {
    return this.processes.size > 0;
  }

  /**
   * Get list of active processes (for debugging)
   */
  getActiveProcesses(): Array<Omit<ManagedProcess, 'process'>> {
    return Array.from(this.processes.values()).map(({ process: _process, ...rest }) => rest);
  }
}

// Export singleton instance
export const ProcessManager = new ProcessManagerSingleton();
