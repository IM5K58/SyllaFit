"use client";

// 행동 이벤트 로깅 — 익명 세션 id로 /api/event 에 전송(fire-and-forget).
// 실패해도 앱에 영향 없음. 개인정보 안 담음.

function sessionId(): string {
  try {
    let s = sessionStorage.getItem("sf-sid");
    if (!s) {
      s = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem("sf-sid", s);
    }
    return s;
  } catch {
    return "anon";
  }
}

export function logEvent(name: string, props?: Record<string, unknown>): void {
  try {
    fetch("/api/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, props: props || {}, session: sessionId() }),
      keepalive: true, // 페이지 이탈 중에도 전송 보장
    }).catch(() => {});
  } catch {
    /* 무시 */
  }
}
