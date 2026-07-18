"""α — 강의계획서 구조화 추출 (해자). Solar가 명시필드 없는 값만 근거와 함께 추출.

원칙:
- 평가비중 등 XML에 이미 숫자로 있는 값은 Solar가 만들지 않음 (크롤러 원문 그대로).
- Solar가 채우는 것: 팀플 유무·과제수·발표수·선수과목·주차부하 — 전부 자유텍스트에서.
- 객관적 사실만. 주관적 "체감 난이도" 생성 금지.
- M5: 모든 추출값은 원문 근거 포인터(source 경로) 동반. 근거 없으면 flagged.
"""
from .solar import chat_json

SYSTEM = """너는 대학 강의계획서에서 객관적 사실만 뽑는 추출기다.
반드시 계획서 본문에 실제로 적힌 내용만 근거로 삼는다. 추측·상식·일반화 금지.
**주관적 난이도·부하 평가 절대 금지.** 네 판단으로 '어렵다/부담크다'를 만들지 마라.
확실하지 않으면 반드시 null. 지어낸 값보다 null 이 항상 낫다(사용자를 오도하면 안 된다).

반드시 아래 JSON 스키마로만 응답한다:
{
  "team_project": true | null,
  "assignment_count": <정수> | null,
  "presentation_count": <정수> | null,
  "prerequisites": "<문자열>" | null,
  "workload_stated": "<계획서가 부하를 직접 언급한 원문 인용>" | null,
  "evidence": [
    {"field": "team_project", "source": "<원문경로>", "quote": "<원문 인용>"}
  ]
}

[근거(evidence) 규칙 — 엄격히 지킬 것]
1. **값이 있는(적극 주장) 필드에만 근거를 단다.** null 필드는 evidence 에 넣지 마라.
2. 각 evidence 의 quote 는 그 field 의 값을 **직접** 정당화해야 한다. quote 는 딱 그 한두 줄만 인용.
3. **과제·발표는 '명시적으로 과제/발표라고 적힌 것'만 센다 (억지로 세지 마라).**
   - assignment_count 근거는 '과제/보고서/레포트/숙제/제출/homework/assignment' 표식이 있는 항목만.
     **강의 주제·수업 내용·소단원은 과제가 아니다 — 절대 세지 마라.**
   - presentation_count 근거는 '발표/presentation' 표식이 있는 항목만. (단순 '세미나 참석'은 발표가 아니다.)
   - 서로 다른 것 하나 = evidence 하나. (개수는 시스템이 근거를 세어 매긴다.)
4. **한 field 당 evidence 는 최대 15개까지만 나열한다.** 그보다 많으면 대표적인 15개만.

[각 필드 판정 기준 — 확실할 때만 값, 아니면 null]
- team_project: 팀/조별/그룹 프로젝트가 **명시되면 true**. 언급이 없으면 **null**(= '언급 없음').
  절대 false 로 '없다'고 단정하지 마라 — 부재는 증명할 수 없다.
- assignment_count: 위 표식 있는 개별 과제를 센 정수. 명시 과제가 없으면 null.
- presentation_count: 위 표식 있는 발표 횟수. 없으면 null.
- prerequisites: 선수과목/이수요건이 **명시된 경우만** 그 문자열. 학습목표·개요·강의목적은 선수과목이 아니다 → null.
- workload_stated: 계획서가 부하/분량을 **직접 서술한 문장이 있을 때만** 그 원문을 인용
  (예: notice 의 '과제가 많습니다', '시간이 많이 소요됩니다'). **시험·과제가 존재한다는 사실만으로는 부하를 판정하지 마라.**
  그런 직접 서술이 없으면 반드시 null. (우리가 low/medium/high 를 매기지 않는다.)

source 경로 예: "ing_method", "share_detail", "weeks[5].content", "notice", "overview"."""


def syllabus_text(key: str, syl: dict) -> str:
    """계획서를 LLM 입력용 텍스트로 (α 추출·Q&A 공용)."""
    weeks_lines = []
    for w in syl.get("weeks", []):
        parts = [f"week {w['week']}: {w['theme']}"]
        if w.get("content", "").strip():
            parts.append(f"내용={w['content']}")
        if w.get("report", "").strip() and w["report"].strip() != "없음":
            parts.append(f"과제={w['report']}")
        weeks_lines.append(" | ".join(parts))

    share = syl.get("share") or {}
    share_line = (f"중간 {share.get('mid',0)} · 기말 {share.get('last',0)} · "
                  f"과제 {share.get('report',0)} · 출석 {share.get('attend',0)} · "
                  f"퀴즈 {share.get('quiz',0)} · 토론 {share.get('discussion',0)} · "
                  f"기타 {share.get('etc',0)}") if share else ""

    return f"""[과목] {key}

[강의 목표(object)]
{syl.get('object', '')}

[강의방식(ing_method)]
{syl.get('ing_method', '')}

[평가비중(share)]
{share_line}

[평가세부(share_detail)]
{syl.get('share_detail', '')}

[수업유형(blended_detail)]
{syl.get('blended_detail', '')}

[개요(overview)]
{syl.get('overview', '')}

[교재(main_book/sub_book)]
{syl.get('main_book', '')}
{syl.get('sub_book', '')}

[유의사항(notice)]
{syl.get('notice', '')}

[오피스아워(office_hour)]
{syl.get('office_hour', '')}

[주차별 계획(weeks)]
{chr(10).join(weeks_lines)}"""


