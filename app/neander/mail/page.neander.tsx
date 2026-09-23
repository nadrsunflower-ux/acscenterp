"use client";

// ============================================================
//  메일 — 카페24 웹메일을 ERP 안에서
// ------------------------------------------------------------
//  왼쪽 판(MailNav)은 카페24 웹메일 사이드바와 같은 차례다. 가운데 목록,
//  오른쪽 읽기. 새 메일은 MailProvider 가 20초마다 확인해 목록 앞에 끼워 준다.
//  메일 계정을 여러 개 로그인해 두고 왼쪽 판 맨 위에서 오간다 — 목록은 계정마다
//  따로 기억한다 (키 `계정|메일함|거르기`).
//
//  ERP 메일함은 카페24 웹메일과 읽음·폴더가 맞춰지지 않는다 (IMAP 이 없다).
//  POP3 로 보이지 않는 카페24 메일함(보낸메일함 등)은 백업 zip 으로 가져온다.
//  휴지통·스팸메일함에서 「영구 삭제」한 메일만 카페24 서버에서도 지운다.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArchiveRestore,
  CalendarClock,
  ChevronLeft,
  Download,
  FileText,
  FolderInput,
  Forward,
  ListChecks,
  Inbox,
  Loader2,
  Mail,
  MailOpen,
  Maximize2,
  Menu as MenuIcon,
  Paperclip,
  Pencil,
  RefreshCw,
  Reply,
  ReplyAll,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Star,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  Button,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  InlineNotice,
  LoadingState,
  Menu,
  PageHeader,
  PageShell,
  SearchInput,
  Sheet,
  cn,
  useConfirm,
  useToast,
  type MenuItem,
} from "@/components/neander/ui";
import { useMail } from "@/components/neander/mail/MailProvider";
import { MailBody } from "@/components/neander/mail/MailBody";
import { MailHandoff } from "@/components/neander/mail/MailHandoff";
import { AddAccountDialog, MailConnect, MailSettings, type SettingsTab } from "@/components/neander/mail/MailAccount";
import { MailComposer, type ComposeInit } from "@/components/neander/mail/MailComposer";
import { MailImport } from "@/components/neander/mail/MailImport";
import { FILTER_LABEL, MailNav, type MailSelection } from "@/components/neander/mail/MailNav";
import { MailReceipts } from "@/components/neander/mail/MailReceipts";
import { formatFileSize } from "@/lib/neander/format";
import {
  cancelSchedule,
  deleteDrafts,
  downloadMailAttachment,
  emptyMailBox,
  fetchMailList,
  fetchMailMessage,
  formatAddr,
  importOlderMail,
  markRead,
  markStar,
  moveMail,
  notSpam,
  purgeMail,
  reportSpam,
  restoreMail,
  sendScheduleNow,
  trashMail,
} from "@/lib/neander/mail/client";
import {
  BOX_LABEL,
  SYSTEM_BOXES,
  isMailBox,
  type MailAccountView,
  type MailAddr,
  type MailBox,
  type SystemBox,
  type MailCounts,
  type MailDetail,
  type MailFilter,
  type MailSummary,
} from "@/lib/neander/mail/types";

/** 메일 화면 높이 — 창에 딱 맞춘다. 위아래 여백 12px, 셸의 pb-10 은 -mb-7 로 되돌린다.
 *  제목·알림 줄을 뺀 나머지를 메일 판(flex-1)이 채우고, 세 칸이 각자 스크롤된다 */
const PAGE_H = "-mb-7 flex h-[calc(100dvh-var(--nd-topbar-h)-1.5rem)] min-h-[600px] flex-col";

interface ListState {
  items: MailSummary[];
  hasMore: boolean;
  loaded: boolean;
  loading: boolean;
  error?: string;
}

const EMPTY_LIST: ListState = { items: [], hasMore: false, loaded: false, loading: false };
const INBOX: MailSelection = { view: "inbox", label: BOX_LABEL.inbox };

/** 목록 캐시 키 — 계정 · 메일함 · 거르기. 공유 메일함이면 동료 계정 */
const keyOf = (s: Pick<MailSelection, "view" | "owner" | "filter">, acct?: string) =>
  `${s.owner ?? acct ?? ""}|${s.view}|${s.filter ?? ""}`;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const byDateDesc = (a: MailSummary, b: MailSummary) => b.date - a.date;

/** 목록 날짜 — 오늘은 시각, 올해는 월·일, 그 전은 연도까지 */
/** 확인 오류 알림에 쓰는 서버 이름 — 카페24 가 아닌 계정도 「카페24」로 나오던 것 */
const SERVER_NAME: Record<string, string> = { cafe24: "카페24 메일 서버", naver: "네이버 메일", gmail: "Gmail" };

function listDate(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "numeric", day: "numeric" });
}

const fullDate = (ms: number) => new Date(ms).toLocaleString("ko-KR", { dateStyle: "long", timeStyle: "short" });

function agoLabel(ms: number | undefined, now: number): string {
  if (!ms) return "아직 확인 전";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 15) return "방금 확인";
  if (s < 60) return `${s}초 전 확인`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}분 전 확인` : `${new Date(ms).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" })} 확인`;
}

const sameAddr = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const prefixed = (prefix: "Re" | "Fwd", subject: string) =>
  new RegExp(`^${prefix}:`, "i").test(subject) ? subject : `${prefix}: ${subject}`;

/** owner: 원본이 있는 계정 (내 계정 또는 동료의 공유 메일함). 보내는 계정은 지금 보는 계정 */
function replyInit(mode: "reply" | "replyAll" | "forward", m: MailDetail, account: MailAccountView, owner?: string): ComposeInit {
  const ref = { box: m.box as MailBox, id: m.id, mode, ...(owner ? { owner } : {}) };
  if (mode === "forward") {
    // 원문이 없는 메일(백업에서 가져온 것)은 첨부를 함께 보낼 수 없다 — 모두 뺀 채로 연다
    return {
      acct: account.key,
      subject: prefixed("Fwd", m.subject),
      sigMode: "reply",
      ref,
      forwardFiles: m.onServer ? m.attachments : [],
      forwardSkip: m.onServer ? [] : m.attachments.map((a) => a.index),
    };
  }
  const mine = (a: MailAddr) => sameAddr(a.address, account.address);
  // 내가 보낸 메일에 답장하면 그때 받은 사람들에게 간다
  const primary = mine(m.from) ? m.to : m.replyTo?.length ? m.replyTo : [m.from];
  const to = [...primary];
  const cc: MailAddr[] = [];
  if (mode === "replyAll") {
    for (const a of m.to) if (!mine(a) && !to.some((t) => sameAddr(t.address, a.address))) to.push(a);
    for (const a of m.cc) if (!mine(a) && !to.some((t) => sameAddr(t.address, a.address))) cc.push(a);
  }
  return { acct: account.key, to, cc, subject: prefixed("Re", m.subject), sigMode: "reply", ref };
}

