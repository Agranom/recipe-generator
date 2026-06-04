import './instrumentation';
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import express from 'express';
import { Container } from 'typedi';
import { RecipeGeneratorController } from './src/controllers/recipe-generator.controller';
import cors from 'cors';
import { otelSDK } from './instrumentation';
import { PinoLoggerAdapter } from './src/shared/services/pino-logger.adapter';
import { LOGGER_TOKEN } from './src/shared/services/logger.service';

dotenv.config({ path: '.env' });

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.ORIGIN, methods: ['POST'] }))

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
  const controller = Container.get(RecipeGeneratorController);
  const logger = Container.get(LOGGER_TOKEN);

  app.post('/getInstagramPostMetadata', controller.getInstagramPostMetadata.bind(controller));
  app.post('/generateFromInstagram', controller.generateFromInstagram.bind(controller));
  app.post('/deleteRecipeVideo', controller.deleteRecipeVideo.bind(controller));

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
