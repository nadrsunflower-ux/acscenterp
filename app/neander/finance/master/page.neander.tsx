"use client";

// ============================================================
//  마스터 관리 — 계정 · 계좌/카드 · 구독 · 배분 규칙 · 자동분류 규칙
// ------------------------------------------------------------
//  최초 1회 "마스터 적재"를 눌러 엑셀에서 뽑아둔 기준 정보를
//  Firestore 에 넣는다. 결정적 문서 id 라 여러 번 눌러도 중복되지 않고
//  덮어쓴다.
//
//  화면 구성은 승인 목업(all-pages/finance-master.png)을 따른다:
//  제목 줄 → 탭 → 조회 조건 줄(FilterBar) → 카드(표·목록) → 쪽 넘김.
//  탭마다 규칙이 달라지면 "이 탭에서는 검색이 어디 있더라"를 매번 다시
//  찾게 된다 — 다섯 탭 모두 같은 순서로 둔다.
//
//  추가 폼은 Dialog 다. 표 위에 인라인으로 펼치면 목록이 아래로 밀려,
//  방금 무엇이 있었는지 확인하며 입력할 수 없다.
// ============================================================

import { useMemo, useState } from "react";
import Link from "next/link";
import { CreditCard, Database, FolderTree, Info, Plus, Repeat, Scale, Search, TriangleAlert } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  FilterBar,
  FilterField,
  InlineNotice,
  Input,
  LoadingState,
  PageHeader,
  PageShell,
  Pagination,
  SearchInput,
  SectionHeader,
  Select,
  Switch,
  Table,
  TableNote,
  TableScroll,
  Tabs,
  Td,
  Th,
  Tr,
  cn,
  useConfirm,
  type Tone,
} from "@/components/neander/ui";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import {
  seedFinanceMaster,
  updateFinPaymentMethod,
  upsertFinVendorRule,
  deleteFinVendorRule,
  upsertFinSubscription,
  deleteFinSubscription,
  setFinAllocationActive,
  deleteFinAllocation,
} from "@/lib/neander/finance/client";
import { legacyPaymentMethods } from "@/lib/neander/finance/report";
import { FIN_BANKS, bankOfMethod, isMonthlyAccount, type FinBankId } from "@/lib/neander/finance/import-slots";
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

/** 탭마다 무엇으로 찾는지가 다르다 — 검색칸이 스스로 알려준다 */
const SEARCH_HINT: Record<Tab, string> = {
  accounts: "계정명 · 회계코드",
  methods: "뒷 4자리 · 별칭 · 사업장",
  subscriptions: "서비스명 · 키워드",
  allocations: "규칙명 · 계정",
  rules: "서비스명 · 키워드",
};

const ALL_TX = "__all__";

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

/** 키워드 칩 — 데이터 문자열이라 mono. 색·모서리는 공통 Badge 가 정한다 */
function Keyword({ children }: { children: React.ReactNode }) {
  return (
    <Badge tone="neutral" size="sm" className="font-mono">
      {children}
    </Badge>
  );
}

