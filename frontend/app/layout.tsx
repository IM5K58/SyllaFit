import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "pretendard/dist/web/variable/pretendardvariable.css";
import "./globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "SyllaFit — AI가 짜주는 내 강의시간표 (인하대)",
  description:
    "인하대생을 위한 AI 수강 플랫폼. 강의계획서를 읽어 과제·팀플·평가 기준으로 시간표를 랭킹하고 수강신청 실패까지 대비합니다.",
};

// 페인트 전에 저장된 테마를 적용 → 다크/라이트 깜빡임(FOUC) 방지.
const noFlash = `(function(){try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlash }} />
      </head>
      <body><Providers>{children}</Providers><Analytics /></body>
    </html>
  );
}
