import { Inject, Service } from 'typedi';
import { instructionsWithTimeSchema, recipeTimestampsSchema } from '../constants/ai-schemas';
import { RecipeTimestamp } from '../models/recipe.model';
import { RecipeVideoMetadata } from '../models/recipe-metadata.model';
import { uniqBy } from 'lodash';
import { VertexAI, GenerativeModel, GenerateContentResponse } from '@google-cloud/vertexai';
import { GoogleStorageService } from '../shared/services/google-storage.service';
import { tmpVideoDirectory } from '../shared/constants/video-directories';

interface InstructionsWithTimeResponse {
  instructions: string;
  timestamps: RecipeTimestamp[];
}

@Service()
export class RecipeInstructionsService {
  private readonly model: GenerativeModel;
  private readonly vertexAI: VertexAI;

  constructor(@Inject() private storageService: GoogleStorageService) {
    const apiKey = process.env.GOOGLE_API_KEY;

    if (!apiKey) {
      throw new Error(`GOOGLE_API_KEY is not provided`);
    }

    this.vertexAI = new VertexAI({
      project: 'boykom',
      location: 'us-central1',
    });

    this.model = this.vertexAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction:
        'You analyze cooking videos and return strict JSON that follows the provided response schema. Use only observable video evidence.',
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 4096,
        responseSchema: instructionsWithTimeSchema,
        responseMimeType: 'application/json',
      },
    });
  }

  async generateInstructionsFromVideo(
    file: RecipeVideoMetadata
  ): Promise<InstructionsWithTimeResponse> {
    try {
      const fileUri = this.storageService.getFileGsutilUrl(`${tmpVideoDirectory}/${file.fileName}`);
      console.log(`Generating instructions from video: ${fileUri}`);

      const result = await this.model.generateContent({
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
      });
      const text = this.getResponseText(result.response);
      if (!text) {
        throw new Error(`No text found in the response`);
      }
      const response = JSON.parse(text) as InstructionsWithTimeResponse;

      return response;
    } catch (error: unknown) {
      console.error(`Couldn't generate instructions from the video`, error);
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
      console.log(`Getting timestamps from video: ${fileUri}`);

      const structuredModel = this.vertexAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        systemInstruction: 'You are a cooking video analyzer.',
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 4096,
          responseSchema: recipeTimestampsSchema,
          responseMimeType: 'application/json',
        },
      });
      const instructionsStr = instructions
        .map((value, i) => `${String(i + 1)}. ${value}`)
        .join('\n');
      const result = await structuredModel.generateContent({
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
      });

      const text = this.getResponseText(result.response);
      if (!text) {
        throw new Error(`No text found in the response`);
      }
      const response = JSON.parse(text);

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

  private getResponseText(result: GenerateContentResponse): string | null {
    return result.candidates?.[0]?.content.parts?.[0]?.text ?? null;
  }
}
