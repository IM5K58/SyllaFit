"""계획서 Q&A — 과목 하나의 계획서 원문에 대해 질문·답변 (근거 인용 강제).

원칙은 α와 동일: 계획서에 적힌 사실만, 없으면 '없다'고 정직하게.
"""
from . import cache_store
from .alpha import syllabus_text
from .solar import chat_json

SYSTEM = """너는 대학 강의계획서에 대한 학생의 질문에 답하는 도우미다.
반드시 아래 제공되는 계획서 내용에 적힌 사실만으로 답한다. 추측·일반상식 보충 금지.
계획서에 없는 내용이면 솔직히 없다고 답한다. 과장·단정 금지.

반드시 아래 JSON 스키마로만 응답한다:
{
  "answer": "<두세 문장 이내의 친근한 한국어 답변 (~해요체)>",
  "found": true | false,
  "quotes": [{"source": "<필드경로 예: weeks[3].content, notice>", "quote": "<근거 원문 한두 줄>"}]
}
- found=true 면 quotes 에 답의 근거를 1~3개 인용한다 (근거 없는 주장 금지).
- found=false 면 quotes 는 빈 배열, answer 는 '계획서에서 확인할 수 없어요' 취지로 쓰고
  가능하면 계획서에 실제로 있는 관련 정보를 한 줄 덧붙인다."""


def ask(key: str, question: str) -> dict:
    course = cache_store.get_course(key) or {}
    syl = cache_store.get_syllabus(key)
    if not syl:
        return {"answer": "이 과목의 계획서가 없어요.", "found": False, "quotes": []}

    header = (f"{course.get('kwamok_kname')} ({key}) · {course.get('prof_name')} 교수 · "
              f"{course.get('credit')}학점 · {course.get('pf_name')}")
    user = f"[과목 정보] {header}\n\n{syllabus_text(key, syl)}\n\n[학생 질문]\n{question}"
    raw = chat_json(SYSTEM, user)

    quotes = [q for q in raw.get("quotes", [])
              if isinstance(q, dict) and (q.get("quote") or "").strip()][:3]
    found = bool(raw.get("found")) and bool(quotes) if raw.get("found") else False
    # found 인데 근거 0개면 신뢰 원칙 위반 → not found 로 강등
    return {
        "answer": raw.get("answer") or "답변을 만들지 못했어요.",
        "found": found,
        "quotes": quotes if found else [],
    }
