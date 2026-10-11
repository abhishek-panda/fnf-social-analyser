# API cURL Examples

> Replace `$INSTAGRAM_ACCESS_TOKEN`, `$INSTAGRAM_BUSINESS_ACCOUNT_ID` with values from your `.env` file.

---

## Token Validation

```bash
curl "https://graph.facebook.com/v26.0/me?access_token=$INSTAGRAM_ACCESS_TOKEN"
```

```bash
curl -i -X GET 
  "https://graph.facebook.com/v26.0/me?fields=id%2Cname&access_token=$INSTAGRAM_ACCESS_TOKEN"
```

---

## Hashtag Search

```bash
curl -X GET 
  "https://graph.facebook.com/v26.0/ig_hashtag_search?user_id=$INSTAGRAM_BUSINESS_ACCOUNT_ID&q=fandfclothing&access_token=$INSTAGRAM_ACCESS_TOKEN"
```

---

## Get Hashtag by ID

```bash
# Hashtag ID for #fandfclothing: 17842830187021233
curl -X GET 
  "https://graph.facebook.com/17842830187021233?fields=id,name&access_token=$INSTAGRAM_ACCESS_TOKEN"
```

---

## Top Media

```bash
curl -X GET 
  "https://graph.facebook.com/17842830187021233/top_media?user_id=$INSTAGRAM_BUSINESS_ACCOUNT_ID&fields=id,caption&access_token=$INSTAGRAM_ACCESS_TOKEN"
```

---

## Recent Media

```bash
curl -i -X GET 
  "https://graph.facebook.com/v26.0/17842830187021233/recent_media?fields=id%2Cmedia_url%2Ccaption%2Cproduct_tags%7Bproduct_id%2Cproduct_url%7D&user_id=$INSTAGRAM_BUSINESS_ACCOUNT_ID&limit=10&access_token=$INSTAGRAM_ACCESS_TOKEN"
```

---

## Visualise Embeddings (embedding-service)

Opens an interactive 3D scatter plot of all post embeddings reduced via UMAP. Open in browser — takes ~10–30s to generate.

```bash
open http://localhost:${EMBEDDING_SERVICE_PORT}/__dev/embeddings/visualise
```

---

## Trigger Manual Sync (feed-collector)

```bash
curl -X POST http://localhost:7000/__dev/sync
```

---

## Image Search

```bash
curl -s -X POST http://localhost:${IMAGE_SEARCH_SERVICE_PORT}/search 
  -H "Content-Type: application/json" 
  -d '{
    "tpnb": "97891081",
    "imageUrl": "https://digitalcontent.api.tesco.com/v2/media/ghs/d3781585-b797-4e36-8700-096446e4fcb0/909-8054_M_03_1021456562.jpeg?h=600&w=480%20768w,%20https://digitalcontent.api.tesco.com/v2/media/ghs/d3781585-b797-4e36-8700-096446e4fcb0/909-8054_M_03_1021456562.jpeg",
    "caption": "F&F Faux Leather Funnel Neck Oversized Fit Jacket in Black",
    "productUrl": "https://www.tesco.com/shop/en-GB/clothing/products/323951665"
  }' | python3 -m json.tool
```


## Demo Product 
https://lego-uk.local.omnichannel.tescocloud.com/shop/en-GB/clothing/products/349663983
