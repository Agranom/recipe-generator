import { z } from 'zod';

export const recipeSchema = z.object({
  title: z.string({ required_error: 'title is required' }).describe('The name of the recipe'),
  description: z.string().describe('Short description/summary of the recipe'),
  cookingMethod: z.string().describe('Sequentially step by step cooking instructions. Start each step with a new line'),
  portionsCount: z.number().optional().describe('For how many portions this recipe is'),
  ingredients: z.array(
    z.object({
      name: z.string().describe('Name of the recipe ingredient'),
      amount: z.string().describe('Amount of the ingredient'),
      measurementUnit: z.string().optional().describe(`Measurement unit of the ingredient`),
    }),
  ),
});

export const recipeValidationSchema = z.object({
  isRecipe: z.boolean().describe('Is the text a cooking recipe?'),
  hasIngredients: z.boolean().describe('Does the recipe contains cooking ingredients (at least one)'),
  hasInstructions: z.boolean().describe('Does the recipe contains instructions how to cook it'),
});
