import { Container } from 'typedi';
import express from 'express';
import cors from 'cors';
import { RecipeGeneratorController } from './controllers/recipe-generator.controller';
import { PinoLoggerAdapter } from './shared/services/pino-logger.adapter';
import { LOGGER_TOKEN } from './shared/services/logger.service';

export function createApp() {
  if (!Container.has(LOGGER_TOKEN)) {
    Container.set(LOGGER_TOKEN, new PinoLoggerAdapter({ level: process.env.LOG_LEVEL || 'info' }));
  }

  const app = express();
  app.use(express.json());
  app.use(cors({ origin: process.env.ORIGIN, methods: ['POST'] }));

  const controller = Container.get(RecipeGeneratorController);
  app.post('/getInstagramPostMetadata', controller.getInstagramPostMetadata.bind(controller));
  app.post('/generateFromInstagram', controller.generateFromInstagram.bind(controller));
  app.post('/deleteRecipeVideo', controller.deleteRecipeVideo.bind(controller));

  return app;
}
