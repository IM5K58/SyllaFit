"""β — 자연어 선호 랭킹.

역할 분리 (결과 안정화 개편, 2026-07-17):
- **Solar = 자연어 해석만.** 선호 문장 → 구조화 플래그(하드+소프트) 1회 호출.
- **점수·순위·근거 = 전부 결정론 공식.** α값(팀플/과제/평가) 기반이라
  같은 입력이면 항상 같은 결과. Solar 점수의 실행 간 흔들림 제거.
- 조합 생성·충돌검사·하드필터(오전/요일/공강) = scheduling(결정론, 기존 유지).

흐름: ① Solar 파싱(1회) → ② 결정론 하드필터 → ③ 결정론 스코어링·근거 생성.
"""
from . import cache_store, scheduling
from .solar import chat_json

MAX_RESULTS = 10  # 응답에 담을 상위 시간표 수
WEEKDAYS = ["월", "화", "수", "목", "금"]

# ── ① 선호 → 구조화 제약 (Solar, 유일한 LLM 호출) ─────────────
PARSE_SYSTEM = """너는 학생의 자연어 시간표 선호를 구조화된 조건으로 변환한다.
반드시 아래 JSON 스키마로만 응답한다:
{
  "avoid_morning": true | false,           // 오전 수업을 피하고 싶은가
  "avoid_evening": true | false,           // 저녁(18시 이후) 수업을 피하고 싶은가
  "avoid_days": ["월","화","수","목","금"] 중 회피 요일 (없으면 []),
  "require_free_day": true | false,         // 공강(수업 없는 평일)을 반드시 원하는가
  "max_days": <정수> | null,                // "주 3일만 등교/학교" → 3. 언급 없으면 null
  "avoid_consecutive": true | false,        // 연강(쉬는 시간 없이 이어지는 수업) 회피
  "lunch_break": true | false,              // 점심시간(12~13시) 확보 요청
  "soft": {
    "avoid_team_project": true | false,     // 팀플 적은/없는 것 선호
    "minimize_assignments": true | false,   // 과제 적은 것 선호
    "prefer_eval": "절대평가" | "상대평가" | "Pass/Fail" | null,  // 평가방식 선호
    "prefer_free_day": true | false         // 공강 있으면 좋음(필수는 아님)
  },
  "unmatched": "<위 조건들로 표현할 수 없는 요청이 있으면 그 내용, 없으면 null>"
}
규칙:
- 명시되지 않은 조건은 false/null 로 둔다. 추측으로 켜지 마라.
- '교수님이 좋은/유명한/꿀강' 같은 평판 요청은 우리 데이터에 없다 → unmatched 에 적어라.
- 시간표 조건으로 해석 가능한 것만 위 플래그로 매핑한다."""


def parse_constraints(preference: str) -> dict:
    raw = chat_json(PARSE_SYSTEM, f"[학생 선호]\n{preference}")
    soft_raw = raw.get("soft") or {}
    if not isinstance(soft_raw, dict):
        soft_raw = {}
    eval_pref = soft_raw.get("prefer_eval")
    if eval_pref not in ("절대평가", "상대평가", "Pass/Fail"):
        eval_pref = None
    max_days = raw.get("max_days")
    if not (isinstance(max_days, int) and 1 <= max_days <= 5):
        max_days = None
    return {
        "avoid_morning": bool(raw.get("avoid_morning")),
        "avoid_evening": bool(raw.get("avoid_evening")),
        "avoid_days": [d for d in raw.get("avoid_days", []) if d in WEEKDAYS],
        "require_free_day": bool(raw.get("require_free_day")),
        "max_days": max_days,
        "avoid_consecutive": bool(raw.get("avoid_consecutive")),
        "lunch_break": bool(raw.get("lunch_break")),
        "soft": {
            "avoid_team_project": bool(soft_raw.get("avoid_team_project")),
            "minimize_assignments": bool(soft_raw.get("minimize_assignments")),
            "prefer_eval": eval_pref,
            "prefer_free_day": bool(soft_raw.get("prefer_free_day")),
        },
        "unmatched": raw.get("unmatched") or None,
    }


# ── ② 결정론 하드 필터 ────────────────────────────────────────
def _combo_courses(keys: list[str]) -> list[dict]:
    out = []
    for k in keys:
        c = cache_store.get_course(k) or {}
        out.append({"key": k, "room_time": c.get("room_time", [])})
    return out


