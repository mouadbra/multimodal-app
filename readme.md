# Multi-Modal AI Pipeline & Evaluation System

Process audio, generate images, analyze them, and evaluate quality at scale. Speak a prompt, watch it become an image via FLUX, then hear the AI describe it back to you,   and run evaluation batches to measure quality over time.

## Overview

This application allows you to:

- Record audio and transcribe it to text via **Azure OpenAI Whisper**
- Generate an image from the transcript using **FLUX 1.1 Pro** (Azure AI Foundry)
- Analyze the generated image with **CLIP** (similarity score) and **GPT-4o Vision** (description)
- Convert the image description back to speech via **Azure OpenAI TTS**
- Run **evaluation batches** over multiple prompts and iterations to measure quality over time
- Visualize batch results: average similarity scores, objective LLM evaluations, image gallery, technical issue breakdown

The frontend provides two tabs: a **Pipeline** tab for the multi-modal demo and an **Evaluation** tab with a full dashboard.

## Technical Architecture

- **Frontend**: React + TypeScript + Tailwind + Shadcn/ui
  - **Pipeline tab**: Audio recording → `/transcribe` → `/generate_image` → `/analyze_image_similarity` → `/text_to_speech`
  - **Evaluation tab**: Batch launcher + dashboard with 4 tabs (Overview / Prompts / Metrics / Gallery)

- **Backend**: FastAPI + Modal
  - `/transcribe` → Whisper transcription
  - `/generate_image` → FLUX 1.1 Pro image generation
  - `/analyze_image_similarity` → CLIP similarity + GPT-4o Vision description
  - `/text_to_speech` → Azure OpenAI TTS
  - `/evaluate` → Run a full evaluation batch (async, parallel)
  - `/evaluation/{batch_id}` → Retrieve batch results
  - `/evaluation_batches` → List all batches

- **Database**: SQLite on Modal Volume (4 tables)

- **LLM**: Azure OpenAI GPT-4o for vision analysis and objective evaluation

- **Embeddings**: CLIP (`clip-ViT-B-32`) via `sentence-transformers` for image-text similarity

- **Infrastructure**: Modal for serverless deployment with persistent volume

## Code Structure

```
multimodal_app/
│
├── backend_service/
│   ├── .env                              # Azure credentials (not committed)
│   ├── pyproject.toml
│   └── src/modal_app/
│       ├── common.py                     # Modal app, FastAPI instance, CORS, image
│       ├── models.py                     # Pydantic models (pipeline + evaluation)
│       └── main.py
│           ├── init_db()                 # Create SQLite tables
│           ├── get_chat/whisper/tts_client() # Azure OpenAI clients
│           ├── /transcribe               # POST - audio → text
│           ├── /generate_image           # POST - text → image (FLUX)
│           ├── /analyze_image_similarity # POST - CLIP + GPT-4o Vision
│           ├── /text_to_speech           # POST - text → audio
│           ├── process_single_iteration()# Core eval loop (async)
│           ├── objective_evaluation()    # Structured LLM eval
│           ├── describe_image()          # Free-form image description
│           ├── write_results_to_db()     # Persist eval results
│           ├── calculate_metrics()       # Aggregate scores
│           ├── /evaluate                 # POST - run batch evaluation
│           ├── /evaluation/{batch_id}    # GET - retrieve batch results
│           └── /evaluation_batches       # GET - list all batches
│
└── frontend_service/
    ├── .env                              # VITE_MODAL_URL
    └── src/
        ├── App.tsx                       # Main component (Pipeline + Evaluation tabs)
        └── components/ui/
            ├── button.tsx
            ├── card.tsx
            └── progress.tsx
```

## Database

### Table 1: Evaluation Batches
```sql
CREATE TABLE evaluation_batches (
    batch_id    TEXT PRIMARY KEY,
    timestamp   DATETIME NOT NULL,
    description TEXT
);
```

### Table 2: Test Prompts
```sql
CREATE TABLE test_prompts (
    prompt_id   TEXT PRIMARY KEY,
    prompt_text TEXT NOT NULL
);
```

### Table 3: Generated Images
```sql
CREATE TABLE generated_images (
    image_id             TEXT PRIMARY KEY,
    batch_id             TEXT NOT NULL,
    prompt_id            TEXT NOT NULL,
    prompt_text          TEXT NOT NULL,
    image_data           TEXT NOT NULL,       -- base64
    iteration            INTEGER NOT NULL,
    similarity_score     REAL,               -- CLIP score (0-100)
    prompt_elements      JSON,
    objective_evaluation JSON,               -- structured LLM eval
    llm_feedback         TEXT,
    FOREIGN KEY (batch_id) REFERENCES evaluation_batches(batch_id),
    FOREIGN KEY (prompt_id) REFERENCES test_prompts(prompt_id)
);
```