export default function MasterPage() {
  const { accounts, paymentMethods, vendorRules, subscriptions, allocations, masterEmpty, loading, refresh } =
    useFinance();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>("accounts");
  const [q, setQ] = useState("");
  const [txType, setTxType] = useState(ALL_TX);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [seeding, setSeeding] = useState<string | null>(null);
  const [seedError, setSeedError] = useState<FriendlyError | null>(null);
  // 결제수단 한 칸을 고치다 실패한 것과 마스터 적재가 통째로 실패한 것은
  // 고칠 방법이 다르다 — 한 곳에 모으면 무엇이 실패했는지 알 수 없다.
  const [methodError, setMethodError] = useState<FriendlyError | null>(null);
  const [adding, setAdding] = useState<null | "sub" | "rule">(null);
  const [busy, setBusy] = useState<string | null>(null);

  const legacyMethods = useMemo(() => legacyPaymentMethods(paymentMethods), [paymentMethods]);

  /** 계좌·카드 한 건의 은행·월별 적재 대상 — 엑셀 임포트 퍼즐의 칸이 여기서 정해진다 */
  const patchMethod = async (id: string, patch: { bank?: FinBankId | null; monthly?: boolean | null }) => {
    setMethodError(null);
    try {
      await updateFinPaymentMethod(id, patch);
      await refresh();
    } catch (e) {
      setMethodError(describeFinanceError(e));
    }
  };

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

  const txTypes = useMemo(
    () => [...new Set(accounts.map((a) => a.txType).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko")),
    [accounts],
  );

  const filteredAccounts = useMemo(() => {
    const s = q.trim().toLowerCase();
    const rows = [...accounts]
      .sort((a, b) => a.lookupKey.localeCompare(b.lookupKey, "ko"))
      .filter((a) => txType === ALL_TX || a.txType === txType);
    if (!s) return rows;
    return rows.filter((a) =>
      [a.major, a.mid, a.minor, a.code, a.example].join(" ").toLowerCase().includes(s),
    );
  }, [accounts, q, txType]);

  const filteredMethods = useMemo(() => {
    const s = q.trim().toLowerCase();
    const rows = [...paymentMethods].sort((a, b) => a.last4.localeCompare(b.last4));
    if (!s) return rows;
    return rows.filter((p) => [p.last4, p.alias, p.site].join(" ").toLowerCase().includes(s));
  }, [paymentMethods, q]);

  const filteredSubs = useMemo(() => {
    const s = q.trim().toLowerCase();
    const rows = [...subscriptions].sort((a, b) => a.service.localeCompare(b.service, "ko"));
    if (!s) return rows;
    return rows.filter((x) =>
      [x.service, (x.keywords ?? []).join(" "), x.note ?? ""].join(" ").toLowerCase().includes(s),
    );
  }, [subscriptions, q]);

  const filteredAllocations = useMemo(() => {
    const s = q.trim().toLowerCase();
    const rows = [...allocations].sort((a, b) => a.name.localeCompare(b.name, "ko"));
    if (!s) return rows;
    return rows.filter((r) =>
      [r.name, r.fromMajor, r.fromMinor, r.note ?? ""].join(" ").toLowerCase().includes(s),
    );
  }, [allocations, q]);

  const filteredRules = useMemo(() => {
    const s = q.trim().toLowerCase();
    const rows = [...vendorRules].sort((a, b) => a.service.localeCompare(b.service, "ko"));
    if (!s) return rows;
    return rows.filter((r) => [r.service, r.keyword].join(" ").toLowerCase().includes(s));
  }, [vendorRules, q]);

  const countOf: Record<Tab, number> = {
    accounts: accounts.length,
    methods: paymentMethods.length,
    subscriptions: subscriptions.length,
    allocations: allocations.length,
    rules: vendorRules.length,
  };
  const isSeeding = seeding === "적재 중…";

  // 조건이 바뀌면 첫 쪽으로 — 3쪽을 보던 중 검색하면 빈 쪽이 나온다
  const resetPage = () => setPage(1);
  const paged = <T,>(rows: T[]) => rows.slice((page - 1) * pageSize, page * pageSize);

  /** 카드 아래 쪽 넘김 줄 — 다섯 탭이 같은 자리에 같은 모양으로 쓴다 */
  const pager = (total: number) => (
    <div className="border-t border-nd-line px-5 py-2.5">
      <Pagination
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(n) => {
          setPageSize(n);
          resetPage();
        }}
      />
    </div>
  );

  const removeSubscription = async (id: string, service: string) => {
    // 삭제는 되돌릴 수 없다 — 다른 재무 화면과 같이 한 단계 확인을 둔다
    if (
      !(await confirm({
        title: `구독 「${service}」을 지울까요?`,
        message: "이 서비스의 집계 기준이 사라집니다. 과거 거래는 지워지지 않습니다.",
        confirmLabel: "삭제",
        tone: "danger",
      }))
    )
      return;
    await deleteFinSubscription(id);
    await refresh();
  };

  const removeAllocation = async (id: string, name: string) => {
    if (
      !(await confirm({
        title: `배분 규칙 「${name}」을 지울까요?`,
        message: "리포트 › 사업부의 배분 후 숫자가 이 규칙만큼 달라집니다.",
        confirmLabel: "삭제",
        tone: "danger",
      }))
    )
      return;
    await deleteFinAllocation(id);
    await refresh();
  };

  const removeRule = async (id: string, service: string, keyword: string) => {
    if (
      !(await confirm({
        title: `자동분류 규칙을 지울까요?`,
        message: `「${keyword}」 → ${service} 규칙이 사라져 이후 거래가 자동으로 묶이지 않습니다.`,
        confirmLabel: "삭제",
        tone: "danger",
      }))
    )
      return;
    await deleteFinVendorRule(id);
    await refresh();
  };

  // 받아오는 동안 "계정이 없습니다" 가 먼저 보이면 적재를 또 누르게 된다
  if (loading) return <LoadingState label="마스터를 불러오는 중…" />;

  return (
    <PageShell width="wide">
      <PageHeader
        title="마스터"
        description="계정·계좌·규칙의 기준 정보. 거래 분류와 파생값(회계코드·부가세·지점)의 근거가 됩니다."
        className="mb-4"
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

      {/* 적재 실패 — 페이지 전체에 걸린 문제라 제목 바로 아래 */}
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

      <Tabs
        className="mb-3"
        ariaLabel="마스터 종류"
        size="sm"
        value={tab}
        onChange={(k) => {
          setTab(k as Tab);
          setQ("");
          setTxType(ALL_TX);
          resetPage();
        }}
        items={TABS.map((t) => ({ key: t.key, label: t.label, hint: countOf[t.key].toLocaleString("ko-KR") }))}
      />

      {/* 조회 조건 줄 — 다섯 탭 모두 같은 자리, 같은 순서 */}
      <FilterBar
        className="mb-4"
        actions={
          tab === "subscriptions" ? (
            <Button size="sm" icon={Plus} onClick={() => setAdding("sub")}>
              구독 추가
            </Button>
          ) : tab === "rules" ? (
            <Button size="sm" icon={Plus} onClick={() => setAdding("rule")}>
              규칙 추가
            </Button>
          ) : undefined
        }
      >
        {tab === "accounts" && (
          <FilterField label="거래유형" htmlFor="master-txtype">
            <Select
              id="master-txtype"
              size="sm"
              className="w-auto min-w-[8rem]"
              value={txType}
              onChange={(e) => {
                setTxType(e.target.value);
                resetPage();
              }}
            >
              <option value={ALL_TX}>전체</option>
              {txTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
          </FilterField>
        )}
        <FilterField label="검색" htmlFor="master-q">
          <SearchInput
            id="master-q"
            className="w-64"
            value={q}
            onValueChange={(v) => {
              setQ(v);
              resetPage();
            }}
            placeholder={SEARCH_HINT[tab]}
            ariaLabel={`${TABS.find((t) => t.key === tab)?.label} 검색`}
          />
        </FilterField>
      </FilterBar>

      {/* 계정 */}
      {tab === "accounts" && (
        <Card padding="none" className="overflow-hidden">
          <div className="px-5 pt-5">
            <SectionHeader
              title="계정"
              hint={`${filteredAccounts.length.toLocaleString("ko-KR")}건`}
              action={<TableNote>통합_MAP 순서</TableNote>}
            />
          </div>
          {filteredAccounts.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState
                compact
                icon={FolderTree}
                title="계정이 없습니다"
                description={q || txType !== ALL_TX ? "조건에 맞는 계정이 없습니다." : "마스터를 적재하세요."}
                className="border-0"
              />
            </div>
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
                  {paged(filteredAccounts).map((a) => (
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
          {pager(filteredAccounts.length)}
        </Card>
      )}

      {/* 계좌·카드 */}
      {tab === "methods" && (
        <Card padding="none" className="overflow-hidden">
          <div className="px-5 pt-5">
            <SectionHeader
              title="계좌·카드"
              hint={`${filteredMethods.length.toLocaleString("ko-KR")}건`}
            />
            {/* 한 칸 고치기가 실패한 것 — 그 표 바로 위에 둬야 무엇이 안 저장됐는지 안다 */}
            {methodError && (
              <ErrorState
                className="mb-3"
                title={methodError.title}
                description={
                  <>
                    <p>{methodError.detail}</p>
                    {methodError.command && (
                      <code className="mt-2 inline-block rounded-[6px] bg-nd-content px-2 py-1 font-mono text-nd-caption text-nd-fg">
                        {methodError.command}
                      </code>
                    )}
                  </>
                }
              />
            )}
            {legacyMethods.length > 0 && (
              <InlineNotice tone="warning" icon={TriangleAlert} className="mb-3">
                결제수단 {legacyMethods.length}건에 <b>종류(통장·카드·현금)</b>가 없습니다. 현금흐름 기준
                집계는 「카드로 쓴 것」을 구분해야 하는데, 지금은 임직원 개인카드 표시로 대신 판정하고
                있습니다. 위 <b>다시 적재</b>를 누르면 채워집니다.
              </InlineNotice>
            )}
          </div>
          {filteredMethods.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState
                compact
                icon={CreditCard}
                title="계좌·카드가 없습니다"
                description={q ? "조건에 맞는 계좌·카드가 없습니다." : "마스터를 적재하세요."}
                className="border-0"
              />
            </div>
          ) : (
            <TableScroll maxHeight="70vh">
              <Table minWidth={900} dense>
                <thead>
                  <tr>
                    <Th sticky="top" className="pl-5">뒷 4자리</Th>
                    <Th sticky="top">별칭</Th>
                    <Th sticky="top">사업장</Th>
                    <Th sticky="top">종류</Th>
                    <Th sticky="top">은행·카드사</Th>
                    <Th sticky="top">월별 적재</Th>
                    <Th sticky="top" className="pr-5">구분</Th>
                  </tr>
                </thead>
                <tbody>
                  {paged(filteredMethods).map((p) => {
                    const bank = bankOfMethod(p);
                    const bankOptions = FIN_BANKS.filter((b) => b.kind === (p.kind === "card" ? "card" : "account"));
                    return (
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
                        <Td>
                          {p.kind === "cash" ? (
                            <span className="text-nd-fg-3">—</span>
                          ) : (
                            <Select
                              size="sm"
                              className="w-36"
                              aria-label={`${p.alias} 은행·카드사`}
                              value={bank ?? ""}
                              onChange={(e) => void patchMethod(p.id, { bank: (e.target.value || null) as FinBankId | null })}
                            >
                              <option value="">{p.bank ? "(비움)" : "(별칭으로 추정)"}</option>
                              {bankOptions.map((b) => (
                                <option key={b.id} value={b.id}>
                                  {b.label}
                                </option>
                              ))}
                            </Select>
                          )}
                        </Td>
                        <Td>
                          {p.kind === "account" ? (
                            <Switch
                              size="sm"
                              checked={isMonthlyAccount(p)}
                              aria-label={`${p.alias} 월별 적재 대상`}
                              onChange={(next) => void patchMethod(p.id, { monthly: next })}
                            />
                          ) : p.kind === "card" ? (
                            <span className="text-nd-caption text-nd-fg-3">카드사 한 칸</span>
                          ) : (
                            <span className="text-nd-fg-3">—</span>
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
                    );
                  })}
                </tbody>
              </Table>
            </TableScroll>
          )}
          <div className="border-t border-nd-line px-5 py-3">
            <TableNote>
              「월별 적재」가 켜진 통장이 엑셀 임포트 퍼즐의 한 칸이 됩니다. 대출·현금은 파일이 따로 없어
              끕니다. 카드는 카드사가 모든 카드를 한 파일에 담아 주므로 카드사마다 한 칸입니다.
            </TableNote>
          </div>
          {pager(filteredMethods.length)}
        </Card>
      )}

      {/* 구독 서비스 */}
      {tab === "subscriptions" && (
        <Card padding="none" className="overflow-hidden">
          <div className="px-5 pt-5">
            <SectionHeader
              title="구독 서비스"
              hint={`${filteredSubs.length.toLocaleString("ko-KR")}건`}
              action={<TableNote>구독 계정 안에서 거래처 키워드를 맞춥니다</TableNote>}
            />
          </div>
          {filteredSubs.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState
                compact
                icon={Repeat}
                title={q ? "조건에 맞는 구독이 없습니다" : "구독 마스터가 비어 있습니다"}
                description={
                  q
                    ? "검색어를 지워 보세요."
                    : "마스터를 적재하면 엑셀 「구독서비스 관리」·「구독결제수단 정비」에서 뽑은 22개가 들어갑니다. 그 전까지는 자동분류 규칙으로 대신 집계합니다."
                }
                className="border-0"
              />
            </div>
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
                  {paged(filteredSubs).map((sub) => (
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
                          aria-label={`${sub.service} 삭제`}
                          onClick={() => void removeSubscription(sub.id, sub.service)}
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
          {pager(filteredSubs.length)}
        </Card>
      )}

      {/* 배분 규칙 */}
      {tab === "allocations" && (
        <Card padding="none" className="overflow-hidden">
          <div className="px-5 pt-5">
            <SectionHeader
              title="배분 규칙"
              hint={`${filteredAllocations.length.toLocaleString("ko-KR")}건`}
            />
            <InlineNotice tone="accent" icon={Info} className="mb-3">
              공용·홍대공용에 쌓인 비용을 사업부로 나눠 싣는 규칙입니다. <b>배분은 사실이 아니라 경영
              판단</b>이라 기본은 전부 꺼져 있고, 켜도 원본 장부는 바뀌지 않습니다 —{" "}
              <Link href="/neander/finance/reports/units" className="font-medium underline">리포트 › 사업부</Link>에서
              배분 전/후를 나란히 보여줍니다.
            </InlineNotice>
          </div>
          {filteredAllocations.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState
                compact
                icon={Scale}
                title={q ? "조건에 맞는 배분 규칙이 없습니다" : "배분 규칙이 없습니다"}
                description={q ? "검색어를 지워 보세요." : "마스터를 적재하면 초안 3개가 비활성 상태로 들어갑니다."}
                className="border-0"
              />
            </div>
          ) : (
            <ul className="divide-y divide-nd-line border-t border-nd-line">
              {paged(filteredAllocations).map((rule) => (
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
                    aria-label={`${rule.name} 삭제`}
                    onClick={() => void removeAllocation(rule.id, rule.name)}
                  >
                    삭제
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {pager(filteredAllocations.length)}
        </Card>
      )}

      {/* 자동분류 규칙 */}
      {tab === "rules" && (
        <Card padding="none" className="overflow-hidden">
          <div className="px-5 pt-5">
            <SectionHeader
              title="자동분류 규칙"
              hint={`${filteredRules.length.toLocaleString("ko-KR")}건`}
              action={<TableNote>거래처명에 키워드가 포함되면 해당 서비스로 분류합니다</TableNote>}
            />
            {subscriptions.length > 0 && (
              <InlineNotice tone="neutral" icon={Info} className="mb-3">
                구독 집계는 이제 <b>구독 서비스</b> 탭의 마스터를 씁니다. 이 규칙들은 구독 마스터가
                비어 있을 때의 대비책으로만 남아 있습니다.
              </InlineNotice>
            )}
          </div>
          {filteredRules.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState
                compact
                icon={Search}
                title={q ? "조건에 맞는 규칙이 없습니다" : "규칙이 없습니다"}
                description={q ? "검색어를 지워 보세요." : "마스터를 적재하거나 직접 추가하세요."}
                className="border-0"
              />
            </div>
          ) : (
            <ul className="divide-y divide-nd-line border-t border-nd-line">
              {paged(filteredRules).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-nd-body">
                  <span className="min-w-0">
                    <span className="font-medium text-nd-fg">{r.service}</span>
                    <span className="ml-2"><Keyword>{r.keyword}</Keyword></span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`${r.service} 규칙 삭제`}
                    onClick={() => void removeRule(r.id, r.service, r.keyword)}
                  >
                    삭제
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {pager(filteredRules.length)}
        </Card>
      )}

      {/* 추가 폼 — 목록을 밀어내지 않도록 Dialog 로 */}
      {adding === "sub" && (
        <AddSubscriptionDialog
          busy={busy === "sub"}
          onClose={() => setAdding(null)}
          onSubmit={async (v) => {
            setBusy("sub");
            try {
              await upsertFinSubscription({
                service: v.service.trim(),
                keywords: v.keywords.split(",").map((k) => k.trim()).filter(Boolean),
                cycle: v.cycle as "monthly" | "usage",
                expected: v.expected ? Number(v.expected) : undefined,
                status: "active",
              });
              await refresh();
              setAdding(null);
            } finally {
              setBusy(null);
            }
          }}
        />
      )}

      {adding === "rule" && (
        <AddRuleDialog
          onClose={() => setAdding(null)}
          onSubmit={async (v) => {
            await upsertFinVendorRule({
              service: v.service.trim(),
              keyword: v.keyword.trim(),
            });
            await refresh();
            setAdding(null);
          }}
        />
      )}
    </PageShell>
  );
}

/** 구독 서비스 추가 — 저장 인자는 예전 인라인 폼과 같다 */
function AddSubscriptionDialog({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (v: { service: string; keywords: string; cycle: string; expected: string }) => Promise<void>;
}) {
  const [form, setForm] = useState({ service: "", keywords: "", cycle: "monthly", expected: "" });
  return (
    <Dialog
      open
      onClose={onClose}
      closeOnOverlay={false}
      size="md"
      title="구독 서비스 추가"
      description="구독 계정 안에서 거래처 키워드를 맞춥니다 · 키워드는 쉼표로 여러 개"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>취소</Button>
          <Button
            icon={Plus}
            loading={busy}
            disabled={!form.service.trim() || !form.keywords.trim()}
            onClick={() => void onSubmit(form)}
          >
            추가
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="서비스명" className="sm:col-span-2">
          <Input
            value={form.service}
            placeholder="예: Anthropic (Claude)"
            autoFocus
            onChange={(e) => setForm({ ...form, service: e.target.value })}
          />
        </Field>
        <Field label="매칭 키워드" className="sm:col-span-2" hint="같은 서비스가 여러 이름으로 찍히면 모두 적으세요">
          <Input
            value={form.keywords}
            placeholder="ANTHROPIC, CLAUDE"
            onChange={(e) => setForm({ ...form, keywords: e.target.value })}
          />
        </Field>
        <Field label="결제 주기">
          <Select value={form.cycle} onChange={(e) => setForm({ ...form, cycle: e.target.value })}>
            <option value="monthly">월정액</option>
            <option value="usage">사용량</option>
          </Select>
        </Field>
        <Field label="월 예상액" hint="비우면 과거 중앙값 기준">
          <Input
            type="number"
            value={form.expected}
            className="nd-num text-right"
            onChange={(e) => setForm({ ...form, expected: e.target.value })}
          />
        </Field>
      </div>
    </Dialog>
  );
}

/** 자동분류 규칙 추가 */
function AddRuleDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (v: { service: string; keyword: string }) => Promise<void>;
}) {
  const [form, setForm] = useState({ service: "", keyword: "" });
  const [saving, setSaving] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      closeOnOverlay={false}
      size="md"
      title="자동분류 규칙 추가"
      description="거래처명에 키워드가 포함되면 해당 서비스로 분류합니다"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>취소</Button>
          <Button
            icon={Plus}
            loading={saving}
            disabled={!form.service.trim() || !form.keyword.trim()}
            onClick={async () => {
              setSaving(true);
              try {
                await onSubmit(form);
              } finally {
                setSaving(false);
              }
            }}
          >
            추가
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="서비스명">
          <Input
            value={form.service}
            placeholder="예: Anthropic (Claude)"
            autoFocus
            onChange={(e) => setForm({ ...form, service: e.target.value })}
          />
        </Field>
        <Field label="매칭 키워드">
          <Input
            value={form.keyword}
            placeholder="예: ANTHROPIC"
            onChange={(e) => setForm({ ...form, keyword: e.target.value })}
          />
        </Field>
      </div>
    </Dialog>
  );
}
