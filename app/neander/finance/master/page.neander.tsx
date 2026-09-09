"use client";

// ============================================================
//  마스터 관리 — 계정 · 계좌/카드 · 구독 · 배분 규칙 · 자동분류 규칙
// ------------------------------------------------------------
//  최초 1회 "마스터 적재"를 눌러 엑셀에서 뽑아둔 기준 정보를
//  Firestore 에 넣는다. 결정적 문서 id 라 여러 번 눌러도 중복되지 않고
//  덮어쓴다.
// ============================================================

import { useMemo, useState } from "react";
import Link from "next/link";
import { CreditCard, Database, FolderTree, Info, Plus, Repeat, Scale, Search, TriangleAlert } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  InlineNotice,
  Input,
  LoadingState,
  PageHeader,
  SectionHeader,
  Select,
  Switch,
  Table,
  TableScroll,
  Tabs,
  Td,
  Th,
  Tr,
  cn,
  type Tone,
} from "@/components/neander/ui";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
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

const KIND_LABEL: Record<string, { text: string; tone: Tone }> = {
  account: { text: "통장", tone: "neutral" },
  card: { text: "카드", tone: "warning" },
  cash: { text: "현금", tone: "success" },
};

const CYCLE_LABEL: Record<string, string> = { monthly: "월정액", usage: "사용량" };
const SUB_STATUS: Record<string, { text: string; tone: Tone }> = {
  active: { text: "사용 중", tone: "success" },
  review: { text: "확인 필요", tone: "warning" },
  cancelled: { text: "해지", tone: "neutral" },
};
const DRIVER_LABEL: Record<string, string> = {
  revenue: "수입 비율",
  expense: "지출 비율",
  fixed: "고정 비율",
};

/** 키워드 칩 — 데이터 문자열이라 mono */
function Keyword({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-[6px] bg-nd-fg/[.06] px-1.5 py-0.5 font-mono text-nd-caption text-nd-fg-2">
      {children}
    </span>
  );
}

