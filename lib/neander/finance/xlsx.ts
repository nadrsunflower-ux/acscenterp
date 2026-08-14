// ============================================================
//  엑셀 통합거래장 파서
// ------------------------------------------------------------
//  기존 장부 파일(.xlsx)을 그대로 올려서 거래를 읽어들인다.
//
//  실제 파일의 생김새를 그대로 감안한다:
//   - 시트 위쪽에 제목행·요약행이 있어 헤더가 1행이 아니다
//     (2607 장부는 4행). 그래서 헤더 위치를 **찾는다**.
//   - `계좌/카번` 이 숫자로 들어와 앞의 0 이 날아간다 → 4자리로 복원.
//   - 파생 열(순금액·수입금액·지출금액·회계코드…)은 읽지 않는다.
//     저장하지 않고 계산하는 값이기 때문이다.
// ============================================================

import * as XLSX from "xlsx";
import type { TxType } from "./types";
import { TX_TYPES, dedupHashOf } from "./types";

/**
 * 통합거래장에서 실제로 읽어들이는 열과 그 별칭.
 *
 * 장부 스키마가 한 번 개편돼서 월별로 열 이름이 다르다.
 *   신버전(2607~) 29열  계정대분류 / 계정중분류 / 계정소분류 + 사업구분 축
 *   구버전(~2606) 28열  상위카테고리 / 하위구분 / 세부항목, 사업구분 없음
 * 둘 다 읽을 수 있어야 과거 장부를 이관할 수 있으므로 별칭으로 흡수한다.
 */
const COLUMN_ALIASES = {
  date: ["거래일시", "거래일", "일자"],
  last4: ["계좌/카번", "계좌/카드번호"],
  txType: ["거래유형"],
  bizMajor: ["사업대분류"],
  bizMinor: ["사업소분류"],
  acctMajor: ["계정대분류", "상위카테고리"],
  acctMid: ["계정중분류", "하위구분"],
  acctMinor: ["계정소분류", "세부항목"],
  vendor: ["거래처"],
  acctNote: ["계정소분류비고", "세부항목비고"],
  personalUse: ["개인사용"],
  projectCode: ["프로젝트코드"],
  gross: ["원금액"],
  adjust: ["조정금액"],
  site: ["사업장"],
  note: ["비고"],
  refundMatchId: ["환급매칭ID"],
} as const;

type ColumnKey = keyof typeof COLUMN_ALIASES;

/**
 * 거래유형 이름도 개편 때 바뀌었다.
 *   구버전 내부이체  →  신버전 자금거래 (계좌 간 이동, 손익 비대상)
 * 뜻이 같은 이름이므로 흡수한다. 뜻이 다르면 흡수하면 안 된다 —
 * 재무에서 조용한 재해석은 금물이다.
 */
const TX_TYPE_ALIASES: Record<string, TxType> = {
  내부이체: "자금거래",
};

function normalizeTxType(raw: string): TxType | null {
  if ((TX_TYPES as readonly string[]).includes(raw)) return raw as TxType;
  return TX_TYPE_ALIASES[raw] ?? null;
}

/**
 * 헤더 판별 기준.
 *
 * 거래일시는 넣지 않는다 — 구버전 장부는 **날짜 열에 헤더 이름이 없다**
 * (A열 헤더가 비어 있고 값만 날짜다). 이름이 확실한 두 열로 헤더 행을
 * 찾고, 날짜 열은 아래에서 따로 해결한다.
 */
const REQUIRED: ColumnKey[] = ["txType", "gross"];

/** 헤더 배열에서 별칭 중 처음 맞는 열의 위치 (없으면 -1) */
function findColumn(header: string[], key: ColumnKey): number {
  for (const alias of COLUMN_ALIASES[key]) {
    const i = header.indexOf(alias);
    if (i >= 0) return i;
  }
  return -1;
}

export interface ParsedRow {
  /** 원본 엑셀 행 번호 (1-base) — 오류 안내에 쓴다 */
  rowNo: number;
  date: string;
  datetime?: string;
  last4?: string;
  txType: TxType;
  bizMajor?: string;
  bizMinor?: string;
  acctMajor?: string;
  acctMid?: string;
  acctMinor?: string;
  vendor?: string;
  acctNote?: string;
  personalUse?: boolean;
  projectCode?: string;
  gross: number;
  adjust: number;
  site?: string;
  note?: string;
  refundMatchId?: string;
  dedupHash: string;
}

