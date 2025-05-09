import { Service } from 'typedi';
import puppeteer from 'puppeteer';
import { retry } from '../shared/utils/retry.util';

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

  // method to get instagram post video url using puppeteer
  async getPostVideoUrl(postUrl: string): Promise<string | null> {
    try {
      const browser = await puppeteer.launch({
        // Handle M1 chip issue
        executablePath: process.env.IS_MAC_M1 === 'true'
          ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
          : puppeteer.executablePath(),
        args: minimal_args,
        headless: true,
      });

      const page = await browser.newPage();

      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

      // Set viewport to mimic a standard desktop display
      await page.setViewport({ width: 1280, height: 800 });

      // Enable request interception to capture video URLs from network requests
      await page.setRequestInterception(true);
      
      let videoUrl: string | null = null;
      
      page.on('request', request => {
        request.continue();
      });
      
      page.on('response', async response => {
        const url = response.url();
        // Check for common video formats in responses
        if (url.includes('.mp4') || url.includes('video') || 
            url.includes('blob:') || url.includes('instagram.com/p/') || 
            url.includes('cdninstagram')) {
          const contentType = response.headers()['content-type'] || '';
          if (contentType.includes('video') || url.endsWith('.mp4')) {
            // Clean the URL by removing byte range parameters that make it unplayable
            let cleanUrl = url;
            if (url.includes('bytestart=') || url.includes('byteend=')) {
              // Remove the byte range parameters
              cleanUrl = url.split('&bytestart=')[0];
              if (cleanUrl.includes('&byteend=')) {
                cleanUrl = cleanUrl.split('&byteend=')[0];
              }
            }
            videoUrl = cleanUrl;
          }
        }
      });

      // Navigate to the post and wait longer to ensure content loads
      await page.goto(postUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // If we haven't captured the video URL through network requests, try these alternative methods
      if (!videoUrl) {
        // Wait for video elements to be available
        await page.waitForSelector('video', { timeout: 5000 }).catch(() => console.log('No video element found directly'));
        
        // Try multiple approaches to extract video URL
        videoUrl = await page.evaluate(() => {
          // Method 1: Direct video element
          const videoElement = document.querySelector('video') as HTMLVideoElement | null;
          if (videoElement && videoElement.src) return videoElement.src;
          
          // Method 2: Source inside video element
          const source = document.querySelector('video source') as HTMLSourceElement | null;
          if (source && source.src) return source.src;
          
          // Method 3: Look for videos inside iframes
          const iframes = document.querySelectorAll('iframe');
          for (const iframe of iframes) {
            try {
              const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
              if (iframeDoc) {
                const iframeVideo = iframeDoc.querySelector('video') as HTMLVideoElement | null;
                if (iframeVideo && iframeVideo.src) return iframeVideo.src;
              }
            } catch (e) {
              // Cross-origin restrictions may prevent access
              console.error('Error getting Instagram video URL:', e);
            }
          }
          
          // Method 4: Check for video URLs in JSON data embedded in the page
          const scripts = document.querySelectorAll('script[type="application/ld+json"]');
          for (const script of scripts) {
            try {
              const data = JSON.parse(script.textContent || '');
              if (data.video?.contentUrl) return data.video.contentUrl;
            } catch (e) {
              // Invalid JSON
              console.error('Error getting Instagram video URL:', e);
            }
          }
          
          return null;
        });
      }

      await browser.close();

      return videoUrl;
    } catch (error) {
      console.error('Error getting Instagram video URL:', error);
      return null;
    }
  }

  async getPostMetadata(postUrl: string): Promise<{ videoUrl: string | null; description: string | null, imageUrl: string | undefined }> {    
    try {
      const [postDescription, videoUrl] = await Promise.all([
        retry(() => this.getPostDescriptionByUrl(postUrl), { maxAttempts: 2, delayMs: 2000 }),
        this.getPostVideoUrl(postUrl),
      ]);

      // Clean the video URL if it still contains byte range parameters
      let cleanVideoUrl = videoUrl;
      if (videoUrl && (videoUrl.includes('bytestart=') || videoUrl.includes('byteend='))) {
        cleanVideoUrl = videoUrl.split(/&bytestart=|&byteend=/)[0];
      }

      return { description: postDescription, videoUrl: cleanVideoUrl, imageUrl: undefined };
    } catch (error) {
      console.error('Error getting post metadata:', error);
      return { description: null, videoUrl: null, imageUrl: undefined };
    }
  }

}