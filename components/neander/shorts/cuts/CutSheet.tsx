"use client";

// ============================================================
//  레퍼런스 영상 「컷 표」 서랍 — 남의 잘된 쇼츠를 컷 전환 단위로 (장면 · 말 · 화면 글자 · 소리 · 초)
// ------------------------------------------------------------
//  왼쪽(모바일은 위) 재생기 · 오른쪽 컷 표(데스크톱 표 · 모바일 카드). 줄의 초를 누르면 재생기가 그 초로 간다
//  (youtube-nocookie 퍼가기 주소를 바꾼다 — 처음 열 때는 자동 재생하지 않는다: 쇼츠처럼 보기 위에서 열리면 소리가 겹친다).
//  아직 없으면 사람 메모(선택) · 예상 비용(실측 근거) · 오늘 n / 30 · 「컷 표 만들기」.
//  초는 AI 가 영상을 보고 적은 대략의 값이다 — 표 위에 늘 그렇게 밝힌다. 길이는 YouTube API 로 알면 그 값.
//  「이 구조로 대본 쓰기」 → 대본 작성기(?ref=cut:yt_…) — 구조는 옮기고 내용은 우리 제품으로 새로 쓴다.
//  들어가는 곳: AI 레이더 후보 · 바이럴 형식(터진 영상 서랍 · 형식 카드 예시) · 대본 작성기 새 대본 양식.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Copy, ExternalLink, Info, ListVideo, PenLine, RefreshCw, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { Badge, Button, ErrorState, Field, Select, Sheet, Skeleton, Textarea, buttonClass, cn, useConfirm, useToast } from "@/components/neander/ui";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { fmtUsd, fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { AiCostNote, RecordTable, StudioNotice, type RecordColumn } from "@/components/neander/shorts/studio";
import { AiWon } from "@/components/neander/shorts/scout/bits";
import { shortsGet, shortsPost } from "@/lib/neander/shorts/client";
import { BEAT_LABEL } from "@/lib/neander/shorts/model";
import { krwOf } from "@/lib/neander/shorts/radar";
import {
  CUT_COST_BASIS,
  CUT_NOTE_MAX,
  avgCutSec,
  cutEmbedUrl,
  cutEstimateUsd,
  cutIdOf,
  cutLen,
  cutRange,
  cutSheetLength,
  cutSheetText,
  fmtCutSec,
  normalizeYoutubeVideoUrl,
  type Cut,
  type CutSheet as CutSheetData,
} from "@/lib/neander/shorts/cuts";

// ---- 서버 호출 ------------------------------------------------------------------

export interface CutsGet {
  me: string;
  admin: boolean;
  today: { used: number; limit: number };
  models: readonly { id: string; label: string }[];
  cut: CutSheetData | null;
}
export const getCutSheet = (id: string) => shortsGet<CutsGet>(`cuts?id=${encodeURIComponent(id)}`);
export const makeCutSheet = (body: { url: string; note?: string; model?: string; force?: boolean }) =>
  shortsPost<{ cut: CutSheetData; reused: boolean; costUsd: number; today: CutsGet["today"] }>("cuts", { action: "cut.make", ...body });

/** 대본 작성기로 — 이 컷 표를 참고 분석으로 고른 새 대본 */
export const cutWriterHref = (id: string) => `/neander/shorts/scripts?ref=${encodeURIComponent(`cut:${id}`)}`;

// ---- 버튼 (영상 하나를 다루는 자리에 하나) ------------------------------------------

/**
 * 「컷 표」 버튼 + 서랍. YouTube 영상 주소가 아니면 그리지 않는다 (AI 가 직접 볼 수 있는 것은 YouTube 뿐).
 * durationSec — 부르는 쪽이 이미 아는 길이(공식 API 값). 예상 비용 어림에만 쓴다.
 */
