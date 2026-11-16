"use client";

// ============================================================
//  첨부파일 미리보기 — 자료 목록에서 줄을 펼치면 그 자리에서 본다.
//  PDF · 사진은 브라우저가 그대로 그리고, 엑셀/CSV 는 표로,
//  워드(docx)는 mammoth 로 HTML 을 만들어 스크립트 없는 iframe 에,
//  한글(hwpx) · 파워포인트(pptx) 는 본문 글자만 뽑아 보여 준다.
//  구형 바이너리(.hwp · .doc · .ppt)와 zip 은 「받기」로 안내한다.
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Eye } from "lucide-react";
import {
  Button, InlineNotice, LoadingState, SegmentedControl, Table, TableScroll, Td, Th, Tr, cn,
} from "@/components/neander/ui";
import { formatBytes } from "@/lib/neander/finance/docs";
import { attachedFileExt, type AttachedFile } from "@/lib/neander/finance/attached-files";

/** 이 크기까지는 펼치자마자 불러오고, 넘으면 버튼을 눌러야 받는다 */
const AUTO_LOAD_BYTES = 30 * 1024 * 1024;
/** 표 미리보기 상한 — 다 보려면 받기 */
const MAX_ROWS = 300;
const MAX_COLS = 40;

type Kind = "pdf" | "image" | "sheet" | "docx" | "hwpx" | "pptx" | "text" | "none";

export function previewKind(file: AttachedFile): Kind {
  switch (attachedFileExt(file.name)) {
    case "pdf": return "pdf";
    case "png": case "jpg": case "jpeg": return "image";
    case "xlsx": case "xls": case "csv": return "sheet";
    case "docx": return "docx";
    case "hwpx": return "hwpx";
    case "pptx": return "pptx";
    case "txt": return "text";
    default: return "none";
  }
}

const UNSUPPORTED: Record<string, string> = {
  hwp: "구형 한글(.hwp) 파일은 브라우저에서 열 수 없습니다. 받아서 한글로 열거나, .hwpx · PDF 로 저장해 다시 올리면 여기서 보입니다.",
  doc: "구형 워드(.doc) 파일은 브라우저에서 열 수 없습니다. 받아서 워드로 열거나, .docx · PDF 로 저장해 다시 올리면 여기서 보입니다.",
  ppt: "구형 파워포인트(.ppt) 파일은 브라우저에서 열 수 없습니다. 받아서 열거나, .pptx · PDF 로 저장해 다시 올리면 여기서 보입니다.",
  zip: "압축 파일은 미리보기가 없습니다. 받아서 풀어 보세요.",
};

interface Props {
  file: AttachedFile;
  /** 원본 읽기 — 패널이 들고 있는 캐시를 거친다 */
  load: (file: AttachedFile, signal: AbortSignal) => Promise<Blob>;
  onDownload: () => void;
}

export function AttachedFilePreview({ file, load, onDownload }: Props) {
  const kind = previewKind(file);
  const [wanted, setWanted] = useState(file.size <= AUTO_LOAD_BYTES);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (kind === "none" || !wanted) return;
    const controller = new AbortController();
    setError(null);
    load(file, controller.signal)
      .then((b) => { if (!controller.signal.aborted) setBlob(b); })
      .catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "파일을 불러오지 못했습니다."); });
    return () => controller.abort();
  }, [file, kind, load, wanted]);

  const shell = (children: React.ReactNode) => (
    <div className="mt-3 rounded-nd-md border border-nd-line bg-nd-sunken p-3">{children}</div>
  );

  if (kind === "none") {
    return shell(
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <p className="flex-1 text-nd-table text-nd-fg-2">{UNSUPPORTED[attachedFileExt(file.name)] ?? "이 형식은 미리보기가 없습니다. 받아서 열어 보세요."}</p>
        <Button size="sm" variant="secondary" icon={Download} onClick={onDownload}>받기</Button>
      </div>,
    );
  }
  if (!wanted) {
    return shell(
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <p className="flex-1 text-nd-table text-nd-fg-2">파일이 커서({formatBytes(file.size)}) 바로 불러오지 않았습니다. 미리보려면 파일 전체를 받아야 합니다.</p>
        <Button size="sm" variant="secondary" icon={Eye} onClick={() => setWanted(true)}>미리보기 불러오기</Button>
      </div>,
    );
  }
  if (error) return shell(<InlineNotice tone="danger">{error}</InlineNotice>);
  if (!blob) return shell(<LoadingState label="미리보기를 불러오는 중…" />);

  switch (kind) {
    case "pdf": return <BlobFrame blob={blob} title={file.name} />;
    case "image": return <BlobImage blob={blob} alt={file.name} />;
    case "sheet": return shell(<SheetPreview blob={blob} ext={attachedFileExt(file.name)} />);
    case "docx": return <DocxPreview blob={blob} title={file.name} />;
    case "hwpx": return shell(<ZipTextPreview blob={blob} kind="hwpx" />);
    case "pptx": return shell(<ZipTextPreview blob={blob} kind="pptx" />);
    case "text": return shell(<TextPreview blob={blob} />);
  }
}

