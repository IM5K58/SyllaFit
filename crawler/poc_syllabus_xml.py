# Stage 1 PoC — 최종: 검색어 → 계획서 본문 XML 캡처 (end-to-end 검증판)
# 실행: python crawler/poc_syllabus_xml.py [검색어] [개수]
#   예: python crawler/poc_syllabus_xml.py 데이터 2
#
# 확인된 경로 (전부 실측):
#   1. GET  LecPlanHistory.aspx            → __VIEWSTATE 등 히든필드 수집 (EUC-KR)
#   2. POST LecPlanHistory.aspx            → 과목명 검색, 결과에 OpenPrint('LecPlan_Rpt.aspx?Value=…')
#   3. POST LecPlan_Xml.aspx?Value=…(이중 인코딩) + {type,path,rpx,jobID}
#        → 계획서 본문 = 구조화 XML (EUC-KR). 세션/쿠키 불필요.
#        ※ Value의 %는 %25로 이중 인코딩해야 함 (rptrx.js 뷰어와 동일 동작)
import re
import sys
import ssl
import time
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "https://sugang.inha.ac.kr/STD/SU_65002/"
SAMPLES = Path(__file__).parent / "samples"
SAMPLES.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Referer": BASE + "LecPlanHistory.aspx",
}
DELAY = 2.0  # 학교 서버 배려: 요청 간 최소 간격(초)

HIDDEN_RE = re.compile(
    r'<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"', re.I
)
ROW_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S)
TD_RE = re.compile(r"<td[^>]*>(.*?)</td>", re.S)
TAG_RE = re.compile(r"<[^>]+>")
OPENPRINT_RE = re.compile(r"OpenPrint\('LecPlan_Rpt\.aspx\?Value=([^']+)'\)")

CTX = ssl.create_default_context()


def fetch(url, data=None, extra_headers=None):
    h = dict(HEADERS)
    if extra_headers:
        h.update(extra_headers)
    req = urllib.request.Request(url, data=data, headers=h)
    resp = urllib.request.urlopen(req, timeout=30, context=CTX)
    return resp, resp.read()


def search(keyword):
    """과목명 검색 → [(학수번호, 분반, 과목명, 교수명, 전공, Value토큰)]"""
    resp, body = fetch(BASE + "LecPlanHistory.aspx")
    fields = dict(HIDDEN_RE.findall(body.decode("euc-kr", errors="replace")))
    assert "__VIEWSTATE" in fields, "뷰스테이트 없음 — 페이지 구조 변경 의심"

    form = dict(fields)
    form.update(
        {"rdolSearchDiv": "K", "txtSearch": keyword, "ibtnSearch": "검색", "hidLang": "KOR"}
    )
    time.sleep(DELAY)
    resp, body = fetch(
        BASE + "LecPlanHistory.aspx",
        urllib.parse.urlencode(form, encoding="euc-kr", errors="replace").encode(),
    )
    html = body.decode("euc-kr", errors="replace")

    rows = []
    for tr in ROW_RE.findall(html):
        m = OPENPRINT_RE.search(tr)
        if not m:
            continue
        tds = [TAG_RE.sub("", td).strip() for td in TD_RE.findall(tr)]
        # 실측 렌더링 컬럼(7개): 년도학기, 학기구분, 학수번호, 분반, 과목명, 교수명, 개설전공
        if len(tds) >= 7:
            rows.append((tds[2], tds[3], tds[4], tds[5], tds[6], m.group(1)))
    return rows


def fetch_syllabus_xml(value_token):
    """Value 토큰 → 계획서 본문 XML (str). 실패 시 None."""
    url = BASE + "LecPlan_Xml.aspx?Value=" + value_token.replace("%", "%25")
    data = urllib.parse.urlencode(
        {
            "type": "pdf",
            "path": "/ITISWebCommon/report/ITISExtLink/STD/",
            "rpx": "SU_65002_R01.crf",
            "jobID": "",
        }
    ).encode()
    resp, body = fetch(url, data, {"X-Requested-With": "XMLHttpRequest"})
    text = body.decode("euc-kr", errors="replace")
    if not text.lstrip().startswith("<?xml"):
        return None  # working.gif 플레이스홀더 등 = 실패
    return text


def main():
    keyword = sys.argv[1] if len(sys.argv) > 1 else "데이터"
    count = int(sys.argv[2]) if len(sys.argv) > 2 else 2

    rows = search(keyword)
    print(f"검색 '{keyword}': 계획서 링크 있는 과목 {len(rows)}건")
    for r in rows[:5]:
        print("  ", r[0], r[1], r[2], "/", r[3], "/", r[4])

    saved = 0
    for haksu, bunban, kwamok, prof, major, token in rows:
        if saved >= count:
            break
        time.sleep(DELAY)
        xml = fetch_syllabus_xml(token)
        if xml is None:
            print(f"  !! {haksu}-{bunban} XML 실패 (플레이스홀더 응답)")
            continue
        out = SAMPLES / f"syllabus_{haksu}_{bunban}.xml"
        out.write_text(xml, encoding="utf-8")
        saved += 1
        print(f"  OK {haksu}-{bunban} {kwamok} ({prof}) -> {out} ({len(xml)} chars)")

    print(f"\n저장 완료: {saved}건")


if __name__ == "__main__":
    main()