export default function MasterPage() {
  const { accounts, paymentMethods, vendorRules, subscriptions, allocations, masterEmpty, loading, refresh } =
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

  const countOf: Record<Tab, number> = {
    accounts: accounts.length,
    methods: paymentMethods.length,
    subscriptions: subscriptions.length,
    allocations: allocations.length,
    rules: vendorRules.length,
  };
  const isSeeding = seeding === "적재 중…";

  // 받아오는 동안 "계정이 없습니다" 가 먼저 보이면 적재를 또 누르게 된다
  if (loading) return <LoadingState label="마스터를 불러오는 중…" />;

  return (
    <div>
      <PageHeader
        title="마스터"
        description="계정·계좌·규칙의 기준 정보. 거래 분류와 파생값(회계코드·부가세·지점)의 근거가 됩니다."
        meta={
          seeding && !isSeeding ? <span className="text-nd-caption text-nd-fg-2">{seeding}</span> : undefined
        }
        actions={
          <Button
            variant={masterEmpty ? "primary" : "secondary"}
            icon={Database}
            loading={isSeeding}
            onClick={seed}
          >
            {masterEmpty ? "마스터 적재하기" : "엑셀 기준으로 다시 적재"}
          </Button>
        }
      />

      {seedError && (
        <ErrorState
          className="mb-4"
          title={seedError.title}
          description={
            <>
              <p>{seedError.detail}</p>
              {seedError.command && (
                <code className="mt-2 inline-block rounded-[6px] bg-nd-content px-2 py-1 font-mono text-nd-caption text-nd-fg">
                  {seedError.command}
                </code>
              )}
            </>
          }
        />
      )}

      {masterEmpty && !seedError && (
        <InlineNotice tone="warning" icon={Info} className="mb-4">
          아직 마스터가 비어 있습니다. <b>마스터 적재하기</b>를 누르면 엑셀 장부에서 뽑아둔
          계정 317개, 계좌·카드 27개, 자동분류 규칙 16개가 들어갑니다.
        </InlineNotice>
      )}

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-nd-line">
        <Tabs
          ariaLabel="마스터 종류"
          size="sm"
          className="border-b-0"
          value={tab}
          onChange={(k) => setTab(k as Tab)}
          items={TABS.map((t) => ({ key: t.key, label: t.label, hint: countOf[t.key].toLocaleString("ko-KR") }))}
        />
        {(tab === "accounts" || tab === "methods") && (
          <span className="relative mb-1.5 inline-block w-56">
            <Input
              size="sm"
              placeholder="검색"
              aria-label="검색"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-8"
            />
            <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-nd-fg-3" />
          </span>
        )}
      </div>

      {/* 계정 */}
      {tab === "accounts" && (
        <Card padding="none" className="overflow-hidden">
          {filteredAccounts.length === 0 ? (
            <EmptyState icon={FolderTree} title="계정이 없습니다" description="마스터를 적재하세요." className="border-0" />
          ) : (
            <TableScroll maxHeight="70vh">
              <Table minWidth={820} dense>
                <thead>
                  <tr>
                    <Th sticky="top" className="pl-5">거래유형</Th>
                    <Th sticky="top">대분류</Th>
                    <Th sticky="top">중분류</Th>
                    <Th sticky="top">소분류</Th>
                    <Th sticky="top">회계코드</Th>
                    <Th sticky="top">부가세</Th>
                    <Th sticky="top" className="pr-5">지점</Th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAccounts.map((a) => (
                    <Tr key={a.id}>
                      <Td muted className="whitespace-nowrap pl-5">{a.txType}</Td>
                      <Td className="whitespace-nowrap text-nd-fg-2">{a.major}</Td>
                      <Td className="whitespace-nowrap text-nd-fg-2">{a.mid}</Td>
                      <Td className="font-medium text-nd-fg">{a.minor}</Td>
                      <Td className="nd-num whitespace-nowrap text-nd-fg-2">{a.code}</Td>
                      <Td className="whitespace-nowrap text-nd-fg-2">{a.vat}</Td>
                      <Td className="whitespace-nowrap pr-5 text-nd-fg-2">{a.branch}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          )}
        </Card>
      )}

      {/* 계좌·카드 */}
      {tab === "methods" && (
        <>
          {legacyMethods.length > 0 && (
            <InlineNotice tone="warning" icon={TriangleAlert} className="mb-4">
              결제수단 {legacyMethods.length}건에 <b>종류(통장·카드·현금)</b>가 없습니다. 현금흐름 기준
              집계는 「카드로 쓴 것」을 구분해야 하는데, 지금은 임직원 개인카드 표시로 대신 판정하고
              있습니다. 위 <b>다시 적재</b>를 누르면 채워집니다.
            </InlineNotice>
          )}
          <Card padding="none" className="overflow-hidden">
            {filteredMethods.length === 0 ? (
              <EmptyState icon={CreditCard} title="계좌·카드가 없습니다" description="마스터를 적재하세요." className="border-0" />
            ) : (
              <TableScroll maxHeight="70vh">
                <Table minWidth={620} dense>
                  <thead>
                    <tr>
                      <Th sticky="top" className="pl-5">뒷 4자리</Th>
                      <Th sticky="top">별칭</Th>
                      <Th sticky="top">사업장</Th>
                      <Th sticky="top">종류</Th>
                      <Th sticky="top" className="pr-5">구분</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMethods.map((p) => (
                      <Tr key={p.id}>
                        <Td className="nd-num pl-5 font-medium text-nd-fg">{p.last4}</Td>
                        <Td>{p.alias}</Td>
                        <Td className="text-nd-fg-2">{p.site}</Td>
                        <Td>
                          {p.kind ? (
                            <Badge tone={KIND_LABEL[p.kind].tone}>{KIND_LABEL[p.kind].text}</Badge>
                          ) : (
                            <span className="text-nd-caption text-nd-warning-text">미지정</span>
                          )}
                        </Td>
                        <Td className="pr-5">
                          {p.personal ? (
                            <Badge tone="warning">임직원 개인카드(대납)</Badge>
                          ) : (
                            <span className="text-nd-fg-3">법인</span>
                          )}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </TableScroll>
            )}
          </Card>
        </>
      )}

      {/* 구독 서비스 */}
      {tab === "subscriptions" && (
        <>
          <Card className="mb-4">
            <SectionHeader
              title="구독 서비스 추가"
              hint="구독 계정 안에서 거래처 키워드를 맞춥니다 · 키워드는 쉼표로 여러 개"
            />
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
                <Select
                  value={newSub.cycle}
                  onChange={(e) => setNewSub({ ...newSub, cycle: e.target.value })}
                >
                  <option value="monthly">월정액</option>
                  <option value="usage">사용량</option>
                </Select>
              </Field>
              <Field label="월 예상액" className="w-32" hint="비우면 과거 중앙값 기준">
                <Input
                  type="number"
                  value={newSub.expected}
                  onChange={(e) => setNewSub({ ...newSub, expected: e.target.value })}
                />
              </Field>
              <Button
                icon={Plus}
                className="mb-[1.35rem]"
                disabled={!newSub.service.trim() || !newSub.keywords.trim()}
                loading={busy === "sub"}
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

          <Card padding="none" className="overflow-hidden">
            {subscriptions.length === 0 ? (
              <EmptyState
                icon={Repeat}
                title="구독 마스터가 비어 있습니다"
                description="마스터를 적재하면 엑셀 「구독서비스 관리」·「구독결제수단 정비」에서 뽑은 22개가 들어갑니다. 그 전까지는 자동분류 규칙으로 대신 집계합니다."
                className="border-0"
              />
            ) : (
              <TableScroll maxHeight="70vh">
                <Table minWidth={820}>
                  <thead>
                    <tr>
                      <Th sticky="top" className="pl-5">서비스</Th>
                      <Th sticky="top">매칭 키워드</Th>
                      <Th sticky="top">주기</Th>
                      <Th sticky="top" align="right">월 예상</Th>
                      <Th sticky="top">권장 결제수단</Th>
                      <Th sticky="top">상태</Th>
                      <Th sticky="top" className="pr-5"><span className="sr-only">동작</span></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...subscriptions]
                      .sort((a, b) => a.service.localeCompare(b.service, "ko"))
                      .map((sub) => (
                        <Tr key={sub.id} className="align-top">
                          <Td className="pl-5 align-top font-medium text-nd-fg">
                            {sub.service}
                            {sub.note && (
                              <p className="mt-0.5 max-w-[240px] text-nd-caption font-normal text-nd-fg-3">{sub.note}</p>
                            )}
                          </Td>
                          <Td className="align-top">
                            <div className="flex flex-wrap gap-1">
                              {(sub.keywords ?? []).map((k) => (
                                <Keyword key={k}>{k}</Keyword>
                              ))}
                            </div>
                          </Td>
                          <Td className="whitespace-nowrap align-top text-nd-fg-2">
                            {CYCLE_LABEL[sub.cycle] ?? sub.cycle}
                          </Td>
                          <Td num className="whitespace-nowrap align-top text-nd-fg-2">
                            {sub.expected ? sub.expected.toLocaleString("ko-KR") : <span className="text-nd-fg-4">—</span>}
                          </Td>
                          <Td muted className="align-top text-nd-caption">{sub.recommendedCard ?? "—"}</Td>
                          <Td className="align-top">
                            <Badge tone={SUB_STATUS[sub.status]?.tone ?? "neutral"}>
                              {SUB_STATUS[sub.status]?.text ?? sub.status}
                            </Badge>
                          </Td>
                          <Td align="right" className="pr-5 align-top">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={async () => {
                                await deleteFinSubscription(sub.id);
                                await refresh();
                              }}
                            >
                              삭제
                            </Button>
                          </Td>
                        </Tr>
                      ))}
                  </tbody>
                </Table>
              </TableScroll>
            )}
          </Card>
        </>
      )}

      {/* 배분 규칙 */}
      {tab === "allocations" && (
        <>
          <InlineNotice tone="accent" icon={Info} className="mb-4">
            공용·홍대공용에 쌓인 비용을 사업부로 나눠 싣는 규칙입니다. <b>배분은 사실이 아니라 경영
            판단</b>이라 기본은 전부 꺼져 있고, 켜도 원본 장부는 바뀌지 않습니다 —{" "}
            <Link href="/neander/finance/reports/units" className="font-medium underline">리포트 › 사업부</Link>에서
            배분 전/후를 나란히 보여줍니다.
          </InlineNotice>

          <Card padding="none" className="overflow-hidden">
            {allocations.length === 0 ? (
              <EmptyState
                icon={Scale}
                title="배분 규칙이 없습니다"
                description="마스터를 적재하면 초안 3개가 비활성 상태로 들어갑니다."
                className="border-0"
              />
            ) : (
              <ul className="divide-y divide-nd-line">
                {[...allocations]
                  .sort((a, b) => a.name.localeCompare(b.name, "ko"))
                  .map((rule) => (
                    <li key={rule.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                      <div className="flex shrink-0 items-center gap-2 pt-0.5">
                        {busy === rule.id ? (
                          <LoadingState size="inline" label="" />
                        ) : (
                          <Switch
                            size="sm"
                            checked={Boolean(rule.active)}
                            disabled={busy !== null}
                            aria-label={`${rule.name} 규칙 ${rule.active ? "끄기" : "켜기"}`}
                            onChange={async (next) => {
                              setBusy(rule.id);
                              try {
                                await setFinAllocationActive(rule.id, next);
                                await refresh();
                              } finally {
                                setBusy(null);
                              }
                            }}
                          />
                        )}
                        <span className={cn("text-nd-caption font-medium", rule.active ? "text-nd-accent-strong" : "text-nd-fg-3")}>
                          {rule.active ? "켜짐" : "꺼짐"}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-nd-body font-medium text-nd-fg">{rule.name}</p>
                        <p className="mt-0.5 text-nd-caption text-nd-fg-2">
                          <b className="font-medium text-nd-fg">
                            {rule.fromMajor} · {rule.fromMinor}
                          </b>
                          {rule.acctMajors?.length ? ` 의 ${rule.acctMajors.join("·")}` : " 의 전체 비용"}
                          {" → "}
                          {rule.targets?.length ? rule.targets.join(", ") : "나머지 전 사업부"}
                          {" · "}
                          {DRIVER_LABEL[rule.driver] ?? rule.driver}
                        </p>
                        {rule.note && <p className="mt-1 text-nd-caption text-nd-fg-3">{rule.note}</p>}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
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
            <InlineNotice tone="neutral" icon={Info} className="mb-4">
              구독 집계는 이제 <b>구독 서비스</b> 탭의 마스터를 씁니다. 이 규칙들은 구독 마스터가
              비어 있을 때의 대비책으로만 남아 있습니다.
            </InlineNotice>
          )}
          <Card className="mb-4">
            <SectionHeader title="규칙 추가" hint="거래처명에 키워드가 포함되면 해당 서비스로 분류합니다" />
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
                icon={Plus}
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

          <Card padding="none" className="overflow-hidden">
            {vendorRules.length === 0 ? (
              <EmptyState icon={Search} title="규칙이 없습니다" description="마스터를 적재하거나 직접 추가하세요." className="border-0" />
            ) : (
              <ul className="divide-y divide-nd-line">
                {[...vendorRules]
                  .sort((a, b) => a.service.localeCompare(b.service, "ko"))
                  .map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-nd-body">
                      <span className="min-w-0">
                        <span className="font-medium text-nd-fg">{r.service}</span>
                        <span className="ml-2"><Keyword>{r.keyword}</Keyword></span>
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
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
