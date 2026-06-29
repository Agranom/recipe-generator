import { InstaScrapperService } from '../insta-scrapper.service';
import { Logger } from '../../shared/interfaces/logger.interface';

jest.setTimeout(30000);
describe('InstaScrapperService', () => {
  let logger: jest.Mocked<Logger>;
  let service: InstaScrapperService;

  beforeEach(() => {
    jest.clearAllMocks();
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

  it('should create the instance', () => {
    expect(service).toBeTruthy();
  });

  describe('getPostMetadata', () => {
    it('should return text from "content" meta by instagram url', async () => {
      const url = 'https://www.instagram.com/reel/DBHExLYonRH/';
      const result = await service.getPostMetadata(url);

      expect(result.description).toBeTruthy();
      expect(result.videoUrl).toBeTruthy();
      expect(result.imageUrl).toBeUndefined();
    });
  });
});
