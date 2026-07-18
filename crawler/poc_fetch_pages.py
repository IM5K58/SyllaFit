# Stage 1 PoC — step 1: sugang 페이지 원문 확보 (폼/포스트백 구조 분석용)
# 실행: python crawler/poc_fetch_pages.py
import ssl
import urllib.request
from pathlib import Path

SAMPLES = Path(__file__).parent / "samples"
SAMPLES.mkdir(parents=True, exist_ok=True)

UA = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    )
}

# (URL, 저장 파일명, 실측 인코딩)
PAGES = [
    (
        "https://sugang.inha.ac.kr/sugang/SU_51001/Lec_Time_Search.aspx",
        "list_page_raw.html",
        "utf-8",
    ),
    (
        "https://sugang.inha.ac.kr/STD/SU_65002/LecPlanHistory.aspx",
        "lecplan_search_raw.html",
        "euc-kr",
    ),
]


def main():
    ctx = ssl.create_default_context()
    for url, name, enc in PAGES:
        req = urllib.request.Request(url, headers=UA)
        resp = urllib.request.urlopen(req, timeout=15, context=ctx)
        body = resp.read()
        out = SAMPLES / name
        out.write_text(body.decode(enc, errors="replace"), encoding="utf-8")
        print(f"saved {out} ({len(body)} bytes, status {resp.status})")


if __name__ == "__main__":
    main()