function useObjectUrl(blob: Blob) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const made = URL.createObjectURL(blob);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [blob]);
  return url;
}

function BlobFrame({ blob, title }: { blob: Blob; title: string }) {
  const url = useObjectUrl(blob);
  if (!url) return null;
  return <iframe src={url} title={`${title} 미리보기`} className="mt-3 h-[80vh] min-h-[480px] w-full rounded-nd-md border border-nd-line bg-white" />;
}

function BlobImage({ blob, alt }: { blob: Blob; alt: string }) {
  const url = useObjectUrl(blob);
  if (!url) return null;
  return (
    <div className="mt-3 flex justify-center rounded-nd-md border border-nd-line bg-nd-sunken p-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- 로그인 뒤 받은 blob 이라 next/image 를 못 쓴다 */}
      <img src={url} alt={alt} className="max-h-[80vh] max-w-full rounded-nd-sm object-contain" />
    </div>
  );
}

// ---- 엑셀 · CSV ------------------------------------------------

interface SheetData { name: string; rows: string[][]; totalRows: number; totalCols: number }

function SheetPreview({ blob, ext }: { blob: Blob; ext: string }) {
  const [sheets, setSheets] = useState<SheetData[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState("0");

  useEffect(() => {
    let alive = true;
    (async () => {
      const XLSX = await import("xlsx");
      const buffer = await blob.arrayBuffer();
      const book = ext === "csv"
        ? XLSX.read(decodeText(buffer), { type: "string" })
        : XLSX.read(buffer, { type: "array", cellDates: true });
      return book.SheetNames.map((name) => {
        const all = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, raw: false, defval: "", blankrows: false });
        const totalCols = all.reduce((max, row) => Math.max(max, row.length), 0);
        const rows = all.slice(0, MAX_ROWS).map((row) => Array.from({ length: Math.min(totalCols, MAX_COLS) }, (_, i) => String(row[i] ?? "")));
        return { name, rows, totalRows: all.length, totalCols };
      });
    })()
      .then((list) => { if (alive) setSheets(list); })
      .catch((e) => {
        if (!alive) return;
        const message = e instanceof Error ? e.message : "";
        setError(/password|encrypt/i.test(message) ? "암호가 걸린 엑셀이라 미리볼 수 없습니다. 받아서 열어 보세요." : "엑셀 파일을 읽지 못했습니다. 받아서 열어 보세요.");
      });
    return () => { alive = false; };
  }, [blob, ext]);

  if (error) return <InlineNotice tone="danger">{error}</InlineNotice>;
  if (!sheets) return <LoadingState label="표를 그리는 중…" />;
  if (!sheets.length) return <p className="text-nd-table text-nd-fg-3">시트가 없습니다.</p>;
  const sheet = sheets[Number(active)] ?? sheets[0];
  const cols = Math.min(sheet.totalCols, MAX_COLS);
  const cut = sheet.totalRows > MAX_ROWS || sheet.totalCols > MAX_COLS;

  return (
    <div className="flex flex-col gap-3">
      {sheets.length > 1 && (
        <SegmentedControl
          size="sm"
          ariaLabel="시트"
          value={String(sheets.indexOf(sheet))}
          onChange={setActive}
          options={sheets.map((s, i) => ({ value: String(i), label: s.name }))}
          className="max-w-full self-start overflow-x-auto"
        />
      )}
      {sheet.rows.length === 0 ? <p className="text-nd-table text-nd-fg-3">빈 시트입니다.</p> : (
        <TableScroll maxHeight="70vh" className="rounded-nd-sm border border-nd-line bg-nd-content">
          <Table dense>
            <thead className="sticky top-0 z-20 bg-nd-content">
              <tr className="border-b border-nd-line">
                <Th className="w-10 text-nd-fg-3">#</Th>
                {Array.from({ length: cols }, (_, i) => <Th key={i} className="text-nd-fg-3">{columnName(i)}</Th>)}
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((row, r) => (
                <Tr key={r}>
                  <Td muted className="nd-num">{r + 1}</Td>
                  {row.map((cell, c) => (
                    <Td key={c} num={looksNumeric(cell)} className="max-w-[320px] truncate whitespace-nowrap" title={cell.length > 30 ? cell : undefined}>{cell}</Td>
                  ))}
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      )}
      {cut && (
        <p className="text-nd-table text-nd-fg-3">
          미리보기는 {MAX_ROWS}줄 · {MAX_COLS}열까지만 보입니다 (이 시트는 {sheet.totalRows.toLocaleString("ko-KR")}줄 · {sheet.totalCols}열). 전부 보려면 받아서 여세요.
        </p>
      )}
    </div>
  );
}

const columnName = (i: number) => {
  let name = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
};
const looksNumeric = (value: string) => /^[-+]?[\d,]+(\.\d+)?%?$/.test(value.trim()) && /\d/.test(value);

/** UTF-8 로 읽다 깨지면 한국 엑셀이 흔히 쓰는 EUC-KR 로 다시 읽는다 */
function decodeText(buffer: ArrayBuffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("euc-kr").decode(buffer);
  }
}

