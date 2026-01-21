/**
 * Centralized logging utility for the yoga platform.
 *
 * Provides consistent logging behavior across the application:
 * - In development: All logs are output to console
 * - In production: Only warnings and errors are logged
 *
 * Usage:
 * ```ts
 * import { logger } from '@/lib/logger';
 *
 * logger.debug('Detailed debug info');
 * logger.info('General info');
 * logger.warn('Warning message');
 * logger.error('Error message', error);
 * ```
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerConfig {
  /** Minimum log level to output (debug < info < warn < error) */
  minLevel: LogLevel;
  /** Whether logging is enabled */
  enabled: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Determines if we're in development mode.
 * Uses import.meta.env.DEV which is set by Vite.
 */
const isDevelopment = (): boolean => {
  try {
    return import.meta.env.DEV === true;
  } catch {
    // Fallback for non-Vite environments - assume production for safety
    return false;
  }
};

/**
 * Default configuration based on environment.
 * - Development: Show all logs (debug and above)
 * - Production: Show only warnings and errors
 */
const getDefaultConfig = (): LoggerConfig => ({
  minLevel: isDevelopment() ? 'debug' : 'warn',
  enabled: true,
});

let config: LoggerConfig = getDefaultConfig();

/**
 * Checks if a log level should be output based on current config.
 */
const shouldLog = (level: LogLevel): boolean => {
  if (!config.enabled) return false;
  return LOG_LEVELS[level] >= LOG_LEVELS[config.minLevel];
};

/**
 * Formats a log message with timestamp and optional prefix.
 */
const formatMessage = (prefix: string, message: string): string => {
  if (isDevelopment()) {
    return `[${prefix}] ${message}`;
  }
  return message;
};

/**
 * Logger instance with methods for each log level.
 */
export const logger = {
  /**
   * Debug-level logging. Only shown in development.
   * Use for detailed information useful during debugging.
   */
  debug: (message: string, ...args: unknown[]): void => {
    if (shouldLog('debug')) {
      // eslint-disable-next-line no-console
      console.debug(formatMessage('DEBUG', message), ...args);
    }
  },

  /**
   * Info-level logging. Only shown in development.
   * Use for general informational messages.
   */
  info: (message: string, ...args: unknown[]): void => {
    if (shouldLog('info')) {
      // eslint-disable-next-line no-console
      console.log(formatMessage('INFO', message), ...args);
    }
  },

  /**
   * Warning-level logging. Shown in all environments.
   * Use for potentially harmful situations that don't prevent operation.
   */
  warn: (message: string, ...args: unknown[]): void => {
    if (shouldLog('warn')) {
      // eslint-disable-next-line no-console
      console.warn(formatMessage('WARN', message), ...args);
    }
  },

  /**
   * Error-level logging. Shown in all environments.
   * Use for error events that might still allow the application to continue.
   */
  error: (message: string, ...args: unknown[]): void => {
    if (shouldLog('error')) {
      // eslint-disable-next-line no-console
      console.error(formatMessage('ERROR', message), ...args);
    }
  },

  /**
   * Configure the logger.
   * Typically called once at application startup if custom config is needed.
   */
  configure: (newConfig: Partial<LoggerConfig>): void => {
    config = { ...config, ...newConfig };
  },

  /**
   * Reset logger to default configuration.
   */
  reset: (): void => {
    config = getDefaultConfig();
  },

  /**
   * Check if currently in development mode.
   */
  isDev: isDevelopment,
};

export default logger;
