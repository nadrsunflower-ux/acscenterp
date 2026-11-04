"use client";

// ============================================================
//  고객사 영상의 두 탭 — 「고객사」(브리프 · 제품) · 「고객 승인」(검토 링크 · 수정 횟수)
// ------------------------------------------------------------
//  브리프 · 금지 표현 · 제품 사실 · 게시 방식은 업체 문서가 정본이다 — 여기서는 보여 주고,
//  고치려면 업체 화면으로 간다 (영상마다 따로 고치면 갈라진다).
//  승인 기록은 서버만 쓴다 (reviews.ts). 게시는 승인된 그 파일만 된다.
//  제작 완료 ≠ 고객 승인 ≠ 납품 완료 — 승인은 보낸 그 파일에 묶인다.
// ============================================================

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ArrowUpRight, Ban, Building2, CheckCircle2, CircleCheck, Copy, ExternalLink, Film, ImageIcon, Link2, Send } from "lucide-react";
import { Badge, Button, EmptyState, Field, FieldAction, FormRow, Input, Select, buttonClass, cn, type Tone, useToast } from "@/components/neander/ui";
import { mutate } from "@/lib/neander/shorts/client";
import { REVIEW_LABEL, fmtSec, revisionsLeft, scanClaims } from "@/lib/neander/shorts/model";
import { spaceOf } from "@/lib/neander/shorts/spaces";
import { CLIENT_DELIVERY_LABEL, type MediaView, type ProjectDoc, type ReviewRound } from "@/lib/neander/shorts/types";
import { useShorts, type WithId } from "../ShortsProvider";
import { MediaThumb, useBlobUrl, useProjectMedia } from "../media";
import { fmtWhen, useAction } from "../parts";
import { AttentionList, ProgressLine, StudioCard, StudioNotice, type AttentionItem } from "../studio";
import type { Draft } from "../useProjectDraft";

/** 브리프 · 제품 정보의 한 줄 — 위 이름, 아래 값 (구분선으로 나눈다) */
function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t border-nd-line py-3 first:border-t-0 first:pt-0">
      <dt className="text-[13px] text-nd-fg-3">{label}</dt>
      <dd className="mt-0.5 min-w-0 text-nd-body text-nd-fg">{children}</dd>
    </div>
  );
}
const Unset = () => <span className="text-nd-fg-3">미입력</span>;

/** 업체 문서가 정하는 값 — 입력칸처럼 보이지만 여기서는 못 고친다 (업체 화면에서) */
function ReadOnlyField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-nd-caption font-medium text-nd-fg-2">{label}</span>
      <div className="flex h-ctl-sm min-w-0 items-center rounded-nd-md border border-nd-line bg-nd-sunken px-3 text-nd-body text-nd-fg">{children}</div>
      {hint && <span className="text-[13px] text-nd-fg-3">{hint}</span>}
    </div>
  );
}

