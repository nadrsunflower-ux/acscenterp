// ============================================================
//  채팅 첨부 파일 → 텍스트 추출
// ------------------------------------------------------------
//  모델에는 파일이 아니라 **추출한 텍스트**를 보낸다. 이유:
//  - OpenRouter 를 거치면 모델마다 파일 지원이 제각각이다 (엑셀·한글은 없음).
//  - 텍스트면 다음 턴 히스토리에 그대로 실어 보낼 수 있어 서버가 파일을
//    보관할 필요가 없다 (서버는 상태를 갖지 않는다).
//
//  형식별: 엑셀/CSV → 시트별 CSV, docx → mammoth, PDF → unpdf(텍스트 레이어),
//  hwpx → zip 안의 section XML 에서 태그 제거. 구형 .hwp/.doc 은 바이너리
//  포맷이라 안 읽는다 — 변환 안내를 던진다.
// ============================================================

import * as XLSX from "xlsx";
import mammoth from "mammoth";
import JSZip from "jszip";
import { extractText } from "unpdf";
import { fileExt } from "../attachment-limits";

/** 파일 하나당 이 글자 수를 넘는 부분은 버린다 — 대화 몇 턴이면 비용이 튄다 */
const MAX_CHARS_PER_FILE = 30_000;

export interface ExtractedAttachment {
  name: string;
  text: string;
  truncated: boolean;
}

/** 실패는 사용자에게 그대로 보여줄 한국어 메시지로 던진다 (라우트가 400 으로 감싼다) */
export async function extractAttachmentText(file: File): Promise<ExtractedAttachment> {
  const buf = Buffer.from(await file.arrayBuffer());
  let text: string;

  switch (fileExt(file.name)) {
    case "xlsx":
    case "xls": {
      const wb = XLSX.read(buf, { type: "buffer" });
      text = wb.SheetNames.map(
        (n) => `[시트: ${n}]\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`,
      ).join("\n\n");
      break;
    }
    case "csv": {
      // 은행 CSV 는 CP949(euc-kr)가 흔하다 — UTF-8 로 깨지면 다시 읽는다
      text = new TextDecoder("utf-8").decode(buf);
      if (text.includes("�")) {
        try {
          text = new TextDecoder("euc-kr").decode(buf);
        } catch {
          /* euc-kr 디코더가 없으면 깨진 대로 둔다 */
        }
      }
      break;
    }
    case "docx":
      text = (await mammoth.extractRawText({ buffer: buf })).value;
      break;
    case "pdf": {
      const r = await extractText(new Uint8Array(buf), { mergePages: true });
      text = r.text;
      break;
    }
    case "hwpx": {
      const zip = await JSZip.loadAsync(buf);
      const sections = Object.keys(zip.files)
        .filter((p) => /^Contents\/section\d+\.xml$/i.test(p))
        .sort();
      if (sections.length === 0) {
        throw new Error(`${file.name}: hwpx 본문을 찾지 못했습니다.`);
      }
      const xmls = await Promise.all(sections.map((p) => zip.files[p].async("string")));
      text = xmls.map(stripHwpxXml).join("\n");
      break;
    }
    case "txt":
    case "md":
      text = buf.toString("utf-8");
      break;
    case "hwp":
      throw new Error(
        `${file.name}: 구형 .hwp 형식은 읽지 못합니다. 한글에서 .hwpx 또는 PDF 로 저장해 다시 첨부해주세요.`,
      );
    case "doc":
      throw new Error(
        `${file.name}: 구형 .doc 형식은 읽지 못합니다. .docx 또는 PDF 로 저장해 다시 첨부해주세요.`,
      );
    default:
      throw new Error(
        `${file.name}: 지원하지 않는 형식입니다. PDF·Word(docx)·엑셀(xlsx/xls/csv)·한글(hwpx)·텍스트만 첨부할 수 있습니다.`,
      );
  }

  const trimmed = text.replace(/\u0000/g, "").trim();
  if (!trimmed) {
    throw new Error(
      `${file.name}: 텍스트를 추출하지 못했습니다. 스캔(이미지) PDF 라면 글자 정보가 없을 수 있습니다.`,
    );
  }
  const truncated = trimmed.length > MAX_CHARS_PER_FILE;
  return {
    name: file.name,
    text: truncated ? trimmed.slice(0, MAX_CHARS_PER_FILE) : trimmed,
    truncated,
  };
}

/** hwpx section XML → 평문. 문단 닫힘을 줄바꿈으로 바꾸고 태그를 걷어낸다. */
function stripHwpxXml(xml: string): string {
  return xml
    .replace(/<\/hp:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}
