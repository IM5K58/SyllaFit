// 내 플랜(에이전트 추천 저장) CRUD — 본인 세션으로만.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  dbEnabled, listAgentItems, addAgentItems, updateAgentItem, deleteAgentItem, logEvent,
} from "@/app/lib/db";

async function requireEmail(): Promise<string | null> {
  return (await auth())?.user?.email ?? null;
}

export async function GET() {
  const email = await requireEmail();
  if (!email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!dbEnabled) return NextResponse.json({ items: [] });
  return NextResponse.json({ items: await listAgentItems(email) });
}

const STATUSES = new Set(["예정", "진행", "완료"]);

export async function POST(req: Request) {
  const email = await requireEmail();
  if (!email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!dbEnabled) return NextResponse.json({ error: "db_not_configured" }, { status: 501 });
  const b = await req.json().catch(() => null);
  const raw = Array.isArray(b?.items) ? b.items : [];
  const items = raw
    .filter((it: Record<string, unknown>) =>
      typeof it?.title === "string" && typeof it?.url === "string" && (it.url as string).startsWith("http"))
    .map((it: Record<string, unknown>) => ({
      category: String(it.category ?? "행사·특강").slice(0, 20),
      title: String(it.title).slice(0, 120),
      reason: String(it.reason ?? "").slice(0, 300),
      url: String(it.url).slice(0, 500),
      date_text: it.date_text ? String(it.date_text).slice(0, 60) : null,
    }));
  if (!items.length) return NextResponse.json({ error: "empty" }, { status: 400 });
  await addAgentItems(email, items);
  await logEvent("agent_save", { n: items.length }, null, email).catch(() => {});
  return NextResponse.json({ ok: true, items: await listAgentItems(email) });
}

export async function PATCH(req: Request) {
  const email = await requireEmail();
  if (!email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!dbEnabled) return NextResponse.json({ error: "db_not_configured" }, { status: 501 });
  const b = await req.json().catch(() => null);
  const id = Number(b?.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const patch: { status?: string; memo?: string } = {};
  if (typeof b?.status === "string" && STATUSES.has(b.status)) patch.status = b.status;
  if (typeof b?.memo === "string") patch.memo = b.memo.slice(0, 200);
  if (!Object.keys(patch).length) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  await updateAgentItem(email, id, patch);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const email = await requireEmail();
  if (!email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!dbEnabled) return NextResponse.json({ error: "db_not_configured" }, { status: 501 });
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  await deleteAgentItem(email, id);
  return NextResponse.json({ ok: true });
}
