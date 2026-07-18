"use client";

import { useEffect, useState } from "react";

interface Notice { id: number; body: string; level: string; }

// 활성 공지를 상단에 표시. 닫기 상태는 브라우저에 기억(공지 id 기준) — UI 설정이라 localStorage OK.
export default function NoticeBanner() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem("dismissed-notices") || "[]");
      if (Array.isArray(d)) setDismissed(new Set(d.filter((x) => typeof x === "number")));
    } catch { /* 무시 */ }
    fetch("/api/notices")
      .then((r) => (r.ok ? r.json() : { notices: [] }))
      .then((d) => setNotices(Array.isArray(d.notices) ? d.notices : []))
      .catch(() => { /* 조용히 무시 */ });
  }, []);

  function dismiss(id: number) {
    setDismissed((prev) => {
      const next = new Set(prev).add(id);
      try { localStorage.setItem("dismissed-notices", JSON.stringify([...next])); } catch { /* 무시 */ }
      return next;
    });
  }

  const visible = notices.filter((n) => !dismissed.has(n.id));
  if (visible.length === 0) return null;

  return (
    <div style={{ marginBottom: 14, display: "flex", flexDirection: "column", gap: 8 }}>
      {visible.map((n) => (
        <div key={n.id} className={`notice notice-${n.level === "update" ? "update" : "info"}`}>
          <span className="notice-tag">{n.level === "update" ? "업데이트" : "공지"}</span>
          <span style={{ flex: 1, whiteSpace: "pre-wrap" }}>{n.body}</span>
          <button className="notice-x" onClick={() => dismiss(n.id)} aria-label="닫기">✕</button>
        </div>
      ))}
    </div>
  );
}
