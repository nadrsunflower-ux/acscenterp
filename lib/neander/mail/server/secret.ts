import "server-only";

// ============================================================
//  메일 비밀번호 암호화 — AES-256-GCM
// ------------------------------------------------------------
//  카페24는 POP3·SMTP 모두 비밀번호로만 로그인한다 (OAuth 없음). 그래서
//  ERP 가 비밀번호를 갖고 있어야 한다. Firestore 에는 암호문만 둔다.
//
//  키는 NEANDER_MAIL_KEY (32바이트 base64) — Firestore 와 **다른 자리**에
//  있어야 의미가 있다. 서비스 계정 키에서 끌어내면 서비스 계정 하나가
//  새는 순간 메일 비밀번호까지 같이 샌다.
//
//  AAD 에 ERP 이메일을 넣는다 — 암호문을 남의 계정 문서에 옮겨 붙여도
//  풀리지 않는다.
//
//  ⚠️ 키를 바꾸면 저장된 비밀번호를 모두 못 푼다. 각자 설정에서 비밀번호를
//     다시 넣으면 된다 (메일 자체는 그대로다).
// ============================================================

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

export function mailKeyConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

function key(): Buffer {
  const raw = process.env.NEANDER_MAIL_KEY?.trim();
  if (!raw) {
    throw new Error(
      "NEANDER_MAIL_KEY 가 설정되지 않았습니다. `openssl rand -base64 32` 로 만든 값을 " +
        ".env.local(로컬)과 Vercel 환경변수(배포)에 넣으세요.",
    );
  }
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("NEANDER_MAIL_KEY 는 32바이트를 base64 로 인코딩한 값이어야 합니다.");
  return k;
}

export function sealSecret(plain: string, owner: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(owner, "utf8"));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function openSecret(sealed: string, owner: string): string {
  const [ver, iv, tag, ct] = sealed.split(".");
  if (ver !== VERSION || !iv || !tag || !ct) throw new Error("저장된 메일 비밀번호 형식을 알 수 없습니다.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(owner, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  try {
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("저장된 메일 비밀번호를 풀지 못했습니다. 메일 설정에서 비밀번호를 다시 입력해 주세요.");
  }
}
