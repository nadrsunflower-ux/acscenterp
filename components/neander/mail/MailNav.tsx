"use client";

// ============================================================
//  메일 사이드바 — 카페24 웹메일 왼쪽 판과 같은 차례
// ------------------------------------------------------------
//    메일 계정 (지금 계정 한 줄 · 커서를 올리거나 누르면 계정 목록 · 연필로 별칭·사진 · 계정 추가)
//    메일쓰기 · 내게쓰기
//    안읽음 · 중요 · 읽음 · 첨부          (받은메일함 빠른 거르기)
//    카페24 메일함 용량
//    받은메일함 · 내게쓴메일함 · 보낸메일함(수신확인) · 예약메일함 · 임시보관함
//    · 스팸메일함 · 휴지통
//    내 메일함 (+ 만들기 · 관리)
//    공유메일함 (동료가 공유한 메일함)
//    외부 메일 설정 · 메일함 가져오기
// ============================================================

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Camera,
  CalendarClock,
  Check,
  ChevronsUpDown,
  CircleAlert,
  FileClock,
  Folder,
  FolderInput,
  FolderPlus,
  Inbox,
  Mail,
  MailCheck,
  MailOpen,
  Paperclip,
  PenSquare,
  Pencil,
  Plus,
  Send,
  Settings,
  Share2,
  ShieldAlert,
  Star,
  Trash2,
  UserRoundPen,
  Users,
} from "lucide-react";
import {
  AvatarPicker,
  Button,
  ColorPalette,
  Dialog,
  EmptyState,
  Field,
  Icon,
  IconButton,
  Input,
  Meter,
  Popover,
  Switch,
  cn,
  useConfirm,
  useToast,
  type LucideIcon,
} from "@/components/neander/ui";
import { createFolder, deleteFolder, renameFolder, shareFolder, updateMail } from "@/lib/neander/mail/client";
import { BOX_LABEL, type MailAccountView, type MailFilter, type MailView, type SystemBox } from "@/lib/neander/mail/types";
import { useMail } from "./MailProvider";

/** 목록이 지금 보여 주는 것 */
export interface MailSelection {
  view: MailView;
  /** 동료의 공유 메일함이면 그 계정 키 (읽기 전용). 없으면 지금 보는 내 계정 */
  owner?: string;
  filter?: MailFilter;
  label: string;
}

export const FILTER_LABEL: Record<MailFilter, string> = {
  unread: "안읽음",
  starred: "중요",
  read: "읽음",
  attach: "첨부",
};

const BOX_ICON: Record<SystemBox, LucideIcon> = {
  inbox: Inbox,
  self: UserRoundPen,
  sent: Send,
  drafts: FileClock,
  spam: ShieldAlert,
  trash: Trash2,
};

const mb = (bytes: number) => (bytes >= 1024 * 1024 * 1024 ? `${(bytes / 1024 ** 3).toFixed(1)}GB` : `${(bytes / 1024 ** 2).toFixed(1)}MB`);

function NavItem({
  icon,
  label,
  count,
  countTone = "neutral",
  active,
  onClick,
  trailing,
}: {
  icon: LucideIcon;
  label: ReactNode;
  count?: number;
  countTone?: "neutral" | "accent";
  active: boolean;
  onClick: () => void;
  trailing?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "group flex items-center rounded-nd-md transition-colors duration-nd-fast",
        active ? "bg-nd-accent-soft text-nd-accent-strong" : "text-nd-fg-2 hover:bg-nd-fg/[.05] hover:text-nd-fg",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        aria-current={active || undefined}
        className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left text-nd-body"
      >
        <Icon icon={icon} size={16} className="shrink-0" />
        <span className={cn("min-w-0 flex-1 truncate", active && "font-medium")}>{label}</span>
        {!!count && (
          <span
            className={cn(
              "shrink-0 text-nd-caption tabular-nums",
              countTone === "accent" ? "font-semibold text-nd-accent-strong" : "text-nd-fg-3",
            )}
          >
            {count}
          </span>
        )}
      </button>
      {trailing}
    </div>
  );
}

