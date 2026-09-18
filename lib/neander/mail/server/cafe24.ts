import "server-only";

// ============================================================
//  카페24 메일 서버 접속 설정
// ------------------------------------------------------------
//  2026-09-18 에 직접 두드려 본 결과 (neander.co.kr):
//
//    받기  webmail.<도메인>:995  POP3 over TLS (110 은 STLS 로 올림)
//          IMAP(143·993)은 닫혀 있다 — 카페24 도움말도 "IMAP 미지원".
//          CAPA: TOP · USER · UIDL · LOGIN-DELAY 10 (Courier)
//    보내기 smtp.cafe24.com:587  STARTTLS · AUTH LOGIN PLAIN · 한 통 30MB
//          계정(메일 상품)에 따라 ecsmtp.cafe24.com 을 쓰는 곳이 있다 (카페24 도움말:
//          단독웹메일·단독그룹웨어는 smtp, 그 밖은 ecsmtp). 연결할 때 둘 다 해 보고
//          되는 쪽을 계정에 적어 둔다 (send.ts testSmtp). 두 곳 모두 *.cafe24.com 인증서.
//
//  ⚠️ 두 서버 모두 **TLS 1.0 만** 받는다. Node(OpenSSL 3) 기본값은 1.2 이상이라
//     그냥 붙으면 ERR_SSL_UNSUPPORTED_PROTOCOL 로 끊긴다. 1.0 을 허용하고
//     보안 등급을 낮추고, 옛 재협상도 허용해야 붙는다 (LEGACY_TLS).
//     평문(110)으로 비밀번호를 흘리는 것보다는 낫다 — 카페24가 올려 주면 지운다.
//
//  ⚠️ POP3 인증서는 *.cafe24.com 이다. webmail.<우리 도메인> 이름으로는
//     맞지 않으므로 이름 확인만 카페24 이름으로 한다. 인증서 체인 검증은
//     그대로 켜 둔다 — 카페24 서버가 맞는지는 확인한다.
// ============================================================

import { constants } from "node:crypto";
import tls, { type ConnectionOptions } from "node:tls";

export const POP3_PORT = 995;
export const SMTP_PORT = 587;
/** 보내는 서버 — 앞의 것부터 해 본다 */
export const SMTP_HOSTS = ["smtp.cafe24.com", "ecsmtp.cafe24.com"] as const;
export const SMTP_HOST = SMTP_HOSTS[0];

/** 인증서 이름 확인에 쓰는 카페24 이름 (와일드카드 *.cafe24.com 에 맞는다) */
const CAFE24_CERT_NAME = "webmail.cafe24.com";

export const LEGACY_TLS: ConnectionOptions = {
  minVersion: "TLSv1",
  ciphers: "DEFAULT:@SECLEVEL=0",
  secureOptions: constants.SSL_OP_LEGACY_SERVER_CONNECT,
};

/** 받는 서버 — 카페24 안내: webmail.<메일 도메인> */
export function popHostFor(address: string): string {
  const domain = address.split("@")[1]?.trim().toLowerCase();
  if (!domain) throw new Error("메일 주소 형식이 아닙니다.");
  return `webmail.${domain}`;
}

export function popTlsOptions(host: string): ConnectionOptions {
  return {
    ...LEGACY_TLS,
    host,
    port: POP3_PORT,
    servername: host,
    checkServerIdentity: (_host, cert) => tls.checkServerIdentity(CAFE24_CERT_NAME, cert),
  };
}

/** 외부 메일(네이버·Gmail·다음) — 보통의 TLS 로 붙는다 */
export function externalTlsOptions(host: string): ConnectionOptions {
  return { host, port: POP3_PORT, servername: host };
}

export function smtpTlsOptions(host: string = SMTP_HOST): ConnectionOptions {
  return { ...LEGACY_TLS, servername: host };
}
