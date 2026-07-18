"""β 랭킹 검증 (Solar 키 필요). 실행: python backend/tests/test_beta_real.py

결정론 조합 생성은 test_scheduling.py 에서 이미 검증. 여기선 Solar 랭킹 품질 확인:
- 자연어 선호("오전 회피, 팀플 없는 것 우선")를 해석해 순위·근거를 내는지
- 근거가 과목 사실(시간/팀플/부하)을 실제로 인용하는지
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import beta, cache_store, scheduling  # noqa: E402
from app.config import settings  # noqa: E402
from app.solar import SolarError  # noqa: E402


def main():
    if not settings.solar_ready:
        print("SOLAR_API_KEY 미설정 — backend/.env 채운 뒤 재실행.")
        sys.exit(1)

    # 실캐시에서 후보 12과목 → 3과목 조합
    cand = cache_store.list_courses()[:12]
    courses = [{"key": c["key"], "room_time": c["room_time"]} for c in cand]
    combos = scheduling.generate_combinations(courses, size=3)
    print(f"후보 {len(courses)}과목 → 충돌없는 3과목 조합 {len(combos)}개")

    preference = "오전 수업은 피하고 싶고, 과제 부담 적은 조합을 우선해줘"
    print(f"선호: {preference}\n")
    try:
        result = beta.rank(combos, preference)
    except SolarError as e:
        print("SolarError:", e)
        sys.exit(1)

    print("해석된 선호:", result.get("preference_understood"))
    print(f"고려 조합 {result.get('combos_considered')}/{result.get('combos_total')}\n")
    for item in result.get("ranking", [])[:5]:
        print(f"[{item.get('rank')}위] score={item.get('score')} 조합={item.get('courses')}")
        for r in item.get("reasons", []):
            print(f"    - {r}")
        for v in item.get("violations", []):
            print(f"    ✗ {v}")


if __name__ == "__main__":
    main()
