"use client";

// ============================================================
//  고객사 영상의 두 탭 — 「고객사」(브리프 · 제품) · 「고객 승인」(검토 링크 · 수정 횟수)
// ------------------------------------------------------------
//  브리프 · 금지 표현 · 제품 사실은 고객사 문서가 정본이다 — 여기서는 보여 주고,
//  고치려면 고객사 화면으로 간다 (영상마다 따로 고치면 갈라진다).
//  승인 기록은 서버만 쓴다 (reviews.ts). 게시는 승인된 그 파일만 된다.
// ============================================================

import Link from "next/link";
import { useState } from "react";
import { Copy, ExternalLink, Send } from "lucide-react";
import { Badge, Button, Card, Field, FormRow, InlineNotice, Input, SectionHeader, Select, useToast } from "@/components/neander/ui";
import { mutate } from "@/lib/neander/shorts/client";
import { REVIEW_LABEL, revisionsLeft, scanClaims } from "@/lib/neander/shorts/model";
import type { ProjectDoc } from "@/lib/neander/shorts/types";
import { useShorts, type WithId } from "../ShortsProvider";
import { useBlobUrl, useProjectMedia } from "../media";
import { fmtWhen, useAction } from "../parts";
import type { Draft } from "../useProjectDraft";

function Photo({ id }: { id: string }) {
  const { url } = useBlobUrl(id);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" className="h-24 w-24 rounded-nd-md object-cover" /> : <div className="h-24 w-24 rounded-nd-md bg-nd-fg/10" />;
}

export function ClientInfoTab({ draft }: { draft: Draft }) {
  const { p, update } = draft;
  const { data } = useShorts();
  const client = data!.clients.find((c) => c.id === p.clientId);
  if (!client) return <InlineNotice tone="warning">이 영상의 고객사를 찾지 못했습니다 (담당자가 아니거나 지워졌습니다).</InlineNotice>;
  const product = client.products.find((x) => x.id === p.clientProductId) ?? null;
  const flags = scanClaims(p.script.lines.map((l) => `${l.text}\n${l.caption}`).join("\n") + "\n" + p.publish.description, [], client.brief.banned).filter((f) => f.kind === "banned");
  return (
    <div className="space-y-6">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-nd-section">{client.name}</span>
          <Badge size="sm">{p.month?.slice(5)}월 계약분</Badge>
          <Link href={`/neander/shorts/clients/${client.id}`} className="ml-auto inline-flex items-center gap-1 text-nd-caption text-nd-accent">고객사 화면에서 고치기 <ExternalLink size={12} /></Link>
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
        {flags.length > 0 && <InlineNotice tone="danger">대본 · 설명에 고객사 금지 표현이 있습니다: {flags.map((f) => `「${f.phrase}」`).join(" ")}</InlineNotice>}
      </Card>
      <section>
        <SectionHeader title="브리프" />
        <Card className="space-y-2 text-nd-body">
          {client.brief.summary && <p>{client.brief.summary}</p>}
          <p><span className="text-nd-fg-3">대상</span> {client.brief.target || "—"} · <span className="text-nd-fg-3">말투</span> {client.brief.tone || "—"}</p>
          {client.brief.keyMessages.length > 0 && <p><span className="text-nd-fg-3">핵심 메시지</span> {client.brief.keyMessages.join(" · ")}</p>}
          {client.brief.mustInclude.length > 0 && <p><span className="text-nd-fg-3">반드시 넣을 것</span> {client.brief.mustInclude.join(" · ")}</p>}
          <p><span className="text-nd-fg-3">금지 표현</span> {client.brief.banned.length ? client.brief.banned.map((b) => <Badge key={b} size="sm" tone="danger" className="mr-1">{b}</Badge>) : "—"}</p>
          {client.brief.notes && <p className="text-nd-fg-2">{client.brief.notes}</p>}
        </Card>
      </section>
      {product && (
        <section>
          <SectionHeader title={`제품 · ${product.name}`} hint="실사진과 AI 장면을 견줘 보세요 — 외형이 다르면 그 장면은 반려" />
          <Card className="space-y-3">
            {product.facts.length > 0 ? <ul className="list-disc space-y-0.5 pl-5 text-nd-body">{product.facts.map((f) => <li key={f}>{f}</li>)}</ul> : <p className="text-nd-body text-nd-fg-3">확인된 사실이 없습니다 — 고객사 화면에서 넣어 주세요.</p>}
            <div className="flex flex-wrap gap-2">{product.photoIds.map((id) => <Photo key={id} id={id} />)}</div>
          </Card>
        </section>
      )}
    </div>
  );
}

