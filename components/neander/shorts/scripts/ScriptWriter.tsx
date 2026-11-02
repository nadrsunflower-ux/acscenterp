"use client";

// ============================================================
//  대본 작성기 — 왼쪽 내 대본 목록 · 오른쪽 (새 대본 칸 | 대화 + 지금 대본)
// ------------------------------------------------------------
//  사진은 브라우저가 1024px JPEG 로 줄여 보낸다(서버 본문 한도 4.5MB). 미리보기는 160px.
//  AI 는 「대본 만들기」 · 「보내기」 를 눌렀을 때만 부른다. 고칠 때마다 버전이 남고 되돌릴 수 있다.
//  ⚠️ 대본은 확인된 사실만 쓴다 — 가격 · 효능 · 후기를 지어내지 않게 서버 규칙이 막고, 확인할 것은 따로 보여 준다.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Bot,
  Camera,
  ClipboardCopy,
  Clapperboard,
  FilePlus2,
  Film,
  ImagePlus,
  Lightbulb,
  PenLine,
  RotateCcw,
  SendHorizontal,
  Sparkles,
  Trash2,
  TriangleAlert,
  Wand2,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  FormRow,
  Input,
  InlineNotice,
  PageHeader,
  PageShell,
  SegmentedControl,
  Select,
  Skeleton,
  Textarea,
  cn,
  useConfirm,
  useToast,
} from "@/components/neander/ui";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { shortsGet, shortsPost } from "@/lib/neander/shorts/client";
import { BEAT_LABEL } from "@/lib/neander/shorts/model";
import { krwOf } from "@/lib/neander/shorts/radar";
import {
  WRITER_KIND_LABEL,
  WRITER_LENGTHS,
  WRITER_MAX_PHOTOS,
  WRITER_REF_LABEL,
  WRITER_SUGGESTIONS,
  writerScriptText,
  writerTimeline,
  writerTotalSec,
  type ScriptSessionDoc,
  type ScriptSessionSummary,
  type WriterKind,
  type WriterRef,
  type WriterRefKind,
  type WriterScript,
} from "@/lib/neander/shorts/script-writer";
import { DEFAULT_FIN_AI_MODEL, FIN_AI_MODELS } from "@/lib/neander/ai/models";

type Session = ScriptSessionDoc & { id: string };
type TurnResult = { session: Session; error: string | null; costUsd: number };
type PhotoDraft = { name: string; dataUrl: string; thumb: string };

const won = (usd: number) => `${krwOf(usd).toLocaleString("ko-KR")}원`;
const MODEL_KEY = "neander.shorts.writerModel";

// ---- 사진 줄이기 (브라우저) -------------------------------------------------------

async function shrink(file: File, max: number, quality: number): Promise<string> {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error(`「${file.name}」 은 읽지 못하는 사진입니다 — JPG · PNG 로 다시 저장해 붙여 주세요.`);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  const g = c.getContext("2d");
  if (!g) throw new Error("사진을 줄이지 못했습니다.");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL("image/jpeg", quality);
}

