# Multi-Modal AI Pipeline

Process audio, generate images, analyze them, and get a spoken description back. Speak a prompt, watch it become an image via FLUX, then hear the AI describe it back to you.

## Overview

This application allows you to:

- Record audio and transcribe it to text via **Azure OpenAI Whisper**
- Generate an image from the transcript using **FLUX 1.1 Pro** (Azure AI Foundry)
- Analyze the generated image with **CLIP** (similarity score) and **GPT-4o Vision** (description)
- Convert the image description back to speech via **Azure OpenAI TTS**

The frontend lets you record your voice, trigger the full pipeline, and visualize each step with a progress bar.

## Technical Architecture

- **Frontend**: React + TypeScript + Tailwind + Shadcn/ui
  - Audio recording via `MediaRecorder` API
  - Pipeline progress bar → `/transcribe` → `/generate_image` → `/analyze_image_similarity` → `/text_to_speech`

- **Backend**: FastAPI + Modal
  - `/transcribe` → Whisper transcription
  - `/generate_image` → FLUX 1.1 Pro image generation
  - `/analyze_image_similarity` → CLIP similarity + GPT-4o Vision description
  - `/text_to_speech` → Azure OpenAI TTS

- **LLM**: Azure OpenAI GPT-4o for vision analysis

- **Embeddings**: CLIP (`clip-ViT-B-32`) via `sentence-transformers` for image-text similarity

- **Infrastructure**: Modal for serverless deployment

## Code Structure

```
multimodal_app/
│
├── backend_service/
│   ├── .env                         # Azure credentials (not committed)
│   ├── pyproject.toml
│   └── src/modal_app/
│       ├── common.py                # Modal app, FastAPI instance, CORS, image
│       ├── models.py                # Pydantic request models
│       └── main.py
│           ├── get_chat_client()    # Azure GPT-4o client
│           ├── get_whisper_client() # Azure Whisper client
│           ├── get_tts_client()     # Azure TTS client
│           ├── /transcribe          # POST - audio → text
│           ├── /generate_image      # POST - text → image (FLUX)
│           ├── /analyze_image_similarity  # POST - CLIP + GPT-4o Vision
│           └── /text_to_speech      # POST - text → audio
│
└── frontend_service/
    ├── .env                         # VITE_MODAL_URL
    └── src/
        ├── App.tsx                  # Main component
        └── components/ui/
            ├── button.tsx
            ├── card.tsx
            └── progress.tsx
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

## Technologies Used

### Backend

- **FastAPI**: Python web framework
- **Modal**: Serverless deployment
- **sentence-transformers**: CLIP model (`clip-ViT-B-32`) for image-text similarity
- **Pillow**: Image processing
- **Pydantic**: Request validation
- **Azure OpenAI**:
  - `whisper` for speech-to-text
  - `gpt-4o` for vision analysis
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
## Usage / Demo
- The video shows complete usage: audio recording, image generation, similarity analysis, and audio description
- Watch the demo here: [Multi-Modal AI Pipeline Demo](https://drive.google.com/file/d/10Ls9aD2i4eAQPRtq1aETY7kVneZyHTL1/view?usp=sharing)
  
## Typical Flow

1. Open `http://localhost:5173/`
2. Click **"Demander les permissions"** and select your microphone
3. Click **"Démarrer"** and describe an image out loud
4. Click **"Arrêter"** then **"Traiter"**
5. Watch the pipeline progress: Transcription → Image Generation → Analysis → Audio
6. See your transcript, generated image, similarity score, and hear the AI description
