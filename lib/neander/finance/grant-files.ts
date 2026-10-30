// 지원사업 서류. 파일은 별도 컬렉션에 보관해 지원사업 자동 저장과 분리한다.
export interface GrantFile {
  id: string;
  grantId: string;
  name: string;
  type: string;
  size: number;
  sha256: string;
  uploadedAt: number;
  uploadedBy?: string;
}

export const MAX_GRANT_FILE_BYTES = 200 * 1024 * 1024;
export const MAX_GRANT_FILES = 30;
export const GRANT_FILE_PART_BYTES = 768 * 1024;
export const GRANT_FILE_READ_PARTS = 5;
export const GRANT_FILE_EXTS = ["pdf", "xlsx", "xls", "docx", "doc", "hwp", "hwpx", "pptx", "ppt", "jpg", "jpeg", "png", "txt", "csv", "zip"];
export const GRANT_FILE_ACCEPT = GRANT_FILE_EXTS.map((ext) => `.${ext}`).join(",");

export const grantFileExt = (name: string) => name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  hwp: "application/x-hwp",
  hwpx: "application/vnd.hancom.hwpx",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt: "application/vnd.ms-powerpoint",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  txt: "text/plain", csv: "text/csv", zip: "application/zip",
};

export function validateGrantFileMeta(raw: { name?: unknown; type?: unknown; size?: unknown; sha256?: unknown }):
  | { ok: true; value: { name: string; type: string; size: number; sha256: string } }
  | { ok: false; error: string } {
  const name = typeof raw.name === "string" ? raw.name.normalize("NFC").trim() : "";
  if (!name || name.length > 240 || /[\u0000-\u001f\u007f/\\]/.test(name)) return { ok: false, error: "파일 이름이 올바르지 않습니다." };
  const ext = grantFileExt(name);
  if (!GRANT_FILE_EXTS.includes(ext)) return { ok: false, error: "지원하지 않는 파일 형식입니다." };
  const size = Number(raw.size);
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_GRANT_FILE_BYTES) return { ok: false, error: `파일 하나는 ${MAX_GRANT_FILE_BYTES / 1024 / 1024}MB까지 올릴 수 있습니다.` };
  const sha256 = typeof raw.sha256 === "string" ? raw.sha256.toLowerCase() : "";
  if (!/^[a-f0-9]{64}$/.test(sha256)) return { ok: false, error: "파일 확인값이 올바르지 않습니다. 다시 선택해 주세요." };
  // 브라우저가 보낸 MIME을 그대로 쓰지 않고 허용한 확장자에 맞춘다.
  return { ok: true, value: { name, size, sha256, type: MIME[ext] || "application/octet-stream" } };
}
