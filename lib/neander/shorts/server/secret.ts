import "server-only";

// ============================================================
//  게시 계정 토큰 암호화 — AES-256-GCM (메일 비밀번호와 같은 방식)
// ------------------------------------------------------------
//  키: NEANDER_SHORTS_TOKEN_KEY (32바이트 base64). 없으면 NEANDER_MAIL_KEY 에서
//  HKDF 로 쇼츠 전용 키를 끌어낸다 — 같은 원본이어도 쓰임새마다 키가 다르다.
//  어느 쪽이든 Firestore 와 **다른 자리**(환경변수)에 있다.
//
//  AAD 에 계정 문서 id 를 넣는다 — 암호문을 다른 계정 문서에 옮겨 붙여도
//  풀리지 않는다 (남의 YouTube 토큰을 내 계정 문서로 옮기는 공격).
// ============================================================

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const VERSION = "s1";

function key(): Buffer {
  const own = process.env.NEANDER_SHORTS_TOKEN_KEY?.trim();
  if (own) {
    const k = Buffer.from(own, "base64");
    if (k.length !== 32) throw new Error("NEANDER_SHORTS_TOKEN_KEY 는 32바이트를 base64 로 인코딩한 값이어야 합니다.");
    return k;
  }
  const mail = process.env.NEANDER_MAIL_KEY?.trim();
  if (!mail) {
    throw new Error(
      "게시 계정 토큰을 암호화할 키가 없습니다. `openssl rand -base64 32` 로 만든 값을 NEANDER_SHORTS_TOKEN_KEY 에 넣으세요.",
    );
  }
  const base = Buffer.from(mail, "base64");
  if (base.length !== 32) throw new Error("NEANDER_MAIL_KEY 형식이 올바르지 않아 AI STUDIO 토큰 키를 만들 수 없습니다.");
  return Buffer.from(hkdfSync("sha256", base, Buffer.alloc(0), Buffer.from("neander-shorts-account-tokens"), 32));
}

export function tokenKeyConfigured(): { configured: boolean; missing: string[] } {
  try {
    key();
    return { configured: true, missing: [] };
  } catch {
    return { configured: false, missing: ["NEANDER_SHORTS_TOKEN_KEY"] };
  }
}

export function sealTokens(tokens: Record<string, unknown>, accountId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(accountId, "utf8"));
  const ct = Buffer.concat([cipher.update(JSON.stringify(tokens), "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function openTokens<T = Record<string, string>>(sealed: string, accountId: string): T {
  const [ver, iv, tag, ct] = sealed.split(".");
  if (ver !== VERSION || !iv || !tag || !ct) throw new Error("저장된 계정 토큰 형식을 알 수 없습니다. 계정을 다시 연결해 주세요.");
  try {
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    d.setAAD(Buffer.from(accountId, "utf8"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8")) as T;
  } catch {
    throw new Error("계정 토큰을 풀지 못했습니다 (키가 바뀌었을 수 있습니다). 계정을 다시 연결해 주세요.");
  }
}
