"use client";

// 학교생활 에이전트 — 프로필+시간표 기반 웹검색 브리핑 (로그인 필수).
// UX: 대화형 아님. 폼 1번 → 원샷 리포트 → 내 플랜에 저장·관리. 보완 요청 한 줄만 대화적.
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSession, signIn } from "next-auth/react";
import ThemeToggle from "../components/ThemeToggle";
import AuthButton from "../components/AuthButton";
import { Course, getCourses } from "../lib/api";
import { logEvent } from "../lib/analytics";

interface AgentResultItem {
  category: string; title: string; reason: string;
  url: string; source_title: string; date_text: string | null;
  verified?: boolean;   // 제목·일정이 출처 스니펫과 일치하는지 Solar가 대조 확인
}
interface AgentResult { summary: string; items: AgentResultItem[]; queries: string[]; runs_left: number | null; restored_at?: string; }
interface PlanItem {
  id: number; category: string; title: string; reason: string;
  url: string; date_text: string | null; status: string; memo: string;
}
interface SavedTT { name: string; keys: string[] }

const CATEGORY_ORDER = ["공모전", "행사·특강", "자격증", "커리큘럼", "면접·취준"];
const GRADES = ["1학년", "2학년", "3학년", "4학년", "졸업예정·유예"];
const WEEKDAYS = ["월", "화", "수", "목", "금"];

export default function SchoolAgentPage() {
  const { data: session, status } = useSession();

  return (
    <>
      <header className="appbar">
        <div className="appbar-inner">
          <Link href="/" className="brand" style={{ textDecoration: "none" }}>
            Sylla<span className="dot">Fit</span>
          </Link>
          <div className="row" style={{ gap: 10 }}>
            <Link href="/tool"><button className="mini">시간표 도구 →</button></Link>
            <ThemeToggle />
            <AuthButton />
          </div>
        </div>
      </header>
      <div className="container" style={{ maxWidth: 860 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: "6px 0 4px" }}>학교생활 에이전트</h1>
        <p className="muted" style={{ marginBottom: 18 }}>
          학과·학년·목표를 알려주면, 웹을 검색해 공모전·행사·자격증·커리큘럼·면접 대비까지 한 번에 정리해 드려요.
        </p>

        {status === "loading" && <div className="panel"><p className="muted">확인 중…</p></div>}
        {status === "unauthenticated" && <LoginGate />}
        {status === "authenticated" && session?.user && <AgentBody />}

        <p className="disclaimer">
          추천은 웹 검색 결과를 근거로 하며, 일정·내용은 반드시 출처 링크에서 확인하세요.
        </p>
      </div>
    </>
  );
}

// 게이트 미리보기용 예시 카드 — 실제 추천이 아님을 '예시' 배지로 명확히 표시(가짜 링크 없음).
const GATE_SAMPLES: { category: string; title: string; reason: string }[] = [
  { category: "공모전", title: "2026 교내 SW·AI 해커톤", reason: "1~2학년도 참가 가능 · 팀 프로젝트 경험과 포트폴리오에 좋아요." },
  { category: "자격증", title: "정보처리기사 (필기·실기)", reason: "SW 전공 취업 기본 스펙 · 학년에 맞춘 접수 일정을 함께 찾아드려요." },
  { category: "행사·특강", title: "현직자 커리어 토크 / 취업 특강", reason: "3~4학년이라면 이력서·면접 준비에 바로 도움이 돼요." },
];

