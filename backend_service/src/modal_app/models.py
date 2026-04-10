from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class ImageGenerationRequest(BaseModel):
    prompt: str


class ImageSimilarityRequest(BaseModel):
    prompt: str
    image_b64: str


class TextToSpeechRequest(BaseModel):
    text: str


# Evaluation models
class ElementPresence(BaseModel):
    element: str
    present: bool
    details: str


class ObjectiveCriteriaResponse(BaseModel):
    required_elements: List[ElementPresence]
    composition_issues: List[str]
    technical_issues: List[str]
    style_match: bool
    overall_score: float
    evaluation_notes: str


class PromptElements(BaseModel):
    chain_of_thought: str
    required_elements: List[str]


class EvaluationRequest(BaseModel):
    description: Optional[str] = None
    num_iterations: int = 5
    custom_prompts: Optional[List[str]] = None


class EvaluationResult(BaseModel):
    prompt: str
    image_b64: str
    similarity_score: float
    objective_evaluation: ObjectiveCriteriaResponse
    feedback: str
    prompt_id: Optional[str] = None


class BatchMetrics(BaseModel):
    avg_similarity_score: float
    avg_objective_score: float
    technical_issues_frequency: dict


class EvaluationResponse(BaseModel):
    batch_id: str
    description: Optional[str]
    timestamp: str
    prompts: List[str]
    metrics: BatchMetrics
    results: List[EvaluationResult]