/**
 * Comprehensive logging service for BrightData integration
 */

import type {
	LogEntry,
	LogLevel,
	LoggerConfig,
	LogTransport,
	RequestLogMetadata,
	ResponseLogMetadata,
	PerformanceMetrics,
} from '@/types/logger';
import { LOG_LEVEL_VALUES, SENSITIVE_HEADERS, SENSITIVE_PATTERNS } from '@/types/logger';
import type { IService } from './base/IService';

/**
 * Logger class for structured logging with performance tracking
 */
export class Logger implements IService {
	private config: Required<LoggerConfig>;
	private transports: LogTransport[] = [];
	private latencies: number[] = [];
	private latencyIndex = 0;
	private latencyCount = 0;
	private readonly maxLatencies = 10000;
	private logBuffer: LogEntry[] = [];
	private readonly maxBufferSize = 1000;

	constructor(config: Partial<LoggerConfig> = {}) {
		this.config = {
			level: config.level ?? ('DEBUG' as LogLevel),
			debugMode: config.debugMode ?? false,
			enableConsole: config.enableConsole ?? true,
			enableFile: config.enableFile ?? false,
			sanitizeHeaders: config.sanitizeHeaders ?? true,
			maskSensitiveData: config.maskSensitiveData ?? true,
			maxLogSize: config.maxLogSize ?? 10000,
			metricsEnabled: config.metricsEnabled ?? true,
		};

		// Add console transport by default
		if (this.config.enableConsole) {
			this.addTransport(new ConsoleTransport());
		}
	}

	/**
	 * IService implementation
	 */
	initialize(): void {
		this.info('Logger initialized', {
			level: this.config.level,
			debugMode: this.config.debugMode,
		});
	}

	async shutdown(): Promise<void> {
		await this.flush();
		this.info('Logger shutdown');
	}

	/**
	 * Add a log transport
	 */
	addTransport(transport: LogTransport): void {
		this.transports.push(transport);
	}

	/**
	 * Set log level
	 */
	setLevel(level: LogLevel): void {
		this.config.level = level;
	}

	/**
	 * Enable/disable debug mode
	 */
	setDebugMode(enabled: boolean): void {
		this.config.debugMode = enabled;
	}

	/**
	 * Debug level logging
	 */
	debug(message: string, metadata?: Record<string, unknown>): void {
		this.log('DEBUG' as LogLevel, message, metadata);
	}

	/**
	 * Info level logging
	 */
	info(message: string, metadata?: Record<string, unknown>): void {
		this.log('INFO' as LogLevel, message, metadata);
	}

	/**
	 * Warn level logging
	 */
	warn(message: string, metadata?: Record<string, unknown>): void {
		this.log('WARN' as LogLevel, message, metadata);
	}

	/**
	 * Error level logging
	 */
	error(message: string, error?: Error, metadata?: Record<string, unknown>): void {
		const errorMetadata = error
			? {
					error: {
						name: error.name,
						message: error.message,
						stack: error.stack,
						code: (error as unknown as Record<string, unknown>)['code'],
					},
				}
			: {};

		this.log('ERROR' as LogLevel, message, {
			...errorMetadata,
			...metadata,
		});
	}

	/**
	 * Log HTTP request
	 */
	logRequest(metadata: RequestLogMetadata): void {
		const sanitizedHeaders = this.config.sanitizeHeaders
			? this.sanitizeHeaders(metadata.headers)
			: metadata.headers;

		const logMetadata = {
			...metadata,
			headers: sanitizedHeaders,
			type: 'request',
		};

		if (this.config.debugMode) {
			this.debug(`Request: ${metadata.method} ${metadata.url}`, logMetadata);
		} else {
			this.info(`Request: ${metadata.method} ${metadata.url}`, {
				correlationId: metadata.correlationId,
				platform: metadata.platform,
				payloadSize: metadata.payloadSize,
			});
		}
	}

	/**
	 * Log HTTP response
	 */
	logResponse(metadata: ResponseLogMetadata): void {
		const logMetadata = {
			...metadata,
			type: 'response',
		};

		// Track latency for metrics
		if (this.config.metricsEnabled) {
			this.trackLatency(metadata.duration);
		}

		const statusLevel = this.getLogLevelForStatus(metadata.statusCode);

		if (this.config.debugMode) {
			this.log(statusLevel, `Response: ${metadata.statusCode} (${metadata.duration}ms)`, logMetadata);
		} else {
			this.log(statusLevel, `Response: ${metadata.statusCode} (${metadata.duration}ms)`, {
				correlationId: metadata.correlationId,
				duration: metadata.duration,
				cacheHit: metadata.cacheHit,
				creditsConsumed: metadata.creditsConsumed,
			});
		}
	}

	/**
	 * Get performance metrics
	 */
	getMetrics(): PerformanceMetrics | null {
		if (!this.config.metricsEnabled || this.latencies.length === 0) {
			return null;
		}

		const sorted = [...this.latencies].sort((a, b) => a - b);
		const count = sorted.length;

		return {
			p50: this.percentile(sorted, 50),
			p95: this.percentile(sorted, 95),
			p99: this.percentile(sorted, 99),
			min: sorted[0] ?? 0,
			max: sorted[count - 1] ?? 0,
			mean: sorted.reduce((sum, val) => sum + val, 0) / count,
			count,
		};
	}

	/**
	 * Reset metrics
	 */
	resetMetrics(): void {
		this.latencies = [];
		this.latencyIndex = 0;
		this.latencyCount = 0;
	}

	/**
	 * Flush log buffer
	 */
	async flush(): Promise<void> {
		const flushPromises = this.transports.map(async (transport) => {
			if (transport.flush) {
				await transport.flush();
			}
		});

		await Promise.all(flushPromises);
		this.logBuffer = [];
	}

