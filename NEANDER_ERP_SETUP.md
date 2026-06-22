# NEANDER ERP 통합 가이드 (/neander)

AC'SCENT ERP 안에 **NEANDER 상위 ERP**를 `/neander` 경로로 통합했습니다.
NEANDER ERP 프로젝트의 기능을 그대로 클론하되, **Firebase는 AC'SCENT ERP와 동일한
프로젝트(acscentmanager)** 를 사용하고, 데이터는 `neander_` 접두사 컬렉션으로 분리합니다.

## 구조

```
app/neander/                 # NEANDER 라우트 (자체 사이드바 Shell)
  layout.tsx                 # 인증 게이트 + Shell
  page.tsx                   # 대시보드
  login/page.tsx             # Google 로그인
  sales/ tasks/ requests/ members/

components/neander/          # NEANDER 전용 컴포넌트
  ui.tsx Shell.tsx Providers.tsx auth.tsx app-data.tsx

lib/neander/                 # NEANDER 도메인 로직
  types.ts format.ts access.ts firebase.ts
  db/ helpers.ts members.ts sales.ts tasks.ts requests.ts

components/AppChrome.tsx      # /neander 에서는 AC'SCENT Nav 숨김 (그 외엔 기존 그대로)
```

- **AC'SCENT → NEANDER 진입 링크는 없습니다** (요청대로). `/neander` 직접 접속.
- **NEANDER → AC'SCENT 복귀 링크**는 NEANDER 사이드바 하단 "🏬 AC'SCENT 매장 관리"에 있습니다.

## Firestore 컬렉션 (AC'SCENT와 충돌 없음)

| 기능 | 컬렉션 |
|------|--------|
| 팀원 | `neander_members` |
| 매출 | `neander_sales` |
| 일일업무 | `neander_daily_tasks` |
| 업무요청 | `neander_work_requests` |

## ⚠️ 사용 전 직접 해야 하는 설정 (Firebase 콘솔)

NEANDER는 **Google 로그인**을 씁니다. acscentmanager 프로젝트에서 한 번만 설정하세요.

1. **Google 로그인 제공업체 활성화**
   - Firebase 콘솔 → Authentication → Sign-in method → **Google** → 사용 설정
2. **승인된 도메인 추가**
   - Authentication → Settings → 승인된 도메인 → `localhost`(개발), 배포 도메인(예: `*.vercel.app` / 실제 도메인) 추가
3. **부트스트랩 관리자 이메일** (이미 설정됨)
   - `.env.local` 의 `NEXT_PUBLIC_NEANDER_ADMIN_EMAILS=nadr.jooyeon@gmail.com`
   - 이 계정으로 `/neander/login` 로그인 → 기본 팀원 5명 시드 → 팀원 관리에서 각자 Google 이메일 등록
   - 팀원 이메일을 모두 등록한 뒤에는 이 환경변수를 비워도 됩니다.
4. **Firestore 보안 규칙** (선택, 권장)
   - 현재 AC'SCENT 규칙을 유지해도 동작합니다(앱단 이메일 화이트리스트가 1차 방어).
   - 더 엄격히 하려면 `neander_*` 컬렉션은 `request.auth != null` 인 경우에만 read/write 허용하도록 규칙을 추가하세요.

## 첫 사용 순서

1. 위 1·2번(Firebase 콘솔) 완료
2. `npm run dev` → `http://localhost:3000/neander` 접속 → `/neander/login` 으로 이동됨
3. 부트스트랩 관리자(`nadr.jooyeon@gmail.com`)로 Google 로그인
4. "기본 팀원 5명 생성" → 팀원 관리에서 이름·역할·**Google 이메일**·색상 입력
5. 각 팀원이 본인 Google 계정으로 로그인하면 자동으로 해당 팀원으로 연결됨

## 검증 완료 항목

- `npx tsc --noEmit` 타입체크 통과
- `npm run build` 프로덕션 빌드 통과 (`/neander` 6개 라우트 정적 생성)
- `/neander/login`(200, 로그인 UI), `/neander`(200, 게이트 로딩셸), `/`(200, AC'SCENT Nav 유지) 응답 확인
- `/neander` 페이지에 AC'SCENT Nav 미노출(AppChrome 분기 정상)
