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

// ── 공지사항 ──────────────────────────────────────────────
export interface Notice { id: number; body: string; level: string; active: boolean; created_at: string; }

export async function getActiveNotices(): Promise<Notice[]> {
  if (!sql) return [];
  await ensureSchema();
  const rows = await sql`SELECT id, body, level, active, created_at FROM notices WHERE active = true ORDER BY created_at DESC`;
  return rows as Notice[];
}

export async function getAllNotices(): Promise<Notice[]> {
  if (!sql) return [];
  await ensureSchema();
  const rows = await sql`SELECT id, body, level, active, created_at FROM notices ORDER BY created_at DESC LIMIT 100`;
  return rows as Notice[];
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
  const rows = await sql`
    SELECT
      count(*)::int AS users,
      coalesce(sum(jsonb_array_length(library)), 0)::int AS saved,
      count(*) FILTER (WHERE jsonb_array_length(working) > 0)::int AS active_working
    FROM user_data
  `;
  const r = rows[0] || {};
  return { users: r.users ?? 0, savedTimetables: r.saved ?? 0, activeWorking: r.active_working ?? 0 };
}
