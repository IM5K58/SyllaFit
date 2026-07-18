# Stage 3b — 목록페이지(Lec_Time_Search) 전 분반 수집
#
# 배경(2026-07-18 실측): 계획서조회(LecPlanHistory) 경로는 "계획서 제출된 분반"만
# 잡힌다(예: 일반수학2 47분반 중 12개만). 목록페이지는 수강신청 서비스 기간에만
# 열리는데, 지금 열려 있음 → 전 분반 + 시간/강의실 + 이수구분 + 평가방식 확보 가능.
#
# 실측 요청 규격 (브라우저 FormData 캡처로 확인):
#   POST Lec_Time_Search.aspx (UTF-8)
#   hhdSrchGubun=search1 + ddlDept=<전공코드> + ibtnSearch1=조회 가 전공별 조회.
#   ddlDept/ddlKita 는 실제 옵션값 필요(빈값이면 working.gif 플레이스홀더 응답).
#   결과 #dgList 컬럼(14): 학수번호-분반, 분반그룹, 과목명, 학년, 학점, 과목구분,
#     시간및강의실, 담당교수, 평가방식, 비고, LECPLAN_YN, GLECPLAN_YN, TIME_DATA, ABEEK_YN
#   TIME_DATA: D<요일>T<교시>... (D1=월..D7=일, 예 D1T16T17T18D3T16T17T18)
#
# 실행:
#   python crawler/crawl_list.py --probe     # 전공 3개만 (파싱 검증)
#   python crawler/crawl_list.py             # 전체 전공 (--resume 지원)
import argparse
import json
import re
import ssl
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

URL = "https://sugang.inha.ac.kr/sugang/SU_51001/Lec_Time_Search.aspx"
HERE = Path(__file__).parent
STATE = HERE / "state"
STATE.mkdir(exist_ok=True)
OUT_FILE = STATE / "list_index.json"       # {key: row}
DONE_FILE = STATE / "list_done_depts.json"  # 완료 전공코드
FAIL_LOG = STATE / "list_failures.log"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Referer": URL,
    "Origin": "https://sugang.inha.ac.kr",
    "Content-Type": "application/x-www-form-urlencoded",
}
DELAY = 1.0
TIMEOUT = 30
MAX_RETRY = 3
KST = timezone(timedelta(hours=9))

HIDDEN_RE = re.compile(r'<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"')
TR_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S)
TD_RE = re.compile(r"<td[^>]*>(.*?)</td>", re.S)
TAG_RE = re.compile(r"<[^>]+>")
DAY_MAP = {"1": "월", "2": "화", "3": "수", "4": "목", "5": "금", "6": "토", "7": "일"}

CTX = ssl.create_default_context()


def http(url, data=None):
    last = None
    for attempt in range(1, MAX_RETRY + 1):
        try:
            req = urllib.request.Request(url, data=data, headers=HEADERS)
            return urllib.request.urlopen(req, timeout=TIMEOUT, context=CTX).read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(DELAY * attempt)
    raise last


def log_fail(msg):
    line = f"{datetime.now(KST).isoformat(timespec='seconds')} {msg}"
    with FAIL_LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")
    print("  FAIL:", msg)


def get_form():
    """GET → (hidden fields, [(dept_code, label)], [(kita_code, label)], [gubun_code])."""
    html = http(URL).decode("utf-8", "replace")
    if "서비스 기간이 아닙니다" in html:
        raise RuntimeError("목록페이지 닫힘 (서비스 기간 아님)")
    hidden = dict(HIDDEN_RE.findall(html))
    m = re.search(r'<select name="ddlDept".*?</select>', html, re.S)
    depts = re.findall(r'<option[^>]*value="([^"]+)"[^>]*>([^<]+)</option>', m.group(0))
    mk = re.search(r'<select name="ddlKita".*?</select>', html, re.S)
    kitas = re.findall(r'<option[^>]*value="([^"]+)"[^>]*>([^<]+)</option>', mk.group(0))
    gubuns = re.findall(r'name="rdoKwamokGubun" value="([^"]+)"', html)
    return hidden, depts, kitas, gubuns


def parse_time_data(td):
    """'D1T16T17T18D3T16T17T18' → [{day, periods}] (강의실은 텍스트에서 별도)."""
    blocks = []
    for day, ts in re.findall(r"D(\d)((?:T\d+)+)", td):
        periods = [int(x) for x in re.findall(r"T(\d+)", ts)]
        if day in DAY_MAP and periods:
            blocks.append({"day": DAY_MAP[day], "periods": periods})
    return blocks


def parse_rooms(text):
    """'월16,17,18,수16,17,18(5동105A)' → 괄호 강의실 목록(등장 순)."""
    return re.findall(r"\(([^)]+)\)", text or "")


