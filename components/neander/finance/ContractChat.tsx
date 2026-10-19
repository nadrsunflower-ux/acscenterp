"use client";

// ============================================================
//  계약서 비서 — 공용 비서 패널의 어댑터 한 벌
// ------------------------------------------------------------
//  계약서 편집창 오른쪽에 붙어, 열려 있는 그 계약서를 두고 이야기한다.
//  「지체상금 상한을 5%로」, 「선금 30% · 중도금 30% · 잔금 40%로」,
//  「상대가 보낸 수정본을 붙였어, 뭐가 달라졌어」.
//
//  패널 자체(대화 · 첨부 · 모델 고르기 · 지난 대화)는 재무·매출 비서와 같은
//  AssistantChat 이다 — embedded 로 편집창 안의 자리를 채운다. 여기 남는
//  것은 계약서에만 있는 것뿐이다: 무엇을 물을 수 있는지, 제안을 어떻게
//  보여 주는지, 적용하면 어디에 닿는지.
//
//  ⚠️ 비서는 계약서를 바꾸지 못한다. 제안은 카드로 오고, 카드는 **전/후**를
//     보여 준다 — 조항의 글이면 바뀐 낱말에 줄을 긋고 칠해서. 사람이 「적용」
//     을 눌러야 화면의 초안에 닿고, 초안은 편집창의 「저장」 을 눌러야 남는다.
//     적용한 제안은 카드에서 되돌릴 수 있다 — 그 제안이 건드린 곳만 되돌린다.
// ============================================================

import { useMemo, type ReactNode } from "react";
import { Badge, Button, cn } from "@/components/neander/ui";
import { AssistantChat, proposalLook, type AssistantAdapter } from "@/components/neander/assistant/AssistantChat";
import { CONTRACT_AI_MODEL } from "@/lib/neander/ai/models";
import {
  deleteContractChat,
  fetchContractChat,
  fetchContractChatList,
  sendContractChat,
} from "@/lib/neander/finance/client";
import type { ContractProposal, FinContractDraft } from "@/lib/neander/finance/contract";
import type { ContractTemplateId } from "@/lib/neander/finance/contract-body";
import { diffWords } from "@/lib/neander/finance/text-diff";

const REVIEW = "이 계약서에서 우리한테 불리하거나 빠진 조항이 있는지 봐줘";

/** 양식마다 돈이 흐르는 방향이 달라, 물어볼 만한 것도 다르다 */
const EXAMPLES: Record<ContractTemplateId, string[]> = {
  service: [
    REVIEW,
    "선금 30% · 중도금 30% · 잔금 40%로 바꿔줘",
    "지체상금 상한을 계약금액의 5%로 낮춰줘",
    "행사 배상책임보험은 발주자가 가입한다는 조항을 넣어줘",
  ],
  supply: [
    REVIEW,
    "선금 50%를 받은 뒤에 제작을 시작한다고 분명히 적어줘",
    "수량을 바꾸면 단가를 다시 협의한다는 내용을 넣어줘",
    "납품 뒤 하자 통지 기간을 14일로 줄여줘",
  ],
  outsource: [
    REVIEW,
    "잔금은 검수 합격 후 30일 이내에 준다로 바꿔줘",
    "품질보증 기간을 1년으로 늘려줘",
    "샘플 승인 없이 본 생산에 들어가면 안 된다는 조항을 넣어줘",
  ],
  collab: [
    REVIEW,
    "로열티율을 9%로 하고, 1,000개를 넘으면 11%로 올리는 구간을 넣어줘",
    "홍보 게시를 안 한 달은 로열티율을 3%p 낮춘다로 채워줘",
    "계약이 끝난 뒤 재고 판매 기간을 1년으로 늘려줘",
  ],
};

