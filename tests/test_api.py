import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import SAMPLE_ANALYSIS, FakeProvider, make_settings

CLIENT = str(uuid.uuid4())


@pytest.fixture
def provider() -> FakeProvider:
    return FakeProvider(delay_seconds=0.1)


@pytest.fixture
def client(provider: FakeProvider) -> Iterator[TestClient]:
    app = create_app(make_settings(), provider=provider)
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


def post(client: TestClient, body: object, client_id: str = CLIENT):  # type: ignore[no-untyped-def]
    return client.post("/api/diagnoses", json=body, headers={"X-Client-Id": client_id})


def test_returns_potential_diagnoses(client: TestClient, provider: FakeProvider) -> None:
    res = post(client, {"symptoms": "Sore throat and fever since yesterday"})
    assert res.status_code == 201
    body = res.json()
    assert body["analysis"]["conditions"][0]["name"] == "Common cold"
    assert body["analysis"]["recognizedAsSymptoms"] is True  # camelCase on the wire
    assert body["meta"]["cached"] is False
    assert provider.calls[0].symptoms == "Sore throat and fever since yesterday"


@pytest.mark.parametrize("body", [{"symptoms": ""}, {}, {"symptoms": "    "}])
def test_rejects_empty_input_without_calling_the_model(
    client: TestClient, provider: FakeProvider, body: object
) -> None:
    res = post(client, body)
    assert res.status_code == 400
    assert res.json()["error"] == {"code": "VALIDATION_ERROR", "message": "Please describe your symptoms."}
    assert provider.calls == []


def test_rejects_input_below_minimum_length(client: TestClient) -> None:
    res = post(client, {"symptoms": "cough"})
    assert res.status_code == 400
    assert "at least 10 characters" in res.json()["error"]["message"]


def test_rejects_malformed_json_and_missing_client_id(client: TestClient) -> None:
    bad = client.post(
        "/api/diagnoses",
        content="{not json",
        headers={"X-Client-Id": CLIENT, "Content-Type": "application/json"},
    )
    assert bad.status_code == 400
    assert bad.json()["error"]["code"] == "BAD_REQUEST"
    missing = client.post("/api/diagnoses", json={"symptoms": "sore throat and fever"})
    assert missing.status_code == 400
    assert "X-Client-Id" in missing.json()["error"]["message"]


def test_repeat_query_is_cached_and_faster(client: TestClient, provider: FakeProvider) -> None:
    first = post(client, {"symptoms": "sore throat and fever"}).json()
    second = post(client, {"symptoms": "Sore throat and fever."}).json()
    assert second["meta"]["cached"] is True
    assert second["meta"]["latencyMs"] < first["meta"]["latencyMs"]
    assert len(provider.calls) == 1
    assert client.get("/api/cache/stats").json()["hits"] == 1


def test_history_is_newest_first_and_scoped_to_client(client: TestClient) -> None:
    a = post(client, {"symptoms": "sore throat and fever"}).json()
    b = post(client, {"symptoms": "headache for three days"}).json()
    post(client, {"symptoms": "someone else's back pain"}, client_id=str(uuid.uuid4()))

    items = client.get("/api/history", headers={"X-Client-Id": CLIENT}).json()["items"]
    assert [i["id"] for i in items] == [b["id"], a["id"]]
    assert items[1]["input"]["symptoms"] == "sore throat and fever"
    assert items[1]["analysis"]["summary"] == SAMPLE_ANALYSIS.summary

    assert client.get(f"/api/history/{a['id']}", headers={"X-Client-Id": CLIENT}).status_code == 200
    other = client.get(f"/api/history/{a['id']}", headers={"X-Client-Id": str(uuid.uuid4())})
    assert other.status_code == 404


def test_clear_history(client: TestClient) -> None:
    post(client, {"symptoms": "sore throat and fever"})
    assert client.delete("/api/history", headers={"X-Client-Id": CLIENT}).json() == {"deleted": 1}
    assert client.get("/api/history", headers={"X-Client-Id": CLIENT}).json() == {"items": []}


def test_returns_422_when_model_finds_no_symptoms(client: TestClient, provider: FakeProvider) -> None:
    provider.result = SAMPLE_ANALYSIS.model_copy(update={"recognized_as_symptoms": False, "conditions": []})
    res = post(client, {"symptoms": "please write me a poem"})
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "UNRECOGNIZED_SYMPTOMS"


def test_hides_unexpected_internal_errors(client: TestClient, provider: FakeProvider) -> None:
    provider.result = RuntimeError("database password is hunter2")
    res = post(client, {"symptoms": "sore throat and fever"})
    assert res.status_code == 500
    assert res.json()["error"]["code"] == "INTERNAL_ERROR"
    assert "hunter2" not in res.text


def test_rate_limits_the_analysis_endpoint(provider: FakeProvider) -> None:
    app = create_app(make_settings(rate_limit_per_minute=2), provider=provider)
    with TestClient(app) as client:
        assert post(client, {"symptoms": "sore throat and fever"}).status_code == 201
        assert post(client, {"symptoms": "sore throat and fever"}).status_code == 201
        limited = post(client, {"symptoms": "sore throat and fever"})
    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "RATE_LIMITED"
    assert "Retry-After" in limited.headers


def test_serves_ui_with_security_headers_and_json_404s(client: TestClient) -> None:
    page = client.get("/")
    assert page.status_code == 200
    assert "text/html" in page.headers["content-type"]
    assert "default-src 'self'" in page.headers["content-security-policy"]
    missing = client.get("/api/nope")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "NOT_FOUND"
