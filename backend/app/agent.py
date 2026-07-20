"""학교생활 에이전트 — 프로필+시간표 기반 웹검색 브리핑.

구조 (클로드식 검색 루프의 미니어처):
  ① Solar function calling: web_search 도구를 스스로 호출 (병렬 지원, 최대 ROUNDS라운드)
  ② 검색 실행 = Naver (naver_search.multi_search)
  ③ 최종 합성: 수집된 결과만 근거로 카테고리별 추천 JSON (response_format 강제)
  ④ 출처 가드: 각 항목의 src(출처 번호)가 실제 수집 결과에 없으면 그 항목 폐기

정직 원칙: 날짜는 검색 스니펫에 있는 것만 date_text로 전달("출처 확인" 라벨용).
합성 근거가 0건이면 빈 결과와 함께 정직하게 알린다.
"""
import json
import re
from datetime import datetime, timedelta, timezone

import httpx

from . import naver_search
from .config import settings
from .solar import SolarError

KST = timezone(timedelta(hours=9))

MAX_ROUNDS = 3          # 검색 라운드 상한 (무한 재검색 방지)
MAX_RESULTS = 24        # 근거 레지스트리 상한 — 40으로 하면 합성이 크게 느려짐(실측 156s)
SEARCH_EFFORT = "minimal"   # 검색 판단 턴 — 실측상 가벼워서 minimal로 충분
# 합성도 minimal 고정: high는 근거 24건+ 앞에서 생각 폭주 → 3분+ 타임아웃(실측), 품질 이득 없음

CATEGORIES = ["공모전", "행사·특강", "자격증", "커리큘럼", "면접·취준"]

TOOLS = [{
    "type": "function",
    "function": {
        "name": "web_search",
        "description": "웹에서 최신 정보를 검색한다(네이버 웹문서·뉴스·블로그). "
                       "학생에게 추천할 공모전·행사·자격증 일정·커리큘럼·취업 정보를 찾을 때 사용.",
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "검색어(한국어, 연도 포함 권장)"}},
            "required": ["query"],
        },
    },
}]

AGENT_SYSTEM = """너는 인하대학교 학생의 학교생활·커리어 에이전트다.
학생의 프로필(학과·학년·목표)과 시간표 요약이 주어진다.

임무: web_search 도구로 이 학생에게 지금 유용한 정보를 조사하라.
- 카테고리: 공모전, 행사·특강, 자격증, 커리큘럼(공부 로드맵), 면접·취준
- 검색어에 연도(2026)를 포함해 최신 정보를 찾아라.
- 학과·목표에 맞춰 구체적으로 검색하라 (예: "2026 대학생 백엔드 공모전").
- 한 번에 여러 검색을 병렬로 요청해도 된다.
- 충분히 모였으면 검색을 멈춰라. 최종 정리는 별도로 요청된다."""

SYNTH_SYSTEM = """너는 인하대학교 학생의 학교생활·커리어 에이전트다.
아래에 번호가 붙은 검색 결과들이 주어진다. 이것만 근거로 학생 맞춤 브리핑을 만들어라.

반드시 아래 JSON 스키마로만 응답하라:
{
  "summary": "<학생 상황에 맞춘 2~3문장 총평 (~해요체)>",
  "items": [
    {
      "category": "공모전" | "행사·특강" | "자격증" | "커리큘럼" | "면접·취준",
      "title": "<추천 항목 이름>",
      "reason": "<왜 이 학생에게 맞는지 1~2문장. 시간표(공강)와 연결되면 언급>",
      "src": <근거가 된 검색 결과 번호(정수)>,
      "date_text": "<검색 결과에 적힌 일정/마감 문구 그대로. 없으면 null>"
    }
  ]
}
규칙:
- 반드시 주어진 검색 결과에 실제로 있는 내용만. src 번호는 근거 결과 번호.
- 검색 결과에 없는 날짜·마감일을 지어내지 마라. 없으면 date_text=null.
- 항목 6~12개, 카테고리를 고르게. 근거가 약한 카테고리는 비워도 된다.
- reason은 프로필(학과·학년·목표)과 연결해 구체적으로.
- 이 학생과 관련 없는 결과는 과감히 제외하라: 타 대학 내부 행사, 광고·홍보성 글,
  학원 수강 후기, 목표와 무관한 직무의 정보 등.
- 오늘 날짜가 함께 주어진다. 마감·접수 종료가 이미 지난 것이 명백한 일정은 items에
  넣지 마라. (예: 오늘이 7월인데 4월 마감 공모전) 연중 상시·날짜 미상은 유지."""


def _chat(messages: list, *, tools=None, effort: str, force_json: bool = False,
          max_tokens: int = 4096, model: str | None = None) -> dict:
    payload = {
        "model": model or settings.solar_model,
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": max_tokens,
    }
    if effort:
        payload["reasoning_effort"] = effort
    if tools:
        payload["tools"] = tools
    if force_json:
        payload["response_format"] = {"type": "json_object"}
    try:
        r = httpx.post(
            f"{settings.solar_base_url.rstrip('/')}/chat/completions",
            json=payload,
            headers={"Authorization": f"Bearer {settings.solar_api_key}"},
            timeout=180,
        )
    except httpx.HTTPError as e:
        raise SolarError(f"Solar 요청 실패: {type(e).__name__}") from e
    if r.status_code != 200:
        raise SolarError(f"Solar {r.status_code}: {r.text[:300]}")
    return r.json()["choices"][0]["message"]


