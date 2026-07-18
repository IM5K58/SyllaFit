"""AI 검토 — 현재 시간표 맥락에서 '뭘 더 들을까' 질문에 과목을 추천.

구조 (β와 동일 원칙):
- Solar #1: 질문 → 구조화 조건 (키워드/학점/교양여부/요일·시간대/부담)
- 결정론: 현재 시간표와 안 겹치는 과목만 + 조건 필터 + α기반 예비랭킹 → 상위 30
- Solar #2: 후보 30개의 '사실'만 주고 3~5개 추천 + 이유 (없는 정보 지어내기 금지)

이수구분: 목록페이지(Lec_Time_Search) 공식 데이터(교양필수/교양선택/전공… — 2026-07-18
확보). 단 핵심교양 '영역'(창의/사회 등) 구분은 여전히 없음 → note 로 정직 안내.
"""
from . import cache_store, scheduling
from .solar import chat_json

GE_GUBUN = ("교양필수", "교양선택")  # 공식 이수구분 기준
GE_PREFIXES = ("GEB", "GED")  # isu_gubun 없는 과목 대비 보조 휴리스틱
MAX_CANDIDATES = 30
WEEKDAYS = ["월", "화", "수", "목", "금"]

PARSE_SYSTEM = """너는 학생의 '어떤 과목을 더 들을까' 질문을 구조화한다.
반드시 아래 JSON 스키마로만 응답한다:
{
  "keyword": "<과목명에서 찾을 핵심 단어, 없으면 null>",
  "credit": <원하는 학점(정수)> | null,
  "general_edu": true | false,          // 교양 과목을 찾는가
  "days": ["월"~"금"] 중 원하는 요일 (없으면 []),
  "time_pref": "오전" | "오후" | "저녁" | null,
  "avoid_team": true | false,           // 팀플 없는 것을 원하는가
  "few_assignments": true | false       // 과제 적은 것을 원하는가
}
명시 안 된 건 null/false/[]. 추측 금지. '교양/창의/핵심교양' 언급 → general_edu=true."""

RECO_SYSTEM = """너는 대학생의 시간표 조언자다. 학생의 질문과, 이미 시간충돌 검사를
통과한 후보 과목들의 사실이 주어진다. 질문에 가장 맞는 과목을 3~5개 골라 추천한다.
주어진 사실만 근거로 삼고, 없는 정보(강의평/난이도 등)를 지어내지 마라.

반드시 아래 JSON 스키마로만 응답한다:
{
  "answer": "<한두 문장의 친근한 총평 (~해요체)>",
  "picks": [{"key": "<학수번호-분반>", "reason": "<사실 기반 추천 이유 한 줄>"}]
}
picks 는 추천 순. 후보 목록에 있는 key 만 사용하라."""


def _ext(key: str) -> dict:
    return (cache_store.get_syllabus(key) or {}).get("extracted") or {}


def _time_pref_ok(course: dict, pref: str | None) -> bool:
    if not pref:
        return True
    obj = {"key": course["key"], "room_time": course.get("room_time", [])}
    periods = [p for b in course.get("room_time", []) for p in b.get("periods", [])]
    if not periods:
        return False  # 온라인/미정은 시간대 조건에선 제외
    if pref == "오전":
        return scheduling.has_morning(obj)
    if pref == "저녁":
        return scheduling.has_evening(obj)
    if pref == "오후":
        return any(3 < p < scheduling.EVENING_START_PERIOD for p in periods)
    return True


def _prelim_score(key: str) -> int:
    """예비랭킹: 확인된 부담 낮은 순 (결정론)."""
    ext = _ext(key)
    s = 0
    if ext.get("team_project"):
        s -= 12
    ac = ext.get("assignment_count")
    if isinstance(ac, int):
        s -= 2 * ac
    return s


def _facts(key: str) -> str:
    c = cache_store.get_course(key) or {}
    ext = _ext(key)
    times = " ".join(f"{b['day']}{','.join(map(str, b['periods']))}"
                     for b in c.get("room_time", [])) or "온라인/미정"
    return (f"- {key} {c.get('kwamok_kname')} | {c.get('prof_name')} | "
            f"{c.get('credit')}학점 | {c.get('isu_gubun') or '구분미상'} | {times} | "
            f"팀플:{ext.get('team_project')} | 과제수:{ext.get('assignment_count')} | "
            f"평가:{c.get('pf_name')}")


def advise(timetable: list[str], question: str) -> dict:
    cond = chat_json(PARSE_SYSTEM, f"[질문]\n{question}")
    keyword = (cond.get("keyword") or "").strip() or None
    # 카테고리성 단어는 과목명 키워드가 아님 (과목명에 '교양'이 들어가진 않음)
    if keyword and any(w in keyword for w in ("교양", "창의", "핵심", "전공", "과목", "수업", "강의")):
        keyword = None
    credit = cond.get("credit") if isinstance(cond.get("credit"), (int, float)) else None
    days = [d for d in (cond.get("days") or []) if d in WEEKDAYS]
    time_pref = cond.get("time_pref") if cond.get("time_pref") in ("오전", "오후", "저녁") else None
    general = bool(cond.get("general_edu"))

    current = [{"key": k, "room_time": (cache_store.get_course(k) or {}).get("room_time", [])}
               for k in timetable]
    in_tt = {k.rsplit("-", 1)[0] for k in timetable}  # 같은 과목 중복 방지 (학수번호 기준)

    # 결정론 필터
    cands = []
    for c in cache_store.list_courses():
        if c["haksu_no"] in in_tt:
            continue
        if general:
            gub = c.get("isu_gubun")
            is_ge = gub in GE_GUBUN if gub else c["haksu_no"].startswith(GE_PREFIXES)
            if not is_ge:
                continue
        if keyword and keyword.lower() not in c["kwamok_kname"].lower():
            continue
        if credit and c.get("credit") != credit:
            continue
        if days:
            used = scheduling.days_used([{"key": c["key"], "room_time": c["room_time"]}])
            if not used or not used.issubset(set(days)):
                continue
        if not _time_pref_ok(c, time_pref):
            continue
        obj = {"key": c["key"], "room_time": c["room_time"]}
        if any(scheduling.conflicts(obj, cur) for cur in current):
            continue
        if cond.get("avoid_team") and _ext(c["key"]).get("team_project"):
            continue
        cands.append(c["key"])

    if not cands:
        return {"answer": "지금 시간표와 겹치지 않으면서 조건에 맞는 과목을 못 찾았어요. "
                          "조건을 조금 풀어서 다시 물어봐 주세요.",
                "suggestions": [], "note": None}

    cands.sort(key=lambda k: (-_prelim_score(k), k))
    top = cands[:MAX_CANDIDATES]

    user = (f"[학생 질문]\n{question}\n\n"
            f"[현재 시간표] {', '.join(timetable) or '(비어 있음)'}\n\n"
            f"[후보 과목 — 전부 현재 시간표와 안 겹침]\n"
            + "\n".join(_facts(k) for k in top))
    reco = chat_json(RECO_SYSTEM, user)

    valid = set(top)
    picks = [p for p in reco.get("picks", [])
             if isinstance(p, dict) and p.get("key") in valid][:5]

    note = None
    if general:
        note = ("교양 여부는 공식 이수구분(교양필수/교양선택) 기준이에요. "
                "핵심교양 '영역'(창의·사회 등) 구분은 포털에서 확인해 주세요.")

    return {"answer": reco.get("answer") or "추천을 만들지 못했어요.",
            "suggestions": picks, "note": note}
