"use client";

// ============================================================
//  세금 고지서 — 국세 · 지방세 전자고지로 받은 고지서와 사람이 넣은 고지서
// ------------------------------------------------------------
//  전자고지 알림(문자 · 카톡 · 메일)이 오면 ERP 가 고지서로 넣고, 「돈 나가는 날」 노션 표에 납기 줄을
//  만들어 도착 · 3일 전 · 당일에 알린다 (lib/neander/finance/tax-notice.ts 머리말).
//  이 화면은 그 고지서 목록과 「직접 넣기」 다. 줄을 누르면 한 장 화면(/neander/tax/[id])에서 고친다.
//  낸 기록은 장부에서 금액이 같은 출금을 찾아 저절로 「냈음」 이 된다 — 돈 나가는 날 표의 상태 칸.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Receipt } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  InlineNotice,
  LoadingState,
  Money,
  PageHeader,
  PageShell,
  Table,
  TableScroll,
  Td,
  Th,
  Tr,
  useToast,
} from "@/components/neander/ui";
import { useAuth } from "@/components/neander/auth";
import { TAX_SOURCE, TAX_STATE, TaxNoticeFields, type TaxDraft } from "@/components/neander/finance/TaxNoticeForm";
import { createTaxNotice, fetchTaxNotices, type TaxNoticeView } from "@/lib/neander/finance/tax-notice-client";
import { noticeNeeds } from "@/lib/neander/finance/tax-notice";

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
const md = (date: string) => `${date.slice(0, 4)}. ${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}(${WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()]})`;
const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const daysLeft = (date: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${kstToday()}T00:00:00Z`)) / 86_400_000);
const day = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);

export default function TaxNoticesPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState<TaxNoticeView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<TaxDraft>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await fetchTaxNotices());
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오지 못했습니다.");
    }
  }, []);
  useEffect(() => {
    if (authLoading || !user) return;
    void load();
  }, [authLoading, user, load]);

  const add = async () => {
    setBusy(true);
    try {
      const id = await createTaxNotice(draft);
      toast.success("넣었습니다 — 돈 나가는 날 표에 납기 줄이 생겼습니다");
      setAdding(false);
      setDraft({});
      router.push(`/neander/tax/${encodeURIComponent(id)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "넣지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const open = rows?.filter((r) => r.state === "open") ?? [];
  const openSum = open.reduce((s, r) => s + (r.amount ?? 0), 0);

  return (
    <PageShell>
      <PageHeader
        title="세금 고지서"
        description="국세 · 지방세 전자고지로 받은 고지서 — 납기는 노션 「돈 나가는 날」 로 도착 · 3일 전 · 당일에 알립니다."
        actions={
          <Button icon={Plus} onClick={() => setAdding(true)}>
            고지서 넣기
          </Button>
        }
      />

      {error ? <ErrorState title="고지서를 불러오지 못했습니다" description={error} action={<Button onClick={() => void load()}>다시 시도</Button>} /> : null}
      {!rows && !error ? <LoadingState label="고지서를 불러오는 중…" /> : null}

      {rows ? (
        <>
          {open.length ? (
            <InlineNotice tone="warning" className="mb-4 text-nd-body">
              낼 고지서 {open.length}장{openSum ? ` · ${openSum.toLocaleString("ko-KR")}원` : ""}
              {open.some((r) => !r.dueDate || !r.amount) ? " — 금액 · 납기를 못 읽은 고지서가 있습니다. 눌러서 채워 주세요." : ""}
            </InlineNotice>
          ) : null}
          {rows.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="아직 받은 고지서가 없습니다"
              description="홈택스 · 위택스 전자고지를 신청하면 알림이 회사 전용폰과 메일로 와서 여기에 저절로 쌓입니다. 종이 고지서는 「고지서 넣기」 로 넣어 주세요."
            />
          ) : (
            <Card padding="none">
              <TableScroll>
                <Table minWidth={820}>
                  <thead>
                    <Tr>
                      <Th className="pl-5">상태</Th>
                      <Th>납기</Th>
                      <Th>사업자</Th>
                      <Th>세목</Th>
                      <Th align="right">낼 돈</Th>
                      <Th>받은 곳</Th>
                      <Th className="pr-5">받은 날</Th>
                    </Tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const st = TAX_STATE[r.state];
                      const left = r.dueDate ? daysLeft(r.dueDate) : null;
                      const href = `/neander/tax/${encodeURIComponent(r.id)}`;
                      return (
                        <Tr key={r.id} className="cursor-pointer" onClick={() => router.push(href)}>
                          <Td className="pl-5">
                            <Badge tone={st.tone}>{st.label}</Badge>
                          </Td>
                          <Td className="whitespace-nowrap">
                            {r.dueDate ? (
                              <Link href={href} onClick={(e) => e.stopPropagation()}>
                                {md(r.dueDate)}
                                {r.state === "open" && left !== null ? (
                                  <span className={left < 0 ? "text-nd-danger-text" : left <= 3 ? "text-nd-warning-text" : "text-nd-fg-3"}>
                                    {" "}
                                    · {left === 0 ? "오늘" : left > 0 ? `${left}일 남음` : `${-left}일 지남`}
                                  </span>
                                ) : null}
                              </Link>
                            ) : (
                              <span className="text-nd-danger-text">모름</span>
                            )}
                          </Td>
                          <Td>{r.site ?? r.payer ?? <span className="text-nd-fg-3">모름</span>}</Td>
                          <Td>
                            {[r.item ?? (r.level ? `${r.level}` : null), ...(r.tags ?? [])].filter(Boolean).join(" · ") || <span className="text-nd-fg-3">모름</span>}
                          </Td>
                          <Td num>{r.amount ? <Money value={r.amount} unit={false} /> : <span className="text-nd-fg-3">모름</span>}</Td>
                          <Td>
                            {TAX_SOURCE[r.source]}
                            {r.state === "open" && noticeNeeds(r).length ? <span className="text-nd-fg-3"> · {noticeNeeds(r).join(" · ")} 채우기</span> : null}
                          </Td>
                          <Td className="whitespace-nowrap pr-5">{day(r.receivedAt)}</Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
              </TableScroll>
            </Card>
          )}
        </>
      ) : null}

      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title="고지서 넣기"
        description="종이 고지서 · 세무사가 알려 준 납기처럼 전자고지로 안 들어온 것"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdding(false)}>
              닫기
            </Button>
            <Button loading={busy} disabled={!draft.dueDate && !draft.amount} onClick={() => void add()}>
              넣기
            </Button>
          </>
        }
      >
        <TaxNoticeFields value={draft} onChange={setDraft} />
      </Dialog>
    </PageShell>
  );
}
