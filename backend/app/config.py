"""서버 설정 로드 — 키는 .env(서버 전용)에서만. 프론트 노출 금지."""
import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent

load_dotenv(BACKEND_DIR / ".env")


class Settings:
    solar_api_key: str = os.getenv("SOLAR_API_KEY", "")
    solar_base_url: str = os.getenv("SOLAR_BASE_URL", "https://api.upstage.ai/v1")
    solar_model: str = os.getenv("SOLAR_MODEL", "solar-pro3")

    # 캐시 blob 저장소(Neon Postgres). 저장소에 캐시가 없을 때 부팅 시 여기서 받아옴.
    database_url: str = os.getenv("DATABASE_URL", "")

    _cache_env = os.getenv("CACHE_DIR")
    cache_dir: Path = (
        (BACKEND_DIR / _cache_env).resolve()
        if _cache_env
        else REPO_DIR / "crawler" / "cache"
    )

    # 허용 오리진(CORS). 배포 시 프론트 도메인을 ALLOWED_ORIGINS 에 쉼표로 지정.
    # 미지정 시 로컬 개발 오리진만 허용.
    _origins_env = os.getenv("ALLOWED_ORIGINS", "")
    allowed_origins: list[str] = (
        [o.strip() for o in _origins_env.split(",") if o.strip()]
        if _origins_env
        else [
            "http://localhost:3000", "http://127.0.0.1:3000",
            "http://localhost:3100", "http://127.0.0.1:3100",
        ]
    )

    @property
    def solar_ready(self) -> bool:
        return bool(self.solar_api_key) and not self.solar_api_key.startswith("up_xxxx")


settings = Settings()
