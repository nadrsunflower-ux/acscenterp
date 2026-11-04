"use client";

// ============================================================
//  게시 탭 — 게시 설정 · 완성 파일 · 계정 · 정책 점검 · 게시(지금 / 예약) · 게시 기록
// ------------------------------------------------------------
//  정책 확인은 두 칸이다: 프로그램이 확인한 것(서버가 게시 직전에 다시 계산)과
//  사람이 확인한 것(누가 · 언제). 둘을 섞어 「확인됨」 하나로 보이지 않는다.
//  게시 문구 첫 줄은 언제나 표준 고지다 (buildCaption 이 맨 앞에 붙인다).
//  같은 계정 · 같은 완성 파일 · 같은 플랫폼은 한 번만 게시된다 (서버 원장).
//  결과가 불확실하면 자동으로 다시 올리지 않는다 — 사람이 플랫폼에서 보고 기록한다.
//  업체 계약이 「완성 파일만 납품」(client.delivery = file) 이면 계정 대신 승인 파일 · 전달 기록을 먼저.
// ============================================================

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { BarChart3, CircleCheck, CircleDashed, CircleX, Clapperboard, Copy, Download, ExternalLink, Plug, Send } from "lucide-react";
import { Badge, Button, Checkbox, Dialog, Disclosure, EmptyState, Field, FieldAction, FormRow, Input, Select, Textarea, buttonClass, cn, useToast } from "@/components/neander/ui";
import { downloadMedia, mutate, notePendingJobs, safeFileName, shortsPost } from "@/lib/neander/shorts/client";
import { CAPTION_LIMIT, DISCLOSURE, INSTAGRAM_MAX_BYTES, PLATFORM_LABEL, PUBLICATION_LABEL, TITLE_LIMIT, buildCaption, captionLength, complianceBlockers, complianceItemsFor, disclosureLine, fmtSec, hashtagLine } from "@/lib/neander/shorts/model";
import { CLIENT_DELIVERY_LABEL, type AccountView, type ComplianceCheck, type ComplianceKey, type MediaView, type PublicationView, type PublishPlatform } from "@/lib/neander/shorts/types";
import { spaceOf } from "@/lib/neander/shorts/spaces";
import { useShorts } from "../ShortsProvider";
import { ConnBadge, PubBadge, fmtWhen, useAction } from "../parts";
import { MediaUpload, useBlobUrl, useProjectMedia } from "../media";
import { RecordTable, StudioCard, StudioNotice, type RecordColumn } from "../studio";
import type { Draft } from "../useProjectDraft";

interface Prepared {
  platform: PublishPlatform;
  title: string;
  caption: string;
  captionLength: number;
  captionLimit: number;
  checks: Partial<Record<ComplianceKey, ComplianceCheck>>;
  blockers: { key: ComplianceKey; label: string; reason: string }[];
  problems: string[];
  existing: PublicationView | null;
}

