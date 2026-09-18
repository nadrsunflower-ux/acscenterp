"use client";

// ============================================================
//  프로젝트 손익 — 상세 (체크리스트 + 계약금액 + 손익)
// ------------------------------------------------------------
//  엑셀 체크리스트를 화면으로 옮긴 것이다. 분류별로 묶인 표에 수량·단가를
//  넣으면 견적금액이 굴러가고, 위에 계약금액과 이익이 바로 보인다.
//
//  편집은 예산 화면과 같은 초안 방식이다 — 셀을 고칠 때마다 서버에 쓰지
//  않고 「저장」 한 번에 프로젝트를 통째로 반영한다. 행사 준비 중에는
//  수십 줄을 연달아 고치므로 셀마다 요청을 보내면 느리고, 중간에 끊기면
//  반쯤 바뀐 표가 남는다.
//
//  「실제금액」 열은 나중에 채운다. 견적(수량×단가)은 준비할 때, 실제는
//  결제가 끝난 뒤. 안 채운 줄은 견적으로 계산하되 몇 줄이 비었는지 위에
//  적어 둔다 — 실질 이익이 "아직 견적 섞인 숫자"인지 알 수 있어야 한다.
//
//  화면 구성은 승인 목업(all-pages/finance-project-detail.png)을 따른다:
//  제목 줄 → 탭 다섯 → 탭 안 내용. 카드 여덟 장을 세로로 늘어놓으면 이
//  화면에서 가장 오래 머무는 지출 시트가 늘 스크롤 한참 아래에 있었다.
//  탭은 「지금 무슨 일을 하는 중인가」로 나눈다 — 숫자를 훑는(개요),
//  준비물을 채우는(지출·준비물), 돈 들어온 것을 맞추는(수입·입금),
//  문서를 붙이는(견적·계약), 원장과 대조하는(원장대조).
//
//  보던 탭은 주소 해시에 남긴다(재무 대시보드의 상세 펼침과 같은 방식).
//  저장하고 새로고침했을 때 개요로 튕기면 방금 고치던 자리를 다시 찾아야
//  한다.
// ============================================================

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  useParams,
  useRouter,
} from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  CircleAlert,
  Download,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  Save,
  SearchX,
  Trash2,
  Undo2,
  Unlink,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  Badge,
  Button,
  ButtonGroup,
  Card,
  cn,
  EmptyState,
  Field,
  FormRow,
  Icon,
  IconButton,
  InlineNotice,
  Input,
  KpiStrip,
  LoadingState,
  Menu,
  type MenuItem,
  Money,
  PageHeader,
  PageShell,
  SectionHeader,
  Select,
  StatTile,
  Table,
  TableNote,
  TableScroll,
  Tabs,
  Td,
  Textarea,
  Th,
  type Tone,
  TotalRow,
  Tr,
  useConfirm,
  useToast,
} from "@/components/neander/ui";
import { ChecklistSheet } from "@/components/neander/finance/ChecklistSheet";
import { isTypingInto } from "@/components/neander/finance/sheetCells";
import {
  CHECKLIST_LAYOUT_KEY,
  DEFAULT_ZOOM,
  ZOOM_STEPS,
  useSheetLayout,
} from "@/components/neander/finance/useSheetLayout";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import {
  deleteFinProject,
  saveFinProject,
  updateFinTransaction,
} from "@/lib/neander/finance/client";
import { TransactionEditor } from "@/components/neander/finance/TransactionEditor";
import { ProjectDocs } from "@/components/neander/finance/ProjectDocs";
import { ledgerHref } from "@/lib/neander/finance/ledgerLink";
import {
  exportProjectXlsx,
  parseChecklistXlsx,
} from "@/lib/neander/finance/project-xlsx";
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABEL,
  VAT_LABEL,
  VAT_MODES,
  VAT_HINT,
  INSTALLMENT_KINDS,
  INSTALLMENT_STATUS_LABEL,
  installmentStatus,
  isReceived,
  newInstallment,
  splitVat,
  type FinProjectInstallment,
  type InstallmentKind,
  type InstallmentStatus,
  type VatMode,
  formatMargin,
  groupLines,
  ledgerRowsOf,
  newLine,
  newRevenue,
  newDeduction,
  DEDUCTION_TAX_MODES,
  DEDUCTION_TAX_LABEL,
  DEDUCTION_TAX_HINT,
  deductionSplit,
  type DeductionTaxMode,
  type FinProjectDeduction,
  projectSummary,
  type FinProjectDoc,
  type FinProjectInput,
  type FinProjectLine,
  type FinProjectRevenue,
  type ProjectStatus,
} from "@/lib/neander/finance/project";
import {
  netAmount,
  type FinTransaction,
  type FinTransactionInput,
  txFlow,
} from "@/lib/neander/finance/types";

/** 상태 → 의미 색 (목록 화면과 같은 표) */
const PROJECT_STATUS_TONE: Record<ProjectStatus, Tone> = {
  planning: "neutral",
  active: "accent",
  done: "success",
  cancelled: "danger",
};
const INSTALLMENT_STATUS_TONE: Record<InstallmentStatus, Tone> = {
  paid: "success",
  overdue: "danger",
  planned: "neutral",
};

/**
 * 탭 → 주소 해시. 새로고침·뒤로가기·남에게 보낸 링크가 같은 탭을 연다.
 * 값이 화면 이름이라 한글 대신 영문 키를 쓴다 (주소창에 인코딩되면 못 읽는다).
 */
type TabKey = "overview" | "expense" | "revenue" | "docs" | "ledger";
const TAB_HASHES: Record<TabKey, string> = {
  overview: "#overview",
  expense: "#expense",
  revenue: "#revenue",
  docs: "#docs",
  ledger: "#ledger",
};
const TAB_KEYS = Object.keys(TAB_HASHES) as TabKey[];

/** 초안 되돌리기 스택. present 가 null 이면 "저장된 그대로" */
interface DraftHistory {
  past: FinProjectInput[];
  present: FinProjectInput | null;
  future: FinProjectInput[];
}
const EMPTY_DRAFT_HISTORY: DraftHistory = { past: [], present: null, future: [] };
const DRAFT_HISTORY_LIMIT = 100;

/**
 * 값으로 비교한다 — 프로젝트 하나라 통째로 견줘도 부담이 없다.
 *
 * 그냥 JSON.stringify 로 견주면 **키 순서**까지 견주게 된다. 시트를 거친 줄은
 * 같은 값이라도 키 차례가 달라져 나온다(빈 값을 지웠다가 다시 채우니까).
 * 그러면 아무것도 안 고쳤는데 「저장」이 켜지고, 되돌리기 스택에도 빈 걸음이
 * 잔뜩 쌓여 ⌘Z 를 여러 번 눌러야 한 번 되돌아간다. 키를 정렬해 견준다.
 */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.keys(o)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        if (o[k] !== undefined) acc[k] = canonical(o[k]);
        return acc;
      }, {});
  }
  return v;
}
const sameDraft = (a: FinProjectInput, b: FinProjectInput) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/**
 * 저장된 문서에서 편집 가능한 부분만 떼어 초안으로 쓴다.
 *
 * ⚠️ 저장은 초안으로 문서를 **통째로** 갈아치운다. 여기서 빠진 칸은 화면에서
 *    한 번 저장하는 순간 사라진다 — 한동안 부가세 기준·입금 회차·사용자 열이
 *    빠져 있어서, 「부가세 포함」 계약이 저장할 때마다 「별도」로 바뀌었다.
 *    FinProjectInput 에 칸을 더하면 여기에도 더할 것.
 */
