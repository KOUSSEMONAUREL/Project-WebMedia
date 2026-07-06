from fastapi import FastAPI, HTTPException, Depends
from fastapi.security import APIKeyHeader
from pydantic import BaseModel
import uvicorn
import os
import requests
from typing import List, Optional
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np

app = FastAPI(title="WebMedia Recommender API")

API_KEY = os.environ.get("RECOMMENDER_API_KEY", "")
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

async def verify_api_key(api_key: str = Depends(api_key_header)):
    if API_KEY and api_key != API_KEY:
        raise HTTPException(status_code=403, detail="Invalid API key")
    return api_key

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
        return [{"media_id": target_id, "score": 1.0}]

    texts = [build_feature_text(m) for m in all_media]
    ids = [m.get("id", m.get("media_id", "")) for m in all_media]

    try:
        target_idx = ids.index(target_id)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"Media {target_id} not found")

    vectorizer = TfidfVectorizer(stop_words="english", max_features=5000)
    tfidf = vectorizer.fit_transform(texts)
    sims = cosine_similarity(tfidf[target_idx], tfidf).flatten()

    ranked = [(ids[i], float(sims[i])) for i in range(len(ids)) if i != target_idx]
    ranked.sort(key=lambda x: x[1], reverse=True)

    return [{"media_id": rid, "score": round(score, 4)} for rid, score in ranked[:limit]]

@app.get("/")
def read_root():
    return {
        "status": "WebMedia Recommender is live",
        "method": "TF-IDF cosine similarity on title/synopsis/genre",
        "source": "Neon API",
    }

@app.post("/recommend", response_model=List[MediaBase])
async def get_recommendations(request: RecommendationRequest, _: str = Depends(verify_api_key)):
    try:
        results = compute_recommendations(request.media_id, request.limit)
        return results
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=7860)
