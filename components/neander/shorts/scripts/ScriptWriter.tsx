"use client";

// ============================================================
//  대본 작성기 — 왼쪽 내 대본 목록 · 오른쪽 (새 대본 칸 | 대화 + 지금 대본)
// ------------------------------------------------------------
//  사진은 브라우저가 1024px JPEG 로 줄여 보낸다(서버 본문 한도 4.5MB). 미리보기는 160px.
//  AI 는 「대본 만들기」 · 「보내기」 를 눌렀을 때만 부른다. 고칠 때마다 버전이 남고 되돌릴 수 있다.
//  ⚠️ 대본은 확인된 사실만 쓴다 — 가격 · 효능 · 후기를 지어내지 않게 서버 규칙이 막고, 확인할 것은 따로 보여 준다.
//  대본은 사람마다 비공개(owner 만) · 프로젝트마다 따로(server/space-db.ts 의 SCOPED) — 관리자도 남의 대본은 못 본다.
//  2026-11 목업 개편: 새 대본은 「제품과 영상 기본 설정 → 스토리 광고 설정 → 참고 분석 · 첫 요청 · 예상 비용」 순서의 카드로.
//  세션 화면은 ScriptSession.tsx (대화와 지금 대본을 나란히).
//  다른 화면이 `?ref=<kind>:<id>` 로 참고 분석을 골라 보낸다 (컷 표 「이 구조로 대본 쓰기」 · 형식 카드 「이 형식으로 대본 쓰기」).
//  새 대본 양식에서 참고 영상 주소를 넣으면 컷 표(components/neander/shorts/cuts)를 만들거나 있는 것을 골라 참고로 쓴다.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, FilePlus2, FolderOpen, ListVideo, Lock, PenLine, Plus, RotateCcw, Sparkles, Theater } from "lucide-react";
import { Button, ErrorState, Field, FieldAction, FormRow, InlineNotice, Input, PageShell, SegmentedControl, Select, Skeleton, Textarea, cn, useToast } from "@/components/neander/ui";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { AiCostNote, StudioCard, StudioHeader, StudioNotice } from "@/components/neander/shorts/studio";
import { shortsGet, shortsPost } from "@/lib/neander/shorts/client";
import { CutSheet, getCutSheet } from "@/components/neander/shorts/cuts/CutSheet";
import { cutSheetLength, normalizeYoutubeVideoUrl, type CutSheet as CutSheetData } from "@/lib/neander/shorts/cuts";
import { spaceKind } from "@/lib/neander/shorts/spaces";
import {
  STORY_LOOKS,
  STORY_TONES,
  WRITER_KIND_LABEL,
  WRITER_LENGTHS,
  WRITER_MAX_PHOTOS,
  WRITER_REF_KINDS,
  WRITER_REF_LABEL,
  WRITER_STYLE_LABEL,
  parseWriterRefParam,
  type ScriptSessionSummary,
  type WriterKind,
  type WriterRef,
  type WriterRefKind,
  type WriterStyle,
} from "@/lib/neander/shorts/script-writer";
import { SessionView } from "./ScriptSession";
import { ModelSelect, PhotoPicker, Spent, estimateCost, useModel, type PhotoDraft, type Session, type TurnResult } from "./writer-parts";

// ---- 화면 ---------------------------------------------------------------------

