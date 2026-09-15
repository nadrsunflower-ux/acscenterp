"use client";

// ============================================================
//  매출 비서 — 공용 패널에 매출 어댑터를 얹는다
// ------------------------------------------------------------
//  재무 비서와 같은 원리다: 서버가 도구로 데이터를 조회하고, 고칠 것은
//  **제안**만 한다. 다른 것은 도메인뿐 — 장부 거래가 아니라 판매 줄·상품·
//  이벤트·단위경제이고, 제안은 「이 줄들을 이 상품으로 확정」과 「이
//  상품에 별칭 추가」 둘이다.
//
//  ⚠️ 「적용」이 부르는 저장 경로는 화면의 검토 대기함·마스터가 쓰는 것과
//     같다 (line.bulkResolve · product.upsert). 비서만의 뒷길은 없다.
// ============================================================

import {
  useMemo,
  useState,
} from "react";
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
import { useSales } from "./SalesProvider";
import { StoreBadge } from "./ui";
import {
  bulkResolveSalesLines,
  deleteSalesChat,
  fetchSalesChat,
  fetchSalesChatList,
  sendSalesChat,
  upsertSalesProduct,
  type SalesProposal,
} from "@/lib/neander/sales/client";

const EXAMPLES = [
  "7월 매장별 매출과 공헌이익률 알려줘",
  "이번 달 미확정이 왜 남았는지 이유별로 묶어줘",
  "와우 이벤트 중 일당 공헌이익이 가장 높은 건?",
  "「이벤트 사쉐 외 1건」 63,000원 묶음을 확정하려면 어떻게 나눠야 해?",
];

export function SalesChat() {
  const { products, refresh } = useSales();

  const adapter = useMemo<AssistantAdapter<SalesProposal>>(
    () => ({
      name: "매출 비서",
      subtitle: "매장·온라인 판매만 봅니다 · 확정은 승인 후에만",
      storagePrefix: "neander.sales.chat",
      intro: (
        <>
          매장 판매에 대해 물어보세요 — 무엇을 몇 개 팔아 얼마 남겼는지. 미확정 판매를 어느
          상품으로 확정할지 제안해 드립니다.
          <b className="text-nd-fg"> 승인 전에는 아무것도 저장되지 않습니다.</b> 장부(정산 입금)는
          재무 비서에게 물어보세요.
        </>
      ),
      examples: EXAMPLES,
      inputPlaceholder: "판매·상품·이벤트에 대해 물어보세요 (Enter 전송 · Shift+Enter 줄바꿈)",
      busyLabel: "판매 데이터를 보고 있습니다…",

      send: (messages, model, files, conversationId, context) =>
        sendSalesChat(messages, model, files, conversationId, context),
      listChats: fetchSalesChatList,
      loadChat: fetchSalesChat,
      deleteChat: deleteSalesChat,

      apply: async (p) => {
        if (p.kind === "resolve") {
          await bulkResolveSalesLines(p.ids, p.productId, p.qty);
        } else {
          const cur = products.find((x) => x.id === p.productId);
          if (!cur) throw new Error(`상품 ${p.productId} 을 찾을 수 없습니다. 마스터를 새로 불러오세요.`);
          if ((cur.aliases ?? []).some((a) => a.toLowerCase() === p.alias.toLowerCase())) return;
          await upsertSalesProduct({ ...cur, aliases: [...(cur.aliases ?? []), p.alias] });
        }
        await refresh();
      },
      proposalKey: (p) => p.id,
      renderProposal: (props) => <SalesProposalCard {...props} />,
    }),
    [products, refresh],
  );

  return <AssistantChat adapter={adapter} />;
}

// ============================================================
//  제안 카드 — 무엇이 바뀌는지 보여준다
// ============================================================

