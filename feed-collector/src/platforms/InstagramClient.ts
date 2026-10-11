import fs from 'fs';
import path from 'path';
import axios, { type AxiosRequestConfig } from 'axios';
import type { ISocialPlatformClient, ITokenRefreshService } from '../interfaces';
import type { InstagramConfig } from '../config';
import type { NewPost, InstagramMedia, Platform } from '../types';

interface GraphApiPaging {
  cursors?: { before: string; after: string };
  next?: string;
}

interface GraphApiListResponse<T> {
  data: T[];
  paging?: GraphApiPaging;
}

export interface MediaItem {
  post: NewPost;
  mediaUrl: string | null;
}

/** Concrete ISocialPlatformClient for the Instagram Graph API. */
export class InstagramClient implements ISocialPlatformClient {
  public readonly platform: Platform = 'instagram';

  private readonly DEBUG_DIR = path.resolve(process.cwd(), 'debug');

  constructor(
    private readonly config: InstagramConfig,
    private readonly tokenService: ITokenRefreshService
  ) {}

  /**
   * Returns an async generator that yields one MediaItem at a time.
   * Memory footprint is bounded to a single API page (~10 posts) at any point.
   */
  async *streamRecentMedia(mediaType: 'recent_media' | 'top_media' = 'recent_media'): AsyncGenerator<MediaItem> {
    const accessToken = await this.tokenService.getAccessToken();
    const seen = new Set<string>();

    console.log(
      `[InstagramClient] Fetching ${mediaType} for ${this.config.trackedHashtags.length} hashtag(s): ` +
      this.config.trackedHashtags.map((h) => '#' + h).join(', ')
    );

    for (const hashtag of this.config.trackedHashtags) {
      try {
        const hashtagId = await this.resolveHashtagId(hashtag, accessToken);
        let total = 0;

        for await (const item of this.paginateHashtag(hashtagId, hashtag, accessToken, mediaType)) {
          if (seen.has(item.post.external_id)) continue;
          seen.add(item.post.external_id);
          total++;
          yield item;
        }

        console.log(`[InstagramClient] #${hashtag} (${mediaType}) → ${total} post(s) yielded`);
      } catch (err) {
        console.error(
          `[InstagramClient] Failed to fetch ${mediaType} for #${hashtag}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  // Keep fetchRecentMedia for interface compatibility — delegates to the generator
  async fetchRecentMedia(): Promise<MediaItem[]> {
    const items: MediaItem[] = [];
    for await (const item of this.streamRecentMedia()) {
      items.push(item);
    }
    return items;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async resolveHashtagId(hashtag: string, accessToken: string): Promise<string> {
    const url = `${this.config.baseUrl}/ig_hashtag_search`;
    const params = {
      user_id: this.config.businessAccountId,
      q: hashtag,
      access_token: accessToken,
    };

    this.logRequest('GET', url, params, `Resolving hashtag ID for #${hashtag}`);

    const { data } = await axios.get<GraphApiListResponse<{ id: string }>>(url, { params });

    if (!data.data?.length) {
      throw new Error(`No hashtag ID found for #${hashtag}`);
    }

    const hashtagId = data.data[0].id;
    console.log(`[InstagramClient] #${hashtag} → hashtag_id: ${hashtagId}`);

    return hashtagId;
  }

  /**
   * Async generator — fetches one page, yields each post, then fetches the next.
   * Only one page of raw API data lives in memory at a time.
   */
  private async *paginateHashtag(
    hashtagId: string,
    hashtag: string,
    accessToken: string,
    mediaType: 'recent_media' | 'top_media' = 'recent_media'
  ): AsyncGenerator<MediaItem> {
    const fields = 'id,media_url,caption,product_tags{product_id,product_url},permalink,timestamp';
    const baseUrl = `${this.config.baseUrl}/${hashtagId}/${mediaType}`;
    const baseParams = {
      fields,
      user_id: this.config.businessAccountId,
      limit: 10,
      access_token: accessToken,
    };

    this.logRequest('GET', baseUrl, baseParams, `Fetching recent media for #${hashtag} (id: ${hashtagId})`);

    const debugFile = this.openDebugFile(hashtag, hashtagId, mediaType);

    let nextUrl: string | undefined = undefined;
    let pageNum = 0;
    let totalPosts = 0;

    do {
      pageNum++;

      let response: GraphApiListResponse<InstagramMedia>;
      let requestUrl: string;

      if (nextUrl) {
        requestUrl = nextUrl;
        const { data } = await axios.get<GraphApiListResponse<InstagramMedia>>(nextUrl);
        response = data;
      } else {
        requestUrl = `${baseUrl}?${new URLSearchParams(
          Object.fromEntries(Object.entries(baseParams).map(([k, v]) => [k, String(v)]))
        ).toString()}`;
        const { data } = await axios.get<GraphApiListResponse<InstagramMedia>>(baseUrl, { params: baseParams });
        response = data;
      }

      const posts = response.data ?? [];
      const hasNext = !!response.paging?.next;
      totalPosts += posts.length;

      // Write this page to debug file immediately — don't hold it in memory
      debugFile.writePage(pageNum, requestUrl, posts, hasNext);

      posts.forEach((post: InstagramMedia, i: number) => {
        console.log(`[InstagramClient]   page[${pageNum}] post[${i + 1}] id=${post.id} url=${post.permalink}`);
        // Yield immediately so IngestionService can process while we fetch the next page
      });

      for (const media of posts) {
        yield {
          post: this.normalise(media),
          mediaUrl: media.media_url ?? null,
        };
      }

      nextUrl = response.paging?.next;
    } while (nextUrl);

    debugFile.close(totalPosts);
  }

  /**
   * Opens a debug file and returns a handle to write pages incrementally.
   * Builds a valid JSON array without holding all data in memory.
   */
  private openDebugFile(hashtag: string, hashtagId: string, mediaType: 'recent_media' | 'top_media' = 'recent_media'): {
    writePage: (page: number, url: string, posts: InstagramMedia[], hasNext: boolean) => void;
    close: (totalPosts: number) => void;
  } {
    try {
      if (!fs.existsSync(this.DEBUG_DIR)) fs.mkdirSync(this.DEBUG_DIR, { recursive: true });

      const filename = path.join(this.DEBUG_DIR, `${mediaType}_${hashtag}.json`);
      const fd = fs.openSync(filename, 'w');

      const header = JSON.stringify({
        hashtag,
        hashtag_id: hashtagId,
        fetched_at: new Date().toISOString(),
      });

      // Write opening structure — pages array left open
      fs.writeSync(fd, header.slice(0, -1) + ',"total_posts":0,"pages":[\n');
      let firstPage = true;

      return {
        writePage: (page, url, posts, hasNext) => {
          const entry = JSON.stringify({ page, url, post_count: posts.length, has_next: hasNext, data: posts }, null, 2);
          fs.writeSync(fd, (firstPage ? '' : ',\n') + entry);
          firstPage = false;
        },
        close: (totalPosts) => {
          fs.writeSync(fd, '\n]}');
          fs.closeSync(fd);
          // Patch total_posts — re-read is small since it's only the header
          const content = fs.readFileSync(filename, 'utf8');
          fs.writeFileSync(filename, content.replace('"total_posts":0', `"total_posts":${totalPosts}`));
          console.log(`[InstagramClient] Debug response written → ${filename}`);
        },
      };
    } catch (err) {
      console.warn('[InstagramClient] Failed to open debug file:', err instanceof Error ? err.message : err);
      // Return no-op handle so pagination continues even if debug write fails
      return { writePage: () => {}, close: () => {} };
    }
  }

  private logRequest(_method: string, _url: string, _params: Record<string, unknown>, description: string): void {
    console.log(`[InstagramClient] ${description}`);
  }

  private normalise(media: InstagramMedia): NewPost {
    const firstTag = media.product_tags?.data?.[0] ?? null;
    return {
      platform: 'instagram',
      external_id: media.id,
      url: media.permalink,
      image_path: null,
      embedding: null,
      caption: media.caption ?? null,
      author_handle: null,
      author_url: null,
      published_at: media.timestamp ? new Date(media.timestamp) : null,
      product_id: firstTag?.product_id ?? null,
      product_url: firstTag?.product_url ?? null,
    };
  }
}
