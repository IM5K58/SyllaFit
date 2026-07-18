import Link from "next/link";

// Auth.js 에러 페이지 — 주로 @inha.edu 아닌 계정 로그인 시도(AccessDenied).
export default function AuthError({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return <ErrorBody searchParams={searchParams} />;
}

async function ErrorBody({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const denied = error === "AccessDenied";
  return (
    <div className="container" style={{ maxWidth: 460, paddingTop: 80, textAlign: "center" }}>
      <div style={{ fontSize: 34, marginBottom: 12 }}>{denied ? "🎓" : "⚠️"}</div>
      <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 10 }}>
        {denied ? "인하대 계정으로만 로그인할 수 있어요" : "로그인 중 문제가 생겼어요"}
      </h1>
      <p className="muted" style={{ lineHeight: 1.7, marginBottom: 22 }}>
        {denied
          ? "SyllaFit은 인하대 재학생 전용이에요. @inha.edu 계정으로 다시 로그인해 주세요."
          : "잠시 후 다시 시도해 주세요. 계속 안 되면 버그 제보로 알려주세요."}
      </p>
      <Link href="/tool" className="ghost-btn" style={{ display: "inline-block", width: "auto", padding: "11px 22px" }}>
        도구로 돌아가기
      </Link>
    </div>
  );
}
