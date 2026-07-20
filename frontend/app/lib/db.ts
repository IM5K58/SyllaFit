// 서버 전용 DB 계층 (Neon Postgres). 사용자당 1행에 시간표 상태를 JSON으로 보관.
// DATABASE_URL 미설정이면 dbEnabled=false → 앱은 무저장(임시)으로 정상 동작.
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
const sql = url ? neon(url) : null;

export const dbEnabled = !!sql;

export interface UserData {
  working: string[];              // 지금 짜는 시간표(학수번호-분반)
  library: { name: string; keys: string[]; savedAt: string }[]; // 보관함
}

// 스키마 준비 — 최초 1회만 실행(모듈 캐시). 별도 마이그레이션 불필요.
let ready: Promise<void> | null = null;
function ensureSchema(): Promise<void> {
  if (!sql) return Promise.resolve();
  if (!ready) {
    const s = sql;
    ready = (async () => {
      await s`
        CREATE TABLE IF NOT EXISTS user_data (
          email      text PRIMARY KEY,
          working    jsonb NOT NULL DEFAULT '[]',
          library    jsonb NOT NULL DEFAULT '[]',
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `;
      await s`
        CREATE TABLE IF NOT EXISTS notices (
          id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          body       text NOT NULL,
          level      text NOT NULL DEFAULT 'info',   -- info | update
          active     boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `;
      await s`
        CREATE TABLE IF NOT EXISTS events (
          id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          name       text NOT NULL,               -- tool_view, tab, search, ai_generate, save, backup_generate, login
          props      jsonb NOT NULL DEFAULT '{}',
          session    text,                        -- 익명 세션 id
          email      text,                        -- 로그인 시에만(서버 세션에서)
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `;
      await s`CREATE INDEX IF NOT EXISTS events_name_idx ON events (name)`;
      await s`CREATE INDEX IF NOT EXISTS events_created_idx ON events (created_at)`;
      await s`
        CREATE TABLE IF NOT EXISTS agent_items (
          id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          email      text NOT NULL,
          category   text NOT NULL,
          title      text NOT NULL,
          reason     text NOT NULL DEFAULT '',
          url        text NOT NULL,
          date_text  text,
          status     text NOT NULL DEFAULT '예정',   -- 예정 | 진행 | 완료
          memo       text NOT NULL DEFAULT '',
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `;
      await s`CREATE INDEX IF NOT EXISTS agent_items_email_idx ON agent_items (email)`;
      await s`
        CREATE TABLE IF NOT EXISTS agent_state (
          email      text PRIMARY KEY,
          profile    jsonb NOT NULL DEFAULT '{}',   -- 마지막 입력 프로필 (재방문 프리필)
          briefing   jsonb,                          -- 마지막 브리핑 결과 (세션 복원)
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `;
    })();
  }
  return ready;
}

export async function getUserData(email: string): Promise<UserData> {
  if (!sql) return { working: [], library: [] };
  await ensureSchema();
  const rows = await sql`SELECT working, library FROM user_data WHERE email = ${email}`;
  if (!rows.length) return { working: [], library: [] };
  return {
    working: Array.isArray(rows[0].working) ? rows[0].working : [],
    library: Array.isArray(rows[0].library) ? rows[0].library : [],
  };
}

export async function putUserData(email: string, data: UserData): Promise<void> {
  if (!sql) return;
  await ensureSchema();
  await sql`
    INSERT INTO user_data (email, working, library, updated_at)
    VALUES (${email}, ${JSON.stringify(data.working)}::jsonb, ${JSON.stringify(data.library)}::jsonb, now())
    ON CONFLICT (email) DO UPDATE
      SET working = EXCLUDED.working, library = EXCLUDED.library, updated_at = now()
  `;
}

// 회원 탈퇴 — 저장 데이터 삭제 + 이벤트의 개인식별(email) 제거(익명 집계는 유지).
export async function deleteUserAccount(email: string): Promise<void> {
  if (!sql) return;
  await ensureSchema();
  await sql`DELETE FROM user_data WHERE email = ${email}`;
  await sql`DELETE FROM agent_items WHERE email = ${email}`;
  await sql`DELETE FROM agent_state WHERE email = ${email}`;
  await sql`UPDATE events SET email = NULL WHERE email = ${email}`;
}

// ── 공지사항 ──────────────────────────────────────────────
export interface Notice { id: number; body: string; level: string; active: boolean; created_at: string; }

// Neon 드라이버는 bigint를 문자열, timestamptz를 Date로 반환 → 직렬화·slice 안전하게 정규화.
function normNotice(r: Record<string, unknown>): Notice {
  const ca = r.created_at;
  return {
    id: Number(r.id),
    body: String(r.body ?? ""),
    level: String(r.level ?? "info"),
    active: !!r.active,
    created_at: ca instanceof Date ? ca.toISOString() : String(ca ?? ""),
  };
}

export async function getActiveNotices(): Promise<Notice[]> {
  if (!sql) return [];
  await ensureSchema();
  const rows = await sql`SELECT id, body, level, active, created_at FROM notices WHERE active = true ORDER BY created_at DESC`;
  return rows.map(normNotice);
}

