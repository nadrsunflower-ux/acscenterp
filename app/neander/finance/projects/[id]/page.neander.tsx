"use client";

// ============================================================
//  프로젝트 손익 — 상세 (체크리스트 + 계약금액 + 손익)
// ------------------------------------------------------------
//  엑셀 체크리스트를 화면으로 옮긴 것이다. 분류별로 묶인 표에 수량·단가를
//  넣으면 견적금액이 굴러가고, 위에 계약금액과 이익이 바로 보인다.
//
//  편집은 초안에 쌓고, 손을 멈추면 **저절로** 프로젝트를 통째로 저장한다
//  (저장 버튼이 없다). 셀마다 요청을 보내지 않는 것은 그대로다 — 행사
//  준비 중에는 수십 줄을 연달아 고치므로 셀마다 보내면 느리고, 중간에
//  끊기면 반쯤 바뀐 표가 남는다. 화면을 떠날 때 남은 변경도 저장한다.
//
//  「실제금액」 열은 나중에 채운다. 견적(수량×단가)은 준비할 때, 실제는
//  결제가 끝난 뒤. 안 채운 줄은 견적으로 계산하되 몇 줄이 비었는지 위에
//  적어 둔다 — 실질 이익이 "아직 견적 섞인 숫자"인지 알 수 있어야 한다.
//
//  화면 구성은 승인 목업(all-pages/finance-project-detail.png)을 따른다:
//  제목 줄 → 탭 다섯 → 탭 안 내용. 카드 여덟 장을 세로로 늘어놓으면 이
//  화면에서 가장 오래 머무는 지출 시트가 늘 스크롤 한참 아래에 있었다.
//  탭은 「지금 무슨 일을 하는 중인가」로 나눈다 — 숫자를 훑는(개요),
//  문서를 붙이는(견적·계약), 돈 들어온 것을 맞추는(수입·입금),
//  준비물과 사람 값을 채우는(지출·인건비), 원장과 대조하는(원장대조).
//  지출·인건비 탭은 위에 지출 시트, 아래에 인건비 칸 — 외부 인력(분류
//  「인건비」 줄)과 사내 인력을 한곳에서 적는다.
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
  Check,
  CircleAlert,
  Download,
  FileText,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCw,
  SearchX,
  Trash2,
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
  Checkbox,
  cn,
  EmptyState,
  Field,
  FieldAction,
  FormRow,
  Icon,
  IconButton,
  InlineNotice,
  Input,
  NumberInput,
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
import { AutoCodeBox } from "@/components/neander/finance/AutoCode";
import { ChecklistSheet } from "@/components/neander/finance/ChecklistSheet";
import { DeliveryDate } from "@/components/neander/finance/DeliveryDate";
import { DueInput } from "@/components/neander/finance/DueInput";
import { isTypingInto } from "@/components/neander/finance/sheetCells";
import {
  CHECKLIST_LAYOUT_KEY,
  DEFAULT_ZOOM,
  ZOOM_STEPS,
  useSheetLayout,
} from "@/components/neander/finance/useSheetLayout";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { useCrumbTail } from "@/components/neander/shell/context";
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
  ENTITY_SHORT,
  PROJECT_ENTITIES,
  projectEntities,
  type ProjectEntity,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABEL,
  VAT_LABEL,
  VAT_MODES,
  VAT_HINT,
  INSTALLMENT_KINDS,
  installmentStatus,
  installmentStatusText,
  isInstallmentReceived,
  isReceived,
  newInstallment,
  splitVat,
  type FinProjectInstallment,
  type InstallmentKind,
  type InstallmentStatus,
  type VatMode,
  formatMargin,
  groupLines,
  hasActual,
  isLaborLine,
  LABOR_CATEGORY,
  ledgerRowsOf,
  lineActual,
  lineEstimate,
  newLine,
  newRevenue,
  newDeduction,
  newLabor,
  newTodo,
  laborCost,
  laborTotal,
  type FinProjectLabor,
  type FinProjectTodo,
  DEDUCTION_TAX_MODES,
  DEDUCTION_TAX_LABEL,
  DEDUCTION_TAX_HINT,
  deductionSplit,
  isDeductionReturned,
  type DeductionTaxMode,
  type FinProjectDeduction,
  projectSummary,
  type FinProjectDoc,
  type FinProjectInput,
  type FinProjectLine,
  type FinProjectRevenue,
  type ProjectStatus,
  sanitizeProject,
} from "@/lib/neander/finance/project";
import { suggestDayRates } from "@/lib/neander/finance/project-report";
import { formatChatTime, todayStrKST } from "@/lib/neander/format";
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

/** 인건비 줄 — 좁은 화면에서는 칸이 두 줄로 접혀 사람끼리 섞여 보이므로 줄 사이에 선을 긋는다 */
const MOBILE_ROW_RULE = "border-t border-nd-line pt-3 first:border-t-0 first:pt-0 sm:border-t-0 sm:pt-0";

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
    deliveryDate: p.deliveryDate,
    bizMinor: p.bizMinor,
    entities: p.entities ? [...p.entities] : undefined,
    contractAmount: p.contractAmount ?? 0,
    vatMode: p.vatMode,
    installments: p.installments?.map((i) => ({ ...i })),
    revenues: (p.revenues ?? []).map((r) => ({ ...r })),
    deductions: p.deductions?.map((d) => ({ ...d })),
    columns: p.columns?.map((c) => ({ ...c })),
    lines: (p.lines ?? []).map((l) => ({ ...l })),
    note: p.note,
    labor: p.labor?.map((l) => ({ ...l })),
    todos: p.todos?.map((t) => ({ ...t })),
    lessons: p.lessons,
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

/** 손을 멈추고 이만큼 지나면 저장한다 — 글자를 치는 동안 요청이 쏟아지지 않게 */
const AUTOSAVE_MS = 800;
/** 저장이 실패하면 한 번은 조용히 다시 해 본다 (잠깐 끊긴 연결) */
const AUTOSAVE_RETRY_MS = 3000;

/**
 * 프로젝트가 바뀌면 편집기를 새로 띄운다 — 초안·되돌리기·저장 대기가
 * 앞 프로젝트 것과 섞이지 않는다. 떠나는 편집기는 남은 변경을 저장하고 내려간다.
 */
export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  return <ProjectDetailEditor key={id} id={id} />;
}

