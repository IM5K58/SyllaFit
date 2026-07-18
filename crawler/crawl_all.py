# Stage 3 — 전과목 계획서 수집 배치 (음절 시딩)
#
# 실행:
#   python crawler/crawl_all.py --probe        # 시드 20개만 (동작 확인용, ~1분)
#   python crawler/crawl_all.py --seeds 100    # 앞 100개 시드
#   python crawler/crawl_all.py                # 전체 (EUC-KR 한글 2350 + A-Z + 0-9)
#   python crawler/crawl_all.py --resume       # 중단분 이어서
#
# 설계 근거 (전부 Stage 1~2 실측):
#   - sugang은 EUC-KR → 모든 과목명 글자는 완성형 한글 2350자 안에 존재.
#     과목명(K) 검색이 부분일치 + 1글자 수용(서버측) → 2350자 시드로 한글명 과목 100% 커버.
#     영문/숫자명 대비 A-Z, 0-9 추가.
#   - 학수번호(H) 접두사 검색은 0건(정확일치 전용) → 과목명 시드가 유일 경로.
#   - 목록 페이지(Lec_Time_Search)는 서비스 기간에만 열림 → 계획서 검색 경로로 수집.
#
# 규율: 요청 간 DELAY초, 재시도, 실패 로깅, 체크포인트(중단/재개), dedup(학수번호-분반).
import argparse
import json
import re
import ssl
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

BASE = "https://sugang.inha.ac.kr/STD/SU_65002/"
SEARCH_URL = BASE + "LecPlanHistory.aspx"
XML_URL = BASE + "LecPlan_Xml.aspx"

HERE = Path(__file__).parent
RAW = HERE / "raw"           # 계획서 XML 원본 보존
STATE = HERE / "state"       # 체크포인트/로그
RAW.mkdir(exist_ok=True)
STATE.mkdir(exist_ok=True)
INDEX_FILE = STATE / "index.json"     # {key: {meta, token}}
DONE_FILE = STATE / "done_seeds.json"  # 완료 시드 목록
FAIL_LOG = STATE / "failures.log"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Referer": SEARCH_URL,
}
DELAY = 1.0            # 학교 서버 배려: 요청 간 간격(초). --delay 로 조절, 1초 미만 비권장.
TIMEOUT = 30
MAX_RETRY = 3
KST = timezone(timedelta(hours=9))
# 계획서 검색은 1999~현재 전 학기를 반환 → 대상 학기만 수집. "YYYY-N" 표기(결과 1열).
TARGET_TERM = "2026-2"

HIDDEN_RE = re.compile(
    r'<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"', re.I
)
ROW_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S)
TD_RE = re.compile(r"<td[^>]*>(.*?)</td>", re.S)
TAG_RE = re.compile(r"<[^>]+>")
OPENPRINT_RE = re.compile(r"OpenPrint\('LecPlan_Rpt\.aspx\?Value=([^']+)'\)")

CTX = ssl.create_default_context()


def euckr_syllables():
    """KS X 1001 완성형 한글 2350자.

    ⚠️ 주의: Windows 에서 파이썬 'euc-kr' 은 cp949(확장완성형, 11172자)로 매핑돼
    chr(cp).encode('euc-kr') 로 필터하면 11172자가 나온다(과잉). 실제 과목명은
    KS X 1001 2350자로 충분하므로, EUC-KR 이중바이트(리드 0xB0~0xC8, 트레일 0xA1~0xFE)를
    직접 디코딩해 정확히 2350자만 생성한다. (가나다순)
    """
    out = []
    for lead in range(0xB0, 0xC9):
        for trail in range(0xA1, 0xFF):
            try:
                ch = bytes([lead, trail]).decode("euc_kr")
            except UnicodeDecodeError:
                continue
            if "가" <= ch <= "힣":
                out.append(ch)
    return out


def build_seeds(limit=None):
    seeds = euckr_syllables()
    seeds += list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
    seeds += list("0123456789")
    if limit:
        seeds = seeds[:limit]
    return seeds