def hard_violations(keys: list[str], cons: dict) -> list[str]:
    """조합이 하드 제약을 어긴 항목들 (결정론). 빈 리스트면 통과."""
    courses = _combo_courses(keys)
    v = []
    if cons["avoid_morning"]:
        morning = [c["key"] for c in courses if scheduling.has_morning(c)]
        if morning:
            v.append(f"오전 수업 포함: {', '.join(morning)}")
    if cons["avoid_days"]:
        used = scheduling.days_used(courses)
        hit = sorted(set(cons["avoid_days"]) & used)
        if hit:
            v.append(f"회피 요일 사용: {', '.join(hit)}")
    if cons["require_free_day"]:
        used = scheduling.days_used(courses)
        if not (set(WEEKDAYS) - used):
            v.append("공강 없음(월~금 모두 수업)")
    if cons["avoid_evening"]:
        ev = [c["key"] for c in courses if scheduling.has_evening(c)]
        if ev:
            v.append(f"저녁(18시 이후) 수업 포함: {', '.join(ev)}")
    if cons["max_days"]:
        used = scheduling.days_used(courses)
        if len(used) > cons["max_days"]:
            v.append(f"등교 {len(used)}일 (목표: 주 {cons['max_days']}일)")
    if cons["avoid_consecutive"] and scheduling.has_back_to_back(courses):
        v.append("연강 있음 (쉬는 시간 없이 이어지는 수업)")
    if cons["lunch_break"]:
        nl = scheduling.days_without_lunch(courses)
        if nl:
            v.append(f"점심시간(12~13시) 없는 요일: {', '.join(nl)}")
    return v


def _ext(key: str) -> dict:
    return (cache_store.get_syllabus(key) or {}).get("extracted") or {}


# ── ③ 결정론 스코어링 (Solar 없음 — 재현성 보장) ─────────────
def score_combo(keys: list[str], soft: dict) -> tuple[int, list[str]]:
    """조합 점수(0~100)와 근거를 α값 기반 공식으로 계산.

    같은 입력 = 항상 같은 점수. '모름(null)'은 감점하지 않되 근거에 명시
    ('없음'과 '모름'을 구분 — 정보 없는 과목이 부당하게 유리해지는 건 감수하고 공개).
    """
    score = 100
    reasons: list[str] = []

    names = {k: (cache_store.get_course(k) or {}).get("kwamok_kname", k) for k in keys}
    exts = {k: _ext(k) for k in keys}

    # 팀플
    tp_courses = [names[k] for k in keys if exts[k].get("team_project")]
    tp_unknown = [names[k] for k in keys if exts[k].get("team_project") is None]
    if soft["avoid_team_project"]:
        score -= 12 * len(tp_courses)
        if tp_courses:
            reasons.append(f"팀플 있는 과목 {len(tp_courses)}개: {', '.join(tp_courses)}")
        else:
            reasons.append("확인된 팀플 과목 없음")
        if tp_unknown:
            reasons.append(f"팀플 정보 미기재 {len(tp_unknown)}과목 (계획서에 언급 없음)")

    # 과제
    known_counts = [(names[k], exts[k]["assignment_count"]) for k in keys
                    if isinstance(exts[k].get("assignment_count"), int)]
    a_unknown = [names[k] for k in keys if exts[k].get("assignment_count") is None]
    if soft["minimize_assignments"]:
        total = sum(c for _, c in known_counts)
        score -= min(2 * total, 30)
        if known_counts:
            detail = ", ".join(f"{n} {c}개" for n, c in known_counts)
            reasons.append(f"확인된 과제 합계 {total}개 ({detail})")
        if a_unknown:
            reasons.append(f"과제 정보 미기재 {len(a_unknown)}과목 (계획서에 과제 표기 없음)")

    # 평가방식
    if soft["prefer_eval"]:
        mismatch = [names[k] for k in keys
                    if (cache_store.get_course(k) or {}).get("pf_name")
                    and (cache_store.get_course(k) or {}).get("pf_name") != soft["prefer_eval"]]
        score -= 6 * len(mismatch)
        if mismatch:
            reasons.append(f"{soft['prefer_eval']} 아닌 과목 {len(mismatch)}개: {', '.join(mismatch)}")
        else:
            reasons.append(f"전 과목 {soft['prefer_eval']}")

    # 공강 (소프트 보너스)
    free = sorted(set(WEEKDAYS) - scheduling.days_used(_combo_courses(keys)))
    if soft["prefer_free_day"]:
        score += 8 * len(free)
    if free:
        reasons.append(f"공강: {', '.join(free)}요일")

    # 아무 소프트 조건도 없을 때의 기본 기준: 확인된 부담(팀플+과제)이 적은 순
    if not any([soft["avoid_team_project"], soft["minimize_assignments"],
                soft["prefer_eval"], soft["prefer_free_day"]]):
        burden = 12 * len(tp_courses) + 2 * sum(c for _, c in known_counts)
        score -= min(burden, 40)
        parts = []
        if tp_courses:
            parts.append(f"팀플 {len(tp_courses)}과목")
        if known_counts:
            parts.append(f"확인된 과제 {sum(c for _, c in known_counts)}개")
        reasons.append("기본 기준(확인된 부담 낮은 순): " + (", ".join(parts) or "확인된 부담 없음"))

    return max(0, min(100, score)), reasons


