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

if ! "$FIREBASE" projects:list >/dev/null 2>&1; then
  echo ""
  echo "✋ Firebase 로그인이 필요합니다. 먼저 아래를 실행하세요:"
  echo ""
  echo "   $FIREBASE login"
  echo ""
  exit 1
fi

echo "▸ 규칙 게시 → $PROJECT"
exec "$FIREBASE" deploy --only firestore:rules,storage --project "$PROJECT"