def _build_user_prompt(key: str, syl: dict) -> str:
    return (syllabus_text(key, syl)
            + "\n\n위 계획서에서 팀프로젝트 유무, 과제 개수, 발표 개수, 선수과목, "
              "주차 부하를 근거와 함께 추출하라.")


CLAIM_FIELDS = ("team_project", "assignment_count", "presentation_count",
                "prerequisites", "workload_stated")


def _is_positive_claim(field: str, val) -> bool:
    """근거를 요구하는 '적극적 주장'인지. 부재(null·false)는 근거 불요.

    부재는 원문 인용으로 증명 불가 → 근거 강제 대상 아님.
    오직 '있다/몇 개다/무엇이다'(true·정수·비어있지 않은 문자열)에만 근거 요구.
    """
    if val is None or val is False or val == "":
        return False
    return True


def _validate_evidence(result: dict, syl: dict) -> dict:
    """M5 검증층: 적극적 주장인데 근거가 없으면 값을 버리고 flagged 로 남긴다.

    근거 없는 값은 화면에 내보내지 않는다(사용자 오도 방지) — 값 자체를 null 로 강등.
    """
    ev_fields = {e.get("field") for e in result.get("evidence", []) if isinstance(e, dict)}
    flags = []
    for field in CLAIM_FIELDS:
        if _is_positive_claim(field, result.get(field)) and field not in ev_fields:
            flags.append(field)
            result[field] = None  # 근거 없는 주장은 값도 제거 (구라 방지)
    # 부재 값에 달린 잉여 근거 제거
    result["evidence"] = [
        e for e in result.get("evidence", [])
        if isinstance(e, dict)
        and _is_positive_claim(e.get("field"), result.get(e.get("field")))
    ]
    result["flagged_no_evidence"] = flags
    return result


# 근거 문구가 실제로 과제/발표를 가리키는지 코드가 재검증 (모델이 강의주제를 과제로
# 착각해 세는 과다카운트 방어). 표식 없는 근거는 카운트에서 제외.
ASSIGNMENT_MARKERS = ("과제", "보고서", "레포트", "리포트", "숙제", "제출",
                      "homework", "assignment")
PRESENTATION_MARKERS = ("발표", "presentation")  # '세미나'는 참석일 수 있어 제외
_MARKERS = {
    "assignment_count": ASSIGNMENT_MARKERS,
    "presentation_count": PRESENTATION_MARKERS,
}


def _count_from_evidence(evidence: list, field: str) -> tuple[int | None, list]:
    """근거 개수로 개수를 센다. 단 해당 field 근거 중 실제 표식이 있는 것만 유효.

    반환: (개수 or None, 유효근거리스트). 모델이 강의주제를 과제로 오인해 넣은
    근거는 표식 검사로 걸러져 카운트에서 빠진다.
    """
    markers = _MARKERS.get(field, ())
    valid = []
    for e in evidence:
        if not (isinstance(e, dict) and e.get("field") == field):
            continue
        quote = (e.get("quote") or "").lower()
        if any(m.lower() in quote for m in markers):
            valid.append(e)
    return (len(valid) if valid else None), valid


def extract(key: str, syl: dict) -> dict:
    """계획서 1건 → α 추출 결과 (근거 포함, M5 검증됨).

    개수(assignment/presentation)는 Solar가 나열한 근거를 코드가 세어 확정 —
    모델의 자체 카운트는 신뢰하지 않는다(reasoning 모델 카운트 불안정).
    """
    raw = chat_json(SYSTEM, _build_user_prompt(key, syl))
    evidence = raw.get("evidence", [])

    a_count, a_valid = _count_from_evidence(evidence, "assignment_count")
    p_count, p_valid = _count_from_evidence(evidence, "presentation_count")

    # 표식 없는(강의주제 오인) 과제·발표 근거는 결과 근거에서도 제거 —
    # 사용자에게 '근거'라며 강의 소주제를 보여주지 않기 위해. 다른 field 근거는 유지.
    counted_fields = set(_MARKERS)
    other_evidence = [
        e for e in evidence
        if isinstance(e, dict) and e.get("field") not in counted_fields
    ]
    evidence = other_evidence + a_valid + p_valid

    # team_project 는 true/null 만 허용 — false('없음' 단정)는 증명불가라 null 로.
    tp = raw.get("team_project")
    team_project = True if tp is True else None

    result = {
        "team_project": team_project,
        "assignment_count": a_count,
        "presentation_count": p_count,
        "prerequisites": raw.get("prerequisites"),
        "workload_stated": raw.get("workload_stated"),
        "evidence": evidence,
    }
    return _validate_evidence(result, syl)
