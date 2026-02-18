/**
 * TranscriptionService - Orchestrates Whisper-based audio transcription
 *
 * Supports:
 * - faster-whisper
 * - whisper.cpp
 * - openai-whisper
 */

import { WhisperDetector, type WhisperVariant, type WhisperModel } from '../utils/whisper';
import nodeRequire from '../utils/nodeRequire';
import type {
  TranscriptionResult,
  TranscriptionOptions,
  TranscriptionProgress,
  TranscriptionSegment,
} from '../types/transcription';
import { TranscriptionError } from '../types/transcription';
import { ProcessManager } from './ProcessManager';

// Supported local media formats (audio + video)
const SUPPORTED_MEDIA_FORMATS = [
  '.mp3', '.m4a', '.ogg', '.wav', '.flac', '.aac', '.wma',
  '.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v'
];

// Video formats that should be converted to WAV before transcription.
const VIDEO_MEDIA_FORMATS = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v'];

// Approximate memory requirements per model (in bytes)
// These are for CPU + int8 compute type (lower than GPU/float16)
const MODEL_MEMORY_REQUIREMENTS: Record<WhisperModel, number> = {
  tiny: 0.5 * 1024 * 1024 * 1024,     // 0.5GB
  base: 0.5 * 1024 * 1024 * 1024,     // 0.5GB
  small: 1 * 1024 * 1024 * 1024,      // 1GB
  medium: 2 * 1024 * 1024 * 1024,     // 2GB
  large: 4 * 1024 * 1024 * 1024,      // 4GB
  'large-v2': 4 * 1024 * 1024 * 1024, // 4GB
  'large-v3': 4 * 1024 * 1024 * 1024  // 4GB
};

// Processing time factors relative to audio duration (model factor * audio duration)
// Conservative estimates for CPU processing with int8
const MODEL_PROCESSING_FACTORS: Record<WhisperModel, number> = {
  tiny: 0.2,
  base: 0.4,
  small: 1.0,
  medium: 2.0,
  large: 5.0,
  'large-v2': 5.0,
  'large-v3': 5.0
};

export class TranscriptionService {
  private currentProcess: ReturnType<typeof import('child_process').spawn> | null = null;
  private isCancelled = false;
  private lastReportedPercentage = 0;

  /**
   * Transcribe media file (audio/video) using local Whisper
   */
  async transcribe(
    mediaPath: string,
    options: TranscriptionOptions
  ): Promise<TranscriptionResult> {
    this.isCancelled = false;
    this.lastReportedPercentage = 0;

    // 1. Validate Whisper is available (respecting user's variant preference and custom path)
    const detection = await WhisperDetector.detect(
      options.preferredVariant,
      options.customWhisperPath,
      options.forceEnableCustomPath
    );
    if (!detection.available || !detection.variant || !detection.path) {
      throw new TranscriptionError('NOT_INSTALLED', 'Whisper not detected');
    }

    // 2. Validate media file exists and format
    this.validateAudioFile(mediaPath);

    // 3. Convert video input to WAV for Whisper CLI compatibility (especially whisper.cpp)
    const preparedInput = await this.prepareInputForTranscription(mediaPath, options.signal);

    try {
      // 4. Check system resources (memory)
      this.checkSystemResources(options.model);

      // 5. Get audio duration for progress tracking
      // Use provided duration from PostData if available, fallback to ffprobe
      const audioDuration = options.audioDuration && options.audioDuration > 0
        ? options.audioDuration
        : await this.getAudioDuration(preparedInput.path);

      // 6. Calculate appropriate timeout
      const timeout = this.getTimeout(audioDuration, options.model);

      // 7. Build command based on variant
      const { command, args, outputFile } = this.buildCommand(
        detection.variant,
        detection.path,
        preparedInput.path,
        options
      );

      // 8. Execute with progress parsing and timeout
      return await this.executeTranscription(
        command,
        args,
        outputFile,
        audioDuration,
        options,
        timeout
      );
    } finally {
      await preparedInput.cleanup();
    }
  }

