"use client";

// ============================================================
//  게시 탭 — 게시 설정 · 정책 확인 · 게시(지금 / 예약) · 게시 기록
// ------------------------------------------------------------
//  정책 확인은 두 칸이다: 프로그램이 확인한 것(서버가 게시 직전에 다시 계산)과
//  사람이 확인한 것(누가 · 언제). 둘을 섞어 「확인됨」 하나로 보이지 않는다.
//  게시 문구 첫 줄은 언제나 표준 고지다 (buildCaption 이 맨 앞에 붙인다).
//  같은 계정 · 같은 완성 파일 · 같은 플랫폼은 한 번만 게시된다 (서버 원장).
//  결과가 불확실하면 자동으로 다시 올리지 않는다 — 사람이 플랫폼에서 보고 기록한다.
// ============================================================

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { CircleCheck, CircleDashed, CircleX, Clapperboard, Copy, Plug, Send } from "lucide-react";
import { Badge, Button, Card, Checkbox, Dialog, EmptyState, Field, FieldAction, FormRow, InlineNotice, Input, SectionHeader, Select, Textarea, buttonClass, cn, useToast } from "@/components/neander/ui";
import { mutate, notePendingJobs, shortsPost } from "@/lib/neander/shorts/client";
import { CAPTION_LIMIT, DISCLOSURE, PLATFORM_LABEL, PUBLICATION_LABEL, TITLE_LIMIT, buildCaption, captionLength, complianceBlockers, complianceItemsFor, disclosureLine, hashtagLine } from "@/lib/neander/shorts/model";
import type { AccountView, ComplianceCheck, ComplianceKey, MediaView, PublicationView, PublishPlatform } from "@/lib/neander/shorts/types";
import { useShorts } from "../ShortsProvider";
import { ConnBadge, PubBadge, fmtWhen, useAction } from "../parts";
import { useBlobUrl, useProjectMedia } from "../media";
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
  const { data, refresh } = useShorts();
  const d = data!;
  const toast = useToast();
  const { busy, run } = useAction();
  const { media, loading: mediaLoading } = useProjectMedia(p.id);
  const renders = media.filter((m) => m.kind === "render" && p.renderIds.includes(m.id)).sort((a, b) => b.createdAt - a.createdAt);
  // 브랜드 영상: 그 고객사 계정 + 우리 채널 · 쿠팡 영상: 고객사 계정은 빼고
  const accounts = d.accounts.filter((a) => a.canPublish && (p.kind === "brand" ? !a.clientId || a.clientId === p.clientId : !a.clientId));
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

  return (
    <div className="space-y-10">
      <section>
        <SectionHeader size="lg" title="게시 설정" hint="제목 · 설명 · 해시태그 · 공개 범위 · 고지" />
        <Card className="space-y-4">
          <Field label="제목" error={titleLen > TITLE_LIMIT ? `${TITLE_LIMIT}자 이하 (${titleLen}자)` : undefined} hint={`YouTube 제목 · Instagram 은 캡션만 씁니다 · ${titleLen}/${TITLE_LIMIT}자`}>
            <Input value={p.publish.title} placeholder={p.title} onChange={(e) => update((x) => void (x.publish.title = e.target.value))} />
          </Field>
          <Field label="설명 (고지 문구는 맨 앞에 저절로 붙습니다)">
            <Textarea rows={4} value={p.publish.description} onChange={(e) => update((x) => void (x.publish.description = e.target.value))} />
          </Field>
          <FormRow className="grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <Field label="해시태그 (쉼표)"><Input value={p.publish.hashtags.join(", ")} onChange={(e) => update((x) => void (x.publish.hashtags = e.target.value.split(",").map((s) => s.trim()).filter(Boolean)))} /></Field>
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
          </FormRow>
          <Field label="AI 합성 콘텐츠 (YouTube containsSyntheticMedia · Instagram is_ai_generated)" hint="실제처럼 보이는 AI 생성 · 변형 장면이 있으면 「있음」. 정해야 게시할 수 있습니다." error={p.publish.synthetic === null ? "골라 주세요" : undefined}>
            <Select value={p.publish.synthetic === null ? "" : p.publish.synthetic ? "yes" : "no"} onChange={(e) => update((x) => void (x.publish.synthetic = e.target.value === "" ? null : e.target.value === "yes"))}>
              <option value="">(정하지 않음)</option>
              <option value="yes">있음 — AI 로 만든 실제 같은 장면 포함</option>
              <option value="no">없음</option>
            </Select>
          </Field>
          {p.scenes.some((s) => s.kind === "ai" && s.ai?.status === "approved") && p.publish.synthetic === false && (
            <InlineNotice tone="warning">승인된 AI 장면이 있는데 「없음」 으로 골랐습니다. 실제처럼 보이는 장면이면 「있음」 이 맞습니다.</InlineNotice>
          )}
        </Card>
      </section>

      <section>
        <SectionHeader
          size="lg"
          title={`게시 문구 미리보기 · ${PLATFORM_LABEL[platform]}`}
          hint={`${captionLength(caption, platform).toLocaleString()} / ${CAPTION_LIMIT[platform].toLocaleString()}${platform === "youtube" ? "바이트" : "자"}`}
          action={<Button size="sm" variant="secondary" icon={Copy} onClick={() => void navigator.clipboard.writeText(caption).then(() => toast.success("복사했습니다."))}>복사</Button>}
        />
        <Card>
          <pre className="whitespace-pre-wrap break-words font-sans text-nd-body leading-relaxed">{caption}</pre>
          {platform === "instagram" && p.coupang.affiliate && <p className="mt-2 text-[13px] text-nd-fg-3">Instagram 캡션의 링크는 눌리지 않아 넣지 않았습니다 — 프로필 링크 · 댓글 키워드 CTA 를 쓰세요.</p>}
        </Card>
      </section>

      <section>
        <SectionHeader
          size="lg"
          title={
            p.kind === "brand"
              ? `게시 전 확인 · ${ownBrandAccount ? "고객사 계정 (자기 광고)" : "우리 채널 (대가 받은 광고)"}`
              : p.kind === "general"
                ? "게시 전 확인 · 일반 영상 (제휴 없음)"
                : "쿠팡 파트너스 정책 확인"
          }
          hint={
            p.kind === "coupang"
              ? "프로그램 확인과 사람 확인을 따로 남깁니다 · 2026-09-07 시행 약관 · 운영정책 기준"
              : p.kind === "general"
                ? "프로그램 확인과 사람 확인을 따로 남깁니다 · 광고가 아니라 고지 문구가 붙지 않습니다"
                : "프로그램 확인과 사람 확인을 따로 남깁니다 · 공정위 추천·보증 심사지침 기준"
          }
          action={
            <>
              {!checkedOnce && <Badge size="lg">프로그램 점검 전</Badge>}
              <Badge tone={remaining.length ? "warning" : "success"} size="lg">{remaining.length ? `남은 확인 ${remaining.length}개` : "필수 확인 모두 됨"}</Badge>
            </>
          }
        />
        <Card padding="none">
          <div className="hidden grid-cols-[minmax(0,1fr)_9.5rem_14rem] gap-4 border-b border-nd-line px-4 py-2 text-[13px] font-medium text-nd-fg-3 md:grid">
            <span>확인 항목</span>
            <span>프로그램 확인</span>
            <span>사람 확인</span>
          </div>
          <ul className="divide-y divide-nd-line">
            {items.map((item) => {
              const c = p.compliance[item.key];
              const sys = prep?.checks[item.key]?.system ?? c?.system ?? null;
              return (
                <li key={item.key} className="grid gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_9.5rem_14rem] md:items-start">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-nd-body font-medium text-nd-fg">
                      {item.label} {!item.required && <Badge>선택</Badge>}
                    </p>
                    <p className="mt-0.5 text-[13px] text-nd-fg-3">{item.how}</p>
                    {sys && <p className={cn("mt-1 text-[13px]", sys.ok ? "text-nd-fg-2" : item.required ? "text-nd-danger-text" : "text-nd-fg-2")}>{sys.detail}</p>}
                  </div>
                  <div className="flex items-center gap-2 md:pt-0.5">
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
                  <div className="min-w-0 md:pt-1">
                    {item.key === "clientApproval" ? (
                      <span className="text-[13px] text-nd-fg-3">승인 기록으로만 (「고객 승인」 탭)</span>
                    ) : (
                      <Checkbox
                        label={
                          <span className="text-nd-body">
                            사람 확인
                            {c?.user && <span className="ml-1 text-[13px] text-nd-fg-3">· {c.user.by === d.me ? "나" : c.user.by} {fmtWhen(c.user.at)}</span>}
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
        </Card>
        <Disclaimer />
      </section>

      <section>
        <SectionHeader size="lg" title="게시" hint="완성 파일 · 게시 채널 · 지금 게시 또는 예약" />
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <Card className="min-w-0">
            <h3 className="mb-3 text-nd-section text-nd-fg">완성 파일</h3>
            {renders.length === 0 ? (
              <EmptyState
                compact
                icon={Clapperboard}
                title={mediaLoading ? "파일 목록을 불러오는 중…" : "완성 파일이 없습니다"}
                description="「편집·출력」 탭에서 MP4 를 출력하세요."
                action={<Link href={`/neander/shorts/projects/${p.id}?tab=edit`} scroll={false} className={buttonClass("secondary", "sm")}>편집·출력으로</Link>}
              />
            ) : (
              <div className="space-y-3">
                {renders.length > 1 && (
                  <Field label="게시할 완성 파일">
                    <Select value={renderId || renders[0]?.id} onChange={(e) => { setRenderId(e.target.value); setPrep(null); }}>
                      {renders.map((r) => <option key={r.id} value={r.id}>{fmtWhen(r.createdAt)} · {r.duration?.toFixed(1)}초 · {r.codecs?.video}/{r.codecs?.audio}{r.overlay?.disclosure ? " · 고지 띠" : ""}</option>)}
                    </Select>
                  </Field>
                )}
                {selectedRender && <RenderInfo r={selectedRender} />}
              </div>
            )}
          </Card>

          <Card className="min-w-0 space-y-4">
            <div>
              <h3 className="mb-2 text-nd-section text-nd-fg">게시 채널 (연결 상태)</h3>
              <ul className="divide-y divide-nd-line rounded-nd-md border border-nd-line">
                {(["youtube", "instagram"] as const).map((pf) => (
                  <ChannelRow key={pf} platform={pf} accounts={accounts.filter((a) => a.platform === pf)} serverOk={(pf === "youtube" ? d.status.youtubeOAuth.configured : d.status.meta.configured) && d.status.tokenKey.configured} />
                ))}
              </ul>
              {accounts.length === 0 && (
                <InlineNotice tone="warning" className="mt-3">
                  {p.kind === "brand" ? "게시할 계정이 없습니다. 고객사 화면에서 고객사 계정을 연결하거나, 우리 채널(내 채널 · 연결)을 연결하세요." : "게시할 수 있는 계정이 없습니다. YouTube · Instagram 계정을 연결하거나, 연결한 팀원에게 공유를 요청하세요."}
                </InlineNotice>
              )}
            </div>

            <div className="space-y-3 border-t border-nd-line pt-4">
              <h3 className="text-nd-section text-nd-fg">게시하기</h3>
              <FormRow className="grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto]">
                <Field label="게시 계정">
                  <Select value={accountId} disabled={!accounts.length} onChange={(e) => { setAccountId(e.target.value); setPrep(null); }}>
                    {!accounts.length && <option value="">(연결된 계정 없음)</option>}
                    {accounts.map((a) => <option key={a.id} value={a.id}>{PLATFORM_LABEL[a.platform]} · {a.externalName}{a.clientId ? " (고객사 계정)" : a.mine ? "" : ` (${a.owner.split("@")[0]} 공유)`}{a.status !== "connected" ? " · 재연결 필요" : ""}</option>)}
                  </Select>
                </Field>
                <FieldAction size="md">
                  <Button variant="secondary" disabled={!accounts.length || !renders.length || busy === "prep"} onClick={() => void prepare()}>게시 전 점검</Button>
                </FieldAction>
              </FormRow>
              {prep && (
                <div className="space-y-2">
                  {prep.existing && <InlineNotice tone={prep.existing.status === "failed" || prep.existing.status === "cancelled" ? "neutral" : "warning"}>이 계정 · 이 파일의 게시 기록: {PUBLICATION_LABEL[prep.existing.status]}{prep.existing.result?.url ? ` · ${prep.existing.result.url}` : ""}</InlineNotice>}
                  {prep.problems.map((x) => <InlineNotice key={x} tone="danger">{x}</InlineNotice>)}
                  {prep.blockers.length > 0 && (
                    <InlineNotice tone="warning">
                      남은 확인: <ul className="mt-1 list-disc pl-5">{prep.blockers.map((b) => <li key={b.key}>{b.label} — {b.reason}</li>)}</ul>
                    </InlineNotice>
                  )}
                  {ready && <InlineNotice tone="success">점검을 통과했습니다 — 지금 게시하거나 예약할 수 있습니다.</InlineNotice>}
                </div>
              )}
              <FormRow className="grid-cols-1 sm:grid-cols-[auto_minmax(0,14rem)_auto]">
                <FieldAction size="md">
                  <Button icon={Send} disabled={!ready || busy === "pub"} onClick={() => void publish(null)}>지금 게시</Button>
                </FieldAction>
                <Field label="예약 시각"><Input type="datetime-local" value={when} disabled={!ready} onChange={(e) => setWhen(e.target.value)} /></Field>
                <FieldAction size="md">
                  <Button variant="secondary" disabled={!ready || busy === "pub" || !when || new Date(when).getTime() < Date.now() + 60_000} onClick={() => void publish(new Date(when).getTime())}>예약</Button>
                </FieldAction>
              </FormRow>
              {blockedWhy && <p className="text-[13px] font-medium text-nd-fg-2">{blockedWhy}</p>}
              <p className="text-[13px] leading-relaxed text-nd-fg-3">
                예약은 「예약 대기 (아직 게시 전)」 로 기록되고, 예약 시각 이후 실행기(열린 ERP 화면 · 매일 06:30 cron)가 처리할 때 실제로 게시됩니다.
                YouTube API 프로젝트가 감사를 받지 않았으면 업로드가 비공개로 제한될 수 있습니다 — 첫 게시는 「비공개」 로 시험하세요.
              </p>
            </div>
          </Card>
        </div>
      </section>

      <PublicationList pubs={pubs} />
      {p.kind === "coupang" && <DmTemplate keyword={p.cta.keyword} link={p.coupang.affiliate?.url ?? ""} virtualHuman={p.virtualHuman} />}
    </div>
  );
}

/** 플랫폼 하나의 게시 계정 상태 — 실제 설정(서버 · 연결한 계정)을 따른다 */
function ChannelRow({ platform, accounts, serverOk }: { platform: PublishPlatform; accounts: AccountView[]; serverOk: boolean }) {
  const ok = accounts.filter((a) => a.status === "connected");
  const reauth = accounts.filter((a) => a.status === "needs_reauth");
  let badge: ReactNode;
  let detail: string;
  if (ok.length) {
    badge = <ConnBadge ok on="연결됨" size="lg" />;
    detail = ok.map((a) => `${a.externalName}${a.clientId ? " (고객사)" : a.mine ? "" : ` (${a.owner.split("@")[0]} 공유)`}`).join(" · ");
  } else if (reauth.length) {
    badge = <Badge tone="danger" size="lg">다시 연결 필요</Badge>;
    detail = `${reauth.map((a) => a.externalName).join(" · ")} — 토큰이 끊겨 게시할 수 없습니다.`;
  } else {
    badge = <ConnBadge ok={false} off="연결 필요" offTone="danger" size="lg" />;
    detail = serverOk ? "계정을 연결하면 바로 게시할 수 있습니다." : `서버에 ${platform === "youtube" ? "YouTube OAuth" : "Meta 앱"} 설정이 없어 아직 연결할 수 없습니다.`;
  }
  return (
    <li className="grid grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3.5 py-2.5">
      <span className="text-nd-body font-semibold text-nd-fg">{PLATFORM_LABEL[platform]}</span>
      <span className="flex min-w-0 items-center">{badge}</span>
      {!ok.length ? (
        <Link href="/neander/shorts/accounts" className={buttonClass("secondary", "sm")}>
          <Plug size={14} aria-hidden className="mr-1" />
          {reauth.length ? "다시 연결" : "연결하기"}
        </Link>
      ) : (
        <span />
      )}
      <span className="col-span-3 text-[13px] text-nd-fg-3 sm:col-span-2 sm:col-start-2">{detail}</span>
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
    ["출력 시각", fmtWhen(r.createdAt)],
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
      {error ? (
        <div className="flex aspect-[9/16] w-full max-w-[180px] items-center justify-center rounded-nd-md bg-nd-sunken p-3 text-center text-[13px] text-nd-danger-text">{error}</div>
      ) : url ? (
        <video src={url} controls playsInline preload="metadata" className="aspect-[9/16] w-full max-w-[180px] rounded-nd-md bg-black" aria-label="완성 파일 미리보기" />
      ) : (
        <div className="aspect-[9/16] w-full max-w-[180px] animate-pulse rounded-nd-md bg-nd-fg/10" />
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

function Disclaimer() {
  return (
    <p className="mt-2 text-[13px] text-nd-fg-3">
      프로그램 확인은 문구 · 기록을 보는 것이며 법적 검토를 대신하지 않습니다. 해외 소스의 출처 · 이용 조건 기록은 선택 항목이고, 해외 영상이라는 이유로 이용 권한이 생기지는 않습니다.
    </p>
  );
}

function PublicationList({ pubs }: { pubs: PublicationView[] }) {
  const { refresh } = useShorts();
  const { busy, run } = useAction();
  const [resolving, setResolving] = useState<PublicationView | null>(null);
  if (!pubs.length) return null;
  return (
    <section>
      <SectionHeader size="lg" title="게시 기록" hint={`${pubs.length}건 · 플랫폼별 결과 — 부분 성공 · 실패가 따로 보입니다`} />
      <Card padding="none">
        <ul className="divide-y divide-nd-line">
          {pubs.map((x) => (
            <li key={x.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-nd-body font-semibold">{PLATFORM_LABEL[x.platform]}</span>
                <PubBadge status={x.status} size="lg" />
                {x.scheduledAt && x.status === "scheduled" && <span className="text-[13px] text-nd-fg-3">{fmtWhen(x.scheduledAt)} 이후</span>}
                {x.result?.url && <a href={x.result.url} target="_blank" rel="noreferrer" className="min-w-0 max-w-[28rem] truncate text-[13px] text-nd-accent hover:underline" title={x.result.url}>{x.result.url}</a>}
                {x.result && <Badge tone={x.result.by === "api" ? "info" : "neutral"}>{x.result.by === "api" ? "API 응답으로 확인" : "사람이 확인"}</Badge>}
                <span className="ml-auto flex gap-1">
                  {(x.status === "scheduled" || x.status === "queued") && <Button size="sm" variant="ghost" disabled={busy === x.id} onClick={() => void run(x.id, async () => { await mutate("publication.cancel", { id: x.id }); await refresh(); }, "취소했습니다.")}>취소</Button>}
                  {x.status === "uncertain" && <Button size="sm" variant="secondary" onClick={() => setResolving(x)}>결과 기록</Button>}
                </span>
              </div>
              {x.error && <p className="mt-1 text-[13px] text-nd-danger-text">{x.error.message}</p>}
              <details className="mt-1">
                <summary className="cursor-pointer text-[13px] text-nd-fg-3">기록 {x.history.length}줄 · 시도 {x.attempts}번</summary>
                <ul className="mt-1 space-y-0.5 text-[13px] text-nd-fg-2">
                  {x.history.map((h, i) => <li key={i}>{fmtWhen(h.at)} · {PUBLICATION_LABEL[h.status]} · {h.msg} · {h.by}</li>)}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      </Card>
      {resolving && <ResolveDialog pub={resolving} onClose={() => setResolving(null)} onDone={async () => { setResolving(null); await refresh(); }} />}
    </section>
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
    <section>
      <SectionHeader size="lg" title="정보 요청 답장 문구" hint={keyword ? `댓글 · DM 키워드 「${keyword}」 를 남긴 사람에게만` : "먼저 요청한 사람에게만"} action={<Button size="sm" variant="secondary" icon={Copy} onClick={() => void navigator.clipboard.writeText(text).then(() => toast.success("복사했습니다."))}>복사</Button>} />
      <Card>
        <pre className="whitespace-pre-wrap break-words font-sans text-nd-body leading-relaxed">{text}</pre>
        <p className="mt-2 text-[13px] text-nd-fg-3">
          DM 답장에도 고지 문구가 필요하고, 요청하지 않은 사람에게 보내는 광고 DM 은 금지입니다. 이 모듈은 DM 을 자동으로 보내지 않습니다. 첫 줄: 「{DISCLOSURE.slice(0, 18)}…」 · 해시태그 줄 예: {hashtagLine(["살림템"])}
        </p>
      </Card>
    </section>
  );
}