function SalesProposalCard({
  proposal,
  applied,
  busy,
  onApply,
  onDismiss,
}: {
  proposal: SalesProposal;
  applied: boolean;
  busy: boolean;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const actions = applied ? (
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
  );

  if (proposal.kind === "alias") {
    return (
      <div className="rounded-nd-lg border border-nd-warning/50 bg-nd-warning-soft/50 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="text-nd-body font-semibold text-nd-fg">
            <Badge tone="warning" size="sm" className="mr-1.5 align-middle">
              제안
            </Badge>
            별칭 추가
          </p>
          {actions}
        </div>
        <p className="mt-1 text-nd-caption leading-relaxed text-nd-fg-2">{proposal.reason}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-nd-caption">
          <span className="rounded-[6px] bg-nd-content px-2 py-0.5 ring-1 ring-nd-warning/40">
            <b className="text-nd-fg">「{proposal.alias}」</b>
          </span>
          <span className="text-nd-fg-3">→</span>
          <span className="rounded-[6px] bg-nd-content px-2 py-0.5 text-nd-fg ring-1 ring-nd-warning/40">
            {proposal.productLabel}
          </span>
        </div>
        <p className="mt-2 text-nd-caption text-nd-fg-2">
          지금 미확정 중 <b className="nd-num text-nd-fg">{proposal.matchCount.toLocaleString("ko-KR")}건</b> ·{" "}
          <Money value={proposal.matchAmount} unit={false} className="font-medium" />원이 이 별칭에 해당합니다.
          저장되면 <b>다음 적재부터</b> 자동으로 잡힙니다 — 이미 적재된 줄은 따로 확정해야 합니다.
        </p>
        {proposal.sampleRaw.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 text-nd-micro text-nd-fg-3">
            {proposal.sampleRaw.map((r) => (
              <li key={r} className="truncate" title={r}>
                · {r}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const rows = expanded ? proposal.before : proposal.before.slice(0, 5);
  const total = proposal.before.reduce((s, b) => s + b.amount, 0);
  /** 이 묶음이 걸친 이벤트 (이름 + 코드). 상시 줄은 빈 값으로 들어온다 */
  const scopes = [...new Set(proposal.before.map((b) => b.event).filter(Boolean))] as string[];

  return (
    <div className="rounded-nd-lg border border-nd-warning/50 bg-nd-warning-soft/50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-nd-body font-semibold text-nd-fg">
          <Badge tone="warning" size="sm" className="mr-1.5 align-middle">
            제안
          </Badge>
          확정 {proposal.ids.length}건
          <span className="ml-2 text-nd-caption font-normal text-nd-fg-2">
            합계 <Money value={total} unit={false} />원
          </span>
        </p>
        {actions}
      </div>

      <p className="mt-1 text-nd-caption leading-relaxed text-nd-fg-2">{proposal.reason}</p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="rounded-[6px] bg-nd-content px-2 py-0.5 text-nd-caption ring-1 ring-nd-warning/40">
          <span className="text-nd-fg-2">상품</span> <b className="text-nd-fg">{proposal.productLabel}</b>
        </span>
        <span className="rounded-[6px] bg-nd-content px-2 py-0.5 text-nd-caption ring-1 ring-nd-warning/40">
          <span className="text-nd-fg-2">줄마다 수량</span> <b className="nd-num text-nd-fg">{proposal.qty}</b>
        </span>
        {/* 어느 행사의 판매인지 — 승인 판단의 핵심이다. 여러 이벤트에 걸쳐
            있으면 그 사실 자체가 신호이므로 개수를 보여준다. */}
        <span className="rounded-[6px] bg-nd-content px-2 py-0.5 text-nd-caption ring-1 ring-nd-warning/40">
          <span className="text-nd-fg-2">이벤트</span>{" "}
          <b className="text-nd-fg">
            {scopes.length === 0
              ? "상시"
              : scopes.length === 1
                ? scopes[0]
                : `${scopes.length}개 (${scopes.slice(0, 2).join(" · ")}…)`}
          </b>
        </span>
      </div>

      <div className="nd-scroll mt-2 overflow-x-auto rounded-nd-md border border-nd-line bg-nd-content">
        <Table dense className="text-nd-caption">
          <thead>
            <tr>
              <Th className="!bg-transparent border-t-0 px-2">날짜</Th>
              <Th className="!bg-transparent border-t-0 px-2">매장</Th>
              <Th className="!bg-transparent border-t-0 px-2">원본 내역</Th>
              <Th className="!bg-transparent border-t-0 px-2">이유</Th>
              <Th align="right" className="!bg-transparent border-t-0 px-2">
                금액
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <Tr key={b.id} hover={false}>
                <Td className="nd-num whitespace-nowrap px-2 text-nd-fg-2">{b.date}</Td>
                <Td className="px-2">
                  <StoreBadge store={b.store} size="sm" />
                </Td>
                <Td className="max-w-[160px] px-2">
                  <span className="block truncate text-nd-fg" title={b.raw}>
                    {b.raw}
                  </span>
                  {/* 이벤트가 섞여 있으면 줄마다 달라진다 — 그때만 보여준다 */}
                  {scopes.length > 1 && (
                    <span className="block truncate text-nd-micro text-nd-fg-3" title={b.event ?? "상시"}>
                      {b.event ?? "상시"}
                    </span>
                  )}
                </Td>
                <Td className="whitespace-nowrap px-2 text-nd-fg-3">{b.reason ?? "—"}</Td>
                <Td num className="whitespace-nowrap px-2">
                  {b.amount.toLocaleString("ko-KR")}
                </Td>
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
