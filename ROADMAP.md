# 실행 계획 (ROADMAP)

ACSCENT ERP / NEANDER ERP 의 앞으로 할 작업을 한 곳에 모은 문서.
작업이 끝나면 해당 항목을 `[x]` 로 바꾸고 결과를 한 줄 남긴다.

**최종 갱신**: 2026-08-14

---

## 배경 — 왜 이 작업들을 하는가

두 시스템은 대상이 완전히 다르다.

| 시스템 | 대상 | 성격 |
| --- | --- | --- |
| **ACSCENT ERP** | 매장 알바 직원 | 공개. 단 `/admin` 은 관리자 전용 |
| **NEANDER ERP** | 이사진·핵심 직원 | 본사 전용. 특정 권한자만 |

그런데 점검 결과 **두 시스템 모두 게이트를 우회하는 경로가 있었고, 방향이 정반대**였다.

- **ACSCENT** — UI 는 잠겨 있는데 DB 가 열려 있다. `/admin` 은 비밀번호로 막혀 있지만 Firestore 규칙이 매장 컬렉션 전체에 `write: if true` 라, 알바가 매장 페이지 콘솔에서 Firestore SDK 를 직접 호출하면 관리자 페이지를 안 거치고도 스케줄·상품을 수정·삭제할 수 있다. **로그인 화면을 통과할 필요가 없다.**
- **NEANDER** — DB 는 잠겨 있는데 정적 콘텐츠가 열려 있었다. Firestore 규칙은 제대로 동작하지만, 코드에 하드코딩된 회의 발표덱은 규칙의 보호를 못 받아 **로그인 없이 전문이 읽혔다.**

즉 **UI 게이트와 DB 게이트가 서로 다른 기준을 쓰고 있던 것**이 근본 원인이다. 아래 작업들은 이 둘을 하나의 기준으로 모으는 과정이다.

---

## Phase 1 — 두 시스템 배포 분리 ✅ 완료

브랜치 `feat/split-acscent-neander`.

- [x] `next.config.mjs` — `APP_TARGET` 으로 `pageExtensions` 분기, 상대 시스템 라우트를 빌드에서 제외
- [x] NEANDER 라우트 17개 개명 (`page.tsx` → `page.neander.tsx`)
- [x] `middleware.ts` — 타깃별 게이트 (ACSCENT: `/admin` 보호 / NEANDER: `/neander` 외 리다이렉트)
- [x] `package.json` — `dev:neander` · `build:neander` · `start:neander`
- [x] `README.md` — 분리 방식·주의사항 명시

**검증 결과**

```
매장 도메인:  /neander/*                → 404
             이전 유출 청크 URL 직접 요청 → 404
             매장 번들에서 회의 브리핑 본문 검색 → 0건
본사 도메인:  / /id /admin              → 307 → /neander
```

라우트 36개 → 19개. 로그인 게이트로 가리는 게 아니라 **코드 자체가 없다.**

### 남은 수동 작업

- [ ] **Vercel 프로젝트 2번째 생성** — 같은 레포, 환경변수 `APP_TARGET=neander` 만 추가. 기존 프로젝트는 기본값이 `acscent` 라 변경 불필요
- [ ] 본사 도메인 연결

---

## Phase 2 — ACSCENT Firestore 조이기

> **목표**: `/admin` 게이트를 UI 잠금이 아니라 실제 경계로 만든다.
> **결정 사항**: 공유 비밀번호(`ADMIN_PASSWORD`) 방식은 유지하고, DB 쓰기만 서버 경유로 바꾼다.

유리한 조건이 두 가지 있다.

1. 매장 쓰기가 전부 `lib/db.ts` 한 곳을 지난다 (쓰기 함수 19개)
2. **관리자 컴포넌트 7개는 Firestore 를 직접 호출하는 곳이 0건** → `lib/db.ts` 만 바꾸면 화면 코드는 무변경

Admin SDK 서비스 계정 키는 이미 있다 — `neander-erp-mcp-team/secrets/acscentmanager-adminsdk.json` (같은 프로젝트 `acscentmanager`).

