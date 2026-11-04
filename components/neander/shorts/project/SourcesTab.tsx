"use client";

// ============================================================
//  소스 탭 — 확인된 사실 · 중국어 검색어 · 해외 소스(링크 · 파일 · 구간)
// ------------------------------------------------------------
//  샤오홍슈 · 더우인은 제3자용 공개 검색 API 가 없다 (2026-10-31 확인). 그래서
//  검색은 새 탭으로 열고, 고른 영상의 링크 · 제작자 · 메모 · 파일을 여기 붙인다.
//  출처 · 이용 조건 칸은 기록용 선택 항목이다 — 편집 승인 조건이 아니다.
//  「원본 반응」 은 해외 원본 영상의 숫자다 (소재 발굴 기록). 우리 영상 성과와 섞지 않는다.
//
//  2026-11 목업 개편(12-video-sources):
//   [원본 영상 · 참고 자료 | 확인된 사실 · 상품 정보] → 원본 · 사용 구간 한 표(출처 · 권한 · 구간 · 쓸 장면)
//   → 줄의 「고치기」 로 그 소스 하나를 표 아래에서 고친다(링크 · 플랫폼 · 제작자 · 메모 · 조건 · 파일 · 구간)
//   → 해외 자료 찾기(중국어 검색어 · 검색 링크)는 따로. 위에서 원본을 올리면 소스 하나가 새로 생긴다.
// ============================================================

import { useState } from "react";
import { ExternalLink, Film, Languages, Link2, Plus, Scissors, Trash2, WandSparkles, X } from "lucide-react";
import { Badge, Button, EmptyState, Field, FieldAction, FormRow, IconButton, InlineNotice, Input, NumberInput, Select, Skeleton, Textarea, buttonClass, useConfirm } from "@/components/neander/ui";
import { deleteMedia, shortsPost } from "@/lib/neander/shorts/client";
import { METRIC_LABEL, PLATFORM_LABEL, PLATFORM_SUPPORT, SEGMENT_PURPOSE_LABEL, TERM_KIND_LABEL, newId, platformFromUrl, searchLinks, videoKey } from "@/lib/neander/shorts/model";
import type { ChineseTermKind, MediaView, ProjectDoc, SegmentPurpose, ShortsPlatform, SourceClip, TrendDoc } from "@/lib/neander/shorts/types";
import { isReadOnlyFor, useShorts, type WithId } from "../ShortsProvider";
import { MediaThumb, MediaUpload, useBlobUrl, useProjectMedia } from "../media";
import { Num, SourceTag, fmtWhen, useAction } from "../parts";
import { AiCostNote, RecordTable, StudioCard, StudioNotice, type RecordColumn } from "../studio";
import type { Draft } from "../useProjectDraft";

export function SourcesTab({ draft }: { draft: Draft }) {
  const { p, update } = draft;
  const files = useProjectMedia(p.id);
  // 표 아래에서 고치는 소스 하나 (줄의 「고치기」 · 새로 더한 소스)
  const [openId, setOpenId] = useState<string | null>(null);
  const brand = p.kind === "brand";
  const addSource = (fileIds: string[] = [], platform?: ShortsPlatform) => {
    const id = newId("src_");
    update((x) =>
      void x.sources.push({ id, platform: platform ?? (brand ? "other" : "xiaohongshu"), url: "", creator: "", title: "", memo: "", terms: "", collectedAt: Date.now(), collectedBy: "", fileIds, segments: [] }),
    );
    setOpenId(id);
  };
  const unrecorded = p.sources.filter((s) => !s.terms.trim()).length;
  return (
    <div className="space-y-6">
      <div className="grid min-w-0 gap-5 xl:grid-cols-2">
        <Originals draft={draft} media={files.media} loading={files.loading} refresh={files.refresh} onAdd={addSource} onOpen={setOpenId} />
        <Facts draft={draft} media={files.media} />
      </div>
      <Sources draft={draft} {...files} openId={openId} setOpenId={setOpenId} onAdd={() => addSource()} />
      {/* 고객사 영상은 고객사 자료 · 촬영본으로 만든다 — 중국어 소스 찾기는 쿠팡 제휴 · 일반 영상에만 */}
      {!brand && <ChineseTerms draft={draft} />}
      {p.sources.length > 0 && unrecorded > 0 && (
        <StudioNotice tone="info" title="자료 이용 권한을 확인해 주세요">
          소스 {p.sources.length}개 중 {unrecorded}개에 출처 · 이용 조건 기록이 없습니다. 편집에 쓸 소스는 「고치기」 에서 이용 조건을 적어 두세요 — 기록용이라 비워 둬도 편집 · 게시를 막지 않습니다.
        </StudioNotice>
      )}
    </div>
  );
}