/** 이 메일이 거르기 조건에 맞는가 (새로 들어온 메일을 목록에 끼울 때) */
function fits(m: MailSummary, f?: MailFilter) {
  if (!f) return true;
  if (f === "unread") return !m.read;
  if (f === "read") return m.read;
  if (f === "starred") return m.starred;
  return m.attachments.length > 0;
}

type BulkKind = "read" | "unread" | "star" | "unstar" | "move" | "trash" | "spam" | "notSpam" | "restore" | "purge" | "deleteDraft";

// ---- 목록 한 줄 ----------------------------------------------

function MailRow({
  m,
  active,
  checked,
  readonly,
  onOpen,
  onExpand,
  onCheck,
  onStar,
}: {
  m: MailSummary;
  active: boolean;
  checked: boolean;
  readonly: boolean;
  onOpen: () => void;
  /** 두 번 누르면 크게 보기 */
  onExpand?: () => void;
  onCheck: (v: boolean) => void;
  onStar: () => void;
}) {
  const showTo = ["sent", "self", "drafts", "scheduled"].includes(m.box) || m.origin === "sent";
  const who = showTo
    ? m.to.map((a) => a.name || a.address).join(", ") || "(받는 사람 없음)"
    : m.from.name || m.from.address;
  const unread = !m.read && (m.box === "inbox" || m.box === "spam" || m.box.startsWith("f_"));
  const pickable = !readonly && m.box !== "scheduled";
  return (
    // relative — 안의 sr-only(절대 위치)가 목록 스크롤 밖으로 빠져 페이지를 늘리지 않게
    <div
      className={cn(
        "relative flex items-stretch border-b border-nd-line transition-colors duration-nd-fast last:border-b-0",
        active ? "bg-nd-accent-soft" : checked ? "bg-nd-accent-soft/50" : "hover:bg-nd-sunken",
      )}
    >
      {pickable && (
        <div className="flex shrink-0 flex-col items-center gap-2 py-3 pl-3">
          <Checkbox checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label={`${m.subject} 고르기`} />
          {m.box !== "drafts" && (
            <button
              type="button"
              onClick={onStar}
              aria-label={m.starred ? "중요 표시 빼기" : "중요 표시"}
              aria-pressed={m.starred}
              className={cn("rounded p-0.5", m.starred ? "text-amber-500" : "text-nd-fg-4 hover:text-nd-fg-3")}
            >
              <Star size={14} fill={m.starred ? "currentColor" : "none"} />
            </button>
          )}
        </div>
      )}
      <button
        type="button"
        // 두 번 누를 때 두 번째 클릭은 버린다 — 같은 메일을 두 번 받지 않게
        onClick={(e) => e.detail < 2 && onOpen()}
        onDoubleClick={onExpand}
        aria-current={active || undefined}
        className="flex min-w-0 flex-1 gap-2 px-3 py-3 text-left"
      >
        <span className="mt-1.5 w-2 shrink-0" aria-hidden>
          {unread && <span className="block h-2 w-2 rounded-full bg-nd-accent" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={cn("truncate text-nd-body", unread ? "font-semibold text-nd-fg" : "text-nd-fg-2")}>{who}</span>
            <span className={cn("shrink-0 text-nd-caption", m.schedule?.status === "failed" ? "text-nd-danger-text" : "text-nd-fg-3")}>
              {m.schedule?.status === "failed" ? "발송 실패" : listDate(m.date)}
            </span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            <span className={cn("truncate text-nd-body", unread ? "font-semibold text-nd-fg" : "text-nd-fg")}>{m.subject}</span>
            {m.attachments.length > 0 && <Icon icon={Paperclip} size={13} className="shrink-0 text-nd-fg-3" />}
            {m.source && <span className="shrink-0 rounded bg-nd-sunken px-1 text-nd-micro text-nd-fg-3">{m.source}</span>}
            {typeof m.opens === "number" && (
              <span className={cn("shrink-0 text-nd-micro", m.opens ? "text-nd-success" : "text-nd-fg-4")}>{m.opens ? "열람" : "미열람"}</span>
            )}
          </span>
          {m.snippet && <span className="mt-0.5 block truncate text-nd-caption text-nd-fg-3">{m.snippet}</span>}
        </span>
        {unread && <span className="sr-only">읽지 않음</span>}
      </button>
    </div>
  );
}

// ---- 읽기 판 ------------------------------------------------

function AddrLine({ label, list }: { label: string; list?: MailAddr[] }) {
  if (!list?.length) return null;
  return (
    <div className="flex gap-2 text-nd-caption">
      <span className="w-14 shrink-0 text-nd-fg-3">{label}</span>
      <span className="min-w-0 break-words text-nd-fg-2">{list.map(formatAddr).join(", ")}</span>
    </div>
  );
}

interface ReaderActions {
  onReply: (mode: "reply" | "replyAll" | "forward") => void;
  /** 이 메일을 업무요청·일일업무·회의 안건으로 (MailHandoff) */
  onHandoff: () => void;
  onAct: (kind: BulkKind, to?: MailBox) => void;
  onFull: () => void;
  onSchedule: (kind: "now" | "cancel" | "edit") => void;
  moveItems: (fn: (to: MailBox) => void) => MenuItem[];
}

function Reader({
  message,
  owner,
  loadingFull,
  actions,
  onExpand,
  onClose,
}: {
  message: MailDetail;
  owner?: string;
  loadingFull: boolean;
  actions: ReaderActions;
  /** 읽기 판에서 — 큰 창으로 */
  onExpand?: () => void;
  /** 큰 창에서 — 닫기. 있으면 본문이 처음 포커스를 받아 화살표·스페이스로 바로 스크롤된다 */
  onClose?: () => void;
}) {
  const toast = useToast();
  const [downloading, setDownloading] = useState<number | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const moveRef = useRef<HTMLButtonElement>(null);
  const m = message;
  const box = m.box;
  const readonly = !!m.readonly;
  const outgoing = box === "sent" || box === "self";

  const download = async (index: number, name: string) => {
    setDownloading(index);
    try {
      await downloadMailAttachment(m.box, m.id, index, name, owner);
    } catch (e) {
      toast.error(errText(e), { title: "첨부를 받지 못했어요" });
    } finally {
      setDownloading(null);
    }
  };

  return (
    <article className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-nd-line px-3 py-2">
        {box === "scheduled" ? (
          <>
            <Button variant="ghost" size="sm" icon={Send} onClick={() => actions.onSchedule("now")}>
              지금 보내기
            </Button>
            <Button variant="ghost" size="sm" icon={Pencil} onClick={() => actions.onSchedule("edit")}>
              고쳐 쓰기
            </Button>
            <span className="flex-1" />
            <Button variant="danger" size="sm" icon={X} onClick={() => actions.onSchedule("cancel")}>
              예약 취소
            </Button>
          </>
        ) : box === "trash" ? (
          <>
            <Button variant="ghost" size="sm" icon={ArchiveRestore} onClick={() => actions.onAct("restore")}>
              되돌리기
            </Button>
            <span className="flex-1" />
            <Button variant="danger" size="sm" icon={Trash2} onClick={() => actions.onAct("purge")}>
              영구 삭제
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" icon={Reply} onClick={() => actions.onReply("reply")}>
              답장
            </Button>
            <Button variant="ghost" size="sm" icon={ReplyAll} onClick={() => actions.onReply("replyAll")}>
              전체 답장
            </Button>
            <Button variant="ghost" size="sm" icon={Forward} onClick={() => actions.onReply("forward")}>
              전달
            </Button>
            {/* 메일 내용을 ERP 안으로 — 업무요청·일일업무·회의 안건 (2026-09-22 팀 피드백) */}
            <Button variant="ghost" size="sm" icon={ListChecks} onClick={actions.onHandoff}>
              업무로
            </Button>
            <span className="flex-1" />
            {!readonly && (
              <>
                <IconButton
                  icon={Star}
                  size="sm"
                  label={m.starred ? "중요 표시 빼기" : "중요 표시"}
                  active={m.starred}
                  onClick={() => actions.onAct(m.starred ? "unstar" : "star")}
                />
                {box === "spam" ? (
                  <Button variant="ghost" size="sm" icon={ShieldCheck} onClick={() => actions.onAct("notSpam")}>
                    스팸 아님
                  </Button>
                ) : (
                  <>
                    <IconButton ref={moveRef} icon={FolderInput} size="sm" label="다른 메일함으로" onClick={() => setMoveOpen(true)} />
                    <Menu
                      open={moveOpen}
                      onClose={() => setMoveOpen(false)}
                      anchorRef={moveRef}
                      placement="bottom-end"
                      ariaLabel="옮길 메일함"
                      items={actions.moveItems((to) => actions.onAct("move", to))}
                    />
                    {!outgoing && <IconButton icon={ShieldAlert} size="sm" label="스팸 신고" onClick={() => actions.onAct("spam")} />}
                  </>
                )}
                {!outgoing && <IconButton icon={MailOpen} size="sm" label="안 읽음으로 표시" onClick={() => actions.onAct("unread")} />}
                {box === "spam" ? (
                  <IconButton icon={Trash2} size="sm" label="영구 삭제" onClick={() => actions.onAct("purge")} />
                ) : (
                  <IconButton icon={Trash2} size="sm" label="휴지통으로" onClick={() => actions.onAct("trash")} />
                )}
              </>
            )}
          </>
        )}
        {(onExpand || onClose) && <span className="mx-1 h-4 w-px bg-nd-line" aria-hidden />}
        {onExpand && <IconButton icon={Maximize2} size="sm" label="크게 보기" onClick={onExpand} />}
        {onClose && <IconButton icon={X} size="sm" label="닫기" onClick={onClose} />}
      </div>

      <div
        data-autofocus={onClose ? true : undefined}
        tabIndex={onClose ? -1 : undefined}
        className={cn("nd-scroll min-h-0 flex-1 overflow-y-auto pb-5 pt-4 outline-none", onClose ? "px-6" : "px-4")}
      >
        <h2 className="text-nd-title text-nd-fg">{m.subject}</h2>
        <div className="mt-3 flex flex-col gap-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-nd-body">
              <span className="font-semibold text-nd-fg">{m.from.name || m.from.address}</span>
              {m.from.name && <span className="ml-1.5 text-nd-caption text-nd-fg-3">{m.from.address}</span>}
              {m.source && <span className="ml-2 rounded bg-nd-sunken px-1.5 text-nd-micro text-nd-fg-3">{m.source}</span>}
            </span>
            <span className="text-nd-caption text-nd-fg-3">{box === "scheduled" ? `보낼 시각 ${fullDate(m.date)}` : fullDate(m.date)}</span>
          </div>
          <AddrLine label="받는 사람" list={m.to} />
          <AddrLine label="참조" list={m.cc} />
          <AddrLine label="숨은참조" list={m.bcc} />
          {typeof m.opens === "number" && (
            <div className="flex gap-2 text-nd-caption">
              <span className="w-14 shrink-0 text-nd-fg-3">수신확인</span>
              <span className={m.opens ? "text-nd-success" : "text-nd-fg-3"}>
                {m.opens ? `열람 ${m.opens}회 (추정)` : "아직 열람 표시 없음"}
              </span>
            </div>
          )}
        </div>

        {m.schedule?.status === "failed" && (
          <InlineNotice tone="danger" className="mt-4">
            예약 발송에 실패했습니다: {m.schedule.error ?? "알 수 없는 오류"} — 「지금 보내기」로 다시 보낼 수 있습니다.
          </InlineNotice>
        )}

        {m.attachments.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {m.attachments.map((a) => {
              const blocked = !!m.imported || box === "scheduled";
              return (
                <button
                  key={a.index}
                  type="button"
                  onClick={() => !blocked && void download(a.index, a.name)}
                  disabled={downloading !== null || blocked}
                  title={
                    m.imported
                      ? "백업에서 가져온 메일이라 첨부 원본이 없습니다 (카페24 웹메일에서 받아 주세요)"
                      : m.onServer
                        ? "누르면 메일 서버에서 받아 옵니다"
                        : "원문이 아직 메일 서버에 없습니다"
                  }
                  className="inline-flex max-w-full items-center gap-2 rounded-nd-md border border-nd-border bg-nd-content px-3 py-2 text-left text-nd-caption transition-colors duration-nd-fast hover:bg-nd-sunken disabled:cursor-default disabled:opacity-70"
                >
                  <Icon
                    icon={downloading === a.index ? Loader2 : FileText}
                    size={16}
                    className={cn("shrink-0 text-nd-fg-3", downloading === a.index && "animate-spin")}
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-nd-fg">{a.name}</span>
                    <span className="text-nd-fg-3">{formatFileSize(a.size)}</span>
                  </span>
                  {!blocked && <Icon icon={Download} size={14} className="shrink-0 text-nd-fg-3" />}
                </button>
              );
            })}
          </div>
        )}

        {m.partial && (
          <InlineNotice
            tone="info"
            className="mt-4"
            action={
              m.onServer ? (
                <Button size="sm" variant="secondary" loading={loadingFull} onClick={actions.onFull}>
                  전체 본문 보기
                </Button>
              ) : undefined
            }
          >
            본문이 커서 ERP 에는 일부만 저장돼 있습니다.
          </InlineNotice>
        )}

        <div className="mt-4">
          <MailBody html={m.html} text={m.text} />
        </div>
      </div>
    </article>
  );
}

