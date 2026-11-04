"use client";

// ============================================================
//  사용자별 현황 — ERP 사용자마다 채널 세트 · 프로젝트 · 게시 · 성과를 한 줄로
// ------------------------------------------------------------
//  관리자(NEANDER_SHORTS_ADMIN_EMAILS)는 모든 사용자를 본다 (비공개 포함 · 읽기 전용).
//  일반 사용자는 자기 줄만 — 남의 채널 · 쿠팡 키 상태 · 실적은 관리자만 본다.
//  이름을 누르면 위쪽 「보기」 가 그 사람으로 바뀌어 다른 화면도 그 사람의 것만 보인다.
//  쿠팡 키는 상태만 보인다 — 키 값은 서버 밖으로 나오지 않는다.
//
//  2026-11 목업 개편: 맨 위 「AI STUDIO 사용자 · 관리자」(접근 설정 · 관리자만)와
//  아래 「사람별 제작 · 성과」(실적)를 나눴다. 실적 표는 두 줄 칸 일곱 개로 줄였고
//  모바일에서는 이름이 붙은 카드로 바뀐다 (RecordTable).
// ============================================================

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Eye, RotateCcw, Save, ShieldCheck, Users } from "lucide-react";
import { Badge, Button, Checkbox, MemberAvatar, Money, cn } from "@/components/neander/ui";
import { useAppData } from "@/components/neander/app-data";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { Num, Unknown, fmtUsd, useAction } from "@/components/neander/shorts/parts";
import { RecordTable, SaveIndicator, StudioCard, StudioHeader, StudioNotice, type RecordColumn } from "@/components/neander/shorts/studio";
import { mutate } from "@/lib/neander/shorts/client";
import { fmtPct, perfRates, projectCost, projectTotals, type PerfTotals } from "@/lib/neander/shorts/model";
import { krwOf } from "@/lib/neander/shorts/radar";
import type { AccountView, ProfileView } from "@/lib/neander/shorts/types";
import { spaceOf } from "@/lib/neander/shorts/spaces";

/** 영상별 합계를 더한다 — 지표마다 아는 값만 더하고, 아무 영상도 모르면 null(미확인) */
function sumTotals(list: PerfTotals[]): PerfTotals {
  const out = { sources: new Set<string>() } as PerfTotals;
  const keys = ["views", "likes", "comments", "saves", "shares", "infoRequests", "clicks", "orders", "revenue"] as const;
  for (const k of keys) out[k] = list.some((t) => t[k] !== null) ? list.reduce((n, t) => n + (t[k] ?? 0), 0) : null;
  for (const t of list) for (const s of t.sources) out.sources.add(s);
  return out;
}

const KEY_LABEL = { none: ["쿠팡 키 없음", "neutral"], unverified: ["쿠팡 확인 전", "warning"], ok: ["쿠팡 확인됨", "success"], failed: ["쿠팡 확인 실패", "danger"] } as const;

type Access = NonNullable<NonNullable<ReturnType<typeof useShorts>["data"]>["access"]>;

interface PersonRow {
  total: false;
  email: string;
  videos: number;
  published: number;
  attention: number;
  scheduled: number;
  totals: PerfTotals;
  rates: ReturnType<typeof perfRates>;
  aiUsd: number;
  youtube: AccountView[];
  instagram: AccountView[];
  profile: ProfileView | undefined;
}
interface TotalLine {
  total: true;
  email: "__total__";
  people: number;
  videos: number;
  published: number;
  attention: number;
  scheduled: number;
  totals: Pick<PerfTotals, "views" | "infoRequests" | "clicks" | "orders" | "revenue">;
  aiUsd: number;
}
type Row = PersonRow | TotalLine;

