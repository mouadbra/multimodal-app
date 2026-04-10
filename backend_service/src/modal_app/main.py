import sqlite3
import asyncio
import uuid
import json
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
from datetime import datetime
from typing import List
from .common import DB_PATH, VOLUME_DIR, app, fastapi_app, volume, image
from .models import (
    ImageGenerationRequest, ImageSimilarityRequest, TextToSpeechRequest,
    EvaluationRequest, EvaluationResult, EvaluationResponse,
    BatchMetrics, ObjectiveCriteriaResponse, ElementPresence
)
from dotenv import load_dotenv

load_dotenv()

DEFAULT_TEST_PROMPTS = [
    "A majestic lion standing on a rock at sunset with golden light",
    "A futuristic city with flying cars and neon lights at night",
    "A cozy wooden cabin in a snowy forest with smoke from the chimney",
]


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


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS evaluation_batches (
            batch_id TEXT PRIMARY KEY,
            timestamp DATETIME NOT NULL,
            description TEXT
        );
        CREATE TABLE IF NOT EXISTS test_prompts (
            prompt_id TEXT PRIMARY KEY,
            prompt_text TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS generated_images (
            image_id TEXT PRIMARY KEY,
            batch_id TEXT NOT NULL,
            prompt_id TEXT NOT NULL,
            prompt_text TEXT NOT NULL,
            image_data TEXT NOT NULL,
            iteration INTEGER NOT NULL,
            similarity_score REAL,
            prompt_elements JSON,
            objective_evaluation JSON,
            llm_feedback TEXT,
            FOREIGN KEY (batch_id) REFERENCES evaluation_batches(batch_id),
            FOREIGN KEY (prompt_id) REFERENCES test_prompts(prompt_id)
        );
        CREATE TABLE IF NOT EXISTS batch_metrics (
            batch_id TEXT NOT NULL,
            avg_similarity_score REAL,
            avg_llm_score REAL,
            timestamp DATETIME NOT NULL,
            FOREIGN KEY (batch_id) REFERENCES evaluation_batches(batch_id)
        );
    """)
    conn.commit()
    conn.close()  

def get_or_create_prompt_ids(conn, prompts: List[str]) -> dict:
    cursor = conn.cursor()
    prompt_map = {}
    for prompt in prompts:
        cursor.execute("SELECT prompt_id FROM test_prompts WHERE prompt_text = ?", (prompt,))
        row = cursor.fetchone()
        if row:
            prompt_map[prompt] = row[0]
        else:
            prompt_id = str(uuid.uuid4())
            cursor.execute("INSERT INTO test_prompts (prompt_id, prompt_text) VALUES (?, ?)", (prompt_id, prompt))
            prompt_map[prompt] = prompt_id
    conn.commit()
    return prompt_map


def aggregate_issues_by_category(issues: List[str]) -> dict:
    categorized = {}
    for issue in issues:
        key = issue.strip().lower()[:50]
        categorized[key] = categorized.get(key, 0) + 1
    return categorized


def write_results_to_db(batch_id: str, results: List[EvaluationResult]):
    with sqlite3.connect(DB_PATH) as conn:
        for result in results:
            conn.execute(
                """INSERT INTO generated_images
                (image_id, batch_id, prompt_id, prompt_text, image_data, iteration,
                similarity_score, objective_evaluation, llm_feedback)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    str(uuid.uuid4()),
                    batch_id,
                    result.prompt_id or str(uuid.uuid4()),
                    result.prompt,
                    result.image_b64,
                    0,
                    result.similarity_score,
                    json.dumps(result.objective_evaluation.dict()),
                    result.feedback,
                ),
            )
        conn.commit()


def calculate_metrics(batch_id: str) -> BatchMetrics:
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT similarity_score, objective_evaluation FROM generated_images WHERE batch_id = ?",
            (batch_id,)
        ).fetchall()

    similarity_scores = []
    objective_scores = []
    all_issues = []

    for row in rows:
        if row[0] is not None:
            similarity_scores.append(row[0])
        if row[1]:
            try:
                obj = json.loads(row[1])
                if obj.get("overall_score") is not None:
                    objective_scores.append(obj["overall_score"])
                all_issues.extend(obj.get("technical_issues", []))
            except json.JSONDecodeError:
                pass

    return BatchMetrics(
        avg_similarity_score=sum(similarity_scores) / len(similarity_scores) if similarity_scores else 0.0,
        avg_objective_score=sum(objective_scores) / len(objective_scores) if objective_scores else 0.0,
        technical_issues_frequency=aggregate_issues_by_category(all_issues),
    )