  /**
   * Validate media file exists and has supported format
   */
  private validateAudioFile(audioPath: string): void {
    const fs = nodeRequire('fs') as typeof import('fs');
    const path = nodeRequire('path') as typeof import('path');

    // Check file exists
    if (!fs.existsSync(audioPath)) {
      throw new TranscriptionError('AUDIO_NOT_FOUND', `Audio file not found: ${audioPath}`);
    }

    // Check format
    const ext = path.extname(audioPath).toLowerCase();
    if (!SUPPORTED_MEDIA_FORMATS.includes(ext)) {
      throw new TranscriptionError(
        'INVALID_AUDIO',
        `Unsupported media format: ${ext}`,
        `Unsupported media format: ${ext}. Supported: ${SUPPORTED_MEDIA_FORMATS.join(', ')}`
      );
    }
  }

  /**
   * Check system resources before starting transcription
   * Logs warning if available memory appears low (macOS reports inaccurately)
   * Does NOT block - let the actual process fail with a proper error if needed
   */
  private checkSystemResources(model: WhisperModel): void {
    try {
      const os = nodeRequire('os') as typeof import('os');
      const freeMemory = os.freemem();
      const requiredMemory = MODEL_MEMORY_REQUIREMENTS[model];

      if (freeMemory < requiredMemory) {
        const freeGB = (freeMemory / 1024 / 1024 / 1024).toFixed(1);
        const requiredGB = (requiredMemory / 1024 / 1024 / 1024).toFixed(1);
        // Just warn - macOS os.freemem() is unreliable (doesn't account for disk cache)
        // Let the actual Whisper process fail with a proper error if there's truly not enough memory
        console.warn(`[TranscriptionService] Low memory warning: ${freeGB}GB free, ${model} model prefers ${requiredGB}GB. Proceeding anyway.`);
      }
    } catch {
      // If memory check fails, continue anyway (non-fatal)
    }
  }

  /**
   * Get a smaller model recommendation
   */
  private getSmallerModel(model: WhisperModel): WhisperModel | null {
    const modelOrder: WhisperModel[] = ['tiny', 'base', 'small', 'medium', 'large'];
    const currentIndex = modelOrder.indexOf(model);
    return currentIndex > 0 ? modelOrder[currentIndex - 1] ?? null : null;
  }

  /**
   * Calculate timeout based on audio duration and model
   */
  private getTimeout(audioDuration: number, model: WhisperModel): number {
    const factor = MODEL_PROCESSING_FACTORS[model];

    // If duration is unknown (0), use a very long fallback (2 hours)
    if (audioDuration <= 0) {
      return 2 * 60 * 60 * 1000; // 2 hours fallback
    }

    // Minimum 10 minutes, estimated time * 2.0 buffer for safety
    const estimatedTime = audioDuration * factor * 2.0 * 1000;
    const minimumTime = 10 * 60 * 1000; // 10 minutes

    return Math.max(minimumTime, estimatedTime);
  }

