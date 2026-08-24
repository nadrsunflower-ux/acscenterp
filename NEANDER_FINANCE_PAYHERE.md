# 페이히어(POS) 매출 → 재무 장부 자동 반영 — 조사 기록 및 재개 가이드

작성: 2026-08-23 · 상태: **페이히어 Open API 문의 답변 대기 (2026-08-24 월요일 전후 예상)**

결정: **페이히어 API 연동이 아니면 진행하지 않는다.** 엑셀 반자동·여신금융협회 우회 경로는
검토했지만 채택하지 않았다(아래 "채택하지 않은 경로" 참고). 답변이 오면 이 문서의
"재개 시 할 일"부터 시작한다.

---

## 1. 조사 결론 (2026-08-23 기준)

### 페이히어 측

- **일반 가맹점에 공개된 개발자 API·웹훅·API 키 발급은 없다.** 홈페이지·도움말 센터 전체에
  개발자 문서가 없고, `developers.payhere.in` / `docs.payhere.in` 도메인도 존재하지 않는다.
  - 검색에 잡히는 `developers.payhere.co`, `support.payhere.lk`, GitHub `PayHereLK` 는
    **스리랑카의 동명 회사**다. 무관하니 헷갈리지 말 것.
- API는 **엔터프라이즈/프랜차이즈 상품으로만** 존재한다.
  - https://payhere.in/enterprise/ — "직접 연동할 수 있는 Open API 셀프 서비스",
    "자체 개발이 어려운 경우 페이히어 팀이 커스터마이징 및 지속적 기술 지원"
  - https://payhere.in/franchise/ — "맞춤형 API 연동, 개발" 사례: 안상규벌꿀(결제 내역·주문서 →
    본사 택배 시스템), 렌즈타운(결제·발주 → SCM 재고), 롸버트치킨(자체 매출 대시보드 연동)
  - 요금·대상(매장 수 조건)·일정 모두 비공개. 영업 상담을 거쳐야 열린다.
- 페이히어 기술 블로그의 "단 하나의 API 사이트"(tech.payhere.in)는 **사내 Swagger 통합**이고
  글에서 "외부 API나 오픈 API가 아닌" 것이라 명시. 외부용 문서가 아니다.
- 가맹점이 쓸 수 있는 내보내기는 **"매출 내역 이메일 전송"** 하나뿐.
  - 경로: 앱 더보기 → 매장 분석 → 매출 분석 → [매출 내역 이메일 전송]
  - 31일 이내 구간만, 예약/정기 전송 없음.
  - 엑셀 시트: 전체 매출 내역 / 상품별 / 시간대별 / 일별 상품 매출
  - 출처: https://help-center.payhere.in/1a503641-d648-8058-830f-efa9234faf9d
- 세무 프로그램(더존·삼쩜삼 등) 공식 연동 없음. 부가세 자료는 앱 또는 VAN사(KOCES·NICE)에서.

### 우리 재무 모듈 측 (붙일 자리는 이미 있음)

- 매장 매출 계정이 마스터에 존재: `수입|매출|B2C매출|와우판매`(SL-002, HON),
  `아이디판매`(SL-003, ID), `팝업현장판매`(SL-006). 새 스키마 불필요 —
  `FinTransaction`(`lib/neander/finance/types.ts`)에 그대로 매핑.
  - `bizMajor="B2C"`, `bizMinor="와우"|"아이디"`, `site`, `last4`(결제수단) 사용.
- 쓰기 API: `app/api/neander/finance/mutate/route.neander.ts` —
  `transaction.bulkAdd`(450건 writeBatch) + `import.create`(배치 이력, 통째 되돌리기).
- 임포트 레퍼런스 구현: `scripts/neander/import-ledger.ts` (Admin SDK 직접 초기화 + dedup + 분류 + 배치 기록).
- 재무와 무관한 간이 매출 등록 `neander_sales`(`lib/neander/db/sales.ts`)가 따로 있다.
  자동 유입은 **재무 장부(`neander_fin_transactions`)** 에 넣는 것으로 정한다.

### 붙일 때 걸리는 제약 (코드에서 확인)

1. **머신 인증 없음.** `lib/neander/finance/server/auth.ts`의 `requireFinanceUser`는 사람의
   Firebase ID 토큰만 받는다. 외부 유입·cron용 인증 분기(공유 시크릿 헤더 등)가 필요.
2. **스케줄러/웹훅 인프라 0.** `vercel.json` 없음, `firebase.json`에 functions 블록 없음.
   현 아키텍처와 가장 맞는 건 `vercel.json` `crons` + `route.neander.ts` + `CRON_SECRET` 검증.
3. **중복 방지.** `dedupHashOf({date,last4,vendor,gross,txType})`는 의도적으로 비유일.
   POS 거래번호/승인번호를 별도 필드(예: `externalId`)로 두고 그걸로 막아야 한다.
4. **파일명 규칙.** 새 API는 반드시 `route.neander.ts` (매장 빌드에서 라우트 제외).
5. **분류 원칙.** 확신 없으면 `needs_review`. 자동 유입분도 `confirmed` 남발 금지.
6. **읽기 성능.** `data` 라우트가 전건 로드. 자동 유입으로 건수가 늘면 월 단위 쿼리 전환 선행.

---

## 2. 채택하지 않은 경로 (왜 안 하는지)

