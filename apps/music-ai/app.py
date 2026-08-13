"""Local Qwen3 embedding + rerank inference for JedFlix.

GPU-locked: one request uses the 1660 Ti at a time so embed backfill and
interactive search cannot OOM the 6GB card.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Literal

import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer
from transformers import AutoModelForCausalLM, AutoTokenizer

log = logging.getLogger("music-ai")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

EMBEDDING_MODEL = os.environ.get("MUSIC_AI_EMBEDDING_MODEL", "Qwen/Qwen3-Embedding-0.6B")
RERANKER_MODEL = os.environ.get("MUSIC_AI_RERANKER_MODEL", "Qwen/Qwen3-Reranker-0.6B")
EMBEDDING_DIM = int(os.environ.get("MUSIC_AI_EMBEDDING_DIM", "512"))
MAX_EMBED_BATCH = int(os.environ.get("MUSIC_AI_EMBED_BATCH", "8"))
MAX_RERANK_BATCH = int(os.environ.get("MUSIC_AI_RERANK_BATCH", "8"))
MAX_TEXTS = int(os.environ.get("MUSIC_AI_MAX_TEXTS", "64"))
MAX_RERANK_LENGTH = int(os.environ.get("MUSIC_AI_RERANK_MAX_LENGTH", "1024"))
DEFAULT_INSTRUCT = (
	"Given a music search query, retrieve relevant artists, albums, or tracks"
)

app = FastAPI(title="JedFlix music-ai", version="1.0.0")
_gpu_lock = asyncio.Lock()
_ready = False
_device = "cpu"
_embedder: SentenceTransformer | None = None
_rerank_tokenizer: Any = None
_rerank_model: Any = None
_yes_id = 0
_no_id = 0
_prefix_tokens: list[int] = []
_suffix_tokens: list[int] = []
_load_error: str | None = None


def _pick_device() -> str:
	if torch.cuda.is_available():
		return "cuda"
	return "cpu"


def _load_embedder(device: str) -> SentenceTransformer:
	kwargs: dict[str, Any] = {
		"device": device,
		"truncate_dim": EMBEDDING_DIM,
		"tokenizer_kwargs": {"padding_side": "left"},
		"trust_remote_code": True,
	}
	if device == "cuda":
		kwargs["model_kwargs"] = {"torch_dtype": torch.float16}
	try:
		return SentenceTransformer(EMBEDDING_MODEL, **kwargs)
	except TypeError:
		kwargs.pop("trust_remote_code", None)
		kwargs.pop("tokenizer_kwargs", None)
		return SentenceTransformer(EMBEDDING_MODEL, **kwargs)


def _load_reranker(device: str) -> None:
	global _rerank_tokenizer, _rerank_model, _yes_id, _no_id, _prefix_tokens, _suffix_tokens
	dtype = torch.float16 if device == "cuda" else torch.float32
	tokenizer = AutoTokenizer.from_pretrained(
		RERANKER_MODEL,
		padding_side="left",
		trust_remote_code=True,
	)
	if tokenizer.pad_token_id is None:
		tokenizer.pad_token = tokenizer.eos_token
	model = AutoModelForCausalLM.from_pretrained(
		RERANKER_MODEL,
		torch_dtype=dtype,
		trust_remote_code=True,
	).to(device)
	model.eval()
	prefix = (
		'<|im_start|>system\nJudge whether the Document meets the requirements based on the Query '
		'and the Instruct provided. Note that the answer can only be "yes" or "no".<|im_end|>\n'
		'<|im_start|>user\n'
	)
	suffix = "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"
	_prefix_tokens = tokenizer.encode(prefix, add_special_tokens=False)
	_suffix_tokens = tokenizer.encode(suffix, add_special_tokens=False)
	_yes_id = tokenizer.convert_tokens_to_ids("yes")
	_no_id = tokenizer.convert_tokens_to_ids("no")
	_rerank_tokenizer = tokenizer
	_rerank_model = model


def _load_models() -> None:
	global _embedder, _ready, _device, _load_error
	try:
		_device = _pick_device()
		log.info("loading embedding model %s dim=%s device=%s", EMBEDDING_MODEL, EMBEDDING_DIM, _device)
		_embedder = _load_embedder(_device)
		log.info("loading reranker model %s", RERANKER_MODEL)
		_load_reranker(_device)
		if _device == "cuda":
			torch.cuda.empty_cache()
		_ready = True
		_load_error = None
		log.info("models ready on %s", _device)
	except Exception as exc:  # noqa: BLE001 — surface load failures via /health
		_load_error = str(exc)
		_ready = False
		log.exception("model load failed")


@app.on_event("startup")
async def _startup() -> None:
	# Load in a thread so /live answers during the first HF download.
	await asyncio.to_thread(_load_models)


class EmbedRequest(BaseModel):
	texts: list[str] = Field(min_length=1)
	is_query: bool = False


class EmbedResponse(BaseModel):
	embeddings: list[list[float]]
	dim: int
	device: str


class RerankDocument(BaseModel):
	id: str
	text: str


class RerankRequest(BaseModel):
	query: str = Field(min_length=1)
	documents: list[RerankDocument] = Field(min_length=1)
	instruct: str | None = None


class RerankResult(BaseModel):
	id: str
	score: float


class RerankResponse(BaseModel):
	results: list[RerankResult]
	device: str


class HealthResponse(BaseModel):
	status: Literal["ok", "loading", "error"]
	device: str
	embedding: bool
	reranker: bool
	dim: int
	error: str | None = None


@app.get("/live")
def live() -> dict[str, str]:
	return {"status": "live"}


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
	if _ready and _embedder is not None and _rerank_model is not None:
		return HealthResponse(
			status="ok",
			device=_device,
			embedding=True,
			reranker=True,
			dim=EMBEDDING_DIM,
		)
	if _load_error:
		return HealthResponse(
			status="error",
			device=_device,
			embedding=_embedder is not None,
			reranker=_rerank_model is not None,
			dim=EMBEDDING_DIM,
			error=_load_error,
		)
	return HealthResponse(
		status="loading",
		device=_device,
		embedding=False,
		reranker=False,
		dim=EMBEDDING_DIM,
	)


def _as_2d(vectors: Any) -> np.ndarray:
	array = np.asarray(vectors, dtype=np.float32)
	if array.ndim == 1:
		array = array.reshape(1, -1)
	return array


def _truncate_normalize(vectors: np.ndarray) -> np.ndarray:
	if vectors.shape[1] > EMBEDDING_DIM:
		vectors = vectors[:, :EMBEDDING_DIM]
	norms = np.linalg.norm(vectors, axis=1, keepdims=True)
	return vectors / np.clip(norms, 1e-12, None)


def _embed_sync(texts: list[str], is_query: bool) -> list[list[float]]:
	if _embedder is None:
		raise RuntimeError("embedding model is not loaded")
	kwargs: dict[str, Any] = {
		"normalize_embeddings": True,
		"batch_size": min(MAX_EMBED_BATCH, len(texts)),
		"show_progress_bar": False,
	}
	if is_query:
		try:
			vectors = _embedder.encode(texts, prompt_name="query", **kwargs)
		except TypeError:
			vectors = _embedder.encode(texts, **kwargs)
	else:
		vectors = _embedder.encode(texts, **kwargs)
	array = _truncate_normalize(_as_2d(vectors))
	return [row.tolist() for row in array]


def _format_rerank_body(query: str, document: str, instruct: str) -> str:
	return f"<Instruct>: {instruct}\n<Query>: {query}\n<Document>: {document}"


@torch.inference_mode()
def _rerank_sync(query: str, documents: list[RerankDocument], instruct: str | None) -> list[RerankResult]:
	if _rerank_model is None or _rerank_tokenizer is None:
		raise RuntimeError("reranker model is not loaded")
	instruction = instruct or DEFAULT_INSTRUCT
	max_body = max(32, MAX_RERANK_LENGTH - len(_prefix_tokens) - len(_suffix_tokens))
	scores: list[float] = []
	for start in range(0, len(documents), MAX_RERANK_BATCH):
		batch = documents[start : start + MAX_RERANK_BATCH]
		encoded: list[list[int]] = []
		for doc in batch:
			body_ids = _rerank_tokenizer.encode(
				_format_rerank_body(query, doc.text, instruction),
				add_special_tokens=False,
				truncation=True,
				max_length=max_body,
			)
			encoded.append(_prefix_tokens + body_ids + _suffix_tokens)
		padded = _rerank_tokenizer.pad(
			{"input_ids": encoded},
			padding=True,
			return_tensors="pt",
		)
		inputs = {key: value.to(_device) for key, value in padded.items()}
		logits = _rerank_model(**inputs).logits[:, -1, :]
		yes_logits = logits[:, _yes_id]
		no_logits = logits[:, _no_id]
		probs = torch.nn.functional.log_softmax(torch.stack([no_logits, yes_logits], dim=1), dim=1)[:, 1].exp()
		scores.extend(float(score) for score in probs.detach().cpu())
	out = [
		RerankResult(id=doc.id, score=score)
		for doc, score in zip(documents, scores, strict=True)
	]
	out.sort(key=lambda item: item.score, reverse=True)
	return out


@app.post("/v1/embed", response_model=EmbedResponse)
async def embed(req: EmbedRequest) -> EmbedResponse:
	if not _ready:
		raise HTTPException(status_code=503, detail=_load_error or "models loading")
	if len(req.texts) > MAX_TEXTS:
		raise HTTPException(status_code=400, detail=f"at most {MAX_TEXTS} texts per request")
	texts = [text.strip() or " " for text in req.texts]
	async with _gpu_lock:
		vectors = await asyncio.to_thread(_embed_sync, texts, req.is_query)
	return EmbedResponse(embeddings=vectors, dim=len(vectors[0]) if vectors else EMBEDDING_DIM, device=_device)


@app.post("/v1/rerank", response_model=RerankResponse)
async def rerank(req: RerankRequest) -> RerankResponse:
	if not _ready:
		raise HTTPException(status_code=503, detail=_load_error or "models loading")
	if len(req.documents) > MAX_TEXTS:
		raise HTTPException(status_code=400, detail=f"at most {MAX_TEXTS} documents per request")
	async with _gpu_lock:
		results = await asyncio.to_thread(_rerank_sync, req.query.strip(), req.documents, req.instruct)
	return RerankResponse(results=results, device=_device)
