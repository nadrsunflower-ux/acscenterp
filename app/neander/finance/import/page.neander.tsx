"use client";

// ============================================================
//  엑셀 임포트 — 한 달은 계좌마다 한 파일, 카드사마다 한 파일
// ------------------------------------------------------------
//  은행에서 받은 파일을 손으로 고칠 필요가 없다. 끌어다 놓으면 **열 이름**
//  으로 은행·카드사를 알아내고(어댑터), 파일 안의 계좌번호로 어느 칸인지
//  정하고, 중복을 걸러 자동분류해 **바로 적재한다.** 확인 단계가 없다.
//
//  칸은 마스터의 계좌·카드에서 만든다 (finance/import-slots.ts):
//    통장   매달 파일이 따로 오므로 계좌마다 한 칸
//    카드   카드사가 모든 카드를 한 파일에 담아 주므로 카드사마다 한 칸
//
//  사람이 손대야 하는 경우는 셋뿐이다:
//    ① 신한은행처럼 파일 안에 계좌번호가 없고 후보가 여럿일 때 — 잔액·
//       거래처 이력으로 추려 보여주고 고르게 한다
//    ② 국민 법인카드의 해외 승인(달러) — 환율을 그 칸에서 받는다
//    ③ 서버가 모르는 비밀번호로 잠긴 파일
//
//  거래가 한 건도 없는 달은 올릴 파일이 없다. 그 칸은 「이 달 거래 없음」
//  으로 채운다 — 거래를 달지 않는 배치 하나가 남는다 (markNoActivity).
//
//  빠진 칸은 붉게, 채워진 칸은 초록으로 빛난다 (neander.css 의
//  nd-puzzle-piece — 매출 적재와 같은 연출).
//
//  ⚠️ 페이히어·네이버 파일은 여기서 적재하지 않고 **대사**만 한다. 매장
//     매출은 이미 정산 입금으로 장부에 있어서 넣으면 두 번 잡힌다.
//
//  ── 카드 사용 메모 (카카오톡) ──
//  법인카드 단톡방의 「대화 내보내기」(.csv)도 같은 자리에 놓는다. 거래를 만들지
//  않고, 이미 들어온 카드 거래에 「구매처 / 품목」 메모를 붙인다 (card-chat.ts).
//  명세서의 거래처는 결제대행사라 그 메모가 자동분류의 근거가 된다. 내보내기는
//  늘 방 전체라 몇 번을 올려도 된다 — 새로 붙는 것만 붙는다.
//
//  화면 순서는 승인 목업(all-pages/finance-import.png)을 따른다:
//  제목 줄 → 진행 단계 → 칸(퍼즐) → 파일 놓는 자리 → 손봐야 할 파일 →
//  다음 할 일 → 이번에 적재한 것 → 접어 둔 보조(추가 확인·적재 이력).
//  화면 아래쪽 두 상자는 자주 열지 않으므로 Disclosure 로 접는다.
// ============================================================

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  CalendarCheck,
  History,
  Inbox,
  Info,
  KeyRound,
  MessageSquareText,
  Puzzle,
  Settings2,
  TriangleAlert,
  Undo2,
  Upload,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  cn,
  Disclosure,
  DisclosureGroup,
  DropZone,
  EmptyState,
  Field,
  FieldAction,
  FormRow,
  Icon,
  InlineNotice,
  Input,
  KpiItem,
  KpiStrip,
  LoadingState,
  Money,
  MonthStepper,
  PageHeader,
  PageShell,
  SectionHeader,
  Select,
  StatTile,
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
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { useAppData } from "@/components/neander/app-data";
import {
  NextStep,
  PuzzlePiece,
  UnassignedCard,
  type PieceActivity,
} from "@/components/neander/finance/ImportPuzzle";
import {
  detectSource,
  looksEncrypted,
  parseWithAdapter,
  readWorkbook,
  type ParseFileResult,
} from "@/lib/neander/finance/adapters";
import {
  reconcilePos,
  storeToUnit,
  type PosResult,
} from "@/lib/neander/finance/adapters/pos";
import { parseReconcileSource } from "@/lib/neander/finance/adapters";
import {
  buildVendorIndex,
  classifyOne,
  summarize,
  type ClassifyContext,
} from "@/lib/neander/finance/classify";
import {
  looksLikeKakaoChat,
  matchCardChat,
  parseCardChat,
  planCardChat,
  waitingForStatement,
  type CardChatPatch,
} from "@/lib/neander/finance/card-chat";
import { engineSigOf, isEngineOwned, relearnPending } from "@/lib/neander/finance/relearn";
import {
  buildFinSlots,
  finPuzzleOf,
  monthOfRows,
  NO_ACTIVITY_LABEL,
  resolveFinSlot,
  splitAmounts,
  withSlotAccount,
  type AccountGuess,
  type FinBank,
  type FinImportSlot,
} from "@/lib/neander/finance/import-slots";
import {
  applyFinEdits,
  fetchFinDedupCounts,
  bulkAddFinTransactions,
  createFinImport,
  decryptFinanceFile,
  undoFinImport,
} from "@/lib/neander/finance/client";
import type { FinImportBatch, FinTransaction, FinTransactionInput } from "@/lib/neander/finance/types";
import { availableMonths } from "@/lib/neander/finance/aggregate";
import { reviewHref } from "@/lib/neander/finance/ledgerLink";
import {
  selectableMonths,
  workingMonthOf,
} from "@/lib/neander/months";
import {
  formatTimestamp,
  monthLabel,
} from "@/lib/neander/format";
import { describeFinanceError } from "@/lib/neander/finance/errors";

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

/** 어느 계좌인지 못 정한 파일 — 사람이 고를 때까지 들고 있는다 */
interface Unassigned {
  id: string;
  file: File;
  buf: ArrayBuffer;
  bank: FinBank;
  rows: number;
  period: { from: string; to: string } | null;
  ranked: AccountGuess[];
}

/** 이번에 적재한 결과 한 줄 */
interface SessionResult {
  fileName: string;
  slotLabel: string;
  inserted: number;
  skipped: number;
  errors: number;
  income: number;
  expense: number;
  confirmed: number;
  suggested: number;
  needsReview: number;
}

/** 카톡 카드 메모를 올린 결과 */
interface ChatResult {
  fileName: string;
  /** 파일에서 읽은 결제 기록 */
  entries: number;
  /** 이번에 새로 붙인 메모 */
  attached: number;
  /** 전에 올려서 이미 붙어 있던 것 */
  already: number;
  /** 메모를 보고 프로젝트를 지정한 거래 */
  projects: { id: string; date: string; vendor: string; amount: number; memo: string; code: string }[];
  /** 메모 덕에 제안이 바뀐 대기 건 */
  relearned: number;
  /** 카드 명세서가 아직 없는 달의 기록 */
  waiting: { month: string; count: number }[];
  /** 그대로 되돌리는 패치 */
  undo: CardChatPatch[];
}

/** 한 요청에 보내는 메모 수 — 진행률을 보이려고 끊는다 */
const CHAT_CHUNK = 300;

let seq = 0;

