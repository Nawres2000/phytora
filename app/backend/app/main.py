from fastapi import FastAPI, UploadFile, File, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image
from io import BytesIO
import random
import time

app = FastAPI(title="PHYTORA API")

# Autoriser le futur site web (React) à communiquer avec l'API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # En dev, on autorise tout
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Modèles de données (Pydantic) ---
class BoundingBox(BaseModel):
    x: float
    y: float
    width: float
    height: float
    label: str
    confidence: float
    color: str

class DiseasePrediction(BaseModel):
    plant_species: str
    disease: str
    is_healthy: bool
    confidence: float

class PredictionResponse(BaseModel):
    task: str
    predictions: list[BoundingBox] = []
    disease: DiseasePrediction = None
    counts: dict = None
    latency_ms: float

# --- Routes de l'API ---

@app.get("/health")
def health_check():
    return {"status": "ok", "message": "Le serveur PHYTORA est en ligne !"}

@app.post("/predict", response_model=PredictionResponse)
async def predict(
    file: UploadFile = File(...), 
    task: str = Query("classification")
):
    start_time = time.time()
    
    # 1. Vérifier que c'est bien une image
    if file.content_type not in ["image/jpeg", "image/png", "image/webp"]:
        raise HTTPException(status_code=400, detail="Format d'image non supporté.")
    
    # 2. Lire l'image
    contents = await file.read()
    try:
        image = Image.open(BytesIO(contents)).convert("RGB")
    except:
        raise HTTPException(status_code=400, detail="Image illisible.")
    
    # 3. FAIRE SEMBLANT DE PRÉDIRE (Mock pour le moment)
    time.sleep(0.5) # Simule le temps de calcul de l'IA
    
    if task == "classification":
        # Faux diagnostic
        return PredictionResponse(
            task="classification",
            disease=DiseasePrediction(
                plant_species="Tomate",
                disease="Mildiou (Late blight)",
                is_healthy=False,
                confidence=round(random.uniform(0.85, 0.99), 3)
            ),
            latency_ms=round((time.time() - start_time) * 1000, 2)
        )
    else:
        # Fausse détection de mauvaises herbes
        return PredictionResponse(
            task="detection",
            counts={"weeds": random.randint(2, 10), "crops": random.randint(1, 5)},
            latency_ms=round((time.time() - start_time) * 1000, 2)
        )