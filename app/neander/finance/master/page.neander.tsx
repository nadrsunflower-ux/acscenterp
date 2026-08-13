"use client";

// ============================================================
//  마스터 관리 — 계정 · 계좌/카드 · 자동분류 규칙
// ------------------------------------------------------------
//  최초 1회 "마스터 적재"를 눌러 엑셀에서 뽑아둔 기준 정보를
//  Firestore 에 넣는다. 결정적 문서 id 라 여러 번 눌러도 중복되지 않고
//  덮어쓴다.
// ============================================================

import { useMemo, useState } from "react";
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
} from "@/lib/neander/finance/db";
import { cn } from "@/components/neander/ui";

type Tab = "accounts" | "methods" | "rules";

const TABS: { key: Tab; label: string }[] = [
  { key: "accounts", label: "계정" },
  { key: "methods", label: "계좌·카드" },
  { key: "rules", label: "자동분류 규칙" },
];

export default function MasterPage() {
  const { accounts, paymentMethods, vendorRules, masterEmpty } = useFinance();
  const [tab, setTab] = useState<Tab>("accounts");
  const [q, setQ] = useState("");
  const [seeding, setSeeding] = useState<string | null>(null);
  const [newRule, setNewRule] = useState({ service: "", keyword: "" });

  const seed = async () => {
    setSeeding("시작…");
    try {
      const r = await seedFinanceMaster((label, done, total) =>
        setSeeding(`${label} ${done}/${total}`),
      );
      setSeeding(
        `완료 — 계정 ${r.accounts} · 계좌/카드 ${r.paymentMethods} · 규칙 ${r.vendorRules}`,
      );
    } catch (e) {
      setSeeding(`실패: ${e instanceof Error ? e.message : String(e)}`);
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

      {masterEmpty && (
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
                    : vendorRules.length}
              </span>
            </button>
          ))}
        </div>
        {tab !== "rules" && (
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
                  <th className="px-4 py-2 text-left font-medium">구분</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filteredMethods.map((p) => (
                  <tr key={p.id} className="hover:bg-zinc-50/70">
                    <td className="px-4 py-1.5 tabular-nums font-medium text-zinc-900">{p.last4}</td>
                    <td className="px-3 py-1.5 text-zinc-700">{p.alias}</td>
                    <td className="px-3 py-1.5 text-zinc-600">{p.site}</td>
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
      )}

      {/* 자동분류 규칙 */}
      {tab === "rules" && (
        <>
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
                  await upsertFinVendorRule(newRule.keyword.trim(), {
                    service: newRule.service.trim(),
                    keyword: newRule.keyword.trim(),
                  });
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
                      <Button variant="ghost" onClick={() => deleteFinVendorRule(r.id)}>
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
