import { Service } from 'typedi';
import { FileState, GoogleAIFileManager } from '@google/generative-ai/server';
import { GenerativeModel, GoogleGenerativeAI } from '@google/generative-ai';
import { FileMetadataResponse } from '@google/generative-ai/dist/server/server';
import fs from 'fs';
import { instructionsWithTimeSchema, recipeTimestampsSchema } from '../constants/ai-schemas';
import { RecipeTimestamp } from '../models/recipe.model';

@Service()
export class RecipeInstructionsService {
  private readonly fileManager: GoogleAIFileManager;
  private readonly model: GenerativeModel;
  private readonly genAI: GoogleGenerativeAI;

  constructor() {
    const apiKey = process.env.GOOGLE_API_KEY;

    if (!apiKey) {
      throw new Error(`GOOGLE_API_KEY is not provided`);
    }
    this.genAI = new GoogleGenerativeAI(apiKey);

    this.fileManager = new GoogleAIFileManager(apiKey);
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

  async generateInstructionsFromVideo(videoPath: string): Promise<{ instructions: string; timestamps: RecipeTimestamp[] }> {
    try {
      const file = await this.uploadVideo(videoPath);

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
     //      {
     //        role: 'user',
     //        parts: [
     //          {
     //            text: `
     //  This is the video where the chief is cooking the recipe.
     //  Your goal is to output step by step cooking instructions in a list format with no extra commentary based on the video context.
     // Add to each step the corresponding timestamps (format mm:ss) to help create a  visually enhanced recipe.
     //  Example of the output:
     //    ------
     //    1. Remove from heat and stir in a knob of butter and a generous amount of grated Parmesan cheese (00:33 - 00:43);
     //    2. Begin adding the warm vegetable broth, one ladleful at a time, stirring continuously until each addition is absorbed before adding more. This process should take about 15-20 minutes (01:10 - 01:24);
     //    3. Add the Arborio rice to the pan and toast for a couple of minutes, stirring constantly, until the grains are slightly translucent (01:33 - 01:53);
     //    ------
     //    Remember don't ask any question, just generate instructions.
     //  `,
     //          },
     //        ],
     //      },
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

      this.fileManager.deleteFile(file.name);

      return JSON.parse(result.response.text());
    } catch (e: any) {
      console.error(`Couldn't generate instructions from the video`, e.message);

      throw e;
    }
  }

  /**
   * Get video timestamps by given recipe instructions
   */
  async getTimestamps(instructions: string[], videoPath: string): Promise<RecipeTimestamp[]> {
    try {
      const file = await this.uploadVideo(videoPath);
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
            `,
              },
            ],
          },
        ],
      });

      const response = JSON.parse(result.response.text());

      if (!response.timestamps) {
        console.error(`Timestamps are empty`);

        return [];
      }

      return response.timestamps;
    } catch (e: any) {
      console.error(`Couldn't get timestamps`);

      return [];
    }
  }

  private async uploadVideo(videoPath: string): Promise<FileMetadataResponse> {
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video does not exist under the path: ${videoPath}`);
    }

    const fileResult = await this.fileManager.uploadFile(videoPath, {
      displayName: 'video',
      mimeType: 'video/mp4',
    });

    console.log(`Video uploaded: ${fileResult.file.uri}`);

    const name = fileResult.file.name;

    let file = await this.fileManager.getFile(name);

    console.log('Processing...');

    while (file.state === FileState.PROCESSING) {
      process.stdout.write('.');
      await new Promise((resolve) => setTimeout(resolve, 100));
      // Fetch the file from the API again
      file = await this.fileManager.getFile(name);
    }

    if (file.state === FileState.FAILED) {
      throw new Error('Video processing failed.');
    }

    console.log(`\nVideo is ACTIVE`);

    return fileResult.file;
  }
}
