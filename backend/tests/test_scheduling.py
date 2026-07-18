"""결정론 스케줄링 검증 (Solar 불필요). 실행: python backend/tests/test_scheduling.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import cache_store, scheduling  # noqa: E402


def main():
    # 합성 케이스: 충돌 검사 정확성
    A = {"key": "A", "room_time": [{"day": "월", "periods": [1, 2, 3]}]}
    B = {"key": "B", "room_time": [{"day": "월", "periods": [3, 4]}]}  # A와 3교시 겹침
    C = {"key": "C", "room_time": [{"day": "화", "periods": [1, 2]}]}  # 안 겹침
    assert scheduling.conflicts(A, B) is True, "월3 겹침 감지 실패"
    assert scheduling.conflicts(A, C) is False, "다른 요일 오탐"
    print("[충돌검사] OK")

    combos = scheduling.generate_combinations([A, B, C], size=2)
    combo_sets = {frozenset(x) for x in combos}
    print("[조합 size=2]", combos)
    assert frozenset({"A", "C"}) in combo_sets
    assert frozenset({"B", "C"}) in combo_sets
    assert frozenset({"A", "B"}) not in combo_sets, "충돌 조합이 생성됨"
    print("[조합 충돌배제] OK")

    # required 포함
    combos_req = scheduling.generate_combinations([A, B, C], size=2, required_keys=["A"])
    assert all("A" in x for x in combos_req)
    assert all(set(x) != {"A", "B"} for x in combos_req)
    print("[required 포함]", combos_req, "OK")

    # 실제 캐시로 조합 생성 (충돌 없는 실데이터 조합이 나오는지)
    real = cache_store.list_courses()[:12]
    real_courses = [{"key": c["key"], "room_time": c["room_time"]} for c in real]
    combos_real = scheduling.generate_combinations(real_courses, size=3)
    print(f"[실캐시 12과목 중 3개조합] {len(combos_real)}개 생성 (예: {combos_real[:2]})")
    # 각 조합이 실제로 충돌 없는지 재검증
    for combo in combos_real[:50]:
        cs = [next(c for c in real_courses if c["key"] == k) for k in combo]
        for i in range(len(cs)):
            for j in range(i + 1, len(cs)):
                assert not scheduling.conflicts(cs[i], cs[j]), f"충돌 조합 누출: {combo}"
    print("[실캐시 조합 무충돌 재검증] OK")

    print("\nOK — 스케줄링 결정론 계층 전부 통과")


if __name__ == "__main__":
    main()
