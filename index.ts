import 'reflect-metadata';
import * as dotenv from 'dotenv';
import express from 'express';
import { Container } from 'typedi';
import { RecipeGeneratorController } from './src/controllers/recipe-generator.controller';
import cors from 'cors';

dotenv.config({ path: '.env' })

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.ORIGIN, methods: ['POST'] }))

const port = process.env.PORT || 4000;

(async () => {
  const controller = Container.get(RecipeGeneratorController);

  app.post('/getInstagramPostMetadata', controller.getInstagramPostMetadata.bind(controller));
  app.post('/generateFromInstagram', controller.generateFromInstagram.bind(controller));
  app.post('/deleteRecipeVideo', controller.deleteRecipeVideo.bind(controller));

  process.on('unhandledRejection', (error: Error, promise: Promise<unknown>) => {
    console.error('Unhandled Rejection at Promise', error, promise);

    throw error;
  });

  process.on('uncaughtException', (error: unknown) => {
    console.error('Unhandled error', error);

    process.exit(1);
  });

  app.listen(port, () => {
    try {
      // tslint:disable-next-line:no-console
      console.log(`server started at port: ${port}`);
      console.log(`Server time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
    } catch (e) {
      console.error('server failed to start', e);
    }
  });
})();
