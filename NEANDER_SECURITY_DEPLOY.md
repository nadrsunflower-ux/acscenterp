# NEANDER 보안 하드닝 — 배포 가이드

NEANDER 메신저/업무 데이터를 **"등록된 팀원(이메일)만 접근"** 으로 잠그는
보안 규칙 적용 절차. AC'SCENT(공개 매장 사이트·관리자 페이지)는 **종전 그대로
동작**하도록 설계돼 있다(규칙의 catch-all 이 `neander_*` 만 제외).

> ⚠️ **순서를 지키세요.** 규칙을 먼저 게시하면 기존 팀원이 잠길 수 있습니다.
> 권장 순서: **① 백필 → ② 클라이언트 배포 → ③ 규칙 게시**.

---

## 무엇이 바뀌나

- **이전:** 임의의 구글 계정으로 로그인하면 네트워크 탭에서 팀 전체 채팅(1:1 DM
  포함)·매출·업무 데이터를 읽을 수 있었음(Firestore 규칙이 사실상 전체 공개).
- **이후:** `neander_*` 컬렉션과 `neander_chat/**` 스토리지는
  **로그인 + 등록 팀원(이메일)** 만 접근. 그 외 계정은 접근 거부.
- **판정 근거:** `neander_member_emails/{이메일}` 문서의 존재 여부.
  부트스트랩 관리자(`nadr.jooyeon@gmail.com`)는 항상 허용(규칙에 하드코딩).
  이 매핑은 `lib/neander/db/members.ts` 가 팀원 추가/수정/삭제 시 자동 동기화.

관련 파일: `firestore.rules`, `storage.rules`, `firebase.json`,
`firestore.indexes.json`, `scripts/neander/backfill-member-emails.ts`.

---

## ① 백필 (규칙 게시 전 1회 — 이미 실행됨)

기존 팀원의 이메일 매핑을 시드한다(멱등·추가 전용). 현재 열린 규칙에서 실행.

```bash
npm run neander:backfill-emails
```

> ✅ 최초 적용 시 이미 실행 완료(팀원 4명 매핑 생성). 팀원을 더 추가했다면
> 다시 실행하거나, 앱의 팀원 관리에서 추가하면 자동으로 매핑이 생긴다.

## ② 클라이언트 배포 (Vercel)

`members.ts` 의 매핑 동기화 코드가 운영에 반영돼야 이후 팀원 변경이
규칙과 어긋나지 않는다. main 브랜치 푸시 → Vercel 자동 배포.

```bash
git push origin main
```

## ③ 규칙 게시 (둘 중 하나)

### 방법 A — Firebase 콘솔에 붙여넣기 (CLI 불필요, 가장 간단)

1. **Firestore 규칙**
   https://console.firebase.google.com/project/acscentmanager/firestore/rules
   → 이 저장소의 `firestore.rules` 전체 내용을 붙여넣고 **게시(Publish)**.
2. **Storage 규칙**
   https://console.firebase.google.com/project/acscentmanager/storage/rules
   → `storage.rules` 전체 내용을 붙여넣고 **게시(Publish)**.

### 방법 B — Firebase CLI

```bash
npx -y firebase-tools login          # 브라우저 1회 인증
npm run firebase:deploy:rules        # firestore:rules + storage 게시
```

---

## 게시 후 점검 (스모크 테스트)

1. 등록 팀원 계정으로 로그인 → 메신저/업무/매출 정상 동작, 첨부 업로드/표시 OK.
2. **미등록** 구글 계정으로 로그인 → "접근 권한이 없습니다" 화면, 데이터 안 보임.
3. AC'SCENT 매장 사이트(`/`, `/id`, `/wow`, 관리자) → **종전과 동일하게** 동작.
4. 콘솔 네트워크 탭에서 `neander_messages` 직접 쿼리 시도(미등록 계정) → 거부.

## 롤백

문제가 생기면 콘솔 규칙 편집기에서 직전 버전으로 되돌리거나, 임시로
`neander_*` 규칙을 `allow read, write: if request.auth != null;` 로 완화.

---

## 남은(선택) 강화 — Tier 2

현재는 **"등록 팀원만 접근"** 까지 막는다(임의 계정 차단). 더 나아가
**팀원끼리도 서로의 1:1 DM 을 DB에서 못 읽게** 하려면:

- 메시지/채팅방 문서에 `memberEmails` 비정규화 저장.
- 메시지 read 규칙을 `callerEmail() in resource.data.memberEmails` 로 좁힘.
- 클라이언트 구독을 대화별/`array-contains` 쿼리로 전환(+복합 인덱스).
- 기존 메시지 `memberEmails` 백필.

소규모·상호신뢰 팀에서는 Tier 1 로 충분할 수 있어 분리해 두었다.