def log_fail(msg):
    line = f"{datetime.now(KST).isoformat(timespec='seconds')} {msg}"
    with FAIL_LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")
    print("  FAIL:", msg)


def http(url, data=None, extra=None):
    h = dict(HEADERS)
    if extra:
        h.update(extra)
    last = None
    for attempt in range(1, MAX_RETRY + 1):
        try:
            req = urllib.request.Request(url, data=data, headers=h)
            resp = urllib.request.urlopen(req, timeout=TIMEOUT, context=CTX)
            return resp.read()
        except Exception as e:  # noqa: BLE001 — 네트워크 전반 재시도
            last = e
            time.sleep(DELAY * attempt)
    raise last


def search_seed(seed):
    """시드 검색 → {key: {meta, token}}. 실패 시 예외."""
    fields = dict(HIDDEN_RE.findall(http(SEARCH_URL).decode("euc-kr", "replace")))
    if "__VIEWSTATE" not in fields:
        raise RuntimeError("뷰스테이트 없음")
    form = dict(fields)
    form.update(
        {"rdolSearchDiv": "K", "txtSearch": seed, "ibtnSearch": "검색", "hidLang": "KOR"}
    )
    time.sleep(DELAY)
    html = http(
        SEARCH_URL,
        urllib.parse.urlencode(form, encoding="euc-kr", errors="replace").encode(),
    ).decode("euc-kr", "replace")

    found = {}
    for tr in ROW_RE.findall(html):
        m = OPENPRINT_RE.search(tr)
        if not m:
            continue
        tds = [TAG_RE.sub("", td).strip() for td in TD_RE.findall(tr)]
        # 렌더 컬럼: 년도학기, 학기구분, 학수번호, 분반, 과목명, 교수명, 개설전공
        if len(tds) < 7:
            continue
        if tds[0] != TARGET_TERM:  # 대상 학기(2026-2)만 — 검색은 1999~현재 전부 반환
            continue
        key = f"{tds[2]}-{tds[3]}"
        found[key] = {
            "yearterm_label": tds[0],
            "term_gubun": tds[1],
            "haksu_no": tds[2],
            "bunban": tds[3],
            "kwamok_kname": tds[4],
            "prof_name": tds[5],
            "major": tds[6],
            "token": m.group(1),
        }
    return found


def fetch_xml(token):
    """Value 토큰 → 계획서 XML(str). 실패(플레이스홀더) 시 None."""
    url = XML_URL + "?Value=" + token.replace("%", "%25")
    data = urllib.parse.urlencode(
        {
            "type": "pdf",
            "path": "/ITISWebCommon/report/ITISExtLink/STD/",
            "rpx": "SU_65002_R01.crf",
            "jobID": "",
        }
    ).encode()
    text = http(url, data, {"X-Requested-With": "XMLHttpRequest"}).decode("euc-kr", "replace")
    return text if text.lstrip().startswith("<?xml") else None


