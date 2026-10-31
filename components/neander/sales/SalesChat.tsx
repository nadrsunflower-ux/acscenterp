"use client";

// ============================================================
//  매출 비서 — 공용 패널에 매출 어댑터를 얹는다
// ------------------------------------------------------------
//  재무 비서와 같은 원리다: 서버가 도구로 데이터를 조회하고, 고칠 것은
//  **제안**만 한다. 다른 것은 도메인뿐 — 장부 거래가 아니라 판매 줄·상품·
//  이벤트·단위경제이고, 제안은 넷이다: 「이 줄들을 이 상품으로 확정」 ·
//  「한 결제를 여러 상품으로 나눠 확정」 · 「새 상품 만들기」 · 「별칭 추가」.
//
//  ⚠️ 「적용」이 부르는 저장 경로는 화면의 검토 대기함·마스터가 쓰는 것과
//     같다 (line.bulkResolve · line.split · product.upsert). 비서만의 뒷길은 없다.
//
//  확정·나누기 제안이 같은 답에서 제안한 새 상품을 쓰면 그 정의가 제안에
//  함께 실려 온다(newProducts). 어느 카드를 먼저 눌러도 상품이 먼저 만들어지게
//  적용할 때 마스터에 없으면 만들고 시작한다.
// ============================================================

import {
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Badge,
  Button,
  cn,
  Money,
  Table,
  Td,
  Th,
  Tr,
} from "@/components/neander/ui";
import {
  AssistantChat,
  proposalLook,
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
  splitSalesLines,
  upsertSalesProduct,
  type SalesProposal,
} from "@/lib/neander/sales/client";
import { rateLabel } from "@/lib/neander/sales/discount";
import { eventLabelOf, kindLabel, storeLabel, type SalesProduct } from "@/lib/neander/sales/types";
import type { SalesProposalLine } from "@/lib/neander/sales/server/ai-tools";

const EXAMPLES = [
  "7월 매장별 매출과 공헌이익률 알려줘",
  "이번 달 미확정이 왜 남았는지 이유별로 묶어줘",
  "와우 이벤트 중 일당 공헌이익이 가장 높은 건?",
  "「이벤트 사쉐 외 1건」 63,000원 묶음을 확정하려면 어떻게 나눠야 해?",
  "이번 이벤트 15,000원 미확정은 전용 클리커야 — 상품 만들고 확정해 줘",
];

