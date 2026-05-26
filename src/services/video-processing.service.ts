import { Service } from 'typedi';
import { LocalVideoManagerService } from './local-video-manager.service';
import { GoogleStorageService } from '../shared/services/google-storage.service';
import { RecipeVideoMetadata } from '../models/recipe-metadata.model';
import path from 'path';
import { tmpVideoDirectory, publishedVideoDirectory } from '../shared/constants/video-directories';

/**
 * Handles staging & promotion of videos.
 */
@Service()
export class VideoProcessingService {

    constructor(
        private localVideoManager: LocalVideoManagerService,
        private storageService: GoogleStorageService
    ) { }

    /**
     * Download from the original URL, upload to our staging area,
     * and return metadata.
     */
    async preloadVideo(videoUrl: string, videoName: string): Promise<RecipeVideoMetadata> {
        console.log(`Preloading video: ${videoName}`);

        const videoPath = path.join(__dirname, videoName);

        try {
            // 1) download locally
            const downloadResult = await this.localVideoManager.downloadVideo(videoUrl, videoPath);
            if (!downloadResult.success) throw new Error('Failed to download video for staging');

            // 2) upload in parallel to both AI service and GCS staging prefix
            const storageMeta = await this.storageService.uploadFile(videoPath, { targetPrefix: `${tmpVideoDirectory}/`, makePublic: false, contentType: 'video/mp4' })

            return {
                fileId: '',
                fileName: videoName,
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
        const destinationFile = `${publishedVideoDirectory}/${fileName}`;

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