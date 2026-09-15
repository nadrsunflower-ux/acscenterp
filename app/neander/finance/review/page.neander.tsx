"use client";

// ============================================================
//  검토 대기함 — 자동분류가 확신하지 못한 건을 사람이 승인
// ------------------------------------------------------------
//  수백 건을 처리해야 하므로 **키보드만으로** 넘길 수 있어야 한다.
//    ↑/↓ 또는 J/K  이동
//    Enter          현재 건 확정
//    E              상세 열기 (분류를 고쳐야 할 때)
//
//  각 행에는 "왜 이렇게 제안했는지"(classReason)를 함께 보여준다.
//  근거 없이 승인 버튼만 있으면 사람은 그냥 다 눌러버린다.
//
//  ── AI 추천 ──
//  규칙(classify.ts)은 거래처가 **정확히** 일치할 때만 맞힌다. 새 거래처가
//  오면 손을 든다. 「AI 추천」은 그 남은 건들을 모델에게 물어본다 —
//  `FACEBK *KEV69QZM62` 와 `FACEBK *FXEVTN5N62` 가 같은 메타 광고라는 걸
//  알아보는 종류의 판단이다.
//
//  ⚠️ AI 결과는 **자동 저장되지 않는다.** 화면에 추천으로 얹히고, 사람이
//     「적용」을 눌러야 저장된다. 확신도가 낮은 건은 눌러도 확정이 아니라
//     제안됨으로 들어간다.
//
//  화면: 행은 거래처·금액이 먼저(업무 화면은 작업·상태가 먼저), 근거는
//  아래. 일괄 처리 바는 sticky 유리 캡슐 하나 — 그 안에는 유리가 없다.
//
//  목업(all-pages/finance-review.png)은 좌 목록 + 우 상세 2단이지만, 이
//  화면의 값은 **키보드로 수백 건을 넘기는 흐름**에 있다. 2단으로 바꾸면
//  커서·단축키가 갈 곳이 없어지므로 흐름은 그대로 두고, 목업이 지적하는
//  것만 따른다 — 조회 조건은 제목 줄이 아니라 목록 위 FilterBar 로,
//  페이지 넘김은 공통 Pagination 으로, 단축키 안내는 접어서.
// ============================================================

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CircleCheck,
  Keyboard,
  Sparkles,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  cn,
  Disclosure,
  EmptyState,
  ErrorState,
  FilterBar,
  FilterField,
  InlineNotice,
  LoadingState,
  Money,
  PageHeader,
  PageShell,
  Pagination,
  Select,
  type Tone,
  UndoHistory,
  useConfirm,
  useUndoHistory,
} from "@/components/neander/ui";
import { LeavingItem, useLeaving } from "@/components/neander/ui";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { ProjectTag } from "@/components/neander/finance/ProjectTag";
import { TransactionEditor } from "@/components/neander/finance/TransactionEditor";
import {
  AccountPicker,
  type AccountValue,
} from "@/components/neander/finance/AccountPicker";
import {
  updateFinTransaction,
  deleteFinTransaction,
  restoreFinTransactions,
  bulkUpdateFinStatus,
  bulkPatchFinTransactions,
  applyFinEdits,
  requestAiSuggestions,
  type AiSuggestResult,
} from "@/lib/neander/finance/client";
import { BIZ_MAJORS } from "@/lib/neander/finance/sheet";
import {
  STATUS_LABEL,
  netAmount,
  type ClassificationStatus,
  type FinTransaction,
  txFlow,
} from "@/lib/neander/finance/types";

const ALL = "__all__";

/** 상태 → 의미 색조 (hex 딕셔너리 대신) */
const STATUS_TONE: Record<ClassificationStatus, Tone> = {
  confirmed: "success",
  suggested: "warning",
  needs_review: "danger",
};

/**
 * 한 페이지에 그리는 행 수의 **기본값**.
 *
 * 대기함이 1천 건을 넘으면서 전부를 한 번에 그리면 첫 렌더가 수 초씩
 * 걸렸다 — 행마다 체크박스·AI 추천·계정 선택기가 붙는 무거운 카드라
 * 목록 길이가 그대로 렌더 비용이 된다. 화면에는 100건씩만 올리고
 * 페이지로 넘긴다. 선택(체크)은 id 기반이라 페이지를 넘겨도 유지된다.
 * (Pagination 에서 한 쪽 개수를 바꿀 수 있다 — 무거운 화면이라 기본은
 *  그대로 100건이다.)
 */
