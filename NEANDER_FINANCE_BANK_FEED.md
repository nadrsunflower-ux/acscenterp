# 은행 입출금·법인카드 내역 자동 수집 — 조사 기록

작성: 2026-08-23 · 상태: **조사 완료, 결정 대기**
관련: `NEANDER_FINANCE_PAYHERE.md`(POS 매출 연동 — 페이히어 답변 대기)

목표: 현재 더존 WEHAGO T edge "통장입출금현황"으로 보는 법인계좌 8개(신한 4·우리 3·국민 1)의
입출금과 법인카드 사용내역을 사내 ERP 재무 장부(`neander_fin_transactions`)에 자동 적재.

---

## 1. 결론

| 경로 | 은행 | 카드 | 요금 | 우리 규모 현실성 |
|---|---|---|---|---|
| **팝빌 계좌조회(EasyFinBank)** | ◯ 신한·우리·국민 법인계좌 | ✕ 없음 | **계좌당 월 5,000원**(8계좌 ≈ 4만원, VAT 미확인) | **높음** — Node SDK, 1개월 무료, 문서 공개 |
| **바로빌 계좌조회 + 카드조회** | ◯ 20개 은행 | ◯ 10개 카드사 승인·매입 | 비공개(구간별 월정액, 문의) | 중간 — SOAP/WSDL, 공식 Node SDK 없음 |
| **CODEF** | ◯ 20개 은행(기업은 **공동인증서 전용** 또는 빠른조회 상품) | ◯ 14개 카드사 승인·청구 | 건당 2원 + **월 최소요금제**(금액 비공개, 과거 50만원 수준) + 인증서 릴레이 월 50만원 | **낮음** — 기능은 최대, 요금은 기업용 |
| 금융결제원 오픈뱅킹 이용기관 | 법인계좌는 2025.1부터 은행 채널만, API 채널 미개방 | — | 건당 10원 + 보안점검 | 불가(업종·심사·보안점검 3중 장벽) |
| 은행별 기업 API(신한 뱅크인·우리 WIN-CMS·KB 기업 Open API) | 제휴 ERP/솔루션사 경유 구조 | — | 협의 | 낮음(자체 ERP 직접 연결 사례 없음) |
| 카드사 EDI(현대 ERP연계·삼성 Ez-Work·우리카드 API·BC BCAS) | — | 카드사별 개별 계약, D+1 배치 | 대체로 무료~소액 + 중계사 월 1만원 | 중간(카드사 수만큼 계약) |
| WEHAGO Open API | 없음 | 없음 | — | 불가 |
| 마이데이터 | 법인 적용 불가(신용정보법 §2 9의2 "개인") | — | — | 불가 |

**권고**: 은행은 **팝빌 계좌조회**로 시작(월 4만원 내외, 2~3일이면 붙음). 카드는 ①사용 카드사가 1~2곳이면
카드사 EDI 직접, ②여러 곳이면 **바로빌 카드조회** 견적을 받아 결정. CODEF는 견적이 월 10만원 이하로
나오지 않는 한 제외.

**모든 현실적 경로가 스크래핑**(은행 빠른조회 ID / 카드사 웹 ID 기반)이다. WEHAGO도 같은 방식이라
카드사·은행 사이트 개편 때 수집이 끊기는 리스크는 동일하다(WEHAGO 공지에 BC·삼성·현대·우리·농협 중단 사례 반복).

### 자체 스크래핑(위하고처럼 직접 긁기) — 검증 결과: 사실상 불가 (2026-08-23 페이지 직접 분석)

신한·국민·우리 세 은행의 빠른조회 페이지를 직접 받아 확인. **세 곳 모두 비밀번호 입력칸에
키보드보안/E2E 암호화 모듈이 걸려 있어** 단순 HTTP POST(평문 비밀번호)로는 거부된다.

