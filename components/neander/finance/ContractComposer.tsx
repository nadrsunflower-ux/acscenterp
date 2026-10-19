"use client";

// ============================================================
//  계약서 만들기 — 종이와 비서를 나란히
// ------------------------------------------------------------
//  표준 양식으로 지은 계약서를 고치는 창이다. 왼쪽에 나가는 종이
//  (ContractSheet), 오른쪽에 그 종이를 두고 이야기하는 비서(ContractChat).
//
//  고치는 길이 둘이다. 종이 위에서 손으로 바로 고치거나, 비서에게 말로
//  시킨다. 둘 다 **같은 초안**을 고친다 — 비서는 질문을 받을 때마다 화면의
//  초안을 통째로 받아 읽으므로, 손으로 고친 것을 모른 채 옛 글을 고치자고
//  하지 않는다.
//
//  비서의 제안은 「적용」 을 눌러야 초안에 닿고, 초안은 「저장」 을 눌러야
//  남는다. 적용한 제안은 카드에서 되돌릴 수 있다. 되돌리기는 초안을 통째로
//  되감지 않고 그 제안이 건드린 곳만 되돌린다 — 그 사이 손으로 고친 다른
//  조항이 같이 사라지면 안 된다.
//
//  받은 계약서를 붙이기만 하는 창(ContractEditor)과는 따로다. 그쪽은 파일이
//  본체이고 여기는 글이 본체다. 다만 체결한 뒤 도장 찍힌 스캔본은 여기에도
//  붙여 둔다 — 종이 아래 파일 칸.
//
//  좁은 화면에서는 종이와 비서를 한 번에 하나씩 본다.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, FileUp, MessageSquareText, Printer, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  InlineNotice,
  SegmentedControl,
  Select,
  cn,
  useConfirm,
} from "@/components/neander/ui";
import { DocFilesField } from "@/components/neander/finance/DocFiles";
import { ContractSheet, changeTarget, printableContractHtml } from "@/components/neander/finance/ContractSheet";
import { ContractChat } from "@/components/neander/finance/ContractChat";
import { deleteFinDoc, saveFinDoc, uploadFinDocFiles } from "@/lib/neander/finance/client";
import {
  CONTRACT_STATUSES,
  CONTRACT_STATUS_LABEL,
  type ContractStatus,
  type FinDocFile,
} from "@/lib/neander/finance/docs";
import {
  CONTRACT_TEMPLATES,
  contractTemplate,
  ourParty,
  type ContractTemplateId,
} from "@/lib/neander/finance/contract-body";
import {
  applyContractChange,
  checkContract,
  contractFileStem,
  invertContractChange,
  syncCounterparty,
  type ContractChange,
  type ContractProposal,
  type FinContractDraft,
} from "@/lib/neander/finance/contract";
import { formalName } from "@/lib/neander/finance/contract-templates";
import { CUSTOM_PRESET, SUPPLIER_PRESETS, findPreset } from "@/lib/neander/finance/supplier";
import { CONTRACT_CSS, openContractPdf } from "@/lib/neander/finance/contract-pdf";
import { VAT_LABEL, type VatMode } from "@/lib/neander/finance/project";

/** 종이 위에 자리가 없는 값들 — 위 띠에 한 줄로 세운다 (견적서 편집창과 같다) */
function ToolbarField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1.5 text-nd-caption text-nd-fg-2">
      <span className="whitespace-nowrap">{label}</span>
      {children}
    </label>
  );
}

const digits = (s: string) => String(s ?? "").replace(/\D/g, "");

type Pane = "doc" | "chat";

