/** Raw post row returned from the posts table. */
export interface PostRow {
  id: string;
  platform: string;
  external_id: string;
  url: string;
  caption: string | null;
  image_path: string | null;
  published_at: Date | null;
}

/** Result row from the pgvector cosine similarity query. */
export interface SemanticResult {
  postId: string;
  platform: string;
  url: string;
  caption: string | null;
  image_path: string | null;
  published_at: Date | null;
  clean_caption: string | null;
  score: number;
}

/** Input from Tesco — product to match against social posts. */
export interface ProductSearchInput {
  /** Tesco product number (TPNB) */
  tpnb: string;
  /** Product image URL from Tesco */
  imageUrl: string;
  /** Product caption / description */
  caption: string;
  /** Optional direct product URL (e.g. tesco.com/fnf/...) */
  productUrl?: string;
}

/** A matched social post returned to the caller. */
export interface MatchedPost {
  postId: string;
  platform: string;
  url: string;
  caption: string | null;
  image_url: string | null;
  published_at: Date | null;
  /** How the match was found */
  matchType: 'direct' | 'semantic';
  /** Similarity score 0–1. Direct matches always return 1.0 */
  score: number;
}

/** Response envelope */
export interface SearchResponse {
  tpnb: string;
  total: number;
  matchType: 'direct' | 'semantic' | 'none';
  posts: MatchedPost[];
}
