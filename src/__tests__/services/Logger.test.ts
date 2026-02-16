import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Logger, ConsoleTransport, JSONTransport, MemoryTransport, createLogger } from '@/services/Logger';
import type { LogLevel, RequestLogMetadata, ResponseLogMetadata } from '@/types/logger';

describe('Logger', () => {
	let logger: Logger;
	let memoryTransport: MemoryTransport;

	beforeEach(() => {
		memoryTransport = new MemoryTransport();
		logger = new Logger({ level: 'DEBUG' as LogLevel, enableConsole: false });
		logger.addTransport(memoryTransport);
	});

	describe('Log levels', () => {
		it('should log debug messages', () => {
			logger.debug('Debug message', { key: 'value' });

			const entries = memoryTransport.getEntries();
			expect(entries).toHaveLength(1);
			expect(entries[0].level).toBe('DEBUG');
			expect(entries[0].message).toBe('Debug message');
			expect(entries[0].key).toBe('value'); // metadata is spread into entry
		});

		it('should log info messages', () => {
			logger.info('Info message');

			const entries = memoryTransport.getEntries();
			expect(entries).toHaveLength(1);
			expect(entries[0].level).toBe('INFO');
		});

		it('should log warn messages', () => {
			logger.warn('Warning message');

			const entries = memoryTransport.getEntries();
			expect(entries).toHaveLength(1);
			expect(entries[0].level).toBe('WARN');
		});

		it('should log error messages with error object', () => {
			const error = new Error('Test error');
			logger.error('Error occurred', error);

			const entries = memoryTransport.getEntries();
			expect(entries).toHaveLength(1);
			expect(entries[0].level).toBe('ERROR');
			expect(entries[0].error).toBeDefined();
			expect(entries[0].error?.name).toBe('Error');
			expect(entries[0].error?.message).toBe('Test error');
		});

		it('should respect log level threshold', () => {
			logger.setLevel('WARN' as LogLevel);

			logger.debug('Debug');
			logger.info('Info');
			logger.warn('Warning');
			logger.error('Error');

			const entries = memoryTransport.getEntries();
			expect(entries).toHaveLength(2);
			expect(entries[0].level).toBe('WARN');
			expect(entries[1].level).toBe('ERROR');
		});
	});

	describe('Request logging', () => {
		it('should log request with metadata', () => {
			const requestMetadata: RequestLogMetadata = {
				method: 'POST',
				url: 'https://api.example.com/data',
				platform: 'facebook',
				headers: {
					'content-type': 'application/json',
					authorization: 'Bearer secret-token',
				},
				payloadSize: 1024,
				queuePosition: 3,
				correlationId: 'req-123',
				timestamp: new Date().toISOString(),
			};

			logger.logRequest(requestMetadata);

			const entries = memoryTransport.getEntries();
			expect(entries).toHaveLength(1);
			expect(entries[0].message).toContain('Request');
			expect(entries[0].message).toContain('POST');
			expect(entries[0].correlationId).toBe('req-123');
		});

		it('should sanitize sensitive headers', () => {
			const requestMetadata: RequestLogMetadata = {
				method: 'GET',
				url: 'https://api.example.com/data',
				headers: {
					'authorization': 'Bearer my-secret-token',
					'x-api-key': 'sk-1234567890',
					'content-type': 'application/json',
				},
				correlationId: 'req-456',
				timestamp: new Date().toISOString(),
			};

			logger.setDebugMode(true);
			logger.logRequest(requestMetadata);

			const entries = memoryTransport.getEntries();
			const headers = entries[0].headers as Record<string, string>;

			// Headers are redacted (may be truncated by maskSensitiveData to '[RED...TED]')
			expect(headers['authorization']).toMatch(/RED.*TED/);
			expect(headers['x-api-key']).toMatch(/RED.*TED/);
			expect(headers['content-type']).toBe('application/json');
		});

		it('should not sanitize headers when disabled', () => {
			const logger2 = new Logger({
				level: 'DEBUG' as LogLevel,
				enableConsole: false,
				sanitizeHeaders: false,
				maskSensitiveData: false, // Also disable data masking
			});
			logger2.addTransport(memoryTransport);

			const requestMetadata: RequestLogMetadata = {
				method: 'GET',
				url: 'https://api.example.com/data',
				headers: {
					'authorization': 'Bearer token',
				},
				correlationId: 'req-789',
				timestamp: new Date().toISOString(),
			};

			logger2.setDebugMode(true);
			logger2.logRequest(requestMetadata);

			const entries = memoryTransport.getEntries();
			const headers = entries[0].headers as Record<string, string>;

			expect(headers['authorization']).toBe('Bearer token');
		});
	});

	describe('Response logging', () => {
		it('should log response with metadata', () => {
			const responseMetadata: ResponseLogMetadata = {
				statusCode: 200,
				duration: 150,
				cacheHit: true,
				creditsConsumed: 2,
				responseSize: 2048,
				correlationId: 'req-123',
				timestamp: new Date().toISOString(),
			};

			logger.logResponse(responseMetadata);

			const entries = memoryTransport.getEntries();
			expect(entries).toHaveLength(1);
			expect(entries[0].message).toContain('Response');
			expect(entries[0].message).toContain('200');
			expect(entries[0].message).toContain('150ms');
		});

		it('should use ERROR level for 5xx status codes', () => {
			const responseMetadata: ResponseLogMetadata = {
				statusCode: 500,
				duration: 100,
				correlationId: 'req-123',
				timestamp: new Date().toISOString(),
			};

			logger.logResponse(responseMetadata);

			const entries = memoryTransport.getEntries();
			expect(entries[0].level).toBe('ERROR');
		});

		it('should use WARN level for 4xx status codes', () => {
			const responseMetadata: ResponseLogMetadata = {
				statusCode: 404,
				duration: 50,
				correlationId: 'req-123',
				timestamp: new Date().toISOString(),
			};

			logger.logResponse(responseMetadata);

			const entries = memoryTransport.getEntries();
			expect(entries[0].level).toBe('WARN');
		});

		it('should use INFO level for 2xx status codes', () => {
			const responseMetadata: ResponseLogMetadata = {
				statusCode: 200,
				duration: 75,
				correlationId: 'req-123',
				timestamp: new Date().toISOString(),
			};

			logger.logResponse(responseMetadata);

			const entries = memoryTransport.getEntries();
			expect(entries[0].level).toBe('INFO');
		});

		it('should track latency metrics', () => {
			logger.logResponse({
				statusCode: 200,
				duration: 100,
				correlationId: 'req-1',
				timestamp: new Date().toISOString(),
			});

			logger.logResponse({
				statusCode: 200,
				duration: 200,
				correlationId: 'req-2',
				timestamp: new Date().toISOString(),
			});

			logger.logResponse({
				statusCode: 200,
				duration: 300,
				correlationId: 'req-3',
				timestamp: new Date().toISOString(),
			});

			const metrics = logger.getMetrics();

			expect(metrics).toBeDefined();
			expect(metrics!.count).toBe(3);
			expect(metrics!.min).toBe(100);
			expect(metrics!.max).toBe(300);
			expect(metrics!.mean).toBe(200);
		});
	});

	describe('Performance metrics', () => {
		it('should calculate percentiles correctly', () => {
			// Generate 100 samples
			for (let i = 1; i <= 100; i++) {
				logger.logResponse({
					statusCode: 200,
					duration: i,
					correlationId: `req-${i}`,
					timestamp: new Date().toISOString(),
				});
			}

			const metrics = logger.getMetrics();

			expect(metrics).toBeDefined();
			expect(metrics!.count).toBe(100);
			expect(metrics!.p50).toBeCloseTo(50, 0);
			expect(metrics!.p95).toBeCloseTo(95, 0);
			expect(metrics!.p99).toBeCloseTo(99, 0);
		});

		it('should reset metrics', () => {
			logger.logResponse({
				statusCode: 200,
				duration: 100,
				correlationId: 'req-1',
				timestamp: new Date().toISOString(),
			});

			expect(logger.getMetrics()?.count).toBe(1);

			logger.resetMetrics();

			expect(logger.getMetrics()).toBeNull();
		});

		it('should return null when metrics disabled', () => {
			const logger2 = new Logger({
				level: 'INFO' as LogLevel,
				metricsEnabled: false,
				enableConsole: false,
			});

			logger2.logResponse({
				statusCode: 200,
				duration: 100,
				correlationId: 'req-1',
				timestamp: new Date().toISOString(),
			});

			expect(logger2.getMetrics()).toBeNull();
		});
	});

	describe('Sensitive data masking', () => {
		it('should mask sensitive keys in metadata', () => {
			logger.info('Test message', {
				apiKey: 'sk-1234567890abcdef',
				username: 'john',
			});

			const entries = memoryTransport.getEntries();
			expect(entries[0].apiKey).toBe('sk-1...cdef');
			expect(entries[0].username).toBe('john');
		});

		it('should mask nested sensitive data', () => {
			logger.info('Test message', {
				config: {
					apiKey: 'secret-key-value',
					endpoint: 'https://api.example.com',
				},
			});

			const entries = memoryTransport.getEntries();
			const config = entries[0].config as any;

			expect(config.apiKey).toBe('secr...alue');
			expect(config.endpoint).toBe('https://api.example.com');
		});

		it('should mask authorization tokens', () => {
			logger.info('Auth test', {
				authorization: 'Bearer token-1234567890',
			});

			const entries = memoryTransport.getEntries();
			expect(entries[0].authorization).toBe('Bear...7890');
		});

		it('should not mask when disabled', () => {
			const logger2 = new Logger({
				level: 'DEBUG' as LogLevel,
				enableConsole: false,
				maskSensitiveData: false,
			});
			logger2.addTransport(memoryTransport);

			logger2.info('Test', {
				apiKey: 'sk-1234567890',
			});

			const entries = memoryTransport.getEntries();
			expect(entries[0].apiKey).toBe('sk-1234567890');
		});
	});

	describe('Debug mode', () => {
		it('should log verbose details in debug mode', () => {
			logger.setDebugMode(true);

			logger.logRequest({
				method: 'GET',
				url: 'https://api.example.com',
				headers: {},
				correlationId: 'req-1',
				timestamp: new Date().toISOString(),
			});

			const entries = memoryTransport.getEntries();
			expect(entries[0].level).toBe('DEBUG');
		});

		it('should log minimal details in normal mode', () => {
			logger.setDebugMode(false);

			logger.logRequest({
				method: 'GET',
				url: 'https://api.example.com',
				headers: {},
				correlationId: 'req-1',
				timestamp: new Date().toISOString(),
			});

			const entries = memoryTransport.getEntries();
			expect(entries[0].level).toBe('INFO');
		});
	});

	describe('Log buffer', () => {
		it('should maintain log buffer', () => {
			logger.info('Message 1');
			logger.info('Message 2');
			logger.info('Message 3');

			const buffer = logger.getBuffer();
			expect(buffer).toHaveLength(3);
		});

		it('should clear buffer', () => {
			logger.info('Message');
			expect(logger.getBuffer()).toHaveLength(1);

			logger.clearBuffer();
			expect(logger.getBuffer()).toHaveLength(0);
		});

		it('should trim buffer when exceeds max size', () => {
			// Logger has maxBufferSize of 1000
			for (let i = 0; i < 1100; i++) {
				logger.info(`Message ${i}`);
			}

			const buffer = logger.getBuffer();
			expect(buffer.length).toBeLessThanOrEqual(1000);
		});
	});

	describe('Transports', () => {
		it('should support multiple transports', () => {
			const transport1 = new MemoryTransport();
			const transport2 = new MemoryTransport();

			logger.addTransport(transport1);
			logger.addTransport(transport2);

			logger.info('Test message');

			expect(transport1.getEntries()).toHaveLength(1);
			expect(transport2.getEntries()).toHaveLength(1);
		});

		it('should flush all transports', async () => {
			const mockTransport = {
				log: vi.fn(),
				flush: vi.fn(),
			};

			logger.addTransport(mockTransport);
			logger.info('Test');

			await logger.flush();

			expect(mockTransport.flush).toHaveBeenCalled();
		});
	});

	describe('Service lifecycle', () => {
		it('should initialize', async () => {
			await logger.initialize();
			const entries = memoryTransport.getEntries();
			expect(entries.some((e) => e.message.includes('initialized'))).toBe(true);
		});

		it('should shutdown', async () => {
			await logger.shutdown();
			const entries = memoryTransport.getEntries();
			expect(entries.some((e) => e.message.includes('shutdown'))).toBe(true);
		});
	});
});