export interface ParseError {
  rowNo: number;
  reason: string;
}

export interface ParseResult {
  sheetName: string;
  headerRowNo: number;
  rows: ParsedRow[];
  errors: ParseError[];
  /** 파일에서 찾은 시트 이름들 (다른 시트를 고르고 싶을 때 보여준다) */
  sheetNames: string[];
}

const str = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
};

const num = (v: unknown): number => {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  // "1,234,567" · "₩1,234" · "(123)" (회계 표기의 음수) 형태를 흡수한다
  const s = String(v).trim();
  const neg = /^\(.*\)$/.test(s);
  const cleaned = s.replace(/[(),₩\s]/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
};

/** 엑셀 날짜 → `YYYY-MM-DD` (KST 기준으로 자른다) */
function toDateStr(v: unknown): { date: string; datetime?: string } {
  if (v instanceof Date) {
    // cellDates:true 로 읽으면 Date 가 온다. 엑셀 날짜는 시각 정보가
    // 의미 없는 경우가 많아 UTC 기준 연월일을 그대로 쓴다.
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, "0");
    const d = String(v.getUTCDate()).padStart(2, "0");
    return { date: `${y}-${m}-${d}`, datetime: v.toISOString() };
  }
  const s = str(v);
  if (!s) return { date: "" };
  // "2026.07.01 00:00:00" · "2026-07-01" · "2026/07/01"
  const m = s.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (m) {
    return {
      date: `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`,
      datetime: s,
    };
  }
  return { date: "", datetime: s };
}

/** 계좌/카번을 4자리 문자열로 (숫자로 읽혀 앞 0 이 날아간 경우 복원) */
function toLast4(v: unknown): string | undefined {
  const s = str(v).replace(/\D/g, "");
  if (!s) return undefined;
  return s.slice(-4).padStart(4, "0");
}

/**
 * 헤더 행을 찾는다. 제목·요약행이 위에 있을 수 있으므로 위에서부터
 * 최대 20행을 훑어 필수 열이 모두 있는 행을 헤더로 본다.
 */
function findHeaderRow(grid: unknown[][]): number {
  for (let i = 0; i < Math.min(grid.length, 20); i++) {
    const cells = (grid[i] ?? []).map((c) => str(c));
    if (REQUIRED.every((k) => findColumn(cells, k) >= 0)) return i;
  }
  return -1;
}

/** 통합거래장으로 보이는 시트를 고른다 */
function pickSheet(wb: XLSX.WorkBook): string | null {
  const exact = wb.SheetNames.find((n) => n.includes("통합거래장"));
  if (exact) return exact;
  // 이름이 달라도 헤더가 맞으면 받아들인다
  for (const name of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
      header: 1,
      blankrows: false,
      raw: true,
    });
    if (findHeaderRow(grid) >= 0) return name;
  }
  return null;
}

/**
 * 워크북에서 거래를 읽는다. 파일 입출력과 분리해 둔 이유는
 * 브라우저(File) 밖에서도 — 예를 들어 검증 스크립트에서 — 똑같은
 * 파싱 로직을 돌릴 수 있어야 하기 때문이다.
 */
