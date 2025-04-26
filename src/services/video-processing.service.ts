// src/services/video-processing.service.ts
import { Service } from 'typedi';
import { LocalVideoManagerService } from './local-video-manager.service';
import { GoogleAiFileManagerService } from '../shared/services/google-ai-file-manager.service';
import { GoogleStorageService } from '../shared/services/google-storage.service';
import { RecipeVideoMetadata } from '../models/recipe-metadata.model';
import path from 'path';

/**
 * Handles staging & promotion of videos.
 */
@Service()
export class VideoProcessingService {

    constructor(
        private localVideoManager: LocalVideoManagerService,
        private aiFileManager: GoogleAiFileManagerService,
        private storageService: GoogleStorageService
    ) { }

    /**
     * Download from the original URL, upload to our staging area,
     * and return metadata.
     */
    async preloadVideo(videoUrl: string, videoName: string): Promise<RecipeVideoMetadata> {
        const videoPath = path.join(__dirname, videoName);

        try {
            // 1) download locally
            const downloadResult = await this.localVideoManager.downloadVideo(videoUrl, videoPath);
            if (!downloadResult.success) throw new Error('Failed to download video for staging');

            // 2) upload in parallel to both AI service and GCS staging prefix
            const [aiMeta, storageMeta] = await Promise.all([
                this.aiFileManager.uploadVideo(videoPath),
                this.storageService.uploadFile(videoPath, { targetPrefix: 'videos/tmp/', makePublic: false, contentType: 'video/mp4' })
            ]);

            return {
                uri: aiMeta.uri,
                fileId: aiMeta.name,
                fileName: videoName,
                mimeType: aiMeta.mimeType,
                url: storageMeta.publicUrl,
                publicFileId: storageMeta.fileId
            };
        } catch (error) {
            console.error('Error during video preload:', error);
            throw error;
        } finally {
            // 3) remove local temp file
            this.localVideoManager.deleteVideo(videoPath);
        }
    }

    /**
     * Promote a previously staged video into permanent storage
     * by moving it in Google Cloud Storage.
     */
    async publishVideo(staged: Pick<RecipeVideoMetadata, 'fileName' | 'fileId' | 'publicFileId'>): Promise<{ url: string, publicFileId: string }> {
        // Extract the source file path
        const sourceFile = decodeURIComponent(staged.publicFileId!);

        // Construct the destination file path - we need to include the filename
        const fileName = staged.fileName;
        const destinationFile = `videos/published/${fileName}`;

        // Move GCS object
        try {
            const { publicUrl, fileId } = await this.storageService.moveFile(
                sourceFile,
                destinationFile
            );

            return {
                url: publicUrl,
                publicFileId: fileId!
            };
        } catch (error) {
            console.error('Error during video publish:', error);
            return { url: '', publicFileId: '' };
        }
    }
}