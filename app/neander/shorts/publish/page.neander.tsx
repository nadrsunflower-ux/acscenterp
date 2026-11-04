"use client";

// ============================================================
//  게시 현황 — 지금 프로젝트의 게시를 플랫폼별 상태로. 결과 확인이 필요한 것을 맨 위에.
// ------------------------------------------------------------
//  밖에서(YouTube Studio · 인스타 앱) 올린 게시물도 자동으로 찾아 붙인다 (server/external.ts) — 위 카드 · 「다른 영상에 붙이기」.
//  2026-11 목업 개편: 머무는 안내(확인 필요) → 자동 연결 카드(계정별 상태 꼬리표) → 상태 탭 9개(0건도 유지) →
//  표(영상 · 플랫폼·계정 · 상태 · 결과·다음 행동 · 예약·갱신) — 모바일은 카드 목록(RecordTable).
//  영상 편수 ≠ 플랫폼별 게시 건수 — 탭 숫자는 게시 건수다.
// ============================================================

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, ArrowUpRight, Camera, ClipboardCheck, FolderOpen, Info, Link2, Plug, RefreshCw, RotateCcw, Send, SquarePlay } from "lucide-react";
import { Badge, Button, Dialog, EmptyState, Field, PageShell, Select, Tabs, buttonClass, cn, useToast, type Tone } from "@/components/neander/ui";
import { useScoped, useShorts } from "@/components/neander/shorts/ShortsProvider";
import { KindTile, PubBadge, fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { RecordTable, StudioCard, StudioHeader, StudioNotice, type RecordColumn } from "@/components/neander/shorts/studio";
import { shortsPost } from "@/lib/neander/shorts/client";
import type { ExternalAccountStatus } from "@/lib/neander/shorts/external";
import { PLATFORM_LABEL } from "@/lib/neander/shorts/model";
import type { AccountView, PublicationStatus, PublicationView } from "@/lib/neander/shorts/types";
import { spaceOf } from "@/lib/neander/shorts/spaces";

const ORDER: PublicationStatus[] = ["uncertain", "failed", "uploading", "processing", "queued", "scheduled", "published", "cancelled"];
const TAB_LABEL: Record<PublicationStatus, string> = {
  uncertain: "확인 필요",
  failed: "실패",
  uploading: "전송 중",
  processing: "처리 중",
  queued: "대기",
  scheduled: "예약",
  published: "게시됨",
  cancelled: "취소",
};
const ACCOUNTS_HREF = "/neander/shorts/accounts";
const videoHref = (projectId: string) => `/neander/shorts/projects/${projectId}?tab=publish`;
/** 결과 칸의 다음 행동 (링크 · 버튼 같은 모양 · 손가락 높이 32px) */
const ACTION_LINK = "mt-1 inline-flex min-h-[32px] items-center gap-1.5 text-[13px] font-medium text-nd-accent hover:underline";

/** 탭 이름 + 건수 (13px — 탭 기본 꼬리표보다 크게) */
const tabLabel = (label: string, n: number) => (
  <>
    {label}
    <span className={cn("nd-num text-[13px] font-normal", n ? "text-nd-fg-3" : "text-nd-fg-4")}>{n.toLocaleString("ko-KR")}</span>
  </>
);

const PlatformIcon = ({ platform, className }: { platform: string; className?: string }) => {
  const I = platform === "youtube" ? SquarePlay : Camera;
  return <I size={18} aria-hidden className={cn("shrink-0 text-nd-fg-3", className)} />;
};

/** 자동 연결 계정 하나의 상태 — 연결 끊김 · 확인 오류 · 확인 전 · 정상 */
function syncState(r: ExternalAccountStatus, acc: AccountView | undefined): { label: string; tone: Tone } {
  if (acc?.status === "needs_reauth") return { label: "다시 연결 필요", tone: "danger" };
  if (r.error) return { label: "확인 오류", tone: "warning" };
  if (!r.checkedAt) return { label: "확인 전", tone: "neutral" };
  return { label: "정상", tone: "success" };
}

/** 밖에서 올린 게시물 자동 연결 — 계정별 마지막 확인 · 연결 수 · 오류 · 지금 확인 */
function ExternalCard({ me, all, onSynced }: { me: string; all: boolean; onSynced: () => Promise<void> }) {
  const { nameOf, data, space } = useShorts();
  // 지금 프로젝트에 붙은 계정만 보여 준다 (확인은 내 모든 계정을 한 번에 — 영상은 계정의 프로젝트로 간다)
  const hereIds = useMemo(() => new Set((data?.accounts ?? []).filter((a) => spaceOf(a) === space).map((a) => a.id)), [data, space]);
  const accById = useMemo(() => new Map((data?.accounts ?? []).map((a) => [a.id, a])), [data]);
  const { busy, run } = useAction();
  const toast = useToast();
  const [rows, setRows] = useState<ExternalAccountStatus[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    setFailed(false);
    const r = await shortsPost<{ accounts: ExternalAccountStatus[] }>("publish", { action: "external.status", scope: all ? "all" : "mine" }).catch(() => null);
    if (!r) setFailed(true);
    setRows(r?.accounts ?? []);
  }, [all]);
  useEffect(() => {
    void load();
  }, [load]);
  const shown = rows ? rows.filter((r) => hereIds.has(r.accountId)) : null;
  const mine = (rows ?? []).filter((r) => r.owner === me);
  const sync = () =>
    void run("sync", async () => {
      const r = await shortsPost<{ imported: number; accounts: ExternalAccountStatus[] }>("publish", { action: "external.sync" });
      setRows(all ? ((await shortsPost<{ accounts: ExternalAccountStatus[] }>("publish", { action: "external.status", scope: "all" }).catch(() => null))?.accounts ?? r.accounts) : r.accounts);
      await onSynced();
      toast.success(r.imported ? `새로 올린 게시물 ${r.imported}건을 연결했습니다.` : "새로 연결할 게시물이 없습니다.");
    });
  if (!failed && shown && !shown.length && !mine.length) return null;
  return (
    <StudioCard
      className="mb-6"
      title="밖에서 올린 게시물 자동 연결"
      description="YouTube Studio · 인스타 앱에서 직접 올린 것도 매일 아침 찾아 영상에 붙이고 성과를 받아 옵니다 · 같은 영상을 두 곳에 올렸으면 한 영상으로 묶습니다"
      action={
        mine.length > 0 && (
          <Button size="sm" variant="secondary" icon={RefreshCw} loading={busy === "sync"} onClick={sync} title="내 모든 계정을 지금 확인합니다">
            지금 확인
          </Button>
        )
      }
    >
      {failed ? (
        <StudioNotice
          tone="warning"
          title="자동 연결 상태를 불러오지 못했습니다"
          action={
            <Button size="sm" variant="secondary" icon={RotateCcw} onClick={() => void load()}>
              다시 시도
            </Button>
          }
        >
          게시 기록은 아래 표에 그대로 있습니다. 잠시 뒤 다시 시도해 주세요.
        </StudioNotice>
      ) : shown === null ? (
        <div className="grid gap-3 sm:grid-cols-2" aria-busy="true">
          <p className="sr-only" role="status">불러오는 중…</p>
          {[0, 1].map((k) => (
            <div key={k} className="h-[92px] animate-pulse rounded-nd-md bg-nd-sunken" />
          ))}
        </div>
      ) : !shown.length ? (
        <p className="text-nd-body text-nd-fg-3">
          이 프로젝트에 붙은 계정이 없습니다 — 「내 채널 · 연결」 에서 계정의 프로젝트를 고르세요. 「지금 확인」 은 내 모든 계정을 확인합니다.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {shown.map((r) => {
            const acc = accById.get(r.accountId);
            const st = syncState(r, acc);
            return (
              <li key={r.accountId} className="min-w-0 rounded-nd-md border border-nd-line bg-nd-sunken/60 px-4 py-3">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                  <PlatformIcon platform={r.platform} />
                  <p className="min-w-0 truncate text-[14px] font-semibold text-nd-fg" title={r.name}>
                    {PLATFORM_LABEL[r.platform]} · {r.name}
                    {r.owner !== me && <span className="font-normal text-nd-fg-3"> ({nameOf(r.owner)})</span>}
                  </p>
                  <Badge tone={st.tone} size="lg">
                    {st.label}
                  </Badge>
                </div>
                <p className="mt-1.5 text-[13px] text-nd-fg-3">
                  {r.checkedAt ? (
                    <>
                      마지막 확인 <span className="nd-num">{fmtWhen(r.checkedAt)}</span>
                    </>
                  ) : (
                    "아직 확인 전 — 내일 아침 또는 「지금 확인」"
                  )}{" "}
                  · 연결 <span className="nd-num">{r.linked.toLocaleString("ko-KR")}</span>건
                </p>
                {r.error && <p className="mt-0.5 text-[13px] text-nd-danger-text [overflow-wrap:anywhere]">{r.error}</p>}
                {acc?.status === "needs_reauth" && (
                  <>
                    <p className="mt-0.5 text-[13px] text-nd-fg-2">인증이 끝났습니다 — 계정을 다시 연결한 뒤 확인하세요.</p>
                    <Link href={ACCOUNTS_HREF} className={ACTION_LINK}>
                      <Link2 size={15} aria-hidden />
                      다시 연결
                    </Link>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </StudioCard>
  );
}

/** 밖에서 올린 게시를 다른 영상으로 — 잘못 붙었을 때 · ERP 에서 기획한 영상에 붙일 때. 옮기는 범위 · 대상 · 결과를 한 창에 */
function AttachDialog({ pub, onClose, onDone }: { pub: PublicationView | null; onClose: () => void; onDone: () => Promise<void> }) {
  const { data } = useShorts();
  const sc = useScoped();
  const { busy, run } = useAction();
  const [target, setTarget] = useState("new");
  useEffect(() => setTarget("new"), [pub?.id]);
  const options = sc.projects.filter((p) => p.owner === data?.me && p.id !== pub?.projectId && !p.sample);
  const current = sc.projects.find((p) => p.id === pub?.projectId);
  const targetProject = target === "new" ? null : options.find((p) => p.id === target) ?? null;
  // 함께 옮겨지는 성과 기록 (이 게시물에 붙은 것) · 옮긴 뒤 대상 영상의 게시 기록
  const metricCount = pub ? (data?.metrics ?? []).filter((m) => m.publicationId === pub.id).length : 0;
  const targetPubs = targetProject ? (data?.publications ?? []).filter((p) => p.projectId === targetProject.id) : [];
  const pubName = pub ? pub.meta.title || pub.meta.caption.split("\n")[0] || pub.result?.externalId || "(제목 없음)" : "";
  const platformName = pub ? PLATFORM_LABEL[pub.platform] : "";
  const save = () =>
    void run(
      "attach",
      async () => {
        await shortsPost("publish", { action: "external.attach", publicationId: pub!.id, projectId: target });
        await onDone();
        onClose();
      },
      target === "new" ? "새 영상으로 떼어 냈습니다." : "다른 영상에 붙였습니다 — 성과 기록도 함께 옮겼습니다.",
    );
  const samePlatform = pub ? targetPubs.filter((p) => p.platform === pub.platform).length : 0;
  const after = targetProject
    ? [...targetPubs.map((p) => PLATFORM_LABEL[p.platform]), platformName]
    : [platformName];
  return (
    <Dialog
      open={!!pub}
      onClose={onClose}
      title="다른 영상에 붙이기"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            닫기
          </Button>
          <Button icon={ArrowRight} loading={busy === "attach"} onClick={save}>
            옮기기
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <StudioNotice tone="info" title="게시 기록과 성과가 함께 이동해요">
          지금 「{current?.title ?? "(볼 수 없는 영상)"}」 에 붙어 있는 {platformName} 게시 「{pubName}」 를 옮깁니다. 이 게시의 성과 기록{" "}
          <span className="nd-num">{metricCount.toLocaleString("ko-KR")}</span>건도 같이 갑니다.
        </StudioNotice>
        <Field label="붙일 영상" hint="내 영상만 고를 수 있습니다 · 지금 프로젝트의 영상">
          <Select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="new">— 새 영상으로 따로</option>
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title || p.product || "(이름 없음)"}
              </option>
            ))}
          </Select>
        </Field>
        <div className="rounded-nd-md border border-nd-line bg-nd-sunken/60 px-4 py-3">
          <p className="flex items-center gap-2 text-[14px] font-semibold text-nd-fg">
            <Link2 size={16} aria-hidden className="text-nd-fg-3" />
            옮긴 뒤
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-nd-fg-2">
            {targetProject ? (
              <>
                「{targetProject.title || targetProject.product || "(이름 없음)"}」 의 게시 기록 <span className="nd-num">{after.length}</span>건 ({after.join(" · ")}) — 같은 영상의 플랫폼별 기록을 한곳에서 봅니다. 그 영상은 「게시됨」 단계가 됩니다.
              </>
            ) : (
              <>이 게시만 담은 새 영상을 만들어 따로 둡니다.</>
            )}{" "}
            {pub?.external?.autoProject ? "지금 붙은 영상은 자동으로 만든 것이라, 완성 파일 · 다른 게시가 없으면 옮긴 뒤 지웁니다." : "지금 붙은 영상은 그대로 남습니다."}
          </p>
        </div>
        {samePlatform > 0 && (
          <StudioNotice tone="warning" title={`그 영상에 이미 ${platformName} 게시가 ${samePlatform}건 있습니다`}>
            같은 영상을 한 계정에 두 번 올린 게 아니라면 다른 영상일 수 있습니다 — 제목 · 올린 때를 한 번 더 확인하세요.
          </StudioNotice>
        )}
      </div>
    </Dialog>
  );
}

/** 결과 · 다음 행동 칸 */
function ResultCell({ p, acc, me, onAttach }: { p: PublicationView; acc: AccountView | undefined; me: string; onAttach: (p: PublicationView) => void }) {
  const last = p.history.at(-1)?.msg;
  if (p.result) {
    return (
      <div className="min-w-0 text-left">
        {p.result.url ? (
          <a href={p.result.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 font-medium text-nd-accent hover:underline" title={p.result.url}>
            <span className="truncate">게시 링크 열기</span>
            <ArrowUpRight size={15} aria-hidden className="shrink-0" />
          </a>
        ) : (
          <p className="text-nd-fg-3">주소 기록 없음</p>
        )}
        <p className="text-[13px] text-nd-fg-3">
          {p.origin === "external" ? "밖에서 올림 · 자동 연결" : p.result.by === "manual" ? "직접 기록" : "API 확인"} · <span className="nd-num">{fmtWhen(p.result.at)}</span>
        </p>
        {p.origin === "external" && p.owner === me && (
          <button type="button" onClick={() => onAttach(p)} className={ACTION_LINK}>
            <Link2 size={15} aria-hidden />
            다른 영상에 붙이기
          </button>
        )}
      </div>
    );
  }
  const msg = p.error?.message;
  const head =
    p.status === "uncertain"
      ? "결과 확인 필요 — 플랫폼에서 올라갔는지 보고 결과를 기록하세요"
      : p.status === "failed"
        ? acc?.status === "needs_reauth"
          ? "계정 인증 만료 — 다시 연결 후 재시도"
          : "게시하지 못했습니다 — 영상의 게시 탭에서 다시 시도"
        : p.status === "uploading"
          ? "완성 파일을 플랫폼으로 보내는 중"
          : p.status === "processing"
            ? "플랫폼에서 영상을 처리하는 중"
            : p.status === "queued"
              ? "앞선 작업이 끝나면 시작합니다"
              : p.status === "scheduled"
                ? `${fmtWhen(p.scheduledAt)} 이후 게시 예정`
                : last || "예약을 취소했습니다";
  return (
    <div className="min-w-0 text-left">
      <p className={cn("text-[14px]", p.status === "uncertain" || p.status === "failed" ? "font-medium text-nd-fg" : "text-nd-fg-2")}>{head}</p>
      {msg && (
        <p className="line-clamp-2 text-[13px] text-nd-fg-3 [overflow-wrap:anywhere]" title={msg}>
          {msg}
        </p>
      )}
      {p.attempts > 1 && <p className="text-[13px] text-nd-fg-3">시도 {p.attempts}회</p>}
      {p.status === "uncertain" && (
        <Link href={videoHref(p.projectId)} className={ACTION_LINK}>
          <ClipboardCheck size={15} aria-hidden />
          결과 기록
        </Link>
      )}
      {p.status === "failed" &&
        (acc?.status === "needs_reauth" ? (
          <Link href={ACCOUNTS_HREF} className={ACTION_LINK}>
            <Plug size={15} aria-hidden />
            다시 연결
          </Link>
        ) : (
          <Link href={videoHref(p.projectId)} className={ACTION_LINK}>
            <RotateCcw size={15} aria-hidden />
            게시 탭 열기
          </Link>
        ))}
    </div>
  );
}

export default function PublishStatusPage() {
  const { data, nameOf, refresh } = useShorts();
  const d = data!;
  const sc = useScoped();
  const [filter, setFilter] = useState<"all" | PublicationStatus>("all");
  const [attachFor, setAttachFor] = useState<PublicationView | null>(null);
  const projectById = useMemo(() => new Map(sc.projects.map((p) => [p.id, p])), [sc.projects]);
  const accountById = useMemo(() => new Map(d.accounts.map((a) => [a.id, a])), [d.accounts]);
  const count = (s: PublicationStatus) => sc.publications.filter((p) => p.status === s).length;
  const uncertain = count("uncertain");
  const rows = [...sc.publications]
    .filter((p) => filter === "all" || p.status === filter)
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.updatedAt - a.updatedAt);
  // 상태 탭 9개는 0건이어도 늘 둔다 (어떤 상태가 있는지 한눈에)
  const tabs = [{ key: "all", label: tabLabel("전체", sc.publications.length) }, ...ORDER.map((s) => ({ key: s, label: tabLabel(TAB_LABEL[s], count(s)) }))];
  // 게시할 수 있는 연결된 계정이 하나도 없을 때만 알린다 (실제 연결 상태 기준)
  const noPublishAccount = !sc.accounts.some((a) => a.canPublish && a.status === "connected");

  const columns: RecordColumn<PublicationView>[] = [
    {
      key: "video",
      header: "영상",
      mobile: "title",
      className: "w-[28%] max-w-0",
      cell: (p) => {
        const project = projectById.get(p.projectId);
        const title = project?.title ?? "(볼 수 없는 영상)";
        const sub = project ? (project.kind === "brand" ? project.clientName || "고객사" : project.product || (project.kind === "general" ? "일반 영상" : "상품 미정")) : "";
        return (
          <div className="flex min-w-0 items-center gap-3">
            <KindTile kind={project?.kind ?? "coupang"} className="h-9 w-9" />
            <div className="min-w-0">
              <Link href={videoHref(p.projectId)} className="block truncate font-medium text-nd-fg hover:underline" title={title}>
                {title}
              </Link>
              {sub && (
                <p className="truncate text-[13px] font-normal text-nd-fg-3" title={sub}>
                  {sub}
                </p>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: "account",
      header: "플랫폼 · 계정",
      mobileLabel: "플랫폼",
      className: "w-[20%] max-w-0",
      cell: (p) => {
        const acc = accountById.get(p.accountId);
        const name = acc ? `${acc.externalName}${acc.owner !== d.me ? ` (${nameOf(acc.owner)})` : ""}` : "(공유 끊김)";
        return (
          <div className="flex min-w-0 items-center justify-end gap-2.5 md:justify-start">
            <PlatformIcon platform={p.platform} className="hidden md:block" />
            <div className="min-w-0">
              <p>{PLATFORM_LABEL[p.platform]}</p>
              <p className="truncate text-[13px] text-nd-fg-3" title={name}>
                {name}
              </p>
              {acc?.status === "needs_reauth" && (
                <Badge tone="danger" size="lg" className="mt-1">
                  다시 연결 필요
                </Badge>
              )}
            </div>
          </div>
        );
      },
    },
    { key: "status", header: "상태", className: "w-[120px] whitespace-nowrap", cell: (p) => <PubBadge status={p.status} size="lg" /> },
    {
      key: "result",
      header: "결과 · 다음 행동",
      mobileLabel: "결과",
      className: "w-[32%] max-w-0",
      cell: (p) => (
        <div className="flex justify-end md:block">
          <ResultCell p={p} acc={accountById.get(p.accountId)} me={d.me} onAttach={setAttachFor} />
        </div>
      ),
    },
    {
      key: "when",
      header: "예약 · 갱신",
      align: "right",
      mobileLabel: "예약 · 갱신",
      className: "whitespace-nowrap",
      cell: (p) =>
        p.status === "scheduled" ? (
          <span>
            {fmtWhen(p.scheduledAt)}
            <span className="ml-1 text-[13px] text-nd-fg-3">예약</span>
          </span>
        ) : (
          <span className="text-nd-fg-2">{fmtWhen(p.updatedAt)}</span>
        ),
    },
  ];

  return (
    <PageShell>
      <StudioHeader
        kicker="AI STUDIO 워크스페이스"
        kickerIcon={FolderOpen}
        title="게시 현황"
        description="계정별 게시 결과와 예약을 확인하고, 확인이 필요한 결과부터 처리하세요. 같은 계정 · 같은 완성 파일 · 같은 플랫폼은 한 번만 게시되고, 결과가 불확실한 게시는 자동으로 다시 올리지 않습니다."
        actions={
          <Link href={ACCOUNTS_HREF} className={buttonClass("secondary", "md", "gap-1.5")}>
            <Plug size={16} aria-hidden />
            내 채널 · 연결
          </Link>
        }
      />
      {uncertain > 0 && (
        <StudioNotice
          tone="warning"
          className="mb-4"
          title={`결과를 확인해야 하는 게시가 ${uncertain.toLocaleString("ko-KR")}건 있어요`}
          action={
            filter !== "uncertain" && (
              <Button size="sm" variant="secondary" onClick={() => setFilter("uncertain")}>
                확인 필요만 보기
              </Button>
            )
          }
        >
          같은 영상을 다시 올리기 전에 플랫폼(YouTube Studio · Instagram)에서 올라갔는지 보고, 그 영상의 게시 탭에서 「결과 기록」 을 남겨 주세요.
        </StudioNotice>
      )}
      {noPublishAccount && (
        <StudioNotice
          tone="neutral"
          icon={Plug}
          className="mb-4"
          action={
            <Link href={ACCOUNTS_HREF} className={buttonClass("secondary", "sm")}>
              내 채널 · 연결
            </Link>
          }
        >
          연결된 SNS 게시 계정이 없습니다 — 새 게시와 예약 실행에는 계정 연결이 필요합니다.
        </StudioNotice>
      )}
      <ExternalCard me={d.me} all={d.scope === "all"} onSynced={refresh} />
      <Tabs className="mb-4" items={tabs} value={filter} onChange={(k) => setFilter(k as typeof filter)} ariaLabel="게시 상태" />
      <StudioCard
        flush
        title="게시 기록"
        description={
          <span className="inline-flex items-center gap-1">
            <Info size={14} aria-hidden />
            플랫폼마다 한 줄 — 영상 한 편을 두 곳에 올리면 두 줄입니다
          </span>
        }
        bodyClassName="max-md:px-4 max-md:pb-4"
      >
        <RecordTable
          ariaLabel="게시 기록"
          rows={rows}
          columns={columns}
          rowKey={(p) => p.id}
          empty={
            <EmptyState
              compact
              className="mt-1 md:mx-6 md:mb-5"
              icon={Send}
              title={filter === "all" ? "게시 기록이 없습니다" : `「${TAB_LABEL[filter]}」 인 게시가 없습니다`}
              description={filter === "all" ? "영상의 게시 탭에서 게시하거나, 플랫폼에서 직접 올리면 위 자동 연결이 찾아 여기에 쌓습니다." : "다른 상태 탭을 보거나 「전체」 로 돌아가세요."}
              action={
                filter !== "all" && (
                  <Button size="sm" variant="secondary" onClick={() => setFilter("all")}>
                    전체 보기
                  </Button>
                )
              }
            />
          }
        />
      </StudioCard>
      <AttachDialog pub={attachFor} onClose={() => setAttachFor(null)} onDone={refresh} />
    </PageShell>
  );
}
