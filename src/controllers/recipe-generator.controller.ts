import { Inject, Service } from 'typedi';
import { RecipeGeneratorService } from '../services/recipe-generator.service';
import express from 'express';
import { InvalidRecipeError } from '../shared/errors/invalid-recipe.error';
import { LOGGER_TOKEN } from '../shared/services/logger.service';
import { Logger } from '../shared/interfaces/logger.interface';

@Service()
export class RecipeGeneratorController {
  constructor(
    @Inject() private recipeGenerator: RecipeGeneratorService,
    @Inject(LOGGER_TOKEN) private logger: Logger
  ) {}

  async getInstagramPostMetadata(req: express.Request, res: express.Response): Promise<unknown> {
    const { postUrl } = req.body;

    if (!postUrl) {
      return res.status(400).send('postUrl is required');
    }

    try {
      const result = await this.recipeGenerator.getRecipeMetadata(postUrl);

      return res.status(200).json(result);
    } catch (e: any) {
      this.logger.error(`getInstagramPostMetadata fails`, { err: e });

      if (e instanceof InvalidRecipeError) {
        return res.status(400).send(e.message);
      }

      res.status(500).send('Internal server error');
    }
  }

  async generateFromInstagram(req: express.Request, res: express.Response) {
    try {
      const { metadata, targetLanguage, useMetricSystem } = req.body;
      const result = await this.recipeGenerator.generateRecipe(metadata, {
        targetLanguage,
        useMetricSystem,
      });

      return res.status(200).json(result);
    } catch (e) {
      this.logger.error(`generateFromInstagram fails`, { err: e });

      res.status(500).send('Internal server error');
    }
  }

  async deleteRecipeVideo(req: express.Request, res: express.Response): Promise<unknown> {
    try {
      const { publicFileId } = req.body;

      await this.recipeGenerator.deleteRecipeVideo({ publicFileId });

      return res.sendStatus(204);
    } catch (e) {
      this.logger.error(`deleteRecipeVideo fails`, { err: e });

      res.status(500).send('Internal server error');
    }
  }
}