| 경로 | 결론 | 이유 |
|---|---|---|
| 페이히어 엑셀 → 기존 임포터 | 보류 | 사람이 매월 파일을 받아 올려야 함. "자동 반영"이 아님 |
| 여신금융협회 카드매출 (CODEF 경유) | **사실상 불가** | CODEF 현행 카탈로그에서 여신금융협회 상품 목록이 비어 있음(카테고리만 잔존). 여신금융협회가 외부 프로그램 신규 로그인(스크래핑)을 제한(더존 WEHAGO 공지). 협회 공식 매통조 API는 이용기관(토스·카카오뱅크·카드사 등) 전용 |
| 홈택스 신용카드 매출자료 (CODEF `KR_PB_NT_071`) | 부적합 | 월별·카드사별 합계라 일일 매출 불가. 월 마감 대사용으로만 의미 |
| VAN사(KOCES·NICE) 포털 엑셀 | 부적합 | 수동, 페이히어 엑셀과 중복 |

참고 — CODEF "일 100회 무료"의 실체: **3개월 데모** 한도이지 영구 무료가 아님. 정식은 심사 + 월 구독(비공개).
1회 = HTTP 요청 1건(조회 기간·건수 무관). 우리 용도(전날치 1일 1회)는 사업자 수 × API 종류 = 최대 6회/일.

---

## 3. 재개 시 할 일 (페이히어 답변 도착 후)

### 3-1. 답변에서 확인할 것

- [ ] 우리 규모(매장 2곳)에 Open API를 **열어주는가** — 아니면 엔터프라이즈 계약 조건(최소 매장 수/월 요금)
- [ ] 제공 형태: **REST 조회 API**(날짜 범위로 결제 내역 pull) vs **웹훅**(결제 발생 시 push) vs 둘 다
- [ ] 인증 방식: API 키 / OAuth / IP 화이트리스트
- [ ] 결제 내역 단위 데이터에 다음이 있는지
  - 거래 고유 ID(승인번호 포함), 결제 일시, **매장 구분**, 결제수단(카드/현금/간편결제/포인트), 금액(총액·할인·부가세), **환불/취소** 식별
  - 상품 라인아이템(있으면 좋고, 없어도 매출 반영엔 지장 없음)
- [ ] 조회 가능 기간·호출 제한·샌드박스 유무
- [ ] 요금 및 계약 기간, 개발 지원(문서 링크 / 담당자)

### 3-2. 답변이 "가능"이면 구현 순서

1. **문서 확보** → 이 파일 4장에 엔드포인트·필드 요약 기록.
2. **스키마 보강**: `FinTransaction`에 `externalId?: string`(POS 거래 ID) + `source?: "payhere"` 추가.
   dedup은 `externalId` 존재 시 그것으로만 판정.
3. **변환기** `lib/neander/finance/payhere/map.ts`: 페이히어 결제 1건 → `FinTransaction`
   - 매장 → `bizMinor`(와우/아이디) + 계정 `수입|매출|B2C매출|{와우판매|아이디판매}`
   - 결제수단 → `last4`(계좌·카드 마스터 조인) / 현금은 현금 계좌
   - 취소·환불 → `adjust` 또는 별도 `환급` 거래 (장부 관례에 맞춰 결정)
   - 매핑 불명확 → `status: "needs_review"`
4. **유입 경로**
   - 웹훅이면: `app/api/neander/finance/payhere/webhook/route.neander.ts` — 서명 검증 → 변환 → `bulkAdd`
   - REST pull이면: `app/api/neander/finance/payhere/sync/route.neander.ts` + `vercel.json` `crons`(매일 새벽, 전날치) + `CRON_SECRET`
   - 둘 다 `neander_fin_imports`에 배치 문서 남겨 되돌리기 가능하게.
5. **인증 분기**: `server/auth.ts`에 `requireCronOrFinanceUser` 추가(헤더 시크릿 or ID 토큰).
6. **환경변수**: `PAYHERE_API_KEY`(또는 client id/secret), `PAYHERE_WEBHOOK_SECRET`, `CRON_SECRET` —
   `.env.local` + Vercel(neander 프로젝트)에 등록. `NEANDER_ERP_SETUP.md`에 추가.
7. **검증**: 페이히어 엑셀(이메일 전송)과 API 결과를 같은 기간으로 대사 → `scripts/neander/verify-finance-import.ts` 패턴 재사용.
8. **초기 적재**: 조회 가능 기간만큼 과거분 백필(배치 1개로).

### 3-3. 답변이 "불가/고가"이면

- 이 문서를 "종결"로 표시하고, 재무 장부의 매장 매출은 현행대로(월별 엑셀 장부 임포트) 유지.
- 페이히어 엑셀 반자동 경로는 필요해지면 2장의 보류를 풀어 재검토.

---

## 4. 페이히어 API 사양 (답변 후 채울 것)

- 문서 URL:
- 인증:
- 엔드포인트 / 웹훅 이벤트:
- 결제 객체 필드:
- 제한(기간·호출):
- 요금·계약:
- 담당자:

---

## 참고 링크

- 페이히어 엔터프라이즈 https://payhere.in/enterprise/ · 프랜차이즈 https://payhere.in/franchise/
- 도움말 센터 https://help-center.payhere.in/ · 매출 현황·장부 https://help-center.payhere.in/1a503641-d648-8058-830f-efa9234faf9d
- 페이히어 고객센터 1522-1902 (평일 09–21, 주말 10–21)
- 여신금융협회 Open API https://openapi.crefia.or.kr/main · 이용기관 공시 https://www.crefia.or.kr/portal/thirdParty/portalThirdPartyList.xx
- CODEF https://codef.io/ (여신금융협회 상품은 현재 카탈로그에 없음)
