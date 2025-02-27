import { Inject, Service } from 'typedi';
import { ChatOpenAI } from '@langchain/openai';
import { InstaScrapperService } from './insta-scrapper.service';
import { Runnable } from '@langchain/core/runnables';
import { recipeSchema, recipeValidationSchema } from '../constants/ai-schemas';
import { AIMessagePromptTemplate, ChatPromptTemplate, SystemMessagePromptTemplate } from '@langchain/core/prompts';
import { GeneratedRecipe, Recipe, RecipeInstruction, RecipeTimestamp } from '../models/recipe.model';
import { InvalidRecipeError } from '../shared/errors/invalid-recipe.error';
import { InstaVideoManagerService } from './insta-video-manager.service';
import { RecipeInstructionsService } from './recipe-instructions.service';
import { RecipeHelper } from '../helpers/recipe.helper';
import { GoogleAiFileManagerService } from '../shared/services/google-ai-file-manager.service';
import { RecipeMetadata, RecipeVideoMetadata } from '../models/recipe-metadata.model';

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
              @Inject() private recipeInstructionsService: RecipeInstructionsService,
              @Inject() private fileManagerService: GoogleAiFileManagerService) {
    this.baseLlm = new ChatOpenAI({
      model: 'gpt-4o-mini',
      temperature: 0,
      maxTokens: -1,
    });
    this.validationLlmChain = this.getValidationLlmChain();
  }

  async getRecipeMetadata(postUrl: string): Promise<RecipeMetadata> {
    const { description, videoUrl, imageUrl } = await this.instaScrapper.getPostMetadata(postUrl);

    if (!description) {
      throw new InvalidRecipeError(`Post description is empty`);
    }

    const { isRecipe, hasInstructions, hasIngredients } = await this.validateRecipe(description);

    if (!isRecipe || (!videoUrl && !hasInstructions)) {
      throw new InvalidRecipeError(`Invalid recipe: ${JSON.stringify({
        isRecipe,
        isVideoUrl: !!videoUrl,
        hasInstructions,
        hasIngredients,
      })}`);
    }

    const defaultPreview: RecipeMetadata = { description, imageUrl, videoUrl, hasInstructions };

    if (!videoUrl) {
      return defaultPreview;
    }

    const videoName = `video-${Date.now()}.mp4`;

    await this.videoManagerService.downloadVideo(videoUrl, videoName);

    try {
      const { uri, name, mimeType } = await this.fileManagerService.uploadVideo(videoName);

      return { ...defaultPreview, videoFile: { uri, fileId: name, fileName: videoName, mimeType } };
    } catch (e: any) {
      await this.videoManagerService.deleteVideo(videoName);

      return defaultPreview;
    }

  }

  async generateRecipe(metadata: RecipeMetadata, options: RecipeGeneratorOptions = {} as RecipeGeneratorOptions): Promise<Recipe> {
    const { targetLanguage, useMetricSystem } = options;
    const { description, hasInstructions, videoFile, videoUrl } = metadata;

    let recipeTimestamps: RecipeTimestamp[] = [];
    let recipeText = description;

    try {
      console.log('Start generating the recipe');

      if (!hasInstructions && videoFile) {
        const {
          instructions,
          timestamps,
        } = await this.recipeInstructionsService.generateInstructionsFromVideo(videoFile);

        console.log(`Instructions generated`);

        recipeText += `\n\nInstructions: ${instructions}`;
        recipeTimestamps = timestamps;
      }

      const recipeLlm = this.getRecipeGeneratorLlmChain({ targetLanguage, useMetricSystem });

      const generatedRecipe: GeneratedRecipe = await recipeLlm.invoke({ text: recipeText }, { timeout: 15000 });

      console.log(`Recipe has been generated`);

      // Generate timestamps if instructions provided in the video description
      if (hasInstructions && videoFile) {
        console.log(`Generating timestamps`);

        const timestamps = await this.recipeInstructionsService.getTimestamps(generatedRecipe.instructions, videoFile);

        console.log('timestamps', timestamps);

        recipeTimestamps = timestamps;
      }

      const instructions: RecipeInstruction[] = RecipeHelper.mapInstructions(generatedRecipe.instructions, recipeTimestamps);

      return { ...generatedRecipe, instructions, videoUrl };
    } catch (e: any) {
      console.error(`Couldn't generate the recipe: `, e.message);

      throw e;
    } finally {
      if (videoFile) {
        this.deleteRecipeVideo(videoFile);
      }
    }
  }

  async deleteRecipeVideo(file: Pick<RecipeVideoMetadata, 'fileId' | 'fileName'>): Promise<void> {
    this.videoManagerService.deleteVideo(file.fileName);
    await this.fileManagerService.deleteFileById(file.fileId);

    console.log('Recipe video has been deleted');
  }

  private async validateRecipe(recipeText: string | null): Promise<{
    isRecipe: boolean;
    hasInstructions: boolean;
    hasIngredients: boolean
  }> {
    if (!recipeText) {
      return { isRecipe: false, hasInstructions: false, hasIngredients: false };
    }

    return this.validationLlmChain.invoke({ text: recipeText }, { timeout: 5000 });
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
