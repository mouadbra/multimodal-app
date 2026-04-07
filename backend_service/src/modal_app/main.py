import sqlite3
from io import BytesIO
from urllib.request import urlopen
import base64
import os
import requests
import modal
from modal import asgi_app
from PIL import Image
from fastapi import UploadFile, File, HTTPException
from openai import AzureOpenAI
from sentence_transformers import SentenceTransformer, util
from .common import DB_PATH, VOLUME_DIR, app, fastapi_app, volume, image
from .models import ImageGenerationRequest, ImageSimilarityRequest, TextToSpeechRequest
from dotenv import load_dotenv

load_dotenv()


def get_chat_client():
    return AzureOpenAI(
        api_key=os.environ["AZURE_OPENAI_CHAT_API_KEY"],
        azure_endpoint=os.environ["AZURE_OPENAI_CHAT_ENDPOINT"],
        api_version=os.environ["AZURE_OPENAI_API_VERSION"],
    )

def get_whisper_client():
    return AzureOpenAI(
        api_key=os.environ["AZURE_OPENAI_WHISPER_API_KEY"],
        azure_endpoint=os.environ["AZURE_OPENAI_WHISPER_ENDPOINT"],
        api_version=os.environ["AZURE_OPENAI_API_VERSION"],
    )

def get_tts_client():
    return AzureOpenAI(
        api_key=os.environ["AZURE_OPENAI_TTS_API_KEY"],
        azure_endpoint=os.environ["AZURE_OPENAI_TTS_ENDPOINT"],
        api_version=os.environ.get("AZURE_OPENAI_TTS_API_VERSION", "2025-03-01-preview"),
    )

@fastapi_app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    client = get_whisper_client()
    if not file.content_type.startswith('audio/'):
        raise HTTPException(
            status_code=400,
            detail="File must be an audio file. Received: " + file.content_type
        )
    try:
        audio_bytes = await file.read()
        audio_file = BytesIO(audio_bytes)
        audio_file.name = file.filename or "audio.webm"
        print(f"Processing audio file: {file.filename}")
        print(f"Content type: {file.content_type}")
        print(f"File size: {len(audio_bytes)} bytes")
        transcription = client.audio.transcriptions.create(
            model=os.environ["AZURE_OPENAI_WHISPER_DEPLOYMENT_NAME"],
            file=audio_file
        )
        return {"transcript": transcription.text}
    except Exception as e:
        print("there was an error")
        print(str(e))
        return {"error": str(e)}, 500

@fastapi_app.post("/generate_image")
async def generate_image(request: ImageGenerationRequest):
    try:
        api_key = os.environ["AZURE_FLUX_API_KEY"]
        endpoint = os.environ["AZURE_FLUX_ENDPOINT"]
        deployment = os.environ["AZURE_FLUX_DEPLOYMENT_NAME"]
        api_version = os.environ["AZURE_FLUX_API_VERSION"]

        url = f"{endpoint}openai/deployments/{deployment}/images/generations?api-version={api_version}"
        headers = {
            "Api-Key": api_key,
            "Content-Type": "application/json",
        }
        body = {
            "prompt": request.prompt,
            "n": 1,
            "size": "1024x1024",
            "output_format": "png"
        }
        response = requests.post(url, headers=headers, json=body)
        response.raise_for_status()
        data = response.json()
        image_b64 = data["data"][0]["b64_json"]
        return {"image_b64": image_b64}
    except Exception as e:
        print(f"Image generation error: {str(e)}")
        return {"error": str(e)}, 500

@fastapi_app.post("/analyze_image_similarity")
async def analyze_image_similarity(request: ImageSimilarityRequest):
    # Décoder le base64 en image
    image_data = base64.b64decode(request.image_b64)
    image = Image.open(BytesIO(image_data)).convert('RGB')
    
    # CLIP pour la similarité
    clip_model = SentenceTransformer('clip-ViT-B-32')
    img_emb = clip_model.encode(image)
    text_emb = clip_model.encode([request.prompt])
    similarity = util.cos_sim(img_emb, text_emb)
    
    # GPT-4o Vision pour la description
    client = get_chat_client()
    vision_response = client.chat.completions.create(
        model=os.environ["AZURE_OPENAI_CHAT_DEPLOYMENT_NAME"],
        messages=[{
            "role": "user",
            "content": [
                {"type": "text", "text": "Describe this image."},
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/png;base64,{request.image_b64}"
                    }
                }
            ]
        }]
    )
    return {
        "similarity_score": float(similarity[0][0]) * 100,
        "image_description": vision_response.choices[0].message.content
    }

@fastapi_app.post("/text_to_speech")
async def text_to_speech(request: TextToSpeechRequest):
    client = get_tts_client()
    response = client.audio.speech.create(
        model=os.environ["AZURE_OPENAI_TTS_DEPLOYMENT_NAME"],
        voice="alloy",
        input=request.text
    )
    audio_base64 = base64.b64encode(response.content).decode('utf-8')
    return {"audio": audio_base64}

@app.function(
    image=image,
    secrets=[modal.Secret.from_name("azure-openai-secret")],
    volumes={VOLUME_DIR: volume},
)
@asgi_app()
def fastapi_entrypoint():
    return fastapi_app
