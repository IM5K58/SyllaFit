// SyllaFit 백엔드(FastAPI) 호출 헬퍼. v1: 무로그인.
// 백엔드 주소는 NEXT_PUBLIC_API_BASE 로 override 가능(기본 localhost:8000).

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

export interface Block { room: string | null; day: string; periods: number[]; }

export interface Course {
  key: string;
  haksu_no: string;
  bunban: string;
  kwamok_kname: string;
  prof_name: string;
  credit: number;
  pf_name: string;
  major: string | null;
  room_time: Block[];
  room_time_raw: string;
  lecplan_yn: boolean;
  // 목록페이지 공식 데이터 (2026-07-18 전분반 수집)
  grade: string | null;      // 대상 학년
  isu_gubun: string | null;  // 이수구분 (교양필수/전공선택 등)
  bigo: string | null;       // 비고
}

export interface Evidence { field: string; source: string; quote: string; }
export interface Extracted {
  team_project: boolean | null;
  assignment_count: number | null;
  presentation_count: number | null;
  prerequisites: string | null;
  workload_stated: string | null;
  evidence: Evidence[];
  flagged_no_evidence: string[];
}

export interface Pick {
  key: string;
  alt_count: number;
  why: string[];
}
export interface RankItem {
  combo_id: number;
  rank: number;
  score: number;
  reasons: string[];
  courses: string[];
  hard_violations: string[];
  picks?: Pick[];
}
export interface RankResult {
  ranking: RankItem[];
  preference_understood?: string;
  constraints?: Record<string, unknown>;
  hard_filtered_out?: number;
  combos_total?: number;
  combos_considered?: number;
  note?: string;
}

export interface FallbackItem { key: string; rank: number; reason: string; }
export interface FallbackBranch {
  risky: string;
  risky_name: string;
  kept: string[];
  feasible_count: number;
  fallback_chain: FallbackItem[];
  note: string | null;
}
export interface FallbackTree { timetable: string[]; branches: FallbackBranch[]; }

async function jf<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

export function getHealth() {
  return jf<{ ok: boolean; solar_ready: boolean; cache_collected_at: string | null; course_count: number }>(
    "/health"
  );
}

export function getCourses(dept?: string) {
  const q = dept ? `?dept=${encodeURIComponent(dept)}` : "";
  return jf<{ collected_at: string | null; courses: Course[] }>(`/courses${q}`);
}

export interface Week {
  week: number;
  theme: string;
  content: string;
  report: string;
  lec_method: string;
}
export interface Syllabus {
  share: Record<string, number>;
  share_detail: string;
  object: string;
  overview: string;
  ing_method: string;
  blended_detail: string;
  main_book: string;
  sub_book: string;
  notice: string;
  office_hour: string;
  weeks: Week[];
  extracted: Extracted;
}

export function getCourse(key: string) {
  return jf<Course & { syllabus: Syllabus | null }>(
    `/courses/${encodeURIComponent(key)}`
  );
}

export function rank(candidates: string[], preference: string, size: number, required?: string[]) {
  return jf<RankResult>("/rank", {
    method: "POST",
    body: JSON.stringify({ candidates, preference, size, required }),
  });
}

export function fallback(timetable: string[], risky: string[], preference: string) {
  return jf<FallbackTree>("/fallback", {
    method: "POST",
    body: JSON.stringify({ timetable, risky, preference }),
  });
}

export interface CourseGroup {
  haksu_no: string;
  kwamok_kname: string;
  sections: number;
  profs: string[];
}

export function getCourseGroups(q?: string) {
  const query = q ? `?q=${encodeURIComponent(q)}` : "";
  return jf<{ count: number; groups: CourseGroup[] }>(`/course-groups${query}`);
}

export interface AskResult {
  answer: string;
  found: boolean;
  quotes: { source: string; quote: string }[];
}

// 계획서 Q&A: 과목 하나의 계획서 원문에 질문 → 근거 인용과 함께 답변
export function askSyllabus(key: string, question: string) {
  return jf<AskResult>("/syllabus/ask", {
    method: "POST",
    body: JSON.stringify({ key, question }),
  });
}

export interface BackupSwap { from: string; from_name: string; to: string; to_name: string; }
export interface BackupItem {
  combo_id: number;
  rank: number;
  score: number;
  courses: string[];
  reasons: string[];
  swaps: BackupSwap[];
}
export interface BackupResult {
  backups: BackupItem[];
  no_alternative: string[];
  risky: string[];
  kept: string[];
  note: string | null;
}

// 실패 대비: 시간표 + 실패 예상 과목 → 그 과목만 대체 분반으로 바꾼 완성 시간표들
export function backupTimetables(timetable: string[], risky: string[]) {
  return jf<BackupResult>("/backup-timetables", {
    method: "POST",
    body: JSON.stringify({ timetable, risky }),
  });
}

export interface AdviseResult {
  answer: string;
  suggestions: { key: string; reason: string }[];
  note: string | null;
}

// AI 검토: 현재 시간표 맥락에서 '뭘 더 들을까' → 안 겹치는 과목 추천
export function adviseTimetable(timetable: string[], question: string) {
  return jf<AdviseResult>("/advise", {
    method: "POST",
    body: JSON.stringify({ timetable, question }),
  });
}

// AI 시간표: 들을 과목(학수번호)만 → AI가 분반 자동 선택해 시간표 랭킹
export function aiTimetable(courses: string[], preference: string) {
  return jf<RankResult>("/ai-timetable", {
    method: "POST",
    body: JSON.stringify({ courses, preference }),
  });
}
