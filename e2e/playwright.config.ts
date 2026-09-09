// ============================================================
//  UI 스모크 테스트 설정 — `npm run test:e2e`
// ------------------------------------------------------------
//  dev 서버(포트 3001, `npm run dev:neander`)가 떠 있어야 하고,
//  `npm run ui:login` 으로 한 번 로그인한 프로필이 있어야 한다.
//  실데이터를 읽기만 한다 — 어떤 저장 버튼도 누르지 않는다.
// ============================================================
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.NEANDER_BASE_URL || "http://localhost:3001",
    trace: "retain-on-failure",
  },
});
