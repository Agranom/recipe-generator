import { FileMetadataResponse } from '@google/generative-ai/server';

export interface RecipeVideoMetadata extends Pick<FileMetadataResponse, 'mimeType' | 'uri'> {
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
