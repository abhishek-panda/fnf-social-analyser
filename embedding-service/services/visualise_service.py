"""
Single responsibility: fetch post embeddings from the database,
reduce to 3D via UMAP, cluster via HDBSCAN, and render an interactive
Plotly HTML visualisation with image-on-hover support.
"""
import json

import hdbscan
import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import psycopg2
import umap

from config import Config

_QUERY = """
    SELECT
        pe.clean_caption,
        pe.embed_source,
        pe.model_version,
        pe.embedding::text,
        p.url,
        p.author_handle,
        p.image_path
    FROM post_embeddings pe
    JOIN posts p ON p.id = pe.post_id
    WHERE pe.embedding IS NOT NULL
    ORDER BY pe.embedded_at DESC
"""

# Palette for up to 20 clusters — noise points (cluster -1) shown in grey
_CLUSTER_COLOURS = [
    "#4F46E5", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
    "#EC4899", "#06B6D4", "#84CC16", "#F97316", "#14B8A6",
    "#6366F1", "#D946EF", "#0EA5E9", "#A3E635", "#FB923C",
    "#2DD4BF", "#818CF8", "#F472B6", "#34D399", "#FBBF24",
]
_NOISE_COLOUR = "#6B7280"

# HDBSCAN min_cluster_size — fewer points can't form a cluster, and UMAP needs n_neighbors >= 2
_MIN_EMBEDDINGS = 10


class VisualiseService:
    """
    Generates a self-contained interactive 3D HTML scatter plot of all
    post embeddings — coloured by HDBSCAN cluster, with image-on-hover.

    Instantiated once at startup and stored on app.state.
    Each call to render() fetches fresh data and re-runs UMAP + HDBSCAN.
    """

    def __init__(self, config: Config) -> None:
        self._database_url = config.database_url

    def render(self) -> str:
        """
        Fetch embeddings, cluster, reduce to 3D, return self-contained HTML.
        Raises RuntimeError if there are too few embeddings to reduce and cluster.
        """
        rows = self._fetch()

        if not rows:
            raise RuntimeError("No embeddings found in database.")
        if len(rows) < _MIN_EMBEDDINGS:
            raise RuntimeError(
                f"Only {len(rows)} embedding(s) in database — need at least {_MIN_EMBEDDINGS} to visualise."
            )

        matrix, df = self._parse(rows)
        reduced = self._reduce(matrix)
        df["cluster"] = self._cluster(reduced)
        return self._plot(df, reduced)

    # ── Private ────────────────────────────────────────────────────────────────

    def _fetch(self) -> list[tuple]:
        conn = psycopg2.connect(self._database_url)
        try:
            with conn.cursor() as cur:
                cur.execute(_QUERY)
                return cur.fetchall()
        finally:
            conn.close()

    def _parse(self, rows: list[tuple]) -> tuple[np.ndarray, pd.DataFrame]:
        captions, sources, models, embeddings, urls, handles, image_paths = [], [], [], [], [], [], []

        for caption, source, model, embedding_text, url, handle, image_path in rows:
            captions.append(caption or "")
            sources.append(source or "")
            models.append(model or "")
            embeddings.append(json.loads(embedding_text))
            urls.append(url or "")
            handles.append(handle or "")
            image_paths.append(image_path or "")

        df = pd.DataFrame({
            "caption":    captions,
            "source":     sources,
            "model":      models,
            "url":        urls,
            "handle":     handles,
            "image_path": image_paths,
        })

        return np.array(embeddings, dtype=np.float32), df

    def _reduce(self, matrix: np.ndarray) -> np.ndarray:
        n_neighbors = min(15, len(matrix) - 1)
        reducer = umap.UMAP(n_components=3, n_neighbors=n_neighbors, random_state=42)
        return reducer.fit_transform(matrix)

    def _cluster(self, reduced: np.ndarray) -> list[str]:
        """
        Cluster in UMAP-reduced space (not raw high-dim embeddings) —
        high-dimensional clustering suffers from the curse of dimensionality.
        """
        clusterer = hdbscan.HDBSCAN(min_cluster_size=10, min_samples=5, metric="euclidean")
        labels = clusterer.fit_predict(reduced)
        return [
            "Unclustered" if label == -1 else f"Cluster {label + 1}"
            for label in labels
        ]

    def _plot(self, df: pd.DataFrame, reduced: np.ndarray) -> str:
        df["x"] = reduced[:, 0]
        df["y"] = reduced[:, 1]
        df["z"] = reduced[:, 2]

        model_label = df["model"].iloc[0] if len(df) else ""
        clusters = sorted(df["cluster"].unique(), key=lambda c: (c == "Unclustered", c))
        n_clusters = len(clusters) - (1 if "Unclustered" in clusters else 0)

        traces = []
        for i, cluster in enumerate(clusters):
            mask = df["cluster"] == cluster
            subset = df[mask]
            colour = _NOISE_COLOUR if cluster == "Unclustered" else _CLUSTER_COLOURS[i % len(_CLUSTER_COLOURS)]

            traces.append(go.Scatter3d(
                x=subset["x"],
                y=subset["y"],
                z=subset["z"],
                mode="markers",
                name=cluster,
                marker=dict(size=4, color=colour, opacity=0.85),
                customdata=list(zip(
                    subset["caption"],
                    subset["handle"],
                    subset["url"],
                    subset["image_path"],
                    subset["source"],
                )),
                hovertemplate=(
                    "<b>@%{customdata[1]}</b><br>"
                    "%{customdata[0]}<br>"
                    "<i>%{customdata[4]}</i>"
                    "<extra></extra>"
                ),
            ))

        fig = go.Figure(data=traces)
        fig.update_layout(
            title=f"Post Embeddings — {len(df)} posts · {n_clusters} clusters · UMAP 3D · {model_label}",
            scene=dict(
                xaxis=dict(showticklabels=False, title=""),
                yaxis=dict(showticklabels=False, title=""),
                zaxis=dict(showticklabels=False, title=""),
            ),
            margin=dict(l=0, r=0, t=50, b=0),
            height=800,
            template="plotly_dark",
            legend=dict(title="Cluster", itemsizing="constant"),
        )

        plot_html = fig.to_html(full_html=False, include_plotlyjs=True, config={"displayModeBar": True, "scrollZoom": True})
        return _build_page(plot_html)


