import pino, { Logger as PinoLogger, LoggerOptions } from 'pino';
import { Context, Logger } from '../interfaces/logger.interface';

export class PinoLoggerAdapter implements Logger {
  private readonly logger: PinoLogger;

  constructor(options?: LoggerOptions) {
    this.logger = pino(options);
  }

  log(message: string, context?: Context): void {
    context ? this.logger.info(context, message) : this.logger.info(message);
  }

  error(message: string, context?: Context): void {
    context ? this.logger.error(context, message) : this.logger.error(message);
  }

  warn(message: string, context?: Context): void {
    context ? this.logger.warn(context, message) : this.logger.warn(message);
  }

  info(message: string, context?: Context): void {
    context ? this.logger.info(context, message) : this.logger.info(message);
  }

  debug(message: string, context?: Context): void {
    context ? this.logger.debug(context, message) : this.logger.debug(message);
  }

  trace(message: string, context?: Context): void {
    context ? this.logger.trace(context, message) : this.logger.trace(message);
  }

  fatal(message: string, context?: Context): void {
    context ? this.logger.fatal(context, message) : this.logger.fatal(message);
  }
}
