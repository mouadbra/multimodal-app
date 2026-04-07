from pydantic import BaseModel

class ImageGenerationRequest(BaseModel):
    prompt: str

class ImageSimilarityRequest(BaseModel):
    prompt: str
    image_b64: str  # changé de image_url à image_b64

class TextToSpeechRequest(BaseModel):
    text: str