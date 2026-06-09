import nodeRequire from './nodeRequire';

export interface MediaToolDetectionResult {
  available: boolean;
  path: string | null;
  version?: string;
  checkedAt: number;
}

type MediaToolName = 'ffmpeg' | 'ffprobe';

/**
 * Centralized detector for local media binaries used by download/transcription flows.
 */
export class MediaToolDetector {
  private static ffmpegDetection: MediaToolDetectionResult | null = null;
  private static ffprobeDetection: MediaToolDetectionResult | null = null;

  static async detectFfmpeg(forceRefresh = false): Promise<MediaToolDetectionResult> {
    if (!forceRefresh && this.ffmpegDetection) {
      return this.ffmpegDetection;
    }

    this.ffmpegDetection = await this.detectTool('ffmpeg');
    return this.ffmpegDetection;
  }

  static async isFfmpegAvailable(forceRefresh = false): Promise<boolean> {
    const detection = await this.detectFfmpeg(forceRefresh);
    return detection.available;
  }

  static async getFfmpegPath(forceRefresh = false): Promise<string | null> {
    const detection = await this.detectFfmpeg(forceRefresh);
    return detection.path;
  }

  static async detectFfprobe(forceRefresh = false): Promise<MediaToolDetectionResult> {
    if (!forceRefresh && this.ffprobeDetection) {
      return this.ffprobeDetection;
    }

    this.ffprobeDetection = await this.detectTool('ffprobe');
    return this.ffprobeDetection;
  }

  static async isFfprobeAvailable(forceRefresh = false): Promise<boolean> {
    const detection = await this.detectFfprobe(forceRefresh);
    return detection.available;
  }

  static async getFfprobePath(forceRefresh = false): Promise<string | null> {
    const detection = await this.detectFfprobe(forceRefresh);
    return detection.path;
  }

  static resetCache(): void {
    this.ffmpegDetection = null;
    this.ffprobeDetection = null;
  }

  private static async detectTool(tool: MediaToolName): Promise<MediaToolDetectionResult> {
    const checkedAt = Date.now();
    const candidates = this.getCandidates(tool);

    for (const candidate of candidates) {
      const result = await this.runVersionCheck(candidate);
      if (result.available) {
        const detection: MediaToolDetectionResult = {
          available: true,
          path: candidate,
          checkedAt,
        };
        if (result.version) {
          detection.version = result.version;
        }
        return detection;
      }
    }

    return {
      available: false,
      path: null,
      checkedAt,
    };
  }

  private static getCandidates(tool: MediaToolName): string[] {
    const os = nodeRequire('os') as typeof import('os');
    const path = nodeRequire('path') as typeof import('path');
    const isWindows = os.platform() === 'win32';
    const home = os.homedir();
    const executable = isWindows ? `${tool}.exe` : tool;
    const windowsProgramFiles = [
      `C:\\Program Files\\ffmpeg\\bin\\${tool}.exe`,
      `C:\\Program Files (x86)\\ffmpeg\\bin\\${tool}.exe`,
      `C:\\ffmpeg\\bin\\${tool}.exe`,
      `C:\\ProgramData\\chocolatey\\bin\\${tool}.exe`,
      path.join(home, 'scoop', 'apps', 'ffmpeg', 'current', 'bin', `${tool}.exe`),
      path.join(home, 'scoop', 'shims', `${tool}.exe`),
    ];

    return [
      executable,
      `/opt/homebrew/bin/${tool}`,
      `/usr/local/bin/${tool}`,
      `/opt/local/bin/${tool}`,
      `/usr/bin/${tool}`,
      `/bin/${tool}`,
      `/snap/bin/${tool}`,
      `/var/lib/flatpak/exports/bin/${tool}`,
      ...windowsProgramFiles,
    ];
  }

  private static async runVersionCheck(binaryPath: string): Promise<{ available: boolean; version?: string }> {
    const { spawn } = nodeRequire('child_process') as typeof import('child_process');

    return await new Promise<{ available: boolean; version?: string }>((resolve) => {
      let settled = false;
      let output = '';

      const child = spawn(binaryPath, ['-version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let timeout: number;

      const finish = (available: boolean): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);

        const firstLine = output
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find(Boolean);

        const result: { available: boolean; version?: string } = {
          available,
        };
        if (firstLine) {
          result.version = firstLine;
        }
        resolve(result);
      };

      timeout = window.setTimeout(() => {
        try {
          child.kill('SIGTERM');
        } catch {
          // Ignore process cleanup errors.
        }
        finish(false);
      }, 10000);

      child.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        output += data.toString();
      });

      child.on('error', () => finish(false));
      child.on('close', (code: number | null) => finish(code === 0));
    });
  }
}
