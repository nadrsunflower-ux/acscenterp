"use client";

// ============================================================
//  급여·세무 서류 — 화면에서 부르는 쪽 (api/neander/finance/tax-docs)
// ------------------------------------------------------------
//  재무 데이터(/data · FinanceProvider)에 싣지 않고 따로 받는다 — 한 해 백 장
//  남짓이라 화면을 열 때 한 번 받으면 된다 (지원사업 grant-client 와 같은 방식).
//
//  올리기: 세무사가 보내는 zip 은 브라우저에서 풀어 PDF 하나하나로 올린다. 이름이
//  옛 한글 인코딩(CP949)이라 그대로 풀면 깨진다 — UTF-8 로 안 읽히면 euc-kr 로.
//  폴더째 고르면 경로(`2026/10월/…`)를 같이 보낸다 — 글자 없는 스캔본의 귀속
//  짐작에 쓴다. 다 올리면 폴더(묶음)마다 「같이 올린 서류끼리 귀속 빌려주기」.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import JSZip from "jszip";
import { getNeanderAuth } from "@/lib/neander/firebase";
import { folderMonthOf } from "./tax-docs-parse";
import { isTaxFolderPick, TAX_DOC_EXTS, TAX_DOC_PART_BYTES, taxDocExt, type TaxDoc, type TaxDocKind } from "./tax-docs";

const URL_ = "/api/neander/finance/tax-docs";

async function token(): Promise<string> {
  const user = getNeanderAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  return user.getIdToken();
}

async function readError(res: Response): Promise<string> {
  try {
    return ((await res.json()) as { error?: string }).error || `요청이 실패했습니다 (HTTP ${res.status})`;
  } catch {
    return `요청이 실패했습니다 (HTTP ${res.status})`;
  }
}

