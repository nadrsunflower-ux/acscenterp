"use client";

import { useMemo, useState } from "react";
import { Coins, Trash2 } from "lucide-react";
import { useAppData } from "@/components/neander/app-data";
import { addSale, deleteSale } from "@/lib/neander/db/sales";
import { emptyToUndef } from "@/lib/neander/db/helpers";
import {
  Button,
  Card,
  Field,
  IconButton,
  Input,
  KpiItem,
  KpiStrip,
  Select,
  Textarea,
  PageHeader,
  Badge,
  EmptyState,
  Table,
  TableNote,
  TableScroll,
  Td,
  Th,
  Tr,
  useConfirm,
  useToast,
} from "@/components/neander/ui";
import {
  SALES_CHANNELS,
  salesChannelLabel,
  type SalesChannel,
} from "@/lib/neander/types";
import { formatKRW, todayStr, thisMonthStr, formatDateKo, isInMonth } from "@/lib/neander/format";

export default function SalesPage() {
  const { sales, members, currentMember } = useAppData();
  const confirm = useConfirm();

  // 필터
  const [month, setMonth] = useState(thisMonthStr());
  const [channelFilter, setChannelFilter] = useState<SalesChannel | "all">("all");
  const [memberFilter, setMemberFilter] = useState<string>("all");

  // 월 + 담당자 기준 (채널 필터 제외) — 요약 카드용
  const monthScoped = useMemo(
    () =>
      sales.filter(
        (s) =>
          isInMonth(s.date, month) &&
          (memberFilter === "all" || s.memberId === memberFilter),
      ),
    [sales, month, memberFilter],
  );

  // 채널 필터까지 적용 — 목록용
  const listSales = useMemo(
    () =>
      [...monthScoped]
        .filter((s) => channelFilter === "all" || s.channel === channelFilter)
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt)),
    [monthScoped, channelFilter],
  );

  const total = monthScoped.reduce((sum, s) => sum + s.amount, 0);
  const byChannel = (c: SalesChannel) =>
    monthScoped.filter((s) => s.channel === c).reduce((sum, s) => sum + s.amount, 0);
  const listTotal = listSales.reduce((s, x) => s + x.amount, 0);

  async function remove(id: string) {
    if (!(await confirm({ title: "이 매출 기록을 삭제할까요?", confirmLabel: "삭제", tone: "danger" }))) return;
    deleteSale(id);
  }

  return (
    <div>
      <PageHeader
        title="매출 관리"
        description="채널별·담당자별 매출을 등록하고 월별로 집계합니다."
      />

      {/* 요약 지표 */}
      <KpiStrip columns={4} className="mb-6">
        <KpiItem label={`${month} 총 매출`} value={formatKRW(total)} tone="accent" hint="담당자 필터 기준" />
        {SALES_CHANNELS.map((c) => (
          <KpiItem key={c.value} label={c.label} value={formatKRW(byChannel(c.value))} />
        ))}
      </KpiStrip>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr] [&>*]:min-w-0">
        <SaleForm me={currentMember} />

        <div className="flex flex-col gap-4">
          {/* 필터 */}
          <Card padding="sm" className="flex flex-wrap items-end gap-3">
            <Field label="월">
              <Input size="sm" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </Field>
            <Field label="채널">
              <Select
                size="sm"
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value as SalesChannel | "all")}
              >
                <option value="all">전체 채널</option>
                {SALES_CHANNELS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="담당자">
              <Select size="sm" value={memberFilter} onChange={(e) => setMemberFilter(e.target.value)}>
                <option value="all">전체</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="ml-auto self-center text-nd-caption text-nd-fg-2">
              <span className="nd-num">{listSales.length}건</span> · 합계{" "}
              <span className="nd-num font-semibold text-nd-fg">{formatKRW(listTotal)}</span>
            </div>
          </Card>

          {/* 목록 */}
          {listSales.length === 0 ? (
            <EmptyState
              icon={Coins}
              title="해당 조건의 매출이 없습니다"
              description="왼쪽에서 등록하거나 필터를 바꿔보세요."
            />
          ) : (
            <Card padding="none" className="overflow-hidden">
              <TableScroll>
                <Table minWidth={560}>
                  <thead>
                    <tr>
                      <Th className="pl-4">날짜</Th>
                      <Th>채널</Th>
                      <Th>담당</Th>
                      <Th>거래처·메모</Th>
                      <Th align="right">금액</Th>
                      <Th className="w-10 pr-3">
                        <span className="sr-only">삭제</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {listSales.map((s) => (
                      <Tr key={s.id}>
                        <Td className="nd-num whitespace-nowrap pl-4 text-nd-fg-2">{formatDateKo(s.date)}</Td>
                        <Td>
                          <Badge>{salesChannelLabel(s.channel)}</Badge>
                        </Td>
                        <Td className="whitespace-nowrap text-nd-fg-2">{s.memberName}</Td>
                        <Td>
                          <span className="block max-w-[24rem] truncate" title={[s.client, s.memo].filter(Boolean).join(" · ")}>
                            {s.client || <span className="text-nd-fg-3">거래처 미기재</span>}
                            {s.memo && <span className="ml-2 text-nd-caption text-nd-fg-3">{s.memo}</span>}
                          </span>
                        </Td>
                        <Td num className="whitespace-nowrap font-semibold">
                          {formatKRW(s.amount)}
                        </Td>
                        <Td className="pr-3">
                          <IconButton
                            icon={Trash2}
                            label="삭제"
                            size="sm"
                            onClick={() => remove(s.id)}
                            className="hover:text-nd-danger-text"
                          />
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </TableScroll>
              <TableNote className="px-4 py-2">단위: 원</TableNote>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function SaleForm({ me }: { me: { id: string; name: string } | null }) {
  const toast = useToast();
  const [channel, setChannel] = useState<SalesChannel>("accent");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayStr());
  const [client, setClient] = useState("");
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount.replace(/,/g, ""));
    if (!amt || amt <= 0) {
      toast.error("금액을 올바르게 입력하세요.");
      return;
    }
    setSaving(true);
    try {
      await addSale({
        channel,
        amount: amt,
        date,
        // 담당자는 로그인한 사람으로 자동 기록 (입력 폼 제거)
        memberId: me?.id ?? "",
        memberName: me?.name ?? "",
        client: emptyToUndef(client),
        memo: emptyToUndef(memo),
      });
      setAmount("");
      setClient("");
      setMemo("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="self-start">
      <h2 className="mb-4 text-nd-section text-nd-fg">매출 등록</h2>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="채널" required>
          <Select value={channel} onChange={(e) => setChannel(e.target.value as SalesChannel)}>
            {SALES_CHANNELS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="금액(원)" required>
          <Input
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d,]/g, ""))}
            placeholder="예: 1500000"
            className="nd-num"
          />
        </Field>
        <Field label="날짜" required>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="거래처" hint="선택 입력">
          <Input value={client} onChange={(e) => setClient(e.target.value)} placeholder="예: ㅇㅇ상사" />
        </Field>
        <Field label="메모" hint="선택 입력">
          <Textarea rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} />
        </Field>
        <Button type="submit" loading={saving}>
          {saving ? "등록 중…" : "매출 등록"}
        </Button>
      </form>
    </Card>
  );
}