describe('ConsoleTransport', () => {
	let consoleTransport: ConsoleTransport;

	beforeEach(() => {
		consoleTransport = new ConsoleTransport();
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'debug').mockImplementation(() => {});
	});

	it('should log to console.log for INFO', () => {
		consoleTransport.log({
			timestamp: new Date().toISOString(),
			level: 'INFO' as LogLevel,
			message: 'Test',
		});

		expect(console.log).toHaveBeenCalled();
	});

	it('should log to console.error for ERROR', () => {
		consoleTransport.log({
			timestamp: new Date().toISOString(),
			level: 'ERROR' as LogLevel,
			message: 'Error',
		});

		expect(console.error).toHaveBeenCalled();
	});

	it('should log to console.warn for WARN', () => {
		consoleTransport.log({
			timestamp: new Date().toISOString(),
			level: 'WARN' as LogLevel,
			message: 'Warning',
		});

		expect(console.warn).toHaveBeenCalled();
	});

	it('should log to console.debug for DEBUG', () => {
		consoleTransport.log({
			timestamp: new Date().toISOString(),
			level: 'DEBUG' as LogLevel,
			message: 'Debug',
		});

		expect(console.debug).toHaveBeenCalled();
	});
});

describe('JSONTransport', () => {
	let jsonTransport: JSONTransport;

	beforeEach(() => {
		jsonTransport = new JSONTransport();
	});

	it('should store logs', () => {
		jsonTransport.log({
			timestamp: new Date().toISOString(),
			level: 'INFO' as LogLevel,
			message: 'Test',
		});

		expect(jsonTransport.getLogs()).toHaveLength(1);
	});

	it('should clear logs on flush', () => {
		jsonTransport.log({
			timestamp: new Date().toISOString(),
			level: 'INFO' as LogLevel,
			message: 'Test',
		});

		jsonTransport.flush();

		expect(jsonTransport.getLogs()).toHaveLength(0);
	});
});

describe('createLogger', () => {
	it('should create logger with default config', () => {
		const logger = createLogger();

		expect(logger).toBeInstanceOf(Logger);
	});

	it('should create logger with custom config', () => {
		const logger = createLogger({
			level: 'ERROR' as LogLevel,
			debugMode: true,
		});

		expect(logger).toBeInstanceOf(Logger);
	});
});
