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

  describe('getPostDescriptionByUrl', () => {

    it('should return text from "content" meta by instagram url', async () => {
      const url = 'https://www.instagram.com/reel/DBHExLYonRH/?utm_source=ig_web_copy_link';
      const result = await service.getPostDescriptionByUrl(url);

      expect(result).toBeTruthy();
    });
  });
});