async function toPhotoDrafts(files: File[], room: number): Promise<PhotoDraft[]> {
  const imgs = files.filter((f) => f.type.startsWith("image/"));
  if (!imgs.length) throw new Error("사진 파일(JPG · PNG · WEBP)만 붙일 수 있습니다.");
  if (imgs.length > room) throw new Error(`사진은 ${WRITER_MAX_PHOTOS}장까지입니다 — 지금 ${room}장 더 붙일 수 있습니다.`);
  return Promise.all(imgs.map(async (f) => ({ name: f.name.slice(0, 80), dataUrl: await shrink(f, 1024, 0.85), thumb: await shrink(f, 160, 0.7) })));
}

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
    // 세션이 바뀔 때만 다시 받는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const onSession = (s: Session) => {
    setSession(s);
    setList((l) => {
      const sum: ScriptSessionSummary = { id: s.id, title: s.title, kind: s.kind, updatedAt: s.updatedAt, createdAt: s.createdAt, costUsd: s.costUsd, projectId: s.projectId, product: s.product.name, versionCount: s.versionCount, cover: s.cover };
      return [sum, ...(l ?? []).filter((x) => x.id !== s.id)];
    });
  };

  return (
    <PageShell>
      <PageHeader
        title="대본 작성기"
        description="제품 사진 · 정보와 분석(바이럴 형식 · 성공 공식 · AI 레이더)으로 소개 영상 대본을 쓰고, 대화로 고쳐 갑니다."
        actions={
          <Button icon={FilePlus2} onClick={() => go("?new=1")}>
            새 대본
          </Button>
        }
      />
      {!aiReady && <InlineNotice tone="warning" className="mb-4">OPENROUTER_API_KEY 가 없어 AI 대본을 쓸 수 없습니다.</InlineNotice>}
      <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <SessionList list={list} error={error} selected={isNew ? null : selected} onPick={(id) => go(`?id=${id}`)} onRetry={() => void loadList()} />
        <div className="min-w-0">
          {isNew ? (
            <NewScript
              onCreated={(r) => {
                onSession(r.session);
                go(`?id=${r.session.id}`);
                if (r.error) toast.error(r.error);
              }}
            />
          ) : sessionErr ? (
            <ErrorState title="대본을 불러오지 못했습니다" description={sessionErr} action={<Button size="sm" variant="secondary" onClick={() => go("?new=1")}>새 대본</Button>} />
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
    <div className="grid gap-4 [@container(min-width:1000px)]:grid-cols-2" aria-busy="true">
      <p className="sr-only" role="status">대본을 불러오는 중…</p>
      <Skeleton className="h-[480px] rounded-nd-lg" />
      <Skeleton className="h-[480px] rounded-nd-lg" />
    </div>
  );
}

// ---- 왼쪽 목록 ------------------------------------------------------------------

function SessionList({ list, error, selected, onPick, onRetry }: { list: ScriptSessionSummary[] | null; error: string | null; selected: string | null; onPick: (id: string) => void; onRetry: () => void }) {
  return (
    <Card padding="none" className="h-fit lg:sticky lg:top-4">
      <div className="flex items-center justify-between border-b border-nd-line px-4 py-3">
        <h2 className="text-[15px] font-semibold text-nd-fg">내 대본</h2>
        {list && <span className="nd-num text-[13px] text-nd-fg-3">{list.length}개</span>}
      </div>
      {error ? (
        <div className="space-y-2 p-4 text-[13px] text-nd-warning-text">
          <p>{error}</p>
          <Button size="sm" variant="secondary" onClick={onRetry}>다시 시도</Button>
        </div>
      ) : !list ? (
        <div className="space-y-2 p-3">
          {[0, 1, 2].map((k) => (
            <Skeleton key={k} className="h-14 w-full" />
          ))}
        </div>
      ) : !list.length ? (
        <p className="p-4 text-[13px] leading-relaxed text-nd-fg-3">아직 대본이 없습니다. 오른쪽에서 제품 정보를 넣고 첫 대본을 만들어 보세요. 대본은 나만 봅니다.</p>
      ) : (
        <ul className="max-h-[70vh] overflow-y-auto p-1.5 nd-scroll">
          {list.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                onClick={() => onPick(x.id)}
                aria-current={x.id === selected ? "true" : undefined}
                className={cn("flex w-full items-center gap-2.5 rounded-nd-md px-2.5 py-2 text-left transition-colors", x.id === selected ? "bg-nd-accent-soft" : "hover:bg-nd-fg/[.04]")}
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-nd-sm bg-nd-fg/[.06] text-nd-fg-3">
                  {x.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={x.cover} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <PenLine size={16} aria-hidden />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-nd-body font-medium text-nd-fg" title={x.title}>{x.title}</span>
                  <span className="block truncate text-[13px] text-nd-fg-3">
                    {x.versionCount ? `v${x.versionCount}` : "대본 전"} · {fmtWhen(x.updatedAt)}
                    {x.projectId ? " · 영상 있음" : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---- 새 대본 -------------------------------------------------------------------

function ModelSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select size="sm" value={value} onChange={(e) => onChange(e.target.value)} aria-label="AI 모델">
      {FIN_AI_MODELS.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
          {m.note ? ` — ${m.note}` : ""}
        </option>
      ))}
    </Select>
  );
}

function useModel(): [string, (v: string) => void] {
  const [m, setM] = useState(DEFAULT_FIN_AI_MODEL);
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(MODEL_KEY);
      if (v && FIN_AI_MODELS.some((x) => x.id === v)) setM(v);
    } catch {
      /* 기본값 */
    }
  }, []);
  return [
    m,
    (v: string) => {
      setM(v);
      try {
        window.localStorage.setItem(MODEL_KEY, v);
      } catch {
        /* 기억 못 해도 고른 값은 쓴다 */
      }
    },
  ];
}

function PhotoPicker({ photos, setPhotos, room }: { photos: PhotoDraft[]; setPhotos: (p: PhotoDraft[]) => void; room: number }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const add = async (files: File[]) => {
    setBusy(true);
    try {
      setPhotos([...photos, ...(await toPhotoDrafts(files, room - photos.length))]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "사진을 붙이지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void add([...e.dataTransfer.files]);
      }}
      className="flex flex-wrap items-center gap-2 rounded-nd-md border border-dashed border-nd-border p-2.5"
    >
      {photos.map((p, i) => (
        <span key={i} className="group relative h-20 w-20 overflow-hidden rounded-nd-sm bg-nd-fg/[.06]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.thumb} alt={p.name} className="h-full w-full object-cover" />
          <span className="nd-num absolute left-1 top-1 rounded-[4px] bg-black/60 px-1 text-[12px] text-white">{i + 1}</span>
          <button type="button" aria-label={`사진 ${i + 1} 빼기`} onClick={() => setPhotos(photos.filter((_, k) => k !== i))} className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white">
            <X size={13} aria-hidden />
          </button>
        </span>
      ))}
      {photos.length < room && (
        <button type="button" onClick={() => input.current?.click()} disabled={busy} className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-nd-sm bg-nd-sunken text-[13px] text-nd-fg-2 hover:bg-nd-fg/[.06]">
          <ImagePlus size={18} aria-hidden />
          {busy ? "줄이는 중…" : "사진 붙이기"}
        </button>
      )}
      <span className="text-[13px] text-nd-fg-3">
        {photos.length}/{room}장 · 끌어 놓아도 됩니다 · 브라우저가 1024px 로 줄여 보냅니다
      </span>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        onChange={(e) => {
          void add([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function NewScript({ onCreated }: { onCreated: (r: TurnResult) => void }) {
  const { data } = useShorts();
  const clients = data?.clients ?? [];
  const { busy, run } = useAction();
  const [model, setModel] = useModel();
  const [refs, setRefs] = useState<WriterRef[] | null>(null);
  const [f, setF] = useState({ name: "", info: "", kind: "coupang" as WriterKind, clientId: "", cta: "", targetSec: 30, ref: "auto", message: "" });
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  useEffect(() => {
    shortsGet<{ refs: WriterRef[] }>("scripts?refs=1")
      .then((r) => setRefs(r.refs))
      .catch(() => setRefs([]));
  }, []);
  const refOf = (v: string) => (v === "auto" ? null : refs?.find((r) => `${r.kind}:${r.id}` === v) ?? null);
  const groups: [Exclude<WriterRefKind, "auto">, string][] = [
    ["format", "바이럴 형식 카드"],
    ["template", "성공 공식"],
    ["radar", "AI 레이더 후보"],
  ];
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
      });
      onCreated(r);
    });

  return (
    <Card className="space-y-5">
      <div>
        <h2 className="text-[17px] font-bold text-nd-fg">새 대본</h2>
        <p className="mt-1 text-nd-body text-nd-fg-2">
          제품 사진과 정보를 넣으면 AI 가 분석해 둔 형식 · 공식을 바탕으로 소개 영상 대본을 씁니다. 다 쓴 뒤에는 오른쪽 대화로 「훅을 더 세게」 처럼 고쳐 가세요.
        </p>
      </div>
      <FormRow className="grid-cols-1 md:grid-cols-[2fr_1fr]">
        <Field label="제품 이름" required>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="예: 다이소 실리콘 싱크대 물막이" maxLength={120} />
        </Field>
        <Field label="길이">
          <SegmentedControl
            ariaLabel="길이"
            value={String(f.targetSec)}
            onChange={(v) => setF({ ...f, targetSec: Number(v) })}
            options={WRITER_LENGTHS.map((n) => ({ value: String(n), label: `${n}초` }))}
          />
        </Field>
      </FormRow>
      <Field label="제품 정보 — 확인된 사실만 (특징 · 크기 · 가격 · 사용법 · 누구에게)">
        <Textarea
          rows={4}
          value={f.info}
          onChange={(e) => setF({ ...f, info: e.target.value })}
          maxLength={3000}
          placeholder={"예: 접으면 2cm · 싱크대 가장자리에 흡착 · 3,000원(다이소) · 실리콘이라 물에 강함\n여기 적지 않은 가격 · 효능은 대본에 쓰지 않습니다."}
        />
      </Field>
      <Field label={`제품 사진 (최대 ${WRITER_MAX_PHOTOS}장 — AI 가 보고 외형 · 구성을 읽습니다)`}>
        <PhotoPicker photos={photos} setPhotos={setPhotos} room={WRITER_MAX_PHOTOS} />
      </Field>
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
        {f.kind === "brand" ? (
          <Field label="고객사 (브리프 · 금지 표현을 따릅니다)">
            <Select value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })}>
              <option value="">고르기…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : f.kind === "coupang" ? (
          <Field label="댓글 키워드 (CTA)">
            <Input value={f.cta} onChange={(e) => setF({ ...f, cta: e.target.value })} placeholder="예: 물막이" maxLength={30} />
          </Field>
        ) : (
          <div />
        )}
      </FormRow>
      <Field label="참고할 분석 — 구성 · 훅 방식 · 리듬을 옮깁니다 (문장은 베끼지 않음)">
        <Select value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} disabled={!refs}>
          <option value="auto">{refs ? `AI 가 고르기 — 형식 카드 · 성공 공식 · 레이더 후보 중 이 제품에 맞는 것` : "분석 목록을 불러오는 중…"}</option>
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
      <Field label="처음 요청 (선택)">
        <Textarea rows={2} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} maxLength={2000} placeholder="예: 자취하는 20대 대상 · 반전으로 시작 · 말 없이 자막만" />
      </Field>
      <div className="flex flex-wrap items-center gap-3 border-t border-nd-line pt-4">
        <Button icon={Sparkles} loading={busy === "make"} disabled={!canMake || busy !== null} onClick={make}>
          {busy === "make" ? "AI 가 대본을 쓰는 중… (10~60초)" : "대본 만들기"}
        </Button>
        <div className="w-[min(320px,100%)]">
          <ModelSelect value={model} onChange={setModel} />
        </div>
        <span className="text-[13px] text-nd-fg-3">한 번에 20초 안팎 · Gemini Flash 는 약 15원(사진 포함), Claude 는 그보다 비쌉니다 — 쓴 비용은 대화마다 적힙니다.</span>
      </div>
    </Card>
  );
}

