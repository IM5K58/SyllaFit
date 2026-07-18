"""부팅 시 캐시 확보 — 저장소에 캐시 JSON이 없으면(공개 저장소라 gitignore됨) Neon에서 받아온다.

로컬 개발: crawler/cache/*.json 이 디스크에 있으므로 아무것도 안 함(즉시 반환).
배포(Render): 새 클론엔 캐시가 없으므로 cache_blobs 테이블에서 내려받아 파일로 푼다.
캐시 업로드는 backend/upload_cache.py 로 한 번(및 재크롤 후) 수행.
"""
from .config import settings

BLOBS = ("courses", "syllabi")  # cache_blobs.name → {name}.json


def ensure_cache() -> None:
    cdir = settings.cache_dir
    cdir.mkdir(parents=True, exist_ok=True)
    missing = [n for n in BLOBS if not (cdir / f"{n}.json").exists()]
    if not missing:
        return  # 로컬/기존 인스턴스에 이미 있음
    if not settings.database_url:
        print("[cache] 파일 없음 + DATABASE_URL 미설정 → 다운로드 스킵 (과목 0개로 동작)")
        return
    try:
        import psycopg  # 지연 import — 캐시가 이미 있으면 불필요
    except ImportError:
        print("[cache] psycopg 미설치 → 다운로드 불가")
        return
    try:
        with psycopg.connect(settings.database_url) as conn, conn.cursor() as cur:
            for name in missing:
                cur.execute("SELECT data FROM cache_blobs WHERE name = %s", (name,))
                row = cur.fetchone()
                if not row:
                    print(f"[cache] cache_blobs에 '{name}' 없음 (upload_cache.py 실행 필요)")
                    continue
                (cdir / f"{name}.json").write_text(row[0], encoding="utf-8")
                print(f"[cache] 다운로드 완료: {name}.json ({len(row[0]):,} chars)")
    except Exception as e:  # noqa: BLE001 — 실패해도 서버는 뜨게(헬스에 0과목으로 표시)
        print(f"[cache] 다운로드 실패: {type(e).__name__} {e}")
