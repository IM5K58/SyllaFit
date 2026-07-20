"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AdviseResult,
  BackupItem,
  BackupResult,
  Course,
  RankResult,
  Syllabus,
  adviseTimetable,
  aiTimetable,
  backupTimetables,
  fallback,
  getCourse,
  getCourses,
  getHealth,
} from "../lib/api";
import Timetable from "../components/Timetable";
import ThemeToggle from "../components/ThemeToggle";
import AuthButton from "../components/AuthButton";
import NoticeBanner from "../components/NoticeBanner";
import AccountSettings from "../components/AccountSettings";
import { downloadTimetableImage } from "../lib/timetableImage";
import { TimetableProvider, useTimetables, SavedTT } from "../lib/timetableStore";
import { logEvent } from "../lib/analytics";

type Detail = Course & { syllabus: Syllabus | null };

export default function ToolPage() {
  // 시간표 상태는 Provider(메모리)에 — 탭 전환엔 유지, 새로고침엔 소멸.
  // useSearchParams(탭 딥링크) 때문에 Suspense 경계 필요.
  return (
    <TimetableProvider>
      <Suspense>
        <ToolInner />
      </Suspense>
    </TimetableProvider>
  );
}

function ToolInner() {
  const searchParams = useSearchParams();
  const [collectedAt, setCollectedAt] = useState<string | null>(null);
  const [solarReady, setSolarReady] = useState<boolean | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [tab, setTab] = useState<"ai" | "manual" | "backup" | "my">("ai");
  const [details, setDetails] = useState<Record<string, Detail>>({});
  // 실패 대비 탭으로 넘길 시간표(핸드오프). null이면 저장된 시간표에서 고르게.
  const [backupSeed, setBackupSeed] = useState<string[] | null>(null);

  const { my, setMy } = useTimetables();

  // 방문 로깅 (행동 통계)
  useEffect(() => { logEvent("tool_view"); }, []);

  // ?tab=my 같은 딥링크로 탭 열기 (앱바 '마이페이지' 메뉴 등). 값 바뀔 때마다 반영.
  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "ai" || t === "manual" || t === "backup" || t === "my") setTab(t);
  }, [searchParams]);

  function goBackup(keys: string[]) {
    setBackupSeed(keys);
    setTab("backup");
  }

  // 다른 탭/카드의 시간표를 '내가 짜는 시간표'로 불러와 이어 편집. 기존 게 있으면 확인 한 번.
  function loadIntoBuilder(keys: string[]) {
    if (my.length > 0 && JSON.stringify(my) !== JSON.stringify(keys)) {
      if (!window.confirm("지금 '내가 짜는 시간표'에 있는 내용을 이 시간표로 바꿀까요?")) return;
    }
    setMy(keys);
    setTab("manual");
  }

  useEffect(() => {
    getHealth()
      .then((h) => {
        setCollectedAt(h.cache_collected_at);
        setSolarReady(h.solar_ready);
      })
      .catch(() => setSolarReady(false));
    getCourses()
      .then((r) => setCourses(r.courses))
      .catch((e) => setLoadErr(String(e)));
  }, []);

  const courseByKey = useMemo(() => {
    const m: Record<string, Course> = {};
    courses.forEach((c) => (m[c.key] = c));
    return m;
  }, [courses]);

  async function ensureDetail(key: string) {
    if (details[key]) return;
    try {
      const d = await getCourse(key);
      setDetails((prev) => ({ ...prev, [key]: d as Detail }));
    } catch {
      /* 무시 — 근거는 선택적 */
    }
  }

  return (
    <>
      <header className="appbar">
        <div className="appbar-inner">
          <Link href="/" className="brand" style={{ textDecoration: "none" }}>
            Sylla<span className="dot">Fit</span>
          </Link>
          <div className="row" style={{ gap: 10 }}>
            <span className="muted">
              {collectedAt ? `데이터 ${collectedAt.slice(0, 10)} · ` : ""}
              과목 {courses.length.toLocaleString()}개
              {solarReady === false && " · ⚠️ Solar 미설정"}
            </span>
            <button
              className="mini"
              onClick={() => window.open("https://docs.google.com/forms/d/e/1FAIpQLSeEpALFqGfRP3uSEb2qdenZVvWHwVqVZZDIihazbzbfWCsxTA/viewform?usp=publish-editor", "_blank", "noopener,noreferrer")}
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              <span>🐛</span>
              <span>버그 제보</span>
            </button>
            <span className="beta-wrap">
              <Link href="/schoolagent"><button className="mini">🎓 학교생활 에이전트</button></Link>
              <span className="beta-badge">Beta</span>
            </span>
            <ThemeToggle />
            <AuthButton />
          </div>
        </div>
      </header>
      <div className="container">

      <NoticeBanner />

      {/* 탭 */}
      <div className="tabbar">
        {([["ai", "AI 시간표"], ["manual", "내가 짜는 시간표"], ["backup", "실패 대비"], ["my", "마이페이지"]] as const).map(
          ([id, label]) => (
            <button
              key={id}
              className={`tab${tab === id ? " active" : ""}`}
              onClick={() => { setTab(id); logEvent("tab", { tab: id }); }}
            >
              {label}
            </button>
          )
        )}
      </div>

      {loadErr && (
        <div className="panel" style={{ color: "var(--danger)" }}>
          백엔드 연결 실패: {loadErr}
          <div className="muted" style={{ marginTop: 6 }}>
            FastAPI가 켜져 있나요? <code>uvicorn app.main:app --port 8000</code> (backend/ 에서)
          </div>
        </div>
      )}

      {tab === "ai" && (
        <AiPlanner
          courses={courses}
          courseByKey={courseByKey}
          details={details}
          ensureDetail={ensureDetail}
          loadIntoBuilder={loadIntoBuilder}
          goBackup={goBackup}
        />
      )}

      {tab === "my" && (
        <MyPage
          courseByKey={courseByKey}
          goManual={() => setTab("manual")}
          goBackup={goBackup}
        />
      )}

      {tab === "manual" && (
        <ManualBuilder
          courses={courses}
          courseByKey={courseByKey}
          details={details}
          ensureDetail={ensureDetail}
          goBackup={goBackup}
        />
      )}

      {tab === "backup" && (
        <BackupPage
          courseByKey={courseByKey}
          seed={backupSeed}
          loadIntoBuilder={loadIntoBuilder}
        />
      )}

        <p className="disclaimer">
          공식 강의계획서 기준이며 실제 체감과 다를 수 있습니다. 근거가 없는 항목은 표시하지 않습니다.
          최종 수강신청은 반드시 학교 포털에서 하세요.
        </p>
      </div>
    </>
  );
}

