import { Inject, Service } from 'typedi';
import axios from 'axios';
import { retry } from '../shared/utils/retry.util';
import { LOGGER_TOKEN } from '../shared/services/logger.service';
import { Logger } from '../shared/interfaces/logger.interface';

const SCRAPECREATORS_POST_URL = 'https://api.scrapecreators.com/v1/instagram/post';

@Service()
export class InstaScrapperService {
  private readonly apiKey: string;

  constructor(@Inject(LOGGER_TOKEN) private logger: Logger) {
    const apiKey = process.env.SCRAPECREATORS_API_KEY;
    if (!apiKey) {
      throw new Error('SCRAPECREATORS_API_KEY is not set');
    }
    this.apiKey = apiKey;
  }

  /**
   * Retrieves metadata (description, video URL, image URL) for an Instagram post
   * via the ScrapeCreators API. Any byte-range params that make the video URL
   * unplayable are stripped. On failure, all fields are returned as null/undefined.
   */
  async getPostMetadata(postUrl: string): Promise<{
    videoUrl: string | null;
    description: string | null;
    imageUrl: string | undefined;
  }> {
    this.logger.info('Fetching Instagram post metadata', { postUrl });
    try {
      const media = await retry(() => this.fetchMedia(postUrl), {
        maxAttempts: 3,
        delayMs: 2000,
      });

      const description: string | null =
        media?.edge_media_to_caption?.edges?.[0]?.node?.text ?? null;

      let videoUrl: string | null = media?.video_url ?? null;
      if (videoUrl && (videoUrl.includes('bytestart=') || videoUrl.includes('byteend='))) {
        videoUrl = videoUrl.split(/&bytestart=|&byteend=/)[0];
        this.logger.debug('Stripped byte-range params from video URL', { postUrl });
      }

      const imageUrl: string | undefined = media?.display_url ?? undefined;

      this.logger.info('Instagram post metadata fetched', {
        postUrl,
        hasVideo: !!videoUrl,
        hasDescription: !!description,
      });

      return { description, videoUrl, imageUrl };
    } catch (err) {
      this.logger.error('Failed to fetch Instagram post metadata', { err, postUrl });

      return { description: null, videoUrl: null, imageUrl: undefined };
    }
  }

  /**
   * Calls ScrapeCreators and returns the raw `xdt_shortcode_media` node
   * (Instagram's native payload), or null if it is absent. Logs the HTTP
   * status and a short body snippet on failure before rethrowing so `retry`
   * can retry and the cause is visible in production.
   */
  private async fetchMedia(postUrl: string): Promise<any> {
    try {
      const response = await axios.get(SCRAPECREATORS_POST_URL, {
        params: { url: postUrl },
        headers: { 'x-api-key': this.apiKey },
        timeout: 15000,
      });
      return response.data?.data?.xdt_shortcode_media ?? null;
    } catch (err: any) {
      // Read via optional chaining rather than gating on axios.isAxiosError,
      // so the status/body diagnostic is always emitted (and is testable under
      // jest.mock('axios'), where isAxiosError would be an auto-mock).
      this.logger.error('ScrapeCreators request failed', {
        err,
        status: err?.response?.status,
        body: JSON.stringify(err?.response?.data ?? '').slice(0, 300),
      });
      throw err;
    }
  }
}