// ---- 원본 영상 · 참고 자료 ----------------------------------------------

/** 올린 원본 파일 미리보기 + 올리기 · 링크로 더하기 (올리면 새 소스 하나가 된다) */
function Originals({
  draft,
  media,
  loading,
  refresh,
  onAdd,
  onOpen,
}: {
  draft: Draft;
  media: MediaView[];
  loading: boolean;
  refresh: () => Promise<void>;
  onAdd: (fileIds?: string[], platform?: ShortsPlatform) => void;
  onOpen: (sourceId: string) => void;
}) {
  const { p } = draft;
  // 소스에 붙은 파일 — 어느 소스의 것인지 함께
  const linked = p.sources.flatMap((s, si) => s.fileIds.map((fid) => ({ fid, si, s, m: media.find((x) => x.id === fid) ?? null })));
  const found = linked.filter((x) => x.m);
  const shown = found.slice(0, 6);
  const missing = loading ? 0 : linked.length - found.length;
  return (
    <StudioCard title="원본 영상 · 참고 자료" description={`소스 ${p.sources.length}개 · 원본 파일 ${linked.length}개`}>
      <div className="space-y-4">
        {loading && !media.length ? (
          <div className="flex gap-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="aspect-[9/16] w-24 rounded-nd-md" />
            ))}
          </div>
        ) : shown.length ? (
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 2xl:grid-cols-6">
            {shown.map(({ fid, si, s, m }) => (
              <li key={fid} className="min-w-0">
                <button type="button" onClick={() => onOpen(s.id)} className="block w-full min-w-0 rounded-nd-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nd-accent" title={`소스 ${si + 1} 고치기`}>
                  <MediaThumb id={fid} type={m!.type} duration={m!.duration} alt={m!.name} icon={Film} className="aspect-[9/16] w-full rounded-nd-md" />
                  <span className="mt-1 block truncate text-[13px] text-nd-fg-2">{m!.name}</span>
                  <span className="block text-[13px] text-nd-fg-3">소스 {si + 1}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : !linked.length ? (
          <div className="flex items-center gap-3 rounded-nd-md border border-dashed border-nd-strong bg-nd-sunken/50 px-4 py-4">
            <Film size={20} aria-hidden className="shrink-0 text-nd-fg-3" />
            <p className="text-nd-body text-nd-fg-2">아직 올린 원본 파일이 없습니다. 직접 찍은 영상이나 내려받은 원본을 올리면 소스 하나가 만들어집니다.</p>
          </div>
        ) : null}
        {found.length > shown.length && <p className="text-[13px] text-nd-fg-3">파일 {found.length - shown.length}개 더 — 아래 표에서 소스별로 봅니다.</p>}
        {missing > 0 && (
          <p className="text-[13px] text-nd-warning-text">소스에 연결된 파일 {missing}개를 찾지 못했습니다 — 지워졌을 수 있습니다. 아래 「고치기」 에서 확인하세요.</p>
        )}
        <MediaUpload
          compact
          projectId={p.id}
          kind="source"
          title="원본 영상 올리기"
          onUploaded={async (ms) => {
            onAdd(
              ms.map((m) => m.id),
              "other",
            );
            await refresh();
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" icon={Link2} onClick={() => onAdd()}>
            링크로 자료 추가
          </Button>
          <span className="text-[13px] text-nd-fg-3">직접 촬영 파일 · 제품 설명서 · 참고 링크를 함께 보관합니다.</span>
        </div>
      </div>
    </StudioCard>
  );
}

// ---- 확인된 사실 ----------------------------------------------------

function Facts({ draft, media }: { draft: Draft; media: MediaView[] }) {
  const { p, update } = draft;
  const { data } = useShorts();
  const [text, setText] = useState("");
  // 사진: 고객사 영상은 고객사 제품 실사진, 쿠팡 영상은 이 영상에 올린 사진 — 없으면 칸을 두지 않는다
  const product = p.kind === "brand" ? data!.clients.find((c) => c.id === p.clientId)?.products.find((x) => x.id === p.clientProductId) : undefined;
  const photo: { id: string; type: string; name: string } | null = product?.photoIds[0]
    ? { id: product.photoIds[0], type: "image/jpeg", name: `${product.name} 제품 사진` }
    : (() => {
        const m = media.find((x) => x.kind === "image" && x.type.startsWith("image/"));
        return m ? { id: m.id, type: m.type, name: m.name } : null;
      })();
  const add = () => {
    if (!text.trim()) return;
    update((x) => void x.facts.push(text.trim()));
    setText("");
  };
  return (
    <StudioCard title="확인된 사실 · 상품 정보" description="대본 · AI 가 쓸 수 있는 것은 여기 적힌 사실뿐입니다 (가격 · 성능 · 후기를 지어내지 않게)">
      <div className="min-w-0 space-y-4">
        <div className={photo ? "grid gap-4 sm:grid-cols-[96px_minmax(0,1fr)]" : ""}>
          {photo && (
            <figure className="min-w-0">
              <MediaThumb id={photo.id} type={photo.type} alt={photo.name} className="aspect-square w-24 rounded-nd-md" />
              <figcaption className="mt-1 truncate text-[13px] text-nd-fg-3" title={photo.name}>
                {p.kind === "brand" ? "고객사 제품 사진" : "올린 사진"}
              </figcaption>
            </figure>
          )}
          <FormRow className="grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,13rem)]">
            <Field label="상품">
              <Input value={p.product} onChange={(e) => update((x) => void (x.product = e.target.value))} />
            </Field>
            <Field label="카테고리">
              <Input value={p.category} onChange={(e) => update((x) => void (x.category = e.target.value))} />
            </Field>
          </FormRow>
        </div>
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-nd-fg-2">
            핵심 특징 (확인된 사실) <span className="nd-num font-normal text-nd-fg-3">{p.facts.length}개</span>
          </p>
          {p.facts.length > 0 && (
            <ol className="mb-2 space-y-1.5">
              {p.facts.map((f, i) => (
                <li key={i} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-2">
                  <span className="nd-num text-right text-[13px] text-nd-fg-3">{i + 1}</span>
                  <Input value={f} onChange={(e) => update((x) => void (x.facts[i] = e.target.value))} aria-label={`사실 ${i + 1}`} />
                  <IconButton icon={Trash2} label="사실 지우기" onClick={() => update((x) => void x.facts.splice(i, 1))} />
                </li>
              ))}
            </ol>
          )}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="새 사실"
              placeholder={p.kind === "brand" ? "예: 용량 50ml (고객사 상세 페이지 확인)" : "예: 접으면 두께 3cm (쿠팡 상세 페이지 확인)"}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) add();
              }}
            />
            <Button variant="secondary" icon={Plus} disabled={!text.trim()} onClick={add}>
              사실 추가
            </Button>
          </div>
        </div>
        <Field label="제작 메모">
          <Textarea rows={2} value={p.notes} onChange={(e) => update((x) => void (x.notes = e.target.value))} />
        </Field>
      </div>
    </StudioCard>
  );
}

