import 'reflect-metadata';
import { InstaScrapperService } from '../insta-scrapper.service';
import { Container } from 'typedi';


jest.setTimeout(30000);
describe('InstaScrapperService', () => {
  let service: InstaScrapperService;

  beforeAll(() => {
    service = Container.get(InstaScrapperService);
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