def load_json(path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def save_json(path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")


def phase_index(seeds, resume, stop_after=0):
    """Phase A: 시드 검색으로 전 과목 (key→meta+token) 인덱스 구축.

    stop_after>0 이면 연속 stop_after개 시드가 새 과목 0을 내면 조기 종료(saturation).
    시드가 흔한 음절부터 정렬돼 있어 앞쪽에서 대부분 잡히므로 안전.
    """
    index = load_json(INDEX_FILE, {}) if resume else {}
    done = set(load_json(DONE_FILE, [])) if resume else set()
    todo = [s for s in seeds if s not in done]
    print(f"[Phase A] 시드 {len(todo)}개 검색 (이미 완료 {len(done)}, 기존 인덱스 {len(index)}과목)"
          + (f", 조기종료: 연속 {stop_after}시드 신규0" if stop_after else ""))

    dry_streak = 0
    for i, seed in enumerate(todo, 1):
        try:
            found = search_seed(seed)
        except Exception as e:  # noqa: BLE001
            log_fail(f"search seed={seed!r}: {type(e).__name__} {e}")
            continue
        new = 0
        for key, meta in found.items():
            if key not in index:
                index[key] = meta
                new += 1
        done.add(seed)
        dry_streak = 0 if new else dry_streak + 1
        if i % 20 == 0 or new:
            print(f"  [{i}/{len(todo)}] '{seed}' +{new} (누적 {len(index)}과목, 신규0연속 {dry_streak})")
        if i % 25 == 0:  # 주기적 체크포인트
            save_json(INDEX_FILE, index)
            save_json(DONE_FILE, sorted(done))
        if stop_after and dry_streak >= stop_after:
            print(f"[Phase A] 조기종료: 최근 {stop_after}시드 연속 신규 과목 0 (saturation)")
            break
        time.sleep(DELAY)

    save_json(INDEX_FILE, index)
    save_json(DONE_FILE, sorted(done))
    print(f"[Phase A] 완료: {len(index)}과목 인덱싱")
    return index


def phase_bodies(index):
    """Phase B: key별 계획서 XML 원본 저장 (이미 있으면 건너뜀)."""
    keys = sorted(index)
    print(f"[Phase B] 본문 {len(keys)}건 수집")
    ok = skip = fail = 0
    for i, key in enumerate(keys, 1):
        out = RAW / f"{key}.xml"
        if out.exists():
            skip += 1
            continue
        try:
            xml = fetch_xml(index[key]["token"])
        except Exception as e:  # noqa: BLE001
            log_fail(f"xml key={key}: {type(e).__name__} {e}")
            fail += 1
            time.sleep(DELAY)
            continue
        if xml is None:
            log_fail(f"xml key={key}: placeholder(만료 토큰?)")
            fail += 1
        else:
            out.write_text(xml, encoding="utf-8")
            ok += 1
        if i % 50 == 0:
            print(f"  [{i}/{len(keys)}] ok={ok} skip={skip} fail={fail}")
        time.sleep(DELAY)
    print(f"[Phase B] 완료: 신규 {ok}, 건너뜀 {skip}, 실패 {fail}")


def main():
    global DELAY, TARGET_TERM
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", action="store_true", help="시드 20개만")
    ap.add_argument("--seeds", type=int, default=None, help="시드 앞 N개만")
    ap.add_argument("--resume", action="store_true", help="체크포인트 이어서")
    ap.add_argument("--index-only", action="store_true", help="Phase A만")
    ap.add_argument("--delay", type=float, default=DELAY,
                    help=f"요청 간 간격(초), 기본 {DELAY}. 1초 미만 비권장.")
    ap.add_argument("--term", default=TARGET_TERM,
                    help=f"수집 대상 학기 'YYYY-N' (기본 {TARGET_TERM}). 검색은 전 학기 반환→이것만 수집.")
    ap.add_argument("--stop-after", type=int, default=0,
                    help="연속 N시드가 새 과목 0이면 조기종료. 0=전체(기본, 권장). "
                         "⚠️ 시드가 가나다순이라 조기종료는 뒤쪽 음절(수·학·일·반 등)을 통째로 놓칠 수 있음.")
    args = ap.parse_args()

    TARGET_TERM = args.term
    DELAY = args.delay
    stop_after = 0 if args.probe else args.stop_after
    limit = 20 if args.probe else args.seeds
    seeds = build_seeds(limit)
    print(f"시드 최대 {len(seeds)}개, 요청 간격 {DELAY}s"
          + (f", 조기종료 연속{stop_after}신규0 (실제론 훨씬 빨리 끝남)" if stop_after else ""))

    index = phase_index(seeds, args.resume or args.probe, stop_after)
    if not index:
        print("인덱스 0 — 중단. state/failures.log 확인.")
        return
    if not args.index_only:
        phase_bodies(index)
    print("\n다음: python crawler/build_cache.py 로 raw/ → cache/ 변환")


if __name__ == "__main__":
    main()
