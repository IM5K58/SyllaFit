// 학교생활 에이전트 실행 — 로그인 필수 + 일일 제한 후 백엔드(FastAPI)로 프록시.
// 로그인·제한을 여기(Next 서버)서 걸고, 백엔드는 AGENT_INTERNAL_KEY로만 열린다.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { dbEnabled, countTodayEvents, logEvent } from "@/app/lib/db";

const BACKEND = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
const DAILY_LIMIT = Number(process.env.AGENT_DAILY_LIMIT || 10);

// Vercel Hobby 플랜의 함수 실행 상한은 60초다(그 이상 적어도 60초에서 강제 종료).
// 백엔드 에이전트는 TIME_BUDGET=45초를 목표로 스스로 단계를 줄인다.
export const maxDuration = 60;
// 60초 안에서 쓸 총 예산. 응답 직렬화·이벤트 기록 몫을 남겨 더 작게 잡는다.
const BUDGET_MS = 55_000;

export async function POST(req: Request) {
  const started = Date.now();
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

  // 예산 관리: maxDuration(120초) 안에서만 재시도한다.
  // 종전엔 95초 타임아웃 뒤 90초를 더 기다려(합 188초) 재시도가 Vercel에 강제 종료됐다.
  // 콜드스타트는 '빠르게' 실패하므로, 타임아웃이 아닐 때만 예산이 남았으면 1회 재시도한다.
  const left = () => BUDGET_MS - (Date.now() - started);
  let r: Response | null = null;
  let timedOut = false;
  try {
    r = await callBackend(Math.max(10_000, left() - 3_000));
  } catch (e) {
    timedOut = e instanceof DOMException && e.name === "TimeoutError";
    // 재시도는 콜드스타트('빠르게 실패')용. 예산이 넉넉할 때만 — Hobby는 60초뿐이다.
    if (!timedOut && left() > 30_000) {
      try {
        await new Promise((res) => setTimeout(res, 3_000));
        r = await callBackend(left() - 5_000);
      } catch {
        r = null;
      }
    }
  }
  if (!r) {
    return timedOut
      ? NextResponse.json(
          { error: "agent_timeout", message: "에이전트가 시간 내에 끝나지 않았어요. 목표를 조금 더 구체적으로 적고 다시 실행해 주세요." },
          { status: 504 },
        )
      : NextResponse.json(
          { error: "backend_unreachable", message: "에이전트 서버가 잠에서 깨는 중일 수 있어요. 30초 뒤 다시 실행해 주세요." },
          { status: 502 },
        );
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
