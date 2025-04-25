import { Service } from 'typedi';
import { Storage, File } from '@google-cloud/storage';
import fs from 'fs';
import path from 'path';

export interface VideoUploadResult {
  fileId?: string;
  publicUrl: string;
  size: number;
}

@Service()
export class GoogleStorageService {
  private readonly storage: Storage;
  private readonly bucketName: string;

  constructor() {
    if (!process.env.GOOGLE_CLOUD_BUCKET_NAME) {
      throw new Error('GOOGLE_CLOUD_BUCKET_NAME is not provided');
    }

    this.bucketName = process.env.GOOGLE_CLOUD_BUCKET_NAME;
    this.storage = new Storage();
  }

  async uploadVideo(filePath: string): Promise<VideoUploadResult> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Video does not exist under the path: ${filePath}`);
    }

    const fileName = path.basename(filePath);
    const destFileName = `videos/${fileName}`;
    
    try {
      const [file] = await this.storage.bucket(this.bucketName).upload(filePath, {
        destination: destFileName,
        metadata: {
          contentType: 'video/mp4',
        },
        public: true,
      });


      const [metadata] = await file.getMetadata();
      const publicUrl = file.publicUrl();

      return {
        fileId: file?.id,
        publicUrl,
        size: Number(metadata.size),
      };
    } catch (err: any) {
      console.error(`Upload video failed: ${err.message}`);
      throw err;
    }
  }

  async deleteFile(fileName: string): Promise<void> {
    try {
      await this.storage.bucket(this.bucketName).file(fileName).delete();
    } catch (err: any) {
      console.error(`Delete file failed: ${err.message}`);
      throw err;
    }
  }

  private async makeFilePublic(file: File): Promise<void> {
    await file.makePublic();
  }
} 