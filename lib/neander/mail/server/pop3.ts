import "server-only";

// ============================================================
//  작은 POP3 클라이언트 — 카페24 받는 서버 (+ 외부 메일 가져오기)
// ------------------------------------------------------------
//  쓰는 명령은 USER · PASS · STAT · UIDL · RETR · DELE · QUIT 뿐이다.
//  라이브러리를 쓰지 않은 이유: 카페24 는 TLS 1.0 만 받아서 접속 옵션을
//  직접 쥐어야 하고(cafe24.ts), 필요한 명령이 이만큼이라 직접 쓰는 편이
//  옵션을 숨기는 래퍼를 들이는 것보다 짧다.
//
//  ⚠️ 본문은 **바이트로** 다룬다. 한국 메일은 아직 EUC-KR 8비트 본문이
//     섞여 오는데, 받는 도중 문자열로 바꾸면 그 바이트가 깨진다.
//     해석(글자 집합 판정)은 mailparser 가 원문 바이트를 보고 한다.
// ============================================================

import tls, { type ConnectionOptions, type TLSSocket } from "node:tls";
import { popTlsOptions } from "./cafe24";

/** 명령 하나의 응답을 기다리는 한도 */
const COMMAND_TIMEOUT_MS = 30_000;
const TERM = Buffer.from("\r\n.\r\n");

export class Pop3Error extends Error {
  constructor(
    message: string,
    /** 비밀번호가 틀렸다 — 다시 시도하면 계정이 잠길 수 있다 */
    readonly auth = false,
    /** 서버가 -ERR 로 답했다 (시간 초과·끊김이 아니다) */
    readonly reply = false,
  ) {
    super(message);
  }
}

interface Pending {
  multi: boolean;
  resolve: (b: Buffer) => void;
  reject: (e: Error) => void;
  /** 첫 줄을 찾기 전까지 모은 바이트 */
  head: Buffer;
  /** 여러 줄 응답: "\r\n" + 본문… 조각들과 전체 길이, 마지막 4바이트 */
  parts?: Buffer[];
  length?: number;
  carry?: Buffer;
  timer: NodeJS.Timeout;
}

export class Pop3 {
  private pending: Pending | null = null;
  private closed = false;

  private constructor(private readonly sock: TLSSocket) {
    sock.on("data", (chunk: Buffer) => this.onData(chunk));
    sock.on("error", (e) => this.fail(new Pop3Error(`메일 서버 연결 오류: ${e.message}`)));
    sock.on("close", () => {
      this.closed = true;
      this.fail(new Pop3Error("메일 서버가 연결을 끊었습니다."));
    });
  }

  /**
   * 접속하고 인사말(+OK)까지 받는다. 기본은 카페24 설정(옛 TLS · 카페24 인증서 이름),
   * 외부 메일(네이버·Gmail 등)은 externalTlsOptions 를 넘긴다.
   */
  static async connect(host: string, options: ConnectionOptions = popTlsOptions(host)): Promise<Pop3> {
    const sock = await new Promise<TLSSocket>((resolve, reject) => {
      const s = tls.connect(options, () => resolve(s));
      s.once("error", (e) => reject(new Pop3Error(`메일 서버(${host})에 연결하지 못했습니다: ${e.message}`)));
      s.setTimeout(COMMAND_TIMEOUT_MS, () => s.destroy(new Error("응답 시간 초과")));
    });
    const pop = new Pop3(sock);
    await pop.read(false);
    return pop;
  }

