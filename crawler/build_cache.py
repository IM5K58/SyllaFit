# Stage 2 — 캐시 빌더: 목록페이지 전 분반(기준) + 계획서 XML(있는 것만) 병합
# 실행: python crawler/build_cache.py
#
# 2026-07-18 개편: 계획서조회 경로는 "계획서 제출 분반"만 잡힌다(일반수학2 47중 12).
# 목록페이지(crawl_list.py, state/list_index.json)가 전 분반의 시간·강의실·이수구분·
# 학년·평가방식·비고를 제공 → 과목 목록의 기준(source of truth)으로 삼고,
# 계획서(raw/*.xml)와 α 추출(기존 cache/syllabi.json의 extracted — Solar 비용 재사용)을
# 키가 맞는 분반에 병합한다. list_index 없으면 종전 방식(계획서만)으로 동작.
#   스키마: crawler/SCHEMA.md
import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from pathlib import Path

HERE = Path(__file__).parent
RAW = HERE / "raw"           # crawl_all.py 산출물 (학수번호-분반.xml)
SAMPLES = HERE / "samples"   # Stage 1 PoC 샘플 (syllabus_*.xml)
CACHE = HERE / "cache"
CACHE.mkdir(exist_ok=True)
STATE = HERE / "state"       # crawl_all.py 인덱스(major 등 목록 메타 병합용)

KST = timezone(timedelta(hours=9))
DAY_GROUP_RE = re.compile(r"([월화수목금토일])(\d+(?:,\d+)*)")


WEB_ONLY = ("웹강의", "사이버", "온라인", "이러닝", "e-러닝")


def parse_room_time(raw):
    """강의시간 문자열 → [{room, day, periods}].

    형식 3종(실측):
      · '하-424:화19,20,21'          강의실 있음 (방:요일교시)
      · '월4,5,6,수4,5,6'            강의실 없음 (요일교시만) → room=None
      · '웹강의' 등                  온라인 → [] (시간 없음)
    파싱 실패해도 raw 는 room_time_raw 에 보존.
    """
    if not raw or not raw.strip():
        return []
    if any(w in raw for w in WEB_ONLY):
        return []
    # 강의실 유무 = ':' 앞에 요일패턴이 없으면 방 이름
    if ":" in raw:
        head, _, tail = raw.partition(":")
        # head 가 요일교시 형태면 방 없음(':'는 데이터 내부), 아니면 head=방
        room = None if DAY_GROUP_RE.search(head) else head
        times = raw if room is None else tail
    else:
        room, times = None, raw
    out = []
    for day, nums in DAY_GROUP_RE.findall(times):
        out.append({"room": room, "day": day, "periods": [int(n) for n in nums.split(",")]})
    return out


def text(el, tag):
    v = el.findtext(tag)
    return (v or "").strip()


def load_xml(path):
    raw = path.read_text(encoding="utf-8")
    raw = raw.replace('encoding="EUC-KR"', 'encoding="UTF-8"', 1)
    return ET.fromstring(raw).find("MAIN")


def convert(main):
    haksu_no = text(main, "HAKSU_NO")
    bunban = text(main, "BUNBAN")
    key = f"{haksu_no}-{bunban}"
    rt_raw = text(main, "ROOM_TIME_LIST")

    course = {
        "haksu_no": haksu_no,
        "bunban": bunban,
        "kwamok_kname": text(main, "KWAMOK_KNAME"),
        "kwamok_ename": text(main, "KWAMOK_ENAME"),
        "prof_name": text(main, "PROF_NAME"),
        "credit": float(text(main, "CREDIT") or 0),
        "pf_name": text(main, "PF_NAME"),
        "major": None,  # LecPlanHistory 검색 행에서 병합 (Stage 3)
        "season_yn": text(main, "SEASON_YN"),
        "room_time_raw": rt_raw,
        "room_time": parse_room_time(rt_raw),
        "lecplan_yn": True,
        # 목록 페이지 전용 — 서비스 기간에만 수집 가능 (SCHEMA.md 참조)
        "grade": None,
        "isu_gubun": None,
        "bigo": None,
    }

    weeks = []
    for info in main.findall("INFO"):
        weeks.append(
            {
                "week": int(text(info, "WEEK") or 0),
                "theme": text(info, "THEME"),
                "content": text(info, "CONTENT"),
                "report": text(info, "REPORT"),
                "lec_method": text(info, "LEC_METHOD_NAME") or text(info, "LEC_METHOD"),
            }
        )

    syllabus = {
        "share": {
            "mid": int(text(main, "SHARE_MID") or 0),
            "last": int(text(main, "SHARE_LAST") or 0),
            "report": int(text(main, "SHARE_REPORT") or 0),
            "attend": int(text(main, "SHARE_ATTEND") or 0),
            "quiz": int(text(main, "SHARE_QUIZ") or 0),
            "discussion": int(text(main, "SHARE_DISCUSSION") or 0),
            "etc": int(text(main, "SHARE_ETC") or 0),
            "total": int(text(main, "SHARE_TOTAL") or 0),
        },
        "share_detail": text(main, "SHARE_DETAIL"),
        "object": text(main, "OBJECT"),
        "overview": text(main, "OVERVIEW"),
        "ing_method": text(main, "ING_METHOD"),
        "blended_detail": text(main, "BLENDED_DETAIL"),
        "main_book": text(main, "MAIN_BOOK"),
        "sub_book": text(main, "SUB_BOOK"),
        "notice": text(main, "NOTICE"),
        "office_hour": text(main, "OFFICE_HOUR"),
        "weeks": weeks,
        # α(Solar) 추출층 — Stage 4에서 채움. 값엔 반드시 evidence 동반.
        # team_project: true/null(있음/언급없음, false 단정 안 함). workload_stated:
        # 계획서가 부하를 직접 서술한 원문 인용만(우리가 등급 매기지 않음).
        "extracted": {
            "assignment_count": None,
            "presentation_count": None,
            "team_project": None,
            "prerequisites": None,
            "workload_stated": None,
            "evidence": [],
        },
    }
    yearterm = text(main, "YEARTERM")
    return key, yearterm, course, syllabus