// ---- 해외 자료 찾기 (중국어 검색어) ------------------------------------

function ChineseTerms({ draft }: { draft: Draft }) {
  const { p, update, flush, replace } = draft;
  const { data } = useShorts();
  const { busy, run } = useAction();
  const [term, setTerm] = useState({ text: "", kind: "name" as ChineseTermKind, meaning: "" });
  const aiReady = data!.status.openrouter.configured;
  return (
    <StudioCard
      title="해외 자료 찾기"
      description={`중국어 검색어 — 상품명 · 동의어 · 용도 · 문제 상황 · ${p.chinese.terms.length}개`}
      action={
        <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          <AiCostNote compact estimate="약 $0.001" />
          <Button
            size="sm"
            variant="secondary"
            icon={WandSparkles}
            loading={busy === "zh"}
            disabled={!aiReady || busy === "zh" || !p.product.trim()}
            title={!aiReady ? "OPENROUTER_API_KEY 가 없어 쓸 수 없습니다" : !p.product.trim() ? "상품 이름을 먼저 적어 주세요" : undefined}
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
            AI 로 검색어 제안
          </Button>
        </span>
      }
    >
      <div className="space-y-4">
        <InlineNotice tone="info">
          샤오홍슈 · 더우인은 공개 검색 API 가 없어 <b>자동 수집하지 않습니다</b>. 검색어 옆 링크로 새 탭에서 찾고, 고른 영상의 링크 · 파일을 위 「원본 · 사용 구간」 에 붙이세요.
        </InlineNotice>
        {p.chinese.terms.length === 0 ? (
          <p className="text-nd-body text-nd-fg-3">아직 검색어가 없습니다. 아래에 직접 더하거나 「AI 로 검색어 제안」 을 누르세요.</p>
        ) : (
          <ul className="divide-y divide-nd-line overflow-hidden rounded-nd-md border border-nd-line">
            {p.chinese.terms.map((t, i) => (
              <li key={t.id} className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-2.5 lg:grid-cols-[5.5rem_minmax(0,1fr)_auto_auto]">
                <Badge size="lg" className="justify-self-start">
                  {TERM_KIND_LABEL[t.kind]}
                </Badge>
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                  <span className="text-[16px] font-semibold text-nd-fg" lang="zh-Hans">
                    {t.text}
                  </span>
                  {t.meaning && (
                    <span className="min-w-0 truncate text-[13px] text-nd-fg-3" title={t.meaning}>
                      {t.meaning}
                    </span>
                  )}
                  {t.by === "ai" && (
                    <Badge size="md" tone="accent">
                      AI 제안
                    </Badge>
                  )}
                </div>
                <span className="col-span-3 flex flex-wrap items-center gap-x-1 gap-y-0.5 lg:col-span-1 lg:justify-end">
                  {searchLinks(t.text).map((l) => (
                    <a key={l.platform} href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-nd-sm px-2 py-1 text-[13px] font-medium text-nd-accent hover:bg-nd-accent-soft">
                      {l.label} <ExternalLink size={13} aria-hidden />
                    </a>
                  ))}
                </span>
                <IconButton icon={Trash2} size="sm" label="검색어 지우기" className="col-start-3 row-start-1 lg:col-start-4" onClick={() => update((x) => void x.chinese.terms.splice(i, 1))} />
              </li>
            ))}
          </ul>
        )}
        <FormRow className="grid-cols-1 sm:grid-cols-[1.5fr_1fr_2fr_auto]">
          <Field label="검색어 직접 입력 (간체)">
            <Input lang="zh-Hans" value={term.text} onChange={(e) => setTerm({ ...term, text: e.target.value })} placeholder="예: 水槽挡水板" />
          </Field>
          <Field label="종류">
            <Select value={term.kind} onChange={(e) => setTerm({ ...term, kind: e.target.value as ChineseTermKind })}>
              {(Object.keys(TERM_KIND_LABEL) as ChineseTermKind[]).map((k) => (
                <option key={k} value={k}>
                  {TERM_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="뜻">
            <Input value={term.meaning} onChange={(e) => setTerm({ ...term, meaning: e.target.value })} placeholder="예: 싱크대 물막이" />
          </Field>
          <FieldAction size="md">
            <Button
              variant="secondary"
              icon={Languages}
              disabled={!term.text.trim()}
              onClick={() => {
                update((x) => void x.chinese.terms.push({ id: newId("zh_"), ...term, text: term.text.trim(), by: "manual" }));
                setTerm({ text: "", kind: term.kind, meaning: "" });
              }}
            >
              더하기
            </Button>
          </FieldAction>
        </FormRow>
      </div>
    </StudioCard>
  );
}

// ---- 원본 · 사용 구간 (한 표) ----------------------------------------

/** 구간을 장면으로 — 소스 · 구간 표와 아래 고치기 칸이 같이 쓴다 */
function segmentToScene(update: Draft["update"], s: SourceClip, g: SourceClip["segments"][number]) {
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
  });
}

function Sources({
  draft,
  media,
  refresh,
  openId,
  setOpenId,
  onAdd,
}: {
  draft: Draft;
  media: MediaView[];
  loading: boolean;
  refresh: () => Promise<void>;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  onAdd: () => void;
}) {
  const { p, update } = draft;
  const { data } = useShorts();
  const brand = p.kind === "brand";
  const sourceFiles = media.filter((m) => m.kind === "source");
  // 같은 영상의 소재 발굴 기록 — 원본 반응(조회 · 좋아요 …)은 거기에만 있다.
  // 소재에서 만든 영상의 첫 소스(src_trend)는 그 소재의 원본이고, 나머지는 주소가 같은 영상만 잇는다.
  const trendFor = (s: SourceClip) => {
    const trends = data!.trends;
    if (s.id === "src_trend" && p.trendId) {
      const t = trends.find((x) => x.id === p.trendId);
      if (t) return t;
    }
    const url = s.url.trim();
    if (!url) return null;
    const k = videoKey(url);
    return trends.find((t) => t.url && (t.url === url || (k !== null && videoKey(t.url) === k))) ?? null;
  };
  const open = p.sources.findIndex((s) => s.id === openId);
  // 읽기 전용(관리자 몰아보기)은 버튼이 잠기므로 모든 소스를 펼쳐 보여 준다 (예전처럼)
  const readOnly = isReadOnlyFor(p, data!.me);
  const editors = readOnly ? p.sources.map((_, i) => i) : open >= 0 ? [open] : [];
  const usedBy = (segId: string) => p.scenes.filter((sc) => sc.clip?.segmentId === segId).length;

  type Row = { s: SourceClip; si: number };
  const rows: Row[] = p.sources.map((s, si) => ({ s, si }));
  const columns: RecordColumn<Row>[] = [
    {
      key: "src",
      header: "자료",
      mobile: "title",
      cell: ({ s, si }) => {
        const files = s.fileIds.map((fid) => media.find((m) => m.id === fid)).filter((m): m is MediaView => !!m);
        const len = files.reduce((n, m) => n + (m.duration ?? 0), 0);
        const name = s.title.trim() || s.memo.trim() || s.creator.trim() || files[0]?.name || `소스 ${si + 1}`;
        const n = s.fileIds.length;
        return (
          <span className="block min-w-0">
            <span className="block truncate font-semibold text-nd-fg" title={name}>
              {name}
            </span>
            <span className="block truncate text-[13px] font-normal text-nd-fg-3">
              소스 {si + 1} · {s.url.trim() ? PLATFORM_LABEL[s.platform] : n ? "직접 올린 파일" : "링크 · 파일 없음"}
              {n ? ` · 파일 ${n}개${len ? ` · ${Math.round(len)}초` : ""}` : ""}
            </span>
          </span>
        );
      },
    },
    {
      key: "rights",
      header: "출처 · 권한",
      mobileLabel: "출처 · 권한",
      cell: ({ s }) => (
        <span className="flex min-w-0 flex-col items-start gap-1 max-md:items-end">
          {s.terms.trim() ? (
            <Badge size="lg" tone="success">
              조건 기록함
            </Badge>
          ) : (
            <Badge size="lg" tone="warning">
              권한 미기록
            </Badge>
          )}
          <span className="max-w-[16rem] truncate text-[13px] text-nd-fg-3" title={s.terms || undefined}>
            {s.terms.trim() || (s.creator.trim() ? `제작자 ${s.creator}` : "출처 · 이용 조건을 적어 두세요")}
          </span>
        </span>
      ),
    },
    {
      key: "seg",
      header: "구간",
      cell: ({ s }) =>
        s.segments.length ? (
          <span className="flex flex-col items-start gap-1.5 max-md:items-end">
            {s.segments.map((g) => (
              <span key={g.id} className="nd-num whitespace-nowrap leading-7">
                {fmtClock(g.start)}–{fmtClock(g.end)}
              </span>
            ))}
          </span>
        ) : (
          <span className="text-[13px] text-nd-fg-3">구간 없음</span>
        ),
    },
    {
      key: "use",
      header: "사용할 장면",
      cell: ({ s }) =>
        s.segments.length ? (
          <span className="flex flex-col items-start gap-1.5 max-md:items-end">
            {s.segments.map((g) => {
              const n = usedBy(g.id);
              return (
                <span key={g.id} className="flex min-w-0 flex-wrap items-center gap-2 max-md:justify-end">
                  <span className="min-w-0 truncate">
                    {SEGMENT_PURPOSE_LABEL[g.purpose]}
                    {g.note ? ` · ${g.note}` : ""}
                  </span>
                  {n > 0 ? (
                    <Badge size="lg" tone="success">
                      장면 {n}개
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={Plus}
                      disabled={!g.fileId || g.end <= g.start}
                      title={!g.fileId ? "파일을 올려 구간에 연결해야 장면으로 보낼 수 있습니다" : undefined}
                      onClick={() => segmentToScene(update, s, g)}
                    >
                      장면에 넣기
                    </Button>
                  )}
                </span>
              );
            })}
          </span>
        ) : (
          <span className="text-[13px] text-nd-fg-3">「고치기」 에서 쓸 구간을 고르세요</span>
        ),
    },
    {
      key: "act",
      header: "작업",
      cell: ({ s }) => (
        <span className="flex flex-wrap items-center gap-1 max-md:justify-end">
          <Button size="sm" variant={openId === s.id ? "soft" : "secondary"} icon={Scissors} aria-expanded={openId === s.id} onClick={() => setOpenId(openId === s.id ? null : s.id)}>
            {openId === s.id ? "고치는 중" : "고치기"}
          </Button>
          {/^https?:\/\//.test(s.url.trim()) && (
            <a href={s.url.trim()} target="_blank" rel="noreferrer" className={buttonClass("ghost", "sm", "gap-1")}>
              <ExternalLink size={14} aria-hidden />
              자료 열기
            </a>
          )}
        </span>
      ),
    },
  ];

  return (
    <StudioCard
      flush
      title={brand ? "원본 · 사용 구간 (촬영본 · 고객사 자료)" : "원본 · 사용 구간"}
      description={`소스 ${p.sources.length}개 · 파일 ${sourceFiles.length}개 · 출처 · 권한 · 구간을 한 표에서`}
      action={
        <Button size="sm" icon={Plus} onClick={onAdd}>
          소스 추가
        </Button>
      }
    >
      {p.sources.length === 0 ? (
        <div className="px-5 pb-5 sm:px-6">
          <EmptyState
            compact
            icon={Film}
            title="연결한 소스가 없습니다"
            description={
              brand
                ? "고객사가 준 제품 영상 · 촬영본이나 AI 로 만든 장면 파일을 올리세요. 구간마다 쓸 용도를 표시하면 장면으로 바로 보낼 수 있습니다."
                : "샤오홍슈 등에서 고른 영상의 링크와 제작자를 적거나 직접 찍은 파일을 올리세요. 구간마다 쓸 용도를 표시하면 장면으로 바로 보낼 수 있습니다."
            }
            action={
              <Button size="sm" icon={Plus} onClick={onAdd}>
                소스 추가
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <RecordTable rows={rows} columns={columns} rowKey={(r) => r.s.id} ariaLabel="원본 · 사용 구간" rowClassName={(r) => (r.s.id === openId ? "bg-nd-accent-soft/40" : undefined)} className="max-md:px-4 max-md:pb-4" />
          {editors.length > 0 && (
            <div className="space-y-4 border-t border-nd-line bg-nd-sunken/40 p-4 sm:p-5">
              {editors.map((i) => (
                <SourceCard
                  key={p.sources[i].id}
                  draft={draft}
                  s={p.sources[i]}
                  si={i}
                  media={media}
                  refresh={refresh}
                  trend={trendFor(p.sources[i])}
                  onClose={() => setOpenId(null)}
                  onToScene={(g) => segmentToScene(update, p.sources[i], g)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </StudioCard>
  );
}

function SourceCard({
  draft,
  s,
  si,
  media,
  refresh,
  trend,
  onClose,
  onToScene,
}: {
  draft: Draft;
  s: SourceClip;
  si: number;
  media: MediaView[];
  refresh: () => Promise<void>;
  trend: WithId<TrendDoc> | null;
  onClose: () => void;
  onToScene: (g: SourceClip["segments"][number]) => void;
}) {
  const { p, update } = draft;
  const ask = useConfirm();
  const files = s.fileIds.map((fid) => ({ fid, m: media.find((x) => x.id === fid) ?? null }));
  const first = files.find((f) => f.m)?.m ?? null;
  const brand = p.kind === "brand";
  const set = (fn: (x: SourceClip) => void) => update((x) => fn(x.sources[si]));

  return (
    <section aria-label={`소스 ${si + 1} 고치기`} className="overflow-hidden rounded-nd-lg border border-nd-line bg-nd-content">
      <div className="grid gap-4 p-4 sm:p-5 md:grid-cols-[140px_minmax(0,1fr)]">
        {/* 첫 파일의 장면 · 길이 — 파일이 없으면 아이콘 상자 */}
        <MediaThumb id={first?.id} type={first?.type} duration={first?.duration} alt={first?.name ?? "소스 파일 없음"} icon={Film} className="aspect-[9/16] w-full max-w-[84px] rounded-nd-md md:max-w-[140px]" />
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent" size="lg">소스 {si + 1}</Badge>
            <Badge size="lg">{PLATFORM_LABEL[s.platform]}</Badge>
            {s.creator.trim() && <span className="min-w-0 truncate text-nd-body font-medium" title={s.creator}>{s.creator}</span>}
            <span className="text-[13px] text-nd-fg-3">등록 {fmtDate(s.collectedAt)}</span>
            <span className="ml-auto flex items-center gap-1">
              {/^https?:\/\//.test(s.url.trim()) && (
                <a href={s.url.trim()} target="_blank" rel="noreferrer" className={buttonClass("secondary", "sm")}>
                  원본 영상 보기 <ExternalLink size={13} aria-hidden className="ml-0.5" />
                </a>
              )}
              <IconButton
                icon={Trash2}
                size="sm"
                label="소스 지우기"
                onClick={async () => {
                  if (!(await ask({ title: "소스를 지울까요?", message: "올린 파일은 영상에 남습니다(편집에서 쓰는 중일 수 있어서).", tone: "danger", confirmLabel: "지우기" }))) return;
                  update((x) => void x.sources.splice(si, 1));
                  onClose();
                }}
              />
              <IconButton icon={X} size="sm" label="고치기 닫기" onClick={onClose} />
            </span>
          </div>
          {s.title.trim() && <p className="line-clamp-2 text-[15px] font-semibold text-nd-fg" title={s.title}>{s.title}</p>}

          <FormRow className="grid-cols-1 sm:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
            <Field label="영상 URL">
              <Input value={s.url} onChange={(e) => set((x) => { x.url = e.target.value; if (e.target.value) x.platform = platformFromUrl(e.target.value); })} placeholder={brand ? "https://… (없으면 비움)" : "https://www.xiaohongshu.com/explore/…"} />
            </Field>
            <Field label="플랫폼">
              <Select value={s.platform} onChange={(e) => set((x) => void (x.platform = e.target.value as ShortsPlatform))}>
                {(Object.keys(PLATFORM_LABEL) as ShortsPlatform[]).map((k) => <option key={k} value={k}>{PLATFORM_LABEL[k]}</option>)}
              </Select>
            </Field>
            <Field label="제작자"><Input value={s.creator} onChange={(e) => set((x) => void (x.creator = e.target.value))} /></Field>
          </FormRow>
          <p className="-mt-1 text-[13px] text-nd-fg-3">{PLATFORM_SUPPORT[s.platform].note}</p>
          <FormRow className="grid-cols-1 sm:grid-cols-2">
            <Field label="제목 · 메모"><Input value={s.memo} onChange={(e) => set((x) => void (x.memo = e.target.value))} placeholder="무엇이 좋았나 · 어디에 쓸까" /></Field>
            <Field label="출처 · 이용 조건 (선택)" hint="기록용입니다 — 비워 둬도 편집·게시를 막지 않습니다">
              <Input value={s.terms} onChange={(e) => set((x) => void (x.terms = e.target.value))} />
            </Field>
          </FormRow>
          {!brand && <OriginalReaction trend={trend} />}
        </div>
      </div>

      {/* 파일 · 쓸 구간 */}
      <div className="space-y-4 border-t border-nd-line bg-nd-fg/[.02] px-4 py-4 sm:px-5">
        <div>
          <p className="mb-2 text-[13px] font-medium text-nd-fg-2">
            원본 파일 <span className="nd-num font-normal text-nd-fg-3">{s.fileIds.length}개</span>
          </p>
          {files.length > 0 && (
            <ul className="mb-2 divide-y divide-nd-line overflow-hidden rounded-nd-md border border-nd-line bg-nd-content">
              {files.map(({ fid, m }) => (
                <li key={fid} className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 md:grid-cols-[2.25rem_minmax(0,1fr)_5rem_7rem_6rem_auto]">
                  <MediaThumb id={m ? fid : null} type={m?.type} icon={Film} alt={m?.name} className="h-12 w-9 rounded" />
                  <span className="min-w-0 truncate text-nd-body" title={m?.name}>{m ? m.name : "(불러오는 중 · 지워진 파일)"}</span>
                  <span className="hidden text-right text-[13px] md:block">{m?.duration ? <Num value={Math.round(m.duration * 10) / 10} unit="초" /> : <span className="text-nd-fg-3">길이 —</span>}</span>
                  <span className="nd-num hidden text-right text-[13px] text-nd-fg-2 md:block">{m?.width && m.height ? `${m.width}×${m.height}` : "—"}</span>
                  <span className="hidden text-right text-[13px] text-nd-fg-3 md:block">{m ? fmtDate(m.createdAt) : ""}</span>
                  <span className="flex items-center gap-1">
                    <Button size="sm" variant="secondary" icon={Plus} onClick={() => set((x) => void x.segments.push({ id: newId("seg_"), fileId: fid, start: 0, end: Math.min(3, m?.duration ?? 3), purpose: "demo", note: "" }))}>
                      구간 추가
                    </Button>
                    <IconButton
                      icon={Trash2}
                      size="sm"
                      label="파일 지우기"
                      onClick={async () => {
                        if (!(await ask({ title: "파일을 지울까요?", message: "이 파일을 쓰는 장면은 원본이 비게 됩니다.", tone: "danger", confirmLabel: "지우기" }))) return;
                        await deleteMedia(fid).catch(() => undefined);
                        set((x) => void (x.fileIds = x.fileIds.filter((f) => f !== fid)));
                        await refresh();
                      }}
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}
          <MediaUpload compact projectId={p.id} kind="source" title="영상 파일 올리기" onUploaded={async (ms) => { set((x) => void x.fileIds.push(...ms.map((m) => m.id))); await refresh(); }} />
        </div>

        {s.segments.length > 0 && (
          <div>
            <p className="mb-2 text-[13px] font-medium text-nd-fg-2">
              쓸 구간 (이 영상에서 사용할 부분) <span className="nd-num font-normal text-nd-fg-3">{s.segments.length}개</span>
            </p>
            <div className="space-y-2">
              {s.segments.map((g, gi) => {
                const file = g.fileId ? media.find((m) => m.id === g.fileId) ?? null : null;
                return (
                  <SegmentRow
                    key={g.id}
                    seg={g}
                    file={file}
                    onChange={(patch) => set((x) => void Object.assign(x.segments[gi], patch))}
                    onRemove={() => set((x) => void x.segments.splice(gi, 1))}
                    onToScene={() => onToScene(g)}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** 해외 원본 영상의 반응 — 같은 영상의 소재 발굴 기록에서. 없거나 공개 안 된 값은 「미확인」 */
function OriginalReaction({ trend }: { trend: WithId<TrendDoc> | null }) {
  const keys = ["views", "likes", "comments", "saves", "shares"] as const;
  if (!trend) {
    return (
      <p className="rounded-nd-md bg-nd-fg/[.03] px-3 py-2 text-[13px] text-nd-fg-3">
        <span className="font-medium text-nd-fg-2">원본 반응</span> 미확인 — 소재 발굴에 같은 영상 기록이 없습니다. (해외 원본의 숫자이며, 우리 영상 성과와 섞지 않습니다)
      </p>
    );
  }
  const src = keys.map((k) => trend.metrics[k]).find((m) => m.v !== null)?.src ?? "manual";
  return (
    <div className="rounded-nd-md bg-nd-fg/[.03] px-3 py-2" title="해외 원본 영상의 숫자입니다 — 우리 영상 성과와 섞지 않습니다">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-[13px] font-medium text-nd-fg-2">원본 반응</span>
        {keys.map((k) => (
          <span key={k} className="inline-flex items-baseline gap-1.5 text-nd-body">
            <span className="text-[13px] text-nd-fg-3">{METRIC_LABEL[k]}</span>
            <Num value={trend.metrics[k].v} />
          </span>
        ))}
        <span className="ml-auto inline-flex items-center gap-1.5 text-[13px] text-nd-fg-3">
          <SourceTag src={src} />
          소재 발굴 기록 · {fmtWhen(trend.collectedAt)}
        </span>
      </div>
    </div>
  );
}

function SegmentRow({
  seg,
  file,
  onChange,
  onRemove,
  onToScene,
}: {
  seg: SourceClip["segments"][number];
  file: MediaView | null;
  onChange: (p: Partial<SourceClip["segments"][number]>) => void;
  onRemove: () => void;
  onToScene: () => void;
}) {
  const { url } = useBlobUrl(seg.fileId);
  const maxSec = file?.duration ?? null;
  const len = Math.max(0, seg.end - seg.start);
  return (
    <div className="grid items-start gap-3 rounded-nd-md border border-nd-line bg-nd-content p-3 sm:grid-cols-[84px_minmax(0,1fr)]">
      {seg.fileId ? (
        url ? (
          <video src={`${url}#t=${seg.start},${seg.end}`} className="aspect-[9/16] w-[84px] rounded bg-black object-cover" controls muted playsInline preload="metadata" aria-label="구간 미리보기" />
        ) : (
          <div className="aspect-[9/16] w-[84px] animate-pulse rounded bg-nd-fg/10" />
        )
      ) : (
        <div className="flex aspect-[9/16] w-[84px] items-center justify-center rounded bg-nd-sunken text-nd-fg-3" title="파일 없이 원본 시각만 적은 구간">
          <Film size={18} aria-hidden />
        </div>
      )}
      <div className="min-w-0 space-y-1.5">
        <p className="truncate text-[13px] text-nd-fg-3" title={file?.name}>
          {file ? file.name : seg.fileId ? "파일 불러오는 중" : "파일 없음 (원본 시각만)"} · 구간 <span className="nd-num text-nd-fg-2">{len.toFixed(1)}초</span>
        </p>
        <FormRow className="grid-cols-2 sm:grid-cols-[minmax(0,6rem)_minmax(0,6rem)_minmax(0,9rem)_minmax(0,1fr)_auto_auto]">
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
          <FieldAction>
            <Button size="sm" variant="secondary" disabled={!seg.fileId || seg.end <= seg.start} title={!seg.fileId ? "파일을 올려 구간에 연결해야 장면으로 보낼 수 있습니다" : undefined} onClick={onToScene}>장면으로</Button>
          </FieldAction>
          <FieldAction>
            <IconButton icon={Trash2} size="sm" label="구간 지우기" onClick={onRemove} />
          </FieldAction>
        </FormRow>
      </div>
    </div>
  );
}

/** 날짜만 — 2026.10.12 (한국 시간) */
function fmtDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  const d = new Date(ms + 9 * 3600_000);
  return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** 0:04 · 1:05.5 — 표 안의 짧은 구간 시각 */
function fmtClock(sec: number): string {
  const v = Math.max(0, Math.round(sec * 10) / 10);
  const m = Math.floor(v / 60);
  const r = Math.round((v - m * 60) * 10) / 10;
  const whole = Number.isInteger(r);
  return `${m}:${(whole ? String(r) : r.toFixed(1)).padStart(whole ? 2 : 4, "0")}`;
}
