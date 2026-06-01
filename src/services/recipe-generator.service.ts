import { Inject, Service } from 'typedi';
import { ChatOpenAI } from '@langchain/openai';
import { InstaScrapperService } from './insta-scrapper.service';
import { Runnable } from '@langchain/core/runnables';
import { recipeSchema, recipeValidationSchema } from '../constants/ai-schemas';
import {
  AIMessagePromptTemplate,
  ChatPromptTemplate,
  SystemMessagePromptTemplate,
} from '@langchain/core/prompts';
import {
  GeneratedRecipe,
  Recipe,
  RecipeInstruction,
  RecipeTimestamp,
} from '../models/recipe.model';
import { InvalidRecipeError } from '../shared/errors/invalid-recipe.error';
import { LocalVideoManagerService } from './local-video-manager.service';
import { RecipeInstructionsService } from './recipe-instructions.service';
import { RecipeHelper } from '../helpers/recipe.helper';
import { RecipeMetadata, RecipeVideoMetadata } from '../models/recipe-metadata.model';
import { GoogleStorageService } from '../shared/services/google-storage.service';
import crypto from 'crypto';
import { VideoProcessingService } from './video-processing.service';
import { retry } from '../shared/utils/retry.util';
import { Logger } from '../shared/interfaces/logger.interface';
import { LOGGER_TOKEN } from '../shared/services/logger.service';

export interface RecipeGeneratorOptions {
  targetLanguage: string;
  useMetricSystem: boolean;
}

@Service()
export class RecipeGeneratorService {
  private readonly baseLlm: ChatOpenAI;
  private readonly validationLlmChain: Runnable;

  constructor(
    @Inject() private instaScrapper: InstaScrapperService,
    @Inject() private localVideoManagerService: LocalVideoManagerService,
    @Inject() private storageService: GoogleStorageService,
    @Inject() private recipeInstructionsService: RecipeInstructionsService,
    @Inject() private videoProcessingService: VideoProcessingService,
    @Inject(LOGGER_TOKEN) private logger: Logger
  ) {
    this.baseLlm = new ChatOpenAI({
      model: 'gpt-4o-mini',
      temperature: 0,
      maxTokens: -1,
    });
    this.validationLlmChain = this.getValidationLlmChain();
  }

  async getRecipeMetadata(postUrl: string): Promise<RecipeMetadata> {
    // Extract the URL part before the query parameters
    const baseUrl = postUrl.split('?')[0];
    const { description, videoUrl, imageUrl } = await this.instaScrapper.getPostMetadata(baseUrl);

    if (!description) {
      throw new InvalidRecipeError(`Post description is empty`);
    }

    const { isRecipe, hasInstructions, hasIngredients } = await retry(
      () => this.validateRecipe(description),
      { maxAttempts: 3, delayMs: 1000 }
    );

    if (!isRecipe || (!videoUrl && !hasInstructions)) {
      throw new InvalidRecipeError(
        `Invalid recipe: ${JSON.stringify({
          isRecipe,
          isVideoUrl: !!videoUrl,
          hasInstructions,
          hasIngredients,
        })}`
      );
    }

    const defaultPreview: RecipeMetadata = { description, imageUrl, hasInstructions };

    if (!videoUrl) {
      return defaultPreview;
    }
    // Generate a hash from the postUrl to use as the video name
    const urlHash = crypto.createHash('md5').update(baseUrl).digest('hex');
    const videoName = `${urlHash}.mp4`;

    try {
      const { publicFileId, fileName, fileId } = await this.videoProcessingService.preloadVideo(
        videoUrl,
        videoName
      );

      return { ...defaultPreview, videoFile: { fileId, fileName, url: videoUrl, publicFileId } };
    } catch (e: any) {
      return defaultPreview;
    } finally {
      this.localVideoManagerService.deleteVideo(videoName);
    }
  }

  async generateRecipe(
    metadata: RecipeMetadata,
    options: RecipeGeneratorOptions = {} as RecipeGeneratorOptions
  ): Promise<Recipe> {
    const { targetLanguage, useMetricSystem } = options;
    const { description, hasInstructions, videoFile } = metadata;

    let recipeTimestamps: RecipeTimestamp[] = [];
    let recipeText = description;

    try {
      if (!hasInstructions && videoFile) {
        this.logger.log(`Generating instructions`);
        const { instructions, timestamps } = await retry(
          () => this.recipeInstructionsService.generateInstructionsFromVideo(videoFile),
          { maxAttempts: 3, useExponentialBackoff: true }
        );

        this.logger.log(`Instructions generated: ${instructions}`);
        this.logger.log(`Timestamps count: ${timestamps.length}`);

        recipeText += `\n\nInstructions: ${instructions}`;
        recipeTimestamps = timestamps;
      }

      this.logger.log('Start generating the recipe');

      const recipeLlm = this.getRecipeGeneratorLlmChain({ targetLanguage, useMetricSystem });

      const generatedRecipe: GeneratedRecipe = await retry(
        () => recipeLlm.invoke({ text: recipeText }, { timeout: 30000 }),
        { maxAttempts: 2, delayMs: 1000 }
      );

      this.logger.log(`Recipe has been generated`);

      // Generate timestamps if instructions provided in the video description
      if (hasInstructions && videoFile) {
        this.logger.log(`Generating timestamps`);

        const timestamps = await this.recipeInstructionsService.getTimestamps(
          generatedRecipe.instructions,
          videoFile
        );

        recipeTimestamps = timestamps;
      }

      const instructions: RecipeInstruction[] = RecipeHelper.mapInstructions(
        generatedRecipe.instructions,
        recipeTimestamps
      );

      if (videoFile) {
        const { url: videoUrl } = await this.videoProcessingService.publishVideo(videoFile);
        this.logger.log('Recipe video has been published to GCS');
        return { ...generatedRecipe, instructions, videoUrl };
      }

      return { ...generatedRecipe, instructions };
    } catch (e: any) {
      this.logger.error(`Couldn't generate the recipe: `, { err: e });

      throw e;
    }
  }

  async deleteRecipeVideo(file: Pick<RecipeVideoMetadata, 'publicFileId'>): Promise<void> {
    // Delete the file from the storage service (Google Cloud Storage)
    if (file.publicFileId) {
      try {
        await this.storageService.deleteFile(file.publicFileId);
        this.logger.log('Recipe video has been deleted from GCS');
      } catch (error: any) {
        this.logger.error(`Failed to delete file from GCS: ${file.publicFileId}:`, { err: error });
        throw error;
      }
    }
  }

  private async validateRecipe(recipeText: string | null): Promise<{
    isRecipe: boolean;
    hasInstructions: boolean;
    hasIngredients: boolean;
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

  private getRecipeGeneratorLlmChain({
    targetLanguage,
    useMetricSystem,
  }: RecipeGeneratorOptions): Runnable {
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
