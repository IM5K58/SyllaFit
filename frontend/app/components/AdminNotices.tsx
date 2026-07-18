"use client";

import { useState } from "react";

interface Notice { id: number; body: string; level: string; active: boolean; created_at: string; }

export default function AdminNotices({ initial }: { initial: Notice[] }) {
  const [notices, setNotices] = useState<Notice[]>(initial);
  const [body, setBody] = useState("");
  const [level, setLevel] = useState<"info" | "update">("info");
  const [busy, setBusy] = useState(false);

  async function reload() {
    const r = await fetch("/api/notices?all=1");
    if (r.ok) setNotices((await r.json()).notices || []);
  }

  async function create() {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      await fetch("/api/notices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: body.trim(), level }),
      });
      setBody("");
      await reload();
    } finally { setBusy(false); }
  }

  async function toggle(n: Notice) {
    await fetch("/api/notices", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: n.id, active: !n.active }),
    });
    reload();
  }

  async function remove(id: number) {
    if (!window.confirm("이 공지를 삭제할까요?")) return;
    await fetch(`/api/notices?id=${id}`, { method: "DELETE" });
    reload();
  }

  return (
    <>
      {/* 새 공지 작성 */}
      <div style={{ marginBottom: 14 }}>
        <textarea
          rows={2}
          placeholder="공지 내용 (예: 8/25 수강신청 대비 서비스 점검 안내)"
          value={body}
          maxLength={500}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <select value={level} onChange={(e) => setLevel(e.target.value as "info" | "update")}
            style={{ width: 130 }}>
            <option value="info">공지</option>
            <option value="update">업데이트</option>
          </select>
          <button className="primary" onClick={create} disabled={busy || !body.trim()}>
            {busy ? "등록 중…" : "공지 등록"}
          </button>
        </div>
      </div>

      {/* 목록 */}
      {notices.length === 0 ? (
        <p className="muted">등록된 공지가 없어요.</p>
      ) : (
        notices.map((n) => (
          <div key={n.id} className="row"
            style={{ justifyContent: "space-between", gap: 10, padding: "9px 0", borderTop: "1px solid var(--border)" }}>
            <span style={{ flex: 1, opacity: n.active ? 1 : 0.5 }}>
              <span className="notice-tag" style={{ marginRight: 6 }}>
                {n.level === "update" ? "업데이트" : "공지"}
              </span>
              {n.body}
              <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>
                {n.created_at?.slice(0, 10)}{n.active ? "" : " · 숨김"}
              </span>
            </span>
            <span className="row" style={{ gap: 6 }}>
              <button className="mini" onClick={() => toggle(n)}>{n.active ? "숨기기" : "게시"}</button>
              <button className="mini" onClick={() => remove(n.id)}>삭제</button>
            </span>
          </div>
        ))
      )}
    </>
  );
}
