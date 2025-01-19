import { Service } from 'typedi';
import puppeteer from 'puppeteer';

@Service()
export class InstaScrapperService {
  async getPostDescriptionByUrl(url: string): Promise<string | null> {
    try {
      console.log(`Start scrapping: ${url}`);

      const browser = await puppeteer.launch({
        // Handle M1 chip issue
        executablePath: process.env.IS_MAC_M1 === 'true' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '',
        headless: true,
      });
      const page = await browser.newPage();

      await page.goto(url, {
        waitUntil: 'networkidle2',
      });

      // Extract content of the <meta property="og:title" ... />
      const description = await page.evaluate(() => {
        const metaTag = document.querySelector('meta[property="og:title"]');
        return metaTag ? metaTag.getAttribute('content') : null;
      });

      console.log('Instagram Post/Reel Description:', description);

      await browser.close();

      return description;
    } catch (e: any) {
      console.error(`getPostDescriptionByUrl failed`, e.message);

      throw e;
    }

  }

}