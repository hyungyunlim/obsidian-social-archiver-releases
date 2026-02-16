import { ProcessManager } from '../services/ProcessManager';

/**
 * YtDlpDetector - Detects and uses yt-dlp for video downloads
 */
export class YtDlpDetector {
  private static ytDlpAvailable: boolean | null = null;
  private static ytDlpPath: string | null = null;
  private static ffmpegAvailable: boolean | null = null;
  private static ffmpegPath: string | null = null;

  /**
   * Check if ffmpeg is installed on the system
   */
  static async isFfmpegAvailable(): Promise<boolean> {
    // Return cached result if available
    if (this.ffmpegAvailable !== null) {
      return this.ffmpegAvailable;
    }

    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      const os = require('os');

      // Build platform-specific paths
      const isWindows = os.platform() === 'win32';
      const username = os.userInfo().username;

      const commonPaths = [
        // Try PATH first (works on all platforms)
        isWindows ? 'ffmpeg.exe' : 'ffmpeg',

        // macOS - Homebrew
        '/opt/homebrew/bin/ffmpeg',     // Apple Silicon
        '/usr/local/bin/ffmpeg',        // Intel Mac

        // macOS - MacPorts
        '/opt/local/bin/ffmpeg',

        // Linux - System packages
        '/usr/bin/ffmpeg',
        '/bin/ffmpeg',

        // Linux - Snap
        '/snap/bin/ffmpeg',

        // Linux - Flatpak
        '/var/lib/flatpak/exports/bin/ffmpeg',

        // Windows - Common install locations
        'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
        'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe',

        // Windows - Chocolatey
        'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe',

        // Windows - Scoop (user-specific)
        `C:\\Users\\${username}\\scoop\\apps\\ffmpeg\\current\\bin\\ffmpeg.exe`,
        `C:\\Users\\${username}\\scoop\\shims\\ffmpeg.exe`,
      ];

      for (const path of commonPaths) {
        try {
          const { stdout } = await execAsync(`"${path}" -version`);
          if (stdout.includes('ffmpeg version')) {
            this.ffmpegAvailable = true;
            this.ffmpegPath = path;
            return true;
          }
        } catch {
          // Continue to next path
        }
      }

      this.ffmpegAvailable = false;
      this.ffmpegPath = null;
      return false;
    } catch (error) {
      this.ffmpegAvailable = false;
      return false;
    }
  }

  /**
   * Check if yt-dlp is installed on the system
   */
  static async isAvailable(): Promise<boolean> {
    // Return cached result if available
    if (this.ytDlpAvailable !== null) {
      return this.ytDlpAvailable;
    }

    try {
      // Use Electron's child_process via require
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      const os = require('os');

      // Build platform-specific paths
      const isWindows = os.platform() === 'win32';
      const username = os.userInfo().username;

      // Common paths where yt-dlp might be installed
      const commonPaths = [
        // Try PATH first (works on all platforms)
        isWindows ? 'yt-dlp.exe' : 'yt-dlp',

        // macOS - Homebrew
        '/opt/homebrew/bin/yt-dlp',     // Apple Silicon
        '/usr/local/bin/yt-dlp',        // Intel Mac

        // macOS - MacPorts
        '/opt/local/bin/yt-dlp',

        // Linux - System packages
        '/usr/bin/yt-dlp',
        '/bin/yt-dlp',

        // Linux - Snap
        '/snap/bin/yt-dlp',

        // Linux - pipx
        `${os.homedir()}/.local/bin/yt-dlp`,

        // Windows - pip install (user)
        `C:\\Users\\${username}\\AppData\\Local\\Programs\\Python\\Python*\\Scripts\\yt-dlp.exe`,
        `C:\\Users\\${username}\\AppData\\Roaming\\Python\\Python*\\Scripts\\yt-dlp.exe`,

        // Windows - Chocolatey
        'C:\\ProgramData\\chocolatey\\bin\\yt-dlp.exe',

        // Windows - Scoop
        `C:\\Users\\${username}\\scoop\\apps\\yt-dlp\\current\\yt-dlp.exe`,
        `C:\\Users\\${username}\\scoop\\shims\\yt-dlp.exe`,

        // Windows - winget (common location)
        'C:\\Program Files\\yt-dlp\\yt-dlp.exe',
      ];

      // Try yt-dlp in common locations
      for (const path of commonPaths) {
        try {
          const { stdout } = await execAsync(`"${path}" --version`);
          if (stdout.trim()) {
            this.ytDlpAvailable = true;
            this.ytDlpPath = path;

            // Also check for ffmpeg availability
            await this.isFfmpegAvailable();

            return true;
          }
        } catch {
          // Continue to next path
        }
      }

      // Try youtube-dl as fallback
      const youtubeDlPaths = [
        isWindows ? 'youtube-dl.exe' : 'youtube-dl',
        '/opt/homebrew/bin/youtube-dl',
        '/usr/local/bin/youtube-dl',
        '/opt/local/bin/youtube-dl',
        '/usr/bin/youtube-dl',
        '/bin/youtube-dl',
        `${os.homedir()}/.local/bin/youtube-dl`,
        `C:\\Users\\${username}\\scoop\\shims\\youtube-dl.exe`,
        'C:\\ProgramData\\chocolatey\\bin\\youtube-dl.exe',
      ];

      for (const path of youtubeDlPaths) {
        try {
          const { stdout } = await execAsync(`"${path}" --version`);
          if (stdout.trim()) {
            this.ytDlpAvailable = true;
            this.ytDlpPath = path;

            // Also check for ffmpeg availability
            await this.isFfmpegAvailable();

            return true;
          }
        } catch {
          // Continue to next path
        }
      }

      this.ytDlpAvailable = false;
      return false;
    } catch (error) {
      this.ytDlpAvailable = false;
      return false;
    }
  }

  /**
   * Download video using yt-dlp
   * @param url Video URL
   * @param outputPath Output directory path (final destination in Vault)
   * @param filename Custom filename (without extension)
   * @param onProgress Progress callback
   * @param signal Optional AbortSignal to cancel download
   */
  static async downloadVideo(
    url: string,
    outputPath: string,
    filename: string,
    onProgress?: (progress: number, status: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    if (!this.ytDlpPath) {
      throw new Error('yt-dlp is not available');
    }

    // Check if already aborted
    if (signal?.aborted) {
      throw new Error('Download cancelled');
    }

    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process');
      const fs = require('fs');
      const path = require('path');
      const os = require('os');

      // Sanitize filename (remove special characters)
      const sanitizedFilename = filename.replace(/[^a-z0-9\-_]/gi, '_');

      // Create temporary directory OUTSIDE the Vault to avoid Obsidian Sync conflicts
      const tempDir = path.join(os.tmpdir(), 'obsidian-social-archiver', Date.now().toString());

      try {
        fs.mkdirSync(tempDir, { recursive: true });
      } catch (error) {
        reject(new Error(`Failed to create temp directory: ${error instanceof Error ? error.message : 'Unknown error'}`));
        return;
      }

      // Build yt-dlp command arguments (download to temp folder)
      const tempOutputTemplate = path.join(tempDir, `${sanitizedFilename}.%(ext)s`);

      // Choose format based on ffmpeg availability
      const hasFFmpeg = this.ffmpegAvailable;
      const args = [];

      if (hasFFmpeg && this.ffmpegPath) {
        // With ffmpeg: Request best quality video+audio and merge to MP4
        // yt-dlp automatically uses stream copy (-c copy) and web optimization (-movflags +faststart)

        // Only pass --ffmpeg-location for absolute paths
        // If ffmpeg is in PATH (just 'ffmpeg' or 'ffmpeg.exe'), let yt-dlp find it itself
        if (path.isAbsolute(this.ffmpegPath)) {
          args.push('--ffmpeg-location', this.ffmpegPath);
        }

        args.push(
          '--format', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best',
          '--merge-output-format', 'mp4', // Force MP4 container
          '--embed-metadata', // Embed metadata
          '--progress' // Show detailed progress including post-processing
        );
      } else {
        // Without ffmpeg: Download whatever format is available
        // Note: May be .ts or other formats that browsers can't play
        args.push(
          '--format', 'best'
        );
      }

      args.push(
        '--output', tempOutputTemplate,
        '--no-playlist',
        '--newline', // Each progress line on new line for easier parsing
        url
      );


      const process = spawn(this.ytDlpPath, args);

      // Register with ProcessManager for cleanup on plugin unload
      ProcessManager.register(process, 'download', `yt-dlp: ${url.slice(0, 50)}`);

      let stdoutData = '';
      let stderrData = '';
      let downloadedFile = '';
      let isCancelled = false;

      // Handle abort signal
      if (signal) {
        signal.addEventListener('abort', () => {
          isCancelled = true;
          process.kill('SIGTERM');

          // Clean up temp directory
          try {
            fs.rmSync(tempDir, { recursive: true, force: true });
          } catch (cleanupError) {
            // Ignore cleanup errors
          }

          reject(new Error('Download cancelled by user'));
        });
      }

      process.stdout.on('data', (data: Buffer) => {
        const output = data.toString();
        stdoutData += output;

        // Parse progress from yt-dlp output
        // Format: [download]  15.2% of 10.25MiB at 1.2MiB/s ETA 00:07
        const progressMatch = output.match(/\[download\]\s+(\d+\.?\d*)%/);
        if (progressMatch && progressMatch[1] && onProgress) {
          const percentage = parseFloat(progressMatch[1]);
          const speedMatch = output.match(/at\s+([\d.]+\w+\/s)/);
          const etaMatch = output.match(/ETA\s+([\d:]+)/);

          let status = `Downloading: ${percentage.toFixed(1)}%`;
          if (speedMatch && speedMatch[1]) status += ` at ${speedMatch[1]}`;
          if (etaMatch && etaMatch[1]) status += ` (ETA ${etaMatch[1]})`;

          onProgress(percentage, status);
        }

        // Check for post-processing messages
        if ((output.includes('[Merger]') || output.includes('Merging formats')) && onProgress) {
          onProgress(95, 'Merging video and audio streams...');
        }
        if (output.includes('[ffmpeg]') && onProgress) {
          onProgress(97, 'Processing with ffmpeg...');
        }
        if ((output.includes('[Metadata]') || output.includes('Adding metadata')) && onProgress) {
          onProgress?.(98, 'Embedding metadata...');
        }
        if ((output.includes('Deleting original file') || output.includes('Deleting')) && onProgress) {
          onProgress(99, 'Cleaning up temporary files...');
        }

        // Capture destination file (in temp folder)
        const destinationMatch = output.match(/\[download\] Destination: (.+)/);
        if (destinationMatch && destinationMatch[1]) {
          downloadedFile = destinationMatch[1].trim();
        }

        // Also check for "already downloaded" message
        const alreadyMatch = output.match(/\[download\] (.+) has already been downloaded/);
        if (alreadyMatch && alreadyMatch[1]) {
          downloadedFile = alreadyMatch[1].trim();
        }
      });

      process.stderr.on('data', (data: Buffer) => {
        const output = data.toString();
        stderrData += output;

        // Check for ffmpeg progress in stderr
        if ((output.includes('frame=') || output.includes('time=')) && onProgress) {
          onProgress(96, 'Merging in progress...');
        }
      });

      process.on('close', async (code: number) => {
        // Don't process if cancelled
        if (isCancelled) {
          return;
        }

        if (code === 0) {
          try {
            // Move file from temp to vault
            const tempFile = downloadedFile || path.join(tempDir, `${sanitizedFilename}.mp4`);

            if (!fs.existsSync(tempFile)) {
              // Try to find any file in temp directory
              const files = fs.readdirSync(tempDir);

              if (files.length > 0) {
                downloadedFile = path.join(tempDir, files[0]);
              } else {
                reject(new Error('Downloaded file not found in temp directory'));
                return;
              }
            } else {
              downloadedFile = tempFile;
            }

            const fileExtension = path.extname(downloadedFile);
            const finalPath = path.join(outputPath, `${sanitizedFilename}${fileExtension}`);

            // Ensure output directory exists
            fs.mkdirSync(outputPath, { recursive: true });

            // Move file from temp to vault
            fs.copyFileSync(downloadedFile, finalPath);

            // Clean up temp directory
            try {
              fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (cleanupError) {
              // Ignore cleanup errors
            }

            if (onProgress) {
              onProgress(100, 'Download complete!');
            }

            resolve(finalPath);
          } catch (moveError) {
            reject(new Error(`Failed to move downloaded file: ${moveError instanceof Error ? moveError.message : 'Unknown error'}`));
          }
        } else {
          // Clean up temp directory on error
          try {
            fs.rmSync(tempDir, { recursive: true, force: true });
          } catch {
            // Ignore cleanup errors
          }

          // Include stderr in error message for debugging
          const errorDetails = stderrData.trim() || stdoutData.slice(-500).trim();
          reject(new Error(`yt-dlp download failed with exit code ${code}: ${errorDetails}`));
        }
      });

      process.on('error', (error: Error) => {
        // Clean up temp directory on error
        try {
          const fs = require('fs');
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }

        reject(new Error(`yt-dlp process error: ${error.message}`));
      });
    });
  }

  /**
   * Get video info without downloading
   */
  static async getVideoInfo(url: string): Promise<any> {
    if (!this.ytDlpPath) {
      throw new Error('yt-dlp is not available');
    }

    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    try {
      const command = `"${this.ytDlpPath}" --dump-json --no-playlist "${url}"`;
      const { stdout } = await execAsync(command);
      return JSON.parse(stdout);
    } catch (error) {
      throw new Error(`Failed to get video info: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if URL is supported by yt-dlp
   * Common platforms: YouTube, Vimeo, Dailymotion, etc.
   */
  static isSupportedUrl(url: string): boolean {
    // YouTube
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      return true;
    }

    // Vimeo
    if (url.includes('vimeo.com')) {
      return true;
    }

    // Dailymotion
    if (url.includes('dailymotion.com')) {
      return true;
    }

    // TikTok (yt-dlp supports it)
    if (url.includes('tiktok.com')) {
      return true;
    }

    // Twitter/X videos
    if (url.includes('twitter.com') || url.includes('x.com')) {
      return true;
    }

    // Instagram videos
    if (url.includes('instagram.com')) {
      return true;
    }

    return false;
  }

  /**
   * Reset detection cache (useful for testing or after installation)
   */
  static resetCache(): void {
    this.ytDlpAvailable = null;
    this.ytDlpPath = null;
    this.ffmpegAvailable = null;
    this.ffmpegPath = null;
  }
}