function ProjectDetailEditor({ id }: { id: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const { projects, transactions, accounts, paymentMethods, loading, refresh } = useFinance();

  const saved = useMemo(() => projects.find((p) => p.id === id) ?? null, [projects, id]);
  // 상단 경로 끝에 프로젝트 이름 — 저장된 이름을 쓴다(고치는 중인 글자는 아직 위치가 아니다)
  useCrumbTail(saved?.name);
  /**
   * 초안과 그 되돌리기 스택.
   *
   * 한 덩어리 상태로 둔다 — 스택을 따로 두면 초안을 바꾸는 자리마다 두 번
   * 갱신해야 하고, 그중 하나만 빠져도 ⌘Z 가 엉뚱한 데로 간다.
   * `present` 가 null 이면 "저장된 그대로"다.
   */
  const [hist, setHist] = useState<DraftHistory>(EMPTY_DRAFT_HISTORY);
  const draft = hist.present;
  /** 삭제하는 중 — 메뉴를 잠근다 */
  const [removing, setRemoving] = useState(false);
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

  const form: FinProjectInput | null = draft ?? (saved ? toInput(saved) : null);
  const dirty = useMemo(
    () => !!draft && !!saved && !sameDraft(draft, toInput(saved)),
    [draft, saved],
  );

  // ---- 자동 저장 ------------------------------------------------
  //
  //  손을 멈추면 초안을 통째로 보낸다. 보내는 동안에도 계속 고칠 수 있고,
  //  그사이 고친 것은 다음 저장이 가져간다. 되돌리기 스택은 저장해도 남는다.
  //
  //  서버는 값을 다듬는다 — 빈 줄을 버리고 글자 앞뒤 공백을 지운다. 그래서
  //  저장한 뒤 초안을 저장본으로 바꿔 끼우는 것은 **다듬을 것이 없었을 때만**
  //  한다. 아니면 방금 「줄 추가」 한 빈 줄이 사라지고, 「홍길동 」 다음에 칠
  //  글자가 띄어쓰기 없이 붙는다. 바꿔 끼우지 않은 초안은 저장본과 조금
  //  달라도 「방금 저장한 그 초안」 이라 다시 보내지 않는다(lastSaved).

  const [autoSaving, setAutoSaving] = useState(false);
  /** 마지막으로 저장에 성공한 초안 — 같은 것을 다시 보내지 않는다 */
  const [lastSaved, setLastSaved] = useState<FinProjectInput | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  /** 보낼 수 없는 값 — 이름·코드가 비었다 등. 고치면 저절로 저장된다 */
  const [invalid, setInvalid] = useState<string | null>(null);
  /** 실패한 초안과 연달아 실패한 횟수 — 두 번째부터 알린다 */
  const [failed, setFailed] = useState<{ draft: FinProjectInput; count: number; message: string } | null>(null);
  /** 보내는 중인 저장 — 보고서를 열 때 끝나기를 기다린다 */
  const inflight = useRef<{ snap: FinProjectInput; done: Promise<void> } | null>(null);
  /** 지운 프로젝트는 저장하지 않는다 */
  const removedRef = useRef(false);

  const needsSave = dirty && draft !== lastSaved;

  const saveDraft = useCallback(
    (snap: FinProjectInput): Promise<void> => {
      const checked = sanitizeProject(snap);
      if (!checked.ok) {
        setInvalid(checked.error);
        return Promise.resolve();
      }
      setInvalid(null);
      setAutoSaving(true);
      const done = (async () => {
        try {
          await saveFinProject(snap, id);
          await refresh();
          setLastSaved(snap);
          setSavedAt(Date.now());
          setFailed(null);
          if (sameDraft(checked.value, snap)) {
            // 보낸 뒤 더 고치지 않았으면 저장본을 따라간다 — 다른 사람이 고친 것도 보인다
            setHist((h) => (h.present === snap ? { ...h, present: null } : h));
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : "저장에 실패했습니다.";
          setFailed((f) => ({ draft: snap, count: (f?.count ?? 0) + 1, message }));
        } finally {
          inflight.current = null;
          setAutoSaving(false);
        }
      })();
      inflight.current = { snap, done };
      return done;
    },
    [id, refresh],
  );

  useEffect(() => {
    if (!draft || !needsSave || autoSaving || removedRef.current) return;
    // 처음 실패는 조용히 한 번 더 해 본다. 또 실패하면 「다시 시도」 를 기다린다
    const retry = failed?.draft === draft;
    if (retry && failed.count >= 2) return;
    const t = window.setTimeout(() => void saveDraft(draft), retry ? AUTOSAVE_RETRY_MS : AUTOSAVE_MS);
    return () => window.clearTimeout(t);
  }, [draft, needsSave, autoSaving, failed, saveDraft]);

  // 떠날 때 남은 변경을 보낸다 — 화면 안에서 다른 메뉴로 옮겨 가는 경우.
  // 창을 닫는 것은 기다려 줄 수 없으니 아래 경고로 막는다.
  const leaveRef = useRef({ draft: null as FinProjectInput | null, refresh, toast });
  useEffect(() => {
    leaveRef.current = { draft: needsSave ? draft : null, refresh, toast };
  });
  useEffect(
    () => () => {
      const { draft: left, refresh: reload, toast: say } = leaveRef.current;
      if (!left || removedRef.current) return;
      const checked = sanitizeProject(left);
      if (!checked.ok) {
        say.error(`프로젝트 변경을 저장하지 못했습니다 — ${checked.error}`);
        return;
      }
      saveFinProject(left, id)
        .then(() => reload())
        .catch((e) => say.error(e instanceof Error ? e.message : "프로젝트 변경을 저장하지 못했습니다."));
    },
    [id],
  );

  // 창을 닫기 전 경고 — 아직 안 간 변경이 있을 때만
  useEffect(() => {
    if (!needsSave && !autoSaving) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [needsSave, autoSaving]);

  const summary = useMemo(
    () => (form ? projectSummary(form, transactions) : null),
    [form, transactions],
  );
  const groups = useMemo(() => (form ? groupLines(form.lines) : []), [form]);
  // 지출 시트에는 인건비 줄을 뺀 나머지만 — 인건비 줄은 아래 「인건비」 칸에서 고친다
  const sheetLines = useMemo(() => (form ? form.lines.filter((l) => !isLaborLine(l)) : []), [form]);
  const laborLines = useMemo(() => (form ? form.lines.filter(isLaborLine) : []), [form]);
  const ledgerRows = useMemo(
    () => (form ? ledgerRowsOf(transactions, form.code) : []),
    [transactions, form],
  );
  // 사내 인력 하루 단가 추천 — 원장 최근 3개월 급여 (project-report.ts)
  const rateHints = useMemo(
    () => suggestDayRates(transactions, todayStrKST().slice(0, 7)),
    [transactions],
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

  // 저장하면 초안이 저장본으로 돌아가(present = null) 스택만 남는다 — 그때는 저장본이 지금 모습이다
  const undo = useCallback(
    () =>
      setHist((h) => {
        if (h.past.length === 0) return h;
        const cur = h.present ?? (saved ? toInput(saved) : null);
        return {
          past: h.past.slice(0, -1),
          present: h.past[h.past.length - 1],
          future: cur ? [cur, ...h.future].slice(0, DRAFT_HISTORY_LIMIT) : h.future,
        };
      }),
    [saved],
  );
  const redo = useCallback(
    () =>
      setHist((h) => {
        if (h.future.length === 0) return h;
        const cur = h.present ?? (saved ? toInput(saved) : null);
        return {
          past: cur ? [...h.past, cur].slice(-DRAFT_HISTORY_LIMIT) : h.past,
          present: h.future[0],
          future: h.future.slice(1),
        };
      }),
    [saved],
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

  // ---- 사내 인력 · 남은 일 ----
  const updateLabor = (lid: string, patch: Partial<FinProjectLabor>) =>
    edit((f) => ({ ...f, labor: (f.labor ?? []).map((l) => (l.id === lid ? { ...l, ...patch } : l)) }));
  /** 이름이 원장 급여 거래처와 같고 단가가 비어 있으면 추천 단가를 채운다 */
  const renameLabor = (l: FinProjectLabor, name: string) => {
    const hint = rateHints.find((h) => h.name === name.trim());
    updateLabor(l.id, { name, ...(hint && !l.dayRate ? { dayRate: hint.dayRate } : {}) });
  };
  const removeLabor = (lid: string) => edit((f) => ({ ...f, labor: (f.labor ?? []).filter((l) => l.id !== lid) }));
  const updateTodo = (tid: string, patch: Partial<FinProjectTodo>) =>
    edit((f) => ({ ...f, todos: (f.todos ?? []).map((t) => (t.id === tid ? { ...t, ...patch } : t)) }));
  const removeTodo = (tid: string) => edit((f) => ({ ...f, todos: (f.todos ?? []).filter((t) => t.id !== tid) }));

  /**
   * 시트는 줄 배열을 통째로 돌려준다 (행 추가·삭제·붙여넣기가 모두 여기로
   * 온다). 넘어온 줄을 그대로 초안에 싣되, 빈 값이 된 선택 항목의 키는
   * 없애 저장 문서와의 비교가 어긋나지 않게 한다.
   *
   * 시트에는 인건비 줄이 없다 — 돌려받은 줄 뒤에 인건비 줄을 다시 붙인다.
   * 시트에서 분류를 「인건비」 로 바꾼(붙여넣은) 줄은 인건비 칸으로 넘어간다.
   */
  const setLines = useCallback(
    (next: FinProjectLine[]) => {
      edit((f) => ({ ...f, lines: [...next, ...f.lines.filter(isLaborLine)].map(tidyLine) }));
      const moved = next.filter(isLaborLine).length;
      if (moved > 0) toast.success(`인건비 ${moved}줄을 아래 「인건비」 칸으로 옮겼습니다.`);
    },
    [edit, toast],
  );
  const updateLine = (lid: string, patch: Partial<FinProjectLine>) =>
    edit((f) => ({ ...f, lines: f.lines.map((l) => (l.id === lid ? tidyLine({ ...l, ...patch }) : l)) }));
  const removeLine = (lid: string) => edit((f) => ({ ...f, lines: f.lines.filter((l) => l.id !== lid) }));

  const updateInstallment = (iid: string, patch: Partial<FinProjectInstallment>) =>
    edit((f) => ({
      ...f,
      installments: (f.installments ?? []).map((i) => (i.id === iid ? { ...i, ...patch } : i)),
    }));
  /** 받는 사업체를 고르면 프로젝트 사업체에도 넣는다 — 서버(sanitizeProject)가 저장할 때와 같은 모양 */
  const setInstallmentEntity = (iid: string, entity: ProjectEntity | undefined) =>
    edit((f) => {
      const picked = new Set(f.entities ?? []);
      if (entity) picked.add(entity);
      const entities = PROJECT_ENTITIES.filter((e) => picked.has(e));
      return {
        ...f,
        entities: entities.length > 0 ? entities : undefined,
        installments: (f.installments ?? []).map((i) => (i.id === iid ? { ...i, entity } : i)),
      };
    });
  const removeInstallment = (iid: string) =>
    edit((f) => ({ ...f, installments: (f.installments ?? []).filter((i) => i.id !== iid) }));
  /**
   * 원장의 입금 거래를 회차에 잇는다 — 그 거래 날짜가 회차의 입금일이 된다.
   * 「받음 · 날짜 미확인」 이던 회차도, 대략(「7월 초」)으로 적어 둔 회차도 같다.
   */
  const linkPaid = (t: FinTransaction, iid: string) => {
    const target = (form?.installments ?? []).find((i) => i.id === iid);
    if (!target) return;
    updateInstallment(iid, { paidDate: t.date, paidApprox: undefined });
    toast.success(`${target.kind} 입금일을 ${t.date} 로 적었습니다.`);
  };
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
        `${file.name} 에서 ${parsed.lines.length}줄을 불러왔습니다${parsed.skipped ? ` (품목 없는 ${parsed.skipped}줄 건너뜀)` : ""}.`,
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

  /**
   * 보고서는 저장된 값으로 그린다 — 아직 안 간 변경이 있으면 먼저 보낸다.
   * 창은 미리 열어 둔다. 저장을 기다린 뒤에 열면 팝업 차단에 걸린다.
   */
  const openReport = async () => {
    const url = `/neander/finance/projects/${id}/report`;
    if (!needsSave && !autoSaving) {
      window.open(url, "_blank", "noopener");
      return;
    }
    const win = window.open("about:blank", "_blank");
    const running = inflight.current;
    if (running) await running.done;
    if (needsSave && draft && draft !== running?.snap) await saveDraft(draft);
    if (win) {
      win.opener = null;
      win.location.href = url;
    } else {
      window.open(url, "_blank", "noopener");
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
    setRemoving(true);
    removedRef.current = true;
    try {
      await deleteFinProject(id);
      await refresh();
      router.push("/neander/finance/projects");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "삭제에 실패했습니다.");
      removedRef.current = false;
      setRemoving(false);
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
  // 지출 시트와 인건비 칸 각자의 합계 — 둘을 더하면 개요의 견적 · 실제 원가다
  const sheetEstimate = sheetLines.reduce((s, l) => s + lineEstimate(l), 0);
  const sheetActual = sheetLines.reduce((s, l) => s + lineActual(l), 0);
  const sheetUnfilled = sheetLines.filter((l) => !hasActual(l)).length;
  const laborPaid = laborLines.reduce((s, l) => s + lineActual(l), 0);
  const staffCost = laborTotal(form.labor);
  /**
   * 시트 높이 — 줄 수에 맞춰 늘리되 화면을 다 먹지 않게 640px 에서 멈춘다.
   * 줄이 적을 때 빈 격자가 길게 남으면 표가 비어 보인다.
   */
  const sheetHeight = Math.min(
    640,
    Math.max(240, (sheetLines.length + 1) * sheetLayout.layout.rowHeight + 44),
  );
  const ledgerNet = summary.ledger.expense - summary.ledger.refund;
  const gap = summary.actual - ledgerNet;
  const isLoss = summary.profitActual < 0;
  const period =
    form.startDate || form.endDate
      ? `${form.startDate ?? "?"}${form.endDate && form.endDate !== form.startDate ? ` ~ ${form.endDate}` : ""}`
      : null;

  /** 사업체 — 고른 값이 없으면 원장 입금의 사업장으로 추정해 흐리게 보인다 */
  const entityView = projectEntities(form, transactions);
  const toggleEntity = (e: ProjectEntity) => {
    const cur = new Set(form.entities ?? []);
    if (cur.has(e)) cur.delete(e);
    else cur.add(e);
    const next = PROJECT_ENTITIES.filter((x) => cur.has(x));
    setField("entities", next.length > 0 ? next : undefined);
  };

  /**
   * 자주 안 쓰는 동작은 「⋯ 더보기」로 접는다 — 제목 줄에 버튼이 다섯이면
   * 어느 것이 주요 동작인지 안 보인다. 남기는 것은 「보고서」다.
   * 저장은 저절로 되고, 되돌리기는 ⌘Z 다.
   */
  const moreItems: MenuItem[] = [
    {
      key: "import",
      label: "엑셀에서 줄 가져오기",
      icon: Upload,
      hint: "분류·제품명·수량·단가",
      disabled: removing,
      onSelect: () => fileRef.current?.click(),
    },
    {
      key: "export",
      label: "엑셀 내려받기",
      icon: Download,
      disabled: removing,
      onSelect: () => exportProjectXlsx({ ...saved, ...form }, transactions),
    },
    { type: "separator", key: "sep-danger" },
    { key: "delete", label: "삭제", icon: Trash2, danger: true, disabled: removing, onSelect: () => void remove() },
  ];

  // 순서는 일이 흘러가는 순서 — 견적·계약을 맺고, 돈을 받고, 준비물을
  // 사고, 마지막에 원장과 맞춘다
  const tabs = [
    { key: "overview", label: "개요" },
    { key: "docs", label: "견적 · 계약" },
    {
      key: "revenue",
      label: "수입 · 입금",
      // 금액이 아니라 건수를 붙인다 — 탭 이름 옆에 돈이 또 찍히면 개요의
      // 지표와 어느 쪽이 맞는지 견주게 된다
      hint: summary.installmentCount > 0 ? `${summary.installmentCount}회차` : undefined,
    },
    { key: "expense", label: "지출 · 인건비", hint: summary.lineCount > 0 ? `${summary.lineCount}줄` : undefined },
    { key: "ledger", label: "원장대조", hint: ledgerRows.length > 0 ? `${ledgerRows.length}건` : undefined },
  ];

  return (
    <PageShell width="wide">
      {/* ---- 머리 ----
          제목은 프로젝트 이름이고 그 자리에서 바로 고친다. "지금 어느
          화면인가"는 상단 경로(재무 / 프로젝트 / 이름)가 알려 준다. */}
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
        title={
          <span className="flex min-w-0 items-center gap-1">
            {/* 입력칸은 글자 길이에 맞춰 줄지 않는다 — 보이지 않는 사본이 폭을
                정하고 입력칸이 그 칸을 채운다. 그래야 상태 배지가 이름 바로
                옆에 붙는다. 연필은 "누르면 고쳐진다"는 표시일 뿐이다. */}
            <span className="-ml-1.5 inline-grid min-w-0 grid-cols-[minmax(0,max-content)]">
              <span aria-hidden className="invisible col-start-1 row-start-1 truncate whitespace-pre border border-transparent px-1.5">
                {form.name || "프로젝트 이름"}
              </span>
              {/* size={1} — 입력칸의 기본 폭(약 20자)이 칸을 넓히지 않게 */}
              <input
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                size={1}
                className="col-start-1 row-start-1 w-full min-w-0 text-ellipsis rounded-nd-md border border-transparent bg-transparent px-1.5 text-nd-fg outline-none transition-colors duration-nd-fast placeholder:text-nd-fg-4 hover:border-nd-border focus:border-nd-accent focus:bg-nd-content"
                aria-label="프로젝트 이름"
                placeholder="프로젝트 이름"
              />
            </span>
            <Icon icon={Pencil} size={16} className="shrink-0 text-nd-fg-4" />
          </span>
        }
        titleSuffix={
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <Badge tone={PROJECT_STATUS_TONE[form.status]} dot>
              {PROJECT_STATUS_LABEL[form.status]}
            </Badge>
            <span className="font-mono text-nd-caption text-nd-fg-2">{form.code || "코드 없음"}</span>
            {entityView.entities.length > 0 && (
              <span
                className={cn("text-nd-caption", entityView.source === "set" ? "font-medium text-nd-fg-2" : "text-nd-fg-3")}
                title={entityView.source === "set" ? "매출을 낸 사업체" : "고르지 않아 원장 입금의 사업장으로 추정했습니다"}
              >
                · {entityView.entities.map((e) => ENTITY_SHORT[e]).join(" · ")}
              </span>
            )}
            {form.client && <span className="text-nd-caption text-nd-fg-3">· {form.client}</span>}
            {period && <span className="nd-num text-nd-caption text-nd-fg-3">· 진행 {period}</span>}
            {form.deliveryDate && (
              <span className="nd-num text-nd-caption text-nd-fg-3">
                · 납기 <DeliveryDate project={form} />
              </span>
            )}
          </span>
        }
        meta={
          // 자동 저장의 상태. 색만으로 알리지 않는다 — 아이콘과 글자를 함께 둔다.
          // role="status" 라 낭독기도 읽는다.
          <span role="status" className="flex items-center gap-2">
            {failed && failed.count >= 2 && failed.draft === draft ? (
              <>
                <Badge tone="danger">
                  <Icon icon={CircleAlert} size={14} />
                  저장하지 못했습니다
                </Badge>
                <span className="max-w-[260px] truncate text-nd-table text-nd-fg-3" title={failed.message}>
                  {failed.message}
                </span>
                <Button size="sm" variant="secondary" icon={RotateCw} onClick={() => void saveDraft(failed.draft)}>
                  다시 시도
                </Button>
              </>
            ) : invalid && needsSave ? (
              <>
                <Badge tone="warning">
                  <Icon icon={CircleAlert} size={14} />
                  저장 안 됨
                </Badge>
                <span className="text-nd-table text-nd-fg-2">{invalid}</span>
              </>
            ) : autoSaving || needsSave ? (
              <span className="text-nd-table text-nd-fg-3">저장 중…</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-nd-table text-nd-fg-3">
                <Icon icon={Check} size={14} />
                {savedAt ? `저장됨 · ${formatChatTime(savedAt)}` : "자동 저장"}
              </span>
            )}
          </span>
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
            {/* 저장된 값으로 그린다 — 아직 안 간 변경은 먼저 보낸다 */}
            <Button variant="secondary" icon={FileText} onClick={() => void openReport()}>
              보고서
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
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
              {/* 원장 거래가 이 글자로 이어져 있어 고치지 않는다 (finance/codes.ts) */}
              <Field label="코드" hint="원장 프로젝트코드">
                <AutoCodeBox code={form.code} size="sm" tag="고정" />
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
              <Field label="진행 시작일">
                <Input size="sm" type="date" value={form.startDate ?? ""} onChange={(e) => setField("startDate", e.target.value || undefined)} />
              </Field>
              <Field label="진행 종료일">
                <Input size="sm" type="date" value={form.endDate ?? ""} onChange={(e) => setField("endDate", e.target.value || undefined)} />
              </Field>
              {/* 진행 기간과 따로 — 넉 달짜리 건도 결과물을 넘기는 날은 하루다 */}
              <Field label="납기">
                <Input size="sm" type="date" value={form.deliveryDate ?? ""} onChange={(e) => setField("deliveryDate", e.target.value || undefined)} />
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
            {/* 사업체 — 계약서·세금계산서를 낸 쪽. 나눠 끊은 건은 둘 이상 고른다 */}
            <Field
              label="사업체"
              className="mt-3"
              hint={
                entityView.source === "ledger"
                  ? `고르지 않음 — 원장 입금 기준으로는 ${entityView.entities.join(" · ")}`
                  : entityView.source === "none"
                    ? "고르지 않음 — 원장에도 입금이 없어 알 수 없습니다"
                    : "매출을 낸 사업체 (계약·세금계산서 주체)"
              }
            >
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="사업체">
                {PROJECT_ENTITIES.map((e) => {
                  const on = (form.entities ?? []).includes(e);
                  return (
                    <button
                      key={e}
                      type="button"
                      onClick={() => toggleEntity(e)}
                      aria-pressed={on}
                      className={cn(
                        "h-ctl-sm rounded-full border px-3 text-nd-caption font-medium transition-colors duration-nd-fast",
                        on
                          ? "border-nd-accent bg-nd-accent-soft text-nd-accent-strong"
                          : "border-nd-line text-nd-fg-2 hover:bg-nd-fg/[.06]",
                      )}
                    >
                      {e}
                    </button>
                  );
                })}
              </div>
            </Field>
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

          {/* ---- 남은 일 · 다음엔 ---- */}
          <Card padding="sm" className="mb-5">
            <SectionHeader title="남은 일 · 다음엔" hint="보고서 첫 장에 나옵니다 — 중간 보고는 남은 일이, 결산은 다음엔이 앞에" />
            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <h3 className="mb-1.5 text-nd-caption font-medium text-nd-fg-2">남은 일</h3>
                <ul className="mb-2 flex flex-col gap-1.5">
                  {(form.todos ?? []).map((t) => (
                    <li key={t.id} className="flex items-center gap-2">
                      <Checkbox checked={!!t.done} onChange={(e) => updateTodo(t.id, { done: e.target.checked || undefined })} aria-label={`${t.text} 끝냄`} />
                      <Input
                        size="sm"
                        value={t.text}
                        onChange={(e) => updateTodo(t.id, { text: e.target.value })}
                        className={cn(t.done && "text-nd-fg-3 line-through")}
                        aria-label="남은 일"
                      />
                      <IconButton icon={X} label="지우기" size="sm" onClick={() => removeTodo(t.id)} className="text-nd-fg-3 hover:text-nd-danger-text" />
                    </li>
                  ))}
                </ul>
                <TodoAdder onAdd={(text) => edit((f) => ({ ...f, todos: [...(f.todos ?? []), newTodo(text)] }))} />
              </div>
              <div>
                <h3 className="mb-1.5 text-nd-caption font-medium text-nd-fg-2">다음엔</h3>
                <Textarea
                  size="sm"
                  rows={4}
                  value={form.lessons ?? ""}
                  onChange={(e) => setField("lessons", e.target.value || undefined)}
                  placeholder="견적에서 빠뜨린 것 · 다음 견적에 넣을 것 · 발주처와 미리 맞출 것 …"
                />
              </div>
            </div>
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

      {/* ================= 지출 · 인건비 ================= */}
      {tab === "expense" && (
        <div className="flex flex-col gap-5">
          <Card padding="none" className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-nd-line px-5 py-3">
              <h2 className="text-nd-section text-nd-fg">
                지출 · 준비물
                <span className="ml-2 text-nd-caption font-normal text-nd-fg-3">
                  {sheetLines.length}줄 · 준비 {sheetLines.filter((l) => l.done).length}/{sheetLines.length} · 물품·인쇄물·식대·운송 — 인건비는 아래 「인건비」 칸에
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
              lines={sheetLines}
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
                견적 합계 <b className="ml-1 text-nd-body"><Money value={sheetEstimate} unit={false} flow="expense" /></b>
              </span>
              <span className="text-nd-fg-2">
                실제 합계 <b className="ml-1 text-nd-body"><Money value={sheetActual} unit={false} flow="expense" /></b>
                {sheetUnfilled > 0 && <span className="ml-1 text-nd-fg-3">(미입력 {sheetUnfilled}줄은 견적으로)</span>}
              </span>
            </div>
          </Card>

          {/* ---- 인건비 ----
              외부 인력은 돈이 실제로 나가 원가에 들어간다 — 분류 「인건비」 줄이라
              시트 줄과 같은 배열(lines)에 저장되고, 여기서는 그 줄만 따로 고친다.
              사내 인력은 급여를 하루로 나눈 추정이라 원가 밖에서 「인력 반영
              이익」 으로만 본다. */}
          <Card padding="sm">
            <SectionHeader title="인건비" hint="같은 사람을 외부 · 사내 두 곳에 적으면 두 번 빠집니다" />

            <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <h3 className="text-nd-body font-semibold text-nd-fg">
                외부 인력
                <span className="ml-2 text-nd-table font-normal text-nd-fg-3">일용직 · 3.3% 프리랜서 · 외주 — 실제로 나간 돈이라 원가에 들어갑니다</span>
              </h3>
              <Button
                variant="ghost"
                size="sm"
                icon={Plus}
                onClick={() => edit((f) => ({ ...f, lines: [...f.lines, { ...newLine(LABOR_CATEGORY), unit: "인일" }] }))}
              >
                사람 추가
              </Button>
            </div>
            {laborLines.length === 0 ? (
              <p className="text-nd-table text-nd-fg-3">아직 없습니다.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {laborLines.map((l) => (
                  <FormRow key={l.id} className={cn(MOBILE_ROW_RULE, "grid-cols-2 sm:grid-cols-[minmax(8rem,1.2fr)_minmax(6rem,1fr)_5rem_8rem_9rem_minmax(8rem,1.2fr)_auto]")}>
                    <Field label="이름 · 내용">
                      <Input size="sm" value={l.item} onChange={(e) => updateLine(l.id, { item: e.target.value })} placeholder="진행요원 2명" />
                    </Field>
                    <Field label="지급처">
                      <Input size="sm" value={l.vendor ?? ""} onChange={(e) => updateLine(l.id, { vendor: e.target.value || undefined })} placeholder="받는 사람 · 업체" />
                    </Field>
                    <Field label="수량" hint={l.unit}>
                      <NumberInput size="sm" decimal value={l.qty || ""} onValueChange={(v) => updateLine(l.id, { qty: Number(v) || 0 })} className="text-right" />
                    </Field>
                    <Field label="단가">
                      <NumberInput
                        size="sm"
                        value={l.unitPrice ?? ""}
                        placeholder="0"
                        onValueChange={(v) => updateLine(l.id, { unitPrice: v === "" ? undefined : Number(v) })}
                        className="text-right"
                      />
                    </Field>
                    <Field label="실제 지급" hint={hasActual(l) ? undefined : "비우면 견적으로"}>
                      <NumberInput
                        size="sm"
                        value={l.actual ?? ""}
                        placeholder={lineEstimate(l).toLocaleString("ko-KR")}
                        onValueChange={(v) => updateLine(l.id, { actual: v === "" ? undefined : Number(v) })}
                        className="text-right"
                      />
                    </Field>
                    <Field label="메모">
                      <Input size="sm" value={l.note ?? ""} onChange={(e) => updateLine(l.id, { note: e.target.value || undefined })} placeholder="설치 · 운영 · 철수" />
                    </Field>
                    <FieldAction>
                      <IconButton icon={X} label={`${l.item || "이 줄"} 빼기`} size="sm" onClick={() => removeLine(l.id)} className="text-nd-fg-3 hover:text-nd-danger-text" />
                    </FieldAction>
                  </FormRow>
                ))}
              </div>
            )}

            <div className="mb-2 mt-5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-nd-line pt-4">
              <h3 className="text-nd-body font-semibold text-nd-fg">
                사내 인력
                <span className="ml-2 text-nd-table font-normal text-nd-fg-3">
                  정직원 · 대표가 쓴 날 × 하루 단가 — 추정이라 원가에 더하지 않고, 보고서에 「인력 반영 이익」 으로 따로 나옵니다
                </span>
              </h3>
              <Button variant="ghost" size="sm" icon={Plus} onClick={() => edit((f) => ({ ...f, labor: [...(f.labor ?? []), newLabor()] }))}>
                사람 추가
              </Button>
            </div>
            {(form.labor ?? []).length === 0 ? (
              <p className="text-nd-table text-nd-fg-3">아직 없습니다.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {(form.labor ?? []).map((l) => {
                  const hint = rateHints.find((h) => h.name === l.name.trim());
                  return (
                    <FormRow key={l.id} className={cn(MOBILE_ROW_RULE, "grid-cols-2 sm:grid-cols-[minmax(8rem,1fr)_6rem_9rem_8rem_minmax(8rem,1.2fr)_auto]")}>
                      <Field label="이름">
                        <Input size="sm" list="labor-names" value={l.name} onChange={(e) => renameLabor(l, e.target.value)} placeholder="이동주" />
                      </Field>
                      <Field label="일수" hint="반나절 0.5">
                        <NumberInput size="sm" decimal value={l.days || ""} onValueChange={(v) => updateLabor(l.id, { days: Number(v) || 0 })} className="text-right" />
                      </Field>
                      <Field
                        label="하루 단가"
                        hint={
                          hint
                            ? `원장 급여 기준 ${hint.dayRate.toLocaleString("ko-KR")}`
                            : rateHints.length > 0
                              ? "원장 급여에 없는 이름"
                              : undefined
                        }
                      >
                        <NumberInput size="sm" value={l.dayRate || ""} placeholder="0" onValueChange={(v) => updateLabor(l.id, { dayRate: Number(v) || 0 })} className="text-right" />
                      </Field>
                      <FieldAction center>
                        <span className="nd-num text-nd-body font-medium text-nd-fg">{laborCost(l).toLocaleString("ko-KR")}원</span>
                      </FieldAction>
                      <Field label="메모">
                        <Input size="sm" value={l.note ?? ""} onChange={(e) => updateLabor(l.id, { note: e.target.value || undefined })} placeholder="설치 · 운영 · 철수" />
                      </Field>
                      <FieldAction>
                        <IconButton icon={X} label={`${l.name || "이 사람"} 빼기`} size="sm" onClick={() => removeLabor(l.id)} className="text-nd-fg-3 hover:text-nd-danger-text" />
                      </FieldAction>
                    </FormRow>
                  );
                })}
              </div>
            )}
            <datalist id="labor-names">
              {rateHints.map((h) => (
                <option key={h.name} value={h.name}>{`하루 ${h.dayRate.toLocaleString("ko-KR")}원 · 월 ${h.monthly.toLocaleString("ko-KR")}원`}</option>
              ))}
            </datalist>
            {rateHints.length > 0 && (
              <TableNote className="mt-2">
                하루 단가 추천 = 원장 최근 3개월 급여 월평균 × 1.1(4대보험 회사 부담) ÷ 21일. 적어 둔 단가는 이 프로젝트에 그때 값으로 남습니다.
              </TableNote>
            )}

            {(laborLines.length > 0 || (form.labor ?? []).length > 0) && (
              <div className="mt-4 flex flex-wrap items-center justify-end gap-6 border-t border-nd-line pt-3 text-nd-table">
                {laborLines.length > 0 && (
                  <span className="text-nd-fg-2">
                    외부 인력 <b className="ml-1 text-nd-body"><Money value={laborPaid} unit={false} flow="expense" /></b>
                  </span>
                )}
                {(form.labor ?? []).length > 0 && (
                  <>
                    <span className="text-nd-fg-2">
                      사내 인력 {(form.labor ?? []).reduce((a, l) => a + (Number(l.days) || 0), 0).toLocaleString("ko-KR")}일{" "}
                      <b className="ml-1 text-nd-body"><Money value={staffCost} unit={false} flow="expense" /></b>
                    </span>
                    <span className="text-nd-fg-2">
                      인력 반영 이익 <b className="ml-1 text-nd-body"><Money value={summary.profitActual - staffCost} unit={false} flow="net" /></b>
                      {summary.revenue > 0 && (
                        <span className="ml-1 text-nd-fg-3">({(((summary.profitActual - staffCost) / summary.revenue) * 100).toFixed(1)}%)</span>
                      )}
                    </span>
                  </>
                )}
              </div>
            )}
          </Card>
        </div>
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
                    <NumberInput
                      value={form.contractAmount || ""}
                      placeholder="0"
                      onValueChange={(v) => setField("contractAmount", Number(v) || 0)}
                      className="text-right font-semibold"
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
                <Table minWidth={1170} dense>
                  <thead>
                    <tr>
                      <Th sticky="top" className="w-28 pl-5">구분</Th>
                      <Th sticky="top" className="w-28" title="이 회차의 세금계산서를 끊고 돈이 들어오는 사업체 — 비우면 프로젝트 사업체">받는 곳</Th>
                      <Th sticky="top" align="right" className="w-32">금액</Th>
                      <Th sticky="top" align="right" className="w-28">청구액</Th>
                      <Th sticky="top" className="w-64">받기로 한 날</Th>
                      <Th sticky="top" className="w-64">입금일</Th>
                      <Th sticky="top" className="w-40" title="눌러서 예정 ↔ 받음">상태</Th>
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
                            <Select
                              size="sm"
                              value={i.entity ?? ""}
                              onChange={(e) => setInstallmentEntity(i.id, (e.target.value || undefined) as ProjectEntity | undefined)}
                              aria-label="받는 곳"
                            >
                              <option value="">—</option>
                              {PROJECT_ENTITIES.map((e) => (
                                <option key={e} value={e}>{ENTITY_SHORT[e]}</option>
                              ))}
                            </Select>
                          </Td>
                          <Td>
                            <NumberInput
                              size="sm"
                              value={i.amount || ""}
                              placeholder="0"
                              onValueChange={(v) => updateInstallment(i.id, { amount: Number(v) || 0 })}
                              className="text-right"
                              aria-label="금액"
                            />
                          </Td>
                          <Td num muted title="부가세를 더한 실제 청구액">
                            {billed.toLocaleString("ko-KR")}
                          </Td>
                          <Td>
                            {/* 정확한 날 또는 「10월 말」 같은 대략 — 옆 단추로 오간다 */}
                            <DueInput
                              value={{ dueDate: i.dueDate, dueApprox: i.dueApprox }}
                              onChange={(v) => updateInstallment(i.id, { dueDate: v.dueDate, dueApprox: v.dueApprox })}
                            />
                          </Td>
                          <Td title="날짜를 넣으면 받은 것으로 셉니다 — 모르면 「7월 초」 처럼 대략으로">
                            <DueInput
                              label="입금일"
                              value={{ dueDate: i.paidDate, dueApprox: i.paidApprox }}
                              onChange={(v) => updateInstallment(i.id, { paidDate: v.dueDate, paidApprox: v.dueApprox })}
                            />
                          </Td>
                          <Td>
                            {/* 누르면 예정 ↔ 받음. 받음으로 두는 데 입금일은 없어도 된다 —
                                되돌리면 입금일도 지운다(날짜가 남아 있으면 계속 받음이라) */}
                            <button
                              type="button"
                              onClick={() =>
                                updateInstallment(
                                  i.id,
                                  isInstallmentReceived(i)
                                    ? { received: undefined, paidDate: undefined, paidApprox: undefined }
                                    : { received: true },
                                )
                              }
                              className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-nd-accent"
                              title={
                                st !== "paid"
                                  ? "눌러서 「받음」 으로 — 입금일을 몰라도 됩니다"
                                  : i.paidDate
                                    ? "눌러서 「예정」 으로 되돌립니다 (입금일도 지웁니다)"
                                    : "받았지만 입금일을 모릅니다 — 「원장대조」 탭에서 입금 거래를 이 회차에 이으면 날짜가 채워집니다. 다시 누르면 「예정」"
                              }
                              aria-label={`상태 ${installmentStatusText(i)} — 눌러서 바꾸기`}
                            >
                              <Badge tone={INSTALLMENT_STATUS_TONE[st]} size="sm" dot className="cursor-pointer">
                                {installmentStatusText(i)}
                              </Badge>
                            </button>
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
                            <NumberInput
                              size="sm"
                              negative
                              value={r.amount || ""}
                              placeholder="0"
                              onValueChange={(v) => updateRevenue(r.id, { amount: Number(v) || 0 })}
                              className="text-right"
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
                  <Table minWidth={1580} dense>
                    <thead>
                      <tr>
                        <Th sticky="top" className="pl-5">항목</Th>
                        <Th sticky="top" align="right" className="w-32">돌려주는 돈</Th>
                        <Th sticky="top" className="w-48">세금계산서</Th>
                        <Th sticky="top" align="right" className="w-28">공급가액</Th>
                        <Th sticky="top" align="right" className="w-24">부가세</Th>
                        <Th sticky="top" className="w-28" title="돈이 나가는 사업체 — 받은 사업체와 다를 수 있습니다">돌려주는 곳</Th>
                        <Th sticky="top" className="w-36">방법</Th>
                        <Th sticky="top" className="w-64">돌려줄 날</Th>
                        <Th sticky="top" className="w-64" title="날을 모르면 옆 단추로 「돌려줌」 만 표시">돌려준 날</Th>
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
                              <NumberInput
                                size="sm"
                                value={d.amount || ""}
                                placeholder="0"
                                // 돌려주는 돈은 늘 양수로 둔다 — 부호는 칸이 받지 않는다
                                onValueChange={(v) => updateDeduction(d.id, { amount: Number(v) || 0 })}
                                className="text-right"
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
                              <Select
                                size="sm"
                                value={d.entity ?? ""}
                                onChange={(e) => updateDeduction(d.id, { entity: (e.target.value || undefined) as ProjectEntity | undefined })}
                                aria-label="돌려주는 곳"
                              >
                                <option value="">—</option>
                                {PROJECT_ENTITIES.map((e) => (
                                  <option key={e} value={e}>{ENTITY_SHORT[e]}</option>
                                ))}
                              </Select>
                            </Td>
                            <Td>
                              <Input
                                size="sm"
                                value={d.method ?? ""}
                                onChange={(e) => updateDeduction(d.id, { method: e.target.value || undefined })}
                                placeholder="현금 · 계좌이체"
                                list="deduction-methods"
                                aria-label="방법"
                              />
                            </Td>
                            <Td title="지나도 돌려준 날이 비어 있으면 「돌려줄 돈」 화면에서 「늦음」">
                              <DueInput
                                label="돌려줄 날"
                                value={{ dueDate: d.dueDate, dueApprox: d.dueApprox }}
                                onChange={(v) => updateDeduction(d.id, { dueDate: v.dueDate, dueApprox: v.dueApprox })}
                              />
                            </Td>
                            <Td>
                              <div className="flex items-center gap-1.5">
                                <Input
                                  size="sm"
                                  type="date"
                                  value={d.paidDate ?? ""}
                                  onChange={(e) => updateDeduction(d.id, { paidDate: e.target.value || undefined })}
                                  className={cn(d.paidDate && "border-nd-success/50 bg-nd-success-soft/40")}
                                  title="돌려줬거나 청구액에서 뺀 날. 비워 두면 아직 돌려줄 돈으로 셉니다"
                                  aria-label="돌려준 날"
                                />
                                {/* 날을 몰라도 「돌려줌」 — 입금 회차의 「받음」 과 같다. 되돌리면 날짜도 지운다 */}
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateDeduction(
                                      d.id,
                                      isDeductionReturned(d) ? { returned: undefined, paidDate: undefined } : { returned: true },
                                    )
                                  }
                                  className="shrink-0 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-nd-accent"
                                  title={isDeductionReturned(d) ? "눌러서 「남음」 으로 되돌립니다 (돌려준 날도 지웁니다)" : "눌러서 「돌려줌」 으로 — 날짜를 몰라도 됩니다"}
                                  aria-label={`상태 ${isDeductionReturned(d) ? "돌려줌" : "남음"} — 눌러서 바꾸기`}
                                >
                                  <Badge tone={isDeductionReturned(d) ? "success" : "warning"} size="sm" dot className="cursor-pointer">
                                    {isDeductionReturned(d) ? "돌려줌" : "남음"}
                                  </Badge>
                                </button>
                              </div>
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
                <datalist id="deduction-methods">
                  <option value="현금" />
                  <option value="계좌이체" />
                </datalist>
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
              <Table minWidth={940} dense>
                <thead>
                  <tr>
                    <Th sticky="top" className="pl-5">거래일</Th>
                    <Th sticky="top">유형</Th>
                    <Th sticky="top">거래처</Th>
                    <Th sticky="top">계정</Th>
                    <Th sticky="top" align="right">순금액</Th>
                    <Th sticky="top" className="w-60" title="입금 거래를 회차에 이으면 그 날짜가 회차의 입금일이 됩니다">회차</Th>
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
                      <Td onClick={(e) => e.stopPropagation()} className="cursor-default">
                        <InstallmentLink
                          t={t}
                          installments={form.installments ?? []}
                          vatMode={form.vatMode ?? "excluded"}
                          onLink={(iid) => linkPaid(t, iid)}
                        />
                      </Td>
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
                코드를 <span className="font-mono">{form.code || "(빈 값)"}</span> 로 고쳤습니다. 저장이 끝나면 거래를 붙일 수 있습니다.
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

/** 남은 일 한 줄 더하기 — 입력 중인 글자는 초안이 아니라 여기 따로 쥔다 (엔터로 추가) */
function TodoAdder({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = useState("");
  const add = () => {
    const t = text.trim();
    if (!t) return;
    onAdd(t);
    setText("");
  };
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <Input size="sm" value={text} onChange={(e) => setText(e.target.value)} placeholder="예: 잔금 세금계산서 발행 · 장비 반납" aria-label="남은 일 더하기" />
      <Button type="submit" variant="secondary" size="sm" icon={Plus} disabled={!text.trim()}>
        추가
      </Button>
    </form>
  );
}

/**
 * 원장대조 표의 「회차」 칸 — 입금 거래를 어느 회차의 돈인지 잇는다.
 *
 *   · 입금이 아닌 거래는 비운다.
 *   · 이 날짜가 이미 어느 회차의 입금일이면 그 회차를 보인다.
 *   · 아니면 입금일이 정확하지 않은 회차(비었거나 대략)를 고르게 한다 —
 *     금액이 청구액과 같으면 옆에 적어 고르기 쉽게 한다.
 */
function InstallmentLink({
  t,
  installments,
  vatMode,
  onLink,
}: {
  t: FinTransaction;
  installments: FinProjectInstallment[];
  vatMode: VatMode;
  onLink: (installmentId: string) => void;
}) {
  if (t.txType !== "수입" || netAmount(t) <= 0) return null;
  const linked = installments.filter((i) => i.paidDate === t.date && !i.paidApprox);
  if (linked.length > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-nd-table text-nd-success-text">
        <Icon icon={Check} size={14} />
        {linked.map((i) => i.kind).join(" · ")} 입금
      </span>
    );
  }
  const open = installments.filter((i) => !i.paidDate || i.paidApprox);
  if (open.length === 0) return null;
  const net = Math.round(netAmount(t));
  return (
    <Select
      size="sm"
      value=""
      onChange={(e) => e.target.value && onLink(e.target.value)}
      aria-label={`${t.date} 입금을 회차에 잇기`}
    >
      <option value="">회차에 잇기…</option>
      {open.map((i) => {
        const billed = splitVat(i.amount, vatMode).total;
        const notes = [
          billed === net ? "금액 같음" : "",
          isInstallmentReceived(i) ? (i.paidDate ? "입금일 대략" : "받음 · 날짜 미확인") : "",
        ].filter(Boolean);
        return (
          <option key={i.id} value={i.id}>
            {`${i.kind} ${billed.toLocaleString("ko-KR")}원${notes.length ? ` (${notes.join(" · ")})` : ""}`}
          </option>
        );
      })}
    </Select>
  );
}
