import { Service } from 'typedi';
import puppeteer from 'puppeteer';
import { IgDownloader } from 'ig-downloader';
import { XdtShortcodeMedia } from 'ig-downloader/dist/types/types/XdtShortcodeMedia';

const minimal_args = [
  // '--autoplay-policy=user-gesture-required',
  // '--disable-background-networking',
  // '--disable-background-timer-throttling',
  // '--disable-backgrounding-occluded-windows',
  // '--disable-breakpad',
  // '--disable-client-side-phishing-detection',
  // '--disable-component-update',
  // '--disable-default-apps',
  // '--disable-dev-shm-usage',
  // '--disable-domain-reliability',
  // '--disable-extensions',
  // '--disable-features=AudioServiceOutOfProcess',
  // '--disable-hang-monitor',
  // '--disable-ipc-flooding-protection',
  // '--disable-notifications',
  // '--disable-offer-store-unmasked-wallet-cards',
  // '--disable-popup-blocking',
  // '--disable-print-preview',
  // '--disable-prompt-on-repost',
  // '--disable-renderer-backgrounding',
  // '--disable-setuid-sandbox',
  '--no-sandbox',
];

@Service()
export class InstaScrapperService {
  async getPostDescriptionByUrl(url: string): Promise<string | null> {
    try {
      console.log(`Start scrapping: ${url}`);

      const browser = await puppeteer.launch({
        // Handle M1 chip issue
        executablePath: process.env.IS_MAC_M1 === 'true'
          ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
          : puppeteer.executablePath(),
        args: minimal_args,
        headless: true,
      });
      const page = await browser.newPage();

      await page.setUserAgent('Mozilla/5.0 (Linux; Android 11; E24T Build/RQ3A.210705.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/122.0.6261.120 Safari/537.36');

      await page.goto(url, { waitUntil: 'domcontentloaded' });

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

  async getPostMediaData(postUrl: string): Promise<XdtShortcodeMedia | null> {
    try {
      const data = await IgDownloader(postUrl);

      return data;
    } catch (e: any) {
      console.error(`Couldn't get post media: ${e.message}`);

      return null;
    }

  }

  async getPostMetadata(postUrl: string): Promise<{ videoUrl: string | undefined; description: string | null, imageUrl: string | undefined }> {
    const [postDescription, mediaData] = await Promise.all([
      this.getPostDescriptionByUrl(postUrl),
      this.getPostMediaData(postUrl),
    ]);

    return { description: postDescription, videoUrl: mediaData?.video_url, imageUrl: mediaData?.thumbnail_src };
  }

}