export default function TeamPage() {
  const { data, viewer, setViewer, nameOf, space, currentSpace } = useShorts();
  const { members } = useAppData();
  const d = data!;
  const router = useRouter();

  // 관리자는 이 화면에 들어오면 모든 사용자의 것을 받는다
  useEffect(() => {
    if (d.admin && viewer === "mine") setViewer("visible");
  }, [d.admin, viewer, setViewer]);

  const people = useMemo<PersonRow[]>(() => {
    const emails = new Set<string>([d.me]);
    if (d.admin) {
      for (const m of members) if (m.email) emails.add(m.email.toLowerCase());
      for (const x of [...d.projects, ...d.accounts]) emails.add(x.owner);
      for (const p of d.profiles) emails.add(p.owner);
    }
    return [...emails]
      .map((email) => {
        // 지금 프로젝트의 것만 (대시보드가 전체)
        const projects = d.projects.filter((p) => p.owner === email && !p.sample && spaceOf(p) === space);
        const ids = new Set(projects.map((p) => p.id));
        const pubs = d.publications.filter((x) => ids.has(x.projectId));
        // projectTotals 는 영상 한 편 단위다 — 게시에 안 묶인 쿠팡 기록은 플랫폼 열쇠 하나로 모이므로
        // 여러 편을 한꺼번에 넣으면 마지막 한 편만 남는다. 영상마다 합친 뒤 더한다 (성과 비교와 같은 방식)
        const totals = sumTotals(projects.map((p) => projectTotals(d.metrics.filter((m) => m.projectId === p.id))));
        const accounts = d.accounts.filter((a) => a.owner === email && spaceOf(a) === space);
        return {
          total: false as const,
          email,
          videos: projects.length,
          published: pubs.filter((x) => x.status === "published").length,
          attention: pubs.filter((x) => x.status === "uncertain" || x.status === "failed").length,
          scheduled: pubs.filter((x) => x.status === "scheduled").length,
          totals,
          rates: perfRates(totals),
          aiUsd: projects.reduce((n, p) => n + projectCost(p).aiUsd, 0),
          youtube: accounts.filter((a) => a.platform === "youtube"),
          instagram: accounts.filter((a) => a.platform === "instagram"),
          profile: d.profiles.find((p) => p.owner === email),
        };
      })
      .sort((a, b) => (a.email === d.me ? -1 : b.email === d.me ? 1 : nameOf(a.email).localeCompare(nameOf(b.email), "ko")));
  }, [d, members, nameOf, space]);

  // 모르는 지표는 빼고 더한다 — 아무도 모르면 0 이 아니라 「미확인」
  const rows = useMemo<Row[]>(() => {
    if (people.length <= 1) return people;
    const sum = (k: "views" | "infoRequests" | "clicks" | "orders" | "revenue") =>
      people.some((r) => r.totals[k] !== null) ? people.reduce((n, r) => n + (r.totals[k] ?? 0), 0) : null;
    const total: TotalLine = {
      total: true,
      email: "__total__",
      people: people.length,
      videos: people.reduce((n, r) => n + r.videos, 0),
      published: people.reduce((n, r) => n + r.published, 0),
      attention: people.reduce((n, r) => n + r.attention, 0),
      scheduled: people.reduce((n, r) => n + r.scheduled, 0),
      totals: { views: sum("views"), infoRequests: sum("infoRequests"), clicks: sum("clicks"), orders: sum("orders"), revenue: sum("revenue") },
      aiUsd: people.reduce((n, r) => n + r.aiUsd, 0),
    };
    return [...people, total];
  }, [people]);

  const open = (email: string) => {
    setViewer(email === d.me ? "mine" : email);
    router.push("/neander/shorts/projects");
  };
  // 역할 — 관리자만 접근 목록(access)을 받는다. 일반 사용자에게는 자기 줄의 「나」 만
  const isAdminEmail = (e: string) => (d.admin && d.access ? d.access.fixedAdmins.includes(e) || d.access.admins.includes(e) : e === d.me && d.admin);
  const roleOf = (e: string) => [e === d.me ? "나" : "", isAdminEmail(e) ? "관리자" : d.admin && d.access ? "일반 사용자" : ""].filter(Boolean).join(" · ");
  const member = (e: string) => members.find((m) => (m.email ?? "").toLowerCase() === e);
  const spaceName = currentSpace?.name ?? "지금 프로젝트";

  const columns: RecordColumn<Row>[] = [
    {
      key: "who",
      header: "사용자",
      mobile: "title",
      className: "min-w-[200px]",
      cell: (r) =>
        r.total ? (
          <span className="font-semibold">합계 · {r.people}명</span>
        ) : (
          <div className="flex min-w-0 items-center gap-2.5">
            <MemberAvatar name={nameOf(r.email)} color={member(r.email)?.color} avatar={member(r.email)?.avatar} className="h-8 w-8 text-[13px]" />
            <div className="min-w-0">
              <button type="button" className="text-left font-semibold text-nd-accent hover:underline" onClick={() => open(r.email)} title="이 사람의 것만 모아 보기">
                {nameOf(r.email)}
              </button>
              <div className="max-w-[220px] truncate text-[13px] font-normal text-nd-fg-3" title={r.email}>
                {[roleOf(r.email), r.email].filter(Boolean).join(" · ")}
              </div>
            </div>
          </div>
        ),
    },
    {
      key: "made",
      header: "영상 · 게시",
      align: "right",
      cell: (r) => (
        <TwoLine top={<b className="font-semibold">영상 {r.videos.toLocaleString("ko-KR")}</b>} bottom={`게시 ${r.published.toLocaleString("ko-KR")}건`} />
      ),
    },
    {
      key: "check",
      header: "확인 · 예약",
      align: "right",
      cell: (r) => (
        <TwoLine
          top={<span className={cn(r.attention > 0 && "font-semibold text-nd-warning-text")}>확인 필요 {r.attention.toLocaleString("ko-KR")}건</span>}
          bottom={`예약 ${r.scheduled.toLocaleString("ko-KR")}건`}
        />
      ),
    },
    {
      key: "views",
      header: "조회 · 주문",
      align: "right",
      cell: (r) => (
        <TwoLine
          top={<b className="font-semibold"><Num value={r.totals.views} /></b>}
          bottom={<>주문 {r.totals.orders === null ? <Unknown /> : `${r.totals.orders.toLocaleString("ko-KR")}건`}</>}
        />
      ),
    },
    {
      key: "rates",
      header: "정보 요청률 · 클릭률",
      align: "right",
      // 합계 줄은 건수만 — 사람마다 아는 지표가 달라 합친 비율은 섞인 값이 된다
      cell: (r) => (
        <TwoLine
          top={<CountRate label="정보 요청" value={r.totals.infoRequests} rate={r.total ? undefined : r.rates.infoRate} />}
          bottom={<CountRate label="클릭" value={r.totals.clicks} rate={r.total ? undefined : r.rates.ctr} />}
        />
      ),
    },
    {
      key: "money",
      header: "제휴 수익 · AI 비용",
      align: "right",
      cell: (r) => (
        <TwoLine
          top={r.totals.revenue === null ? <>수익 <Unknown /></> : <Money value={Math.round(r.totals.revenue)} flow="income" className="font-semibold" />}
          bottom={
            r.aiUsd > 0 ? (
              <span title={`AI 비용 ${fmtUsd(r.aiUsd)} (원은 환산)`}>
                AI <Money value={-krwOf(r.aiUsd)} flow="expense" /> <span className="text-nd-fg-3">({fmtUsd(r.aiUsd)})</span>
              </span>
            ) : (
              "AI 비용 없음"
            )
          }
        />
      ),
    },
    {
      key: "channels",
      header: "YouTube · Instagram · 쿠팡",
      mobileLabel: "채널 · 쿠팡",
      className: "min-w-[220px]",
      cell: (r) => (r.total ? <span className="text-nd-fg-3">—</span> : <ChannelCell r={r} />),
    },
  ];

  return (
    <div className="space-y-6">
      <StudioHeader
        kicker="사람별"
        kickerIcon={Users}
        title="사용자별 현황"
        description={`지금 프로젝트 「${spaceName}」 의 제작 · 게시 · 채널 연결을 사람별로 봅니다. 사람마다 자기 채널 세트(YouTube · Instagram · 쿠팡 파트너스)를 따로 둡니다.`}
      />

      {d.admin && d.access && <AccessCard access={d.access} />}

      {d.admin ? (
        <StudioNotice tone="info" icon={Eye} title="관리자 모아보기 · 다른 사람의 자료는 읽기 전용">
          영상과 소재는 기본 「나만 보기」 입니다. 이름을 누르면 위쪽 「보기」 가 그 사람으로 바뀌고, 남의 비공개 자료는 읽기만 합니다. 각자의 쿠팡 키는 상태만 보입니다 — 클릭수 · 전환율 · 수익금은 쿠팡 파트너스 기밀정보라 ERP 밖으로 공유하지 마세요.
        </StudioNotice>
      ) : (
        <StudioNotice tone="neutral" title="내 줄만 보입니다">
          모든 사용자의 현황은 AI STUDIO 관리자만 봅니다. 다른 사람의 팀 공개 영상은 위쪽 「보기」 에서 고를 수 있습니다.
        </StudioNotice>
      )}

      <StudioCard title="사람별 제작 · 성과" description={`「${spaceName}」 · 영상을 만든 사람 기준 · 게시는 플랫폼별 건수(영상 편수와 다릅니다)`} flush>
        <RecordTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.email}
          ariaLabel="사람별 제작 · 성과"
          rowClassName={(r) =>
            r.total
              ? "bg-nd-sunken/70 font-medium"
              : viewer === r.email || (viewer === "mine" && r.email === d.me)
                ? "bg-nd-accent-soft/50"
                : undefined
          }
          className="pb-1 md:pb-0 [&>ul]:px-4 [&>ul]:pb-4"
        />
      </StudioCard>
      <p className="text-[13px] leading-relaxed text-nd-fg-3">
        영상 소유자 기준 · 지금 프로젝트의 자료만 합산합니다 (출처별 마지막 기록 · 모르는 지표는 빼고 합 · 누구도 모르는 지표는 「미확인」). 쿠팡 주문 · 수익은 각자의 키로 각자의 리포트만 읽은 금액 그대로이고, AI 비용 원화는 달러를 환산한 값입니다.
      </p>
    </div>
  );
}

