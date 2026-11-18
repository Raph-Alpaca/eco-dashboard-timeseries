# 데이터 규격(데이터 계약) — 코드북 · 원자료 CSV · 집계 큐브

이 문서는 대시보드가 읽는 데이터의 모양을 정의합니다. 화면 코드는 이 규격만 알고, 데이터가 합성인지 실제인지는 모릅니다.
`schemaVersion: 1` 을 깨는 변경은 화면과 도구를 함께 고쳐야 합니다.

## 1. 흐름

```
data/source/*.json  ──(tools/generate_synthetic.py)──▶ data/synthetic/*.csv ─┐
                                                                             ├─(tools/build_cubes.py)─▶ data/cubes/*.json ─▶ 화면
data/real/*.csv (실데이터, git 제외) ───────────────────────────────────────┘
data/codebook/base_*.json + data/source/*.json ──(tools/build_codebook.py)──▶ data/codebook/*.json ─▶ 화면·도구
```

## 2. 코드북 `data/codebook/<survey>.json`

| 키 | 내용 |
|---|---|
| `dims` | 축 정의. `{"level": {"label":"학교급","codes":[["E","초등학교"],...]}}` |
| `groups` | 파생 축(저장 축에서 매핑). 예: `region5` = `sido`를 권역으로 |
| `populations` | 모집단(=큐브 1개). `dims`(저장 축), `derived`(파생 축), `weighted`, `census`, `ui.filters`, `ui.defaultBy`, `ui.note` |
| `questions[]` | 문항 메타. `qid`, `pop`, `type`, `categories`/`scale`, `items`, `positive`, `base`, `baseKind`, `indicator`, `source`, `notes`, `cubeKeys`, `publishedBy` |
| `pairs` | (현황조사) 학생·교원 비교 쌍 |
| `indicators`, `areas` | (실태조사) 공통 지표 키, 영역 구분 |

문항 `type`: `likert5` `single` `binary` `multi` `rank` `item_likert5` `item_cat` `item_binary` `numeric` `events`.
조건부 문항 `base`: `{"qid":"S07","sameItem":true,"eq":1}` / `{"qid":"T11","in":[1,2,3,4]}` / `{"dim":"coord","eq":"1"}` — **`eq`/`in`은 0부터 세는 보기 번호**(binary는 0/1).

## 3. 원자료 CSV (`data/real/*.csv`, 양식: `TEMPLATE_*.csv`)

- 파일 하나 = 모집단 하나. 1행 = 응답자(또는 기관) 1명. UTF-8(BOM 허용).
- 열: `id`, 저장 축(`grade`,`sido`,… 코드값), 가중 모집단은 `weight`, 그리고 문항 열.
- 문항 열 규칙

| type | 열 이름 | 값 |
|---|---|---|
| likert5 / single / item_likert5 / item_cat | `qid`, `qid_item` | 1부터 세는 보기 번호 |
| binary / item_binary | `qid`, `qid_item` | 0 / 1 |
| multi | `qid__c1` … `qid__ck` | 0 / 1 (건 기준 표면 건수) |
| rank | `qid__1`, `qid__2`, `qid__3` | 1부터 세는 보기 번호 |
| numeric | `qid` | 숫자 |
| events | `qid__c1` … `qid__ck` | 범주별 건수 |
| (선택) | `<YN문항>__events` | 그 단위의 총 건수(사업 수 등). 없으면 범주 합으로 계산 |

- 빈칸 = 무응답/해당 없음. 조건부 문항은 베이스가 아닌 행을 빈칸으로 둡니다.
- 열 이름은 코드북의 `cubeKeys`와 일치해야 합니다. 합성 CSV(`data/synthetic/`)가 완전한 예시입니다.

## 4. 집계 큐브 `data/cubes/<pop>.json`

```json
{ "schemaVersion": 1, "pop": "student", "weighted": false,
  "dims": ["grade","sido","urban","gender"], "shape": [6,17,3,2], "ncell": 612,
  "units": [셀별 단위 수],
  "questions": {
    "S01":      {"k":5, "n":[셀별 응답 수], "v":[셀×k 합계]},
    "S07E_1":   {"k":5, "n":[...], "v":[...]},
    "S04_r1":   {"k":9, "n":[...], "v":[...]},
    "SCH_PLAN_N": {"k":5, "n":[...], "v":[...], "sum":[셀별 합], "sq":[제곱합], "b":[가중 응답 수], "ev":[건수 합], "bins":[...]}
  } }
```