function LoginGate() {
  return (
    <div className="panel" style={{ padding: "28px 20px" }}>
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <div style={{ fontSize: 30, marginBottom: 8 }}>🎓</div>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 6 }}>학과·학년·목표만 알려주면, 웹을 뒤져 이렇게 정리해 드려요</div>
        <p className="muted" style={{ marginBottom: 16 }}>
          아래는 예시예요. 로그인하면 <b>내 프로필에 맞춘 실제 추천</b>과 출처 링크를 받고, 마음에 드는 항목은 <b>내 플랜</b>에 저장할 수 있어요.
        </p>
        <button className="primary" onClick={() => signIn("google", { callbackUrl: "/schoolagent" })}>
          인하대 계정(@inha.edu)으로 로그인
        </button>
      </div>

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>
          이런 브리핑을 받아요 · 예시
        </div>
        <div style={{ opacity: 0.85 }}>
          {GATE_SAMPLES.map((s) => (
            <div key={s.title} style={{ border: "1px dashed var(--border)", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
              <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <b style={{ fontSize: 14 }}>
                  <span className="tag" style={{ marginRight: 6 }}>{s.category}</span>
                  {s.title}
                </b>
                <span className="badge eval">예시</span>
              </div>
              <div className="reason" style={{ margin: "4px 0 0" }}>{s.reason}</div>
            </div>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          실제 브리핑은 지금 열려 있는 공모전·행사·자격증을 웹에서 찾아 출처 링크와 함께 보여드려요.
        </p>
      </div>
    </div>
  );
}

function AgentBody() {
  // 시간표 연결
  const [courses, setCourses] = useState<Course[]>([]);
  const [working, setWorking] = useState<string[]>([]);
  const [library, setLibrary] = useState<SavedTT[]>([]);
  const [ttChoice, setTtChoice] = useState<string>("");  // "working" | "lib:이름" | ""
  // 프로필
  const [major, setMajor] = useState("");
  const [grade, setGrade] = useState("3학년");
  const [goal, setGoal] = useState("");
  // 실행
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<AgentResult | null>(null);
  // 보완 요청
  const [followQ, setFollowQ] = useState("");
  // 내 플랜
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const savedUrls = useMemo(() => new Set(plan.map((p) => p.url)), [plan]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    logEvent("tab", { tab: "schoolagent" });
    getCourses().then((r) => setCourses(r.courses)).catch(() => {});
    fetch("/api/timetables").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      if (Array.isArray(d.working)) setWorking(d.working);
      if (Array.isArray(d.library)) setLibrary(d.library);
      if (Array.isArray(d.working) && d.working.length) setTtChoice("working");
    }).catch(() => {});
    fetch("/api/agent-items").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d?.items) setPlan(d.items);
    }).catch(() => {});
    // 이전 세션 복원: 마지막 브리핑 + 프로필 프리필 (새로 시작 누르기 전까지 유지)
    fetch("/api/agent/state").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      const p = d.state?.profile;
      if (p) {
        if (typeof p.major === "string") setMajor(p.major);
        if (typeof p.grade === "string" && GRADES.includes(p.grade)) setGrade(p.grade);
        if (typeof p.goal === "string") setGoal(p.goal);
      }
      const b = d.state?.briefing;
      if (b && Array.isArray(b.items)) {
        setResult({
          summary: String(b.summary || ""),
          items: b.items,
          queries: Array.isArray(b.queries) ? b.queries : [],
          runs_left: d.runs_left ?? null,
          restored_at: d.state?.updated_at,
        });
      }
    }).catch(() => {});
  }, []);

  const courseByKey = useMemo(() => {
    const m: Record<string, Course> = {};
    courses.forEach((c) => (m[c.key] = c));
    return m;
  }, [courses]);

  function selectedKeys(): string[] {
    if (ttChoice === "working") return working;
    if (ttChoice.startsWith("lib:")) return library.find((s) => s.name === ttChoice.slice(4))?.keys || [];
    return [];
  }

  // 시간표 요약 — 공강·등교 요일·학점 (에이전트가 추천 사유에 활용)
  const ttSummary = useMemo(() => {
    const keys = selectedKeys();
    if (!keys.length) return "";
    const used = new Set<string>();
    let credits = 0;
    keys.forEach((k) => {
      const c = courseByKey[k];
      if (!c) return;
      credits += c.credit || 0;
      (c.room_time || []).forEach((b) => used.add(b.day));
    });
    const free = WEEKDAYS.filter((d) => !used.has(d));
    const usedList = WEEKDAYS.filter((d) => used.has(d));
    return `${keys.length}과목 ${credits}학점 · 등교 ${usedList.join("·") || "없음"} · 공강 ${free.join("·") || "없음"}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttChoice, working, library, courseByKey]);

  async function run(extraGoal?: string) {
    if (busy) return;
    const g = (goal + (extraGoal ? `\n추가 요청: ${extraGoal}` : "")).trim();
    if (!g) { setErr("목표·하고 싶은 것을 한 줄이라도 적어주세요."); return; }
    setBusy(true); setErr(null); setElapsed(0);
    timer.current = setInterval(() => setElapsed((v) => v + 1), 1000);
    try {
      const r = await fetch("/api/agent/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: { major, grade, goal: g }, timetable_summary: ttSummary }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || d.error || `HTTP ${r.status}`);
      let next: AgentResult;
      if (extraGoal && result) {
        // 보완 실행: 기존 결과에 병합 (URL 중복 제거)
        const seen = new Set(result.items.map((i) => i.url));
        next = { ...d, items: [...result.items, ...d.items.filter((i: AgentResultItem) => !seen.has(i.url))] };
        setFollowQ("");
      } else {
        next = d;
      }
      setResult(next);
      // 세션 보존 — 재방문 시 복원 (새 브리핑 시작 전까지)
      void fetch("/api/agent/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: { major, grade, goal },
          briefing: { summary: next.summary, items: next.items, queries: next.queries },
        }),
      }).catch(() => {});
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      if (timer.current) clearInterval(timer.current);
      setBusy(false);
    }
  }

  async function saveItems(items: AgentResultItem[]) {
    const fresh = items.filter((i) => !savedUrls.has(i.url));
    if (!fresh.length) return;
    const r = await fetch("/api/agent-items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: fresh }),
    });
    const d = await r.json().catch(() => null);
    if (r.ok && d?.items) setPlan(d.items);
  }

  async function patchPlan(id: number, patch: { status?: string; memo?: string }) {
    setPlan((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    await fetch("/api/agent-items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
  }

  async function removePlan(id: number) {
    setPlan((prev) => prev.filter((p) => p.id !== id));
    await fetch(`/api/agent-items?id=${id}`, { method: "DELETE" });
  }

  const grouped = useMemo(() => {
    const g: Record<string, AgentResultItem[]> = {};
    (result?.items || []).forEach((i) => (g[i.category] ||= []).push(i));
    return g;
  }, [result]);

  return (
    <>
      {/* 1. 시간표 연결 */}
      <div className="panel">
        <div className="h-sec"><span className="step">1</span>시간표 연결 (선택)</div>
        <p className="muted" style={{ margin: "-4px 0 10px" }}>
          시간표를 연결하면 공강 시간까지 고려해서 추천해 드려요.
        </p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="mini" onClick={() => setTtChoice("working")}
            style={ttChoice === "working" ? { borderColor: "var(--accent)", color: "var(--accent)", fontWeight: 700 } : {}}>
            지금 짜는 시간표 ({working.length}과목)
          </button>
          {library.map((s) => (
            <button key={s.name} className="mini" onClick={() => setTtChoice(`lib:${s.name}`)}
              style={ttChoice === `lib:${s.name}` ? { borderColor: "var(--accent)", color: "var(--accent)", fontWeight: 700 } : {}}>
              {s.name} ({s.keys.length})
            </button>
          ))}
          <button className="mini" onClick={() => setTtChoice("")}
            style={ttChoice === "" ? { borderColor: "var(--accent)", color: "var(--accent)", fontWeight: 700 } : {}}>
            연결 안 함
          </button>
        </div>
        {working.length === 0 && library.length === 0 && (
          <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>
            저장된 시간표가 없어요. <Link href="/tool">시간표 도구에서 먼저 짜기 →</Link>
          </p>
        )}
        {ttSummary && <p className="reason" style={{ marginTop: 10 }}>연결됨: {ttSummary}</p>}
      </div>

      {/* 2. 프로필 */}
      <div className="panel">
        <div className="h-sec"><span className="step">2</span>나에 대해 알려주세요</div>
        <div className="row" style={{ gap: 8, marginBottom: 8 }}>
          <input style={{ flex: 2, minWidth: 160 }} placeholder="학과 (예: 컴퓨터공학과)"
            value={major} maxLength={30} onChange={(e) => setMajor(e.target.value)} />
          <select style={{ flex: 1, minWidth: 110 }} value={grade} onChange={(e) => setGrade(e.target.value)}>
            {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <textarea rows={3} maxLength={400} value={goal} onChange={(e) => setGoal(e.target.value)}
          placeholder="목표·하고 싶은 것·배우고 싶은 것 (예: 백엔드 개발자가 목표예요. 올해 정보처리기사 따고 공모전도 나가보고 싶어요)" />
        <div className="row" style={{ marginTop: 10, gap: 10 }}>
          <button className="primary" onClick={() => run()} disabled={busy || !goal.trim()}>
            {busy ? "에이전트 실행 중…" : "에이전트 실행"}
          </button>
          {result?.runs_left != null && !busy && (
            <span className="muted" style={{ fontSize: 12.5 }}>오늘 남은 실행 {result.runs_left}회</span>
          )}
        </div>
      </div>

      {/* 실행 중 */}
      {busy && (
        <div className="panel">
          <div className="scan">
            <div className="scan-doc">
              <div className="bar title" /><div className="bar mid" /><div className="bar" />
              <div className="bar short" /><div className="bar mid" /><div className="bar short" />
              <div className="scan-line" />
            </div>
            <div>
              <div className="scan-msg">웹을 검색하며 정리하고 있어요<span className="scan-dots" /></div>
              <div className="scan-sub">
                공모전·행사·자격증·커리큘럼·면접 정보를 찾는 중 · {elapsed}초 (보통 1분 내외)
              </div>
            </div>
          </div>
        </div>
      )}

      {err && <div className="panel" style={{ color: "var(--danger)" }}>{err}</div>}

      {/* 3. 결과 브리핑 */}
      {result && !busy && (
        <div className="panel">
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div className="h-sec" style={{ margin: 0 }}><span className="step">3</span>캠퍼스 브리핑</div>
            <span className="row" style={{ gap: 6 }}>
              {result.items.length > 0 && (
                <button className="mini" onClick={() => saveItems(result.items)}>
                  전체를 내 플랜에 저장
                </button>
              )}
              <button className="mini" onClick={async () => {
                if (!window.confirm("현재 브리핑을 지우고 새로 시작할까요? (내 플랜에 저장한 항목은 유지돼요)")) return;
                await fetch("/api/agent/state", { method: "DELETE" }).catch(() => {});
                setResult(null);
              }}>
                새 브리핑 시작
              </button>
            </span>
          </div>
          {result.restored_at && (
            <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
              이전 브리핑({result.restored_at.slice(0, 10)})을 불러왔어요 — 이어서 보완하거나 새로 시작할 수 있어요.
            </p>
          )}
          {result.summary && (
            <p style={{ margin: "10px 0 6px", lineHeight: 1.7, fontSize: 14.5 }}>{result.summary}</p>
          )}
          <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
            검색 {result.queries.length}회 기반 · <b style={{ color: "var(--good)" }}>✓ 출처 확인됨</b>은 제목·일정이 출처와 일치하는지 Solar가 한 번 더 대조한 항목이에요. 최종 신청 전 출처 링크를 확인하세요.
          </p>

          {result.items.length === 0 && (
            <p className="muted">추천할 항목을 찾지 못했어요. 목표를 더 구체적으로 적고 다시 실행해 보세요.</p>
          )}

          {CATEGORY_ORDER.filter((c) => grouped[c]?.length).map((cat) => (
            <div key={cat} style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 13.5, color: "var(--accent)", marginBottom: 6 }}>{cat}</div>
              {grouped[cat].map((it) => (
                <div key={it.url + it.title} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
                  <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <b style={{ fontSize: 14 }}>{it.title}</b>
                    {it.verified ? (
                      <span className="badge ok" title="제목·일정이 출처 내용과 일치하는지 Solar가 대조 확인했어요">
                        {it.date_text ? `${it.date_text} · ` : ""}✓ 출처 확인됨
                      </span>
                    ) : it.date_text ? (
                      <span className="badge team" title="출처에 적힌 일정 — 반드시 원문에서 확인하세요">
                        {it.date_text} · 출처 확인
                      </span>
                    ) : null}
                  </div>
                  <div className="reason" style={{ margin: "4px 0 6px" }}>{it.reason}</div>
                  <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                    <a href={it.url} target="_blank" rel="noopener noreferrer"
                       style={{ fontSize: 12.5, color: "var(--accent)" }}>
                      {it.source_title || it.url.slice(0, 40)}
                    </a>
                    <button className="mini" onClick={() => saveItems([it])} disabled={savedUrls.has(it.url)}>
                      {savedUrls.has(it.url) ? "저장됨" : "+ 내 플랜"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}

          {/* 보완 요청 */}
          <div className="row" style={{ gap: 8, marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
            <input style={{ flex: 1, minWidth: 200 }} placeholder="보완 요청 (예: 인턴 공고도 찾아줘)"
              value={followQ} maxLength={100} onChange={(e) => setFollowQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && followQ.trim() && run(followQ.trim())} />
            <button className="mini" onClick={() => run(followQ.trim())} disabled={busy || !followQ.trim()}>
              추가 검색
            </button>
          </div>
        </div>
      )}

      {/* 4. 내 플랜 */}
      <div className="panel">
        <div className="h-sec"><span className="step">4</span>내 플랜</div>
        {plan.length === 0 ? (
          <p className="muted">아직 저장한 항목이 없어요. 브리핑에서 “+ 내 플랜”으로 담아보세요.</p>
        ) : (
          plan.map((p) => (
            <div key={p.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
              <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <span style={{ flex: 1, minWidth: 200 }}>
                  <span className="tag" style={{ marginRight: 6 }}>{p.category}</span>
                  <b>{p.title}</b>
                  {p.date_text && <span className="muted" style={{ fontSize: 12, marginLeft: 6 }}>⏰ {p.date_text}</span>}
                </span>
                <span className="row" style={{ gap: 6 }}>
                  <select value={p.status} onChange={(e) => patchPlan(p.id, { status: e.target.value })}
                    style={{ width: 84, padding: "4px 6px", fontSize: 12.5 }}>
                    <option>예정</option><option>진행</option><option>완료</option>
                  </select>
                  <a href={p.url} target="_blank" rel="noopener noreferrer"><button className="mini">출처</button></a>
                  <button className="mini" onClick={() => removePlan(p.id)}>삭제</button>
                </span>
              </div>
              <input
                style={{ marginTop: 6, fontSize: 12.5, padding: "6px 9px" }}
                placeholder="메모 (예: 팀원 구하는 중)"
                defaultValue={p.memo}
                maxLength={200}
                onBlur={(e) => e.target.value !== p.memo && patchPlan(p.id, { memo: e.target.value })}
              />
            </div>
          ))
        )}
      </div>
    </>
  );
}