  async login(user: string, pass: string): Promise<void> {
    await this.command(`USER ${user}`);
    try {
      await this.command(`PASS ${pass}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 답이 없었다 (시간 초과·끊김) — 비밀번호 탓으로 세면 안 된다. 틀린 비밀번호에는
      // 카페24 가 5초쯤 뒤 -ERR 로 답한다 (2026-09-18 확인). 30초 넘게 답이 없으면
      // POP3 사용설정이 꺼져 있거나 막 켠 직후인 경우였다.
      if (!(e instanceof Pop3Error && e.reply)) {
        throw new Pop3Error(
          `카페24 메일 서버가 로그인에 답하지 않았습니다 (${msg}). 그 계정으로 웹메일에 로그인해 환경설정 → POP3/SMTP 사용설정이 「사용함」인지 확인하고, 방금 켰다면 몇 분 뒤 다시 해 보세요.`,
        );
      }
      // 잠김·사용 중은 잠깐 뒤 다시 되는 일이다. 나머지 -ERR 은 비밀번호로 본다.
      if (/IN-USE|lock|busy|try again|temporar/i.test(msg)) throw new Pop3Error(msg);
      throw new Pop3Error("메일 비밀번호가 맞지 않습니다. (카페24 웹메일의 POP3/SMTP 사용 설정도 확인하세요)", true, true);
    }
  }

  async stat(): Promise<{ count: number; size: number }> {
    const line = (await this.command("STAT")).toString("latin1");
    const [, count, size] = line.split(/\s+/);
    return { count: Number(count) || 0, size: Number(size) || 0 };
  }

  /** 번호 · 고유 id — 번호는 이번 접속 안에서만 유효하다 */
  async uidl(): Promise<{ n: number; uid: string }[]> {
    const body = (await this.command("UIDL", true)).toString("latin1");
    return body
      .split("\r\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [n, uid] = l.split(/\s+/);
        return { n: Number(n), uid: uid ?? "" };
      })
      .filter((x) => x.n > 0 && x.uid);
  }

  /** 원문 한 통 (바이트) */
  retr(n: number): Promise<Buffer> {
    return this.command(`RETR ${n}`, true);
  }

  /** 지울 표시 — QUIT 해야 실제로 지워진다 */
  async dele(n: number): Promise<void> {
    await this.command(`DELE ${n}`);
  }

  /** 정상 종료 (DELE 가 확정된다). 실패해도 소켓은 닫는다 */
  async quit(): Promise<void> {
    if (this.closed) return;
    try {
      await this.command("QUIT");
    } catch {
      /* 이미 끊겼다 */
    } finally {
      this.close();
    }
  }

  /** QUIT 없이 끊는다 — DELE 는 취소된다 */
  close(): void {
    this.closed = true;
    this.sock.destroy();
  }

  // ---- 내부 ------------------------------------------------

  private command(line: string, multi = false): Promise<Buffer> {
    if (this.closed) return Promise.reject(new Pop3Error("메일 서버 연결이 닫혀 있습니다."));
    const p = this.read(multi);
    this.sock.write(`${line}\r\n`);
    return p;
  }

  private read(multi: boolean): Promise<Buffer> {
    if (this.pending) return Promise.reject(new Error("POP3 명령이 겹쳤습니다."));
    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Pop3Error("메일 서버 응답이 너무 늦습니다."));
        this.close();
      }, COMMAND_TIMEOUT_MS);
      this.pending = { multi, resolve, reject, head: Buffer.alloc(0), timer };
    });
  }

  private settle(result: { ok: Buffer } | { err: Error }) {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    clearTimeout(p.timer);
    if ("ok" in result) p.resolve(result.ok);
    else p.reject(result.err);
  }

  private fail(e: Error) {
    this.settle({ err: e });
  }

  private onData(chunk: Buffer) {
    const p = this.pending;
    if (!p) return;

    if (!p.parts) {
      p.head = p.head.length ? Buffer.concat([p.head, chunk]) : chunk;
      const eol = p.head.indexOf("\r\n");
      if (eol < 0) return;
      const first = p.head.subarray(0, eol).toString("utf8");
      if (!first.startsWith("+OK")) {
        this.settle({ err: new Pop3Error(first.replace(/^-ERR\s*/, "") || "메일 서버가 거절했습니다.", false, true) });
        return;
      }
      if (!p.multi) {
        this.settle({ ok: Buffer.from(first, "utf8") });
        return;
      }
      // 여러 줄 응답은 "\r\n" + 나머지 를 하나의 흐름으로 보고 "\r\n.\r\n" 을 찾는다.
      // 첫 줄의 줄바꿈을 흐름 앞에 두면 본문이 빈 응답("+OK\r\n.\r\n")도 같은 규칙으로 잡힌다.
      p.parts = [];
      p.length = 0;
      p.carry = Buffer.alloc(0);
      chunk = p.head.subarray(eol);
    }

    // 끝 표시가 조각 경계에 걸칠 수 있으니 앞 조각의 마지막 4바이트를 붙여서 찾는다
    const region = Buffer.concat([p.carry!, chunk]);
    const hit = region.indexOf(TERM);
    p.parts.push(chunk);
    p.length! += chunk.length;
    if (hit < 0) {
      p.carry = region.subarray(Math.max(0, region.length - (TERM.length - 1)));
      return;
    }
    const stream = Buffer.concat(p.parts, p.length);
    const at = hit - p.carry!.length + (p.length! - chunk.length);
    // 흐름 앞의 "\r\n" 을 떼고, 마지막 줄의 줄바꿈까지 본문이다
    this.settle({ ok: unstuff(stream.subarray(2, at + 2)) });
  }
}

/** 점으로 시작하는 줄은 서버가 점을 하나 더 붙여 보낸다 (RFC 1939 §3) */
function unstuff(body: Buffer): Buffer {
  const out: Buffer[] = [];
  let from = 0;
  if (body[0] === 0x2e) from = 1; // 첫 줄
  let i = body.indexOf("\r\n.", from);
  while (i >= 0) {
    out.push(body.subarray(from, i + 2));
    from = i + 3; // 줄 첫 점 하나를 버린다
    i = body.indexOf("\r\n.", from);
  }
  out.push(body.subarray(from));
  return Buffer.concat(out);
}