def search(hidden, defaults, mode, value):
    """mode: dept(search1)/kita(search2)/gubun(search3) 조회 → {key: row}."""
    dept_first, kita_first = defaults
    form = dict(hidden)
    form.update({
        "ddlDept": dept_first, "ddlKita": kita_first,
        "ddlTime1": "선택", "ddlTime2": "선택", "ddlTime3": "선택",
        "rdoKwamokGubun": "99", "rdoSearchGubun": "KWAMOK",
        "txtSearchKeyword": "", "mb_search": "", "hidLang": "KOR",
    })
    if mode == "dept":
        form.update({"ddlDept": value, "hhdSrchGubun": "search1", "ibtnSearch1": "조회"})
    elif mode == "kita":
        form.update({"ddlKita": value, "hhdSrchGubun": "search2", "ibtnSearch2": "조회"})
    else:  # gubun
        form.update({"rdoKwamokGubun": value, "hhdSrchGubun": "search3", "ibtnSearch3": "조회"})
    html = http(URL, urllib.parse.urlencode(form).encode()).decode("utf-8", "replace")
    if "working.gif" in html and "dgList" not in html:
        raise RuntimeError("플레이스홀더 응답 (폼 필드 확인)")

    rows = {}
    for tr in TR_RE.findall(html):
        tds = [TAG_RE.sub("", t).replace("&nbsp;", " ").strip() for t in TD_RE.findall(tr)]
        if len(tds) < 14 or "-" not in tds[0]:
            continue
        key = tds[0]
        if not re.match(r"^[A-Z0-9]+-\d+$", key):
            continue
        haksu, bunban = key.rsplit("-", 1)
        time_text = tds[6]
        blocks = parse_time_data(tds[12])
        rooms = parse_rooms(time_text)
        # 강의실 매칭: 블록 수와 괄호 수가 같으면 1:1, 괄호 1개면 전 블록 공용
        for i, b in enumerate(blocks):
            if len(rooms) == len(blocks):
                b["room"] = rooms[i]
            elif len(rooms) == 1:
                b["room"] = rooms[0]
            else:
                b["room"] = None
        rows[key] = {
            "key": key, "haksu_no": haksu, "bunban": bunban,
            "kwamok_kname": tds[2], "grade": tds[3], "credit": tds[4],
            "isu_gubun": tds[5], "time_text": time_text, "room_time": blocks,
            "prof_name": tds[7], "pf_name": tds[8], "bigo": tds[9],
            "lecplan_yn": tds[10] == "Y", "time_data": tds[12],
        }
    return rows


def main():
    global DELAY
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", action="store_true", help="전공 3개만")
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--delay", type=float, default=DELAY)
    args = ap.parse_args()
    DELAY = args.delay

    hidden, depts, kitas, gubuns = get_form()
    defaults = (depts[0][0], kitas[0][0])
    # 조회 축 3종 전부: 전공(search1) + 기타분류(search2) + 과목구분(search3)
    jobs = ([("dept", c, n) for c, n in depts]
            + [("kita", c, n) for c, n in kitas]
            + [("gubun", g, f"과목구분{g}") for g in gubuns])
    print(f"전공 {len(depts)} + 기타 {len(kitas)} + 구분 {len(gubuns)} = {len(jobs)}조회, 목록페이지 열림 확인")
    if args.probe:
        jobs = jobs[:3]

    index = json.loads(OUT_FILE.read_text(encoding="utf-8")) if (args.resume and OUT_FILE.exists()) else {}
    done = set(json.loads(DONE_FILE.read_text(encoding="utf-8"))) if (args.resume and DONE_FILE.exists()) else set()
    todo = [(m, c, n) for m, c, n in jobs if f"{m}:{c}" not in done]

    for i, (mode, code, name) in enumerate(todo, 1):
        time.sleep(DELAY)
        try:
            rows = search(hidden, defaults, mode, code)
        except Exception as e:  # noqa: BLE001
            log_fail(f"{mode}={code} {name}: {type(e).__name__} {e}")
            continue
        new = sum(1 for k in rows if k not in index)
        index.update(rows)
        done.add(f"{mode}:{code}")
        print(f"[{i}/{len(todo)}] {name.split('/')[0].strip()} rows={len(rows)} +{new} (누적 {len(index)})")
        if i % 10 == 0 or i == len(todo):
            OUT_FILE.write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
            DONE_FILE.write_text(json.dumps(sorted(done), ensure_ascii=False), encoding="utf-8")

    OUT_FILE.write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
    DONE_FILE.write_text(json.dumps(sorted(done), ensure_ascii=False), encoding="utf-8")
    with_plan = sum(1 for r in index.values() if r["lecplan_yn"])
    print(f"\n완료: 분반 {len(index)}개 (계획서有 {with_plan}, 無 {len(index)-with_plan})")
    print(f"→ {OUT_FILE}")


if __name__ == "__main__":
    main()
