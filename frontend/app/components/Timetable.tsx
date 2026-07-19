// 주간 시간표 그리드. 인하대 교시 = 30분 단위(1교시 09:00 시작).
// 충돌 없는 조합을 시각화 — 오전/공강 여부가 한눈에.
import { Block, Course } from "../lib/api";

const DAY_ORDER = ["월", "화", "수", "목", "금", "토", "일"];
const PALETTE: [string, string][] = [
  ["#e8f0fe", "#2f6df6"],
  ["#e6f4ec", "#1a7f4b"],
  ["#fbf0dd", "#b4690e"],
  ["#f3e8fd", "#7b3ff2"],
  ["#fde8ef", "#c0398a"],
  ["#e2f6f7", "#0f8b93"],
  ["#fbe9e7", "#c0392b"],
  ["#eef1f5", "#4b5563"],
];

function periodLabel(p: number): string {
  const mins = 540 + (p - 1) * 30; // 1교시 = 09:00
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

interface Item { key: string; name: string; prof: string; blocks: Block[]; raw: string; }

export default function Timetable({
  courses,
  full = false,
}: {
  courses: (Course | undefined)[];
  // full: 과목 유무와 무관하게 월~금 · 09:00~18:00 전체 격자를 항상 표시 (직접 조립용).
  // 저녁 수업이 추가되면 그 시간까지 자동 확장.
  full?: boolean;
}) {
  const items: Item[] = courses
    .filter((c): c is Course => !!c)
    .map((c) => ({ key: c.key, name: c.kwamok_kname, prof: c.prof_name || "", blocks: c.room_time || [], raw: c.room_time_raw || "" }));

  // 과목별 색 (그리드 블록·온라인 카드에서 동일 색 사용)
  const colorOf: Record<string, [string, string]> = {};
  items.forEach((it, i) => (colorOf[it.key] = PALETTE[i % PALETTE.length]));

  // 표시할 요일 = 실제 사용된 요일(월~금은 기본), 교시 범위 = 사용된 최소~최대
  const usedDays = new Set<string>();
  let minP = Infinity;
  let maxP = -Infinity;
  items.forEach((it) =>
    it.blocks.forEach((b) => {
      usedDays.add(b.day);
      b.periods.forEach((p) => {
        minP = Math.min(minP, p);
        maxP = Math.max(maxP, p);
      });
    })
  );
  const onlineOnly = items.filter((it) => it.blocks.length === 0);

  // 온라인 강의(시간표에 자리 없는 것) — 격자 아래 '연장선' 카드로 크게 표시 + 셀 정보.
  const onlineBlock = onlineOnly.length > 0 && (
    <div style={{ marginTop: 10 }}>
      <div className="muted" style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>
        온라인 강의 <span style={{ fontWeight: 400 }}>(정해진 시간 없음)</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {onlineOnly.map((it) => {
          const [bg, fg] = colorOf[it.key];
          return (
            <div key={it.key} style={{
              background: bg, color: fg, borderLeft: `4px solid ${fg}`,
              borderRadius: 8, padding: "9px 12px", minWidth: 130,
            }}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{it.name}</div>
              <div style={{ fontWeight: 500, fontSize: 12, opacity: 0.9, marginTop: 3 }}>
                {it.raw || "온라인 / 시간 미정"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  if (!isFinite(minP)) {
    if (!full) {
      // 시간 있는 강의가 없음 — 그리드 없이 온라인 카드만
      return <div>{onlineBlock || <div className="muted" style={{ padding: "6px 0" }}>표시할 강의가 없어요.</div>}</div>;
    }
    minP = 1;
    maxP = 26; // 빈 격자: 09:00~22:00
  }
  if (full) {
    minP = 1;
    maxP = Math.max(maxP, 26); // 26교시 = 21:30~22:00
  }

  const days = DAY_ORDER.filter((d) => usedDays.has(d) || ["월", "화", "수", "목", "금"].includes(d));
  const startP = minP;
  const endP = maxP;
  const nRows = endP - startP + 1;

  const ROW_H = 32;

  return (
    <div style={{ overflowX: "auto" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `54px repeat(${days.length}, minmax(72px, 1fr))`,
          gridTemplateRows: `24px repeat(${nRows}, ${ROW_H}px)`,
          border: "1px solid var(--border)",
          borderRadius: 8,
          overflow: "hidden",
          fontSize: 12,
          minWidth: 54 + days.length * 72,
        }}
      >
        {/* 좌상단: '교시' 라벨 */}
        <div style={{
          borderRight: "1px solid var(--border)", borderBottom: "1px solid var(--border)",
          fontSize: 10, fontWeight: 700, color: "var(--muted)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>교시</div>
        {/* 요일 헤더 */}
        {days.map((d) => (
          <div
            key={d}
            style={{
              textAlign: "center",
              fontWeight: 700,
              borderBottom: "1px solid var(--border)",
              borderRight: "1px solid var(--border)",
              lineHeight: "24px",
            }}
          >
            {d}
          </div>
        ))}

        {/* 좌측 라벨: 교시 번호(매 칸) + 시간(정시만) — 강의 표기 '금4,5,6,7'과 매칭 */}
        {Array.from({ length: nRows }, (_, r) => {
          const p = startP + r;
          const onHour = (540 + (p - 1) * 30) % 60 === 0; // 정시만 시간 표기
          return (
            <div
              key={`t${p}`}
              style={{
                gridColumn: 1,
                gridRow: r + 2,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 3,
                padding: "0 4px",
                borderRight: "1px solid var(--border)",
                borderBottom: "1px dashed var(--border)",
              }}
            >
              <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-2)" }}>{p}</span>
              <span style={{ fontSize: 9, color: "var(--muted)" }}>{onHour ? periodLabel(p) : ""}</span>
            </div>
          );
        })}

        {/* 격자 배경 셀 */}
        {Array.from({ length: nRows }, (_, r) =>
          days.map((d, ci) => (
            <div
              key={`bg${r}-${d}`}
              style={{
                gridColumn: ci + 2,
                gridRow: r + 2,
                borderRight: "1px solid var(--border)",
                borderBottom: "1px dashed var(--border)",
              }}
            />
          ))
        )}

        {/* 과목 블록 */}
        {items.flatMap((it) =>
          it.blocks.map((b, bi) => {
            const ci = days.indexOf(b.day);
            if (ci < 0 || b.periods.length === 0) return null;
            const s = Math.min(...b.periods);
            const e = Math.max(...b.periods);
            const [bg, fg] = colorOf[it.key];
            return (
              <div
                key={`${it.key}-${bi}`}
                title={`${it.name} (${b.day}${b.periods.join(",")})`}
                style={{
                  gridColumn: ci + 2,
                  gridRow: `${s - startP + 2} / ${e - startP + 3}`,
                  background: bg,
                  color: fg,
                  borderLeft: `3px solid ${fg}`,
                  borderRadius: 4,
                  margin: 1,
                  padding: "2px 4px",
                  fontSize: 11,
                  fontWeight: 600,
                  overflow: "hidden",
                  lineHeight: 1.2,
                }}
              >
                {it.name}
                {(it.prof || b.room) && (
                  <div style={{ fontWeight: 400, fontSize: 10, opacity: 0.9 }}>
                    {[it.prof, b.room].filter(Boolean).join(" · ")}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      {onlineBlock}
    </div>
  );
}
