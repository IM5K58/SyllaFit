"""FastAPI 백엔드 (v1, 무DB·무로그인).

무계정 전제 금지: 응답 모델에 나중에 user_id가 얹힐 자리를 남긴다 (v1.1 대비).
α/β/γ 모두 로그인 없이 동작. 저장·리뷰는 v1.1에서 로그인 게이트.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel

from . import advise, agent, alpha, backup, beta, cache_store, gamma, naver_search, qa, scheduling
from .cache_bootstrap import ensure_cache
from .config import settings
from .solar import SolarError


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_cache()  # 저장소에 캐시 없으면 Neon에서 받아옴 (공개 저장소 대응)
    yield


app = FastAPI(title="SyllaFit API", version="0.1.0", lifespan=lifespan)

# 응답 gzip 압축 — /courses(2.2MB) 같은 큰 JSON을 ~400KB로 줄여 초기 로딩 단축.
app.add_middleware(GZipMiddleware, minimum_size=1024)

# v1: 무로그인. 허용 오리진은 설정(config)에서 — 배포 도메인은 ALLOWED_ORIGINS env로.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "ok": True,
        "solar_ready": settings.solar_ready,
        "cache_collected_at": cache_store.collected_at(),
        "course_count": len(cache_store.list_courses()),
    }


@app.get("/courses")
def get_courses(dept: str | None = None):
    """캐시 과목 목록. dept로 개설전공 부분일치 필터."""
    return {
        "collected_at": cache_store.collected_at(),
        "courses": cache_store.list_courses(dept),
    }


@app.get("/courses/{key}")
def get_course(key: str):
    course = cache_store.get_course(key)
    if not course:
        raise HTTPException(404, f"과목 없음: {key}")
    return {"key": key, **course, "syllabus": cache_store.get_syllabus(key)}


class ExtractRequest(BaseModel):
    keys: list[str]
    # user_id: str | None = None  # v1.1 자리 (지금은 미사용)


@app.post("/syllabus/extract")
def extract_syllabi(req: ExtractRequest):
    """학수번호-분반 목록 → α 구조화 추출(+근거). 캐시 계획서를 입력으로 사용."""
    out = {}
    for key in req.keys:
        syl = cache_store.get_syllabus(key)
        if not syl:
            out[key] = {"error": "계획서 캐시 없음"}
            continue
        try:
            out[key] = alpha.extract(key, syl)
        except SolarError as e:
            raise HTTPException(503, f"Solar 오류: {e}")
    return {"extracted": out}


class AgentPlanRequest(BaseModel):
    profile: dict          # {major, grade, goal}
    timetable_summary: str = ""


@app.post("/agent/plan")
def agent_plan(req: AgentPlanRequest, x_internal_key: str | None = Header(default=None)):
    """학교생활 에이전트 — 프로필+시간표 → 웹검색 브리핑.

    로그인·일일제한은 프론트(Next 서버 라우트)가 담당. 이 엔드포인트는
    AGENT_INTERNAL_KEY 가 설정돼 있으면 그 키를 아는 호출만 허용(직접 호출 차단).
    """
    if settings.agent_internal_key and x_internal_key != settings.agent_internal_key:
        raise HTTPException(403, "forbidden")
    goal = str(req.profile.get("goal", ""))[:500]
    if not goal.strip():
        raise HTTPException(400, "목표·관심사를 입력해 주세요.")
    profile = {"major": str(req.profile.get("major", ""))[:50],
               "grade": str(req.profile.get("grade", ""))[:20], "goal": goal}
    try:
        return agent.run_agent(profile, req.timetable_summary[:300])
    except naver_search.NaverSearchError as e:
        raise HTTPException(503, f"검색 오류: {e}")
    except SolarError as e:
        raise HTTPException(503, f"Solar 오류: {e}")


class AdviseRequest(BaseModel):
    timetable: list[str]
    question: str


@app.post("/advise")
def advise_endpoint(req: AdviseRequest):
    """현재 시간표 맥락에서 '뭘 더 들을까' 질문 → 안 겹치는 과목 추천."""
    for key in req.timetable:
        if not cache_store.get_course(key):
            raise HTTPException(404, f"과목 없음: {key}")
    q = req.question.strip()
    if not q or len(q) > 200:
        raise HTTPException(400, "질문은 1~200자로 입력해 주세요.")
    try:
        return advise.advise(req.timetable, q)
    except SolarError as e:
        raise HTTPException(503, f"Solar 오류: {e}")


class AskRequest(BaseModel):
    key: str
    question: str


@app.post("/syllabus/ask")
def ask_syllabus(req: AskRequest):
    """계획서 원문에 대한 질문 → 근거 인용과 함께 답변."""
    if not cache_store.get_course(req.key):
        raise HTTPException(404, f"과목 없음: {req.key}")
    q = req.question.strip()
    if not q or len(q) > 200:
        raise HTTPException(400, "질문은 1~200자로 입력해 주세요.")
    try:
        return qa.ask(req.key, q)
    except SolarError as e:
        raise HTTPException(503, f"Solar 오류: {e}")


class RankRequest(BaseModel):
    candidates: list[str]
    preference: str
    size: int
    required: list[str] | None = None
    # user_id: str | None = None  # v1.1 자리


@app.post("/rank")
def rank_timetables(req: RankRequest):
    """후보 과목 + 자연어 선호 → 충돌없는 조합 생성(결정론) → Solar 랭킹(근거)."""
    courses = []
    for key in req.candidates:
        c = cache_store.get_course(key)
        if not c:
            raise HTTPException(404, f"과목 없음: {key}")
        courses.append({"key": key, "room_time": c.get("room_time", [])})

    combos = scheduling.generate_combinations(
        courses, size=req.size, required_keys=req.required
    )
    if not combos:
        return {"ranking": [], "combos_total": 0,
                "note": "충돌 없는 조합이 없습니다 (size/required 확인)."}
    try:
        return beta.rank(combos, req.preference)
    except SolarError as e:
        raise HTTPException(503, f"Solar 오류: {e}")


@app.get("/course-groups")
def course_groups(q: str | None = None):
    """과목(학수번호) 단위 목록 — 분반을 묶어 '과목명 = 여러 분반'으로 제공.

    AI 시간표: 사용자는 분반이 아니라 '들을 과목'을 고른다.
    """
    groups: dict[str, dict] = {}
    for c in cache_store.list_courses():
        hn = c["haksu_no"]
        g = groups.setdefault(hn, {
            "haksu_no": hn, "kwamok_kname": c["kwamok_kname"],
            "sections": 0, "profs": set(),
        })
        g["sections"] += 1
        if c.get("prof_name"):
            g["profs"].add(c["prof_name"])
    rows = [
        {"haksu_no": g["haksu_no"], "kwamok_kname": g["kwamok_kname"],
         "sections": g["sections"], "profs": sorted(g["profs"])}
        for g in groups.values()
    ]
    if q:
        ql = q.lower()
        rows = [r for r in rows
                if ql in r["kwamok_kname"].lower() or ql in r["haksu_no"].lower()
                or any(ql in p.lower() for p in r["profs"])]
    rows.sort(key=lambda r: r["kwamok_kname"])
    return {"count": len(rows), "groups": rows[:60]}


class AiTimetableRequest(BaseModel):
    courses: list[str]  # 학수번호(분반 없음) 리스트 — 들을 과목
    preference: str = ""
    # user_id: str | None = None  # v1.1 자리


@app.post("/ai-timetable")
def ai_timetable(req: AiTimetableRequest):
    """들을 과목(학수번호) → 각 과목의 분반 중 택1 → 충돌없는 시간표 → Solar 랭킹.

    사용자는 교수·시간을 고르지 않는다. AI가 계획서(α)·선호로 분반을 자동 선택.
    """
    all_courses = cache_store.list_courses()
    by_haksu: dict[str, list[dict]] = {}
    for c in all_courses:
        by_haksu.setdefault(c["haksu_no"], []).append(
            {"key": c["key"], "room_time": c.get("room_time", [])}
        )

    groups = []
    for hn in req.courses:
        sections = by_haksu.get(hn)
        if not sections:
            raise HTTPException(404, f"과목 없음: {hn}")
        groups.append(sections)

    combos = scheduling.generate_group_combinations(groups)
    if not combos:
        return {"ranking": [],
                "note": "선택한 과목을 시간 충돌 없이 모두 넣을 수 있는 조합이 없어요. "
                        "과목을 줄이거나 바꿔보세요."}
    try:
        result = beta.rank(combos, req.preference)
    except SolarError as e:
        raise HTTPException(503, f"Solar 오류: {e}")

    # 분반이 여럿인 과목에 대해 '왜 이 분반?' 결정론 근거 부착
    for item in result.get("ranking", []):
        picks = []
        for key in item.get("courses", []):
            hn = key.rsplit("-", 1)[0]
            siblings = [c["key"] for c in by_haksu.get(hn, [])]
            if len(siblings) > 1:
                picks.append({
                    "key": key,
                    "alt_count": len(siblings) - 1,
                    "why": beta.selection_reasons(key, siblings),
                })
        item["picks"] = picks
    return result


class FallbackRequest(BaseModel):
    timetable: list[str]
    risky: list[str]
    preference: str = ""
    # user_id: str | None = None  # v1.1 자리


@app.post("/fallback")
def fallback_tree(req: FallbackRequest):
    """시간표 + 위험 과목 → 실패 대비(같은 과목 다른 분반) 폴백 트리."""
    for key in req.timetable + req.risky:
        if not cache_store.get_course(key):
            raise HTTPException(404, f"과목 없음: {key}")
    for r in req.risky:
        if r not in req.timetable:
            raise HTTPException(400, f"위험 과목이 시간표에 없음: {r}")
    try:
        return gamma.build_fallback_tree(req.timetable, req.risky, req.preference)
    except SolarError as e:
        raise HTTPException(503, f"Solar 오류: {e}")


class BackupRequest(BaseModel):
    timetable: list[str]
    risky: list[str]


@app.post("/backup-timetables")
def backup_timetables(req: BackupRequest):
    """시간표 + 실패 예상 과목 → 그 과목만 대체 분반으로 바꾼 완성 대비 시간표들.

    결정론(Solar 없음). γ의 per-course 폴백과 달리 완성된 시간표 여러 개를 랭킹.
    """
    for key in req.timetable:
        if not cache_store.get_course(key):
            raise HTTPException(404, f"과목 없음: {key}")
    for r in req.risky:
        if r not in req.timetable:
            raise HTTPException(400, f"위험 과목이 시간표에 없음: {r}")
    return backup.build_backups(req.timetable, req.risky)