// ---- 세션 (대화 + 지금 대본) -----------------------------------------------------

function SessionView({ s, onChange, onDeleted }: { s: Session; onChange: (s: Session) => void; onDeleted: () => void }) {
  const toast = useToast();
  const ask = useConfirm();
  const router = useRouter();
  const { busy, run } = useAction();
  const [view, setView] = useState<number | null>(null); // 보고 있는 버전 (null = 지금)
  const shown = view === null ? s.script : (s.versions.find((v) => v.n === view)?.script ?? s.script);

  const post = async <T,>(action: string, body: object) => shortsPost<T>("scripts", { action, id: s.id, ...body });
  const del = async () => {
    if (!(await ask({ title: "이 대본을 지울까요?", message: "대화 · 버전 · 사진이 모두 지워집니다. 만든 영상은 그대로 남습니다.", confirmLabel: "지우기", tone: "danger" }))) return;
    void run("del", async () => {
      await post("delete", {});
      onDeleted();
    }, "대본을 지웠습니다.");
  };
  const toProject = () =>
    void run("proj", async () => {
      const r = await post<{ projectId: string; created: boolean }>("toProject", {});
      onChange({ ...s, projectId: r.projectId });
      toast.success(r.created ? "이 대본으로 영상을 만들었습니다." : "이미 만든 영상을 엽니다.");
      router.push(`/neander/shorts/projects/${r.projectId}`);
    });

  return (
    <div className="space-y-4 [container-type:inline-size]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-[20px] font-bold text-nd-fg" title={s.title}>{s.title}</h2>
          <p className="text-[13px] text-nd-fg-3">
            {WRITER_KIND_LABEL[s.kind]} · 만든 날 {fmtWhen(s.createdAt)} · AI 비용 합 {won(s.costUsd)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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
      <div className="grid items-start gap-4 [@container(min-width:760px)]:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <ChatPane s={s} onChange={onChange} onViewVersion={setView} />
        <ScriptPane s={s} script={shown} view={view} setView={setView} onChange={onChange} />
      </div>
    </div>
  );
}

function ChatPane({ s, onChange, onViewVersion }: { s: Session; onChange: (s: Session) => void; onViewVersion: (n: number | null) => void }) {
  const toast = useToast();
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

  return (
    <Card padding="none" className="flex min-h-[520px] flex-col [@container(min-width:760px)]:sticky [@container(min-width:760px)]:top-4 [@container(min-width:760px)]:h-[calc(100vh-140px)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-nd-line px-4 py-2.5">
        <h3 className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-nd-fg">
          <Bot size={16} className="text-nd-accent" aria-hidden /> 대화로 고치기
        </h3>
        <div className="w-[min(260px,100%)]">
          <ModelSelect value={model} onChange={setModel} />
        </div>
      </div>
      <div ref={list} className="nd-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite">
        {s.messages.length === 0 && <p className="text-[13px] text-nd-fg-3">아직 대화가 없습니다.</p>}
        {s.messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-8 rounded-nd-md bg-nd-accent-soft px-3 py-2 text-nd-body text-nd-fg">
              <p className="whitespace-pre-line [overflow-wrap:anywhere]">{m.text}</p>
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
            </div>
          ) : (
            <div key={i} className={cn("mr-6 rounded-nd-md px-3 py-2 text-nd-body", m.error ? "bg-nd-danger-soft text-nd-danger-text" : "bg-nd-sunken text-nd-fg")}>
              <p className="whitespace-pre-line [overflow-wrap:anywhere]">{m.error ? `${m.text} — ${m.error}` : m.text}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-nd-fg-3">
                {m.version && (
                  <button type="button" className="font-medium text-nd-accent hover:underline" onClick={() => onViewVersion(m.version ?? null)}>
                    v{m.version} 보기
                  </button>
                )}
                {m.model && <span>{FIN_AI_MODELS.find((x) => x.id === m.model)?.label ?? m.model}</span>}
                {m.costUsd !== undefined && <span className="nd-num">{won(m.costUsd)}</span>}
                <span>{fmtWhen(m.at)}</span>
              </p>
            </div>
          ),
        )}
        {busy === "send" && (
          <div className="mr-6 inline-flex items-center gap-2 rounded-nd-md bg-nd-sunken px-3 py-2 text-nd-body text-nd-fg-2" role="status">
            <Sparkles size={15} className="animate-pulse text-nd-accent" aria-hidden />
            AI 가 대본을 고치는 중… (10~60초)
          </div>
        )}
      </div>
      <div className="space-y-2 border-t border-nd-line px-4 py-3">
        {lastFailed && !busy && (
          <Button size="sm" variant="secondary" icon={RotateCcw} onClick={() => send(s.messages.filter((m) => m.role === "user").at(-1)?.text ?? "")}>
            방금 요청 다시 보내기
          </Button>
        )}
        <div className="flex flex-wrap gap-1.5">
          {WRITER_SUGGESTIONS.map((q) => (
            <button key={q} type="button" disabled={busy !== null || !s.script} onClick={() => send(q)} className="rounded-full border border-nd-border bg-nd-content px-2.5 py-1 text-[13px] text-nd-fg-2 hover:bg-nd-sunken disabled:opacity-50">
              {q}
            </button>
          ))}
        </div>
        {attach && <PhotoPicker photos={photos} setPhotos={setPhotos} room={room} />}
        <div className="flex items-end gap-2">
          <Textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            maxLength={2000}
            disabled={busy !== null}
            placeholder={s.script ? "어떻게 고칠까요? (Enter 보내기 · Shift+Enter 줄바꿈)" : "처음 대본을 다시 부탁해 보세요"}
            className="min-w-0 flex-1"
            aria-label="요청"
          />
          <div className="flex flex-col gap-1.5">
            <Button variant="ghost" size="sm" icon={Camera} aria-label="사진 붙이기" title={room ? `사진 붙이기 (${room}장 더)` : "사진은 4장까지입니다"} disabled={!room || busy !== null} onClick={() => setAttach(!attach)} />
            <Button size="sm" icon={SendHorizontal} aria-label="보내기" loading={busy === "send"} disabled={(!text.trim() && !photos.length) || busy !== null} onClick={() => send()} />
          </div>
        </div>
      </div>
    </Card>
  );
}

