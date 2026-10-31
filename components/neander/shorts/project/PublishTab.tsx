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

import { useMemo, useState } from "react";
import Link from "next/link";
import { CircleCheck, CircleX, Copy, Send } from "lucide-react";
import { Badge, Button, Card, Checkbox, Dialog, Field, FormRow, InlineNotice, Input, SectionHeader, Select, Textarea, useToast } from "@/components/neander/ui";
import { mutate, notePendingJobs, shortsPost } from "@/lib/neander/shorts/client";
import { CAPTION_LIMIT, DISCLOSURE, PLATFORM_LABEL, PUBLICATION_LABEL, TITLE_LIMIT, buildCaption, captionLength, complianceItemsFor, disclosureLine, hashtagLine } from "@/lib/neander/shorts/model";
import type { ComplianceCheck, ComplianceKey, PublicationView, PublishPlatform } from "@/lib/neander/shorts/types";
import { useShorts } from "../ShortsProvider";
import { PubBadge, fmtWhen, useAction } from "../parts";
import { useProjectMedia } from "../media";
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
  const { media } = useProjectMedia(p.id);
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
    <div className="space-y-8">
      <section>
        <SectionHeader title="게시 설정" />
        <Card className="space-y-3">
          <Field label="제목" error={titleLen > TITLE_LIMIT ? `${TITLE_LIMIT}자 이하 (${titleLen}자)` : undefined} hint="YouTube 제목 · Instagram 은 캡션만 씁니다">
            <Input value={p.publish.title} placeholder={p.title} onChange={(e) => update((x) => void (x.publish.title = e.target.value))} />
          </Field>
          <Field label="설명 (고지 문구는 맨 앞에 저절로 붙습니다)">
            <Textarea rows={4} value={p.publish.description} onChange={(e) => update((x) => void (x.publish.description = e.target.value))} />
          </Field>
          <FormRow className="grid-cols-1 sm:grid-cols-[2fr_1fr_1fr]">
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
        <SectionHeader title={`게시 문구 미리보기 · ${PLATFORM_LABEL[platform]}`} hint={`${captionLength(caption, platform).toLocaleString()} / ${CAPTION_LIMIT[platform].toLocaleString()}${platform === "youtube" ? "바이트" : "자"}`} action={<Button size="sm" variant="ghost" icon={Copy} onClick={() => void navigator.clipboard.writeText(caption).then(() => toast.success("복사했습니다."))}>복사</Button>} />
        <Card>
          <pre className="whitespace-pre-wrap break-words font-sans text-nd-body">{caption}</pre>
          {platform === "instagram" && p.coupang.affiliate && <p className="mt-2 text-nd-caption text-nd-fg-3">Instagram 캡션의 링크는 눌리지 않아 넣지 않았습니다 — 프로필 링크 · 댓글 키워드 CTA 를 쓰세요.</p>}
        </Card>
      </section>

      <section>
        <SectionHeader
          title={p.kind === "brand" ? `게시 전 확인 · ${ownBrandAccount ? "고객사 계정 (자기 광고)" : "우리 채널 (대가 받은 광고)"}` : "쿠팡 파트너스 정책 확인"}
          hint={p.kind === "brand" ? "프로그램 확인과 사람 확인을 따로 남깁니다 · 공정위 추천·보증 심사지침 기준" : "프로그램 확인과 사람 확인을 따로 남깁니다 · 2026-09-07 시행 약관 · 운영정책 기준"}
        />
        <Card padding="none">
          <ul className="divide-y divide-nd-line">
            {items.map((item) => {
              const c = p.compliance[item.key];
              const sys = prep?.checks[item.key]?.system ?? c?.system ?? null;
              return (
                <li key={item.key} className="px-4 py-3">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-nd-body font-medium">
                        {item.label} {!item.required && <Badge size="sm">선택</Badge>}
                      </p>
                      <p className="text-nd-caption text-nd-fg-3">{item.how}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <span className="flex items-center gap-1.5 text-nd-caption">
                        <span className="text-nd-fg-3">프로그램</span>
                        {sys ? (sys.ok ? <Badge tone="success" size="sm"><CircleCheck size={11} className="mr-0.5 inline" />통과</Badge> : <Badge tone={item.required ? "danger" : "neutral"} size="sm"><CircleX size={11} className="mr-0.5 inline" />안 됨</Badge>) : <Badge size="sm">{item.key === "dmConsent" ? "확인 불가 (사람만)" : "점검 전"}</Badge>}
                      </span>
                      {item.key === "clientApproval" ? (
                        <span className="text-nd-caption text-nd-fg-3">승인 기록으로만 (「고객 승인」 탭)</span>
                      ) : (
                        <Checkbox
                          label={<span className="text-nd-caption">사람 확인{c?.user ? ` · ${c.user.by === d.me ? "나" : c.user.by} ${fmtWhen(c.user.at)}` : ""}</span>}
                          checked={!!c?.user?.ok}
                          onChange={(e) => userCheck(item.key, e.target.checked)}
                        />
                      )}
                    </div>
                  </div>
                  {sys && <p className={`mt-1 text-nd-caption ${sys.ok ? "text-nd-fg-2" : "text-nd-danger-text"}`}>{sys.detail}</p>}
                </li>
              );
            })}
          </ul>
        </Card>
        <Disclaimer />
      </section>

      <section>
        <SectionHeader title="게시" />
        <Card className="space-y-3">
          {accounts.length === 0 ? (
            <InlineNotice tone="neutral" action={<Link href="/neander/shorts/accounts"><Button size="sm" variant="secondary">계정 연결</Button></Link>}>
              {p.kind === "brand" ? "게시할 계정이 없습니다. 고객사 화면에서 고객사 계정을 연결하거나, 우리 채널(내 채널 · 연결)을 연결하세요." : "게시할 수 있는 계정이 없습니다. YouTube · Instagram 계정을 연결하거나, 연결한 팀원에게 공유를 요청하세요."}
            </InlineNotice>
          ) : renders.length === 0 ? (
            <InlineNotice tone="neutral">완성 파일이 없습니다. 「편집·출력」 탭에서 MP4 를 출력하세요.</InlineNotice>
          ) : (
            <>
              <FormRow className="grid-cols-1 sm:grid-cols-[1.5fr_1.5fr_auto]">
                <Field label="게시 계정">
                  <Select value={accountId} onChange={(e) => { setAccountId(e.target.value); setPrep(null); }}>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{PLATFORM_LABEL[a.platform]} · {a.externalName}{a.clientId ? " (고객사 계정)" : a.mine ? "" : ` (${a.owner.split("@")[0]} 공유)`}{a.status !== "connected" ? " · 재연결 필요" : ""}</option>)}
                  </Select>
                </Field>
                <Field label="완성 파일">
                  <Select value={renderId || renders[0]?.id} onChange={(e) => { setRenderId(e.target.value); setPrep(null); }}>
                    {renders.map((r) => <option key={r.id} value={r.id}>{fmtWhen(r.createdAt)} · {r.duration?.toFixed(1)}초 · {r.codecs?.video}/{r.codecs?.audio}{r.overlay?.disclosure ? " · 고지 띠" : ""}</option>)}
                  </Select>
                </Field>
                <div className="flex flex-col gap-1.5">
                  <span className="text-nd-caption" aria-hidden>{" "}</span>
                  <Button variant="secondary" disabled={busy === "prep"} onClick={() => void prepare()}>게시 전 점검</Button>
                </div>
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
                  {!prep.problems.length && !prep.blockers.length && (
                    <div className="flex flex-wrap items-end gap-2">
                      <Button icon={Send} disabled={busy === "pub"} onClick={() => void publish(null)}>지금 게시</Button>
                      <Field label="예약 시각" className="w-56"><Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
                      <Button variant="secondary" disabled={busy === "pub" || !when || new Date(when).getTime() < Date.now() + 60_000} onClick={() => void publish(new Date(when).getTime())}>예약</Button>
                    </div>
                  )}
                </div>
              )}
              <p className="text-nd-caption text-nd-fg-3">
                예약은 「예약 대기 (아직 게시 전)」 로 기록되고, 예약 시각 이후 실행기(열린 ERP 화면 · 매일 06:30 cron)가 처리할 때 실제로 게시됩니다.
                YouTube API 프로젝트가 감사를 받지 않았으면 업로드가 비공개로 제한될 수 있습니다 — 첫 게시는 「비공개」 로 시험하세요.
              </p>
            </>
          )}
        </Card>
      </section>

      <PublicationList pubs={pubs} />
      {p.kind !== "brand" && <DmTemplate keyword={p.cta.keyword} link={p.coupang.affiliate?.url ?? ""} virtualHuman={p.virtualHuman} />}
    </div>
  );
}

