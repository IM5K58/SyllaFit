# Stage 1 PoC — step 2: 계획서 검색 POST → 본문 링크 추출 → 본문 원문 캡처
# 실행: python crawler/poc_lecplan_search.py [검색어]  (기본: 데이터)
#
# 검증 대상 가정:
#   (a) GET에서 받은 __VIEWSTATE/__EVENTVALIDATION을 그대로 재전송하면 검색 POST 성공
#   (b) 결과의 OpenPrint('파일명') 파일은 세션 없이 GET 가능
#   (c) POST 본문 인코딩은 EUC-KR
import http.cookiejar
import re
import ssl
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "https://sugang.inha.ac.kr/STD/SU_65002/"
URL = BASE + "LecPlanHistory.aspx"
SAMPLES = Path(__file__).parent / "samples"
SAMPLES.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Referer": URL,
}

# 학교 서버 배려: 요청 사이 간격(초)
DELAY = 2.0

HIDDEN_RE = re.compile(
    r'<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"', re.I
)
OPENPRINT_RE = re.compile(r"OpenPrint\('([^']+)'\)")
ROW_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S)
TD_RE = re.compile(r"<td[^>]*>(.*?)</td>", re.S)
TAG_RE = re.compile(r"<[^>]+>")


def build_opener():
    ctx = ssl.create_default_context()
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(jar),
        urllib.request.HTTPSHandler(context=ctx),
    )


def fetch(opener, url, data=None):
    req = urllib.request.Request(url, data=data, headers=HEADERS)
    resp = opener.open(req, timeout=20)
    return resp, resp.read()


def main():
    keyword = sys.argv[1] if len(sys.argv) > 1 else "데이터"
    opener = build_opener()

    # 1) GET — 뷰스테이트/히든필드 수집
    resp, body = fetch(opener, URL)
    html = body.decode("euc-kr", errors="replace")
    fields = dict(HIDDEN_RE.findall(html))
    print(f"[GET] {resp.status}, hidden fields: {sorted(fields.keys())}")
    if "__VIEWSTATE" not in fields:
        print("!! __VIEWSTATE 없음 — 페이지 구조가 예상과 다름. 중단.")
        return

    # 2) POST — 과목명 검색 (EUC-KR 인코딩)
    form = dict(fields)
    form.update(
        {
            "rdolSearchDiv": "K",  # K=과목명, P=교수명, H=학수번호
            "txtSearch": keyword,
            "ibtnSearch": "검색",
            "hidLang": "KOR",
        }
    )
    data = urllib.parse.urlencode(form, encoding="euc-kr", errors="replace").encode()
    time.sleep(DELAY)
    resp, body = fetch(opener, URL, data=data)
    result_html = body.decode("euc-kr", errors="replace")
    out = SAMPLES / "lecplan_results_raw.html"
    out.write_text(result_html, encoding="utf-8")
    print(f"[POST '{keyword}'] {resp.status}, {len(body)} bytes -> {out}")

    # 3) 결과 행 파싱 + OpenPrint 파일명 추출
    links = OPENPRINT_RE.findall(result_html)
    print(f"OpenPrint links found: {len(links)}")
    for tr in ROW_RE.findall(result_html):
        tds = [TAG_RE.sub("", td).strip() for td in TD_RE.findall(tr)]
        if tds and len(tds) >= 8:
            m = OPENPRINT_RE.search(tr)
            mark = " -> " + m.group(1) if m else " (링크 없음)"
            print("  |", " / ".join(tds[:10]), mark)

    if not links:
        print("!! 계획서 링크 0건 — 결과 HTML을 확인 필요 (위 파일 참조). 중단.")
        return

    # 4) 본문 2건 GET 캡처
    for i, file_nm in enumerate(links[:2], 1):
        time.sleep(DELAY)
        url = urllib.parse.urljoin(BASE, file_nm)
        try:
            resp, body = fetch(opener, url)
        except Exception as e:
            print(f"[BODY {i}] {url} -> ERROR {type(e).__name__}: {e}")
            continue
        ctype = resp.headers.get("Content-Type", "")
        ext = ".pdf" if "pdf" in ctype.lower() else ".html"
        out = SAMPLES / f"syllabus_{i:02d}{ext}"
        if ext == ".html":
            enc = "utf-8" if "utf-8" in ctype.lower() else "euc-kr"
            out.write_text(body.decode(enc, errors="replace"), encoding="utf-8")
        else:
            out.write_bytes(body)
        print(f"[BODY {i}] {resp.status} {ctype} {len(body)} bytes -> {out}")
        print(f"         url: {url}")


if __name__ == "__main__":
    main()
