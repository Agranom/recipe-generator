import { Service } from 'typedi';
import { IgDownloader } from 'ig-downloader';
import axios from 'axios';
import fs from 'fs';

@Service()
export class InstaVideoManagerService {
  async downloadVideo(postUrl: string, outputPath: string): Promise<{ success: boolean; videoUrl?: string }> {
    try {
      const data = await IgDownloader(postUrl);

      if (!data.video_url) {
        console.error(`@ ${postUrl} downloadVideo fail: video_url is null`);

        return { success: false };
      }

      await this.downloadVideoByUrl(data.video_url, outputPath);

      console.log(`Video has been downloaded to path: ${outputPath}`);

      return { success: true, videoUrl: data.video_url };
    } catch (e: any) {
      console.error(`@ ${postUrl} downloadVideo fail: ${e.message}`);

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