function toInput(p: FinProjectDoc): FinProjectInput {
  return {
    code: p.code,
    name: p.name,
    client: p.client,
    status: p.status,
    startDate: p.startDate,
    endDate: p.endDate,
    bizMinor: p.bizMinor,
    contractAmount: p.contractAmount ?? 0,
    vatMode: p.vatMode,
    installments: p.installments?.map((i) => ({ ...i })),
    revenues: (p.revenues ?? []).map((r) => ({ ...r })),
    deductions: p.deductions?.map((d) => ({ ...d })),
    columns: p.columns?.map((c) => ({ ...c })),
    lines: (p.lines ?? []).map((l) => ({ ...l })),
    note: p.note,
  };
}

/**
 * 빈 값이 된 **선택** 항목의 키를 없앤다. id·분류·품목·수량은 언제나 남긴다
 * — 줄의 정체이고, 없애면 시트 셀의 value 가 undefined 가 되어 제어를 놓는다.
 */
const KEEP_KEYS = new Set<keyof FinProjectLine>(["id", "category", "item", "qty"]);
function tidyLine(l: FinProjectLine): FinProjectLine {
  const next = { ...l };
  (Object.keys(next) as (keyof FinProjectLine)[]).forEach((k) => {
    if (KEEP_KEYS.has(k)) return;
    const v = next[k];
    if (v === undefined || v === "" || v === false || (typeof v === "number" && Number.isNaN(v))) {
      delete next[k];
    }
  });
  // 시트에서 새로 만든 행은 분류·품목이 비어 있을 수 있다 — 문자열로 맞춘다
  next.category = next.category ?? "";
  next.item = next.item ?? "";
  next.qty = Number.isFinite(next.qty) ? next.qty : 0;
  return next;
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const { projects, transactions, accounts, paymentMethods, loading, refresh } = useFinance();

  const saved = useMemo(() => projects.find((p) => p.id === id) ?? null, [projects, id]);
  /**
   * 초안과 그 되돌리기 스택.
   *
   * 한 덩어리 상태로 둔다 — 스택을 따로 두면 초안을 바꾸는 자리마다 두 번
   * 갱신해야 하고, 그중 하나만 빠져도 ⌘Z 가 엉뚱한 데로 간다.
   * `present` 가 null 이면 "저장된 그대로"다.
   */
  const [hist, setHist] = useState<DraftHistory>(EMPTY_DRAFT_HISTORY);
  const draft = hist.present;
  const setDraft = useCallback(
    (next: FinProjectInput | null) => setHist({ past: [], present: next, future: [] }),
    [],
  );
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  /** 제목 줄 오른쪽 「⋯ 더보기」 — 자주 안 쓰는 동작을 여기 접어 둔다 */
  const moreRef = useRef<HTMLButtonElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  /** 원장 대조 표에서 열어 둔 거래 — 그 자리에서 고친다 */
  const [editingTx, setEditingTx] = useState<FinTransaction | null>(null);
  /** 프로젝트에 없는 거래를 찾아 붙이는 칸 */
  const [attachQuery, setAttachQuery] = useState("");
  const [attaching, setAttaching] = useState(false);
  /** 지출 시트의 열 너비·행 높이·배율 (원장과 따로 남는다) */
  const sheetLayout = useSheetLayout(CHECKLIST_LAYOUT_KEY);

  // ---- 탭 ------------------------------------------------------
  const [tab, setTab] = useState<TabKey>("overview");
  useEffect(() => {
    // 우리가 여는 것은 replaceState 라 hashchange 를 일으키지 않는다 —
    // 여기 걸리는 것은 밖에서 들어온 링크뿐이다. 모르는 해시는 무시한다
    // (다른 화면에서 쓰는 앵커가 붙어 들어와도 탭이 튀지 않게).
    const apply = () => {
      const hit = TAB_KEYS.find((k) => TAB_HASHES[k] === window.location.hash);
      if (hit) setTab(hit);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);
  const goTab = useCallback((key: string) => {
    const next = (TAB_KEYS as string[]).includes(key) ? (key as TabKey) : "overview";
    setTab(next);
    window.history.replaceState(null, "", TAB_HASHES[next]);
  }, []);

  /** 결과 알림 — 예전 띠 대신 토스트. 하위 부품(문서 칸)도 같은 경로를 쓴다 */
  const notify = useCallback(
    (n: { kind: "ok" | "error"; text: string }) => {
      if (n.kind === "ok") toast.success(n.text);
      else toast.error(n.text);
    },
    [toast],
  );

  // 다른 프로젝트로 옮기면 초안을 버린다
  useEffect(() => {
    setDraft(null);
  }, [id]);

  const form: FinProjectInput | null = draft ?? (saved ? toInput(saved) : null);
  const dirty = useMemo(
    () => !!draft && !!saved && !sameDraft(draft, toInput(saved)),
    [draft, saved],
  );

  // 떠나기 전 경고 — 저장 안 한 체크리스트가 날아가면 다시 적어야 한다
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const summary = useMemo(
    () => (form ? projectSummary(form, transactions) : null),
    [form, transactions],
  );
  const groups = useMemo(() => (form ? groupLines(form.lines) : []), [form]);
  const ledgerRows = useMemo(
    () => (form ? ledgerRowsOf(transactions, form.code) : []),
    [transactions, form],
  );

  /** 사업소분류 후보 — 원장에 있는 값 */
  const bizMinors = useMemo(() => {
    const s = new Set<string>();
    transactions.forEach((t) => t.bizMinor && s.add(t.bizMinor));
    return [...s].sort();
  }, [transactions]);
  // ---- 초안 조작 ---------------------------------------------

  const edit = useCallback(
    (fn: (f: FinProjectInput) => FinProjectInput) => {
      setHist((h) => {
        const base = h.present ?? (saved ? toInput(saved) : null);
        if (!base) return h;
        const next = fn(base);
        // 값이 그대로면 스택도 그대로 — 시트는 안 바뀌어도 통지를 보낸다
        if (sameDraft(next, base)) return h;
        return { past: [...h.past, base].slice(-DRAFT_HISTORY_LIMIT), present: next, future: [] };
      });
    },
    [saved],
  );

  const undo = useCallback(
    () =>
      setHist((h) =>
        h.past.length === 0
          ? h
          : {
              past: h.past.slice(0, -1),
              present: h.past[h.past.length - 1],
              future: h.present ? [h.present, ...h.future].slice(0, DRAFT_HISTORY_LIMIT) : h.future,
            },
      ),
    [],
  );
  const redo = useCallback(
    () =>
      setHist((h) =>
        h.future.length === 0
          ? h
          : {
              past: h.present ? [...h.past, h.present].slice(-DRAFT_HISTORY_LIMIT) : h.past,
              present: h.future[0],
              future: h.future.slice(1),
            },
      ),
    [],
  );
  const canUndo = hist.past.length > 0;
  const canRedo = hist.future.length > 0;

  // ⌘Z / ⌘⇧Z — 시트 위에서도 듣는다 (셀에 글자를 치는 중일 때만 넘긴다)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      if (isTypingInto(e.target as HTMLElement | null)) return;
      e.preventDefault();
      if (key === "y" || e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const setField = <K extends keyof FinProjectInput>(k: K, v: FinProjectInput[K]) =>
    edit((f) => ({ ...f, [k]: v }));

  /**
   * 시트는 줄 배열을 통째로 돌려준다 (행 추가·삭제·붙여넣기가 모두 여기로
   * 온다). 넘어온 줄을 그대로 초안에 싣되, 빈 값이 된 선택 항목의 키는
   * 없애 저장 문서와의 비교가 어긋나지 않게 한다.
   */
  const setLines = useCallback(
    (next: FinProjectLine[]) => edit((f) => ({ ...f, lines: next.map(tidyLine) })),
    [edit],
  );

  const updateInstallment = (iid: string, patch: Partial<FinProjectInstallment>) =>
    edit((f) => ({
      ...f,
      installments: (f.installments ?? []).map((i) => (i.id === iid ? { ...i, ...patch } : i)),
    }));
  const removeInstallment = (iid: string) =>
    edit((f) => ({ ...f, installments: (f.installments ?? []).filter((i) => i.id !== iid) }));
  /**
   * 새 회차. 다음 단계를 짐작해 넣는다 — 선금이 있으면 중도금, 중도금까지
   * 있으면 잔금. 금액은 계약금액에서 이미 나눈 몫을 뺀 나머지를 채운다.
   */
  const addInstallment = () =>
    edit((f) => {
      const list = f.installments ?? [];
      const used = new Set(list.map((i) => i.kind));
      const kind: InstallmentKind = !used.has("선금")
        ? "선금"
        : !used.has("중도금")
          ? "중도금"
          : "잔금";
      const rest = Math.max(0, (f.contractAmount || 0) - list.reduce((n, i) => n + (i.amount || 0), 0));
      return { ...f, installments: [...list, { ...newInstallment(kind), amount: rest }] };
    });

  const updateRevenue = (rid: string, patch: Partial<FinProjectRevenue>) =>
    edit((f) => ({ ...f, revenues: f.revenues.map((r) => (r.id === rid ? { ...r, ...patch } : r)) }));
  const removeRevenue = (rid: string) => edit((f) => ({ ...f, revenues: f.revenues.filter((r) => r.id !== rid) }));

  const updateDeduction = (did: string, patch: Partial<FinProjectDeduction>) =>
    edit((f) => ({ ...f, deductions: (f.deductions ?? []).map((d) => (d.id === did ? { ...d, ...patch } : d)) }));
  const removeDeduction = (did: string) =>
    edit((f) => ({ ...f, deductions: (f.deductions ?? []).filter((d) => d.id !== did) }));

  /** 엑셀 지출 목록을 초안 뒤에 붙인다 — 저장 전까지는 서버에 안 간다 */
  const importXlsx = async (file: File) => {
    try {
      const parsed = parseChecklistXlsx(await file.arrayBuffer());
      if (parsed.error) {
        toast.error(parsed.error);
        return;
      }
      if (parsed.lines.length === 0) {
        toast.error("가져올 줄이 없습니다.");
        return;
      }
      edit((f) => ({ ...f, lines: [...f.lines, ...parsed.lines] }));
      toast.success(
        `${file.name} 에서 ${parsed.lines.length}줄을 불러왔습니다${parsed.skipped ? ` (품목 없는 ${parsed.skipped}줄 건너뜀)` : ""}. 확인 후 저장하세요.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "파일을 읽지 못했습니다.");
    }
  };

  // ---- 원장 거래 직접 손보기 -------------------------------------
  //
  //  이 화면에서 거래를 고치는 것은 **원장을 고치는 것**이다. 체크리스트와
  //  달리 초안이 없고 누르는 즉시 반영된다 — 원장은 프로젝트 문서가 아니라
  //  회사 장부라, 이 화면의 「저장」에 묶어두면 어디까지 반영됐는지 흐려진다.

  const savedCode = saved?.code ?? "";
  /** 코드를 고쳐놓고 아직 저장 안 했으면 붙이기를 막는다 — 어느 코드로 붙일지 모호하다 */
  const codeUnsaved = !!form && form.code !== savedCode;

  const patchTx = async (txId: string, patch: Partial<FinTransactionInput>, okText: string) => {
    setAttaching(true);
    try {
      await updateFinTransaction(txId, patch);
      await refresh();
      toast.success(okText);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "원장 수정에 실패했습니다.");
    } finally {
      setAttaching(false);
    }
  };

  const attachTx = (t: FinTransaction) =>
    patchTx(t.id, { projectCode: savedCode }, `${t.date} ${t.vendor ?? ""} 를 ${savedCode} 에 붙였습니다.`);

  /** 떼기는 빈 문자열로 — undefined 는 JSON 에서 사라져 서버까지 못 간다 */
  const detachTx = (t: FinTransaction) =>
    patchTx(t.id, { projectCode: "" }, `${t.date} ${t.vendor ?? ""} 를 이 프로젝트에서 뗐습니다.`);

  /** 붙일 후보 — 아직 어느 프로젝트에도 안 붙은 거래에서 찾는다 */
  const attachCandidates = useMemo(() => {
    const q = attachQuery.trim().toLowerCase();
    if (!q) return [];
    return transactions
      .filter((t) => !(t.projectCode ?? "").trim())
      .filter((t) =>
        [t.vendor, t.note, t.acctNote, t.acctMinor, t.date, String(t.gross)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 20);
  }, [transactions, attachQuery]);

  // ---- 저장 · 삭제 --------------------------------------------

  const save = async () => {
    if (!draft || !dirty) return;
    setSaving(true);
    try {
      await saveFinProject(draft, id);
      await refresh();
      setDraft(null);
      toast.success("저장했습니다.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!saved) return;
    const ok = await confirm({
      title: `「${saved.name}」 프로젝트를 지울까요?`,
      message: `지출 ${saved.lines?.length ?? 0}줄도 함께 사라집니다. 원장 거래는 그대로 남습니다.`,
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (!ok) return;
    setSaving(true);
    try {
      await deleteFinProject(id);
      await refresh();
      router.push("/neander/finance/projects");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "삭제에 실패했습니다.");
      setSaving(false);
    }
  };

  // ---- 렌더 --------------------------------------------------

  if (loading) return <LoadingState />;
  if (!saved || !form || !summary) {
    return (
      <PageShell width="form" className="py-6">
        <EmptyState
          icon={SearchX}
          title="프로젝트를 찾을 수 없습니다"
          description="지워졌거나 주소가 잘못됐습니다."
          action={
            <Link href="/neander/finance/projects">
              <Button variant="secondary" icon={ArrowLeft}>프로젝트 목록</Button>
            </Link>
          }
        />
      </PageShell>
    );
  }

  const unfilled = summary.lineCount - summary.actualFilled;
  /**
   * 시트 높이 — 줄 수에 맞춰 늘리되 화면을 다 먹지 않게 640px 에서 멈춘다.
   * 줄이 적을 때 빈 격자가 길게 남으면 표가 비어 보인다.
   */
  const sheetHeight = Math.min(
    640,
    Math.max(240, (form.lines.length + 1) * sheetLayout.layout.rowHeight + 44),
  );
  const ledgerNet = summary.ledger.expense - summary.ledger.refund;
  const gap = summary.actual - ledgerNet;
  const isLoss = summary.profitActual < 0;
  const period =
    form.startDate || form.endDate
      ? `${form.startDate ?? "?"}${form.endDate && form.endDate !== form.startDate ? ` ~ ${form.endDate}` : ""}`
      : null;

  /**
   * 자주 안 쓰는 동작은 「⋯ 더보기」로 접는다 — 제목 줄에 버튼이 다섯이면
   * 어느 것이 주요 동작인지 안 보인다. 남기는 것은 「저장」 하나다.
   * 「변경 취소」는 되돌릴 변경이 있을 때만 나온다.
   */
  const moreItems: MenuItem[] = [
    {
      key: "import",
      label: "엑셀에서 줄 가져오기",
      icon: Upload,
      hint: "분류·제품명·수량·단가",
      disabled: saving,
      onSelect: () => fileRef.current?.click(),
    },
    {
      key: "export",
      label: "엑셀 내려받기",
      icon: Download,
      disabled: saving,
      onSelect: () => exportProjectXlsx({ ...saved, ...form }, transactions),
    },
    ...(dirty
      ? ([
          { type: "separator", key: "sep-revert" },
          {
            key: "revert",
            label: "변경 취소",
            icon: Undo2,
            disabled: saving,
            onSelect: () => setDraft(null),
          },
        ] satisfies MenuItem[])
      : []),
    { type: "separator", key: "sep-danger" },
    { key: "delete", label: "삭제", icon: Trash2, danger: true, disabled: saving, onSelect: () => void remove() },
  ];

  const tabs = [
    { key: "overview", label: "개요" },
    { key: "expense", label: "지출 · 준비물", hint: summary.lineCount > 0 ? `${summary.lineCount}줄` : undefined },
    {
      key: "revenue",
      label: "수입 · 입금",
      // 금액이 아니라 건수를 붙인다 — 탭 이름 옆에 돈이 또 찍히면 개요의
      // 지표와 어느 쪽이 맞는지 견주게 된다
      hint: summary.installmentCount > 0 ? `${summary.installmentCount}회차` : undefined,
    },
    { key: "docs", label: "견적 · 계약" },
    { key: "ledger", label: "원장대조", hint: ledgerRows.length > 0 ? `${ledgerRows.length}건` : undefined },
  ];

  return (
    <PageShell width="wide">
      {/* ---- 머리 ----
          제목은 화면 이름(「재무 프로젝트 상세」)이고 프로젝트명은 그 아래
          편집 가능한 줄이다. 제목 자체가 입력칸이면 "지금 어느 화면인가"를
          잃는다 — 목업도 같은 배치다. */}
      <PageHeader
        className="mb-4"
        eyebrow={
          <Link
            href="/neander/finance/projects"
            className="inline-flex items-center gap-1 hover:text-nd-accent-strong"
          >
            <Icon icon={ArrowLeft} size={14} />
            프로젝트 목록
          </Link>
        }
        title="재무 프로젝트 상세"
        titleSuffix={
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <Badge tone={PROJECT_STATUS_TONE[form.status]} dot>
              {PROJECT_STATUS_LABEL[form.status]}
            </Badge>
            <span className="font-mono text-nd-caption text-nd-fg-2">{form.code || "코드 없음"}</span>
            {form.client && <span className="text-nd-caption text-nd-fg-3">· {form.client}</span>}
            {period && <span className="nd-num text-nd-caption text-nd-fg-3">· {period}</span>}
          </span>
        }
        description={
          <span className="flex items-center gap-1">
            {/* 프로젝트명은 여기서 바로 고친다 — 이름 하나 바꾸려고 다른 화면으로
                보내지 않는다. 연필은 "누르면 고쳐진다"는 표시일 뿐이다. */}
            <input
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              className="w-full min-w-[10rem] flex-1 rounded-nd-md border border-transparent bg-transparent px-1.5 py-0.5 text-nd-title font-semibold text-nd-fg outline-none transition-colors duration-nd-fast hover:border-nd-border focus:border-nd-accent focus:bg-nd-content"
              aria-label="프로젝트 이름"
              placeholder="프로젝트 이름"
            />
            <Icon icon={Pencil} size={14} className="shrink-0 text-nd-fg-4" />
          </span>
        }
        meta={
          dirty ? (
            // 색만으로 알리지 않는다 — 아이콘과 글자를 함께 둔다.
            // role="status" 라 낭독기도 저장 안 된 상태를 읽는다.
            <span role="status">
              <Badge tone="warning">
                <Icon icon={CircleAlert} size={14} />
                저장되지 않은 변경사항이 있습니다
              </Badge>
            </span>
          ) : undefined
        }
        actions={
          <>
            <IconButton
              ref={moreRef}
              icon={MoreHorizontal}
              label="프로젝트 더보기"
              variant="secondary"
              onClick={() => setMoreOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
            />
            <Button icon={Save} disabled={!dirty} loading={saving} onClick={save}>
              변경 저장
            </Button>
          </>
        }
      />
      <Menu
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        anchorRef={moreRef}
        placement="bottom-end"
        ariaLabel="프로젝트 더보기"
        items={moreItems}
      />
      {/* 메뉴가 닫혀 있어도 살아 있어야 한다 — 파일 선택창을 여는 통로다 */}
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void importXlsx(f);
        }}
      />

      <Tabs className="mb-4" ariaLabel="프로젝트 상세" value={tab} onChange={goTab} items={tabs} />

      {/* ================= 개요 ================= */}
      {tab === "overview" && (
        <>
          <KpiStrip columns={6} className="mb-2">
            <StatTile
              label="수입 (공급가액)"
              value={summary.revenue}
              flow="income"
              hint={
                summary.deduction > 0
                  ? `매출 차감 ${summary.deduction.toLocaleString("ko-KR")} 반영 · 부가세 ${summary.revenueVat.toLocaleString("ko-KR")} 별도`
                  : summary.revenueVat > 0
                    ? `부가세 ${summary.revenueVat.toLocaleString("ko-KR")} 별도 · 총액 ${summary.revenueTotal.toLocaleString("ko-KR")}`
                    : "면세 — 부가세 없음"
              }
            />
            <StatTile label="견적 원가" value={summary.estimate} flow="expense" hint={`${summary.lineCount}줄 · 수량 × 단가`} />
            <StatTile label="예상 이익" value={summary.profitEstimate} flow="net" hint={`이익률 ${formatMargin(summary.marginEstimate)}`} />
            <StatTile
              label="실제 원가"
              value={summary.actual}
              flow="expense"
              tone={unfilled > 0 && summary.actualFilled > 0 ? "warning" : undefined}
              hint={summary.lineCount === 0 ? "줄 없음" : unfilled > 0 ? `실제금액 미입력 ${unfilled}줄은 견적으로` : "모든 줄 실제금액 입력됨"}
            />
            <StatTile
              label="실질 이익"
              value={summary.profitActual}
              flow="net"
              hint={`이익률 ${formatMargin(summary.marginActual)}`}
              tag={
                <Badge tone={isLoss ? "danger" : "success"} size="sm">
                  {isLoss ? "손실" : "이익"}
                </Badge>
              }
            />
            <StatTile
              label="미수금"
              value={summary.unpaid}
              tone={summary.overdue > 0 ? "danger" : summary.deductionPending > 0 ? "warning" : undefined}
              hint={
                summary.overdue > 0
                  ? `연체 ${summary.overdueCount}건 · ${summary.overdue.toLocaleString("ko-KR")}원`
                  : summary.deductionPending > 0
                    ? `돌려줄 돈 ${summary.deductionPending.toLocaleString("ko-KR")}원 남음`
                    : summary.unpaid === 0
                      ? "다 받았습니다"
                      : `받은 돈 ${summary.received.toLocaleString("ko-KR")}원`
              }
            />
          </KpiStrip>
          <TableNote className="mb-5">
            이익 = 공급가액 − 원가. 원가는 실제로 지불한 금액(대개 부가세 포함)이라, 매입세액을 공제받으면 실제 부담은 이보다 적습니다.
          </TableNote>

          {/* ---- 기본 정보 ---- */}
          <Card padding="sm" className="mb-5">
            <SectionHeader title="기본 정보" hint="원장·문서와 이어지는 값" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <Field label="코드" hint="원장 프로젝트코드">
                <Input size="sm" value={form.code} onChange={(e) => setField("code", e.target.value.trim())} className="font-mono" />
              </Field>
              <Field label="발주처 · 주최">
                <Input size="sm" value={form.client ?? ""} onChange={(e) => setField("client", e.target.value || undefined)} />
              </Field>
              <Field label="상태">
                <Select size="sm" value={form.status} onChange={(e) => setField("status", e.target.value as ProjectStatus)}>
                  {PROJECT_STATUSES.map((st) => (
                    <option key={st} value={st}>{PROJECT_STATUS_LABEL[st]}</option>
                  ))}
                </Select>
              </Field>
              <Field label="시작일">
                <Input size="sm" type="date" value={form.startDate ?? ""} onChange={(e) => setField("startDate", e.target.value || undefined)} />
              </Field>
              <Field label="종료일">
                <Input size="sm" type="date" value={form.endDate ?? ""} onChange={(e) => setField("endDate", e.target.value || undefined)} />
              </Field>
              <Field label="사업소분류">
                <Input
                  size="sm"
                  value={form.bizMinor ?? ""}
                  onChange={(e) => setField("bizMinor", e.target.value || undefined)}
                  list="project-biz-minors"
                  placeholder="조향 · SMOAT …"
                />
                <datalist id="project-biz-minors">
                  {bizMinors.map((b) => <option key={b} value={b} />)}
                </datalist>
              </Field>
            </div>
            <Field label="메모" className="mt-3">
              <Textarea
                size="sm"
                rows={2}
                value={form.note ?? ""}
                onChange={(e) => setField("note", e.target.value || undefined)}
                className="!min-h-0"
                placeholder="계약 조건, 부가세 기준, 정산 일정 …"
              />
            </Field>
          </Card>

          {/* ---- 분류별 소계 ---- */}
          {groups.length > 0 && (
            <Card padding="none" className="overflow-hidden">
              <div className="px-5 pt-5">
                <SectionHeader title="분류별 소계" hint="지출을 분류별로 묶은 소계" action={<TableNote>단위: 원</TableNote>} />
              </div>
              <TableScroll>
                <Table minWidth={560} className="max-w-3xl">
                  <thead>
                    <tr>
                      <Th className="pl-5">분류</Th>
                      <Th align="right">줄 수</Th>
                      <Th align="right">준비</Th>
                      <Th align="right">견적</Th>
                      <Th align="right">실제</Th>
                      <Th align="right" className="pr-5">수입 대비</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => (
                      <Tr key={g.category}>
                        <Td className="pl-5 font-medium">{g.category}</Td>
                        <Td num>{g.lines.length}</Td>
                        <Td num muted>{g.doneCount}/{g.lines.length}</Td>
                        <Td num><Money value={g.estimate} unit={false} muted /></Td>
                        <Td num><Money value={g.actual} unit={false} flow="expense" /></Td>
                        <Td num muted className="pr-5">{summary.revenue > 0 ? `${((g.actual / summary.revenue) * 100).toFixed(1)}%` : "—"}</Td>
                      </Tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <TotalRow>
                      <Td className="pl-5">총계</Td>
                      <Td num>{summary.lineCount}</Td>
                      <Td num muted>{summary.doneCount}/{summary.lineCount}</Td>
                      <Td num><Money value={summary.estimate} unit={false} flow="expense" /></Td>
                      <Td num><Money value={summary.actual} unit={false} flow="expense" /></Td>
                      <Td num muted className="pr-5">{summary.revenue > 0 ? `${((summary.actual / summary.revenue) * 100).toFixed(1)}%` : "—"}</Td>
                    </TotalRow>
                  </tfoot>
                </Table>
              </TableScroll>
            </Card>
          )}
        </>
      )}

      {/* ================= 지출 · 준비물 ================= */}
      {tab === "expense" && (
        <Card padding="none" className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-nd-line px-5 py-3">
            <h2 className="text-nd-section text-nd-fg">
              지출 · 준비물
              <span className="ml-2 text-nd-caption font-normal text-nd-fg-3">
                {summary.lineCount}줄 · 준비 {summary.doneCount}/{summary.lineCount} · 물품·인쇄물·식대·인건비·운송 모두 여기에
              </span>
            </h2>
            <div className="flex items-center gap-2">
              <span className="hidden text-nd-micro text-nd-fg-3 sm:inline">
                엑셀처럼 씁니다 — 붙여넣기 · 방향키 이동 · 오른쪽 클릭으로 줄 넣기/지우기
              </span>
              {/* 배율은 원장 시트와 같은 캡슐 — 두 시트의 조작이 같아 보여야 한다 */}
              <ButtonGroup label="시트 배율">
                <IconButton
                  icon={ZoomOut}
                  label="시트 축소"
                  size="sm"
                  pill
                  onClick={() => sheetLayout.stepZoom(-1)}
                  disabled={sheetLayout.layout.zoom <= ZOOM_STEPS[0]}
                />
                <button
                  type="button"
                  onClick={() => sheetLayout.setZoom(DEFAULT_ZOOM)}
                  title="100% 로"
                  aria-label={`시트 배율 ${Math.round(sheetLayout.layout.zoom * 100)}% — 누르면 100% 로`}
                  className="nd-num h-ctl-sm min-w-[3rem] rounded-full px-1.5 text-nd-caption font-medium text-nd-fg-2 transition-colors duration-nd-fast hover:bg-nd-fg/[.06] hover:text-nd-fg"
                >
                  {Math.round(sheetLayout.layout.zoom * 100)}%
                </button>
                <IconButton
                  icon={ZoomIn}
                  label="시트 확대"
                  size="sm"
                  pill
                  onClick={() => sheetLayout.stepZoom(1)}
                  disabled={sheetLayout.layout.zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
                />
              </ButtonGroup>
            </div>
          </div>

          <ChecklistSheet
            lines={form.lines}
            onChange={setLines}
            columns={form.columns ?? []}
            onColumnsChange={(cols) => setField("columns", cols)}
            createRow={() => newLine("")}
            undo={undo}
            redo={redo}
            canUndo={canUndo}
            canRedo={canRedo}
            height={sheetHeight}
            sheet={sheetLayout}
          />

          <div className="flex flex-wrap items-center justify-end gap-6 border-t border-nd-line px-5 py-2.5 text-nd-caption">
            <span className="text-nd-fg-2">
              견적 합계 <b className="ml-1 text-nd-body"><Money value={summary.estimate} unit={false} flow="expense" /></b>
            </span>
            <span className="text-nd-fg-2">
              실제 합계 <b className="ml-1 text-nd-body"><Money value={summary.actual} unit={false} flow="expense" /></b>
              {unfilled > 0 && <span className="ml-1 text-nd-fg-3">(미입력 {unfilled}줄은 견적으로)</span>}
            </span>
          </div>
        </Card>
      )}

      {/* ================= 수입 · 입금 ================= */}
      {tab === "revenue" && (
        <div className="flex flex-col gap-5">
          {/* ---- 계약금액 · 부가세 ---- */}
          <Card>
            <SectionHeader title="수입" hint="계약서에 적힌 금액이 부가세를 포함한 값인지 골라 주세요" />
            <div className="grid gap-5 lg:grid-cols-[minmax(0,24rem)_1fr] [&>*]:min-w-0">
              <div>
                <FormRow className="grid-cols-[minmax(0,1fr)_minmax(0,9.5rem)]">
                  <Field label="계약금액">
                    <Input
                      type="number"
                      inputMode="numeric"
                      value={form.contractAmount || ""}
                      placeholder="0"
                      onChange={(e) => setField("contractAmount", Number(e.target.value) || 0)}
                      className="nd-num text-right font-semibold"
                    />
                  </Field>
                  <Field label="부가세">
                    <Select
                      value={form.vatMode ?? "excluded"}
                      onChange={(e) => setField("vatMode", e.target.value as VatMode)}
                      title={VAT_HINT[form.vatMode ?? "excluded"]}
                    >
                      {VAT_MODES.map((m) => (
                        <option key={m} value={m}>{VAT_LABEL[m]}</option>
                      ))}
                    </Select>
                  </Field>
                </FormRow>
                <p className="mt-1.5 text-nd-caption text-nd-fg-3">{VAT_HINT[form.vatMode ?? "excluded"]}</p>
                <p className="mt-2 text-nd-caption text-nd-fg-3">
                  이익은 공급가액으로 계산합니다. 받은 부가세는 나중에 낼 돈이라 회사에 남는 돈이 아닙니다.
                </p>
              </div>

              {/* 계약서 숫자를 그대로 읽어 확인하는 세 값만 둔다.
                  받은 돈·미수금은 개요 탭의 지표 띠에 있다 — 같은 숫자를 두
                  군데 두면 한쪽만 고쳐졌을 때 어느 쪽이 맞는지 알 수 없다. */}
              {/* 매출 차감이 있으면 「계약서 숫자」와 「남는 숫자」가 갈린다. 청구 총액은
                  계약서 그대로 두고, 공급가액·부가세는 차감을 뺀 값, 넷째 칸에 순 입금을 둔다. */}
              <KpiStrip columns={summary.deductionCount > 0 ? 4 : 3} className="self-start">
                <StatTile
                  label="공급가액"
                  value={summary.revenue}
                  hint={summary.deductionCount > 0 ? "매출 차감 뒤 · 이익 계산의 기준" : "이익 계산의 기준"}
                />
                <StatTile label="부가세" value={summary.revenueVat} hint={VAT_LABEL[form.vatMode ?? "excluded"]} />
                <StatTile label="청구 총액" value={summary.grossTotal} hint="계약서에 찍히는 금액" />
                {summary.deductionCount > 0 && (
                  <StatTile
                    label="순 입금"
                    value={summary.revenueTotal}
                    tone={summary.deductionPending > 0 ? "warning" : undefined}
                    hint={
                      summary.deductionPending > 0
                        ? `돌려줄 돈 ${summary.deductionPending.toLocaleString("ko-KR")}원 남음`
                        : `청구 총액 − 매출 차감 ${summary.deduction.toLocaleString("ko-KR")}`
                    }
                  />
                )}
              </KpiStrip>
            </div>

            {summary.overdue > 0 && (
              <InlineNotice tone="danger" className="mt-4 text-nd-caption">
                받기로 한 날이 지난 회차 <b>{summary.overdueCount}건 · {summary.overdue.toLocaleString("ko-KR")}원</b>
              </InlineNotice>
            )}
          </Card>

          {/* ---- 입금 일정 (선금·중도금·잔금) ---- */}
          <Card padding="none" className="overflow-hidden">
            <div className="px-5 pt-5">
              <SectionHeader
                title="입금 일정"
                hint="계약금액을 나눠 받는 회차"
                action={
                  <Button variant="ghost" size="sm" icon={Plus} onClick={addInstallment}>
                    회차 추가
                  </Button>
                }
              />
            </div>
            {(form.installments ?? []).length === 0 ? (
              <p className="px-5 pb-5 text-nd-caption text-nd-fg-3">
                아직 없습니다. 「회차 추가」로 선금·중도금·잔금을 나눠 적으면 미수금이 계산됩니다.
              </p>
            ) : (
              // 회차는 계속 늘어난다 — 아래로 스크롤해도 어느 열인지 잃지 않게 머리글을 붙인다
              <TableScroll maxHeight={360}>
                <Table minWidth={860} dense>
                  <thead>
                    <tr>
                      <Th sticky="top" className="w-28 pl-5">구분</Th>
                      <Th sticky="top" align="right" className="w-32">금액</Th>
                      <Th sticky="top" align="right" className="w-28">청구액</Th>
                      <Th sticky="top" className="w-44">받기로 한 날</Th>
                      <Th sticky="top" className="w-44">입금일</Th>
                      <Th sticky="top" className="w-20">상태</Th>
                      <Th sticky="top">비고</Th>
                      <Th sticky="top" className="w-12 pr-5" aria-label="동작" />
                    </tr>
                  </thead>
                  <tbody>
                    {(form.installments ?? []).map((i) => {
                      const st = installmentStatus(i);
                      const billed = splitVat(i.amount, form.vatMode ?? "excluded").total;
                      return (
                        <Tr key={i.id} hover={false}>
                          <Td className="pl-5">
                            <Select
                              size="sm"
                              value={i.kind}
                              onChange={(e) => updateInstallment(i.id, { kind: e.target.value as InstallmentKind })}
                              aria-label="구분"
                            >
                              {INSTALLMENT_KINDS.map((k) => (
                                <option key={k} value={k}>{k}</option>
                              ))}
                            </Select>
                          </Td>
                          <Td>
                            <Input
                              size="sm"
                              type="number"
                              inputMode="numeric"
                              value={i.amount || ""}
                              placeholder="0"
                              onChange={(e) => updateInstallment(i.id, { amount: Number(e.target.value) || 0 })}
                              className="nd-num text-right"
                              aria-label="금액"
                            />
                          </Td>
                          <Td num muted title="부가세를 더한 실제 청구액">
                            {billed.toLocaleString("ko-KR")}
                          </Td>
                          <Td>
                            <Input
                              size="sm"
                              type="date"
                              value={i.dueDate ?? ""}
                              onChange={(e) => updateInstallment(i.id, { dueDate: e.target.value || undefined })}
                              aria-label="받기로 한 날"
                            />
                          </Td>
                          <Td>
                            <Input
                              size="sm"
                              type="date"
                              value={i.paidDate ?? ""}
                              onChange={(e) => updateInstallment(i.id, { paidDate: e.target.value || undefined })}
                              className={cn(i.paidDate && "border-nd-success/50 bg-nd-success-soft/40")}
                              title="날짜를 넣으면 입금 완료로 셉니다"
                              aria-label="입금일"
                            />
                          </Td>
                          <Td>
                            <Badge tone={INSTALLMENT_STATUS_TONE[st]} size="sm" dot>
                              {INSTALLMENT_STATUS_LABEL[st]}
                            </Badge>
                          </Td>
                          <Td>
                            <Input
                              size="sm"
                              value={i.note ?? ""}
                              onChange={(e) => updateInstallment(i.id, { note: e.target.value || undefined })}
                              placeholder="비고"
                              className="min-w-[8rem]"
                              aria-label="비고"
                            />
                          </Td>
                          <Td align="right" className="pr-5">
                            <IconButton icon={X} label="회차 삭제" size="sm" onClick={() => removeInstallment(i.id)} className="text-nd-fg-3 hover:text-nd-danger-text" />
                          </Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
              </TableScroll>
            )}
            {summary.installmentCount > 0 && summary.scheduleGap !== 0 && (
              <div className="px-5 pb-4 pt-3">
                <InlineNotice tone="warning" className="text-nd-caption">
                  회차 합계가 계약 청구액과 <b>{Math.abs(summary.scheduleGap).toLocaleString("ko-KR")}원</b>{" "}
                  {summary.scheduleGap > 0 ? "모자랍니다" : "많습니다"}. 아직 안 나눈 몫이면 회차를 더하고, 잘못 적었으면 금액을 고치세요.
                </InlineNotice>
              </div>
            )}
          </Card>

          {/* ---- 추가 수입 ---- */}
          <Card padding="none" className="overflow-hidden">
            <div className="px-5 pt-5">
              <SectionHeader
                title="추가 수입"
                hint="추가 정산 · 현장 판매 · 지원금 …"
                action={
                  <Button variant="ghost" size="sm" icon={Plus} onClick={() => edit((f) => ({ ...f, revenues: [...f.revenues, newRevenue()] }))}>
                    줄 추가
                  </Button>
                }
              />
            </div>
            {form.revenues.length === 0 ? (
              <p className="px-5 pb-5 text-nd-caption text-nd-fg-3">없음</p>
            ) : (
              <TableScroll maxHeight={360}>
                <Table minWidth={900} dense>
                  <thead>
                    <tr>
                      <Th sticky="top" className="pl-5">항목</Th>
                      <Th sticky="top" align="right" className="w-32">금액</Th>
                      <Th sticky="top" className="w-36">부가세</Th>
                      <Th sticky="top" align="right" className="w-28">공급가액</Th>
                      <Th sticky="top" className="w-44">입금일</Th>
                      <Th sticky="top">비고</Th>
                      <Th sticky="top" className="w-12 pr-5" aria-label="동작" />
                    </tr>
                  </thead>
                  <tbody>
                    {form.revenues.map((r) => {
                      const split = splitVat(r.amount, r.vatMode ?? form.vatMode ?? "excluded");
                      return (
                        <Tr key={r.id} hover={false}>
                          <Td className="pl-5">
                            <Input size="sm" value={r.label} onChange={(e) => updateRevenue(r.id, { label: e.target.value })} placeholder="항목" className="min-w-[8rem]" aria-label="항목" />
                          </Td>
                          <Td>
                            <Input
                              size="sm"
                              type="number"
                              inputMode="numeric"
                              value={r.amount || ""}
                              placeholder="0"
                              onChange={(e) => updateRevenue(r.id, { amount: Number(e.target.value) || 0 })}
                              className="nd-num text-right"
                              aria-label="금액"
                            />
                          </Td>
                          <Td>
                            <Select
                              size="sm"
                              value={r.vatMode ?? ""}
                              onChange={(e) => updateRevenue(r.id, { vatMode: (e.target.value || undefined) as VatMode | undefined })}
                              aria-label="부가세"
                            >
                              <option value="">계약과 동일</option>
                              {VAT_MODES.map((m) => (
                                <option key={m} value={m}>{VAT_LABEL[m]}</option>
                              ))}
                            </Select>
                          </Td>
                          <Td num className="text-nd-fg-2">{split.supply.toLocaleString("ko-KR")}</Td>
                          <Td>
                            <Input
                              size="sm"
                              type="date"
                              value={r.receivedDate ?? ""}
                              onChange={(e) => updateRevenue(r.id, { receivedDate: e.target.value || undefined, received: undefined })}
                              className={cn(isReceived(r) && "border-nd-success/50 bg-nd-success-soft/40")}
                              title="날짜를 넣으면 입금 완료로 셉니다"
                              aria-label="입금일"
                            />
                          </Td>
                          <Td>
                            <Input size="sm" value={r.note ?? ""} onChange={(e) => updateRevenue(r.id, { note: e.target.value || undefined })} placeholder="비고" className="min-w-[8rem]" aria-label="비고" />
                          </Td>
                          <Td align="right" className="pr-5">
                            <IconButton icon={X} label="줄 삭제" size="sm" onClick={() => removeRevenue(r.id)} className="text-nd-fg-3 hover:text-nd-danger-text" />
                          </Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
              </TableScroll>
            )}
          </Card>

          {/* ---- 매출 차감 ---- */}
          <Card padding="none" className="overflow-hidden">
            <div className="px-5 pt-5">
              <SectionHeader
                title="매출 차감"
                hint="발주처에 돌려주는 돈 · 할인 · 에누리 — 계약금액은 그대로 두고 여기서 뺍니다"
                action={
                  <Button variant="ghost" size="sm" icon={Plus} onClick={() => edit((f) => ({ ...f, deductions: [...(f.deductions ?? []), newDeduction()] }))}>
                    줄 추가
                  </Button>
                }
              />
            </div>
            {(form.deductions ?? []).length === 0 ? (
              <p className="px-5 pb-5 text-nd-caption text-nd-fg-3">
                없음. 계약서 금액 중 일부를 돌려주기로 했다면 여기 적으세요 — 계약금액을 줄여 적으면 통장에 들어온 돈과 어긋납니다.
              </p>
            ) : (
              <>
                <TableScroll maxHeight={360}>
                  <Table minWidth={980} dense>
                    <thead>
                      <tr>
                        <Th sticky="top" className="pl-5">항목</Th>
                        <Th sticky="top" align="right" className="w-32">돌려주는 돈</Th>
                        <Th sticky="top" className="w-48">세금계산서</Th>
                        <Th sticky="top" align="right" className="w-28">공급가액</Th>
                        <Th sticky="top" align="right" className="w-24">부가세</Th>
                        <Th sticky="top" className="w-44">돌려준 날</Th>
                        <Th sticky="top">비고</Th>
                        <Th sticky="top" className="w-12 pr-5" aria-label="동작" />
                      </tr>
                    </thead>
                    <tbody>
                      {(form.deductions ?? []).map((d) => {
                        const split = deductionSplit(d, form.vatMode ?? "excluded");
                        return (
                          <Tr key={d.id} hover={false}>
                            <Td className="pl-5">
                              <Input size="sm" value={d.label} onChange={(e) => updateDeduction(d.id, { label: e.target.value })} placeholder="항목" className="min-w-[8rem]" aria-label="항목" />
                            </Td>
                            <Td>
                              <Input
                                size="sm"
                                type="number"
                                inputMode="numeric"
                                value={d.amount || ""}
                                placeholder="0"
                                // 음수로 적어도 같은 뜻이다 — 돌려주는 돈은 늘 양수로 둔다
                                onChange={(e) => updateDeduction(d.id, { amount: Math.abs(Number(e.target.value) || 0) })}
                                className="nd-num text-right"
                                title="통장에서 실제로 나가는 금액"
                                aria-label="돌려주는 돈"
                              />
                            </Td>
                            <Td>
                              <Select
                                size="sm"
                                value={d.taxMode}
                                onChange={(e) => updateDeduction(d.id, { taxMode: e.target.value as DeductionTaxMode })}
                                title={DEDUCTION_TAX_HINT[d.taxMode]}
                                aria-label="세금계산서"
                              >
                                {DEDUCTION_TAX_MODES.map((m) => (
                                  <option key={m} value={m}>{DEDUCTION_TAX_LABEL[m]}</option>
                                ))}
                              </Select>
                            </Td>
                            <Td num>
                              <Money value={-split.supply} unit={false} flow="expense" />
                            </Td>
                            <Td num title={d.taxMode === "none" ? "세금계산서를 그대로 두면 부가세는 줄지 않습니다" : undefined}>
                              <Money value={-split.vat} unit={false} flow="expense" />
                            </Td>
                            <Td>
                              <Input
                                size="sm"
                                type="date"
                                value={d.paidDate ?? ""}
                                onChange={(e) => updateDeduction(d.id, { paidDate: e.target.value || undefined })}
                                className={cn(d.paidDate && "border-nd-success/50 bg-nd-success-soft/40")}
                                title="돌려줬거나 청구액에서 뺀 날. 비워 두면 아직 돌려줄 돈으로 셉니다"
                                aria-label="돌려준 날"
                              />
                            </Td>
                            <Td>
                              <Input size="sm" value={d.note ?? ""} onChange={(e) => updateDeduction(d.id, { note: e.target.value || undefined })} placeholder="비고" className="min-w-[8rem]" aria-label="비고" />
                            </Td>
                            <Td align="right" className="pr-5">
                              <IconButton icon={X} label="줄 삭제" size="sm" onClick={() => removeDeduction(d.id)} className="text-nd-fg-3 hover:text-nd-danger-text" />
                            </Td>
                          </Tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </TableScroll>
                <div className="px-5 pb-4 pt-3">
                  <TableNote>
                    「세금계산서 그대로」는 부가세를 처음 끊은 대로 내므로 돌려준 돈 전액이 이익에서 빠집니다.
                    원장에는 돌려준 돈을 입금 때와 같은 매출 계정의 음수로 적으세요 — 「환급」 유형으로 적으면 지출이 줄어든 것으로 계산됩니다.
                  </TableNote>
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      {/* ================= 견적 · 계약 ================= */}
      {/* 문서는 편집창 안에서 바로 저장된다 (프로젝트 「저장」 과 따로). 계약금액 반영만 초안을 거친다.
          바깥이 이미 Card 라 ProjectDocs 는 껍데기를 벗고(bare) 한 겹으로 들어온다. */}
      {tab === "docs" && (
        <Card>
          <ProjectDocs
            bare
            project={saved}
            onApplyAmount={(amount, vatMode) => edit((f) => ({ ...f, contractAmount: amount, vatMode }))}
            onNotice={notify}
          />
        </Card>
      )}

      {/* ================= 원장대조 ================= */}
      {tab === "ledger" && (
        <Card padding="none" className="overflow-hidden">
          <div className="px-5 pt-5">
            <SectionHeader
              title="원장 대조"
              hint={`원장에서 프로젝트코드 ${form.code || "(없음)"} 가 찍힌 거래 — 줄을 누르면 그 자리에서 고칩니다`}
              action={
                form.code ? (
                  <Link
                    href={ledgerHref({ projectCode: form.code })}
                    className="inline-flex items-center gap-1 text-nd-caption font-medium text-nd-accent-strong hover:underline"
                  >
                    원장에서 보기
                    <Icon icon={ArrowUpRight} size={14} />
                  </Link>
                ) : undefined
              }
            />
          </div>

          {ledgerRows.length > 0 && (
            <div className="flex flex-wrap gap-x-8 gap-y-2 px-5 pb-4 text-nd-body">
              <span className="text-nd-fg-2">
                거래 <b className="nd-num text-nd-fg">{ledgerRows.length}</b>건
              </span>
              <span className="text-nd-fg-2">
                수입 <Money value={summary.ledger.income} unit={false} flow="income" className="font-medium" />
              </span>
              <span className="text-nd-fg-2">
                지출 <Money value={ledgerNet} unit={false} flow="expense" className="font-medium" />
                {summary.ledger.refund > 0 && (
                  <span className="ml-1 text-nd-caption text-nd-fg-3">(환급 {summary.ledger.refund.toLocaleString("ko-KR")} 차감)</span>
                )}
              </span>
              <span className="text-nd-fg-2">
                지출 실제 원가와 차이 <Money value={gap} unit={false} className="font-medium" />
                <span className={cn("ml-1 text-nd-caption", gap === 0 ? "text-nd-success-text" : "text-nd-fg-3")}>
                  {gap > 0
                    ? "원장에 아직 안 찍힌 지출이 있거나 견적이 높습니다"
                    : gap < 0
                      ? "지출 목록에 빠진 항목이 원장에 있습니다"
                      : "일치"}
                </span>
              </span>
            </div>
          )}

          {ledgerRows.length === 0 ? (
            <p className="px-5 pb-4 text-nd-caption text-nd-fg-3">
              아직 이 코드로 잡힌 거래가 없습니다. 아래에서 거래를 찾아 붙이거나, 원장에서 프로젝트코드에{" "}
              <span className="font-mono">{form.code || "코드"}</span> 를 적으면 여기 모입니다.
            </p>
          ) : (
            // 한 프로젝트에 수십 건까지 붙는다 — 머리글을 붙여 두고 표 안에서만 스크롤한다
            <TableScroll maxHeight={420}>
              <Table minWidth={720} dense>
                <thead>
                  <tr>
                    <Th sticky="top" className="pl-5">거래일</Th>
                    <Th sticky="top">유형</Th>
                    <Th sticky="top">거래처</Th>
                    <Th sticky="top">계정</Th>
                    <Th sticky="top" align="right">순금액</Th>
                    <Th sticky="top" className="w-20 pr-5" aria-label="동작" />
                  </tr>
                </thead>
                <tbody>
                  {ledgerRows.map((t) => (
                    <Tr
                      key={t.id}
                      onClick={() => setEditingTx(t)}
                      className="cursor-pointer"
                      title="눌러서 이 거래를 고칩니다"
                    >
                      <Td className="whitespace-nowrap pl-5 nd-num">{t.date}</Td>
                      <Td>{t.txType}</Td>
                      <Td>
                        <span className="block max-w-[16rem] truncate" title={t.vendor ?? ""}>{t.vendor ?? ""}</span>
                      </Td>
                      <Td muted>
                        <span className="block max-w-[18rem] truncate" title={[t.acctMajor, t.acctMid, t.acctMinor].filter(Boolean).join(" › ")}>
                          {[t.acctMajor, t.acctMid, t.acctMinor].filter(Boolean).join(" › ")}
                        </span>
                      </Td>
                      <Td num><Money value={netAmount(t)} unit={false} flow={txFlow(t.txType)} /></Td>
                      <Td align="right" className="pr-5">
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={Unlink}
                          disabled={attaching}
                          onClick={(e) => {
                            e.stopPropagation();
                            void detachTx(t);
                          }}
                          className="text-nd-fg-3 hover:text-nd-danger-text"
                          title="이 프로젝트에서 떼기 (거래는 원장에 남습니다)"
                        >
                          떼기
                        </Button>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          )}

          {/* 거래 붙이기 — 프로젝트코드가 비어 있는 거래를 찾아 이 코드로 묶는다 */}
          <div className="border-t border-nd-line px-5 py-4">
            {codeUnsaved ? (
              <InlineNotice tone="warning">
                코드를 <span className="font-mono">{form.code || "(빈 값)"}</span> 로 고쳤습니다. 먼저 저장해야 거래를 붙일 수 있습니다.
              </InlineNotice>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <label className="flex flex-wrap items-center gap-2 text-nd-caption font-medium text-nd-fg-2">
                    거래 붙이기
                    <Input
                      size="sm"
                      value={attachQuery}
                      onChange={(e) => setAttachQuery(e.target.value)}
                      placeholder="거래처·비고·금액·날짜로 찾기"
                      className="w-72 max-w-full"
                      disabled={!savedCode || attaching}
                    />
                  </label>
                  <span className="text-nd-caption text-nd-fg-3">프로젝트코드가 비어 있는 거래만 나옵니다</span>
                </div>
                {attachQuery.trim() && (
                  <div className="mt-3 overflow-hidden rounded-nd-md border border-nd-line">
                    {attachCandidates.length === 0 ? (
                      <p className="px-3 py-4 text-center text-nd-caption text-nd-fg-3">찾은 거래가 없습니다.</p>
                    ) : (
                      <TableScroll maxHeight={256}>
                        <Table minWidth={640} dense>
                          <tbody>
                            {attachCandidates.map((t) => (
                              <Tr key={t.id}>
                                <Td className="whitespace-nowrap nd-num">{t.date}</Td>
                                <Td>{t.txType}</Td>
                                <Td>
                                  <span className="block max-w-[16rem] truncate" title={t.vendor ?? ""}>{t.vendor ?? ""}</span>
                                </Td>
                                <Td muted>{[t.acctMid, t.acctMinor].filter(Boolean).join(" › ")}</Td>
                                <Td num><Money value={netAmount(t)} unit={false} flow={txFlow(t.txType)} /></Td>
                                <Td align="right" className="w-24">
                                  <Button variant="soft" size="sm" icon={Link2} disabled={attaching} onClick={() => void attachTx(t)}>
                                    붙이기
                                  </Button>
                                </Td>
                              </Tr>
                            ))}
                          </tbody>
                        </Table>
                      </TableScroll>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </Card>
      )}

      {/* 원장 거래 수정 — 원장·검토함과 같은 편집기를 그대로 쓴다 */}
      {editingTx && (
        <TransactionEditor
          tx={editingTx}
          accounts={accounts}
          paymentMethods={paymentMethods}
          knownBizMinors={bizMinors}
          onSave={async (patch) => {
            await updateFinTransaction(editingTx.id, patch);
            await refresh();
            toast.success("원장 거래를 수정했습니다.");
          }}
          onClose={() => setEditingTx(null)}
        />
      )}
    </PageShell>
  );
}