# ─── Multi-Modal Endpoints ────────────────────────────────────────────────────

@fastapi_app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    client = get_whisper_client()
    if not file.content_type.startswith('audio/'):
        raise HTTPException(status_code=400, detail="File must be an audio file. Received: " + file.content_type)
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
        headers = {"Api-Key": api_key, "Content-Type": "application/json"}
        body = {"prompt": request.prompt, "n": 1, "size": "1024x1024", "output_format": "png"}
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
    image_data = base64.b64decode(request.image_b64)
    image = Image.open(BytesIO(image_data)).convert('RGB')
    clip_model = SentenceTransformer('clip-ViT-B-32')
    img_emb = clip_model.encode(image)
    text_emb = clip_model.encode([request.prompt])
    similarity = util.cos_sim(img_emb, text_emb)
    client = get_chat_client()
    vision_response = client.chat.completions.create(
        model=os.environ["AZURE_OPENAI_CHAT_DEPLOYMENT_NAME"],
        messages=[{
            "role": "user",
            "content": [
                {"type": "text", "text": "Describe this image."},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{request.image_b64}"}}
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


# ─── Evaluation Endpoints ─────────────────────────────────────────────────────

async def process_single_iteration(
    prompt: str, prompt_id: str, batch_id: str, iteration: int
) -> EvaluationResult | None:
    try:
        # Generate image
        image_response = await generate_image(ImageGenerationRequest(prompt=prompt))
        image_b64 = image_response["image_b64"]

        # Run similarity + objective eval + description concurrently
        similarity_task = analyze_image_similarity(
            ImageSimilarityRequest(prompt=prompt, image_b64=image_b64)
        )
        objective_task = objective_evaluation(prompt=prompt, image_b64=image_b64)
        description_task = describe_image(image_b64=image_b64)

        similarity_response, objective_response, description_response = await asyncio.gather(
            similarity_task, objective_task, description_task
        )

        return EvaluationResult(
            prompt=prompt,
            image_b64=image_b64,
            similarity_score=similarity_response["similarity_score"],
            objective_evaluation=objective_response,
            feedback=description_response,
            prompt_id=prompt_id,
        )
    except Exception as e:
        print(f"Error processing iteration {iteration} for prompt '{prompt}': {str(e)}")
        return None


async def objective_evaluation(prompt: str, image_b64: str) -> ObjectiveCriteriaResponse:
    client = get_chat_client()
    schema = """{
        "required_elements": [{"element": "string", "present": true, "details": "string"}],
        "composition_issues": ["string"],
        "technical_issues": ["string"],
        "style_match": true,
        "overall_score": 0.0,
        "evaluation_notes": "string"
    }"""
    response = client.chat.completions.create(
        model=os.environ["AZURE_OPENAI_CHAT_DEPLOYMENT_NAME"],
        messages=[
            {
                "role": "system",
                "content": f"As a genius expert, your task is to understand the content and provide the parsed objects in json that match the following json_schema:\n{schema}\nMake sure to return an instance of the JSON, not the schema itself."
            },
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": f"Evaluate this image against the prompt: '{prompt}'"},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_b64}"}}
                ]
            }
        ],
        response_format={"type": "json_object"},
    )
    raw = json.loads(response.choices[0].message.content)
    elements = [ElementPresence(**e) for e in raw.get("required_elements", [])]
    return ObjectiveCriteriaResponse(
        required_elements=elements,
        composition_issues=raw.get("composition_issues", []),
        technical_issues=raw.get("technical_issues", []),
        style_match=raw.get("style_match", False),
        overall_score=raw.get("overall_score", 0.0),
        evaluation_notes=raw.get("evaluation_notes", ""),
    )


async def describe_image(image_b64: str) -> str:
    client = get_chat_client()
    response = client.chat.completions.create(
        model=os.environ["AZURE_OPENAI_CHAT_DEPLOYMENT_NAME"],
        messages=[{
            "role": "user",
            "content": [
                {"type": "text", "text": "Provide a detailed description of this image in 2-3 sentences."},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_b64}"}}
            ]
        }]
    )
    return response.choices[0].message.content


