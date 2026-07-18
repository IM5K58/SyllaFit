"""α 추출을 실제 캐시 계획서로 검증 (Solar 키 필요).

실행: (backend/.env 에 SOLAR_API_KEY 넣은 뒤)
    python backend/tests/test_alpha_real.py

검증 포인트 (실데이터 기반 기대값):
- BNF1904-001: share_detail 에 "4-5명으로 팀을 구성하여 시각화 프로젝트" → team_project=True 여야 함.
- 모든 결과는 evidence(원문 근거) 동반, flagged_no_evidence 는 비어야 이상적.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import alpha, cache_store  # noqa: E402
from app.config import settings  # noqa: E402
from app.solar import SolarError  # noqa: E402


def _pick_cases(n=3):
    """현재 캐시에서 자유텍스트가 풍부한(=α가 판단할 게 있는) 과목 우선 선택.

    특정 학수번호를 하드코딩하지 않는다(크롤 학기가 바뀌어도 동작).
    """
    scored = []
    for c in cache_store.list_courses():
        syl = cache_store.get_syllabus(c["key"]) or {}
        blob = " ".join([syl.get("ing_method", ""), syl.get("share_detail", ""),
                         syl.get("notice", "")] +
                        [w.get("report", "") + w.get("content", "")
                         for w in syl.get("weeks", [])])
        scored.append((len(blob), c["key"], c["kwamok_kname"]))
    scored.sort(reverse=True)
    return [(k, name) for _, k, name in scored[:n]]


def main():
    if not settings.solar_ready:
        print("SOLAR_API_KEY 미설정 — backend/.env 채운 뒤 재실행.")
        print(f"  (base_url={settings.solar_base_url}, model={settings.solar_model})")
        sys.exit(1)

    cases = _pick_cases()
    if not cases:
        print("캐시에 과목 없음 — 먼저 크롤+build_cache 실행.")
        sys.exit(1)

    for key, name in cases:
        syl = cache_store.get_syllabus(key)
        print(f"\n=== {key} {name} ===")
        try:
            result = alpha.extract(key, syl)
        except SolarError as e:
            print("  SolarError:", e)
            continue
        print(json.dumps(result, ensure_ascii=False, indent=2))
        if result["flagged_no_evidence"]:
            print("  ⚠️ 근거 없는 값:", result["flagged_no_evidence"])


if __name__ == "__main__":
    main()
