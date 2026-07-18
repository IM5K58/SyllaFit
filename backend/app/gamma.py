"""γ — 실패 대비 폴백 트리.

경쟁률을 예측하지 않는다(PRD 9절). 사용자가 '이 과목 실패할까 걱정'이라고
위험도를 입력하면 → 실패 시 대체 계획을 조건부 트리로 자동 생성.

아키텍처(β와 동일 분리):
- 대체 후보의 시간 충돌 재검증 = 결정론(scheduling).
- 대체 우선순위·근거 = Solar.
"""
from . import cache_store, scheduling

MAX_ALTS_PER_SLOT = 10  # 슬롯당 Solar에 넘길 대체후보 상한


def _course_obj(key: str) -> dict:
    c = cache_store.get_course(key) or {}
    return {"key": key, "room_time": c.get("room_time", [])}


def feasible_replacements(risky_key: str, kept_keys: list[str]) -> list[str]:
    """risky_key 가 실패했을 때의 대체 = **같은 과목(같은 학수번호)의 다른 분반**.

    데이터베이스를 못 들으면 다른 교수/시간대의 데이터베이스를 들어야 정상이므로,
    완전 다른 과목이 아니라 동일 교과목의 다른 분반만 후보로 한다.
    남은 시간표(kept)와 충돌하지 않는 분반만 반환.
    """
    haksu_no = risky_key.rsplit("-", 1)[0]
    kept = [_course_obj(k) for k in kept_keys]
    out = []
    for c in cache_store.list_courses():
        if c["haksu_no"] != haksu_no or c["key"] == risky_key:
            continue
        cobj = {"key": c["key"], "room_time": c.get("room_time", [])}
        if any(scheduling.conflicts(cobj, k) for k in kept):
            continue
        out.append(c["key"])
    return out


def _brief(key: str) -> str:
    """결정론 대체 설명. 헤더가 교수·시간을 이미 보여주므로 중복 피함."""
    ext = (cache_store.get_syllabus(key) or {}).get("extracted") or {}
    parts = ["남은 시간표와 안 겹쳐요"]
    if ext.get("team_project"):
        parts.append("팀플 있음")
    elif ext.get("team_project") is None:
        pass  # 모름 — 단정하지 않음
    else:
        parts.append("팀플 없음")
    if isinstance(ext.get("assignment_count"), int):
        parts.append(f"과제 {ext['assignment_count']}개")
    return " · ".join(parts)


def _rank_alts(risky_key: str, alts: list[str], preference: str) -> list[dict]:
    """대체 분반 우선순위 — 결정론 (β와 같은 스코어 공식, Solar 없음 → 즉시·재현).

    preference 는 이미 rank 흐름에서 파싱됐을 수 있으나 여기선 독립 호출이므로
    소프트 조건 없이 '확인된 부담 낮은 순' 기본 기준으로 정렬한다.
    """
    if not alts:
        return []
    from . import beta  # 순환 import 방지를 위해 지역 import
    default_soft = {"avoid_team_project": False, "minimize_assignments": False,
                    "prefer_eval": None, "prefer_free_day": False}
    scored = []
    for k in alts[:MAX_ALTS_PER_SLOT]:
        s, _ = beta.score_combo([k], default_soft)
        scored.append((s, k))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [{"key": k, "rank": i + 1, "reason": _brief(k)}
            for i, (_, k) in enumerate(scored)]


def build_fallback_tree(timetable: list[str], risky: list[str],
                        preference: str = "") -> dict:
    """위험 과목별 폴백 체인을 담은 트리.

    각 위험 과목에 대해: kept = 시간표 - 그 과목. **같은 과목의 다른 분반** 중
    kept 와 충돌없는 것을 결정론으로 뽑고 Solar 로 우선순위 매김.
    """
    branches = []
    for risky_key in risky:
        kept = [k for k in timetable if k != risky_key]
        feas = feasible_replacements(risky_key, kept)
        chain = _rank_alts(risky_key, feas, preference) if feas else []
        # Solar 랭킹이 비어도 실제 대체가 있으면 결정론으로 채운다(놓치지 않게)
        if not chain and feas:
            chain = [{"key": k, "rank": i + 1, "reason": _brief(k)}
                     for i, k in enumerate(feas[:MAX_ALTS_PER_SLOT])]
        course = cache_store.get_course(risky_key) or {}
        branches.append({
            "risky": risky_key,
            "risky_name": course.get("kwamok_kname"),
            "kept": kept,
            "feasible_count": len(feas),
            "fallback_chain": chain,
            "note": None if feas else
                    "이 과목은 다른 분반이 없어요. 실패 시 다른 과목으로 대체해야 해요.",
        })
    return {"timetable": timetable, "branches": branches}
