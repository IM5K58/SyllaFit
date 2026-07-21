// 관리자 페이지 — ADMIN_EMAILS 에 있는 계정만. 통계 + 공지 관리.
import Link from "next/link";
import { auth } from "@/auth";
import { isAdminEmail } from "@/app/lib/admin";
import {
  dbEnabled, getStats, getAllNotices, getEventStats, getAgentAdminStats,
  type EventStats, type AgentAdminStats,
} from "@/app/lib/db";
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

  // DB 호출이 실패해도 페이지 자체는 뜨게(빈 상태로) — 500 크래시 방지.
  let stats = null;
  let notices: Awaited<ReturnType<typeof getAllNotices>> = [];
  let events: EventStats | null = null;
  let agentStats: AgentAdminStats | null = null;
  let dbError: string | null = null;
  if (dbEnabled) {
    try {
      [stats, notices, events, agentStats] = await Promise.all([
        getStats(), getAllNotices(), getEventStats(), getAgentAdminStats(),
      ]);
    } catch (e) {
      dbError = String(e);
    }
  }

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
        ) : !stats ? (
          <p className="muted">통계를 불러오지 못했어요. (DB 오류: {dbError?.slice(0, 200)})</p>
        ) : (
          <div className="row" style={{ gap: 24, flexWrap: "wrap" }}>
            <Stat label="로그인 사용자" value={stats.users} />
            <Stat label="저장된 시간표" value={stats.savedTimetables} />
            <Stat label="작성 중 시간표" value={stats.activeWorking} />
          </div>
        )}
        <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>
          방문자·페이지뷰 등 트래픽 통계는 Vercel 대시보드 → Analytics 에서 확인하세요.
        </p>
      </div>

      {/* 행동 통계 */}
      <div className="panel">
        <div className="h-sec"><span className="step">2</span>행동 통계</div>
        {!events || events.totalEvents === 0 ? (
          <p className="muted">아직 수집된 이벤트가 없어요. (배포 후 사용자가 도구를 쓰면 쌓여요)</p>
        ) : (
          <>
            {/* 퍼널 + 재방문율 */}
            <div className="row" style={{ gap: 20, flexWrap: "wrap", marginBottom: 16 }}>
              <Stat label="도구 방문" value={events.funnel.visits} />
              <Stat label="AI 시간표 생성" value={events.funnel.aiGenerate} />
              <Stat label="로그인 세션" value={events.funnel.logins} />
              <Stat label="시간표 저장" value={events.funnel.saves} />
              <RetentionStat total={events.retention.totalSessions} returning={events.retention.returningSessions} />
            </div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
              고유 세션 {events.uniqueSessions.toLocaleString()} · 총 이벤트 {events.totalEvents.toLocaleString()}
              {" · 재방문 세션 "}{events.retention.returningSessions.toLocaleString()}/{events.retention.totalSessions.toLocaleString()}
              {" (2일 이상 방문)"}
            </div>

            {/* 날짜별 추이 */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>날짜별 추이 (최근 14일)</div>
              {events.daily.length === 0 ? (
                <p className="muted" style={{ fontSize: 13 }}>아직 없어요.</p>
              ) : (
                <DailyChart data={events.daily} />
              )}
            </div>

            <div className="row" style={{ gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
              {/* 이벤트별 */}
              <div style={{ flex: "1 1 220px" }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>이벤트별 발생 수</div>
                {events.byName.map((e) => (
                  <div key={e.name} className="row" style={{ justifyContent: "space-between", padding: "3px 0", fontSize: 13 }}>
                    <span className="muted">{eventLabel(e.name)}</span>
                    <b>{e.n.toLocaleString()}</b>
                  </div>
                ))}
              </div>
              {/* 인기 검색어 */}
              <div style={{ flex: "1 1 220px" }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>인기 검색어 TOP 10</div>
                {events.topSearch.length === 0 ? (
                  <p className="muted" style={{ fontSize: 13 }}>아직 없어요.</p>
                ) : events.topSearch.map((s, i) => (
                  <div key={s.q} className="row" style={{ justifyContent: "space-between", padding: "3px 0", fontSize: 13 }}>
                    <span className="muted">{i + 1}. {s.q}</span>
                    <b>{s.n.toLocaleString()}</b>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* 학교생활 에이전트 통계 */}
      <div className="panel">
        <div className="h-sec"><span className="step">3</span>학교생활 에이전트</div>
        {!agentStats || agentStats.runs === 0 ? (
          <p className="muted">아직 실행 기록이 없어요. 사용자가 에이전트를 쓰면 여기 쌓여요.</p>
        ) : (
          <>
            {/* 규모 + 전환 */}
            <div className="row" style={{ gap: 20, flexWrap: "wrap", marginBottom: 6 }}>
              <Stat label="총 실행" value={agentStats.runs} />
              <Stat label="실행 사용자" value={agentStats.runUsers} />
              <RateStat label="실행→저장 전환율"
                num={agentStats.saveUsers} den={agentStats.runUsers} />
              <Stat label="저장된 플랜" value={agentStats.savedTotal} />
            </div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
              실행당 평균 추천 {agentStats.avgItems}개
              {" · 빈 결과 실행 "}{agentStats.emptyRuns}회
              {agentStats.runs > 0 && ` (${Math.round((agentStats.emptyRuns / agentStats.runs) * 100)}% — 오르면 검색 프롬프트 점검)`}
              {agentStats.planUsers > 0 &&
                ` · 플랜 보유 ${agentStats.planUsers}명 (인당 평균 ${Math.round((agentStats.savedTotal / agentStats.planUsers) * 10) / 10}개)`}
            </div>

            <div className="row" style={{ gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
              <CountList title="저장 카테고리 분포" rows={agentStats.categories} total={agentStats.savedTotal} />
              <CountList title="플랜 상태" rows={agentStats.statuses} total={agentStats.savedTotal} />
              <CountList title="학과 TOP" rows={agentStats.majors} />
              <CountList title="학년 분포" rows={agentStats.grades} />
            </div>
          </>
        )}
      </div>

      {/* 공지 관리 */}
      <div className="panel">
        <div className="h-sec"><span className="step">4</span>공지사항 관리</div>
        {!dbEnabled ? (
          <p className="muted">DATABASE_URL 을 설정하면 공지를 등록할 수 있어요.</p>
        ) : (
          <AdminNotices initial={notices} />
        )}
      </div>
    </div>
  );
}

function eventLabel(name: string): string {
  const m: Record<string, string> = {
    tool_view: "도구 방문", tab: "탭 전환", search: "검색", ai_generate: "AI 시간표 생성",
    save: "시간표 저장", backup_generate: "실패대비 생성", login: "로그인", advise: "AI 검토",
    agent_run: "에이전트 실행", agent_save: "플랜 저장",
  };
  return m[name] || name;
}

function RateStat({ label, num, den }: { label: string; num: number; den: number }) {
  const rate = den > 0 ? Math.round((num / den) * 100) : 0;
  return (
    <div>
      <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--accent)" }}>{rate}%</div>
      <div className="muted" style={{ fontSize: 13 }}>{label} ({num}/{den})</div>
    </div>
  );
}

function CountList({ title, rows, total }: { title: string; rows: { name: string; n: number }[]; total?: number }) {
  return (
    <div style={{ flex: "1 1 180px", minWidth: 160 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{title}</div>
      {rows.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>아직 없어요.</p>
      ) : rows.map((r) => (
        <div key={r.name} className="row" style={{ justifyContent: "space-between", padding: "3px 0", fontSize: 13 }}>
          <span className="muted">{r.name}</span>
          <b>
            {r.n.toLocaleString()}
            {total && total > 0 ? <span className="muted" style={{ fontWeight: 400 }}> ({Math.round((r.n / total) * 100)}%)</span> : null}
          </b>
        </div>
      ))}
    </div>
  );
}

function RetentionStat({ total, returning }: { total: number; returning: number }) {
  const rate = total > 0 ? Math.round((returning / total) * 100) : 0;
  return (
    <div>
      <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--accent)" }}>{rate}%</div>
      <div className="muted" style={{ fontSize: 13 }}>재방문율</div>
    </div>
  );
}

// 날짜별 방문 막대 + 세션 수(작은 라벨). 차트 라이브러리 없이 CSS 막대.
function DailyChart({ data }: { data: { day: string; visits: number; ai: number; saves: number; sessions: number; agent: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.visits));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 130, overflowX: "auto", paddingBottom: 2 }}>
      {data.map((d) => (
        <div key={d.day} style={{ flex: "1 0 34px", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700 }}>{d.visits}</span>
          <div
            title={`${d.day} · 방문 ${d.visits} · AI ${d.ai} · 저장 ${d.saves} · 에이전트 ${d.agent} · 세션 ${d.sessions}`}
            style={{
              width: "100%", maxWidth: 26,
              height: `${Math.round((d.visits / max) * 96)}px`,
              minHeight: 3, borderRadius: 5,
              background: "var(--accent)",
            }}
          />
          <span className="muted" style={{ fontSize: 10 }}>{d.day}</span>
        </div>
      ))}
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
