import { Inject, Service } from 'typedi';
import { instructionsWithTimeSchema, recipeTimestampsSchema } from '../constants/ai-schemas';
import { RecipeTimestamp } from '../models/recipe.model';
import { RecipeVideoMetadata } from '../models/recipe-metadata.model';
import { uniqBy } from 'lodash';
import { GoogleGenAI, MediaResolution } from '@google/genai';
import { GoogleStorageService } from '../shared/services/google-storage.service';
import { tmpVideoDirectory } from '../shared/constants/video-directories';
import { LOGGER_TOKEN } from '../shared/services/logger.service';
import { Logger } from '../shared/interfaces/logger.interface';

interface InstructionsWithTimeResponse {
  instructions: string;
  timestamps: RecipeTimestamp[];
}

@Service()
export class RecipeInstructionsService {
  private readonly ai: GoogleGenAI;

  constructor(
    @Inject() private storageService: GoogleStorageService,
    @Inject(LOGGER_TOKEN) private logger: Logger
  ) {
    this.ai = new GoogleGenAI({ vertexai: true, project: 'boykom', location: 'us-central1' });
  }

  async generateInstructionsFromVideo(
    file: RecipeVideoMetadata
  ): Promise<InstructionsWithTimeResponse> {
    try {
      const fileUri = this.storageService.getFileGsutilUrl(`${tmpVideoDirectory}/${file.fileName}`);
      this.logger.log(`Generating instructions from video: ${fileUri}`);

      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash-lite',
        contents: [
          {
            role: 'user',
            parts: [
              {
                fileData: {
                  mimeType: 'video/mp4',
                  fileUri,
                },
              },
              {
                text: `
Analyze this cooking video and produce the recipe instructions with matching timestamps.
Requirements:
- Return only valid JSON that matches the response schema.
- Write "instructions" as one string with numbered lines: "1. ...", "2. ...", "3. ...".
- Include only cooking actions that are clearly shown or verbally explained in the video.
- Keep each instruction concise, actionable, and in chronological order.
- Create exactly one timestamp object for each numbered instruction.
- Use the same step number in each timestamp object as the matching instruction line.
- Use mm:ss for startTime and endTime, based on when the step starts and ends in the video.
- Do not duplicate steps, merge repeated actions, or add commentary outside the schema.
`,
              },
            ],
          },
        ],
        config: {
          systemInstruction:
            'You analyze cooking videos and return strict JSON that follows the provided response schema. Use only observable video evidence.',
          temperature: 0,
          maxOutputTokens: 4096,
          responseSchema: instructionsWithTimeSchema,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 },
          mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
        },
      });

      const text = response.text ?? null;
      if (!text) {
        throw new Error(`No text found in the response`);
      }

      return JSON.parse(text) as InstructionsWithTimeResponse;
    } catch (error: unknown) {
      this.logger.error(`Couldn't generate instructions from the video`, { err: error });
      throw error;
    }
  }

  /**
   * Get video timestamps by given recipe instructions
   */
  async getTimestamps(
    instructions: string[],
    file: RecipeVideoMetadata
  ): Promise<RecipeTimestamp[]> {
    try {
      const fileUri = this.storageService.getFileGsutilUrl(`${tmpVideoDirectory}/${file.fileName}`);
      this.logger.log(`Getting timestamps from video: ${fileUri}`);

      const instructionsStr = instructions
        .map((value, i) => `${String(i + 1)}. ${value}`)
        .join('\n');

      const result = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash-lite',
        contents: [
          {
            role: 'user',
            parts: [
              {
                fileData: {
                  mimeType: 'video/mp4',
                  fileUri,
                },
              },
            ],
          },
          {
            role: 'user',
            parts: [
              {
                text: `
              You are provided with a video of a cooking recipe and step-by-step instructions related to that video.
              Your goal is to review each instruction and find the corresponding timestamps in the video.
              If a step is not shown in the video, simply set the startTime and endTime to null.

              Instructions: ${instructionsStr};

              Output the result based on the schema.
              Avoid duplicated steps.
            `,
              },
            ],
          },
        ],
        config: {
          systemInstruction: 'You are a cooking video analyzer.',
          temperature: 0,
          maxOutputTokens: 4096,
          responseSchema: recipeTimestampsSchema,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 },
          mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
        },
      });
      // TEMP DIAGNOSTIC — remove after measuring
      this.logger.log(`[DIAG getTimestamps]`, { usageMetadata: result.usageMetadata });

      const text = result.text ?? null;
      if (!text) {
        throw new Error(`No text found in the response`);
      }
      const response = JSON.parse(text);

      if (!response.timestamps) {
        this.logger.warn(`Timestamps are empty`);

        return [];
      }

      return uniqBy<RecipeTimestamp>(response.timestamps, 'step');
    } catch (e: unknown) {
      this.logger.error(`Couldn't get timestamps`, { err: e });

      return [];
    }
  }
}
