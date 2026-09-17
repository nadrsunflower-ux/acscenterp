// ============================================================
//  월별 적재 퍼즐 — 한 달은 원본 파일 세 개로 완성된다
// ------------------------------------------------------------
//  네이버 예약자관리 1개 + 페이히어 매출내역 2개(아이디·와우). 이 셋이
//  다 들어와야 그 달의 판매 줄이 완전하다. 하나라도 빠지면 월 손익이
//  조용히 작아지므로, 화면은 빠진 칸을 **붉게** 드러내고 채워진 칸을
//  초록으로 보여준다.
//
//  네 번째 칸 — 온라인(2026-09-15 추가)은 **있을 때만** 올리는 칸이다
//  (optional). 온라인 판매가 없던 달(2025-12·2026-01)도 있어서, 필수로 두면 그
//  달 퍼즐이 영영 완성되지 않는다. 완성 판정·「n/3」은 필수 칸만 센다.
//
//  ⚠️ 2026-09 부터 온라인 칸은 **자동으로 채워진다** — acscent.co.kr 주문을
//     ERP 가 직접 끌어온다 (lib/neander/sync). 그래도 칸을 없애지 않은 이유:
//     시작일(기본 2026-09-01) 앞의 달은 여전히 엑셀이 정본이고, 그 달을 다시
//     보거나 고칠 때 올릴 자리가 필요하다. 칸에는 「자동」 표시가 붙는다.
//
//  칸은 파일명이 아니라 **내용**으로 정한다 — 페이히어는 시트 상단의
//  매장 이름(악센트 아이디 · 악센트 와우(홍대))으로, 네이버는 예약번호·
//  이용일시 열로 판정한다. 어느 칸에 떨어뜨리든 맞는 칸으로 간다.
// ============================================================

import type { PosResult } from "@/lib/neander/finance/adapters";
import { selectableMonths, todayMonth, workingMonthOf } from "@/lib/neander/months";
import type { PayRoute, SalesImportBatch, SalesStore } from "./types";

// 달 목록은 재무 적재와 같은 규칙을 쓴다 — 여기서 다시 내보낸다
export { selectableMonths };

export type ImportSlotKey = "naver" | "payhere-id" | "payhere-wow" | "payhere-online";

export interface ImportSlot {
  key: ImportSlotKey;
  /** 칸 제목 */
  label: string;
  /** 어디서 내려받는 파일인지 */
  source: string;
  /** 파일명 예시 */
  example: string;
  store: SalesStore;
  route: PayRoute;
  /** 암호가 걸려 오는 파일 — 서버가 푼다 */
  encrypted: boolean;
  /** 있을 때만 올리는 칸 — 비어 있어도 퍼즐은 완성된다 */
  optional?: boolean;
  /**
   * 자사 사이트에서 **자동으로** 들어오는 칸. 사람이 파일을 올릴 일이 없다
   * (lib/neander/sync). 시작일 앞의 달은 여전히 엑셀이 정본이라, 칸을
   * 없애지 않고 「자동」 표시만 붙인다 — 과거 달을 손으로 올릴 길은 남는다.
   */
  auto?: "acscent-online";
}

export const IMPORT_SLOTS: ImportSlot[] = [
  {
    key: "naver",
    label: "네이버 예약",
    source: "네이버 예약 파트너센터 › 예약자 관리",
    example: "주식회사 네안데르_예약자관리_YYYYMMDD_HHMM.xlsx",
    store: "id",
    route: "naver",
    encrypted: true,
  },
  {
    key: "payhere-id",
    label: "페이히어 · 아이디",
    source: "페이히어 › 매출 내역 › 악센트 아이디",
    example: "YYYYMMDD~YYYYMMDD_악센트 아이디.xlsx",
    store: "id",
    route: "payhere",
    encrypted: false,
  },
  {
    key: "payhere-wow",
    label: "페이히어 · 와우",
    source: "페이히어 › 매출 내역 › 악센트 와우(홍대)",
    example: "YYYYMMDD~YYYYMMDD_악센트 와우(홍대).xlsx",
    store: "wow",
    route: "payhere",
    encrypted: false,
  },
  {
    key: "payhere-online",
    label: "온라인 (자사몰)",
    source: "acscent.co.kr 주문 — 사이트에서 자동으로 들어옵니다",
    example: "페이히어_온라인_매출_YYYY-MM-DD_YYYY-MM-DD.xlsx (과거 달 수동 적재용)",
    store: "online",
    route: "online",
    encrypted: false,
    optional: true,
    auto: "acscent-online",
  },
];

