"use client";

// ============================================================
//  마스터 관리 — 계정 · 계좌/카드 · 자동분류 규칙
// ------------------------------------------------------------
//  최초 1회 "마스터 적재"를 눌러 엑셀에서 뽑아둔 기준 정보를
//  Firestore 에 넣는다. 결정적 문서 id 라 여러 번 눌러도 중복되지 않고
//  덮어쓴다.
// ============================================================

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Button,
  Card,
  Input,
  PageHeader,
  Badge,
  Field,
  EmptyState,
} from "@/components/neander/ui";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { SectionTitle } from "@/components/neander/finance/ui";
import {
  seedFinanceMaster,
  upsertFinVendorRule,
  deleteFinVendorRule,
  upsertFinSubscription,
  deleteFinSubscription,
  setFinAllocationActive,
  deleteFinAllocation,
} from "@/lib/neander/finance/client";
import { legacyPaymentMethods } from "@/lib/neander/finance/report";
import { cn } from "@/components/neander/ui";
import {
  describeFinanceError,
  type FriendlyError,
} from "@/lib/neander/finance/errors";

type Tab = "accounts" | "methods" | "subscriptions" | "allocations" | "rules";

const TABS: { key: Tab; label: string }[] = [
  { key: "accounts", label: "계정" },
  { key: "methods", label: "계좌·카드" },
  { key: "subscriptions", label: "구독 서비스" },
  { key: "allocations", label: "배분 규칙" },
  { key: "rules", label: "자동분류 규칙" },
];

const KIND_LABEL: Record<string, { text: string; color: string }> = {
  account: { text: "통장", color: "#64748b" },
  card: { text: "카드", color: "#f59e0b" },
  cash: { text: "현금", color: "#16a34a" },
};

const CYCLE_LABEL: Record<string, string> = { monthly: "월정액", usage: "사용량" };
const SUB_STATUS: Record<string, { text: string; color: string }> = {
  active: { text: "사용 중", color: "#16a34a" },
  review: { text: "확인 필요", color: "#f59e0b" },
  cancelled: { text: "해지", color: "#71717a" },
};
const DRIVER_LABEL: Record<string, string> = {
  revenue: "수입 비율",
  expense: "지출 비율",
  fixed: "고정 비율",
};

