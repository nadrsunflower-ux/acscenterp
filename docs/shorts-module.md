# AI STUDIO 워크스페이스 (/neander/shorts)

AI 로 만드는 영상을 한 흐름으로 다룬다. 영상은 세 종류다.

- **쿠팡 제휴 영상** — 소재 발굴 → 중국어 소스 → 쿠팡 동일 상품 → 성공 공식 · 대본 → 편집 · 출력 → 계정 게시 → 성과.
- **고객사(브랜드) 영상** — 고객사 계약 · 브리프 · 제품 → 월별 영상 → 편집 · 출력 → 고객 검토(링크) → 승인한 파일만 게시 → 월간 보고.
- **일반 영상 (제휴 없음)** — 제휴 링크 · 협찬 · 대가가 없는 영상(예: 다이소 목록 · 살림 정보). 고지 문구 · 영상 안 고지 띠 · 「쿠팡 확인」 탭이 없고, 확인 항목은 「제휴 링크 · 협찬 · 대가 없음」(프로그램이 제목 · 문구 · 대본에서 쿠팡 링크와 「쿠팡 파트너스 · 유료 광고 · 협찬」 을 찾고 사람이 확인 — 찾으면 사람 확인으로 못 넘김) · 표현 확인 · 소스 기록(선택)뿐이다. 쿠팡 ↔ 일반은 영상 화면 위에서 바꾸고, 고객사 영상과는 서로 바꿀 수 없다. 고객사 소유 계정에는 올리지 않는다. 쿠팡 파트너스 승인 전에도 게시를 시험할 수 있다.

이름: 화면에는 **AI STUDIO**(워크스페이스) · **영상**(「내 영상」 「새 영상」)으로 보인다. 처음 이름이 「쇼핑쇼츠」 라서 주소(`/neander/shorts/*`) · 컬렉션(`neander_shorts_*`) · 코드 이름(`ProjectDoc` · `projectId` 등)은 그대로 둔다. 플랫폼 형식인 「쇼츠」(YouTube Shorts)는 그대로 쓴다.

프로토타입(`~/Developer/shoppingshorts/studio`)의 모델 · 게시 어댑터 · 프롬프트 원칙을 옮겼다. Cloudflare(Sites 인증 · D1 · R2)는 ERP 의 Google 로그인 · Firestore · 서버 API 로 바꿨다.

## 구조

| 자리 | 내용 |
| --- | --- |
| `app/neander/shorts/*` | 화면 (워크스페이스 메뉴 `SHORTS_NAV` · nav-config.ts) |
| `app/api/neander/shorts/*` | `data` · `mutate` · `media` · `jobs` · `ai` · `research` · `publish` · `oauth`(+`callback`) · `cron` |
| `lib/neander/shorts/model.ts` | 점수 산식 · 고지 문구 · 정책 확인 · 자막 · SRT · 중복 열쇠 · 성과 합계 (순수 함수) |
| `lib/neander/shorts/render.ts` | 브라우저 출력기 (mediabunny/WebCodecs → H.264/AAC MP4) |
| `lib/neander/shorts/server/*` | 저장 · 권한 · 파일 조각 · 작업 큐 · 실행기 · 외부 어댑터 |
| `components/neander/shorts/*` | 공급자 · 실행기 · 영상 탭 · 미리보기 |

컬렉션은 모두 `neander_shorts_*` (collections.ts). 보안 규칙에 없어 **서버만** 읽고 쓴다.

## 권한 · 데이터 분리

- 입장: NEANDER 팀원(`requireMember`). `NEANDER_SHORTS_EMAILS` 가 있으면 그 목록만.
- 문서마다 `owner` · `visibility`. 비공개는 소유자만, 팀 공개는 모듈 사용자 누구나 읽고 고친다. 지우기 · 공개 범위 바꾸기는 소유자만.
- 게시 계정은 연결한 사람의 것. 소유자가 `sharedWith` 에 팀원을 넣어야 그 사람이 게시할 수 있다. 토큰은 AES-256-GCM(AAD = 계정 문서 id)으로 서버에만.
- 출처 위조 막기: 숫자의 `src: "api"` 는 서버가 공식 API 로 받아 적을 때만 생긴다. 확인한 사람(동일 상품 · 정책 확인 · 제휴 링크)은 서버가 요청자로 찍는다.

## 사람별 채널 세트 · 몰아보기

