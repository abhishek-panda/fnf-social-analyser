import fs from 'fs';
import path from 'path';
import axios from 'axios';
import type { Platform } from '../types';
import { logger } from '../utils/logger';

/**
 * Downloads media from a remote URL and saves it to:
 *   {mediaPath}/{platform}/{external_id}.{ext}
 *
 * Returns only the filename (e.g. 17888291706617649.jpg) — not the full path.
 * Full path is constructed at the application level using MEDIA_PATH from config.
 */
export class ImageDownloaderService {
  constructor(private readonly mediaPath: string) {}

  /**
   * Downloads the image at `url` and saves it to disk.
   * Returns the filename (external_id.ext) on success, null on failure.
   */
  async download(
    url: string | null,
    platform: Platform,
    externalId: string
  ): Promise<string | null> {
    if (!url) return null;

    const ext = this.inferExtension(url);
    const filename = `${externalId}.${ext}`;
    const dir = path.join(this.mediaPath, platform);
    const filePath = path.join(dir, filename);

    // Skip if already downloaded
    if (fs.existsSync(filePath)) {
      logger.debug(`[ImageDownloader] Already exists — skipping: ${filename}`);
      return filename;
    }

    try {
      fs.mkdirSync(dir, { recursive: true });
      const response = await axios.get<Buffer>(url, { responseType: 'arraybuffer' });
      fs.writeFileSync(filePath, Buffer.from(response.data));
      logger.info(`[ImageDownloader] Saved: ${filename}`);
      return filename;
    } catch (err) {
      const detail = axios.isAxiosError(err)
        ? { status: err.response?.status, message: err.message, url }
        : { message: err instanceof Error ? err.message : String(err), url };
      logger.error('[ImageDownloader] Failed to download media', detail);
      return null;
    }
  }

  /** Builds the full absolute path from mediaPath + platform + filename. */
  buildFullPath(platform: Platform, filename: string): string {
    return path.join(this.mediaPath, platform, filename);
  }

  /** Infers file extension from URL path, defaulting to jpg. */
  private inferExtension(url: string): string {
    try {
      const pathname = new URL(url).pathname;
      const ext = path.extname(pathname).replace('.', '').toLowerCase();
      if (['mp4', 'mov', 'webm'].includes(ext)) return ext;
      if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return ext === 'jpeg' ? 'jpg' : ext;
    } catch {
      // Malformed URL — fall through to default
    }
    return 'jpg';
  }
}