/** 두 줄 칸 — 위 주요 값 · 아래 보조 값 */
function TwoLine({ top, bottom }: { top: ReactNode; bottom: ReactNode }) {
  return (
    <div className="whitespace-nowrap leading-snug">
      <div className="text-[14px] text-nd-fg">{top}</div>
      <div className="mt-0.5 text-[13px] text-nd-fg-3">{bottom}</div>
    </div>
  );
}

/** 「정보 요청 34건 · 1.60%」 — 숫자를 모르면 「미확인」, 분모가 0 이면 비율은 「—」 */
function CountRate({ label, value, rate }: { label: string; value: number | null; rate?: number | null }) {
  if (value === null)
    return (
      <span>
        {label} <Unknown />
      </span>
    );
  return (
    <span className="nd-num">
      {label} {value.toLocaleString("ko-KR")}건{rate !== undefined && <> · {rate === null ? "—" : fmtPct(rate)}</>}
    </span>
  );
}

/** 게시 계정 상태 — 게시에 꼭 필요하다. 없으면 「연결 필요」 (빨강), 끊긴 것이 있으면 「다시 연결 필요」 */
function channelState(accounts: AccountView[]): { text: string; tone: "danger" | "success" } {
  if (!accounts.length) return { text: "연결 필요", tone: "danger" };
  if (accounts.some((a) => a.status === "needs_reauth")) return { text: "다시 연결 필요", tone: "danger" };
  return { text: accounts.map((a) => `${a.externalName}${a.coupangSubId ? ` · ${a.coupangSubId}` : ""}`).join(", "), tone: "success" };
}

