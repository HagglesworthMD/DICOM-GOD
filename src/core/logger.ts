/**
 * Simple dev-friendly logger with levels and timestamps
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

const MIN_LEVEL: LogLevel = import.meta.env.DEV ? 'debug' : 'info';

function shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[MIN_LEVEL];
}

function formatTime(): string {
    return new Date().toISOString().slice(11, 23);
}

function formatMessage(level: LogLevel, module: string, msg: string): string {
    return `[${formatTime()}] [${level.toUpperCase()}] [${module}] ${msg}`;
}

export function createLogger(module: string) {
    return {
        debug: (msg: string, ...args: unknown[]) => {
            if (shouldLog('debug')) {
                console.debug(formatMessage('debug', module, msg), ...args);
            }
        },
        info: (msg: string, ...args: unknown[]) => {
            if (shouldLog('info')) {
                console.info(formatMessage('info', module, msg), ...args);
            }
        },
        warn: (msg: string, ...args: unknown[]) => {
            if (shouldLog('warn')) {
                console.warn(formatMessage('warn', module, msg), ...args);
            }
        },
        error: (msg: string, ...args: unknown[]) => {
            if (shouldLog('error')) {
                console.error(formatMessage('error', module, msg), ...args);
            }
        },
    };
}

export const log = createLogger('App');
