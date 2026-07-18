// 관리자 페이지 — ADMIN_EMAILS 에 있는 계정만. 통계 + 공지 관리.
import Link from "next/link";
import { auth } from "@/auth";
import { isAdminEmail } from "@/app/lib/admin";
import { dbEnabled, getStats, getAllNotices } from "@/app/lib/db";
import AdminNotices from "../components/AdminNotices";

export const dynamic = "force-dynamic"; // 세션·DB 실시간 조회

export default async function AdminPage() {
  const session = await auth();
  const email = session?.user?.email;

  if (!isAdminEmail(email)) {
    return (
      <div className="container" style={{ maxWidth: 460, paddingTop: 80, textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>🔒</div>
        <h1 style={{ fontSize: 19, fontWeight: 800, marginBottom: 8 }}>접근 권한이 없어요</h1>
        <p className="muted" style={{ marginBottom: 20 }}>
          {email ? `${email} 계정은 관리자가 아니에요.` : "관리자 계정으로 로그인해 주세요."}
        </p>
        <Link href="/tool" className="ghost-btn" style={{ display: "inline-block", width: "auto", padding: "10px 20px" }}>
          도구로 돌아가기
        </Link>
      </div>
    );
  }

  const stats = dbEnabled ? await getStats() : null;
  const notices = dbEnabled ? await getAllNotices() : [];

  return (
    <div className="container" style={{ maxWidth: 760, paddingTop: 36 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>관리자</h1>
        <Link href="/tool" className="mini" style={{ textDecoration: "none" }}>← 도구</Link>
      </div>

      {/* 통계 */}
      <div className="panel">
        <div className="h-sec"><span className="step">1</span>통계</div>
        {!dbEnabled ? (
          <p className="muted">DATABASE_URL 미설정 — DB 통계를 볼 수 없어요.</p>
        ) : (
          <div className="row" style={{ gap: 24, flexWrap: "wrap" }}>
            <Stat label="로그인 사용자" value={stats!.users} />
            <Stat label="저장된 시간표" value={stats!.savedTimetables} />
            <Stat label="작성 중 시간표" value={stats!.activeWorking} />
          </div>
        )}
        <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>
          방문자·페이지뷰 등 트래픽 통계는 Vercel 대시보드 → Analytics 에서 확인하세요.
        </p>
      </div>

      {/* 공지 관리 */}
      <div className="panel">
        <div className="h-sec"><span className="step">2</span>공지사항 관리</div>
        {!dbEnabled ? (
          <p className="muted">DATABASE_URL 을 설정하면 공지를 등록할 수 있어요.</p>
        ) : (
          <AdminNotices initial={notices} />
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em" }}>{value.toLocaleString()}</div>
      <div className="muted" style={{ fontSize: 13 }}>{label}</div>
    </div>
  );
}
