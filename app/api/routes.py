import uuid
from dataclasses import asdict
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, Query, Request

from app.domain.schemas import DiagnosisRecord, SymptomInput
from app.errors import NotFoundError, ValidationError
from app.history.repository import HistoryRepository
from app.services.symptom_service import SymptomService

router = APIRouter(prefix="/api")

def analyze_rate_limit(request: Request) -> None:
    """LLM calls cost money; cap them per IP."""
    request.app.state.rate_limiter(request)


def client_id(x_client_id: Annotated[str | None, Header()] = None) -> str:
    """There are no accounts: each browser generates a random id (kept in localStorage)
    and sends it on every request to scope its own history."""
    try:
        return str(uuid.UUID(x_client_id or ""))
    except ValueError:
        raise ValidationError("Missing or invalid X-Client-Id header.") from None


def history_repo(request: Request) -> HistoryRepository:
    repo: HistoryRepository = request.app.state.history
    return repo


def symptom_service(request: Request) -> SymptomService:
    service: SymptomService = request.app.state.service
    return service


ClientId = Annotated[str, Depends(client_id)]
History = Annotated[HistoryRepository, Depends(history_repo)]


@router.get("/health")
async def health(request: Request) -> dict[str, str]:
    return {"status": "ok", "model": request.app.state.provider.model_id, "mode": request.app.state.mode}


@router.post("/diagnoses", status_code=201, dependencies=[Depends(analyze_rate_limit)])
async def create_diagnosis(
    symptom_input: SymptomInput,
    cid: ClientId,
    service: Annotated[SymptomService, Depends(symptom_service)],
) -> DiagnosisRecord:
    return await service.check(cid, symptom_input)


@router.get("/history")
async def list_history(
    cid: ClientId, history: History, limit: Annotated[int, Query(ge=1, le=100)] = 50
) -> dict[str, list[DiagnosisRecord]]:
    return {"items": history.list(cid, limit)}


@router.get("/history/{record_id}")
async def get_history_item(record_id: str, cid: ClientId, history: History) -> DiagnosisRecord:
    record = history.get(cid, record_id)
    if record is None:
        raise NotFoundError("That submission was not found.")
    return record


@router.delete("/history")
async def clear_history(cid: ClientId, history: History) -> dict[str, int]:
    return {"deleted": history.clear(cid)}


@router.get("/cache/stats")
async def cache_stats(request: Request) -> dict[str, Any]:
    stats = asdict(request.app.state.cache.stats())
    return {"size": stats["size"], "maxEntries": stats["max_entries"], "hits": stats["hits"], "misses": stats["misses"]}


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
async def api_not_found(path: str) -> None:
    raise NotFoundError()
