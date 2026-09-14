"use client";

// ============================================================
//  매출 › 적재 — 한 달은 원본 파일 세 개로 완성되는 퍼즐이다
// ------------------------------------------------------------
//  네이버 예약자관리 1개 + 페이히어 매출내역 2개(아이디·와우) + 온라인(있을 때만,
//  lib/neander/sales/online-sheet.ts). 칸을 나란히 두고, 파일을 떨어뜨리면 **바로** 해석해서 적재한다 — 확인 단계가
//  없다. 어느 칸에 떨어뜨리든 내용으로 판정해 맞는 칸으로 간다.
//
//  빠진 칸은 붉게, 채워진 칸은 초록으로 빛난다 (neander.css 의
//  nd-puzzle-piece). 셋이 다 초록이면 다음 할 일(이벤트 입력 → 검토 →
//  월 손익)로 이어지는 띠가 뜬다.
//
//  파서는 새로 쓰지 않는다 — 재무 모듈의 parsePayhere · parseNaverBooking
//  (개인정보 열을 읽지 않는 것까지 그대로). 네이버 파일의 암호는 서버가
//  환경변수로 푼다 (api/neander/sales/decrypt).
//
//  ⚠️ 여기서 만드는 것은 재무 거래가 아니라 **판매 줄**이다. 같은 판매가
//     장부에는 카드사 정산 입금으로 이미 들어와 있다.
//
//  ⚠️ 배치를 승인 목업(all-pages/sales-import.png)에 맞췄다.
//     · 맨 위에 Stepper — 지금이 「올리기」인지 「해석 확인」인지 「적재
//       완료」인지가 퍼즐 칸에서 그대로 나온다. 새 상태는 만들지 않았다.
//     · 비밀번호 · 잡수익 · 적재 이력은 접어 두는 세 줄(Disclosure)로
//       내렸다. 한 달에 한 번 쓰는 것들이 퍼즐 세 칸을 아래로 밀고 있었다.
//     · 설명 성격의 InlineNotice 는 기준 한 줄(BasisLine + ⓘ)로 내리고,
//       배너 자리는 경고·오류에만 남겼다.
// ============================================================

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import Link from "next/link";
import {
  CalendarPlus,
  ChartNoAxesColumn,
  CircleAlert,
  CircleCheck,
  FileSpreadsheet,
  Inbox,
  KeyRound,
  LockOpen,
  Puzzle,
  Receipt,
  TriangleAlert,
  Undo2,
  Upload,
} from "lucide-react";
import {
  Badge,
  BasisLine,
  Button,
  Card,
  cn,
  Disclosure,
  EmptyState,
  ErrorState,
  Field,
  FieldAction,
  FormRow,
  Icon,
  InfoPopover,
  InlineNotice,
  Input,
  KpiItem,
  LoadingState,
  Money,
  MonthStepper,
  PageHeader,
  PageShell,
  Select,
  Spinner,
  StatusDot,
  Stepper,
  Table,
  TableNote,
  TableScroll,
  Td,
  Th,
  Tr,
  useConfirm,
  useToast,
} from "@/components/neander/ui";
import { ToolbarPortal } from "@/components/neander/shell/context";
import { useSales } from "@/components/neander/sales/SalesProvider";
import { StoreBadge } from "@/components/neander/sales/ui";
import {
  looksEncrypted,
  parseReconcileSource,
  readWorkbook,
  type PosResult,
} from "@/lib/neander/finance/adapters";
import { detectOnlineSheet, parseOnlineSheet } from "@/lib/neander/sales/online-sheet";
import { availableMonths } from "@/lib/neander/sales/aggregate";
import {
  addSalesLine,
  commitSalesImport,
  decryptSalesFile,
  undoSalesImport,
} from "@/lib/neander/sales/client";
import {
  classifySlot,
  firstIncompleteMonth,
  monthOfBatch,
  monthOfResult,
  puzzleOf,
  selectableMonths,
  type ImportSlot,
  type ImportSlotKey,
} from "@/lib/neander/sales/import-slots";
import {
  resolveRows,
  summarize,
  type RawSaleRow,
} from "@/lib/neander/sales/resolve";
import {
  PAY_ROUTES,
  SALES_STORES,
  routeLabel,
  type PayRoute,
  type SalesImportBatch,
  type SalesLineInput,
  type SalesStore,
} from "@/lib/neander/sales/types";
import { monthLabel } from "@/lib/neander/format";

// ---- 칸의 순간 상태 (적재 결과는 imports 에서 오고, 이건 진행·오류만) ----

type PieceActivity =
  | { kind: "idle" }
  | { kind: "busy"; step: string; fileName: string }
  | { kind: "error"; message: string; fileName?: string };

const won = (n: number) => n.toLocaleString("ko-KR");

