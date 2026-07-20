"use client";

import { useSession, signOut } from "next-auth/react";
import { useState } from "react";

// 마이페이지 > 설정 — 계정 정보 + 회원 탈퇴(되돌릴 수 없음).
export default function AccountSettings() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);   // 탈퇴 경고 펼침
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (status === "loading") return <p className="muted">불러오는 중…</p>;

  const email = session?.user?.email;
  if (!email) {
    return (
      <p className="muted">
        로그인하면 계정 설정을 볼 수 있어요. (우측 상단에서 인하대 계정으로 로그인)
      </p>
    );
  }

  async function withdraw() {
    if (busy) return;
    // 되돌릴 수 없는 작업 — 마지막 확인
    if (!window.confirm("정말 탈퇴할까요?\n저장된 시간표가 모두 삭제되며 되돌릴 수 없어요.")) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/account", { method: "DELETE" });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      // 삭제 성공 → 로그아웃하며 홈으로 (메모리 상태도 함께 초기화됨)
      await signOut({ callbackUrl: "/" });
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  }

  return (
    <>
      {/* 계정 정보 */}
      <div style={{ marginBottom: 18 }}>
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 3 }}>로그인 계정</div>
        <div style={{ fontWeight: 700 }}>{session.user?.name || "인하대생"}</div>
        <div className="muted" style={{ fontSize: 13 }}>{email}</div>
      </div>

      {/* 위험 구역 */}
      <div style={{
        border: "1px solid var(--danger)", borderRadius: 12, padding: 14,
        background: "var(--danger-weak)",
      }}>
        <div style={{ fontWeight: 700, color: "var(--danger)", marginBottom: 4 }}>회원 탈퇴</div>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.65, marginBottom: 10 }}>
          탈퇴하면 <b>저장된 시간표와 보관함이 모두 삭제</b>되고 되돌릴 수 없어요.
          (다시 로그인해도 복구되지 않아요)
        </p>

        {!open ? (
          <button className="mini" onClick={() => setOpen(true)}>회원 탈퇴하기</button>
        ) : (
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button
              className="mini"
              onClick={withdraw}
              disabled={busy}
              style={{ borderColor: "var(--danger)", color: "var(--danger)", fontWeight: 700 }}
            >
              {busy ? "탈퇴 처리 중…" : "네, 탈퇴할게요"}
            </button>
            <button className="mini" onClick={() => setOpen(false)} disabled={busy}>취소</button>
          </div>
        )}
        {err && (
          <div className="violation" style={{ marginTop: 8 }}>
            탈퇴에 실패했어요: {err}
          </div>
        )}
      </div>
    </>
  );
}
