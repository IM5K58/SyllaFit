// 회원 탈퇴 — 본인 세션으로만 자기 계정 삭제 가능.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { dbEnabled, deleteUserAccount } from "@/app/lib/db";

export async function DELETE() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!dbEnabled) return NextResponse.json({ error: "db_not_configured" }, { status: 501 });
  try {
    await deleteUserAccount(email);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