// ---- 화면 ----------------------------------------------------

export default function MailPage() {
  const { ready, account } = useMail();

  if (!ready) {
    return (
      <PageShell width="full">
        <PageHeader title="메일" />
        <LoadingState />
      </PageShell>
    );
  }
  if (!account) {
    return (
      <PageShell width="wide">
        <PageHeader title="메일" description="카페24 회사 메일을 ERP 안에서 받고 보냅니다." />
        <MailConnect />
      </PageShell>
    );
  }
  return <Mailbox account={account} />;
}

function Mailbox({ account }: { account: MailAccountView }) {
  const { activeKey, counts, setCounts, checking, lastCheckedAt, error, errorSince, checkNow, subscribe, setAccount, refresh, accounts, setActive } = useMail();
  const toast = useToast();
  const confirm = useConfirm();

  const [sel, setSel] = useState<MailSelection>(INBOX);
  /** 「업무로」 창에 올려 둔 메일 (MailHandoff) */
  const [handoff, setHandoff] = useState<MailDetail | null>(null);
  const [lists, setLists] = useState<Record<string, ListState>>({});
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MailDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string>();
  const [loadingFull, setLoadingFull] = useState(false);
  /** 큰 창으로 보는 메일 — 읽기 판의 메일과 같을 때만 열린다 (다른 메일을 열면 저절로 닫힌다) */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [compose, setCompose] = useState<ComposeInit | null>(null);
  const [settings, setSettings] = useState<{ open: boolean; tab: SettingsTab }>({ open: false, tab: "basic" });
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [olderBusy, setOlderBusy] = useState(false);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const bulkMoveRef = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  const key = keyOf(sel, activeKey);
  const list = lists[key] ?? EMPTY_LIST;
  const listsRef = useRef(lists);
  listsRef.current = lists;
  const readonly = !!sel.owner;
  const actBox: MailBox | null = isMailBox(sel.view) && !readonly ? sel.view : null;

  const patch = useCallback((k: string, fn: (s: ListState) => ListState) => {
    setLists((prev) => ({ ...prev, [k]: fn(prev[k] ?? EMPTY_LIST) }));
  }, []);

  /** 지금 계정의 이 메일함 목록들을 다시 받게 한다 (거르기별로 따로 있다) */
  const invalidate = useCallback(
    (view: string) => {
      setLists((prev) => {
        const next: Record<string, ListState> = {};
        for (const [k, v] of Object.entries(prev)) {
          const [acct, v2] = k.split("|");
          if (acct !== (activeKey ?? "") || v2 !== view) next[k] = v;
        }
        return next;
      });
    },
    [activeKey],
  );

  // 계정을 바꾸면 그 계정의 받은메일함으로 (목록은 계정마다 기억해 둔다)
  useEffect(() => {
    setSel(INBOX);
    setChecked(new Set());
    setOpenId(null);
    setDetail(null);
    setDetailError(undefined);
    setQuery("");
  }, [activeKey]);

  const load = useCallback(
    async (s: MailSelection, more = false) => {
      if (s.view === "receipts") return;
      const k = keyOf(s, activeKey);
      const items = listsRef.current[k]?.items ?? [];
      const before = more && items.length ? items[items.length - 1].date : undefined;
      patch(k, (st) => ({ ...st, loading: true, error: undefined }));
      try {
        const res = await fetchMailList(s.view, { filter: s.filter, before, acct: s.owner ?? activeKey });
        patch(k, (st) => {
          const merged = more ? [...st.items, ...res.list.items] : res.list.items;
          const seen = new Set<string>();
          const uniq = merged.filter((m) => !seen.has(m.id) && !!seen.add(m.id));
          return {
            // 예약은 보낼 시각이 가까운 것부터
            items: s.view === "scheduled" ? uniq : uniq.sort(byDateDesc),
            hasMore: res.list.hasMore,
            loaded: true,
            loading: false,
          };
        });
      } catch (e) {
        patch(k, (st) => ({ ...st, loading: false, error: errText(e) }));
      }
    },
    [patch, activeKey],
  );

  useEffect(() => {
    if (sel.view !== "receipts" && !list.loaded && !list.loading && !list.error) void load(sel);
  }, [sel, list.loaded, list.loading, list.error, load]);

  // 새 메일·방금 보낸 메일을 해당 목록 앞에 끼운다
  useEffect(
    () =>
      subscribe((added) => {
        setLists((prev) => {
          const next = { ...prev };
          for (const [k, st] of Object.entries(prev)) {
            const [acct, view, filter] = k.split("|");
            if (!st.loaded) continue;
            const f = (filter || undefined) as MailFilter | undefined;
            const fresh = added.filter(
              (m) => (m.acct ?? activeKey) === acct && m.box === view && fits(m, f) && !st.items.some((x) => x.id === m.id),
            );
            if (fresh.length) next[k] = { ...st, items: [...fresh, ...st.items].sort(byDateDesc) };
          }
          return next;
        });
      }),
    [subscribe, activeKey],
  );

  /**
   * 다른 화면의 「메일에서 옴」 칩에서 왔을 때 — /neander/mail?acct=&box=&id=
   * (MailChip). 그 계정으로 옮기고 메일을 바로 편다. 한 번 열면 주소는 지운다.
   */
  const jumped = useRef(false);
  useEffect(() => {
    if (jumped.current || typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    const box = q.get("box");
    const id = q.get("id");
    if (!id || !isMailBox(box)) return;
    const acct = q.get("acct") || undefined;
    // 계정 목록을 받기 전이면 기다린다 (ready 뒤 다시 돈다)
    if (acct && accounts.length === 0) return;
    jumped.current = true;
    window.history.replaceState(null, "", "/neander/mail");
    if (acct && acct !== activeKey && accounts.some((a) => a.key === acct)) setActive(acct);
    const label = SYSTEM_BOXES.includes(box as SystemBox)
      ? BOX_LABEL[box as SystemBox]
      : accounts.find((a) => a.key === (acct ?? activeKey))?.folders?.find((f) => f.id === box)?.name ?? "메일함";
    setSel({ view: box, label });
    setOpenId(id);
    setDetail(null);
    setDetailLoading(true);
    setDetailError(undefined);
    void fetchMailMessage(box, id, { acct })
      .then((res) => setDetail(res.message))
      .catch((e) => setDetailError(errText(e)))
      .finally(() => setDetailLoading(false));
  }, [accounts, activeKey, setActive]);

  const closeReader = () => {
    setOpenId(null);
    setDetail(null);
    setExpandedId(null);
  };

  const select = (s: MailSelection) => {
    // 같은 곳을 다시 누르면 새로 받는다 (다른 기기에서 바뀐 것)
    if (keyOf(s, activeKey) === key) invalidate(s.view);
    setSel(s);
    setChecked(new Set());
    closeReader();
    setDetailError(undefined);
    setNavOpen(false);
  };

  /** 지금 목록에서 고친 것을 바로 보이게 (null 이면 목록에서 뺀다) */
  const updateItems = (ids: string[], fn: (m: MailSummary) => MailSummary | null) => {
    const set = new Set(ids);
    setLists((prev) => {
      const next: Record<string, ListState> = {};
      for (const [k, st] of Object.entries(prev)) {
        const [acct, view] = k.split("|");
        if (view !== sel.view || acct !== (sel.owner ?? activeKey ?? "")) {
          next[k] = st;
          continue;
        }
        next[k] = { ...st, items: st.items.map((m) => (set.has(m.id) ? fn(m) : m)).filter((m): m is MailSummary => !!m) };
      }
      return next;
    });
    if (detail && set.has(detail.id)) {
      const upd = fn(detail);
      if (!upd) closeReader();
      else setDetail({ ...detail, ...upd });
    }
  };

  const act = async (kind: BulkKind, ids: string[], to?: MailBox) => {
    if (!actBox || !ids.length) return;
    try {
      let res: { counts: MailCounts } | undefined;
      switch (kind) {
        case "read":
        case "unread":
          res = await markRead(actBox, ids, kind === "read");
          updateItems(ids, (m) => ({ ...m, read: kind === "read" }));
          if (kind === "unread") closeReader();
          break;
        case "star":
        case "unstar":
          res = await markStar(actBox, ids, kind === "star");
          updateItems(ids, (m) => ({ ...m, starred: kind === "star" }));
          break;
        case "move":
          if (!to) return;
          res = await moveMail(actBox, ids, to);
          updateItems(ids, () => null);
          invalidate(to);
          toast.success(`${ids.length}통을 옮겼어요.`);
          break;
        case "trash":
          res = await trashMail(actBox, ids);
          updateItems(ids, () => null);
          invalidate("trash");
          toast.success(`${ids.length}통을 휴지통으로 옮겼어요.`);
          break;
        case "spam":
          res = await reportSpam(actBox, ids);
          updateItems(ids, () => null);
          invalidate("spam");
          void refresh();
          toast.success("스팸으로 신고했어요. 같은 보낸 사람의 새 메일은 스팸메일함으로 들어옵니다.");
          break;
        case "notSpam": {
          const r = await notSpam(ids);
          res = r;
          setAccount(r.account);
          updateItems(ids, () => null);
          invalidate("inbox");
          toast.success("받은메일함으로 옮기고 차단을 풀었어요.");
          break;
        }
        case "restore":
          res = await restoreMail(ids);
          updateItems(ids, () => null);
          for (const v of ["inbox", "sent", "self", "spam", ...account.folders.map((f) => f.id)]) invalidate(v);
          toast.success(`${ids.length}통을 되돌렸어요.`);
          break;
        case "purge": {
          const ok = await confirm({
            title: `${ids.length}통을 영구 삭제할까요?`,
            message: "ERP 에서 지우고, 카페24 메일 서버의 원문도 지웁니다. 되돌릴 수 없습니다.",
            confirmLabel: "영구 삭제",
            tone: "danger",
          });
          if (!ok) return;
          res = await purgeMail(actBox, ids);
          updateItems(ids, () => null);
          break;
        }
        case "deleteDraft": {
          const ok = await confirm({ title: `임시저장 ${ids.length}통을 지울까요?`, confirmLabel: "지우기", tone: "danger" });
          if (!ok) return;
          res = await deleteDrafts(ids);
          updateItems(ids, () => null);
          break;
        }
      }
      if (res?.counts) setCounts(res.counts);
      setChecked((c) => new Set([...c].filter((id) => !ids.includes(id))));
    } catch (e) {
      toast.error(errText(e));
    }
  };

  const openMessage = async (m: MailSummary, full = false) => {
    // 임시보관함은 읽지 않고 바로 이어 쓴다
    if (m.box === "drafts") {
      try {
        const { message } = await fetchMailMessage("drafts", m.id);
        setCompose({ ...(message.compose ?? {}), draftId: m.id, acct: activeKey });
      } catch (e) {
        toast.error(errText(e));
      }
      return;
    }
    setOpenId(m.id);
    if (full) setLoadingFull(true);
    else {
      setDetail(null);
      setDetailLoading(true);
    }
    setDetailError(undefined);
    try {
      const res = await fetchMailMessage(m.box, m.id, { full, acct: sel.owner ?? activeKey });
      setDetail(res.message);
      if (res.wasUnread) {
        updateItems([m.id], (x) => ({ ...x, read: true }));
        if (m.box === "inbox") setCounts({ ...counts, unread: Math.max(0, counts.unread - 1) });
        if (m.box === "spam") setCounts({ ...counts, spamUnread: Math.max(0, counts.spamUnread - 1) });
      }
    } catch (e) {
      if (full) toast.error(errText(e));
      else setDetailError(errText(e));
    } finally {
      setDetailLoading(false);
      setLoadingFull(false);
    }
  };

  const onSchedule = async (kind: "now" | "cancel" | "edit") => {
    if (!detail) return;
    try {
      if (kind === "now") {
        const r = await sendScheduleNow(detail.id);
        setCounts(r.counts);
        toast.success("보냈어요.");
      } else {
        if (kind === "cancel") {
          const ok = await confirm({ title: "예약을 취소할까요?", message: "쓴 내용은 임시보관함으로 옮깁니다.", confirmLabel: "예약 취소" });
          if (!ok) return;
        }
        const r = await cancelSchedule(detail.id);
        setCounts(r.counts);
        invalidate("drafts");
        if (kind === "edit") {
          const { message } = await fetchMailMessage("drafts", r.draft.id);
          setCompose({ ...(message.compose ?? {}), draftId: r.draft.id, acct: activeKey });
        } else toast.success("예약을 취소하고 임시보관함에 넣었어요.");
      }
      invalidate("scheduled");
      invalidate("sent");
      closeReader();
    } catch (e) {
      toast.error(errText(e));
    }
  };

  const onEmpty = async (box: "trash" | "spam") => {
    const ok = await confirm({
      title: `${BOX_LABEL[box]}을 비울까요?`,
      message: "안의 메일을 모두 영구 삭제합니다. 카페24 메일 서버의 원문도 지웁니다.",
      confirmLabel: "비우기",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const r = await emptyMailBox(box);
      setCounts(r.counts);
      invalidate(box);
      if (sel.view === box) closeReader();
      toast.success(`${BOX_LABEL[box]}을 비웠어요.`);
    } catch (e) {
      toast.error(errText(e));
    }
  };

  const onOlder = async (box: "inbox" | "sent") => {
    setOlderBusy(true);
    try {
      const { sync, counts: c } = await importOlderMail(box);
      setCounts(c);
      patch(keyOf({ view: box }, activeKey), (s) => {
        const ids = new Set(s.items.map((x) => x.id));
        return { ...s, items: [...s.items, ...sync.added.filter((m) => !ids.has(m.id))].sort(byDateDesc) };
      });
      setAccount(box === "sent" ? { ...account, olderSent: sync.olderCount || undefined } : { ...account, olderCount: sync.olderCount });
      toast.success(`예전 메일 ${sync.added.length}통을 가져왔어요.`);
    } catch (e) {
      toast.error(errText(e), { title: "예전 메일을 가져오지 못했어요" });
    } finally {
      setOlderBusy(false);
    }
  };

  const refreshNow = async () => {
    const r = await checkNow(true);
    void refresh();
    invalidate("scheduled");
    if (r && Object.values(r).every((x) => x.status === "ok" && !x.added.length)) toast.info("새 메일이 없어요.");
  };

  const moveItems = (fn: (to: MailBox) => void): MenuItem[] => {
    const targets: { id: MailBox; label: string }[] = [
      { id: "inbox", label: BOX_LABEL.inbox },
      ...account.folders.map((f) => ({ id: f.id, label: f.name })),
    ];
    const items: MenuItem[] = targets
      .filter((t) => t.id !== sel.view)
      .map((t) => ({ key: t.id, label: t.label, onSelect: () => fn(t.id) }));
    if (!account.folders.length) items.push({ type: "label", key: "none", label: "내 메일함을 만들면 여기에 보입니다" });
    return items;
  };

  const q = query.trim().toLowerCase();
  const items = useMemo(() => {
    if (!q) return list.items;
    return list.items.filter((m) =>
      [m.subject, m.snippet, m.from.name, m.from.address, ...m.to.map((a) => `${a.name ?? ""} ${a.address}`)]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [list.items, q]);

  const checkedIds = [...checked].filter((id) => items.some((m) => m.id === id));
  const allChecked = items.length > 0 && checkedIds.length === items.length;

  const bulk = (label: string, icon: LucideIcon, kind: BulkKind, danger = false) => (
    <Button key={kind} size="sm" variant={danger ? "danger" : "ghost"} icon={icon} onClick={() => void act(kind, checkedIds)}>
      {label}
    </Button>
  );
  const bulkButtons = !actBox || !checkedIds.length
    ? null
    : actBox === "drafts"
      ? [bulk("삭제", Trash2, "deleteDraft", true)]
      : actBox === "trash"
        ? [bulk("되돌리기", ArchiveRestore, "restore"), bulk("영구 삭제", Trash2, "purge", true)]
        : actBox === "spam"
          ? [bulk("스팸 아님", ShieldCheck, "notSpam"), bulk("읽음", MailOpen, "read"), bulk("영구 삭제", Trash2, "purge", true)]
          : [
              bulk("읽음", MailOpen, "read"),
              bulk("안읽음", Mail, "unread"),
              bulk("중요", Star, "star"),
              <span key="move">
                <Button ref={bulkMoveRef} size="sm" variant="ghost" icon={FolderInput} onClick={() => setBulkMoveOpen(true)}>
                  이동
                </Button>
                <Menu
                  open={bulkMoveOpen}
                  onClose={() => setBulkMoveOpen(false)}
                  anchorRef={bulkMoveRef}
                  ariaLabel="옮길 메일함"
                  items={moveItems((to) => void act("move", checkedIds, to))}
                />
              </span>,
              ...(actBox === "sent" || actBox === "self" ? [] : [bulk("스팸", ShieldAlert, "spam")]),
              bulk("삭제", Trash2, "trash", true),
            ];

  const emptyTitle = q ? "찾는 메일이 없어요" : sel.filter ? `${FILTER_LABEL[sel.filter]} 메일이 없어요` : `${sel.label}이 비어 있어요`;
  const emptyHint = q
    ? "지금 불러온 메일 안에서만 찾습니다."
    : sel.view === "sent"
      ? "ERP 에서 보낸 메일이 여기에 쌓입니다. 예전에 카페24 웹메일로 보낸 메일은 백업 파일로 가져올 수 있어요."
      : sel.view === "scheduled"
        ? "메일쓰기에서 「예약 발송」을 켜면 여기서 기다립니다."
        : undefined;

  /** 목록 칸 머리 — 메일함 이름 · 검색 (좁은 화면에서는 메일함 단추 · 메일쓰기 단추도) */
  const listHead = (
    <div className="flex shrink-0 flex-col gap-2 border-b border-nd-line px-3 py-2.5">
      <div className="flex min-h-ctl-sm items-center gap-1.5">
        <IconButton icon={MenuIcon} size="sm" label="메일함 · 계정" className="-ml-1 xl:hidden" onClick={() => setNavOpen(true)} />
        <h2 className="flex min-w-0 flex-1 items-center gap-2 text-nd-section text-nd-fg">
          <span className="truncate">{sel.label}</span>
          {sel.owner && <span className="shrink-0 rounded bg-nd-sunken px-1.5 text-nd-micro text-nd-fg-3">공유 · 읽기 전용</span>}
          {sel.filter && (
            <button
              type="button"
              onClick={() => select(INBOX)}
              aria-label="거르기 풀기"
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-nd-accent-soft px-2 py-0.5 text-nd-caption text-nd-accent-strong"
            >
              {FILTER_LABEL[sel.filter]}만 <X size={12} />
            </button>
          )}
        </h2>
        <IconButton
          icon={Pencil}
          size="sm"
          label="메일쓰기"
          className="xl:hidden"
          onClick={() => setCompose({ sigMode: "new", acct: account.key })}
        />
      </div>
      {sel.view !== "receipts" && <SearchInput value={query} onValueChange={setQuery} placeholder="보낸 사람·제목 찾기" />}
    </div>
  );

  // 세 칸(메일함 · 목록 · 읽기)은 한 판에 붙어 있다 — 칸 사이는 세로 줄만.
  // 좁은 화면(lg 아래)에서는 목록과 읽기가 한 칸을 번갈아 쓰고, 메일함은 서랍으로 연다.
  // 아직 안 가져온 예전 메일 — 받은메일함(모든 계정) · 보낸메일함(네이버·Gmail — 서버 보낸메일함을 바로 읽는다)
  const olderHere = sel.filter || sel.owner ? 0 : sel.view === "inbox" ? account.olderCount : sel.view === "sent" ? account.olderSent ?? 0 : 0;
  const serverName = account.provider === "naver" ? "네이버" : account.provider === "gmail" ? "Gmail" : "카페24";

  const listPane = (
    <section
      aria-label="메일 목록"
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col lg:w-[380px] lg:flex-none lg:border-r lg:border-nd-line",
        openId && "max-lg:hidden",
      )}
    >
      {listHead}
      {actBox && items.length > 0 && (
        <div className="flex min-h-[40px] shrink-0 flex-wrap items-center gap-1 border-b border-nd-line px-3 py-1">
          <Checkbox
            checked={allChecked}
            onChange={(e) => setChecked(e.target.checked ? new Set(items.map((m) => m.id)) : new Set())}
            aria-label="모두 고르기"
          />
          <span className="ml-1 mr-1 text-nd-caption text-nd-fg-3">
            {checkedIds.length ? `${checkedIds.length}통 고름` : `${items.length}통`}
          </span>
          {bulkButtons}
        </div>
      )}
      <div className="nd-scroll min-h-0 flex-1 overflow-y-auto">
        {list.error ? (
          <ErrorState
            className="m-4"
            description={list.error}
            action={
              <Button size="sm" variant="secondary" onClick={() => void load(sel)}>
                다시 시도
              </Button>
            }
          />
        ) : !list.loaded ? (
          <LoadingState size="block" />
        ) : items.length === 0 ? (
          <EmptyState
            className="m-4"
            compact
            icon={sel.view === "sent" ? Send : sel.view === "scheduled" ? CalendarClock : sel.view === "trash" ? Trash2 : Inbox}
            title={emptyTitle}
            description={emptyHint}
            action={
              sel.view === "sent" && !q && account.provider === "cafe24" ? (
                <Button size="sm" variant="secondary" icon={FolderInput} onClick={() => setImportOpen(true)}>
                  카페24 보낸메일함 가져오기
                </Button>
              ) : undefined
            }
          />
        ) : (
          items.map((m) => (
            <MailRow
              key={m.id}
              m={m}
              active={openId === m.id}
              checked={checked.has(m.id)}
              readonly={readonly}
              onOpen={() => void openMessage(m)}
              onExpand={m.box === "drafts" ? undefined : () => setExpandedId(m.id)}
              onCheck={(v) =>
                setChecked((c) => {
                  const next = new Set(c);
                  if (v) next.add(m.id);
                  else next.delete(m.id);
                  return next;
                })
              }
              onStar={() => void act(m.starred ? "unstar" : "star", [m.id])}
            />
          ))
        )}
        {list.loaded && (list.hasMore || olderHere > 0) && (
          <div className="flex flex-col items-center gap-2 border-t border-nd-line px-4 py-3">
            {list.hasMore && (
              <Button size="sm" variant="secondary" loading={list.loading} onClick={() => void load(sel, true)}>
                더 보기
              </Button>
            )}
            {!list.hasMore && olderHere > 0 && (
              <>
                <Button size="sm" variant="secondary" loading={olderBusy} onClick={() => void onOlder(sel.view === "sent" ? "sent" : "inbox")}>
                  {serverName} 에서 예전 메일 30통 더 가져오기
                </Button>
                <span className="text-nd-caption text-nd-fg-3">아직 가져오지 않은 예전 메일 {olderHere}통</span>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );

  const readerActions = (m: MailDetail): ReaderActions => ({
    onReply: (mode) => {
      // 답장 창이 큰 창 위에 겹치지 않게 — 큰 창은 닫고 쓴다
      setExpandedId(null);
      setCompose(replyInit(mode, m, account, sel.owner ?? activeKey));
    },
    onAct: (kind, to) => void act(kind, [m.id], to),
    onHandoff: () => setHandoff(m),
    onFull: () => void openMessage(m, true),
    onSchedule: (kind) => {
      if (kind === "edit") setExpandedId(null);
      void onSchedule(kind);
    },
    moveItems,
  });

  /** 큰 창 — 읽기 판과 같은 메일·같은 동작. 지우거나 옮겨 메일이 판에서 사라지면 함께 닫힌다 */
  const expanded = detail && detail.id === expandedId ? detail : null;
  const expandedView = (
    <Dialog
      open={!!expanded}
      onClose={() => setExpandedId(null)}
      size="full"
      hideClose
      ariaLabel={expanded?.subject || "메일 크게 보기"}
      className="h-[92vh] sm:h-[calc(100dvh-2rem)] sm:!max-h-[calc(100dvh-2rem)] sm:!max-w-[1100px]"
      bodyClassName="!p-0 flex flex-col"
    >
      {expanded && (
        <Reader
          message={expanded}
          owner={sel.owner ?? activeKey}
          loadingFull={loadingFull}
          actions={readerActions(expanded)}
          onClose={() => setExpandedId(null)}
        />
      )}
    </Dialog>
  );

  const detailPane = (
    <section aria-label="메일 읽기" className={cn("min-h-0 min-w-0 flex-1 flex-col", openId ? "flex" : "hidden lg:flex")}>
      {openId && (
        <div className="shrink-0 border-b border-nd-line px-2 py-1.5 lg:hidden">
          <Button variant="ghost" size="sm" icon={ChevronLeft} onClick={closeReader}>
            목록으로
          </Button>
        </div>
      )}
      {detailError ? (
        <ErrorState className="m-4" description={detailError} />
      ) : detailLoading ? (
        <LoadingState size="block" />
      ) : detail ? (
        <Reader
          message={detail}
          owner={sel.owner ?? activeKey}
          loadingFull={loadingFull}
          actions={readerActions(detail)}
          onExpand={() => setExpandedId(detail.id)}
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-nd-body text-nd-fg-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-nd-fg/[.05]">
            <Icon icon={Mail} size={22} />
          </span>
          메일을 고르세요
        </div>
      )}
    </section>
  );

  const nav = (
    <MailNav
      current={sel}
      onSelect={select}
      onCompose={(self) => {
        setNavOpen(false);
        setCompose({ sigMode: "new", self, acct: account.key });
      }}
      onAddAccount={() => {
        setNavOpen(false);
        setAddOpen(true);
      }}
      onExternal={() => {
        setNavOpen(false);
        setSettings({ open: true, tab: "external" });
      }}
      onImport={() => {
        setNavOpen(false);
        setImportOpen(true);
      }}
      onEmpty={(b) => void onEmpty(b)}
    />
  );

  // 메일은 넓은 화면을 끝까지 쓴다 — 읽기 판이 남는 폭을 모두 가져간다 (2026-09-18 사용자 요청)
  return (
    <PageShell width="full" className={PAGE_H}>
      <PageHeader
        title="메일"
        compact
        description={
          <>
            {account.label ? `${account.label} · ` : account.name ? `${account.name} · ` : ""}
            {account.address}
            <span className="text-nd-fg-3"> · {checking ? "확인 중…" : agoLabel(lastCheckedAt ?? account.lastCheckedAt, now)}</span>
          </>
        }
        actions={
          <>
            <IconButton
              icon={RefreshCw}
              label="지금 새 메일 확인"
              onClick={() => void refreshNow()}
              disabled={checking || account.authFailed}
              className={cn(checking && "[&_svg]:animate-spin")}
            />
            <IconButton icon={Settings} label="메일 설정" onClick={() => setSettings({ open: true, tab: "basic" })} />
          </>
        }
        className="mb-3 shrink-0"
      />

      {account.authFailed ? (
        <InlineNotice
          tone="danger"
          className="mb-3 shrink-0"
          action={
            <Button size="sm" variant="secondary" onClick={() => setSettings({ open: true, tab: "basic" })}>
              비밀번호 다시 넣기
            </Button>
          }
        >
          {SERVER_NAME[account.provider ?? "cafe24"]} 비밀번호가 맞지 않아 새 메일 확인을 멈췄습니다. 계정이 잠기지 않도록 다시
          넣을 때까지 쉬어요.
        </InlineNotice>
      ) : (
        error && (
          <InlineNotice tone="warning" className="mb-3 shrink-0">
            {SERVER_NAME[account.provider ?? "cafe24"]}에서
            {errorSince ? ` ${Math.max(2, Math.round((Date.now() - errorSince) / 60_000))}분째` : ""} 새 메일을 받지 못하고
            있어요. 저절로 다시 시도합니다.
            <span className="mt-0.5 block break-all text-nd-caption opacity-80">원인: {error}</span>
          </InlineNotice>
        )
      )}

      <Card padding="none" className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className="nd-scroll hidden w-[244px] shrink-0 overflow-y-auto border-r border-nd-line bg-nd-sunken/40 p-3 xl:block">
          {nav}
        </div>
        {sel.view === "receipts" ? (
          <section aria-label="수신확인" className="flex min-h-0 min-w-0 flex-1 flex-col">
            {listHead}
            <MailReceipts key={activeKey} className="min-h-0 flex-1" />
          </section>
        ) : (
          <>
            {listPane}
            {detailPane}
          </>
        )}
      </Card>

      {expandedView}
      <Sheet open={navOpen} onClose={() => setNavOpen(false)} side="left" title="메일함" width={300}>
        {nav}
      </Sheet>
      <MailComposer
        init={compose}
        onClose={() => {
          setCompose(null);
          invalidate("drafts");
          invalidate("scheduled");
        }}
      />
      {/* 이 메일을 업무요청·일일업무·회의 안건으로 */}
      <MailHandoff mail={handoff} acct={sel.owner ?? activeKey} onClose={() => setHandoff(null)} />
      <AddAccountDialog open={addOpen} onClose={() => setAddOpen(false)} />
      <MailSettings open={settings.open} initialTab={settings.tab} onClose={() => setSettings((s) => ({ ...s, open: false }))} />
      <MailImport
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={(box, label) => {
          invalidate(box);
          select({ view: box, label });
        }}
      />
    </PageShell>
  );
}