// ---- 워드(docx) ------------------------------------------------

const DOCX_STYLE = `
  body { margin: 0; padding: 32px 40px; font: 15px/1.7 -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; color: #1d1d1f; background: #fff; word-break: keep-all; overflow-wrap: anywhere; }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; margin: 12px 0; max-width: 100%; }
  td, th { border: 1px solid #d2d2d7; padding: 6px 10px; vertical-align: top; }
  h1, h2, h3 { line-height: 1.35; }
  p { margin: 0 0 8px; }
`;

function DocxPreview({ blob, title }: { blob: Blob; title: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const mammoth = (await import("mammoth")).default;
      const { value } = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
      return value;
    })()
      .then((value) => { if (alive) setHtml(value); })
      .catch(() => { if (alive) setError("워드 파일을 읽지 못했습니다. 받아서 열어 보세요."); });
    return () => { alive = false; };
  }, [blob]);

  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  // 스크립트가 없는 iframe(sandbox) 에 넣는다 — 문서 안 HTML 이 스크립트를 돌리지 못한다.
  // allow-same-origin 은 본문 높이를 재려고만 쓴다(스크립트가 없으니 iframe 쪽에서 이 페이지를 만질 수 없다).
  const fit = () => {
    // html 의 scrollHeight 는 칸 높이보다 작아지지 않으니 body 의 실제 높이를 잰다
    const body = frame.current?.contentDocument?.body;
    if (body) setHeight(Math.max(160, Math.min(Math.ceil(body.getBoundingClientRect().height) + 2, Math.round(window.innerHeight * 0.8))));
  };
  const doc = useMemo(() => html === null ? null : `<!doctype html><html><head><meta charset="utf-8"><style>${DOCX_STYLE}</style></head><body>${html || "<p>본문이 비어 있습니다.</p>"}</body></html>`, [html]);
  if (error) return <div className="mt-3"><InlineNotice tone="danger">{error}</InlineNotice></div>;
  if (!doc) return <div className="mt-3"><LoadingState label="문서를 그리는 중…" /></div>;
  return (
    <iframe
      ref={frame} srcDoc={doc} sandbox="allow-same-origin" title={`${title} 미리보기`} onLoad={fit}
      style={{ height: height ?? 420 }}
      className="mt-3 w-full rounded-nd-md border border-nd-line bg-white"
    />
  );
}