/** 계정 한 줄의 이름 — 별칭이 있으면 별칭, 없으면 주소 앞부분 */
export const accountTitle = (a: { label?: string; address: string }) => a.label || a.address.split("@")[0];

/** 메일 서비스 색 — 계정 동그라미의 기본 배경 (카페24 는 회사 파랑) */
const PROVIDER_COLOR: Record<string, string> = {
  naver: "#03C75A",
  gmail: "#EA4335",
  cafe24: "#2570CC",
};

/** 동그라미 글자 — 「(주)네안데르」처럼 앞에 붙은 (주)·괄호를 건너뛰고 첫 글자 */
const initialOf = (s: string) =>
  (s.replace(/^\s*(\(주\)|㈜|주식회사)\s*/, "").match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase();

type AvatarLook = Pick<MailAccountView, "provider" | "label" | "name" | "address" | "avatarPhoto" | "avatarEmoji" | "avatarColor">;

/** 계정 동그라미 — 사진 › 캐릭터 › 이름 첫 글자. 색을 따로 안 정했으면 메일 서비스 색 */
export function AccountAvatar({ account: a, size = 28, className }: { account: AvatarLook; size?: number; className?: string }) {
  const box = cn("flex shrink-0 items-center justify-center overflow-hidden rounded-full", className);
  if (a.avatarPhoto) {
    // eslint-disable-next-line @next/next/no-img-element -- 계정 문서에 든 작은 data URL
    return <img src={a.avatarPhoto} alt="" aria-hidden width={size} height={size} className={cn(box, "object-cover")} style={{ width: size, height: size }} />;
  }
  return (
    <span
      aria-hidden
      className={cn(box, "font-semibold leading-none text-white")}
      style={{
        width: size,
        height: size,
        fontSize: a.avatarEmoji ? size * 0.55 : size * 0.43,
        backgroundColor: a.avatarColor || PROVIDER_COLOR[a.provider] || PROVIDER_COLOR.cafe24,
      }}
    >
      {a.avatarEmoji || initialOf(a.label || a.name || a.address)}
    </span>
  );
}

/** 사진 파일 → 가운데를 정사각형으로 잘라 128px JPEG data URL (계정 문서에 그대로 둘 만큼 작게) */
async function squarePhoto(file: File, px = 128): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = px;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#fff"; // 투명 PNG 가 JPEG 로 검게 바뀌지 않게
    ctx.fillRect(0, 0, px, px);
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, px, px);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 연필 — 계정 별칭과 동그라미(사진·캐릭터·색)를 고친다. 사진·캐릭터는 둘 중 하나만 */
function AccountEditDialog({ account, onClose }: { account: MailAccountView | null; onClose: () => void }) {
  const { setAccount } = useMail();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState("");
  const [photo, setPhoto] = useState("");
  const [emoji, setEmoji] = useState("");
  const [color, setColor] = useState("");
  const [saving, setSaving] = useState(false);
  const [openFor, setOpenFor] = useState<string | null>(null);

  // 열 때마다 그 계정의 지금 값으로 채운다
  if (account && openFor !== account.key) {
    setOpenFor(account.key);
    setLabel(account.label ?? "");
    setPhoto(account.avatarPhoto ?? "");
    setEmoji(account.avatarEmoji ?? "");
    setColor(account.avatarColor ?? "");
  }
  if (!account && openFor) setOpenFor(null);

  const pickPhoto = async (file?: File) => {
    if (!file) return;
    try {
      setPhoto(await squarePhoto(file));
      setEmoji("");
    } catch {
      toast.error("JPG·PNG 사진으로 다시 골라 주세요.", { title: "사진을 읽지 못했어요" });
    }
  };

  const save = async () => {
    if (!account) return;
    setSaving(true);
    try {
      const { account: updated } = await updateMail(
        { label: label.trim(), avatarPhoto: photo, avatarEmoji: emoji, avatarColor: color },
        account.key,
      );
      setAccount(updated);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { title: "저장하지 못했어요" });
    } finally {
      setSaving(false);
    }
  };

  const preview: AvatarLook | null = account && {
    ...account,
    label: label.trim() || undefined,
    avatarPhoto: photo || undefined,
    avatarEmoji: emoji || undefined,
    avatarColor: color || undefined,
  };

  return (
    <Dialog
      open={!!account}
      onClose={onClose}
      size="sm"
      title="메일 계정 꾸미기"
      description={account?.address}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            취소
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            저장
          </Button>
        </>
      }
    >
      {preview && account && (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label="사진 고르기"
              className="group relative shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nd-accent focus-visible:ring-offset-2"
            >
              <AccountAvatar account={preview} size={64} />
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white opacity-0 transition-opacity duration-nd-fast group-hover:opacity-100">
                <Icon icon={Camera} size={20} />
              </span>
            </button>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" icon={Camera} onClick={() => fileRef.current?.click()}>
                {photo ? "사진 바꾸기" : "사진 올리기"}
              </Button>
              {photo && (
                <Button size="sm" variant="ghost" onClick={() => setPhoto("")}>
                  사진 빼기
                </Button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                void pickPhoto(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>

          <Field label="별칭" hint="계정 목록·보내는 계정에 주소 대신 보입니다. 비우면 주소 앞부분">
            <Input
              value={label}
              maxLength={30}
              placeholder={account.address.split("@")[0]}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void save();
                }
              }}
            />
          </Field>

          <div className="flex flex-col gap-1.5">
            <span className="text-nd-caption font-medium text-nd-fg-2">캐릭터 {photo && <span className="font-normal text-nd-fg-3">— 고르면 사진 대신 나옵니다</span>}</span>
            <AvatarPicker
              value={photo ? "" : emoji}
              onChange={(v) => {
                setEmoji(v);
                if (v) setPhoto("");
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-nd-caption font-medium text-nd-fg-2">색</span>
            <ColorPalette value={color} onChange={setColor} defaultColor={PROVIDER_COLOR[account.provider] ?? PROVIDER_COLOR.cafe24} />
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** 계정 한 줄의 속 — 동그라미 · 이름 · (공용) 주소 · 안 읽은 수 */
function AccountLine({ a, active }: { a: MailAccountView; active: boolean }) {
  const n = a.counts?.unread ?? 0;
  return (
    <>
      <AccountAvatar account={a} />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-nd-body", active ? "font-medium text-nd-accent-strong" : "text-nd-fg")}>
          {accountTitle(a)}
        </span>
        <span className="flex min-w-0 items-center gap-1 text-nd-micro text-nd-fg-3">
          {a.team && (
            <span
              className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-nd-sunken px-1.5 font-medium text-nd-fg-2"
              title={`팀 공용 계정 — ${a.connectedBy} 연결`}
            >
              <Icon icon={Users} size={10} />
              공용
            </span>
          )}
          <span className="truncate">{a.label ? a.address : `@${a.address.split("@")[1]}`}</span>
        </span>
      </span>
      {a.authFailed ? (
        <Icon icon={CircleAlert} size={15} className="shrink-0 text-nd-danger" aria-label="비밀번호 오류로 멈춤" />
      ) : n > 0 ? (
        <span className="shrink-0 rounded-full bg-nd-accent px-1.5 text-nd-micro font-semibold tabular-nums text-white">{n}</span>
      ) : null}
    </>
  );
}

/** 커서를 올려 계정 목록을 열기까지 · 떠난 뒤 닫기까지 (판으로 옮겨 가는 사이에 닫히지 않게) */
const SWITCH_OPEN_DELAY = 200;
const SWITCH_CLOSE_DELAY = 150;

/**
 * 메일 계정 — 지금 계정만 한 줄로 둔다. 커서를 올리면 로그인해 둔 계정 목록이
 * 아래에 뜨고, 누르면 그 계정으로 바뀐다. 누르면 열려 있는 채로 남는다 (터치·키보드).
 * 다른 계정에 안 읽은 메일이 있으면 바꾸기 표시에 점을 찍는다.
 */
function AccountSwitcher({ onAdd }: { onAdd: () => void }) {
  const { accounts, activeKey, setActive } = useMail();
  const [editing, setEditing] = useState<string | null>(null);
  const editingAccount = accounts.find((a) => a.key === editing) ?? null;
  const [open, setOpen] = useState(false);
  // 어떻게 열었나 — 커서로 연 목록은 커서가 떠나면 닫고, 눌러 연 목록은 바깥을 눌러야 닫는다.
  // 닫을 때도 이 값을 읽어 포커스를 돌려줄지 정하므로 닫으며 지우지 않는다
  const [via, setVia] = useState<"hover" | "click">("hover");
  const anchorRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | null>(null);

  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const show = () => {
    clear();
    if (open) return;
    timer.current = window.setTimeout(() => {
      setVia("hover");
      setOpen(true);
    }, SWITCH_OPEN_DELAY);
  };
  const hide = () => {
    clear();
    if (!(open && via === "click")) timer.current = window.setTimeout(() => setOpen(false), SWITCH_CLOSE_DELAY);
  };
  const close = () => {
    clear();
    setOpen(false);
  };
  useEffect(() => clear, []);

  const current = accounts.find((a) => a.key === activeKey) ?? accounts[0];
  const switchable = accounts.length > 1;
  const othersUnread = accounts.reduce((sum, a) => sum + (a.key === current?.key ? 0 : (a.counts?.unread ?? 0)), 0);
  const othersFailed = accounts.some((a) => a.key !== current?.key && a.authFailed);

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex h-7 items-center justify-between px-2.5">
        <span className="text-nd-micro font-semibold uppercase tracking-wide text-nd-fg-3">메일 계정</span>
        <IconButton icon={Plus} size="sm" label="메일 계정 추가" onClick={onAdd} />
      </div>
      {current && (
        <div
          className={cn(
            "group flex items-center rounded-nd-md bg-nd-accent-soft transition-shadow duration-nd-fast",
            open && "ring-1 ring-nd-accent/30",
          )}
        >
          <button
            ref={anchorRef}
            type="button"
            onMouseEnter={switchable ? show : undefined}
            onMouseLeave={switchable ? hide : undefined}
            onClick={() => {
              if (!switchable) return;
              clear();
              // 커서로 열린 목록을 누르면 눌러 연 것으로 붙잡아 둔다
              if (open && via === "click") setOpen(false);
              else {
                setVia("click");
                setOpen(true);
              }
            }}
            aria-haspopup={switchable ? "dialog" : undefined}
            aria-expanded={switchable ? open : undefined}
            title={current.address}
            className={cn("flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2 text-left", !switchable && "cursor-default")}
          >
            <AccountLine a={current} active />
            {switchable && (
              <span
                className="relative shrink-0 text-nd-fg-3"
                title={othersUnread ? `다른 계정에 안 읽은 메일 ${othersUnread}통` : othersFailed ? "다른 계정에 확인이 멈춘 곳이 있어요" : "다른 계정으로 바꾸기"}
              >
                <Icon icon={ChevronsUpDown} size={14} />
                {(othersUnread > 0 || othersFailed) && (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full",
                      othersFailed ? "bg-nd-danger" : "bg-nd-accent",
                    )}
                  />
                )}
              </span>
            )}
          </button>
          <IconButton
            icon={Pencil}
            size="sm"
            label={`${current.address} 별칭·사진 바꾸기`}
            className="mx-0.5 opacity-50 group-hover:opacity-100 focus-visible:opacity-100"
            onClick={() => {
              close();
              setEditing(current.key);
            }}
          />
        </div>
      )}
      <Popover
        open={open}
        onClose={close}
        anchorRef={anchorRef}
        placement="bottom-start"
        role="dialog"
        ariaLabel="메일 계정 바꾸기"
        autoFocus={via === "click"}
        returnFocus={via === "click"}
        // 좁은 화면에서는 메일함 판이 시트(창 층) 안에 있다 — 그 위로 올라와야 보인다
        overDialog
        unpadded
        className="w-[272px] max-w-[calc(100vw-1rem)]"
      >
        <div onMouseEnter={clear} onMouseLeave={hide} className="flex max-h-[inherit] flex-col">
          <div className="px-3 pb-1 pt-2.5 text-nd-micro font-semibold text-nd-fg-3">계정 바꾸기 · {accounts.length}개</div>
          <div className="nd-scroll min-h-0 flex-1 overflow-y-auto px-1 pb-1">
            {accounts.map((a) => {
              const active = a.key === current?.key;
              return (
                <div
                  key={a.key}
                  className={cn(
                    "group flex items-center rounded-nd-md transition-colors duration-nd-fast",
                    active ? "bg-nd-accent-soft" : "hover:bg-nd-fg/[.05]",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      if (!active) setActive(a.key);
                    }}
                    aria-current={active || undefined}
                    title={a.address}
                    className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2 text-left"
                  >
                    <AccountLine a={a} active={active} />
                    {active && <Icon icon={Check} size={14} className="shrink-0 text-nd-accent" />}
                  </button>
                  <IconButton
                    icon={Pencil}
                    size="sm"
                    label={`${a.address} 별칭·사진 바꾸기`}
                    className="mx-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => {
                      close();
                      setEditing(a.key);
                    }}
                  />
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => {
              close();
              onAdd();
            }}
            className="flex items-center gap-2 border-t border-nd-line px-3 py-2 text-left text-nd-caption text-nd-fg-2 transition-colors duration-nd-fast hover:bg-nd-fg/[.05] hover:text-nd-fg"
          >
            <Icon icon={Plus} size={14} />
            메일 계정 추가
          </button>
        </div>
      </Popover>
      <AccountEditDialog account={editingAccount} onClose={() => setEditing(null)} />
      {accounts.length < 2 && (
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-2 rounded-nd-md px-2.5 py-1.5 text-left text-nd-caption text-nd-fg-3 hover:bg-nd-fg/[.05] hover:text-nd-fg"
        >
          <Icon icon={Plus} size={14} />
          다른 메일 계정도 로그인해 두기
        </button>
      )}
    </div>
  );
}

function Group({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex h-7 items-center justify-between px-2.5">
        <span className="text-nd-micro font-semibold uppercase tracking-wide text-nd-fg-3">{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

export function MailNav({
  current,
  onSelect,
  onCompose,
  onExternal,
  onImport,
  onEmpty,
  onAddAccount,
}: {
  current: MailSelection;
  onSelect: (s: MailSelection) => void;
  onCompose: (self: boolean) => void;
  onExternal: () => void;
  onImport: () => void;
  onEmpty: (box: "trash" | "spam") => void;
  onAddAccount: () => void;
}) {
  const { account, counts, shared } = useMail();
  const [manage, setManage] = useState(false);
  if (!account) return null;

  const is = (view: MailView, owner?: string) => current.view === view && current.owner === owner && !current.filter;
  const box = (b: SystemBox) => onSelect({ view: b, label: BOX_LABEL[b] });
  const quick = (f: MailFilter) => onSelect({ view: "inbox", filter: f, label: `받은메일함 · ${FILTER_LABEL[f]}` });

  const used = account.usage?.bytes;
  const quota = account.quotaBytes;

  const quickItems: { f: MailFilter; icon: LucideIcon; n?: number }[] = [
    { f: "unread", icon: Mail, n: counts.unread },
    { f: "starred", icon: Star },
    { f: "read", icon: MailOpen },
    { f: "attach", icon: Paperclip },
  ];

  return (
    <nav aria-label="메일함" className="flex flex-col gap-4">
      <AccountSwitcher onAdd={onAddAccount} />

      <div className="grid grid-cols-2 gap-2">
        <Button icon={PenSquare} onClick={() => onCompose(false)}>
          메일쓰기
        </Button>
        <Button variant="secondary" onClick={() => onCompose(true)}>
          내게쓰기
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-1 rounded-nd-md bg-nd-sunken p-1">
        {quickItems.map(({ f, icon, n }) => {
          const active = current.view === "inbox" && current.filter === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => quick(f)}
              aria-pressed={active}
              aria-label={n ? `${FILTER_LABEL[f]} ${n}통` : undefined}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-[8px] py-2 text-nd-micro transition-colors duration-nd-fast",
                active ? "bg-nd-content text-nd-accent-strong shadow-nd-card" : "text-nd-fg-3 hover:text-nd-fg",
              )}
            >
              {/* 수는 아이콘 어깨에 — 줄을 따로 차지하면 수가 생길 때마다 아이콘이 밀린다 */}
              <span className="relative">
                <Icon icon={icon} size={14} />
                {!!n && (
                  <span
                    aria-hidden
                    className="absolute -top-1.5 left-full -ml-1 rounded-full bg-nd-accent px-1 text-[10px] font-semibold leading-[14px] tabular-nums text-white"
                  >
                    {n > 999 ? "999+" : n}
                  </span>
                )}
              </span>
              {FILTER_LABEL[f]}
            </button>
          );
        })}
      </div>

      {used !== undefined && (
        <div
          className="flex flex-col gap-1 px-1"
          title={account.provider === "cafe24" ? "카페24 받은메일함 사용량 (POP3 로 보이는 메일 기준)" : "메일 서버가 알려 준 사용량"}
        >
          <Meter value={used} max={quota} warnAbove={0.9} width={212} label="카페24 메일함 사용량" />
          <span className="text-nd-caption text-nd-fg-3">
            <span className="text-nd-accent-strong">{mb(used)}</span> / {mb(quota)} ({Math.round((used / quota) * 100)}% 사용중)
          </span>
        </div>
      )}

      <div className="flex flex-col gap-0.5">
        <NavItem icon={BOX_ICON.inbox} label={BOX_LABEL.inbox} count={counts.unread} countTone="accent" active={is("inbox")} onClick={() => box("inbox")} />
        <NavItem icon={BOX_ICON.self} label={BOX_LABEL.self} active={is("self")} onClick={() => box("self")} />
        <NavItem
          icon={BOX_ICON.sent}
          label={BOX_LABEL.sent}
          active={is("sent")}
          onClick={() => box("sent")}
          trailing={
            <button
              type="button"
              onClick={() => onSelect({ view: "receipts", label: "수신확인" })}
              className={cn(
                "mr-1 shrink-0 rounded-[6px] border px-1.5 py-0.5 text-nd-micro transition-colors duration-nd-fast",
                current.view === "receipts"
                  ? "border-nd-accent bg-nd-accent-soft text-nd-accent-strong"
                  : "border-nd-border text-nd-fg-3 hover:text-nd-fg",
              )}
            >
              수신확인
            </button>
          }
        />
        <NavItem
          icon={CalendarClock}
          label="예약메일함"
          count={counts.scheduled}
          active={is("scheduled")}
          onClick={() => onSelect({ view: "scheduled", label: "예약메일함" })}
        />
        <NavItem icon={BOX_ICON.drafts} label={BOX_LABEL.drafts} count={counts.drafts} active={is("drafts")} onClick={() => box("drafts")} />
        <NavItem
          icon={BOX_ICON.spam}
          label={BOX_LABEL.spam}
          count={counts.spamUnread}
          active={is("spam")}
          onClick={() => box("spam")}
          trailing={
            <IconButton icon={Trash2} size="sm" label="스팸메일함 비우기" className="mr-0.5 opacity-60 group-hover:opacity-100" onClick={() => onEmpty("spam")} />
          }
        />
        <NavItem
          icon={BOX_ICON.trash}
          label={BOX_LABEL.trash}
          active={is("trash")}
          onClick={() => box("trash")}
          trailing={
            <IconButton icon={Trash2} size="sm" label="휴지통 비우기" className="mr-0.5 opacity-60 group-hover:opacity-100" onClick={() => onEmpty("trash")} />
          }
        />
      </div>

      <Group
        title="내 메일함"
        action={
          <IconButton icon={Settings} size="sm" label="내 메일함 관리" onClick={() => setManage(true)} />
        }
      >
        {account.folders.length === 0 ? (
          <button
            type="button"
            onClick={() => setManage(true)}
            className="flex items-center gap-2 rounded-nd-md px-2.5 py-1.5 text-left text-nd-caption text-nd-fg-3 hover:bg-nd-fg/[.05] hover:text-nd-fg"
          >
            <Icon icon={FolderPlus} size={15} />
            메일함 만들기
          </button>
        ) : (
          account.folders.map((f) => (
            <NavItem
              key={f.id}
              icon={f.shared ? Share2 : Folder}
              label={f.name}
              active={is(f.id)}
              onClick={() => onSelect({ view: f.id, label: f.name })}
            />
          ))
        )}
      </Group>

      <Group title="공유메일함">
        {shared.length === 0 ? (
          <span className="px-2.5 py-1 text-nd-caption text-nd-fg-3">동료가 공유한 메일함이 없어요</span>
        ) : (
          shared.map((f) => (
            <NavItem
              key={`${f.owner}/${f.id}`}
              icon={Users}
              label={
                <>
                  {f.name} <span className="text-nd-caption text-nd-fg-3">· {f.ownerName}</span>
                </>
              }
              active={is(f.id, f.owner)}
              onClick={() => onSelect({ view: f.id, owner: f.owner, label: `${f.ownerName} · ${f.name}` })}
            />
          ))
        )}
      </Group>

      <div className="flex flex-col gap-0.5 border-t border-nd-line pt-3">
        <NavItem icon={MailCheck} label="외부 메일 설정" count={account.externals.length || undefined} active={false} onClick={onExternal} />
        {account.provider === "cafe24" && (
          <NavItem icon={FolderInput} label="카페24 메일함 가져오기" active={false} onClick={onImport} />
        )}
      </div>

      <FolderManager open={manage} onClose={() => setManage(false)} />
    </nav>
  );
}

/** 내 메일함 만들기 · 이름 바꾸기 · 공유 · 지우기 */
function FolderManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { account, setAccount, setCounts } = useMail();
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  if (!account) return null;

  const run = async (fn: () => Promise<{ account: typeof account }>) => {
    setBusy(true);
    try {
      setAccount((await fn()).account);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="내 메일함 관리" size="sm">
      <div className="flex flex-col gap-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            void run(() => createFolder(name.trim())).then(() => setName(""));
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="새 메일함 이름" aria-label="새 메일함 이름" />
          <Button type="submit" icon={FolderPlus} loading={busy} disabled={!name.trim()}>
            만들기
          </Button>
        </form>
        {account.folders.length === 0 ? (
          <EmptyState compact icon={Folder} title="만든 메일함이 없어요" description="메일을 주제별로 모아 두거나, 팀에 공유할 수 있습니다." />
        ) : (
          <ul className="flex flex-col divide-y divide-nd-line rounded-nd-md border border-nd-line">
            {account.folders.map((f) => (
              <li key={f.id} className="flex items-center gap-2 px-3 py-2">
                <Icon icon={f.shared ? Share2 : Folder} size={15} className="shrink-0 text-nd-fg-3" />
                <span className="min-w-0 flex-1 truncate text-nd-body text-nd-fg">{f.name}</span>
                <Switch
                  size="sm"
                  checked={f.shared}
                  label="팀 공유"
                  onChange={(v) => void run(() => shareFolder(f.id, v))}
                />
                <IconButton
                  icon={Pencil}
                  size="sm"
                  label="이름 바꾸기"
                  onClick={() => {
                    const next = window.prompt("새 이름", f.name);
                    if (next && next.trim() && next !== f.name) void run(() => renameFolder(f.id, next.trim()));
                  }}
                />
                <IconButton
                  icon={Trash2}
                  size="sm"
                  label="지우기"
                  onClick={async () => {
                    const ok = await confirm({
                      title: `「${f.name}」을 지울까요?`,
                      message: "안에 있던 메일은 휴지통으로 옮깁니다.",
                      confirmLabel: "지우기",
                      tone: "danger",
                    });
                    if (!ok) return;
                    setBusy(true);
                    try {
                      const r = await deleteFolder(f.id);
                      setAccount(r.account);
                      setCounts(r.counts);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : String(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        <p className="text-nd-caption leading-relaxed text-nd-fg-3">
          「팀 공유」를 켜면 ERP 에 메일을 연결한 동료의 공유메일함에 이 메일함이 보입니다 (읽기만 할 수 있습니다).
        </p>
      </div>
    </Dialog>
  );
}
