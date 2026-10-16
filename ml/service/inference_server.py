import os
import sys
import time
import json
import base64
import io
import numpy as np
import torch
import torch.nn.functional as F
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from models.bioacoustic_cnn import BioacousticCNN
from training.audio_transforms import (
    load_audio_mono,
    pad_or_crop_audio,
    compute_mel_spectrogram,
    extract_features_for_inference,
    TARGET_SAMPLES,
    SAMPLE_RATE
)
from evaluation.explainability import GradCAMBioacoustics

app = FastAPI(title="BirdSong Bioacoustics CNN Inference Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

CHECKPOINT_PATH = os.environ.get("CNN_CHECKPOINT_PATH", "ml/checkpoints/best_model.pt")
METADATA_PATH = os.environ.get("CNN_METADATA_PATH", "ml/checkpoints/model_metadata.json")

# Service state
model: Optional[BioacousticCNN] = None
grad_cam: Optional[GradCAMBioacoustics] = None
metadata: Dict[str, Any] = {}
label_to_idx: Dict[str, int] = {}
idx_to_label: Dict[int, str] = {}
species_meta: Dict[str, Any] = {}

def load_model_if_available():
    global model, grad_cam, metadata, label_to_idx, idx_to_label, species_meta

    if not os.path.exists(CHECKPOINT_PATH) or not os.path.exists(METADATA_PATH):
        print(f"Warning: Model checkpoint ({CHECKPOINT_PATH}) or metadata ({METADATA_PATH}) not found.")
        return False

    try:
        with open(METADATA_PATH, 'r', encoding='utf-8') as f:
            metadata = json.load(f)

        label_to_idx = metadata.get('label_to_idx', {})
        idx_to_label = {int(k): v for k, v in metadata.get('idx_to_label', {}).items()}
        species_meta = metadata.get('species_metadata', {})
        num_classes = metadata.get('num_classes', len(label_to_idx))

        m = BioacousticCNN(num_classes=num_classes, in_channels=1)
        state_dict = torch.load(CHECKPOINT_PATH, map_location='cpu')
        m.load_state_dict(state_dict)
        m.eval()

        model = m
        try:
            grad_cam = GradCAMBioacoustics(model)
        except Exception as e:
            print(f"Grad-CAM hook warning: {e}")
            grad_cam = None

        print(f"Loaded BioacousticCNN ({metadata.get('model_version')}) for {num_classes} classes.")
        return True
    except Exception as e:
        print(f"Failed to load checkpoint: {e}")
        return False

# Attempt initial load
load_model_if_available()

class AudioPayload(BaseModel):
    audio_base64: Optional[str] = None
    min_confidence: Optional[float] = 0.35

@app.get("/health")
def health():
    is_ready = model is not None
    return {
        "status": "healthy" if is_ready else "no_model_loaded",
        "model_loaded": is_ready,
        "model_version": metadata.get("model_version", "none"),
        "num_classes": metadata.get("num_classes", 0),
        "classes": list(label_to_idx.keys()),
        "architecture": metadata.get("architecture", "BioacousticCNN-4Block"),
        "created_at": metadata.get("created_at"),
        "device": "cpu"
    }

@app.post("/reload")
def reload_model():
    success = load_model_if_available()
    return {"reloaded": success, "status": "healthy" if success else "failed"}

@app.post("/predict")
async def predict_audio(
    file: Optional[UploadFile] = File(None),
    audio_base64: Optional[str] = Form(None),
    min_confidence: float = Form(0.35)
):
    if model is None:
        if not load_model_if_available():
            raise HTTPException(
                status_code=503,
                detail="CNN Model is not currently available or training is not completed yet."
            )

    t0 = time.time()
    audio_bytes: Optional[bytes] = None

    if file:
        audio_bytes = await file.read()
    elif audio_base64:
        clean_b64 = audio_base64.split(",")[-1]
        try:
            audio_bytes = base64.b64decode(clean_b64)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid Base64 audio payload: {str(e)}")

    if not audio_bytes or len(audio_bytes) < 64:
        raise HTTPException(status_code=400, detail="Empty or invalid audio bytes provided.")

    try:
        # Preprocessing
        input_tensor = extract_features_for_inference(audio_bytes, sr=SAMPLE_RATE)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Audio decoding/preprocessing failed: {str(e)}")

    # Model inference
    with torch.no_grad():
        logits = model(input_tensor)
        probs = F.softmax(logits, dim=1).squeeze(0) # (num_classes,)
        top_k = min(3, len(label_to_idx))
        values, indices = torch.topk(probs, k=top_k)

    candidates = []
    for rank in range(top_k):
        cls_idx = indices[rank].item()
        score = round(float(values[rank].item()), 4)
        sp_id = idx_to_label.get(cls_idx, f"unknown-{cls_idx}")
        info = species_meta.get(sp_id, {})
        candidates.append({
            "species_id": sp_id,
            "common_name": info.get("commonName", sp_id),
            "scientific_name": info.get("scientificName", ""),
            "model_score": score,
            "rank": rank + 1
        })

    top_score = candidates[0]["model_score"]
    is_uncertain = top_score < min_confidence

    # Optional Saliency Map via Grad-CAM
    saliency_heatmap = None
    if grad_cam and not is_uncertain:
        try:
            top_class_idx = indices[0].item()
            raw_saliency = grad_cam.generate_saliency(input_tensor, target_class_idx=top_class_idx)
            # Downsample saliency to 16x32 grid for compact JSON response
            from scipy.ndimage import zoom
            downsampled = zoom(raw_saliency, (16 / raw_saliency.shape[0], 32 / raw_saliency.shape[1]), order=1)
            saliency_heatmap = np.round(downsampled, 3).tolist()
        except Exception as e:
            print(f"Saliency computation notice: {e}")

    # Downsampled Mel-spectrogram for frontend visualization
    mel_array = input_tensor.squeeze().numpy()
    from scipy.ndimage import zoom
    down_mel = zoom(mel_array, (16 / mel_array.shape[0], 32 / mel_array.shape[1]), order=1)

    latency_ms = round((time.time() - t0) * 1000, 1)

    return {
        "status": "success",
        "predicted_species": candidates[0] if not is_uncertain else None,
        "is_uncertain": is_uncertain,
        "uncertainty_reason": f"Top candidate model score ({top_score:.2%}) is below calibrated threshold ({min_confidence:.2%})" if is_uncertain else None,
        "candidates": candidates,
        "model_version": metadata.get("model_version", "cnn-v1.0.0"),
        "inference_latency_ms": latency_ms,
        "spectrogram_preview": np.round(down_mel, 3).tolist(),
        "saliency_heatmap": saliency_heatmap,
        "disclaimer": "Scores represent CNN output activations across trained classes and should not be interpreted as definitive field identification proof."
    }

if __name__ == '__main__':
    import uvicorn
    port = int(os.environ.get("CNN_PORT", 5005))
    uvicorn.run("inference_server:app", host="127.0.0.1", port=port, log_level="info")
