"use client";

// ============================================================
//  프로젝트 문서 — 견적서 · 계약서 칸
// ------------------------------------------------------------
//  프로젝트 상세 화면의 한 구역. 왼쪽에 견적서, 오른쪽에 계약서를 두고
//  각각 목록과 「새로」 버튼을 둔다. 줄을 누르면 편집창이 열리고, 파일
//  칩을 누르면 파일이 새 창에 열린다.
//
//  문서 저장은 프로젝트의 「저장」 과 **따로** 간다. 문서는 편집창 안에서
//  바로 서버에 쓴다 — 프로젝트 초안(체크리스트)에 묶어 두면 견적서 하나
//  고치려고 체크리스트까지 통째로 다시 저장하게 되고, 반대로 체크리스트를
//  「변경 취소」 하면 견적서까지 되돌아가는 꼴이 된다.
//
//  예외가 「계약금액으로 반영」 이다. 견적 총액이나 계약금액을 프로젝트
//  수입 칸에 넣는 건 프로젝트 초안을 고치는 일이라, 그쪽 「저장」 을 거친다.
// ============================================================

import { useMemo, useState } from "react";
import { Badge, Card } from "@/components/neander/ui";
import { Money, SectionTitle } from "@/components/neander/finance/ui";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { FileChip } from "@/components/neander/finance/DocFiles";
import { QuoteEditor } from "@/components/neander/finance/QuoteEditor";
import { ContractEditor } from "@/components/neander/finance/ContractEditor";
import { openQuotePdf } from "@/lib/neander/finance/quote-pdf";
import {
  CONTRACT_STATUS_COLOR,
  CONTRACT_STATUS_LABEL,
  QUOTE_STATUS_COLOR,
  QUOTE_STATUS_LABEL,
  QUOTE_VAT_LABEL,
  docsOfProject,
  emptyContract,
  emptyQuote,
  formatQuoteNo,
  isContract,
  isQuote,
  quoteTotals,
  type FinContractDoc,
  type FinContractInput,
  type FinQuoteDoc,
  type FinQuoteInput,
} from "@/lib/neander/finance/docs";
import { VAT_LABEL, splitVat, type FinProjectDoc, type VatMode } from "@/lib/neander/finance/project";

type Open =
  | { kind: "quote"; id?: string; initial: FinQuoteInput; files: FinQuoteDoc["files"] }
  | { kind: "contract"; id?: string; initial: FinContractInput; files: FinContractDoc["files"] }
  | null;

/** 저장된 문서에서 편집 가능한 부분만 뗀다 (id·시각·파일은 따로 다룬다) */
function quoteInput(d: FinQuoteDoc): FinQuoteInput {
  const { id: _id, createdAt: _c, createdBy: _cb, updatedAt: _u, updatedBy: _ub, files: _f, ...rest } = d;
  return { ...rest, lines: rest.lines.map((l) => ({ ...l })), supplier: { ...rest.supplier } };
}
function contractInput(d: FinContractDoc): FinContractInput {
  const { id: _id, createdAt: _c, createdBy: _cb, updatedAt: _u, updatedBy: _ub, files: _f, ...rest } = d;
  return { ...rest };
}

