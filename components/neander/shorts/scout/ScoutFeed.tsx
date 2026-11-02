"use client";

// ============================================================
//  바이럴 형식 — 쇼츠처럼 보기 (터진 영상 탭 · 주간 보고의 새로 찾은 영상)
// ------------------------------------------------------------
//  공용 드로어(feed/ShortsFeed) 위에 터진 영상 한 편씩: 세로 영상 · 원본 반응(조회 · 배수 · 평소 · 좋아요 · 댓글 ·
//  한글 댓글) · AI 형식 분석 · 메모(AI 가 분석할 때 참고) · 묶기(AI 제안) · 제외 · 자세히.
//  YouTube 가 아닌 영상(틱톡 · 더우인)은 썸네일과 「원본 열기」 만. 마지막으로 본 영상을 기억해 이어 본다.
//  숫자는 모두 원본(남의 채널) 영상의 반응이다 — 우리 영상 성과가 아니다.
// ============================================================

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ExternalLink, GalleryVerticalEnd, Layers, PanelRightOpen } from "lucide-react";
import { Badge, Button, Field, Textarea, cn } from "@/components/neander/ui";
import { Num, SourceTag, fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { FeedSlideLayout, FeedVideo, ShortsFeedSheet, useFeedResume } from "@/components/neander/shorts/feed/ShortsFeed";
import { PLATFORM_LABEL } from "@/lib/neander/shorts/model";
import { hitNoteState, type HitDoc } from "@/lib/neander/shorts/scout";
import { Ago, AiBadge, CountryTag, LangBadge, Multiple } from "./bits";
import { scout, type ScoutData, type WithId } from "./useScout";

const FEED_LAST_KEY = "neander.shorts.scoutFeedLast";

/**
 * 「쇼츠처럼 보기」 단추(마지막으로 본 영상이 이 목록에 있으면 「이어 보기 · N번째」 + 「처음부터」)와 드로어.
 * hits 순서가 넘기는 순서다 (부르는 화면의 필터 · 정렬 그대로).
 */
export function ScoutFeed({
  d,
  hits,
  refresh,
  onOpenFormat,
  onDetail,
}: {
  d: ScoutData;
  hits: WithId<HitDoc>[];
  refresh: () => Promise<void>;
  onOpenFormat: (id: string) => void;
  /** 「자세히 · 묶기」 — 부르는 화면의 영상 창을 연다 (드로어는 닫는다) */
  onDetail: (id: string) => void;
}) {
  const [start, setStart] = useState<string | null>(null);
  const { last, onSeen } = useFeedResume(FEED_LAST_KEY);
  const groups = useMemo(() => hits.map((h) => ({ key: h.id, items: [h] })), [hits]);
  const resumeIdx = last ? hits.findIndex((h) => h.id === last.id) : -1;
  const close = () => setStart(null);

  return (
    <>
      {resumeIdx > 0 ? (
        <span className="inline-flex flex-wrap gap-2">
          <Button size="sm" icon={GalleryVerticalEnd} onClick={() => setStart(last!.id)} title={`쇼츠처럼 보기에서 마지막으로 본 영상(${resumeIdx + 1}번째)부터 이어서 봅니다`}>
            이어 보기 · <span className="nd-num">{resumeIdx + 1}</span>번째
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setStart(hits[0].id)}>
            처음부터
          </Button>
        </span>
      ) : (
        <Button size="sm" variant="secondary" icon={GalleryVerticalEnd} disabled={!hits.length} onClick={() => setStart(hits[0]?.id ?? null)}>
          쇼츠처럼 보기
        </Button>
      )}
      <ShortsFeedSheet
        startId={start}
        groups={groups}
        onClose={close}
        onSeen={onSeen}
        ariaLabel="터진 영상 쇼츠처럼 보기"
        emptyTitle="넘겨 볼 영상이 없습니다"
        renderSlide={({ item, active, onFocus }) => (
          <HitSlide
            h={item}
            d={d}
            active={active}
            onFocus={onFocus}
            refresh={refresh}
            onDetail={(id) => {
              close();
              onDetail(id);
            }}
            onOpenFormat={(id) => {
              close();
              onOpenFormat(id);
            }}
          />
        )}
      />
    </>
  );
}

