/** Supported social media platforms. Extend as new platforms are added. */
export type Platform = 'instagram' | 'tiktok' | 'pinterest' | 'x';

/** A normalised social media post as stored in the DB. */
export interface Post {
  id: string;
  platform: Platform;
  external_id: string;
  /** Permalink to the original post (e.g. Instagram permalink). */
  url: string;
  /** Filename of the downloaded image (e.g. 17888291706617649.jpg). Full path built from MEDIA_PATH + platform + image_path. Null if not yet downloaded. */
  image_path: string | null;
  /** Embedding vector (dims depend on model — e.g. 512 for FashionCLIP, 1152 for SigLIP SO400M). Null until embedding-service processes the post. */
  embedding: number[] | null;
  caption: string | null;
  author_handle: string | null;
  author_url: string | null;
  published_at: Date | null;
  /** Product ID from Instagram product tag — null if post has no product tag. */
  product_id: string | null;
  /** Product URL from Instagram product tag — null if post has no product tag. */
  product_url: string | null;
  hidden: boolean;
  ingested_at: Date;
}

/** Shape for creating a new post (before DB assigns id/hidden/ingested_at). */
export type NewPost = Omit<Post, 'id' | 'hidden' | 'ingested_at'>;

export interface InstagramProductTag {
  product_id: string;
  product_url: string;
}

/** A raw Instagram Graph API media object. */
export interface InstagramMedia {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink: string;
  timestamp?: string;
  username?: string;
  product_tags?: { data: InstagramProductTag[] };
  [key: string]: unknown;
}

/** A product in the F&F catalogue snapshot. */
export interface Product {
  tpnb: string;
  title: string;
  description: string | null;
  colour: string | null;
  category: string | null;
  image_url: string | null;
  synced_at: Date;
}

/** Subset of product fields used for matching. */
export type ProductMatchFields = Pick<Product, 'tpnb' | 'title' | 'colour' | 'category'>;

/** A link between a post and a matched product. */
export interface PostProductLink {
  id: string;
  post_id: string;
  tpnb: string;
  confidence_score: number;
  matched_at: Date;
}

/** A hashtag → TPNB seed mapping entry. */
export interface HashtagTpnbMap {
  hashtag: string;
  tpnb: string;
}

/** The shape returned by GET /v1/social-posts */
export interface SocialPostsResponse {
  tpnb: string;
  total: number;
  posts: SocialPostItem[];
}

/** A single post item in the API response. */
export interface SocialPostItem {
  id: string;
  platform: Platform;
  url: string;
  image_path: string | null;
  caption: string | null;
  author_handle: string | null;
  author_url: string | null;
  confidence_score: number;
}

/** Result returned by a single matching strategy for one post. */
export interface MatchResult {
  tpnb: string;
  confidence: number;
  signal: string;
}

/** Options for querying posts. */
export interface QueryOptions {
  limit?: number;
  platform?: Platform;
}

/** A stored Instagram access token record. */
export interface InstagramToken {
  id: number;
  access_token: string;
  /** null means the token never expires (e.g. a System User token) */
  expires_at: Date | null;
  refreshed_at: Date;
  created_at: Date;
}

/** Result returned by TokenRefreshService.refreshIfNeeded */
export interface TokenRefreshResult {
  refreshed: boolean;
  expiresAt: Date | null;
}
