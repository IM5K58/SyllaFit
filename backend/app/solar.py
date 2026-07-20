"""Solar API 클라이언트 (Upstage, OpenAI 호환). 키는 서버 전용."""
import json

import httpx

from .config import settings


class SolarError(RuntimeError):
    pass


def chat_json(system: str, user: str, *, temperature: float = 0.0,
              max_tokens: int = 8192) -> dict:
    """Solar에 JSON 응답을 요청하고 파싱해서 반환.

    OpenAI 호환 /chat/completions 엔드포인트 사용. response_format=json_object.
    실패(키 없음/네트워크/파싱)는 SolarError로 명확히 던진다 — 추측 폴백 없음.
    """
    if not settings.solar_ready:
        raise SolarError(
            "SOLAR_API_KEY 미설정 — backend/.env 에 실제 키 필요 (서버 전용)"
        )

    url = f"{settings.solar_base_url.rstrip('/')}/chat/completions"
    payload = {
        "model": settings.solar_model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
    }
    if settings.solar_reasoning_effort:  # 추론 모델(solar-open2 등)만 필요 — 빈 값이면 미전송
        payload["reasoning_effort"] = settings.solar_reasoning_effort
    headers = {"Authorization": f"Bearer {settings.solar_api_key}"}

    try:
        resp = httpx.post(url, json=payload, headers=headers, timeout=120)
    except httpx.HTTPError as e:
        raise SolarError(f"Solar 요청 실패: {type(e).__name__}: {e}") from e

    if resp.status_code != 200:
        raise SolarError(f"Solar {resp.status_code}: {resp.text[:500]}")

    try:
        content = resp.json()["choices"][0]["message"]["content"]
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        raise SolarError(f"Solar 응답 구조 예상 밖: {resp.text[:500]}") from e

    try:
        return json.loads(content)
    except json.JSONDecodeError as e:
        raise SolarError(f"Solar가 JSON 아닌 응답 반환: {content[:500]}") from e
