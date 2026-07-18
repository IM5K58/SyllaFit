// 시간표를 PNG로 그려서 다운로드 (캔버스 직접 렌더 — 외부 라이브러리 없음).
// 공유용이므로 테마와 무관하게 밝은 배경으로 고정 렌더.
import { Course } from "./api";

const DAY_ORDER = ["월", "화", "수", "목", "금", "토", "일"];
const PALETTE: [string, string][] = [
  ["#e8f1ff", "#1b64da"],
  ["#e3f5ee", "#0f7a52"],
  ["#fbf1de", "#96610f"],
  ["#f3e8fd", "#7b3ff2"],
  ["#fde8ef", "#c0398a"],
  ["#e2f6f7", "#0f8b93"],
  ["#fdecec", "#c5303a"],
  ["#f3f3f5", "#4e5968"],
];

function periodLabel(p: number): string {
  const mins = 540 + (p - 1) * 30;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

export function downloadTimetableImage(courses: (Course | undefined)[], title = "SyllaFit 시간표") {
  const items = courses.filter((c): c is Course => !!c);
  const scheduled = items.filter((c) => c.room_time?.length);
  const online = items.filter((c) => !c.room_time?.length);

  // 범위 계산 — 화면 격자와 동일하게 항상 1교시(09:00)부터 전체 표시.
  // 저녁 수업이 있으면 그 시간까지 확장(기본은 26교시=22:00).
  const usedDays = new Set<string>();
  let maxP = -Infinity;
  scheduled.forEach((c) => c.room_time.forEach((b) => {
    usedDays.add(b.day);
    b.periods.forEach((p) => { maxP = Math.max(maxP, p); });
  }));
  const minP = 1;
  maxP = Math.max(isFinite(maxP) ? maxP : 1, 26);
  const days = DAY_ORDER.filter((d) => usedDays.has(d) || ["월","화","수","목","금"].includes(d));
  const nRows = maxP - minP + 1;

  // 레이아웃 (2x 스케일 = 선명한 PNG)
  const S = 2;
  const timeW = 72, dayW = 168, headH = 64, rowHeadH = 40, rowH = 34;
  const footH = online.length ? 64 : 40;
  const W = timeW + dayW * days.length + 32;
  const H = headH + rowHeadH + rowH * nRows + footH + 16;

  const canvas = document.createElement("canvas");
  canvas.width = W * S; canvas.height = H * S;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(S, S);
  const FONT = "'Pretendard Variable', Pretendard, 'Malgun Gothic', sans-serif";

  // 배경 + 타이틀
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#191f28"; ctx.font = `800 20px ${FONT}`;
  ctx.fillText("Sylla", 16, 34);
  const w1 = ctx.measureText("Sylla").width;
  ctx.fillStyle = "#3182f6"; ctx.fillText("Fit", 16 + w1, 34);
  const w2 = ctx.measureText("Fit").width;
  ctx.fillStyle = "#8b95a1"; ctx.font = `500 13px ${FONT}`;
  ctx.fillText(`· ${title}`, 16 + w1 + w2 + 8, 34);

  const gx = 16, gy = headH; // 그리드 원점
  const gridW = timeW + dayW * days.length;

  // 요일 헤더 + '교시' 헤더
  ctx.font = `700 14px ${FONT}`; ctx.fillStyle = "#4e5968"; ctx.textAlign = "center";
  days.forEach((d, i) => ctx.fillText(d, gx + timeW + dayW * i + dayW / 2, gy + 26));
  ctx.font = `700 11px ${FONT}`; ctx.fillStyle = "#8b95a1";
  ctx.fillText("교시", gx + timeW / 2, gy + 26);

  // 격자
  ctx.strokeStyle = "#e5e8ef"; ctx.lineWidth = 1;
  for (let r = 0; r <= nRows; r++) {
    const y = gy + rowHeadH + rowH * r;
    ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx + gridW, y); ctx.stroke();
  }
  for (let c = 0; c <= days.length; c++) {
    const x = gx + timeW + dayW * c;
    ctx.beginPath(); ctx.moveTo(x, gy + rowHeadH); ctx.lineTo(x, gy + rowHeadH + rowH * nRows); ctx.stroke();
  }

  // 좌측 라벨: 교시 번호(매 칸) + 시간(정시만) — 화면 격자와 동일, 강의 표기와 매칭
  for (let r = 0; r < nRows; r++) {
    const p = minP + r;
    const yy = gy + rowHeadH + rowH * r + 14;
    ctx.font = `700 11px ${FONT}`; ctx.fillStyle = "#4e5968"; ctx.textAlign = "left";
    ctx.fillText(String(p), gx + 8, yy);
    if ((540 + (p - 1) * 30) % 60 === 0) {
      ctx.font = `500 10px ${FONT}`; ctx.fillStyle = "#adb5bd"; ctx.textAlign = "right";
      ctx.fillText(periodLabel(p), gx + timeW - 6, yy);
    }
  }

  // 과목 블록
  const colorOf: Record<string, [string, string]> = {};
  scheduled.forEach((c, i) => (colorOf[c.key] = PALETTE[i % PALETTE.length]));
  ctx.textAlign = "left";
  scheduled.forEach((c) => {
    const [bg, fg] = colorOf[c.key];
    c.room_time.forEach((b) => {
      const ci = days.indexOf(b.day);
      if (ci < 0 || !b.periods.length) return;
      const s = Math.min(...b.periods), e = Math.max(...b.periods);
      const x = gx + timeW + dayW * ci + 2;
      const y = gy + rowHeadH + rowH * (s - minP) + 2;
      const h = rowH * (e - s + 1) - 4, w = dayW - 4;
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.fill();
      ctx.fillStyle = fg; ctx.fillRect(x, y, 3, h);
      ctx.font = `600 12px ${FONT}`;
      // 과목명 (넘치면 줄임)
      let name = c.kwamok_kname;
      while (ctx.measureText(name).width > w - 14 && name.length > 2) name = name.slice(0, -1);
      if (name !== c.kwamok_kname) name += "…";
      ctx.fillText(name, x + 8, y + 17);
      ctx.font = `400 10.5px ${FONT}`; ctx.fillStyle = "#8b95a1";
      const sub = [c.prof_name, b.room].filter(Boolean).join(" · ");
      if (h > 30 && sub) ctx.fillText(sub, x + 8, y + 32);
    });
  });

  // 푸터
  let fy = gy + rowHeadH + rowH * nRows + 24;
  ctx.font = `400 11px ${FONT}`; ctx.fillStyle = "#8b95a1";
  if (online.length) {
    ctx.fillText(`온라인/시간미정: ${online.map((c) => c.kwamok_kname).join(", ")}`, gx, fy);
    fy += 18;
  }
  const credits = items.reduce((a, c) => a + (c.credit || 0), 0);
  ctx.fillText(`${items.length}과목 · ${credits}학점 · 공식 강의계획서 기준 · 최종 확인은 학교 포털에서`, gx, fy);

  // 다운로드
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "syllafit-시간표.png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, "image/png");
}
