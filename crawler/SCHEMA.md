# 캐시 스키마 (Stage 2 확정 — 실데이터 기반)

기준 실데이터: `samples/syllabus_ICT3005_001.xml`, `samples/syllabus_FAN4311_001.xml` (2026-07-15 수집, 20262 학기)

## 키
- **과목 식별자 = `학수번호-분반`** (예: `ICT3005-001`). XML `HAKSU_BUNBAN`(=`20262ICT3005001`)에서 학기를 뗀 형태.
- diff·조회·리뷰(v1.1)·시간표 구성 모두 이 키 기준.

## courses.json — 과목 메타 (β 조합/충돌검사용)

```json
{
  "collected_at": "2026-07-15T14:00:00+09:00",
  "yearterm": "20262",
  "source": "sugang.inha.ac.kr (LecPlanHistory 검색 + LecPlan_Xml)",
  "courses": {
    "ICT3005-001": {
      "haksu_no": "ICT3005",
      "bunban": "001",
      "kwamok_kname": "데이터베이스",
      "kwamok_ename": "Database",
      "prof_name": "김유성",
      "credit": 3.0,
      "pf_name": "상대평가",
      "major": "연계전공(SCSC)",
      "season_yn": "N",
      "room_time_raw": "하-424:화19,20,21,22,23,24",
      "room_time": [
        { "room": "하-424", "day": "화", "periods": [19, 20, 21, 22, 23, 24] }
      ],
      "lecplan_yn": true,
      "grade": null,
      "isu_gubun": null,
      "bigo": null
    }
  }
}
```

### 필드 출처 주석
| 필드 | 출처 | 상태 |
|---|---|---|
| haksu_no~room_time | 계획서 XML `MAIN` | ✅ 지금 수집 가능 |
| major | LecPlanHistory 검색 결과 행 | ✅ 지금 수집 가능 |
| lecplan_yn | 검색 결과에 OpenPrint 링크 존재 여부 | ✅ 지금 수집 가능 |
| **grade(학년), isu_gubun(이수구분), bigo(비고/선수)** | 목록 페이지 `Lec_Time_Search.aspx` | ⚠️ **서비스 기간에만 열림** (실측: "서비스 기간이 아닙니다") → null 허용, 기간 열리면 병합 |

- `room_time` 파싱 규칙(가정 포함): `방:요일교시들` 형태. 요일 그룹 정규식 `([월화수목금토일])(\d+(?:,\d+)*)`.
  **가정:** 복수 요일/강의실 과목의 구분자 형식 미확인(샘플 2건 모두 단일 그룹) → 파싱 실패 시 `room_time: []`로 두고 `room_time_raw` 보존.

## syllabi.json — 계획서 본문 (α의 입력·출력)

```json
{
  "collected_at": "2026-07-15T14:00:00+09:00",
  "yearterm": "20262",
  "syllabi": {
    "ICT3005-001": {
      "share": { "mid": 30, "last": 30, "report": 30, "attend": 10,
                 "quiz": 0, "discussion": 0, "etc": 0, "total": 100 },
      "share_detail": "",
      "object": "…강의 목표…",
      "overview": "…강의 개요…",
      "ing_method": "이론 강의 및 필요시 실습, 숙제",
      "blended_detail": "강의식",
      "main_book": "서명:… 저자:… ISBN:…",
      "sub_book": "…",
      "notice": "",
      "office_hour": "월요일 1-3교시",
      "weeks": [
        { "week": 1, "theme": "교과목 소개…", "content": "", "report": "", "lec_method": "" }
      ],
      "extracted": {
        "assignment_count": null,
        "presentation_count": null,
        "team_project": null,
        "prerequisites": null,
        "workload_stated": null,
        "evidence": [],
        "flagged_no_evidence": []
      }
    }
  }
}
```

### 두 층 분리 (중요)
- **원문층(share~weeks):** 크롤러가 XML에서 기계적으로 옮김. Solar 개입 없음.
  - **평가비중은 이미 숫자 필드로 제공됨** (`SHARE_*`) → α가 생성할 필요 없음. 단 `share_detail` 자유텍스트가 세부 배분을 덮어쓰는 경우 있음(FAN4311 실측: "과제 40% - 프로젝트 30%…" ← share.report=30과 불일치 가능) → α가 교차대조.
- **추출층(`extracted`):** Stage 4에서 Solar(α)가 채움. **신뢰성 원칙: 못 믿을 값보다 null. 사용자 오도 금지.**
  - `assignment_count` / `presentation_count`: 주차별 `report`·`content` 텍스트에서. **단 '과제/보고서/제출/발표' 표식이 있는 항목만**(코드 `_count_from_evidence`가 재검증, 강의주제 오인 방지). 없으면 null.
  - `team_project`: **true/null만** (`ing_method`·주차 텍스트에 팀/조별 프로젝트 명시 → true, 언급 없으면 null). **false로 '없음' 단정 안 함**(부재는 증명 불가).
  - `prerequisites`: 선수과목 **명시된 경우만** 문자열. 학습목표·개요는 아님 → null.
  - `workload_stated`: **계획서가 부하를 직접 서술한 원문 인용만**(예 notice "과제가 많습니다"). 우리가 low/medium/high 등급 안 매김(주관 판정 금지). 없으면 null.
  - **M5 강제:** 모든 값은 `evidence` 근거 동반. **근거 없는 값은 코드가 null로 강등** + `flagged_no_evidence`에 기록 → 화면에 안 나감. `{ "field": "team_project", "source": "share_detail", "quote": "4-5명으로 팀을 구성하여…" }`.

### 원문 근거 포인터 규약
`source`는 이 JSON 내 경로 문자열: `"object"`, `"weeks[3].report"`, `"share_detail"` 등.
원본 XML은 `samples/`(추후 `raw/`)에 보존 → 분쟁 시 재검증 가능.

## v1.1 대비
- 캐시는 읽기전용 유지. 사용자 산출물(시간표·리뷰)은 이 파일에 절대 쓰지 않음(DB로).
- 시간표 저장 모델이 이 키(`학수번호-분반`)를 참조하는 구조로 설계 → `user_id`는 DB 쪽에만 붙음.

## 미검증/열린 문제 (Stage 3에서 해소)
1. ✅ **해소:** `ROOM_TIME_LIST` 형식 3종 확인(1269과목 실측) — ①`방:요일교시`(강의실 있음) ②`요일교시`만(강의실 없는 실시간, room=None) ③`웹강의`등(온라인, 시간없음→[]). 파서 3종 처리. 1269 = 시간있음 1223 + 온라인 46.
2. `Value` 토큰 유효기간 — 캐시 갱신 주기와 연관
3. 전체 과목 열거 방법: 목록 페이지가 잠긴 기간엔 LecPlanHistory 검색(2글자 이상)으로 커버해야 함 → 검색어 시딩 전략 필요 (예: 학수번호 접두사 사전 or 자모/음절 사전). 서비스 기간에 목록 전체 스냅샷이 정공법.
4. 학년/이수구분/비고: 서비스 기간 열리면 목록에서 병합
