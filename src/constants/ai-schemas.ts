import { z } from 'zod';
import { ResponseSchema, SchemaType } from '@google-cloud/vertexai';

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
    })
  ),
});

export const recipeValidationSchema = z.object({
  isRecipe: z.boolean().describe('Is the text a cooking recipe?'),
  hasIngredients: z
    .boolean()
    .describe('Does the recipe contains cooking ingredients (at least one)'),
  hasInstructions: z.boolean().describe('Does the recipe contains instructions how to cook it'),
});

export const instructionsWithTimeSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    instructions: {
      type: SchemaType.STRING,
      description:
        'Single string with concise cooking instructions. Each step must be on its own line, start with the step number followed by a period, and describe exactly one visible cooking action.',
      example: `
1. Toast the Arborio rice in the pan until the grains are slightly translucent.
2. Add warm vegetable broth one ladle at a time, stirring until each addition is absorbed.
3. Remove from heat and stir in butter and grated Parmesan cheese.
      `,
    },
    timestamps: {
      type: SchemaType.ARRAY,
      description:
        'One timestamp object per instruction step. Step numbers must match the numbered lines in "instructions", be sorted in ascending order, and contain no duplicates.',
      items: {
        type: SchemaType.OBJECT,
        properties: {
          step: {
            type: SchemaType.INTEGER,
            description: 'Instruction step number from the "instructions" field.',
          },
          startTime: {
            type: SchemaType.STRING,
            description: 'Start time of the cooking step in the video using mm:ss format.',
          },
          endTime: {
            type: SchemaType.STRING,
            description: 'End time of the cooking step in the video using mm:ss format.',
          },
        },
        required: ['step', 'startTime', 'endTime'],
      },
    },
  },
  required: ['instructions', 'timestamps'],
};

export const recipeTimestampsSchema: ResponseSchema = {
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
            description:
              'End time of the cooking step in a format mm:ss. Set to null if the step in not shown on the video.',
          },
        },
        required: ['step'],
      },
    },
  },
  required: ['timestamps'],
};