export default function ImportPage() {
  const {
    transactions,
    accounts,
    paymentMethods,
    vendorRules,
    classRules,
    vendorIndex,
    projects,
    imports,
    masterEmpty,
    loading,
    refresh,
    applyTransactions,
  } = useFinance();
  const { currentMember } = useAppData();
  const toast = useToast();
  const confirm = useConfirm();

  // ---- 칸과 달 ----------------------------------------------
  const slots = useMemo(() => buildFinSlots(paymentMethods), [paymentMethods]);
  const months = useMemo(
    () =>
      selectableMonths([
        ...availableMonths(transactions),
        ...imports.map((b) => b.month).filter((m): m is string => !!m),
      ]),
    [transactions, imports],
  );
  const [month, setMonth] = useState("");
  const activeMonth =
    month || workingMonthOf(months, (m) => finPuzzleOf(slots, m, transactions, imports));
  const puzzle = useMemo(
    () => finPuzzleOf(slots, activeMonth, transactions, imports),
    [slots, activeMonth, transactions, imports],
  );

  // ---- 진행 상태 --------------------------------------------
  const [activity, setActivity] = useState<Record<string, PieceActivity>>({});
  const setAct = (key: string, a: PieceActivity) => setActivity((prev) => ({ ...prev, [key]: a }));
  const actOf = (key: string): PieceActivity => activity[key] ?? { kind: "idle" };
  /** 환율을 기다리는 파일 (칸 키 → 파일) */
  const fxWaiting = useRef(new Map<string, { file: File; buf: ArrayBuffer }>());
  const [unassigned, setUnassigned] = useState<Unassigned[]>([]);
  const [posResults, setPosResults] = useState<{ id: string; pos: PosResult }[]>([]);
  const [results, setResults] = useState<SessionResult[]>([]);
  const [chatResult, setChatResult] = useState<ChatResult | null>(null);
  const [chatStep, setChatStep] = useState<string | null>(null);
  /** 카톡 파일은 명세서 뒤에 처리한다 — 방금 적재한 거래까지 봐야 해서 최신 목록을 든다 */
  const txRef = useRef(transactions);
  txRef.current = transactions;
  const [pageError, setPageError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [askPassword, setAskPassword] = useState(false);
  /** 「추가 확인 (선택)」 이 펼쳐져 있는가 — 서버가 암호를 물으면 저절로 펼친다 */
  const [extrasOpen, setExtrasOpen] = useState(false);
  useEffect(() => {
    if (askPassword) setExtrasOpen(true);
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

  // 달을 바꾸면 이전 달의 진행 표시는 의미가 없다
  useEffect(() => {
    setActivity({});
    setUnassigned([]);
    setResults([]);
    setPageError(null);
    fxWaiting.current.clear();
  }, [activeMonth]);

  const knownLast4 = useMemo(() => paymentMethods.map((p) => p.last4), [paymentMethods]);
  /** 우리 법인·사업장 이름. 사람 이름은 넣지 않는다 (adapters/util.ts 주석) */
  const ownEntities = useMemo(
    () => [...new Set(paymentMethods.map((p) => p.site).filter(Boolean))],
    [paymentMethods],
  );
  /**
   * 이미 적재된 거래를 중복 키별로 **센다** — 같은 날 같은 금액이 실제로 두 번 있을 수 있다.
   *
   * 거래 목록에는 dedupHash 를 싣지 않으므로(finance/payload.ts) 서버에서 개수만 받는다.
   * **받기 전에는 비교하지 않는다** — 빈 채로 비교하면 중복이 새 거래로 들어간다.
   * 적재·되돌리기로 거래가 바뀌면 비워서 다음에 다시 받는다.
   */
  const countsRef = useRef<Promise<Map<string, number>> | null>(null);
  function ensureCounts(): Promise<Map<string, number>> {
    if (!countsRef.current) {
      countsRef.current = fetchFinDedupCounts().catch((e) => {
        countsRef.current = null;
        throw e;
      });
    }
    return countsRef.current;
  }
  // 첫 파일이 기다리지 않게 화면에 들어오면 미리 받아 둔다
  useEffect(() => {
    void ensureCounts().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 파일 하나를 끝까지 --------------------------------------
  async function ingestOne(
    file: File,
    opts: { buf?: ArrayBuffer; forceSlot?: FinImportSlot; fxRate?: number } = {},
  ): Promise<void> {
    let slotKey: string | null = opts.forceSlot?.key ?? null;
    try {
      // ① 읽기 · 암호 해제
      let buf = opts.buf ?? (await file.arrayBuffer());
      if (!opts.buf && looksEncrypted(buf)) {
        try {
          buf = await decryptFinanceFile(file, password || undefined);
        } catch (e) {
          const err = e as Error & { needsPassword?: boolean };
          if (err.needsPassword) setAskPassword(true);
          throw err;
        }
      }

      // ② 양식 판별
      const wb = readWorkbook(buf);
      const detection = detectSource(wb, file.name);
      if (detection.pos && !opts.forceSlot) {
        const pos = parseReconcileSource(wb, file.name);
        if (!pos) throw new Error("매출 파일을 읽지 못했습니다.");
        setPosResults((prev) => [...prev, { id: `p${++seq}`, pos }]);
        return;
      }

      const parse = (last4?: string) =>
        parseWithAdapter(wb, { fileName: file.name, last4, fxRate: opts.fxRate, knownLast4, ownEntities });
      const parsed = parse(opts.forceSlot?.kind === "account" ? opts.forceSlot.last4s[0] : undefined);
      if (!parsed) {
        throw new Error(
          "이 파일의 출처를 알아내지 못했습니다. 은행·카드사에서 내려받은 원본 그대로 올려주세요.",
        );
      }
      // 추정으로 칸을 찾으면 그 계좌로 다시 읽어 바꿔 끼운다 (③)
      let result: ParseFileResult = parsed;
      if (result.rows.length === 0 && result.errors.length > 0) {
        throw new Error(result.errors[0].reason);
      }
      // 거래가 한 줄도 없는 파일 — 어느 달인지 알 수 없어 칸에 넣지 못한다.
      // (예전에는 아래 ④에서 「한 달을 넘는 파일입니다」로 잘못 안내했다.)
      // 어느 칸인지 알면 그 칸에 알린다 — 「거래 없음」 버튼이 바로 거기 있다.
      if (result.rows.length === 0) {
        const detected = result.detectedLast4[0];
        const known =
          opts.forceSlot ??
          (detected ? slots.find((s) => s.kind === "account" && s.last4s.includes(detected)) : undefined);
        if (known) slotKey = known.key;
        throw new Error(
          `거래가 한 건도 없는 파일입니다. ${monthLabel(activeMonth)}에 거래가 없었다면 칸의 「이 달 거래 없음」을 누르세요.`,
        );
      }

      // ③ 어느 칸인가
      let slot = opts.forceSlot;
      if (!slot) {
        const res = resolveFinSlot(result, slots, transactions);
        if (res.kind === "none") throw new Error(res.message);
        if (res.kind === "ambiguous") {
          const period = monthOfRows(result.rows);
          setUnassigned((prev) => [
            ...prev,
            {
              id: `u${++seq}`,
              file,
              buf,
              bank: res.bank,
              rows: result.rows.length,
              period: period ? { from: period.from, to: period.to } : null,
              ranked: res.ranked,
            },
          ]);
          return;
        }
        slot = res.slot;
        // 추정으로 찾은 칸이면 줄에 아직 계좌가 없다 — 그 계좌로 다시 읽는다
        result = withSlotAccount(result, slot, parse);
      }
      slotKey = slot.key;
      setAct(slot.key, { kind: "busy", step: "읽는 중…", fileName: file.name });

      // ④ 기간 — 한 달짜리 파일이어야 칸에 넣을 수 있다
      const period = monthOfRows(result.rows);
      if (!period) {
        throw new Error("한 달을 넘는 파일입니다. 달마다 따로 내려받아 올려주세요.");
      }
      if (period.month !== activeMonth) {
        throw new Error(
          `${monthLabel(period.month)} 파일입니다. 지금 고른 달은 ${monthLabel(activeMonth)} 입니다 — 위에서 달을 바꾸거나 맞는 파일을 올려주세요.`,
        );
      }

      // ⑤ 외화 — 환율을 받기 전에는 적재하지 않는다 (0원으로 넣으면 조용히 사라진다)
      if (result.needs.fxCurrency && !opts.fxRate) {
        fxWaiting.current.set(slot.key, { file, buf });
        setAct(slot.key, {
          kind: "fx",
          fileName: file.name,
          currency: result.needs.fxCurrency,
          fxRows: result.needs.fxRows ?? 0,
          rows: result.rows.length,
        });
        return;
      }

      // ⑥ 이미 채워진 칸이면 바꿀지 묻는다
      const piece = puzzle.pieces.find((p) => p.slot.key === slot!.key);
      if (piece?.batch?.noActivity) {
        // 「거래 없음」 표시만 있던 칸 — 지울 거래가 없으니 묻지 않고 표시를 거둔다
        await undoFinImport(piece.batch.id);
      } else if (piece?.filled) {
        const ok = await confirm({
          title: piece.batch
            ? `${slot.label} 칸에 이미 「${piece.batch.fileName}」이 있습니다`
            : `${slot.label} 칸에 이미 ${monthLabel(activeMonth)} 거래 ${won(piece.count)}건이 있습니다`,
          message: piece.batch
            ? "그 적재를 되돌리고 이 파일로 바꿉니다. 검토 대기함에서 고친 분류도 함께 지워집니다."
            : "옛 방식(통합거래장)으로 들어온 거래라 되돌릴 배치가 없습니다. 그대로 두고 겹치지 않는 건만 더합니다.",
          confirmLabel: piece.batch ? "바꾸기" : "계속",
          ...(piece.batch ? { tone: "danger" as const } : {}),
        });
        if (!ok) {
          setAct(slot.key, { kind: "idle" });
          return;
        }
        if (piece.batch) {
          setAct(slot.key, { kind: "busy", step: "이전 적재 되돌리는 중…", fileName: file.name });
          await undoFinImport(piece.batch.id);
          // 되돌린 거래는 더 이상 중복이 아니다 — 개수를 다시 받는다
          countsRef.current = null;
        }
      }

      // ⑦ 중복 검사 · 자동분류
      setAct(slot.key, { kind: "busy", step: "분류 중…", fileName: file.name });
      const existingCounts = await ensureCounts();
      const seen = new Map<string, number>();
      const prepared = result.rows.map((row) => {
        const nth = seen.get(row.dedupHash) ?? 0;
        seen.set(row.dedupHash, nth + 1);
        return {
          row,
          duplicate: nth < (existingCounts.get(row.dedupHash) ?? 0),
          suggestion: classifyOne({ ...row, hint: row.hint }, {
            vendorIndex,
            vendorRules,
            paymentMethods,
            accounts,
            // 사람이 정해 둔 분류 규칙 — 이력보다 먼저 본다 (class-rules.ts)
            classRules,
          }),
        };
      });
      const fresh = prepared.filter((p) => !p.duplicate);
      const skipped = prepared.length - fresh.length;
      if (fresh.length === 0) {
        setAct(slot.key, { kind: "idle" });
        setResults((prev) => [
          ...prev,
          {
            fileName: file.name,
            slotLabel: slot!.label,
            inserted: 0,
            skipped,
            errors: result.errors.length,
            income: 0,
            expense: 0,
            confirmed: 0,
            suggested: 0,
            needsReview: 0,
          },
        ]);
        toast.success(`${slot.label} — 모두 이미 들어와 있습니다 (중복 ${won(skipped)}건).`);
        return;
      }

      // ⑧ 적재 — 배치는 파일 하나가 하나 (되돌리기가 "그 파일만" 이어야 한다)
      setAct(slot.key, { kind: "busy", step: `${won(fresh.length)}건 적재 중…`, fileName: file.name });
      // 수입·지출은 나눠 센다 — 한 숫자로 더하면 뜻이 없어진다 (gross 는 늘 양수)
      const money = splitAmounts(fresh.map((p) => ({ ...p.row, txType: p.suggestion.txType ?? p.row.txType })));
      const { id: batchId } = await createFinImport({
        fileName: file.name,
        inserted: fresh.length,
        skipped,
        byMemberId: currentMember?.id,
        month: period.month,
        slotKey: slot.key,
        adapterId: result.adapterId,
        from: period.from,
        to: period.to,
        last4s: result.detectedLast4.length ? result.detectedLast4 : slot.last4s,
        income: money.income,
        expense: money.expense,
      });

      const rows: FinTransactionInput[] = fresh.map(({ row, suggestion }) => ({
        date: row.date,
        datetime: row.datetime,
        last4: row.last4,
        // 분류가 유형을 고쳤으면 그것을 쓴다 (은행은 방향만 안다)
        txType: suggestion.txType ?? row.txType,
        bizMajor: suggestion.bizMajor,
        bizMinor: suggestion.bizMinor,
        acctMajor: suggestion.acctMajor,
        acctMid: suggestion.acctMid,
        acctMinor: suggestion.acctMinor,
        vendor: row.vendor,
        acctNote: row.acctNote,
        personalUse: row.personalUse,
        projectCode: row.projectCode,
        gross: row.gross,
        adjust: row.adjust,
        site: suggestion.site,
        note: row.note,
        status: suggestion.status,
        classReason: suggestion.classReason,
        refundMatchId: row.refundMatchId,
        dedupHash: row.dedupHash,
        importBatchId: batchId,
        balanceAfter: row.balanceAfter,
      }));
      await bulkAddFinTransactions(rows, (done, total) =>
        setAct(slot!.key, { kind: "busy", step: `적재 ${done}/${total}`, fileName: file.name }),
      );

      const sum = summarize(fresh.map((p) => p.suggestion));
      setResults((prev) => [
        ...prev,
        {
          fileName: file.name,
          slotLabel: slot!.label,
          inserted: fresh.length,
          skipped,
          errors: result.errors.length,
          income: money.income,
          expense: money.expense,
          confirmed: sum.confirmed,
          suggested: sum.suggested,
          needsReview: sum.needsReview,
        },
      ]);
      fxWaiting.current.delete(slot.key);
      setAct(slot.key, { kind: "idle" });
      toast.success(
        `${slot.label} — ${won(fresh.length)}건 적재${skipped > 0 ? ` · 중복 ${won(skipped)}건 제외` : ""}`,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (slotKey) setAct(slotKey, { kind: "error", message, fileName: file.name });
      else setPageError(`${file.name} — ${message}`);
    }
  }

  // ---- 카톡 카드 메모 ----------------------------------------
  /** 여러 줄 패치를 끊어 보내고, 서버가 돌려준 거래를 모은다 */
  async function sendPatches(patches: CardChatPatch[], label: string): Promise<FinTransaction[]> {
    const saved: FinTransaction[] = [];
    for (let i = 0; i < patches.length; i += CHAT_CHUNK) {
      setChatStep(`${label} ${won(Math.min(i + CHAT_CHUNK, patches.length))}/${won(patches.length)}`);
      const res = await applyFinEdits({
        // 지울 값은 null 로 보낸다 (서버가 그대로 저장한다)
        updates: patches.slice(i, i + CHAT_CHUNK) as { id: string; patch: Partial<FinTransactionInput> }[],
        inserts: [],
        deletes: [],
      });
      saved.push(...res.transactions);
    }
    if (saved.length) applyTransactions({ upsert: saved });
    return saved;
  }

  /**
   * 법인카드 단톡방 내보내기 — 거래를 만들지 않고 메모를 붙인다.
   * 붙인 뒤에는 그 메모를 근거로 대기 건을 다시 분류한다 (제안까지만 — relearn.ts).
   */
  async function ingestChat(file: File, text: string): Promise<void> {
    try {
      setChatStep("읽는 중…");
      const entries = parseCardChat(text);
      if (entries.length === 0) {
        throw new Error("결제 기록을 찾지 못했습니다. 법인카드 단톡방의 「대화 내보내기」 파일이 맞는지 확인해 주세요.");
      }
      const rows = txRef.current;
      const match = matchCardChat(entries, rows, paymentMethods);
      const plan = planCardChat(match.matched, projects, (t) => (isEngineOwned(t) ? engineSigOf(t) : undefined));
      const saved = await sendPatches(plan.updates, "메모 붙이는 중");

      // 메모가 붙은 대기 건을 다시 분류한다. 확정은 만들지 않는다 — 여기는 아무도
      // 한 건씩 보지 않는 일괄 작업이다. 확정할 만한 것은 검토 대기함이 알아서 한다.
      const byId = new Map(saved.map((t) => [t.id, t]));
      const merged = rows.map((t) => byId.get(t.id) ?? t);
      const ctx = {
        vendorIndex: buildVendorIndex(merged),
        vendorRules,
        paymentMethods,
        accounts,
        ...(classRules ? { classRules } : {}),
      } as ClassifyContext;
      const relearned = relearnPending(merged, ctx, {
        confirm: false,
        owned: (t) => !!t.cardMemo && isEngineOwned(t),
      });
      await sendPatches(
        relearned.map((c) => ({ id: c.id, patch: c.patch })),
        "제안 고치는 중",
      );

      // 되돌리기 — 메모를 떼고, 다시 분류한 건은 분류도 전으로
      const undo = new Map(plan.undo.map((u) => [u.id, { ...u.patch }]));
      relearned.forEach((c) => {
        const b = c.before;
        undo.set(c.id, {
          ...(undo.get(c.id) ?? {}),
          status: b.status,
          txType: b.txType,
          acctMajor: b.acctMajor ?? null,
          acctMid: b.acctMid ?? null,
          acctMinor: b.acctMinor ?? null,
          bizMajor: b.bizMajor ?? null,
          bizMinor: b.bizMinor ?? null,
          classReason: b.classReason ?? null,
          engineSig: engineSigOf(b),
        });
      });

      // 같은 파일을 다시 올리면 새로 붙는 것이 없다 — 그때 앞서 붙인 것의 되돌리기를 잃지 않게
      // 이어 붙인다. 같은 거래는 먼저 것이 이긴다 (가장 처음 상태로 돌아가야 한다).
      const earlier = chatResult?.undo ?? [];
      earlier.forEach((u) => undo.set(u.id, { ...(undo.get(u.id) ?? {}), ...u.patch }));

      setChatResult({
        fileName: file.name,
        entries: entries.length,
        attached: plan.updates.length,
        already: match.already,
        projects: plan.projects.map((p) => ({
          id: p.tx.id,
          date: p.tx.date,
          vendor: p.tx.vendor ?? "",
          amount: p.tx.gross ?? 0,
          memo: p.memo,
          code: p.code,
        })),
        relearned: relearned.length,
        waiting: waitingForStatement(match.unmatched, merged, paymentMethods),
        undo: [...undo.entries()].map(([id, patch]) => ({ id, patch })),
      });
      toast.success(
        plan.updates.length > 0
          ? `카드 메모 ${won(plan.updates.length)}건을 거래에 붙였습니다.`
          : "새로 붙일 메모가 없습니다 — 모두 이미 붙어 있거나 짝이 될 카드 거래가 아직 없습니다.",
      );
    } catch (e) {
      const f = describeFinanceError(e);
      setPageError(`${file.name} — ${f.detail || f.title}`);
    } finally {
      setChatStep(null);
    }
  }

  async function undoChat() {
    if (!chatResult || busyRef.current) return;
    const ok = await confirm({
      title: `이 화면에서 붙인 카드 메모를 뗄까요? (거래 ${won(chatResult.undo.length)}건)`,
      message: "메모와, 메모를 보고 지정한 프로젝트·고친 제안을 올리기 전으로 돌립니다. 그 거래의 분류를 그 뒤에 고쳤다면 그것도 같이 돌아갑니다.",
      confirmLabel: "되돌리기",
      tone: "danger",
    });
    if (!ok) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await sendPatches(chatResult.undo, "되돌리는 중");
      setChatResult(null);
      toast.success("카드 메모를 올리기 전으로 되돌렸습니다.");
    } catch (e) {
      const f = describeFinanceError(e);
      toast.error(f.detail, { title: f.title });
    } finally {
      setChatStep(null);
      busyRef.current = false;
      setBusy(false);
    }
  }

  /** 여러 파일을 한 번에 — 순서대로 (바꾸기 확인이 겹치지 않게) */
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  async function ingest(files: File[], opts?: { forceSlot?: FinImportSlot; buf?: ArrayBuffer; fxRate?: number }) {
    if (files.length === 0 || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setPageError(null);
    try {
      // 카톡 내보내기는 따로 모아 **맨 뒤에** 처리한다 — 같이 올린 카드 명세서가
      // 먼저 들어와 있어야 그 거래에 메모가 붙는다.
      const chats: { file: File; text: string }[] = [];
      const sheets: File[] = [];
      for (const f of files) {
        const text = !opts?.forceSlot && /\.csv$/i.test(f.name) ? await f.text() : "";
        if (looksLikeKakaoChat(text.slice(0, 40))) chats.push({ file: f, text });
        else sheets.push(f);
      }
      for (const f of sheets) await ingestOne(f, opts ?? {});
      if (sheets.length > 0) {
        countsRef.current = null;
        await refresh();
      }
      if (chats.length > 0) {
        // 방금 받은 거래가 화면 상태에 자리 잡을 때까지 한 박자 기다린다 (txRef)
        if (sheets.length > 0) await new Promise((r) => setTimeout(r, 0));
        for (const c of chats) await ingestChat(c.file, c.text);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  /**
   * 「이 달 거래 없음」 — 파일 없이 칸을 채운다.
   *
   * 거래가 한 건도 없는 달은 은행이 줄 파일이 없다(0건짜리 파일은 달을 알 수
   * 없어 받지 못한다). 그대로 두면 칸이 끝내 붉게 남아, 빠뜨린 것인지 없는
   * 것인지 다음 사람이 알 수 없다. 거래를 달지 않는 배치 하나로 남긴다 —
   * 그래서 지울 때도 적재 되돌리기와 같은 길을 쓴다.
   */
  async function markNoActivity(slot: FinImportSlot) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setAct(slot.key, { kind: "idle" });
    try {
      await createFinImport({
        fileName: NO_ACTIVITY_LABEL,
        inserted: 0,
        skipped: 0,
        byMemberId: currentMember?.id,
        month: activeMonth,
        slotKey: slot.key,
        last4s: slot.last4s,
        noActivity: true,
      });
      await refresh();
      toast.success(`${slot.label} — ${monthLabel(activeMonth)} 거래 없음으로 표시했습니다.`);
    } catch (e) {
      const f = describeFinanceError(e);
      toast.error(f.detail, { title: f.title });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function undoSlot(target: Pick<FinImportBatch, "id" | "noActivity">, label: string) {
    // 「거래 없음」 표시는 지울 거래가 없다 — 묻지 않는다
    if (
      !target.noActivity &&
      !(await confirm({
        title: `${label} 칸의 적재를 되돌릴까요?`,
        message: "이 파일로 들어온 거래만 지웁니다. 다른 칸은 그대로 남습니다.",
        confirmLabel: "되돌리기",
        tone: "danger",
      }))
    )
      return;
    setBusy(true);
    try {
      await undoFinImport(target.id);
      countsRef.current = null;
      await refresh();
      toast.success(target.noActivity ? "「거래 없음」 표시를 지웠습니다." : "적재를 되돌렸습니다.");
    } catch (e) {
      const f = describeFinanceError(e);
      toast.error(f.detail, { title: f.title });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingState label="장부를 불러오는 중…" />;

  // 이 달 검토 대기 건수 — 다음 할 일 타일에 쓴다
  const reviewCount = transactions.filter(
    (t) => t.date?.startsWith(activeMonth) && t.status !== "confirmed",
  ).length;
  const sessionInserted = results.reduce((s, r) => s + r.inserted, 0);

  // 이 달 카드 지출 중 메모가 붙은 것 — 카톡 파일을 올릴 때가 됐는지 알려 준다
  const cardLast4 = new Set(paymentMethods.filter((p) => p.kind === "card").map((p) => p.last4));
  const cardRows = transactions.filter(
    (t) => t.date?.startsWith(activeMonth) && cardLast4.has(t.last4 ?? "") && (t.txType === "지출" || t.txType === "환급"),
  );
  const chatMonth = { cards: cardRows.length, withMemo: cardRows.filter((t) => !!t.cardMemo).length };

  /**
   * 지금 어느 단계인가 — **새 상태를 두지 않고** 이미 있는 것에서 읽는다.
   * 아직 아무것도 안 들어왔으면 ①, 칸이 채워지기 시작했거나 손봐야 할
   * 파일이 남아 있으면 ②, 이 달 칸이 다 차면 ③.
   *
   * 목업의 3단계는 「미리보기·적재」지만, 이 화면은 미리보기 없이 놓는
   * 즉시 적재한다(파일 머리 주석). 그래서 3단계 이름은 「적재 완료」다 —
   * 있지도 않은 확인 단계를 그려 두면 사람은 그걸 기다린다.
   */
  const stepNow = puzzle.complete
    ? 2
    : puzzle.filled > 0 || results.length > 0 || unassigned.length > 0
      ? 1
      : 0;

  return (
    <PageShell width="wide">
      <ToolbarPortal order={0}>
        <MonthStepper
          glass
          months={months}
          value={activeMonth}
          onChange={setMonth}
          labelFor={(m) => {
            const p = finPuzzleOf(slots, m, transactions, imports);
            return p.complete ? "완성" : p.filled > 0 ? `${p.filled}/${p.total}` : undefined;
          }}
        />
      </ToolbarPortal>

      <PageHeader
        title="엑셀 임포트"
        description="계좌마다 한 파일, 카드사마다 한 파일. 끌어다 놓으면 출처를 알아내 중복을 걸러내고 자동분류해 바로 적재합니다."
        meta={
          <span className="flex items-center gap-1.5 text-nd-caption text-nd-fg-2">
            <Icon icon={Puzzle} size={14} />
            {monthLabel(activeMonth)} 퍼즐{" "}
            <span
              className={cn(
                "nd-num font-semibold",
                puzzle.complete ? "text-nd-success-text" : "text-nd-danger-text",
              )}
            >
              {puzzle.filled}/{puzzle.total}
            </span>
          </span>
        }
      />

      {/* 진행 단계 — 지금 어디쯤인지, 다음이 무엇인지 한 줄로 */}
      <Card padding="sm" className="mb-4">
        <Stepper
          current={stepNow}
          steps={[
            {
              key: "upload",
              label: "파일 올리기",
              hint: `${monthLabel(activeMonth)} 은행·카드 파일`,
            },
            {
              key: "slots",
              label: "칸 확인",
              hint: puzzle.total > 0 ? `${puzzle.filled}/${puzzle.total} 칸 채움` : "마스터에 칸이 없습니다",
            },
            {
              key: "done",
              label: "적재 완료",
              hint: sessionInserted > 0 ? `이번에 ${won(sessionInserted)}건` : "놓는 즉시 적재됩니다",
            },
          ]}
        />
      </Card>

      {masterEmpty && (
        <InlineNotice tone="warning" icon={TriangleAlert} className="mb-4">
          <b>계정 마스터가 아직 비어 있습니다.</b>{" "}
          <Link href="/neander/finance/master" className="font-medium underline">
            마스터
          </Link>
          에서 먼저 적재하면 칸이 생기고 자동분류 정확도가 올라갑니다.
        </InlineNotice>
      )}

      {pageError && (
        <InlineNotice tone="danger" icon={TriangleAlert} className="mb-4">
          {pageError}
        </InlineNotice>
      )}

      {/* ---- 퍼즐 ---- */}
      {slots.length === 0 ? (
        <EmptyState
          icon={Puzzle}
          title="적재할 계좌·카드가 없습니다"
          description="마스터 › 계좌·카드에서 은행을 정하고 「월별 적재」를 켜면 여기에 칸이 생깁니다."
          action={
            <Link href="/neander/finance/master">
              <Button>마스터로 가기</Button>
            </Link>
          }
        />
      ) : (
        // 칸 위에 그대로 놓아도 받는다 — 어느 칸에 놓든 제자리를 찾아가므로
        // 조준하게 만들 이유가 없다 (DropZone 은 아래 넓은 자리가 따로 맡는다)
        <div
          className={cn(
            "mb-5 grid gap-3 rounded-nd-lg sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
            justSolved && "nd-puzzle-complete",
          )}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void ingest(Array.from(e.dataTransfer.files ?? []));
          }}
        >
          {puzzle.pieces.map((piece) => (
            <PuzzlePiece
              key={piece.slot.key}
              status={piece}
              activity={actOf(piece.slot.key)}
              onFiles={(files) => void ingest(files)}
              onUndo={piece.batch ? () => void undoSlot(piece.batch!, piece.slot.label) : undefined}
              onNoActivity={() => void markNoActivity(piece.slot)}
              locked={busy}
              onFx={(rate) => {
                const held = fxWaiting.current.get(piece.slot.key);
                if (held) void ingest([held.file], { forceSlot: piece.slot, buf: held.buf, fxRate: rate });
              }}
            />
          ))}
        </div>
      )}

      {/* 칸 밖에 놓아도 되는 넓은 자리 — 파일을 여러 개 한꺼번에.
          끌어다 놓기만 되면 키보드로는 못 올린다 — 공통 DropZone 은 늘 눌러서
          고를 수 있는 버튼이고 숨은 file input 이 짝을 이룬다. */}
      {slots.length > 0 && (
        <DropZone
          className="mb-5"
          onFiles={(files) => void ingest(files)}
          accept=".xlsx,.xls,.csv"
          multiple
          busy={busy}
          title={busy ? (chatStep ?? "읽는 중…") : "이 달 파일을 한꺼번에 끌어다 놓으세요"}
          hint={
            <>
              신한·국민·우리은행 · 토스뱅크 · 카카오뱅크 · 신한/국민 법인카드 · 법인카드 단톡방 내보내기
              <br />
              어느 칸에 놓든 파일 안의 계좌번호로 제자리를 찾아갑니다 · 암호는 서버가 풉니다
            </>
          }
        />
      )}

      {/* ---- 카드 사용 메모 (카카오톡) ---- */}
      <ChatMemoCard
        month={activeMonth}
        memo={chatMonth}
        result={chatResult}
        busy={busy}
        step={chatStep}
        onFiles={(files) => void ingest(files)}
        onUndo={() => void undoChat()}
        onDismiss={() => setChatResult(null)}
      />

      {/* ---- 계좌를 못 정한 파일 ---- */}
      {unassigned.length > 0 && (
        <div className="mb-5 space-y-3">
          {unassigned.map((u) => (
            <UnassignedCard
              key={u.id}
              fileName={u.file.name}
              bank={u.bank}
              rows={u.rows}
              period={u.period}
              ranked={u.ranked}
              filledKeys={new Set(puzzle.pieces.filter((p) => p.filled).map((p) => p.slot.key))}
              onPick={(slot) => {
                setUnassigned((prev) => prev.filter((x) => x.id !== u.id));
                void ingest([u.file], { forceSlot: slot, buf: u.buf });
              }}
              onDismiss={() => setUnassigned((prev) => prev.filter((x) => x.id !== u.id))}
            />
          ))}
        </div>
      )}

      {/* ---- 다음 할 일 ----
          예전에는 같은 이야기를 InlineNotice 와 타일 3개로 **두 번** 했다.
          링크와 건수를 함께 들고 있는 타일만 남기고, 상태 한 줄은 제목 옆
          힌트로 옮긴다. */}
      <section className="mb-5">
        <SectionHeader
          as="h2"
          title="다음 할 일"
          hint={
            puzzle.complete
              ? `${monthLabel(activeMonth)} 칸이 다 찼습니다 — 검토하고 마감하세요`
              : `${monthLabel(activeMonth)} 칸 ${puzzle.total - puzzle.filled}개가 비어 있습니다`
          }
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <NextStep
            href="/neander/finance/import"
            icon={Upload}
            n={1}
            title="엑셀 임포트"
            sub={`${puzzle.filled}/${puzzle.total} 칸 채움`}
            tone={puzzle.complete ? "success" : undefined}
          />
          <NextStep
            href={reviewHref(activeMonth)}
            icon={Inbox}
            n={2}
            title="검토 대기함"
            sub={reviewCount > 0 ? `이 달 미확정 ${won(reviewCount)}건` : "이 달 미확정 없음"}
            tone={reviewCount > 0 ? "warning" : "success"}
          />
          <NextStep href="/neander/finance/close" icon={CalendarCheck} n={3} title="월 마감" sub="점검하고 숫자를 얼립니다" />
        </div>
        {!puzzle.complete && (
          <p className="mt-2 text-nd-caption text-nd-fg-3">
            통장은 계좌마다 한 파일, 카드는 카드사마다 한 파일입니다 — 카드사가 모든 카드를 한 파일에 담아
            주기 때문입니다. 계좌가 늘면{" "}
            <Link href="/neander/finance/master" className="font-medium underline">
              마스터
            </Link>
            에서 「월별 적재」를 켜면 칸이 생깁니다.
          </p>
        )}
      </section>

      {/* ---- 이번에 적재한 것 ---- */}
      {results.length > 0 && (
        <Card padding="none" className="mb-5 overflow-hidden">
          <div className="px-5 pt-4">
            <SectionHeader
              title="이번에 적재한 것"
              hint={`파일 ${results.length}개 · ${won(sessionInserted)}건`}
            />
          </div>
          <KpiStrip columns={4} className="px-5 pb-4">
            <KpiItem
              label="적재"
              value={<span className="nd-num">{won(sessionInserted)}</span>}
              unit="건"
              hint={`중복 ${won(results.reduce((s, r) => s + r.skipped, 0))}건 제외`}
            />
            <KpiItem
              label="자동확정"
              value={<span className="nd-num">{won(results.reduce((s, r) => s + r.confirmed, 0))}</span>}
              unit="건"
              tone="success"
            />
            <KpiItem
              label="제안됨"
              value={<span className="nd-num">{won(results.reduce((s, r) => s + r.suggested, 0))}</span>}
              unit="건"
              tone="warning"
            />
            <KpiItem
              label="검토필요"
              value={<span className="nd-num">{won(results.reduce((s, r) => s + r.needsReview, 0))}</span>}
              unit="건"
              tone={results.some((r) => r.needsReview > 0) ? "danger" : "neutral"}
            />
          </KpiStrip>
          {/* 파일이 여러 개면 표가 길어진다 — maxHeight 가 있어야 Th sticky 가 실제로 붙는다 */}
          <TableScroll maxHeight={360}>
            <Table minWidth={760} dense>
              <thead>
                <tr>
                  <Th sticky="top" className="pl-5">파일</Th>
                  <Th sticky="top">칸</Th>
                  <Th sticky="top" align="right">적재</Th>
                  <Th sticky="top" align="right">중복 제외</Th>
                  <Th sticky="top" align="right">못 읽음</Th>
                  <Th sticky="top" align="right">수입</Th>
                  <Th sticky="top" align="right" className="pr-5">지출</Th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <Tr key={i}>
                    <Td className="pl-5">
                      <span className="block max-w-[20rem] truncate" title={r.fileName}>
                        {r.fileName}
                      </span>
                    </Td>
                    <Td className="text-nd-fg-2">{r.slotLabel}</Td>
                    <Td num className="font-medium">{won(r.inserted)}</Td>
                    <Td num muted>{r.skipped > 0 ? won(r.skipped) : "—"}</Td>
                    <Td num className={r.errors > 0 ? "text-nd-danger-text" : undefined}>
                      {r.errors > 0 ? won(r.errors) : "—"}
                    </Td>
                    <Td num><Money value={r.income} unit={false} flow="income" muted={!r.income} /></Td>
                    <Td num className="pr-5"><Money value={r.expense} unit={false} flow="expense" muted={!r.expense} /></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        </Card>
      )}

      {/* ---- 매출 파일 대사 (적재하지 않는다) ----
          예전에는 화면 맨 아래에 상황마다 다른 자리에 끼어들었다. 자리를
          고정해 「이번에 적재한 것」 바로 아래에서만 늘어나게 한다. */}
      {posResults.length > 0 && (
        <div className="mb-5 space-y-3">
          {posResults.map((p) => (
            <PosCard
              key={p.id}
              pos={p.pos}
              transactions={transactions}
              onRemove={() => setPosResults((prev) => prev.filter((x) => x.id !== p.id))}
            />
          ))}
        </div>
      )}

      {/* ---- 접어 두는 보조 ----
          비밀번호와 적재 이력은 없으면 안 되지만 매번 볼 것은 아니다.
          비밀번호 칸은 서버가 물으면 저절로 펼쳐진다(extrasOpen). */}
      <DisclosureGroup>
        <Disclosure
          icon={Settings2}
          title="추가 확인 (선택)"
          description="비밀번호가 걸린 파일 · 자주 쓰는 암호는 서버에 넣어 둘 수 있습니다"
          open={extrasOpen}
          onOpenChange={setExtrasOpen}
          meta={askPassword ? <span className="text-nd-warning-text">비밀번호가 필요합니다</span> : undefined}
        >
          {askPassword && (
            <InlineNotice tone="warning" icon={TriangleAlert} className="mb-3">
              서버가 아는 비밀번호로 열리지 않았습니다 — 한 번 넣으면 이 화면에서는 계속 씁니다.
            </InlineNotice>
          )}
          <FormRow className="grid-cols-1 sm:grid-cols-[14rem_auto_minmax(0,1fr)]">
            <Field label="파일 비밀번호">
              <Input
                size="sm"
                type="password"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <FieldAction>
              <Button size="sm" icon={KeyRound} disabled={!password} onClick={() => setAskPassword(false)}>
                이 비밀번호로 다시 올리기
              </Button>
            </FieldAction>
            <FieldAction center>
              <TableNote>
                자주 쓰는 비밀번호는 서버 환경변수 <b>NEANDER_XLSX_PASSWORDS</b> 에 넣어 두면 묻지 않습니다.
              </TableNote>
            </FieldAction>
          </FormRow>
        </Disclosure>

        <Disclosure
          icon={History}
          title="적재 이력"
          description="파일 단위로 통째 되돌릴 수 있습니다"
          meta={imports.length > 0 ? `${won(imports.length)}건` : undefined}
          // 표는 상자 끝까지 붙는다 (cn 은 tailwind-merge 가 아니라 ! 로 눌러야 한다)
          bodyClassName="!p-0"
        >
          {imports.length === 0 ? (
            <EmptyState
              compact
              icon={History}
              className="m-4"
              title="아직 적재 이력이 없습니다"
              description="파일을 올리면 여기에 한 줄씩 쌓이고, 줄마다 통째로 되돌릴 수 있습니다."
            />
          ) : (
            <TableScroll maxHeight={420}>
              <Table minWidth={640} dense>
                <thead>
                  <tr>
                    <Th sticky="top" className="pl-5">파일</Th>
                    <Th sticky="top">달</Th>
                    <Th sticky="top" align="right">적재</Th>
                    <Th sticky="top" align="right">중복 제외</Th>
                    <Th sticky="top">올린 때</Th>
                    <Th sticky="top" align="right" className="pr-5">
                      <span className="sr-only">되돌리기</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {imports.slice(0, 20).map((b) => (
                    <Tr key={b.id}>
                      <Td className="pl-5">
                        <span className="block max-w-[22rem] truncate font-medium text-nd-fg" title={b.fileName}>
                          {b.noActivity
                            ? `${slots.find((s) => s.key === b.slotKey)?.label ?? b.slotKey ?? ""} · ${NO_ACTIVITY_LABEL}`
                            : b.fileName}
                        </span>
                      </Td>
                      <Td>{b.month ? <Badge size="sm">{b.month}</Badge> : <span className="text-nd-fg-3">—</span>}</Td>
                      <Td num muted={b.noActivity}>{b.noActivity ? "—" : b.inserted.toLocaleString("ko-KR")}</Td>
                      <Td num muted>{b.skipped > 0 ? b.skipped.toLocaleString("ko-KR") : "—"}</Td>
                      <Td className="whitespace-nowrap text-nd-fg-2">
                        {b.createdAt ? formatTimestamp(b.createdAt) : "—"}
                      </Td>
                      <Td align="right" className="pr-5">
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={Undo2}
                          disabled={busy}
                          onClick={() => void undoSlot(b, b.fileName)}
                        >
                          {b.noActivity ? "표시 지우기" : "되돌리기"}
                        </Button>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          )}
        </Disclosure>
      </DisclosureGroup>
    </PageShell>
  );
}

// ============================================================
//  카드 사용 메모 (카카오톡) — 단톡방 내보내기를 받는 칸
// ------------------------------------------------------------
//  은행·카드 칸과 달리 달마다 채우는 퍼즐이 아니다. 내보내기는 늘 방 전체라
//  한 파일이 모든 달에 걸친다. 그래서 퍼즐 밖에 따로 두고, 이 달 카드 지출에
//  메모가 얼마나 붙어 있는지만 보여 준다.
// ============================================================

function ChatMemoCard({
  month,
  memo,
  result,
  busy,
  step,
  onFiles,
  onUndo,
  onDismiss,
}: {
  month: string;
  memo: { cards: number; withMemo: number };
  result: ChatResult | null;
  busy: boolean;
  step: string | null;
  onFiles: (files: File[]) => void;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const missing = memo.cards - memo.withMemo;
  return (
    <Card className="mb-5">
      <div className="grid items-center gap-x-6 gap-y-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[16px] font-semibold text-nd-fg">
            <Icon icon={MessageSquareText} size={18} className="text-nd-fg-2" />
            카드 사용 메모 (카카오톡)
            {memo.cards > 0 && (
              <Badge tone={missing === 0 ? "success" : memo.withMemo === 0 ? "warning" : "neutral"}>
                {monthLabel(month)} 카드 지출 {won(memo.cards)}건 중 {won(memo.withMemo)}건에 메모
              </Badge>
            )}
          </p>
          <p className="mt-1 text-nd-body leading-relaxed text-nd-fg-2">
            법인카드 단톡방에서 <b className="font-medium text-nd-fg">대화 내보내기</b>로 받은 파일(.csv)을 올리면, 금액과 날짜가 같은 카드
            거래에 「구매처 / 품목」 메모가 붙습니다. 명세서에는 결제대행사 이름만 찍히는 결제를 자동분류가 이 메모로
            맞힙니다. 몇 번을 올려도 새로 붙는 것만 붙습니다.
          </p>
        </div>
        <DropZone
          compact
          onFiles={onFiles}
          accept=".csv"
          busy={busy}
          icon={MessageSquareText}
          title={busy && step ? step : "카톡 내보내기 파일(.csv) 올리기"}
        />
      </div>

      {result && (
        <div className="mt-4 border-t border-nd-border pt-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 text-nd-body text-nd-fg-2">
              <span className="font-medium text-nd-fg">방금 올린 파일</span>{" "}
              <span className="break-all">{result.fileName}</span> · 결제 기록 {won(result.entries)}건
            </p>
            <div className="flex items-center gap-1">
              {result.undo.length > 0 && (
                <Button variant="ghost" size="sm" icon={Undo2} disabled={busy} onClick={onUndo}>
                  되돌리기
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={onDismiss}>
                닫기
              </Button>
            </div>
          </div>
          <KpiStrip columns={4}>
            <KpiItem
              label="새로 붙인 메모"
              value={<span className="nd-num">{won(result.attached)}</span>}
              unit="건"
              tone={result.attached > 0 ? "success" : "neutral"}
              hint={result.already > 0 ? `이미 붙어 있던 것 ${won(result.already)}건` : undefined}
            />
            <KpiItem
              label="고쳐진 제안"
              value={<span className="nd-num">{won(result.relearned)}</span>}
              unit="건"
              hint="메모를 근거로 다시 분류 · 확정은 사람이"
            />
            <KpiItem
              label="프로젝트 지정"
              value={<span className="nd-num">{won(result.projects.length)}</span>}
              unit="건"
              hint="메모에 프로젝트 이름이 적힌 거래"
            />
            <KpiItem
              label="명세서를 기다리는 기록"
              value={<span className="nd-num">{won(result.waiting.reduce((s, w) => s + w.count, 0))}</span>}
              unit="건"
              tone={result.waiting.length > 0 ? "warning" : "neutral"}
              hint={
                result.waiting.length > 0
                  ? result.waiting
                      .slice(0, 3)
                      .map((w) => `${monthLabel(w.month)} ${won(w.count)}건`)
                      .join(" · ")
                  : "모두 짝을 찾았습니다"
              }
            />
          </KpiStrip>
          {result.waiting.length > 0 && (
            <InlineNotice tone="info" icon={Info} className="mt-3">
              {result.waiting.map((w) => monthLabel(w.month)).join(" · ")} 카드 명세서가 아직 장부에 없습니다. 명세서를 올린 뒤{" "}
              <b>이 파일을 다시 올리면</b> 그 달 결제에도 메모가 붙습니다.
            </InlineNotice>
          )}
          {result.projects.length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 text-nd-body font-medium text-nd-fg">메모를 보고 프로젝트를 지정한 거래</p>
              <TableScroll maxHeight={260}>
                <Table minWidth={720} dense>
                  <thead>
                    <tr>
                      <Th sticky="top">거래일</Th>
                      <Th sticky="top">거래처</Th>
                      <Th sticky="top" align="right">금액</Th>
                      <Th sticky="top">카드 메모</Th>
                      <Th sticky="top">프로젝트</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.projects.map((p) => (
                      <Tr key={p.id}>
                        <Td className="nd-num whitespace-nowrap">{p.date}</Td>
                        <Td>
                          <span className="block max-w-[14rem] truncate" title={p.vendor}>
                            {p.vendor || "—"}
                          </span>
                        </Td>
                        <Td num>
                          <Money value={p.amount} unit={false} flow="expense" />
                        </Td>
                        <Td>
                          <span className="block max-w-[28rem] truncate" title={p.memo}>
                            {p.memo}
                          </span>
                        </Td>
                        <Td>
                          <Badge size="sm">{p.code}</Badge>
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </TableScroll>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ============================================================
//  페이히어 POS — 대사 카드 (적재하지 않는다)
// ------------------------------------------------------------
//  매장 매출은 이미 정산 입금(카드사 정산 · Npay정산)으로 장부에 들어와
//  있다. 여기서 또 넣으면 매출이 두 번 잡히므로 **맞춰만** 본다.
// ============================================================

function PosCard({
  pos,
  transactions,
  onRemove,
}: {
  pos: PosResult;
  transactions: { date?: string; txType: string; acctMinor?: string; gross: number; adjust: number }[];
  onRemove: () => void;
}) {
  const guess = pos.unit ?? storeToUnit(pos.store);
  const [acct, setAcct] = useState<string>(guess.acctMinor ?? "");
  const unit = { ...guess, acctMinor: acct || guess.acctMinor };

  /** 같은 기간에 각 매출 계정이 얼마나 잡혔는지 — 고를 때 근거가 된다 */
  const acctOptions = useMemo(() => {
    const m = new Map<string, { n: number; amt: number }>();
    transactions.forEach((t) => {
      if (t.txType !== "수입" || !t.acctMinor) return;
      if (pos.from && (t.date ?? "") < pos.from) return;
      if (pos.to && (t.date ?? "") > pos.to) return;
      const v = m.get(t.acctMinor) ?? { n: 0, amt: 0 };
      v.n += 1;
      v.amt += (t.gross || 0) - (t.adjust || 0);
      m.set(t.acctMinor, v);
    });
    return [...m.entries()].sort((a, b) => b[1].amt - a[1].amt);
  }, [transactions, pos.from, pos.to]);

  const ledger = useMemo(() => {
    let amt = 0;
    let n = 0;
    transactions.forEach((t) => {
      if (t.txType !== "수입" || t.acctMinor !== unit.acctMinor) return;
      if (pos.from && (t.date ?? "") < pos.from) return;
      if (pos.to && (t.date ?? "") > pos.to) return;
      amt += (t.gross || 0) - (t.adjust || 0);
      n += 1;
    });
    return { ledgerSales: amt, ledgerCount: n };
  }, [transactions, unit.acctMinor, pos.from, pos.to]);

  const rec = reconcilePos(pos, ledger);

  return (
    <Card className="mb-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-nd-body font-semibold text-nd-fg">
            <Badge tone="success">매출 대사</Badge>
            <span className="min-w-0 break-all">{pos.sourceLabel} · {pos.store}</span>
          </p>
          <p className="mt-0.5 text-nd-caption text-nd-fg-2">{pos.period}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          닫기
        </Button>
      </div>

      <InlineNotice tone="success" icon={Info} className="mt-3 text-nd-caption">
        <b>이 파일은 장부에 적재하지 않습니다.</b> 매장 매출은 이미 정산 입금으로 들어와 있어서 여기서 또
        넣으면 두 번 잡힙니다. 판매 줄(수량·원가)은{" "}
        <Link href="/neander/sales/import" className="font-medium underline">
          매출 적재
        </Link>
        에서 만듭니다.
      </InlineNotice>

      {acctOptions.length > 0 && (
        <FormRow className="mt-3 grid-cols-1 sm:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
          <Field label="맞춰볼 매출 계정">
            <Select size="sm" value={acct} onChange={(e) => setAcct(e.target.value)}>
              <option value="">(선택)</option>
              {acctOptions.map(([name, v]) => (
                <option key={name} value={name}>
                  {name} — 같은 기간 {v.n}건 {v.amt.toLocaleString("ko-KR")}원
                </option>
              ))}
            </Select>
          </Field>
          <FieldAction center>
            <TableNote>같은 기간 장부에 잡힌 매출 계정들입니다. 금액이 가까운 쪽이 대개 맞습니다.</TableNote>
          </FieldAction>
        </FormRow>
      )}

      {/* 금액은 StatTile(재무 다른 화면과 같은 「원」 표기·음수 -), 건수는 KpiItem */}
      <KpiStrip columns={4} className="mt-3">
        <StatTile label={`${pos.sourceLabel} 실매출`} value={rec.posNet} flow="income" hint={`${rec.posCount}건`} />
        <StatTile
          label="장부 매출"
          value={rec.ledgerSales}
          flow="income"
          hint={`${rec.ledgerCount}건 · ${unit.acctMinor ?? "계정 미선택"}`}
        />
        <StatTile
          label="차이 (장부 − 원본)"
          value={rec.gap}
          hint={`${(rec.gapRate * 100).toFixed(1)}% · 수수료·미정산`}
        />
        <StatTile
          label={rec.cardPortion > 0 ? "카드 결제분" : "간편결제분"}
          value={rec.cardPortion > 0 ? rec.cardPortion : pos.byMethod.easy}
          hint={`현금 ${rec.cashPortion.toLocaleString("ko-KR")}`}
        />
      </KpiStrip>

      {pos.warnings.length > 0 && (
        <InlineNotice tone="warning" icon={TriangleAlert} className="mt-2 text-nd-caption">
          <ul className="space-y-0.5">
            {pos.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </InlineNotice>
      )}
    </Card>
  );
}
