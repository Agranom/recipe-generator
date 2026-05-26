import { Service } from 'typedi';
import { Storage, File } from '@google-cloud/storage';
import fs from 'fs';
import path from 'path';

export interface UploadFileResult {
  fileId?: string;
  publicUrl: string;
}

interface UploadFileOptions {
  targetPrefix?: string;
  contentType?: string;
  makePublic?: boolean;
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

  getFileGsutilUrl(destFileName: string): string {
    return `gs://${this.bucketName}/${destFileName}`;
  }



  async uploadFile(filePath: string, options: UploadFileOptions = {}): Promise<UploadFileResult> {
    console.log(`Uploading file to Google Storage: ${filePath}`);
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`File does not exist under the path: ${filePath}`);
    }

    const fileName = path.basename(filePath);
    const prefix = options.targetPrefix || '';
    const destFileName = `${prefix}${fileName}`;
    
    try {
      const [file] = await this.storage.bucket(this.bucketName).upload(filePath, {
        destination: destFileName,
        metadata: {
          contentType: options.contentType || 'application/octet-stream',
        },
        public: options.makePublic ?? true,
      });

      const publicUrl = file.publicUrl();

      console.log(`File uploaded successfully: ${publicUrl}`);

      return {
        fileId: file?.id,
        publicUrl,
      };
    } catch (err: any) {
      console.error(`Upload file failed: ${err.message}`);
      throw err;
    }
  }

  async moveFile(sourceFile: string, destinationFile: string): Promise<UploadFileResult> {
    try {
      // Move the file
      const [file] = await this.storage.bucket(this.bucketName).file(sourceFile).move(destinationFile) as [File];
      
      // Ensure the file is public after moving
      await file.makePublic();
      
      const publicUrl = file.publicUrl();
      
      return {
        fileId: destinationFile, // Return the destination path as the fileId for future reference
        publicUrl,
      };
    } catch (err: any) {
      console.error(`Move file failed: ${err.message}`);
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
} 