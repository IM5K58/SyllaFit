// Auth.js (NextAuth v5) — Google 로그인 + @inha.edu 도메인 제한.
// 세션은 JWT(기본) — 로그인 자체는 DB 불필요. 사용자 저장 데이터는 별도 API/DB(Phase 2).
//
// 필요한 env (프론트 서버 전용, 클라이언트 노출 금지):
//   AUTH_SECRET          — 세션 서명 키 (openssl rand -base64 33)
//   AUTH_GOOGLE_ID       — Google OAuth 클라이언트 ID
//   AUTH_GOOGLE_SECRET   — Google OAuth 클라이언트 시크릿
//   ALLOWED_EMAIL_DOMAINS — 허용 이메일 도메인(쉼표). 미지정 시 inha.edu
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// 허용 도메인 — 인하대 계정만. 필요 시 env로 inha.ac.kr 등 추가.
export const ALLOWED_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS || "inha.edu")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

function emailAllowed(email?: string | null, hd?: string | null): boolean {
  const domain = (email || "").toLowerCase().split("@")[1] || "";
  const workspace = (hd || "").toLowerCase();
  return ALLOWED_DOMAINS.includes(domain) || ALLOWED_DOMAINS.includes(workspace);
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  // 프록시/셀프호스트 뒤에서도 host 신뢰(콜백 URL은 Google 화이트리스트가 최종 방어).
  // Vercel은 자동 신뢰하지만 Render·로컬 prod 등 어디서든 동작하게 명시.
  trustHost: true,
  providers: [
    Google({
      // hd: 구글 계정 선택창을 해당 워크스페이스로 유도(UX). 실제 차단은 signIn 콜백이 담당.
      authorization: {
        params: { hd: ALLOWED_DOMAINS[0], prompt: "select_account" },
      },
    }),
  ],
  callbacks: {
    // 도메인 게이트 — @inha.edu 아니면 로그인 거부(AccessDenied).
    // (Phase 2 사용자 저장은 session.user.email 을 키로 사용 → 별도 id 불필요)
    async signIn({ profile }) {
      return emailAllowed(profile?.email, (profile as { hd?: string })?.hd);
    },
  },
  pages: {
    error: "/auth-error", // 도메인 거부 시 커스텀 안내 페이지
  },
});
