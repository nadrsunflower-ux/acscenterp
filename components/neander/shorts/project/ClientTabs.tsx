"use client";

// ============================================================
//  고객사 영상의 두 탭 — 「고객사」(브리프 · 제품) · 「고객 승인」(검토 링크 · 수정 횟수)
// ------------------------------------------------------------
//  브리프 · 금지 표현 · 제품 사실은 고객사 문서가 정본이다 — 여기서는 보여 주고,
//  고치려면 고객사 화면으로 간다 (영상마다 따로 고치면 갈라진다).
//  승인 기록은 서버만 쓴다 (reviews.ts). 게시는 승인된 그 파일만 된다.
// ============================================================

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Ban, CheckCircle2, Copy, ExternalLink, Film, ImageIcon, Send } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, FieldAction, FormRow, InlineNotice, Input, Meter, SectionHeader, Select, Table, TableScroll, Td, Th, type Tone, useToast } from "@/components/neander/ui";
import { mutate } from "@/lib/neander/shorts/client";
import { REVIEW_LABEL, fmtSec, revisionsLeft, scanClaims } from "@/lib/neander/shorts/model";
import type { MediaView, ProjectDoc, ReviewRound } from "@/lib/neander/shorts/types";
import { useShorts, type WithId } from "../ShortsProvider";
import { MediaThumb, useBlobUrl, useProjectMedia } from "../media";
import { KindTile, fmtWhen, useAction } from "../parts";
import type { Draft } from "../useProjectDraft";

/** 브리프 · 제품 정보의 한 줄 — 왼쪽 이름, 오른쪽 값 */
function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[112px_minmax(0,1fr)] sm:gap-3">
      <dt className="text-[13px] text-nd-fg-3 sm:pt-px">{label}</dt>
      <dd className="min-w-0 text-nd-body text-nd-fg">{children}</dd>
    </div>
  );
}
const Unset = () => <span className="text-nd-fg-3">미입력</span>;