export function CutsButton({
  url,
  title,
  durationSec,
  size = "md",
  variant = "ghost",
  label = "컷 표",
  className,
}: {
  url: string;
  title?: string;
  durationSec?: number | null;
  size?: "sm" | "md";
  variant?: "ghost" | "secondary" | "soft";
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!normalizeYoutubeVideoUrl(url)) return null;
  return (
    <>
      <Button
        size={size}
        variant={variant}
        icon={ListVideo}
        className={className}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title="컷 전환마다 장면 · 말 · 화면 글자 · 소리 · 초를 펼쳐 봅니다 — 그 구조로 대본을 쓸 수 있습니다"
      >
        {label}
      </Button>
      <CutSheet open={open} url={url} title={title} durationSec={durationSec} onClose={() => setOpen(false)} />
    </>
  );
}

// ---- 서랍 -----------------------------------------------------------------------

export function CutSheet({
  open,
  url,
  title,
  durationSec,
  onClose,
  onUse,
}: {
  open: boolean;
  url: string;
  title?: string;
  durationSec?: number | null;
  onClose: () => void;
  /** 대본 작성기 새 대본 양식에서 — 「이 컷 표를 참고로 쓰기」 (없으면 대본 작성기로 가는 링크) */
  onUse?: (cut: CutSheetData) => void;
}) {
  const ref = normalizeYoutubeVideoUrl(url);
  // 부르는 쪽이 제목을 모르면(대본 작성기 주소 칸) 컷 표에 적힌 제목으로
  const [known, setKnown] = useState("");
  const shownTitle = title?.trim() || known || "레퍼런스 영상";
  return (
    <Sheet open={open && !!ref} onClose={onClose} width={1240} title={<span className="line-clamp-1 [overflow-wrap:anywhere]">컷 표 · {shownTitle}</span>}>
      {ref && open && <CutSheetBody key={ref.videoId} videoId={ref.videoId} url={ref.url} durationHint={durationSec ?? null} onUse={onUse} onClose={onClose} onTitle={setKnown} />}
    </Sheet>
  );
}