function ChannelCell({ r }: { r: PersonRow }) {
  const k = r.profile?.coupang.status ?? "none";
  const subs = r.profile?.subIds.length ?? 0;
  const keyMeta = [r.profile?.coupang.afCode, subs ? `채널 아이디 ${subs}개` : ""].filter(Boolean).join(" · ");
  const line = (label: string, accounts: AccountView[]) => {
    const st = channelState(accounts);
    return (
      <div className="flex min-w-0 max-w-[260px] items-baseline gap-1.5 text-[13px] md:max-w-[240px]">
        <span className="shrink-0 text-nd-fg-3">{label}</span>
        <span className={cn("min-w-0 truncate", st.tone === "danger" ? "font-medium text-nd-danger-text" : "text-nd-fg")} title={st.text}>
          {st.text}
          {st.tone === "success" && accounts.length > 1 ? ` (${accounts.length})` : ""}
        </span>
      </div>
    );
  };
  return (
    <div className="flex min-w-0 flex-col items-end gap-1 md:items-start">
      {line("YouTube", r.youtube)}
      {line("Instagram", r.instagram)}
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 md:justify-start">
        <Badge size="lg" tone={KEY_LABEL[k][1]}>{KEY_LABEL[k][0]}</Badge>
        {keyMeta && <span className="max-w-[160px] truncate text-[13px] text-nd-fg-3" title={keyMeta}>{keyMeta}</span>}
      </div>
    </div>
  );
}

