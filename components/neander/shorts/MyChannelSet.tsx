"use client";

// ============================================================
//  내 채널 세트 — 내 YouTube · Instagram 계정 + 내 쿠팡 파트너스 + 내 검색 키
// ------------------------------------------------------------
//  ERP 사용자마다 따로다. 쿠팡 키는 나만의 것이라 공유하지 않는다 (파트너스 FAQ —
//  API 키 1개 · 공유 불가). 계정은 공유할 수 있지만, 그 계정용 제휴 링크는 언제나
//  계정 주인(나)의 쿠팡 키 · 채널 아이디로 만들어진다.
//  키는 서버에서 암호화되고, 화면에는 끝 4자리와 상태만 돌아온다.
//
//  2026-11 목업 개편 — 조각을 나눴다 (accounts/AccountsScreen 이 한 화면으로 엮는다):
//    MyChannelSet       「새 계정은 지금 프로젝트에」 안내 · 연결 요약 카드 네 장 · 게시 계정 표
//    CoupangKeyCard     내 쿠팡 키 (파트너스 아이디 · Access/Secret Key · 키 확인 · 지우기)
//    CoupangSubIdsCard  쿠팡 채널 아이디 목록 (어느 계정에 붙었나 · 더하기 · 목록 저장)
//    YoutubeKeyCard     내 YouTube 검색 키 (선택)
//  게시 계정 표의 「옮기기」 · 「팀원 고르기」 · 「주소」 는 작은 창에서 고른다.
// ============================================================

