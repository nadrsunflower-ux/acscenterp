// ============================================================
//  UI 검증용 브라우저 프로필 위치
// ------------------------------------------------------------
//  ERP 는 Google 로그인을 거쳐야 화면이 보이고, 자동화 브라우저는 그
//  팝업을 통과하지 못한다. 그래서 사람이 한 번 로그인한 프로필을
//  저장소 밖(사용자 홈)에 두고 재사용한다. 저장소에는 들어가지 않는다.
// ============================================================
import os from "node:os";
import path from "node:path";

export const PROFILE_DIR = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "neander-erp-playwright",
);

export const BASE_URL = process.env.NEANDER_BASE_URL || "http://localhost:3001";
