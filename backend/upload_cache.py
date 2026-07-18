"""캐시 JSON 2개를 Neon(cache_blobs 테이블)에 업로드.

공개 저장소(Public)에선 캐시를 커밋하지 않으므로, 배포 백엔드가 부팅 시 여기서 받아간다.
최초 1회 + 재크롤(build_cache.py) 후마다 실행.

사용:
  # DATABASE_URL 은 backend/.env 또는 환경변수로 (Neon connection string)
  cd backend && python upload_cache.py
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND = Path(__file__).resolve().parent
CACHE = BACKEND.parent / "crawler" / "cache"
load_dotenv(BACKEND / ".env")

DATABASE_URL = os.getenv("DATABASE_URL", "")
BLOBS = ("courses", "syllabi")


def main() -> None:
    if not DATABASE_URL:
        sys.exit("DATABASE_URL 미설정 — backend/.env 에 Neon connection string 필요")
    missing = [n for n in BLOBS if not (CACHE / f"{n}.json").exists()]
    if missing:
        sys.exit(f"캐시 파일 없음: {missing} — 먼저 crawler/build_cache.py 실행")

    import psycopg

    with psycopg.connect(DATABASE_URL) as conn, conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS cache_blobs (
                name       text PRIMARY KEY,
                data       text NOT NULL,
                updated_at timestamptz NOT NULL DEFAULT now()
            )
        """)
        for name in BLOBS:
            data = (CACHE / f"{name}.json").read_text(encoding="utf-8")
            cur.execute("""
                INSERT INTO cache_blobs (name, data, updated_at)
                VALUES (%s, %s, now())
                ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
            """, (name, data))
            print(f"업로드 완료: {name}.json ({len(data):,} chars)")
        conn.commit()
    print("→ Neon cache_blobs 에 저장됨. 배포 백엔드가 부팅 시 받아갑니다.")


if __name__ == "__main__":
    main()
