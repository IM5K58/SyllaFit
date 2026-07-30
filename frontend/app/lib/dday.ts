// 마감일(D-day) 계산 — 에이전트 브리핑과 마이페이지 '내 플랜'이 함께 쓴다.
// 판단 규칙은 백엔드 agent.py의 _date_passed와 같게 유지한다(표시와 필터가 어긋나지 않게).

/** 연도 없는 날짜를 '방금 지난 일정'으로 볼 최대 일수. 이보다 오래됐으면 내년 공고로 본다. */
const RECENT_PAST_DAYS = 90;

/**
 * date_text에서 '가장 늦은 날짜'(=마감)를 뽑는다.
 * 표기가 없거나 애매하면 null(=D-day 미표시) — 잘못된 마감 표시가 없는 것보다 나쁘다.
 */
export function parseDeadline(text: string | null): Date | null {
  if (!text) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const found: Date[] = [];
  const push = (y: number, mo: number, da: number) => {
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return;
    const d = new Date(y, mo - 1, da);
    if (d.getMonth() === mo - 1 && d.getDate() === da) found.push(d); // 롤오버(2/30 등) 방지
  };
  // 2026.04.23 / 26-04-23 / 2026년 4월 3일
  const full = /(20\d{2}|\d{2})[.\-/년]\s?(\d{1,2})[.\-/월]\s?(\d{1,2})/g;
  let m: RegExpExecArray | null;
  while ((m = full.exec(text))) {
    const y = Number(m[1]);
    push(y < 100 ? y + 2000 : y, Number(m[2]), Number(m[3]));
  }
  // 연도 없는 표기('8월 15일', '07.20')의 연도 추정 — 백엔드 _date_passed와 같은 규칙.
  //  · 가까운 과거(RECENT_PAST_DAYS 이내)는 '올해 = 방금 지난 일정'으로 본다
  //    → "07.20"을 7/30에 보면 '마감'. 지난 걸 D-355로 보여주는 게 가장 위험하다.
  //  · 먼 과거는 '내년 = 매년 반복되는 공고'로 본다
  //    → 12월에 본 "2월 15일"은 내년 2월. (이걸 올해로 보면 멀쩡한 공고가 마감으로 뜬다)
  const yearFor = (mo: number, da: number): number => {
    const y = today.getFullYear();
    const asThisYear = new Date(y, mo - 1, da);
    if (asThisYear >= today) return y;
    const daysAgo = Math.round((today.getTime() - asThisYear.getTime()) / 86_400_000);
    return daysAgo <= RECENT_PAST_DAYS ? y : y + 1;
  };
  if (!found.length) {
    const md = /(\d{1,2})월\s?(\d{1,2})일/g;
    while ((m = md.exec(text))) {
      const mo = Number(m[1]), da = Number(m[2]);
      if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) push(yearFor(mo, da), mo, da);
    }
  }
  // 'MM.DD' (예: "원서접수 : 07.20 ~ 07.23") — 시험·접수 일정에 흔한 표기.
  if (!found.length) {
    const dot = /\b(\d{1,2})\s?[.\-/]\s?(\d{1,2})\b/g;
    while ((m = dot.exec(text))) {
      const mo = Number(m[1]), da = Number(m[2]);
      if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) push(yearFor(mo, da), mo, da);
    }
  }
  if (!found.length) return null;
  return found.reduce((a, b) => (a > b ? a : b));
}

/** D-day 표시용. 지난 건 '마감', 오늘은 'D-DAY'. days는 정렬 키로도 쓴다. */
export function ddayInfo(text: string | null): { days: number; label: string } | null {
  const d = parseDeadline(text);
  if (!d) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  return { days, label: days < 0 ? "마감" : days === 0 ? "D-DAY" : `D-${days}` };
}

/** 마감 임박 순 정렬 키 — 완료는 뒤로, 날짜 미상 → 지난 것 순. 두 화면이 같은 순서를 쓴다. */
export function planSortKey(p: { date_text: string | null; status?: string }): { g: number; d: number } {
  if (p.status === "완료") return { g: 3, d: 0 };
  const dd = ddayInfo(p.date_text);
  if (!dd) return { g: 1, d: 0 };
  return dd.days < 0 ? { g: 2, d: dd.days } : { g: 0, d: dd.days };
}

/** planSortKey 기준 오름차순 비교자 (Array.prototype.sort에 그대로 전달). */
export function byDeadline<T extends { date_text: string | null; status?: string }>(a: T, b: T): number {
  const ra = planSortKey(a), rb = planSortKey(b);
  return ra.g !== rb.g ? ra.g - rb.g : ra.d - rb.d;
}