export function ClientInfoTab({ draft }: { draft: Draft }) {
  const { p, update } = draft;
  const { data } = useShorts();
  const client = data!.clients.find((c) => c.id === p.clientId);
  if (!client) return <InlineNotice tone="warning">이 영상의 고객사를 찾지 못했습니다 (담당자가 아니거나 지워졌습니다).</InlineNotice>;
  const product = client.products.find((x) => x.id === p.clientProductId) ?? null;
  const flags = scanClaims(p.script.lines.map((l) => `${l.text}\n${l.caption}`).join("\n") + "\n" + p.publish.description, [], client.brief.banned).filter((f) => f.kind === "banned");
  const b = client.brief;
  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <KindTile kind="brand" className="h-11 w-11" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-[17px] font-semibold text-nd-fg" title={client.name}>{client.name}</h2>
              <Badge size="lg">{p.month ? `${Number(p.month.slice(5))}월 계약분` : "계약 월 미정"}</Badge>
            </div>
            <p className="text-[13px] text-nd-fg-3">
              고객사 담당 {client.contactName || "미입력"} · 한 편당 수정 {client.contract.revisionLimit}회 · 월 {client.contract.videosPerMonth}편
            </p>
          </div>
          <Link href={`/neander/shorts/clients/${client.id}`} className="ml-auto inline-flex items-center gap-1 text-[13px] font-medium text-nd-accent hover:underline">고객사 화면에서 고치기 <ExternalLink size={13} aria-hidden /></Link>
        </div>
        <FormRow className="grid-cols-1 sm:grid-cols-3">
          <Field label="제품">
            <Select size="sm" value={p.clientProductId ?? ""} onChange={(e) => update((x) => {
              x.clientProductId = e.target.value || null;
              const pd = client.products.find((y) => y.id === e.target.value);
              if (pd) {
                x.product = pd.name;
                x.facts = [...pd.facts];
              }
            })}>
              <option value="">(제품 미정)</option>
              {client.products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </Field>
          <Field label="올릴 곳" hint={p.brandTarget === "client" ? "고객사 자기 광고 — 고지 불필요" : "우리 채널의 대가 받은 광고 — 「광고」 고지"}>
            <Select size="sm" value={p.brandTarget} onChange={(e) => update((x) => {
              x.brandTarget = e.target.value as "client" | "own";
              x.output.disclosureOverlay = x.brandTarget === "own";
            })}>
              <option value="client">고객사 계정</option>
              <option value="own">우리 채널</option>
            </Select>
          </Field>
          <Field label="계약 월"><Input size="sm" type="month" value={p.month ?? ""} onChange={(e) => update((x) => void (x.month = e.target.value || x.month))} /></Field>
        </FormRow>
        {flags.length > 0 && <InlineNotice tone="danger" icon={Ban}>대본 · 설명에 고객사 금지 표현이 있습니다: {flags.map((f) => `「${f.phrase}」`).join(" ")}</InlineNotice>}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="min-w-0">
          <SectionHeader size="lg" title="브리프" hint="고객사 문서가 정본" />
          <Card className="space-y-4">
            {b.summary ? <p className="whitespace-pre-wrap text-nd-body leading-relaxed">{b.summary}</p> : <p className="text-[13px] text-nd-fg-3">브리프 요약이 없습니다.</p>}
            <dl className="space-y-2.5">
              <InfoRow label="대상">{b.target || <Unset />}</InfoRow>
              <InfoRow label="말투">{b.tone || <Unset />}</InfoRow>
              <InfoRow label="핵심 메시지">{b.keyMessages.length ? b.keyMessages.join(" · ") : <Unset />}</InfoRow>
              <InfoRow label="반드시 넣을 것">{b.mustInclude.length ? b.mustInclude.join(" · ") : <Unset />}</InfoRow>
            </dl>
            <div className="rounded-nd-md border border-nd-danger/25 bg-nd-danger-soft/40 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Ban size={16} className="text-nd-danger-text" aria-hidden />
                <span className="text-nd-body font-semibold text-nd-danger-text">금지 표현</span>
                <span className="text-[13px] text-nd-fg-3">대본 · 자막 · 설명에 쓰지 않습니다</span>
              </div>
              {b.banned.length ? (
                <>
                  <div className="flex flex-wrap gap-1.5">{b.banned.map((w) => <Badge key={w} size="lg" tone="danger">{w}</Badge>)}</div>
                  <p className={`mt-2 text-[13px] ${flags.length ? "text-nd-danger-text" : "text-nd-fg-3"}`}>
                    {flags.length ? `지금 대본 · 설명에서 ${flags.length}개를 찾았습니다 — 고쳐 주세요.` : "지금 대본 · 설명에서는 찾지 못했습니다."}
                  </p>
                </>
              ) : (
                <p className="text-[13px] text-nd-fg-3">등록된 금지 표현이 없습니다.</p>
              )}
            </div>
            {b.notes && <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-nd-fg-2">{b.notes}</p>}
          </Card>
        </section>

        <section className="min-w-0">
          <SectionHeader size="lg" title="제품 정보" hint="확인된 사실만 대본에 씁니다" />
          {product ? (
            <Card className="space-y-4">
              <dl className="space-y-2.5">
                <InfoRow label="제품명"><span className="font-medium">{product.name}</span></InfoRow>
                {product.url && (
                  <InfoRow label="제품 주소">
                    <a href={product.url} target="_blank" rel="noreferrer" className="block truncate text-nd-accent hover:underline" title={product.url}>{product.url}</a>
                  </InfoRow>
                )}
                <InfoRow label="확인된 사실">
                  {product.facts.length > 0 ? (
                    <ul className="list-disc space-y-1 pl-5">{product.facts.map((f) => <li key={f}>{f}</li>)}</ul>
                  ) : (
                    <span className="text-nd-fg-3">확인된 사실이 없습니다 — 고객사 화면에서 넣어 주세요.</span>
                  )}
                </InfoRow>
                {product.note && <InfoRow label="메모"><span className="whitespace-pre-wrap text-nd-fg-2">{product.note}</span></InfoRow>}
              </dl>
            </Card>
          ) : (
            <EmptyState compact icon={ImageIcon} title="제품을 고르지 않았습니다" description="위 「제품」 에서 이 영상의 제품을 고르면 확인된 사실과 실사진이 보입니다." />
          )}
        </section>
      </div>

      {product && (
        <section>
          <SectionHeader size="lg" title={`제품 실사진 (${product.photoIds.length}장)`} hint="실사진과 AI 장면을 견줘 보세요 — 외형이 다르면 그 장면은 반려" />
          {product.photoIds.length > 0 ? (
            <Card>
              <div className="flex flex-wrap gap-3">
                {product.photoIds.map((id, i) => (
                  <MediaThumb key={id} id={id} alt={`${product.name} 실사진 ${i + 1}`} className="h-44 w-44 rounded-nd-md" />
                ))}
              </div>
            </Card>
          ) : (
            <p className="rounded-nd-lg border border-dashed border-nd-strong px-4 py-5 text-center text-nd-body text-nd-fg-3">등록된 실사진이 없습니다 — 고객사 화면에서 올려 주세요.</p>
          )}
        </section>
      )}
    </div>
  );
}

// ---- 고객 승인 ------------------------------------------------------------

const STATE_TONE: Record<ProjectDoc["review"]["state"], Tone> = { none: "neutral", waiting: "info", revision: "warning", approved: "success" };
const DECISION: Record<ReviewRound["decision"], { label: string; tone: Tone }> = {
  pending: { label: "답 기다림", tone: "info" },
  approved: { label: "승인", tone: "success" },
  revision: { label: "수정 요청", tone: "warning" },
  withdrawn: { label: "거둬들임", tone: "neutral" },
};

/** 완성 파일 한 줄 설명 — 만든 때 · 길이 · 해상도 · 크기 · 고지 띠 */
function renderMeta(r: MediaView) {
  return [fmtWhen(r.createdAt), fmtSec(r.duration), r.width && r.height ? `${r.width}×${r.height}` : null, `${(r.size / 1024 / 1024).toFixed(1)}MB`, r.overlay?.disclosure ? `고지 띠 「${r.overlay.text}」` : null]
    .filter(Boolean)
    .join(" · ");
}

/** 고객에게 보낼(보낸) 완성 파일 — 9:16 으로 재생. 파일이 없으면 아이콘 상자 */
function RenderPlayer({ media, loading }: { media: MediaView | null; loading: boolean }) {
  const { url, error } = useBlobUrl(media?.id ?? null);
  if (media && url && !error) return <video src={url} controls playsInline className="aspect-[9/16] w-full rounded-nd-md bg-black" aria-label={media.name} />;
  return (
    <div className="flex aspect-[9/16] w-full flex-col items-center justify-center gap-1.5 rounded-nd-md bg-nd-sunken px-3 text-center text-nd-fg-3">
      <Film size={22} aria-hidden />
      <span className="text-[13px]">{!media ? (loading ? "불러오는 중" : "완성 파일 없음") : error ? "파일을 받지 못했습니다" : "불러오는 중"}</span>
    </div>
  );
}

export function ReviewTab({ draft }: { draft: Draft }) {
  const { p, flush, replace } = draft;
  const { data, nameOf } = useShorts();
  const toast = useToast();
  const { busy, run } = useAction();
  const client = data!.clients.find((c) => c.id === p.clientId);
  const { media, loading } = useProjectMedia(p.id);
  const renders = media.filter((m) => m.kind === "render" && p.renderIds.includes(m.id)).sort((a, b) => b.createdAt - a.createdAt);
  const [renderId, setRenderId] = useState(renders[0]?.id ?? "");
  const [link, setLink] = useState<string | null>(null);
  const [rec, setRec] = useState({ decision: "approved", feedback: "", decidedBy: client?.contactName ?? "" });
  const limit = client?.contract.revisionLimit ?? 0;
  const left = revisionsLeft(p.review, limit);
  const last = p.review.rounds[p.review.rounds.length - 1];
  // 게시 검사(model.ts)와 같은 기준 — 승인 상태일 때 마지막 「승인」 회차의 파일
  const approvedRound = p.review.state === "approved" ? [...p.review.rounds].reverse().find((r) => r.decision === "approved") : undefined;
  const approvedRender = approvedRound ? media.find((m) => m.id === approvedRound.renderId) ?? null : null;
  const fileOf = (id: string) => media.find((m) => m.id === id) ?? null;
  const selected = renders.find((r) => r.id === (renderId || renders[0]?.id)) ?? null;
  // 고객이 지금 보고 있는 파일 — 답을 기다리는 마지막 회차의 파일
  const pendingRound = p.review.state === "waiting" && last?.decision === "pending" ? last : undefined;
  const underReview = pendingRound ? fileOf(pendingRound.renderId) : null;
  const shown = p.review.state === "approved" ? approvedRender : (underReview ?? selected);
  const info = underReview ?? selected;
  // 보낼 파일이 하나도 없으면 빈 재생 칸 대신 안내 한 줄만
  const noFile = p.review.state !== "approved" && renders.length === 0;
  const reload = async () => {
    const { project } = await mutate<{ project: WithId<ProjectDoc> }>("project.get", { id: p.id });
    replace(project);
  };

  const status =
    p.review.state === "approved" && approvedRound
      ? `${approvedRound.n}차 검토 파일을 ${approvedRound.decidedBy ?? "고객사"} 이(가) 승인했습니다 (${approvedRound.decidedVia === "link" ? "검토 링크" : "담당자 기록"} · ${fmtWhen(approvedRound.decidedAt)}).`
      : p.review.state === "waiting" && last
        ? `${last.n}차 검토를 보냈습니다 (${fmtWhen(last.sentAt)}). 고객사 답을 기다리고 있습니다.`
        : p.review.state === "revision" && last
          ? `${last.n}차 검토에 수정 요청을 받았습니다 — 고쳐서 새로 출력한 뒤 다시 보내세요.`
          : p.review.rounds.length === 0
            ? "아직 고객사에 보내지 않았습니다. 완성 파일을 골라 검토를 보내세요."
            : "지금 고객사가 검토 중인 파일이 없습니다. 완성 파일을 골라 보내세요.";

  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Badge size="lg" tone={STATE_TONE[p.review.state]}>{REVIEW_LABEL[p.review.state]}</Badge>
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-nd-body">
            <span>수정 <span className="nd-num font-semibold">{p.review.revisionsUsed} / {limit}</span>회 사용</span>
            <Meter value={p.review.revisionsUsed} max={limit} warnAbove={1} width={80} />
            <span className={left === 0 ? "text-nd-danger-text" : "text-nd-fg-2"}>{left === 0 ? "계약 상한에 닿았습니다 (이후 요청은 「계약 범위 밖」 으로 기록)" : `남은 ${left}회`}</span>
          </span>
        </div>
        {!(noFile && p.review.state === "none") && (
          <InlineNotice tone={p.review.state === "approved" ? "success" : p.review.state === "revision" ? "warning" : p.review.state === "waiting" ? "info" : "neutral"}>{status}</InlineNotice>
        )}

        {noFile ? (
          <InlineNotice tone="neutral" icon={Film}>완성 파일이 없습니다. 「편집·출력」 에서 MP4 를 출력한 뒤 보내세요.</InlineNotice>
        ) : (
          <div className="grid gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
            <div className="w-full max-w-[220px]">
              <RenderPlayer media={shown} loading={loading} />
            </div>
            <div className="min-w-0 space-y-4">
              {p.review.state === "approved" ? (
                <>
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] text-nd-fg-3">승인된 파일</span>
                      <Badge size="lg" tone="success"><CheckCircle2 size={14} aria-hidden />고객 승인 · {approvedRound?.n}차 검토</Badge>
                    </div>
                    {approvedRender ? (
                      <>
                        <p className="truncate text-nd-body font-medium" title={approvedRender.name}>{approvedRender.name}</p>
                        <p className="nd-num text-[13px] text-nd-fg-3">{renderMeta(approvedRender)}</p>
                      </>
                    ) : (
                      <p className="text-[13px] text-nd-fg-3">승인된 파일을 이 목록에서 찾지 못했습니다 (지워졌을 수 있습니다).</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <InlineNotice tone="success" className="flex-1">승인된 파일만 게시할 수 있습니다. 다시 고쳐야 하면 승인을 취소하고 새로 출력해 보내세요.</InlineNotice>
                    <Button size="sm" variant="secondary" disabled={busy === "reopen"} onClick={() => void run("reopen", async () => { await mutate("review.reopen", { projectId: p.id }); await reload(); }, "승인을 취소했습니다 (기록은 남습니다).")}>승인 취소</Button>
                  </div>
                </>
              ) : (
                <>
                  {info && (
                    <div className="space-y-1">
                      <span className="flex flex-wrap items-center gap-2 text-[13px] text-nd-fg-3">
                        {underReview ? <>고객사가 보고 있는 파일 <Badge tone="info">{pendingRound!.n}차 검토</Badge></> : "보낼 파일"}
                      </span>
                      <p className="truncate text-nd-body font-medium" title={info.name}>{info.name}</p>
                      <p className="nd-num text-[13px] text-nd-fg-3">{renderMeta(info)}</p>
                    </div>
                  )}
                  <FormRow className="grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <Field label={underReview ? "다시 보낼 완성 파일" : "보낼 완성 파일"}>
                      <Select size="sm" value={renderId || renders[0].id} onChange={(e) => setRenderId(e.target.value)}>
                        {renders.map((r) => <option key={r.id} value={r.id}>{fmtWhen(r.createdAt)} · {r.duration?.toFixed(1)}초{r.overlay?.disclosure ? ` · 고지 띠 「${r.overlay.text}」` : ""}{r.id === underReview?.id ? " · 지금 검토 중" : ""}</option>)}
                      </Select>
                    </Field>
                    <FieldAction>
                      <Button size="sm" icon={Send} disabled={busy === "send"} onClick={() => void run("send", async () => {
                        await flush();
                        const r = await mutate<{ url: string; round: number }>("review.send", { projectId: p.id, renderId: renderId || renders[0].id });
                        setLink(r.url);
                        await reload();
                      }, "검토 링크를 만들었습니다 — 고객사에 보내 주세요.")}>{p.review.state === "waiting" ? "새 파일로 다시 보내기" : "검토 보내기"}</Button>
                    </FieldAction>
                  </FormRow>
                </>
              )}
              {link && (
                <div className="space-y-2 rounded-nd-md bg-nd-fg/[.04] p-3">
                  <span className="text-[13px] font-medium text-nd-fg-2">검토 링크</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-nd-sm bg-nd-content px-2 py-1.5 text-[13px]" title={link}>{link}</code>
                    <Button size="sm" variant="secondary" icon={Copy} onClick={() => void navigator.clipboard.writeText(link).then(() => toast.success("링크를 복사했습니다."))}>복사</Button>
                  </div>
                  <p className="text-[13px] text-nd-fg-3">30일 동안 그 영상 한 편만 볼 수 있습니다 (로그인 없음). 링크는 지금 한 번만 보입니다 — 서버에는 링크를 저장하지 않습니다.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      {last && last.decision === "pending" && (
        <section>
          <SectionHeader size="lg" title="카톡 · 메일로 받은 답 기록" hint="링크 대신 다른 길로 받은 답 — 누가 기록했는지 남습니다" />
          <Card className="space-y-2">
            <FormRow className="grid-cols-1 sm:grid-cols-[140px_minmax(0,1fr)_minmax(0,2fr)_auto]">
              <Field label="답">
                <Select size="sm" value={rec.decision} onChange={(e) => setRec({ ...rec, decision: e.target.value })}>
                  <option value="approved">승인</option>
                  <option value="revision">수정 요청</option>
                </Select>
              </Field>
              <Field label="고객사 쪽 이름"><Input size="sm" value={rec.decidedBy} onChange={(e) => setRec({ ...rec, decidedBy: e.target.value })} /></Field>
              <Field label="수정 내용" required={rec.decision === "revision"}><Input size="sm" value={rec.feedback} onChange={(e) => setRec({ ...rec, feedback: e.target.value })} /></Field>
              <FieldAction>
                <Button size="sm" variant="secondary" disabled={busy === "rec"} onClick={() => void run("rec", async () => { await mutate("review.record", { projectId: p.id, ...rec }); await reload(); }, "기록했습니다.")}>기록</Button>
              </FieldAction>
            </FormRow>
            <p className="text-[13px] text-nd-fg-3">{last.n}차 검토에 대한 답입니다. 한 번 기록하면 이 회차의 답은 바꿀 수 없습니다 · 수정 요청이면 수정 내용을 적어 주세요 · 남은 수정 {left}회</p>
          </Card>
        </section>
      )}

      <section>
        <SectionHeader size="lg" title="검토 기록" hint={`${p.review.rounds.length}회`} />
        {p.review.rounds.length === 0 ? (
          <p className="rounded-nd-lg border border-dashed border-nd-strong px-4 py-5 text-center text-nd-body text-nd-fg-3">아직 보낸 적이 없습니다.</p>
        ) : (
          <Card padding="none" className="overflow-hidden">
            <TableScroll>
              <Table size="md" minWidth={820}>
                <thead>
                  <tr>
                    <Th className="w-[64px]">회차</Th>
                    <Th>보냄</Th>
                    <Th>파일</Th>
                    <Th>답</Th>
                    <Th>답한 사람</Th>
                    <Th className="w-[34%]">의견</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-nd-line">
                  {p.review.rounds.map((r) => {
                    const d = DECISION[r.decision];
                    const f = fileOf(r.renderId);
                    const isApproved = approvedRound?.n === r.n;
                    return (
                      <tr key={r.n} className="align-top">
                        <Td className="font-medium">{r.n}차</Td>
                        <Td>
                          <span className="nd-num">{fmtWhen(r.sentAt)}</span>
                          <span className="block text-[13px] text-nd-fg-3">{nameOf(r.sentBy)}</span>
                        </Td>
                        <Td className="max-w-[200px]">
                          {f ? <span className="nd-num block truncate text-[13px] text-nd-fg-2" title={f.name}>{fmtWhen(f.createdAt)} · {fmtSec(f.duration)}</span> : <span className="text-[13px] text-nd-fg-3">목록에 없음</span>}
                          {isApproved && <span className="mt-1 block"><Badge tone="success">승인된 파일</Badge></span>}
                        </Td>
                        <Td>
                          <span className="flex flex-wrap gap-1.5">
                            <Badge size="lg" tone={d.tone}>{d.label}</Badge>
                            {r.extra && <Badge size="lg" tone="danger">계약 범위 밖</Badge>}
                          </span>
                        </Td>
                        <Td className="max-w-[220px]">
                          {r.decidedAt ? (
                            <>
                              <span className="block truncate" title={r.decidedBy ?? ""}>{r.decidedBy || "이름 없음"}</span>
                              <span className="nd-num block text-[13px] text-nd-fg-3">{r.decidedVia === "link" ? "링크" : "담당자 기록"} · {fmtWhen(r.decidedAt)}</span>
                            </>
                          ) : (
                            <span className="text-nd-fg-3">—</span>
                          )}
                        </Td>
                        <Td>{r.feedback ? <span className="whitespace-pre-wrap">「{r.feedback}」</span> : <span className="text-nd-fg-3">{r.decision === "pending" ? "아직 답 없음" : "—"}</span>}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableScroll>
          </Card>
        )}
      </section>
    </div>
  );
}
