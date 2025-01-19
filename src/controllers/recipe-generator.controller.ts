import { Inject, Service } from 'typedi';
import { RecipeGeneratorService } from '../services/recipe-generator.service';
import express from 'express';

@Service()
export class RecipeGeneratorController {
  constructor(@Inject() private recipeGenerator: RecipeGeneratorService) {
  }

  async generateFromInstagram(req: express.Request, res: express.Response) {
    try {
      const { url, targetLanguage, useMetricSystem } = req.body;
      const result = await this.recipeGenerator.generateFromUrl(url, {
        targetLanguage,
        useMetricSystem,
      });

      return res.status(200).json(result);
    } catch (e) {
      console.error(`generateRecipe fails`, e);

      res.status(500).send('Internal server error');
    }
  }
}