export const slotByKey = (key: ImportSlotKey): ImportSlot =>
  IMPORT_SLOTS.find((s) => s.key === key)!;

/** 파서 결과로 어느 칸인지 정한다. 모르면 null */
export function classifySlot(r: PosResult): ImportSlot | null {
  if (/네이버/.test(r.sourceLabel)) return slotByKey("naver");
  if (/온라인/.test(r.sourceLabel) || /온라인|online/i.test(r.store)) return slotByKey("payhere-online");
  const s = `${r.store} ${r.sourceLabel}`;
  if (/와우|wow/i.test(s)) return slotByKey("payhere-wow");
  if (/아이디|\bID\b/i.test(s)) return slotByKey("payhere-id");
  return null;
}

/** 파일이 담은 달. 두 달에 걸치거나 기간을 모르면 null */
export function monthOfResult(r: PosResult): string | null {
  const from = r.from?.slice(0, 7);
  const to = r.to?.slice(0, 7);
  if (!from) return null;
  if (to && to !== from) return null;
  return from;
}

/** 적재 배치가 담은 달 — from 기준. 없으면 to */
export function monthOfBatch(b: SalesImportBatch): string | null {
  const m = (b.from ?? b.to ?? "").slice(0, 7);
  return /^\d{4}-\d{2}$/.test(m) ? m : null;
}

/** 그 달·그 칸에 살아 있는(되돌리지 않은) 배치. 여러 개면 최신 */
export function batchInSlot(
  imports: SalesImportBatch[],
  month: string,
  slot: ImportSlot,
): SalesImportBatch | undefined {
  return imports
    .filter(
      (b) =>
        !b.undone &&
        b.store === slot.store &&
        b.route === slot.route &&
        monthOfBatch(b) === month,
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0];
}

/** 그 달의 퍼즐 상태 — 채워진 칸 수와 칸별 배치. 수와 완성은 필수 칸만 센다 */
export function puzzleOf(imports: SalesImportBatch[], month: string) {
  const pieces = IMPORT_SLOTS.map((slot) => ({ slot, batch: batchInSlot(imports, month, slot) }));
  const required = pieces.filter((p) => !p.slot.optional);
  const filled = required.filter((p) => p.batch).length;
  return { pieces, filled, total: required.length, complete: filled === required.length };
}

/**
 * 처음 열 때 보여줄 달 — 퍼즐에 할 일이 있는 달 (lib/neander/months.ts 의 규칙)
 */
export function firstIncompleteMonth(imports: SalesImportBatch[], months: string[]): string {
  return workingMonthOf(months, (m) => puzzleOf(imports, m));
}

/**
 * 지금 작업 중인 달 — 가장 최근에 적재한 파일의 달. 아무것도 없으면 이번 달.
 * 이벤트 입력 화면이 처음 열 때 쓴다: 파일을 올린 직후 그 달의 행사를 적는
 * 흐름이라, 퍼즐이 완성된 달이 곧 작업 중인 달이다.
 */
export function workingMonth(imports: SalesImportBatch[]): string {
  const months = imports
    .filter((b) => !b.undone)
    .map((b) => monthOfBatch(b))
    .filter((m): m is string => !!m)
    .sort();
  return months[months.length - 1] ?? todayMonth();
}
