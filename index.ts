import './instrumentation';
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { Container } from 'typedi';
import { otelSDK } from './instrumentation';
import { PinoLoggerAdapter } from './src/shared/services/pino-logger.adapter';
import { LOGGER_TOKEN } from './src/shared/services/logger.service';
import { createApp } from './src/app';

dotenv.config({ path: '.env' });

const port = process.env.PORT || 4000;

(async () => {
  Container.set(LOGGER_TOKEN, new PinoLoggerAdapter(
    {
      level: process.env.LOG_LEVEL || 'info',
      transport: process.env.NODE_ENV !== 'production' ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
        },
      } : undefined,
      formatters: {
        level(label) {
          return { severity: label.toUpperCase() };
        },
      }
    }));
  const app = createApp();
  const logger = Container.get(LOGGER_TOKEN);

  process.on('unhandledRejection', (error: Error, promise: Promise<unknown>) => {
    logger.error('Unhandled Rejection at Promise', { err: error, promise });

    throw error;
  });

  process.on('uncaughtException', (error: unknown) => {
    logger.error('Unhandled error', { err: error });

    process.exit(1);
  });

  app.listen(port, () => {
    try {
      // tslint:disable-next-line:no-console
      logger.log(`server started at port: ${port}`);
      logger.log(`Server time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
    } catch (e) {
      logger.error('server failed to start', { err: e });
    }
  });

  process.on('SIGTERM', () => {
    otelSDK.shutdown()
      .then(() => logger.log('OTel SDK shutdown'))
      .catch((error) => logger.error('Error shutting down OTel SDK', { err: error }))
      .finally(() => process.exit(0));
  });

  process.on('SIGINT', () => {
    otelSDK.shutdown()
      .then(() => logger.log('OTel SDK shutdown'))
      .catch((error) => logger.error('Error shutting down OTel SDK', { err: error }))
      .finally(() => process.exit(0));
  });
})();
