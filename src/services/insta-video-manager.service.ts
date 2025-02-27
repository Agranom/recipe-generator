import { Inject, Service } from 'typedi';
import axios from 'axios';
import fs from 'fs';
import { InstaScrapperService } from './insta-scrapper.service';

@Service()
export class InstaVideoManagerService {
  constructor(@Inject() private instaScrapper: InstaScrapperService) {
  }

  async downloadVideo(videoUrl: string | undefined, outputPath: string): Promise<{ success: boolean; videoUrl?: string }> {
    if (!videoUrl) {
      console.error(`@ downloadVideo fail: videoUrl is null`);

      return { success: false };
    }

    try {
      await this.downloadVideoByUrl(videoUrl, outputPath);

      console.log(`Video has been downloaded to path: ${outputPath}`);

      return { success: true, videoUrl };
    } catch (e: any) {
      console.error(`@ downloadVideo fail: ${e.message}`);

      return { success: false };
    }

  }

  deleteVideo(path: string): void {
    if (fs.existsSync(path)) {
      fs.unlink(path, (err) => {
        if (err) {
          console.error(`Couldn't delete the video under the path: ${path}`, err.message);
        } else {
          console.log('Video deleted successfully!');
        }
      });
    }
  }

  private async downloadVideoByUrl(url: string, outputPath = ''): Promise<unknown> {
    const response = await axios.get(url, {
      responseType: 'stream',
    });

    // Create a write stream to save the video
    const writer = fs.createWriteStream(outputPath);

    // Pipe the video stream to the file
    response.data.pipe(writer);

    // Wait for the download to finish
    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log(`Video downloaded successfully to ${outputPath}`);
        resolve('done');
      });
      writer.on('error', reject);
    });
  }
}