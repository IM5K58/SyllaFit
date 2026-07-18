"""크롤러 산출 JSON 캐시 읽기·서빙 (읽기전용, 항상). DB와 절대 섞지 않음."""
import json
from functools import lru_cache

from .config import settings


# maxsize>=2: courses.json·syllabi.json 을 번갈아 조회해도 둘 다 캐시에 상주해야 함.
# (maxsize=1이면 서로 evict → 매 호출 JSON 재파싱, 캐시 커질수록 치명적)
@lru_cache(maxsize=4)
def _load(name: str) -> dict:
    path = settings.cache_dir / name
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def courses_meta() -> dict:
    """{collected_at, yearterm, courses:{key:course}}"""
    return _load("courses.json")


def syllabi_meta() -> dict:
    """{collected_at, yearterm, syllabi:{key:syllabus}}"""
    return _load("syllabi.json")


def list_courses(dept: str | None = None) -> list[dict]:
    data = courses_meta().get("courses", {})
    rows = []
    for key, c in data.items():
        if dept and dept not in (c.get("major") or ""):
            continue
        rows.append({"key": key, **c})
    return rows


def get_course(key: str) -> dict | None:
    return courses_meta().get("courses", {}).get(key)


def get_syllabus(key: str) -> dict | None:
    return syllabi_meta().get("syllabi", {}).get(key)


def collected_at() -> str | None:
    return courses_meta().get("collected_at")


def reload_cache() -> None:
    _load.cache_clear()