export function ReviewTab({ draft }: { draft: Draft }) {
  const { p, flush, replace } = draft;
  const { data, nameOf } = useShorts();
  const toast = useToast();
  const { busy, run } = useAction();
  const client = data!.clients.find((c) => c.id === p.clientId);
  const { media } = useProjectMedia(p.id);
  const renders = media.filter((m) => m.kind === "render" && p.renderIds.includes(m.id)).sort((a, b) => b.createdAt - a.createdAt);
  const [renderId, setRenderId] = useState(renders[0]?.id ?? "");
  const [link, setLink] = useState<string | null>(null);
  const [rec, setRec] = useState({ decision: "approved", feedback: "", decidedBy: client?.contactName ?? "" });
  const limit = client?.contract.revisionLimit ?? 0;
  const left = revisionsLeft(p.review, limit);
  const last = p.review.rounds[p.review.rounds.length - 1];
  const reload = async () => {
    const { project } = await mutate<{ project: WithId<ProjectDoc> }>("project.get", { id: p.id });
    replace(project);
  };

  return (
    <div className="space-y-6">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={p.review.state === "approved" ? "success" : p.review.state === "waiting" ? "info" : p.review.state === "revision" ? "warning" : "neutral"}>{REVIEW_LABEL[p.review.state]}</Badge>
          <span className="text-nd-body">수정 {p.review.revisionsUsed} / {limit}회 사용{left === 0 ? " — 계약 상한에 닿았습니다 (이후 요청은 「계약 범위 밖」 으로 기록)" : ` · 남은 ${left}회`}</span>
        </div>
        {p.review.state === "approved" ? (
          <div className="flex flex-wrap items-center gap-2">
            <InlineNotice tone="success" className="flex-1">승인된 파일만 게시할 수 있습니다. 다시 고쳐야 하면 승인을 취소하고 새로 출력해 보내세요.</InlineNotice>
            <Button size="sm" variant="ghost" disabled={busy === "reopen"} onClick={() => void run("reopen", async () => { await mutate("review.reopen", { projectId: p.id }); await reload(); }, "승인을 취소했습니다 (기록은 남습니다).")}>승인 취소</Button>
          </div>
        ) : renders.length === 0 ? (
          <InlineNotice tone="neutral">완성 파일이 없습니다. 「편집·출력」 에서 MP4 를 출력한 뒤 보내세요.</InlineNotice>
        ) : (
          <FormRow className="grid-cols-1 sm:grid-cols-[2fr_auto]">
            <Field label="보낼 완성 파일">
              <Select size="sm" value={renderId || renders[0].id} onChange={(e) => setRenderId(e.target.value)}>
                {renders.map((r) => <option key={r.id} value={r.id}>{fmtWhen(r.createdAt)} · {r.duration?.toFixed(1)}초{r.overlay?.disclosure ? ` · 고지 띠 「${r.overlay.text}」` : ""}</option>)}
              </Select>
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-nd-caption" aria-hidden>{" "}</span>
              <Button size="sm" icon={Send} disabled={busy === "send"} onClick={() => void run("send", async () => {
                await flush();
                const r = await mutate<{ url: string; round: number }>("review.send", { projectId: p.id, renderId: renderId || renders[0].id });
                setLink(r.url);
                await reload();
              }, "검토 링크를 만들었습니다 — 고객사에 보내 주세요.")}>{p.review.state === "waiting" ? "새 파일로 다시 보내기" : "검토 보내기"}</Button>
            </div>
          </FormRow>
        )}
        {link && (
          <div className="flex flex-wrap items-center gap-2 rounded-nd-md bg-nd-fg/[.04] p-3">
            <code className="min-w-0 flex-1 truncate text-nd-caption" title={link}>{link}</code>
            <Button size="sm" variant="secondary" icon={Copy} onClick={() => void navigator.clipboard.writeText(link).then(() => toast.success("링크를 복사했습니다."))}>복사</Button>
            <p className="w-full text-nd-caption text-nd-fg-3">30일 동안 그 영상 한 편만 볼 수 있습니다 (로그인 없음). 링크는 지금 한 번만 보입니다 — 서버에는 링크를 저장하지 않습니다.</p>
          </div>
        )}
      </Card>

      {last && last.decision === "pending" && (
        <section>
          <SectionHeader title="카톡 · 메일로 받은 답 기록" hint="링크 대신 다른 길로 받은 답 — 누가 기록했는지 남습니다" />
          <Card>
            <FormRow className="grid-cols-1 sm:grid-cols-[1fr_1fr_2fr_auto]">
              <Field label="답">
                <Select size="sm" value={rec.decision} onChange={(e) => setRec({ ...rec, decision: e.target.value })}>
                  <option value="approved">승인</option>
                  <option value="revision">수정 요청</option>
                </Select>
              </Field>
              <Field label="고객사 쪽 이름"><Input size="sm" value={rec.decidedBy} onChange={(e) => setRec({ ...rec, decidedBy: e.target.value })} /></Field>
              <Field label="수정 내용"><Input size="sm" value={rec.feedback} onChange={(e) => setRec({ ...rec, feedback: e.target.value })} /></Field>
              <div className="flex flex-col gap-1.5">
                <span className="text-nd-caption" aria-hidden>{" "}</span>
                <Button size="sm" variant="secondary" disabled={busy === "rec"} onClick={() => void run("rec", async () => { await mutate("review.record", { projectId: p.id, ...rec }); await reload(); }, "기록했습니다.")}>기록</Button>
              </div>
            </FormRow>
          </Card>
        </section>
      )}

      <section>
        <SectionHeader title="검토 기록" hint={`${p.review.rounds.length}회`} />
        {p.review.rounds.length === 0 ? (
          <p className="text-nd-body text-nd-fg-3">아직 보낸 적이 없습니다.</p>
        ) : (
          <Card padding="none">
            <ul className="divide-y divide-nd-line">
              {[...p.review.rounds].reverse().map((r) => (
                <li key={r.n} className="px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-2 text-nd-body">
                    <span className="font-medium">{r.n}차</span>
                    <Badge size="sm" tone={r.decision === "approved" ? "success" : r.decision === "revision" ? "warning" : r.decision === "withdrawn" ? "neutral" : "info"}>
                      {r.decision === "approved" ? "승인" : r.decision === "revision" ? "수정 요청" : r.decision === "withdrawn" ? "거둬들임" : "답 기다림"}
                    </Badge>
                    {r.extra && <Badge size="sm" tone="danger">계약 범위 밖</Badge>}
                    <span className="text-nd-caption text-nd-fg-3">보냄 {nameOf(r.sentBy)} {fmtWhen(r.sentAt)}{r.decidedAt ? ` · 답 ${r.decidedBy ?? ""} ${fmtWhen(r.decidedAt)} (${r.decidedVia === "link" ? "링크" : "담당자 기록"})` : ""}</span>
                  </div>
                  {r.feedback && <p className="mt-1 whitespace-pre-wrap text-nd-body text-nd-fg-2">「{r.feedback}」</p>}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
