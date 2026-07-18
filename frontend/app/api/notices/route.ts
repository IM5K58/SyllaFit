// 공지사항. GET=공개(활성 공지), POST/PATCH/DELETE=관리자 전용.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminEmail } from "@/app/lib/admin";
import {
  dbEnabled, getActiveNotices, getAllNotices, createNotice, setNoticeActive, deleteNotice,
} from "@/app/lib/db";

async function requireAdmin(): Promise<boolean> {
  const session = await auth();
  return isAdminEmail(session?.user?.email);
}

// 공개: 배너에 표시할 활성 공지. 관리자면 ?all=1 로 전체.
export async function GET(req: Request) {
  if (!dbEnabled) return NextResponse.json({ notices: [] });
  const all = new URL(req.url).searchParams.get("all") === "1";
  if (all) {
    if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    return NextResponse.json({ notices: await getAllNotices() });
  }
  return NextResponse.json({ notices: await getActiveNotices() });
}

export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const body = typeof b?.body === "string" ? b.body.trim().slice(0, 500) : "";
  const level = b?.level === "update" ? "update" : "info";
  if (!body) return NextResponse.json({ error: "empty" }, { status: 400 });
  await createNotice(body, level);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const id = Number(b?.id);
  if (!Number.isInteger(id) || typeof b?.active !== "boolean")
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  await setNoticeActive(id, b.active);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  await deleteNotice(id);
  return NextResponse.json({ ok: true });
}
