import { FileMetadataResponse } from '@google/generative-ai/server';

export interface RecipeVideoMetadata {
  /** @deprecated fileId is no longer used, use publicFileId instead */
  fileId: string;
  fileName: string;
  url: string;
  publicFileId?: string;
}

export interface RecipeMetadata {
  description: string;
  hasInstructions: boolean;
  imageUrl?: string;
  videoUrl?: string;
  videoFile?: RecipeVideoMetadata;
}