function Disclaimer() {
  return (
    <p className="mt-2 text-nd-caption text-nd-fg-3">
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
      <SectionHeader title="게시 기록" hint="플랫폼별 결과 — 부분 성공 · 실패가 따로 보입니다" />
      <Card padding="none">
        <ul className="divide-y divide-nd-line">
          {pubs.map((x) => (
            <li key={x.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{PLATFORM_LABEL[x.platform]}</span>
                <PubBadge status={x.status} />
                {x.scheduledAt && x.status === "scheduled" && <span className="text-nd-caption text-nd-fg-3">{fmtWhen(x.scheduledAt)} 이후</span>}
                {x.result?.url && <a href={x.result.url} target="_blank" rel="noreferrer" className="text-nd-caption text-nd-accent">{x.result.url}</a>}
                {x.result && <Badge size="sm" tone={x.result.by === "api" ? "info" : "neutral"}>{x.result.by === "api" ? "API 응답으로 확인" : "사람이 확인"}</Badge>}
                <span className="ml-auto flex gap-1">
                  {(x.status === "scheduled" || x.status === "queued") && <Button size="sm" variant="ghost" disabled={busy === x.id} onClick={() => void run(x.id, async () => { await mutate("publication.cancel", { id: x.id }); await refresh(); }, "취소했습니다.")}>취소</Button>}
                  {x.status === "uncertain" && <Button size="sm" variant="secondary" onClick={() => setResolving(x)}>결과 기록</Button>}
                </span>
              </div>
              {x.error && <p className="mt-1 text-nd-caption text-nd-danger-text">{x.error.message}</p>}
              <details className="mt-1">
                <summary className="cursor-pointer text-nd-caption text-nd-fg-3">기록 {x.history.length}줄 · 시도 {x.attempts}번</summary>
                <ul className="mt-1 space-y-0.5 text-nd-caption text-nd-fg-2">
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
      <SectionHeader title="정보 요청 답장 문구" hint={keyword ? `댓글 · DM 키워드 「${keyword}」 를 남긴 사람에게만` : "먼저 요청한 사람에게만"} action={<Button size="sm" variant="ghost" icon={Copy} onClick={() => void navigator.clipboard.writeText(text).then(() => toast.success("복사했습니다."))}>복사</Button>} />
      <Card>
        <pre className="whitespace-pre-wrap font-sans text-nd-body">{text}</pre>
        <p className="mt-2 text-nd-caption text-nd-fg-3">
          DM 답장에도 고지 문구가 필요하고, 요청하지 않은 사람에게 보내는 광고 DM 은 금지입니다. 이 모듈은 DM 을 자동으로 보내지 않습니다. 첫 줄: 「{DISCLOSURE.slice(0, 18)}…」 · 해시태그 줄 예: {hashtagLine(["살림템"])}
        </p>
      </Card>
    </section>
  );
}