def load_index():
    """crawl_all.py의 state/index.json에서 목록 메타(major 등) 병합용."""
    idx = STATE / "index.json"
    return json.loads(idx.read_text(encoding="utf-8")) if idx.exists() else {}


TARGET_YEARTERM = "20262"  # 대상 학기(2026-2). 옛 학기 XML은 캐시에서 제외.


def load_list_index():
    """crawl_list.py 산출물 — 목록페이지 전 분반 (없으면 {})."""
    p = STATE / "list_index.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def load_old_syllabi():
    """기존 캐시의 syllabi — α 추출/M5 검증 결과 보존용 (Solar 재호출 방지)."""
    p = CACHE / "syllabi.json"
    if not p.exists():
        return {}
    return json.loads(p.read_text(encoding="utf-8")).get("syllabi", {})


def main():
    # raw/ (크롤러 전체 수집) 우선, 없으면 samples/ (PoC)
    files = sorted(RAW.glob("*.xml")) or sorted(SAMPLES.glob("syllabus_*_*.xml"))
    if not files:
        print("raw/ 또는 samples/에 XML 없음 — 먼저 crawl_all.py 실행")
        return

    index = load_index()      # key -> {major, ...} (계획서 검색 메타)
    list_idx = load_list_index()
    old_syl = load_old_syllabi()

    # 1) 계획서 XML → 코스(계획서 기준) + 계획서 본문
    xml_courses, syllabi = {}, {}
    skipped_term = 0
    for f in files:
        try:
            key, yt, course, syl = convert(load_xml(f))
        except Exception as e:  # noqa: BLE001 — 깨진 XML은 건너뛰고 로깅
            print(f"SKIP {f.name}: {type(e).__name__} {e}")
            continue
        if yt != TARGET_YEARTERM:  # 옛 학기 계획서 제외 (검색이 1999~현재 반환)
            skipped_term += 1
            continue
        if key in index and index[key].get("major"):
            course["major"] = index[key]["major"]
        xml_courses[key] = course
        # α/M5 결과가 이미 있으면 그 syllabus 를 그대로 보존 (같은 원문 재크롤이므로 안전)
        prev = old_syl.get(key)
        syllabi[key] = prev if (prev and prev.get("extracted")) else syl
    print(f"계획서 XML {len(xml_courses)}건 (from {len(files)}, 타학기 {skipped_term} 제외, "
          f"α보존 {sum(1 for k in xml_courses if k in old_syl)})")

    # 2) 과목 목록 확정: 목록페이지가 있으면 그것이 기준(전 분반), 없으면 계획서만
    if list_idx:
        courses = {}
        for key, row in list_idx.items():
            xc = xml_courses.get(key, {})
            courses[key] = {
                "haksu_no": row["haksu_no"],
                "bunban": row["bunban"],
                "kwamok_kname": row["kwamok_kname"],
                "kwamok_ename": xc.get("kwamok_ename", ""),
                "prof_name": row["prof_name"],
                "credit": float(row["credit"] or 0),
                "pf_name": row["pf_name"],
                "major": xc.get("major"),
                "season_yn": xc.get("season_yn", ""),
                "room_time_raw": row["time_text"],
                "room_time": row["room_time"],   # TIME_DATA 파싱(기계가독) — XML보다 신뢰
                "lecplan_yn": key in syllabi,     # 실제 본문 확보 여부 (목록 Y여도 미수집이면 F)
                "grade": row["grade"] or None,
                "isu_gubun": row["isu_gubun"] or None,
                "bigo": row["bigo"] or None,
            }
        dropped = sorted(k for k in xml_courses if k not in courses)
        if dropped:
            print(f"목록에 없는 계획서 키 {len(dropped)}건 제외(그룹계획서/폐강 추정): "
                  + ", ".join(dropped[:10]) + (" …" if len(dropped) > 10 else ""))
        source = "sugang.inha.ac.kr (Lec_Time_Search 전분반 + LecPlan_Xml 계획서)"
    else:
        courses = xml_courses
        print("⚠ list_index.json 없음 — 계획서 제출 분반만 캐시됨 (crawl_list.py 실행 권장)")
        source = "sugang.inha.ac.kr (LecPlanHistory + LecPlan_Xml)"

    yearterm = TARGET_YEARTERM
    with_syl = sum(1 for k in courses if k in syllabi)
    print(f"converted {len(courses)}분반 (계획서 {with_syl}, 없음 {len(courses)-with_syl})")

    now = datetime.now(KST).isoformat(timespec="seconds")
    (CACHE / "courses.json").write_text(
        json.dumps(
            {"collected_at": now, "yearterm": yearterm,
             "source": source,
             "courses": courses},
            ensure_ascii=False, indent=2),
        encoding="utf-8")
    (CACHE / "syllabi.json").write_text(
        json.dumps(
            {"collected_at": now, "yearterm": yearterm, "syllabi": syllabi},
            ensure_ascii=False, indent=2),
        encoding="utf-8")
    print(f"\n{CACHE / 'courses.json'} / syllabi.json 생성 ({len(courses)}과목)")


if __name__ == "__main__":
    main()