@fastapi_app.post("/evaluate", response_model=EvaluationResponse)
async def run_evaluation(request: EvaluationRequest):
    try:
        batch_id = str(uuid.uuid4())
        timestamp = datetime.now()

        with sqlite3.connect(DB_PATH) as conn:
            conn.execute(
                "INSERT INTO evaluation_batches (batch_id, timestamp, description) VALUES (?, ?, ?)",
                (batch_id, timestamp, request.description),
            )
            conn.commit()
            prompts = request.custom_prompts if request.custom_prompts else DEFAULT_TEST_PROMPTS
            prompt_map = get_or_create_prompt_ids(conn, prompts)

        tasks = [
            process_single_iteration(prompt, prompt_map[prompt], batch_id, iteration)
            for prompt in prompts
            for iteration in range(request.num_iterations)
        ]
        raw_results = await asyncio.gather(*tasks, return_exceptions=True)
        valid_results = [r for r in raw_results if isinstance(r, EvaluationResult)]

        write_results_to_db(batch_id, valid_results)
        volume.commit()  # ← seulement à la fin

        metrics = calculate_metrics(batch_id)
        return EvaluationResponse(
            batch_id=batch_id,
            description=request.description,
            timestamp=timestamp.isoformat(),
            prompts=prompts,
            metrics=metrics,
            results=valid_results,
        )
    except Exception as e:
        print(f"Evaluation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Evaluation failed: {str(e)}")

@fastapi_app.get("/evaluation/{batch_id}", response_model=EvaluationResponse)
async def get_evaluation_results(batch_id: str):
    try:
        volume.reload()
        with sqlite3.connect(DB_PATH) as conn:
            batch = conn.execute(
                "SELECT description, timestamp FROM evaluation_batches WHERE batch_id = ?",
                (batch_id,)
            ).fetchone()
            if not batch:
                raise HTTPException(status_code=404, detail="Batch not found")

            rows = conn.execute(
                """SELECT prompt_text, image_data, similarity_score,
                objective_evaluation, llm_feedback, prompt_id
                FROM generated_images WHERE batch_id = ? ORDER BY prompt_text""",
                (batch_id,)
            ).fetchall()

        evaluation_results = []
        all_issues = []
        for r in rows:
            try:
                obj = json.loads(r[3]) if r[3] else {}
                elements = [ElementPresence(**e) for e in obj.get("required_elements", [])]
                objective_eval = ObjectiveCriteriaResponse(
                    required_elements=elements,
                    composition_issues=obj.get("composition_issues", []),
                    technical_issues=obj.get("technical_issues", []),
                    style_match=obj.get("style_match", False),
                    overall_score=obj.get("overall_score", 0.0),
                    evaluation_notes=obj.get("evaluation_notes", ""),
                )
                all_issues.extend(obj.get("technical_issues", []))
                evaluation_results.append(EvaluationResult(
                    prompt=r[0], image_b64=r[1], similarity_score=r[2],
                    objective_evaluation=objective_eval, feedback=r[4] or "", prompt_id=r[5]
                ))
            except Exception as e:
                print(f"Error parsing result: {e}")
                continue

        similarity_scores = [r.similarity_score for r in evaluation_results if r.similarity_score]
        objective_scores = [r.objective_evaluation.overall_score for r in evaluation_results]
        metrics = BatchMetrics(
            avg_similarity_score=sum(similarity_scores) / len(similarity_scores) if similarity_scores else 0.0,
            avg_objective_score=sum(objective_scores) / len(objective_scores) if objective_scores else 0.0,
            technical_issues_frequency=aggregate_issues_by_category(all_issues),
        )
        return EvaluationResponse(
            batch_id=batch_id,
            description=batch[0],
            timestamp=batch[1],
            prompts=list(set(r.prompt for r in evaluation_results)),
            metrics=metrics,
            results=evaluation_results,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@fastapi_app.get("/evaluation_batches")
async def get_evaluation_batches():
    try:
        with sqlite3.connect(DB_PATH) as conn:
            rows = conn.execute(
                """SELECT eb.batch_id, eb.description, eb.timestamp,
                COUNT(gi.image_id) as image_count
                FROM evaluation_batches eb
                LEFT JOIN generated_images gi ON eb.batch_id = gi.batch_id
                GROUP BY eb.batch_id ORDER BY eb.timestamp DESC"""
            ).fetchall()
        return [
            {"batch_id": r[0], "description": r[1], "timestamp": r[2], "image_count": r[3]}
            for r in rows
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.function(
    image=image,
    secrets=[modal.Secret.from_name("azure-openai-secret")],
    volumes={VOLUME_DIR: volume},
)
@asgi_app()
def fastapi_entrypoint():
    init_db()
    volume.commit()  
    return fastapi_app