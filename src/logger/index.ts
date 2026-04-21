export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export type LogSink = (entry: Record<string, unknown>) => void;

export type Logger = {
  info: (message: string, metadata?: Record<string, unknown>) => void;
  warn: (message: string, metadata?: Record<string, unknown>) => void;
  error: (message: string, metadata?: Record<string, unknown>) => void;
  debug: (message: string, metadata?: Record<string, unknown>) => void;
};

export function createLogger(options: { module: string; traceId: string; sink?: LogSink }): Logger {
  const sink: LogSink = options.sink ?? ((entry) => process.stdout.write(`${JSON.stringify(entry)}\n`));

  const emit = (level: LogLevel, message: string, metadata: Record<string, unknown> = {}) => {
    sink({
      level,
      timestamp: new Date().toISOString(),
      module: options.module,
      traceId: options.traceId,
      message,
      ...metadata
    });
  };

  return {
    info: (message, metadata) => emit('info', message, metadata),
    warn: (message, metadata) => emit('warn', message, metadata),
    error: (message, metadata) => emit('error', message, metadata),
    debug: (message, metadata) => emit('debug', message, metadata)
  };
}