async function post<T>(body: object): Promise<T> {
  const res = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

export async function fetchTaxDocs(): Promise<TaxDoc[]> {
  const res = await fetch(URL_, { headers: { Authorization: `Bearer ${await token()}` }, cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  return ((await res.json()) as { docs?: TaxDoc[] }).docs ?? [];
}

export async function updateTaxDoc(id: string, patch: { kind?: TaxDocKind; period?: string; entity?: string; note?: string }): Promise<TaxDoc> {
  const { doc } = await post<{ doc: TaxDoc }>({ action: "update", id, patch });
  await reload();
  return doc;
}

export async function deleteTaxDoc(id: string): Promise<void> {
  await post({ action: "delete", id });
  await reload();
}

// ---- 함께 보는 사본 ------------------------------------------------

let cache: TaxDoc[] | null = null;
const listeners = new Set<(list: TaxDoc[]) => void>();

async function reload(): Promise<TaxDoc[]> {
  const list = await fetchTaxDocs();
  cache = list;
  listeners.forEach((fn) => fn(list));
  return list;
}

export function useTaxDocs() {
  const [docs, setDocs] = useState<TaxDoc[]>(cache ?? []);
  const [loading, setLoading] = useState(cache === null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "서류를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    listeners.add(setDocs);
    const off = getNeanderAuth().onAuthStateChanged((u) => {
      if (u) void refresh();
    });
    return () => {
      listeners.delete(setDocs);
      off();
    };
  }, [refresh]);

  return { docs, loading, error, refresh };
}

// ---- 올리기 --------------------------------------------------------

interface Entry {
  name: string;
  blob: Blob;
  /** 묶음 — 같은 폴더 · 같은 zip 의 파일끼리 귀속을 빌려준다 */
  group: string;
  /** 폴더 경로에서 짐작한 달 */
  folderMonth?: string;
}

function decodeZipName(bytes: Uint8Array | string[] | string): string {
  if (typeof bytes === "string") return bytes;
  const u8 = Array.isArray(bytes) ? new Uint8Array(bytes.map((c) => c.charCodeAt(0))) : bytes;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(u8);
  } catch {
    return new TextDecoder("euc-kr").decode(u8);
  }
}

const skipName = (name: string) => {
  const base = name.split("/").pop() ?? name;
  return !base || base.startsWith(".") || base.startsWith("~$") || name.includes("__MACOSX/");
};

async function expand(files: File[]): Promise<{ entries: Entry[]; skipped: string[] }> {
  const entries: Entry[] = [];
  const skipped: string[] = [];
  const year = String(new Date().getFullYear());
  for (const f of files) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
    const path = (rel || f.name).normalize("NFC");
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (skipName(path)) continue;
    // 폴더째 고른 것은 세무사 서류만 (장부 · 원가 엑셀이 같이 있다). 하나씩 고른 파일은 그대로 받는다
    if (rel && !isTaxFolderPick(path)) {
      skipped.push(f.name);
      continue;
    }
    if (taxDocExt(f.name) === "zip") {
      const zip = await JSZip.loadAsync(f, { decodeFileName: decodeZipName });
      const zipMonth = folderMonthOf(path, year);
      for (const z of Object.values(zip.files)) {
        if (z.dir || skipName(z.name)) continue;
        const name = (z.name.split("/").pop() ?? z.name).normalize("NFC");
        if (!TAX_DOC_EXTS.includes(taxDocExt(name))) {
          skipped.push(name);
          continue;
        }
        entries.push({ name, blob: await z.async("blob"), group: path, folderMonth: folderMonthOf(`${dir}/${z.name}`, year) ?? zipMonth });
      }
      continue;
    }
    if (!TAX_DOC_EXTS.includes(taxDocExt(f.name))) {
      skipped.push(f.name);
      continue;
    }
    entries.push({ name: f.name.normalize("NFC"), blob: f, group: dir || "drop", folderMonth: folderMonthOf(path, year) });
  }
  return { entries, skipped };
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const mimeOf = (name: string, blob: Blob) =>
  blob.type ||
  ({ pdf: "application/pdf", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" } as Record<string, string>)[taxDocExt(name)] ||
  "application/octet-stream";

async function uploadOne(e: Entry): Promise<{ doc: TaxDoc; duplicate: boolean }> {
  const made = await post<{ id: string; partBytes: number; parts: number } | { duplicate: TaxDoc }>({
    action: "create",
    name: e.name,
    type: mimeOf(e.name, e.blob),
    size: e.blob.size,
    sha256: await sha256Hex(e.blob),
    folderMonth: e.folderMonth,
  });
  if ("duplicate" in made) return { doc: made.duplicate, duplicate: true };
  const { id, partBytes, parts } = made;
  try {
    const one = async (n: number) => {
      const buf = await e.blob.slice(n * partBytes, (n + 1) * partBytes).arrayBuffer();
      await post({ action: "part", id, n, base64: toBase64(buf) });
    };
    for (let n = 0; n < parts; n += 3) await Promise.all([n, n + 1, n + 2].filter((i) => i < parts).map(one));
    return { doc: (await post<{ doc: TaxDoc }>({ action: "done", id })).doc, duplicate: false };
  } catch (err) {
    void post({ action: "delete", id }).catch(() => undefined);
    throw err;
  }
}

export interface TaxUploadReport {
  added: TaxDoc[];
  duplicates: TaxDoc[];
  failed: { name: string; error: string }[];
  skipped: string[];
}

/** 파일 · zip · 폴더를 올린다. 진행률(0~1)과 지금 올리는 파일 이름을 알려 준다 */
export async function uploadTaxFiles(files: File[], onProgress?: (p: number, name: string) => void): Promise<TaxUploadReport> {
  const { entries, skipped } = await expand(files);
  const report: TaxUploadReport = { added: [], duplicates: [], failed: [], skipped };
  const groups = new Map<string, string[]>();
  let done = 0;
  const run = async (e: Entry) => {
    onProgress?.(done / Math.max(1, entries.length), e.name);
    try {
      const r = await uploadOne(e);
      (r.duplicate ? report.duplicates : report.added).push(r.doc);
      if (!r.duplicate) groups.set(e.group, [...(groups.get(e.group) ?? []), r.doc.id]);
    } catch (err) {
      report.failed.push({ name: e.name, error: err instanceof Error ? err.message : "올리지 못했습니다." });
    }
    done++;
    onProgress?.(done / Math.max(1, entries.length), e.name);
  };
  // 세 파일씩 나란히 — 한 파일은 조각이 서너 개라 요청이 많지 않다
  for (let i = 0; i < entries.length; i += 3) await Promise.all(entries.slice(i, i + 3).map(run));
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    const { docs } = await post<{ docs: TaxDoc[] }>({ action: "siblings", ids }).catch(() => ({ docs: [] as TaxDoc[] }));
    for (const d of docs) {
      const i = report.added.findIndex((a) => a.id === d.id);
      if (i >= 0) report.added[i] = d;
    }
  }
  await reload().catch(() => undefined);
  return report;
}

// ---- 받기 · 열기 ---------------------------------------------------

async function readTaxDoc(d: TaxDoc): Promise<Blob> {
  const auth = { Authorization: `Bearer ${await token()}` };
  const parts = Math.ceil(d.size / TAX_DOC_PART_BYTES);
  const chunks: ArrayBuffer[] = [];
  for (let from = 0; from < parts; from += 5) {
    const r = await fetch(`${URL_}?id=${encodeURIComponent(d.id)}&from=${from}&count=5`, { headers: auth, cache: "no-store" });
    if (!r.ok) throw new Error(await readError(r));
    chunks.push(await r.arrayBuffer());
  }
  return new Blob(chunks, { type: d.type || "application/octet-stream" });
}

function saveAs(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const canPreviewTaxDoc = (d: TaxDoc) => /^(image\/|application\/pdf)/.test(d.type);

export async function downloadTaxDoc(d: TaxDoc): Promise<void> {
  saveAs(await readTaxDoc(d), d.name);
}

/**
 * 새 탭에서 연다. 창을 **클릭 시점에 먼저** 열어 둔다 — 조각을 받는 사이(await)에
 * window.open 을 부르면 브라우저가 팝업으로 보고 막는다 (회의 첨부와 같은 이유).
 */
export async function openTaxDoc(d: TaxDoc): Promise<void> {
  if (!canPreviewTaxDoc(d)) return downloadTaxDoc(d);
  const w = window.open("", "_blank");
  try {
    const blob = await readTaxDoc(d);
    if (!w) return saveAs(blob, d.name);
    const url = URL.createObjectURL(blob);
    w.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    w?.close();
    throw e;
  }
}
