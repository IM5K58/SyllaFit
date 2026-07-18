"""결정론 스케줄링 — 시간 충돌 검사 + 조합 생성 (에타 마법사가 하는 부분, 재활용).

β의 우위는 이 위의 Solar 랭킹이지 조합 생성 자체가 아니다(가이드 3.2).
조합 폭발은 상한(MAX_COMBOS)으로 CPU 보호.
"""
from itertools import combinations

MAX_COMBOS = 300  # 조합 폭발 상한 (CPU 보호, top-K 컷)


def _slots(course: dict) -> set[tuple[str, int]]:
    """course 의 room_time → {(요일, 교시)} 집합. 충돌 검사 단위."""
    out = set()
    for block in course.get("room_time", []):
        day = block.get("day")
        for p in block.get("periods", []):
            out.add((day, p))
    return out


def conflicts(a: dict, b: dict) -> bool:
    """두 과목이 같은 (요일,교시)를 공유하면 충돌."""
    return bool(_slots(a) & _slots(b))


def _pairwise_ok(chosen_slots: set, cand_slots: set) -> bool:
    return not (chosen_slots & cand_slots)


def generate_combinations(
    candidates: list[dict],
    size: int,
    required_keys: list[str] | None = None,
    max_combos: int = MAX_COMBOS,
) -> list[list[str]]:
    """충돌 없는 size개 조합을 생성 (key 리스트들의 리스트).

    required_keys 는 모든 조합에 반드시 포함. 상한 도달 시 조기 종료.
    course dict 는 'key' 와 'room_time' 을 가져야 함.
    """
    required_keys = required_keys or []
    by_key = {c["key"]: c for c in candidates}

    # 필수 과목끼리 충돌하면 해 없음
    req = [by_key[k] for k in required_keys if k in by_key]
    req_slots = set()
    for c in req:
        s = _slots(c)
        if req_slots & s:
            return []  # 필수끼리 충돌
        req_slots |= s

    pool = [c for c in candidates if c["key"] not in set(required_keys)]
    need = size - len(req)
    if need < 0:
        return []
    if need == 0:
        return [[c["key"] for c in req]] if req else []

    results: list[list[str]] = []
    pool_slots = [(_slots(c), c["key"]) for c in pool]

    def backtrack(start: int, chosen_slots: set, chosen_keys: list[str]):
        if len(results) >= max_combos:
            return
        if len(chosen_keys) == need:
            results.append([c["key"] for c in req] + chosen_keys)
            return
        for i in range(start, len(pool_slots)):
            slots, key = pool_slots[i]
            if _pairwise_ok(chosen_slots, slots):
                backtrack(i + 1, chosen_slots | slots, chosen_keys + [key])
                if len(results) >= max_combos:
                    return

    backtrack(0, set(req_slots), [])
    return results


def generate_group_combinations(
    groups: list[list[dict]],
    max_combos: int = MAX_COMBOS,
) -> list[list[str]]:
    """과목 그룹마다 분반 하나씩 골라 충돌 없는 시간표를 생성 (AI 시간표 핵심).

    groups: 과목별 분반 목록의 리스트. 예) [[DB-001, DB-002], [ALGO-001], ...]
    각 그룹에서 정확히 하나를 뽑아, 서로 충돌하지 않는 조합을 만든다.
    한 그룹의 모든 분반이 이미 고른 것들과 충돌하면 해가 없어 그 가지는 버려짐.
    상한(max_combos) 도달 시 조기 종료.
    """
    # 그룹을 분반 수가 적은 순으로 정렬하면 가지치기가 빨라짐(제약 강한 것 먼저)
    order = sorted(range(len(groups)), key=lambda i: len(groups[i]))
    ordered = [groups[i] for i in order]
    results: list[list[str]] = []

    def backtrack(gi: int, chosen_slots: set, chosen_keys: list[str]):
        if len(results) >= max_combos:
            return
        if gi == len(ordered):
            results.append(list(chosen_keys))
            return
        for cand in ordered[gi]:
            slots = _slots(cand)
            if not (chosen_slots & slots):
                chosen_keys.append(cand["key"])
                backtrack(gi + 1, chosen_slots | slots, chosen_keys)
                chosen_keys.pop()
                if len(results) >= max_combos:
                    return

    backtrack(0, set(), [])
    return results


def has_morning(course: dict, morning_max_period: int = 3) -> bool:
    """오전 수업 여부 — 교시 <= morning_max_period 가 있으면 True. (제약 판정용 보조)"""
    return any(p <= morning_max_period for (_d, p) in _slots(course))


EVENING_START_PERIOD = 19  # 18:00 (1교시=09:00, 30분 단위 → 19교시=18:00)
LUNCH_PERIODS = (7, 8)     # 12:00~13:00


def has_evening(course: dict, evening_start: int = EVENING_START_PERIOD) -> bool:
    """저녁(18시 이후) 수업 여부."""
    return any(p >= evening_start for (_d, p) in _slots(course))


def days_used(courses: list[dict]) -> set[str]:
    days = set()
    for c in courses:
        for (d, _p) in _slots(c):
            days.add(d)
    return days


def _day_period_map(courses: list[dict]) -> dict[str, dict[int, str]]:
    """요일 → {교시: 과목key}. 연강·점심 판정용."""
    m: dict[str, dict[int, str]] = {}
    for c in courses:
        for (d, p) in _slots(c):
            m.setdefault(d, {})[p] = c["key"]
    return m


def has_back_to_back(courses: list[dict]) -> bool:
    """서로 다른 과목이 쉬는 시간 없이 연달아 붙는 요일이 있는가 (연강)."""
    for pm in _day_period_map(courses).values():
        for p, key in pm.items():
            nxt = pm.get(p + 1)
            if nxt is not None and nxt != key:
                return True
    return False


def days_without_lunch(courses: list[dict]) -> list[str]:
    """점심(12~13시) 교시가 전부 수업으로 찬 요일 목록."""
    out = []
    for d, pm in _day_period_map(courses).items():
        if all(p in pm for p in LUNCH_PERIODS):
            out.append(d)
    return sorted(out)