export function ContractChat({
  template,
  getDraft,
  docId,
  reverted,
  onApply,
  onRevert,
  onLocate,
  className,
}: {
  /** 어느 양식인가 — 예시 질문이 달라진다 */
  template: ContractTemplateId;
  /** 화면의 지금 초안 — 질문과 함께 통째로 보낸다 */
  getDraft: () => FinContractDraft;
  /** 저장된 계약서면 그 문서 id. 대화가 이 계약서에 묶인다 */
  docId?: string;
  /** 적용했다가 되돌린 제안들 */
  reverted: Set<string>;
  onApply: (p: ContractProposal) => void;
  /** 되돌릴 수 없으면(가리키던 조항이 사라짐) false */
  onRevert: (p: ContractProposal) => boolean;
  /** 이 제안이 건드리는 자리를 종이에서 보여 준다 */
  onLocate: (p: ContractProposal, applied: boolean) => void;
  className?: string;
}) {
  const adapter = useMemo<AssistantAdapter<ContractProposal>>(
    () => ({
      name: "계약서 비서",
      subtitle: "이 계약서를 읽고 고칠 것을 제안합니다 · 적용은 승인 후에만",
      storagePrefix: "neander.finance.contract-chat",
      defaultModel: CONTRACT_AI_MODEL,
      intro: (
        <>
          열어 둔 계약서를 두고 말로 고칩니다. 조항을 바꾸거나 끼워 넣고, 금액·기간·상대방 칸을 채우고, 상대가 보낸
          계약서(PDF · Word · 한글 hwpx)를 붙여 우리 초안과 견줘 볼 수 있습니다.
          <b className="text-nd-fg"> 제안은 「적용」 을 눌러야 종이에 반영되고, 종이는 「저장」 을 눌러야 남습니다.</b>{" "}
          법률 자문은 아닙니다 — 금액이 크거나 낯선 조건이면 전문가에게 보이세요.
        </>
      ),
      examples: EXAMPLES[template],
      inputPlaceholder: "이 계약서를 어떻게 고칠지 말해 주세요 (Enter 전송 · Shift+Enter 줄바꿈)",
      busyLabel: "계약서를 읽고 있습니다…",
      // 이 비서의 도구는 조회가 아니라 전부 제안이다
      traceLabel: (n) => `제안 시도 ${n}건 — 무엇을 하려 했는지 보기`,

      send: (messages, model, files, conversationId) =>
        sendContractChat(messages, getDraft(), { model, files, conversationId, docId }),
      // 아직 저장한 적 없는 계약서는 대화를 묶을 문서가 없다 — 「지난 대화」 단추를 감춘다
      ...(docId
        ? { listChats: () => fetchContractChatList(docId), loadChat: fetchContractChat, deleteChat: deleteContractChat }
        : {}),

      apply: async (p) => onApply(p),
      proposalKey: (p) => p.id,
      renderProposal: ({ proposal, applied, dismissed, busy, onApply: apply, onDismiss }) => (
        <ProposalCard
          proposal={proposal}
          // 되돌린 제안은 다시 「아직 안 누름」 으로 돌아간다 — 다시 적용할 수 있다
          applied={applied && !reverted.has(proposal.id)}
          dismissed={dismissed}
          busy={busy}
          onApply={apply}
          onDismiss={onDismiss}
          onRevert={() => onRevert(proposal)}
          onLocate={(isApplied) => onLocate(proposal, isApplied)}
        />
      ),
    }),
    [template, getDraft, docId, reverted, onApply, onRevert, onLocate],
  );

  return <AssistantChat adapter={adapter} embedded className={className} />;
}

// ---- 제안 카드 ----------------------------------------------------

/** 바뀐 낱말에 줄을 긋고 칠한다 — 조항 두 벌을 눈으로 대조하지 않게 */
function TextDiff({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => diffWords(before, after), [before, after]);
  return (
    <p className="whitespace-pre-wrap break-keep text-nd-table leading-relaxed text-nd-fg">
      {parts.map((p, i) =>
        p.op === "same" ? (
          <span key={i}>{p.text}</span>
        ) : p.op === "del" ? (
          <del key={i} className="rounded-[3px] bg-nd-danger-soft text-nd-danger-text decoration-nd-danger-text/60">
            {p.text}
          </del>
        ) : (
          <ins key={i} className="rounded-[3px] bg-nd-success-soft font-medium text-nd-success-text no-underline">
            {p.text}
          </ins>
        ),
      )}
    </p>
  );
}

function Box({ ring, children, label }: { ring: string; children: ReactNode; label?: string }) {
  return (
    <div className={cn("nd-scroll mt-2 max-h-[340px] overflow-y-auto rounded-nd-md bg-nd-content px-3 py-2 ring-1", ring)}>
      {label && <p className="mb-1 text-nd-caption font-medium text-nd-fg-3">{label}</p>}
      {children}
    </div>
  );
}