/**
 * 한 쪽에 보일 건수. 100 이면 페이지가 19,000px 이 되어 마우스로는 바닥까지
 * 못 간다 (행마다 계정 고르는 자리를 잡아 두기 때문이다). j/k 로 훑는 사람은
 * 길이를 못 느끼지만, 스크롤로 보는 사람에게는 벽이다. 50 으로 두고 필요하면
 * 아래 쪽 넘김에서 100·200 으로 올린다.
 */
const PAGE_SIZE = 50;

/** 계정 3단 경로. 소분류 이름은 중분류마다 겹치므로(일반소모품비 등) 전체 경로로 묶는다 */
const acctPathOf = (t: FinTransaction) =>
  `${t.acctMajor ?? "-"} > ${t.acctMid ?? "-"} > ${t.acctMinor ?? "-"}`;

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded-[6px] border border-nd-border bg-nd-sunken px-1.5 py-0.5 font-sans text-nd-micro text-nd-fg-2">
      {children}
    </kbd>
  );
}

export default function ReviewPage() {
  const { transactions, accounts, paymentMethods, loading, applyTransactions } = useFinance();
  const confirm = useConfirm();
  /**
   * 되돌리기 — 처리 직전의 거래를 쌓아 두었다가 통째로 되쓴다 (매출 대기함과
   * 같은 부품). 확정·일괄 지정은 누르는 순간 대기함에서 사라져, 잘못 눌렀을 때
   * 원장에서 한 건씩 찾아 되돌려야 했다.
   */
  const undoLog = useUndoHistory<FinTransaction>({
    // 되쓴 거래만 바꿔 끼운다 — 전체(거래 1만+ · 7MB)를 다시 받지 않는다
    restore: async (before) => {
      const res = await restoreFinTransactions(before);
      applyTransactions({ upsert: res.transactions });
    },
  });
  const txLabel = (t: FinTransaction) => `${t.date} ${netAmount(t).toLocaleString("ko-KR")}원`;

  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  /**
   * 계정으로 좁히기. 대기함이 수백 건이 되면 이게 없으면 일괄 지정이
   * 무의미하다 — 날짜순으로 섞인 목록에서 같은 계정 146건을 고르려면
   * 체크박스를 146번 눌러야 한다. 좁힌 뒤 「전체 선택」을 누르면 그
   * 묶음만 잡힌다.
   */
  const [acctFilter, setAcctFilter] = useState<string>(ALL);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  /** 커서는 **현재 페이지 안**의 위치다 (0 ~ pageSize-1) */
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState<FinTransaction | null>(null);
  const [busy, setBusy] = useState(false);
  // 여러 건을 골라 같은 계정으로 한 번에 고친다. 같은 문제를 가진 거래가
  // 수십 건씩 몰려 있어서, 하나씩 누르게 하면 아무도 끝까지 안 한다.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAcct, setBulkAcct] = useState<AccountValue>({});
  // 사업구분은 거래유형과 무관하므로 유형이 섞여 있어도 한 번에 지정할 수 있다
  const [bulkBiz, setBulkBiz] = useState<{ major: string; minor: string }>({ major: "", minor: "" });
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);

  // ---- AI 추천 ----
  const [ai, setAi] = useState<AiSuggestResult | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  /** 추천을 이미 적용한 거래 (다시 적용하지 않게) */
  const [aiApplied, setAiApplied] = useState<Set<string>>(new Set());
  const aiById = useMemo(
    () => new Map((ai?.suggestions ?? []).map((s) => [s.id, s])),
    [ai],
  );

  const pending = useMemo(
    () =>
      transactions
        .filter((t) => t.status === "suggested" || t.status === "needs_review")
        .filter((t) => statusFilter === ALL || t.status === statusFilter)
        .filter((t) => acctFilter === ALL || acctPathOf(t) === acctFilter)
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [transactions, statusFilter, acctFilter],
  );

  // ---- 페이지 ----
  const pageCount = Math.max(1, Math.ceil(pending.length / pageSize));
  // 처리해서 목록이 줄면 페이지가 범위를 벗어날 수 있다
  useEffect(() => {
    if (page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);
  const pageRows = useMemo(
    () => pending.slice(page * pageSize, (page + 1) * pageSize),
    [pending, page, pageSize],
  );
  const goPage = useCallback(
    (p: number) => {
      setPage(Math.max(0, Math.min(pageCount - 1, p)));
      setCursor(0);
      window.scrollTo({ top: 0 });
    },
    [pageCount],
  );

  /** 계정 필터 후보 — 계정 필터를 **빼고** 센다 (좁힌 뒤에도 다른 계정으로 옮겨갈 수 있게) */
  const acctGroups = useMemo(() => {
    const m = new Map<string, number>();
    transactions
      .filter((t) => t.status === "suggested" || t.status === "needs_review")
      .filter((t) => statusFilter === ALL || t.status === statusFilter)
      .forEach((t) => m.set(acctPathOf(t), (m.get(acctPathOf(t)) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"));
  }, [transactions, statusFilter]);

  const bizMinors = useMemo(
    () =>
      [...new Set(transactions.map((t) => t.bizMinor).filter(Boolean) as string[])].sort(
        (a, b) => a.localeCompare(b, "ko"),
      ),
    [transactions],
  );

  /**
   * 물어볼 대상: 계정이 아직 없거나 「검토필요」인 건. 최대 40건.
   * 「제안됨」이면서 계정이 있는 건은 규칙이 이미 근거를 댄 것이라 뺀다 —
   * 모델을 부를 값이 없고 비용만 든다.
   */
  const aiTargets = useMemo(
    () =>
      pending
        .filter((t) => (!t.acctMinor || t.status === "needs_review") && !aiApplied.has(t.id))
        .slice(0, 40),
    [pending, aiApplied],
  );

  const askAi = async () => {
    if (aiTargets.length === 0) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const res = await requestAiSuggestions(aiTargets.map((t) => t.id));
      setAi(res);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI 추천에 실패했습니다.");
    } finally {
      setAiBusy(false);
    }
  };

  /**
   * 추천을 저장한다. 확신도 0.7 이상이면 제안됨, 그 아래는 검토필요로 둔다 —
   * AI 가 확정을 만들지는 않는다.
   */
  const applyAi = async (ids: string[]) => {
    const picks = ids
      .map((id) => aiById.get(id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s));
    if (picks.length === 0) return;
    setBusy(true);
    try {
      const res = await applyFinEdits({
        updates: picks.map((s) => ({
          id: s.id,
          patch: {
            acctMajor: s.acctMajor,
            acctMid: s.acctMid,
            acctMinor: s.acctMinor,
            bizMajor: s.bizMajor,
            bizMinor: s.bizMinor,
            status: s.confidence >= 0.7 ? "suggested" : "needs_review",
            classReason: `AI 추천(확신 ${Math.round(s.confidence * 100)}%) — ${s.reason}`,
          },
        })),
        inserts: [],
        deletes: [],
      });
      setAiApplied((prev) => new Set([...prev, ...picks.map((s) => s.id)]));
      const before = picks
        .map((s) => transactions.find((t) => t.id === s.id))
        .filter((t): t is FinTransaction => Boolean(t));
      undoLog.record(`AI 추천 ${picks.length}건을 저장했습니다.`, `AI 추천 ${picks.length}건 저장`, before);
      applyTransactions({ upsert: res.transactions });
    } finally {
      setBusy(false);
    }
  };

  // 목록이 줄어들면 커서가 범위를 벗어난다
  useEffect(() => {
    if (cursor >= pageRows.length) setCursor(Math.max(0, pageRows.length - 1));
  }, [pageRows.length, cursor]);

  /**
   * 확정·일괄 지정·삭제로 대기함에서 빠지는 카드는 순간 사라지지 않는다 —
   * 결과를 띄우고 흐려지며 접힌 뒤에 목록을 새로 읽는다 (ui/motion.tsx).
   * 매출 검토 대기함과 같은 모습이다.
   */
  const leaving = useLeaving();

  const approve = useCallback(
    async (t: FinTransaction) => {
      if (!t) return;
      const res = await updateFinTransaction(t.id, { status: "confirmed" });
      undoLog.record("확정했습니다.", `${txLabel(t)} 확정`, [t]);
      // 다 접힌 뒤 바뀐 거래만 바꿔 끼운다 — 전체(7MB)를 다시 받지 않는다
      await leaving.run([t.id], { message: "확정했습니다" }, () =>
        applyTransactions({ upsert: res.transactions }),
      );
    },
    [applyTransactions, undoLog.record, leaving.run],
  );

  // 키보드 조작
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (pageRows.length === 0) return;

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        // 페이지 끝에서 한 번 더 내리면 다음 페이지로
        if (cursor >= pageRows.length - 1) {
          if (page < pageCount - 1) goPage(page + 1);
        } else setCursor(cursor + 1);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        // 페이지 첫 행에서 한 번 더 올리면 이전 페이지의 끝으로
        if (cursor <= 0) {
          if (page > 0) {
            setPage(page - 1);
            setCursor(pageSize - 1);
          }
        } else setCursor(cursor - 1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const t = pageRows[cursor];
        if (t) approve(t);
      } else if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        setEditing(pageRows[cursor] ?? null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pageRows, cursor, editing, approve, page, pageCount, pageSize, goPage]);

  // 커서가 화면 밖으로 나가지 않게
  useEffect(() => {
    rowRefs.current[cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectedRows = pending.filter((t) => selected.has(t.id));
  // 거래유형이 섞이면 계정 후보가 달라져 하나로 못 고른다
  const selectedTypes = [...new Set(selectedRows.map((t) => t.txType))];
  const bulkTxType = selectedTypes.length === 1 ? selectedTypes[0] : null;

  /** 계정 3단이 마스터에 있는가 (거래유형은 뺀다 — 환급은 지출 계정을 쓴다) */
  const acctPaths = useMemo(
    () => new Set(accounts.map((a) => `${a.major}|${a.mid}|${a.minor}`)),
    [accounts],
  );

  /**
   * 사업구분 일괄 지정.
   *
   * 계정까지 멀쩡한 행만 확정으로 올린다. 사업구분만 비어서 대기함에 온
   * 행은 채우는 순간 볼 일이 끝나지만, 계정이 마스터에 없어서 온 행까지
   * 함께 확정해 버리면 **정작 고쳐야 할 문제가 대기함에서 사라진다.**
   * 그래서 행마다 상태를 달리 쓴다(applyEdits 는 행별 패치를 받는다).
   */
  const applyBulkBiz = async () => {
    if (!bulkBiz.major || selectedRows.length === 0) return;
    setBusy(true);
    try {
      const updates = selectedRows.map((t) => {
        const acctOk = !!t.acctMinor && acctPaths.has(`${t.acctMajor}|${t.acctMid}|${t.acctMinor}`);
        return {
          id: t.id,
          patch: {
            bizMajor: bulkBiz.major,
            bizMinor: bulkBiz.minor || bulkBiz.major,
            ...(acctOk
              ? { status: "confirmed" as const, classReason: `검토 대기함에서 사업구분 일괄 지정 (${selectedRows.length}건)` }
              : { classReason: "사업구분은 지정했으나 계정이 마스터에 없어 대기함에 남긴다" }),
          },
        };
      });
      const res = await applyFinEdits({ updates, inserts: [], deletes: [] });
      undoLog.record(
        `사업구분 ${selectedRows.length}건을 지정했습니다.`,
        `사업구분 ${selectedRows.length}건 → ${bulkBiz.minor || bulkBiz.major}`,
        selectedRows,
      );
      setSelected(new Set());
      setBulkBiz({ major: "", minor: "" });
      // 확정으로 올라간 행만 떠난다 — 계정이 없어 남는 행까지 흐려지면 사라진 줄로 읽힌다
      const leaves = updates.filter((u) => "status" in u.patch).map((u) => u.id);
      await leaving.run(leaves, {}, () => applyTransactions({ upsert: res.transactions }));
    } finally {
      setBusy(false);
    }
  };

  const applyBulk = async () => {
    if (!bulkAcct.acctMinor || selectedRows.length === 0) return;
    setBusy(true);
    try {
      const res = await bulkPatchFinTransactions(
        selectedRows.map((t) => t.id),
        {
          ...bulkAcct,
          status: "confirmed",
          classReason: `검토 대기함에서 ${selectedRows.length}건 일괄 지정`,
        },
      );
      undoLog.record(
        `${selectedRows.length}건을 확정했습니다.`,
        `계정 ${selectedRows.length}건 일괄 지정 → ${bulkAcct.acctMinor}`,
        selectedRows,
      );
      const leaves = selectedRows.map((t) => t.id);
      setSelected(new Set());
      setBulkAcct({});
      await leaving.run(leaves, {}, () => applyTransactions({ upsert: res.transactions }));
    } finally {
      setBusy(false);
    }
  };

  /**
   * 제안됨을 통째로 확정한다.
   *
   * 수백 건이 한 번에 대기함에서 사라진다 — 몇 건인지 보여주고 한 번 묻는다.
   * 잘못 눌렀으면 「방금 처리한 것」에서 되돌린다 (새로고침 전까지).
   */
  const approveAllSuggested = async () => {
    const rows = pending.filter((t) => t.status === "suggested");
    const ids = rows.map((t) => t.id);
    if (ids.length === 0) return;
    const ok = await confirm({
      title: `제안됨 ${ids.length.toLocaleString("ko-KR")}건을 한 번에 확정할까요?`,
      message:
        "확정하면 대기함에서 빠집니다. 잘못 눌렀다면 이 화면의 「방금 처리한 것」에서 되돌릴 수 있습니다(새로고침 전까지).",
      confirmLabel: `${ids.length.toLocaleString("ko-KR")}건 확정`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await bulkUpdateFinStatus(ids, "confirmed");
      undoLog.record(
        `제안됨 ${ids.length.toLocaleString("ko-KR")}건을 확정했습니다.`,
        `제안됨 ${ids.length.toLocaleString("ko-KR")}건 일괄 확정`,
        rows,
      );
      // 화면 밖 행은 그려지지 않으므로 키만 넘어가고 아무 일도 없다
      await leaving.run(ids, {}, () => applyTransactions({ upsert: res.transactions }));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <LoadingState label="대기함을 불러오는 중…" />;
  }

  const suggestedCount = transactions.filter((t) => t.status === "suggested").length;

  // 페이지 넘김 — 화면마다 손으로 만들던 버튼 줄 대신 공통 부품.
  // 한 쪽 개수도 여기서 고른다 (Pagination 은 1-base, 내부 page 는 0-base)
  const pager = (
    <Pagination
      total={pending.length}
      page={page + 1}
      pageSize={pageSize}
      onPageChange={(p) => goPage(p - 1)}
      onPageSizeChange={(n) => {
        setPageSize(n);
        setPage(0);
        setCursor(0);
      }}
      pageSizeOptions={[50, 100, 200]}
    />
  );

  return (
    <PageShell>
      <PageHeader
        title="검토 대기함"
        description="자동분류가 확신하지 못한 거래입니다. 근거를 보고 승인하거나 고치세요."
        // 제목 줄 오른쪽에는 **상태와 주요 동작만** 둔다. 조회 조건(상태·계정)은
        // 목록 바로 위 FilterBar 로 내렸다 — Select 2 + Button 2 가 한 줄에
        // 몰리면 무엇이 동작이고 무엇이 조건인지 구분되지 않는다.
        meta={
          <Badge tone={pending.length > 0 ? "warning" : "success"} dot>
            검토 대기 <span className="nd-num">{pending.length.toLocaleString("ko-KR")}</span>건
          </Badge>
        }
        actions={
          <>
            {aiTargets.length > 0 && (
              <Button variant="secondary" icon={Sparkles} onClick={askAi} loading={aiBusy} disabled={busy}>
                {aiBusy ? "AI 가 보고 있습니다…" : `AI 추천 (${aiTargets.length}건)`}
              </Button>
            )}
            {suggestedCount > 0 && (
              <Button variant={pending.length > 0 ? "primary" : "secondary"} onClick={approveAllSuggested} disabled={busy}>
                제안됨 {suggestedCount}건 일괄 확정
              </Button>
            )}
          </>
        }
      />

      <UndoHistory
        className="mb-4"
        entries={undoLog.entries}
        undoingId={undoLog.undoingId}
        onUndo={(e) => void undoLog.undo(e)}
      />

      {aiError && (
        <ErrorState className="mb-4" title="AI 추천을 받지 못했습니다" description={aiError} />
      )}

      {ai && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex flex-wrap items-baseline gap-x-2 text-nd-section text-nd-fg">
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles size={16} strokeWidth={1.75} className="text-nd-info" aria-hidden />
                  AI 추천 {ai.suggestions.length}건
                </span>
                <span className="text-nd-caption font-normal text-nd-fg-3">{ai.model}</span>
              </p>
              <p className="mt-1 text-nd-body text-nd-fg-2">
                아래 각 거래에 추천이 붙었습니다. <b className="text-nd-fg">저장되지 않았습니다</b> — 확인 후 적용하세요.
                확신도 70% 미만은 적용해도 「검토필요」로 남습니다.
              </p>
              <p className="nd-num mt-1 text-nd-caption text-nd-fg-3">
                토큰 입력 {ai.usage.inputTokens.toLocaleString("ko-KR")}
                {ai.usage.cacheReadTokens > 0 &&
                  ` (캐시 재사용 ${ai.usage.cacheReadTokens.toLocaleString("ko-KR")})`}
                {" · 출력 "}
                {ai.usage.outputTokens.toLocaleString("ko-KR")}
                {ai.usage.costUsd !== undefined && ` · 비용 $${ai.usage.costUsd.toFixed(4)}`}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button variant="ghost" onClick={() => setAi(null)} disabled={busy}>
                추천 지우기
              </Button>
              <Button
                onClick={() =>
                  applyAi(
                    ai.suggestions.filter((x) => x.confidence >= 0.7 && !aiApplied.has(x.id)).map((x) => x.id),
                  )
                }
                disabled={busy || ai.suggestions.every((x) => x.confidence < 0.7 || aiApplied.has(x.id))}
              >
                확신 70%↑ 일괄 적용
              </Button>
            </div>
          </div>
          {ai.rejected.length > 0 && (
            <InlineNotice tone="warning" className="mt-3">
              계정 마스터에 없는 계정을 제안한 {ai.rejected.length}건은 버렸습니다
              ({ai.rejected.slice(0, 2).map((r) => r.proposed).join(", ")}
              {ai.rejected.length > 2 && " …"}).
            </InlineNotice>
          )}
        </Card>
      )}

      {/* 조회 조건 — 지금 무엇으로 걸러 보고 있는지는 목록 바로 위에 붙어 있어야 읽힌다 */}
      <FilterBar
        className="mb-3"
        actions={
          pending.length > 0 ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setSelected(
                  selected.size === pending.length ? new Set() : new Set(pending.map((t) => t.id)),
                )
              }
            >
              {selected.size === pending.length
                ? "전체 해제"
                : `전체 선택 (${pending.length.toLocaleString("ko-KR")})`}
            </Button>
          ) : undefined
        }
      >
        <FilterField label="상태" htmlFor="rv-status">
          <Select
            id="rv-status"
            size="sm"
            value={statusFilter}
            className="w-auto"
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(0);
              setCursor(0);
            }}
          >
            <option value={ALL}>전체 상태</option>
            {(["suggested", "needs_review"] as ClassificationStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="계정" htmlFor="rv-acct">
          <Select
            id="rv-acct"
            size="sm"
            value={acctFilter}
            className="w-auto max-w-[20rem]"
            onChange={(e) => {
              setAcctFilter(e.target.value);
              setSelected(new Set()); // 안 보이는 행이 선택된 채로 남으면 안 된다
              setPage(0);
              setCursor(0);
            }}
            title="계정으로 좁힌 뒤 「전체 선택」 을 누르면 그 묶음만 잡힙니다"
          >
            <option value={ALL}>모든 계정 ({acctGroups.reduce((n, [, c]) => n + c, 0)})</option>
            {acctGroups.map(([path, n]) => (
              <option key={path} value={path}>
                {path} ({n})
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>

      {/* 단축키는 이 화면의 핵심이지만 매번 읽을 것은 아니다 — 접어 두되 제목으로 남긴다 */}
      <Disclosure
        icon={Keyboard}
        title="단축키"
        description="키보드만으로 수백 건을 넘길 수 있습니다"
        className="mb-3"
        meta={
          <span className="hidden items-center gap-1.5 sm:inline-flex">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            <Kbd>Enter</Kbd>
            <Kbd>E</Kbd>
          </span>
        }
      >
        <dl className="grid gap-2 text-nd-caption sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <dt className="flex shrink-0 items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd><Kbd>J</Kbd><Kbd>K</Kbd></dt>
            <dd className="text-nd-fg-2">커서 이동 (쪽 끝에서 한 번 더 누르면 다음 쪽)</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="shrink-0"><Kbd>Enter</Kbd></dt>
            <dd className="text-nd-fg-2">커서에 있는 건을 확정</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="shrink-0"><Kbd>E</Kbd></dt>
            <dd className="text-nd-fg-2">상세 열기 (분류를 고쳐야 할 때)</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="shrink-0 text-nd-fg-3">체크박스</dt>
            <dd className="text-nd-fg-2">
              여러 건을 골라 같은 계정으로 한 번에 지정 · 선택은 쪽을 넘겨도 유지됩니다
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-nd-caption text-nd-fg-3">
          커서가 놓인 행에서는 아래쪽 계정 칸이 선택기로 바뀌어 그 자리에서 바로 고칠 수 있습니다.
        </p>
      </Disclosure>

      {pending.length === 0 ? (
        <EmptyState
          icon={CircleCheck}
          title="검토할 거래가 없습니다"
          description="모든 거래가 확정 상태입니다."
        />
      ) : (
        <>
          {selected.size > 0 && (
            // 일괄 처리 바 — sticky 유리 캡슐 하나. 안쪽은 불투명 컨트롤만.
            // 상단바 높이는 셸이 토큰으로 들고 있다 (top-16 으로 박아 두면 셸이 바뀔 때 어긋난다)
            <div className="nd-glass sticky top-[var(--nd-topbar-h)] z-nd-sticky mb-3 rounded-nd-xl p-4">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <p className="text-nd-body font-semibold text-nd-fg">
                    {selected.size.toLocaleString("ko-KR")}건 선택됨
                  </p>
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    className="mt-0.5 text-nd-caption text-nd-fg-2 underline hover:text-nd-fg"
                  >
                    선택 해제
                  </button>
                </div>
                {bulkTxType ? (
                  <>
                    <div className="min-w-0 flex-1">
                      <AccountPicker
                        accounts={accounts}
                        txType={bulkTxType}
                        compact
                        value={bulkAcct}
                        onChange={setBulkAcct}
                      />
                    </div>
                    <Button size="sm" onClick={applyBulk} disabled={busy || !bulkAcct.acctMinor}>
                      {selected.size}건에 적용
                    </Button>
                  </>
                ) : (
                  <p className="text-nd-body text-nd-danger-text">
                    거래유형이 섞여 있어 계정을 한 번에 지정할 수 없습니다
                    ({selectedTypes.join(" · ")}). 같은 유형끼리 골라주세요.
                  </p>
                )}
              </div>

              {/* 사업구분은 거래유형과 무관하다 — 유형이 섞여 있어도 지정할 수 있다 */}
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-nd-line pt-3">
                <span className="text-nd-caption font-medium text-nd-fg-2">사업구분 일괄</span>
                <Select
                  size="sm"
                  aria-label="사업대분류"
                  value={bulkBiz.major}
                  onChange={(e) => setBulkBiz({ major: e.target.value, minor: "" })}
                  className="w-28"
                >
                  <option value="">대분류</option>
                  {BIZ_MAJORS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </Select>
                <Select
                  size="sm"
                  aria-label="사업소분류"
                  value={bulkBiz.minor}
                  onChange={(e) => setBulkBiz((v) => ({ ...v, minor: e.target.value }))}
                  disabled={!bulkBiz.major}
                  className="w-40"
                >
                  <option value="">소분류 (대분류와 같게)</option>
                  {bizMinors.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </Select>
                <Button variant="secondary" size="sm" onClick={applyBulkBiz} disabled={busy || !bulkBiz.major}>
                  {selected.size}건에 사업구분 적용
                </Button>
                <span className="text-nd-caption text-nd-fg-3">
                  계정까지 멀쩡한 행만 확정으로 올라갑니다
                </span>
              </div>
            </div>
          )}

          <div className="mb-3">{pager}</div>

          <ul className="space-y-2">
            {pageRows.map((t, i) => {
              const active = i === cursor;
              const suggestion = aiById.has(t.id) && !aiApplied.has(t.id) ? aiById.get(t.id) : undefined;
              return (
                <LeavingItem
                  as="li"
                  key={t.id}
                  ref={(el) => { rowRefs.current[i] = el as (typeof rowRefs.current)[number]; }}
                  aria-current={active ? "true" : undefined}
                  state={leaving.state[t.id]}
                  gap="0.5rem"
                >
                  <Card
                    padding="sm"
                    onClick={() => setCursor(i)}
                    className={cn("transition-shadow duration-nd-fast", active && "ring-2 ring-nd-accent/60")}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        {/* 거래처·금액이 먼저 */}
                        <div className="flex items-start gap-2.5">
                          <Checkbox
                            checked={selected.has(t.id)}
                            onChange={() => toggle(t.id)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`${t.vendor || "(거래처 없음)"} 선택`}
                            className="mt-0.5"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                              <span className="min-w-0 truncate text-nd-body font-semibold text-nd-fg" title={t.vendor || undefined}>
                                {t.vendor || "(거래처 없음)"}
                              </span>
                              <span className="text-nd-section">
                                <Money value={netAmount(t)} flow={txFlow(t.txType)} />
                              </span>
                            </p>
                            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-nd-caption text-nd-fg-2">
                              <Badge tone={STATUS_TONE[t.status]} size="sm" dot>
                                {STATUS_LABEL[t.status]}
                              </Badge>
                              <span className="nd-num">{t.date}</span>
                              <span>{t.txType}</span>
                              <ProjectTag code={t.projectCode} />
                            </p>
                            {t.classReason && (
                              <p className="mt-1.5 text-nd-caption leading-relaxed text-nd-fg-3">{t.classReason}</p>
                            )}
                          </div>
                        </div>

                        {suggestion && (
                          <InlineNotice
                            tone={suggestion.confidence >= 0.7 ? "info" : "warning"}
                            icon={Sparkles}
                            className="mt-2"
                            action={
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={(ev) => { ev.stopPropagation(); void applyAi([t.id]); }}
                                disabled={busy}
                              >
                                적용
                              </Button>
                            }
                          >
                            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="text-nd-micro uppercase tracking-wide opacity-80">AI 추천</span>
                              <span className="font-medium text-nd-fg">
                                {[suggestion.acctMajor, suggestion.acctMid, suggestion.acctMinor].join(" › ")}
                              </span>
                              {suggestion.bizMinor && (
                                <span className="text-nd-caption text-nd-fg-2">
                                  {suggestion.bizMajor} · {suggestion.bizMinor}
                                </span>
                              )}
                              <span className="nd-num text-nd-caption font-medium">
                                확신 {Math.round(suggestion.confidence * 100)}%
                              </span>
                            </p>
                            <p className="mt-0.5 text-nd-caption text-nd-fg-2">{suggestion.reason}</p>
                          </InlineNotice>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button variant="secondary" size="sm" onClick={() => setEditing(t)}>
                          상세
                        </Button>
                        <Button size="sm" onClick={() => approve(t)}>확정</Button>
                      </div>
                    </div>

                    {/*
                      계정 자리 — 커서 행에서만 선택기로 바뀐다. 선택기는 50행에
                      다 그리기엔 무겁다(Select 3개 × 행 수).

                      ⚠️ 예전에는 모든 행이 선택기 높이를 **미리 비워** 뒀다. 커서
                         행만 부풀면 목록이 덜컥거린다는 이유였는데, 실측해 보니
                         값만 치르고 효과는 못 냈다 — 커서 행은 예약분(68px)을
                         넘겨 87px 이라 점프가 남았고, 나머지 행은 한 줄(17px)만
                         쓰면서 51px 씩 비어 페이지의 4분의 1이 빈 종이였다.

                         지금은 비우지 않는다. 커서를 옮길 때 `scrollIntoView
                         ({block:"nearest"})` 가 **커서 행을 제자리에 붙들어** 두므로,
                         아래 행들이 밀려도 읽던 자리는 그대로다.
                    */}
                    <div className="mt-3 border-t border-nd-line pt-3">
                      {active ? (
                        <AccountPicker
                          accounts={accounts}
                          txType={t.txType}
                          compact
                          value={{
                            acctMajor: t.acctMajor,
                            acctMid: t.acctMid,
                            acctMinor: t.acctMinor,
                          }}
                          onChange={async (v) => {
                            const res = await updateFinTransaction(t.id, v);
                            undoLog.record(
                              "계정을 바꿨습니다.",
                              `${txLabel(t)} 계정 → ${v.acctMinor ?? "비움"}`,
                              [t],
                            );
                            applyTransactions({ upsert: res.transactions });
                          }}
                        />
                      ) : (
                        <p className="flex flex-wrap items-baseline gap-x-2 text-nd-caption text-nd-fg-3">
                          <span className="font-medium text-nd-fg-2">계정</span>
                          {t.acctMinor ? (
                            <span>{[t.acctMajor, t.acctMid, t.acctMinor].filter(Boolean).join(" › ")}</span>
                          ) : (
                            <span className="text-nd-danger-text">아직 없음 — 커서를 두면 고칠 수 있습니다</span>
                          )}
                        </p>
                      )}
                    </div>
                  </Card>
                </LeavingItem>
              );
            })}
          </ul>

          <div className="mt-3">{pager}</div>
        </>
      )}

      {editing && (
        <TransactionEditor
          tx={editing}
          accounts={accounts}
          paymentMethods={paymentMethods}
          knownBizMinors={bizMinors}
          onSave={async (patch) => {
            const res = await updateFinTransaction(editing.id, patch);
            undoLog.record("저장했습니다.", `${txLabel(editing)} 수정`, [editing]);
            applyTransactions({ upsert: res.transactions });
          }}
          onDelete={async () => {
            await deleteFinTransaction(editing.id);
            undoLog.record("삭제했습니다.", `${txLabel(editing)} 삭제`, [editing]);
            const id = editing.id;
            await leaving.run([id], { message: "삭제했습니다", tone: "neutral" }, () =>
              applyTransactions({ remove: [id] }),
            );
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </PageShell>
  );
}