export function SalesChat() {
  const { products, refresh, applyProducts } = useSales();

  const adapter = useMemo<AssistantAdapter<SalesProposal>>(
    () => ({
      name: "매출 비서",
      subtitle: "매장·온라인 판매만 봅니다 · 확정·상품 추가는 승인 후에만",
      storagePrefix: "neander.sales.chat",
      intro: (
        <>
          매장 판매에 대해 물어보세요 — 무엇을 몇 개 팔아 얼마 남겼는지. 미확정 판매를 어느
          상품으로 확정할지, 한 결제를 어떻게 나눌지, 마스터에 없는 행사 상품을 어떻게 만들지
          제안해 드립니다.
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
        /**
         * 제안이 쓰는 새 상품을 먼저 만든다. 이미 있으면(다른 카드로 먼저 만들었으면)
         * 건너뛰고, 같은 코드를 그새 다른 상품이 차지했으면 멈춘다 — 엉뚱한 상품으로
         * 확정되면 안 된다.
         */
        const ensure = async (list: SalesProduct[] | undefined) => {
          for (const np of list ?? []) {
            const cur = products.find((x) => x.id === np.id);
            if (cur) {
              if (cur.store !== np.store || cur.name !== np.name || cur.option !== np.option) {
                throw new Error(
                  `코드 ${np.id} 는 그새 「${cur.name} ${cur.option}」 이 쓰고 있습니다. 비서에게 다시 제안받으세요.`,
                );
              }
              continue;
            }
            await upsertSalesProduct(np);
            applyProducts({ upsert: [np] });
          }
        };
        if (p.kind === "resolve") {
          await ensure(p.newProducts);
          await bulkResolveSalesLines(p.ids, p.productId, p.qty, p.discount);
        } else if (p.kind === "split") {
          await ensure(p.newProducts);
          await splitSalesLines(
            p.ids,
            p.parts.map(({ productId, qty, amount, discount }) => ({
              productId,
              qty,
              amount,
              ...(discount ? { discount } : {}),
            })),
          );
        } else if (p.kind === "product") {
          await ensure([p.product]);
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
    [products, refresh, applyProducts],
  );

  return <AssistantChat adapter={adapter} />;
}

// ============================================================
//  제안 카드 — 무엇이 바뀌는지 보여준다
// ============================================================

type Look = ReturnType<typeof proposalLook>;

/** 카드 안의 작은 사실 한 칸 — 「상품 IDE-012 비아이 클리커」 */
function Chip({ look, label, children }: { look: Look; label: string; children: ReactNode }) {
  return (
    <span className={cn("rounded-[6px] bg-nd-content px-2 py-0.5 text-nd-caption ring-1", look.ring)}>
      <span className="text-nd-fg-2">{label}</span> <b className="text-nd-fg">{children}</b>
    </span>
  );
}

/** 어느 행사의 판매인지 — 승인 판단의 핵심이다. 여러 이벤트에 걸치면 그 사실 자체가 신호다 */
function scopesOf(before: SalesProposalLine[]): string[] {
  return [...new Set(before.map((b) => b.event).filter(Boolean))] as string[];
}

function scopeText(scopes: string[]): string {
  return scopes.length === 0
    ? "상시"
    : scopes.length === 1
      ? scopes[0]
      : `${scopes.length}개 (${scopes.slice(0, 2).join(" · ")}…)`;
}

const productScope = (p: SalesProduct, eventLabel?: string) =>
  p.eventIds?.length ? `${eventLabel ?? p.eventIds.join(", ")} 전용` : `${storeLabel(p.store)} 공용`;

/**
 * 이 제안을 적용하면 함께 만들어지는 상품. 확정 카드만 보고 승인해도 마스터에
 * 무엇이 생기는지 알 수 있어야 한다.
 */
function NewProductsNote({ look, list }: { look: Look; list?: SalesProduct[] }) {
  const { events } = useSales();
  if (!list?.length) return null;
  const byId = new Map(events.map((e) => [e.id, e]));
  const label = (p: SalesProduct) => (p.eventIds?.length ? p.eventIds.map((id) => eventLabelOf(id, byId)).join(", ") : undefined);
  return (
    <div className={cn("mt-2 rounded-[6px] bg-nd-content px-2 py-1.5 text-nd-caption ring-1", look.ring)}>
      <span className="text-nd-fg-2">적용하면 새 상품도 함께 만듭니다</span>
      <ul className="mt-0.5 space-y-0.5">
        {list.map((p) => (
          <li key={p.id} className="text-nd-fg">
            <b className="nd-num">{p.id}</b> {p.name} {p.option} · <Money value={p.price} unit={false} />원 ·{" "}
            {productScope(p, label(p))}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 대상 판매 줄 — 다섯 줄까지 보이고 나머지는 펼친다 */
function LinesTable({ look, before }: { look: Look; before: SalesProposalLine[] }) {
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? before : before.slice(0, 5);
  const scopes = scopesOf(before);
  return (
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
      {before.length > 5 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={cn(
            "w-full border-t border-nd-line px-2 py-1.5 text-nd-caption font-medium transition-colors duration-nd-fast",
            look.more,
          )}
        >
          {expanded ? "접기" : `나머지 ${before.length - 5}건 보기`}
        </button>
      )}
    </div>
  );
}

function SalesProposalCard({
  proposal,
  applied,
  dismissed,
  busy,
  onApply,
  onDismiss,
}: {
  proposal: SalesProposal;
  applied: boolean;
  dismissed: boolean;
  busy: boolean;
  onApply: () => void;
  onDismiss: () => void;
}) {
  // 적용하면 초록, 무시하면 회색 — 저장됐는지가 색으로 보인다
  const look = proposalLook(applied, dismissed);
  const actions = applied ? (
    <Badge tone="success">처리됨</Badge>
  ) : dismissed ? (
    <Badge>무시함</Badge>
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
  const header = (title: ReactNode) => (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <p className="text-nd-body font-semibold text-nd-fg">
        <Badge tone={look.badge} size="sm" className="mr-1.5 align-middle">
          제안
        </Badge>
        {title}
      </p>
      {actions}
    </div>
  );
  const shell = (children: ReactNode) => (
    <div className={cn("rounded-nd-lg border p-3 transition-colors duration-nd", look.card)}>{children}</div>
  );

  if (proposal.kind === "alias") {
    return shell(
      <>
        {header("별칭 추가")}
        <p className="mt-1 text-nd-caption leading-relaxed text-nd-fg-2">{proposal.reason}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-nd-caption">
          <span className={cn("rounded-[6px] bg-nd-content px-2 py-0.5 ring-1", look.ring)}>
            <b className="text-nd-fg">「{proposal.alias}」</b>
          </span>
          <span className="text-nd-fg-3">→</span>
          <span className={cn("rounded-[6px] bg-nd-content px-2 py-0.5 text-nd-fg ring-1", look.ring)}>
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
      </>,
    );
  }

  if (proposal.kind === "product") {
    const p = proposal.product;
    return shell(
      <>
        {header("새 상품 만들기")}
        <p className="mt-1 text-nd-caption leading-relaxed text-nd-fg-2">{proposal.reason}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip look={look} label="코드">
            <span className="nd-num">{p.id}</span>
          </Chip>
          <Chip look={look} label="상품">
            {p.name} {p.option}
          </Chip>
          <Chip look={look} label="판매가">
            <Money value={p.price} unit={false} />원
          </Chip>
          <Chip look={look} label="재료비">
            {p.unconfirmed ? "미확인 (0원으로 둠)" : <><Money value={p.material} unit={false} />원</>}
          </Chip>
          <Chip look={look} label="범위">
            {productScope(p, proposal.eventLabel)}
          </Chip>
          <Chip look={look} label="유형">
            {kindLabel(p.kind)}
          </Chip>
          {p.bottles > 1 && (
            <Chip look={look} label="병 수">
              <span className="nd-num">{p.bottles}</span>
            </Chip>
          )}
          {(p.aliases ?? []).length > 0 && (
            <Chip look={look} label="POS 별칭">
              「{(p.aliases ?? []).join(" / ")}」
            </Chip>
          )}
        </div>
        <p className="mt-2 text-nd-caption leading-relaxed text-nd-fg-2">
          이 상품을 쓸 수 있는 <Money value={p.price} unit={false} />원 미확정 줄{" "}
          <b className="nd-num text-nd-fg">{proposal.sameAmountCount.toLocaleString("ko-KR")}건</b>. 이 카드는 상품만
          만들고, 줄 확정은 확정·나누기 카드에서 합니다(그 카드를 먼저 눌러도 상품이 함께 만들어집니다).
          {p.unconfirmed && " 재료비를 모르면 공헌이익이 부풀어 보이니 마스터에서 채워 주세요."}
        </p>
      </>,
    );
  }

  const total = proposal.before.reduce((sum, b) => sum + b.amount, 0);
  const scopes = scopesOf(proposal.before);

  if (proposal.kind === "split") {
    const gap = proposal.list - proposal.amount;
    return shell(
      <>
        {header(
          <>
            나눠서 확정 {proposal.ids.length}건
            <span className="ml-2 text-nd-caption font-normal text-nd-fg-2">
              합계 <Money value={total} unit={false} />원
            </span>
          </>,
        )}
        <p className="mt-1 text-nd-caption leading-relaxed text-nd-fg-2">{proposal.reason}</p>

        <div className="nd-scroll mt-2 overflow-x-auto rounded-nd-md border border-nd-line bg-nd-content">
          <Table dense className="text-nd-caption">
            <thead>
              <tr>
                <Th className="!bg-transparent border-t-0 px-2">결제 한 건 안의 상품</Th>
                <Th align="right" className="!bg-transparent border-t-0 px-2">
                  정가
                </Th>
                <Th align="right" className="!bg-transparent border-t-0 px-2">
                  수량
                </Th>
                <Th align="right" className="!bg-transparent border-t-0 px-2">
                  이 줄 매출
                </Th>
              </tr>
            </thead>
            <tbody>
              {proposal.parts.map((x) => (
                <Tr key={x.productId} hover={false}>
                  <Td className="px-2 text-nd-fg">
                    {x.productLabel}
                    {proposal.newProducts?.some((np) => np.id === x.productId) && (
                      <Badge tone="accent" size="sm" className="ml-1.5 align-middle">
                        새 상품
                      </Badge>
                    )}
                  </Td>
                  <Td num className="whitespace-nowrap px-2 text-nd-fg-2">
                    {x.unit.toLocaleString("ko-KR")}
                  </Td>
                  <Td num className="whitespace-nowrap px-2 text-nd-fg-2">
                    ×{x.qty}
                  </Td>
                  <Td num className="whitespace-nowrap px-2">
                    {x.amount.toLocaleString("ko-KR")}
                    {x.amount !== x.list && (
                      <span className="block text-nd-micro text-nd-fg-3">정가 {x.list.toLocaleString("ko-KR")}</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
        <p className="mt-1.5 text-nd-caption text-nd-fg-2">
          정가 합계 <Money value={proposal.list} unit={false} />원 · 결제 <Money value={proposal.amount} unit={false} />원
          {gap > 0 && proposal.discountRate !== undefined ? (
            <>
              {" "}
              · 할인 <b className="nd-num text-nd-fg">{gap.toLocaleString("ko-KR")}원 ({rateLabel(proposal.discountRate)})</b> — 상품별
              정가 비율로 나눠 할인으로 기록합니다
            </>
          ) : (
            " · 정가 그대로"
          )}
          . 결제 한 건이 상품 {proposal.parts.length}줄로 나뉩니다.
        </p>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip look={look} label="이벤트">
            {scopeText(scopes)}
          </Chip>
        </div>
        <NewProductsNote look={look} list={proposal.newProducts} />
        <LinesTable look={look} before={proposal.before} />
      </>,
    );
  }

  return shell(
    <>
      {header(
        <>
          확정 {proposal.ids.length}건
          <span className="ml-2 text-nd-caption font-normal text-nd-fg-2">
            합계 <Money value={total} unit={false} />원
          </span>
        </>,
      )}

      <p className="mt-1 text-nd-caption leading-relaxed text-nd-fg-2">{proposal.reason}</p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <Chip look={look} label="상품">
          {proposal.productLabel}
        </Chip>
        <Chip look={look} label="줄마다 수량">
          <span className="nd-num">{proposal.qty}</span>
        </Chip>
        {proposal.discount && (
          <Chip look={look} label="할인">
            {rateLabel(proposal.discount.rate)} · 정가 <Money value={proposal.discount.list} unit={false} />원
          </Chip>
        )}
        <Chip look={look} label="이벤트">
          {scopeText(scopes)}
        </Chip>
      </div>

      <NewProductsNote look={look} list={proposal.newProducts} />
      <LinesTable look={look} before={proposal.before} />
    </>,
  );
}
