"""실패 대비 시간표 — 위험 과목을 같은 과목 다른 분반으로 교체한 '완성 시간표' 여러 개.

γ(gamma)의 per-course 폴백 체인과 달리, 여기서는 **완성된 대비 시간표**를 만든다.
사용자가 '이 과목들 신청 실패할 것 같다'고 고르면, 그 과목들만 대체 분반으로 바꾼
시간표들을 결정론으로 조합·랭킹한다. (경쟁률 예측 안 함 — PRD 9절)

전부 결정론(Solar 호출 0 → 즉시·재현). 랭킹은 β와 같은 점수 공식.
"""
from . import beta, cache_store, gamma, scheduling

MAX_RESULTS = 8
MAX_ALTS_PER_COURSE = 12  # 위험과목당 조합에 넣을 대체 분반 상한(조합 폭발 방지)
DEFAULT_SOFT = {"avoid_team_project": False, "minimize_assignments": False,
                "prefer_eval": None, "prefer_free_day": False}


def _obj(key: str) -> dict:
    c = cache_store.get_course(key) or {}
    return {"key": key, "room_time": c.get("room_time", [])}


def _name(key: str) -> str:
    return (cache_store.get_course(key) or {}).get("kwamok_kname") or key


def build_backups(timetable: list[str], risky: list[str]) -> dict:
    """timetable 중 risky 과목만 대체 분반으로 바꾼 완성 시간표들(결정론 랭킹)."""
    risky = [r for r in risky if r in timetable]
    if not risky:
        return {"backups": [], "no_alternative": [], "risky": [], "kept": timetable,
                "note": "실패할 것 같은 과목을 하나 이상 선택해 주세요."}

    kept = [k for k in timetable if k not in risky]

    # 그룹 조합: 고정 과목(kept)은 1개짜리 그룹, 위험 과목은 대체 분반 그룹
    groups = [[_obj(k)] for k in kept]
    no_alt = []
    for r in risky:
        alts = gamma.feasible_replacements(r, kept)  # 같은 과목·다른 분반·kept와 안 겹침
        if alts:
            # 부담 낮은 순으로 정렬 후 상한 — 좋은 대체가 조합 컷오프에 안 잘리게
            alts = sorted(alts, key=lambda a: (-beta.score_combo([a], DEFAULT_SOFT)[0], a))
            groups.append([_obj(a) for a in alts[:MAX_ALTS_PER_COURSE]])
        else:
            no_alt.append(r)
            groups.append([_obj(r)])  # 대체 불가 — 원본 유지(표시용), note로 정직 안내

    combos = scheduling.generate_group_combinations(groups)
    # 원본과 완전히 같은 조합은 대비책이 아니므로 제외 (전부 no_alt면 어쩔 수 없이 유지)
    orig = set(timetable)
    filtered = [c for c in combos if set(c) != orig]
    combos = filtered or combos

    note = None
    if not combos:
        return {"backups": [], "no_alternative": no_alt, "risky": risky, "kept": kept,
                "note": "선택한 과목들을 동시에 대체할 수 있는 조합이 없어요. "
                        "위험 과목을 줄이거나 다른 조합으로 시도해 보세요."}

    scored = []
    for combo in combos:
        s, reasons = beta.score_combo(combo, DEFAULT_SOFT)
        scored.append((s, combo, reasons))
    scored.sort(key=lambda x: (-x[0], x[1]))  # 동점은 키순 → 완전 재현

    backups = []
    for i, (s, combo, reasons) in enumerate(scored[:MAX_RESULTS]):
        # 어떤 위험 과목이 어떤 분반으로 바뀌었는지
        swaps = []
        for r in risky:
            hn = r.rsplit("-", 1)[0]
            newk = next((k for k in combo if k.rsplit("-", 1)[0] == hn), None)
            if newk and newk != r:
                swaps.append({"from": r, "from_name": _name(r),
                              "to": newk, "to_name": _name(newk)})
        backups.append({"combo_id": i, "rank": i + 1, "score": s,
                        "courses": combo, "reasons": reasons, "swaps": swaps})

    if no_alt:
        names = ", ".join(_name(r) for r in no_alt)
        note = (f"{names}은(는) 다른 분반이 없어 대체할 수 없어요. "
                "실패 시 이 과목은 다른 과목으로 바꿔야 해요.")

    return {"backups": backups, "no_alternative": no_alt,
            "risky": risky, "kept": kept, "note": note}