export function ScriptWriter() {
  const router = useRouter();
  const search = useSearchParams();
  const selected = search.get("id");
  const isNew = search.get("new") === "1" || !selected;
  const toast = useToast();
  const [list, setList] = useState<ScriptSessionSummary[] | null>(null);
  const [aiReady, setAiReady] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [sessionErr, setSessionErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const go = useCallback((q: string) => router.replace(`/neander/shorts/scripts${q}`, { scroll: false }), [router]);

  const loadList = useCallback(async () => {
    try {
      const r = await shortsGet<{ sessions: ScriptSessionSummary[]; ai: boolean }>("scripts");
      setList(r.sessions);
      setAiReady(r.ai);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "대본 목록을 불러오지 못했습니다.");
    }
  }, []);
  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!selected) {
      setSession(null);
      return;
    }
    let live = true;
    setSessionErr(null);
    if (session?.id !== selected) setSession(null);
    shortsGet<{ session: Session }>(`scripts?id=${encodeURIComponent(selected)}`)
      .then((r) => live && setSession(r.session))
      .catch((e) => live && setSessionErr(e instanceof Error ? e.message : "대본을 불러오지 못했습니다."));
    return () => {
      live = false;
    };
    // 세션이 바뀔 때만(또는 「다시 시도」) 다시 받는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, reload]);

  const onSession = (s: Session) => {
    setSession(s);
    setList((l) => {
      const sum: ScriptSessionSummary = { id: s.id, title: s.title, kind: s.kind, style: s.style, updatedAt: s.updatedAt, createdAt: s.createdAt, costUsd: s.costUsd, projectId: s.projectId, product: s.product.name, versionCount: s.versionCount, cover: s.cover };
      return [sum, ...(l ?? []).filter((x) => x.id !== s.id)];
    });
  };
  const spentUsd = (list ?? []).reduce((n, x) => n + (x.costUsd ?? 0), 0);

  return (
    <PageShell>
      <StudioHeader
        kicker="AI STUDIO 워크스페이스"
        kickerIcon={FolderOpen}
        title="대본 작성기"
        description={
          isNew
            ? "제품 사진 · 정보와 분석(레퍼런스 컷 표 · 바이럴 형식 · 성공 공식 · AI 레이더)으로 초안을 만들고, 대화로 고쳐 가세요."
            : "대화 옆에서 최신 대본과 바뀐 장면을 바로 확인하세요. 고칠 때마다 버전이 남고 되돌릴 수 있습니다."
        }
        actions={
          <Button icon={FilePlus2} onClick={() => go("?new=1")}>
            새 대본
          </Button>
        }
      />
      {!aiReady && (
        <StudioNotice tone="warning" className="mb-4" title="AI 대본을 쓸 수 없습니다">
          OPENROUTER_API_KEY 가 없어 「대본 만들기」 · 「보내기」 가 동작하지 않습니다. 지난 대본은 그대로 볼 수 있습니다.
        </StudioNotice>
      )}
      <div className="grid items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
        <SessionList list={list} error={error} selected={isNew ? null : selected} onPick={(id) => go(`?id=${id}`)} onNew={() => go("?new=1")} onRetry={() => void loadList()} />
        <div className="min-w-0">
          {isNew ? (
            <NewScript
              key={`${search.get("product") ?? ""}|${search.get("ref") ?? ""}`}
              spentUsd={list ? spentUsd : null}
              prefill={{ product: search.get("product") ?? "", info: search.get("info") ?? "", style: search.get("style") === "story" ? "story" : "intro", ref: search.get("ref") ?? "" }}
              onCreated={(r) => {
                onSession(r.session);
                go(`?id=${r.session.id}`);
                if (r.error) toast.error(r.error);
              }}
            />
          ) : sessionErr ? (
            <ErrorState
              title="대본을 불러오지 못했습니다"
              description={sessionErr}
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button size="sm" variant="secondary" icon={RotateCcw} onClick={() => setReload((n) => n + 1)}>
                    다시 시도
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => go("?new=1")}>
                    새 대본
                  </Button>
                </div>
              }
            />
          ) : !session ? (
            <SessionSkeleton />
          ) : (
            <SessionView
              key={session.id}
              s={session}
              onChange={onSession}
              onDeleted={() => {
                setList((l) => (l ?? []).filter((x) => x.id !== session.id));
                setSession(null);
                go("?new=1");
              }}
            />
          )}
        </div>
      </div>
    </PageShell>
  );
}

function SessionSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <p className="sr-only" role="status">
        대본을 불러오는 중…
      </p>
      <Skeleton className="h-12 w-1/2 rounded-nd-md" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-[480px] rounded-nd-lg" />
        <Skeleton className="h-[480px] rounded-nd-lg" />
      </div>
    </div>
  );
}

// ---- 왼쪽 목록 ------------------------------------------------------------------