def selection_reasons(picked_key: str, sibling_keys: list[str]) -> list[str]:
    """고른 분반이 같은 과목의 다른 분반들보다 나은 점 (결정론, 사실 기반).

    '오전 없음/과제 적음/팀플 없음'은 실제로 대안 중 그렇지 않은 게 있을 때만 주장.
    """
    others = [k for k in sibling_keys if k != picked_key]
    if not others:
        return []
    pc = cache_store.get_course(picked_key) or {}
    pext = _ext(picked_key)
    reasons: list[str] = []

    # 오전: 고른 건 오전 없는데, 오전 있는 대안이 존재하면
    picked_morning = scheduling.has_morning({"key": picked_key, "room_time": pc.get("room_time", [])})
    alt_morning = any(
        scheduling.has_morning({"key": k, "room_time": (cache_store.get_course(k) or {}).get("room_time", [])})
        for k in others
    )
    if not picked_morning and alt_morning:
        reasons.append("오전 수업 없는 분반")

    # 과제: 고른 게 대안보다 적으면
    pa = pext.get("assignment_count")
    alt_a = [_ext(k).get("assignment_count") for k in others]
    alt_a = [a for a in alt_a if isinstance(a, int)]
    if isinstance(pa, int) and alt_a and pa < max(alt_a):
        reasons.append(f"과제 적은 분반 (과제 {pa}개)")

    # 팀플: 고른 건 팀플 없는데, 팀플 있는 대안이 존재하면
    if not pext.get("team_project") and any(_ext(k).get("team_project") for k in others):
        reasons.append("팀플 없는 분반")

    return reasons


def _understood(cons: dict) -> str:
    """파싱된 조건을 사람이 읽을 문장으로 (결정론)."""
    parts = []
    if cons["avoid_morning"]:
        parts.append("오전 회피")
    if cons["avoid_evening"]:
        parts.append("저녁 회피")
    if cons["avoid_days"]:
        parts.append(f"{'·'.join(cons['avoid_days'])}요일 회피")
    if cons["require_free_day"]:
        parts.append("공강 필수")
    if cons["max_days"]:
        parts.append(f"주 {cons['max_days']}일 등교")
    if cons["avoid_consecutive"]:
        parts.append("연강 회피")
    if cons["lunch_break"]:
        parts.append("점심시간 확보")
    s = cons["soft"]
    if s["avoid_team_project"]:
        parts.append("팀플 적게")
    if s["minimize_assignments"]:
        parts.append("과제 적게")
    if s["prefer_eval"]:
        parts.append(f"{s['prefer_eval']} 선호")
    if s["prefer_free_day"] and not cons["require_free_day"]:
        parts.append("공강 있으면 좋음")
    return " · ".join(parts) if parts else "특별한 조건 없음 — 확인된 부담(팀플·과제) 낮은 순으로 정렬"


# ── 통합 진입점 ───────────────────────────────────────────────
def rank(combos: list[list[str]], preference: str) -> dict:
    if not combos:
        return {"ranking": [], "note": "충돌 없는 조합이 없습니다."}

    cons = parse_constraints(preference)  # 유일한 Solar 호출

    # 결정론 하드 필터
    passing = [c for c in combos if not hard_violations(c, cons)]
    hard_filtered = len(combos) - len(passing)

    note = None
    if not passing:
        passing = sorted(combos, key=lambda c: len(hard_violations(c, cons)))[:MAX_RESULTS]
        note = "조건을 모두 만족하는 조합이 없어, 위반이 가장 적은 조합을 제시합니다."

    # 결정론 스코어링 — 전 조합 평가 후 상위 N (샘플링 불필요, 비용 0)
    scored = []
    for combo in passing:
        s, reasons = score_combo(combo, cons["soft"])
        scored.append((s, combo, reasons))
    # 동점은 과목키 순으로 고정 정렬 → 완전한 재현성
    scored.sort(key=lambda x: (-x[0], x[1]))

    ranking = []
    for i, (s, combo, reasons) in enumerate(scored[:MAX_RESULTS]):
        ranking.append({
            "combo_id": i,
            "rank": i + 1,
            "score": s,
            "reasons": reasons,
            "courses": combo,
            "hard_violations": hard_violations(combo, cons),
        })

    understood = _understood(cons)
    if cons.get("unmatched"):
        note_un = (f"“{cons['unmatched']}” 조건은 강의평 데이터가 없어 반영하지 못했어요. "
                   "SyllaFit은 계획서에서 확인되는 사실(시간·팀플·과제·평가방식)로만 추천해요.")
        note = f"{note} {note_un}" if note else note_un

    result = {
        "ranking": ranking,
        "preference_understood": understood,
        "constraints": cons,
        "hard_filtered_out": hard_filtered,
        "combos_total": len(combos),
        "combos_considered": len(passing),
    }
    if note:
        result["note"] = note
    return result
