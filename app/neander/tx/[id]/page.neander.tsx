"use client";

// ============================================================
//  거래 한 건 확인 — 폰에서 (노션 입출금 · 카드 알림의 링크)
// ------------------------------------------------------------
//  문자로 들어온 거래를 돈이 움직인 그때 확정하고 프로젝트에 붙인다.
//    · 맞음 — 엔진이 붙인 분류 그대로 확정
//    · 다른 분류 — 이 거래처의 과거 분류(누르면 확정) · 계정 찾기
//    · 받을 돈 — 입금이면 금액이 같은 안 받은 회차를 한 번에 「받음」 (project.markReceived)
//    · 프로젝트 — 그날 진행 중인 프로젝트가 위에. 고르면 그 프로젝트 원가 · 매출로 잡힌다
//  재무 화면(/neander/finance/*)은 장부 전체를 받으므로 이 화면은 그 밖에 둔다 — 폰에서 바로 열리게.
//  쓰기는 재무 화면과 같은 길(mutate)이다. 고친 것은 엔진이 장부 이력으로 다시 배운다.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Check, ChevronRight, FolderKanban, Landmark, CreditCard, Search, X } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Input,
  LoadingState,
  Money,
  PageShell,
  SectionHeader,
  cn,
  useToast,
} from "@/components/neander/ui";
import { useAuth } from "@/components/neander/auth";
import { markFinReceipt, updateFinTransaction } from "@/lib/neander/finance/client";
import { accountPatch, accountsFor, fetchTxCard, projectPatch, type TxCardData, type TxCardProject } from "@/lib/neander/finance/tx-card";
import type { FinTransactionInput } from "@/lib/neander/finance/types";

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
const STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" }> = {
  confirmed: { label: "확정", tone: "success" },
  suggested: { label: "제안", tone: "warning" },
  needs_review: { label: "확인 필요", tone: "danger" },
};
const path = (...xs: (string | undefined)[]) => xs.filter(Boolean).join(" › ");
const whenOf = (datetime?: string, date?: string) => {
  const d = datetime ?? date ?? "";
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}${d.length > 11 ? ` ${d.slice(11, 16)}` : ""}`;
};

export default function TxCardPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params?.id ?? ""));
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<TxCardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pickAccount, setPickAccount] = useState(false);
  const [pickProject, setPickProject] = useState(false);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await fetchTxCard(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오지 못했습니다.");
    }
  }, [id]);
  useEffect(() => {
    if (authLoading || !user) return;
    void load();
  }, [authLoading, user, load]);

  const tx = data?.tx;
  const income = tx ? tx.txType === "수입" || tx.txType === "환급" || (tx.txType === "지출" && tx.gross < 0) : false;

  /** 쓰고 → 다시 읽는다 (서버가 고친 값 · 받을 돈이 바로 보이게) */
  const run = async (key: string, label: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      toast.success(label);
      setPickAccount(false);
      setPickProject(false);
      setQ("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };
  const patch = (key: string, label: string, p: Partial<FinTransactionInput>) => run(key, label, () => updateFinTransaction(id, p, "phone"));

  const accounts = useMemo(() => {
    if (!data || !tx) return [];
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return accountsFor(tx, data.accounts)
      .filter((a) => words.every((w) => `${a.major} ${a.mid} ${a.minor}`.toLowerCase().includes(w)))
      .slice(0, 40);
  }, [data, tx, q]);
  const projects = useMemo(() => {
    if (!data) return [];
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return data.projects.filter((p) => words.every((w) => `${p.code} ${p.name} ${p.client ?? ""}`.toLowerCase().includes(w)));
  }, [data, q]);
  const currentProject = data?.projects.find((p) => p.code.trim().toLowerCase() === (tx?.projectCode ?? "").trim().toLowerCase());

  if (authLoading || (!data && !error)) {
    return (
      <PageShell width="narrow">
        <LoadingState label="거래를 불러오는 중…" />
      </PageShell>
    );
  }
  if (!user) {
    return (
      <PageShell width="narrow">
        <ErrorState title="로그인이 필요합니다" description="ERP 에 로그인한 뒤 다시 열어 주세요." />
      </PageShell>
    );
  }
  if (error || !data || !tx) {
    return (
      <PageShell width="narrow">
        <ErrorState title="거래를 열지 못했습니다" description={error ?? ""} action={<Button onClick={() => void load()}>다시 시도</Button>} />
      </PageShell>
    );
  }

  const st = STATUS[tx.status] ?? STATUS.needs_review;
  const amount = Math.abs(tx.gross - (tx.adjust ?? 0));
  const received = (tx.receiptOf ?? []).length > 0;

  return (
    <PageShell width="narrow" className="pb-24">
      {/* ---- 무슨 거래 ---- */}
      <Card className="mb-4">
        <div className="flex items-center gap-2 text-nd-body text-nd-fg-2">
          {data.kind === "card" ? <CreditCard size={16} aria-hidden /> : <Landmark size={16} aria-hidden />}
          <span>{data.where}</span>
          <span className="text-nd-fg-3">· {whenOf(tx.datetime, tx.date)}</span>
          {tx.smsOpen ? (
            <Badge size="sm" tone="neutral" className="ml-auto">
              문자로 들어옴
            </Badge>
          ) : null}
        </div>
        <div className="mt-2 text-nd-title font-semibold">{tx.vendor || "거래처 모름"}</div>
        <div className="mt-1 text-nd-display font-bold">
          <Money value={income ? amount : -amount} flow={income ? "income" : "expense"} />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Badge tone={st.tone}>{st.label}</Badge>
          <span className="text-nd-body">{path(tx.acctMajor, tx.acctMid, tx.acctMinor) || "분류 없음"}</span>
        </div>
        {tx.bizMajor ? <div className="mt-1 text-nd-body text-nd-fg-2">사업 {path(tx.bizMajor, tx.bizMinor)}</div> : null}
        {tx.classReason ? <div className="mt-2 text-nd-body text-nd-fg-3">{tx.classReason}</div> : null}
        {tx.status !== "confirmed" && tx.acctMinor ? (
          <Button className="mt-4 w-full" size="lg" icon={Check} loading={busy === "ok"} onClick={() => void patch("ok", "확정했습니다", { status: "confirmed" })}>
            맞음 — 이대로 확정
          </Button>
        ) : null}
      </Card>

      {/* ---- 받을 돈 (입금) ---- */}
      {income && !received && data.receipts.length > 0 ? (
        <>
          <SectionHeader title="이 입금, 이 대금인가요?" hint="금액(부가세 포함)이 같은 안 받은 회차" />
          <Card padding="none" className="mb-4 divide-y divide-nd-line">
            {data.receipts.map((r) => (
              <button
                key={`${r.projectId}:${r.installmentId}`}
                type="button"
                disabled={!!busy || !r.projectId || !r.installmentId}
                onClick={() =>
                  void run(`r:${r.installmentId}`, `${r.name} ${r.kind} 받음으로 바꿨습니다`, () => markFinReceipt(r.projectId!, [r.installmentId!], id))
                }
                className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-nd-sunken"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-nd-body font-semibold">
                    {r.name} · {r.kind}
                  </div>
                  <div className="text-nd-body text-nd-fg-3">
                    {r.code} · {won(r.billed)}
                    {r.nameMatch ? " · 입금자 이름도 같음" : " · 금액만 같음"}
                  </div>
                </div>
                <span className="shrink-0 text-nd-body font-semibold text-nd-accent">받음</span>
              </button>
            ))}
          </Card>
        </>
      ) : null}
      {received ? (
        <Card className="mb-4 text-nd-body">
          <FolderKanban size={16} className="mr-1 inline" aria-hidden />
          {currentProject ? `${currentProject.name} 대금으로 받음 처리됨` : `프로젝트 ${tx.projectCode ?? ""} 대금으로 받음 처리됨`}
        </Card>
      ) : null}

      {/* ---- 분류 ---- */}
      <SectionHeader title="어디에 쓴 돈" hint={data.candidateBasis ? `이 거래처 ${data.candidateBasis}` : undefined} />
      <Card padding="none" className="mb-2 divide-y divide-nd-line">
        {data.candidates.length === 0 ? <div className="px-4 py-3 text-nd-body text-nd-fg-3">이 거래처는 처음입니다 — 아래에서 계정을 찾아 주세요.</div> : null}
        {data.candidates.map((c) => {
          const same = c.acctMinor === tx.acctMinor && c.acctMid === tx.acctMid && c.txType === tx.txType;
          const key = `c:${c.acctMajor}|${c.acctMid}|${c.acctMinor}`;
          return (
            <button
              key={key}
              type="button"
              disabled={!!busy}
              onClick={() => void patch(key, `${c.acctMinor}(으)로 확정했습니다`, accountPatch(c, `이 거래처 과거 ${c.count}건의 분류`))}
              className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-nd-sunken"
            >
              <div className="min-w-0 flex-1">
                <div className="text-nd-body font-semibold">{c.acctMinor}</div>
                <div className="text-nd-body text-nd-fg-3">
                  {path(c.acctMajor, c.acctMid)}
                  {c.bizMinor ? ` · ${c.bizMinor}` : ""} · {c.count}건
                </div>
              </div>
              {same && tx.status === "confirmed" ? <Check size={18} className="text-nd-income-text" aria-label="지금 분류" /> : <ChevronRight size={18} className="text-nd-fg-3" aria-hidden />}
            </button>
          );
        })}
      </Card>
      {pickAccount ? (
        <Card padding="none" className="mb-4">
          <div className="flex items-center gap-2 border-b border-nd-line px-3 py-2">
            <Search size={16} className="text-nd-fg-3" aria-hidden />
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="계정 이름 (예: 식대, 소모품)" className="flex-1" />
            <button type="button" aria-label="닫기" onClick={() => (setPickAccount(false), setQ(""))} className="p-1 text-nd-fg-3">
              <X size={18} />
            </button>
          </div>
          <div className="max-h-[50vh] divide-y divide-nd-line overflow-y-auto">
            {accounts.map((a) => {
              const key = `a:${a.txType}|${a.major}|${a.mid}|${a.minor}`;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={!!busy}
                  onClick={() =>
                    void patch(key, `${a.minor}(으)로 확정했습니다`, accountPatch({ txType: a.txType, acctMajor: a.major, acctMid: a.mid, acctMinor: a.minor }, "계정을 직접 고름"))
                  }
                  className="block w-full px-4 py-3 text-left active:bg-nd-sunken"
                >
                  <div className="text-nd-body font-semibold">{a.minor}</div>
                  <div className="text-nd-body text-nd-fg-3">
                    {a.txType} · {path(a.major, a.mid)}
                  </div>
                </button>
              );
            })}
            {accounts.length === 0 ? <div className="px-4 py-3 text-nd-body text-nd-fg-3">맞는 계정이 없습니다.</div> : null}
          </div>
        </Card>
      ) : (
        <Button variant="secondary" className="mb-4 w-full" onClick={() => (setPickAccount(true), setPickProject(false), setQ(""))}>
          다른 계정 찾기
        </Button>
      )}

      {/* ---- 프로젝트 ---- */}
      <SectionHeader title="프로젝트" hint={currentProject ? `지금: ${currentProject.name}` : tx.projectCode ? `지금: ${tx.projectCode}` : "붙이면 그 프로젝트 원가 · 매출로 잡힙니다"} />
      {pickProject ? (
        <Card padding="none" className="mb-4">
          <div className="flex items-center gap-2 border-b border-nd-line px-3 py-2">
            <Search size={16} className="text-nd-fg-3" aria-hidden />
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="프로젝트 이름 · 코드 · 발주처" className="flex-1" />
            <button type="button" aria-label="닫기" onClick={() => (setPickProject(false), setQ(""))} className="p-1 text-nd-fg-3">
              <X size={18} />
            </button>
          </div>
          <div className="max-h-[50vh] divide-y divide-nd-line overflow-y-auto">
            {projects.map((p: TxCardProject) => (
              <button
                key={p.id}
                type="button"
                disabled={!!busy}
                onClick={() => void patch(`p:${p.id}`, `${p.name}에 붙였습니다`, projectPatch(tx, p))}
                className={cn("block w-full px-4 py-3 text-left active:bg-nd-sunken", p.code === tx.projectCode && "bg-nd-sunken")}
              >
                <div className="flex items-center gap-2">
                  <span className="text-nd-body font-semibold">{p.name}</span>
                  {p.covers ? (
                    <Badge size="sm" tone="info">
                      진행 중
                    </Badge>
                  ) : null}
                </div>
                <div className="text-nd-body text-nd-fg-3">
                  {p.code}
                  {p.client ? ` · ${p.client}` : ""}
                  {p.startDate ? ` · ${whenOf(undefined, p.startDate)}~${p.endDate ? whenOf(undefined, p.endDate) : ""}` : ""}
                </div>
              </button>
            ))}
            {projects.length === 0 ? <div className="px-4 py-3 text-nd-body text-nd-fg-3">맞는 프로젝트가 없습니다.</div> : null}
          </div>
          {tx.projectCode && !received ? (
            <button type="button" disabled={!!busy} onClick={() => void patch("p:none", "프로젝트를 뗐습니다", projectPatch(tx, null))} className="w-full border-t border-nd-line px-4 py-3 text-left text-nd-body text-nd-fg-2">
              프로젝트 떼기
            </button>
          ) : null}
        </Card>
      ) : (
        <Button variant="secondary" className="mb-6 w-full" icon={FolderKanban} disabled={received} onClick={() => (setPickProject(true), setPickAccount(false), setQ(""))}>
          {currentProject || tx.projectCode ? "다른 프로젝트로 바꾸기" : "프로젝트에 붙이기"}
        </Button>
      )}

      {/* ---- 다음 확인 ---- */}
      {data.pending.length > 0 ? (
        <>
          <SectionHeader title="확인 안 한 문자 거래" hint={`${data.pending.length}건`} />
          <Card padding="none" className="divide-y divide-nd-line">
            {data.pending.slice(0, 12).map((p) => (
              <Link key={p.id} href={`/neander/tx/${encodeURIComponent(p.id)}`} className="flex items-center gap-3 px-4 py-3 active:bg-nd-sunken">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-nd-body font-semibold">{p.vendor || "거래처 모름"}</div>
                  <div className="text-nd-body text-nd-fg-3">
                    {whenOf(p.datetime, p.date)} · {STATUS[p.status]?.label ?? ""}
                  </div>
                </div>
                <Money value={p.txType === "수입" ? p.gross : -p.gross} flow={p.txType === "수입" ? "income" : "expense"} className="shrink-0 text-nd-body" />
                <ChevronRight size={18} className="shrink-0 text-nd-fg-3" aria-hidden />
              </Link>
            ))}
          </Card>
        </>
      ) : null}
    </PageShell>
  );
}
