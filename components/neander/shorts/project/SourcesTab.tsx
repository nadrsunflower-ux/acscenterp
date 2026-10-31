"use client";

// ============================================================
//  소스 탭 — 확인된 사실 · 중국어 검색어 · 해외 소스(링크 · 파일 · 구간)
// ------------------------------------------------------------
//  샤오홍슈 · 더우인은 제3자용 공개 검색 API 가 없다 (2026-10-31 확인). 그래서
//  검색은 새 탭으로 열고, 고른 영상의 링크 · 제작자 · 메모 · 파일을 여기 붙인다.
//  출처 · 이용 조건 칸은 기록용 선택 항목이다 — 편집 승인 조건이 아니다.
// ============================================================

import { useState } from "react";
import { ExternalLink, Film, Languages, Plus, Trash2, WandSparkles } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, FormRow, InlineNotice, Input, NumberInput, SectionHeader, Select, Textarea, useConfirm } from "@/components/neander/ui";
import { deleteMedia, shortsPost } from "@/lib/neander/shorts/client";
import { PLATFORM_LABEL, PLATFORM_SUPPORT, SEGMENT_PURPOSE_LABEL, TERM_KIND_LABEL, newId, platformFromUrl, searchLinks } from "@/lib/neander/shorts/model";
import type { ChineseTermKind, ProjectDoc, SegmentPurpose, ShortsPlatform } from "@/lib/neander/shorts/types";
import { useShorts, type WithId } from "../ShortsProvider";
import { MediaUpload, mediaLabel, useBlobUrl, useProjectMedia } from "../media";
import { useAction } from "../parts";
import type { Draft } from "../useProjectDraft";

export function SourcesTab({ draft }: { draft: Draft }) {
  const { p, update } = draft;
  return (
    <div className="space-y-8">
      <Facts p={p} update={update} />
      {/* 고객사 영상은 고객사 자료 · 촬영본으로 만든다 — 중국어 소스 찾기는 쿠팡 제휴 영상에만 */}
      {p.kind !== "brand" && <ChineseTerms draft={draft} />}
      <Sources draft={draft} />
    </div>
  );
}

function Facts({ p, update }: { p: ProjectDoc; update: Draft["update"] }) {
  const [text, setText] = useState("");
  return (
    <section>
      <SectionHeader title="확인된 사실" hint="대본 · AI 가 쓸 수 있는 것은 여기 적힌 사실뿐입니다 (가격 · 성능 · 후기를 지어내지 않게)" />
      <Card className="space-y-3">
        <FormRow className="grid-cols-1 sm:grid-cols-[1fr_auto]">
          <Field label="상품">
            <Input value={p.product} onChange={(e) => update((x) => void (x.product = e.target.value))} />
          </Field>
          <Field label="카테고리">
            <Input value={p.category} onChange={(e) => update((x) => void (x.category = e.target.value))} />
          </Field>
        </FormRow>
        <ul className="space-y-1.5">
          {p.facts.map((f, i) => (
            <li key={i} className="flex items-center gap-2">
              <Input size="sm" value={f} onChange={(e) => update((x) => void (x.facts[i] = e.target.value))} aria-label={`사실 ${i + 1}`} />
              <Button size="sm" variant="ghost" icon={Trash2} aria-label="지우기" onClick={() => update((x) => void x.facts.splice(i, 1))} />
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Input size="sm" value={text} onChange={(e) => setText(e.target.value)} placeholder={p.kind === "brand" ? "예: 용량 50ml (고객사 상세 페이지 확인)" : "예: 접으면 두께 3cm (쿠팡 상세 페이지 확인)"} onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim()) {
              update((x) => void x.facts.push(text.trim()));
              setText("");
            }
          }} />
          <Button size="sm" variant="secondary" icon={Plus} disabled={!text.trim()} onClick={() => { update((x) => void x.facts.push(text.trim())); setText(""); }}>추가</Button>
        </div>
        <Field label="메모">
          <Textarea rows={2} value={p.notes} onChange={(e) => update((x) => void (x.notes = e.target.value))} />
        </Field>
      </Card>
    </section>
  );
}

