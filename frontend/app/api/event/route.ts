// 익명 행동 이벤트 수집(fire-and-forget). 개인정보 없음 — 세션 id + (로그인 시)이메일만.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { dbEnabled, logEvent } from "@/app/lib/db";

const ALLOWED = new Set([
  "tool_view", "tab", "search", "ai_generate", "save", "backup_generate", "login", "advise",
]);

export async function POST(req: Request) {
  if (!dbEnabled) return NextResponse.json({ ok: false });
  try {
    const b = await req.json().catch(() => null);
    const name = typeof b?.name === "string" ? b.name : "";
    if (!ALLOWED.has(name)) return NextResponse.json({ ok: false }, { status: 400 });
    const props = b?.props && typeof b.props === "object" ? b.props : {};
    const session = typeof b?.session === "string" ? b.session.slice(0, 40) : null;
    // 이메일은 클라이언트가 아니라 서버 세션에서(신뢰) — 로그인 안 했으면 null
    let email: string | null = null;
    try { email = (await auth())?.user?.email ?? null; } catch { /* 무시 */ }
    await logEvent(name, props, session, email);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }); // 수집 실패는 조용히
  }
}