- [ ] 서비스 계정 키를 환경변수로 주입 (레포에 커밋 금지, Vercel 환경변수)
- [ ] 서버 API 라우트 신설 — `admin_session` 쿠키 검증 후 Admin SDK 로 쓰기
- [ ] `lib/db.ts` 쓰기 함수 19개를 fetch 경유로 전환
- [ ] `firestore.rules` — 매장 컬렉션 `read: true / write: false`
- [ ] **예외 유지**: 알바가 직접 써야 하는 `taskChecks`(업무 체크)와 건의함은 클라이언트 쓰기 허용
- [ ] 관리자 페이지 전 기능 회귀 테스트 (스케줄·업무·이벤트·상품·프로모션·향료·청소·건의함)

### 알려진 한계 (이번 결정의 트레이드오프)

공유 비밀번호를 유지하므로 **개인 식별과 감사 추적은 여전히 불가**하다. 누가 무엇을 바꿨는지 남지 않고, 비밀번호가 유출되면 회수 방법이 변경뿐이다. 나중에 필요해지면 Google 로그인 + 역할 기반으로 전환할 수 있다 (Phase 3 의 역할 체계를 그대로 재사용 가능).

---

## Phase 3 — NEANDER 권한 세분화

현재 `lib/neander/types.ts` 의 `Member.role` 은 **자유 문자열 표시용**이고 권한 판정에 쓰이지 않는다. 즉 등록된 팀원 전원이 동일 권한이며, 이사진과 핵심 직원 사이에 차등이 없다.

- [ ] 역할 정의 — `neander_member` / `neander_admin`
- [ ] `lib/neander/access.ts` 를 역할 기반으로 확장 (현재는 이메일 허용목록만 판정)
- [ ] `firestore.rules` 에 동일 역할 기준 반영 → UI 게이트와 DB 게이트를 일치시킴
- [ ] 팀원 등록·삭제 등 관리 기능을 `neander_admin` 으로 제한

### 회의 발표덱 정적 유출 (Phase 1 로 완화, 미완결)

`/neander/meetings/prep/*` 는 Firestore 가 아니라 **코드에 하드코딩된 정적 페이지**라 규칙의 보호를 못 받는다.

Phase 1 로 매장 도메인에서는 사라졌지만, **본사 도메인은 공개 URL 이라 주소를 아는 사람은 여전히 로그인 없이 읽을 수 있다.** 노출 범위가 "알바 전원"에서 "URL 을 아는 사람"으로 줄었을 뿐 0 이 아니다.

- [ ] 덱 콘텐츠를 `neander_meetings` 로 이관 → 기존 규칙이 그대로 보호
- [ ] 발표덱 엔진을 하드코딩이 아닌 데이터 기반으로 전환

---

## 백로그 (급하지 않음)

- [ ] **의존성 취약점** — 프로덕션 기준 15건 (critical 1: `websocket-driver`, high: `undici`·`nanoid`·`postcss`). `npm audit fix` 로 breaking 없이 대부분 해결. 단 `undici` 는 `package.json` overrides 에 `6.26.0` 으로 직접 핀되어 있는데 그 버전이 취약 → 값을 올려야 함. `next` 14.2.35 는 메이저 이동이 필요해 별도 판단
- [ ] **비대한 컴포넌트 분할** — `components/scheduler/WeeklySchedule.tsx` (1079줄), `app/neander/tasks/page.neander.tsx` (941줄), `components/admin/DailyTaskAdmin.tsx` (701줄). 해당 파일을 건드리는 작업 전에 선행하면 안전
- [ ] **MCP 서버 레포 위치** — `Desktop/smoat/neander-erp-mcp-team` 이 `smoat` 레포 안에 중첩되어 있다 (git log 에 smoat 커밋이 찍힘). 의도한 구조인지 확인 필요
- [ ] **`CLAUDE.md` 생성** — 반복 작업 시 구조 재파악 비용 절감

---

## 별도 프로젝트 — 재무·장부 모듈 (neander-erp-m1)

이 레포와 **스택이 다른 독립 프로젝트**다: Next.js + **Supabase(PostgreSQL)**, Firebase 아님.
재무 엑셀(2605·2606·2607)을 DB 로 이관하는 설계이며, `DESIGN.md` 가 **승인 대기** 상태(작성일 2026-08-11).
git 은 `Initial commit from Create Next App` 하나뿐 — 골격만 잡힌 초기 단계.

현재 위치: `~/Downloads/neander-erp-m1` — **정리하다 날아가기 쉬운 자리이므로 옮기는 것을 권장.**

- [ ] 안정적인 위치로 이동
- [ ] `DESIGN.md` 승인 여부 결정
- [ ] 설계안 대비 현재 구현 상태의 격차 정리
