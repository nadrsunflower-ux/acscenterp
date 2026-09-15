"use client";

// ============================================================
//  재무 비서 — 공용 비서 패널의 어댑터 한 벌
// ------------------------------------------------------------
//  ⚠️ 모델은 장부를 직접 바꾸지 못한다. 제안은 「바뀔 내용」을 전/후로 보여
//     주고, 사람이 「적용」을 눌러야 그때 저장된다 (server/ai-tools.ts 주석).
//
//  패널 자체(도킹·팝업 · 지난 대화 · 모델 고르기 · 첨부 · PDF · 마크다운)는
//  components/neander/assistant/AssistantChat 이 그린다. 매출 비서와 **같은
//  구현**이다.
//
//  ⚠️ 예전에는 이 파일이 그 패널을 통째로 한 벌 더 갖고 있었다 (1,169줄).
//     Markdown·ModelConfirmDialog·도킹 계산까지 거의 그대로 복사돼 있어서,
//     한쪽을 고치면 다른 쪽이 조용히 뒤처졌다. 여기 남는 것은 **재무에만
//     있는 것**뿐이다 — 무엇을 물어볼 수 있는지(EXAMPLES), 제안을 어떻게
//     보여주는지(ProposalCard), 적용하면 어디에 저장되는지(applyFinEdits).
// ============================================================

import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Money,
  Table,
  Td,
  Th,
  Tr,
} from "@/components/neander/ui";
import {
  AssistantChat,
  type AssistantAdapter,
} from "@/components/neander/assistant/AssistantChat";
import { useFinance } from "./FinanceProvider";
import {
  applyFinEdits,
  deleteChat,
  fetchChat,
  fetchChatList,
  sendFinanceChat,
  type ChangeProposal,
} from "@/lib/neander/finance/client";

const EXAMPLES = [
  "7월에 구독비 얼마 썼어?",
  "검토필요로 남은 거래 보여줘",
  "쿠팡이츠 거래를 전부 일반식대로 바꿔줘",
  "지난달 대비 이번 달에 크게 늘어난 계정은?",
];

export function FinanceChat() {
  const { refresh } = useFinance();

  const adapter = useMemo<AssistantAdapter<ChangeProposal>>(
    () => ({
      name: "재무 비서",
      subtitle: "장부를 읽고 고칠 것을 제안합니다 · 저장은 승인 후에만",
      storagePrefix: "neander.finance.chat",
      intro: (
        <>
          장부에 대해 물어보세요 — 무엇에 얼마를 썼는지, 무엇이 검토로 남아 있는지. 잘못 분류된
          거래는 고칠 것을 제안해 드립니다.
          <b className="text-nd-fg"> 승인 전에는 아무것도 저장되지 않습니다.</b> 매장 판매 수량·원가는
          매출 비서에게 물어보세요.
        </>
      ),
      examples: EXAMPLES,
      inputPlaceholder: "거래·계정·구독에 대해 물어보세요 (Enter 전송 · Shift+Enter 줄바꿈)",
      busyLabel: "장부를 보고 있습니다…",

      send: (messages, model, files, conversationId, context) =>
        sendFinanceChat(messages, model, files, conversationId, context),
      listChats: fetchChatList,
      loadChat: fetchChat,
      deleteChat,

      /**
       * 적용 — 제안이 가리키는 거래를 한 번에 고친다. 근거를 함께 남겨
       * 나중에 "누가 왜 바꿨나" 를 물을 수 있게 한다.
       */
      apply: async (p) => {
        await applyFinEdits({
          updates: p.ids.map((id) => ({
            id,
            patch: { ...p.patch, classReason: `재무 비서 제안 — ${p.reason}` },
          })),
          inserts: [],
          deletes: [],
        });
        await refresh();
      },
      proposalKey: (p) => p.id,
      renderProposal: (props) => <ProposalCard {...props} />,
    }),
    [refresh],
  );

  return <AssistantChat adapter={adapter} />;
}

const FIELD_LABEL: Record<string, string> = {
  acctMajor: "계정대분류",
  acctMid: "계정중분류",
  acctMinor: "계정소분류",
  bizMajor: "사업대분류",
  bizMinor: "사업소분류",
  txType: "거래유형",
  status: "상태",
  site: "사업장",
  note: "비고",
  vendor: "거래처",
};

function ProposalCard({
  proposal,
  applied,
  busy,
  onApply,
  onDismiss,
}: {
  proposal: ChangeProposal;
  applied: boolean;
  busy: boolean;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? proposal.before : proposal.before.slice(0, 5);
  const total = proposal.before.reduce((s, b) => s + b.amount, 0);

  return (
    <div className="rounded-nd-lg border border-nd-warning/50 bg-nd-warning-soft/50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-nd-body font-semibold text-nd-fg">
          <Badge tone="warning" size="sm" className="mr-1.5 align-middle">제안</Badge>
          변경 {proposal.ids.length}건
          <span className="ml-2 text-nd-caption font-normal text-nd-fg-2">
            합계 <Money value={total} unit={false} />원
          </span>
        </p>
        {applied ? (
          <Badge tone="success">처리됨</Badge>
        ) : (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={onDismiss} disabled={busy}>
              무시
            </Button>
            <Button size="sm" onClick={onApply} disabled={busy}>
              적용
            </Button>
          </div>
        )}
      </div>

      <p className="mt-1 text-nd-caption leading-relaxed text-nd-fg-2">{proposal.reason}</p>

      {/* 바뀔 값 */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {Object.entries(proposal.patch).map(([k, v]) => (
          <span key={k} className="rounded-[6px] bg-nd-content px-2 py-0.5 text-nd-caption ring-1 ring-nd-warning/40">
            <span className="text-nd-fg-2">{FIELD_LABEL[k] ?? k}</span>{" "}
            <b className="text-nd-fg">{String(v)}</b>
          </span>
        ))}
      </div>

      {/* 대상 거래 */}
      <div className="nd-scroll mt-2 overflow-x-auto rounded-nd-md border border-nd-line bg-nd-content">
        <Table dense className="text-nd-caption">
          <thead>
            <tr>
              <Th className="!bg-transparent border-t-0 px-2">거래일</Th>
              <Th className="!bg-transparent border-t-0 px-2">거래처</Th>
              <Th className="!bg-transparent border-t-0 px-2">지금 계정</Th>
              <Th align="right" className="!bg-transparent border-t-0 px-2">금액</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <Tr key={b.id} hover={false}>
                <Td className="whitespace-nowrap px-2 nd-num text-nd-fg-2">{b.date}</Td>
                <Td className="max-w-[120px] truncate px-2 text-nd-fg" title={b.vendor ?? undefined}>{b.vendor ?? "—"}</Td>
                <Td className="max-w-[140px] truncate px-2 text-nd-fg-2" title={b.acct}>{b.acct}</Td>
                <Td num className="whitespace-nowrap px-2">{b.amount.toLocaleString("ko-KR")}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        {proposal.before.length > 5 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="w-full border-t border-nd-line px-2 py-1.5 text-nd-caption font-medium text-nd-warning-text transition-colors duration-nd-fast hover:bg-nd-warning-soft/50"
          >
            {expanded ? "접기" : `나머지 ${proposal.before.length - 5}건 보기`}
          </button>
        )}
      </div>
    </div>
  );
}