### Table 4: Batch Metrics
```sql
CREATE TABLE batch_metrics (
    batch_id             TEXT NOT NULL,
    avg_similarity_score REAL,
    avg_llm_score        REAL,
    timestamp            DATETIME NOT NULL,
    FOREIGN KEY (batch_id) REFERENCES evaluation_batches(batch_id)
);
```

## Multi-Modal Pipeline Flow

```
🎤 Audio Input
     ↓
Azure Whisper → 📝 Transcript
     ↓
FLUX 1.1 Pro  → 🖼️  Generated Image (base64)
     ↓              ↓
  CLIP          GPT-4o Vision
(similarity)    (description)
     ↓              ↓
     📊 Results
     ↓
Azure TTS → 🔊 Audio Description
```

## Evaluation System Flow

```
POST /evaluate
  ↓
Create batch record in SQLite
  ↓
For each prompt × N iterations (async parallel):
  ├── generate_image()              ← FLUX 1.1 Pro
  ├── analyze_image_similarity()    ← CLIP score
  ├── objective_evaluation()        ← Structured LLM check (JSON)
  └── describe_image()              ← Free-form feedback
  ↓
write_results_to_db()
  ↓
calculate_metrics() → EvaluationResponse
```

## Technologies Used

### Backend

- **FastAPI**: Python web framework
- **Modal**: Serverless deployment with persistent volume
- **SQLite**: Lightweight database for storing eval results
- **sentence-transformers**: CLIP model (`clip-ViT-B-32`) for image-text similarity
- **Pillow**: Image processing
- **Pydantic**: Structured output validation for LLM responses
- **Azure OpenAI**:
  - `whisper` for speech-to-text
  - `gpt-4o` for vision analysis and objective evaluation
  - `tts` for text-to-speech
- **FLUX 1.1 Pro** (Azure AI Foundry): Image generation

### Frontend

- **React + TypeScript**: UI framework
- **Vite**: Build tool
- **TailwindCSS**: Styling
- **Shadcn/ui**: UI components (Button, Card, Progress)
- **MediaRecorder API**: Browser-native audio recording

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/mouadbra/multimodal-app.git
cd multimodal-app
```

### 2. Backend

```bash
cd backend_service
uv sync
```

Create a `.env` file:
```
# GPT-4o (Vision + Chat)
AZURE_OPENAI_CHAT_API_KEY=
AZURE_OPENAI_CHAT_ENDPOINT=
AZURE_OPENAI_CHAT_DEPLOYMENT_NAME=gpt-4o
AZURE_OPENAI_API_VERSION=2024-02-01

# Whisper (STT)
AZURE_OPENAI_WHISPER_API_KEY=
AZURE_OPENAI_WHISPER_ENDPOINT=
AZURE_OPENAI_WHISPER_DEPLOYMENT_NAME=whisper

# FLUX (Image generation)
AZURE_FLUX_API_KEY=
AZURE_FLUX_ENDPOINT=
AZURE_FLUX_DEPLOYMENT_NAME=FLUX-1.1-pro
AZURE_FLUX_API_VERSION=2025-04-01-preview

# TTS
AZURE_OPENAI_TTS_API_KEY=
AZURE_OPENAI_TTS_ENDPOINT=
AZURE_OPENAI_TTS_DEPLOYMENT_NAME=tts
AZURE_OPENAI_TTS_API_VERSION=2025-03-01-preview
```

Create a Modal secret named `azure-openai-secret` with the same variables at [modal.com](https://modal.com).

Authenticate with Modal:
```bash
python -m modal token new
```

Run the backend:
```bash
uv run modal serve -m src.modal_app.main
```

### 3. Frontend

```bash
cd frontend_service
bun install
```

Create a `.env` file:
```
VITE_MODAL_URL=https://your-modal-url.modal.run
```

Run the frontend:
```bash
bun run dev
```

## Typical Flow

### Multi-Modal Pipeline
1. Open `http://localhost:5173/` → **Pipeline** tab
2. Click **"Demander les permissions"** and select your microphone
3. Click **"Démarrer"** and describe an image out loud
4. Click **"Arrêter"** then **"Traiter"**
5. Watch the pipeline: Transcription → Image Generation → Analysis → Audio

### Evaluation Batch
1. Go to **Evaluation** tab
2. Enter a description (e.g. "Test batch #1") and click **Lancer**
3. Wait ~3-5 min for 3 images to be generated and evaluated
4. Explore the 4 tabs:
   - **Overview**: avg similarity score + avg objective score
   - **Prompts**: list of prompts used
   - **Metrics**: technical issues frequency
   - **Gallery**: all generated images with scores and issue tags



## Notes

- CLIP similarity scores of 30-50% are normal for long descriptive prompts — it's a cosine distance, not a quality score
- All Azure credentials are stored as Modal secrets and never exposed to the frontend
