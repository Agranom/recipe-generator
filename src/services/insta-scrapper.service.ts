import { Service } from 'typedi';
import puppeteer, { LaunchOptions } from 'puppeteer';
import { retry } from '../shared/utils/retry.util';
import axios from 'axios';

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

const userAgent = 'Mozilla/5.0 (Linux; Android 11; E24T Build/RQ3A.210705.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/122.0.6261.120 Safari/537.36';

@Service()
export class InstaScrapperService {
  private readonly config: LaunchOptions;

  constructor() {
    this.config = {
      executablePath: process.env.IS_MAC_M1 === 'true'
        ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        : puppeteer.executablePath(),
      args: minimal_args,
      headless: true,
    };
  }

  /**
   * Retrieves metadata from an Instagram post, including the description, video URL, and image URL.
   * This method attempts to fetch the post description and video URL concurrently using retry logic.
   * If the video URL contains byte range parameters, they are removed to clean the URL.
   * 
   * @param postUrl - The URL of the Instagram post to scrape for metadata.
   * @returns A promise that resolves to an object containing the post description, video URL, and image URL.
   *          If any of these cannot be retrieved, they will be returned as null or undefined.
   */
  async getPostMetadata(postUrl: string): Promise<{ videoUrl: string | null; description: string | null, imageUrl: string | undefined }> {
    try {
      const [postDescription, videoUrl] = await Promise.all([
        retry(() => this.getPostDescriptionByUrl(postUrl), { maxAttempts: 3, delayMs: 2000 }).catch((error) => {
          console.error('Error getting Instagram post description:', error);
          return null;
        }),
        retry(() => this.getPostVideoUrl(postUrl), { maxAttempts: 3, delayMs: 2000 }).catch((error) => {
          console.error('Error getting Instagram video URL:', error);
          return null;
        }),
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

  /**
   * Attempts to get the video URL using multiple approaches
   * This implementation uses multiple strategies in sequence to get the video URL
   */
  private async getPostVideoUrl(postUrl: string): Promise<string | null> {
      // 1. Try GraphQL API with various query hashes
      const graphqlUrl = await this.getVideoUrlByGraphQL(postUrl);
      if (graphqlUrl) {
        console.log("Successfully retrieved video URL using GraphQL approach");
        return graphqlUrl;
      }

      // 2. Try HTML API as fallback
      const htmlUrl = await this.getVideoUrlByHTML(postUrl);
      if (htmlUrl) {
        console.log("Successfully retrieved video URL using HTML approach");
        return htmlUrl;
      }

      console.log("All direct API approaches failed, falling back to browser-based extraction");
      return null;
  }

  /**
   * Try to get the video URL using the GraphQL API with various query hashes
   */
  private async getVideoUrlByGraphQL(postUrl: string): Promise<string | null> {
    try {
      // Extract the shortcode from the post URL
      const urlMatch = postUrl.match(/instagram\.com\/(p|reel|tv)\/([^/?]+)/);
      if (!urlMatch || !urlMatch[2]) {
        console.warn('Could not extract post shortcode from URL');
        return null;
      }
      const shortcode = urlMatch[2];
      console.log(`Extracting video URL for shortcode: ${shortcode}`);

      const apiUrl = `https://www.instagram.com/graphql/query/?doc_id=8845758582119845&variables={"shortcode":"${shortcode}"}`;

      const response = await axios.get(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Referer': `https://www.instagram.com/p/${shortcode}/`,
          'Origin': 'https://www.instagram.com',
          'x-ig-app-id': '936619743392459',
          'sec-fetch-site': 'same-origin',
          'sec-fetch-mode': 'cors',
          'x-requested-with': 'XMLHttpRequest'
        },
        timeout: 15000
      });

      // Check if we got a valid response
      if (response.data?.data?.xdt_shortcode_media) {
        const mediaData = response.data.data.xdt_shortcode_media;
        console.log(`Successfully retrieved media data`);

        // First priority: direct video_url if available
        if (mediaData.video_url) {
          // Clean the URL if needed (sometimes contains escape characters)
          const cleanUrl = mediaData.video_url.replace(/\\u0026/g, '&');
          return cleanUrl;
        }

        // Second priority: video_versions (sometimes present for reels)
        if (mediaData.video_versions && mediaData.video_versions.length > 0) {
          // Get the highest quality version
          return mediaData.video_versions[0].url;
        }

        // Third priority: special fields for reels
        if (mediaData.clips_metadata && mediaData.clips_metadata.source_url) {
          return mediaData.clips_metadata.source_url;
        }

        // Fourth priority: check in children for carousel posts
        if (mediaData.edge_sidecar_to_children?.edges) {
          for (const edge of mediaData.edge_sidecar_to_children.edges) {
            if (edge.node.is_video && edge.node.video_url) {
              return edge.node.video_url;
            }
          }
        }

        // Fifth priority: extract from display resources
        if (mediaData.display_resources && mediaData.display_resources.length > 0) {
          const highestResResource = mediaData.display_resources.reduce(
            (prev: any, current: any) => (current.config_width > prev.config_width) ? current : prev,
            mediaData.display_resources[0]
          );

          // Sometimes video URLs can be derived from image URLs
          if (highestResResource.src) {
            const imgUrl = highestResResource.src;
            // Try to convert image URL pattern to video URL pattern
            const possibleVideoUrl = imgUrl
              .replace('/t51.', '/v51.')  // Change type indicator
              .replace('/e35/', '/e15/')  // Change encoding
              .replace(/\.[^.]+$/, '.mp4'); // Change extension

            try {
              // Verify if this URL actually returns a video
              const headResponse = await axios.head(possibleVideoUrl, { timeout: 5000 });
              if (headResponse.status === 200 &&
                (headResponse.headers['content-type']?.includes('video') ||
                  possibleVideoUrl.endsWith('.mp4'))) {
                return possibleVideoUrl;
              }
            } catch (e) {
              // Not a valid video URL, continue
            }
          }
        }
      }
    } catch (error: any) {
      // Check if it's an authentication error
      throw error;
      // Continue to the next query hash
    }

    return null;
  }


  /**
   * Retrieves the video URL from an Instagram post using Puppeteer.
   * This method launches a headless browser, navigates to the given post URL,
   * and attempts to capture the video URL through network requests or by evaluating
   * the page content. It handles various scenarios to ensure the video URL is extracted,
   * including direct video elements, sources within video elements, iframes, and JSON data.
   * 
   * @param postUrl - The URL of the Instagram post to scrape for video content.
   * @returns A promise that resolves to the video URL or null if not found.
   * @throws An error if no video URL is found after all attempts.
   */
  private async getVideoUrlByHTML(postUrl: string): Promise<string | null> {
    const browser = await puppeteer.launch(this.config);

    const page = await browser.newPage();

    await page.setUserAgent(userAgent);

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

      if (url.startsWith('blob:')) {
        return;
      }
      // Check for common video formats in responses
      if (url.includes('.mp4') || url.includes('video') ||
        url.includes('instagram.com/p/') ||
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
            console.error('Error looking for videos inside iframes:', e);
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
            console.error('Error checking for video URLs in JSON data embedded in the page:', e);
            }
          }

          return null;
        });
    }

    await browser.close();

    if (!videoUrl) {
      throw new Error('No video URL found');
    }

    if (videoUrl.startsWith('blob:')) {
      throw new Error('Unsupported video URL format (blob:)');
    }

    return videoUrl;
  }

    /**
   * Retrieves the description of an Instagram post by scraping the page.
   * This method launches a headless browser, navigates to the given URL,
   * and extracts the content of the <meta property="og:title" ... /> tag.
   * 
   * @param url - The URL of the Instagram post to scrape for the description.
   * @returns A promise that resolves to the post description or null if not found.
   * @throws An error if no description is found.
   */
    private async getPostDescriptionByUrl(url: string): Promise<string | null> {
      console.log(`Start scrapping: ${url}`);
  
      const browser = await puppeteer.launch(this.config);
      const page = await browser.newPage();
  
      await page.setUserAgent(userAgent);
  
      await page.goto(url, { waitUntil: 'domcontentloaded' });
  
      // Extract content of the <meta property="og:title" ... />
      const description = await page.evaluate(() => {
        const metaTag = document.querySelector('meta[property="og:title"]');
        return metaTag ? metaTag.getAttribute('content') : null;
      });
  
      console.log('Instagram Post/Reel Description:', description);
  
      await browser.close();
  
      if (!description) {
        throw new Error('No description found');
      }
  
      return description;
    }
}