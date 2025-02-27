import { z } from 'zod';
import { Schema, SchemaType } from '@google/generative-ai';

export const recipeSchema = z.object({
  title: z.string({ required_error: 'title is required' }).describe('The name of the recipe'),
  description: z.string().describe('Short description/summary of the recipe'),
  instructions: z.array(z.string()).describe('Sequentially step by step cooking instructions'),
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

export const instructionsWithTimeSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    // instructions: {
    //   type: SchemaType.ARRAY,
    //   description: 'Sequentially step by step cooking instructions',
    //   items: {
    //     type: SchemaType.STRING,
    //   },
    // },
    instructions: {
      type: SchemaType.STRING,
      description: 'Step by step cooking instructions. Start each step with a new line and the step number (1, 2, 3, etc.)',
      example: `
       1. Remove from heat and stir in a knob of butter and a generous amount of grated Parmesan cheese;
       2. Begin adding the warm vegetable broth, one ladleful at a time, stirring continuously until each addition is absorbed before adding more. This process should take about 15-20 minutes;
       3. Add the Arborio rice to the pan and toast for a couple of minutes, stirring constantly, until the grains are slightly translucent;
      `,
    },
    timestamps: {
      type: SchemaType.ARRAY,
      description: 'Recipe video timestamps which correspond to cooking instructions described in "instructions" field.',
      items: {
        type: SchemaType.OBJECT,
        properties: {
          step: {
            type: SchemaType.NUMBER,
            description: `Instruction's Step number`,
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
        required: ['step'],
      },
    },
  },
  required: ['instructions', 'timestamps'],
};

export const recipeTimestampsSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    timestamps: {
      type: SchemaType.ARRAY,
      description: 'Recipe video timestamps which correspond to cooking instructions.',
      items: {
        type: SchemaType.OBJECT,
        properties: {
          step: {
            type: SchemaType.NUMBER,
            description: 'Step number',
          },
          startTime: {
            type: SchemaType.STRING,
            description: `Start time of the cooking step in a format mm:ss. Set to null if the step in not shown on the video.`,
          },
          endTime: {
            type: SchemaType.STRING,
            description: 'End time of the cooking step in a format mm:ss. Set to null if the step in not shown on the video.',
          },
        },
        required: ['step'],
      },
    },
  },
  required: ['timestamps'],
};