# 프로젝트 견적서 작성기

별도 [quotation-neander](https://github.com/okkhoxo/quotation-neander) 프로그램의 5종 디자인과 입력 흐름을 프로젝트의 「견적 · 계약 → 새 견적서」 팝업으로 옮겼다.

- 프로젝트명·발주처·견적번호·최근 공급자 정보는 ERP에서 채운다.
- 새 견적은 기본 디자인으로 시작한다. 기존 문서는 디자인 값이 없으면 이전 ERP 판형으로 열린다.
- `FinQuoteInput`의 `design`, `category`, `receiver`를 `sanitizeFinDoc`에서 보존한다. 수신 상호는 기존 `recipient`를 사용한다.
- 문서·첨부 저장과 프로젝트 계약금액 반영은 기존 ERP 경로를 사용한다. 계약금액 반영은 프로젝트 초안을 바꾸므로 프로젝트 화면에서도 저장해야 한다.
- 금액은 `quoteTotals`와 `quoteLineAmount`를 공통 사용한다. 포함 단가는 VAT를 역산하고, 별도 단가는 VAT를 더한다. 프로젝트에는 품목 합과 VAT 기준을 함께 넘긴다.
- PDF는 브라우저 인쇄로 여러 페이지를 지원한다. PNG는 선택한 판형을 이미지로 저장한다. 엑셀은 기존 ERP 표에 동일 금액과 수신자 상세정보를 담는다.

## AI 입력 도우미

`POST /api/neander/finance/ai/quote`는 ERP 인증과 프로젝트 존재 여부를 확인한다. 텍스트·이미지·PDF·Office 파일에서 품목 또는 사업자 정보를 읽고 초안만 반환한다. 결과 검토 후 적용하고, 문서 저장은 따로 한다. 명시되지 않은 단가는 0원으로 남기고 확인 안내를 표시한다.

기존 서버의 `OPENROUTER_API_KEY`를 사용한다. 모델은 선택적으로 `OPENROUTER_QUOTE_MODEL`로 지정하며 미지정 시 ERP 기본 모델을 따른다. API 키나 원본 프로그램의 Firebase 설정은 클라이언트로 옮기지 않는다.

## 일해라컴퍼니 인감

인감 ID는 `ilhaera`다. 원본 이미지는 공개 파일에 포함하지 않고 로컬 `private/finance/seals/ilhaera.png`에 보관한다. 로컬 인증 라우트는 이 파일을 읽을 수 있다. 배포 환경에서 사용하려면 기존 보안 인감 저장소에 등록한다.

```sh
npm run finance:upload-seals
npm run finance:upload-seals -- --apply
```

첫 명령은 미리보기이며, 두 번째 명령은 등록된 로컬 인감 중 변경된 이미지를 Firestore에 올린다. `private/`는 Git에서 제외되므로 인감 업로드와 코드 배포는 별도 작업이다.

## 검증

```sh
npx tsx --test lib/neander/finance/quote-integration.test.ts lib/neander/finance/quote-assist.test.ts lib/neander/finance/contract.test.ts
npx tsx --conditions react-server --test lib/neander/finance/server/ai-quote.test.ts
node e2e/quotation-ui.mjs
```

UI 검증은 실제 편집기를 가상 데이터와 함께 렌더링하고 저장·인감·AI 요청을 테스트 응답으로 대체한다. 실제 문서 저장이나 유료 AI 호출은 하지 않는다. 화면 캡처와 출력 검증 파일은 Git에서 제외된 `output/quotation-integration/`에 남긴다.