// ---- 한글(hwpx) · 파워포인트(pptx) — 글자만 -------------------

function ZipTextPreview({ blob, kind }: { blob: Blob; kind: "hwpx" | "pptx" }) {
  const [parts, setParts] = useState<{ label?: string; lines: string[] }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(await blob.arrayBuffer());
      const pattern = kind === "hwpx" ? /^Contents\/section(\d+)\.xml$/i : /^ppt\/slides\/slide(\d+)\.xml$/i;
      const paths = Object.keys(zip.files)
        .map((path) => ({ path, n: Number(pattern.exec(path)?.[1] ?? NaN) }))
        .filter((p) => Number.isFinite(p.n))
        .sort((a, b) => a.n - b.n);
      if (!paths.length) throw new Error("empty");
      const parser = new DOMParser();
      return Promise.all(paths.map(async ({ path, n }) => {
        const xml = parser.parseFromString(await zip.files[path].async("string"), "application/xml");
        // hwpx: 문단 hp:p 안의 hp:t · pptx: 문단 a:p 안의 a:t
        const paragraphs = Array.from(xml.getElementsByTagNameNS("*", "p"));
        const lines = paragraphs
          .filter((p) => !Array.from(p.getElementsByTagNameNS("*", "p")).length) // 안쪽 문단(표 칸)만 — 겹쳐 세지 않게
          .map((p) => Array.from(p.getElementsByTagNameNS("*", "t")).map((t) => t.textContent ?? "").join(""))
          .filter((line) => line.trim());
        return { label: kind === "pptx" ? `슬라이드 ${n}` : undefined, lines };
      }));
    })()
      .then((list) => { if (alive) setParts(list); })
      .catch(() => { if (alive) setError(kind === "hwpx" ? "한글 파일 본문을 찾지 못했습니다. 받아서 열어 보세요." : "파워포인트 파일을 읽지 못했습니다. 받아서 열어 보세요."); });
    return () => { alive = false; };
  }, [blob, kind]);

  if (error) return <InlineNotice tone="danger">{error}</InlineNotice>;
  if (!parts) return <LoadingState label="본문을 읽는 중…" />;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-nd-table text-nd-fg-3">{kind === "hwpx" ? "한글 파일은 글자만 보여 줍니다. 표·그림·서식은 받아서 확인하세요." : "슬라이드의 글자만 보여 줍니다. 그림·배치는 받아서 확인하세요."}</p>
      <div className="nd-scroll max-h-[70vh] overflow-y-auto rounded-nd-sm border border-nd-line bg-nd-content px-5 py-4">
        {parts.map((part, i) => (
          <section key={i} className={cn(i > 0 && part.label && "mt-5 border-t border-nd-line pt-4")}>
            {part.label && <h4 className="mb-2 text-nd-table font-semibold text-nd-fg-2">{part.label}</h4>}
            {part.lines.length ? part.lines.map((line, j) => (
              <p key={j} className="mb-1.5 whitespace-pre-wrap text-nd-body leading-relaxed text-nd-fg">{line}</p>
            )) : <p className="text-nd-table text-nd-fg-3">글자가 없습니다.</p>}
          </section>
        ))}
      </div>
    </div>
  );
}

// ---- 글자(txt) -----------------------------------------------

function TextPreview({ blob }: { blob: Blob }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void blob.arrayBuffer().then((buffer) => { if (alive) setText(decodeText(buffer)); });
    return () => { alive = false; };
  }, [blob]);
  if (text === null) return <LoadingState label="글자를 읽는 중…" />;
  return (
    <pre className="nd-scroll max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-nd-sm border border-nd-line bg-nd-content px-4 py-3 font-sans text-nd-body text-nd-fg">
      {text || "빈 파일입니다."}
    </pre>
  );
}
