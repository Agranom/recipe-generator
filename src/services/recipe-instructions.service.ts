import { Inject, Service } from 'typedi';
import { GenerativeModel, GoogleGenerativeAI } from '@google/generative-ai';
import { instructionsWithTimeSchema, recipeTimestampsSchema } from '../constants/ai-schemas';
import { RecipeTimestamp } from '../models/recipe.model';
import { GoogleAiFileManagerService } from '../shared/services/google-ai-file-manager.service';
import { RecipeVideoMetadata } from '../models/recipe-metadata.model';
import { uniqBy } from 'lodash';

@Service()
export class RecipeInstructionsService {
  private readonly model: GenerativeModel;
  private readonly genAI: GoogleGenerativeAI;

  constructor(@Inject() private fileManagerService: GoogleAiFileManagerService) {
    const apiKey = process.env.GOOGLE_API_KEY;

    if (!apiKey) {
      throw new Error(`GOOGLE_API_KEY is not provided`);
    }
    this.genAI = new GoogleGenerativeAI(apiKey);

    this.model = this.genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      systemInstruction: 'You are a cooking video analyzer.',
      generationConfig: {
        temperature: 0,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
        responseSchema: instructionsWithTimeSchema,
        responseMimeType: 'application/json'
      },
    });
  }

  async generateInstructionsFromVideo(file: RecipeVideoMetadata): Promise<{ instructions: string; timestamps: RecipeTimestamp[] }> {
    try {
      await this.fileManagerService.waitUntilActive(file.fileId);

      const result = await this.model.generateContent({
        contents: [
          {
            role: 'user', parts: [
              {
                fileData: {
                  mimeType: file.mimeType,
                  fileUri: file.uri,
                },
              },
            ],
          },
          {
            role: 'user',
            parts: [
              {
                text: `
      This is the video where the chief is cooking the recipe.
      Your goal is to output step by step cooking instructions in a list format with no extra commentary based on the video context.

       Output the result based on the schema.
      `,
              },
            ],
          },
        ],
      });

      return JSON.parse(result.response.text());
    } catch (e: any) {
      console.error(`Couldn't generate instructions from the video`, e.message);

      throw e;
    }
  }

  /**
   * Get video timestamps by given recipe instructions
   */
  async getTimestamps(instructions: string[], file: RecipeVideoMetadata): Promise<RecipeTimestamp[]> {
    try {
      await this.fileManagerService.waitUntilActive(file.fileId);

      const structuredModel = this.genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        systemInstruction: 'You are a cooking video analyzer.',
        generationConfig: {
          ...this.model.generationConfig,
          responseSchema: recipeTimestampsSchema,
        },
      });
      const instructionsStr = instructions
        .map((value, i) => `${String(i + 1)}. ${value}`)
        .join('\n');
      const result = await structuredModel.generateContent({
        contents: [
          {
            role: 'user', parts: [
              {
                fileData: {
                  mimeType: file.mimeType,
                  fileUri: file.uri,
                },
              },
            ],
          },
          {
            role: 'user', parts: [
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
      });

      const response = JSON.parse(result.response.text());

      if (!response.timestamps) {
        console.warn(`Timestamps are empty`);

        return [];
      }


      return uniqBy<RecipeTimestamp>(response.timestamps, 'step');
    } catch (e: any) {
      console.error(`Couldn't get timestamps`);

      return [];
    }
  }
}