export default function SalesImportPage() {
  const { lines, events, products, assumptions, imports, masterEmpty, loading, error, refresh } =
    useSales();
  const toast = useToast();
  const confirm = useConfirm();

  // ---- 달 고르기 --------------------------------------------
  const months = useMemo(
    () =>
      selectableMonths([
        ...availableMonths(lines, events),
        ...imports.map((b) => monthOfBatch(b)).filter((m): m is string => !!m),
      ]),
    [lines, events, imports],
  );
  const [month, setMonth] = useState("");
  const activeMonth = month || firstIncompleteMonth(imports, months);

  const puzzle = useMemo(() => puzzleOf(imports, activeMonth), [imports, activeMonth]);

  // ---- 칸별 진행 상태 --------------------------------------
  const [activity, setActivity] = useState<Record<ImportSlotKey, PieceActivity>>({
    naver: { kind: "idle" },
    "payhere-id": { kind: "idle" },
    "payhere-wow": { kind: "idle" },
    "payhere-online": { kind: "idle" },
  });
  const setAct = (key: ImportSlotKey, a: PieceActivity) =>
    setActivity((prev) => ({ ...prev, [key]: a }));
  /** 칸을 못 정한 파일의 오류 — 페이지 위에 띄운다 */
  const [pageError, setPageError] = useState<string | null>(null);
  /** 서버에 비밀번호가 없을 때만 사람에게 묻는다 */
  const [password, setPassword] = useState("");
  const [askPassword, setAskPassword] = useState(false);
  /** 비밀번호 판은 접어 두지만, 서버가 물어오면 저절로 펴진다 */
  const [pwOpen, setPwOpen] = useState(false);
  useEffect(() => {
    if (askPassword) setPwOpen(true);
  }, [askPassword]);

  // 퍼즐이 막 완성된 순간 한 번 번쩍인다
  const [justSolved, setJustSolved] = useState(false);
  const prevFilled = useRef(puzzle.filled);
  useEffect(() => {
    if (puzzle.complete && prevFilled.current < puzzle.total) {
      setJustSolved(true);
      const t = setTimeout(() => setJustSolved(false), 1000);
      return () => clearTimeout(t);
    }
    prevFilled.current = puzzle.filled;
  }, [puzzle.complete, puzzle.filled, puzzle.total]);
  useEffect(() => {
    prevFilled.current = puzzle.filled;
  }, [puzzle.filled]);

  // 달을 바꾸면 이전 달의 오류 표시는 의미가 없다
  useEffect(() => {
    setActivity({
      naver: { kind: "idle" },
      "payhere-id": { kind: "idle" },
      "payhere-wow": { kind: "idle" },
      "payhere-online": { kind: "idle" },
    });
    setPageError(null);
  }, [activeMonth]);

  // ---- 파일 하나를 끝까지 (읽기 → 복호화 → 해석 → 적재) ----------
  async function ingestOne(file: File, doneThisRun: Set<ImportSlotKey>): Promise<void> {
    let slotKey: ImportSlotKey | null = null;
    try {
      let buf = await file.arrayBuffer();
      if (looksEncrypted(buf)) {
        // 암호 파일은 네이버뿐이다 — 풀기 전이라도 그 칸에 진행을 보인다
        slotKey = "naver";
        setAct("naver", { kind: "busy", step: "암호 해제 중…", fileName: file.name });
        try {
          buf = await decryptSalesFile(file, password || undefined);
        } catch (e) {
          const err = e as Error & { needsPassword?: boolean };
          if (err.needsPassword) setAskPassword(true);
          throw err;
        }
      }
      const wb = readWorkbook(buf);
      // 온라인 매출은 POS 원본이 아니라 「입력_페이히어_온라인」 시트 모양으로 온다 — 먼저 알아본다
      const result = detectOnlineSheet(wb)
        ? parseOnlineSheet(wb, file.name)
        : parseReconcileSource(wb, file.name);
      if (!result || result.sales.length === 0) {
        throw new Error(
          "페이히어 매출 내역 · 네이버 예약자 관리 · 페이히어 온라인 매출 파일이 아닙니다. POS·예약에서 내려받은 파일이나 온라인 매출 시트를 올려주세요.",
        );
      }
      const slot = classifySlot(result);
      if (!slot) {
        throw new Error(`매장을 알 수 없는 파일입니다 (시트 상단: ${result.store || "없음"}).`);
      }
      slotKey = slot.key;
      // 한 번에 떨어뜨린 파일 중 같은 칸이 둘이면 두 번째는 넣지 않는다 —
      // 조용히 두 번 적재하면 그 매장 매출이 두 배가 된다
      if (doneThisRun.has(slot.key)) {
        throw new Error("같은 칸의 파일이 두 개입니다. 하나만 남기고 다시 올려주세요.");
      }
      setAct(slot.key, { kind: "busy", step: "해석 중…", fileName: file.name });

      const fileMonth = monthOfResult(result);
      if (!fileMonth) {
        throw new Error(
          `기간을 한 달로 잡을 수 없습니다 (${result.from ?? "?"} ~ ${result.to ?? "?"}). 한 달 단위로 내려받은 파일을 올려주세요.`,
        );
      }
      if (fileMonth !== activeMonth) {
        throw new Error(
          `${monthLabel(fileMonth)} 파일입니다. 지금 고른 달은 ${monthLabel(activeMonth)} 입니다 — 위에서 달을 바꾸거나 맞는 파일을 올려주세요.`,
        );
      }

      // 이미 그 칸이 채워져 있으면 바꿀지 묻는다 — 조용히 두 번 적재하면 매출이 두 배가 된다
      const existing = puzzleOf(imports, activeMonth).pieces.find((p) => p.slot.key === slot.key)?.batch;
      if (existing) {
        const ok = await confirm({
          title: `${slot.label} 칸에 이미 「${existing.fileName}」이 있습니다`,
          message: "그 적재를 되돌리고 이 파일로 바꿉니다. 검토 대기함에서 확정한 내용도 함께 지워집니다.",
          confirmLabel: "바꾸기",
          tone: "danger",
        });
        if (!ok) {
          setAct(slot.key, { kind: "idle" });
          return;
        }
        setAct(slot.key, { kind: "busy", step: "이전 적재 되돌리는 중…", fileName: file.name });
        await undoSalesImport(existing.id);
      }

      const drafts = resolveDrafts(result, slot);
      const stats = summarize(drafts);
      setAct(slot.key, { kind: "busy", step: `${won(stats.rows)}줄 적재 중…`, fileName: file.name });
      const res = await commitSalesImport(
        {
          fileName: file.name,
          sourceLabel: result.sourceLabel,
          store: slot.store,
          route: slot.route,
          from: result.from,
          to: result.to,
          rows: stats.rows,
          resolved: stats.resolved,
          needsReview: stats.needsReview,
          sourceTotal: result.summary.total,
          loadedTotal: stats.total,
        },
        drafts,
      );
      toast.success(
        `${slot.label} — ${won(res.written)}줄 적재${stats.needsReview > 0 ? ` · 미확정 ${won(stats.needsReview)}건` : ""}`,
      );
      doneThisRun.add(slot.key);
      setAct(slot.key, { kind: "idle" });
    } catch (e) {
      const message = e instanceof Error ? e.message : "파일을 읽을 수 없습니다.";
      if (slotKey) setAct(slotKey, { kind: "error", message, fileName: file.name });
      else setPageError(`${file.name} — ${message}`);
    }
  }

  function resolveDrafts(result: PosResult, slot: ImportSlot): SalesLineInput[] {
    const rows: RawSaleRow[] = result.sales.map((s) => ({
      date: s.date,
      items: s.items,
      total: s.total,
      refundedAt: s.refundedAt,
      refundAmount: s.refundAmount,
      cancelFee: s.cancelFee,
      options: s.options,
      qty: s.qty,
    }));
    return resolveRows(rows, { products, events, store: slot.store, route: slot.route, assumptions }, {});
  }

  /** 여러 파일을 한 번에 — 순서대로 처리한다 (바꾸기 확인이 겹치지 않게) */
  const busyRef = useRef(false);
  async function ingest(files: File[]) {
    if (files.length === 0 || busyRef.current) return;
    busyRef.current = true;
    setPageError(null);
    try {
      const done = new Set<ImportSlotKey>();
      for (const f of files) await ingestOne(f, done);
      await refresh();
    } finally {
      busyRef.current = false;
    }
  }

  /**
   * 적재 되돌리기 — 퍼즐 칸에서도, 아래 「적재 이력」에서도 이 하나를 부른다.
   *
   * 예전에는 같은 일을 두 곳에 따로 적어 두어 확인 문구가 서로 달랐다
   * (한쪽은 「다른 칸은 그대로 남습니다」를 말하고 한쪽은 말하지 않았다).
   * 같은 일에 같은 문구를 쓰지 않으면 사람은 둘을 다른 일로 읽는다.
   */
  async function undo(b: SalesImportBatch, slot?: ImportSlot) {
    if (
      !(await confirm({
        title: `${slot ? `${slot.label} 칸의 ` : ""}「${b.fileName}」 적재를 되돌릴까요?`,
        message:
          "이 파일로 만든 판매 줄만 지웁니다. 다른 칸은 그대로 남습니다. 검토 대기함에서 확정한 내용도 함께 사라집니다.",
        confirmLabel: "되돌리기",
        tone: "danger",
      }))
    )
      return;
    try {
      const res = await undoSalesImport(b.id);
      toast.success(`${won(res.removed)}줄을 지웠습니다.`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "되돌리기에 실패했습니다.");
    }
  }

  if (loading) return <LoadingState label="매출을 불러오는 중…" />;

  // 불러오지 못한 것과 아직 적재하지 않은 것은 다르다 — 예전에는 둘 다 빈 퍼즐로 보였다
  if (error) {
    return (
      <PageShell width="wide">
        <PageHeader title="매출 적재" description="한 달의 원본 파일 세 개(온라인 매출이 있으면 네 개)로 판매 줄을 만듭니다." />
        <ErrorState
          title="적재 상태를 불러올 수 없습니다"
          description={error instanceof Error ? error.message : "알 수 없는 오류"}
        />
      </PageShell>
    );
  }

  const reviewCount = lines.filter(
    (l) => l.status === "needs_review" && l.date.startsWith(activeMonth),
  ).length;
  const monthEvents = events.filter((e) => e.from.startsWith(activeMonth)).length;

  /**
   * 지금 어느 단계인가 — **퍼즐 칸이 그대로 단계다.** 새 상태를 두면 화면이
   * 말하는 단계와 실제 적재 상태가 어긋날 수 있다 (파일은 떨어뜨리는 즉시
   * 해석·적재되므로 「해석 확인」은 채워진 칸을 대조하는 단계다).
   */
  const step = puzzle.filled === 0 ? 0 : puzzle.complete ? 2 : 1;

  return (
    <PageShell width="wide">
      <ToolbarPortal order={0}>
        <MonthStepper
          glass
          months={months}
          value={activeMonth}
          onChange={setMonth}
          labelFor={(m) => {
            const p = puzzleOf(imports, m);
            return p.complete ? "완성" : p.filled > 0 ? `${p.filled}/${p.total}` : undefined;
          }}
        />
      </ToolbarPortal>

      <PageHeader
        title="매출 적재"
        description="한 달의 원본 파일 세 개(온라인 매출이 있으면 네 개)를 끌어다 놓으면 판매 줄이 바로 만들어집니다."
        className="mb-3"
        meta={
          // 색만으로 전하지 않는다 — 「완성」·「채움」이 글자로 함께 붙는다
          <StatusDot
            tone={puzzle.complete ? "success" : "warning"}
            className="text-nd-body font-medium text-nd-fg-2"
          >
            <Icon icon={Puzzle} size={14} />
            {monthLabel(activeMonth)} 퍼즐{" "}
            <span className="nd-num font-semibold text-nd-fg">
              {puzzle.filled}/{puzzle.total}
            </span>{" "}
            {puzzle.complete ? "완성" : "채움"}
          </StatusDot>
        }
      />

      {/* 기준 한 줄 + ⓘ — 예전에는 이 설명이 화면 위 InlineNotice 한 장이었다 */}
      <BasisLine
        className="mb-4"
        items={["여기서 만드는 것은 판매 줄(수량·상품·원가)", "장부에는 아무것도 쓰지 않습니다"]}
      >
        <InfoPopover
          label="적재 규칙"
          title="이 화면이 하는 일"
          terms={[
            {
              term: "판매 줄",
              desc: "수량 · 상품 · 원가입니다. 같은 판매의 금액은 카드사 정산 입금으로 재무 장부에 이미 들어와 있어, 장부에는 아무것도 쓰지 않습니다.",
            },
            {
              term: "칸 배정",
              desc: "파일은 어느 칸에 놓아도 내용(시트 상단의 매장·출처)으로 알아서 제자리로 갑니다. 온라인 칸은 그 달 온라인 매출이 있을 때만 채웁니다 — 비어 있어도 퍼즐은 완성됩니다.",
            },
            {
              term: "즉시 적재",
              desc: "확인 단계가 없습니다 — 떨어뜨리면 해석해서 바로 적재합니다. 잘못 넣었으면 그 칸의 「되돌리기」로 그 파일 몫만 지웁니다.",
            },
            {
              term: "네이버 암호",
              desc: "서버가 환경변수(NEANDER_SALES_XLSX_PASSWORD)로 풉니다. 없을 때만 아래 「네이버 파일 비밀번호」로 묻습니다.",
            },
          ]}
        />
      </BasisLine>

      {/* 단계 — 퍼즐 칸에서 유도한다 (위 step 주석) */}
      <Stepper
        className="mb-5"
        ariaLabel="적재 진행 단계"
        current={step}
        steps={[
          { key: "upload", label: "파일 올리기", hint: "네이버 1 · 페이히어 2 · 온라인은 있을 때" },
          {
            key: "check",
            label: "해석 확인",
            hint: `${puzzle.filled}/${puzzle.total} 칸 · 줄 수와 합계 대조`,
          },
          {
            key: "done",
            label: "적재 완료",
            hint: reviewCount > 0 ? `미확정 ${won(reviewCount)}건` : "미확정 없음",
          },
        ]}
      />

      {/* 배너 자리는 경고·오류만 — 설명은 위 기준 줄로 내렸다 */}
      {masterEmpty && (
        <InlineNotice tone="warning" icon={TriangleAlert} className="mb-4">
          상품 마스터가 비어 있어 <b>모든 줄이 미확정으로 적재됩니다.</b> 먼저{" "}
          <Link href="/neander/sales/master" className="font-medium underline">
            마스터를 적재
          </Link>
          하세요.
        </InlineNotice>
      )}

      {pageError && (
        <InlineNotice tone="danger" icon={TriangleAlert} className="mb-4">
          {pageError}
        </InlineNotice>
      )}

      {/* ---- 퍼즐 칸 — 필수 셋 + 온라인(있을 때만) ---- */}
      <div
        className={cn(
          "mb-5 grid gap-4 rounded-nd-lg md:grid-cols-2 xl:grid-cols-4",
          justSolved && "nd-puzzle-complete",
        )}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void ingest(Array.from(e.dataTransfer.files ?? []));
        }}
      >
        {puzzle.pieces.map(({ slot, batch }) => (
          <Piece
            key={slot.key}
            slot={slot}
            batch={batch}
            activity={activity[slot.key]}
            onFiles={(files) => void ingest(files)}
            onUndo={batch ? () => void undo(batch, slot) : undefined}
          />
        ))}
      </div>

      {/* 완성은 상태다 — 축하가 아니라 「다음 세 가지가 남았다」를 말한다 */}
      {puzzle.complete && (
        // 퍼즐이 맞춰진 순간(nd-puzzle-complete 번쩍임과 함께) 위에서 내려앉는다
        <InlineNotice tone="success" icon={CircleCheck} className="mb-5 animate-in fade-in slide-in-from-top-2 duration-nd">
          <b>{monthLabel(activeMonth)} 퍼즐이 완성됐습니다.</b> 아래 세 단계를 마치면 월 손익이
          확정됩니다.
        </InlineNotice>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <NextStep
          href="/neander/sales/event-entry"
          icon={CalendarPlus}
          n={1}
          title="이벤트 입력"
          sub={monthEvents > 0 ? `${monthEvents}건 등록됨` : "이 달 행사를 적으면 판매가 행사에 붙습니다"}
        />
        <NextStep
          href="/neander/sales/review"
          icon={Inbox}
          n={2}
          title="검토 대기함"
          sub={reviewCount > 0 ? `미확정 ${won(reviewCount)}건` : "미확정 없음"}
          tone={reviewCount > 0 ? "warning" : undefined}
        />
        <NextStep href="/neander/sales" icon={ChartNoAxesColumn} n={3} title="월 손익" sub="매장별 공헌이익 · 영업이익" />
      </div>

      {/* ---- 한 달에 한 번 쓰는 것들은 접어 둔다 (목업 하단의 세 줄) ---- */}
      <div className="flex flex-col gap-2">
        <Disclosure
          icon={KeyRound}
          title="네이버 파일 비밀번호"
          description="서버에 암호가 없을 때만 씁니다"
          open={pwOpen}
          onOpenChange={setPwOpen}
          meta={
            askPassword ? (
              <Badge tone="warning" size="sm">
                입력 필요
              </Badge>
            ) : undefined
          }
        >
          <p className="mb-3 text-nd-caption text-nd-fg-2">
            서버에 <code className="nd-num">NEANDER_SALES_XLSX_PASSWORD</code> 가 없어서 묻습니다 —
            설정해 두면 다시 묻지 않습니다.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="비밀번호">
              <Input
                size="sm"
                type="password"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Button size="sm" icon={KeyRound} disabled={!password} onClick={() => setAskPassword(false)}>
              이 비밀번호로 다시 올리기
            </Button>
          </div>
        </Disclosure>

        <Disclosure
          icon={Receipt}
          title="잡수익 직접 입력"
          description="상품 조합으로 설명되지 않는 금액 — 손입력은 이 칸 하나뿐입니다"
        >
          <MiscIncomeForm onSaved={refresh} />
        </Disclosure>

        {/* bodyClassName — 표는 자기 여백(pl-5·pr-5)을 갖는다. 접이식 본문의 여백을
            그대로 두면 왼쪽이 두 번 들여쓰이고 가로 스크롤도 안쪽에서 잘린다. */}
        <Disclosure
          icon={FileSpreadsheet}
          title="적재 이력"
          description="되돌리기는 그 파일만"
          meta={`${won(imports.length)}건`}
          bodyClassName="!px-0 !py-0"
        >
          {imports.length === 0 ? (
            <EmptyState icon={FileSpreadsheet} title="아직 적재한 파일이 없습니다" className="border-0" />
          ) : (
            <TableScroll maxHeight="70vh">
              <Table minWidth={900} dense>
                <thead>
                  <tr>
                    <Th sticky="top" className="pl-5">파일</Th>
                    <Th sticky="top">출처</Th>
                    <Th sticky="top">매장·경로</Th>
                    <Th sticky="top">기간</Th>
                    <Th sticky="top" align="right">줄</Th>
                    <Th sticky="top" align="right">확정</Th>
                    <Th sticky="top" align="right">미확정</Th>
                    <Th sticky="top" align="right">합계</Th>
                    <Th sticky="top" className="pr-5" />
                  </tr>
                </thead>
                <tbody>
                  {imports.map((b) => (
                    <Tr key={b.id} className={b.undone ? "opacity-50" : undefined}>
                      <Td className="pl-5">
                        <span className="block max-w-[18rem] truncate" title={b.fileName}>
                          {b.fileName}
                        </span>
                        {b.undone && <Badge size="sm">되돌림</Badge>}
                      </Td>
                      <Td className="text-nd-fg-2">{b.sourceLabel}</Td>
                      <Td>
                        <span className="flex items-center gap-1.5">
                          <StoreBadge store={b.store} size="sm" />
                          <span className="text-nd-caption text-nd-fg-2">{routeLabel(b.route)}</span>
                        </span>
                      </Td>
                      <Td className="nd-num whitespace-nowrap text-nd-fg-2">
                        {b.from && b.to ? `${b.from}~${b.to}` : "—"}
                      </Td>
                      <Td num>{won(b.rows)}</Td>
                      <Td num className="text-nd-success-text">{won(b.resolved)}</Td>
                      <Td num className={b.needsReview > 0 ? "text-nd-warning-text" : undefined}>
                        {won(b.needsReview)}
                      </Td>
                      <Td num><Money value={b.loadedTotal} unit={false} /></Td>
                      <Td className="pr-5">
                        {/* 퍼즐 칸의 되돌리기와 **같은 함수** — 확인 문구가 갈라지지 않게 */}
                        {!b.undone && (
                          <Button size="sm" variant="ghost" icon={Undo2} onClick={() => void undo(b)}>
                            되돌리기
                          </Button>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          )}
        </Disclosure>
      </div>
    </PageShell>
  );
}

// ============================================================
//  퍼즐 조각 하나
// ------------------------------------------------------------
//  ⚠️ 여기만 공통 DropZone 을 쓰지 않는다. 두 가지 이유다.
//
//   ① 바깥 격자에도 onDrop 이 걸려 있다 (칸 사이 빈틈에 떨어뜨려도 받으려고).
//      DropZone 은 drop 을 preventDefault 만 하고 **전파를 막지 않아서**,
//      칸 안에 두면 같은 파일이 칸 한 번 · 바깥 한 번 = 두 번 적재된다.
//      매출이 조용히 두 배가 되는 사고다.
//   ② 떨어뜨리는 자리가 「안내 문구」가 아니라 **칸 전체**다 — 적재된 칸
//      (파일명·줄 수·합계가 차 있는 상태) 위에 그대로 떨어뜨려 바꿀 수 있어야
//      한다. DropZone 은 안내 버튼 하나를 그리는 부품이라 이 모양이 안 된다.
//
//  그래서 카드가 직접 받고, 키보드용으로 숨은 <input type="file"> 을 짝으로
//  둔다 (DropZone 이 하는 것과 같은 보장).
// ============================================================

function Piece({
  slot,
  batch,
  activity,
  onFiles,
  onUndo,
}: {
  slot: ImportSlot;
  batch?: SalesImportBatch;
  activity: PieceActivity;
  onFiles: (files: File[]) => void;
  onUndo?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const state: "missing" | "optional" | "busy" | "error" | "done" =
    activity.kind === "busy"
      ? "busy"
      : activity.kind === "error"
        ? "error"
        : batch
          ? "done"
          : slot.optional
            ? "optional"
            : "missing";

  const gap = batch ? batch.sourceTotal - batch.loadedTotal : 0;

  function drop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    onFiles(Array.from(e.dataTransfer.files ?? []));
  }

  return (
    <Card
      padding="none"
      className={cn("nd-puzzle-piece flex min-h-[15rem] flex-col overflow-hidden rounded-nd-lg", over && "cursor-copy")}
      data-state={state}
      data-over={over || undefined}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      aria-label={`${slot.label} — ${
        state === "done"
          ? "적재됨"
          : state === "busy"
            ? "진행 중"
            : state === "error"
              ? "오류"
              : state === "optional"
                ? "비어 있음 — 있을 때만 올리는 칸"
                : "비어 있음"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        multiple
        className="hidden"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      {/* 머리 — 어느 칸인지 */}
      <div className="flex items-start justify-between gap-2 border-b border-nd-line px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <StoreBadge store={slot.store} size="sm" />
            <span className="truncate text-nd-body font-semibold text-nd-fg">{slot.label}</span>
          </div>
          <p className="mt-0.5 truncate text-nd-micro text-nd-fg-3" title={slot.source}>
            {slot.source}
          </p>
        </div>
        <StateMark state={state} />
      </div>

      {/* 몸통 — 상태별 */}
      <div className="flex flex-1 flex-col px-4 py-3">
        {state === "busy" && activity.kind === "busy" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <Spinner />
            <p className="text-nd-body text-nd-fg">{activity.step}</p>
            <p className="max-w-full truncate text-nd-micro text-nd-fg-3" title={activity.fileName}>
              {activity.fileName}
            </p>
          </div>
        )}

        {state === "error" && activity.kind === "error" && (
          <div className="flex flex-1 flex-col gap-2">
            <p className="text-nd-caption text-nd-danger-text">{activity.message}</p>
            {activity.fileName && (
              <p className="truncate text-nd-micro text-nd-fg-3" title={activity.fileName}>
                {activity.fileName}
              </p>
            )}
            <DropHint slot={slot} onPick={() => inputRef.current?.click()} retry />
          </div>
        )}

        {(state === "missing" || state === "optional") && (
          <DropHint slot={slot} onPick={() => inputRef.current?.click()} />
        )}

        {state === "done" && batch && (
          <div className="flex flex-1 flex-col gap-2">
            <p className="flex items-center gap-1.5 text-nd-caption text-nd-fg">
              <Icon icon={FileSpreadsheet} size={14} className="shrink-0 text-nd-fg-3" />
              <span className="truncate" title={batch.fileName}>{batch.fileName}</span>
            </p>
            <p className="nd-num text-nd-micro text-nd-fg-3">
              {batch.from && batch.to ? `${batch.from} ~ ${batch.to}` : "기간 없음"}
            </p>
            {/* 칸 폭이 좁아 sm 미만에서는 한 줄씩 쌓는다 (KpiItem 이 그 폭을 스스로 안다) */}
            <div className="mt-1 grid grid-cols-1 gap-px overflow-hidden rounded-nd-md bg-[var(--nd-line)] sm:grid-cols-3 [&>*]:bg-nd-sunken">
              <KpiItem label="줄" value={won(batch.rows)} />
              <KpiItem label="확정" value={won(batch.resolved)} tone="success" />
              <KpiItem
                label="미확정"
                value={won(batch.needsReview)}
                tone={batch.needsReview > 0 ? "warning" : "neutral"}
              />
            </div>
            <p className="nd-num text-nd-caption text-nd-fg">
              합계 <Money value={batch.loadedTotal} />
            </p>
            {gap !== 0 && (
              <p className="flex items-start gap-1 text-nd-micro text-nd-warning-text">
                <Icon icon={TriangleAlert} size={12} className="mt-0.5 shrink-0" />
                원본 합계와 {won(Math.abs(gap))}원 다릅니다 (0원 결제·환불 제외분인지 확인)
              </p>
            )}
            {batch.needsReview > 0 && (
              <Link href="/neander/sales/review" className="text-nd-micro font-medium text-nd-accent-strong underline">
                미확정 {won(batch.needsReview)}건 → 검토 대기함
              </Link>
            )}
            <div className="mt-auto flex items-center justify-between gap-2 pt-2">
              <Button size="sm" variant="ghost" icon={Upload} onClick={() => inputRef.current?.click()}>
                다른 파일로 바꾸기
              </Button>
              {onUndo && (
                <Button size="sm" variant="ghost" icon={Undo2} onClick={onUndo}>
                  되돌리기
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

/** 칸 상태 — 색만으로 전하지 않게 글자를 함께 둔다 (공통 Badge) */
function StateMark({ state }: { state: "missing" | "optional" | "busy" | "error" | "done" }) {
  if (state === "done")
    return (
      <Badge tone="success" size="sm" className="shrink-0">
        <Icon icon={CircleCheck} size={12} /> 적재됨
      </Badge>
    );
  // 비어 있어도 괜찮은 칸 — 붉게 칠하지 않는다
  if (state === "optional")
    return (
      <Badge size="sm" className="shrink-0">
        있을 때만
      </Badge>
    );
  if (state === "busy")
    return (
      <Badge tone="accent" size="sm" dot className="shrink-0">
        진행 중
      </Badge>
    );
  if (state === "error")
    return (
      <Badge tone="danger" size="sm" className="shrink-0">
        <Icon icon={CircleAlert} size={12} /> 오류
      </Badge>
    );
  return (
    <Badge tone="danger" size="sm" className="shrink-0">
      <Icon icon={CircleAlert} size={12} /> 비어 있음
    </Badge>
  );
}

function DropHint({ slot, onPick, retry = false }: { slot: ImportSlot; onPick: () => void; retry?: boolean }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex flex-1 flex-col items-center justify-center gap-2 rounded-nd-md border border-dashed border-nd-border px-3 py-5 text-center transition-colors duration-nd-fast hover:bg-nd-sunken"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-nd-fg/[.06] text-nd-fg-2">
        <Icon icon={slot.encrypted ? LockOpen : Upload} size={18} />
      </span>
      <span className="text-nd-caption font-medium text-nd-fg">
        {retry ? "다른 파일을 끌어다 놓으세요" : "파일을 끌어다 놓으세요"}
      </span>
      <span className="text-nd-micro text-nd-fg-3">{slot.example}</span>
      {slot.encrypted && (
        <span className="text-nd-micro text-nd-fg-3">암호는 서버가 자동으로 풉니다</span>
      )}
    </button>
  );
}

function NextStep({
  href,
  icon,
  n,
  title,
  sub,
  tone,
}: {
  href: string;
  icon: typeof Inbox;
  n: number;
  title: string;
  sub: string;
  tone?: "warning";
}) {
  return (
    <Link
      href={href}
      className="nd-surface flex items-center gap-3 rounded-nd-lg p-3 text-left transition-colors duration-nd-fast hover:bg-nd-sunken"
    >
      <span className="nd-num flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-nd-sunken text-nd-caption font-semibold text-nd-fg-2">
        {n}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-nd-body font-medium text-nd-fg">
          <Icon icon={icon} size={14} className="text-nd-fg-3" />
          {title}
        </span>
        <span className={cn("block truncate text-nd-micro", tone === "warning" ? "text-nd-warning-text" : "text-nd-fg-3")}>
          {sub}
        </span>
      </span>
    </Link>
  );
}

// ============================================================
//  잡수익 (비표준금액) — 엑셀 아이디매장 시트 아래 칸의 자리
// ------------------------------------------------------------
//  매장 매출은 사람이 한 줄씩 타이핑할 성질이 아니다. 손입력은 **이 칸
//  하나만** 남긴다 — 상품 조합으로 설명되지 않는 금액이 실제로 있고,
//  파일로도 들어오지 않기 때문이다. status="manual" 로 저장하므로 검토
//  대기함에 쌓이지 않고, 원가는 적은 값만 쓴다.
//
//  카드에서 접이식(Disclosure) 안으로 옮겼다 — 한 달에 한두 번 쓰는 칸이
//  퍼즐 세 칸과 다음 할 일을 아래로 밀고 있었다. 제목·설명은 Disclosure 가
//  그리므로 여기서는 폼만 그린다.
// ============================================================
function MiscIncomeForm({ onSaved }: { onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [f, setF] = useState({
    date: new Date().toISOString().slice(0, 10),
    store: "id" as SalesStore,
    route: "payhere" as PayRoute,
    amount: "",
    material: "",
    memo: "",
  });
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(f.amount.replace(/[^\d]/g, ""));
    if (!amount || amount <= 0) {
      toast.error("금액을 올바르게 입력하세요.");
      return;
    }
    if (!f.date) {
      toast.error("날짜가 필요합니다.");
      return;
    }
    setSaving(true);
    try {
      await addSalesLine({
        date: f.date,
        store: f.store,
        route: f.route,
        amount,
        qty: 1,
        status: "manual",
        raw: f.memo.trim() || "잡수익 (직접입력)",
        manualMaterial: Number(f.material.replace(/[^\d]/g, "")) || 0,
        memo: f.memo.trim() || undefined,
        createdAt: Date.now(),
      });
      toast.success("잡수익을 기록했습니다.");
      setF({ ...f, amount: "", material: "", memo: "" });
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* 칸 너비는 격자 열이 정한다 — 입력칸마다 w-24 를 박으면 줄이 다시 삐뚤어진다 */}
      <FormRow
        as="form"
        onSubmit={submit}
        className="grid-cols-2 md:grid-cols-4 xl:grid-cols-[9rem_7rem_9.5rem_8rem_7.5rem_minmax(9rem,1fr)_auto]"
      >
        <Field label="날짜" required>
          <Input size="sm" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Field>
        <Field label="매장" required>
          <Select size="sm" value={f.store} onChange={(e) => setF({ ...f, store: e.target.value as SalesStore })}>
            {SALES_STORES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="결제 경로" hint="수수료율">
          <Select size="sm" value={f.route} onChange={(e) => setF({ ...f, route: e.target.value as PayRoute })}>
            {PAY_ROUTES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="금액(원)" required>
          <Input
            size="sm"
            inputMode="numeric"
            className="nd-num"
            placeholder="53000"
            value={f.amount}
            onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d]/g, "") })}
          />
        </Field>
        <Field label="원가(원)" hint="모르면 비워 둡니다" className="col-span-2 md:col-span-1">
          <Input
            size="sm"
            inputMode="numeric"
            className="nd-num"
            placeholder="0"
            value={f.material}
            onChange={(e) => setF({ ...f, material: e.target.value.replace(/[^\d]/g, "") })}
          />
        </Field>
        <Field label="메모" className="col-span-2 xl:col-span-1">
          <Input size="sm" placeholder="예: 50ml + 사쉐 복합결제" value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} />
        </Field>
        <FieldAction className="col-span-2 md:col-span-1">
          <Button type="submit" size="sm" loading={saving} className="w-full md:w-auto">
            기록
          </Button>
        </FieldAction>
      </FormRow>
      <TableNote className="pt-2">
        직접입력 줄은 검토 대기함에 쌓이지 않고, 원가는 적은 값만 씁니다 — 비워 두면 0 으로
        잡히므로 그 줄의 공헌이익은 과대평가됩니다.
      </TableNote>
    </>
  );
}