- 사람마다 **채널 세트**를 따로 둔다: 내가 연결한 YouTube · Instagram 계정 + 내 쿠팡 파트너스 키(Access · Secret, AF 코드) + 채널 아이디(subId) 목록 + (선택) 내 YouTube 검색 키. `neander_shorts_profiles/{ERP 이메일}` · 키는 암호문(AAD = `profile:` + 이메일) · 화면에는 끝 4자리와 상태만.
- 쿠팡 키는 공유하지 않는다 (파트너스 FAQ: API 키 1개 · 공유 불가). 계정은 공유할 수 있지만, 그 계정용 딥링크는 **계정 주인의 키 · 계정의 채널 아이디**로 서버가 만든다.
- 어느 키를 쓰나: 검색 = 내 키 → 없으면 회사 공용 키(환경변수) · 딥링크 = 게시 계정 주인의 키(회사 키로 대신 안 함) · 리포트 = 각자 자기 키로 자기 링크(`affiliate.coupangOwner`)의 실적만 · 쿠팡 429 면 24시간 그 키를 부르지 않는다.
- 게시 전 점검이 「제휴 링크 주인 = 게시 계정 주인」 을 본다 — 다르면 막는다 (그 사람의 파트너스에 등록되지 않은 채널에서 활동하는 셈).
- 화면 위쪽 「보기」: 내 것(기본) · 볼 수 있는 전체 · 사람별. 「사용자별 현황」(`/neander/shorts/team`)은 사람마다 채널 세트 · 쿠팡 키 상태 · 영상 · 게시 · 성과를 한 줄로.
- AI STUDIO 관리자(`NEANDER_SHORTS_ADMIN_EMAILS`, 없으면 `NEXT_PUBLIC_NEANDER_ADMIN_EMAILS`)는 모든 사람의 것을 **읽기 전용**으로 본다 — 남의 비공개 영상은 탭이 잠기고, 고치기 · 생성 · 게시는 서버가 막는다. 관리자가 아니면 자기 줄과 팀 공개만.

## 고객사(브랜드 대행) · 고객 검토

- `neander_shorts_clients` — 계약(월 금액 · 부가세 · 월 편수 · 한 편당 수정 횟수 · 시작/끝 월 · 재무 코드) · 브리프(요약 · 대상 · 말투 · 핵심 메시지 · 반드시 넣을 것 · **금지 표현** · 참고) · 제품(확인된 사실 · 실사진) · 담당자. **조회수 약속 칸은 없다.**
- 권한: 담당자(`members`)만 읽고 고친다 · 만든 사람은 늘 담당자 · 지우기는 만든 사람(영상 · 고객사 계정이 남으면 거절). 관리자는 읽기만. 담당자 목록은 그 고객사의 영상(`members`) · 고객사 계정(`clientMembers`)에 사본으로 붙고, 바뀌면 함께 고친다.
- 영상 추가: 그 달 계약분(`month`) · 제품의 사실이 대본 재료 · 정찰 형식 카드를 고르면 훅 · 구성 · 편집이 참고 자료로. 올릴 곳 = 고객사 계정(자기 광고 — 고지 없음) 또는 우리 채널(「광고 · {고객사} 유료 광고」 첫 줄 + 영상 안 고지 띠).
- 고객 검토: 「검토 보내기」 → `/neander/review/<토큰>` (30일 · 로그인 없음 · 그 영상 한 편만). 토큰은 저장하지 않는다(문서 id = sha256). 회차마다 한 번만 답하고, 새 회차가 나가면 앞 링크는 거둬들인다. 수정 요청은 계약의 수정 횟수로 세고, 넘은 요청도 기록하되 「계약 범위 밖」(`extra`)으로 표시. 카톡 · 메일로 받은 답은 담당자가 대신 기록(누가 기록했는지 남음).
- 게시: 브랜드 영상의 점검 항목은 (우리 채널이면) 고지 2개 + **고객사 승인**(승인된 그 파일만 · 사람 확인으로 넘길 수 없음) + 금지 · 의심 표현 + 소스 출처(선택). 쿠팡 항목은 없다. 다른 고객사의 계정 · 고객사 계정에 쿠팡 영상은 막는다. 예약 · 게시된 뒤에는 「승인 취소」 불가.
- 월간 보고 `/neander/shorts/clients/<id>/report?month=YYYY-MM` — 브라우저 인쇄 → PDF. 성과는 기록된 값만(출처 표시) · 「조회수는 계약상 약속이 아님」 · 다음 달 제안은 정찰 주간 보고에서.

## 작업 큐

Firestore `neander_shorts_jobs` + 임대(90초). 실행기 `tick()` 은 한 번에 시간 예산만큼만 돈다.

