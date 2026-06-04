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
import { trace, SpanStatusCode } from '@opentelemetry/api';

export interface RecipeGeneratorOptions {
  targetLanguage: string;
  useMetricSystem: boolean;
}

@Service()
export class RecipeGeneratorService {
  private readonly baseLlm: ChatOpenAI;
  private readonly validationLlmChain: Runnable;
  private readonly tracer = trace.getTracer('recipe-generator-service', '1.0.0');

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
    return this.tracer.startActiveSpan('getRecipeMetadata', async (span) => {
      try {
        span.setAttribute('post.url', postUrl);

        const baseUrl = postUrl.split('?')[0];
        const { description, videoUrl, imageUrl } = await this.tracer.startActiveSpan(
          'scrapeInstagramPost',
          async (scrapeSpan) => {
            try {
              const result = await this.instaScrapper.getPostMetadata(baseUrl);
              scrapeSpan.setAttribute('has.video', !!videoUrl);
              scrapeSpan.setAttribute('description.length', description?.length ?? 0);
              return result;
            } catch (err) {
              scrapeSpan.recordException(err as Error);
              scrapeSpan.setStatus({ code: SpanStatusCode.ERROR });
              throw err;
            }
          }
        );

        if (!description) {
          const error = new InvalidRecipeError(`Post description is empty`);
          span.recordException(error);
          throw error;
        }

        const { isRecipe, hasInstructions, hasIngredients } = await this.tracer.startActiveSpan(
          'validateRecipe',
          async (validateSpan) => {
            try {
              const result = await retry(() => this.validateRecipe(description), {
                maxAttempts: 3,
                delayMs: 1000,
              });
              validateSpan.setAttribute('is.recipe', result.isRecipe);
              validateSpan.setAttribute('has.instructions', result.hasInstructions);
              validateSpan.setAttribute('has.ingredients', result.hasIngredients);
              return result;
            } catch (err) {
              validateSpan.recordException(err as Error);
              validateSpan.setStatus({ code: SpanStatusCode.ERROR });
              throw err;
            }
          }
        );

        if (!isRecipe || (!videoUrl && !hasInstructions)) {
          const error = new InvalidRecipeError(
            `Invalid recipe: ${JSON.stringify({
              isRecipe,
              isVideoUrl: !!videoUrl,
              hasInstructions,
              hasIngredients,
            })}`
          );
          span.recordException(error);
          throw error;
        }

        const defaultPreview: RecipeMetadata = { description, imageUrl, hasInstructions };

        if (!videoUrl) {
          return defaultPreview;
        }

        const urlHash = crypto.createHash('md5').update(baseUrl).digest('hex');
        const videoName = `${urlHash}.mp4`;

        try {
          const { publicFileId, fileName, fileId } = await this.tracer.startActiveSpan(
            'preloadVideo',
            async (preloadSpan) => {
              try {
                const result = await this.videoProcessingService.preloadVideo(videoUrl, videoName);
                preloadSpan.setAttribute('video.name', videoName);
                preloadSpan.setAttribute('file.id', result.fileId);
                return result;
              } catch (err) {
                preloadSpan.recordException(err as Error);
                preloadSpan.setStatus({ code: SpanStatusCode.ERROR });
                throw err;
              }
            }
          );

          return {
            ...defaultPreview,
            videoFile: { fileId, fileName, url: videoUrl, publicFileId },
          };
        } catch (e: any) {
          span.addEvent('video_preload_failed', { 'error.message': e.message });
          return defaultPreview;
        } finally {
          this.localVideoManagerService.deleteVideo(videoName);
        }
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw err;
      }
    });
  }

  async generateRecipe(
    metadata: RecipeMetadata,
    options: RecipeGeneratorOptions = {} as RecipeGeneratorOptions
  ): Promise<Recipe> {
    return this.tracer.startActiveSpan('generateRecipe', async (span) => {
      try {
        const { targetLanguage, useMetricSystem } = options;
        const { description, hasInstructions, videoFile } = metadata;

        span.setAttribute('has.instructions', hasInstructions);
        span.setAttribute('has.video', !!videoFile);
        span.setAttribute('target.language', targetLanguage || 'english');
        span.setAttribute('use.metric.system', useMetricSystem);

        let recipeTimestamps: RecipeTimestamp[] = [];
        let recipeText = description;

        if (!hasInstructions && videoFile) {
          const { instructions, timestamps } = await this.tracer.startActiveSpan(
            'generateInstructionsFromVideo',
            async (instructSpan) => {
              try {
                this.logger.log(`Generating instructions`);
                const result = await retry(
                  () => this.recipeInstructionsService.generateInstructionsFromVideo(videoFile),
                  { maxAttempts: 3, useExponentialBackoff: true }
                );

                this.logger.log(`Instructions generated: ${result.instructions}`);
                this.logger.log(`Timestamps count: ${result.timestamps.length}`);

                return result;
              } catch (err) {
                instructSpan.recordException(err as Error);
                instructSpan.setStatus({ code: SpanStatusCode.ERROR });
                throw err;
              }
            }
          );

          recipeText += `\n\nInstructions: ${instructions}`;
          recipeTimestamps = timestamps;
        }

        this.logger.log('Start generating the recipe');

        const generatedRecipe: GeneratedRecipe = await this.tracer.startActiveSpan(
          'parseRecipeWithLLM',
          async (parseSpan) => {
            try {
              const recipeLlm = this.getRecipeGeneratorLlmChain({
                targetLanguage,
                useMetricSystem,
              });

              const result = await retry(
                () => recipeLlm.invoke({ text: recipeText }, { timeout: 30000 }),
                { maxAttempts: 2, delayMs: 1000 }
              );

              parseSpan.setAttribute('recipe.name', result.name || '');
              parseSpan.setAttribute('ingredients.count', result.ingredients?.length ?? 0);
              parseSpan.setAttribute('instructions.count', result.instructions?.length ?? 0);
              this.logger.log(`Recipe has been generated`);

              return result;
            } catch (err) {
              parseSpan.recordException(err as Error);
              parseSpan.setStatus({ code: SpanStatusCode.ERROR });
              throw err;
            }
          }
        );

        if (hasInstructions && videoFile) {
          recipeTimestamps = await this.tracer.startActiveSpan(
            'alignTimestampsToInstructions',
            async (timestampSpan) => {
              try {
                this.logger.log(`Generating timestamps`);
                const result = await this.recipeInstructionsService.getTimestamps(
                  generatedRecipe.instructions,
                  videoFile
                );

                timestampSpan.setAttribute('timestamps.count', result.length);
                return result;
              } catch (err) {
                timestampSpan.recordException(err as Error);
                timestampSpan.setStatus({ code: SpanStatusCode.ERROR });
                throw err;
              }
            }
          );
        }

        const instructions: RecipeInstruction[] = RecipeHelper.mapInstructions(
          generatedRecipe.instructions,
          recipeTimestamps
        );

        this.logger.log(`Instructions with timestamps: `, { instructions });

        if (videoFile) {
          const { url: videoUrl } = await this.tracer.startActiveSpan(
            'publishVideo',
            async (publishSpan) => {
              try {
                const result = await this.videoProcessingService.publishVideo(videoFile);
                publishSpan.setAttribute('video.url', result.url);
                this.logger.log('Recipe video has been published to GCS');
                return result;
              } catch (err) {
                publishSpan.recordException(err as Error);
                publishSpan.setStatus({ code: SpanStatusCode.ERROR });
                throw err;
              }
            }
          );

          return { ...generatedRecipe, instructions, videoUrl };
        }

        return { ...generatedRecipe, instructions };
      } catch (e: any) {
        span.recordException(e);
        span.setStatus({ code: SpanStatusCode.ERROR, message: e.message });
        this.logger.error(`Couldn't generate the recipe: `, { err: e });

        throw e;
      }
    });
  }

  async deleteRecipeVideo(file: Pick<RecipeVideoMetadata, 'publicFileId'>): Promise<void> {
    return this.tracer.startActiveSpan('deleteRecipeVideo', async (span) => {
      try {
        span.setAttribute('file.id', file.publicFileId || '');

        if (file.publicFileId) {
          await this.storageService.deleteFile(file.publicFileId);
          span.addEvent('video_deleted_successfully');
          this.logger.log('Recipe video has been deleted from GCS');
        }
      } catch (error: any) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        this.logger.error(`Failed to delete file from GCS: ${file.publicFileId}:`, { err: error });
        throw error;
      }
    });
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
