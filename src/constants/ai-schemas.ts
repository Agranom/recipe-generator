import { z } from 'zod';
import { Schema, SchemaType } from '@google/generative-ai';

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

// export const recipeInstructionsSchema = z.object({
//   instructions: z.string().describe('Sequentially (1, 2, 3 ...) step by step cooking instructions. Start each step with a new line'),
//   timestamps: z.array(
//     z.object({
//       step: z.number().describe('Step number'),
//       startTime: z.string().describe('Start time of the current cooking step in format mm:ss'),
//       endTime: z.string().describe('End time of the cooking step in format mm:ss'),
//     })).describe('Appropriate video timestamps which correspond to cooking instructions described in "instructions" field.')
// });

export const recipeInstructionsSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    instructions: {
      type: SchemaType.STRING,
      description: 'Sequentially (1, 2, 3 ...) step by step cooking instructions. Start each step with a new line',
    },
    timestamps: {
      type: SchemaType.ARRAY,
      description: 'Appropriate video timestamps which correspond to cooking instructions described in "instructions" field.',
      items: {
        type: SchemaType.OBJECT,
        properties: {
          step: {
            type: SchemaType.NUMBER,
            description: 'Step number',
          },
          startTime: {
            type: SchemaType.STRING,
            description: 'Start time of the current cooking step in format mm:ss',
          },
          endTime: {
            type: SchemaType.STRING,
            description: 'End time of the cooking step in format mm:ss',
          },
        },
        required: ['step', 'startTime', 'endTime'],
      },
    },
  },
  required: ['instructions', 'timestamps'],
};