	/**
	 * Get log buffer (for testing or inspection)
	 */
	getBuffer(): LogEntry[] {
		return [...this.logBuffer];
	}

	/**
	 * Clear log buffer
	 */
	clearBuffer(): void {
		this.logBuffer = [];
	}

	/**
	 * Core logging method
	 */
	private log(level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
		// Check if this log level should be emitted
		if (!this.shouldLog(level)) {
			return;
		}

		// Mask sensitive data if enabled
		const sanitizedMetadata = this.config.maskSensitiveData
			? this.maskSensitiveData(metadata)
			: metadata;

		const entry: LogEntry = {
			timestamp: new Date().toISOString(),
			level,
			message,
			...sanitizedMetadata,
		};

		// Add to buffer
		this.addToBuffer(entry);

		// Emit to all transports
		this.transports.forEach((transport) => {
			try {
				void transport.log(entry);
			} catch {
				// Avoid infinite loop by not logging transport errors
			}
		});
	}

	/**
	 * Check if log level should be emitted
	 */
	private shouldLog(level: LogLevel): boolean {
		return LOG_LEVEL_VALUES[level] >= LOG_LEVEL_VALUES[this.config.level];
	}

	/**
	 * Get appropriate log level for HTTP status code
	 */
	private getLogLevelForStatus(statusCode: number): LogLevel {
		if (statusCode >= 500) {
			return 'ERROR' as LogLevel;
		}
		if (statusCode >= 400) {
			return 'WARN' as LogLevel;
		}
		return 'INFO' as LogLevel;
	}

	/**
	 * Sanitize headers by removing/masking sensitive values
	 */
	private sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
		const sanitized: Record<string, string> = {};

		for (const [key, value] of Object.entries(headers)) {
			const keyLower = key.toLowerCase();

			if (SENSITIVE_HEADERS.includes(keyLower)) {
				sanitized[key] = '[REDACTED]';
			} else if (this.isSensitiveKey(key)) {
				sanitized[key] = this.maskValue(value);
			} else {
				sanitized[key] = value;
			}
		}

		return sanitized;
	}

	/**
	 * Check if key contains sensitive pattern
	 */
	private isSensitiveKey(key: string): boolean {
		return Object.values(SENSITIVE_PATTERNS).some((pattern) => pattern.test(key));
	}

	/**
	 * Mask sensitive data in metadata
	 */
	private maskSensitiveData(metadata?: Record<string, unknown>): Record<string, unknown> | undefined {
		if (!metadata) {
			return metadata;
		}

		const masked: Record<string, unknown> = {};

		for (const [key, value] of Object.entries(metadata)) {
			if (this.isSensitiveKey(key)) {
				masked[key] = typeof value === 'string' ? this.maskValue(value) : '[REDACTED]';
			} else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
				masked[key] = this.maskSensitiveData(value as Record<string, unknown>);
			} else {
				masked[key] = value;
			}
		}

		return masked;
	}

	/**
	 * Mask a string value
	 */
	private maskValue(value: string): string {
		if (value.length <= 8) {
			return '***';
		}
		return `${value.substring(0, 4)}...${value.substring(value.length - 4)}`;
	}

	/**
	 * Track latency for metrics
	 */
	private trackLatency(duration: number): void {
		// Circular buffer: overwrites oldest entry without array reallocation
		if (this.latencies.length < this.maxLatencies) {
			this.latencies.push(duration);
		} else {
			this.latencies[this.latencyIndex] = duration;
		}
		this.latencyIndex = (this.latencyIndex + 1) % this.maxLatencies;
		this.latencyCount++;
	}

	/**
	 * Calculate percentile
	 */
	private percentile(sorted: number[], p: number): number {
		const index = Math.ceil((sorted.length * p) / 100) - 1;
		return sorted[Math.max(0, index)] ?? 0;
	}

	/**
	 * Add entry to buffer
	 */
	private addToBuffer(entry: LogEntry): void {
		this.logBuffer.push(entry);

		// Trim buffer if exceeds max size
		if (this.logBuffer.length > this.maxBufferSize) {
			this.logBuffer = this.logBuffer.slice(-this.maxBufferSize);
		}
	}
}

/**
 * Console transport for logging to console
 */
export class ConsoleTransport implements LogTransport {
	log(entry: LogEntry): void {
		const level = entry.level.toLowerCase();
		const timestamp = new Date(entry.timestamp).toISOString();
		const logMessage = `[${timestamp}] [${entry.level}] ${entry.message}`;

		// Use appropriate console method
		if (level === 'error') {
			console.error(logMessage);
		} else if (level === 'warn') {
			console.warn(logMessage);
		} else if (level === 'debug') {
			console.debug(logMessage);
		} else {
			console.log(logMessage);
		}
	}
}

/**
 * JSON transport for structured logging
 */
export class JSONTransport implements LogTransport {
	private logs: LogEntry[] = [];

	log(entry: LogEntry): void {
		this.logs.push(entry);
	}

	getLogs(): LogEntry[] {
		return [...this.logs];
	}

	clear(): void {
		this.logs = [];
	}

	flush(): void {
		// In a real implementation, this would write to a file or external service
		this.clear();
	}
}

/**
 * Memory transport for testing
 */
export class MemoryTransport implements LogTransport {
	private entries: LogEntry[] = [];

	log(entry: LogEntry): void {
		this.entries.push(entry);
	}

	getEntries(): LogEntry[] {
		return [...this.entries];
	}

	clear(): void {
		this.entries = [];
	}

	flush(): void {
		this.clear();
	}
}

/**
 * Create a logger instance with default configuration
 */
export function createLogger(config?: Partial<LoggerConfig>): Logger {
	return new Logger(config);
}