| 은행 | 경로 | 확인된 장벽 |
|---|---|---|
| 우리 | 스피드계좌조회 `withyou=BICOM0117` | 비번칸 `npkencrypt="on"`(nProtect), 제출 시 `npPfsCtrl.toJson()`로 암호화 후 `/nbi/jcc` 전송. 최대 600건 |
| 국민 | 빠른조회 팝업 `page=C025255` | ASTx(안랩)+nProtect 키패드(`nppfs`)+WIZVERA Delfino+E2E(`secukey.INI7E2ESTATE`)+캡차. "통합보안프로그램 설치" 팝업 |
| 신한 | 간편서비스 계좌조회 `EZ02010RM00.xml` | WebSquare + ASTx 보안모듈 |

공개 예제 코드는 전부 사망: Beomi/kb_transaction(IE 전용·가상키보드 못 뚫어 archived, 2019),
juragi/KbQuick(2018, "될 때도 안 될 때도"). 신한은 "통합 자산 정보 조회(스크래핑) 서비스 이용신청서"라는
별도 신청 서식 존재 → 임의 스크래핑 대상이 아님.

DIY 선택지 둘 다 비현실적: ①헤드리스 브라우저로 보안 JS 실행 — ASTx·nProtect가 OS 네이티브 에이전트
요구 + 헤드리스 탐지·거부 / ②은행별 암호화 로직 리버스 — 은행 스크립트 변경 시마다 조용히 0건, 3은행 상시 유지보수.
→ **이 암호화·유지보수를 대신 사는 것이 팝빌 월 4만원.** 자체 구현은 투입 대비 실익 없음. 배제.

---

## 2. 스크린샷에서 확인한 사실 (2026-08-17~23 주간)

- 신한 140-01428-4248 계좌에 **카드사별 정산 입금**이 매일 찍힌다: `Npay정산`, `NH…`, `KB…`, `하나…`,
  `SHC…`(신한카드), `삼성…`, `롯데…`, `…BC`. → 은행 피드만 자동화해도 카드 매출의 **입금(수수료 차감 후)**
  측은 카드사별로 잡힌다. 여신금융협회 입금내역 경로(`NEANDER_FINANCE_PAYHERE.md` 2장, 현재 불가)의 대체재.
- 8계좌 중 잔액 1,680원·1,298원짜리 휴면 계좌 2개는 수집 대상에서 빼면 월 1만원 절감.

---

## 3. 팝빌 계좌조회 — 구현 메모

- 가입: popbill.com/PartnerRequest → LinkID/SecretKey → test.popbill.com에서 개발 → 유선 협의 후 운영 전환.
  최소 충전 11,000원. 계좌조회 1개월 무상.
- 계좌 등록 요건(은행별): **국민** 사업자번호+계좌번호+계좌비밀번호+인터넷뱅킹 ID /
  **신한** 사업자번호+계좌번호+비밀번호+**조회전용 ID/PW** / **우리** 사업자번호+계좌번호+비밀번호(**스피드조회계좌 등록 선행**).
  원화 입출금 계좌만(외화·예적금 불가).
- 수집 모델: **온디맨드**. `requestJob(CorpNum, BankCode, AccountNumber, SDate, EDate)` → `getJobState` 폴링(jobState 3)
  → `search(JobID, TradeType, …, PerPage≤1000)`. 1회 요청 최대 1개월 구간, **조회일 기준 3개월 이전까지만** → 과거분 백필은 엑셀 장부 유지.
- 응답 필드: `tid`(거래 고유 ID), `trdate`, `trdt`(yyyyMMddHHmmss), `accIn`, `accOut`, `balance`, `remark1~4`(은행별 상이), `lastscrapdt`.
- SDK: npm `popbill` (linkhub-sdk/node-popbill, MIT) → `popbill.EasyFinBankService()`.

### 우리 장부로의 매핑

