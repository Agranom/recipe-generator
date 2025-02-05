import { Inject, Service } from 'typedi';
import { RecipeGeneratorService } from '../services/recipe-generator.service';
import express from 'express';
import { InvalidRecipeError } from '../shared/errors/invalid-recipe.error';
import { RecipeInstructionsService } from '../services/recipe-instructions.service';

@Service()
export class RecipeGeneratorController {
  constructor(@Inject() private recipeGenerator: RecipeGeneratorService,
              @Inject() private recipeInstructionsService: RecipeInstructionsService) {
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

      if (e instanceof InvalidRecipeError) {
        return res.status(400).send(e.message)
      }

      res.status(500).send('Internal server error');
    }
  }
}
