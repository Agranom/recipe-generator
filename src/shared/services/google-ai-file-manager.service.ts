import { Service } from 'typedi';
import { FileMetadataResponse, GoogleAIFileManager, FileState } from '@google/generative-ai/server';
import fs from 'fs';

@Service()
export class GoogleAiFileManagerService {
  private readonly fileManager: GoogleAIFileManager;

  constructor() {
    if (!process.env.GOOGLE_API_KEY) {
      throw new Error(`GOOGLE_API_KEY is not provided`);
    }

    this.fileManager = new GoogleAIFileManager(process.env.GOOGLE_API_KEY);
  }

  async uploadVideo(path: string): Promise<FileMetadataResponse> {
    if (!fs.existsSync(path)) {
      throw new Error(`Video does not exist under the path: ${path}`);
    }

    try {
      const fileResult = await this.fileManager.uploadFile(path, {
        displayName: 'video',
        mimeType: 'video/mp4',
      });

      console.log(`Video uploaded: ${fileResult.file.uri}`);

      return fileResult.file;
    } catch (e: any) {
      console.error(`Upload video failed: ${e.message}`);

      throw e;
    }
  }

  async deleteFileById(fileId: string): Promise<void> {
    await this.fileManager.deleteFile(fileId);
  }

  async waitUntilActive(fileId: string): Promise<void> {
    let file = await this.fileManager.getFile(fileId);

    console.log('Processing...');

    while (file.state === FileState.PROCESSING) {
      process.stdout.write('.');
      await new Promise((resolve) => setTimeout(resolve, 100));
      // Fetch the file from the API again
      file = await this.fileManager.getFile(fileId);
    }

    if (file.state === FileState.FAILED) {
      throw new Error('Video processing failed.');
    }

    console.log(`\nVideo is ACTIVE`);
  }
}