export function parseWorkbook(
  wb: XLSX.WorkBook,
  sheetNameOverride?: string,
): ParseResult {
  const sheetName = sheetNameOverride ?? pickSheet(wb);
  if (!sheetName || !wb.Sheets[sheetName]) {
    return {
      sheetName: "",
      headerRowNo: 0,
      rows: [],
      errors: [{ rowNo: 0, reason: "통합거래장 시트를 찾지 못했습니다." }],
      sheetNames: wb.SheetNames,
    };
  }

  const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
    header: 1,
    blankrows: false,
    raw: true,
  });

  const headerIdx = findHeaderRow(grid);
  if (headerIdx < 0) {
    return {
      sheetName,
      headerRowNo: 0,
      rows: [],
      errors: [
        {
          rowNo: 0,
          reason:
            "헤더를 찾지 못했습니다. 거래유형 · 원금액 열이 있어야 합니다.",
        },
      ],
      sheetNames: wb.SheetNames,
    };
  }

  const header = (grid[headerIdx] ?? []).map((c) => str(c));
  const idx = Object.fromEntries(
    (Object.keys(COLUMN_ALIASES) as ColumnKey[]).map((k) => [k, findColumn(header, k)]),
  ) as Record<ColumnKey, number>;

  // 구버전 장부는 날짜 열에 헤더 이름이 없다. 이름으로 못 찾으면 헤더가
  // 비어 있는 열 중 **첫 데이터 행이 날짜로 읽히는 열**을 날짜로 본다.
  if (idx.date < 0) {
    const firstData = grid[headerIdx + 1] ?? [];
    for (let c = 0; c < header.length; c++) {
      if (header[c]) continue;
      if (toDateStr(firstData[c]).date) {
        idx.date = c;
        break;
      }
    }
  }

  const get = (row: unknown[], key: ColumnKey): unknown =>
    idx[key] >= 0 ? row[idx[key]] : undefined;

  const rows: ParsedRow[] = [];
  const errors: ParseError[] = [];

  for (let i = headerIdx + 1; i < grid.length; i++) {
    const row = grid[i] ?? [];
    const rowNo = i + 1;

    const { date, datetime } = toDateStr(get(row, "date"));
    const txTypeRaw = str(get(row, "txType"));
    const gross = num(get(row, "gross"));

    // 빈 행은 조용히 건너뛴다.
    //
    // 엑셀 하단에는 수식만 걸려 있고 입력값은 없는 여백 행이 수백 줄
    // 이어진다. 그 행들도 순금액 0, 사업장 "네안데르"(VLOOKUP 기본값),
    // 결제수단구분 "법인카드", 조회키 "|||" 같은 **파생 결과**를 갖고
    // 있어서 "모든 셀이 비었는가"로는 걸러지지 않는다.
    // 그래서 사람이 실제로 입력하는 열만 보고 판정한다.
    const blank =
      !date &&
      !txTypeRaw &&
      gross === 0 &&
      num(get(row, "adjust")) === 0 &&
      !str(get(row, "vendor")) &&
      !str(get(row, "acctMinor"));
    if (blank) continue;

    if (!date) {
      errors.push({ rowNo, reason: "거래일시를 읽을 수 없음" });
      continue;
    }
    const txType = normalizeTxType(txTypeRaw);
    if (!txType) {
      errors.push({
        rowNo,
        reason: txTypeRaw
          ? `거래유형 「${txTypeRaw}」 은 인식할 수 없음 (${TX_TYPES.join("/")})`
          : "거래유형이 비어 있음",
      });
      continue;
    }
    const last4 = toLast4(get(row, "last4"));
    const vendor = str(get(row, "vendor")) || undefined;
    const adjust = num(get(row, "adjust"));

    rows.push({
      rowNo,
      date,
      datetime,
      last4,
      txType,
      bizMajor: str(get(row, "bizMajor")) || undefined,
      bizMinor: str(get(row, "bizMinor")) || undefined,
      acctMajor: str(get(row, "acctMajor")) || undefined,
      acctMid: str(get(row, "acctMid")) || undefined,
      acctMinor: str(get(row, "acctMinor")) || undefined,
      vendor,
      acctNote: str(get(row, "acctNote")) || undefined,
      personalUse: /^(y|yes|o|true|1)$/i.test(str(get(row, "personalUse"))) || undefined,
      projectCode: str(get(row, "projectCode")) || undefined,
      gross,
      adjust,
      site: str(get(row, "site")) || undefined,
      note: str(get(row, "note")) || undefined,
      refundMatchId: str(get(row, "refundMatchId")) || undefined,
      dedupHash: dedupHashOf({ date, last4, vendor, gross, txType }),
    });
  }

  return { sheetName, headerRowNo: headerIdx + 1, rows, errors, sheetNames: wb.SheetNames };
}

/** 브라우저에서 업로드된 파일을 읽는다 */
export async function parseLedgerFile(
  file: File,
  sheetNameOverride?: string,
): Promise<ParseResult> {
  const buf = await file.arrayBuffer();
  return parseWorkbook(XLSX.read(buf, { cellDates: true }), sheetNameOverride);
}