export function ClientInfoTab({ draft }: { draft: Draft }) {
  const { p, update } = draft;
  const { data, nameOf } = useShorts();
  const client = data!.clients.find((c) => c.id === p.clientId);
  if (!client) return <StudioNotice tone="warning" title="이 영상의 업체를 찾지 못했습니다">담당자가 아니거나 업체가 지워졌습니다. 업체 담당자 · 관리자만 대행 영상을 볼 수 있습니다.</StudioNotice>;
  const product = client.products.find((x) => x.id === p.clientProductId) ?? null;
  const flags = scanClaims(p.script.lines.map((l) => `${l.text}\n${l.caption}`).join("\n") + "\n" + p.publish.description, [], client.brief.banned).filter((f) => f.kind === "banned");
  const b = client.brief;
  const delivery = client.delivery ?? "upload";
  const editHref = `/neander/shorts/clients/${client.id}`;
  const monthText = p.month ? `${Number(p.month.slice(5))}월 계약분` : "계약 월 미정";
  const managers = client.members.map(nameOf).join(" · ");
  return (
    <div className="space-y-6">
      <StudioNotice
        tone="info"
        icon={Building2}
        title={`${client.name} · ${monthText}`}
        action={
          <Link href={editHref} className={buttonClass("secondary", "sm", "gap-1.5")}>
            <ExternalLink size={14} aria-hidden />
            업체에서 고치기
          </Link>
        }
      >
        월 {client.contract.videosPerMonth}편 · 편당 수정 {client.contract.revisionLimit}회 · 고객사 담당 {client.contactName || "미입력"}
        {managers ? ` · 우리 담당 ${managers}` : ""} · 관리자와 지정 담당자만 볼 수 있습니다.
      </StudioNotice>

      <FormRow className="grid-cols-1 md:grid-cols-2">
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
        <ReadOnlyField label="게시 방식 (업체 계약)" hint="업체 계약에서 정합니다 — 바꾸려면 「업체에서 고치기」">
          {CLIENT_DELIVERY_LABEL[delivery]}
        </ReadOnlyField>
      </FormRow>

      {flags.length > 0 && (
        <StudioNotice tone="danger" icon={Ban} title={`대본 · 설명에 금지 표현 ${flags.length}개`}>
          {flags.map((f) => `「${f.phrase}」`).join(" ")} — 「공식·대본」 · 「게시」 탭에서 고쳐 주세요.
        </StudioNotice>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <StudioCard title="고객사 브리프" description="업체 문서가 정본입니다">
          {b.summary ? <p className="mb-4 whitespace-pre-wrap text-[17px] font-semibold leading-relaxed text-nd-fg">{b.summary}</p> : <p className="mb-4 text-[13px] text-nd-fg-3">브리프 요약이 없습니다 — 업체 화면에서 넣어 주세요.</p>}
          <dl>
            <InfoRow label="대상">{b.target || <Unset />}</InfoRow>
            <InfoRow label="말투 · 핵심 메시지">{[b.tone, ...b.keyMessages].filter(Boolean).join(" · ") || <Unset />}</InfoRow>
          </dl>

          {/* 반드시 넣을 것 — 빠지면 고객 검토에서 돌아온다 */}
          <div className="mt-3 rounded-nd-md border border-nd-accent/25 bg-nd-accent-soft/40 p-3.5">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <CircleCheck size={16} className="text-nd-accent-strong" aria-hidden />
              <span className="text-nd-body font-semibold text-nd-accent-strong">꼭 넣을 것</span>
              <span className="text-[13px] text-nd-fg-3">장면 · 대본에 모두 들어갔는지 확인하세요</span>
            </div>
            {b.mustInclude.length ? (
              <ul className="space-y-1">
                {b.mustInclude.map((w) => (
                  <li key={w} className="flex items-start gap-2 text-nd-body text-nd-fg">
                    <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-nd-accent" />
                    {w}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-nd-fg-3">등록된 필수 요소가 없습니다.</p>
            )}
          </div>

          <div className="mt-3 rounded-nd-md border border-nd-danger/25 bg-nd-danger-soft/40 p-3.5">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Ban size={16} className="text-nd-danger-text" aria-hidden />
              <span className="text-nd-body font-semibold text-nd-danger-text">금지 표현</span>
              <span className="text-[13px] text-nd-fg-3">대본 · 자막 · 설명에 쓰지 않습니다</span>
            </div>
            {b.banned.length ? (
              <>
                <div className="flex flex-wrap gap-1.5">{b.banned.map((w) => <Badge key={w} size="lg" tone="danger">{w}</Badge>)}</div>
                <p className={cn("mt-2 text-[13px]", flags.length ? "font-medium text-nd-danger-text" : "text-nd-success-text")}>
                  {flags.length ? `지금 대본 · 설명에서 ${flags.length}개를 찾았습니다 — 고쳐 주세요.` : "지금 대본 · 설명에서는 찾지 못했습니다."}
                </p>
              </>
            ) : (
              <p className="text-[13px] text-nd-fg-3">등록된 금지 표현이 없습니다.</p>
            )}
          </div>

          {b.references.length > 0 && (
            <div className="mt-3 space-y-1">
              <span className="text-[13px] text-nd-fg-3">참고 링크</span>
              {b.references.map((r) =>
                /^https?:\/\//.test(r) ? (
                  <a key={r} href={r} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1 text-nd-body text-nd-accent hover:underline">
                    <Link2 size={14} aria-hidden className="shrink-0" />
                    <span className="truncate" title={r}>{r}</span>
                  </a>
                ) : (
                  <p key={r} className="text-nd-body text-nd-fg-2">{r}</p>
                ),
              )}
            </div>
          )}
          {b.notes && <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-nd-fg-2">{b.notes}</p>}
        </StudioCard>

        <StudioCard title="제품 · 실사진 대조" description="확인된 사실만 대본에 씁니다 · 실사진과 AI 장면을 견줘 외형이 다르면 그 장면은 반려">
          {product ? (
            <div className="space-y-4">
              {product.photoIds.length > 0 ? (
                <div className="flex flex-wrap gap-3">
                  {product.photoIds.map((id, i) => (
                    <MediaThumb key={id} id={id} alt={`${product.name} 실사진 ${i + 1}`} className="h-40 w-40 rounded-nd-md" />
                  ))}
                </div>
              ) : (
                <p className="rounded-nd-md border border-dashed border-nd-strong px-4 py-5 text-center text-nd-body text-nd-fg-3">등록된 실사진이 없습니다 — 업체 화면에서 올려 주세요.</p>
              )}
              <dl>
                <InfoRow label="제품명"><span className="font-medium">{product.name}</span></InfoRow>
                {product.url && (
                  <InfoRow label="제품 주소">
                    <a href={product.url} target="_blank" rel="noreferrer" className="block truncate text-nd-accent hover:underline" title={product.url}>{product.url}</a>
                  </InfoRow>
                )}
                <InfoRow label={`확인된 사실 ${product.facts.length}개`}>
                  {product.facts.length > 0 ? (
                    <ul className="list-disc space-y-1 pl-5">{product.facts.map((f) => <li key={f}>{f}</li>)}</ul>
                  ) : (
                    <span className="text-nd-fg-3">확인된 사실이 없습니다 — 업체 화면에서 넣어 주세요.</span>
                  )}
                </InfoRow>
                {product.note && <InfoRow label="메모"><span className="whitespace-pre-wrap text-nd-fg-2">{product.note}</span></InfoRow>}
              </dl>
              <p className="text-[13px] text-nd-fg-3">실제 제품 외형은 업체 자료를 정본으로 씁니다.</p>
            </div>
          ) : (
            <EmptyState compact icon={ImageIcon} title="제품을 고르지 않았습니다" description="위 「제품」 에서 이 영상의 제품을 고르면 확인된 사실과 실사진이 보입니다." />
          )}
        </StudioCard>
      </div>

      <StudioNotice tone="info" title={delivery === "file" ? "이 업체는 「완성 파일만 납품」 계약입니다" : "이 업체는 「우리가 고객사 계정에 게시」 계약입니다"}>
        {delivery === "file"
          ? "게시는 고객사가 합니다. 「게시」 탭에서 계정 선택 대신 고객이 승인한 완성 파일 내려받기 · 전달 기록이 먼저 보입니다."
          : "고객이 승인한 그 파일만 고객사 계정에 올립니다. 계약이 「완성 파일만 납품」 으로 바뀌면 업체 화면에서 게시 방식을 바꾸세요."}
      </StudioNotice>
    </div>
  );
}

// ---- 고객 승인 ------------------------------------------------------------

const STATE_TONE: Record<ProjectDoc["review"]["state"], Tone> = { none: "neutral", waiting: "info", revision: "warning", approved: "success" };
const DECISION: Record<ReviewRound["decision"], { label: string; tone: Tone; bar: string }> = {
  pending: { label: "답 기다림", tone: "info", bar: "bg-nd-info" },
  approved: { label: "고객 승인", tone: "success", bar: "bg-nd-success" },
  revision: { label: "수정 요청", tone: "warning", bar: "bg-nd-warning" },
  withdrawn: { label: "거둬들임", tone: "neutral", bar: "bg-nd-fg-4" },
};

/** 완성 파일 한 줄 설명 — 만든 때 · 길이 · 해상도 · 크기 · 고지 띠 */
function renderMeta(r: MediaView) {
  return [fmtWhen(r.createdAt), fmtSec(r.duration), r.width && r.height ? `${r.width}×${r.height}` : null, `${(r.size / 1024 / 1024).toFixed(1)}MB`, r.overlay?.disclosure ? `고지 띠 「${r.overlay.text}」` : null]
    .filter(Boolean)
    .join(" · ");
}

/** 고객에게 보낼(보낸) 완성 파일 — 9:16 으로 재생. 파일이 없으면 아이콘 상자 */
function RenderPlayer({ media, loading }: { media: MediaView | null; loading: boolean }) {
  const { url, error, purged } = useBlobUrl(media?.id ?? null);
  if (media && url && !error) return <video src={url} controls playsInline className="aspect-[9/16] w-full rounded-nd-md bg-black" aria-label={media.name} />;
  return (
    <div className="flex aspect-[9/16] w-full flex-col items-center justify-center gap-1.5 rounded-nd-md bg-nd-sunken px-3 text-center text-nd-fg-3">
      <Film size={22} aria-hidden />
      <span className="text-[13px]">
        {!media ? (loading ? "불러오는 중" : "완성 파일 없음") : purged ? (purged === "published" ? "게시가 끝나 파일을 지웠습니다 — 「게시」 탭의 링크로 보세요" : "오래 쓰지 않아 파일을 지웠습니다") : error ? "파일을 받지 못했습니다" : "불러오는 중"}
      </span>
    </div>
  );
}

export function ReviewTab({ draft }: { draft: Draft }) {
  const { p, flush, replace } = draft;
  const { data, nameOf } = useShorts();
  const d = data!;
  const toast = useToast();
  const { busy, run } = useAction();
  const client = d.clients.find((c) => c.id === p.clientId);
  const { media, loading, error: mediaError, retry: retryMedia } = useProjectMedia(p.id);
  // 게시 뒤 내용을 지운 파일은 다시 보낼 수 없다
  const renders = media.filter((m) => m.kind === "render" && !m.purged && p.renderIds.includes(m.id)).sort((a, b) => b.createdAt - a.createdAt);
  const [renderId, setRenderId] = useState(renders[0]?.id ?? "");
  const [link, setLink] = useState<string | null>(null);
  const [rec, setRec] = useState({ decision: "approved", feedback: "", decidedBy: client?.contactName ?? "" });
  const [watch, setWatch] = useState<number | null>(null);
  const limit = client?.contract.revisionLimit ?? 0;
  const left = revisionsLeft(p.review, limit);
  const over = Math.max(0, p.review.revisionsUsed - limit);
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
  const lastAnswer = [...p.review.rounds].reverse().find((r) => r.decidedAt);
  const reload = async () => {
    const { project } = await mutate<{ project: WithId<ProjectDoc> }>("project.get", { id: p.id });
    replace(project);
  };

  const headline =
    p.review.state === "approved" && approvedRound
      ? { title: `${p.title || "이 영상"} · 고객 승인 완료`, body: `${fmtWhen(approvedRound.decidedAt)} ${approvedRound.n}차 파일을 ${approvedRound.decidedBy || "고객사"} 이(가) 승인했습니다 (${approvedRound.decidedVia === "link" ? "검토 링크" : "담당자 기록"}) · 수정 요청 ${p.review.revisionsUsed}회. 승인된 이 파일로 게시 · 납품을 준비하세요.` }
      : p.review.state === "waiting" && last
        ? { title: `${last.n}차 검토 · 고객 답을 기다리는 중`, body: `${fmtWhen(last.sentAt)} 에 보냈습니다. 고객사가 링크에서 답하거나, 카톡 · 메일로 받은 답을 아래에 기록하세요.` }
        : p.review.state === "revision" && last
          ? { title: `${last.n}차 검토 · 수정 요청 받음`, body: `${last.feedback ? `「${last.feedback}」 — ` : ""}고쳐서 새로 출력한 뒤 다시 보내세요.${left === 0 ? " 계약 수정 횟수를 다 썼습니다." : ""}` }
          : p.review.rounds.length === 0
            ? { title: "아직 고객사에 보내지 않았습니다", body: noFile ? "「편집·출력」 에서 MP4 를 출력한 뒤 검토 링크를 보내세요." : "완성 파일을 골라 검토 링크를 만드세요." }
            : { title: "지금 고객사가 검토 중인 파일이 없습니다", body: "완성 파일을 골라 다시 보내세요." };

  // 같은 업체의 다른 영상 — 답을 기다리거나 수정 요청 · 상한을 넘긴 것
  const others: AttentionItem[] = d.projects
    .filter((x) => x.clientId && x.clientId === p.clientId && x.id !== p.id && (x.review.state === "revision" || x.review.state === "waiting" || x.review.revisionsUsed > limit))
    .map((x) => {
      const space = d.spaces.find((s) => s.id === spaceOf(x));
      const xLast = x.review.rounds[x.review.rounds.length - 1];
      const xOver = Math.max(0, x.review.revisionsUsed - limit);
      return {
        key: x.id,
        label: x.review.state === "revision" ? "수정 요청" : x.review.state === "waiting" ? "고객 검토 중" : REVIEW_LABEL[x.review.state],
        tone: (x.review.state === "revision" || xOver ? "warning" : "info") as Tone,
        title: `${space ? `${space.name} · ` : ""}${x.title || "제목 없음"}`,
        detail: [
          `수정 ${x.review.revisionsUsed} / ${limit}회${xOver ? ` · 상한 ${xOver}회 초과` : ""}`,
          x.review.state === "revision" && xLast?.feedback ? `고객 요청 「${xLast.feedback}」` : null,
          x.review.state === "waiting" && xLast ? `${xLast.n}차 · ${fmtWhen(xLast.sentAt)} 보냄` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        href: `/neander/shorts/projects/${x.id}?tab=review`,
        actionLabel: "그 영상 열기",
      };
    });

  return (
    <div className="space-y-6">
      {mediaError && (
        <StudioNotice tone="danger" title="이 영상의 파일 목록을 받지 못했습니다" action={<Button size="sm" variant="secondary" onClick={retryMedia}>다시 시도</Button>}>
          {mediaError}
        </StudioNotice>
      )}
      <StudioNotice tone={STATE_TONE[p.review.state]} title={headline.title}>
        {headline.body}
      </StudioNotice>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <StudioCard
          title={p.review.state === "approved" ? "승인된 파일 · 검토 링크" : "검토 링크 · 보낼 파일"}
          action={<Badge size="lg" tone={STATE_TONE[p.review.state]}>{REVIEW_LABEL[p.review.state]}</Badge>}
        >
          {noFile ? (
            <EmptyState compact icon={Film} title="보낼 완성 파일이 없습니다" description="「편집·출력」 에서 MP4 를 출력하거나 다 만든 영상을 올린 뒤 보내세요." action={<Link href={`/neander/shorts/projects/${p.id}?tab=edit`} scroll={false} className={buttonClass("secondary", "sm")}>편집·출력으로</Link>} />
          ) : (
            <div className="grid gap-5 sm:grid-cols-[160px_minmax(0,1fr)]">
              <div className="w-full max-w-[160px]">
                <RenderPlayer media={shown} loading={loading} />
              </div>
              <div className="min-w-0 space-y-4">
                {p.review.state === "approved" ? (
                  <>
                    <div className="space-y-1.5">
                      <Badge size="lg" tone="success"><CheckCircle2 size={14} aria-hidden />고객 승인 · {approvedRound?.n}차 검토</Badge>
                      {approvedRender ? (
                        <>
                          <p className="truncate text-nd-body font-medium" title={approvedRender.name}>{approvedRender.name}</p>
                          <p className="nd-num text-[13px] text-nd-fg-3">{renderMeta(approvedRender)}</p>
                        </>
                      ) : (
                        <p className="text-[13px] text-nd-fg-3">승인된 파일을 이 목록에서 찾지 못했습니다 (지워졌을 수 있습니다).</p>
                      )}
                    </div>
                    <p className="text-[13px] leading-relaxed text-nd-fg-2">승인된 파일만 게시 · 납품할 수 있습니다. 다시 고쳐야 하면 승인을 취소하고 새로 출력해 보내세요 (기록은 남습니다).</p>
                    <Button size="sm" variant="secondary" disabled={busy === "reopen"} onClick={() => void run("reopen", async () => { await mutate("review.reopen", { projectId: p.id }); await reload(); }, "승인을 취소했습니다 (기록은 남습니다).")}>승인 취소</Button>
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
                    <p className="text-[13px] text-nd-fg-3">승인은 보낸 그 파일에 묶입니다. 파일을 바꾸면 다시 승인을 받아야 합니다.</p>
                  </>
                )}
                {link && (
                  <div className="space-y-2 rounded-nd-md bg-nd-sunken p-3">
                    <span className="text-[13px] font-medium text-nd-fg-2">검토 링크 (로그인 없이 여는 전용 링크)</span>
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded-nd-sm bg-nd-content px-2 py-1.5 text-[13px]" title={link}>{link}</code>
                      <Button size="sm" variant="secondary" icon={Copy} onClick={() => void navigator.clipboard.writeText(link).then(() => toast.success("링크를 복사했습니다."))}>검토 링크 복사</Button>
                    </div>
                    <p className="text-[13px] text-nd-fg-3">30일 동안 그 영상 한 편만 볼 수 있습니다. 링크는 지금 한 번만 보입니다 — 서버에는 링크를 저장하지 않습니다.</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </StudioCard>

        <StudioCard
          title="수정 횟수"
          action={
            over > 0 ? (
              <Badge size="lg" tone="danger">상한 {over}회 초과</Badge>
            ) : (
              <Badge size="lg" tone={left === 0 ? "warning" : "info"}>{left === 0 ? "남은 수정 없음" : `${left}회 남음`}</Badge>
            )
          }
        >
          <div className="space-y-3">
            <p className="nd-num text-[32px] font-bold leading-none tracking-[-0.02em] text-nd-fg">
              {p.review.revisionsUsed}
              <span className="ml-1 text-[17px] font-semibold text-nd-fg-2">/ {limit}회</span>
            </p>
            <ProgressLine value={p.review.revisionsUsed} total={limit} tone={over > 0 ? "danger" : left === 0 ? "warning" : "accent"} />
            <p className="text-[13px] text-nd-fg-2">
              {client ? `계약에 포함된 수정은 편당 ${limit}회입니다.` : "업체 계약을 찾지 못해 상한을 모릅니다."} {left === 0 && limit > 0 ? "이후 수정 요청은 「계약 범위 밖」 으로 기록됩니다." : ""}
            </p>
            {lastAnswer ? (
              <div className="rounded-nd-md border border-nd-line bg-nd-sunken/60 px-4 py-3">
                <p className="text-[13px] font-semibold text-nd-fg">고객 회신 · {lastAnswer.n}차</p>
                <p className="mt-1 whitespace-pre-wrap text-nd-body text-nd-fg">{lastAnswer.feedback ? `「${lastAnswer.feedback}」` : DECISION[lastAnswer.decision].label}</p>
                <p className="nd-num mt-1 text-[13px] text-nd-fg-3">{lastAnswer.decidedBy || "이름 없음"} · {lastAnswer.decidedVia === "link" ? "검토 링크" : "담당자 기록"} · {fmtWhen(lastAnswer.decidedAt)}</p>
              </div>
            ) : (
              <p className="text-[13px] text-nd-fg-3">아직 받은 고객 회신이 없습니다.</p>
            )}
          </div>
        </StudioCard>
      </div>

      {last && last.decision === "pending" && (
        <StudioCard title="카톡 · 메일로 받은 답 기록" description="링크 대신 다른 길로 받은 답 — 누가 기록했는지 남습니다">
          <div className="space-y-2">
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
          </div>
        </StudioCard>
      )}

      <StudioCard title="회차별 검토 기록" description={p.review.rounds.length ? `${p.review.rounds.length}회 보냄 · 최근 회차가 위` : undefined}>
        {p.review.rounds.length === 0 ? (
          <p className="rounded-nd-md border border-dashed border-nd-strong px-4 py-5 text-center text-nd-body text-nd-fg-3">아직 보낸 적이 없습니다.</p>
        ) : (
          <ol className="space-y-3">
            {[...p.review.rounds].reverse().map((r) => {
              const dd = DECISION[r.decision];
              const f = fileOf(r.renderId);
              const isApproved = approvedRound?.n === r.n;
              return (
                <li key={r.n} className="flex gap-3">
                  <span aria-hidden className={cn("w-1 shrink-0 rounded-full", dd.bar)} />
                  <div className="min-w-0 flex-1 py-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-nd-body font-semibold text-nd-fg">{r.n}차 · {dd.label}</span>
                      <Badge size="lg" tone={dd.tone}>{dd.label}</Badge>
                      {r.extra && <Badge size="lg" tone="danger">계약 범위 밖</Badge>}
                      {isApproved && <Badge size="lg" tone="success">승인된 파일</Badge>}
                    </div>
                    <p className="nd-num mt-1 text-[13px] text-nd-fg-2">
                      {f ? <span title={f.name}>{f.name} · {fmtSec(f.duration)}</span> : "파일이 목록에 없음"} · {fmtWhen(r.sentAt)} {nameOf(r.sentBy)} 보냄
                      {r.decidedAt ? ` · ${fmtWhen(r.decidedAt)} ${r.decidedBy || "이름 없음"} (${r.decidedVia === "link" ? "링크" : "담당자 기록"})` : ""}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-nd-body text-nd-fg">
                      {r.feedback ? `「${r.feedback}」` : <span className="text-nd-fg-3">{r.decision === "pending" ? "아직 답 없음" : r.decision === "approved" ? "수정 요청 없이 승인했습니다." : "의견 없음"}</span>}
                    </p>
                    {f && !f.purged && (
                      <div className="mt-2">
                        <Button size="sm" variant="ghost" icon={Film} onClick={() => setWatch(watch === r.n ? null : r.n)}>{watch === r.n ? "파일 닫기" : "파일 보기"}</Button>
                        {watch === r.n && <div className="mt-2 w-full max-w-[160px]"><RenderPlayer media={f} loading={false} /></div>}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </StudioCard>

      {others.length > 0 && (
        <StudioCard title="같은 업체의 다른 영상에서 확인할 일" description="이 영상 밖의 일입니다 — 그 영상에서 열어 처리하세요">
          <AttentionList items={others} />
        </StudioCard>
      )}

      <StudioNotice
        tone="info"
        title="수정 상한을 넘기면 담당자가 먼저 확인합니다"
        action={
          client ? (
            <Link href={`/neander/shorts/clients/${client.id}`} className={buttonClass("secondary", "sm", "gap-1.5")}>
              <ArrowUpRight size={14} aria-hidden />
              업체 · 계약 보기
            </Link>
          ) : undefined
        }
      >
        상한을 넘긴 요청도 「계약 범위 밖」 으로 기록됩니다. 추가 작업 여부는 업체 · 계약 화면에서 협의 내용을 확인하세요.
      </StudioNotice>
    </div>
  );
}
