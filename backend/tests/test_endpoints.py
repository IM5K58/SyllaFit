"""결정론 계층 검증 (Solar 불필요). 실행: python backend/tests/test_endpoints.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)


def main():
    r = client.get("/health")
    print("[health]", r.status_code, r.json())
    assert r.status_code == 200 and r.json()["course_count"] > 0

    r = client.get("/courses")
    courses = r.json()["courses"]
    print("[courses]", r.status_code, "count:", len(courses))
    assert r.status_code == 200 and courses

    key = courses[0]["key"]
    r = client.get(f"/courses/{key}")
    body = r.json()
    print("[course detail]", r.status_code, key, body["kwamok_kname"],
          "| syllabus.share:", body["syllabus"]["share"])
    assert r.status_code == 200 and body["syllabus"]

    r = client.get("/courses/NOPE-999")
    print("[404 check]", r.status_code)
    assert r.status_code == 404

    # extract 는 Solar 필요 — 키 없으면 503 이 정상
    r = client.post("/syllabus/extract", json={"keys": [key]})
    print("[extract w/o key]", r.status_code,
          str(r.json())[:120])
    assert r.status_code in (200, 503)

    print("\nOK — 결정론 계층 전부 통과")


if __name__ == "__main__":
    main()