function SessionList({
  list,
  error,
  selected,
  onPick,
  onNew,
  onRetry,
}: {
  list: ScriptSessionSummary[] | null;
  error: string | null;
  selected: string | null;
  onPick: (id: string) => void;
  onNew: () => void;
  onRetry: () => void;
}) {
  return (
    <StudioCard
      title="내 대본"
      action={list && <span className="nd-num text-[13px] text-nd-fg-3">{list.length}개</span>}
      className="lg:sticky lg:top-4"
      bodyClassName="px-3 pb-4 sm:px-3"
    >
      {error ? (
        <div className="space-y-2 px-2 text-[13px] text-nd-warning-text">
          <p>{error}</p>
          <Button size="sm" variant="secondary" icon={RotateCcw} onClick={onRetry}>
            다시 시도
          </Button>
        </div>
      ) : !list ? (
        <div className="space-y-2 px-1">
          {[0, 1, 2].map((k) => (
            <Skeleton key={k} className="h-14 w-full" />
          ))}
        </div>
      ) : !list.length ? (
        <p className="px-2 text-[13px] leading-relaxed text-nd-fg-3">아직 대본이 없습니다. 제품 정보를 넣고 첫 대본을 만들어 보세요.</p>
      ) : (
        <ul className="nd-scroll max-h-[60vh] space-y-1 overflow-y-auto lg:max-h-[calc(100vh-320px)]">
          {list.map((x) => {
            const on = x.id === selected;
            return (
              <li key={x.id}>
                <button
                  type="button"
                  onClick={() => onPick(x.id)}
                  aria-current={on ? "true" : undefined}
                  className={cn("flex w-full items-center gap-2.5 rounded-nd-md px-2.5 py-2.5 text-left transition-colors", on ? "bg-nd-accent-soft" : "hover:bg-nd-sunken")}
                >
                  {x.cover && (
                    <span className="h-10 w-10 shrink-0 overflow-hidden rounded-nd-sm bg-nd-sunken">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={x.cover} alt="" className="h-full w-full object-cover" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className={cn("block break-keep text-[14px] font-semibold leading-snug [overflow-wrap:anywhere]", on ? "text-nd-accent-strong" : "text-nd-fg")} title={x.title}>
                      {x.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[13px] text-nd-fg-3" title={x.product}>
                      {x.style === "story" ? "스토리 광고" : "제품 소개"} · {x.versionCount ? `버전 ${x.versionCount}개` : "대본 전"}
                    </span>
                    <span className="block truncate text-[13px] text-nd-fg-3">
                      {fmtWhen(x.updatedAt)}
                      {x.projectId ? " · 영상 있음" : ""}
                    </span>
                  </span>
                  {on && <ChevronRight size={16} aria-hidden className="shrink-0 text-nd-accent" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3 border-t border-nd-line px-1 pt-3">
        <Button variant="ghost" size="sm" icon={Plus} onClick={onNew} className="-ml-1">
          새 대본
        </Button>
        <p className="mt-1 flex items-start gap-1.5 px-1 text-[13px] leading-snug text-nd-fg-3">
          <Lock size={14} aria-hidden className="mt-[2px] shrink-0" />
          이 프로젝트의 내 대본만 보입니다 — 대본은 나만 봅니다
        </p>
      </div>
    </StudioCard>
  );
}

// ---- 새 대본 -------------------------------------------------------------------

/** 컷 표 → 고르는 칸의 한 줄 (서버 writerReferences 와 같은 모양) */
const cutRefOf = (c: CutSheetData): WriterRef => {
  const n = cutSheetLength(c);
  return { kind: "cut", id: c.id, name: c.title || c.url, summary: [`컷 ${c.cuts.length}개`, n ? `약 ${Math.round(n)}초` : "", c.channel, c.hook ? `훅 ${c.hook.slice(0, 40)}` : ""].filter(Boolean).join(" · ") };
};

/**
 * prefill — 트렌드 노트의 「대본으로」 처럼 다른 화면이 주소로 넘긴 제품 이름 · 정보 · 방식 ·
 * 참고 분석(ref = `<kind>:<id>` — 컷 표 · 형식 카드 · 성공 공식 · 레이더 후보)
 */
function NewScript({ onCreated, prefill, spentUsd }: { onCreated: (r: TurnResult) => void; prefill?: { product: string; info: string; style: WriterStyle; ref?: string }; spentUsd: number | null }) {
  const { data, currentSpace } = useShorts();
  const clients = data?.clients ?? [];
  const { busy, run } = useAction();
  const [model, setModel] = useModel();
  const [refs, setRefs] = useState<WriterRef[] | null>(null);
  // 기본 영상 종류 — 대행 프로젝트면 그 업체의 고객사 브랜드, 아니면 프로젝트의 「새 영상 기본 종류」
  const agencyClient = spaceKind(currentSpace) === "agency" && currentSpace?.clientId && clients.some((c) => c.id === currentSpace.clientId) ? currentSpace.clientId : "";
  const [f, setF] = useState({
    name: prefill?.product.slice(0, 120) ?? "",
    info: prefill?.info.slice(0, 3000) ?? "",
    kind: (agencyClient ? "brand" : currentSpace?.defaultKind === "general" ? "general" : "coupang") as WriterKind,
    clientId: agencyClient,
    cta: "",
    targetSec: (prefill?.style ?? currentSpace?.writerStyle) === "story" ? 45 : 30,
    ref: ((r) => (r ? `${r.kind}:${r.id}` : "auto"))(parseWriterRefParam(prefill?.ref)),
    message: "",
  });
  // 주소로 넘긴 참고 분석을 목록에서 못 찾았을 때 (지워졌거나 다른 프로젝트 것)
  const [refMissing, setRefMissing] = useState<string | null>(null);
  // 참고 영상 주소 → 컷 표 서랍
  const [cutUrl, setCutUrl] = useState("");
  const [cutOpen, setCutOpen] = useState<string | null>(null);
  // 기본 방식은 지금 프로젝트의 설정 (AI 생성 채널이면 스토리 광고)
  const [style, setStyle] = useState<WriterStyle>(prefill?.style ?? currentSpace?.writerStyle ?? "intro");
  const [story, setStory] = useState({ problem: "", idea: "", characters: "", tone: STORY_TONES[0] as string, look: STORY_LOOKS[0] as string, endCard: "" });
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  useEffect(() => {
    let live = true;
    const want = parseWriterRefParam(prefill?.ref);
    void (async () => {
      const list = await shortsGet<{ refs: WriterRef[] }>("scripts?refs=1")
        .then((r) => r.refs)
        .catch(() => [] as WriterRef[]);
      // 주소로 고른 컷 표가 최근 목록(30) 밖이면 그 하나를 더 받아 넣는다
      if (want?.kind === "cut" && !list.some((r) => r.kind === "cut" && r.id === want.id)) {
        const c = await getCutSheet(want.id).then((r) => r.cut).catch(() => null);
        if (c) list.unshift(cutRefOf(c));
      }
      if (!live) return;
      setRefs(list);
      if (want && !list.some((r) => r.kind === want.kind && r.id === want.id)) {
        setRefMissing(`넘겨받은 ${WRITER_REF_LABEL[want.kind]}을(를) 이 프로젝트에서 찾지 못해 「AI 가 고르기」 로 두었습니다 — 지워졌거나 다른 프로젝트의 자료입니다.`);
        setF((x) => ({ ...x, ref: "auto" }));
      }
    })();
    return () => {
      live = false;
    };
    // 처음 한 번 (prefill 은 key 로 바뀐다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const refOf = (v: string) => (v === "auto" ? null : refs?.find((r) => `${r.kind}:${r.id}` === v) ?? null);
  const groups: [Exclude<WriterRefKind, "auto">, string][] = WRITER_REF_KINDS.map((k) => [k, WRITER_REF_LABEL[k]]);
  const cutRef = normalizeYoutubeVideoUrl(cutUrl);
  /** 컷 표 서랍의 「이 컷 표를 참고로 쓰기」 — 목록에 없으면 넣고 고른다 */
  const pickCut = (c: CutSheetData) => {
    const r = cutRefOf(c);
    setRefs((xs) => [r, ...(xs ?? []).filter((x) => !(x.kind === "cut" && x.id === c.id))]);
    setF((x) => ({ ...x, ref: `cut:${c.id}` }));
    setRefMissing(null);
    setCutOpen(null);
  };
  const picked = refOf(f.ref);
  const canMake = f.name.trim() && (f.kind !== "brand" || f.clientId);
  const make = () =>
    void run("make", async () => {
      const r = await shortsPost<TurnResult>("scripts", {
        action: "create",
        productName: f.name,
        productInfo: f.info,
        kind: f.kind,
        clientId: f.clientId || undefined,
        ctaKeyword: f.cta,
        targetSec: f.targetSec,
        refKind: picked ? picked.kind : "auto",
        refId: picked?.id,
        refName: picked?.name,
        message: f.message,
        model,
        photos,
        style,
        story: style === "story" ? story : undefined,
      });
      onCreated(r);
    });
  const changeStyle = (v: WriterStyle) => {
    setStyle(v);
    // 스토리 광고는 보통 더 길다 — 기본 길이만 바꾼다(사람이 고른 길이는 그대로)
    if (v === "story" && f.targetSec === 30) setF({ ...f, targetSec: 45 });
    if (v === "intro" && f.targetSec === 45) setF({ ...f, targetSec: 30 });
  };
  const refCount = (k: Exclude<WriterRefKind, "auto">) => (refs ?? []).filter((r) => r.kind === k).length;

  return (
    <div className="space-y-4">
      <StudioCard title="제품과 영상 기본 설정" description="확인된 사실만 적으세요 — 여기 적지 않은 가격 · 효능 · 후기는 대본에 쓰지 않습니다.">
        <div className="space-y-4">
          <FormRow className="grid-cols-1 md:grid-cols-2">
            <Field label="제품 이름" required>
              <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="예: 다이소 실리콘 싱크대 물막이" maxLength={120} />
            </Field>
            <Field label="영상 길이">
              <SegmentedControl fill ariaLabel="영상 길이" value={String(f.targetSec)} onChange={(v) => setF({ ...f, targetSec: Number(v) })} options={WRITER_LENGTHS.map((n) => ({ value: String(n), label: `${n}초` }))} />
            </Field>
          </FormRow>
          <Field label="제품 정보 · 확인된 사실만 (특징 · 크기 · 가격 · 사용법 · 누구에게)">
            <Textarea
              rows={3}
              value={f.info}
              onChange={(e) => setF({ ...f, info: e.target.value })}
              maxLength={3000}
              placeholder={"예: 접으면 2cm · 싱크대 가장자리에 흡착 · 3,000원(다이소) · 실리콘이라 물에 강함\n여기 적지 않은 가격 · 효능은 대본에 쓰지 않습니다."}
            />
          </Field>
          <div>
            <p className="mb-1.5 text-nd-caption font-medium text-nd-fg-2">
              제품 사진 · 최대 {WRITER_MAX_PHOTOS}장 <span className="font-normal text-nd-fg-3">— AI 가 보고 외형 · 구성을 읽습니다{style === "story" ? " · 제품 컷 · 엔드카드는 실제 사진으로" : ""}</span>
            </p>
            <PhotoPicker photos={photos} setPhotos={setPhotos} room={WRITER_MAX_PHOTOS} />
          </div>
          <FormRow className="grid-cols-1 md:grid-cols-2">
            <Field label="영상 종류">
              <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as WriterKind })}>
                {(Object.keys(WRITER_KIND_LABEL) as WriterKind[]).map((k) => (
                  <option key={k} value={k}>
                    {WRITER_KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="영상 방식">
              <SegmentedControl
                fill
                ariaLabel="영상 방식"
                value={style}
                onChange={changeStyle}
                options={(Object.keys(WRITER_STYLE_LABEL) as WriterStyle[]).map((k) => ({ value: k, label: WRITER_STYLE_LABEL[k], icon: k === "story" ? Theater : PenLine }))}
              />
            </Field>
          </FormRow>
          {f.kind !== "general" && (
            <FormRow className="grid-cols-1 md:grid-cols-2">
              {f.kind === "brand" ? (
                <Field label="고객사 (브리프 · 금지 표현을 따릅니다)" required>
                  <Select value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })}>
                    <option value="">고르기…</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <Field label="댓글 키워드 (CTA)">
                  <Input value={f.cta} onChange={(e) => setF({ ...f, cta: e.target.value })} placeholder="예: 물막이" maxLength={30} />
                </Field>
              )}
            </FormRow>
          )}
          <p className="rounded-nd-md bg-nd-sunken px-3 py-2.5 text-[13px] leading-relaxed text-nd-fg-2">
            {style === "story"
              ? "스토리 광고 — 제품이 해결하는 문제를 갈등으로 삼아 짧은 이야기를 짜고, 캐릭터 시트 · 컷별 카메라 · AI 영상 프롬프트 · 엔드카드까지 콘티로 씁니다."
              : "제품 소개 — 제품 사진과 정보를 AI 가 분석해 둔 형식 · 공식에 맞춰 소개 영상 대본으로 씁니다."}{" "}
            다 쓴 뒤에는 대화로 고쳐 가세요.
          </p>
        </div>
      </StudioCard>

      {style === "story" && (
        <StudioCard title="스토리 광고 설정" description="비워 두면 AI 가 제안합니다 · 제품 컷 · 엔드카드는 실제 사진을 기준으로 구성합니다">
          <div className="space-y-4">
            <FormRow className="grid-cols-1 md:grid-cols-2">
              <Field label="문제 · 핵심 장점 (스토리의 갈등이 됩니다)">
                <Textarea rows={3} value={story.problem} onChange={(e) => setStory({ ...story, problem: e.target.value })} maxLength={600} placeholder="예: 발바닥 털이 길면 미끄러운 바닥에서 못 멈춘다 → 털을 정리하면 젤리로 딱 선다" />
              </Field>
              <Field label="아이디어 · 무대">
                <Textarea rows={3} value={story.idea} onChange={(e) => setStory({ ...story, idea: e.target.value })} maxLength={1500} placeholder="예: 단풍 공원 데크에서 강아지 두 마리 달리기 시합 → 고양이가 끼어듦 → 털 정리 후 리매치" />
              </Field>
            </FormRow>
            <FormRow className="grid-cols-1 md:grid-cols-2">
              <Field label="등장인물">
                <Input value={story.characters} onChange={(e) => setStory({ ...story, characters: e.target.value })} maxLength={800} placeholder="예: 몰티즈 솜이(주인공) · 푸들 초코(라이벌) · 치즈냥(심판)" />
              </Field>
              <Field label="톤">
                <Select value={story.tone} onChange={(e) => setStory({ ...story, tone: e.target.value })}>
                  {STORY_TONES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </Field>
            </FormRow>
            <FormRow className="grid-cols-1 md:grid-cols-2">
              <Field label="그림체">
                <Select value={story.look} onChange={(e) => setStory({ ...story, look: e.target.value })}>
                  {STORY_LOOKS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="엔드카드에 넣을 것 (가격 · 할인 · 문구 — 적은 것만 씁니다)">
                <Input value={story.endCard} onChange={(e) => setStory({ ...story, endCard: e.target.value })} maxLength={300} placeholder="예: 23,500원 → 18,900원 · 「사주세요」" />
              </Field>
            </FormRow>
          </div>
        </StudioCard>
      )}

      <StudioCard title="참고 분석 · 첫 요청" description="분석의 구성 · 훅 방식 · 리듬을 옮깁니다 — 문장은 베끼지 않습니다">
        <div className="space-y-4">
          <Field label="참고할 분석">
            <Select value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} disabled={!refs}>
              <option value="auto">{refs ? "AI 가 고르기 — 컷 표 · 형식 카드 · 성공 공식 · 레이더 후보 중 이 제품에 맞는 것" : "분석 목록을 불러오는 중…"}</option>
              {groups.map(([k, label]) => {
                const items = (refs ?? []).filter((r) => r.kind === k);
                return items.length ? (
                  <optgroup key={k} label={`${label} (${items.length})`}>
                    {items.map((r) => (
                      <option key={r.id} value={`${r.kind}:${r.id}`}>
                        {r.name}
                        {r.summary ? ` — ${r.summary}` : ""}
                      </option>
                    ))}
                  </optgroup>
                ) : null;
              })}
            </Select>
          </Field>
          <p className="-mt-2 text-[13px] leading-relaxed text-nd-fg-3">
            {picked ? (
              <>
                <b className="font-medium text-nd-fg-2">고른 분석 · {picked.name}</b>
                {picked.summary ? ` — ${picked.summary}` : ""}
              </>
            ) : refs ? (
              <>
                고를 수 있는 분석 — 레퍼런스 컷 표 <span className="nd-num">{refCount("cut")}</span> · 바이럴 형식 카드 <span className="nd-num">{refCount("format")}</span> · 성공 공식 <span className="nd-num">{refCount("template")}</span> · 레이더 후보{" "}
                <span className="nd-num">{refCount("radar")}</span>
              </>
            ) : null}
            {picked?.kind === "cut" && " · 구조(컷 순서 · 길이 · 훅 · 역할)만 옮기고 말 · 제품은 새로 씁니다"}
          </p>
          {refMissing && <InlineNotice tone="warning">{refMissing}</InlineNotice>}
          <FormRow className="grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Field label="참고 영상 주소로 컷 표 (선택) — 남의 잘된 쇼츠를 컷 단위로 뜯어 그 구조로 씁니다">
              <Input
                value={cutUrl}
                onChange={(e) => setCutUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && cutRef) {
                    e.preventDefault();
                    setCutOpen(cutRef.url);
                  }
                }}
                placeholder="https://www.youtube.com/shorts/…"
                inputMode="url"
                aria-invalid={cutUrl.trim() !== "" && !cutRef}
              />
            </Field>
            <FieldAction size="md">
              <Button variant="secondary" icon={ListVideo} disabled={!cutRef} onClick={() => cutRef && setCutOpen(cutRef.url)}>
                컷 표 보기 · 만들기
              </Button>
            </FieldAction>
          </FormRow>
          {cutUrl.trim() !== "" && !cutRef && <p className="-mt-2 text-[13px] text-nd-warning-text">YouTube 영상 주소(watch · shorts · youtu.be)만 됩니다 — AI 가 직접 볼 수 있는 것은 YouTube 영상뿐입니다.</p>}
          <CutSheet open={!!cutOpen} url={cutOpen ?? ""} onClose={() => setCutOpen(null)} onUse={pickCut} />
          <Field label="처음 요청 (선택)">
            <Textarea rows={2} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} maxLength={2000} placeholder="예: 자취하는 20대 대상 · 반전으로 시작 · 말 없이 자막만" />
          </Field>
          <FormRow className="grid-cols-1 md:grid-cols-2">
            <Field label="AI 모델">
              <ModelSelect size="md" value={model} onChange={setModel} />
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-nd-caption font-medium text-nd-fg-2">예상 비용</span>
              <div className="flex min-h-ctl-md items-center rounded-nd-md bg-nd-sunken px-3 py-2">
                <AiCostNote compact estimate={estimateCost(model, style)} />
              </div>
            </div>
          </FormRow>
          <div className="flex flex-col gap-3 border-t border-nd-line pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] leading-relaxed text-nd-fg-3">
              {style === "story" ? "스토리 · 콘티는 한 번에 40~50초" : "한 번에 20초 안팎"} · 대본 작성기는 하루 상한이 없어 누를 때마다 한 번 비용이 듭니다
              {spentUsd !== null && (
                <>
                  {" "}
                  · 이 프로젝트 내 대본에 쓴 AI 비용 합 <Spent usd={spentUsd} />
                </>
              )}
            </p>
            <Button icon={Sparkles} loading={busy === "make"} disabled={!canMake || busy !== null} onClick={make} className="shrink-0">
              {busy === "make" ? "AI 가 대본을 쓰는 중… (10~60초)" : style === "story" ? "스토리 · 콘티 만들기" : "대본 만들기"}
            </Button>
          </div>
        </div>
      </StudioCard>
    </div>
  );
}
