"""γ 폴백 결정론 검증 (Solar 불필요). 실행: python backend/tests/test_gamma.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import cache_store, gamma, scheduling  # noqa: E402


def main():
    # 합성: 대체 후보 충돌 재검증
    A = {"key": "A", "room_time": [{"day": "월", "periods": [1, 2]}]}
    B = {"key": "B", "room_time": [{"day": "화", "periods": [1, 2]}]}  # kept
    X = {"key": "X", "room_time": [{"day": "화", "periods": [2, 3]}]}  # B와 충돌
    Y = {"key": "Y", "room_time": [{"day": "수", "periods": [1]}]}     # 충돌 없음
    store = {c["key"]: c for c in [A, B, X, Y]}
    original = cache_store.get_course
    cache_store.get_course = lambda k: store.get(k)  # 합성 주입
    try:
        # A가 실패, kept=[B], 후보=[X,Y] → Y만 feasible (X는 B와 충돌)
        feas = gamma.feasible_replacements("A", ["B"], ["X", "Y"])
        print("[feasible]", feas)
        assert feas == ["Y"], f"기대 [Y], 실제 {feas}"
        print("[대체 충돌 재검증] OK")

        # 이미 시간표에 있는 과목은 대체후보에서 제외
        feas2 = gamma.feasible_replacements("A", ["B"], ["B", "Y"])
        assert "B" not in feas2
        print("[시간표 내 과목 제외] OK", feas2)
    finally:
        cache_store.get_course = original  # 원복

    # 실제 캐시로 feasibility (충돌 없는 대체가 실제로 안 붙는지 재검증)
    real = [c["key"] for c in cache_store.list_courses()[:40]]
    timetable = real[:4]
    risky = [timetable[0]]
    kept = timetable[1:]
    feas3 = gamma.feasible_replacements(risky[0], kept, real)
    kept_objs = [{"key": k, "room_time": cache_store.get_course(k)["room_time"]} for k in kept]
    for cand in feas3[:50]:
        cobj = {"key": cand, "room_time": cache_store.get_course(cand)["room_time"]}
        for ko in kept_objs:
            assert not scheduling.conflicts(cobj, ko), f"충돌 대체 누출: {cand}"
    print(f"[실캐시 feasibility] risky={risky[0]}, kept={kept} → 대체 {len(feas3)}개, 전부 무충돌 OK")

    print("\nOK — γ 결정론 계층 통과")


if __name__ == "__main__":
    main()