export function PublishTab({ draft }: { draft: Draft }) {
  const { p, update, flush } = draft;
  const { data, refresh, nameOf } = useShorts();
  const d = data!;
  const toast = useToast();
  const { busy, run } = useAction();
  const { media, loading: mediaLoading, refresh: refreshMedia, error: mediaError, retry: retryMedia } = useProjectMedia(p.id);
  // 게시할 수 있는 것 = 내용이 남은 완성 파일 · 게시 뒤 지운 것은 기록(링크)으로만
  const allRenders = media.filter((m) => m.kind === "render" && p.renderIds.includes(m.id)).sort((a, b) => b.createdAt - a.createdAt);
  const renders = allRenders.filter((m) => !m.purged);
  const purgedRenders = allRenders.filter((m) => m.purged);
  const storage = d.status.storage;
  // 브랜드 영상: 그 고객사 계정 + 우리 채널 · 쿠팡 영상: 고객사 계정은 빼고
  // 이 영상의 프로젝트에 붙은 계정만 — 고객사 영상은 그 고객사 계정(프로젝트와 상관없이)도
  const accounts = d.accounts.filter((a) => a.canPublish && (p.kind === "brand" ? a.clientId === p.clientId || (!a.clientId && spaceOf(a) === spaceOf(p)) : !a.clientId && spaceOf(a) === spaceOf(p)));
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [renderId, setRenderId] = useState(renders[0]?.id ?? "");
  const [prep, setPrep] = useState<Prepared | null>(null);
  const [when, setWhen] = useState("");
  const pubs = d.publications.filter((x) => x.projectId === p.id);
  const account = accounts.find((a) => a.id === accountId);
  const platform: PublishPlatform = account?.platform ?? "youtube";
  const ownBrandAccount = p.kind === "brand" && !!account?.clientId && account.clientId === p.clientId;
  const caption = useMemo(() => buildCaption(p, platform, { ownBrandAccount }), [p, platform, ownBrandAccount]);
  const items = complianceItemsFor(p, ownBrandAccount);
  const titleLen = [...(p.publish.title || p.title)].length;
  const selectedRender = renders.find((r) => r.id === (renderId || renders[0]?.id)) ?? null;
  // 남은 확인 — 마지막 「게시 전 점검」 의 프로그램 확인과 지금 사람 확인으로 (서버가 게시 직전에 다시 계산한다)
  const remaining = complianceBlockers(
    Object.fromEntries(items.map((it) => [it.key, { system: prep?.checks[it.key]?.system ?? p.compliance[it.key]?.system ?? null, user: p.compliance[it.key]?.user ?? null }])),
    items,
  );
  const required = items.filter((it) => it.required).length;
  const passed = Math.max(0, required - remaining.length);
  const checkedOnce = items.some((it) => (prep?.checks[it.key]?.system ?? p.compliance[it.key]?.system) != null);
  const ready = !!prep && !prep.problems.length && !prep.blockers.length;
  const blockedWhy = !accounts.length
    ? "게시할 계정이 연결되지 않아 게시할 수 없습니다."
    : !renders.length
      ? "완성 파일이 없어 게시할 수 없습니다."
      : !prep
        ? "「게시 전 점검」 을 먼저 하세요 — 통과하면 게시 버튼이 켜집니다."
        : prep.problems.length || prep.blockers.length
          ? "점검에서 막힌 항목을 해결해야 게시할 수 있습니다."
          : null;

  const prepare = () =>
    run("prep", async () => {
      await flush();
      const r = await shortsPost<Prepared>("publish", { action: "prepare", projectId: p.id, accountId, renderId: renderId || renders[0]?.id });
      setPrep(r);
      // 서버가 프로그램 확인 칸을 다시 적었다 — 화면 사본도 받는다
      const { project } = await mutate<{ project: typeof p }>("project.get", { id: p.id });
      draft.replace(project);
      return r;
    });

  // 다른 도구로 다 만든 영상 — 서버가 영상의 완성 파일 목록에 넣는다
  const onDirectUpload = async (ms: MediaView[]) => {
    await refreshMedia();
    const { project } = await mutate<{ project: typeof p }>("project.get", { id: p.id });
    draft.replace(project);
    if (ms[0]) setRenderId(ms[0].id);
    setPrep(null);
    toast.success("완성 파일을 올렸습니다 — 「게시 전 점검」 뒤 게시하세요.");
  };

  const publish = (scheduledAt: number | null) =>
    run("pub", async () => {
      await flush();
      await shortsPost("publish", { action: "create", projectId: p.id, accountId, renderId: renderId || renders[0]?.id, scheduledAt });
      notePendingJobs(scheduledAt ? scheduledAt + 3600_000 : undefined);
      await refresh();
      setPrep(null);
    }, scheduledAt ? "예약했습니다 — 예약 시각 이후 실행기가 게시합니다 (아직 게시 전)." : "게시 대기열에 넣었습니다. 실행기가 전송합니다.");

  const userCheck = (key: ComplianceKey, ok: boolean, note?: string) =>
    update((x) => {
      const cur = x.compliance[key] ?? { system: null, user: null };
      x.compliance[key] = { system: cur.system, user: ok ? { ok: true, by: d.me, at: Date.now(), note: note ?? cur.user?.note ?? "" } : null };
    });

  // 업체가 「완성 파일만 납품」 이면 게시는 고객사가 한다 — 우리는 승인된 파일을 넘긴다
  const client = p.kind === "brand" ? d.clients.find((c) => c.id === p.clientId) ?? null : null;
  const fileOnly = p.kind === "brand" && client?.delivery === "file";

  // 「광고」 고지 — 게시 문구 첫 줄은 buildCaption 이 정한다 (여기서는 무엇이 붙는지 보여만 준다)
  const discloses = p.kind === "coupang" || (p.kind === "brand" && !ownBrandAccount);
  const disclosureText =
    p.kind === "general"
      ? "광고 아님 — 고지 문구 없음"
      : p.kind === "brand" && ownBrandAccount
        ? "고객사 자기 광고 — 고지 문구 없음"
        : `${caption.split("\n")[0] || "고지"} (설명 첫 줄에 저절로)`;

  // ---- 조각 ---------------------------------------------------------------

  const settingsCard = (
    <StudioCard title={fileOnly ? "게시 설정 · 고객사에 함께 넘길 문구" : "게시 설정"} description={fileOnly ? "게시는 고객사가 합니다 — 제목 · 설명 · 해시태그를 정리해 문구로 넘기세요" : undefined}>
      <div className="space-y-4">
        <Field label="제목" error={titleLen > TITLE_LIMIT ? `${TITLE_LIMIT}자 이하 (${titleLen}자)` : undefined} hint={`YouTube 제목 · Instagram 은 캡션만 씁니다 · ${titleLen}/${TITLE_LIMIT}자`}>
          <Input value={p.publish.title} placeholder={p.title} onChange={(e) => update((x) => void (x.publish.title = e.target.value))} />
        </Field>
        <Field label="설명 (고지 문구는 맨 앞에 저절로 붙습니다)">
          <Textarea rows={4} value={p.publish.description} onChange={(e) => update((x) => void (x.publish.description = e.target.value))} />
        </Field>
        <Field label="해시태그 (쉼표)"><Input value={p.publish.hashtags.join(", ")} onChange={(e) => update((x) => void (x.publish.hashtags = e.target.value.split(",").map((s) => s.trim()).filter(Boolean)))} /></Field>
        <FormRow className="grid-cols-1 sm:grid-cols-2">
          <Field label="공개 범위 (YouTube)">
            <Select value={p.publish.privacy} onChange={(e) => update((x) => void (x.publish.privacy = e.target.value as typeof x.publish.privacy))}>
              <option value="private">비공개</option>
              <option value="unlisted">일부 공개</option>
              <option value="public">공개</option>
            </Select>
          </Field>
          <Field label="아동용 콘텐츠 (YouTube 필수)">
            <Select value={p.publish.madeForKids ? "yes" : "no"} onChange={(e) => update((x) => void (x.publish.madeForKids = e.target.value === "yes"))}>
              <option value="no">아니요 (아동용 아님)</option>
              <option value="yes">예 (아동용)</option>
            </Select>
          </Field>
          <Field label="AI 합성 콘텐츠" hint="YouTube containsSyntheticMedia · Instagram is_ai_generated — 정해야 게시할 수 있습니다" error={p.publish.synthetic === null ? "골라 주세요" : undefined}>
            <Select value={p.publish.synthetic === null ? "" : p.publish.synthetic ? "yes" : "no"} onChange={(e) => update((x) => void (x.publish.synthetic = e.target.value === "" ? null : e.target.value === "yes"))}>
              <option value="">(정하지 않음)</option>
              <option value="yes">있음 — AI 로 만든 실제 같은 장면 포함</option>
              <option value="no">없음</option>
            </Select>
          </Field>
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-nd-caption font-medium text-nd-fg-2">「광고」 고지</span>
            <div className={cn("flex min-h-ctl-md min-w-0 items-center rounded-nd-md border border-nd-line bg-nd-sunken px-3 py-1.5 text-nd-body", discloses ? "text-nd-fg" : "text-nd-fg-2")}>
              <span className="min-w-0 break-keep">{disclosureText}</span>
            </div>
            <span className="text-[13px] text-nd-fg-3">
              {p.kind === "general" ? "제휴 · 협찬이 생기면 영상 종류를 바꿔 주세요" : `영상 안 띠 ${p.output.disclosureOverlay ? "켜짐" : "꺼짐"} · 「편집·출력」 에서 바꿉니다`}
            </span>
          </div>
        </FormRow>
        {p.scenes.some((s) => s.kind === "ai" && s.ai?.status === "approved") && p.publish.synthetic === false && (
          <StudioNotice tone="warning">승인된 AI 장면이 있는데 「없음」 으로 골랐습니다. 실제처럼 보이는 장면이면 「있음」 이 맞습니다.</StudioNotice>
        )}

        <div className="rounded-nd-md border border-nd-line bg-nd-sunken/60 p-3.5">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-nd-body font-semibold text-nd-fg">게시 문구 미리보기 · {PLATFORM_LABEL[platform]}</span>
            <span className="nd-num text-[13px] text-nd-fg-3">
              {captionLength(caption, platform).toLocaleString("ko-KR")} / {CAPTION_LIMIT[platform].toLocaleString("ko-KR")}
              {platform === "youtube" ? "바이트" : "자"}
            </span>
            <Button size="sm" variant="secondary" icon={Copy} className="ml-auto" onClick={() => void navigator.clipboard.writeText(caption).then(() => toast.success("복사했습니다."))}>복사</Button>
          </div>
          {caption ? <pre className="whitespace-pre-wrap break-words font-sans text-nd-body leading-relaxed text-nd-fg">{caption}</pre> : <p className="text-nd-body text-nd-fg-3">아직 붙을 문구가 없습니다 — 설명 · 해시태그를 적으면 여기에 게시 문구가 만들어집니다.</p>}
          {platform === "instagram" && p.coupang.affiliate && <p className="mt-2 text-[13px] text-nd-fg-3">Instagram 캡션의 링크는 눌리지 않아 넣지 않았습니다 — 프로필 링크 · 댓글 키워드 CTA 를 쓰세요.</p>}
        </div>
      </div>
    </StudioCard>
  );

  const fileAccountCard = (
    <StudioCard title="완성 파일 · 계정">
      <div className="space-y-4">
        {renders.length === 0 ? (
          <EmptyState
            compact
            icon={Clapperboard}
            title={mediaLoading ? "파일 목록을 불러오는 중…" : "완성 파일이 없습니다"}
            description="다른 도구로 다 만든 MP4 를 아래에 올리거나, 「편집·출력」 탭에서 출력하세요."
            action={<Link href={`/neander/shorts/projects/${p.id}?tab=edit`} scroll={false} className={buttonClass("secondary", "sm")}>편집·출력으로</Link>}
          />
        ) : (
          <div className="space-y-3">
            {renders.length > 1 && (
              <Field label="게시할 완성 파일">
                <Select value={renderId || renders[0]?.id} onChange={(e) => { setRenderId(e.target.value); setPrep(null); }}>
                  {renders.map((r) => <option key={r.id} value={r.id}>{fmtWhen(r.createdAt)} · {r.direct ? "직접 올림 · " : ""}{r.duration?.toFixed(1)}초 · {r.codecs?.video}/{r.codecs?.audio}{r.overlay?.disclosure ? " · 고지 띠" : ""}</option>)}
                </Select>
              </Field>
            )}
            {selectedRender && <RenderInfo r={selectedRender} />}
          </div>
        )}
        <MediaUpload
          projectId={p.id}
          kind="render"
          direct
          compact
          multiple={false}
          title="다 만든 영상 올리기 (MP4)"
          hint={
            storage.bucket.ready
              ? `하나 ${storage.renderMaxMb}MB 까지 · 저장소에 잠깐 두고 게시가 끝나면 지웁니다`
              : `지금은 하나 ${storage.renderMaxMb}MB 까지 (Firebase Storage 를 켜면 500MB) · 게시가 끝나면 지웁니다`
          }
          onUploaded={(ms) => void onDirectUpload(ms)}
        />
        <div>
          <Checkbox label={<span className="text-nd-body">게시가 끝나도 완성 파일 남기기</span>} checked={!!p.publish.keepFiles} onChange={(e) => update((x) => void (x.publish.keepFiles = e.target.checked))} />
          <p className="mt-1 text-[13px] leading-relaxed text-nd-fg-3">
            {p.publish.keepFiles
              ? "이 영상의 완성 파일은 게시 뒤에도 서버에 남습니다. 다 쓰면 「편집·출력」 탭에서 직접 지워 주세요."
              : "끄면(기본) 연결된 채널(YouTube · Instagram)에 모두 올라가는 대로 서버에서 지우고 게시물 링크로 봅니다. 한쪽에만 올렸으면 다른 쪽에 마저 올릴 수 있게 하루 뒤에, 아무 데도 안 올린 파일은 7일 뒤 지웁니다. 실패하거나 결과 확인이 필요한 게시가 있으면 다시 시도할 수 있게 남깁니다."}
          </p>
        </div>
        {purgedRenders.length > 0 && (
          <div className="border-t border-nd-line pt-3">
            <h4 className="mb-1.5 text-nd-body font-semibold text-nd-fg">게시 뒤 지운 파일 {purgedRenders.length}개</h4>
            <ul className="space-y-1.5">
              {purgedRenders.map((r) => {
                const links = pubs.filter((x) => x.renderId === r.id && x.result?.url);
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-nd-fg-2">
                    <span className="min-w-0 max-w-[16rem] truncate" title={r.name}>{r.name}</span>
                    <span className="nd-num text-nd-fg-3">{r.purged ? fmtWhen(r.purged.at) : ""} 지움</span>
                    {links.length ? (
                      links.map((x) => (
                        <a key={x.id} href={x.result!.url!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-nd-accent hover:underline">
                          {PLATFORM_LABEL[x.platform]}에서 보기 <ExternalLink size={13} aria-hidden />
                        </a>
                      ))
                    ) : (
                      <span className="text-nd-fg-3">{r.purged?.reason === "expired" ? "7일 동안 게시하지 않아 지움" : "게시 링크 없음"}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="border-t border-nd-line pt-4">
          <h4 className="mb-2 text-nd-body font-semibold text-nd-fg">게시 계정 (연결 상태)</h4>
          <ul className="divide-y divide-nd-line rounded-nd-md border border-nd-line">
            {(["youtube", "instagram"] as const).map((pf) => (
              <ChannelRow key={pf} platform={pf} accounts={accounts.filter((a) => a.platform === pf)} serverOk={(pf === "youtube" ? d.status.youtubeOAuth.configured : d.status.meta.configured) && d.status.tokenKey.configured} nameOf={nameOf} />
            ))}
          </ul>
          {accounts.length === 0 && (
            <StudioNotice tone="warning" className="mt-3">
              {p.kind === "brand" ? "게시할 계정이 없습니다. 업체 화면에서 고객사 계정을 연결하거나, 우리 채널(내 채널 · 연결)을 연결하세요." : "게시할 수 있는 계정이 없습니다. YouTube · Instagram 계정을 연결하거나, 연결한 팀원에게 공유를 요청하세요."}
            </StudioNotice>
          )}
        </div>
      </div>
    </StudioCard>
  );

  const checkCard = (
    <StudioCard
      title={
        p.kind === "brand"
          ? `게시 전 정책 점검 · ${ownBrandAccount ? "고객사 계정 (자기 광고)" : "우리 채널 (대가 받은 광고)"}`
          : p.kind === "general"
            ? "게시 전 정책 점검 · 일반 영상 (제휴 없음)"
            : "게시 전 정책 점검 · 쿠팡 파트너스"
      }
      description={
        p.kind === "coupang"
          ? "프로그램 확인과 사람 확인을 따로 남깁니다 · 2026-09-07 시행 약관 · 운영정책 기준"
          : p.kind === "general"
            ? "프로그램 확인과 사람 확인을 따로 남깁니다 · 광고가 아니라 고지 문구가 붙지 않습니다"
            : "프로그램 확인과 사람 확인을 따로 남깁니다 · 공정위 추천·보증 심사지침 기준"
      }
      action={
        <>
          {!checkedOnce && <Badge size="lg">프로그램 점검 전</Badge>}
          <Badge tone={remaining.length ? "warning" : "success"} size="lg">
            {passed} / {required} 확인
          </Badge>
        </>
      }
      flush
    >
      <div className="hidden grid-cols-[minmax(0,1fr)_9.5rem_14rem] gap-4 border-y border-nd-line bg-nd-sunken/70 px-5 py-2.5 text-[13px] font-medium text-nd-fg-3 sm:px-6 md:grid">
        <span>확인 항목</span>
        <span>프로그램 확인</span>
        <span>사람 확인</span>
      </div>
      <ul className="divide-y divide-nd-line border-t border-nd-line md:border-t-0">
        {items.map((item) => {
          const c = p.compliance[item.key];
          const sys = prep?.checks[item.key]?.system ?? c?.system ?? null;
          const done = !remaining.some((r) => r.key === item.key);
          return (
            <li key={item.key} className="grid gap-x-4 gap-y-2 px-5 py-3 sm:px-6 md:grid-cols-[minmax(0,1fr)_9.5rem_14rem] md:items-start">
              <div className="flex min-w-0 items-start gap-2.5">
                {item.required ? (
                  done ? <CircleCheck size={18} aria-label="확인됨" className="mt-0.5 shrink-0 text-nd-success-text" /> : <CircleDashed size={18} aria-label="남은 확인" className="mt-0.5 shrink-0 text-nd-warning-text" />
                ) : (
                  <CircleDashed size={18} aria-hidden className="mt-0.5 shrink-0 text-nd-fg-4" />
                )}
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 text-nd-body font-medium text-nd-fg">
                    {item.label} {!item.required && <Badge>선택</Badge>}
                  </p>
                  <p className="mt-0.5 text-[13px] text-nd-fg-3">{item.how}</p>
                  {sys && <p className={cn("mt-1 text-[13px]", sys.ok ? "text-nd-fg-2" : item.required ? "text-nd-danger-text" : "text-nd-fg-2")}>{sys.detail}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2 pl-7 md:pl-0 md:pt-0.5">
                <span className="text-[13px] text-nd-fg-3 md:hidden">프로그램</span>
                {sys ? (
                  sys.ok ? (
                    <Badge tone="success" size="lg"><CircleCheck size={14} aria-hidden />통과</Badge>
                  ) : (
                    <Badge tone={item.required ? "danger" : "neutral"} size="lg"><CircleX size={14} aria-hidden />안 됨</Badge>
                  )
                ) : (
                  <Badge size="lg"><CircleDashed size={14} aria-hidden />{item.key === "dmConsent" ? "확인 불가 (사람만)" : "점검 전"}</Badge>
                )}
              </div>
              <div className="min-w-0 pl-7 md:pl-0 md:pt-1">
                {item.key === "clientApproval" ? (
                  <span className="text-[13px] text-nd-fg-3">승인 기록으로만 (「고객 승인」 탭)</span>
                ) : (
                  <Checkbox
                    label={
                      <span className="text-nd-body">
                        사람 확인
                        {c?.user && <span className="ml-1 text-[13px] text-nd-fg-3">· {c.user.by === d.me ? "나" : nameOf(c.user.by)} {fmtWhen(c.user.at)}</span>}
                      </span>
                    }
                    checked={!!c?.user?.ok}
                    onChange={(e) => userCheck(item.key, e.target.checked)}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-nd-line px-5 py-3 text-[13px] text-nd-fg-3 sm:px-6">
        프로그램 확인은 문구 · 기록을 보는 것이며 법적 검토를 대신하지 않습니다. 해외 소스의 출처 · 이용 조건 기록은 선택 항목이고, 해외 영상이라는 이유로 이용 권한이 생기지는 않습니다.
      </p>
    </StudioCard>
  );

  const publishCard = (
    <StudioCard title="게시하기" description="점검을 통과하면 지금 게시하거나 예약할 수 있습니다 · 계정별 결과는 게시 기록에 남습니다">
      <div className="space-y-4">
        <FormRow className="grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,16rem)]">
          <Field label="올릴 계정" hint={accounts.some((a) => a.status !== "connected") ? "「재연결 필요」 계정은 다시 연결한 뒤 게시됩니다" : undefined}>
            <Select value={accountId} disabled={!accounts.length} onChange={(e) => { setAccountId(e.target.value); setPrep(null); }}>
              {!accounts.length && <option value="">(연결된 계정 없음)</option>}
              {accounts.map((a) => <option key={a.id} value={a.id}>{PLATFORM_LABEL[a.platform]} · {a.externalName}{a.clientId ? " (고객사 계정)" : a.mine ? "" : ` (${nameOf(a.owner)} 공유)`}{a.status !== "connected" ? " · 재연결 필요" : ""}</option>)}
            </Select>
          </Field>
          <FieldAction size="md">
            <Button variant="secondary" disabled={!accounts.length || !renders.length || busy === "prep"} onClick={() => void prepare()}>게시 전 점검</Button>
          </FieldAction>
          <Field label="예약 시각"><Input type="datetime-local" value={when} disabled={!ready} onChange={(e) => setWhen(e.target.value)} /></Field>
        </FormRow>
        {platform === "instagram" && selectedRender && selectedRender.size > INSTAGRAM_MAX_BYTES && (
          <StudioNotice tone="warning">
            Instagram 은 릴스 한 편 {INSTAGRAM_MAX_BYTES / 1024 / 1024}MB 까지 받습니다. 이 파일은 {(selectedRender.size / 1024 / 1024).toFixed(0)}MB 라 YouTube 에만 올릴 수 있습니다.
          </StudioNotice>
        )}
        {prep && (
          <div className="space-y-2">
            {prep.existing && <StudioNotice tone={prep.existing.status === "failed" || prep.existing.status === "cancelled" ? "neutral" : "warning"}>이 계정 · 이 파일의 게시 기록: {PUBLICATION_LABEL[prep.existing.status]}{prep.existing.result?.url ? ` · ${prep.existing.result.url}` : ""}</StudioNotice>}
            {prep.problems.map((x) => <StudioNotice key={x} tone="danger">{x}</StudioNotice>)}
            {prep.blockers.length > 0 && (
              <StudioNotice tone="warning" title={`남은 확인 ${prep.blockers.length}개`}>
                <ul className="mt-1 list-disc pl-5">{prep.blockers.map((b) => <li key={b.key}>{b.label} — {b.reason}</li>)}</ul>
              </StudioNotice>
            )}
            {ready && <StudioNotice tone="success">점검을 통과했습니다 — 지금 게시하거나 예약할 수 있습니다.</StudioNotice>}
          </div>
        )}
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <p className={cn("min-w-0 flex-1 text-[13px]", blockedWhy ? "font-medium text-nd-fg-2" : "text-nd-fg-3")}>{blockedWhy ?? "지금 게시는 바로 대기열에, 예약은 「예약 대기 (아직 게시 전)」 로 기록됩니다."}</p>
          <div className="flex flex-wrap gap-2">
            <Button icon={Send} disabled={!ready || busy === "pub"} onClick={() => void publish(null)}>지금 게시</Button>
            <Button variant="secondary" disabled={!ready || busy === "pub" || !when || new Date(when).getTime() < Date.now() + 60_000} onClick={() => void publish(new Date(when).getTime())}>예약하기</Button>
          </div>
        </div>
        <p className="text-[13px] leading-relaxed text-nd-fg-3">
          예약은 예약 시각 이후 실행기(열린 ERP 화면 · 매일 06:30 cron)가 처리할 때 실제로 게시됩니다.
          YouTube API 프로젝트가 감사를 받지 않았으면 업로드가 비공개로 제한될 수 있습니다 — 첫 게시는 「비공개」 로 시험하세요.
        </p>
      </div>
    </StudioCard>
  );

  const records = <PublicationList pubs={pubs} accounts={d.accounts} />;
  const dm = p.kind === "coupang" ? <DmTemplate keyword={p.cta.keyword} link={p.coupang.affiliate?.url ?? ""} virtualHuman={p.virtualHuman} /> : null;

  if (fileOnly) {
    return (
      <div className="space-y-6">
        {mediaError && (
          <StudioNotice tone="danger" title="이 영상의 파일 목록을 받지 못했습니다" action={<Button size="sm" variant="secondary" onClick={retryMedia}>다시 시도</Button>}>
            {mediaError}
          </StudioNotice>
        )}
        <StudioNotice tone="info" title="이 업체는 「완성 파일만 납품」 계약입니다">
          고객사 계정 게시를 대신하지 않습니다. 고객이 승인한 완성 파일을 내려받아 전달하세요 — 게시는 고객사가 합니다. 게시 방식은 업체 계약에서 정합니다.
        </StudioNotice>
        <DeliverySection draft={draft} media={media} loading={mediaLoading} />
        {settingsCard}
        {pubs.length > 0 && records}
        <Disclosure title="우리 계정으로 게시" description="이 업체 계약에서는 쓰지 않습니다 — 계약이 바뀌었을 때만 여세요" meta={<Badge size="lg">계약: {CLIENT_DELIVERY_LABEL.file}</Badge>}>
          <div className="space-y-6">
            {fileAccountCard}
            {checkCard}
            {publishCard}
          </div>
        </Disclosure>
        <StudioNotice
          tone="info"
          title="게시 이후 성과도 기록할 수 있어요"
          action={
            <Link href={`/neander/shorts/projects/${p.id}?tab=perf`} scroll={false} className={buttonClass("secondary", "sm", "gap-1.5")}>
              <BarChart3 size={14} aria-hidden />
              성과로 이동
            </Link>
          }
        >
          고객이 공유한 게시 링크와 수치를 「성과」 탭에 직접 입력으로 남기면 출처와 함께 보입니다.
        </StudioNotice>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {mediaError && (
        <StudioNotice tone="danger" title="이 영상의 파일 목록을 받지 못했습니다" action={<Button size="sm" variant="secondary" onClick={retryMedia}>다시 시도</Button>}>
          {mediaError}
        </StudioNotice>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        {settingsCard}
        {fileAccountCard}
      </div>
      {checkCard}
      {publishCard}
      {records}
      {dm}
    </div>
  );
}

// ---- 완성 파일만 납품 -----------------------------------------------------

interface DeliveryRow {
  key: string;
  kind: string;
  tone: "success" | "warning" | "info" | "neutral";
  content: ReactNode;
  who: string;
  at: number | null;
}

/** 납품할 파일(고객이 승인한 그 파일) · 승인 · 전달 이력 — 파일을 바꾸면 다시 승인을 받아야 한다 */
function DeliverySection({ draft, media, loading }: { draft: Draft; media: MediaView[]; loading: boolean }) {
  const { p } = draft;
  const { data, nameOf } = useShorts();
  const d = data!;
  const { busy, run } = useAction();
  const approvedRound = p.review.state === "approved" ? [...p.review.rounds].reverse().find((r) => r.decision === "approved") : undefined;
  const approved = approvedRound ? media.find((m) => m.id === approvedRound.renderId) ?? null : null;
  const { url } = useBlobUrl(approved && !approved.purged ? approved.id : null);
  const pubs = d.publications.filter((x) => x.projectId === p.id);

  const rows: DeliveryRow[] = [];
  for (const r of p.review.rounds) {
    const f = media.find((m) => m.id === r.renderId);
    rows.push({ key: `s${r.n}`, kind: `${r.n}차 검토 보냄`, tone: "info", content: f ? f.name : "파일이 목록에 없음", who: nameOf(r.sentBy), at: r.sentAt });
    if (r.decidedAt)
      rows.push({
        key: `d${r.n}`,
        kind: r.decision === "approved" ? `${r.n}차 고객 승인` : r.decision === "revision" ? `${r.n}차 수정 요청` : `${r.n}차 거둬들임`,
        tone: r.decision === "approved" ? "success" : r.decision === "revision" ? "warning" : "neutral",
        content: r.feedback ? `「${r.feedback}」` : f?.name ?? "—",
        who: `${r.decidedBy || "이름 없음"} (${r.decidedVia === "link" ? "링크" : "담당자 기록"})`,
        at: r.decidedAt,
      });
  }
  for (const x of pubs)
    rows.push({
      key: `p${x.id}`,
      kind: `게시 · ${PLATFORM_LABEL[x.platform]}`,
      tone: x.status === "published" ? "success" : "neutral",
      content: x.result?.url ? (
        <a href={x.result.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-nd-accent hover:underline">
          게시물 열기 <ExternalLink size={13} aria-hidden />
        </a>
      ) : (
        PUBLICATION_LABEL[x.status]
      ),
      who: x.origin === "external" ? "밖에서 올림 · 자동 연결" : nameOf(x.owner),
      at: x.result?.at ?? x.updatedAt,
    });
  rows.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));

  const cols: RecordColumn<DeliveryRow>[] = [
    { key: "kind", header: "구분", mobile: "title", cell: (r) => <Badge size="lg" tone={r.tone}>{r.kind}</Badge> },
    { key: "content", header: "파일 · 내용", cell: (r) => <span className="min-w-0 break-all">{r.content}</span> },
    { key: "who", header: "담당자", cell: (r) => r.who },
    { key: "at", header: "시각", align: "right", className: "whitespace-nowrap", cell: (r) => fmtWhen(r.at) },
  ];

  return (
    <>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <StudioCard title="납품할 완성 파일" description="고객이 승인한 그 파일만 넘깁니다">
          {p.review.state !== "approved" ? (
            <StudioNotice
              tone="warning"
              title="아직 고객 승인 전입니다"
              action={<Link href={`/neander/shorts/projects/${p.id}?tab=review`} scroll={false} className={buttonClass("secondary", "sm")}>고객 승인으로</Link>}
            >
              「고객 승인」 탭에서 검토 링크를 보내 승인을 받으면, 승인된 그 파일이 여기에 납품 파일로 나옵니다.
            </StudioNotice>
          ) : !approved ? (
            <EmptyState compact icon={Clapperboard} title={loading ? "파일 목록을 불러오는 중…" : "승인된 파일을 찾지 못했습니다"} description={loading ? undefined : "지워졌을 수 있습니다. 새로 출력해 다시 승인을 받으세요."} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
              {url ? (
                <video src={url} controls playsInline preload="metadata" className="aspect-[9/16] w-full max-w-[160px] rounded-nd-md bg-black" aria-label="납품할 완성 파일" />
              ) : (
                <div className="flex aspect-[9/16] w-full max-w-[160px] flex-col items-center justify-center gap-1.5 rounded-nd-md bg-nd-sunken px-3 text-center text-[13px] text-nd-fg-3">
                  <Clapperboard size={20} aria-hidden />
                  {approved.purged ? "파일 내용을 지웠습니다" : "불러오는 중"}
                </div>
              )}
              <div className="min-w-0 space-y-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate text-nd-body font-semibold" title={approved.name}>{approved.name}</span>
                    <Badge size="lg" tone="success">고객 승인 · {approvedRound!.n}차</Badge>
                  </div>
                  <p className="nd-num text-[13px] text-nd-fg-3">
                    {[fmtSec(approved.duration), approved.width && approved.height ? `${approved.width}×${approved.height}` : null, `${(approved.size / 1024 / 1024).toFixed(1)}MB`, approved.overlay?.disclosure ? `고지 띠 「${approved.overlay.text}」 포함` : "고지 띠 없음"].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <p className="flex items-start gap-1.5 text-[13px] text-nd-success-text">
                  <CircleCheck size={15} aria-hidden className="mt-0.5 shrink-0" />
                  내려받는 파일 = 고객이 {fmtWhen(approvedRound!.decidedAt)} 승인한 {approvedRound!.n}차 파일
                </p>
                <Button icon={Download} disabled={!!approved.purged || busy === "dl"} onClick={() => void run("dl", async () => downloadMedia(approved, `${safeFileName(p.title)}.mp4`))}>
                  완성 파일 내려받기
                </Button>
                {approved.purged && <p className="text-[13px] text-nd-fg-3">이 파일은 내용을 지워 내려받을 수 없습니다 — 새로 출력해 다시 승인을 받으세요.</p>}
              </div>
            </div>
          )}
        </StudioCard>

        <StudioCard title="승인 · 전달 이력" description="검토를 보낸 때 · 고객 답 · 게시 기록 (최근 것이 위)" flush>
          <RecordTable
            rows={rows}
            columns={cols}
            rowKey={(r) => r.key}
            ariaLabel="승인 · 전달 이력"
            empty={<p className="px-5 pb-5 text-nd-body text-nd-fg-3 sm:px-6">아직 검토를 보낸 적이 없습니다.</p>}
            className="[&>ul]:px-4 [&>ul]:pb-3"
          />
          <p className="border-t border-nd-line px-5 py-3 text-[13px] text-nd-fg-3 sm:px-6">파일을 내려받아 넘긴 일(전달일 · 받는 사람)은 아직 따로 기록되지 않습니다. 고객이 게시하면 그 링크를 「성과」 탭에 남기세요.</p>
        </StudioCard>
      </div>
    </>
  );
}

// ---- 계정 · 파일 ----------------------------------------------------------

/** 플랫폼 하나의 게시 계정 상태 — 실제 설정(서버 · 연결한 계정)을 따른다 */
function ChannelRow({ platform, accounts, serverOk, nameOf }: { platform: PublishPlatform; accounts: AccountView[]; serverOk: boolean; nameOf: (e: string) => string }) {
  const ok = accounts.filter((a) => a.status === "connected");
  const reauth = accounts.filter((a) => a.status === "needs_reauth");
  let badge: ReactNode;
  let detail: string;
  if (ok.length) {
    badge = <ConnBadge ok on="연결됨" size="lg" />;
    detail = ok.map((a) => `${a.externalName}${a.clientId ? " (고객사)" : a.mine ? " · 내 계정" : ` (${nameOf(a.owner)} 공유)`}`).join(" · ");
  } else if (reauth.length) {
    badge = <Badge tone="danger" size="lg">다시 연결 필요</Badge>;
    detail = `${reauth.map((a) => a.externalName).join(" · ")} — 토큰이 끊겨 게시할 수 없습니다.`;
  } else {
    badge = <ConnBadge ok={false} off="연결 필요" offTone="danger" size="lg" />;
    detail = serverOk ? "계정을 연결하면 바로 게시할 수 있습니다." : `서버에 ${platform === "youtube" ? "YouTube OAuth" : "Meta 앱"} 설정이 없어 아직 연결할 수 없습니다.`;
  }
  return (
    <li className="flex flex-col gap-2 px-3.5 py-3 sm:flex-row sm:items-center sm:gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-nd-body font-semibold text-nd-fg">{PLATFORM_LABEL[platform]}</span>
          {badge}
        </div>
        <p className="mt-0.5 text-[13px] text-nd-fg-3">{detail}</p>
      </div>
      {!ok.length && (
        <Link href="/neander/shorts/accounts" className={buttonClass("secondary", "sm", "shrink-0 self-start sm:self-center")}>
          <Plug size={14} aria-hidden className="mr-1" />
          {reauth.length ? "다시 연결" : "연결하기"}
        </Link>
      )}
    </li>
  );
}

/** 완성 파일 미리보기 + 파일 정보 */
function RenderInfo({ r }: { r: MediaView }) {
  const { url, error } = useBlobUrl(r.id);
  const rows: [string, ReactNode][] = [
    ["파일명", <span key="n" className="block truncate" title={r.name}>{r.name}</span>],
    ["해상도", r.width && r.height ? <span key="r" className="nd-num">{r.width} × {r.height}{r.height > r.width ? " (세로)" : ""}</span> : "—"],
    ["길이", r.duration ? <span key="d" className="nd-num">{r.duration.toFixed(1)}초</span> : "—"],
    ["파일 크기", r.size ? <span key="s" className="nd-num">{(r.size / 1024 / 1024).toFixed(2)}MB</span> : "—"],
    ["코덱", r.codecs ? `${r.codecs.video ?? "?"} / ${r.codecs.audio ?? "?"}` : "—"],
    ["영상 안 고지", r.overlay?.disclosure ? <Badge key="o" tone="success">고지 띠 있음</Badge> : <Badge key="o">고지 띠 없음</Badge>],
    [r.direct ? "올린 시각" : "출력 시각", <span key="t">{fmtWhen(r.createdAt)}{r.direct ? " · 직접 올림" : ""}</span>],
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
      {error ? (
        <div className="flex aspect-[9/16] w-full max-w-[160px] items-center justify-center rounded-nd-md bg-nd-sunken p-3 text-center text-[13px] text-nd-danger-text">{error}</div>
      ) : url ? (
        <video src={url} controls playsInline preload="metadata" className="aspect-[9/16] w-full max-w-[160px] rounded-nd-md bg-black" aria-label="완성 파일 미리보기" />
      ) : (
        <div className="aspect-[9/16] w-full max-w-[160px] animate-pulse rounded-nd-md bg-nd-fg/10" />
      )}
      <dl className="min-w-0 divide-y divide-nd-line self-start rounded-nd-md border border-nd-line text-nd-body">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-3 px-3 py-2">
            <dt className="text-[13px] text-nd-fg-3">{k}</dt>
            <dd className="min-w-0 text-nd-fg">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ---- 게시 기록 -------------------------------------------------------------

function PublicationList({ pubs, accounts }: { pubs: PublicationView[]; accounts: AccountView[] }) {
  const { refresh, nameOf } = useShorts();
  const { busy, run } = useAction();
  const [resolving, setResolving] = useState<PublicationView | null>(null);
  const byPlatform = (["youtube", "instagram"] as const).map((pf) => ({ pf, n: pubs.filter((x) => x.platform === pf).length })).filter((x) => x.n);
  const cols: RecordColumn<PublicationView>[] = [
    {
      key: "acct",
      header: "플랫폼 · 계정",
      mobile: "title",
      cell: (x) => {
        const a = accounts.find((aa) => aa.id === x.accountId);
        return <span className="font-medium">{PLATFORM_LABEL[x.platform]} · {a?.externalName ?? "계정 정보 없음"}</span>;
      },
    },
    {
      key: "status",
      header: "상태",
      cell: (x) => (
        <span className="inline-flex flex-col items-end gap-0.5 md:items-start">
          <PubBadge status={x.status} size="lg" />
          {x.scheduledAt && x.status === "scheduled" && <span className="nd-num text-[13px] text-nd-fg-3">{fmtWhen(x.scheduledAt)} 이후</span>}
        </span>
      ),
    },
    {
      key: "result",
      header: "결과 · 출처",
      cell: (x) => (
        <span className="inline-flex min-w-0 flex-col items-end gap-0.5 md:items-start">
          {x.result?.url ? (
            <a href={x.result.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-nd-accent hover:underline" title={x.result.url}>
              게시물 열기 <ExternalLink size={13} aria-hidden />
            </a>
          ) : (
            <span className="text-nd-fg-3">링크 없음</span>
          )}
          <span className="text-[13px] text-nd-fg-3">
            {x.origin === "external" ? "밖에서 올림 · 자동 연결" : x.result ? (x.result.by === "api" ? "ERP 에서 게시 · API 응답으로 확인" : "ERP 에서 게시 · 사람이 확인") : "ERP 에서 게시"}
          </span>
          {x.error && <span className="text-[13px] text-nd-danger-text">{x.error.message}</span>}
        </span>
      ),
    },
    { key: "at", header: "시각", className: "whitespace-nowrap", cell: (x) => <span className="nd-num">{fmtWhen(x.result?.at ?? x.updatedAt)}</span> },
    {
      key: "act",
      header: "기록",
      cell: (x) => (
        <span className="inline-flex flex-col items-end gap-1 md:items-start">
          {(x.status === "scheduled" || x.status === "queued" || x.status === "uncertain") && (
            <span className="flex flex-wrap gap-1">
              {(x.status === "scheduled" || x.status === "queued") && <Button size="sm" variant="ghost" disabled={busy === x.id} onClick={() => void run(x.id, async () => { await mutate("publication.cancel", { id: x.id }); await refresh(); }, "취소했습니다.")}>예약 · 대기 취소</Button>}
              {x.status === "uncertain" && <Button size="sm" variant="secondary" onClick={() => setResolving(x)}>결과 기록</Button>}
            </span>
          )}
          <details>
            <summary className="cursor-pointer text-[13px] text-nd-fg-3">기록 {x.history.length}줄 · 시도 {x.attempts}번</summary>
            <ul className="mt-1 space-y-0.5 text-left text-[13px] text-nd-fg-2">
              {x.history.map((h, i) => <li key={i}>{fmtWhen(h.at)} · {PUBLICATION_LABEL[h.status]} · {h.msg} · {h.by.includes("@") ? nameOf(h.by) : h.by}</li>)}
            </ul>
          </details>
        </span>
      ),
    },
  ];
  return (
    <>
      <StudioCard
        title="게시 기록"
        description={pubs.length ? `게시물 ${pubs.length}건 (${byPlatform.map((x) => `${PLATFORM_LABEL[x.pf]} ${x.n}건`).join(" · ")}) · 이 영상 1편의 플랫폼별 결과 — 부분 성공 · 실패가 따로 보입니다` : undefined}
        flush
      >
        <RecordTable
          rows={pubs}
          columns={cols}
          rowKey={(x) => x.id}
          ariaLabel="게시 기록"
          empty={<p className="px-5 pb-5 text-nd-body text-nd-fg-3 sm:px-6">아직 게시 기록이 없습니다. YouTube Studio · 인스타 앱에서 직접 올린 게시물도 매일 아침 자동으로 이 영상에 이어집니다.</p>}
          className="[&>ul]:px-4 [&>ul]:pb-3"
        />
      </StudioCard>
      {resolving && <ResolveDialog pub={resolving} onClose={() => setResolving(null)} onDone={async () => { setResolving(null); await refresh(); }} />}
    </>
  );
}

function ResolveDialog({ pub, onClose, onDone }: { pub: PublicationView; onClose: () => void; onDone: () => Promise<void> }) {
  const { busy, run } = useAction();
  const [url, setUrl] = useState("");
  return (
    <Dialog
      open
      onClose={onClose}
      title="게시 결과 기록"
      description={`${PLATFORM_LABEL[pub.platform]} 에서 이 영상이 올라갔는지 직접 확인한 뒤 기록하세요. 자동으로 다시 게시하지 않습니다.`}
      footer={
        <>
          <Button variant="secondary" disabled={busy === "no"} onClick={() => void run("no", async () => { await mutate("publication.resolve", { id: pub.id, outcome: "not_published" }); await onDone(); }, "게시되지 않음으로 기록했습니다 — 다시 시도할 수 있습니다.")}>게시되지 않았음</Button>
          <Button disabled={busy === "yes" || !url.trim()} onClick={() => void run("yes", async () => { await mutate("publication.resolve", { id: pub.id, outcome: "published", url }); await onDone(); }, "게시됨으로 기록했습니다.")}>게시됨 (주소 입력)</Button>
        </>
      }
    >
      <Field label="게시물 주소" hint={pub.platform === "youtube" ? "YouTube Studio 에서 확인한 주소" : "Instagram 게시물 주소"}>
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
      </Field>
    </Dialog>
  );
}

function DmTemplate({ keyword, link, virtualHuman }: { keyword: string; link: string; virtualHuman: boolean }) {
  const toast = useToast();
  const text = `${disclosureLine(virtualHuman)}\n\n문의 주셔서 감사합니다. 영상 속 제품 정보예요.\n${link || "(제휴 링크)"}\n\n가격 · 옵션은 링크에서 확인해 주세요.`;
  return (
    <StudioCard
      title="정보 요청 답장 문구"
      description={keyword ? `댓글 · DM 키워드 「${keyword}」 를 남긴 사람에게만` : "먼저 요청한 사람에게만"}
      action={<Button size="sm" variant="secondary" icon={Copy} onClick={() => void navigator.clipboard.writeText(text).then(() => toast.success("복사했습니다."))}>문구 복사</Button>}
    >
      <pre className="whitespace-pre-wrap break-words font-sans text-nd-body leading-relaxed text-nd-fg">{text}</pre>
      <p className="mt-2 text-[13px] text-nd-fg-3">
        먼저 요청한 사람에게만 이 문구를 복사해 직접 답장하세요. DM 답장에도 고지 문구가 필요하고, 요청하지 않은 사람에게 보내는 광고 DM 은 금지입니다. 이 모듈은 DM 을 자동으로 보내지 않습니다. 첫 줄: 「{DISCLOSURE.slice(0, 18)}…」 · 해시태그 줄 예: {hashtagLine(["살림템"])}
      </p>
    </StudioCard>
  );
}
