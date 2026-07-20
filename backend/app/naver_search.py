"""Naver 검색 API 클라이언트 (웹문서·뉴스·블로그).

에이전트의 web_search 도구 구현체. 공급자 교체를 대비해 결과를 표준 형태로 정규화:
  {title, url, snippet, source, date}
※ 개발자센터 검색 API는 2027-06-30까지 지원(2026-07-31 전 발급 키) — 이후
  NAVER API HUB로 이관 필요. 이 파일만 갈아끼우면 되도록 여기 격리한다.
"""
import html
import re

import httpx

from .config import settings

BASE = "https://openapi.naver.com/v1/search"
# 소스별 엔드포인트 (쇼핑·책·전문자료는 2026-07-31 종료라 배제)
SOURCES = {"web": "webkr.json", "news": "news.json", "blog": "blog.json"}
TAG_RE = re.compile(r"</?b>")

class NaverSearchError(RuntimeError):
    pass


def _clean(s: str) -> str:
    return html.unescape(TAG_RE.sub("", s or "")).strip()


def search(query: str, source: str = "web", display: int = 5) -> list[dict]:
    """검색 → 정규화 결과 리스트. 실패는 예외(폴백으로 지어내지 않음)."""
    if not settings.naver_ready:
        raise NaverSearchError("NAVER_CLIENT_ID/SECRET 미설정 (backend/.env)")
    endpoint = SOURCES.get(source, SOURCES["web"])
    try:
        r = httpx.get(
            f"{BASE}/{endpoint}",
            params={"query": query, "display": display, "sort": "sim"},
            headers={
                "X-Naver-Client-Id": settings.naver_client_id,
                "X-Naver-Client-Secret": settings.naver_client_secret,
            },
            timeout=15,
        )
    except httpx.HTTPError as e:
        raise NaverSearchError(f"Naver 요청 실패: {type(e).__name__}") from e
    if r.status_code != 200:
        raise NaverSearchError(f"Naver {r.status_code}: {r.text[:200]}")

    out = []
    for it in r.json().get("items", []):
        url = it.get("link") or ""
        if not url.startswith("http"):
            continue
        out.append({
            "title": _clean(it.get("title", "")),
            "url": url,
            "snippet": _clean(it.get("description", "")),
            "source": source,
            # 뉴스만 pubDate 제공 — 있으면 신선도 판단에 사용
            "date": (it.get("pubDate") or "")[:16],
        })
    return out


def multi_search(query: str, display: int = 4) -> list[dict]:
    """웹문서+뉴스+블로그 통합 검색 (에이전트 도구 기본형). 3소스 병렬 호출."""
    from concurrent.futures import ThreadPoolExecutor

    results, errors = [], []
    with ThreadPoolExecutor(max_workers=3) as ex:
        futures = {ex.submit(search, query, src, display): src for src in SOURCES}
        for fut in futures:
            try:
                results.extend(fut.result())
            except NaverSearchError as e:
                errors.append(str(e))
    if not results and errors:
        raise NaverSearchError("; ".join(errors[:2]))
    # URL 중복 제거 (같은 문서가 소스 여럿에 잡히는 경우)
    seen, dedup = set(), []
    for r in results:
        if r["url"] in seen:
            continue
        seen.add(r["url"])
        dedup.append(r)
    return dedup
