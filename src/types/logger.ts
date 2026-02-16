/**
 * Logging types and interfaces for structured logging
 */

/**
 * Log levels in order of severity
 */
export enum LogLevel {
	DEBUG = 'DEBUG',
	INFO = 'INFO',
	WARN = 'WARN',
	ERROR = 'ERROR',
}

/**
 * Log level numeric values for comparison
 */
export const LOG_LEVEL_VALUES: Record<LogLevel, number> = {
	[LogLevel.DEBUG]: 0,
	[LogLevel.INFO]: 1,
	[LogLevel.WARN]: 2,
	[LogLevel.ERROR]: 3,
};

/**
 * Structured log entry format
 */
export interface LogEntry {
	timestamp: string;
	level: LogLevel;
	message: string;
	correlationId?: string;
	platform?: string;
	url?: string;
	method?: string;
	duration?: number;
	statusCode?: number;
	error?: {
		name: string;
		message: string;
		stack?: string;
		code?: string;
	};
	metadata?: Record<string, unknown>;
}

/**
 * Request log metadata
 */
export interface RequestLogMetadata {
	method: string;
	url: string;
	platform?: string;
	headers: Record<string, string>;
	payloadSize?: number;
	queuePosition?: number;
	correlationId: string;
	timestamp: string;
}

/**
 * Response log metadata
 */
export interface ResponseLogMetadata {
	statusCode: number;
	duration: number;
	cacheHit?: boolean;
	creditsConsumed?: number;
	responseSize?: number;
	correlationId: string;
	timestamp: string;
}

/**
 * Performance metrics for latency tracking
 */
export interface PerformanceMetrics {
	p50: number;
	p95: number;
	p99: number;
	min: number;
	max: number;
	mean: number;
	count: number;
}

/**
 * Logger configuration options
 */
export interface LoggerConfig {
	level: LogLevel;
	debugMode?: boolean;
	enableConsole?: boolean;
	enableFile?: boolean;
	sanitizeHeaders?: boolean;
	maskSensitiveData?: boolean;
	maxLogSize?: number;
	metricsEnabled?: boolean;
}

/**
 * Log transport interface for extensible logging
 */
export interface LogTransport {
	log(entry: LogEntry): void | Promise<void>;
	flush?(): void | Promise<void>;
}

/**
 * Sensitive data patterns to mask in logs
 */
export const SENSITIVE_PATTERNS = {
	apiKey: /api[_-]?key/i,
	authorization: /authorization/i,
	bearer: /bearer/i,
	token: /token/i,
	secret: /secret/i,
	password: /password/i,
	credential: /credential/i,
};

/**
 * Headers to sanitize (remove or mask)
 */
export const SENSITIVE_HEADERS = [
	'authorization',
	'x-api-key',
	'api-key',
	'x-auth-token',
	'cookie',
	'set-cookie',
	'x-csrf-token',
];
