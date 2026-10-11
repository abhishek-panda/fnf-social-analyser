# image-search

> Matches Tesco F&F products to relevant social media posts using two-tier AI-powered matching.

---

## API

### `POST /search`

Finds social posts that match a given Tesco product.

**Request body:**

```json
{
  "tpnb": "323951665",
  "imageUrl": "https://digitalcontent.api.tesco.com/v2/media/ghs/xxx/image.jpeg",
  "caption": "F&F Faux Leather Funnel Neck Oversized Fit Jacket in Black",
  "productUrl": "https://www.tesco.com/shop/en-GB/clothing/products/323951665"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `tpnb` | string | ✅ | Tesco Product Number Base |
| `imageUrl` | string | ✅ | Product image URL |
| `caption` | string | ✅ | Product title or description |
| `productUrl` | string | ❌ | Product page URL — enables direct URL match |

**Response:**

```json
{
  "tpnb": "323951665",
  "total": 3,
  "matchType": "semantic",
  "posts": [
    {
      "postId": "19d368a5-7cd9-49d4-8ec8-f66ac467a5cf",
      "platform": "instagram",
      "url": "https://www.instagram.com/p/C2RjvossiwA/",
      "caption": "Classics for your wardrobe...",
      "image_path": "17937111101688066.jpg",
      "published_at": "2024-01-19T08:00:13.000Z",
      "matchType": "semantic",
      "score": 0.82
    }
  ]
}
```

**`matchType` values:**

| Value | Meaning |
|---|---|
| `direct` | Post has a matching Instagram product tag or product URL in caption. Score is always `1.0`. |
| `semantic` | Matched via vision-language cosine similarity. Score is `0.0–1.0`. |
| `none` | No match found above the similarity threshold. |

**Tuning similarity:**

| Env var | Default | Description |
|---|---|---|
| `SIMILARITY_THRESHOLD` | `0.3` | Minimum cosine similarity score to include a result |
| `SIMILARITY_LIMIT` | `20` | Maximum number of semantic results to return |

---

### `GET /health`

```json
{ "status": "ok", "service": "image-search" }
```

---

## Matching Strategy

```
Tier 1 — Direct (exact, zero-cost)
  1a. posts.product_id matches tpnb     (Instagram product tag)
  1b. posts.caption contains productUrl (URL match)
  → Returns immediately if found. No AI involved.

Tier 2 — Semantic (AI-powered)
  1. Product image + caption → embedding via embedding-service
  2. pgvector cosine similarity against stored post embeddings
  → Returns ranked results above SIMILARITY_THRESHOLD
```

Tier 1 always takes priority. Tier 2 only runs if no direct match is found.

---

## Prerequisites

- PostgreSQL running with pgvector extension and `post_embeddings` populated
- embedding-service running (see `../embedding-service/`)
- If running on Tesco network, set `NODE_EXTRA_CA_CERTS` in root `.env` pointing to `tesco-ca.crt` — see [TROUBLESHOOT.md §1](../TROUBLESHOOT.md#1-ssl-certificate-errors-tesco-network)

## Running

```bash
yarn dev
```
