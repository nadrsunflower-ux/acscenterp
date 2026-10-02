"use client";

// ============================================================
//  리포트 › 가수금 — 엑셀 「가수금_기록대장」
// ------------------------------------------------------------
//  임직원과 회사 사이에 오간 돈을 건별로 적는 기록장이다. 다른 리포트와 달리
//  **달이 없다** — 2023년에 받은 돈을 2026년에 갚기도 해서, 봐야 하는 것은
//  「그 달에 얼마」 가 아니라 「지금 누구에게 얼마 남았나」 다.
//
//  화면은 그 질문 순서대로다:
//    ① 누구에게 얼마 남았나      — 실제 돈 주인별 (명의가 아니라)
//    ② 그 숫자를 이루는 건       — 수기 대장의 한 줄 = 한 건
//    ③ 아직 건에 안 붙은 장부 거래 — 가수금 계정으로 잡혔는데 어느 건인지 모르는 돈
//
//  ③ 이 이 화면을 계속 맞게 유지하는 장치다. 통장에서 가수금이 오가면 장부에
//  거래가 생기고, 그 거래가 여기 뜬다 — 건에 붙이거나 새 건으로 적으면 사라진다.
//  장부에 없는 정리(현금 · 다른 사업자 통장 · 상계)만 건을 열어 손으로 적는다.
//
//  계산은 lib/neander/finance/suspense.ts, 건을 고치는 창은 SuspenseEditor.
// ============================================================

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { HandCoins, Link2, Plus, TriangleAlert } from "lucide-react";
import {
  Badge,
  BasisLine,
  Button,
  Card,
  Dialog,
  Disclosure,
  EmptyState,
  FilterBar,
  FilterField,
  Icon,
  KpiItem,
  KpiStrip,
  LoadingState,
  Money,
  PageHeader,
  PageShell,
  SectionHeader,
  SegmentedControl,
  Select,
  StatTile,
  Table,
  TableNote,
  TableScroll,
  Td,
  Th,
  type Tone,
  TotalRow,
  Tr,
  useConfirm,
  useToast,
} from "@/components/neander/ui";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { ReportTabs } from "@/components/neander/finance/ReportTabs";
import { SuspenseEditor } from "@/components/neander/finance/SuspenseEditor";
import { deleteFinSuspense, saveFinSuspense } from "@/lib/neander/finance/client";
import { ledgerHref } from "@/lib/neander/finance/ledgerLink";
import {
  attachCandidates,
  attachTx,
  buildSuspenseBook,
  DIRECTION_LABEL,
  nextSuspenseNo,
  personKey,
  SETTLE_LABEL,
  STATUS_LABEL,
  SUSPENSE_MAJOR,
  toInput,
  type FinSuspenseInput,
  type LinkRole,
  type SuspenseStatus,
  type SuspenseView,
  type UnattachedTx,
} from "@/lib/neander/finance/suspense";
import { netAmount } from "@/lib/neander/finance/types";

const STATUS_TONE: Record<SuspenseStatus, Tone> = {
  open: "warning",
  done: "success",
  over: "danger",
  company: "neutral",
};

type StatusFilter = "all" | "open" | "done" | "company";

/** 「남음」 에는 더 갚은 건도 넣는다 — 둘 다 아직 손볼 것이 남은 건이다 */
const inFilter = (v: SuspenseView, f: StatusFilter) =>
  f === "all" || (f === "open" ? v.status === "open" || v.status === "over" : v.status === f);

const dash = <span className="text-nd-fg-4">—</span>;

/** 붙일 자리를 사람 말로 */
const roleLabel = (view: SuspenseView, role: LinkRole) =>
  role === "origin" ? "이 건이 생긴 거래로" : `${SETTLE_LABEL[view.item.direction]}으로`;

interface EditorTarget {
  /** 창을 다시 만들 열쇠 — 같은 건을 두 번 열어도 초안이 새로 선다 */
  key: number;
  id?: string;
  initial: FinSuspenseInput;
}