function ProposalCard({
  proposal: p,
  applied,
  dismissed,
  busy,
  onApply,
  onDismiss,
  onRevert,
  onLocate,
}: {
  proposal: ContractProposal;
  applied: boolean;
  dismissed: boolean;
  busy: boolean;
  onApply: () => void;
  onDismiss: () => void;
  onRevert: () => boolean;
  onLocate: (applied: boolean) => void;
}) {
  const look = proposalLook(applied, dismissed);
  const c = p.change;
  const removes = c.kind === "clause.remove";

  return (
    <div className={cn("rounded-nd-lg border p-3 transition-colors duration-nd", look.card)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 text-nd-body font-semibold text-nd-fg">
          <Badge tone={applied || dismissed ? look.badge : removes ? "danger" : look.badge} size="sm" className="mr-1.5 align-middle">
            제안
          </Badge>
          {p.label}
        </p>
        {applied ? (
          <div className="flex items-center gap-1">
            <Badge tone="success">적용됨</Badge>
            <Button variant="ghost" size="sm" onClick={() => onRevert()} disabled={busy} title="이 제안이 바꾼 곳만 원래대로 돌립니다">
              되돌리기
            </Button>
          </div>
        ) : dismissed ? (
          <Badge>무시함</Badge>
        ) : (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={onDismiss} disabled={busy}>
              무시
            </Button>
            <Button size="sm" variant={removes ? "danger" : "primary"} onClick={onApply} disabled={busy}>
              적용
            </Button>
          </div>
        )}
      </div>

      {p.reason && <p className="mt-1 text-nd-table leading-relaxed text-nd-fg-2">{p.reason}</p>}

      {c.kind === "clause.edit" && (
        <Box ring={look.ring}>
          {p.before?.title !== undefined && p.before.title !== c.title && (
            <p className="mb-1.5 text-nd-table text-nd-fg-2">
              제목 <del className="text-nd-danger-text">{p.before.title || "(없음)"}</del> →{" "}
              <b className="font-medium text-nd-success-text">{c.title}</b>
            </p>
          )}
          <TextDiff before={p.before?.text ?? ""} after={c.text} />
        </Box>
      )}
      {c.kind === "clause.add" && (
        <Box ring={look.ring} label="새 조항">
          <p className="whitespace-pre-wrap break-keep text-nd-table leading-relaxed text-nd-fg">{c.clause.text}</p>
        </Box>
      )}
      {c.kind === "clause.remove" && (
        <Box ring={look.ring} label="빠지는 조항">
          <p className="whitespace-pre-wrap break-keep text-nd-table leading-relaxed text-nd-fg-2 line-through decoration-nd-danger-text/50">
            {p.before?.text ?? ""}
          </p>
        </Box>
      )}
      {c.kind === "text" && (
        <Box ring={look.ring}>
          <TextDiff before={p.before?.text ?? ""} after={c.text} />
        </Box>
      )}
      {c.kind === "fields" && (
        <Box ring={look.ring}>
          <dl className="space-y-2">
            {(p.rows ?? []).map((r) => (
              <div key={r.label}>
                <dt className="text-nd-caption font-medium text-nd-fg-3">{r.label}</dt>
                <dd className="mt-0.5">
                  {r.from.includes("\n") || r.to.includes("\n") ? (
                    // 개요 행·품목 표는 목록째 바뀐다 — 줄 단위로 대조해 보여 준다
                    <TextDiff before={r.from} after={r.to} />
                  ) : (
                    <p className="break-keep text-nd-table leading-relaxed">
                      <del className="text-nd-fg-3">{r.from}</del>
                      <span className="mx-1.5 text-nd-fg-3">→</span>
                      <b className="font-medium text-nd-fg">{r.to}</b>
                    </p>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </Box>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-nd-caption text-nd-fg-3">
          {applied ? "종이에 반영했습니다 — 편집창의 「저장」 을 눌러야 남습니다." : dismissed ? "반영하지 않았습니다." : "적용 전에는 종이가 바뀌지 않습니다."}
        </p>
        {!(removes && applied) && (
          <Button variant="ghost" size="sm" onClick={() => onLocate(applied)} className={cn("shrink-0", look.more)}>
            종이에서 보기
          </Button>
        )}
      </div>
    </div>
  );
}
