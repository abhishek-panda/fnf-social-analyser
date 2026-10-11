# Troubleshooting Guide

---

## Table of Contents

1. [SSL Certificate Errors (Tesco Network)](#1-ssl-certificate-errors-tesco-network)
2. [BullMQ / Redis Issues](#2-bullmq--redis-issues)
3. [Embedding Service Errors](#3-embedding-service-errors)
4. [Instagram API Errors](#4-instagram-api-errors)
5. [Database Issues](#5-database-issues)
6. [Search Returns No Results](#6-search-returns-no-results)

---

## 1. SSL Certificate Errors (Tesco Network)

### Root Cause

Tesco uses **Zscaler** as a transparent HTTPS proxy. It intercepts all outbound HTTPS traffic and re-signs server certificates with the **Tesco Root CA** — a certificate that is not in any default trust store (Node.js, Python, curl).

Without the Tesco CA bundle, every HTTPS call fails:

```
unable to get local issuer certificate
CERTIFICATE_VERIFY_FAILED
SSL: CERTIFICATE_VERIFY_FAILED
```

This affects:
- **Node.js** — Instagram Graph API calls
- **Python** — HuggingFace model downloads, Instagram image fetches
- **curl** — any manual API calls

### The Fix

You need to generate a `tesco-ca.crt` PEM bundle containing the Tesco Root CA and configure each runtime to trust it.

> ⚠️ `tesco-ca.crt` is gitignored — it is machine-specific and must **never be committed**.

---

### Step 1 — Extract the certificate chain

```bash
# Extract the full Zscaler-intercepted chain from Facebook
echo | openssl s_client -connect graph.facebook.com:443 -showcerts 2>/dev/null > /tmp/fullchain.txt

# Export Tesco Root CA from Mac keychain
security find-certificate -c "Tesco Root CA" -p > /tmp/tesco-root.pem
```

Then combine them into a single PEM bundle at the repo root:

```bash
cat /tmp/fullchain.txt /tmp/tesco-root.pem > tesco-ca.crt
```

---

### Step 2 — Configure each runtime

Add to your root `.env` (values already present in `.env.example`):

```env
NODE_EXTRA_CA_CERTS=/absolute/path/to/fnf-social-analyser/tesco-ca.crt
```

> Use an absolute path — relative paths are not reliably resolved by all runtimes.

- **Node.js** (`feed-collector`, `image-search`) — reads `NODE_EXTRA_CA_CERTS` natively at process startup. Both services use `dotenv-cli` in their `yarn dev` script (`dotenv -e ../.env -- ts-node src/index.ts`), which loads the root `.env` into the shell environment before Node.js starts, so the variable is available at startup.
- **Python** (`embedding-service`) — no extra `.env` vars needed. `clip_service.py` reads `NODE_EXTRA_CA_CERTS` at runtime and programmatically sets `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`, and `CURL_CA_BUNDLE` from it. Everything is derived automatically — no manual Python-specific config required.

---

### Step 3 — Python SSL (HuggingFace Hub downloads)

HuggingFace Hub uses `httpx` internally and reads `SSL_CERT_FILE`. The `requests` library reads `REQUESTS_CA_BUNDLE`. Both are set programmatically in `embedding-service/services/clip_service.py` on startup — it reads `NODE_EXTRA_CA_CERTS` and derives all Python SSL variables from it:

```python
import os
cert_path = os.environ.get("NODE_EXTRA_CA_CERTS")
if cert_path:
    os.environ["SSL_CERT_FILE"] = cert_path
    os.environ["REQUESTS_CA_BUNDLE"] = cert_path
    os.environ["CURL_CA_BUNDLE"] = cert_path
```

No manual step required — this runs automatically on startup. Do **not** add `REQUESTS_CA_BUNDLE` or `CURL_CA_BUNDLE` to `.env`; they are derived at runtime only.

---

### Yarn scripts for certificate management

Since `tesco-ca.crt` cannot be committed, these scripts help regenerate it quickly:

Add to root `package.json` if needed locally:

```bash
# Extract Zscaler chain from Facebook endpoint
yarn cert:extract

# Export Tesco Root CA from Mac keychain
yarn cert:keychain

# Combine into tesco-ca.crt
yarn cert:build

# Full regeneration in one command
yarn cert:regen
```

To add these locally (do not commit — only for your machine):

```bash
# Extract chain
echo | openssl s_client -connect graph.facebook.com:443 -showcerts 2>/dev/null > /tmp/fullchain.txt

# Export from keychain
security find-certificate -c "Tesco Root CA" -p > /tmp/tesco-root.pem

# Build bundle
cat /tmp/fullchain.txt /tmp/tesco-root.pem > tesco-ca.crt
```

---

### When to regenerate

Regenerate `tesco-ca.crt` if:
- You see SSL errors after not seeing them before
- Tesco rotates its Zscaler certificates (happens periodically)
- You set up on a new machine

After regenerating, restart all services.

---

### Off Tesco network (home / VPN off)

SSL errors disappear — the Zscaler proxy is not active. Leave `NODE_EXTRA_CA_CERTS` set in `.env`; it is safely ignored when the certs are already trusted natively.

---

## 2. BullMQ / Redis Issues

### `BullMQ could not load the optional 'ioredis' package`

`ioredis` is an optional peer dependency and must be installed explicitly:

```bash
cd feed-collector && yarn add ioredis
```

### `Error: connect ECONNREFUSED 127.0.0.1:6379`

Redis is not running. Start it:

```bash
yarn db:up
```

---

## 3. Embedding Service Errors

### `500 Internal Server Error` — sequence length exceeds max_position_embeddings

Happens when the text tokenizer produces more tokens than the model supports (e.g. SigLIP SO400M has a max of 64 tokens, not 77).

**Fix:** `clip_service.py` reads `max_position_embeddings` dynamically from the model config — ensure you are on the latest code.

### `ValueError: Either model_file or model_proto must be specified`

SigLIP tokenizer vocab file is missing from the HuggingFace cache. Set `HF_HUB_OFFLINE=0` and restart to re-download the tokenizer files.

### `Embedding service returns 503`

Ollama is not running:

```bash
ollama serve
```

### Model takes too long to load on startup

The vision model is loading from disk for the first time. This is normal — subsequent restarts are fast once cached. Set `HF_HUB_OFFLINE=1` after the first successful startup to prevent network checks.

---

## 4. Instagram API Errors

### `OAuthException: Invalid OAuth access token`

The token in `.env` has expired or is invalid. Obtain a new long-lived token:

```bash
curl "https://graph.facebook.com/v24.0/oauth/access_token
  ?grant_type=ig_exchange_token
  &client_id=$INSTAGRAM_APP_ID
  &client_secret=$INSTAGRAM_APP_SECRET
  &access_token=SHORT_LIVED_TOKEN"
```

Update `INSTAGRAM_ACCESS_TOKEN` in `.env` and restart feed-collector — it will re-seed the token to DB on startup.

### `user_id` returning `undefined` in hashtag search

The `INSTAGRAM_BUSINESS_ACCOUNT_ID` env var is missing or not loaded. Verify it is set in `.env` and that feed-collector config reads it correctly.

---

## 5. Database Issues

### `expected N dimensions, not M`

The embedding vector dimensions don't match the `VECTOR(N)` column definition. This happens after switching models without updating the schema.

**Fix:**

```bash
# Update the column to the new model's dimensions (e.g. 768 for LAION ViT-L-14)
docker exec -i fnf_postgres psql -U postgres -d fnf_social_analyser -c "
  ALTER TABLE post_embeddings DROP COLUMN IF EXISTS embedding;
  ALTER TABLE post_embeddings ADD COLUMN embedding VECTOR(768);
  DROP INDEX IF EXISTS idx_post_embeddings_embedding;
  CREATE INDEX idx_post_embeddings_embedding ON post_embeddings USING hnsw (embedding vector_cosine_ops);
"

# Then update db/index.ts to match and re-backfill
yarn backfill:embeddings
```

### DB backup and restore

```bash
yarn db:backup
yarn db:restore
```

---

## 6. Search Returns No Results

### Same scores after switching model

Post embeddings were generated by the old model — they are incompatible with the new model's vectors. Truncate and re-backfill:

```bash
docker exec -i fnf_postgres psql -U postgres -d fnf_social_analyser 
  -c "TRUNCATE TABLE post_embeddings;"

yarn backfill:embeddings
```

### Semantic results are low quality

The dataset is too small. Semantic search requires sufficient variety to find meaningful matches. Run the feed-collector continuously to grow the index — results improve significantly above ~5k posts.

### Similarity threshold too high

Lower `SIMILARITY_THRESHOLD` in `.env` (default: `0.3`) to return more results:

```env
SIMILARITY_THRESHOLD=0.2
```