| 팝빌 | `FinTransaction` |
|---|---|
| `tid` | `externalId`(**신규 필드**, 중복 방지 키) + `source: "popbill"` |
| `trdate` | `date` (YYYY-MM-DD) · `trdt` → `datetime` |
| 계좌번호 뒷4자리 | `last4` → `neander_fin_payment_methods` 조인으로 `site`(법인) 결정 |
| `accIn` > 0 | `txType: "수입"`, `gross = accIn` |
| `accOut` > 0 | `txType: "지출"`, `gross = accOut` |
| `remark1~4` | `vendor`(대표 적요) + `note`(나머지) → `neander_fin_vendor_rules`로 자동분류 |
| 분류 확신 없음 | `status: "needs_review"` (원칙: 추측으로 `confirmed` 금지) |
| 계좌 간 이체·카드대금 | `txType: "자금거래"` / `"카드대금결제"` — 상대계좌 `last4` 매칭 규칙 필요 |

### 인프라(페이히어 연동 계획과 공유)

1. `vercel.json` `crons` — 매일 새벽 전일분 수집. 라우트 `app/api/neander/finance/bank/sync/route.neander.ts`
   (**파일명 `route.neander.ts` 필수**) + `CRON_SECRET` 헤더 검증 분기(`server/auth.ts`).
2. 배치마다 `neander_fin_imports` 문서 생성(`byEmail: "cron:popbill"`) → 기존 화면에서 통째 되돌리기 가능.
3. env: `POPBILL_LINK_ID`, `POPBILL_SECRET_KEY`, `POPBILL_CORP_NUM`, `CRON_SECRET` — `.env.local` + Vercel(neander).
4. 건수 증가 대비 `data` 라우트 월 단위 쿼리 전환(ROADMAP 알려진 한계).
5. 대사: 월말에 WEHAGO 화면 합계(입금/출금/잔액)와 장부 집계 비교 — `balance` 필드로 잔액 연속성 검증 가능.

---

## 4. 법인카드 — 선택지 메모

- **바로빌 카드조회**: SOAP `https://ws.baroservice.com/CARD.asmx` — `Register`(카드사 웹 ID/PW), `GetApprovalHistories`,
  `GetPurchaseHistories`, `RefreshNow`. 응답에 `ApprovalNum, ApprovalDT, Amount, Tax, StoreName, StoreCorpNum, StoreTaxType`.
  Node는 `soap` 패키지로 WSDL 직접 호출. 요금 문의 070-4040-5617.
- **CODEF 법인카드**: 14개사, ID/PW 로그인 가능(삼성·하나는 ID만, 씨티·전북·수협·제주는 인증서만). 요금 장벽.
- **카드사 EDI**: 현대 MY COMPANY ERP연계(쿠콘·파투아 중계), 삼성 Ez-Work(외감법인 한정), 우리카드 API포털, BC BCAS.
- **홈택스 사업용신용카드 매입내역**: 법인카드는 등록 불요, 단 **매월 15일경 직전월분** → 월 마감·부가세용. 공식 API 없음(중개사 스크래핑만).
- 카드 승인 내역의 장부상 자리: `txType: "지출"` + `last4`(카드) + 가맹점 → `vendor`; 월 결제일 출금은 `"카드대금결제"`로 은행 피드에서 잡힘 → 이중계상 방지 규칙 필요.

---

## 5. 채택 방향 (2026-08-23 결정)

**1단계 = 수동 엑셀 업로드부터 시작.** 은행·카드사에서 정기적으로 거래내역 엑셀을 받아
기존 임포트 경로(`app/neander/finance/import` 화면 + `scripts/neander/import-ledger.ts`)에 태운다.
자동화(팝빌 등)는 이 위에 나중에 얹는다: 수동 → 반자동 → 자동.

이유: ①이미 인프라 존재(업로드 화면·CLI·`xlsx.ts` 파서) ②의존성 0(팝빌 계약·계좌 등록·페이히어 답변 불요)
③현금 매출·전 계좌·전 카드사 커버 ④스크래핑 리스크 없음.

### 구현 순서

1. **샘플 확보(유일한 대기 지점)** — 신한·국민·우리 각 거래내역 엑셀 1개 + 사용 법인카드사 사용내역 엑셀 1개.
   은행·카드사마다 열 구성이 달라 실제 파일 없이는 변환기를 못 짠다.
