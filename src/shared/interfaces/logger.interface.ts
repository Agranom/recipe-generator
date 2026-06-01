export interface Context {
  err?: Error | unknown;
  [key: string]: any;
}

export interface Logger {
  log(message: string, context?: Context): void;
  error(message: string, context?: Context): void;
  warn(message: string, context?: Context): void;
  info(message: string, context?: Context): void;
  debug(message: string, context?: Context): void;
  trace(message: string, context?: Context): void;
  fatal(message: string, context?: Context): void;
}