/**
 * AI STUDIO 사용자 · 관리자 — 관리자만 고친다. 배포 설정(환경변수)에 있는 사람은 「고정」.
 * 관리자는 모든 사람의 것과 대행 프로젝트(업체별)를 읽고, 프로젝트 보관 · 자동화 설정을 바꾼다.
 */
function AccessCard({ access }: { access: Access }) {
  const { members } = useAppData();
  const { data, refresh } = useShorts();
  const { busy, run } = useAction();
  const me = data!.me;
  const [users, setUsers] = useState<string[]>(access.users);
  const [admins, setAdmins] = useState<string[]>(access.admins);
  const people = members.filter((m) => m.email).map((m) => ({ name: m.name, email: (m.email ?? "").toLowerCase(), color: m.color, avatar: m.avatar }));
  const fixedAdmin = (e: string) => access.fixedAdmins.includes(e);
  const fixedUser = (e: string) => access.open || access.fixedUsers.includes(e) || fixedAdmin(e);
  const isAdmin = (e: string) => fixedAdmin(e) || admins.includes(e);
  const isUser = (e: string) => isAdmin(e) || fixedUser(e) || users.includes(e);
  const toggle = (list: string[], e: string, on: boolean) => (on ? [...new Set([...list, e])] : list.filter((x) => x !== e));
  const dirty = users.join() !== access.users.join() || admins.join() !== access.admins.join();
  // 저장된 값과 비교한 바뀐 사람 (꼬리표)
  const savedAdmin = (e: string) => fixedAdmin(e) || access.admins.includes(e);
  const savedUser = (e: string) => savedAdmin(e) || fixedUser(e) || access.users.includes(e);
  const changed = (e: string) => savedAdmin(e) !== isAdmin(e) || savedUser(e) !== isUser(e);
  const userCount = people.filter((p) => isUser(p.email)).length;
  const adminCount = people.filter((p) => isAdmin(p.email)).length;

  type P = (typeof people)[number];
  const columns: RecordColumn<P>[] = [
    {
      key: "who",
      header: "사용자",
      mobile: "title",
      cell: (p) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <MemberAvatar name={p.name} color={p.color} avatar={p.avatar} className="h-8 w-8 text-[13px]" />
          <div className="min-w-0">
            <div className="font-semibold text-nd-fg">{p.name}</div>
            <div className="truncate text-[13px] font-normal text-nd-fg-3" title={p.email}>{p.email}</div>
          </div>
        </div>
      ),
    },
    {
      key: "use",
      header: "AI STUDIO 사용",
      cell: (p) => (
        <Checkbox
          checked={isUser(p.email)}
          disabled={fixedUser(p.email) || isAdmin(p.email)}
          onChange={(e) => setUsers(toggle(users, p.email, e.target.checked))}
          label={<span className="text-[14px]">{isUser(p.email) ? "사용" : "사용 안 함"}</span>}
          aria-label={`${p.name} AI STUDIO 사용`}
        />
      ),
    },
    {
      key: "admin",
      header: "관리자",
      cell: (p) => (
        <Checkbox
          checked={isAdmin(p.email)}
          disabled={fixedAdmin(p.email) || (p.email === me && !fixedAdmin(me))}
          onChange={(e) => setAdmins(toggle(admins, p.email, e.target.checked))}
          label={<span className="text-[14px]">{isAdmin(p.email) ? "관리자" : "관리자 아님"}</span>}
          aria-label={`${p.name} 관리자`}
        />
      ),
    },
    {
      key: "why",
      header: "설정",
      cell: (p) => {
        const notes: string[] = [];
        if (fixedAdmin(p.email)) notes.push("관리자 고정 (배포 설정)");
        else if (fixedUser(p.email)) notes.push(access.open ? "팀원 누구나 사용" : "사용 고정 (배포 설정)");
        else if (isAdmin(p.email)) notes.push("관리자라서 사용");
        if (p.email === me && !fixedAdmin(me)) notes.push("나 — 스스로 못 뺌");
        return (
          <div className="flex flex-wrap items-center justify-end gap-1.5 md:justify-start">
            {fixedAdmin(p.email) || (fixedUser(p.email) && !access.open) ? <Badge size="lg" tone="neutral">고정</Badge> : null}
            {changed(p.email) && <Badge size="lg" tone="warning">바뀜 · 저장 전</Badge>}
            {notes.length > 0 && <span className="text-[13px] text-nd-fg-3">{notes.join(" · ")}</span>}
            {!notes.length && !changed(p.email) && <span className="text-[13px] text-nd-fg-3">여기서 바꿈</span>}
          </div>
        );
      },
    },
  ];

  const save = () =>
    void run(
      "save",
      async () => {
        await mutate("access.save", { users, admins });
        await refresh();
      },
      "AI STUDIO 사용자 · 관리자를 저장했습니다 — 1분 안에 반영됩니다.",
    );

  return (
    <StudioCard
      title={
        <span className="inline-flex items-center gap-2">
          <ShieldCheck size={17} aria-hidden className="text-nd-fg-3" />
          AI STUDIO 사용자 · 관리자
        </span>
      }
      description={`사용자 ${userCount}명 · 관리자 ${adminCount}명 · 「고정」 은 배포 설정이라 여기서 뺄 수 없습니다.`}
      action={
        dirty ? (
          <>
            <SaveIndicator state="dirty" />
            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => { setUsers(access.users); setAdmins(access.admins); }}>
              되돌리기
            </Button>
            <Button size="sm" icon={Save} loading={busy === "save"} onClick={save}>
              저장
            </Button>
          </>
        ) : (
          <SaveIndicator state={busy === "save" ? "saving" : "saved"} />
        )
      }
      flush
    >
      <RecordTable rows={people} columns={columns} rowKey={(p) => p.email} ariaLabel="AI STUDIO 사용자 · 관리자" className="[&>ul]:px-4 [&>ul]:pb-2" />
      <p className="border-t border-nd-line px-5 py-3 text-[13px] leading-relaxed text-nd-fg-3 sm:px-6">
        관리자는 모든 사람의 것과 대행 프로젝트(업체별)를 보고, 프로젝트 보관 · 자동화 설정을 바꿉니다. 관리자는 사용자이기도 합니다. 저장하면 1분 안에 모든 서버에 반영됩니다.
      </p>
    </StudioCard>
  );
}