function CutSheetBody({
  videoId,
  url,
  durationHint,
  onUse,
  onClose,
  onTitle,
}: {
  videoId: string;
  url: string;
  durationHint: number | null;
  onUse?: (cut: CutSheetData) => void;
  onClose: () => void;
  onTitle: (title: string) => void;
}) {
  const id = cutIdOf(videoId);
  const toast = useToast();
  const ask = useConfirm();
  const { nameOf } = useShorts();
  const { busy, run } = useAction();
  const [data, setData] = useState<CutsGet | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [makeErr, setMakeErr] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [model, setModel] = useState("");
  const [redo, setRedo] = useState(false);
  // 재생기 — 처음엔 멈춘 채, 줄의 초를 누르면 그 초부터 재생 (주소가 바뀌면 iframe 을 새로 그린다)
  const [seek, setSeek] = useState<{ at: number; play: boolean; n: number }>({ at: 0, play: false, n: 0 });
  const player = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await getCutSheet(id);
      setData(r);
      onTitle(r.cut?.title ?? "");
      setNote((n) => n || r.cut?.note || "");
      setModel((m) => m || r.models[0]?.id || "");
      setLoadErr(null);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "컷 표를 불러오지 못했습니다.");
    }
    // onTitle 은 부모의 setState — 바뀌지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const cut = data?.cut ?? null;
  const len = cut ? cutSheetLength(cut) : durationHint;
  const estimateUsd = cutEstimateUsd(len ?? null);
  const estimate = `약 ${krwOf(estimateUsd).toLocaleString("ko-KR")}원`;
  const estimateWhy = `컷 표 실측(${CUT_COST_BASIS.sec}초 한 편 $${CUT_COST_BASIS.usd})을 ${len ? `이 영상 길이 ${Math.round(len)}초` : "길이를 몰라 30초"}에 맞춘 어림 — 컷이 많으면 조금 더 듭니다`;
  const reached = !!data && data.today.used >= data.today.limit;

  const make = (force: boolean) =>
    void run(force ? "redo" : "make", async () => {
      setMakeErr(null);
      try {
        const r = await makeCutSheet({ url, note, model: model || undefined, force });
        setData((d) => (d ? { ...d, cut: r.cut, today: r.today } : d));
        onTitle(r.cut.title);
        setRedo(false);
        setSeek({ at: 0, play: false, n: 0 });
        if (r.reused) toast.info("이미 있는 컷 표를 열었습니다 — AI 를 부르지 않았습니다.");
        else toast.success(`컷 ${r.cut.cuts.length}개를 받아 적었습니다 · 비용 약 ${krwOf(r.costUsd).toLocaleString("ko-KR")}원`);
      } catch (e) {
        setMakeErr(e instanceof Error ? e.message : "컷 표를 만들지 못했습니다.");
      }
    });
  const remake = async () => {
    const ok = await ask({
      title: "컷 표를 다시 만들까요?",
      message: `AI 가 영상을 다시 봅니다 — 예상 ${estimate} · 오늘 ${data?.today.used ?? 0} / ${data?.today.limit ?? 30}편. 지금 표는 새 표로 바뀝니다 (이 프로젝트의 모두에게).`,
      confirmLabel: "다시 만들기",
    });
    if (ok) make(true);
  };
  const remove = async () => {
    if (!cut) return;
    const ok = await ask({ title: "컷 표를 지울까요?", message: "이 프로젝트의 모두에게서 사라집니다. 이 표를 참고로 쓴 대본은 그대로 남습니다.", tone: "danger", confirmLabel: "지우기" });
    if (!ok) return;
    await run(
      "del",
      async () => {
        await shortsPost("cuts", { action: "cut.delete", id });
        setData((d) => (d ? { ...d, cut: null } : d));
      },
      "컷 표를 지웠습니다.",
    );
  };
  const copy = async () => {
    if (!cut) return;
    try {
      await navigator.clipboard.writeText(cutSheetText(cut, BEAT_LABEL));
      toast.success("컷 표를 복사했습니다 — 노션 · 카톡에 붙여 넣으세요.");
    } catch {
      toast.error("복사하지 못했습니다 — 브라우저가 클립보드를 막았습니다.");
    }
  };
  const jump = (c: Cut) => {
    setSeek((s) => ({ at: c.from, play: true, n: s.n + 1 }));
    // 모바일은 재생기가 표 위에 있다 — 누른 뒤 보이게
    if (window.matchMedia("(max-width: 1023px)").matches) player.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  if (loadErr && !data)
    return (
      <div className="px-5 pb-6">
        <ErrorState
          title="컷 표를 불러오지 못했습니다"
          description={loadErr}
          action={
            <Button size="sm" variant="secondary" icon={RotateCcw} onClick={() => void load()}>
              다시 불러오기
            </Button>
          }
        />
      </div>
    );

  const canDelete = !!cut && !!data && (cut.owner === data.me || data.admin);
  const making = busy === "make" || busy === "redo";

  const makeForm = (force: boolean) => (
    <div className="space-y-3">
      <Field label="사람 메모 (선택) — AI 가 받아 적을 때 초점으로 삼습니다">
        <Textarea
          rows={2}
          value={note}
          maxLength={CUT_NOTE_MAX}
          onChange={(e) => setNote(e.target.value)}
          disabled={making}
          placeholder="예: 「첫 5초 훅만 자세히」 「손 클로즈업이 몇 번 나오는지」 「자막 문구 위주로」"
        />
      </Field>
      {data && data.models.length > 1 && (
        <Field label="영상을 보는 모델">
          <Select size="sm" value={model} onChange={(e) => setModel(e.target.value)}>
            {data.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <div className="flex flex-col gap-2 rounded-nd-md bg-nd-sunken px-3.5 py-3">
        <AiCostNote estimate={estimate} used={data ? `${data.today.used}편` : null} cap={data ? `${data.today.limit}편 (이 프로젝트)` : null} />
        <p className="text-[13px] leading-relaxed text-nd-fg-3">{estimateWhy}. 만든 표는 이 프로젝트의 모두가 함께 봅니다 — 같은 영상은 다시 부르지 않습니다.</p>
      </div>
      {reached && data && (
        <StudioNotice tone="warning" title="오늘 하루 상한에 닿았습니다">
          이 프로젝트에서 오늘 컷 표를 {data.today.limit}편 만들었습니다. 내일 다시 만들 수 있습니다.
        </StudioNotice>
      )}
      {makeErr && (
        <StudioNotice tone="danger" title="컷 표를 만들지 못했습니다">
          {makeErr}
        </StudioNotice>
      )}
      {making && (
        <StudioNotice tone="info" title="AI 가 영상을 보는 중…">
          화면 · 소리 · 자막을 보고 컷마다 받아 적습니다 — 보통 20~60초 걸립니다. 서랍을 닫지 마세요.
        </StudioNotice>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {force && (
          <Button variant="ghost" onClick={() => setRedo(false)} disabled={making}>
            취소
          </Button>
        )}
        <Button icon={force ? RefreshCw : Sparkles} loading={making} disabled={!data || reached || busy !== null} onClick={() => (force ? void remake() : make(false))}>
          {making ? "영상 보는 중…" : force ? "다시 만들기" : "컷 표 만들기"}
        </Button>
      </div>
    </div>
  );

  const columns: RecordColumn<Cut>[] = [
    {
      key: "at",
      header: "컷 · 초 (AI 추정)",
      mobile: "title",
      className: "w-[150px]",
      cell: (c) => {
        const i = cut ? cut.cuts.indexOf(c) : 0;
        return (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="nd-num text-[13px] font-semibold text-nd-fg-3">{i + 1}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                jump(c);
              }}
              className="nd-num rounded-nd-sm text-[14px] font-semibold text-nd-accent underline-offset-2 hover:underline"
              title={`재생기를 ${fmtCutSec(c.from)}초로 · 컷 길이 ${fmtCutSec(cutLen(c))}초`}
            >
              {cutRange(c)}
            </button>
            {c.beat ? (
              <Badge tone="info" size="lg">
                {BEAT_LABEL[c.beat]}
              </Badge>
            ) : null}
          </span>
        );
      },
    },
    { key: "shot", header: "화면", cell: (c) => <Cell text={c.shot} />, className: "min-w-[180px]" },
    { key: "speech", header: "말", cell: (c) => <Cell text={c.speech} empty="말 없음" />, className: "min-w-[160px]" },
    { key: "caption", header: "화면 글자", cell: (c) => <Cell text={c.caption} />, className: "min-w-[120px]" },
    { key: "sound", header: "소리", cell: (c) => <Cell text={c.sound} />, className: "min-w-[120px]" },
  ];

  return (
    <div className="grid gap-5 px-5 pb-6 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)] lg:items-start">
      {/* 재생기 */}
      <div ref={player} className="scroll-mt-2 lg:sticky lg:top-0">
        <div className="mx-auto aspect-[9/16] w-full max-w-[240px] overflow-hidden rounded-nd-lg bg-black lg:max-w-none">
          <iframe
            key={seek.n}
            src={cutEmbedUrl(videoId, seek.at, seek.play)}
            title="레퍼런스 영상"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            className="h-full w-full"
          />
        </div>
        <p className="mt-2 text-center text-[13px] leading-snug text-nd-fg-3">
          {cut && <span className="block">표의 초를 누르면 그 초부터 재생합니다</span>}
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-nd-accent hover:underline">
            YouTube 에서 열기 <ExternalLink size={13} aria-hidden />
          </a>
        </p>
      </div>

      {/* 표 · 만들기 */}
      <div className="min-w-0 space-y-4">
        {!data ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-16 w-full rounded-nd-md" />
            <Skeleton className="h-64 w-full rounded-nd-md" />
          </div>
        ) : !cut ? (
          <div className="space-y-4">
            <StudioNotice tone="info" title="아직 컷 표가 없습니다">
              AI(Gemini)가 영상을 직접 보고 컷 전환마다 화면 · 말(들린 그대로 — 외국어는 원문 + 뜻) · 화면 글자 · 소리 · 대략의 초를 받아 적습니다. 보지 못한 것은 지어내지 않게 했습니다.
            </StudioNotice>
            {makeForm(false)}
          </div>
        ) : (
          <>
            <section aria-label="컷 표 요약" className="space-y-2.5">
              {cut.hook && (
                <div className="rounded-nd-md bg-nd-accent-soft/60 px-3.5 py-2.5">
                  <p className="text-[13px] font-medium text-nd-accent-strong">훅 (첫 2초)</p>
                  <p className="mt-0.5 text-[15px] font-semibold leading-snug text-nd-fg [overflow-wrap:anywhere]">{cut.hook}</p>
                </div>
              )}
              {cut.summary && <p className="text-nd-body leading-relaxed text-nd-fg [overflow-wrap:anywhere]">{cut.summary}</p>}
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-nd-fg-2">
                <Badge tone="accent" size="lg">
                  AI 추정
                </Badge>
                <span>
                  컷 <b className="nd-num">{cut.cuts.length}</b>개
                </span>
                <span aria-hidden>·</span>
                <span>
                  {len === null ? (
                    "길이 —"
                  ) : (
                    <>
                      길이 약 <span className="nd-num">{Math.round(len)}</span>초 {cut.durationSrc === "api" ? "(YouTube)" : cut.durationSrc === "ai" ? "(AI 가 본 값)" : "(마지막 컷 기준)"}
                    </>
                  )}
                </span>
                {avgCutSec(cut.cuts) !== null && (
                  <>
                    <span aria-hidden>·</span>
                    <span>
                      평균 컷 <span className="nd-num">{avgCutSec(cut.cuts)}</span>초
                    </span>
                  </>
                )}
                <span aria-hidden>·</span>
                <span>
                  {cut.by === data.me ? "내가" : nameOf(cut.by)} 만듦 · {fmtWhen(cut.at)}
                </span>
                <span aria-hidden>·</span>
                <span title={`${cut.model} · ${fmtUsd(cut.costUsd)}`}>
                  비용 <AiWon usd={cut.costUsd} className="font-medium" />
                </span>
              </p>
              {cut.note && <p className="text-[13px] text-nd-fg-3 [overflow-wrap:anywhere]">사람 메모(분석 초점): {cut.note}</p>}
            </section>

            <div className="flex flex-wrap items-center gap-2">
              {onUse ? (
                <Button icon={PenLine} onClick={() => onUse(cut)}>
                  이 컷 표를 참고로 쓰기
                </Button>
              ) : (
                <Link href={cutWriterHref(cut.id)} className={buttonClass("primary", "md", "gap-1.5")} onClick={onClose}>
                  <PenLine size={16} aria-hidden />이 구조로 대본 쓰기
                </Link>
              )}
              <Button variant="secondary" icon={Copy} onClick={() => void copy()}>
                복사
              </Button>
              <Button variant="ghost" icon={RefreshCw} disabled={busy !== null} onClick={() => setRedo((v) => !v)} aria-expanded={redo}>
                다시 만들기
              </Button>
              {canDelete && (
                <Button variant="ghost" icon={Trash2} loading={busy === "del"} disabled={busy !== null} onClick={() => void remove()} className="ml-auto">
                  지우기
                </Button>
              )}
            </div>
            {redo && <div className="rounded-nd-md border border-nd-line px-4 py-3.5">{makeForm(true)}</div>}

            <p className="flex items-start gap-1.5 text-[13px] leading-relaxed text-nd-fg-3">
              <Info size={14} aria-hidden className="mt-[3px] shrink-0" />
              <span>초는 AI 가 영상을 보고 적은 대략의 값입니다 — 편집 기준으로 쓰기 전에 재생기로 확인하세요. 말은 들린 그대로(외국어는 원문 + 뜻), 역할은 AI 의 분류입니다.</span>
            </p>
            <div className="overflow-hidden rounded-nd-md border border-nd-line max-md:border-0">
              <RecordTable rows={cut.cuts} columns={columns} rowKey={(c) => `${c.from}-${c.to}`} ariaLabel="컷 표" rowClassName={(c) => (seek.play && seek.at === c.from ? "bg-nd-accent-soft/50" : undefined)} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 표 칸 글 — 비면 「—」 (모바일 카드에서도 왼쪽 정렬로 읽히게) */
function Cell({ text, empty }: { text: string; empty?: string }) {
  if (!text) return <span className={cn("block text-left text-nd-fg-3")}>{empty ?? "—"}</span>;
  return <span className="block whitespace-pre-line text-left text-[14px] leading-snug text-nd-fg [overflow-wrap:anywhere]">{text}</span>;
}