export default function MasterPage() {
  const { accounts, paymentMethods, vendorRules, subscriptions, allocations, masterEmpty, refresh } =
    useFinance();
  const [tab, setTab] = useState<Tab>("accounts");
  const [q, setQ] = useState("");
  const [seeding, setSeeding] = useState<string | null>(null);
  const [seedError, setSeedError] = useState<FriendlyError | null>(null);
  const [newRule, setNewRule] = useState({ service: "", keyword: "" });
  const [newSub, setNewSub] = useState({ service: "", keywords: "", cycle: "monthly", expected: "" });
  const [busy, setBusy] = useState<string | null>(null);

  const legacyMethods = useMemo(() => legacyPaymentMethods(paymentMethods), [paymentMethods]);

  const seed = async () => {
    setSeedError(null);
    setSeeding("적재 중…");
    try {
      const r = await seedFinanceMaster();
      await refresh();
      setSeeding(
        `완료 — 계정 ${r.accounts} · 계좌/카드 ${r.paymentMethods} · 규칙 ${r.vendorRules}` +
          ` · 구독 ${r.subscriptions ?? 0} · 배분 규칙 ${r.allocations ?? 0}개 추가`,
      );
    } catch (e) {
      // 원문 메시지("Missing or insufficient permissions.")만으로는
      // 무엇을 해야 하는지 알 수 없다 — 조치까지 알려준다.
      const f = describeFinanceError(e);
      setSeedError(f);
      setSeeding(null);
    }
  };

  const filteredAccounts = useMemo(() => {
    const s = q.trim().toLowerCase();
    const rows = [...accounts].sort((a, b) => a.lookupKey.localeCompare(b.lookupKey, "ko"));
    if (!s) return rows;
    return rows.filter((a) =>
      [a.major, a.mid, a.minor, a.code, a.example].join(" ").toLowerCase().includes(s),
    );
  }, [accounts, q]);

  const filteredMethods = useMemo(() => {
    const s = q.trim().toLowerCase();
    const rows = [...paymentMethods].sort((a, b) => a.last4.localeCompare(b.last4));
    if (!s) return rows;
    return rows.filter((p) => [p.last4, p.alias, p.site].join(" ").toLowerCase().includes(s));
  }, [paymentMethods, q]);

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8">
      <PageHeader
        title="마스터"
        description="계정·계좌·규칙의 기준 정보. 거래 분류와 파생값(회계코드·부가세·지점)의 근거가 됩니다."
        actions={
          <div className="flex items-center gap-2">
            {seeding && <span className="text-sm text-zinc-500">{seeding}</span>}
            <Button variant={masterEmpty ? "primary" : "secondary"} onClick={seed}>
              {masterEmpty ? "마스터 적재하기" : "엑셀 기준으로 다시 적재"}
            </Button>
          </div>
        }
      />

      {seedError && (
        <Card className="mb-4 border-rose-200 bg-rose-50/60">
          <p className="font-semibold text-rose-900">{seedError.title}</p>
          <p className="mt-1 text-sm leading-relaxed text-rose-800">{seedError.detail}</p>
          {seedError.command && (
            <code className="mt-2 inline-block rounded bg-white px-2 py-1 font-mono text-sm text-rose-900 ring-1 ring-rose-200">
              {seedError.command}
            </code>
          )}
        </Card>
      )}

      {masterEmpty && !seedError && (
        <Card className="mb-4 border-amber-200 bg-amber-50/60">
          <p className="text-sm text-zinc-700">
            아직 마스터가 비어 있습니다. <b>마스터 적재하기</b>를 누르면 엑셀 장부에서 뽑아둔
            계정 317개, 계좌·카드 27개, 자동분류 규칙 16개가 들어갑니다.
          </p>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg bg-zinc-100 p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition",
                tab === t.key ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800",
              )}
            >
              {t.label}
              <span className="ml-1.5 text-xs text-zinc-400">
                {t.key === "accounts"
                  ? accounts.length
                  : t.key === "methods"
                    ? paymentMethods.length
                    : t.key === "subscriptions"
                      ? subscriptions.length
                      : t.key === "allocations"
                        ? allocations.length
                        : vendorRules.length}
              </span>
            </button>
          ))}
        </div>
        {(tab === "accounts" || tab === "methods") && (
          <Input
            placeholder="검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-56"
          />
        )}
      </div>

      {/* 계정 */}
      {tab === "accounts" && (
        <Card className="overflow-hidden p-0">
          {filteredAccounts.length === 0 ? (
            <EmptyState icon="🗂️" title="계정이 없습니다" description="마스터를 적재하세요." />
          ) : (
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="sticky top-0 z-10 bg-zinc-50">
                  <tr className="border-b border-zinc-200 text-xs text-zinc-500">
                    <th className="px-4 py-2 text-left font-medium">거래유형</th>
                    <th className="px-3 py-2 text-left font-medium">대분류</th>
                    <th className="px-3 py-2 text-left font-medium">중분류</th>
                    <th className="px-3 py-2 text-left font-medium">소분류</th>
                    <th className="px-3 py-2 text-left font-medium">회계코드</th>
                    <th className="px-3 py-2 text-left font-medium">부가세</th>
                    <th className="px-4 py-2 text-left font-medium">지점</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {filteredAccounts.map((a) => (
                    <tr key={a.id} className="hover:bg-zinc-50/70">
                      <td className="whitespace-nowrap px-4 py-1.5 text-zinc-500">{a.txType}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-zinc-600">{a.major}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-zinc-600">{a.mid}</td>
                      <td className="px-3 py-1.5 font-medium text-zinc-900">{a.minor}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-zinc-600">{a.code}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-zinc-600">{a.vat}</td>
                      <td className="whitespace-nowrap px-4 py-1.5 text-zinc-600">{a.branch}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* 계좌·카드 */}
      {tab === "methods" && (
        <>
          {legacyMethods.length > 0 && (
            <Card className="mb-4 border-amber-200 bg-amber-50/60">
              <p className="text-sm text-zinc-700">
                결제수단 {legacyMethods.length}건에 <b>종류(통장·카드·현금)</b>가 없습니다. 현금흐름 기준
                집계는 「카드로 쓴 것」을 구분해야 하는데, 지금은 임직원 개인카드 표시로 대신 판정하고
                있습니다. 위 <b>다시 적재</b>를 누르면 채워집니다.
              </p>
            </Card>
          )}
        <Card className="overflow-hidden p-0">
          {filteredMethods.length === 0 ? (
            <EmptyState icon="💳" title="계좌·카드가 없습니다" description="마스터를 적재하세요." />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
                  <th className="px-4 py-2 text-left font-medium">뒷 4자리</th>
                  <th className="px-3 py-2 text-left font-medium">별칭</th>
                  <th className="px-3 py-2 text-left font-medium">사업장</th>
                  <th className="px-3 py-2 text-left font-medium">종류</th>
                  <th className="px-4 py-2 text-left font-medium">구분</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filteredMethods.map((p) => (
                  <tr key={p.id} className="hover:bg-zinc-50/70">
                    <td className="px-4 py-1.5 tabular-nums font-medium text-zinc-900">{p.last4}</td>
                    <td className="px-3 py-1.5 text-zinc-700">{p.alias}</td>
                    <td className="px-3 py-1.5 text-zinc-600">{p.site}</td>
                    <td className="px-3 py-1.5">
                      {p.kind ? (
                        <Badge color={KIND_LABEL[p.kind].color}>{KIND_LABEL[p.kind].text}</Badge>
                      ) : (
                        <span className="text-xs text-amber-600">미지정</span>
                      )}
                    </td>
                    <td className="px-4 py-1.5">
                      {p.personal ? (
                        <Badge color="#f59e0b">임직원 개인카드(대납)</Badge>
                      ) : (
                        <span className="text-zinc-400">법인</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        </>
      )}

      {/* 구독 서비스 */}
      {tab === "subscriptions" && (
        <>
          <Card className="mb-4">
            <SectionTitle hint="구독 계정 안에서 거래처 키워드를 맞춥니다 · 키워드는 쉼표로 여러 개">
              구독 서비스 추가
            </SectionTitle>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="서비스명" className="w-56">
                <Input
                  value={newSub.service}
                  placeholder="예: Anthropic (Claude)"
                  onChange={(e) => setNewSub({ ...newSub, service: e.target.value })}
                />
              </Field>
              <Field label="매칭 키워드" className="w-64" hint="같은 서비스가 여러 이름으로 찍히면 모두 적으세요">
                <Input
                  value={newSub.keywords}
                  placeholder="ANTHROPIC, CLAUDE"
                  onChange={(e) => setNewSub({ ...newSub, keywords: e.target.value })}
                />
              </Field>
              <Field label="결제 주기" className="w-32">
                <select
                  value={newSub.cycle}
                  onChange={(e) => setNewSub({ ...newSub, cycle: e.target.value })}
                  className="w-full cursor-pointer rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500"
                >
                  <option value="monthly">월정액</option>
                  <option value="usage">사용량</option>
                </select>
              </Field>
              <Field label="월 예상액" className="w-32" hint="비우면 과거 중앙값 기준">
                <Input
                  type="number"
                  value={newSub.expected}
                  onChange={(e) => setNewSub({ ...newSub, expected: e.target.value })}
                />
              </Field>
              <Button
                disabled={!newSub.service.trim() || !newSub.keywords.trim() || busy !== null}
                onClick={async () => {
                  setBusy("sub");
                  try {
                    await upsertFinSubscription({
                      service: newSub.service.trim(),
                      keywords: newSub.keywords.split(",").map((k) => k.trim()).filter(Boolean),
                      cycle: newSub.cycle as "monthly" | "usage",
                      expected: newSub.expected ? Number(newSub.expected) : undefined,
                      status: "active",
                    });
                    await refresh();
                    setNewSub({ service: "", keywords: "", cycle: "monthly", expected: "" });
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                추가
              </Button>
            </div>
          </Card>

          <Card className="overflow-hidden p-0">
            {subscriptions.length === 0 ? (
              <EmptyState
                icon="🔁"
                title="구독 마스터가 비어 있습니다"
                description="마스터를 적재하면 엑셀 「구독서비스 관리」·「구독결제수단 정비」에서 뽑은 22개가 들어갑니다. 그 전까지는 자동분류 규칙으로 대신 집계합니다."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
                      <th className="px-4 py-2 text-left font-medium">서비스</th>
                      <th className="px-3 py-2 text-left font-medium">매칭 키워드</th>
                      <th className="px-3 py-2 text-left font-medium">주기</th>
                      <th className="px-3 py-2 text-right font-medium">월 예상</th>
                      <th className="px-3 py-2 text-left font-medium">권장 결제수단</th>
                      <th className="px-3 py-2 text-left font-medium">상태</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {[...subscriptions]
                      .sort((a, b) => a.service.localeCompare(b.service, "ko"))
                      .map((sub) => (
                        <tr key={sub.id} className="align-top hover:bg-zinc-50/70">
                          <td className="px-4 py-2 font-medium text-zinc-900">
                            {sub.service}
                            {sub.note && (
                              <p className="mt-0.5 max-w-[240px] text-xs font-normal text-zinc-400">{sub.note}</p>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {(sub.keywords ?? []).map((k) => (
                                <span key={k} className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-600">
                                  {k}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-zinc-600">
                            {CYCLE_LABEL[sub.cycle] ?? sub.cycle}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-600">
                            {sub.expected ? sub.expected.toLocaleString("ko-KR") : <span className="text-zinc-300">—</span>}
                          </td>
                          <td className="px-3 py-2 text-xs text-zinc-500">{sub.recommendedCard ?? "—"}</td>
                          <td className="px-3 py-2">
                            <Badge color={SUB_STATUS[sub.status]?.color ?? "#71717a"}>
                              {SUB_STATUS[sub.status]?.text ?? sub.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-2 text-right">
                            <Button
                              variant="ghost"
                              onClick={async () => {
                                await deleteFinSubscription(sub.id);
                                await refresh();
                              }}
                            >
                              삭제
                            </Button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {/* 배분 규칙 */}
      {tab === "allocations" && (
        <>
          <Card className="mb-4 border-indigo-200 bg-indigo-50/50">
            <p className="text-sm leading-relaxed text-zinc-700">
              공용·홍대공용에 쌓인 비용을 사업부로 나눠 싣는 규칙입니다. <b>배분은 사실이 아니라 경영
              판단</b>이라 기본은 전부 꺼져 있고, 켜도 원본 장부는 바뀌지 않습니다 —{" "}
              <Link href="/neander/finance/reports/units" className="underline">리포트 › 사업부</Link>에서
              배분 전/후를 나란히 보여줍니다.
            </p>
          </Card>

          <Card className="overflow-hidden p-0">
            {allocations.length === 0 ? (
              <EmptyState
                icon="⚖️"
                title="배분 규칙이 없습니다"
                description="마스터를 적재하면 초안 3개가 비활성 상태로 들어갑니다."
              />
            ) : (
              <ul className="divide-y divide-zinc-100">
                {[...allocations]
                  .sort((a, b) => a.name.localeCompare(b.name, "ko"))
                  .map((rule) => (
                    <li key={rule.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                      <label className="flex shrink-0 cursor-pointer items-center gap-2 pt-0.5">
                        <input
                          type="checkbox"
                          checked={Boolean(rule.active)}
                          disabled={busy !== null}
                          onChange={async (e) => {
                            setBusy(rule.id);
                            try {
                              await setFinAllocationActive(rule.id, e.target.checked);
                              await refresh();
                            } finally {
                              setBusy(null);
                            }
                          }}
                          className="accent-indigo-600"
                        />
                        <span className={cn("text-xs font-medium", rule.active ? "text-indigo-700" : "text-zinc-400")}>
                          {rule.active ? "켜짐" : "꺼짐"}
                        </span>
                      </label>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-zinc-900">{rule.name}</p>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          <b className="font-medium text-zinc-700">
                            {rule.fromMajor} · {rule.fromMinor}
                          </b>
                          {rule.acctMajors?.length ? ` 의 ${rule.acctMajors.join("·")}` : " 의 전체 비용"}
                          {" → "}
                          {rule.targets?.length ? rule.targets.join(", ") : "나머지 전 사업부"}
                          {" · "}
                          {DRIVER_LABEL[rule.driver] ?? rule.driver}
                        </p>
                        {rule.note && <p className="mt-1 text-xs text-zinc-400">{rule.note}</p>}
                      </div>
                      <Button
                        variant="ghost"
                        onClick={async () => {
                          await deleteFinAllocation(rule.id);
                          await refresh();
                        }}
                      >
                        삭제
                      </Button>
                    </li>
                  ))}
              </ul>
            )}
          </Card>
        </>
      )}

      {/* 자동분류 규칙 */}
      {tab === "rules" && (
        <>
          {subscriptions.length > 0 && (
            <Card className="mb-4 border-zinc-200 bg-zinc-50">
              <p className="text-sm text-zinc-600">
                구독 집계는 이제 <b>구독 서비스</b> 탭의 마스터를 씁니다. 이 규칙들은 구독 마스터가
                비어 있을 때의 대비책으로만 남아 있습니다.
              </p>
            </Card>
          )}
          <Card className="mb-4">
            <SectionTitle hint="거래처명에 키워드가 포함되면 해당 서비스로 분류합니다">
              규칙 추가
            </SectionTitle>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="서비스명" className="w-56">
                <Input
                  value={newRule.service}
                  placeholder="예: Anthropic (Claude)"
                  onChange={(e) => setNewRule({ ...newRule, service: e.target.value })}
                />
              </Field>
              <Field label="매칭 키워드" className="w-48">
                <Input
                  value={newRule.keyword}
                  placeholder="예: ANTHROPIC"
                  onChange={(e) => setNewRule({ ...newRule, keyword: e.target.value })}
                />
              </Field>
              <Button
                disabled={!newRule.service.trim() || !newRule.keyword.trim()}
                onClick={async () => {
                  await upsertFinVendorRule({
                    service: newRule.service.trim(),
                    keyword: newRule.keyword.trim(),
                  });
                  await refresh();
                  setNewRule({ service: "", keyword: "" });
                }}
              >
                추가
              </Button>
            </div>
          </Card>

          <Card className="overflow-hidden p-0">
            {vendorRules.length === 0 ? (
              <EmptyState icon="🔎" title="규칙이 없습니다" description="마스터를 적재하거나 직접 추가하세요." />
            ) : (
              <ul className="divide-y divide-zinc-100">
                {[...vendorRules]
                  .sort((a, b) => a.service.localeCompare(b.service, "ko"))
                  .map((r) => (
                    <li key={r.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                      <span className="min-w-0">
                        <span className="font-medium text-zinc-900">{r.service}</span>
                        <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-600">
                          {r.keyword}
                        </span>
                      </span>
                      <Button
                        variant="ghost"
                        onClick={async () => {
                          await deleteFinVendorRule(r.id);
                          await refresh();
                        }}
                      >
                        삭제
                      </Button>
                    </li>
                  ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