export default function SuspenseReport() {
  const { transactions, suspense, paymentMethods, loading, refresh } = useFinance();
  const toast = useToast();
  const confirm = useConfirm();

  const [status, setStatus] = useState<StatusFilter>("all");
  const [owner, setOwner] = useState("");
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [attaching, setAttaching] = useState<UnattachedTx | null>(null);
  const [saving, setSaving] = useState(false);

  const book = useMemo(() => buildSuspenseBook(suspense, transactions), [suspense, transactions]);

  const aliasOf = useMemo(() => {
    const map = new Map(paymentMethods.map((p) => [p.last4, p.alias]));
    return (last4?: string) => (last4 ? (map.get(last4) ?? last4) : "계좌 없음");
  }, [paymentMethods]);

  /** 이름 고르기 후보 — 이미 적힌 돈 주인·명의 */
  const people = useMemo(() => {
    const set = new Set<string>();
    suspense.forEach((it) => {
      if (!it.companyMoney) set.add(personKey(it.owner));
      if (it.nominee) set.add(personKey(it.nominee));
    });
    return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b, "ko"));
  }, [suspense]);

  const rows = useMemo(
    () =>
      book.views.filter(
        (v) => inFilter(v, status) && (!owner || (v.status !== "company" && personKey(v.item.owner) === owner)),
      ),
    [book.views, status, owner],
  );
  const count = (f: StatusFilter) => book.views.filter((v) => inFilter(v, f)).length;
  /** 보이는 줄의 합계 — 방향마다 한 줄 */
  const sums = useMemo(
    () =>
      (["in", "out"] as const)
        .map((direction) => {
          const own = rows.filter((v) => v.item.direction === direction);
          return {
            direction,
            count: own.length,
            amount: own.reduce((s, v) => s + v.item.amount, 0),
            settled: own.reduce((s, v) => s + v.settled, 0),
            remaining: own.reduce((s, v) => s + v.remaining, 0),
          };
        })
        .filter((t) => t.count > 0),
    [rows],
  );

  const openNew = useCallback(
    (preset: Partial<FinSuspenseInput> = {}) =>
      setEditor({
        key: Date.now(),
        initial: {
          direction: "in",
          amount: 0,
          owner: "",
          origins: [],
          settles: [],
          no: nextSuspenseNo(suspense),
          ...preset,
        },
      }),
    [suspense],
  );
  const openEdit = (v: SuspenseView) => setEditor({ key: Date.now(), id: v.item.id, initial: toInput(v.item) });

  const save = async (input: FinSuspenseInput, id?: string, done?: string) => {
    setSaving(true);
    try {
      await saveFinSuspense(input, id);
      await refresh();
      setEditor(null);
      setAttaching(null);
      toast.success(done ?? (id ? "건을 고쳤습니다." : "새 건을 적었습니다."));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    const ok = await confirm({
      title: "이 건을 지울까요?",
      message: "붙여 둔 장부 거래는 그대로 남고, 아래 「안 붙은 장부 거래」 로 돌아갑니다.",
      confirmLabel: "지우기",
      tone: "danger",
    });
    if (!ok) return;
    setSaving(true);
    try {
      await deleteFinSuspense(id);
      await refresh();
      setEditor(null);
      toast.success("건을 지웠습니다.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "지우지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  /** 안 붙은 거래를 새 건으로 — 들어온 돈은 받은 돈, 나간 돈은 내준 돈으로 시작한다 */
  const newFromTx = (u: UnattachedTx) => {
    const vendor = u.tx.vendor ?? "";
    const who = people.find((p) => vendor.includes(p)) ?? "";
    setAttaching(null);
    openNew({
      direction: u.flow === "in" ? "in" : "out",
      amount: u.rest,
      date: u.tx.date,
      owner: who,
      purpose: u.tx.note || undefined,
      origins: [{ txId: u.tx.id, amount: u.rest }],
    });
  };

  if (loading) return <LoadingState label="기록장을 여는 중…" />;

  const { totals } = book;
  const header = (
    <>
      <PageHeader
        title="가수금"
        description="임직원이 회사에 넣은 돈과 회사가 임직원에게 내준 돈을 건별로 적습니다"
        className="mb-4"
        meta={
          totals.issueCount > 0 ? (
            <Badge tone="danger">
              <Icon icon={TriangleAlert} size={13} />
              장부와 어긋난 건 {totals.issueCount}
            </Badge>
          ) : undefined
        }
        actions={
          <Button size="sm" icon={Plus} onClick={() => openNew()}>
            새 건 적기
          </Button>
        }
      />
      <ReportTabs className="mb-4" />
    </>
  );

  const editorNode = editor && (
    <SuspenseEditor
      key={editor.key}
      open
      id={editor.id}
      initial={editor.initial}
      items={suspense}
      transactions={transactions}
      aliasOf={aliasOf}
      people={people}
      saving={saving}
      onSave={(input) => save(input, editor.id)}
      onDelete={editor.id ? () => remove(editor.id!) : undefined}
      onClose={() => setEditor(null)}
    />
  );

  const candidates = attaching ? attachCandidates(attaching.flow, book.views) : [];
  // 거래처에 이름이 들어 있는 사람의 건을 먼저 — 대개 그 사람 건이다
  const vendorOf = attaching?.tx.vendor ?? "";
  const ranked = candidates
    .filter((c) => c.view.status !== "company")
    .sort(
      (a, b) =>
        Number(vendorOf.includes(personKey(b.view.item.owner))) - Number(vendorOf.includes(personKey(a.view.item.owner))),
    );
  // 회사 돈 건은 열 몇 개씩 쌓여 사람 건을 밀어낸다 — 접어 두고 필요할 때만 편다
  const companyCands = candidates.filter((c) => c.view.status === "company");

  const candidateList = (list: typeof candidates) => (
    <ul className="flex flex-col gap-2">
      {list.map(({ view, role }) => (
        <li key={`${view.item.id}-${role}`}>
          <button
            type="button"
            disabled={saving}
            onClick={() =>
              attaching &&
              save(
                attachTx(view, role, attaching),
                view.item.id,
                `${view.item.no ? `${view.item.no}번 ` : ""}${view.item.owner} 건에 붙였습니다.`,
              )
            }
            className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-nd-md border border-nd-border px-3.5 py-2.5 text-left text-nd-body transition-colors duration-nd-fast hover:border-nd-accent hover:bg-nd-accent-soft/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="nd-num w-8 text-nd-fg-3">{view.item.no ?? "—"}</span>
            <span className="font-medium text-nd-fg">{view.item.owner}</span>
            <span className="min-w-0 flex-1 truncate text-nd-fg-2">
              {view.item.purpose ?? "목적 없음"}
              {view.item.date && <span className="nd-num ml-2 text-nd-fg-3">{view.item.date}</span>}
            </span>
            <span className="text-nd-fg-2">
              {view.status === "company" ? "회사 돈" : "남음"}{" "}
              <Money value={view.status === "company" ? view.item.amount : view.remaining} unit={false} />
            </span>
            <Badge tone={role === "origin" ? "info" : "warning"}>{roleLabel(view, role)}</Badge>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <PageShell>
      {header}

      <BasisLine
        className="mb-4"
        items={[
          "잔액은 통장 명의가 아니라 실제 돈 주인 앞으로 셉니다",
          <>
            회사 돈 <b className="font-medium text-nd-fg">{totals.companyCount}건</b>{" "}
            <Money value={totals.companyAmount} unit={false} />원은 갚을 빚이 아니라 잔액에서 뺍니다
          </>,
          `장부 거래는 「${SUSPENSE_MAJOR}」 계정으로 잡힌 것만 붙습니다`,
        ]}
      />

      <KpiStrip columns={4} className="mb-5">
        <StatTile
          label="회사가 갚을 돈"
          value={totals.payable}
          flow="expense"
          hint="받은 돈 중 아직 안 갚은 것"
        />
        <StatTile
          label="회사가 받을 돈"
          value={totals.receivable}
          flow="income"
          hint="내준 돈 중 아직 안 돌려받은 것"
        />
        <KpiItem label="남은 건" value={totals.openCount} unit="건" hint={`전체 ${book.views.length}건`} />
        <StatTile
          label="안 붙은 장부 거래"
          value={totals.unattachedAmount}
          tone={book.unattached.length > 0 ? "warning" : undefined}
          hint={
            book.unattached.length > 0
              ? `${book.unattached.length}건 — 아래에서 건에 붙이세요`
              : "가수금 거래가 모두 건에 붙어 있습니다"
          }
        />
      </KpiStrip>

      {/* ---- ① 누구에게 얼마 남았나 ---- */}
      <Card padding="none" className="mb-5 overflow-hidden">
        <div className="px-5 pt-5">
          <SectionHeader
            title="사람별 남은 돈"
            hint="이름을 누르면 아래 표가 그 사람 건만 보입니다"
            action={<TableNote>단위: 원</TableNote>}
          />
        </div>
        {book.people.length === 0 ? (
          <EmptyState
            className="border-0"
            compact
            icon={HandCoins}
            title="아직 적힌 건이 없습니다"
            description="「새 건 적기」 로 시작하거나, 아래 안 붙은 장부 거래를 새 건으로 적으세요."
          />
        ) : (
          <TableScroll>
            <Table minWidth={860}>
              <thead>
                <tr>
                  <Th className="pl-5">실제 돈 주인</Th>
                  <Th align="right">받은 돈</Th>
                  <Th align="right">갚음</Th>
                  <Th align="right">회사가 갚을 돈</Th>
                  <Th align="right">내준 돈</Th>
                  <Th align="right">돌려받음</Th>
                  <Th align="right">회사가 받을 돈</Th>
                  <Th align="right" className="pr-5">남은 건</Th>
                </tr>
              </thead>
              <tbody>
                {book.people.map((p) => {
                  const cell = (n: number, strong = false) =>
                    n === 0 ? dash : <Money value={n} unit={false} className={strong ? "font-semibold" : undefined} />;
                  return (
                    <Tr key={p.owner} selected={owner === p.owner}>
                      <Td className="pl-5 font-medium text-nd-fg">
                        <button
                          type="button"
                          className="hover:underline"
                          aria-pressed={owner === p.owner}
                          onClick={() => setOwner(owner === p.owner ? "" : p.owner)}
                        >
                          {p.owner}
                        </button>
                      </Td>
                      <Td num>{cell(p.received)}</Td>
                      <Td num>{cell(p.repaid)}</Td>
                      <Td num>{cell(p.payable, true)}</Td>
                      <Td num>{cell(p.lent)}</Td>
                      <Td num>{cell(p.recovered)}</Td>
                      <Td num>{cell(p.receivable, true)}</Td>
                      <Td num muted className="pr-5">{p.openCount || "—"}</Td>
                    </Tr>
                  );
                })}
              </tbody>
              <tfoot>
                <TotalRow>
                  <Td className="pl-5">합계</Td>
                  <Td num><Money value={book.people.reduce((s, p) => s + p.received, 0)} unit={false} /></Td>
                  <Td num><Money value={book.people.reduce((s, p) => s + p.repaid, 0)} unit={false} /></Td>
                  <Td num><Money value={totals.payable} unit={false} flow="expense" /></Td>
                  <Td num><Money value={book.people.reduce((s, p) => s + p.lent, 0)} unit={false} /></Td>
                  <Td num><Money value={book.people.reduce((s, p) => s + p.recovered, 0)} unit={false} /></Td>
                  <Td num><Money value={totals.receivable} unit={false} flow="income" /></Td>
                  <Td num className="pr-5">{totals.openCount}</Td>
                </TotalRow>
              </tfoot>
            </Table>
          </TableScroll>
        )}
      </Card>

      {/* ---- ② 건별 ---- */}
      <FilterBar className="mb-3">
        <FilterField label="상태" as="div">
          <SegmentedControl
            size="sm"
            ariaLabel="상태"
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: `전체 ${count("all")}` },
              { value: "open", label: `남음 ${count("open")}` },
              { value: "done", label: `다 갚음 ${count("done")}` },
              { value: "company", label: `회사 돈 ${count("company")}` },
            ]}
          />
        </FilterField>
        <FilterField label="돈 주인" htmlFor="suspense-owner">
          <Select id="suspense-owner" size="sm" value={owner} onChange={(e) => setOwner(e.target.value)} className="w-40">
            <option value="">모두</option>
            {book.people.map((p) => (
              <option key={p.owner} value={p.owner}>
                {p.owner}
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>

      <Card padding="none" className="mb-5 overflow-hidden">
        <div className="px-5 pt-5">
          <SectionHeader
            title={<>건별 기록 <span className="text-nd-fg-3">{rows.length}건</span></>}
            hint="줄을 누르면 고치거나 갚은 기록을 적을 수 있습니다"
            action={<TableNote>단위: 원</TableNote>}
          />
        </div>
        {rows.length === 0 ? (
          <EmptyState className="border-0" compact title="이 조건에 맞는 건이 없습니다" />
        ) : (
          <TableScroll>
            <Table minWidth={1180}>
              <thead>
                <tr>
                  <Th align="right" className="pl-5">번호</Th>
                  <Th>발생일</Th>
                  <Th>구분</Th>
                  <Th>실제 돈 주인</Th>
                  <Th>목적</Th>
                  <Th align="right">금액</Th>
                  <Th align="right">갚음 · 돌려받음</Th>
                  <Th align="right">남음</Th>
                  <Th>상태</Th>
                  <Th>마지막 정리</Th>
                  <Th className="pr-5">비고</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => {
                  const { item } = v;
                  const last = item.settles[item.settles.length - 1];
                  const isIn = item.direction === "in";
                  return (
                    <Tr key={item.id} className="cursor-pointer" onClick={() => openEdit(v)}>
                      <Td num muted className="pl-5">{item.no ?? "—"}</Td>
                      <Td className="nd-num whitespace-nowrap">{item.date ?? dash}</Td>
                      <Td>
                        <Badge tone={isIn ? "info" : "accent"}>{DIRECTION_LABEL[item.direction]}</Badge>
                      </Td>
                      <Td className="whitespace-nowrap">
                        <span className="font-medium text-nd-fg">{item.owner}</span>
                        {item.nominee && personKey(item.nominee) !== personKey(item.owner) && (
                          <span className="ml-1.5 text-nd-fg-3">명의 {item.nominee}</span>
                        )}
                      </Td>
                      <Td>
                        {/* 줄 전체가 눌리지만, 키보드로는 이 단추로 연다 */}
                        <button
                          type="button"
                          className="text-left hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEdit(v);
                          }}
                        >
                          {item.purpose ?? "목적 없음"}
                        </button>
                      </Td>
                      <Td num>
                        <Money value={item.amount} unit={false} flow={isIn ? "income" : "expense"} />
                      </Td>
                      <Td num>
                        {v.settled === 0 ? dash : <Money value={v.settled} unit={false} flow={isIn ? "expense" : "income"} />}
                      </Td>
                      <Td num className="font-semibold">
                        {v.status === "company" || v.remaining === 0 ? dash : <Money value={v.remaining} unit={false} />}
                      </Td>
                      <Td>
                        <Badge tone={STATUS_TONE[v.status]}>
                          {v.status === "done" && !isIn ? "다 돌려받음" : STATUS_LABEL[v.status]}
                        </Badge>
                      </Td>
                      <Td className="whitespace-nowrap">
                        {v.lastSettleDate ? (
                          <>
                            <span className="nd-num">{v.lastSettleDate}</span>
                            {last?.method && <span className="ml-1.5 text-nd-fg-3">{last.method}</span>}
                          </>
                        ) : (
                          dash
                        )}
                      </Td>
                      <Td className="max-w-[340px] pr-5 text-nd-fg-2">
                        {item.note}
                        {v.issues.map((s) => (
                          <span key={s} className="block text-nd-danger-text">
                            <Icon icon={TriangleAlert} size={13} className="mr-1 inline-block align-[-2px]" />
                            {s}
                          </span>
                        ))}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
              <tfoot>
                {/* 받은 돈과 내준 돈은 방향이 반대라 한 줄로 더하지 않는다 */}
                {sums.map((t) => (
                  <TotalRow key={t.direction}>
                    <Td className="pl-5" colSpan={5}>
                      {DIRECTION_LABEL[t.direction]} 합계{" "}
                      <span className="font-normal text-nd-fg-3">
                        {t.count}건{t.direction === "in" && " · 회사 돈은 남음에서 뺌"}
                      </span>
                    </Td>
                    <Td num><Money value={t.amount} unit={false} /></Td>
                    <Td num><Money value={t.settled} unit={false} /></Td>
                    <Td num><Money value={t.remaining} unit={false} /></Td>
                    <Td colSpan={3} />
                  </TotalRow>
                ))}
              </tfoot>
            </Table>
          </TableScroll>
        )}
      </Card>

      {/* ---- ③ 아직 건에 안 붙은 장부 거래 ---- */}
      <Card padding="none" className="overflow-hidden">
        <div className="px-5 pt-5">
          <SectionHeader
            title={<>안 붙은 장부 거래 <span className="text-nd-fg-3">{book.unattached.length}건</span></>}
            hint="가수금 계정으로 잡혔는데 어느 건인지 아직 모르는 돈 — 건에 붙이거나 새 건으로 적으면 사라집니다"
            action={
              <Link
                href={ledgerHref({ acctMajor: SUSPENSE_MAJOR })}
                className="text-nd-table text-nd-accent-strong hover:underline"
              >
                원장에서 가수금 거래 보기
              </Link>
            }
          />
        </div>
        {book.unattached.length === 0 ? (
          <EmptyState
            className="border-0"
            compact
            title="가수금 거래가 모두 건에 붙어 있습니다"
            description="통장에서 가수금이 오가 장부에 거래가 생기면 여기에 나타납니다."
          />
        ) : (
          <TableScroll>
            <Table minWidth={980}>
              <thead>
                <tr>
                  <Th className="pl-5">거래일</Th>
                  <Th>계좌</Th>
                  <Th>방향</Th>
                  <Th>거래처</Th>
                  <Th>비고</Th>
                  <Th align="right">거래 금액</Th>
                  <Th align="right">안 붙은 몫</Th>
                  <Th align="right" className="pr-5">
                    <span className="sr-only">동작</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {book.unattached.map((u) => (
                  <Tr key={u.tx.id}>
                    <Td className="nd-num whitespace-nowrap pl-5">{u.tx.date}</Td>
                    <Td className="whitespace-nowrap">{aliasOf(u.tx.last4)}</Td>
                    <Td>
                      <Badge tone={u.flow === "in" ? "success" : "danger"}>
                        {u.flow === "in" ? "들어온 돈" : "나간 돈"}
                      </Badge>
                    </Td>
                    <Td className="font-medium text-nd-fg">{u.tx.vendor ?? dash}</Td>
                    <Td className="max-w-[360px] text-nd-fg-2">{u.tx.note || u.tx.acctNote || dash}</Td>
                    <Td num>
                      <Money value={netAmount(u.tx)} unit={false} flow={u.flow === "in" ? "income" : "expense"} />
                    </Td>
                    <Td num className="font-semibold">
                      <Money value={u.rest} unit={false} />
                    </Td>
                    <Td align="right" className="whitespace-nowrap pr-5">
                      <Button variant="secondary" size="sm" icon={Link2} onClick={() => setAttaching(u)}>
                        건에 붙이기
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}
      </Card>

      {/* ---- 붙일 건 고르기 ---- */}
      <Dialog
        open={!!attaching}
        onClose={() => setAttaching(null)}
        size="lg"
        title="이 거래를 어느 건에 붙일까요?"
        description={
          attaching && (
            <>
              <span className="nd-num">{attaching.tx.date}</span> · {aliasOf(attaching.tx.last4)} ·{" "}
              {attaching.tx.vendor ?? "거래처 없음"} · {attaching.flow === "in" ? "들어온 돈" : "나간 돈"}{" "}
              <Money value={attaching.rest} />
            </>
          )
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setAttaching(null)} disabled={saving}>
              취소
            </Button>
            <Button icon={Plus} onClick={() => attaching && newFromTx(attaching)} disabled={saving}>
              {attaching?.flow === "in" ? "새로 받은 돈으로 적기" : "새로 내준 돈으로 적기"}
            </Button>
          </>
        }
      >
        {ranked.length === 0 ? (
          <p className="text-nd-body text-nd-fg-2">
            {attaching?.flow === "in"
              ? "돌려받을 것이 남은 건이 없습니다. 새로 받은 돈이면 아래 단추로 새 건을 적으세요."
              : "갚을 것이 남은 건이 없습니다. 회사가 내준 돈이면 아래 단추로 새 건을 적으세요."}
          </p>
        ) : (
          candidateList(ranked)
        )}
        {companyCands.length > 0 && (
          <Disclosure
            className="mt-3"
            title="회사 돈 건에 붙이기"
            description="회사 돈이 개인 통장을 거쳐 오간 거래일 때"
            meta={<span className="text-nd-table text-nd-fg-3">{companyCands.length}건</span>}
          >
            {candidateList(companyCands)}
          </Disclosure>
        )}
      </Dialog>

      {editorNode}
    </PageShell>
  );
}