function ScriptPane({ s, script, view, setView, onChange }: { s: Session; script: WriterScript | null; view: number | null; setView: (n: number | null) => void; onChange: (s: Session) => void }) {
  const toast = useToast();
  const { busy, run } = useAction();
  const [photoView, setPhotoView] = useState<{ n: number; url: string | null } | null>(null);
  const [facts, setFacts] = useState(s.facts.join("\n"));
  useEffect(() => setFacts(s.facts.join("\n")), [s.facts]);
  const latest = s.versions.at(-1)?.n ?? null;
  const tl = script ? writerTimeline(script) : [];

  const openPhoto = (n: number) => {
    const p = s.photos[n];
    if (!p) return;
    setPhotoView({ n, url: null });
    shortsGet<{ dataUrl: string }>(`scripts?id=${s.id}&photo=${p.id}`)
      .then((r) => setPhotoView({ n, url: r.dataUrl }))
      .catch(() => setPhotoView({ n, url: p.thumb }));
  };
  const copy = async () => {
    if (!script) return;
    try {
      await navigator.clipboard.writeText(writerScriptText(script, BEAT_LABEL));
      toast.success("대본을 복사했습니다.");
    } catch {
      toast.error("복사하지 못했습니다 — 브라우저 권한을 확인해 주세요.");
    }
  };
  const saveFacts = () => {
    const next = facts.split("\n").map((x) => x.trim()).filter(Boolean);
    if (next.join("\n") === s.facts.join("\n")) return;
    void run("facts", async () => {
      const r = await shortsPost<{ session: Session }>("scripts", { action: "patch", id: s.id, patch: { facts: next } });
      onChange(r.session);
    }, "확인된 사실을 고쳤습니다 — 다음 요청부터 AI 가 이것을 따릅니다.");
  };
  const revert = (n: number) =>
    void run("rev", async () => {
      const r = await shortsPost<{ session: Session }>("scripts", { action: "revert", id: s.id, n });
      onChange(r.session);
      setView(null);
    }, `v${n} 으로 되돌렸습니다.`);

  if (!script) {
    return (
      <Card>
        <EmptyState compact icon={PenLine} title="아직 대본이 없습니다" description="왼쪽 대화에서 요청을 보내면 AI 가 첫 대본을 씁니다. 앞서 실패했다면 「방금 요청 다시 보내기」 를 누르세요." />
      </Card>
    );
  }

  return (
    <Card padding="none" className="min-w-0">
      {/* 버전 · 복사 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-nd-line px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Select size="sm" className="w-auto" value={String(view ?? latest ?? "")} onChange={(e) => setView(Number(e.target.value) === latest ? null : Number(e.target.value))} aria-label="버전">
            {[...s.versions].reverse().map((v) => (
              <option key={v.n} value={v.n}>
                v{v.n}
                {v.n === latest ? " (지금)" : ""} · {v.note.slice(0, 24)}
              </option>
            ))}
          </Select>
          {view !== null && view !== latest && (
            <Button size="sm" variant="secondary" icon={RotateCcw} loading={busy === "rev"} onClick={() => revert(view)}>
              이 버전으로 되돌리기
            </Button>
          )}
        </div>
        <Button size="sm" variant="ghost" icon={ClipboardCopy} onClick={() => void copy()}>
          글로 복사
        </Button>
      </div>

      <div className="space-y-4 px-4 py-4">
        {view !== null && view !== latest && <InlineNotice tone="info">예전 버전(v{view})을 보고 있습니다 — 대화는 지금 버전(v{latest})을 고칩니다.</InlineNotice>}
        <div>
          <p className="text-[13px] text-nd-fg-3">
            제목 · 약 <span className="nd-num">{writerTotalSec(script)}</span>초 (목표 {script.targetSec}초) · 장면 {script.scenes.length}개
          </p>
          <h3 className="mt-0.5 text-[18px] font-bold leading-snug text-nd-fg [overflow-wrap:anywhere]">{script.title}</h3>
        </div>
        {script.hook && (
          <div className="rounded-nd-md bg-nd-accent-soft/60 px-3 py-2.5">
            <p className="text-[13px] font-medium text-nd-accent-strong">첫 3초 훅</p>
            <p className="mt-0.5 text-[15px] font-semibold text-nd-fg [overflow-wrap:anywhere]">{script.hook}</p>
          </div>
        )}
        {s.basis && s.basis.kind !== "none" && (
          <p className="flex items-start gap-1.5 text-[13px] leading-relaxed text-nd-fg-2">
            <Lightbulb size={14} className="mt-[3px] shrink-0 text-nd-accent" aria-hidden />
            <span>
              <b className="font-medium text-nd-fg">근거 · {WRITER_REF_LABEL[s.basis.kind]} 「{s.basis.name}」</b> — {s.basis.why}
            </span>
          </p>
        )}

        <ol className="space-y-2.5" aria-label="장면">
          {script.scenes.map((sc, i) => {
            const lines = script.lines.filter((l) => l.scene === i);
            return (
              <li key={i} className="rounded-nd-md border border-nd-line p-3">
                <div className="flex gap-3">
                  {sc.kind === "image" && sc.photo !== null && s.photos[sc.photo] ? (
                    <button type="button" onClick={() => openPhoto(sc.photo!)} className="h-[72px] w-[54px] shrink-0 overflow-hidden rounded-nd-sm bg-nd-fg/[.06]" aria-label={`제품 사진 ${sc.photo + 1} 크게 보기`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.photos[sc.photo].thumb} alt="" className="h-full w-full object-cover" />
                    </button>
                  ) : (
                    <span className={cn("flex h-[72px] w-[54px] shrink-0 items-center justify-center rounded-nd-sm", sc.kind === "ai" ? "bg-nd-accent-soft text-nd-accent" : "bg-nd-warning-soft text-nd-warning-text")} aria-hidden>
                      {sc.kind === "ai" ? <Wand2 size={18} /> : <Film size={18} />}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="nd-num text-[13px] font-semibold text-nd-fg-2">
                        {i + 1} · {tl[i].from}~{tl[i].to}초
                      </span>
                      <Badge tone={sc.kind === "image" ? "success" : sc.kind === "ai" ? "accent" : "warning"} size="sm">
                        {sc.kind === "image" ? `제품 사진 ${(sc.photo ?? 0) + 1}` : sc.kind === "ai" ? "AI 생성" : "직접 촬영"}
                      </Badge>
                      <span className="min-w-0 text-nd-body font-medium text-nd-fg [overflow-wrap:anywhere]">{sc.label}</span>
                    </div>
                    {sc.visual && <p className="mt-1 text-[13px] text-nd-fg-3 [overflow-wrap:anywhere]">화면 · {sc.visual}</p>}
                    <ul className="mt-1.5 space-y-1">
                      {lines.map((l, k) => (
                        <li key={k} className="text-nd-body text-nd-fg">
                          <span className="mr-1.5 text-[13px] font-medium text-nd-fg-3">{BEAT_LABEL[l.beat]}</span>
                          <span className="[overflow-wrap:anywhere]">{l.text}</span>
                          {l.caption && l.caption !== l.text && <span className="mt-0.5 block text-[13px] text-nd-fg-2">자막 「{l.caption}」</span>}
                        </li>
                      ))}
                    </ul>
                    {sc.aiPrompt && (
                      <details className="mt-1.5 text-[13px] text-nd-fg-3">
                        <summary className="cursor-pointer select-none font-medium text-nd-fg-2">AI 영상 프롬프트</summary>
                        <p className="mt-1 font-mono text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">{sc.aiPrompt}</p>
                      </details>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="space-y-1.5 rounded-nd-md bg-nd-sunken px-3 py-2.5 text-nd-body">
          <p>
            <span className="text-[13px] font-medium text-nd-fg-3">CTA </span>
            {script.cta.wording || "—"}
            {script.cta.keyword && <span className="text-nd-fg-3"> · 키워드 「{script.cta.keyword}」</span>}
          </p>
          {script.description && <p className="whitespace-pre-line text-[13px] text-nd-fg-2 [overflow-wrap:anywhere]">{script.description}</p>}
          {script.hashtags.length > 0 && <p className="text-[13px] text-nd-accent-strong [overflow-wrap:anywhere]">{script.hashtags.map((h) => `#${h}`).join(" ")}</p>}
        </div>

        {s.checks.length > 0 && (
          <div className="rounded-nd-md border border-nd-warning/40 bg-nd-warning-soft/50 px-3 py-2.5">
            <p className="mb-1 inline-flex items-center gap-1 text-[13px] font-semibold text-nd-warning-text">
              <TriangleAlert size={14} aria-hidden /> 올리기 전에 확인할 것
            </p>
            <ul className="space-y-0.5 text-[13px] text-nd-fg">
              {s.checks.map((c, i) => (
                <li key={i}>· {c}</li>
              ))}
            </ul>
          </div>
        )}

        <Field label="확인된 사실 — AI 는 이것만 대본에 씁니다 (한 줄에 하나 · 고치면 다음 요청부터 반영)">
          <Textarea rows={Math.min(8, Math.max(3, s.facts.length + 1))} value={facts} onChange={(e) => setFacts(e.target.value)} onBlur={saveFacts} disabled={busy === "facts"} />
        </Field>

        {s.photos.length > 0 && (
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-nd-fg-2">제품 사진</p>
            <div className="flex flex-wrap gap-2">
              {s.photos.map((p, i) => (
                <button key={p.id} type="button" onClick={() => openPhoto(i)} className="relative h-16 w-16 overflow-hidden rounded-nd-sm bg-nd-fg/[.06]" aria-label={`사진 ${i + 1} 크게 보기`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.thumb} alt="" className="h-full w-full object-cover" />
                  <span className="nd-num absolute left-1 top-1 rounded-[4px] bg-black/60 px-1 text-[12px] text-white">{i + 1}</span>
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
    </Card>
  );
}

