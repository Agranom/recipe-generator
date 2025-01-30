import { Inject, Service } from 'typedi';
import { ChatOpenAI } from '@langchain/openai';
import { InstaScrapperService } from './insta-scrapper.service';
import { Runnable } from '@langchain/core/runnables';
import { recipeSchema, recipeValidationSchema } from '../constants/ai-schemas';
import { AIMessagePromptTemplate, ChatPromptTemplate, SystemMessagePromptTemplate } from '@langchain/core/prompts';
import { Recipe } from '../models/recipe.model';
import { InvalidRecipeError } from '../shared/errors/invalid-recipe.error';
import { InstaVideoManagerService } from './insta-video-manager.service';
import { RecipeInstructionsService } from './recipe-instructions.service';

export interface RecipeGeneratorOptions {
  targetLanguage: string;
  useMetricSystem: boolean;
}

@Service()
export class RecipeGeneratorService {
  private readonly baseLlm: ChatOpenAI;
  private readonly validationLlmChain: Runnable;

  constructor(@Inject() private instaScrapper: InstaScrapperService,
              @Inject() private videoManagerService: InstaVideoManagerService,
              @Inject() private recipeInstructionsService: RecipeInstructionsService) {
    this.baseLlm = new ChatOpenAI({
      model: 'gpt-4o-mini',
      temperature: 0,
    });
    this.validationLlmChain = this.getValidationLlmChain();
  }

  async generateFromUrl(url: string, options: RecipeGeneratorOptions = {} as RecipeGeneratorOptions): Promise<Recipe> {
    const { targetLanguage, useMetricSystem } = options;
    let recipeText = await this.instaScrapper.getPostDescriptionByUrl(url);

    if (!recipeText) {
      throw new Error('Post description is empty');
    }
    const { isRecipe, hasIngredients, hasInstructions } = await this.validateRecipe(recipeText);
    const isRecipeValid = isRecipe && hasIngredients;

    console.log(`Recipe validated: ${JSON.stringify({ isRecipe, hasIngredients, hasInstructions })}`);

    if (!isRecipeValid) {
      throw new InvalidRecipeError(`Invalid recipe: ${JSON.stringify({ isRecipe, hasIngredients, hasInstructions })}`);
    }

    if (!hasInstructions) {
      const videoPath = `video-${Date.now()}.mp4`;

      try {
        await this.videoManagerService.downloadVideo(url, videoPath);
        const instructions = await this.recipeInstructionsService.generateInstructionsFromVideo(videoPath);

        console.log(`Instructions generated`);

        recipeText += `\n\nInstructions: ${instructions}`;
      } catch (e: any) {
        console.error(`Couldn't generate instructions from the video`, e.message);

        throw e;
      } finally {
        this.videoManagerService.deleteVideo(videoPath);
      }
    }

    const recipeLlm = this.getRecipeGeneratorLlmChain({ targetLanguage, useMetricSystem });

    return recipeLlm.invoke({ text: recipeText });
  }

  private async validateRecipe(recipeText: string): Promise<{
    isRecipe: boolean;
    hasInstructions: boolean;
    hasIngredients: boolean
  }> {

    return this.validationLlmChain.invoke({ text: recipeText });
  }

  private getValidationLlmChain(): Runnable {
    const prompt = ChatPromptTemplate.fromMessages([
      AIMessagePromptTemplate.fromTemplate(`
        You are a cooking expert. Determine if the following text is a valid recipe. 
It must contain cooking instructions and a list of ingredients.
Text: {text}
      `),
    ]);

    return prompt.pipe(this.baseLlm.withStructuredOutput(recipeValidationSchema));
  }

  private getRecipeGeneratorLlmChain({ targetLanguage, useMetricSystem }: RecipeGeneratorOptions): Runnable {
    const prompt = ChatPromptTemplate.fromMessages([
      SystemMessagePromptTemplate.fromTemplate('You are a culinary expert.'),
      AIMessagePromptTemplate.fromTemplate(`
        You are a culinary expert.
    Parse this recipe text into JSON format using the schema provided.
    Ensure clarity.
    Ensure units are consistent.
    ${targetLanguage ? `Use ${targetLanguage} language for the field values but keep the JSON keys in English` : ''}.
    ${useMetricSystem ? 'Use metric units (except for tsp abd tbsp).' : ''}
    Recipe text: {text}
      `),
    ]);

    return prompt.pipe(this.baseLlm.withStructuredOutput(recipeSchema));
  }

}
