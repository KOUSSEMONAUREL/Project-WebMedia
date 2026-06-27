import sys
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn
import os
import requests
from typing import List
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np

app = FastAPI(title="WebMedia Recommender API")

NEON_API_URL = os.environ.get("NEON_API_URL", "http://localhost:8787/api")

class RecommendationRequest(BaseModel):
    media_id: str
    limit: int = 10

class MediaBase(BaseModel):
    media_id: str
    score: float

def fetch_all_media() -> List[dict]:
    try:
        resp = requests.get(f"{NEON_API_URL}/media", params={"limit": 200, "type": "all"}, timeout=10)
        if resp.ok:
            data = resp.json()
            return data.get("data", [])
    except Exception as e:
        print(f"Warning: cannot fetch media: {e}")
    return []

def build_feature_text(m: dict) -> str:
    parts = [
        m.get("title", ""),
        m.get("synopsis", ""),
        m.get("genre", ""),
        m.get("type", ""),
    ]
    return " ".join(str(p) for p in parts if p)

def compute_recommendations(target_id: str, limit: int = 10) -> List[dict]:
    all_media = fetch_all_media()
    if not all_media:
        return []

    texts = [build_feature_text(m) for m in all_media]
    ids = []
    for m in all_media:
        mid = m.get("id") or m.get("media_id")
        if mid:
            ids.append(str(mid))

    if not ids or target_id not in ids:
        raise HTTPException(status_code=404, detail=f"Media {target_id} not found")

    target_idx = ids.index(target_id)

    vectorizer = TfidfVectorizer(stop_words="english", max_features=5000)
    tfidf = vectorizer.fit_transform(texts)
    sims = cosine_similarity(tfidf[target_idx], tfidf).flatten()
    sims = np.nan_to_num(sims, nan=0.0)

    ranked = [(ids[i], float(sims[i])) for i in range(len(ids)) if i != target_idx]
    ranked.sort(key=lambda x: x[1], reverse=True)

    return [{"media_id": rid, "score": round(score, 4)} for rid, score in ranked[:limit]]

@app.get("/")
def read_root() -> dict:
    return {
        "status": "WebMedia Recommender is live",
        "method": "TF-IDF cosine similarity on title/synopsis/genre",
        "source": "Neon API",
    }

@app.post("/recommend", response_model=List[MediaBase])
def get_recommendations(request: RecommendationRequest):
    try:
        results = compute_recommendations(request.media_id, request.limit)
        return results
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    port = int(os.environ.get("PORT", sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "7860"))
    uvicorn.run(app, host="0.0.0.0", port=port)