function ChineseTerms({ draft }: { draft: Draft }) {
  const { p, update, flush, replace } = draft;
  const { data } = useShorts();
  const { busy, run } = useAction();
  const [term, setTerm] = useState({ text: "", kind: "name" as ChineseTermKind, meaning: "" });
  return (
    <section>
      <SectionHeader
        title="중국어 검색어"
        hint="상품명 · 동의어 · 용도 · 문제 상황"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon={WandSparkles}
            disabled={!data!.status.openrouter.configured || busy === "zh" || !p.product.trim()}
            onClick={() =>
              void run(
                "zh",
                async () => {
                  await flush();
                  const r = await shortsPost<{ project: WithId<ProjectDoc>; costUsd: number }>("ai", { action: "chinese", projectId: p.id });
                  replace(r.project);
                },
                "AI 가 검색어를 더했습니다 — 실제 검색 결과를 보고 고르세요.",
              )
            }
          >
            AI 로 만들기 (약 $0.001)
          </Button>
        }
      />
      <InlineNotice tone="info" className="mb-3">
        샤오홍슈 · 더우인은 공개 검색 API 가 없어 <b>자동 수집하지 않습니다</b>. 검색어 옆 링크로 새 탭에서 찾고, 고른 영상의 링크 · 파일을 아래 「해외 소스」 에 붙이세요.
      </InlineNotice>
      <Card padding="none">
        {p.chinese.terms.length === 0 ? (
          <p className="p-4 text-nd-body text-nd-fg-3">아직 검색어가 없습니다.</p>
        ) : (
          <ul className="divide-y divide-nd-line">
            {p.chinese.terms.map((t, i) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                <Badge size="sm">{TERM_KIND_LABEL[t.kind]}</Badge>
                <span className="font-medium" lang="zh-Hans">{t.text}</span>
                <span className="text-nd-caption text-nd-fg-3">{t.meaning}</span>
                {t.by === "ai" && <Badge size="sm" tone="accent">AI 제안</Badge>}
                <span className="ml-auto flex flex-wrap gap-1.5">
                  {searchLinks(t.text).map((l) => (
                    <a key={l.platform} href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 rounded-nd-sm px-1.5 py-0.5 text-nd-caption text-nd-accent hover:bg-nd-accent-soft">
                      {l.label} <ExternalLink size={11} />
                    </a>
                  ))}
                  <Button size="sm" variant="ghost" icon={Trash2} aria-label="지우기" onClick={() => update((x) => void x.chinese.terms.splice(i, 1))} />
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-nd-line p-3">
          <FormRow className="grid-cols-1 sm:grid-cols-[1.5fr_1fr_2fr_auto]">
            <Field label="검색어 (간체)"><Input size="sm" lang="zh-Hans" value={term.text} onChange={(e) => setTerm({ ...term, text: e.target.value })} /></Field>
            <Field label="종류">
              <Select size="sm" value={term.kind} onChange={(e) => setTerm({ ...term, kind: e.target.value as ChineseTermKind })}>
                {(Object.keys(TERM_KIND_LABEL) as ChineseTermKind[]).map((k) => <option key={k} value={k}>{TERM_KIND_LABEL[k]}</option>)}
              </Select>
            </Field>
            <Field label="뜻"><Input size="sm" value={term.meaning} onChange={(e) => setTerm({ ...term, meaning: e.target.value })} /></Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-nd-caption" aria-hidden>{" "}</span>
              <Button size="sm" variant="secondary" icon={Languages} disabled={!term.text.trim()} onClick={() => { update((x) => void x.chinese.terms.push({ id: newId("zh_"), ...term, text: term.text.trim(), by: "manual" })); setTerm({ text: "", kind: term.kind, meaning: "" }); }}>더하기</Button>
            </div>
          </FormRow>
        </div>
      </Card>
    </section>
  );
}

function Sources({ draft }: { draft: Draft }) {
  const { p, update } = draft;
  const ask = useConfirm();
  const { media, refresh } = useProjectMedia(p.id);
  const sourceFiles = media.filter((m) => m.kind === "source");
  const addSource = () =>
    update((x) =>
      void x.sources.push({ id: newId("src_"), platform: p.kind === "brand" ? "other" : "xiaohongshu", url: "", creator: "", title: "", memo: "", terms: "", collectedAt: Date.now(), collectedBy: "", fileIds: [], segments: [] }),
    );

  return (
    <section>
      <SectionHeader title={p.kind === "brand" ? "소스 · 촬영본" : "해외 소스"} hint={`${p.sources.length}개 · 파일 ${sourceFiles.length}개`} action={<Button size="sm" icon={Plus} onClick={addSource}>소스 추가</Button>} />
      {p.sources.length === 0 ? (
        <EmptyState
          compact
          icon={Film}
          title="연결한 소스가 없습니다"
          description={
            p.kind === "brand"
              ? "고객사가 준 제품 영상 · 촬영본이나 AI 로 만든 장면 파일을 올리세요. 구간마다 쓸 용도를 표시하면 장면으로 바로 보낼 수 있습니다."
              : "샤오홍슈 등에서 고른 영상의 링크와 제작자를 적고, 내려받은 파일을 올리세요. 구간마다 쓸 용도를 표시하면 장면으로 바로 보낼 수 있습니다."
          }
          action={<Button size="sm" onClick={addSource}>소스 추가</Button>}
        />
      ) : (
        <div className="space-y-4">
          {p.sources.map((s, si) => (
            <Card key={s.id} className="space-y-3">
              <FormRow className="grid-cols-1 sm:grid-cols-[2.2fr_1fr_1.2fr_auto]">
                <Field label="영상 URL">
                  <Input size="sm" value={s.url} onChange={(e) => update((x) => { x.sources[si].url = e.target.value; if (e.target.value) x.sources[si].platform = platformFromUrl(e.target.value); })} placeholder={p.kind === "brand" ? "https://… (없으면 비움)" : "https://www.xiaohongshu.com/explore/…"} />
                </Field>
                <Field label="플랫폼">
                  <Select size="sm" value={s.platform} onChange={(e) => update((x) => void (x.sources[si].platform = e.target.value as ShortsPlatform))}>
                    {(Object.keys(PLATFORM_LABEL) as ShortsPlatform[]).map((k) => <option key={k} value={k}>{PLATFORM_LABEL[k]}</option>)}
                  </Select>
                </Field>
                <Field label="제작자"><Input size="sm" value={s.creator} onChange={(e) => update((x) => void (x.sources[si].creator = e.target.value))} /></Field>
                <div className="flex flex-col gap-1.5">
                  <span className="text-nd-caption" aria-hidden>{" "}</span>
                  <Button size="sm" variant="ghost" icon={Trash2} aria-label="소스 지우기" onClick={async () => {
                    if (!(await ask({ title: "소스를 지울까요?", message: "올린 파일은 영상에 남습니다(편집에서 쓰는 중일 수 있어서).", tone: "danger", confirmLabel: "지우기" }))) return;
                    update((x) => void x.sources.splice(si, 1));
                  }} />
                </div>
              </FormRow>
              <p className="-mt-1 text-nd-caption text-nd-fg-3">{PLATFORM_SUPPORT[s.platform].note}</p>
              <FormRow className="grid-cols-1 sm:grid-cols-2">
                <Field label="제목 · 메모"><Input size="sm" value={s.memo} onChange={(e) => update((x) => void (x.sources[si].memo = e.target.value))} placeholder="무엇이 좋았나 · 어디에 쓸까" /></Field>
                <Field label="출처 · 이용 조건 (선택)" hint="기록용입니다 — 비워 둬도 편집·게시를 막지 않습니다">
                  <Input size="sm" value={s.terms} onChange={(e) => update((x) => void (x.sources[si].terms = e.target.value))} />
                </Field>
              </FormRow>

              <div>
                <p className="mb-1.5 text-nd-caption font-medium text-nd-fg-2">파일</p>
                <div className="space-y-2">
                  {s.fileIds.map((fid) => {
                    const m = media.find((x) => x.id === fid);
                    return (
                      <div key={fid} className="flex items-center gap-2 text-nd-body">
                        <Film size={14} className="text-nd-fg-3" />
                        <span className="min-w-0 flex-1 truncate">{m ? mediaLabel(m) : "(불러오는 중 · 지워진 파일)"}</span>
                        <Button size="sm" variant="ghost" onClick={() => update((x) => void x.sources[si].segments.push({ id: newId("seg_"), fileId: fid, start: 0, end: Math.min(3, m?.duration ?? 3), purpose: "demo", note: "" }))}>구간 추가</Button>
                        <Button size="sm" variant="ghost" icon={Trash2} aria-label="파일 지우기" onClick={async () => {
                          if (!(await ask({ title: "파일을 지울까요?", message: "이 파일을 쓰는 장면은 원본이 비게 됩니다.", tone: "danger", confirmLabel: "지우기" }))) return;
                          await deleteMedia(fid).catch(() => undefined);
                          update((x) => void (x.sources[si].fileIds = x.sources[si].fileIds.filter((f) => f !== fid)));
                          await refresh();
                        }} />
                      </div>
                    );
                  })}
                  <MediaUpload compact projectId={p.id} kind="source" title="영상 파일 올리기" onUploaded={async (ms) => { update((x) => void x.sources[si].fileIds.push(...ms.map((m) => m.id))); await refresh(); }} />
                </div>
              </div>

              {s.segments.length > 0 && (
                <div>
                  <p className="mb-1.5 text-nd-caption font-medium text-nd-fg-2">쓸 구간</p>
                  <div className="space-y-2">
                    {s.segments.map((g, gi) => (
                      <SegmentRow
                        key={g.id}
                        seg={g}
                        maxSec={media.find((m) => m.id === g.fileId)?.duration ?? null}
                        onChange={(patch) => update((x) => void Object.assign(x.sources[si].segments[gi], patch))}
                        onRemove={() => update((x) => void x.sources[si].segments.splice(gi, 1))}
                        onToScene={() =>
                          update((x) => {
                            const sceneId = newId("sc_");
                            x.scenes.push({
                              id: sceneId,
                              kind: "clip",
                              label: `${SEGMENT_PURPOSE_LABEL[g.purpose]}${g.note ? ` · ${g.note}` : ""}`.slice(0, 100),
                              duration: Math.round((g.end - g.start) * 1000) / 1000,
                              clip: g.fileId ? { fileId: g.fileId, start: g.start, end: g.end, sourceId: s.id, segmentId: g.id } : null,
                              ai: null,
                              image: null,
                              keepAudio: false,
                            });
                            if (x.stage === "research" || x.stage === "sourcing") x.stage = "sourcing";
                          })
                        }
                      />
                    ))}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

function SegmentRow({
  seg,
  maxSec,
  onChange,
  onRemove,
  onToScene,
}: {
  seg: ProjectDoc["sources"][number]["segments"][number];
  maxSec: number | null;
  onChange: (p: Partial<typeof seg>) => void;
  onRemove: () => void;
  onToScene: () => void;
}) {
  const { url } = useBlobUrl(seg.fileId);
  return (
    <div className="grid items-start gap-2 rounded-nd-md bg-nd-fg/[.03] p-2 sm:grid-cols-[120px_1fr]">
      {url ? (
        <video src={`${url}#t=${seg.start},${seg.end}`} className="aspect-[9/16] w-full max-w-[120px] rounded bg-black object-cover" controls muted playsInline preload="metadata" />
      ) : (
        <div className="aspect-[9/16] w-full max-w-[120px] rounded bg-nd-fg/10" />
      )}
      <FormRow className="grid-cols-2 sm:grid-cols-[1fr_1fr_1.2fr_2fr_auto_auto]">
        <Field label="시작 (초)"><NumberInput size="sm" decimal value={seg.start} onValueChange={(r) => onChange({ start: Math.max(0, Number(r) || 0) })} /></Field>
        <Field label="끝 (초)" error={maxSec !== null && seg.end > maxSec + 0.01 ? `원본 ${maxSec.toFixed(1)}초` : undefined}>
          <NumberInput size="sm" decimal value={seg.end} onValueChange={(r) => onChange({ end: Math.max(0, Number(r) || 0) })} />
        </Field>
        <Field label="용도">
          <Select size="sm" value={seg.purpose} onChange={(e) => onChange({ purpose: e.target.value as SegmentPurpose })}>
            {(Object.keys(SEGMENT_PURPOSE_LABEL) as SegmentPurpose[]).map((k) => <option key={k} value={k}>{SEGMENT_PURPOSE_LABEL[k]}</option>)}
          </Select>
        </Field>
        <Field label="메모"><Input size="sm" value={seg.note} onChange={(e) => onChange({ note: e.target.value })} /></Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-nd-caption" aria-hidden>{" "}</span>
          <Button size="sm" variant="secondary" disabled={!seg.fileId || seg.end <= seg.start} onClick={onToScene}>장면으로</Button>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-nd-caption" aria-hidden>{" "}</span>
          <Button size="sm" variant="ghost" icon={Trash2} aria-label="구간 지우기" onClick={onRemove} />
        </div>
      </FormRow>
    </div>
  );
}