export async function getAllNotices(): Promise<Notice[]> {
  if (!sql) return [];
  await ensureSchema();
  const rows = await sql`SELECT id, body, level, active, created_at FROM notices ORDER BY created_at DESC LIMIT 100`;
  return rows.map(normNotice);
}

export async function createNotice(body: string, level: string): Promise<void> {
  if (!sql) return;
  await ensureSchema();
  await sql`INSERT INTO notices (body, level) VALUES (${body}, ${level})`;
}

export async function setNoticeActive(id: number, active: boolean): Promise<void> {
  if (!sql) return;
  await ensureSchema();
  await sql`UPDATE notices SET active = ${active} WHERE id = ${id}`;
}

export async function deleteNotice(id: number): Promise<void> {
  if (!sql) return;
  await ensureSchema();
  await sql`DELETE FROM notices WHERE id = ${id}`;
}

// ── 관리자 통계 ───────────────────────────────────────────
export interface Stats { users: number; savedTimetables: number; activeWorking: number; }

export async function getStats(): Promise<Stats> {
  if (!sql) return { users: 0, savedTimetables: 0, activeWorking: 0 };
  await ensureSchema();
  // jsonb_typeof 가드: working/library 가 배열이 아니어도 throw 안 나게. FILTER는 괄호로 캐스트 명확화.
  const rows = await sql`
    SELECT
      count(*)::int AS users,
      coalesce(sum(CASE WHEN jsonb_typeof(library) = 'array' THEN jsonb_array_length(library) ELSE 0 END), 0)::int AS saved,
      (count(*) FILTER (WHERE jsonb_typeof(working) = 'array' AND jsonb_array_length(working) > 0))::int AS active_working
    FROM user_data
  `;
  const r = rows[0] || {};
  return {
    users: Number(r.users ?? 0),
    savedTimetables: Number(r.saved ?? 0),
    activeWorking: Number(r.active_working ?? 0),
  };
}

// ── 학교생활 에이전트: 내 플랜 ─────────────────────────────
export interface AgentItem {
  id: number; category: string; title: string; reason: string;
  url: string; date_text: string | null; status: string; memo: string; created_at: string;
}

function normAgentItem(r: Record<string, unknown>): AgentItem {
  const ca = r.created_at;
  return {
    id: Number(r.id),
    category: String(r.category ?? ""),
    title: String(r.title ?? ""),
    reason: String(r.reason ?? ""),
    url: String(r.url ?? ""),
    date_text: r.date_text == null ? null : String(r.date_text),
    status: String(r.status ?? "예정"),
    memo: String(r.memo ?? ""),
    created_at: ca instanceof Date ? ca.toISOString() : String(ca ?? ""),
  };
}

export async function listAgentItems(email: string): Promise<AgentItem[]> {
  if (!sql) return [];
  await ensureSchema();
  const rows = await sql`SELECT * FROM agent_items WHERE email = ${email} ORDER BY created_at DESC LIMIT 200`;
  return rows.map(normAgentItem);
}

export async function addAgentItems(
  email: string,
  items: { category: string; title: string; reason: string; url: string; date_text: string | null }[],
): Promise<void> {
  if (!sql || !items.length) return;
  await ensureSchema();
  for (const it of items.slice(0, 20)) {
    // 같은 URL을 이미 저장했으면 중복 저장 안 함
    await sql`
      INSERT INTO agent_items (email, category, title, reason, url, date_text)
      SELECT ${email}, ${it.category}, ${it.title}, ${it.reason}, ${it.url}, ${it.date_text}
      WHERE NOT EXISTS (SELECT 1 FROM agent_items WHERE email = ${email} AND url = ${it.url})
    `;
  }
}

export async function updateAgentItem(
  email: string, id: number, patch: { status?: string; memo?: string },
): Promise<void> {
  if (!sql) return;
  await ensureSchema();
  if (patch.status !== undefined)
    await sql`UPDATE agent_items SET status = ${patch.status} WHERE id = ${id} AND email = ${email}`;
  if (patch.memo !== undefined)
    await sql`UPDATE agent_items SET memo = ${patch.memo} WHERE id = ${id} AND email = ${email}`;
}

export async function deleteAgentItem(email: string, id: number): Promise<void> {
  if (!sql) return;
  await ensureSchema();
  await sql`DELETE FROM agent_items WHERE id = ${id} AND email = ${email}`;
}

// ── 에이전트 세션 상태 (마지막 브리핑·프로필 보존) ─────────────
export interface AgentState {
  profile: Record<string, unknown>;
  briefing: Record<string, unknown> | null;
  updated_at: string;
}

export async function getAgentState(email: string): Promise<AgentState | null> {
  if (!sql) return null;
  await ensureSchema();
  const rows = await sql`SELECT profile, briefing, updated_at FROM agent_state WHERE email = ${email}`;
  if (!rows.length) return null;
  const r = rows[0];
  const ua = r.updated_at;
  return {
    profile: r.profile && typeof r.profile === "object" ? r.profile : {},
    briefing: r.briefing && typeof r.briefing === "object" ? r.briefing : null,
    updated_at: ua instanceof Date ? ua.toISOString() : String(ua ?? ""),
  };
}

