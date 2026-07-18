"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// 선택 로그인 — 앱바에 로그인/프로필 표시. 열람은 로그인 없이도 가능.
export default function AuthButton() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 메뉴 바깥 클릭 / Esc → 닫기
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (status === "loading") {
    return <span className="muted" style={{ fontSize: 13 }}>…</span>;
  }

  if (!session?.user) {
    return (
      <button
        className="mini"
        onClick={() => signIn("google", { callbackUrl: "/tool" })}
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        <GoogleMark />
        <span>로그인</span>
      </button>
    );
  }

  const user = session.user;
  const initial = (user.name || user.email || "?").trim().charAt(0).toUpperCase();

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        className="avatar-btn"
        onClick={() => setOpen((v) => !v)}
        title={user.email || undefined}
        aria-label="계정 메뉴"
      >
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.image} alt="" width={28} height={28} style={{ borderRadius: "50%" }} />
        ) : (
          <span className="avatar-fallback">{initial}</span>
        )}
      </button>
      {open && (
        <div className="account-menu">
          <div style={{ padding: "4px 10px 8px" }}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>{user.name || "인하대생"}</div>
            <div className="muted" style={{ fontSize: 12 }}>{user.email}</div>
          </div>
          <button
            className="menu-item"
            onClick={() => { setOpen(false); router.push("/tool?tab=my"); }}
          >
            마이페이지
          </button>
          <button className="menu-item" onClick={() => signOut({ callbackUrl: "/tool" })}>
            로그아웃
          </button>
        </div>
      )}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