function Stat({ label, tag, children, title }: { label: string; tag?: ReactNode; children: ReactNode; title?: string }) {
  return (
    <div className="min-w-0" title={title}>
      <dt className="flex min-h-[20px] flex-wrap items-center gap-1 text-[13px] text-nd-fg-3">
        {label}
        {tag}
      </dt>
      <dd className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1 text-[16px] font-semibold text-nd-fg">{children}</dd>
    </div>
  );
}

function HitSlide({
  h,
  d,
  active,
  onFocus,
  refresh,
  onDetail,
  onOpenFormat,
}: {
  h: WithId<HitDoc>;
  d: ScoutData;
  active: boolean;
  onFocus: () => void;
  refresh: () => Promise<void>;
  onDetail: (id: string) => void;
  onOpenFormat: (id: string) => void;
}) {
  const { busy, run } = useAction();
  const [note, setNote] = useState(h.note);
  useEffect(() => setNote(h.note), [h.id, h.note]);
  const a = h.analysis;
  const fmt = h.formatId ? d.formats.find((f) => f.id === h.formatId) : null;
  const suggested = !h.formatId && a?.match.formatId ? (d.formats.find((f) => f.id === a.match.formatId && !f.archived) ?? null) : null;
  const act = (key: string, action: string, body: object, ok?: string) =>
    run(
      key,
      async () => {
        await scout(action, { id: h.id, ...body });
        await refresh();
      },
      ok,
    );
  const videoId = h.platform === "youtube" && h.externalId ? h.externalId : null;
  const ns = hitNoteState({ note, analysis: a });
  const kc = h.koreanComments;

  return (
    <FeedSlideLayout video={<FeedVideo active={active} videoId={videoId} thumbnail={h.thumbnail} title={h.title} url={h.url} onFocus={onFocus} />}>
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <CountryTag code={h.country} size="md" />
          <Badge tone="neutral" size="md">
            {PLATFORM_LABEL[h.platform]}
          </Badge>
          {h.status === "assigned" && fmt ? (
            <Badge tone="success" size="md">
              형식에 묶음 · {fmt.name}
            </Badge>
          ) : h.status === "dismissed" ? (
            <Badge tone="neutral" size="md">
              제외
            </Badge>
          ) : (
            <Badge tone="warning" size="md">
              묶기 전
            </Badge>
          )}
        </div>
        <h3 className="line-clamp-3 text-[17px] font-bold leading-snug text-nd-fg [overflow-wrap:anywhere]" title={h.title}>
          {h.title || h.url}
        </h3>
        <p className="text-[13px] text-nd-fg-3">
          {h.channel || "채널 모름"} · 올린 지 <Ago iso={h.publishedAt} /> · {h.found === "scan" ? "감시 채널 훑기" : "직접 등록"} {fmtWhen(h.createdAt)}
        </p>
      </div>

      <dl className="grid grid-cols-3 gap-x-3 gap-y-2.5 border-y border-nd-line py-3">
        <Stat label="원본 조회" tag={<SourceTag src={h.views.src} title={h.views.ref} />} title={h.views.ref}>
          <Num value={h.views.v} />
        </Stat>
        <Stat label="배수 (평소 대비)" title="조회수 ÷ 그 채널 평소 조회수 (최근 쇼츠 중앙값)">
          <Multiple value={h.multiple} />
        </Stat>
        <Stat label="채널 평소" title={h.baseline.ref}>
          <Num value={h.baseline.v === null ? null : Math.round(h.baseline.v)} />
        </Stat>
        <Stat label="좋아요" title={h.likes.ref}>
          <Num value={h.likes.v} />
        </Stat>
        <Stat label="댓글" title={h.comments.ref}>
          <Num value={h.comments.v} />
        </Stat>
        <Stat label="한글 댓글" title="댓글 표본 중 한글이 들어간 비율 — 한국 사람이 이미 보고 있나">
          {kc && kc.sampled > 0 ? (
            <span className="nd-num">
              {Math.round((kc.korean / kc.sampled) * 100)}% <span className="text-[13px] font-normal text-nd-fg-3">({kc.korean}/{kc.sampled})</span>
            </span>
          ) : (
            <span className="text-[14px] font-normal text-nd-fg-3">표본 없음</span>
          )}
        </Stat>
      </dl>
      <p className="-mt-1.5 text-[13px] text-nd-fg-3">원본 영상의 반응입니다 — 우리 영상 성과가 아닙니다.</p>

      <div className="rounded-nd-md bg-nd-accent-soft/60 px-3 py-2.5">
        {a ? (
          <div className="space-y-1.5 text-[13px] leading-relaxed text-nd-fg-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="accent" size="md">
                AI 형식 분석
              </Badge>
              <span className="text-[15px] font-semibold text-nd-fg">{a.formatName}</span>
              <AiBadge level={a.aiFeasibility.level} size="sm" />
              <LangBadge dep={a.languageDependence} size="sm" />
              {ns === "applied" && <Badge tone="success" size="sm">메모 반영</Badge>}
              {ns === "stale" && note.trim() && <Badge tone="warning" size="sm">메모 반영 전</Badge>}
            </div>
            {a.summary && <p className="text-nd-body text-nd-fg">{a.summary}</p>}
            {a.hook && (
              <p>
                <b className="font-medium text-nd-fg">훅(첫 2초)</b> {a.hook}
              </p>
            )}
            {a.structure.length > 0 && (
              <p>
                <b className="font-medium text-nd-fg">흐름</b> {a.structure.join(" → ")}
              </p>
            )}
            {a.whyItWorks && (
              <p>
                <b className="font-medium text-nd-fg">먹힌 이유(가설)</b> {a.whyItWorks}
              </p>
            )}
          </div>
        ) : (
          <p className="text-[13px] text-nd-fg-2">
            아직 AI 분석 전입니다 — 「자세히 · 묶기」 에서 {videoId ? "AI 가 영상을 보고 형식을 뽑습니다(약 10원)." : "형식 카드를 직접 적어 묶을 수 있습니다."}
          </p>
        )}
      </div>

      <Field label="메모 — AI 가 분석할 때 참고합니다">
        <Textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== h.note && void act("note", "hit.update", { patch: { note } })}
          placeholder="왜 눈여겨봤는지 · 어디가 핵심인지 (예: 「첫 장면 손 클로즈업이 핵심」)"
        />
      </Field>

      <div className="sticky bottom-0 mt-auto flex flex-wrap items-center gap-2 border-t border-nd-line bg-nd-content pt-3">
        {suggested && (
          <Button size="sm" icon={Layers} loading={busy === "as"} disabled={busy !== null} onClick={() => void act("as", "hit.assign", { formatId: suggested.id }, `「${suggested.name}」 에 묶었습니다.`)} title={a?.match.reason}>
            「{suggested.name.length > 14 ? `${suggested.name.slice(0, 14)}…` : suggested.name}」 에 묶기
          </Button>
        )}
        {fmt && (
          <Button size="sm" variant="secondary" icon={Layers} onClick={() => onOpenFormat(fmt.id)}>
            형식 카드 보기
          </Button>
        )}
        <Button size="sm" variant="secondary" icon={PanelRightOpen} onClick={() => onDetail(h.id)}>
          자세히 · 묶기
        </Button>
        {h.status === "dismissed" ? (
          <Button size="sm" variant="ghost" loading={busy === "st"} disabled={busy !== null} onClick={() => void act("st", "hit.update", { patch: { status: "new" } }, "되살렸습니다.")}>
            되살리기
          </Button>
        ) : (
          <Button size="sm" variant="ghost" loading={busy === "st"} disabled={busy !== null} onClick={() => void act("st", "hit.update", { patch: { status: "dismissed" } }, "제외했습니다 — 「제외」 탭에서 되살릴 수 있습니다.")}>
            제외
          </Button>
        )}
        <a href={h.url} target="_blank" rel="noreferrer" className={cn("ml-auto inline-flex h-8 items-center gap-1 rounded-[8px] px-1.5 text-[13px] font-medium text-nd-fg-2 hover:bg-nd-fg/[.06] hover:text-nd-fg")}>
          원본 열기 <ExternalLink size={13} aria-hidden />
        </a>
      </div>
    </FeedSlideLayout>
  );
}