def _build_page(plot_html: str) -> str:
    """Wrap the Plotly div in a full HTML page with image hover panel."""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Embedding Visualiser</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ background: #111827; color: #f9fafb; font-family: system-ui, sans-serif; display: flex; height: 100vh; overflow: hidden; }}
    #plot  {{ flex: 1; min-width: 0; overflow: hidden; }}
    #panel {{
      width: 280px; min-width: 280px; background: #1f2937; border-left: 1px solid #374151;
      padding: 16px; display: flex; flex-direction: column; gap: 12px; overflow-y: auto;
    }}
    #panel h2  {{ font-size: 13px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em; }}
    #post-img  {{ width: 100%; border-radius: 8px; object-fit: cover; aspect-ratio: 1; background: #374151; display: none; }}
    #post-img.loaded {{ display: block; }}
    #post-handle {{ font-weight: 600; font-size: 14px; color: #e5e7eb; }}
    #post-caption {{ font-size: 13px; color: #d1d5db; line-height: 1.5; }}
    #post-source  {{ font-size: 11px; color: #6b7280; font-style: italic; }}
    #post-link    {{ font-size: 12px; color: #6366f1; text-decoration: none; }}
    #post-link:hover {{ text-decoration: underline; }}
    #placeholder  {{ font-size: 13px; color: #6b7280; margin-top: 40px; text-align: center; }}
  </style>
</head>
<body>
  <div id="plot">{plot_html}</div>
  <div id="panel">
    <h2>Post Detail</h2>
    <p id="placeholder">Hover over a dot to see post details</p>
    <img id="post-img" alt="Post image" />
    <div id="post-handle"></div>
    <div id="post-caption"></div>
    <div id="post-source"></div>
    <a id="post-link" target="_blank" rel="noopener noreferrer"></a>
  </div>
  <script>
    (function() {{
      const img         = document.getElementById('post-img');
      const handle      = document.getElementById('post-handle');
      const caption     = document.getElementById('post-caption');
      const source      = document.getElementById('post-source');
      const link        = document.getElementById('post-link');
      const placeholder = document.getElementById('placeholder');

      function showPoint(customdata) {{
        const [cap, hdl, url, imagePath, src] = customdata;
        placeholder.style.display = 'none';
        handle.textContent  = hdl ? '@' + hdl : '';
        caption.textContent = cap || '';
        source.textContent  = src || '';
        link.href        = url || '';
        link.textContent = url ? 'View on Instagram ↗' : '';

        const isImage = imagePath && /[.](jpg|jpeg|webp|png)$/i.test(imagePath);
        if (isImage) {{
          img.classList.remove('loaded');
          img.src     = '/__dev/media/' + imagePath;
          img.onload  = () => img.classList.add('loaded');
          img.onerror = () => img.classList.remove('loaded');
        }} else {{
          img.classList.remove('loaded');
          img.src = '';
        }}
      }}

      function attach() {{
        const plotDiv = document.querySelector('.plotly-graph-div');
        if (!plotDiv || typeof plotDiv.on !== 'function') {{ setTimeout(attach, 200); return; }}

        // Force Plotly to fit its container (not the full viewport)
        const plotContainer = document.getElementById('plot');
        Plotly.relayout(plotDiv, {{ width: plotContainer.clientWidth, height: plotContainer.clientHeight }});

        plotDiv.on('plotly_hover', (data) => {{
          const pt = (data?.detail ?? data)?.points?.[0];
          if (pt?.customdata) showPoint(pt.customdata);
        }});


      }}

      attach();
    }})();
  </script>
</body>
</html>"""