import { useState, type ReactNode } from "react";
import {
  ArrowLeftRight,
  Camera,
  Check,
  KeyRound,
  Link2,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  SquarePlay,
  Trash2,
  Unlink,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { Badge, Button, Checkbox, Dialog, EmptyState, Field, FieldAction, FormRow, IconButton, Input, Select, buttonClass, cn, useConfirm, type Tone } from "@/components/neander/ui";
import { useAppData } from "@/components/neander/app-data";
import { mutate, shortsPost } from "@/lib/neander/shorts/client";
import { PLATFORM_LABEL } from "@/lib/neander/shorts/model";
import type { AccountView, ProfileView } from "@/lib/neander/shorts/types";
import { DEFAULT_SPACE_ID, spaceKind, spaceOf, type SpaceView } from "@/lib/neander/shorts/spaces";
import { useShorts } from "./ShortsProvider";
import { fmtWhen, useAction } from "./parts";
import { RecordTable, StudioCard, StudioNotice, type RecordColumn } from "./studio";

const STATUS: Record<ProfileView["coupang"]["status"], { label: string; tone: "neutral" | "warning" | "success" | "danger" }> = {
  none: { label: "키 없음", tone: "neutral" },
  unverified: { label: "넣음 · 확인 전", tone: "warning" },
  ok: { label: "키 확인됨", tone: "success" },
  failed: { label: "확인 실패", tone: "danger" },
};

/** 게시 계정 상태 — 게시에 꼭 필요하다. 없으면 「연결 필요」 (빨강) */
function publishState(accounts: AccountView[]): { label: string; tone: Tone; reauth: boolean } {
  if (accounts.some((a) => a.status === "needs_reauth")) return { label: "다시 연결 필요", tone: "danger", reauth: true };
  const n = accounts.filter((a) => a.status === "connected").length;
  return n ? { label: n > 1 ? `연결됨 ${n}` : "연결됨", tone: "success", reauth: false } : { label: "연결 필요", tone: "danger", reauth: false };
}

const AUTH_LABEL: Record<AccountView["authMode"], string> = { google_oauth: "Google OAuth", facebook_login: "Facebook 로그인", manual_token: "토큰 직접 입력" };

/** 지금 프로젝트 이름 — 「자체 운영 · 살림설계사무소」 · 「대행 · 업체 · 프로젝트」 */
export function useSpaceLabel() {
  const { data, currentSpace } = useShorts();
  const d = data!;
  const sp = currentSpace ?? d.spaces.find((x) => x.id === DEFAULT_SPACE_ID) ?? null;
  const kind = spaceKind(sp);
  const client = kind === "agency" && sp?.clientId ? d.clients.find((c) => c.id === sp.clientId)?.name : null;
  return { name: sp?.name ?? "살림설계사무소", kind, client, label: [kind === "agency" ? "대행" : "자체 운영", client, sp?.name ?? "살림설계사무소"].filter(Boolean).join(" · ") };
}

export function MyChannelSet({ onManualInstagram }: { onManualInstagram: () => void }) {
  const { data, refresh, nameOf } = useShorts();
  const d = data!;
  const { busy, run } = useAction();
  const s = d.status;
  const here = useSpaceLabel();
  const profile = d.profiles.find((x) => x.owner === d.me);
  const mine = d.accounts.filter((a) => a.mine);
  const shared = d.accounts.filter((a) => !a.mine && a.canPublish);
  const yt = mine.filter((a) => a.platform === "youtube");
  const ig = mine.filter((a) => a.platform === "instagram");
  const c = profile?.coupang;
  const coupangSt = STATUS[c?.status ?? "none"];
  const y = profile?.youtubeKey;
  const q = d.quotas?.youtubeSearch;

  const connect = (platform: "youtube" | "instagram") =>
    run(platform, async () => {
      const r = await shortsPost<{ url: string }>("oauth", { platform });
      window.location.assign(r.url);
    });

  // 연결 버튼이 막힌 이유 — 서버 설정이 빠졌을 때만
  const ytBlocked = !s.youtubeOAuth.configured ? "서버에 YouTube OAuth 가 설정되지 않아 연결할 수 없습니다 — 아래 「서버 연결 상태」 의 빠진 환경변수를 보세요." : !s.tokenKey.configured ? "토큰 암호화 키가 없어 계정을 연결할 수 없습니다." : null;
  const igBlocked = !s.meta.configured ? "서버에 Meta 앱이 설정되지 않아 연결할 수 없습니다 — 아래 「서버 연결 상태」 의 빠진 환경변수를 보세요." : !s.tokenKey.configured ? "토큰 암호화 키가 없어 계정을 연결할 수 없습니다." : null;
  const ytState = publishState(yt);
  const igState = publishState(ig);
  const names = (list: AccountView[]) => list.map((a) => a.externalName).join(", ");
  /** 다시 연결 · 처음 연결 · 하나 더 — 모두 같은 OAuth 연결이다 */
  const connectButton = (platform: "youtube" | "instagram", list: AccountView[], st: ReturnType<typeof publishState>, blocked: string | null) => (
    <Button
      size="md"
      variant={st.reauth || !list.length ? "primary" : "secondary"}
      icon={st.reauth ? RefreshCw : list.length ? Plus : Plug}
      disabled={!!blocked}
      loading={busy === platform}
      onClick={() => void connect(platform)}
    >
      {st.reauth ? "다시 연결" : list.length ? "계정 더 연결" : `${PLATFORM_LABEL[platform]} 연결`}
    </Button>
  );

  return (
    <div className="space-y-6">
      <StudioNotice tone="info" title="새로 연결하는 계정은 지금 프로젝트에 붙어요">
        지금 프로젝트: <b className="font-semibold text-nd-fg">{here.label}</b>. 다른 채널이면 위에서 프로젝트를 먼저 고르세요. 연결한 뒤에도 아래 표의 「프로젝트」 에서 옮길 수 있습니다.
      </StudioNotice>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ConnCard
          icon={SquarePlay}
          title="YouTube 게시"
          badge={<Badge size="lg" tone={ytState.tone}>{ytState.label}</Badge>}
          headline={yt.length ? <span className="block truncate" title={names(yt)}>{names(yt)}</span> : "연결한 채널 없음"}
          detail={yt.length ? `${nameOf(d.me)} · ${ytState.reauth ? "인증 만료 — 예약 실행 전에 다시 연결" : "게시 가능"}` : "게시하려면 연결이 필요합니다."}
          note={ytBlocked}
          actions={connectButton("youtube", yt, ytState, ytBlocked)}
        />
        <ConnCard
          icon={Camera}
          title="Instagram 게시"
          badge={<Badge size="lg" tone={igState.tone}>{igState.label}</Badge>}
          headline={ig.length ? <span className="block truncate" title={names(ig)}>{names(ig)}</span> : "연결한 계정 없음"}
          detail={ig.length ? `${nameOf(d.me)} · ${igState.reauth ? "인증 만료 — 예약 실행 전에 다시 연결" : "게시 가능"}` : "프로페셔널 계정을 연결해야 게시할 수 있습니다."}
          note={igBlocked}
          actions={
            <>
              {connectButton("instagram", ig, igState, igBlocked)}
              <Button size="md" variant="ghost" icon={KeyRound} disabled={!s.tokenKey.configured} onClick={onManualInstagram}>
                토큰 직접 입력
              </Button>
            </>
          }
        />
        <ConnCard
          icon={ShoppingBag}
          title="쿠팡 파트너스"
          badge={<Badge size="lg" tone={coupangSt.tone}>{coupangSt.label}</Badge>}
          headline={c?.configured ? <>내 키 · 끝 네 자리 <span className="font-mono">{c.keyHint ?? "…"}</span></> : "내 키 없음"}
          detail={
            c?.configured
              ? `채널 아이디 ${profile?.subIds.length ?? 0}개 · 나만 사용${c.checkedAt ? ` · ${fmtWhen(c.checkedAt)} 확인` : ""}`
              : `딥링크 · 리포트는 내 키로만 만듭니다.${s.companyCoupang.configured ? " 검색은 회사 공용 키로 합니다." : ""} 채널 아이디 ${profile?.subIds.length ?? 0}개`
          }
          actions={
            <a href="#my-coupang" className={buttonClass("secondary", "md", "gap-1.5")}>
              <KeyRound size={16} aria-hidden />키 · 채널 아이디 관리
            </a>
          }
        />
        <ConnCard
          icon={Search}
          title="YouTube 검색 키"
          badge={y?.configured ? <Badge size="lg" tone="success">개인 키 설정됨</Badge> : s.youtubeSearch.configured ? <Badge size="lg" tone="info">회사 키 사용 중</Badge> : <Badge size="lg">미연결</Badge>}
          headline={
            q && q.source ? (
              <span className="nd-num">
                {q.source === "personal" ? "개인 키" : "회사 키"} · 오늘 {q.used.toLocaleString("ko-KR")} / {q.limit.toLocaleString("ko-KR")}회
              </span>
            ) : y?.configured ? (
              <>개인 키 <span className="font-mono">{y.hint ?? "…"}</span></>
            ) : (
              "검색 키 없음"
            )
          }
          detail={y?.configured ? <>내 키 <span className="font-mono">{y.hint ?? "…"}</span> — 검색 한도를 회사 키와 따로 씁니다.</> : s.youtubeSearch.configured ? "내 키가 없어 회사 키로 검색합니다 (하루 한도를 함께 씁니다)." : "검색 키가 없습니다 — 검색 표본은 직접 붙여 넣습니다."}
          actions={
            <a href="#my-youtube-key" className={buttonClass("secondary", "md", "gap-1.5")}>
              <Pencil size={16} aria-hidden />
              {y?.configured ? "검색 키 바꾸기" : "검색 키 넣기"}
            </a>
          }
        />
      </div>

      <StudioCard
        id="my-accounts"
        title="게시 계정"
        description={`내가 연결한 계정 · YouTube ${yt.length} · Instagram ${ig.length} — 프로젝트를 옮기고, 쿠팡 채널 아이디와 함께 게시할 팀원을 정합니다`}
        className="scroll-mt-24"
        flush
      >
        {mine.length === 0 ? (
          <div className="px-5 pb-5 sm:px-6">
            <EmptyState
              icon={Plug}
              title="아직 연결한 내 게시 계정이 없습니다"
              description="게시는 미연결 상태입니다. 아래 「계정 준비 순서」 대로 계정과 개발자 앱을 만든 뒤 위 카드에서 연결하세요. 계정이 없어도 소재 발굴 · 대본 · 출력 · 다운로드는 모두 쓸 수 있습니다."
              compact
            />
          </div>
        ) : (
          <AccountsTable accounts={mine} profile={profile} spaces={d.spaces} onChanged={refresh} />
        )}
        {shared.length > 0 && (
          <p className="border-t border-nd-line px-5 py-3 text-[13px] leading-relaxed text-nd-fg-3 sm:px-6">
            나에게 공유된 계정: {shared.map((a) => `${PLATFORM_LABEL[a.platform]} ${a.externalName} (${nameOf(a.owner)})`).join(" · ")} — 이 계정용 링크는 계정 주인의 쿠팡 키로 만들어집니다.
          </p>
        )}
      </StudioCard>
    </div>
  );
}

/** 연결 카드 한 장 — 이름 · 아이콘 + 상태 · 굵은 한 줄 · 설명 · 동작 */
function ConnCard({
  icon: I,
  title,
  badge,
  headline,
  detail,
  note,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  badge: ReactNode;
  headline: ReactNode;
  detail: ReactNode;
  note?: string | null;
  actions: ReactNode;
}) {
  return (
    <section className="nd-surface flex min-w-0 flex-col gap-3 rounded-nd-lg px-5 py-4 sm:px-6 sm:py-5">
      <h3 className="text-[16px] font-semibold leading-snug text-nd-fg">{title}</h3>
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-nd-md border border-nd-line text-nd-fg-2">
          <I size={18} aria-hidden />
        </span>
        {badge}
      </div>
      <div className="min-w-0">
        <div className="min-w-0 text-[15px] font-semibold text-nd-fg">{headline}</div>
        <div className="mt-0.5 text-[13px] leading-relaxed text-nd-fg-3">{detail}</div>
      </div>
      {note && <p className="text-[13px] leading-relaxed text-nd-warning-text">{note}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">{actions}</div>
    </section>
  );
}

// ---- 게시 계정 표 ------------------------------------------------------------

function AccountsTable({ accounts, profile, spaces, onChanged }: { accounts: AccountView[]; profile: ProfileView | undefined; spaces: SpaceView[]; onChanged: () => Promise<void> }) {
  const { nameOf } = useShorts();
  const columns: RecordColumn<AccountView>[] = [
    {
      key: "account",
      header: "계정 · 연결한 사람",
      mobile: "title",
      className: "min-w-[240px]",
      cell: (a) => (
        <div className="min-w-0">
          <div className="font-semibold text-nd-fg">
            {PLATFORM_LABEL[a.platform]} · {a.externalName}
          </div>
          <div className="text-[13px] font-normal text-nd-fg-3">
            {nameOf(a.owner)} · {AUTH_LABEL[a.authMode]} · {fmtWhen(a.createdAt)} 연결
          </div>
        </div>
      ),
    },
    { key: "space", header: "프로젝트", cell: (a) => <ProjectCell a={a} spaces={spaces.filter((x) => !x.archived || x.id === spaceOf(a))} onChanged={onChanged} /> },
    {
      key: "status",
      header: "상태",
      cell: (a) => (a.status === "connected" ? <Badge size="lg" tone="success">연결됨</Badge> : <Badge size="lg" tone="danger">다시 연결 필요</Badge>),
    },
    { key: "sub", header: "쿠팡 채널 아이디", mobileLabel: "채널 아이디", cell: (a) => <SubIdCell a={a} subs={profile?.subIds ?? []} onChanged={onChanged} /> },
    { key: "reg", header: "활동 채널 등록", cell: (a) => <ChannelRegCell a={a} onChanged={onChanged} /> },
    { key: "share", header: "함께 게시할 팀원", cell: (a) => <ShareCell a={a} onChanged={onChanged} /> },
    { key: "manage", header: "관리", cell: (a) => <DisconnectCell a={a} onChanged={onChanged} /> },
  ];
  return <RecordTable rows={accounts} columns={columns} rowKey={(a) => a.id} ariaLabel="게시 계정" className="[&>ul]:px-4 [&>ul]:pb-4" />;
}

/** 이 계정으로 올리는 AI STUDIO 프로젝트 — 밖에서 올린 게시물도 이 프로젝트의 영상으로 붙는다 */
function ProjectCell({ a, spaces, onChanged }: { a: AccountView; spaces: SpaceView[]; onChanged: () => Promise<void> }) {
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(spaceOf(a));
  const name = spaces.find((x) => x.id === spaceOf(a))?.name ?? "?";
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 md:justify-start">
      <span className="font-medium text-nd-fg">{name}</span>
      {a.clientId ? (
        <span className="text-[13px] text-nd-fg-3">업체 계정 · 옮길 수 없음</span>
      ) : (
        <Button size="sm" variant="ghost" icon={ArrowLeftRight} onClick={() => { setTo(spaceOf(a)); setOpen(true); }} aria-label={`${a.externalName} 프로젝트 옮기기`}>
          옮기기
        </Button>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title="계정을 다른 프로젝트로 옮기기"
        description={`${PLATFORM_LABEL[a.platform]} · ${a.externalName}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>취소</Button>
            <Button
              icon={ArrowLeftRight}
              disabled={to === spaceOf(a)}
              loading={busy === "space"}
              onClick={() =>
                void run(
                  "space",
                  async () => {
                    await mutate("account.update", { id: a.id, spaceId: to });
                    await onChanged();
                    setOpen(false);
                  },
                  "계정을 옮겼습니다 — 이 계정의 게시 · 채널 숫자가 그 프로젝트에 모입니다.",
                )
              }
            >
              옮기기
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="옮길 프로젝트">
            <Select value={to} onChange={(e) => setTo(e.target.value)} aria-label={`${a.externalName} 프로젝트`}>
              {spaces.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                  {x.archived ? " (보관함)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <p className="text-[13px] leading-relaxed text-nd-fg-3">
            옮기면 이 계정의 채널 숫자와 앞으로 밖에서 올린 게시물이 새 프로젝트에 모입니다. 이미 만든 영상과 그 게시 기록은 영상이 속한 프로젝트에 그대로 남습니다.
          </p>
        </div>
      </Dialog>
    </div>
  );
}

/** 이 계정에 붙일 쿠팡 채널 아이디 — 내 파트너스에 등록한 것 중에서 */
function SubIdCell({ a, subs, onChanged }: { a: AccountView; subs: ProfileView["subIds"]; onChanged: () => Promise<void> }) {
  const { busy, run } = useAction();
  return (
    <div className="flex flex-col items-end gap-1 md:min-w-[150px] md:max-w-[210px] md:items-stretch">
      <Select
        size="sm"
        aria-label={`${a.externalName} 채널 아이디`}
        value={a.coupangSubId ?? ""}
        disabled={busy === "sub"}
        onChange={(e) => void run("sub", async () => { await mutate("account.update", { id: a.id, coupangSubId: e.target.value }); await onChanged(); })}
        className="w-[180px] md:w-full"
      >
        <option value="">(없음)</option>
        {subs.map((x) => (
          <option key={x.id} value={x.id}>
            {x.id}
            {x.label ? ` · ${x.label}` : ""}
          </option>
        ))}
      </Select>
      {!subs.length && (
        <a href="#my-coupang-subids" className="text-[13px] text-nd-accent hover:underline">
          채널 아이디 먼저 등록
        </a>
      )}
    </div>
  );
}

/** 쿠팡 파트너스 활동 채널로 등록했는지 — 사람이 파트너스 사이트에서 확인한 기록 */
function ChannelRegCell({ a, onChanged }: { a: AccountView; onChanged: () => Promise<void> }) {
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(a.coupangChannel?.url ?? "");
  const reg = !!a.coupangChannel?.registered;
  const save = (registered: boolean, u: string) =>
    run("cc", async () => {
      await mutate("account.update", { id: a.id, coupangChannel: registered ? { registered: true, url: u } : null });
      await onChanged();
      return true;
    });
  return (
    <div className="flex flex-col items-end gap-1 md:items-start">
      <Checkbox
        label={<span className="text-[14px]">{reg ? "등록됨" : "등록 안 함"}</span>}
        checked={reg}
        disabled={busy === "cc"}
        aria-label={`${a.externalName} 쿠팡 활동 채널 등록`}
        onChange={(e) => void save(e.target.checked, a.coupangChannel?.url ?? url)}
      />
      <div className="flex max-w-[220px] items-center gap-1 text-[13px] text-nd-fg-3">
        {a.coupangChannel?.url ? (
          <span className="min-w-0 truncate" title={a.coupangChannel.url}>{a.coupangChannel.url}</span>
        ) : null}
        {a.coupangChannel && <span className="shrink-0">{a.coupangChannel.url ? "· " : ""}{fmtWhen(a.coupangChannel.at)}</span>}
        <button type="button" className="shrink-0 rounded px-1 font-medium text-nd-accent hover:underline" onClick={() => { setUrl(a.coupangChannel?.url ?? ""); setOpen(true); }}>
          {a.coupangChannel?.url ? "주소 고치기" : "주소 적기"}
        </button>
      </div>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title="쿠팡 활동 채널 등록"
        description={`${PLATFORM_LABEL[a.platform]} · ${a.externalName} — 파트너스 사이트에 활동 채널로 등록한 주소`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>취소</Button>
            <Button icon={Check} loading={busy === "cc"} onClick={() => void save(true, url).then((ok) => ok && setOpen(false))}>
              등록함으로 저장
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="등록한 채널 주소" hint="파트너스에 적은 YouTube 채널 · Instagram 계정 주소">
            <Input value={url} placeholder="https://" onChange={(e) => setUrl(e.target.value)} aria-label="등록한 채널 주소" />
          </Field>
          <p className="text-[13px] leading-relaxed text-nd-fg-3">미등록 채널의 활동은 수익 몰수 · 해지 사유입니다. 파트너스에서 등록을 마친 뒤 저장하세요.</p>
        </div>
      </Dialog>
    </div>
  );
}

/** 이 계정으로 게시해도 되는 다른 팀원 (소유자가 정한다 · 등록된 팀원만) */
function ShareCell({ a, onChanged }: { a: AccountView; onChanged: () => Promise<void> }) {
  const { data, nameOf } = useShorts();
  const { members } = useAppData();
  const { busy, run } = useAction();
  const me = data!.me;
  const [open, setOpen] = useState(false);
  const team = members.filter((m) => m.email && m.email.toLowerCase() !== me).map((m) => ({ name: m.name, email: (m.email ?? "").toLowerCase() }));
  const known = new Set(team.map((t) => t.email));
  const [picked, setPicked] = useState<string[]>(a.sharedWith);
  const [extra, setExtra] = useState("");
  const reset = () => {
    setPicked(a.sharedWith.filter((e) => known.has(e)));
    setExtra(a.sharedWith.filter((e) => !known.has(e)).join(", "));
  };
  const list = [...new Set([...picked, ...extra.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)])];
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 md:justify-start">
      <span className={cn("min-w-0 max-w-[200px] truncate", a.sharedWith.length ? "text-nd-fg" : "text-nd-fg-3")} title={a.sharedWith.join(", ")}>
        {a.sharedWith.length ? a.sharedWith.map(nameOf).join(", ") : "나만"}
      </span>
      <Button size="sm" variant="ghost" icon={UserPlus} onClick={() => { reset(); setOpen(true); }} aria-label={`${a.externalName} 함께 게시할 팀원 고르기`}>
        팀원 고르기
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title="함께 게시할 팀원"
        description={`${PLATFORM_LABEL[a.platform]} · ${a.externalName} — 고른 팀원도 이 계정으로 게시할 수 있습니다`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>취소</Button>
            <Button
              icon={Check}
              loading={busy === "sh"}
              onClick={() =>
                void run(
                  "sh",
                  async () => {
                    await mutate("account.update", { id: a.id, sharedWith: list });
                    await onChanged();
                    setOpen(false);
                  },
                  "공유 대상을 저장했습니다.",
                )
              }
            >
              저장
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {team.length > 0 ? (
            <ul className="divide-y divide-nd-line rounded-nd-md border border-nd-line">
              {team.map((t) => (
                <li key={t.email} className="px-3 py-2.5">
                  <Checkbox
                    checked={picked.includes(t.email)}
                    onChange={(e) => setPicked(e.target.checked ? [...new Set([...picked, t.email])] : picked.filter((x) => x !== t.email))}
                    label={
                      <span className="text-[14px]">
                        {t.name} <span className="text-[13px] text-nd-fg-3">{t.email}</span>
                      </span>
                    }
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-nd-fg-3">이메일이 등록된 다른 팀원이 없습니다.</p>
          )}
          <Field label="목록에 없는 팀원 이메일 (쉼표로)" hint="ERP 에 등록된 팀원 이메일만 저장됩니다">
            <Input value={extra} placeholder="name@example.com" onChange={(e) => setExtra(e.target.value)} aria-label="공유할 팀원" />
          </Field>
          <p className="text-[13px] leading-relaxed text-nd-fg-3">이 계정용 제휴 링크는 언제나 계정 주인(나)의 쿠팡 키 · 채널 아이디로 만들어집니다.</p>
        </div>
      </Dialog>
    </div>
  );
}

function DisconnectCell({ a, onChanged }: { a: AccountView; onChanged: () => Promise<void> }) {
  const ask = useConfirm();
  const { busy, run } = useAction();
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={Unlink}
      loading={busy === "del"}
      aria-label={`${a.externalName} 연결 끊기`}
      onClick={async () => {
        if (!(await ask({ title: "연결을 끊을까요?", message: "ERP 에 보관한 토큰만 지웁니다. Google · Meta 계정의 앱 권한은 각 계정 설정에서 따로 해제하세요.", tone: "danger", confirmLabel: "끊기" }))) return;
        await run("del", async () => { await mutate("account.delete", { id: a.id }); await onChanged(); });
      }}
    >
      연결 끊기
    </Button>
  );
}

// ---- 쿠팡 키 · 채널 아이디 · 검색 키 ------------------------------------------

/** 내 쿠팡 키 — 파트너스 아이디(기록용) · Access/Secret Key · 키 확인 · 지우기 */
export function CoupangKeyCard({ className }: { className?: string }) {
  const { data, refresh } = useShorts();
  const d = data!;
  const profile = d.profiles.find((x) => x.owner === d.me);
  const companyKey = d.status.companyCoupang.configured;
  const ask = useConfirm();
  const { busy, run } = useAction();
  const [keys, setKeys] = useState({ accessKey: "", secretKey: "" });
  const [af, setAf] = useState(profile?.coupang.afCode ?? "");
  const c = profile?.coupang;
  const st = STATUS[c?.status ?? "none"];
  const masked = c?.configured ? `•••• •••• ${c.keyHint ?? ""} · 바꿀 때만 입력` : "";
  return (
    <StudioCard
      id="my-coupang"
      className={cn("scroll-mt-24", className)}
      title={<span className="inline-flex flex-wrap items-center gap-2">내 쿠팡 키 <Badge size="lg" tone={st.tone}>{st.label}</Badge></span>}
      description={[c?.keyHint ? `Access Key 끝 ${c.keyHint}` : "아직 넣지 않았습니다", c?.checkedAt ? `${fmtWhen(c.checkedAt)} 확인` : ""].filter(Boolean).join(" · ")}
    >
      <div className="space-y-4">
        {c?.message && c.status !== "none" && (
          <StudioNotice tone={c.status === "ok" ? "success" : c.status === "failed" ? "danger" : "neutral"}>{c.message}</StudioNotice>
        )}
        <FormRow className="grid-cols-1 sm:grid-cols-2">
          <Field label="Access Key (접근 키)">
            <Input type="password" autoComplete="off" value={keys.accessKey} placeholder={masked} onChange={(e) => setKeys({ ...keys, accessKey: e.target.value.trim() })} />
          </Field>
          <Field label="Secret Key (비밀 키)">
            <Input type="password" autoComplete="off" value={keys.secretKey} placeholder={c?.configured ? "•••• •••• •••• · 바꿀 때만 입력" : ""} onChange={(e) => setKeys({ ...keys, secretKey: e.target.value.trim() })} />
          </Field>
        </FormRow>
        <FormRow className="grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Field label="파트너스 아이디 (AF…)" hint="기록용">
            <Input value={af} onChange={(e) => setAf(e.target.value)} />
          </Field>
          <FieldAction size="md">
            <Button
              icon={ShieldCheck}
              disabled={busy === "k" || (!keys.accessKey && !keys.secretKey && af === (c?.afCode ?? ""))}
              loading={busy === "k"}
              onClick={() =>
                void run(
                  "k",
                  async () => {
                    if (keys.accessKey || keys.secretKey) await mutate("profile.saveCoupangKeys", { ...keys, afCode: af });
                    else await mutate("profile.saveMeta", { afCode: af });
                    setKeys({ accessKey: "", secretKey: "" });
                    await refresh();
                  },
                  "저장했습니다 — 키는 서버에서 암호화해 보관합니다.",
                )
              }
            >
              저장
            </Button>
          </FieldAction>
        </FormRow>
        <p className="text-[13px] leading-relaxed text-nd-fg-3">
          키는 서버에서 암호화해 보관하고 원문은 화면에 다시 보이지 않습니다. 딥링크 · 리포트는 이 키로만 만듭니다 (수수료 · 실적이 키 주인에게 붙습니다). 검색은 이 키가 없으면 {companyKey ? "회사 공용 키" : "직접 검색"}로 합니다.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button icon={Check} variant="secondary" disabled={!c?.configured} loading={busy === "v"} onClick={() => void run("v", async () => { await mutate("profile.verifyCoupang"); await refresh(); })}>
            키 확인 (검색 1건)
          </Button>
          {c?.configured && (
            <Button
              variant="ghost"
              icon={Trash2}
              onClick={async () => {
                if (!(await ask({ title: "쿠팡 키를 지울까요?", message: "이미 만든 제휴 링크는 그대로입니다. 새 딥링크 · 리포트를 내 키로 못 만들게 됩니다.", tone: "danger", confirmLabel: "지우기" }))) return;
                await run("dk", async () => { await mutate("profile.deleteCoupangKeys"); await refresh(); });
              }}
            >
              키 지우기
            </Button>
          )}
        </div>
      </div>
    </StudioCard>
  );
}

/** 쿠팡 채널 아이디(subId) — 파트너스에 등록한 것만 · 최대 10개. 어느 게시 계정에 붙었는지 함께 */
export function CoupangSubIdsCard({ className }: { className?: string }) {
  const { data, refresh } = useShorts();
  const d = data!;
  const profile = d.profiles.find((x) => x.owner === d.me);
  const { busy, run } = useAction();
  const saved = profile?.subIds ?? [];
  const [subs, setSubs] = useState(saved);
  const [newSub, setNewSub] = useState({ id: "", label: "" });
  const dirty = JSON.stringify(subs) === JSON.stringify(saved) ? false : true;
  const mine = d.accounts.filter((a) => a.mine);
  const usedBy = (id: string) => mine.filter((a) => a.coupangSubId === id);
  const valid = /^[A-Za-z0-9]{8,20}$/.test(newSub.id);
  type R = { id: string; label: string };
  const columns: RecordColumn<R>[] = [
    {
      key: "id",
      header: "채널 아이디 · 이름",
      mobile: "title",
      cell: (x) => (
        <div className="min-w-0">
          <code className="rounded bg-nd-sunken px-1.5 py-0.5 text-[13px] font-medium text-nd-fg">{x.id}</code>
          <div className="mt-0.5 max-w-[200px] truncate text-[13px] font-normal text-nd-fg-3" title={x.label}>{x.label || "이름 없음"}</div>
        </div>
      ),
    },
    {
      key: "acc",
      header: "연결 계정",
      cell: (x) => {
        const list = usedBy(x.id);
        return list.length ? <span className="text-[14px]">{list.map((a) => `${PLATFORM_LABEL[a.platform]} ${a.externalName}`).join(", ")}</span> : <span className="text-[13px] text-nd-fg-3">붙은 계정 없음</span>;
      },
    },
    {
      key: "st",
      header: "상태",
      className: "whitespace-nowrap",
      cell: (x) => (
        <span className="inline-flex items-center gap-1">
          {saved.some((s) => s.id === x.id) ? <Badge size="lg" tone="success">목록에 있음</Badge> : <Badge size="lg" tone="warning">저장 전</Badge>}
          <IconButton icon={Trash2} label={`${x.id} 지우기`} size="sm" onClick={() => setSubs(subs.filter((s) => s.id !== x.id))} />
        </span>
      ),
    },
  ];
  return (
    <StudioCard
      id="my-coupang-subids"
      className={cn("scroll-mt-24", className)}
      title="쿠팡 채널 아이디"
      description={`파트너스에 등록한 것만 · 최대 10개 · 지금 ${subs.length}개`}
      action={
        dirty ? (
          <Button size="sm" loading={busy === "subs"} onClick={() => void run("subs", async () => { await mutate("profile.saveMeta", { subIds: subs }); await refresh(); }, "채널 아이디를 저장했습니다.")}>
            목록 저장
          </Button>
        ) : undefined
      }
      flush
    >
      <RecordTable
        rows={subs}
        columns={columns}
        rowKey={(x) => x.id}
        ariaLabel="쿠팡 채널 아이디"
        className="[&>ul]:px-4"
        empty={<p className="px-5 pb-2 text-[13px] text-nd-fg-3 sm:px-6">아직 등록한 채널 아이디가 없습니다 — 채널별로 리포트를 나눠 보려면 파트너스에 등록한 아이디를 더하세요 (미등록 아이디는 정산 제외).</p>}
      />
      <div className="border-t border-nd-line px-5 py-4 sm:px-6">
        <FormRow className="grid-cols-1 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_auto]">
          <Field label="새 채널 아이디">
            <Input value={newSub.id} onChange={(e) => setNewSub({ ...newSub, id: e.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 20) })} placeholder="8~20자 영문·숫자" />
          </Field>
          <Field label="이름">
            <Input value={newSub.label} onChange={(e) => setNewSub({ ...newSub, label: e.target.value })} placeholder="예: 유튜브 쇼츠" />
          </Field>
          <FieldAction size="md">
            <Button variant="secondary" icon={Plus} disabled={!valid || subs.length >= 10} onClick={() => { setSubs([...subs.filter((x) => x.id !== newSub.id), newSub]); setNewSub({ id: "", label: "" }); }}>
              더하기
            </Button>
          </FieldAction>
        </FormRow>
        {dirty && <p className="mt-2 text-[13px] text-nd-warning-text">목록을 바꿨습니다 — 「목록 저장」 을 눌러야 반영됩니다.</p>}
      </div>
    </StudioCard>
  );
}

/** 내 YouTube 검색 키 (선택) — 없으면 회사 키 */
export function YoutubeKeyCard({ className }: { className?: string }) {
  const { data, refresh } = useShorts();
  const d = data!;
  const profile = d.profiles.find((x) => x.owner === d.me);
  const companyKey = d.status.youtubeSearch.configured;
  const { busy, run } = useAction();
  const [key, setKey] = useState("");
  const y = profile?.youtubeKey;
  return (
    <StudioCard
      id="my-youtube-key"
      className={cn("scroll-mt-24", className)}
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          내 YouTube 검색 키 <span className="text-[13px] font-normal text-nd-fg-3">(선택)</span>
          {y?.configured ? <Badge size="lg" tone="success">끝 {y.hint}</Badge> : <Badge size="lg">{companyKey ? "회사 키 사용 중" : "없음"}</Badge>}
        </span>
      }
      description="내 Google Cloud 프로젝트의 키 — 검색 한도(하루 100회)를 회사 키와 따로 씁니다"
    >
      <FormRow className="grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <Field label="YouTube Data API 키">
          <Input type="password" autoComplete="off" value={key} placeholder={y?.configured ? `•••• ${y.hint ?? ""} · 바꿀 때만 입력` : ""} onChange={(e) => setKey(e.target.value.trim())} />
        </Field>
        <FieldAction size="md">
          <Button icon={Link2} disabled={!key} loading={busy === "y"} onClick={() => void run("y", async () => { await mutate("profile.saveYoutubeKey", { key }); setKey(""); await refresh(); }, "저장했습니다.")}>
            저장
          </Button>
        </FieldAction>
        <FieldAction size="md">
          <Button variant="ghost" icon={Trash2} disabled={!y?.configured} loading={busy === "yd"} onClick={() => void run("yd", async () => { await mutate("profile.saveYoutubeKey", { key: "" }); await refresh(); })}>
            지우기
          </Button>
        </FieldAction>
      </FormRow>
    </StudioCard>
  );
}
