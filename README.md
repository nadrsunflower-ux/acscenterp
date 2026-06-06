# 악센트 운영 관리 사이트

악센트 아이디 / 악센트 와우 매장의 근무 스케줄, 업무 체크리스트, 운영 상품·이벤트, 운영 안내를 관리하는 내부용 웹사이트입니다.

- Framework: Next.js 14 (App Router)
- DB/Storage: Firebase (Firestore + Storage)
- Styling: Tailwind CSS
- UI 언어: 한국어

## 1. Firebase 준비

1. [Firebase 콘솔](https://console.firebase.google.com/)에서 새 프로젝트를 생성합니다.
2. **Firestore Database** 활성화 → 처음에는 **테스트 모드**로 시작합니다.
3. **Storage** 활성화 (상품/이벤트 이미지 업로드에 사용).
4. 프로젝트 설정 → **웹앱 등록**(`</>` 아이콘) → 표시되는 `firebaseConfig` 6개 값을 복사합니다.

## 2. 환경 변수 설정

`.env.local.example` 을 복사해 `.env.local` 을 만들고 값을 채웁니다.

```bash
cp .env.local.example .env.local
```

```
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
ADMIN_PASSWORD=changeme   # 관리자 페이지 로그인 비밀번호. 반드시 변경하세요.
```

> env 값이 비어 있어도 빌드/실행은 되지만, Firebase 연동 기능(데이터 조회/저장)은 동작하지 않습니다. (안전하게 빈 값 반환)

## 3. 설치 & 실행

```bash
npm install
npm run dev      # 개발 서버 (http://localhost:3000)
npm run build    # 프로덕션 빌드
npm run start    # 프로덕션 실행
```

## 4. 초기 데이터 불러오기

관리자 페이지에서 **"초기 데이터 불러오기"** 버튼을 누르면 기본 상품/이벤트/향료 교체일/청소 가이드가 Firestore에 1회 주입됩니다(`seedInitialData`).

- 결정적(deterministic) 문서 id를 사용하므로 여러 번 눌러도 중복 누적되지 않고 덮어씁니다.

## 5. Firestore 컬렉션 구조

| 컬렉션 | 설명 |
| --- | --- |
| `shifts` | 근무 스케줄 (WorkShift) |
| `tasks` | 업무 정의 (일별/주기성, Task) |
| `taskChecks` | 업무 체크 기록 (TaskCheck, 문서 id = `taskId_YYYY-MM-DD`) |
| `events` | 캘린더 이벤트 (CalendarEvent, 근무 스케줄과 별도) |
| `products` | 운영 상품 (Product) |
| `promotions` | 운영 이벤트/프로모션 (Promotion) |
| `settings` | 단건 설정 — 향료 교체일(`fragrance_id`/`fragrance_wow`), 청소 가이드(`cleaning_id`/`cleaning_wow`) |

Storage 경로: 이미지는 `uploadImage(file, pathPrefix)` 로 `pathPrefix/타임스탬프_파일명` 에 저장되고 download URL 이 상품/프로모션의 `imageUrl` 로 사용됩니다.

## 6. 권장 보안 규칙

운영 단계로 넘어갈 때 테스트 모드 규칙을 아래처럼 강화하는 것을 권장합니다.

### Firestore (`firestore.rules`)

읽기는 공개로 두고(매장 스태프가 로그인 없이 조회), 쓰기는 관리자 페이지(서버 쿠키 보호)로만 일어나므로 클라이언트 직접 쓰기는 차단하는 예시입니다. 단, 대시보드의 업무 체크는 일반 사용자도 써야 하므로 `taskChecks` 는 쓰기를 허용합니다.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 공개 조회
    match /{document=**} {
      allow read: if true;
    }
    // 업무 체크는 누구나 토글 가능
    match /taskChecks/{id} {
      allow write: if true;
    }
    // 그 외 컬렉션 쓰기는 관리자 작업(여기서는 콘솔/관리자 환경)으로 제한
    match /shifts/{id}      { allow write: if false; }
    match /tasks/{id}       { allow write: if false; }
    match /events/{id}      { allow write: if false; }
    match /products/{id}    { allow write: if false; }
    match /promotions/{id}  { allow write: if false; }
    match /settings/{id}    { allow write: if false; }
  }
}
```

> 위 규칙에서 `write: if false` 로 둔 컬렉션은 관리자 클라이언트에서도 직접 쓸 수 없습니다. 관리자 페이지에서 직접 Firestore 에 쓰는 구조라면, 운영 시 Firebase Auth(관리자 계정) 기반 규칙(`allow write: if request.auth != null`)으로 전환하거나, 테스트 모드를 유지하되 `ADMIN_PASSWORD` 게이트에만 의존하세요. 내부용·소규모 운영에서는 테스트 모드 + 관리자 비밀번호 게이트로 충분할 수 있습니다.

### Storage (`storage.rules`)

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read: if true;
      allow write: if true;   // 운영 시 Firebase Auth 기반으로 강화 권장
    }
  }
}
```

## 7. 관리자 로그인 동작

- `/admin` 이하 경로는 `middleware.ts` 가 보호합니다. `admin_session` 쿠키가 없으면 `/admin/login` 으로 리다이렉트됩니다(로그인 페이지는 예외).
- `/admin/login` 에서 비밀번호 입력 → `POST /api/admin-login` → `ADMIN_PASSWORD` 와 일치 시 httpOnly 쿠키 설정.
- 로그아웃: `POST /api/admin-logout` 으로 쿠키 삭제.

## 8. 페이지 구성 (다른 에이전트가 구현)

1. `/` 대시보드 — 캘린더 + 근무 스케줄 + 업무 체크리스트 + 이벤트 알림
2. `/id` 악센트 아이디 — 상품/이벤트/운영 안내/재고 위치/향료 교체일/청소 가이드
3. `/wow` 악센트 와우 — 상품/청소 가이드
4. `/admin` 관리자 — 스케줄·업무·이벤트·상품·프로모션·향료 교체일 등록/관리