- 부르는 곳: 열린 ERP 화면(`ShortsRunner` — 쇼츠 화면이거나 이 브라우저가 작업을 만들었을 때만), Vercel Cron(매일 06:30 KST), 화면의 「지금 실행」.
- 임대가 끝난 running 작업: 브라우저 출력 → `interrupted`, 서버 · 쓰기 도중 → `uncertain`(자동 재시도 금지), 서버 · 읽기 → 다시 `queued`.
- 종류: `ai_video`(submit → poll → download), `tts`(줄마다), `publish`(YouTube 업로드 / Instagram 컨테이너 → rupload → 처리 대기 → 게시), `render`(브라우저 실행 · 서버는 진행 · 결과만 기록).
- 게시 원장 문서 id = `publicationKey(계정, 완성 파일, 플랫폼)` 를 `create()` 로 잡아 중복을 막는다.

## 환경변수

| 이름 | 필수 | 용도 |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | (이미 있음) | 분석 · 대본 · 중국어 검색어 · AI 음성 · AI 영상 |
| `CRON_SECRET` | (이미 있음) | `/api/neander/shorts/cron` |
| `NEANDER_SHORTS_YOUTUBE_API_KEY` | 선택 | 회사 YouTube 검색 키 — 개인 검색 키가 없는 사람이 쓴다 |
| `NEANDER_SHORTS_GOOGLE_CLIENT_ID` · `_SECRET` | YouTube 게시 | Google OAuth 웹 클라이언트 |
| `NEANDER_SHORTS_META_APP_ID` · `_SECRET` (· `_CONFIG_ID`) | Instagram 게시 | Facebook 로그인 for Business |
| `NEANDER_SHORTS_COUPANG_ACCESS_KEY` · `_SECRET_KEY` | 선택 | 회사 공용 쿠팡 키 — 개인 키가 없는 사람의 **검색만** (딥링크 · 리포트는 각자 화면에서 넣은 개인 키) |
| `NEANDER_SHORTS_ADMIN_EMAILS` | 권장 | 사용자별 현황 · 몰아보기를 볼 사람 (없으면 부트스트랩 관리자) |
| `NEANDER_SHORTS_TOKEN_KEY` | 권장 | 계정 토큰 암호화 키(32바이트 base64). 없으면 `NEANDER_MAIL_KEY` 에서 HKDF 로 끌어냄 |
| `NEANDER_SHORTS_MEDIA_QUOTA_MB` | 선택 | 파일 저장 한도 (기본 500MB · Firestore 조각) |
| `NEANDER_SHORTS_EMAILS` | 선택 | 사용자 제한 |

OAuth 리디렉션 URI: `https://neander-erp.vercel.app/api/neander/shorts/oauth/callback` (로컬은 해당 주소의 같은 경로). 계정 준비 순서는 화면 「계정 · 연결」 에 있다.

## 정책 반영 (2026-10-31 공식 자료 확인)

- 쿠팡 파트너스 약관 · 운영정책 2026-09-07 시행본, 공지 160(유튜브 · 쇼츠 대가성 문구) · 189(가상인물) · 200(금지 문구).
  - 쇼츠는 영상 안 · 유료광고 배너 · 제목 중 하나 **와** 설명란 · 고정 댓글 첫 부분 → 게시 문구 첫 줄 표준 고지 + 출력 영상의 고지 띠(기본 켬).
  - 가상인물이 나오면 `[광고][가상인물 포함]` 을 첫 부분과 영상 안에.
  - 활동 채널 등록 · 동의 없는 DM 금지 · 무효 클릭 · 가격 · 할인 · 「가격 오류」「쿠팡 미쳤다」「마지막 기회」 등 → 정책 확인 항목과 문장 검사(`scanClaims`).
- 공정위 「추천 · 보증 등에 관한 표시 · 광고 심사지침」 2026-06-01 개정 — 영상 전체 추천은 시작 · 끝 · 중간 반복 → 고지 띠를 처음부터 끝까지.
- Open API 약관 제5조(받은 데이터 복제 · 저장 금지) → 쿠팡 검색 결과는 저장하지 않고, 고른 후보는 주소 · 이름만 남긴다. 가격 · 판매 상태는 사람이 확인해 적는다.
- 해외 소스의 출처 · 이용 조건 기록은 **선택 항목**이다 — 편집 · 게시를 막지 않는다.

## 검증

```bash
npm run shorts:test            # 계산 · 규칙 24건 + 정찰 11건 + 외부 어댑터(모의 응답) 14건
npm run shorts:verify-render   # Chrome 에서 실제 MP4 출력 · 코덱 · 자막 · 고지 띠 · 소리 · 취소 (로그인 불필요)
npm run shorts:verify-server   # 실제 Firestore · 검증용 이메일 · 외부 호출은 모의 (실사용 작업이 대기 중이면 시작 안 함) — 사람별 분리 · 관리자 읽기 전용 · 링크 주인 확인 · 고객사 담당자 · 검토 링크 · 승인 파일만 게시 (131건)
node e2e/shorts-people-ui.mjs <BASE_URL> <토큰파일> <샷 폴더> <다른 사람 비공개 영상 제목>   # 내 채널 세트 · 사용자별 현황 · 읽기 전용
node e2e/shorts-ui.mjs <BASE_URL> <토큰파일> <샘플 mp4> <샷 폴더>   # 로그인한 화면 흐름 (e2e:token)
node e2e/shorts-clients-ui.mjs <BASE_URL> <토큰파일> <샘플 mp4> <샷 폴더>   # 고객사 → 영상 → 검토 링크(로그인 없는 창) → 승인 → 게시 점검 → 월간 보고 → 지우기 (32건)
```