export function ContractComposer({
  id: initialId,
  initial,
  initialFiles = [],
  onClose,
  onSaved,
  onDeleted,
  onApplyAmount,
}: {
  /** 저장된 문서면 id. 새 문서면 없음 */
  id?: string;
  initial: FinContractDraft;
  initialFiles?: FinDocFile[];
  onClose: () => void;
  onSaved: (id: string) => Promise<void>;
  onDeleted?: () => Promise<void>;
  /** 프로젝트 초안의 계약금액·부가세 기준에 이 값을 넣는다 */
  onApplyAmount?: (amount: number, vatMode: VatMode) => void;
}) {
  const confirm = useConfirm();
  const [docId, setDocId] = useState<string | undefined>(initialId);
  const [form, setForm] = useState<FinContractDraft>(initial);
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(initial));
  const [files, setFiles] = useState<FinDocFile[]>(initialFiles);
  const [pending, setPending] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>("doc");
  const [showIssues, setShowIssues] = useState(false);

  // 비서는 늘 「지금」 의 초안을 읽어야 한다 — 어댑터를 매 글자마다 새로 만들지 않도록 ref 로 건넨다
  const formRef = useRef(form);
  formRef.current = form;
  const getDraft = useCallback(() => formRef.current, []);

  const meta = contractTemplate(form.body.template);
  const dirty = JSON.stringify(form) !== savedSnapshot || pending.length > 0;
  const check = useMemo(() => checkContract(form), [form]);
  const us = ourParty(form.body);
  const presetId = SUPPLIER_PRESETS.find((p) => digits(p.supplier.bizNo) === digits(us.bizNo) && digits(us.bizNo))?.id ?? CUSTOM_PRESET;

  /** 사업자를 바꾸면 우리 쪽 서명란 네 칸과 도장이 함께 갈린다 (견적서와 같은 이유) */
  const applyPreset = (id: string) => {
    const p = findPreset(id);
    if (!p) return;
    const party = { name: formalName(p.supplier.name), bizNo: p.supplier.bizNo, address: p.supplier.address, ceo: p.supplier.ceo };
    setForm((f) =>
      syncCounterparty({
        ...f,
        body: { ...f.body, ...(f.body.ourSide === "a" ? { partyA: party } : { partyB: party }), sealId: p.sealId },
      }),
    );
  };

  // ---- 방금 바뀐 자리 ----
  const scrollRef = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState<{ part: string; n: number } | null>(null);
  const locate = useCallback((part: string | null) => {
    if (!part) return;
    setFlash((f) => ({ part, n: (f?.n ?? 0) + 1 }));
  }, []);
  useEffect(() => {
    if (!flash) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-part="${CSS.escape(flash.part)}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    const t = window.setTimeout(() => setFlash(null), 2200);
    return () => window.clearTimeout(t);
  }, [flash]);

  // ---- 비서의 제안 ----
  /** 제안 id → 그 제안을 되돌리는 변경 (적용하는 순간의 초안으로 만든다) */
  const inverses = useRef(new Map<string, ContractChange>());
  const [reverted, setReverted] = useState<Set<string>>(() => new Set());

  const applyProposal = useCallback(
    (p: ContractProposal) => {
      const cur = formRef.current;
      const back = invertContractChange(cur, p.change);
      if (back) inverses.current.set(p.id, back);
      else inverses.current.delete(p.id);
      const next = applyContractChange(cur, p.change);
      formRef.current = next;
      setForm(next);
      setReverted((prev) => {
        if (!prev.has(p.id)) return prev;
        const n = new Set(prev);
        n.delete(p.id);
        return n;
      });
      setOkMsg(null);
      locate(changeTarget(p.change));
    },
    [locate],
  );

  const revertProposal = useCallback(
    (p: ContractProposal): boolean => {
      const back = inverses.current.get(p.id);
      if (!back) {
        setError(`「${p.label}」 은 되돌릴 수 없습니다 — 그 조항이 이미 없습니다. 종이에서 직접 고쳐 주세요.`);
        return false;
      }
      const next = applyContractChange(formRef.current, back);
      formRef.current = next;
      setForm(next);
      setReverted((prev) => new Set(prev).add(p.id));
      locate(changeTarget(back));
      return true;
    },
    [locate],
  );

  /** 카드의 「종이에서 보기」 — 적용 전이면 바뀔 자리를, 적용 뒤면 바뀐 자리를 짚는다 */
  const locateProposal = useCallback(
    (p: ContractProposal, applied: boolean) => {
      const c = p.change;
      const part =
        c.kind === "clause.remove" ? c.clauseId : c.kind === "clause.add" && !applied ? c.afterId : changeTarget(c);
      setPane("doc");
      locate(part);
    },
    [locate],
  );

  // ---- 닫기 · 저장 · 삭제 ----
  const close = async () => {
    if (
      dirty &&
      !(await confirm({
        title: "저장하지 않은 변경이 있습니다",
        message: "닫으면 고친 내용이 사라집니다. 닫을까요?",
        confirmLabel: "닫기",
        tone: "danger",
      }))
    )
      return;
    onClose();
  };

  const save = async () => {
    if (!form.title.trim()) {
      setError("계약명이 비어 있습니다 — 「계약의 개요」 의 계약명을 적어 주세요.");
      return;
    }
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await saveFinDoc(form, docId);
      setDocId(res.id);
      setSavedSnapshot(JSON.stringify(form));
      let uploadError: string | null = null;
      if (pending.length > 0) {
        try {
          const next = await uploadFinDocFiles(res.id, pending);
          setFiles(next);
          setPending([]);
        } catch (e) {
          uploadError = e instanceof Error ? e.message : "파일을 올리지 못했습니다.";
        }
      }
      await onSaved(res.id);
      if (uploadError) setError(`계약서는 저장했습니다. 파일만 올리지 못했습니다 — ${uploadError}`);
      else setOkMsg("저장했습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!docId || !onDeleted) return;
    const ok = await confirm({
      title: `계약서 「${form.title}」 를 지울까요?`,
      message: files.length > 0 ? `붙은 파일 ${files.length}개도 함께 사라집니다.` : "지운 계약서는 되살릴 수 없습니다.",
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (!ok) return;
    setSaving(true);
    try {
      await deleteFinDoc(docId);
      await onDeleted();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제에 실패했습니다.");
      setSaving(false);
    }
  };

  /** 아직 채우지 않은 곳 — 위 띠의 「채울 곳」 과 뽑기 전 확인창이 같은 목록을 쓴다 */
  const issueNotes = useMemo(() => {
    const notes: string[] = [];
    if (check.blanks > 0) notes.push(`본문에 빈칸(____)이 ${check.blanks}곳 남아 있습니다.`);
    if (check.missing.length > 0) notes.push(`비어 있는 칸 — ${check.missing.join(" · ")}`);
    check.dangling.forEach((d) => notes.push(`${d.clause} 가 없는 ${d.ref} 를 가리킵니다.`));
    return notes;
  }, [check]);

  /** 뽑기 전에 남은 빈칸을 알린다. 막지는 않는다 — 상대에게 보내며 비워 두는 자리도 있다 */
  const exportGuard = async () =>
    issueNotes.length === 0 ||
    confirm({
      title: "아직 채우지 않은 곳이 있습니다",
      message: (
        <>
          <ul className="list-disc space-y-1 pl-5">
            {issueNotes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <p className="mt-3">그대로 뽑을까요?</p>
        </>
      ),
      confirmLabel: "그대로 뽑기",
    });
  const print = async () => {
    if (!(await exportGuard())) return;
    if (!openContractPdf(printableContractHtml(form), contractFileStem(form)))
      setError("팝업이 차단되어 인쇄창을 열지 못했습니다. 이 사이트의 팝업을 허용해 주세요.");
  };

  const issues = check.blanks + check.missing.length + check.dangling.length;
  const showingIssues = showIssues && issues > 0;
  const paysUs = form.body.template === "service" || form.body.template === "supply";

  return (
    <Dialog
      open
      onClose={() => void close()}
      size="full"
      closeOnOverlay={false}
      title={docId ? "계약서" : "새 계약서"}
      // 종이(860) + 비서 한 칸이면 충분하다 — 아주 넓은 모니터에서 양옆이 휑하지 않게 묶는다
      className="h-[92vh] sm:h-[88vh] min-[1680px]:max-w-[1600px]"
      bodyClassName="flex min-h-0 flex-col !overflow-hidden !pb-4"
      footer={
        <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {docId && onDeleted && (
              <Button variant="danger" size="sm" icon={Trash2} onClick={remove} disabled={saving}>
                삭제
              </Button>
            )}
            {onApplyAmount && paysUs && (
              <Button
                variant="secondary"
                size="sm"
                disabled={saving || form.amount === 0}
                onClick={() => {
                  onApplyAmount(form.amount, form.vatMode);
                  setOkMsg(`프로젝트 계약금액 칸에 ${form.amount.toLocaleString("ko-KR")} (${VAT_LABEL[form.vatMode]}) 을 넣었습니다. 프로젝트 화면에서 「저장」 해야 남습니다.`);
                }}
                title="프로젝트 수입 칸의 계약금액·부가세 기준에 이 값을 넣습니다 (프로젝트 저장은 따로)"
              >
                계약금액으로 반영
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {(dirty || !docId) && <span className="text-nd-caption text-nd-warning-text">저장 안 됨</span>}
            <Button variant="ghost" onClick={() => void close()} disabled={saving}>
              닫기
            </Button>
            {/* 새로 지은 계약서는 손대지 않아도 저장할 수 있다 — 양식 그대로가 이미 초안이다 */}
            <Button onClick={save} disabled={!dirty && !!docId} loading={saving}>
              저장
            </Button>
          </div>
        </div>
      }
    >
      {/* 좁은 화면 — 종이와 비서를 한 번에 하나씩 */}
      <div className="mb-3 lg:hidden">
        <SegmentedControl<Pane>
          ariaLabel="보기"
          fill
          value={pane}
          onChange={setPane}
          options={[
            { value: "doc", label: "계약서", icon: FileText },
            { value: "chat", label: "비서와 고치기", icon: MessageSquareText },
          ]}
        />
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        {/* ---- 종이 ---- */}
        <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", pane === "chat" && "max-lg:hidden")}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span title={`바탕 — ${meta.basis}`}>
                <Badge tone="accent">{meta.label}</Badge>
              </span>
              <ToolbarField label="우리 쪽">
                <Select
                  size="sm"
                  className="w-auto"
                  value={presetId}
                  onChange={(e) => applyPreset(e.target.value)}
                  title={`우리는 “${form.body.ourSide === "a" ? "갑" : "을"}” 입니다. 고르면 우리 쪽 서명란과 도장이 함께 채워집니다`}
                >
                  {SUPPLIER_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                  {presetId === CUSTOM_PRESET && <option value={CUSTOM_PRESET}>직접 입력</option>}
                </Select>
              </ToolbarField>
              <ToolbarField label="상태">
                <Select size="sm" className="w-auto" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as ContractStatus }))}>
                  {CONTRACT_STATUSES.map((s) => (
                    <option key={s} value={s}>{CONTRACT_STATUS_LABEL[s]}</option>
                  ))}
                </Select>
              </ToolbarField>
              {issues > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowIssues((v) => !v)}
                  aria-expanded={showingIssues}
                  className="rounded-full transition-opacity duration-nd-fast hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-nd-accent"
                  title="아직 채우지 않은 곳을 봅니다"
                >
                  <Badge tone="warning" dot>
                    채울 곳 {issues} {showingIssues ? "▴" : "▾"}
                  </Badge>
                </button>
              ) : (
                <Badge tone="success" dot>
                  빈칸 없음
                </Badge>
              )}
            </div>
            <Button variant="secondary" size="sm" icon={Printer} onClick={() => void print()} disabled={saving} title="인쇄창을 엽니다 — 대상에서 「PDF로 저장」">
              인쇄 / PDF
            </Button>
          </div>

          {(error || okMsg) && (
            <InlineNotice tone={error ? "danger" : "success"} className="mb-3">
              {error ?? okMsg}
            </InlineNotice>
          )}
          {showingIssues ? (
            <InlineNotice tone="warning" className="mb-3">
              <ul className="list-disc space-y-0.5 pl-4">
                {issueNotes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </InlineNotice>
          ) : (
            // 번호가 밀린 것은 접어 두지 않는다 — 틀린 조를 가리키는 계약서는 그대로 나가면 안 된다
            check.dangling.length > 0 && (
              <InlineNotice tone="warning" className="mb-3">
                {check.dangling.map((d) => `${d.clause} 가 없는 ${d.ref} 를 가리킵니다`).join(" · ")} — 조항을 빼거나 옮기면서 번호가 밀렸습니다.
              </InlineNotice>
            )
          )}

          <style>{CONTRACT_CSS}</style>
          <div ref={scrollRef} className="nd-scroll min-h-0 flex-1 overflow-auto rounded-nd-lg bg-nd-sunken p-3 sm:p-5">
            <div className="mx-auto min-w-[640px] max-w-[860px] rounded-lg border border-nd-line bg-white px-7 py-8 shadow-sm sm:px-11 sm:py-10">
              <ContractSheet
                value={form}
                onChange={(next) => {
                  setForm(next);
                  setOkMsg(null);
                }}
                flash={flash?.part}
                confirmRemove={(label) =>
                  confirm({
                    title: `${label} 를 뺄까요?`,
                    message: "뒤 조항의 번호가 하나씩 당겨집니다.",
                    confirmLabel: "빼기",
                    tone: "danger",
                  })
                }
              />
            </div>

            <div className="mx-auto mt-5 flex min-w-[640px] max-w-[860px] flex-col gap-1.5">
              <span className="text-nd-caption font-medium text-nd-fg-2">
                파일 <span className="ml-1 font-normal text-nd-fg-3">체결한 뒤 도장 찍힌 스캔본, 상대가 되보낸 수정본</span>
              </span>
              <DocFilesField docId={docId} files={files} onFilesChange={setFiles} pending={pending} onPendingChange={setPending} disabled={saving} onError={setError} />
            </div>
          </div>
        </div>

        {/* ---- 비서 ---- */}
        <aside
          className={cn(
            "flex min-h-0 w-full flex-col overflow-hidden rounded-nd-lg border border-nd-line lg:w-[clamp(380px,34%,580px)] lg:shrink-0",
            pane === "doc" && "max-lg:hidden",
          )}
        >
          <ContractChat
            template={form.body.template}
            getDraft={getDraft}
            docId={docId}
            reverted={reverted}
            onApply={applyProposal}
            onRevert={revertProposal}
            onLocate={locateProposal}
          />
        </aside>
      </div>
    </Dialog>
  );
}

// ---- 양식 고르기 --------------------------------------------------

/**
 * 「새 계약서」 를 누르면 먼저 고른다 — 표준 양식 넷 중 하나로 우리 초안을
 * 짓거나, 상대가 보내온 계약서를 붙이거나. 양식마다 우리가 어느 쪽인지,
 * 어느 옛 계약서에서 왔는지를 같이 보여 준다 — 「용역」 과 「제작 위탁」 은
 * 이름이 비슷해도 돈이 흐르는 방향이 반대다.
 */
export function ContractTemplatePicker({
  onPick,
  onRegister,
  onClose,
}: {
  onPick: (id: ContractTemplateId) => void;
  /** 받은 계약서 — 본문을 짓지 않고 파일과 요약만 남긴다 (ContractEditor) */
  onRegister?: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="어떤 계약서를 만들까요?"
      description="프로젝트의 상대방 · 금액 · 기간 · 입금 일정과 최근 견적서 품목을 채워서 엽니다. 연 뒤에는 종이 위에서 고치거나 비서에게 말로 시킬 수 있습니다."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {CONTRACT_TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onPick(t.id)}
            className="flex flex-col items-start gap-1.5 rounded-nd-lg border border-nd-line bg-nd-content p-4 text-left transition-colors duration-nd-fast hover:border-nd-accent/60 hover:bg-nd-accent-soft/40 focus-visible:border-nd-accent focus-visible:outline-none"
          >
            <span className="flex w-full items-center justify-between gap-2">
              <span className="text-nd-section text-nd-fg">{t.label}</span>
              <Badge tone={t.ourSide === "a" ? "info" : "accent"} size="sm">
                우리는 “{t.ourSide === "a" ? "갑" : "을"}” · {t.ourSide === "a" ? t.roleA : t.roleB}
              </Badge>
            </span>
            <span className="text-nd-body leading-relaxed text-nd-fg-2">{t.hint}</span>
            <span className="text-nd-caption leading-relaxed text-nd-fg-3">바탕 — {t.basis}</span>
          </button>
        ))}
      </div>
      <p className="mt-4 text-nd-caption leading-relaxed text-nd-fg-3">
        우리가 먼저 내밀 초안입니다. 옛 계약서에서 우리에게 불리했던 자리(지체상금 상한 · 해지 조건 · 권리 귀속 · 관할)를 고쳐 담았습니다.
        법률 자문을 거친 글은 아니니, 금액이 크거나 낯선 조건이 붙는 계약은 전문가에게 보이세요.
      </p>
      {onRegister && (
        <button
          type="button"
          onClick={onRegister}
          className="mt-4 flex w-full items-center gap-3 rounded-nd-lg border border-dashed border-nd-border px-4 py-3 text-left transition-colors duration-nd-fast hover:border-nd-accent/60 hover:bg-nd-sunken focus-visible:border-nd-accent focus-visible:outline-none"
        >
          <FileUp size={18} strokeWidth={1.75} className="shrink-0 text-nd-fg-3" aria-hidden />
          <span className="min-w-0">
            <span className="block text-nd-body font-medium text-nd-fg">받은 계약서 붙이기</span>
            <span className="block text-nd-table leading-relaxed text-nd-fg-2">
              상대가 자기 양식으로 보내온 계약서는 본문을 짓지 않고, 파일을 붙인 뒤 금액 · 기간 · 상태만 요약해 둡니다.
            </span>
          </span>
        </button>
      )}
    </Dialog>
  );
}
