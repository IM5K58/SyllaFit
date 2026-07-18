"""α 추출값을 캐시(syllabi.json)의 extracted 필드에 병합 (가이드: /syllabus/extract → 캐시 병합).

실행:
  python backend/enrich_alpha.py            # 전체(미완료분만), 재개 가능
  python backend/enrich_alpha.py 40         # 미완료분 중 최대 40과목만
  python backend/enrich_alpha.py --redo     # 이미 한 것도 전부 다시

크롤러 원문층은 건드리지 않고 extracted 만 채운다. 근거 포인터 포함.
- 재개: extracted._alpha_done=True 인 과목은 건너뜀(중단 후 다시 실행하면 이어서).
- 체크포인트: CHECKPOINT_EVERY 과목마다 파일 저장(크래시 대비).
- Solar 실패는 로깅 후 계속(해당 과목은 미완료로 남아 다음 실행에 재시도).
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app import alpha, cache_store  # noqa: E402
from app.config import settings  # noqa: E402
from app.solar import SolarError  # noqa: E402

SYLLABI = settings.cache_dir / "syllabi.json"
CHECKPOINT_EVERY = 20


def main():
    args = sys.argv[1:]
    redo = "--redo" in args
    only_empty = "--only-empty" in args  # 전 필드 null + 원문 풍부 과목만 재추출
    nums = [a for a in args if a.isdigit()]
    limit = int(nums[0]) if nums else None

    if not settings.solar_ready:
        print("SOLAR_API_KEY 미설정 — backend/.env 필요.")
        sys.exit(1)

    data = json.loads(SYLLABI.read_text(encoding="utf-8"))
    syllabi = data.get("syllabi", {})

    FIELDS = ("team_project", "assignment_count", "presentation_count",
              "prerequisites", "workload_stated")

    def is_empty_rich(v):
        ext = v.get("extracted") or {}
        if any(ext.get(f) is not None for f in FIELDS):
            return False
        blob = " ".join(
            [v.get("ing_method", ""), v.get("share_detail", ""), v.get("notice", "")]
            + [w.get("report", "") + w.get("content", "") for w in v.get("weeks", [])]
        )
        return len(blob.strip()) > 300

    if only_empty:
        todo = [k for k, v in syllabi.items() if is_empty_rich(v)]
    else:
        todo = [
            k for k, v in syllabi.items()
            if redo or not (v.get("extracted") or {}).get("_alpha_done")
        ]
    if limit:
        todo = todo[:limit]
    already = len(syllabi) - len([k for k, v in syllabi.items()
                                  if not (v.get("extracted") or {}).get("_alpha_done")])
    print(f"전체 {len(syllabi)}과목 | 이미 완료 {already} | 이번 대상 {len(todo)} (Solar 호출)")

    done = fail = 0
    for i, key in enumerate(todo, 1):
        syl = syllabi[key]
        try:
            result = alpha.extract(key, syl)
        except SolarError as e:
            print(f"  [{i}/{len(todo)}] {key} SolarError: {e}")
            fail += 1
            continue
        result["_alpha_done"] = True
        syl["extracted"] = result
        done += 1
        if i % 10 == 0 or result["team_project"] or result["assignment_count"]:
            print(f"  [{i}/{len(todo)}] {key}: 팀플={result['team_project']} "
                  f"부하={result['workload_stated'] or '-'} 과제={result['assignment_count']} "
                  f"근거{len(result['evidence'])}")
        if i % CHECKPOINT_EVERY == 0:
            SYLLABI.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"    …체크포인트 저장 ({done}완료)")

    SYLLABI.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    cache_store.reload_cache()
    print(f"\n완료: 신규 {done}, 실패 {fail} -> {SYLLABI}")
    remaining = sum(1 for v in syllabi.values()
                    if not (v.get("extracted") or {}).get("_alpha_done"))
    if remaining:
        print(f"미완료 {remaining}과목 남음 — 다시 실행하면 이어서 처리.")


if __name__ == "__main__":
    main()