export async function putAgentState(
  email: string, profile: Record<string, unknown>, briefing: Record<string, unknown> | null,
): Promise<void> {
  if (!sql) return;
  await ensureSchema();
  await sql`
    INSERT INTO agent_state (email, profile, briefing, updated_at)
    VALUES (${email}, ${JSON.stringify(profile)}::jsonb, ${briefing ? JSON.stringify(briefing) : null}::jsonb, now())
    ON CONFLICT (email) DO UPDATE
      SET profile = EXCLUDED.profile, briefing = EXCLUDED.briefing, updated_at = now()
  `;
}

export async function clearAgentBriefing(email: string): Promise<void> {
  if (!sql) return;
  await ensureSchema();
  await sql`UPDATE agent_state SET briefing = NULL, updated_at = now() WHERE email = ${email}`;
}

// 오늘(UTC 아닌 KST 기준) 특정 이벤트를 이 사용자가 몇 번 했나 — 일일 실행 제한용
export async function countTodayEvents(name: string, email: string): Promise<number> {
  if (!sql) return 0;
  await ensureSchema();
  const rows = await sql`
    SELECT count(*)::int AS n FROM events
    WHERE name = ${name} AND email = ${email}
      AND created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'
  `;
  return Number(rows[0]?.n ?? 0);
}

// ── 이벤트 로깅 (행동 통계) ───────────────────────────────
export async function logEvent(
  name: string, props: Record<string, unknown>, session: string | null, email: string | null,
): Promise<void> {
  if (!sql) return;
  await ensureSchema();
  await sql`
    INSERT INTO events (name, props, session, email)
    VALUES (${name}, ${JSON.stringify(props || {})}::jsonb, ${session}, ${email})
  `;
}

export interface DailyPoint { day: string; visits: number; ai: number; saves: number; sessions: number; }
export interface EventStats {
  totalEvents: number;
  uniqueSessions: number;
  byName: { name: string; n: number }[];
  topSearch: { q: string; n: number }[];
  funnel: { visits: number; aiGenerate: number; logins: number; saves: number };
  daily: DailyPoint[];
  retention: { totalSessions: number; returningSessions: number };
}

export async function getEventStats(): Promise<EventStats> {
  const empty: EventStats = {
    totalEvents: 0, uniqueSessions: 0, byName: [], topSearch: [],
    funnel: { visits: 0, aiGenerate: 0, logins: 0, saves: 0 },
    daily: [], retention: { totalSessions: 0, returningSessions: 0 },
  };
  if (!sql) return empty;
  await ensureSchema();
  const [totals, byName, topSearch, daily, retention] = await Promise.all([
    sql`SELECT count(*)::int AS total, count(DISTINCT session)::int AS sessions FROM events`,
    sql`SELECT name, count(*)::int AS n FROM events GROUP BY name ORDER BY n DESC LIMIT 20`,
    sql`SELECT props->>'q' AS q, count(*)::int AS n FROM events
        WHERE name = 'search' AND coalesce(props->>'q','') <> '' GROUP BY 1 ORDER BY n DESC LIMIT 10`,
    // 최근 14일 일별 추이
    sql`SELECT
          to_char(date_trunc('day', created_at), 'MM-DD') AS day,
          count(*) FILTER (WHERE name = 'tool_view')::int AS visits,
          count(*) FILTER (WHERE name = 'ai_generate')::int AS ai,
          count(*) FILTER (WHERE name = 'save')::int AS saves,
          count(DISTINCT session)::int AS sessions
        FROM events
        WHERE created_at >= now() - interval '14 days'
        GROUP BY date_trunc('day', created_at)
        ORDER BY date_trunc('day', created_at)`,
    // 재방문: 2일 이상 등장한 세션 비율
    sql`WITH sd AS (
          SELECT session, count(DISTINCT date_trunc('day', created_at)) AS days
          FROM events WHERE session IS NOT NULL GROUP BY session
        )
        SELECT count(*)::int AS total, count(*) FILTER (WHERE days >= 2)::int AS returning FROM sd`,
  ]);
  const cnt = (nm: string) => Number((byName as { name: string; n: number }[]).find((x) => x.name === nm)?.n ?? 0);
  return {
    totalEvents: Number(totals[0]?.total ?? 0),
    uniqueSessions: Number(totals[0]?.sessions ?? 0),
    byName: (byName as { name: string; n: number }[]).map((x) => ({ name: x.name, n: Number(x.n) })),
    topSearch: (topSearch as { q: string; n: number }[]).map((x) => ({ q: x.q, n: Number(x.n) })),
    funnel: { visits: cnt("tool_view"), aiGenerate: cnt("ai_generate"), logins: cnt("login"), saves: cnt("save") },
    daily: (daily as Record<string, unknown>[]).map((d) => ({
      day: String(d.day), visits: Number(d.visits), ai: Number(d.ai), saves: Number(d.saves), sessions: Number(d.sessions),
    })),
    retention: { totalSessions: Number(retention[0]?.total ?? 0), returningSessions: Number(retention[0]?.returning ?? 0) },
  };
}