  /**
   * Get audio duration using ffprobe if available
   */
  private async getAudioDuration(audioPath: string): Promise<number> {
    try {
      const { exec } = nodeRequire('child_process') as typeof import('child_process');
      const { promisify } = nodeRequire('util') as typeof import('util');
      const execAsync = promisify(exec);

      // Try ffprobe first
      const { stdout } = await execAsync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`,
        { timeout: 10000 }
      );

      const duration = parseFloat(stdout.trim());
      if (!isNaN(duration)) {
        return duration;
      }
    } catch {
      // ffprobe not available, return 0 (unknown duration)
    }

    return 0;
  }

  /**
   * Prepare media input for Whisper.
   * Video files are extracted to temporary WAV files via ffmpeg.
   */
  private async prepareInputForTranscription(
    mediaPath: string,
    signal?: AbortSignal
  ): Promise<{ path: string; cleanup: () => Promise<void> }> {
    const path = nodeRequire('path') as typeof import('path');
    const ext = path.extname(mediaPath).toLowerCase();

    if (!VIDEO_MEDIA_FORMATS.includes(ext)) {
      return {
        path: mediaPath,
        cleanup: async () => {},
      };
    }

    const wavPath = await this.extractAudioFromVideo(mediaPath, signal);
    return {
      path: wavPath,
      // eslint-disable-next-line @typescript-eslint/require-await -- cleanup must match async interface signature even though it calls only sync fs methods
      cleanup: async () => {
        const fs = nodeRequire('fs') as typeof import('fs');
        try {
          if (fs.existsSync(wavPath)) {
            fs.unlinkSync(wavPath);
          }
        } catch {
          // Ignore cleanup errors for temp files
        }
      },
    };
  }

  /**
   * Extract mono 16kHz WAV from video using ffmpeg.
   */
  private async extractAudioFromVideo(videoPath: string, signal?: AbortSignal): Promise<string> {
    const fs = nodeRequire('fs') as typeof import('fs');
    const os = nodeRequire('os') as typeof import('os');
    const path = nodeRequire('path') as typeof import('path');
    const { spawn } = nodeRequire('child_process') as typeof import('child_process');

    const ffmpegPath = await this.resolveFfmpegPath();
    if (!ffmpegPath) {
      throw new TranscriptionError(
        'INVALID_AUDIO',
        'ffmpeg not found for video transcription',
        'Video transcription requires ffmpeg. Please install ffmpeg and try again.'
      );
    }

    const baseName = path.basename(videoPath, path.extname(videoPath));
    const outputPath = path.join(os.tmpdir(), `whisper_input_${baseName}_${Date.now()}.wav`);

    return await new Promise<string>((resolve, reject) => {
      let settled = false;
      let stderrData = '';

      const ffmpegArgs = [
        '-y',
        '-i', videoPath,
        '-vn',
        '-acodec', 'pcm_s16le',
        '-ar', '16000',
        '-ac', '1',
        outputPath,
      ];

      const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs, {
        stdio: ['ignore', 'ignore', 'pipe'],
      });

      ProcessManager.register(ffmpegProcess, 'transcription', 'ffmpeg audio extraction');

      const abortHandler = () => {
        if (settled) return;
        settled = true;
        ffmpegProcess.kill('SIGTERM');
        reject(new TranscriptionError('CANCELLED', 'Video audio extraction cancelled by user'));
      };

      if (signal) {
        if (signal.aborted) {
          abortHandler();
          return;
        }
        signal.addEventListener('abort', abortHandler);
      }

      ffmpegProcess.stderr?.on('data', (data: Buffer) => {
        stderrData += data.toString();
      });

      ffmpegProcess.on('error', (error: Error) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', abortHandler);
        reject(new TranscriptionError(
          'INVALID_AUDIO',
          `Failed to start ffmpeg: ${error.message}`,
          'Could not start ffmpeg to extract audio from video.'
        ));
      });

      ffmpegProcess.on('close', (code: number | null) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', abortHandler);

        if (code === 0 && fs.existsSync(outputPath)) {
          resolve(outputPath);
          return;
        }

        // Best-effort cleanup for partial output
        try {
          if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
          }
        } catch {
          // Ignore cleanup errors
        }

        reject(new TranscriptionError(
          'INVALID_AUDIO',
          `Failed to extract audio from video (exit ${code}): ${stderrData.slice(0, 300)}`,
          'Could not extract audio from this video. Please check the file or ffmpeg installation.'
        ));
      });
    });
  }

  /**
   * Resolve an executable ffmpeg path from PATH and common install locations.
   */
  private async resolveFfmpegPath(): Promise<string | null> {
    const os = nodeRequire('os') as typeof import('os');
    const isWindows = os.platform() === 'win32';
    const username = os.userInfo().username;

    const candidates = [
      isWindows ? 'ffmpeg.exe' : 'ffmpeg',
      '/opt/homebrew/bin/ffmpeg',
      '/usr/local/bin/ffmpeg',
      '/usr/bin/ffmpeg',
      '/bin/ffmpeg',
      '/opt/local/bin/ffmpeg',
      '/snap/bin/ffmpeg',
      '/var/lib/flatpak/exports/bin/ffmpeg',
      'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe',
      `C:\\Users\\${username}\\scoop\\apps\\ffmpeg\\current\\bin\\ffmpeg.exe`,
      `C:\\Users\\${username}\\scoop\\shims\\ffmpeg.exe`,
    ];

    for (const candidate of candidates) {
      if (await this.canExecuteBinary(candidate, ['-version'])) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * Check if a binary can be executed.
   */
  private async canExecuteBinary(binaryPath: string, args: string[] = []): Promise<boolean> {
    const { spawn } = nodeRequire('child_process') as typeof import('child_process');

    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const proc = spawn(binaryPath, args, { stdio: ['ignore', 'ignore', 'ignore'] });

      proc.on('error', () => {
        if (settled) return;
        settled = true;
        resolve(false);
      });

      proc.on('close', (code: number | null) => {
        if (settled) return;
        settled = true;
        resolve(code === 0);
      });
    });
  }

  /**
   * Build variant-specific command
   */
  private buildCommand(
    variant: WhisperVariant,
    whisperPath: string,
    audioPath: string,
    options: TranscriptionOptions
  ): { command: string; args: string[]; outputFile: string | null } {
    const os = nodeRequire('os') as typeof import('os');
    const path = nodeRequire('path') as typeof import('path');

    // Create temp output file for JSON output
    const tempDir = os.tmpdir();
    const baseName = path.basename(audioPath, path.extname(audioPath));
    const outputFile = path.join(tempDir, `whisper_${baseName}_${Date.now()}.json`);

    switch (variant) {
      case 'faster-whisper': {
        // faster-whisper CLI:
        // faster-whisper audio.mp3 --model medium --language auto --output_format json --output_dir /tmp
        const args = [
          audioPath,
          '--model', options.model,
          '--output_format', 'json',
          '--output_dir', tempDir,
          '--device', 'auto',  // Use GPU if available, fallback to CPU
          '--compute_type', 'int8',  // Lower memory usage (works on CPU)
        ];

        // Always specify language explicitly for consistent behavior
        args.push('--language', options.language || 'auto');

        return {
          command: whisperPath,
          args,
          outputFile: path.join(tempDir, `${baseName}.json`),
        };
      }

      case 'whisper.cpp': {
        // whisper.cpp:
        // ./main -m models/ggml-medium.bin -f audio.wav -ojf -of /tmp/output -pp
        const modelPath = this.getWhisperCppModelPath(options.model);
        const args = [
          '-m', modelPath,
          '-f', audioPath,
          '-ojf', // Full JSON output (includes language, model info)
          '-of', outputFile.replace('.json', ''), // Output file prefix
          '-pp', // Print progress
        ];

        // Always specify language (whisper.cpp default is 'en', not 'auto')
        // Must explicitly set 'auto' for auto-detect
        args.push('-l', options.language || 'auto');

        return {
          command: whisperPath,
          args,
          outputFile,
        };
      }

      case 'openai-whisper': {
        // openai-whisper:
        // whisper audio.mp3 --model medium --language auto --output_format json --output_dir /tmp
        const args = [
          audioPath,
          '--model', options.model,
          '--output_format', 'json',
          '--output_dir', tempDir,
          '--verbose', 'True', // Enable verbose output for progress tracking
        ];

        if (options.language && options.language !== 'auto') {
          args.push('--language', options.language);
        }

        return {
          command: whisperPath,
          args,
          outputFile: path.join(tempDir, `${baseName}.json`),
        };
      }

      default:
        throw new TranscriptionError('UNKNOWN', `Unsupported Whisper variant: ${String(variant)}`);
    }
  }

  /**
   * Get whisper.cpp model file path
   */
  private getWhisperCppModelPath(model: WhisperModel): string {
    const os = nodeRequire('os') as typeof import('os');
    const path = nodeRequire('path') as typeof import('path');
    const fs = nodeRequire('fs') as typeof import('fs');

    // Common model paths for whisper.cpp
    const modelDirs = [
      path.join(os.homedir(), 'whisper-models'),           // User's custom directory
      path.join(os.homedir(), '.cache', 'whisper-cpp'),    // Recommended cache location
      path.join(os.homedir(), 'whisper.cpp', 'models'),    // Source build location
      path.join(os.homedir(), '.cache', 'whisper'),        // Generic whisper cache
      './models',
    ];

    const modelFileName = `ggml-${model}.bin`;

    for (const dir of modelDirs) {
      const modelPath = path.join(dir, modelFileName);
      if (fs.existsSync(modelPath)) {
        return modelPath;
      }
    }

    // Return default path (will fail if not found)
    return path.join(os.homedir(), 'whisper-models', modelFileName);
  }

  /**
   * Execute transcription and parse output
   */
  private async executeTranscription(
    command: string,
    args: string[],
    outputFile: string | null,
    audioDuration: number,
    options: TranscriptionOptions,
    timeout: number = 5 * 60 * 1000 // Default 5 minutes
  ): Promise<TranscriptionResult> {
    return new Promise((resolve, reject) => {
      const { spawn } = nodeRequire('child_process') as typeof import('child_process');
      const fs = nodeRequire('fs') as typeof import('fs');
      const startTime = Date.now();

      // Report initial progress
      options.onProgress?.({
        percentage: 0,
        currentTime: 0,
        totalDuration: audioDuration,
        status: 'Starting transcription...',
      });

      // Ensure PATH includes common binary locations (ffmpeg, etc.)
      const os = nodeRequire('os') as typeof import('os');
      const isWindows = os.platform() === 'win32';
      const pathSeparator = isWindows ? ';' : ':';
      const env = { ...process.env };
      const currentPath = env.PATH || env.Path || '';

      if (isWindows) {
        // Windows: Add common binary locations
        const additionalPaths = [
          process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Programs\\Python\\Python311\\Scripts`,
          process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Programs\\Python\\Python310\\Scripts`,
          process.env.APPDATA && `${process.env.APPDATA}\\Python\\Scripts`,
          'C:\\Program Files\\ffmpeg\\bin',
          'C:\\ffmpeg\\bin',
        ].filter(Boolean) as string[];
        const pathsToAdd = additionalPaths.filter(p => !currentPath.toLowerCase().includes(p.toLowerCase()));
        if (pathsToAdd.length > 0) {
          env.PATH = [...pathsToAdd, currentPath].join(pathSeparator);
        }
      } else {
        // Unix: Add common binary locations
        const additionalPaths = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
        const pathsToAdd = additionalPaths.filter(p => !currentPath.includes(p));
        if (pathsToAdd.length > 0) {
          env.PATH = [...pathsToAdd, currentPath].join(pathSeparator);
        }
      }

      // Force Python to use unbuffered output for real-time progress tracking
      env.PYTHONUNBUFFERED = '1';

      // Spawn options - Windows may need shell for proper executable resolution
      const spawnOptions: { stdio: ['ignore', 'pipe', 'pipe']; env: typeof env; shell?: boolean } = {
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      };

      // When using shell: true on Windows, paths with spaces need to be quoted
      let processedCommand = command;
      let processedArgs = args;
      if (isWindows) {
        spawnOptions.shell = true;
        // Quote command if it contains spaces
        if (command.includes(' ') && !command.startsWith('"') && !command.startsWith("'")) {
          processedCommand = `"${command}"`;
        }
        // Quote arguments that contain spaces (for shell execution)
        processedArgs = args.map(arg => {
          if (arg.includes(' ') && !arg.startsWith('"') && !arg.startsWith("'")) {
            return `"${arg}"`;
          }
          return arg;
        });
      }

      const childProcess = spawn(processedCommand, processedArgs, spawnOptions);

      this.currentProcess = childProcess;

      // Register with ProcessManager for cleanup on plugin unload
      ProcessManager.register(childProcess, 'transcription', `Whisper ${options.model}`);

      // Setup timeout handler
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          this.isCancelled = true;
          childProcess.kill('SIGTERM');
          reject(new TranscriptionError(
            'TIMEOUT',
            `Transcription timed out after ${Math.round(timeout / 1000 / 60)} minutes`,
            'Transcription timed out. Try a smaller model or shorter audio.'
          ));
        }, timeout);
      }

      // Handle abort signal
      if (options.signal) {
        const abortHandler = () => {
          this.isCancelled = true;
          childProcess.kill('SIGTERM');
          reject(new TranscriptionError('CANCELLED', 'Transcription cancelled by user'));
        };

        options.signal.addEventListener('abort', abortHandler);

        childProcess.on('close', () => {
          options.signal?.removeEventListener('abort', abortHandler);
        });
      }

      let stderrData = '';

      childProcess.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        this.parseProgress(output, audioDuration, options.onProgress);
      });

      childProcess.stderr?.on('data', (data: Buffer) => {
        const output = data.toString();
        stderrData += output;
        // Some Whisper variants output progress to stderr
        this.parseProgress(output, audioDuration, options.onProgress);
      });

      childProcess.on('close', (code: number | null) => { (() => {
        this.currentProcess = null;

        // Clear timeout handler
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        if (this.isCancelled) {
          return; // Already rejected via abort/timeout handler
        }

        const processingTime = Date.now() - startTime;

        if (code === 0) {
          try {
            // Read JSON output file
            if (outputFile && fs.existsSync(outputFile)) {
              const jsonContent = fs.readFileSync(outputFile, 'utf-8');
              const result = this.parseJsonOutput(jsonContent, options.model, processingTime);

              // Clean up temp file
              try {
                fs.unlinkSync(outputFile);
              } catch {
                // Ignore cleanup errors
              }

              options.onProgress?.({
                percentage: 100,
                currentTime: result.duration,
                totalDuration: result.duration,
                status: 'Transcription complete!',
              });

              resolve(result);
            } else {
              reject(new TranscriptionError('UNKNOWN', 'Transcription output file not found'));
            }
          } catch (error) {
            console.error(`[TranscriptionService] JSON parsing error:`, error);
            reject(new TranscriptionError(
              'UNKNOWN',
              `Failed to parse transcription output: ${error instanceof Error ? error.message : 'Unknown error'}`
            ));
          }
        } else {
          // Parse error type from stderr
          console.error(`[TranscriptionService] Process failed. Exit code: ${code}, stderr: ${stderrData.slice(0, 500)}`);
          reject(this.parseError(stderrData, code));
        }
      })(); });

      childProcess.on('error', (error: Error) => {
        console.error(`[TranscriptionService] Process spawn error:`, error);
        this.currentProcess = null;
        reject(new TranscriptionError(
          'UNKNOWN',
          `Failed to start Whisper process: ${error.message}`
        ));
      });
    });
  }

  /**
   * Parse progress from stdout/stderr
   * Progress never goes backwards - only reports if percentage is higher than last reported
   */
  private parseProgress(
    output: string,
    totalDuration: number,
    onProgress?: (progress: TranscriptionProgress) => void
  ): void {
    if (!onProgress) return;

    // Helper to report progress only if it's higher than last reported
    const reportProgress = (percentage: number, currentTime: number, status: string) => {
      const clampedPercentage = Math.min(99, percentage);
      if (clampedPercentage > this.lastReportedPercentage) {
        this.lastReportedPercentage = clampedPercentage;
        onProgress({
          percentage: clampedPercentage,
          currentTime,
          totalDuration,
          status,
        });
      }
    };

    // Try different progress patterns

    // openai-whisper verbose: "[00:00.000 --> 00:02.880]" or "[0:00.000 --> 0:02.880]"
    // Also handles hours format: "[00:00:00.000 --> 00:00:02.880]"
    // The END timestamp shows how far we've transcribed
    const openaiVerboseMatch = output.match(/\[\d+:[\d:.]+\s*-->\s*(\d+):(\d+)[.:](\d+)/);
    if (openaiVerboseMatch && openaiVerboseMatch[1] && openaiVerboseMatch[2]) {
      const minutes = parseInt(openaiVerboseMatch[1], 10);
      const seconds = parseInt(openaiVerboseMatch[2], 10);
      const currentTime = minutes * 60 + seconds;

      if (totalDuration > 0) {
        const rawPercentage = (currentTime / totalDuration) * 100;
        const percentage = 10 + (rawPercentage * 0.89);
        reportProgress(percentage, currentTime, `Transcribing... ${this.formatTime(currentTime)}`);
      }
      return;
    }

    // faster-whisper: "[00:12.340 --> 00:15.670] text..."
    const timestampMatch = output.match(/\[(\d{2}):(\d{2})\.(\d{3})/);
    if (timestampMatch && timestampMatch[1] && timestampMatch[2]) {
      const minutes = parseInt(timestampMatch[1], 10);
      const seconds = parseInt(timestampMatch[2], 10);
      const currentTime = minutes * 60 + seconds;

      if (totalDuration > 0) {
        // Map timestamp progress to 10-99% range (0-10% reserved for loading phase)
        const rawPercentage = (currentTime / totalDuration) * 100;
        const percentage = 10 + (rawPercentage * 0.89); // 10% + (0-89%)
        reportProgress(percentage, currentTime, `Transcribing... ${this.formatTime(currentTime)}`);
      }
      return;
    }

    // whisper.cpp: "whisper_full: progress = 45%"
    const percentMatch = output.match(/progress\s*=\s*(\d+)%/i);
    if (percentMatch && percentMatch[1]) {
      const percentage = parseInt(percentMatch[1], 10);
      const currentTime = totalDuration > 0 ? (percentage / 100) * totalDuration : 0;
      // Map to 10-99% range
      const mappedPercentage = 10 + (percentage * 0.89);
      reportProgress(mappedPercentage, currentTime, `Transcribing... ${percentage}%`);
      return;
    }

    // openai-whisper: "Transcribing: 45%|███████████████"
    const barMatch = output.match(/(\d+)%\|/);
    if (barMatch && barMatch[1]) {
      const percentage = parseInt(barMatch[1], 10);
      const currentTime = totalDuration > 0 ? (percentage / 100) * totalDuration : 0;
      // Map to 10-99% range
      const mappedPercentage = 10 + (percentage * 0.89);
      reportProgress(mappedPercentage, currentTime, `Transcribing... ${percentage}%`);
      return;
    }

    // Generic progress indicators (loading phase: 0-10%)
    if (output.includes('Loading model') || output.includes('loading model')) {
      reportProgress(5, 0, 'Loading model...');
    } else if (output.includes('Processing') || output.includes('Transcribing')) {
      reportProgress(10, 0, 'Processing audio...');
    }
  }

  /**
   * Parse JSON output from Whisper
   * Handles different JSON formats:
   * - faster-whisper/openai-whisper: { segments: [{ start, end, text }] }
   * - whisper.cpp: { transcription: [{ offsets: { from, to }, text }] }
   */
  private parseJsonOutput(
    jsonContent: string,
    model: WhisperModel,
    processingTime: number
  ): TranscriptionResult {
    const json = JSON.parse(jsonContent) as Record<string, unknown>;

    // Handle different JSON formats from different Whisper variants
    const rawSegments = (Array.isArray(json.segments) ? json.segments : (Array.isArray(json.transcription) ? json.transcription : []));
    const segments: TranscriptionSegment[] = rawSegments.map(
      (segment: {
        id?: number;
        // faster-whisper / openai-whisper format
        start?: number;
        end?: number;
        // whisper.cpp format (offsets in milliseconds)
        offsets?: { from: number; to: number };
        // whisper.cpp format (timestamps as strings)
        timestamps?: { from: string; to: string };
        text: string;
        words?: Array<{
          word: string;
          start?: number;
          end?: number;
          // whisper.cpp word format
          offsets?: { from: number; to: number };
          probability?: number;
          confidence?: number;
          p?: number; // whisper.cpp uses 'p' for probability
        }>;
        tokens?: Array<{
          text: string;
          offsets?: { from: number; to: number };
          p?: number;
        }>;
      }, index: number) => {
        // Parse start/end time, handling different formats
        let startTime: number;
        let endTime: number;

        if (typeof segment.start === 'number' && typeof segment.end === 'number') {
          // faster-whisper / openai-whisper: times in seconds
          startTime = segment.start;
          endTime = segment.end;
        } else if (segment.offsets) {
          // whisper.cpp: offsets in milliseconds
          startTime = segment.offsets.from / 1000;
          endTime = segment.offsets.to / 1000;
        } else if (segment.timestamps) {
          // whisper.cpp: timestamps as strings "00:00:00,720"
          startTime = this.parseTimestampString(segment.timestamps.from);
          endTime = this.parseTimestampString(segment.timestamps.to);
        } else {
          // Fallback
          startTime = 0;
          endTime = 0;
        }

        // Parse words if available
        const words = segment.words?.map((w) => {
          let wordStart: number;
          let wordEnd: number;

          if (typeof w.start === 'number' && typeof w.end === 'number') {
            wordStart = w.start;
            wordEnd = w.end;
          } else if (w.offsets) {
            wordStart = w.offsets.from / 1000;
            wordEnd = w.offsets.to / 1000;
          } else {
            wordStart = startTime;
            wordEnd = endTime;
          }

          return {
            word: w.word,
            start: wordStart,
            end: wordEnd,
            probability: w.probability ?? w.confidence ?? w.p ?? 1,
          };
        });

        return {
          id: segment.id ?? index,
          start: startTime,
          end: endTime,
          text: segment.text.trim(),
          words,
        };
      }
    );

    // Calculate duration from last segment
    const lastSegment = segments[segments.length - 1];
    const jsonResult = json.result as Record<string, unknown> | undefined;
    const jsonInfo = json.info as Record<string, unknown> | undefined;
    const duration = lastSegment?.end || (typeof json.duration === 'number' ? json.duration : 0);

    return {
      segments,
      // whisper.cpp: detected language is in result.language
      // faster-whisper: may be in info.language
      // openai-whisper: language is at top level
      language: (typeof jsonResult?.language === 'string' ? jsonResult.language : null)
        ?? (typeof jsonInfo?.language === 'string' ? jsonInfo.language : null)
        ?? (typeof json.language === 'string' ? json.language : null)
        ?? 'en',
      duration,
      processingTime,
      model,
      hasWordTimestamps: segments.some((s) => s.words && s.words.length > 0),
    };
  }

  /**
   * Parse timestamp string from whisper.cpp format
   * Format: "00:00:00,720" or "00:00:08,880"
   */
  private parseTimestampString(timestamp: string): number {
    if (!timestamp) return 0;

    // Format: "HH:MM:SS,mmm" or "HH:MM:SS.mmm"
    const match = timestamp.match(/(\d+):(\d+):(\d+)[,.](\d+)/);
    if (match && match[1] && match[2] && match[3] && match[4]) {
      const hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const seconds = parseInt(match[3], 10);
      const milliseconds = parseInt(match[4], 10);
      return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
    }

    // Try simpler format: "MM:SS,mmm"
    const simpleMatch = timestamp.match(/(\d+):(\d+)[,.](\d+)/);
    if (simpleMatch && simpleMatch[1] && simpleMatch[2] && simpleMatch[3]) {
      const minutes = parseInt(simpleMatch[1], 10);
      const seconds = parseInt(simpleMatch[2], 10);
      const milliseconds = parseInt(simpleMatch[3], 10);
      return minutes * 60 + seconds + milliseconds / 1000;
    }

    return 0;
  }

  /**
   * Parse error from stderr output
   */
  private parseError(stderr: string, exitCode: number | null): TranscriptionError {
    const lowerStderr = stderr.toLowerCase();

    // Check for specific error patterns
    if (lowerStderr.includes('out of memory') || lowerStderr.includes('cuda out of memory')) {
      return new TranscriptionError(
        'OUT_OF_MEMORY',
        `Out of memory: ${stderr.slice(0, 200)}`
      );
    }

    if (lowerStderr.includes('model') && (lowerStderr.includes('not found') || lowerStderr.includes('does not exist'))) {
      return new TranscriptionError(
        'MODEL_NOT_FOUND',
        `Model not found: ${stderr.slice(0, 200)}`
      );
    }

    if (lowerStderr.includes('timeout')) {
      return new TranscriptionError(
        'TIMEOUT',
        `Transcription timed out: ${stderr.slice(0, 200)}`
      );
    }

    if (lowerStderr.includes('invalid') || lowerStderr.includes('unsupported') || lowerStderr.includes('cannot decode')) {
      return new TranscriptionError(
        'INVALID_AUDIO',
        `Invalid audio file: ${stderr.slice(0, 200)}`
      );
    }

    // Generic error
    return new TranscriptionError(
      'UNKNOWN',
      `Transcription failed with exit code ${exitCode}: ${stderr.slice(0, 200)}`
    );
  }

  /**
   * Format time in MM:SS or HH:MM:SS
   */
  private formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  /**
   * Cancel ongoing transcription
   */
  cancel(): void {
    this.isCancelled = true;
    if (this.currentProcess) {
      this.currentProcess.kill('SIGTERM');
      this.currentProcess = null;
    }
  }

  /**
   * Check if transcription is in progress
   */
  isRunning(): boolean {
    return this.currentProcess !== null;
  }

  /**
   * Convert transcription result to markdown format
   */
  static toMarkdown(result: TranscriptionResult): string {
    const lines: string[] = [];

    for (const segment of result.segments) {
      const timestamp = TranscriptionService.formatTimestamp(segment.start);
      lines.push(`[${timestamp}] ${segment.text}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Format timestamp for display
   */
  static formatTimestamp(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
}