## 바이럴 형식 정찰 (/neander/shorts/scout)

쿠팡 제휴 영상과 고객사 영상이 같이 쓰는 「요즘 무엇이 먹히나」 정보. 회사 공용이다 (visibility 없음 · 지우기는 만든 사람 · AI STUDIO 관리자, 자동 수집 문서는 관리자만).

| 자리 | 내용 |
| --- | --- |
| `lib/neander/shorts/scout.ts` | 타입 · 평소 조회수 · 배수 · 형식 수명 · 나라별 처음 본 날 · 시차 · 주간 보고 집계 (순수 함수) |
| `lib/neander/shorts/server/scout-store.ts` | `neander_shorts_watch` · `_hits` · `_formats` · `_reports` · 설정(`neander_shorts_settings/scout`) |
| `lib/neander/shorts/server/scout-run.ts` | 훑기 · 영상 분석 · 자동 분석 · 주간 보고 · cron |
| `lib/neander/shorts/server/scout-ai.ts` | 영상 보기(OpenRouter `video_url` — Gemini 가 공개 YouTube 주소를 직접 본다) · 보고 요약 |
| `app/api/neander/shorts/scout` | GET 한 벌 · POST 동작 (`watch.*` · `hit.*` · `format.*` · `report.*` · `settings.save`) |
| `components/neander/shorts/scout/*` | 주간 보고 · 터진 영상 · 형식 카드 · 감시 채널 탭 |

- **터진 영상** = 3분 이하 · 올린 지 30일 안 · 1만 회 이상 · 그 채널 평소의 3배 이상 (설정에서 바꾼다). 평소 = 최근 쇼츠 중 올린 지 7일 넘은 것 최대 30편의 조회수 중앙값 (모자라면 어린 영상까지 · 그래도 5편 미만이면 모름).
- **훑기**는 채널 하나에 약 3단위(playlistItems · videos · channels) — search.list(하루 100회)는 「채널 찾기」 · 「국내 검색」 에서만.
- **형식 카드** = 소재가 아니라 「어떻게 만들었나」. AI 분석이 기존 카드와 같은 형식을 제안하고(목록에 없는 id 는 버림), 사람이 묶는다. 카드마다 나라별 처음 본 날 · 한국 상태 · 시차가 계산된다. 게시일을 모르는 직접 등록 영상은 찾은 날로 센다.
- **수명**: 씨앗(한 편) · 떠오름(최근 2주 두 채널 이상 · 주당 편수가 그 전 4주 이상) · 포화 조짐(6편 이상 · 최근 배수 중앙값이 그 전의 60% 밑) · 식음(6주 넘게 없음) · 유지.
- **한국 상태**: 국내 검색 표본에서 사람이 고른 것 + 국내(KR) 터진 영상. 표본에서 못 찾은 것은 「국내 표본에 없음」 이지 없다는 단정이 아니다. 카드 저장으로는 바뀌지 않는다 (검색 · 표시 동작으로만).
- **AI 분석**은 YouTube 영상만 (틱톡 · 더우인 · 샤오홍슈 · 인스타는 링크 + 사람이 본 숫자로 등록, 카드는 직접). 한 편 약 10원(19초 영상 실측 $0.0069). 해외 영상은 분석할 때 댓글 100개 표본의 한글 비율도 잰다.
- **매일 아침 cron**(⑤): 회사 키(`NEANDER_SHORTS_YOUTUBE_API_KEY`)가 있으면 20시간 안에 안 훑은 채널 → 새 영상 자동 분석(하루 상한 기본 10편 · 0 이면 끔) → 이번 주 보고 새로 고치기. 회사 키가 없으면 보고만. 같은 주를 다시 만들어도 붙여 둔 AI 요약은 남는다.

```bash
npm run shorts:verify-scout     # 실제 Firestore · YouTube · AI 는 모의 — 훑기 · 출처 · 분석 요청 모양 · 권한 · 카드 · 보고 (31건)
node e2e/shorts-scout-ui.mjs <BASE_URL> <토큰파일> <샷 폴더>   # 로그인한 화면 — 직접 등록 · 카드 자동 저장 · 묶기 · 보고 (만든 것 지움)
```
