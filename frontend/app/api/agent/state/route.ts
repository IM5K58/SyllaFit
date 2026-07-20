// 에이전트 세션 상태 — 마지막 브리핑·프로필을 계정에 보존/복원.
// GET: 복원(+오늘 남은 실행 수) / PUT: 저장(실행·병합 후 클라이언트가 호출) / DELETE: 새 브리핑 시작.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  dbEnabled, getAgentState, putAgentState, clearAgentBriefing, countTodayEvents,
} from "@/app/lib/db";

const DAILY_LIMIT = Number(process.env.AGENT_DAILY_LIMIT || 10);

async function requireEmail(): Promise<string | null> {
  return (await auth())?.user?.email ?? null;
}

export async function GET() {
  const email = await requireEmail();
  if (!email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!dbEnabled) return NextResponse.json({ state: null, runs_left: null });
  const [state, used] = await Promise.all([
    getAgentState(email),
    countTodayEvents("agent_run", email),
  ]);
  return NextResponse.json({ state, runs_left: Math.max(0, DAILY_LIMIT - used) });
}

export async function PUT(req: Request) {
  const email = await requireEmail();
  if (!email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!dbEnabled) return NextResponse.json({ ok: false });
  const b = await req.json().catch(() => null);
  const profile = b?.profile && typeof b.profile === "object" ? b.profile : {};
  const briefing = b?.briefing && typeof b.briefing === "object" ? b.briefing : null;
  // 폭주 방지: 브리핑 JSON 200KB 상한
  if (briefing && JSON.stringify(briefing).length > 200_000)
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  await putAgentState(email, profile, briefing);
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const email = await requireEmail();
  if (!email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!dbEnabled) return NextResponse.json({ ok: false });
  await clearAgentBriefing(email);
  return NextResponse.json({ ok: true });
}
