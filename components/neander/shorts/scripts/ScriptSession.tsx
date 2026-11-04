"use client";

// ============================================================
//  대본 작성기 · 세션 화면 — 대화로 고치기 | 지금 대본 (나란히)
// ------------------------------------------------------------
//  아래로: 캐릭터 시트 · 엔드카드(스토리) | 확인된 사실 · 확인할 것 → 게시 문구 · 행동 유도(전체 대본 복사).
//  예전 버전을 고르면 모든 칸이 그 버전을 보여 주고, 「이 버전으로 되돌리기」 가 나온다(대화는 지금 버전을 고친다).
//  확인된 사실은 칸을 벗어나면 조용히 저장한다(SaveIndicator) — 다음 요청부터 AI 가 이것을 따른다.
//  「보내기」 · 빠른 요청은 유료 AI 한 번이다 — 예상 비용을 버튼 옆에 둔다.
// ============================================================

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Bot, Camera, ClipboardCopy, Clapperboard, Film, Lightbulb, PenLine, RotateCcw, SendHorizontal, Sparkles, Trash2, TriangleAlert, Users, Wand2 } from "lucide-react";
import { Badge, Button, Dialog, EmptyState, Select, Skeleton, Textarea, cn, useConfirm, useToast } from "@/components/neander/ui";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { AiCostNote, SaveIndicator, StudioCard, StudioNotice, VisibilityChip, type StudioSaveState } from "@/components/neander/shorts/studio";
import { shortsGet, shortsPost } from "@/lib/neander/shorts/client";
import { BEAT_LABEL } from "@/lib/neander/shorts/model";
import { WRITER_KIND_LABEL, WRITER_MAX_PHOTOS, WRITER_REF_LABEL, WRITER_STYLE_LABEL, WRITER_SUGGESTIONS, writerScriptText, writerTimeline, writerTotalSec, type WriterScript } from "@/lib/neander/shorts/script-writer";
import { ModelSelect, PhotoPicker, STORY_SUGGESTIONS, Spent, estimateCost, modelLabel, useModel, won, type PhotoDraft, type Session, type TurnResult } from "./writer-parts";

const two = (n: number) => String(n).padStart(2, "0");

