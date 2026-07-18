"""M5 검증 패스 — α 추출값의 근거 정합성을 Solar 로 재판정 (PRD M5: 게이트 패턴).

각 (주장, 인용문) 쌍에 대해 '인용문이 주장을 직접 뒷받침하는가'를 판정한다.
- 지지 근거가 하나도 없는 주장 → 값을 null 로 강등 (m5_rejected 에 기록)
- 개수 필드(과제/발표)는 '지지된 근거 수'로 재계산
- 결과는 syllabi.json 의 extracted._m5 에 저장 (후기용 통계 근거)

실행:
  python backend/verify_alpha.py --limit 25     # 샘플 25과목
  python backend/verify_alpha.py                # 검증 대상 전체 (재개 가능)
"""
import argparse
import json
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.config import settings  # noqa: E402
from app.solar import SolarError, chat_json  # noqa: E402

SYLLABI = settings.cache_dir / "syllabi.json"
CHECKPOINT_EVERY = 10
KST = timezone(timedelta(hours=9))

SYSTEM = """너는 엄격한 검증 판정자다. 대학 강의계획서에서 추출된 '주장'과 그 근거로
제시된 '계획서 인용문' 쌍이 주어진다. 각 쌍에 대해 인용문이 주장을 직접 뒷받침하면
true, 무관하거나 불충분하면 false 로 판정한다. 판정만 하고 새 주장을 만들지 마라.

반드시 아래 JSON 스키마로만 응답한다:
{"verdicts": [{"i": <번호>, "supports": true|false}]}"""

FIELD_CLAIM = {
    "team_project": "이 과목에는 팀(조별) 프로젝트가 있다",
    "assignment_count": "이 인용문은 학생이 수행하는 개별 과제(보고서/제출물) 항목이다",
    "presentation_count": "이 인용문은 학생이 하는 발표 항목이다",
    "prerequisites": "이 인용문은 이 과목의 선수과목/사전요건을 명시한다",
    "workload_stated": "이 인용문은 계획서가 수업 부담(과제량/시간소요)을 직접 서술한 것이다",
}
COUNT_FIELDS = ("assignment_count", "presentation_count")


def verify_course(key: str, ext: dict) -> dict | None:
    """근거 있는 주장만 판정. 판정 결과로 ext 를 제자리 수정, 요약 반환."""
    pairs = []  # (i, field, quote)
    for e in ext.get("evidence", []):
        f = e.get("field")
        if f in FIELD_CLAIM and (e.get("quote") or "").strip():
            pairs.append((len(pairs), f, e["quote"]))
    if not pairs:
        return None

    lines = [f"{i}. [주장] {FIELD_CLAIM[f]}\n   [인용문] {q}" for i, f, q in pairs]
    raw = chat_json(SYSTEM, f"[과목] {key}\n\n" + "\n".join(lines))
    verdicts = {v.get("i"): bool(v.get("supports"))
                for v in raw.get("verdicts", []) if isinstance(v, dict)}

    supported_by_field: dict[str, int] = {}
    total_by_field: dict[str, int] = {}
    for i, f, _q in pairs:
        total_by_field[f] = total_by_field.get(f, 0) + 1
        if verdicts.get(i, False):
            supported_by_field[f] = supported_by_field.get(f, 0) + 1

    # 근거에 판정 마킹 + 지지 안 된 근거 제거
    kept = []
    idx = 0
    for e in ext.get("evidence", []):
        f = e.get("field")
        if f in FIELD_CLAIM and (e.get("quote") or "").strip():
            if verdicts.get(idx, False):
                kept.append(e)
            idx += 1
        else:
            kept.append(e)
    ext["evidence"] = kept

    rejected = []
    for f in total_by_field:
        sup = supported_by_field.get(f, 0)
        if f in COUNT_FIELDS:
            ext[f] = sup if sup > 0 else None  # 지지된 근거 수로 재계산
            if sup == 0:
                rejected.append(f)
        elif sup == 0:
            ext[f] = None  # 지지 근거 전무 → 주장 철회
            rejected.append(f)

    summary = {
        "at": datetime.now(KST).isoformat(timespec="seconds"),
        "checked": len(pairs),
        "supported": sum(supported_by_field.values()),
        "rejected_fields": rejected,
    }
    ext["_m5"] = summary
    return summary


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None, help="검증할 과목 수 상한(샘플)")
    ap.add_argument("--redo", action="store_true", help="이미 검증한 과목도 다시")
    args = ap.parse_args()

    if not settings.solar_ready:
        print("SOLAR_API_KEY 미설정"); sys.exit(1)

    data = json.loads(SYLLABI.read_text(encoding="utf-8"))
    syllabi = data.get("syllabi", {})

    todo = [k for k, v in syllabi.items()
            if (v.get("extracted") or {}).get("evidence")
            and (args.redo or "_m5" not in (v.get("extracted") or {}))]
    if args.limit:
        todo = todo[:args.limit]
    print(f"검증 대상 {len(todo)}과목 (근거 있는 과목만)")

    stats = {"courses": 0, "checked": 0, "supported": 0, "rejected": 0}
    for i, key in enumerate(todo, 1):
        ext = syllabi[key]["extracted"]
        try:
            s = verify_course(key, ext)
        except SolarError as e:
            print(f"  [{i}] {key} SolarError: {str(e)[:80]}")
            continue
        if s:
            stats["courses"] += 1
            stats["checked"] += s["checked"]
            stats["supported"] += s["supported"]
            stats["rejected"] += len(s["rejected_fields"])
            if s["rejected_fields"] or i % 10 == 0:
                print(f"  [{i}/{len(todo)}] {key}: {s['supported']}/{s['checked']} 지지"
                      + (f" · 철회: {s['rejected_fields']}" if s["rejected_fields"] else ""))
        if i % CHECKPOINT_EVERY == 0:
            SYLLABI.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    SYLLABI.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    if stats["checked"]:
        rate = stats["supported"] / stats["checked"] * 100
        print(f"\n[M5 요약] {stats['courses']}과목 · 근거 {stats['checked']}건 판정 · "
              f"지지율 {rate:.1f}% · 주장 철회 {stats['rejected']}건")


if __name__ == "__main__":
    main()
