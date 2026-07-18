// 로그인 사용자의 시간표 저장/불러오기. 세션(email)으로 보호.
// DATABASE_URL 미설정 시 501 → 프론트는 클라우드 비활성으로 간주(임시저장 유지).
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { dbEnabled, getUserData, putUserData, type UserData } from "@/app/lib/db";

async function requireEmail(): Promise<string | null> {
  const session = await auth();
  return session?.user?.email ?? null;
}

function sanitize(body: unknown): UserData {
  const b = (body ?? {}) as Record<string, unknown>;
  const working = Array.isArray(b.working)
    ? b.working.filter((k): k is string => typeof k === "string").slice(0, 100)
    : [];
  const library = Array.isArray(b.library)
    ? b.library
        .filter((s): s is { name: string; keys: string[]; savedAt: string } =>
          !!s && typeof (s as Record<string, unknown>).name === "string" &&
          Array.isArray((s as Record<string, unknown>).keys))
        .map((s) => ({
          name: String(s.name).slice(0, 40),
          keys: s.keys.filter((k): k is string => typeof k === "string").slice(0, 100),
          savedAt: typeof s.savedAt === "string" ? s.savedAt : "",
        }))
        .slice(0, 50)
    : [];
  return { working, library };
}

export async function GET() {
  const email = await requireEmail();
  if (!email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!dbEnabled) return NextResponse.json({ error: "db_not_configured" }, { status: 501 });
  try {
    return NextResponse.json(await getUserData(email));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const email = await requireEmail();
  if (!email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!dbEnabled) return NextResponse.json({ error: "db_not_configured" }, { status: 501 });
  try {
    const body = await req.json().catch(() => null);
    await putUserData(email, sanitize(body));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