export function SessionView({ s, onChange, onDeleted }: { s: Session; onChange: (s: Session) => void; onDeleted: () => void }) {
  const toast = useToast();
  const ask = useConfirm();
  const router = useRouter();
  const { nameOf } = useShorts();
  const { busy, run } = useAction();
  const [view, setView] = useState<number | null>(null); // 보고 있는 버전 (null = 지금)
  const shown = view === null ? s.script : (s.versions.find((v) => v.n === view)?.script ?? s.script);
  const latest = s.versions.at(-1)?.n ?? null;
  const style = s.style ?? "intro";

  const post = async <T,>(action: string, body: object) => shortsPost<T>("scripts", { action, id: s.id, ...body });
  const del = async () => {
    if (!(await ask({ title: "이 대본을 지울까요?", message: "대화 · 버전 · 사진이 모두 지워집니다. 만든 영상은 그대로 남습니다.", confirmLabel: "지우기", tone: "danger" }))) return;
    void run(
      "del",
      async () => {
        await post("delete", {});
        onDeleted();
      },
      "대본을 지웠습니다.",
    );
  };
  const toProject = () =>
    void run("proj", async () => {
      const r = await post<{ projectId: string; created: boolean }>("toProject", {});
      onChange({ ...s, projectId: r.projectId });
      toast.success(r.created ? "이 대본으로 영상을 만들었습니다." : "이미 만든 영상을 엽니다.");
      router.push(`/neander/shorts/projects/${r.projectId}`);
    });
  const revert = (n: number) =>
    void run(
      "rev",
      async () => {
        const r = await post<{ session: Session }>("revert", { n });
        onChange(r.session);
        setView(null);
      },
      `버전 ${n} 으로 되돌렸습니다.`,
    );

  return (
    <div className="space-y-4 [container-type:inline-size]">
      {/* 세션 제목 줄 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="break-keep text-[22px] font-bold leading-snug text-nd-fg [overflow-wrap:anywhere]">{s.title}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-nd-fg-3">
            <span>{WRITER_STYLE_LABEL[style]}</span>
            <span aria-hidden>·</span>
            <span>{WRITER_KIND_LABEL[s.kind]}</span>
            <span aria-hidden>·</span>
            <span className="nd-num">목표 {s.targetSec}초</span>
            <span aria-hidden>·</span>
            <span className="nd-num">버전 {s.versionCount}개</span>
            <span aria-hidden>·</span>
            <span>만든 날 {fmtWhen(s.createdAt)}</span>
            <span aria-hidden>·</span>
            <span>
              AI 비용 합 <Spent usd={s.costUsd} />
            </span>
            <span aria-hidden>·</span>
            <VisibilityChip visibility="private" ownerName={nameOf(s.owner)} />
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {s.projectId ? (
            <Button variant="secondary" icon={Clapperboard} onClick={() => router.push(`/neander/shorts/projects/${s.projectId}`)}>
              만든 영상 열기
            </Button>
          ) : (
            <Button icon={Clapperboard} loading={busy === "proj"} disabled={!s.script || busy !== null} onClick={toProject} title="지금 대본의 장면 · 대본 줄 · 게시 문구로 영상을 만듭니다">
              이 대본으로 영상 만들기
            </Button>
          )}
          <Button variant="ghost" icon={Trash2} disabled={busy !== null} onClick={() => void del()}>
            지우기
          </Button>
        </div>
      </div>

      <div className="grid items-start gap-4 [@container(min-width:760px)]:grid-cols-2">
        <ChatPane s={s} onChange={onChange} onViewVersion={setView} />
        <ScriptPane s={s} script={shown} view={view} latest={latest} setView={setView} onRevert={revert} reverting={busy === "rev"} />
      </div>

      <div className={cn("grid items-start gap-4", shown?.story && "[@container(min-width:760px)]:grid-cols-2")}>
        {shown?.story && <CharacterCard story={shown.story} />}
        <FactsCard s={s} onChange={onChange} />
      </div>

      {shown && <PostCard script={shown} />}
    </div>
  );
}

// ---- 대화로 고치기 ------------------------------------------------------------------

function ChatPane({ s, onChange, onViewVersion }: { s: Session; onChange: (s: Session) => void; onViewVersion: (n: number | null) => void }) {
  const toast = useToast();
  const { nameOf } = useShorts();
  const { busy, run } = useAction();
  const [model, setModel] = useModel();
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [attach, setAttach] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const room = WRITER_MAX_PHOTOS - s.photos.length;
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [s.messages.length, busy]);
  const send = (msg?: string) => {
    const m = (msg ?? text).trim();
    if ((!m && !photos.length) || busy) return;
    void run("send", async () => {
      const r = await shortsPost<TurnResult>("scripts", { action: "turn", id: s.id, message: m, photos, model });
      onChange(r.session);
      onViewVersion(null);
      setText("");
      setPhotos([]);
      setAttach(false);
      if (r.error) toast.error(r.error);
    });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };
  const photoById = useMemo(() => new Map(s.photos.map((p, i) => [p.id, { ...p, n: i + 1 }])), [s.photos]);
  const lastFailed = s.messages.at(-1)?.error;
  const me = nameOf(s.owner);

  return (
    <section className="nd-surface flex min-h-[520px] min-w-0 flex-col overflow-hidden rounded-nd-lg [@container(min-width:760px)]:sticky [@container(min-width:760px)]:top-4 [@container(min-width:760px)]:h-[calc(100vh-140px)]">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-3 pt-4">
        <h3 className="inline-flex items-center gap-1.5 text-[16px] font-semibold text-nd-fg">
          <Bot size={17} className="text-nd-accent" aria-hidden /> 대화로 고치기
        </h3>
        <div className="w-[min(240px,100%)]">
          <ModelSelect value={model} onChange={setModel} />
        </div>
      </div>
      <div ref={list} className="nd-scroll min-h-0 flex-1 space-y-3 overflow-y-auto border-t border-nd-line px-5 py-4" aria-live="polite">
        {s.messages.length === 0 && <p className="text-[13px] text-nd-fg-3">아직 대화가 없습니다.</p>}
        {s.messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-6 rounded-nd-md border border-nd-accent/20 bg-nd-accent-soft px-3.5 py-2.5 text-nd-body text-nd-fg">
              <p className="text-[13px] font-semibold text-nd-fg-2">{me}</p>
              <p className="mt-0.5 whitespace-pre-line [overflow-wrap:anywhere]">{m.text}</p>
              {m.photoIds?.length ? (
                <div className="mt-1.5 flex gap-1.5">
                  {m.photoIds.map((pid) => {
                    const p = photoById.get(pid);
                    return p ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={pid} src={p.thumb} alt={`사진 ${p.n}`} title={`사진 ${p.n}`} className="h-10 w-10 rounded-[6px] object-cover" />
                    ) : null;
                  })}
                </div>
              ) : null}
              <p className="nd-num mt-1 text-[13px] text-nd-fg-3">{fmtWhen(m.at)}</p>
            </div>
          ) : (
            <div key={i} className={cn("mr-4 rounded-nd-md border px-3.5 py-2.5 text-nd-body", m.error ? "border-nd-danger/25 bg-nd-danger-soft text-nd-danger-text" : "border-nd-line bg-nd-content text-nd-fg")}>
              <p className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-nd-fg-2">
                {m.error ? <TriangleAlert size={14} aria-hidden /> : <Sparkles size={14} aria-hidden className="text-nd-accent" />}
                {m.error ? "AI 가 답하지 못했어요" : "AI 대본 도우미"}
              </p>
              <p className="mt-0.5 whitespace-pre-line [overflow-wrap:anywhere]">{m.error ? `${m.text} — ${m.error}` : m.text}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-nd-fg-3">
                {m.version && (
                  <button type="button" className="font-medium text-nd-accent hover:underline" onClick={() => onViewVersion(m.version ?? null)}>
                    버전 {m.version} 보기
                  </button>
                )}
                {m.model && <span>{modelLabel(m.model)}</span>}
                {m.costUsd !== undefined && <span className="nd-num">{won(m.costUsd)}</span>}
                <span className="nd-num">{fmtWhen(m.at)}</span>
              </p>
            </div>
          ),
        )}
        {busy === "send" && (
          <div className="mr-4 inline-flex items-center gap-2 rounded-nd-md bg-nd-sunken px-3 py-2 text-nd-body text-nd-fg-2" role="status">
            <Sparkles size={15} className="animate-pulse text-nd-accent" aria-hidden />
            AI 가 대본을 고치는 중… (10~60초)
          </div>
        )}
      </div>
      <div className="space-y-2.5 border-t border-nd-line px-5 py-4">
        {lastFailed && !busy && (
          <Button size="sm" variant="secondary" icon={RotateCcw} onClick={() => send(s.messages.filter((m) => m.role === "user").at(-1)?.text ?? "")}>
            방금 요청 다시 보내기
          </Button>
        )}
        <p className="text-[13px] font-medium text-nd-fg-2">수정 요청</p>
        {attach && <PhotoPicker compact photos={photos} setPhotos={setPhotos} room={room} />}
        <Textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          maxLength={2000}
          disabled={busy !== null}
          placeholder={s.script ? "대본을 어떻게 바꾸고 싶나요? (Enter 보내기 · Shift+Enter 줄바꿈)" : "처음 대본을 다시 부탁해 보세요"}
          className="w-full"
          aria-label="수정 요청"
        />
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" icon={Camera} title={room ? `사진 붙이기 (${room}장 더)` : "사진은 4장까지입니다"} disabled={!room || busy !== null} onClick={() => setAttach(!attach)} className="-ml-2">
            {attach ? "사진 접기" : "사진 붙이기"}
          </Button>
          <Button icon={SendHorizontal} loading={busy === "send"} disabled={(!text.trim() && !photos.length) || busy !== null} onClick={() => send()}>
            보내기
          </Button>
        </div>
        <AiCostNote label="다음 요청" estimate={estimateCost(model, s.style ?? "intro", s)} />
        <div className="flex flex-wrap gap-1.5">
          {(s.style === "story" ? STORY_SUGGESTIONS : WRITER_SUGGESTIONS).map((q) => (
            <button
              key={q}
              type="button"
              disabled={busy !== null || !s.script}
              onClick={() => send(q)}
              className="rounded-nd-sm bg-nd-sunken px-2.5 py-1.5 text-[13px] font-medium text-nd-fg-2 hover:bg-nd-fg/[.08] disabled:opacity-50"
              title="누르면 바로 보냅니다 (AI 한 번)"
            >
              {q}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---- 지금 대본 ----------------------------------------------------------------------

function ScriptPane({
  s,
  script,
  view,
  latest,
  setView,
  onRevert,
  reverting,
}: {
  s: Session;
  script: WriterScript | null;
  view: number | null;
  latest: number | null;
  setView: (n: number | null) => void;
  onRevert: (n: number) => void;
  reverting: boolean;
}) {
  const [photoView, setPhotoView] = useState<{ n: number; url: string | null } | null>(null);
  const tl = script ? writerTimeline(script) : [];
  const older = view !== null && view !== latest;

  const openPhoto = (n: number) => {
    const p = s.photos[n];
    if (!p) return;
    setPhotoView({ n, url: null });
    shortsGet<{ dataUrl: string }>(`scripts?id=${s.id}&photo=${p.id}`)
      .then((r) => setPhotoView({ n, url: r.dataUrl }))
      .catch(() => setPhotoView({ n, url: p.thumb }));
  };

  if (!script) {
    return (
      <StudioCard title="지금 대본">
        <EmptyState compact icon={PenLine} title="아직 대본이 없습니다" description="왼쪽 대화에서 요청을 보내면 AI 가 첫 대본을 씁니다. 앞서 실패했다면 「방금 요청 다시 보내기」 를 누르세요." />
      </StudioCard>
    );
  }

  return (
    <StudioCard title="지금 대본">
      <div className="space-y-4">
        {/* 버전 */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-nd-caption font-medium text-nd-fg-2">버전</span>
            <Select className="w-auto min-w-[180px]" value={String(view ?? latest ?? "")} onChange={(e) => setView(Number(e.target.value) === latest ? null : Number(e.target.value))} aria-label="버전">
              {[...s.versions].reverse().map((v) => (
                <option key={v.n} value={v.n}>
                  버전 {v.n}
                  {v.n === latest ? " · 최신" : ""} · {v.note.slice(0, 24)}
                </option>
              ))}
            </Select>
          </label>
          {older && (
            <Button variant="secondary" icon={RotateCcw} loading={reverting} onClick={() => onRevert(view!)}>
              이 버전으로 되돌리기
            </Button>
          )}
        </div>
        {older && <StudioNotice tone="info">예전 버전(버전 {view})을 보고 있습니다 — 대화는 지금 버전(버전 {latest})을 고칩니다.</StudioNotice>}

        <div>
          <p className="text-[13px] text-nd-fg-3">
            제목 · 약 <span className="nd-num">{writerTotalSec(script)}</span>초 (목표 <span className="nd-num">{script.targetSec}</span>초) · 장면 <span className="nd-num">{script.scenes.length}</span>개
          </p>
          <h3 className="mt-0.5 text-[18px] font-bold leading-snug text-nd-fg [overflow-wrap:anywhere]">{script.title}</h3>
        </div>
        {script.hook && (
          <div className="rounded-nd-md bg-nd-accent-soft/60 px-3.5 py-2.5">
            <p className="text-[13px] font-medium text-nd-accent-strong">첫 3초 훅</p>
            <p className="mt-0.5 text-[15px] font-semibold text-nd-fg [overflow-wrap:anywhere]">{script.hook}</p>
          </div>
        )}
        {script.story && <StoryHead story={script.story} />}
        {s.basis && s.basis.kind !== "none" && (
          <p className="flex items-start gap-1.5 text-[13px] leading-relaxed text-nd-fg-2">
            <Lightbulb size={14} className="mt-[3px] shrink-0 text-nd-accent" aria-hidden />
            <span>
              <b className="font-medium text-nd-fg">
                근거 · {WRITER_REF_LABEL[s.basis.kind]} 「{s.basis.name}」
              </b>{" "}
              — {s.basis.why}
            </span>
          </p>
        )}

        <ol className="space-y-3" aria-label="장면">
          {script.scenes.map((sc, i) => {
            const lines = script.lines.filter((l) => l.scene === i);
            const kindText = sc.kind === "image" ? `사진 ${(sc.photo ?? 0) + 1}` : sc.kind === "ai" ? "AI 생성" : "직접 촬영";
            return (
              <li key={i} className="rounded-nd-md border border-nd-line px-3.5 py-3">
                <div className="flex gap-3">
                  {sc.kind === "image" && sc.photo !== null && s.photos[sc.photo] ? (
                    <button type="button" onClick={() => openPhoto(sc.photo!)} className="h-16 w-12 shrink-0 overflow-hidden rounded-nd-sm bg-nd-sunken" aria-label={`제품 사진 ${sc.photo + 1} 크게 보기`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.photos[sc.photo].thumb} alt="" className="h-full w-full object-cover" />
                    </button>
                  ) : (
                    <span className={cn("flex h-16 w-12 shrink-0 items-center justify-center rounded-nd-sm", sc.kind === "ai" ? "bg-nd-accent-soft text-nd-accent" : sc.kind === "clip" ? "bg-nd-warning-soft text-nd-warning-text" : "bg-nd-sunken text-nd-fg-3")} aria-hidden>
                      {sc.kind === "ai" ? <Wand2 size={18} /> : <Film size={18} />}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 text-[14px] font-semibold text-nd-fg [overflow-wrap:anywhere]">
                        <span className="nd-num">{two(i + 1)}</span> · {sc.label}
                      </p>
                      <Badge tone={sc.kind === "image" ? "neutral" : sc.kind === "ai" ? "accent" : "warning"} size="lg" className="shrink-0">
                        {kindText}
                      </Badge>
                    </div>
                    <p className="nd-num text-[13px] text-nd-fg-3">
                      {tl[i].from}~{tl[i].to}초
                    </p>
                    {sc.visual && <p className="mt-1 text-[13px] text-nd-fg-2 [overflow-wrap:anywhere]">화면 · {sc.visual}</p>}
                    {sc.camera && <p className="text-[13px] text-nd-fg-3 [overflow-wrap:anywhere]">카메라 · {sc.camera}</p>}
                    {sc.sound && <p className="text-[13px] text-nd-fg-3 [overflow-wrap:anywhere]">소리 · {sc.sound}</p>}
                    {sc.continuity && <p className="text-[13px] text-nd-fg-3 [overflow-wrap:anywhere]">이어짐 · {sc.continuity}</p>}
                  </div>
                </div>
                {lines.length > 0 && (
                  <div className="mt-2.5 rounded-nd-md bg-nd-sunken px-3 py-2.5">
                    <p className="text-[13px] font-semibold text-nd-fg-2">내레이션 · 자막</p>
                    <ul className="mt-1 space-y-1">
                      {lines.map((l, k) => (
                        <li key={k} className="text-nd-body text-nd-fg">
                          <span className="mr-1.5 text-[13px] font-medium text-nd-fg-3">{BEAT_LABEL[l.beat]}</span>
                          <span className="[overflow-wrap:anywhere]">{l.text}</span>
                          {l.caption && l.caption !== l.text && <span className="mt-0.5 block text-[13px] text-nd-fg-2">자막 「{l.caption}」</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {sc.aiPrompt && (
                  <details className="mt-2 text-[13px] text-nd-fg-3">
                    <summary className="cursor-pointer select-none font-medium text-nd-fg-2">AI 영상 프롬프트</summary>
                    <p className="mt-1 font-mono text-[13px] leading-relaxed [overflow-wrap:anywhere]">{sc.aiPrompt}</p>
                  </details>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <Dialog open={!!photoView} onClose={() => setPhotoView(null)} size="lg" title={photoView ? `제품 사진 ${photoView.n + 1}` : ""}>
        {photoView &&
          (photoView.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoView.url} alt={`제품 사진 ${photoView.n + 1}`} className="mx-auto max-h-[70vh] rounded-nd-md" />
          ) : (
            <Skeleton className="mx-auto h-[50vh] w-full" />
          ))}
      </Dialog>
    </StudioCard>
  );
}

/** 스토리 광고 머리 — 로그라인 · 캐치프레이즈 · 그림체 · 막 구조 */
function StoryHead({ story }: { story: NonNullable<WriterScript["story"]> }) {
  const total = Math.max(1, ...story.acts.map((a) => a.toSec));
  return (
    <div data-writer-story className="space-y-3">
      {(story.logline || story.catchphrase) && (
        <div className="rounded-nd-md bg-nd-sunken px-3.5 py-3">
          {story.logline && (
            <>
              <p className="text-[13px] font-semibold text-nd-fg-2">로그라인</p>
              <p className="text-nd-body text-nd-fg [overflow-wrap:anywhere]">{story.logline}</p>
            </>
          )}
          {story.catchphrase && (
            <>
              <p className="mt-2 text-[13px] font-semibold text-nd-fg-2">캐치프레이즈</p>
              <p className="text-[15px] font-bold text-nd-accent-strong [overflow-wrap:anywhere]">「{story.catchphrase}」</p>
            </>
          )}
          {story.look && <p className="mt-2 text-[13px] text-nd-fg-3">그림체 · {story.look}</p>}
        </div>
      )}
      {story.acts.length > 0 && (
        <div>
          <p className="text-[13px] text-nd-fg-2 [overflow-wrap:anywhere]">
            <b className="font-semibold text-nd-fg">막 구조</b> · {story.acts.map((a) => a.name).join(" → ")}
          </p>
          <div className="mt-1.5 flex h-2 gap-[2px] overflow-hidden rounded-full" aria-hidden>
            {story.acts.map((a, i) => (
              <span key={i} style={{ width: `${((a.toSec - a.fromSec) / total) * 100}%` }} className={cn("h-full", i % 2 ? "bg-nd-accent/45" : "bg-nd-accent")} />
            ))}
          </div>
          <ol className="mt-1.5 space-y-0.5">
            {story.acts.map((a, i) => (
              <li key={i} className="text-[13px] text-nd-fg-2 [overflow-wrap:anywhere]">
                <b className="font-semibold text-nd-fg">{a.name}</b>{" "}
                <span className="nd-num text-nd-fg-3">
                  {a.fromSec}~{a.toSec}초
                </span>{" "}
                · {a.summary}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// ---- 아래 칸들 ----------------------------------------------------------------------

/** 캐릭터 시트 · 엔드카드 — 영문 고정 묘사는 눌러서 복사 (모든 AI 컷 프롬프트에 그대로 들어간다) */
function CharacterCard({ story }: { story: NonNullable<WriterScript["story"]> }) {
  const toast = useToast();
  const copy = async (t: string) => {
    try {
      await navigator.clipboard.writeText(t);
      toast.success("영문 고정 묘사를 복사했습니다.");
    } catch {
      toast.error("복사하지 못했습니다.");
    }
  };
  const end = story.endCard;
  return (
    <StudioCard title="캐릭터 시트 · 엔드카드" description="같은 외형 · 의상 · 목소리를 모든 장면에 유지합니다">
      <div className="space-y-4">
        {story.characters.length > 0 ? (
          <ul className="space-y-2.5">
            {story.characters.map((c, i) => (
              <li key={i} className="min-w-0">
                <p className="inline-flex items-center gap-1.5 text-nd-body font-semibold text-nd-fg">
                  <Users size={15} aria-hidden className="text-nd-fg-3" />
                  {c.name} {c.role && <span className="text-[13px] font-normal text-nd-fg-3">· {c.role}</span>}
                </p>
                {c.look && <p className="text-[13px] text-nd-fg-2 [overflow-wrap:anywhere]">{c.look}</p>}
                {c.lookPrompt && (
                  <button type="button" onClick={() => void copy(c.lookPrompt)} className="mt-1 block w-full rounded-nd-sm bg-nd-sunken px-2.5 py-1.5 text-left font-mono text-[13px] leading-snug text-nd-fg-3 hover:text-nd-fg [overflow-wrap:anywhere]" title="눌러서 복사">
                    {c.lookPrompt}
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-nd-fg-3">등장인물이 아직 없습니다.</p>
        )}
        {(end.visual || end.text || end.cta) && (
          <div className="border-t border-nd-line pt-3">
            <p className="text-[14px] font-semibold text-nd-fg">엔드카드 (실제 제품 사진 위에)</p>
            {end.text && <p className="mt-0.5 text-[15px] font-semibold text-nd-fg [overflow-wrap:anywhere]">「{end.text}」</p>}
            {end.visual && <p className="mt-0.5 text-[13px] text-nd-fg-3 [overflow-wrap:anywhere]">화면 · {end.visual}</p>}
            {end.cta && <p className="text-[13px] text-nd-fg-3 [overflow-wrap:anywhere]">CTA · {end.cta}</p>}
          </div>
        )}
      </div>
    </StudioCard>
  );
}

/** 확인된 사실(고칠 수 있음 · 조용히 저장) · 확인할 것 · 제품 사진 */
function FactsCard({ s, onChange }: { s: Session; onChange: (s: Session) => void }) {
  const [facts, setFacts] = useState(s.facts.join("\n"));
  const [state, setState] = useState<StudioSaveState>("saved");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [photoView, setPhotoView] = useState<{ n: number; url: string | null } | null>(null);
  useEffect(() => {
    setFacts(s.facts.join("\n"));
  }, [s.facts]);
  const save = async () => {
    const next = facts
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
    if (next.join("\n") === s.facts.join("\n")) {
      setState("saved");
      return;
    }
    setState("saving");
    try {
      const r = await shortsPost<{ session: Session }>("scripts", { action: "patch", id: s.id, patch: { facts: next } });
      onChange(r.session);
      setSavedAt(Date.now());
      setState("saved");
    } catch {
      setState("error");
    }
  };
  const openPhoto = (n: number) => {
    const p = s.photos[n];
    if (!p) return;
    setPhotoView({ n, url: null });
    shortsGet<{ dataUrl: string }>(`scripts?id=${s.id}&photo=${p.id}`)
      .then((r) => setPhotoView({ n, url: r.dataUrl }))
      .catch(() => setPhotoView({ n, url: p.thumb }));
  };
  return (
    <StudioCard title="확인된 사실 · 확인할 것" description="AI 는 확인된 사실만 대본에 씁니다 — 확인할 것은 단정 문장에 넣지 않았습니다" action={<SaveIndicator state={state} savedAt={savedAt} onRetry={() => void save()} />}>
      <div className="space-y-4">
        {s.checks.length > 0 && (
          <div className="rounded-nd-md border border-nd-warning/40 bg-nd-warning-soft/50 px-3.5 py-2.5">
            <p className="mb-1 inline-flex items-center gap-1.5 text-[13px] font-semibold text-nd-warning-text">
              <TriangleAlert size={14} aria-hidden /> 올리기 전에 확인할 것
            </p>
            <ul className="space-y-0.5 text-[13px] text-nd-fg">
              {s.checks.map((c, i) => (
                <li key={i}>· {c}</li>
              ))}
            </ul>
          </div>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-nd-caption font-medium text-nd-fg-2">확인된 사실 — 한 줄에 하나 · 고치면 칸을 벗어날 때 저장되고 다음 요청부터 반영</span>
          <Textarea
            rows={Math.min(8, Math.max(3, s.facts.length + 1))}
            value={facts}
            onChange={(e) => {
              setFacts(e.target.value);
              setState("dirty");
            }}
            onBlur={() => void save()}
            disabled={state === "saving"}
            className="w-full"
          />
        </label>
        {s.photos.length > 0 && (
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-nd-fg-2">제품 사진</p>
            <div className="flex flex-wrap gap-2">
              {s.photos.map((p, i) => (
                <button key={p.id} type="button" onClick={() => openPhoto(i)} className="relative h-16 w-16 overflow-hidden rounded-nd-sm bg-nd-sunken" aria-label={`사진 ${i + 1} 크게 보기`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.thumb} alt="" className="h-full w-full object-cover" />
                  <span className="nd-num absolute left-1 top-1 rounded-[4px] bg-black/60 px-1 text-[13px] leading-tight text-white">{i + 1}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <Dialog open={!!photoView} onClose={() => setPhotoView(null)} size="lg" title={photoView ? `제품 사진 ${photoView.n + 1}` : ""}>
        {photoView &&
          (photoView.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoView.url} alt={`제품 사진 ${photoView.n + 1}`} className="mx-auto max-h-[70vh] rounded-nd-md" />
          ) : (
            <Skeleton className="mx-auto h-[50vh] w-full" />
          ))}
      </Dialog>
    </StudioCard>
  );
}

/** 게시 문구 · 행동 유도 — 전체 대본 복사 */
function PostCard({ script }: { script: WriterScript }) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(writerScriptText(script, BEAT_LABEL));
      toast.success("대본을 복사했습니다.");
    } catch {
      toast.error("복사하지 못했습니다 — 브라우저 권한을 확인해 주세요.");
    }
  };
  return (
    <StudioCard
      title="게시 문구 · 행동 유도"
      action={
        <Button size="sm" variant="secondary" icon={ClipboardCopy} onClick={() => void copy()}>
          전체 대본 복사
        </Button>
      }
    >
      <div className="space-y-2 text-nd-body">
        {script.description ? <p className="whitespace-pre-line text-nd-fg-2 [overflow-wrap:anywhere]">{script.description}</p> : <p className="text-nd-fg-3">게시 설명이 아직 없습니다.</p>}
        <p className="[overflow-wrap:anywhere]">
          <b className="font-semibold text-nd-fg">행동 유도</b> · {script.cta.wording || "—"}
          {script.cta.keyword && <span className="text-nd-fg-3"> · 키워드 「{script.cta.keyword}」</span>}
        </p>
        {script.hashtags.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 pt-1" aria-label="해시태그">
            {script.hashtags.map((h) => (
              <li key={h} className="rounded-nd-sm bg-nd-sunken px-2 py-1 text-[13px] font-medium text-nd-fg-2">
                #{h}
              </li>
            ))}
          </ul>
        )}
      </div>
    </StudioCard>
  );
}
