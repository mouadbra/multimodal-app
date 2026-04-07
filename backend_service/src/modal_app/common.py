import modal
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

# Modal app
app = modal.App("multimodal-app")

# Volume for persistence
volume = modal.Volume.from_name("multimodal-volume", create_if_missing=True)
VOLUME_DIR = "/data"
DB_PATH = f"{VOLUME_DIR}/multimodal.db"

# FastAPI app
fastapi_app = FastAPI()
fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Modal image with all dependencies
image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "fastapi",
        "openai",
        "sentence-transformers",
        "Pillow",
        "python-multipart",
        "python-dotenv",
        "requests",
    )
)