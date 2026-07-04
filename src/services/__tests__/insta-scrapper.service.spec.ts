import { InstaScrapperService } from '../insta-scrapper.service';
import { Logger } from '../../shared/interfaces/logger.interface';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const REEL_URL = 'https://www.instagram.com/reel/DBHExLYonRH/';

function makeResponse(media: Record<string, unknown> | null) {
  return { data: { data: { xdt_shortcode_media: media } } };
}

describe('InstaScrapperService', () => {
  let logger: jest.Mocked<Logger>;
  let service: InstaScrapperService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SCRAPECREATORS_API_KEY = 'test-key';
    logger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn(),
      fatal: jest.fn(),
    };
    service = new InstaScrapperService(logger);
  });

  it('creates the instance', () => {
    expect(service).toBeTruthy();
  });

  it('throws if SCRAPECREATORS_API_KEY is missing', () => {
    delete process.env.SCRAPECREATORS_API_KEY;
    expect(() => new InstaScrapperService(logger)).toThrow(/SCRAPECREATORS_API_KEY/);
  });

  it('maps description, video URL, and image URL from the API response', async () => {
    mockedAxios.get.mockResolvedValue(
      makeResponse({
        edge_media_to_caption: { edges: [{ node: { text: 'Yummy pasta recipe' } }] },
        video_url: 'https://cdn.example.com/video.mp4',
        display_url: 'https://cdn.example.com/image.jpg',
      })
    );

    const result = await service.getPostMetadata(REEL_URL);

    expect(result).toEqual({
      description: 'Yummy pasta recipe',
      videoUrl: 'https://cdn.example.com/video.mp4',
      imageUrl: 'https://cdn.example.com/image.jpg',
    });
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://api.scrapecreators.com/v1/instagram/post',
      expect.objectContaining({
        params: { url: REEL_URL },
        headers: { 'x-api-key': 'test-key' },
      })
    );
  });

  it('strips bytestart/byteend params from the video URL', async () => {
    mockedAxios.get.mockResolvedValue(
      makeResponse({
        edge_media_to_caption: { edges: [{ node: { text: 'caption' } }] },
        video_url: 'https://cdn.example.com/video.mp4?efg=1&bytestart=0&byteend=100',
        display_url: 'https://cdn.example.com/image.jpg',
      })
    );

    const result = await service.getPostMetadata(REEL_URL);

    expect(result.videoUrl).toBe('https://cdn.example.com/video.mp4?efg=1');
  });

  it('returns null videoUrl for a post without a video, keeping the description', async () => {
    mockedAxios.get.mockResolvedValue(
      makeResponse({
        edge_media_to_caption: { edges: [{ node: { text: 'photo caption' } }] },
        display_url: 'https://cdn.example.com/image.jpg',
      })
    );

    const result = await service.getPostMetadata(REEL_URL);

    expect(result.description).toBe('photo caption');
    expect(result.videoUrl).toBeNull();
    expect(result.imageUrl).toBe('https://cdn.example.com/image.jpg');
  });

  it('returns all-null fields and logs when the API fails on every attempt', async () => {
    jest.useFakeTimers();
    mockedAxios.get.mockRejectedValue(new Error('network down'));

    const promise = service.getPostMetadata(REEL_URL);
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ description: null, videoUrl: null, imageUrl: undefined });
    expect(mockedAxios.get).toHaveBeenCalledTimes(3);
    expect(logger.error).toHaveBeenCalled();
    jest.useRealTimers();
  });
});