- 셀 번호 = 축 코드 인덱스의 행 우선(row-major) 조합. `strides`는 `shape`에서 계산.
- `v`의 의미: 비가중이면 응답 수, 가중이면 가중치 합, 건 기준이면 건수 합. 비율 분모는 문항 유형별로 다릅니다(`js/aggregate.js` 참고).
- 사전 마스킹: `--suppress-min N` 으로 단위 수 N 미만 셀을 비운 큐브를 만들 수 있습니다. 축 축소: `--coarsen sido=region5s`.

## 5. 억제·표시 규칙(화면)

| 조사 | 규칙 |
|---|---|
| 사람 단위(현황조사) | 집단의 비가중 응답 수 < 30 → `–` 표시(`config.js` `suppression.person.minN`) |
| 가중 추정(유아·초중등) | 비가중 응답 수 < 10 → "불안정 추정" 표시 |
| 기관 전수조사 | 억제 없음 |

화면 억제는 표시 규칙입니다. **공개 큐브는 누구나 내려받을 수 있으므로** 실데이터에서는 큐브를 만들 때 `--suppress-min`·`--coarsen`으로 미리 보호합니다.

## 6. 실데이터 교체 절차(요약)

1. `data/real/`에 양식대로 CSV 저장(저장소에 올라가지 않음).
2. `python tools/build_cubes.py --real --suppress-min 30 --coarsen sido=region5s`
3. `data/cubes/*.json`만 배포. `config.js`에서 `synthetic: false`, `dataLabel` 수정, `buildId` 올리기.
4. (선택) `python tools/validate.py`로 공표값과 대조.

## 7. 검증 도구

- `tools/check_source.py` — 전사 JSON 구조 검사
- `tools/validate.py` — 큐브 재집계 vs 공표값(`data/validation_report.md`)
- `tests/test_build_cubes.py` — 큐브 생성기 단위 테스트(조건부·가중·건 기준·마스킹·드라이런)
- `tests/aggregate.test.mjs` — JS 집계와 파이썬 집계의 패리티

## 공표값 저장소와 연도 간 문항 대응 (실태조사 2024→2025)

```
data/source/s2_*.json (2025)  ─┐
data/source/2024/s2_*.json     ├─(tools/build_published.py)─▶ data/published/<연도>/<pop>.json ─▶ 추이·연도 보기, 공표값 우선 표시
data/link/status_survey.json  ─┘                              data/published/index.json (대응 색인)
```

- **공표값 저장소** `data/published/<연도>/<pop>.json`: `{schemaVersion, survey, pop, year, order:[qid…], questions:{qid: {…전사 표 그대로…, axes, hasAll}}}`. 숫자는 전사본과 같고(다시 계산하지 않음), 여부형 문항의 `positive`가 비어 있으면 인쇄된 `pct`에서 가져옵니다. 현황조사(2025)의 `student.json`·`teacher.json`도 같은 형태로 들어 있습니다.
- **문항 대응표** `data/link/status_survey.json` (사람이 관리): 기관별 `items[qid] = {status, reason | wording, all?, axes?}` 와 `trendAxes`(이을 축 제한), `note`.
  - `status`: `same`(동일) · `wording`(문구만 다름 — 두 해 설문 문구 `wording.2024/2025/diff` 필수) · `changed`(범위·정의 변경) · `base`(분모 다름) · `cats`(보기 다름) · `unit`(단위·산출 기준 다름) · `struct`(표 구성 다름). 한 해에만 있는 문항은 자동으로 `only2024`/`only2025`.
  - 대응표에 없는 문항은 생성기가 유형·보기·기준을 비교해 자동 판정합니다. `same`/`wording`으로 적었는데 형식이 다르면 생성이 오류로 멈춥니다.
  - 잇는 것은 `same`·`wording`뿐이고, 두 해 모두 공표된 집단(전체·공표 축)만 잇습니다. `all:false`, `axes:[…]`로 문항별로 좁힐 수 있습니다.
- **대응 색인** `data/published/index.json`: 연도 정보(`years[]`: 기준일·출처·참여 현황·가중 방식), 축 라벨, 기관별 문항 상태(`pops[pop].items[qid]`)와 집계(`summary`).
- **공표값 우선 표시**(`js/pubmerge.js`): 2025년 화면에서 필터가 없고 비교 축이 0~1개이며 그 집단의 값이 보고서에 인쇄되어 있으면, 합성 큐브 집계값을 인쇄값으로 덮어씁니다. 그 밖의 조합은 합성값 그대로입니다.
- 실데이터로 바꿀 때는 연도별 큐브에서 같은 형태의 `data/published` 파일을 만들면 화면은 그대로 동작합니다.
