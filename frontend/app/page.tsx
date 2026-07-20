import Link from "next/link";
import ThemeToggle from "./components/ThemeToggle";
import AuthButton from "./components/AuthButton";
import Reveal from "./components/Reveal";
import Timetable from "./components/Timetable";
import { Course } from "./lib/api";

// 데모용 샘플 시간표 (충돌 없는 오후 조합)
const SAMPLE: Course[] = [
  mk("ICT3005-001", "데이터베이스", "하-424", [["월", [6, 7, 8]], ["수", [6, 7, 8]]]),
  mk("AIE2002-001", "인공지능프로그래밍", "5W-361", [["화", [6, 7, 8]], ["목", [6, 7, 8]]]),
  mk("BUS2101-001", "경영전략", "60주년-712", [["금", [4, 5, 6]]]),
];

function mk(key: string, name: string, room: string, days: [string, number[]][]): Course {
  return {
    key, kwamok_kname: name, haksu_no: key.split("-")[0], bunban: "001",
    prof_name: "", credit: 3, pf_name: "상대평가", major: null,
    room_time: days.map(([day, periods]) => ({ room, day, periods })),
    room_time_raw: "", lecplan_yn: true,
    grade: null, isu_gubun: null, bigo: null,
  };
}

export default function Home() {
  return (
    <>
      <header className="appbar">
        <div className="appbar-inner">
          <span className="brand">Sylla<span className="dot">Fit</span></span>
          <div className="row" style={{ gap: 8 }}>
            <Link href="/tool"><button className="mini">도구 열기 →</button></Link>
            <span className="beta-wrap">
              <Link href="/schoolagent"><button className="mini">🎓 에이전트</button></Link>
              <span className="beta-badge">Beta</span>
            </span>
            <a
              href="https://docs.google.com/forms/d/e/1FAIpQLSeEpALFqGfRP3uSEb2qdenZVvWHwVqVZZDIihazbzbfWCsxTA/viewform?usp=publish-editor"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-mini"
            >
              <span>🐛</span>
              <span>버그 제보</span>
            </a>
            <ThemeToggle />
            <AuthButton />
          </div>
        </div>
      </header>

      {/* 풀스크린 히어로 */}
      <section className="hero-full">
        <div className="eyebrow">인하대생을 위한</div>
        <h1 className="hero-title">Sylla<span className="grad">Fit</span></h1>
        <p className="hero-sub">시간표 짜기, <span style={{ color: "var(--accent)" }}>딸깍</span> 한 번으로</p>
        <Link href="/tool">
          <button className="primary" style={{ padding: "14px 34px", fontSize: 16 }}>
            시간표 짜러 가기 →
          </button>
        </Link>
        <div className="scroll-hint" aria-hidden>
          <svg width="30" height="18" viewBox="0 0 30 18" fill="none">
            <path d="M3 3 L15 14 L27 3" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </section>

      <div className="container" style={{ paddingTop: 0 }}>
        {/* α — 계획서를 읽는다 */}
        <Reveal>
          <div className="story">
            <div className="copy">
              <div className="kicker">01 계획서 분석</div>
              <h2 className="headline">같은 과목도,<br />교수마다 달라요.</h2>
              <p className="desc">
                같은 데이터베이스라도 <b>어떤 분반은 팀플, 어떤 분반은 시험 위주</b>예요.
                그 차이는 계획서를 읽어야 알 수 있죠. AI가 대신 읽고, 근거와 함께 알려줘요.
              </p>
            </div>
            <div className="visual">
              <div className="mock">
                <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 14 }}>
                  데이터베이스 <span className="muted" style={{ fontWeight: 400 }}>· 어느 분반이 나을까?</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
                    <div className="muted" style={{ fontSize: 12, marginBottom: 7 }}>김OO 교수</div>
                    <span className="badge team">팀 프로젝트</span>
                    <div className="muted" style={{ marginTop: 9, fontSize: 13 }}>과제 3개 · 발표 있음</div>
                  </div>
                  <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
                    <div className="muted" style={{ fontSize: 12, marginBottom: 7 }}>이OO 교수</div>
                    <span className="badge" style={{ background: "var(--good-weak)", color: "var(--good)" }}>팀플 없음</span>
                    <div className="muted" style={{ marginTop: 9, fontSize: 13 }}>시험 위주 · 개인과제</div>
                  </div>
                </div>
                <div className="muted" style={{ marginTop: 13, fontSize: 12.5 }}>
                  <b style={{ color: "var(--text-2)" }}>SyllaFit은 계획서를 읽고 골라줘요.</b>
                </div>
              </div>
            </div>
          </div>
        </Reveal>

        {/* β — 말하면 정렬된다 */}
        <Reveal>
          <div className="story flip">
            <div className="copy">
              <div className="kicker">02 맞춤 추천</div>
              <h2 className="headline">말하면,<br />시간표가 만들어져요.</h2>
              <p className="desc">
                “오전은 피하고, 팀플 적은 걸로.” <b>한 문장</b>이면 충분합니다.
                원하는 스타일에 맞는 시간표를 만들어 <b>좋은 순서대로</b> 추천해 드려요.
              </p>
            </div>
            <div className="visual">
              <div className="mock">
                <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                  <span className="rank-badge top">1순위</span>
                  <span className="score-pill">95<small> /100</small></span>
                </div>
                <Timetable courses={SAMPLE} />
                <div className="reason" style={{ marginTop: 10 }}>오전 수업 없음 · 팀플 1개로 최소</div>
              </div>
            </div>
          </div>
        </Reveal>

        {/* γ — 실패까지 대비 */}
        <Reveal>
          <div className="story">
            <div className="copy">
              <div className="kicker">03 실패 대비 시간표</div>
              <h2 className="headline">그 분반 놓치면?<br />다른 분반으로.</h2>
              <p className="desc">
                인기 분반은 신청에 실패할 수도 있죠. 그때 <b>같은 과목의 다른 분반</b>(다른 교수·시간)을
                미리 찾아둬요. 물론 남은 시간표와 <b>안 겹치게</b>요.
              </p>
            </div>
            <div className="visual">
              <div className="mock">
                <div className="muted" style={{ fontSize: 12 }}>수강신청 실패 대비</div>
                <div style={{ margin: "5px 0 12px" }}>
                  <b style={{ fontSize: 15, textDecoration: "line-through", color: "var(--muted)" }}>데이터베이스</b>{" "}
                  <span className="muted" style={{ fontSize: 12.5 }}>김OO 교수 · 화 6,7,8</span>{" "}
                  <span className="badge" style={{ background: "var(--danger-weak)", color: "var(--danger)" }}>실패</span>
                </div>
                <div className="muted" style={{ fontSize: 12.5, marginBottom: 9 }}>
                  ↓ 같은 데이터베이스, 다른 분반으로
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
                    <b>데이터베이스</b> <span className="muted">김OO 교수</span> <span className="tag">월 3,4,5</span>
                    <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>같은 교수, 다른 시간 · 안 겹쳐요</div>
                  </div>
                  <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
                    <b>데이터베이스</b> <span className="muted">이OO 교수</span> <span className="tag">목 6,7,8</span>
                    <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>다른 교수 · 공강 유지</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Reveal>

        {/* 클로징 */}
        <Reveal>
          <section style={{ textAlign: "center", padding: "70px 0 40px" }}>
            <h2 className="headline" style={{ fontSize: "clamp(24px, 4vw, 34px)" }}>
              이젠 시간표도 <span style={{ color: "var(--accent)" }}>딸깍</span>으로.
            </h2>
            <p className="desc" style={{ margin: "0 auto 26px", maxWidth: 520 }}>
              SyllaFit은 강의계획서 기반으로 나에게 가장 잘 맞는 시간표와 실패 대비까지 알려드려요.
            </p>
            <Link href="/tool">
              <button className="primary" style={{ padding: "14px 34px", fontSize: 16 }}>
                지금 시간표 짜러 가기 →
              </button>
            </Link>
          </section>
        </Reveal>

        <p className="disclaimer" style={{ marginTop: 10 }}>
          공식 강의계획서(sugang.inha.ac.kr) 기준이며 실제 체감과 다를 수 있습니다.
          최종 수강신청은 반드시 학교 포털에서 진행하세요.
        </p>
      </div>

      <footer className="footer">
        <div className="footer-inner">
          <span className="muted">© 2026 SyllaFit · 인하대생을 위한 AI 시간표</span>
          <div className="row" style={{ gap: 18 }}>
            <Link href="/terms">이용약관</Link>
            <Link href="/privacy">개인정보처리방침</Link>
          </div>
        </div>
      </footer>
    </>
  );
}