2. **소스별 변환기** `lib/neander/finance/import-sources/` — 각 엑셀 → `FinTransaction`.
   - 은행: 입금>0 → `수입` / 출금>0 → `지출`, 계좌 뒷4 → `last4` → `site`, 적요 → `vendor` → 기존 거래처 규칙 자동분류, 계좌 간 이체·카드대금 → `자금거래`/`카드대금결제`
   - 카드: 가맹점 → `vendor`, 카드 뒷4 → `last4`, 승인일 → `date`; 월 결제 출금은 은행 피드에서 잡히므로 이중계상 방지 규칙 필요
   - 분류 불명확 → `status: "needs_review"`
3. **중복 방지** — `FinTransaction`에 `externalId?`(은행 거래키/카드 승인번호) + `source?` 추가.
   같은 파일 반복 업로드해도 `externalId`로 스킵. (자동화 단계와 공유하는 필드)
4. **업로드 화면**에 소스 선택 드롭다운(장부/신한/국민/우리/카드) 추가 — 기존 `createFinImport`+`bulkAdd` 흐름 재사용, 배치 되돌리기 유지.

### 파일 수동 확보 경로(스크래핑 아님)
우리=스피드계좌조회 화면 엑셀 / 국민·신한=기업뱅킹 거래내역 엑셀 / 카드=카드사 기업 포털 또는 홈택스 사업용신용카드.

### 나중 결정 (자동화 단계로 미룸)
- [ ] 팝빌 계좌조회 도입 여부 (도입 시 신한 조회전용ID·우리 스피드계좌·국민 빠른조회 등록 선행)
- [ ] 법인카드사 목록 확정 → 1~2곳 EDI / 3곳↑ 바로빌
- [ ] 휴면 계좌 2개 제외 여부
- [ ] 페이히어 답변과 합쳐 cron·머신 인증·`externalId` 한 번에 설계

---

## 참고 링크

- 팝빌 계좌조회 https://www.popbill.com/AccountTransaction/API · 요금 https://www.popbill.com/Pricing ·
  은행별 등록정보 https://developers.popbill.com/guide/easyfinbank/introduction/regist-bank-account ·
  Node API https://developers.popbill.com/reference/easyfinbank/node/api/job · SDK https://github.com/linkhub-sdk/node-popbill
- 바로빌 계좌 https://dev.barobill.co.kr/services/bankAccount · 카드 https://dev.barobill.co.kr/services/card ·
  요금 https://dev.barobill.co.kr/partners/cost/partner · WSDL https://ws.baroservice.com/CARD.asmx
- CODEF 기업 수시입출 https://developer.codef.io/products/bank/common/b/transaction · 법인카드 승인 https://developer.codef.io/products/card/common/b/approval ·
  2025-02 이용정책 변경(최소요금 비공개) https://codef.io/cs/notice/detail/0/1/93
- 오픈뱅킹 법인계좌(2025.1, 은행 채널) https://www.fsc.go.kr/no010101/83750 · 이용기관 요건 https://fsc.go.kr/po010101/73746
- KB 기업 Open API https://obizapi.kbstar.com/quics?page=C108082 · 신한 뱅크인 https://www.hankyung.com/article/202501070366i · 우리 WIN-CMS https://nbi.wooribank.com/nbi/woori?withyou=BIBNK0236
- 카드사 EDI vs 스크래핑 비교 https://docs.spendit.kr/ko/articles/8119168 · 현대카드 ERP연계 https://mycompany.hyundaicard.com/ · 삼성 Ez-Work https://www.samsungcard.com/corporation/services/ez-work/UHPCBE0101M0.jsp
- WEHAGO T edge 통장입출금현황 https://wehagotedgehelp.zendesk.com/hc/ko/articles/4413973360537
- 마이데이터 법인 불가 근거(신용정보법 §2 9의2) https://casenote.kr/법령/신용정보의_이용_및_보호에_관한_법률/제2조
