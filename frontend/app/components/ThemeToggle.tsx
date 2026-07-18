"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

// 현재 적용된 테마 판정 (수동 설정 우선, 없으면 시스템)
function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  const set = document.documentElement.getAttribute("data-theme");
  if (set === "light" || set === "dark") return set;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(currentTheme());
    setMounted(true);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* 저장 실패 무시 */
    }
  }

  // 하이드레이션 불일치 방지: 마운트 전엔 중립 렌더
  const label = !mounted ? "◐" : theme === "dark" ? "☀︎" : "☾";
  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      aria-label="다크/라이트 모드 전환"
      title={theme === "dark" ? "라이트 모드로" : "다크 모드로"}
      suppressHydrationWarning
    >
      {label}
    </button>
  );
}
