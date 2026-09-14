import "server-only";

// ============================================================
//  암호 걸린 엑셀의 비밀번호 목록 — 환경변수에만 있다
// ------------------------------------------------------------
//  토스·카카오뱅크 거래내역, 네이버 예약자관리는 늘 같은 비밀번호로 잠겨
//  온다. 계좌마다 다르지만 몇 개 안 되므로, 서버가 목록을 들고 **차례로
//  시도**한다 — 파일을 열기 전에는 어느 계좌 파일인지 알 수 없어서
//  "이 파일엔 이 비밀번호" 식의 대응표를 만들 수가 없다.
//
//  ⚠️ 비밀번호를 코드에 적지 않는다 — 이 저장소는 공개돼 있다.
//     .env.local 과 배포 환경변수(NEANDER_XLSX_PASSWORDS, 쉼표 구분)에만 둔다.
//     예전 이름 NEANDER_SALES_XLSX_PASSWORD 도 계속 읽는다.
// ============================================================

/** 시도할 비밀번호들 — 앞에 사람이 준 것, 뒤에 환경변수 목록 (중복 제거) */
export function knownXlsxPasswords(extra?: string): string[] {
  const list = [
    extra ?? "",
    ...(process.env.NEANDER_XLSX_PASSWORDS ?? "").split(","),
    process.env.NEANDER_SALES_XLSX_PASSWORD ?? "",
  ]
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(list)];
}

/** 환경변수에 하나라도 있는가 — 없으면 화면이 비밀번호를 물어야 한다 */
export function hasConfiguredPasswords(): boolean {
  return knownXlsxPasswords().length > 0;
}

type Oct = {
  isEncrypted: (b: Buffer) => boolean;
  decrypt: (b: Buffer, o: { password: string }) => Promise<Buffer>;
};

/**
 * 잠긴 파일이면 아는 비밀번호로 차례로 풀어 본다.
 * 잠기지 않은 파일은 그대로 돌려준다. 전부 실패하면 null.
 */
export async function decryptWithKnownPasswords(
  input: Buffer,
  extra?: string,
): Promise<{ buf: Buffer; encrypted: boolean; used?: string } | null> {
  // 동적 import — 이 라우트를 부르지 않는 요청에 라이브러리를 얹지 않는다
  const oct = (await import("officecrypto-tool")) as Oct;
  if (!oct.isEncrypted(input)) return { buf: input, encrypted: false };
  for (const password of knownXlsxPasswords(extra)) {
    try {
      return { buf: await oct.decrypt(input, { password }), encrypted: true, used: password };
    } catch {
      // 다음 후보로
    }
  }
  return null;
}