export function ProjectDocs({
  project,
  onApplyAmount,
  onNotice,
}: {
  project: FinProjectDoc;
  /** 프로젝트 초안의 계약금액·부가세 기준을 바꾼다 */
  onApplyAmount?: (amount: number, vatMode: VatMode) => void;
  onNotice?: (n: { kind: "ok" | "error"; text: string }) => void;
}) {
  const { docs, refresh } = useFinance();
  const [open, setOpen] = useState<Open>(null);

  const quotes = useMemo(() => docsOfProject(docs, project.id, "quote").filter(isQuote), [docs, project.id]);
  const contracts = useMemo(() => docsOfProject(docs, project.id, "contract").filter(isContract), [docs, project.id]);

  const newQuote = () =>
    setOpen({
      kind: "quote",
      initial: emptyQuote(project.id, { title: `${project.name}의 건`, recipient: project.client ?? "", existing: docs }),
      files: [],
    });
  const newContract = () =>
    setOpen({
      kind: "contract",
      initial: emptyContract(project.id, {
        title: project.name,
        counterparty: project.client ?? "",
        amount: project.contractAmount ?? 0,
        vatMode: project.vatMode ?? "included",
        startDate: project.startDate,
        endDate: project.endDate,
      }),
      files: [],
    });

  const printQuote = (q: FinQuoteDoc) => {
    if (!openQuotePdf(q)) onNotice?.({ kind: "error", text: "팝업이 차단되어 인쇄창을 열지 못했습니다. 이 사이트의 팝업을 허용해 주세요." });
  };

  const after = async () => {
    await refresh();
  };

  return (
    <>
      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        {/* ---- 견적서 ---- */}
        <Card className="p-4">
          <SectionTitle
            hint="만들어 인쇄·PDF·엑셀로 보내거나, 받은 파일을 붙여 둡니다"
            action={
              <button type="button" onClick={newQuote} className="text-xs text-indigo-600 hover:underline">
                + 새 견적서
              </button>
            }
          >
            견적서 <span className="ml-1 font-normal text-zinc-400">{quotes.length}</span>
          </SectionTitle>
          {quotes.length === 0 ? (
            <p className="py-4 text-center text-xs text-zinc-400">아직 견적서가 없습니다. 「새 견적서」 로 시작하세요.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {quotes.map((q) => {
                const t = quoteTotals(q);
                return (
                  <li key={q.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setOpen({ kind: "quote", id: q.id, initial: quoteInput(q), files: q.files ?? [] })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") setOpen({ kind: "quote", id: q.id, initial: quoteInput(q), files: q.files ?? [] });
                      }}
                      className="-mx-2 cursor-pointer rounded-lg px-2 py-2 hover:bg-indigo-50/40 focus:bg-indigo-50 focus:outline-none"
                      title="눌러서 엽니다"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-zinc-800">{q.title || <span className="text-zinc-400">(견적명 없음)</span>}</p>
                          <p className="mt-0.5 text-xs text-zinc-500">
                            {formatQuoteNo(q.quoteNo) || "번호 없음"} · {q.date} · {q.recipient || "수신 없음"}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-semibold"><Money value={t.total} unit={false} /></p>
                          <p className="text-[11px] text-zinc-400">{QUOTE_VAT_LABEL[q.vatMode]} · {q.lines.length}품목</p>
                        </div>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge color={QUOTE_STATUS_COLOR[q.status]}>{QUOTE_STATUS_LABEL[q.status]}</Badge>
                        {(q.files ?? []).map((f) => (
                          <FileChip key={f.path} file={f} />
                        ))}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            printQuote(q);
                          }}
                          className="ml-auto rounded border border-zinc-200 px-1.5 py-0.5 text-[11px] text-zinc-600 hover:border-indigo-300 hover:text-indigo-700"
                          title="인쇄창을 엽니다 — 대상에서 「PDF로 저장」"
                        >
                          인쇄 / PDF
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* ---- 계약서 ---- */}
        <Card className="p-4">
          <SectionTitle
            hint="도장 찍힌 PDF 를 붙이고 금액·기간·상태를 요약해 둡니다"
            action={
              <button type="button" onClick={newContract} className="text-xs text-indigo-600 hover:underline">
                + 계약서 등록
              </button>
            }
          >
            계약서 <span className="ml-1 font-normal text-zinc-400">{contracts.length}</span>
          </SectionTitle>
          {contracts.length === 0 ? (
            <p className="py-4 text-center text-xs text-zinc-400">아직 계약서가 없습니다. 「계약서 등록」 으로 파일을 붙이세요.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {contracts.map((c) => {
                const split = splitVat(c.amount, c.vatMode);
                const period = c.startDate || c.endDate ? `${c.startDate ?? "?"} ~ ${c.endDate ?? "?"}` : null;
                return (
                  <li key={c.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setOpen({ kind: "contract", id: c.id, initial: contractInput(c), files: c.files ?? [] })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") setOpen({ kind: "contract", id: c.id, initial: contractInput(c), files: c.files ?? [] });
                      }}
                      className="-mx-2 cursor-pointer rounded-lg px-2 py-2 hover:bg-indigo-50/40 focus:bg-indigo-50 focus:outline-none"
                      title="눌러서 엽니다"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-zinc-800">{c.title}</p>
                          <p className="mt-0.5 text-xs text-zinc-500">
                            {c.counterparty || "상대방 없음"}
                            {period ? ` · ${period}` : ""}
                            {c.signedDate ? ` · 체결 ${c.signedDate}` : ""}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-semibold"><Money value={c.amount} unit={false} /></p>
                          <p className="text-[11px] text-zinc-400">
                            {VAT_LABEL[c.vatMode]}
                            {c.vatMode !== "exempt" ? ` · 공급가액 ${split.supply.toLocaleString("ko-KR")}` : ""}
                          </p>
                        </div>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge color={CONTRACT_STATUS_COLOR[c.status]}>{CONTRACT_STATUS_LABEL[c.status]}</Badge>
                        {(c.files ?? []).length === 0 ? (
                          <span className="text-[11px] text-amber-700">파일 없음 — 계약서 원본을 붙여 두세요</span>
                        ) : (
                          (c.files ?? []).map((f) => <FileChip key={f.path} file={f} />)
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {open?.kind === "quote" && (
        <QuoteEditor
          key={open.id ?? "new-quote"}
          id={open.id}
          initial={open.initial}
          initialFiles={open.files}
          onClose={() => setOpen(null)}
          onSaved={after}
          onDeleted={after}
          onApplyAmount={onApplyAmount}
        />
      )}
      {open?.kind === "contract" && (
        <ContractEditor
          key={open.id ?? "new-contract"}
          id={open.id}
          initial={open.initial}
          initialFiles={open.files}
          onClose={() => setOpen(null)}
          onSaved={after}
          onDeleted={after}
          onApplyAmount={onApplyAmount}
        />
      )}
    </>
  );
}