function timeText(c?: Course): string {
  if (!c) return "";
  if (!c.room_time || c.room_time.length === 0) return c.room_time_raw || "온라인/미정";
  return c.room_time.map((b) => `${b.day}${b.periods.join(",")}`).join(" ");
}

// 검색 정규화 — 소문자 + 공백 제거. "일반수학2" ↔ "일반수학 2" ↔ "일반 수학2" 다 매칭.
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}


// ── 마이페이지: 내 시간표 + 보관함 ──
function MyPage({
  courseByKey,
  goManual,
  goBackup,
}: {
  courseByKey: Record<string, Course>;
  goManual: () => void;
  goBackup: (keys: string[]) => void;
}) {
  const { my, setMy, library: saved, saveToLibrary, removeFromLibrary, cloudEnabled } = useTimetables();
  const [saveName, setSaveName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  // 학교생활 에이전트 '내 플랜' 요약 (로그인 시에만 값이 옴 — 비로그인 401은 조용히 무시)
  const [planItems, setPlanItems] = useState<
    { id: number; category: string; title: string; url: string; date_text: string | null; status: string }[] | null
  >(null);

  useEffect(() => {
    fetch("/api/agent-items")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.items) setPlanItems(d.items); })
      .catch(() => {});
  }, []);

  async function patchPlanStatus(id: number, status: string) {
    setPlanItems((prev) => prev?.map((p) => (p.id === id ? { ...p, status } : p)) ?? null);
    await fetch("/api/agent-items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    }).catch(() => {});
  }

  function saveCurrent() {
    if (my.length === 0) { setNotice("저장할 과목이 없어요. 먼저 시간표를 짜 주세요."); return; }
    const name = saveToLibrary(saveName.trim() || `시간표 ${saved.length + 1}`, my);
    setSaveName("");
    setNotice(`“${name}”으로 보관함에 저장했어요.`);
  }

  function loadSaved(s: SavedTT) {
    setMy(s.keys);
    setNotice(`“${s.name}”을 불러왔어요. '내가 짜는 시간표' 탭에서 이어서 수정할 수 있어요.`);
  }

  const credits = (keys: string[]) => keys.reduce((a, k) => a + (courseByKey[k]?.credit || 0), 0);

  return (
    <>
      {/* 지금 짜는 시간표 */}
      <div className="panel">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
          <div className="h-sec" style={{ margin: 0 }}><span className="step">1</span>지금 짜는 시간표</div>
          {my.length > 0 && (
            <span className="muted">
              <b style={{ color: "var(--text)" }}>{my.length}</b>과목 ·{" "}
              <b style={{ color: "var(--text)" }}>{credits(my)}</b>학점
            </span>
          )}
        </div>
        {notice && <p className="disclaimer" style={{ marginBottom: 10 }}>{notice}</p>}
        {my.length === 0 ? (
          <p className="muted">아직 짜는 중인 시간표가 없어요.</p>
        ) : (
          <>
            <Timetable courses={my.map((k) => courseByKey[k])} full />
            <div className="row" style={{ marginTop: 10, gap: 8 }}>
              <button className="mini" onClick={goManual}>이어서 짜기 →</button>
              <button className="mini" onClick={() => goBackup(my)}>실패 대비하기 →</button>
              <button className="mini"
                onClick={() => downloadTimetableImage(my.map((k) => courseByKey[k]), "내 시간표")}>
                ⬇ 이미지 저장
              </button>
              <span className="row" style={{ gap: 6 }}>
                <input
                  style={{ width: 160, padding: "5px 9px", fontSize: 13 }}
                  placeholder="이름 (예: 1안)"
                  value={saveName}
                  maxLength={20}
                  onChange={(e) => setSaveName(e.target.value)}
                />
                <button className="mini" onClick={saveCurrent}>보관함에 저장</button>
              </span>
            </div>
          </>
        )}
      </div>

      {/* 보관함 */}
      <div className="panel">
        <div className="h-sec"><span className="step">2</span>시간표 보관함</div>
        {saved.length === 0 ? (
          <p className="muted">보관된 시간표가 없어요. 위에서 “보관함에 저장”을 눌러 여러 안을 담아두세요.</p>
        ) : (
          saved.map((s) => (
            <div key={s.name} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span>
                  <b>{s.name}</b>{" "}
                  <span className="muted">
                    {s.keys.length}과목 · {credits(s.keys)}학점 · {s.savedAt}
                  </span>
                </span>
                <span className="row" style={{ gap: 6 }}>
                  <button className="mini" onClick={() => loadSaved(s)}>불러오기</button>
                  <button className="mini" onClick={() => goBackup(s.keys)}>실패 대비</button>
                  <button className="mini"
                    onClick={() => downloadTimetableImage(s.keys.map((k) => courseByKey[k]), s.name)}>
                    ⬇
                  </button>
                  <button className="mini" onClick={() => removeFromLibrary(s.name)}>
                    삭제
                  </button>
                </span>
              </div>
              <div className="muted" style={{ marginTop: 4, fontSize: 12.5 }}>
                {s.keys.map((k) => courseByKey[k]?.kwamok_kname || k).join(" · ")}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 내 플랜 (학교생활 에이전트) — 로그인 시에만 표시 */}
      {planItems !== null && (
        <div className="panel">
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div className="h-sec" style={{ margin: 0 }}><span className="step">3</span>내 플랜</div>
            <Link href="/schoolagent"><button className="mini">학교생활 에이전트에서 관리 →</button></Link>
          </div>
          {planItems.length === 0 ? (
            <p className="muted" style={{ marginTop: 10 }}>
              아직 저장한 플랜이 없어요. 학교생활 에이전트가 공모전·자격증·행사를 찾아드려요.
            </p>
          ) : (
            <div style={{ marginTop: 10 }}>
              {planItems.slice(0, 8).map((p) => (
                <div key={p.id} className="row"
                  style={{ justifyContent: "space-between", gap: 8, padding: "7px 0", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
                  <span style={{ flex: 1, minWidth: 180 }}>
                    <span className="tag" style={{ marginRight: 6 }}>{p.category}</span>
                    <a href={p.url} target="_blank" rel="noopener noreferrer"
                       style={{ color: "var(--text)", fontWeight: 650 }}>{p.title}</a>
                    {p.date_text && <span className="muted" style={{ fontSize: 12, marginLeft: 6 }}>⏰ {p.date_text}</span>}
                  </span>
                  <select value={p.status} onChange={(e) => patchPlanStatus(p.id, e.target.value)}
                    style={{ width: 84, padding: "4px 6px", fontSize: 12.5 }}>
                    <option>예정</option><option>진행</option><option>완료</option>
                  </select>
                </div>
              ))}
              {planItems.length > 8 && (
                <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                  외 {planItems.length - 8}개 — 전체는 에이전트 페이지에서
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* 설정 */}
      <div className="panel">
        <div className="h-sec"><span className="step">{planItems !== null ? 4 : 3}</span>설정</div>
        <AccountSettings />
      </div>

      <div className="panel inset">
        {cloudEnabled ? (
          <>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>☁️ 자동 저장되고 있어요</div>
            <div className="muted">
              로그인 상태라 시간표와 보관함이 계정에 저장돼요. 다른 기기·브라우저에서
              로그인하면 그대로 불러와져요.
            </div>
          </>
        ) : (
          <>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>💾 로그인하면 저장돼요</div>
            <div className="muted">
              지금 짠 시간표는 <b>새로고침하거나 창을 닫으면 사라져요.</b> 우측 상단에서
              인하대 계정으로 로그인하면 시간표가 저장되고, 다른 기기에서도 불러올 수 있어요.
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ── 실패 대비 시간표: 실패 예상 과목을 대체 분반으로 바꾼 완성 시간표 ──
function BackupPage({
  courseByKey,
  seed,
  loadIntoBuilder,
}: {
  courseByKey: Record<string, Course>;
  seed: string[] | null;
  loadIntoBuilder: (keys: string[]) => void;
}) {
  const { my, library, saveToLibrary } = useTimetables();
  const [source, setSource] = useState<string[]>([]);
  const [risky, setRisky] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<BackupResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // 진입: 넘겨받은 시간표(seed) 우선, 없으면 지금 짜던 내 시간표
  useEffect(() => {
    setSource(seed && seed.length ? seed : my);
    setRisky([]); setRes(null); setErr(null); setSavedMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  function pickSource(keys: string[]) {
    setSource(keys); setRisky([]); setRes(null); setErr(null); setSavedMsg(null);
  }
  function toggleRisky(k: string) {
    setRisky((prev) => prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]);
    setRes(null);
  }

  async function generate() {
    if (risky.length === 0) { setErr("실패할 것 같은 과목을 하나 이상 선택해 주세요."); return; }
    setBusy(true); setErr(null); setRes(null); setShowAll(false); setSavedMsg(null);
    logEvent("backup_generate", { risky: risky.length });
    try {
      setRes(await backupTimetables(source, risky));
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  function saveBackup(b: BackupItem) {
    const name = saveToLibrary("대비 시간표", b.courses);
    setSavedMsg(`“${name}”을 마이페이지 보관함에 저장했어요.`);
  }

  const credits = source.reduce((a, k) => a + (courseByKey[k]?.credit || 0), 0);
  const backups = res?.backups || [];
  const shown = showAll ? backups : backups.slice(0, 3);

  return (
    <>
      {/* 대상 시간표 */}
      <div className="panel">
        <div className="h-sec"><span className="step">1</span>대비할 시간표 고르기</div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <button className="mini" onClick={() => pickSource(my)}>내가 짜는 시간표 불러오기</button>
          {library.length > 0 && <span className="muted" style={{ fontSize: 12 }}>또는 보관함:</span>}
          {library.map((s) => (
            <button key={s.name} className="mini" onClick={() => pickSource(s.keys)}>
              {s.name} ({s.keys.length})
            </button>
          ))}
        </div>
        {source.length === 0 ? (
          <p className="muted">
            대비할 시간표가 없어요. 위 버튼으로 불러오거나, ‘내가 짜는 시간표’·마이페이지에서
            <b> 실패 대비하기 →</b> 로 넘어오세요.
          </p>
        ) : (
          <>
            <span className="muted" style={{ fontSize: 13 }}>
              <b style={{ color: "var(--text)" }}>{source.length}</b>과목 · <b style={{ color: "var(--text)" }}>{credits}</b>학점
            </span>
            <div style={{ marginTop: 8 }}>
              <Timetable courses={source.map((k) => courseByKey[k])} full />
            </div>
          </>
        )}
      </div>

      {/* 실패 예상 과목 선택 */}
      {source.length > 0 && (
        <div className="panel">
          <div className="h-sec"><span className="step">2</span>신청 실패할 것 같은 과목 고르기</div>
          <p className="muted" style={{ margin: "-4px 0 10px" }}>
            경쟁 심할 것 같은 과목을 체크하면, 그 과목만 <b>같은 과목 다른 분반</b>으로 바꾼 대비 시간표를 만들어드려요.
          </p>
          {source.map((k) => {
            const c = courseByKey[k];
            const on = risky.includes(k);
            return (
              <label key={k} className="row" style={{
                gap: 8, padding: "7px 4px", borderBottom: "1px solid var(--border)", cursor: "pointer",
              }}>
                <input type="checkbox" checked={on} onChange={() => toggleRisky(k)} />
                <span>
                  <b>{c?.kwamok_kname || k}</b>{" "}
                  <span className="muted">{c?.prof_name} · {c?.credit}학점 · {timeText(c)}</span>
                </span>
              </label>
            );
          })}
          <div style={{ marginTop: 12 }}>
            <button className="primary" onClick={generate} disabled={busy || risky.length === 0}>
              {busy ? "대비 시간표 만드는 중…" : `대비 시간표 생성 (${risky.length}과목)`}
            </button>
          </div>
        </div>
      )}

      {err && <div className="panel" style={{ color: "var(--danger)" }}>오류: {err}</div>}

      {/* 결과 */}
      {res && !busy && (
        <div className="panel">
          <div className="h-sec"><span className="step">3</span>대비 시간표</div>
          {res.note && <p className="disclaimer">{res.note}</p>}
          {savedMsg && <p className="disclaimer">{savedMsg}</p>}
          {backups.length === 0 ? (
            <p className="muted">만들 수 있는 대비 시간표가 없어요. 위험 과목을 줄여서 다시 시도해 보세요.</p>
          ) : (
            <>
              {shown.map((b) => (
                <div key={b.combo_id} className="panel inset" style={{ border: "1px solid var(--border)" }}>
                  <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <span className={`rank-badge${b.rank === 1 ? " top" : ""}`}>{b.rank}순위</span>
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      <button className="mini" onClick={() => saveBackup(b)}>♡ 저장</button>
                      <button className="mini" onClick={() => loadIntoBuilder(b.courses)}>✏ 커스텀하기</button>
                      <button className="mini"
                        onClick={() => downloadTimetableImage(b.courses.map((k) => courseByKey[k]), `대비 ${b.rank}순위`)}>
                        ⬇ 이미지
                      </button>
                      <div className="score-pill">{b.score}<small> /100</small></div>
                    </div>
                  </div>
                  {b.swaps.length > 0 && (
                    <div style={{ margin: "8px 0" }}>
                      {b.swaps.map((s) => (
                        <div key={s.from} className="reason">
                          {s.from_name}: <span className="muted">{s.from.split("-")[1]}분반</span>
                          {" → "}
                          <span style={{ color: "var(--accent)" }}>
                            {s.to.split("-")[1]}분반 ({courseByKey[s.to]?.prof_name} · {timeText(courseByKey[s.to])})
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <Timetable courses={b.courses.map((k) => courseByKey[k])} />
                </div>
              ))}
              {!showAll && backups.length > 3 && (
                <button className="ghost-btn" onClick={() => setShowAll(true)}>
                  대비 시간표 더보기 ({backups.length - 3}개 더)
                </button>
              )}
              {showAll && backups.length > 3 && (
                <button className="ghost-btn" onClick={() => setShowAll(false)}>접기</button>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}

// ── 내가 짜는 시간표: 직접 조립 + AI 검토 ──────────────────────
function overlaps(a?: Course, b?: Course): boolean {
  if (!a?.room_time || !b?.room_time) return false;
  const slots = new Set(a.room_time.flatMap((x) => x.periods.map((p) => `${x.day}:${p}`)));
  return b.room_time.some((x) => x.periods.some((p) => slots.has(`${x.day}:${p}`)));
}

function ManualBuilder({
  courses,
  courseByKey,
  details,
  ensureDetail,
  goBackup,
}: {
  courses: Course[];
  courseByKey: Record<string, Course>;
  details: Record<string, Detail>;
  ensureDetail: (key: string) => void;
  goBackup: (keys: string[]) => void;
}) {
  const { my, setMy } = useTimetables();
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  // 상세는 '어느 섹션에서 눌렀는지'까지 기억 → 그 섹션에서 열림
  const [detail, setDetail] = useState<{ key: string; slot: "search" | "my" | "advise" } | null>(null);
  // AI 검토
  const [advQ, setAdvQ] = useState("");
  const [advBusy, setAdvBusy] = useState(false);
  const [advRes, setAdvRes] = useState<AdviseResult | null>(null);
  const [advErr, setAdvErr] = useState<string | null>(null);
  // 놓치면? (과목별 폴백)
  const [fbKey, setFbKey] = useState<string | null>(null);
  const [fbBusy, setFbBusy] = useState(false);
  const [fbChain, setFbChain] = useState<{ key: string; rank: number; reason: string }[]>([]);

  // 검색어 로깅(디바운스) — 인기 검색어 통계용
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) return;
    const t = setTimeout(() => logEvent("search", { q: q.slice(0, 40) }), 1500);
    return () => clearTimeout(t);
  }, [search]);

  const results = useMemo(() => {
    const q = norm(search);
    if (!q) return [];
    return courses
      .filter((c) => norm(c.kwamok_kname).includes(q)
        || norm(c.key).includes(q)
        || norm(c.prof_name || "").includes(q))
      .slice(0, 60); // 분반 많은 과목(일반수학2=47개)도 다 보이게
  }, [search, courses]);

  const credits = my.reduce((a, k) => a + (courseByKey[k]?.credit || 0), 0);

  function conflictWith(key: string): string | null {
    const c = courseByKey[key];
    for (const k of my) {
      if (overlaps(c, courseByKey[k])) return courseByKey[k]?.kwamok_kname || k;
    }
    return null;
  }

  function tryAdd(key: string) {
    if (my.includes(key)) return;
    const sameCourse = my.find((k) => k.split("-")[0] === key.split("-")[0]);
    if (sameCourse) {
      setNotice(`이미 같은 과목(${courseByKey[sameCourse]?.kwamok_kname})이 시간표에 있어요.`);
      return;
    }
    const hit = conflictWith(key);
    if (hit) {
      setNotice(`“${courseByKey[key]?.kwamok_kname}”은(는) “${hit}”와 시간이 겹쳐서 넣을 수 없어요.`);
      return;
    }
    setNotice(null);
    setMy((m) => [...m, key]);
    ensureDetail(key);
  }

  function openDetail(key: string, slot: "search" | "my" | "advise") {
    setDetail((cur) => (cur && cur.key === key && cur.slot === slot ? null : { key, slot }));
    ensureDetail(key);
  }
  // 해당 섹션에서 눌렀을 때만 그 자리에 상세 카드를 렌더
  function detailFor(slot: "search" | "my" | "advise") {
    if (!detail || detail.slot !== slot) return null;
    return (
      <CourseDetail
        detail={details[detail.key]}
        course={courseByKey[detail.key]}
        added={my.includes(detail.key)}
        onAdd={() => tryAdd(detail.key)}
        onClose={() => setDetail(null)}
      />
    );
  }

  async function runAdvise() {
    const q = advQ.trim();
    if (!q || advBusy) return;
    setAdvBusy(true); setAdvErr(null); setAdvRes(null);
    try {
      const r = await adviseTimetable(my, q);
      setAdvRes(r);
      r.suggestions.forEach((s) => ensureDetail(s.key));
    } catch (e) {
      setAdvErr(String(e));
    } finally {
      setAdvBusy(false);
    }
  }

  async function toggleFallback(courseKey: string) {
    if (fbKey === courseKey) { setFbKey(null); return; }
    setFbKey(courseKey); setFbBusy(true); setFbChain([]);
    try {
      const t = await fallback(my, [courseKey], "");
      setFbChain(t.branches[0]?.fallback_chain || []);
    } catch { setFbChain([]); } finally { setFbBusy(false); }
  }

  return (
    <>
      {/* 검색 → 바로 추가 */}
      <div className="panel">
        <div className="h-sec"><span className="step">1</span>과목 검색해서 시간표에 넣기</div>
        <input
          placeholder="과목명·학수번호·교수 검색 (예: 데이터베이스, 김ㅇㅇ)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {notice && <p className="disclaimer" style={{ marginTop: 8 }}>{notice}</p>}
        {results.length > 0 && (
          <div style={{ marginTop: 8, maxHeight: 240, overflowY: "auto" }}>
            {results.map((c) => {
              const inMy = my.includes(c.key);
              const hit = !inMy && conflictWith(c.key);
              return (
                <div key={c.key} className="row"
                  style={{ justifyContent: "space-between", padding: "6px 4px", borderBottom: "1px solid var(--border)" }}>
                  <span onClick={() => openDetail(c.key, "search")} style={{ cursor: "pointer", flex: 1 }} title="상세 보기">
                    <b>{c.kwamok_kname}</b> <span className="tag">{c.key}</span>{" "}
                    <span className="muted">
                      {c.prof_name} · {c.credit}학점{c.isu_gubun ? ` · ${c.isu_gubun}` : ""} · {timeText(c)}
                    </span>
                    {hit && <span className="badge" style={{ background: "var(--danger-weak)", color: "var(--danger)" }}>겹침</span>}
                  </span>
                  <button className="mini" onClick={() => tryAdd(c.key)} disabled={inMy || !!hit}>
                    {inMy ? "담김" : "추가"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {detailFor("search")}
      </div>

      {/* 내 시간표 */}
      <div className="panel">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
          <div className="h-sec" style={{ margin: 0 }}><span className="step">2</span>내 시간표</div>
          <div className="row" style={{ gap: 8 }}>
            <span className="muted"><b style={{ color: "var(--text)" }}>{my.length}</b>과목 · <b style={{ color: "var(--text)" }}>{credits}</b>학점</span>
            {my.length > 0 && (
              <>
                <button className="mini" onClick={() => goBackup(my)}>실패 대비하기 →</button>
                <button className="mini"
                  onClick={() => downloadTimetableImage(my.map((k) => courseByKey[k]), "내 시간표")}>
                  ⬇ 이미지 저장
                </button>
              </>
            )}
          </div>
        </div>
        {my.length === 0 && (
          <p className="muted" style={{ marginBottom: 8 }}>
            위에서 과목을 검색해 추가하면 이 시간표에 채워져요. 시간이 겹치면 자동으로 막아드려요.
          </p>
        )}
        <Timetable courses={my.map((k) => courseByKey[k])} full />
        {my.length > 0 && (
          <>
            <div style={{ marginTop: 10 }}>
              {my.map((k) => {
                const c = courseByKey[k];
                const ext = details[k]?.syllabus?.extracted;
                return (
                  <div key={k} style={{ padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span onClick={() => openDetail(k, "my")} style={{ cursor: "pointer" }} title="상세 보기">
                        <b>{c?.kwamok_kname || k}</b>{" "}
                        <span className="muted">{c?.prof_name} · {timeText(c)}</span>
                        {ext?.team_project && <span className="badge team">팀플</span>}
                        {typeof ext?.assignment_count === "number" && (
                          <span className="badge assign">과제 {ext.assignment_count}</span>
                        )}
                      </span>
                      <span className="row" style={{ gap: 6 }}>
                        <button className="mini" onClick={() => toggleFallback(k)}>
                          {fbKey === k ? "닫기" : "놓치면?"}
                        </button>
                        <button className="mini" onClick={() => setMy((m) => m.filter((x) => x !== k))}>제거</button>
                      </span>
                    </div>
                    {fbKey === k && (
                      <div className="evidence" style={{ marginTop: 6 }}>
                        {fbBusy && <span className="muted">대체 분반 찾는 중…</span>}
                        {!fbBusy && fbChain.length === 0 && <span className="muted">이 과목은 다른 분반이 없어요.</span>}
                        {!fbBusy && fbChain.map((f) => (
                          <div key={f.key} style={{ marginBottom: 3 }}>
                            <span className="rank-badge" style={{ marginRight: 6 }}>{f.rank}</span>
                            <b>{courseByKey[f.key]?.kwamok_kname || f.key}</b>{" "}
                            <span className="muted">{courseByKey[f.key]?.prof_name} 교수 · {timeText(courseByKey[f.key])}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {detailFor("my")}
            </div>
          </>
        )}
      </div>

      {/* AI 검토란 */}
      <div className="panel">
        <div className="h-sec"><span className="step">3</span>AI 검토 — 뭘 더 들을까?</div>
        <div className="row" style={{ gap: 8 }}>
          <input
            style={{ flex: 1, minWidth: 220 }}
            placeholder="예: 화요일에 들을 만한 교양 3학점 뭐 있어? 팀플 없는 걸로"
            value={advQ}
            maxLength={200}
            onChange={(e) => setAdvQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runAdvise()}
          />
          <button className="primary" onClick={runAdvise} disabled={advBusy || !advQ.trim()}>
            {advBusy ? "찾는 중…" : "물어보기"}
          </button>
        </div>
        <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
          지금 시간표와 안 겹치는 과목만 골라서 추천해 드려요.
        </p>
        {advErr && <div className="violation" style={{ marginTop: 8 }}>오류: {advErr}</div>}
        {advRes && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 14, color: "var(--text-2)", lineHeight: 1.7 }}>{advRes.answer}</div>
            {advRes.suggestions.map((s) => {
              const c = courseByKey[s.key];
              const ext = details[s.key]?.syllabus?.extracted;
              return (
                <div key={s.key} className="row"
                  style={{ justifyContent: "space-between", padding: "7px 4px", borderBottom: "1px solid var(--border)" }}>
                  <span onClick={() => openDetail(s.key, "advise")} style={{ cursor: "pointer", flex: 1 }} title="상세 보기">
                    <b>{c?.kwamok_kname || s.key}</b>{" "}
                    <span className="muted">{c?.prof_name} · {c?.credit}학점 · {timeText(c)}</span>
                    {ext?.team_project && <span className="badge team">팀플</span>}
                    <div className="reason" style={{ marginTop: 2 }}>{s.reason}</div>
                  </span>
                  <button className="mini" onClick={() => tryAdd(s.key)} disabled={my.includes(s.key)}>
                    {my.includes(s.key) ? "담김" : "추가"}
                  </button>
                </div>
              );
            })}
            {advRes.note && <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>{advRes.note}</p>}
            {detailFor("advise")}
          </div>
        )}
      </div>
    </>
  );
}

// AI 시간표 생성 중 — 강의계획서를 스캔하는 로더
function ScanLoader() {
  const subs = [
    "팀플·과제 부담을 확인하는 중",
    "겹치지 않는 분반을 맞춰보는 중",
    "평가 방식을 비교하는 중",
    "공강과 오전 수업을 따져보는 중",
  ];
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => (v + 1) % subs.length), 1600);
    return () => clearInterval(t);
  }, [subs.length]);
  return (
    <div className="panel">
      <div className="scan">
        <div className="scan-doc">
          <div className="bar title" />
          <div className="bar mid" />
          <div className="bar" />
          <div className="bar short" />
          <div className="bar mid" />
          <div className="bar short" />
          <div className="scan-line" />
        </div>
        <div>
          <div className="scan-msg">강의계획서를 토대로 시간표를 짜고 있어요<span className="scan-dots" /></div>
          <div className="scan-sub">{subs[i]}</div>
        </div>
      </div>
    </div>
  );
}

interface Grp { haksu_no: string; name: string; sections: Course[]; profs: string[]; }

// AI 시간표: 들을 과목(학수번호)만 고르면 AI가 분반을 자동 선택해 시간표를 짜준다.
function AiPlanner({
  courses,
  courseByKey,
  details,
  ensureDetail,
  loadIntoBuilder,
  goBackup,
}: {
  courses: Course[];
  courseByKey: Record<string, Course>;
  details: Record<string, Detail>;
  ensureDetail: (key: string) => void;
  loadIntoBuilder: (keys: string[]) => void;
  goBackup: (keys: string[]) => void;
}) {
  const { saveToLibrary } = useTimetables();
  const [search, setSearch] = useState("");
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) return;
    const t = setTimeout(() => logEvent("search", { q: q.slice(0, 40) }), 1500);
    return () => clearTimeout(t);
  }, [search]);
  const [picked, setPicked] = useState<string[]>([]); // 학수번호
  const [preference, setPreference] = useState("오전 수업은 피하고, 팀플·과제 적은 걸로");
  const [result, setResult] = useState<RankResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);       // 3순위 초과 펼침
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  // 과목별 "놓치면?" 폴백 (같은 과목 다른 분반)
  const [fbKey, setFbKey] = useState<string | null>(null);
  const [fbBusy, setFbBusy] = useState(false);
  const [fbChain, setFbChain] = useState<{ key: string; rank: number; reason: string }[]>([]);

  function saveCombo(it: { rank: number; courses: string[] }) {
    const name = saveToLibrary(`AI추천 ${it.rank}순위`, it.courses);
    setSavedMsg(`“${name}”을 마이페이지 보관함에 저장했어요.`);
  }
  function customize(it: { courses: string[] }) {
    loadIntoBuilder(it.courses);
  }

  async function toggleFallback(comboId: number, comboKeys: string[], courseKey: string) {
    const id = `${comboId}:${courseKey}`;
    if (fbKey === id) { setFbKey(null); return; }
    setFbKey(id);
    setFbBusy(true);
    setFbChain([]);
    try {
      const t = await fallback(comboKeys, [courseKey], preference);
      const chain = t.branches[0]?.fallback_chain || [];
      setFbChain(chain);
      chain.forEach((f) => ensureDetail(f.key));
    } catch {
      setFbChain([]);
    } finally {
      setFbBusy(false);
    }
  }

  const groups = useMemo(() => {
    const m: Record<string, Grp> = {};
    courses.forEach((c) => {
      const g = (m[c.haksu_no] ||= { haksu_no: c.haksu_no, name: c.kwamok_kname, sections: [], profs: [] });
      g.sections.push(c);
      if (c.prof_name && !g.profs.includes(c.prof_name)) g.profs.push(c.prof_name);
    });
    return m;
  }, [courses]);

  const found = useMemo(() => {
    const q = norm(search);
    if (!q) return [];
    return Object.values(groups)
      .filter((g) => norm(g.name).includes(q) || norm(g.haksu_no).includes(q)
        || g.profs.some((p) => norm(p).includes(q)))
      .slice(0, 20);
  }, [search, groups]);

  function addCourse(hn: string) {
    if (!picked.includes(hn)) setPicked((p) => [...p, hn]);
  }

  async function run() {
    setBusy(true); setErr(null); setResult(null); setShowAll(false); setSavedMsg(null);
    logEvent("ai_generate", { courses: picked.length });
    try {
      const r = await aiTimetable(picked, preference);
      setResult(r);
      const keys = new Set<string>();
      r.ranking?.forEach((it) => it.courses?.forEach((k) => keys.add(k)));
      keys.forEach(ensureDetail);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="panel">
        <div className="h-sec"><span className="step">1</span>들을 과목 고르기</div>
        <p className="muted" style={{ margin: "-6px 0 10px" }}>
          교수·시간은 안 골라도 돼요. 과목만 넣으면 AI가 계획서를 읽고 <b>분반을 골라 시간표를 짜드려요.</b>
        </p>
        <input
          placeholder="들을 과목 검색 (예: 데이터베이스, 일반수학)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {found.length > 0 && (
          <div style={{ marginTop: 8, maxHeight: 220, overflowY: "auto" }}>
            {found.map((g) => (
              <div key={g.haksu_no} className="row"
                style={{ justifyContent: "space-between", padding: "6px 4px", borderBottom: "1px solid var(--border)" }}>
                <span>
                  <b>{g.name}</b> <span className="tag">{g.haksu_no}</span>{" "}
                  <span className="muted">
                    분반 {g.sections.length}개{g.profs.length ? ` · ${g.profs.slice(0, 3).join(", ")}` : ""}
                  </span>
                </span>
                <button className="mini" onClick={() => addCourse(g.haksu_no)} disabled={picked.includes(g.haksu_no)}>
                  {picked.includes(g.haksu_no) ? "담김" : "담기"}
                </button>
              </div>
            ))}
          </div>
        )}
        {picked.length > 0 && (
          <div className="row" style={{ marginTop: 12 }}>
            {picked.map((hn) => (
              <span key={hn} className="chip">
                {groups[hn]?.name || hn}
                <button onClick={() => setPicked((p) => p.filter((x) => x !== hn))} aria-label="제거">×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="h-sec"><span className="step">2</span>어떤 시간표를 원해요?</div>
        <textarea rows={2} value={preference} onChange={(e) => setPreference(e.target.value)}
          placeholder="예: 오전 회피, 공강 하루, 팀플 없는 것 우선, 월요일 피하기" />
        <div style={{ marginTop: 10 }}>
          <button className="primary" onClick={run} disabled={busy || picked.length < 2}>
            {busy ? "AI가 시간표 짜는 중…" : "AI 시간표 짜줘"}
          </button>
          {picked.length < 2 && <span className="muted" style={{ marginLeft: 8 }}>과목을 2개 이상 골라주세요</span>}
        </div>
      </div>

      {busy && <ScanLoader />}

      {err && <div className="panel" style={{ color: "var(--danger)" }}>오류: {err}</div>}

      {result && !busy && (
        <div className="panel">
          <div className="h-sec"><span className="step">3</span>AI가 짠 시간표</div>
          {result.note && <p className="disclaimer">{result.note}</p>}
          {result.preference_understood && (
            <p className="muted" style={{ marginBottom: 8 }}>해석된 선호: {result.preference_understood}</p>
          )}
          {savedMsg && <p className="disclaimer" style={{ marginBottom: 8 }}>{savedMsg}</p>}
          {(showAll ? result.ranking : result.ranking?.slice(0, 3))?.map((it) => (
            <div key={it.combo_id} className="panel inset" style={{ border: "1px solid var(--border)" }}>
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <span className={`rank-badge${it.rank === 1 ? " top" : ""}`}>{it.rank}순위</span>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  <button className="mini" onClick={() => saveCombo(it)}>♡ 저장</button>
                  <button className="mini" onClick={() => customize(it)}>✏ 커스텀하기</button>
                  <button className="mini" onClick={() => goBackup(it.courses)}>실패 대비 →</button>
                  <button
                    className="mini"
                    onClick={() =>
                      downloadTimetableImage(it.courses.map((k) => courseByKey[k]), `${it.rank}순위 시간표`)
                    }
                  >
                    ⬇ 이미지
                  </button>
                  <div className="score-pill">{it.score}<small> /100</small></div>
                </div>
              </div>
              {/* AI가 고른 분반 (교수 강조) + 왜 이 분반인지 */}
              <div style={{ margin: "10px 0" }}>
                {it.courses.map((k) => {
                  const c = courseByKey[k];
                  const ext = details[k]?.syllabus?.extracted;
                  const pick = it.picks?.find((p) => p.key === k);
                  return (
                    <div key={k} style={{ padding: "4px 0" }}>
                      <div className="row" style={{ cursor: "pointer" }}
                        onClick={() => { setDetailKey(detailKey === k ? null : k); ensureDetail(k); }}
                        title="상세 보기">
                        <b>{c?.kwamok_kname || k}</b>
                        <span className="muted">— {c?.prof_name} · {timeText(c)}</span>
                        {ext?.team_project && <span className="badge team">팀플</span>}
                        {typeof ext?.assignment_count === "number" && (
                          <span className="badge assign">과제 {ext.assignment_count}</span>
                        )}
                      </div>
                      <div className="row" style={{ gap: 8, marginTop: 2, marginLeft: 2 }}>
                        {pick && pick.alt_count > 0 && (
                          <span className="muted" style={{ fontSize: 12 }}>
                            분반 {pick.alt_count + 1}개 중 선택
                            {pick.why.length > 0 && <> · <span style={{ color: "var(--accent)" }}>{pick.why.join(" · ")}</span></>}
                          </span>
                        )}
                        <button className="mini" onClick={() => toggleFallback(it.combo_id, it.courses, k)}>
                          {fbKey === `${it.combo_id}:${k}` ? "닫기" : "놓치면?"}
                        </button>
                      </div>
                      {fbKey === `${it.combo_id}:${k}` && (
                        <div className="evidence" style={{ marginTop: 6 }}>
                          {fbBusy && <span className="muted">대체 분반 찾는 중…</span>}
                          {!fbBusy && fbChain.length === 0 && (
                            <span className="muted">이 과목은 다른 분반이 없어요.</span>
                          )}
                          {!fbBusy && fbChain.map((f) => (
                            <div key={f.key} style={{ marginBottom: 3 }}>
                              <span className="rank-badge" style={{ marginRight: 6 }}>{f.rank}</span>
                              <b>{courseByKey[f.key]?.kwamok_kname || f.key}</b>{" "}
                              <span className="muted">{courseByKey[f.key]?.prof_name} 교수 · {timeText(courseByKey[f.key])}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <Timetable courses={it.courses.map((k) => courseByKey[k])} />
              <div style={{ marginTop: 8 }}>
                {it.reasons?.map((r, i) => <div key={i} className="reason">{r}</div>)}
                {it.hard_violations?.map((v, i) => <div key={i} className="violation">✗ {v}</div>)}
              </div>
              {detailKey && it.courses.includes(detailKey) && (
                <CourseDetail
                  detail={details[detailKey]}
                  course={courseByKey[detailKey]}
                  added
                  onAdd={() => {}}
                  onClose={() => setDetailKey(null)}
                />
              )}
            </div>
          ))}
          {!showAll && (result.ranking?.length || 0) > 3 && (
            <button className="ghost-btn" onClick={() => setShowAll(true)}>
              추천 더보기 ({(result.ranking?.length || 0) - 3}개 더)
            </button>
          )}
          {showAll && (result.ranking?.length || 0) > 3 && (
            <button className="ghost-btn" onClick={() => setShowAll(false)}>접기</button>
          )}
        </div>
      )}
    </>
  );
}

function CourseDetail({
  detail,
  course,
  added,
  onAdd,
  onClose,
}: {
  detail?: Detail;
  course?: Course;
  added: boolean;
  onAdd: () => void;
  onClose: () => void;
}) {
  const c = detail || course;
  const ext = detail?.syllabus?.extracted;
  const share = detail?.syllabus?.share;
  const evi = ext?.evidence || [];
  const hasAlpha =
    ext && (ext.team_project || ext.assignment_count || ext.presentation_count ||
      ext.prerequisites || ext.workload_stated);
  const [showRaw, setShowRaw] = useState(false);

  return (
    <div
      className="panel"
      style={{ marginTop: 12, marginBottom: 0, border: "1px solid var(--accent)", background: "var(--panel-2)" }}
    >
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <b style={{ fontSize: 16 }}>{c?.kwamok_kname || detail?.kwamok_kname}</b>{" "}
          <span className="tag">{c?.key}</span>
          <div className="muted" style={{ marginTop: 3 }}>
            {c?.prof_name} · {c?.credit}학점 · {c?.pf_name} · {timeText(c)}
            {c?.major ? ` · ${c.major}` : ""}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {detail?.syllabus && (
            <button className="mini" onClick={() => setShowRaw(true)}>강의계획서 원문</button>
          )}
          <button className="mini" onClick={onClose} aria-label="닫기">✕</button>
        </div>
      </div>

      {!detail && <div className="muted" style={{ marginTop: 10 }}>불러오는 중…</div>}

      {/* 계획서 미제출 분반 — '언급 없음'과 구분해 정직하게 표기 */}
      {detail && !detail.syllabus && (
        <>
          <p className="disclaimer" style={{ marginTop: 12 }}>
            아직 강의계획서가 제출되지 않은 분반이에요. 팀플·과제·평가 정보는 계획서가
            올라온 뒤에 보여드릴 수 있어요. (시간·학점·이수구분은 공식 시간표 기준)
          </p>
          <div style={{ marginTop: 14 }}>
            <button className="primary" onClick={onAdd} disabled={added}>
              {added ? "후보에 담김" : "후보에 담기"}
            </button>
          </div>
        </>
      )}

      {detail?.syllabus && (
        <>
          {/* α 요약 배지 */}
          <div className="row" style={{ margin: "12px 0 4px" }}>
            {ext?.team_project ? (
              <span className="badge team">팀 프로젝트 있음</span>
            ) : (
              <span className="badge eval">팀플 언급 없음</span>
            )}
            {typeof ext?.assignment_count === "number" && (
              <span className="badge assign">과제 {ext.assignment_count}개</span>
            )}
            {typeof ext?.presentation_count === "number" && (
              <span className="badge assign">발표 {ext.presentation_count}회</span>
            )}
          </div>

          {/* 평가 비중 */}
          {share && share.total > 0 && (
            <div className="muted" style={{ marginTop: 8 }}>
              평가 비중 · 중간 {share.mid} · 기말 {share.last} · 과제 {share.report} · 출석 {share.attend}
              {share.quiz ? ` · 퀴즈 ${share.quiz}` : ""}
              {share.discussion ? ` · 토론 ${share.discussion}` : ""}
            </div>
          )}
          {ext?.prerequisites && (
            <div className="muted" style={{ marginTop: 4 }}>선수과목 · {ext.prerequisites}</div>
          )}
          {ext?.workload_stated && (
            <div className="muted" style={{ marginTop: 4 }}>부하 언급 · “{ext.workload_stated}”</div>
          )}

          {/* 근거 */}
          {evi.length > 0 ? (
            <div className="evidence" style={{ marginTop: 12 }}>
              {evi.map((e, i) => (
                <div key={i} style={{ marginBottom: 2 }}>
                  <span className="tag">{fieldLabel(e.field)}</span> “{e.quote}”
                </div>
              ))}
              <div className="muted" style={{ marginTop: 6, fontSize: 11 }}>
                모두 강의계획서 원문에서 확인한 내용이에요.
              </div>
            </div>
          ) : (
            !hasAlpha && (
              <div className="muted" style={{ marginTop: 12 }}>
                계획서에서 팀플·과제로 특별히 확인된 내용이 없어요.
              </div>
            )
          )}

          <div style={{ marginTop: 14 }}>
            <button className="primary" onClick={onAdd} disabled={added}>
              {added ? "후보에 담김" : "후보에 담기"}
            </button>
          </div>
        </>
      )}
      {showRaw && detail?.syllabus && (
        <SyllabusModal course={c} syllabus={detail.syllabus} onClose={() => setShowRaw(false)} />
      )}
    </div>
  );
}

function SyllabusModal({
  course,
  syllabus,
  onClose,
}: {
  course?: Course;
  syllabus: Syllabus;
  onClose: () => void;
}) {
  const s = syllabus;
  const sh = s.share;
  const section = (title: string, body: React.ReactNode) =>
    body ? (
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 5, color: "var(--accent)" }}>{title}</div>
        <div style={{ fontSize: 13.5, color: "var(--text-2)", whiteSpace: "pre-wrap", lineHeight: 1.65 }}>{body}</div>
      </div>
    ) : null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <b style={{ fontSize: 16 }}>{course?.kwamok_kname}</b>{" "}
            <span className="tag">{course?.key}</span>
            <div className="muted" style={{ marginTop: 2 }}>
              {course?.prof_name} · {course?.credit}학점 · {course?.pf_name} · 강의계획서 원문
            </div>
          </div>
          <button className="mini" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <div className="modal-body">
          {section("강의 목표", s.object)}
          {section("강의 개요", s.overview)}
          {section("강의 방식", s.ing_method)}
          {sh && sh.total > 0 &&
            section("평가 방법",
              `중간 ${sh.mid} · 기말 ${sh.last} · 과제 ${sh.report} · 출석 ${sh.attend}`
              + (sh.quiz ? ` · 퀴즈 ${sh.quiz}` : "")
              + (sh.discussion ? ` · 토론 ${sh.discussion}` : "")
              + (sh.etc ? ` · 기타 ${sh.etc}` : "")
              + (s.share_detail ? `\n\n${s.share_detail}` : ""))}
          {section("교재", [s.main_book, s.sub_book].filter(Boolean).join("\n\n"))}
          {section("유의사항", s.notice)}
          {section("오피스아워", s.office_hour)}
          {s.weeks && s.weeks.length > 0 && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: "var(--accent)" }}>주차별 계획</div>
              <div style={{ overflowX: "auto" }}>
                <table className="week-table">
                  <thead>
                    <tr><th>주차</th><th>주제</th><th>내용</th><th>과제</th></tr>
                  </thead>
                  <tbody>
                    {s.weeks.map((w) => (
                      <tr key={w.week}>
                        <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>{w.week}</td>
                        <td>{w.theme}</td>
                        <td className="muted">{w.content}</td>
                        <td className="muted">{w.report && w.report !== "없음" ? w.report : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div className="muted" style={{ marginTop: 14, fontSize: 11 }}>
            출처: sugang.inha.ac.kr 공식 강의계획서 (수집 시점 기준)
          </div>
        </div>
      </div>
    </div>
  );
}

function EvidenceBlock({ keys, details }: { keys: string[]; details: Record<string, Detail> }) {
  const [open, setOpen] = useState(false);
  const withEvidence = keys
    .map((k) => ({ k, ext: details[k]?.syllabus?.extracted }))
    .filter((x) => x.ext && x.ext.evidence.length > 0);
  if (withEvidence.length === 0) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <button className="mini" onClick={() => setOpen((o) => !o)}>
        {open ? "근거 접기" : `근거 보기 (${withEvidence.length}과목)`}
      </button>
      {open &&
        withEvidence.map(({ k, ext }) => (
          <div key={k} className="evidence">
            <b>{details[k]?.kwamok_kname || k}</b>
            {ext!.evidence.map((e, i) => (
              <div key={i}>
                <span className="tag">{fieldLabel(e.field)}</span> “{e.quote}”{" "}
                <span className="muted">({e.source})</span>
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}

function fieldLabel(f: string): string {
  return (
    { team_project: "팀플", assignment_count: "과제", presentation_count: "발표",
      prerequisites: "선수과목", workload_stated: "부하" } as Record<string, string>
  )[f] || f;
}
