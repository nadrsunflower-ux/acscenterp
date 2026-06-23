"use client";

import { useMemo, useState } from "react";
import { useAppData } from "@/components/neander/app-data";
import { addSale, deleteSale } from "@/lib/neander/db/sales";
import { emptyToUndef } from "@/lib/neander/db/helpers";
import {
  Button,
  Card,
  Field,
  Input,
  Select,
  Textarea,
  PageHeader,
  Badge,
  EmptyState,
} from "@/components/neander/ui";
import {
  SALES_CHANNELS,
  salesChannelLabel,
  type SalesChannel,
} from "@/lib/neander/types";
import { formatKRW, todayStr, thisMonthStr, formatDateKo, isInMonth } from "@/lib/neander/format";

export default function SalesPage() {
  const { sales, members, currentMember } = useAppData();

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

  return (
    <div>
      <PageHeader
        title="매출 관리"
        description="채널별·담당자별 매출을 등록하고 월별로 집계합니다."
      />

      {/* 요약 카드 */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label={`${month} 총 매출`} value={total} accent />
        {SALES_CHANNELS.map((c) => (
          <SummaryCard key={c.value} label={c.label} value={byChannel(c.value)} />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <SaleForm me={currentMember} />

        <div className="flex flex-col gap-4">
          {/* 필터 */}
          <Card className="flex flex-wrap items-end gap-3">
            <Field label="월">
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </Field>
            <Field label="채널">
              <Select
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
              <Select value={memberFilter} onChange={(e) => setMemberFilter(e.target.value)}>
                <option value="all">전체</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="ml-auto self-center text-sm text-zinc-500">
              {listSales.length}건 · 합계{" "}
              <span className="font-semibold text-zinc-800">
                {formatKRW(listSales.reduce((s, x) => s + x.amount, 0))}
              </span>
            </div>
          </Card>

          {/* 목록 */}
          {listSales.length === 0 ? (
            <EmptyState icon="💰" title="해당 조건의 매출이 없습니다" description="왼쪽에서 등록하거나 필터를 바꿔보세요." />
          ) : (
            <Card className="!p-0">
              <ul className="divide-y divide-zinc-100">
                {listSales.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="w-20 shrink-0 text-xs text-zinc-400">
                      {formatDateKo(s.date)}
                    </div>
                    <Badge>{salesChannelLabel(s.channel)}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-zinc-800">
                        {s.client || <span className="text-zinc-400">거래처 미기재</span>}
                        {s.memo && <span className="ml-2 text-xs text-zinc-400">{s.memo}</span>}
                      </div>
                      <div className="text-xs text-zinc-400">{s.memberName}</div>
                    </div>
                    <div className="shrink-0 text-sm font-semibold text-zinc-900">
                      {formatKRW(s.amount)}
                    </div>
                    <button
                      onClick={() => {
                        if (confirm("이 매출 기록을 삭제할까요?")) deleteSale(s.id);
                      }}
                      className="shrink-0 text-xs text-zinc-300 hover:text-red-500"
                      aria-label="삭제"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div
      className={
        accent
          ? "rounded-xl bg-indigo-600 p-4 text-white shadow-sm"
          : "rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
      }
    >
      <div className={accent ? "text-xs text-indigo-100" : "text-xs text-zinc-400"}>{label}</div>
      <div className={accent ? "mt-1 text-xl font-bold" : "mt-1 text-xl font-bold text-zinc-900"}>
        {formatKRW(value)}
      </div>
    </div>
  );
}

function SaleForm({ me }: { me: { id: string; name: string } | null }) {
  const [channel, setChannel] = useState<SalesChannel>("accent");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayStr());
  const [client, setClient] = useState("");
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount.replace(/,/g, ""));
    if (!amt || amt <= 0) return alert("금액을 올바르게 입력하세요.");
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
    <Card>
      <h2 className="mb-4 text-sm font-semibold text-zinc-800">매출 등록</h2>
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
        <Button type="submit" disabled={saving}>
          {saving ? "등록 중…" : "매출 등록"}
        </Button>
      </form>
    </Card>
  );
}