# 날짜 추출 패턴: 2026.04.23 / 26-04-23 / 2026년 4월 3일 / 27 Apr 2026 / 5월 16일(연도 없음)
_D_FULL = re.compile(r"(20\d{2}|\d{2})[.\-/년]\s?(\d{1,2})[.\-/월]\s?(\d{1,2})")
_D_ENG = re.compile(r"(\d{1,2})\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s(20\d{2})", re.I)
_D_MD = re.compile(r"(\d{1,2})월\s?(\d{1,2})일")
_ENG_MON = {m: i + 1 for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}


def _date_passed(text: str) -> bool:
    """date_text 안의 날짜 중 '가장 늦은 날'이 오늘(KST) 이전이면 True(=이미 지난 일정).

    파싱 실패·연중 상시는 False(유지) — 확실할 때만 거른다(정직 원칙: 애매하면 보여주고
    '출처 확인' 라벨에 맡김).
    """
    today = datetime.now(KST).date()
    dates = []
    for y, m, d in _D_FULL.findall(text):
        try:
            yy = int(y) + (2000 if len(y) == 2 else 0)
            dates.append(datetime(yy, int(m), int(d)).date())
        except ValueError:
            pass
    for d, mon, y in _D_ENG.findall(text):
        try:
            dates.append(datetime(int(y), _ENG_MON[mon.lower()[:3]], int(d)).date())
        except (ValueError, KeyError):
            pass
    if not dates:  # 연도 있는 날짜가 없을 때만 '5월 16일' 류를 올해로 가정
        for m, d in _D_MD.findall(text):
            try:
                dates.append(datetime(today.year, int(m), int(d)).date())
            except ValueError:
                pass
    return bool(dates) and max(dates) < today


def run_agent(profile: dict, timetable_summary: str,
              synthesis_effort: str = "minimal") -> dict:
    """프로필+시간표 → 검색 루프 → 출처 가드 통과한 브리핑 JSON."""
    user_brief = (
        f"[프로필] 학과: {profile.get('major', '미입력')} / 학년: {profile.get('grade', '미입력')}\n"
        f"[목표·관심사] {profile.get('goal', '미입력')}\n"
        f"[시간표 요약] {timetable_summary or '미연결'}"
    )
    messages = [
        {"role": "system", "content": AGENT_SYSTEM},
        {"role": "user", "content": user_brief},
    ]

    registry: list[dict] = []   # 번호 붙은 근거 저장소 (1-base)
    queries: list[str] = []

    for _ in range(MAX_ROUNDS):
        msg = _chat(messages, tools=TOOLS, effort=SEARCH_EFFORT)
        tool_calls = msg.get("tool_calls") or []
        if not tool_calls:
            break  # 모델이 "충분하다" 판단
        messages.append(msg)
        for call in tool_calls:
            try:
                q = json.loads(call["function"]["arguments"]).get("query", "")
            except (json.JSONDecodeError, KeyError):
                q = ""
            results = []
            if q and len(registry) < MAX_RESULTS:
                queries.append(q)
                try:
                    found = naver_search.multi_search(q, display=3)[:6]
                except naver_search.NaverSearchError:
                    found = []
                for f in found:
                    if len(registry) >= MAX_RESULTS:
                        break
                    registry.append(f)
                    results.append({"n": len(registry), "title": f["title"],
                                    "snippet": f["snippet"][:140], "date": f["date"] or None})
            messages.append({
                "role": "tool",
                "tool_call_id": call["id"],
                "content": json.dumps(results or {"note": "결과 없음"}, ensure_ascii=False),
            })

    if not registry:
        return {"summary": "검색에서 쓸만한 근거를 찾지 못했어요. 목표를 조금 더 구체적으로 적어 다시 실행해 주세요.",
                "items": [], "queries": queries, "sources": 0}

    # 최종 합성 — 수집 근거만 제공, JSON 강제, effort는 A/B 대상
    numbered = "\n".join(
        f"[{i+1}] {r['title']} | {r['snippet'][:160]}" + (f" | 날짜: {r['date']}" if r.get("date") else "")
        for i, r in enumerate(registry)
    )
    # 합성은 pro3: open2는 출력 생성이 느려 합성에서 60초+ 소요(실측) — 검색 판단(function
    # calling)은 open2, 대량 JSON 출력은 서빙 빠른 pro3로 역할 분담.
    today = datetime.now(KST).strftime("%Y년 %m월 %d일")
    synth = _chat(
        [{"role": "system", "content": SYNTH_SYSTEM},
         {"role": "user", "content": f"[오늘 날짜] {today}\n{user_brief}\n\n[검색 결과]\n{numbered}"}],
        effort="", force_json=True, max_tokens=4096, model="solar-pro3",
    )
    try:
        data = json.loads(synth.get("content") or "{}")
    except json.JSONDecodeError as e:
        raise SolarError(f"합성 응답이 JSON 아님: {(synth.get('content') or '')[:200]}") from e

    # 출처 가드 — src가 실제 레지스트리 번호가 아니면 폐기
    items = []
    for it in data.get("items", []):
        src = it.get("src")
        if not isinstance(src, int) or not (1 <= src <= len(registry)):
            continue
        if it.get("date_text") and _date_passed(str(it["date_text"])):
            continue  # 마감이 확실히 지난 일정 제외 (프롬프트+코드 이중 가드)
        ref = registry[src - 1]
        items.append({
            "category": it.get("category") if it.get("category") in CATEGORIES else "행사·특강",
            "title": str(it.get("title") or "")[:120],
            "reason": str(it.get("reason") or "")[:300],
            "url": ref["url"],
            "source_title": ref["title"][:80],
            "date_text": (str(it.get("date_text"))[:60] if it.get("date_text") else None),
        })

    return {"summary": str(data.get("summary") or "")[:500],
            "items": items, "queries": queries, "sources": len(registry)}
