// 학교생활 에이전트 실행 — 로그인 필수 + 일일 제한 후 백엔드(FastAPI)로 프록시.
// 로그인·제한을 여기(Next 서버)서 걸고, 백엔드는 AGENT_INTERNAL_KEY로만 열린다.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { dbEnabled, countTodayEvents, logEvent } from "@/app/lib/db";

const BACKEND = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
const DAILY_LIMIT = Number(process.env.AGENT_DAILY_LIMIT || 10);

export const maxDuration = 120; // 에이전트 실행 ~60초 — 서버리스 타임아웃 여유

export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // 일일 실행 제한 (DB 없으면 제한 못 세므로 로컬 개발은 통과)
  let used = 0;
  if (dbEnabled) {
    used = await countTodayEvents("agent_run", email);
    if (used >= DAILY_LIMIT) {
      return NextResponse.json(
        { error: "daily_limit", message: `오늘 실행 횟수(${DAILY_LIMIT}회)를 다 썼어요. 내일 다시 만나요!` },
        { status: 429 },
      );
    }
  }

  const body = await req.json().catch(() => null);
  const profile = body?.profile && typeof body.profile === "object" ? body.profile : {};
  const timetable_summary = typeof body?.timetable_summary === "string" ? body.timetable_summary : "";

  // Render 무료 플랜은 재시작·콜드스타트 중 연결이 튕길 수 있어 1회 재시도 (총 예산 ~105초)
  async function callBackend(timeoutMs: number): Promise<Response> {
    return fetch(`${BACKEND}/agent/plan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.AGENT_INTERNAL_KEY ? { "X-Internal-Key": process.env.AGENT_INTERNAL_KEY } : {}),
      },
      body: JSON.stringify({ profile, timetable_summary }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  }
  let r: Response;
  try {
    r = await callBackend(95_000);
  } catch {
    try {
      await new Promise((res) => setTimeout(res, 3_000));
      r = await callBackend(90_000);
    } catch {
      return NextResponse.json(
        { error: "backend_unreachable", message: "에이전트 서버가 잠에서 깨는 중일 수 있어요. 30초 뒤 다시 실행해 주세요." },
        { status: 502 },
      );
    }
  }

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    return NextResponse.json({ error: "agent_failed", message: data?.detail || "에이전트 실행에 실패했어요." }, { status: r.status });
  }

  // 성공한 실행만 카운트 (실패는 횟수 안 깎음)
  if (dbEnabled) {
    await logEvent("agent_run", { items: data.items?.length ?? 0 }, null, email).catch(() => {});
    used += 1;
  }
  return NextResponse.json({ ...data, runs_left: dbEnabled ? DAILY_LIMIT - used : null });
}
