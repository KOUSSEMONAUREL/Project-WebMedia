export type LogLevel = 'info' | 'warn' | 'error' | 'audit';

export interface LogEntry {
    level: LogLevel;
    service: string;
    message: string;
    details?: any;
    timestamp: Date;
}

const log = (level: LogLevel, service: string, message: string, details?: any) => {
    const prefix = `[${level.toUpperCase()}] [${service}]`;
    const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    console[method](`${prefix} ${message}`, details ?? '');
};

export const logger = {
    info:  (service: string, message: string, details?: any, _uri?: string) => log('info',  service, message, details),
    warn:  (service: string, message: string, details?: any, _uri?: string) => log('warn',  service, message, details),
    error: (service: string, message: string, details?: any, _uri?: string) => log('error', service, message, details),
    audit: (service: string, message: string, details?: any, _uri?: string) => log('audit', service, message, details),
};
