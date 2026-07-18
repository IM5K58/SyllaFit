// 관리자 판별 — ADMIN_EMAILS(쉼표, 서버 전용)에 있는 이메일만 관리자.
// 미설정이면 아무도 관리자가 아님(안전 기본값).
export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const admins = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.toLowerCase());
}
