#!/usr/bin/env bash
# ============================================================
#  Firestore / Storage 보안 규칙 게시
# ------------------------------------------------------------
#  왜 npx 를 직접 안 쓰는가:
#    `npx firebase-tools` 는 이 환경(Node 20)에서 뜨지 않는다. firebase-tools
#    안쪽의 universal-analytics 가 uuid 를 require 하는데, npm 이 중첩 uuid 를
#    ESM 전용 버전으로 해석해 ERR_REQUIRE_ESM 으로 죽는다. 버전을 낮춰도
#    같다(12 / 13.0.3 / 13.15.4 모두 실패). npm overrides 로 uuid 를 CJS
#    버전에 고정해야만 뜬다.
#
#    그렇다고 firebase-tools 를 프로젝트 devDependency 로 넣으면 Vercel 이
#    배포할 때마다 수백 MB 를 더 받는다. 규칙 게시는 가끔 하는 일이라
#    그 비용이 아깝다. 그래서 격리된 .firebase-cli/ 에 한 번만 설치한다.
#
#  사용:
#    npm run firebase:deploy:rules
#
#  ⚠️ 사용자 계정 로그인이 필요하다(`firebase login`). Admin SDK 서비스
#     계정으로는 안 된다 — 규칙 게시는 firebaserules 권한을 요구하는데
#     Admin SDK 계정에는 그 권한이 없다.
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_DIR="$ROOT/.firebase-cli"
FIREBASE="$CLI_DIR/node_modules/.bin/firebase"
PROJECT="${FIREBASE_PROJECT:-acscentmanager}"

if [ ! -x "$FIREBASE" ]; then
  echo "▸ firebase-tools 설치 (최초 1회, $CLI_DIR)"
  mkdir -p "$CLI_DIR"
  cat > "$CLI_DIR/package.json" <<'JSON'
{
  "name": "firebase-cli-local",
  "private": true,
  "description": "규칙 게시 전용. 앱 의존성과 분리해 Vercel 빌드에 영향을 주지 않는다.",
  "overrides": { "uuid": "9.0.1" }
}
JSON
  (cd "$CLI_DIR" && npm install --no-audit --no-fund firebase-tools@13 >/dev/null)
  echo "▸ 설치 완료: $("$FIREBASE" --version)"
fi

# 여러 Google 계정을 쓰는 경우가 흔하다. 어느 계정으로 배포할지 지정한다:
#     FIREBASE_ACCOUNT=someone@gmail.com npm run firebase:deploy:rules
ACCOUNT_ARGS=()
if [ -n "${FIREBASE_ACCOUNT:-}" ]; then
  ACCOUNT_ARGS=(--account "$FIREBASE_ACCOUNT")
fi

if ! "$FIREBASE" projects:list "${ACCOUNT_ARGS[@]+"${ACCOUNT_ARGS[@]}"}" >/dev/null 2>&1; then
  cat <<MSG

✋ Firebase 로그인이 필요합니다.

   본인 터미널에서 직접 실행하세요. OAuth 는 브라우저를 띄우므로
   에이전트 세션이나 CI 처럼 TTY 가 없는 곳에서는 실행되지 않습니다
   ("Cannot run login in non-interactive mode").

   $FIREBASE login

   → acscentmanager 프로젝트에 편집자 이상 권한이 있는 Google 계정 선택
   → 완료 후 이 명령을 다시 실행:  npm run firebase:deploy:rules

MSG
  exit 1
fi

# 기본은 Firestore 규칙만 게시한다.
#
# storage 를 함께 넣으면 CLI 가 Firebase Storage 서비스가 켜져 있는지
# 확인하려고 serviceusage.googleapis.com 을 호출하는데, 여기엔
# serviceusage.services.get 권한이 필요하다. 편집자 권한만 있는 계정은
# 이 호출에서 403 이 나고 **Firestore 규칙까지 통째로 배포가 중단된다.**
# Storage 규칙은 자주 바뀌지 않으므로 필요할 때만 켠다:
#
#     WITH_STORAGE=1 npm run firebase:deploy:rules
TARGETS="firestore:rules"
if [ "${WITH_STORAGE:-}" = "1" ]; then
  TARGETS="firestore:rules,storage"
fi

# 배포 전에 그 계정이 이 프로젝트를 실제로 볼 수 있는지 먼저 확인한다.
# 계정이 프로젝트 멤버가 아니면 CLI 는 한참 진행하다 firebaserules 403 을
# 뱉는데, 그 메시지만 보면 "권한 등급이 부족한가" 로 오해하기 쉽다.
# 실제로는 계정을 잘못 골랐을 때가 대부분이다.
if ! "$FIREBASE" projects:list "${ACCOUNT_ARGS[@]+"${ACCOUNT_ARGS[@]}"}" 2>/dev/null | grep -q "[[:space:]]$PROJECT[[:space:]]"; then
  WHO="$("$FIREBASE" login:list 2>/dev/null | head -3 | tail -1 | tr -d ' ')"
  cat <<MSG

✋ 로그인한 계정에서 '$PROJECT' 프로젝트가 보이지 않습니다.
   ${FIREBASE_ACCOUNT:+(지정 계정: $FIREBASE_ACCOUNT)}

   권한 등급의 문제가 아니라 그 계정이 프로젝트 멤버가 아닐 가능성이 큽니다.
   아래에서 어느 계정이 열리는지 확인하세요:

     https://console.firebase.google.com/project/$PROJECT/firestore/rules

   맞는 계정을 추가한 뒤 그 계정으로 배포하세요:

     $FIREBASE login:add
     FIREBASE_ACCOUNT=<그 계정> npm run firebase:deploy:rules

MSG
  exit 1
fi

echo "▸ 규칙 게시 → $PROJECT ($TARGETS)"
exec "$FIREBASE" deploy --only "$TARGETS" --project "$PROJECT" "${ACCOUNT_ARGS[@]+"${ACCOUNT_ARGS[@]}"}"
