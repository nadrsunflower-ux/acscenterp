"use client";

// ============================================================
//  고객사 영상 검토 — 로그인 없이 링크로 여는 화면
// ------------------------------------------------------------
//  토큰 하나로 영상 한 편만 받고(api/neander/shorts/review), 그 회차에 한 번만 답한다.
//  ERP 의 다른 자료 · 로그인 · 셸을 쓰지 않는다 (Providers 의 isPublicPath).
//  계약상 수정 횟수를 다 쓰면 「추가 수정 요청 (계약 범위 밖)」 으로 바뀐다 — 막지 않고 알린다.
//  고객은 주로 휴대폰으로 연다 — 좁은 화면은 한 줄(영상 → 답하기 → 지난 회차),
//  넓은 화면은 영상 왼쪽 · 답하기 오른쪽.
//
//  2026-11 목업 개편: 맨 위 「NEANDER · 영상 검토 · 고객 전용」 머리 · 「○○을 확인해 주세요」 제목 ·
//  답하기 칸 안에 남은 수정 횟수 상자 · 「지난 회차」(첫 회차면 빈 상태) · 「다른 자료는 보이지 않아요」.
//  상한을 넘은 요청은 「추가 수정 요청 · 계약 범위 밖」 창에서 협의 안내 · 앞선 검토와 함께 받는다.
// ============================================================

import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { CircleAlert, CircleCheck, Clock, Film, History, Info as InfoIcon, Link2Off, MessageSquare, PenLine, Send, ShieldCheck, TriangleAlert } from "lucide-react";
import { Badge, Button, Dialog, Field, Input, Spinner, Textarea, cn, toneCls, type Tone } from "@/components/neander/ui";

interface Info {
  clientName: string;
  title: string;
  round: number;
  latest: boolean;
  decision: "pending" | "approved" | "revision" | "withdrawn";
  feedback: string;
  media: { size: number; type: string; duration: number | null; parts: number; url?: string | null; purged?: boolean };
  revisionLimit: number;
  revisionsUsed: number;
  history: { n: number; decision: string; feedback: string; decidedAt: number | null }[];
  expiresAt: number;
}

/** 불러오기 실패 — HTTP 상태로 「만료」 · 「없음」 을 가른다 */
class LoadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function readErr(res: Response) {
  try {
    return ((await res.json()) as { error?: string }).error ?? `요청이 실패했습니다 (HTTP ${res.status})`;
  } catch {
    return `요청이 실패했습니다 (HTTP ${res.status})`;
  }
}

/** 한국 날짜 — 2026-11-10 */
const fmtDate = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);
/** 짧은 날짜 — 11/3 */
const fmtShort = (ms: number) => {
  const d = new Date(ms + 9 * 3600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};

/** 「선반 2편을」 · 「욕실 컷를」 — 끝 글자 받침으로 을/를. 판단할 수 없으면 null */
function objectJosa(word: string): string | null {
  const last = word.trim().slice(-1);
  if (!last) return null;
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 ? "을" : "를";
  // 숫자는 읽는 소리로 (0 영 · 1 일 · 2 이 · 3 삼 · 4 사 · 5 오 · 6 육 · 7 칠 · 8 팔 · 9 구)
  if (/[0-9]/.test(last)) return "013678".includes(last) ? "을" : "를";
  return null;
}

const DECISION_LABEL: Record<string, { text: string; tone: Tone }> = {
  approved: { text: "승인", tone: "success" },
  revision: { text: "수정 요청", tone: "danger" },
  pending: { text: "답 없음", tone: "neutral" },
};

/** 영상 크기 — 폭 380px 까지, 세로가 창을 넘지 않게 (9:16) */
const VIDEO_BOX = "aspect-[9/16] min-w-[220px]";
const VIDEO_STYLE = { width: "min(100%, 380px, calc((100svh - 150px) * 9 / 16))" };

/** 창(Dialog)은 body 로 올라간다 — 이 화면에 있는 동안 body 에도 13px 글씨 범위를 켠다 */
function useComfortableBody() {
  useEffect(() => {
    const b = document.body;
    const prev = b.dataset.ndText;
    b.dataset.ndText = "comfortable";
    return () => {
      if (prev === undefined) delete b.dataset.ndText;
      else b.dataset.ndText = prev;
    };
  }, []);
}

export default function ReviewPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<Info | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; status: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [video, setVideo] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(0);
  const [name, setName] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);
  useComfortableBody();

  useEffect(() => {
    let url: string | null = null;
    (async () => {
      const res = await fetch(`/api/neander/shorts/review?token=${encodeURIComponent(token)}`, { cache: "no-store" });
      if (!res.ok) throw new LoadError(await readErr(res), res.status);
      const i = ((await res.json()) as { review: Info }).review;
      setInfo(i);
      if (i.media.purged) throw new LoadError("게시가 끝나 검토용 영상 파일을 정리했습니다. 게시된 영상으로 확인해 주세요.", 0);
      // 저장소에 있는 큰 파일 — 만료되는 주소로 바로 재생한다 (조각으로 받지 않는다)
      if (i.media.url) {
        setLoaded(1);
        setVideo(i.media.url);
        return;
      }
      const chunks: ArrayBuffer[] = [];
      for (let from = 0; from < i.media.parts; from += 5) {
        const r = await fetch(`/api/neander/shorts/review?token=${encodeURIComponent(token)}&from=${from}&count=5`, { cache: "no-store" });
        if (!r.ok) throw new LoadError(await readErr(r), r.status);
        chunks.push(await r.arrayBuffer());
        setLoaded(Math.min(1, (from + 5) / i.media.parts));
      }
      url = URL.createObjectURL(new Blob(chunks, { type: i.media.type }));
      setVideo(url);
    })().catch((e) =>
      setLoadError({ message: e instanceof Error ? e.message : "영상을 불러오지 못했습니다.", status: e instanceof LoadError ? e.status : 0 }),
    );
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [token]);

  const answer = async (decision: "approved" | "revision") => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/neander/shorts/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, decision, feedback, name }),
      });
      if (!res.ok) throw new Error(await readErr(res));
      setInfo(((await res.json()) as { review: Info }).review);
      setExtraOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "보내지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  // 링크 자체를 못 연 경우 — 만료 · 없음 · 지운 영상
  if (!info && loadError) {
    const expired = loadError.status === 410;
    return (
      <main data-nd-text="comfortable" className="min-h-screen bg-nd-page">
        <ReviewTop />
        <div className="flex items-center justify-center px-4 py-16">
          <div className="nd-surface w-full max-w-md rounded-nd-lg px-6 py-8 text-center">
            <span className={cn("mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full", expired ? "bg-nd-warning-soft text-nd-warning-text" : "bg-nd-danger-soft text-nd-danger-text")}>
              {expired ? <Clock size={22} aria-hidden /> : <Link2Off size={22} aria-hidden />}
            </span>
            <h1 className="text-[20px] font-semibold text-nd-fg">{expired ? "검토 링크가 만료됐습니다" : "검토 링크를 열 수 없습니다"}</h1>
            <p role="alert" className="mt-3 text-nd-body leading-relaxed text-nd-fg-2">{loadError.message}</p>
            <p className="mt-4 text-[13px] text-nd-fg-3">문의는 영상을 보낸 담당자에게 전달해 주세요.</p>
          </div>
        </div>
      </main>
    );
  }

  const over = info ? info.revisionsUsed >= info.revisionLimit : false;
  const left = info ? Math.max(0, info.revisionLimit - info.revisionsUsed) : 0;
  const stale = !!info && (!info.latest || info.decision === "withdrawn");
  // 버튼이 왜 아직 안 눌리는지 — 승인은 이름 + 영상, 수정 요청은 이름 + 수정할 점
  const waitHint = [
    !video ? "영상을 다 받으면 승인할 수 있습니다." : !name.trim() ? "이름을 적으면 승인할 수 있습니다." : "",
    !over && (!name.trim() || !feedback.trim()) ? "수정 요청은 이름과 수정할 내용을 모두 적어야 보낼 수 있습니다." : "",
  ]
    .filter(Boolean)
    .join(" ");
  const status: { tone: Tone; label: string } | null = !info
    ? null
    : stale
      ? { tone: "neutral", label: "지난 링크" }
      : info.decision === "approved"
        ? { tone: "success", label: "승인함" }
        : info.decision === "revision"
          ? { tone: "danger", label: "수정 요청함" }
          : { tone: "warning", label: "답변 대기" };
  const josa = info ? objectJosa(info.title) : null;
  const heading = !info ? "불러오는 중…" : josa ? `${info.title}${josa} 확인해 주세요` : `「${info.title}」 확인을 부탁드립니다`;
  const meta = info ? [`${info.round}차 검토`, `링크 만료 ${fmtDate(info.expiresAt)}`, info.media.duration ? `${Math.round(info.media.duration)}초` : ""].filter(Boolean) : [];

  return (
    <main data-nd-text="comfortable" className="min-h-screen bg-nd-page">
      <ReviewTop />
      <div className="mx-auto w-full max-w-[1280px] px-4 pb-10 pt-6 sm:px-8 sm:pt-8">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-2 sm:mb-8">
          <div className="min-w-0">
            {info && <p className="text-[14px] text-nd-fg-2">{info.clientName}</p>}
            <h1 className="mt-1 min-w-0 break-words text-[24px] font-bold leading-snug tracking-[-0.01em] text-nd-fg sm:text-[30px]">{heading}</h1>
            {meta.length > 0 && <p className="nd-num mt-2 text-[14px] text-nd-fg-2">{meta.join(" · ")}</p>}
          </div>
          {status && (
            <Badge tone={status.tone} size="lg">
              {status.label}
            </Badge>
          )}
        </header>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-10">
          {/* 영상 — 이 화면의 주인공 */}
          <div className="flex justify-center lg:sticky lg:top-6">
            {video ? (
              <video src={video} controls playsInline style={VIDEO_STYLE} className={cn(VIDEO_BOX, "rounded-nd-lg bg-black object-contain shadow-lg")} />
            ) : (
              <div style={VIDEO_STYLE} className={cn(VIDEO_BOX, "flex flex-col items-center justify-center gap-3 rounded-nd-lg border border-nd-line bg-nd-sunken px-6 text-center")}>
                {loadError ? (
                  <>
                    <CircleAlert size={24} aria-hidden className="text-nd-danger" />
                    <p className="text-nd-body text-nd-fg-2">영상을 받지 못했습니다</p>
                  </>
                ) : (
                  <>
                    {info ? <Film size={24} aria-hidden className="text-nd-fg-3" /> : <Spinner size={24} />}
                    <p className="text-nd-body text-nd-fg-2">{info ? `영상 받는 중 ${Math.round(loaded * 100)}%` : "불러오는 중…"}</p>
                    {info && (
                      <div className="h-1.5 w-40 overflow-hidden rounded-full bg-nd-fg/10" role="progressbar" aria-label="영상 받는 중" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(loaded * 100)}>
                        <div className="h-full rounded-full bg-nd-accent transition-[width]" style={{ width: `${Math.round(loaded * 100)}%` }} />
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-4">
            {loadError && (
              <p role="alert" className="flex items-start gap-2 rounded-nd-md bg-nd-danger-soft px-4 py-3 text-nd-body text-nd-danger-text">
                <CircleAlert size={16} aria-hidden className="mt-0.5 shrink-0" />
                <span>{loadError.message}</span>
              </p>
            )}

            {info && (
              <Panel title={stale || info.decision !== "pending" ? "검토 결과" : "검토 결과 보내기"}>
                {stale ? (
                  <Answered icon={Link2Off} tone="neutral">
                    이 링크보다 새 검토 영상이 있습니다. 담당자가 보낸 가장 최근 링크로 확인해 주세요.
                  </Answered>
                ) : info.decision !== "pending" ? (
                  <Answered icon={info.decision === "approved" ? CircleCheck : PenLine} tone={info.decision === "approved" ? "success" : "info"} quote={info.feedback}>
                    {info.decision === "approved" ? "승인해 주셔서 감사합니다. 이 영상으로 게시를 준비합니다." : "수정 요청을 받았습니다. 고친 영상을 새 링크로 보내 드리겠습니다."}
                  </Answered>
                ) : (
                  <div className="space-y-4">
                    <p className="text-nd-body leading-relaxed text-nd-fg-2">영상을 확인한 뒤 승인하거나 바꿀 점을 적어 주세요. 이 링크에서는 이번 회차에 한 번 답할 수 있습니다.</p>
                    <Field label="답변하는 분의 이름" required>
                      <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="이름" />
                    </Field>
                    <Field label="수정할 내용 (수정 요청 때 필수)" hint="수정 요청을 보낼 때 이름과 내용을 모두 입력해 주세요.">
                      <Textarea rows={4} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="예: 12초에서 제품 이름을 조금 더 크게 보여 주세요." />
                    </Field>
                    <RevisionBox used={info.revisionsUsed} limit={info.revisionLimit} left={left} over={over} />
                    {error && !extraOpen && (
                      <p role="alert" className="flex items-start gap-2 rounded-nd-md bg-nd-danger-soft px-3 py-2.5 text-nd-body text-nd-danger-text">
                        <CircleAlert size={16} aria-hidden className="mt-0.5 shrink-0" />
                        <span>{error}</span>
                      </p>
                    )}
                    <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
                      <Button size="lg" icon={CircleCheck} disabled={busy || !name.trim() || !video} onClick={() => void answer("approved")}>
                        승인
                      </Button>
                      {over ? (
                        <Button size="lg" variant="secondary" icon={MessageSquare} disabled={busy} onClick={() => { setError(null); setExtraOpen(true); }} className="whitespace-normal text-center">
                          추가 수정 요청 (계약 범위 밖)
                        </Button>
                      ) : (
                        <Button size="lg" variant="secondary" icon={MessageSquare} disabled={busy || !name.trim() || !feedback.trim()} onClick={() => void answer("revision")}>
                          수정 요청 보내기
                        </Button>
                      )}
                    </div>
                    {waitHint && <p className="text-[13px] leading-relaxed text-nd-fg-3">{waitHint}</p>}
                    <p className="flex items-start gap-2 rounded-nd-md bg-nd-warning-soft px-3 py-2.5 text-[14px] leading-relaxed text-nd-warning-text">
                      <TriangleAlert size={16} aria-hidden className="mt-0.5 shrink-0" />
                      <span>한 번 답하면 이 회차는 바꿀 수 없습니다. 영상을 끝까지 보신 뒤 답해 주세요.</span>
                    </p>
                  </div>
                )}
              </Panel>
            )}

            {info && (
              <Panel title="지난 회차">
                <HistoryList history={info.history} />
              </Panel>
            )}

            {info && (
              <div className={cn("flex items-start gap-2.5 rounded-nd-md border border-current/10 px-4 py-3", toneCls.info.soft)}>
                <InfoIcon size={18} aria-hidden className={cn("mt-0.5 shrink-0", toneCls.info.text)} />
                <div className="min-w-0 text-[14px] leading-relaxed">
                  <div className={cn("font-semibold", toneCls.info.text)}>다른 자료는 보이지 않아요</div>
                  <div className="mt-0.5 text-nd-fg-2">이 링크에서는 이 영상 한 편만 확인할 수 있습니다.</div>
                </div>
              </div>
            )}
          </div>
        </div>

        <footer className="mt-10 border-t border-nd-line pt-5 text-[13px] text-nd-fg-3">문의는 영상을 보낸 담당자에게 전달해 주세요.</footer>
      </div>

      {info && (
        <Dialog
          open={extraOpen}
          onClose={() => setExtraOpen(false)}
          closeOnOverlay={false}
          title="추가 수정 요청 · 계약 범위 밖"
          footer={
            <>
              <Button variant="secondary" onClick={() => setExtraOpen(false)}>
                돌아가기
              </Button>
              <Button icon={Send} loading={busy} disabled={!name.trim() || !feedback.trim()} onClick={() => void answer("revision")}>
                추가 수정 요청 보내기
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div className={cn("flex items-start gap-2.5 rounded-nd-md border border-current/10 px-4 py-3", toneCls.warning.soft)}>
              <TriangleAlert size={18} aria-hidden className={cn("mt-0.5 shrink-0", toneCls.warning.text)} />
              <div className="min-w-0 text-[14px] leading-relaxed">
                <div className={cn("font-semibold", toneCls.warning.text)}>계약상 수정 {info.revisionLimit}회를 모두 사용했어요</div>
                <div className="mt-0.5 text-nd-fg-2">추가 요청도 보낼 수 있습니다. 이 요청은 별도 협의 대상으로 기록되고, 제작 일정과 추가 비용은 담당자와 따로 협의합니다.</div>
              </div>
            </div>
            <Field label="답변하는 분의 이름" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="이름" />
            </Field>
            <Field label="수정할 내용" required hint="수정하고 싶은 시점과 내용을 구체적으로 적어 주세요.">
              <Textarea rows={4} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="예: 브랜드 이름을 마지막 장면에서 더 크게 보여 주세요." />
            </Field>
            {error && (
              <p role="alert" className="flex items-start gap-2 rounded-nd-md bg-nd-danger-soft px-3 py-2.5 text-nd-body text-nd-danger-text">
                <CircleAlert size={16} aria-hidden className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </p>
            )}
            <div className="rounded-nd-lg border border-nd-line px-4 py-3.5">
              <h3 className="mb-2 flex items-center gap-1.5 text-[15px] font-semibold text-nd-fg">
                <History size={16} aria-hidden className="text-nd-fg-3" />
                앞선 검토
              </h3>
              <HistoryList history={info.history} compact />
            </div>
          </div>
        </Dialog>
      )}
    </main>
  );
}

/** 맨 위 머리 — 회사 이름 · 고객 전용 · 로그인 없이 답할 수 있다는 안내 (ERP 메뉴는 없다) */
function ReviewTop() {
  return (
    <div className="border-b border-nd-line bg-nd-page">
      <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-4 sm:px-8 sm:py-5">
        <div>
          <div className="text-[15px] font-bold tracking-[0.18em] text-nd-fg">NEANDER</div>
          <div className="mt-0.5 text-[13px] text-nd-fg-3">영상 검토 · 고객 전용</div>
        </div>
        <Badge tone="info" size="lg">
          <ShieldCheck size={14} aria-hidden />
          로그인 없이 답변할 수 있어요
        </Badge>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="nd-surface min-w-0 rounded-nd-lg px-5 py-5 sm:px-6">
      <h2 className="mb-3 text-[17px] font-semibold text-nd-fg">{title}</h2>
      {children}
    </section>
  );
}

/** 계약에 포함된 남은 수정 — 상한을 넘으면 별도 협의 */
function RevisionBox({ used, limit, left, over }: { used: number; limit: number; left: number; over: boolean }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 rounded-nd-md border px-4 py-3", over ? "border-nd-warning/30 bg-nd-warning-soft" : "border-nd-line bg-nd-sunken/70")}>
      <div className="min-w-0">
        <div className={cn("text-[14px] font-semibold", over ? "text-nd-warning-text" : "text-nd-fg")}>{over ? `계약상 수정 ${limit}회를 모두 사용했어요` : "계약에 포함된 남은 수정"}</div>
        <div className="nd-num mt-0.5 text-[13px] text-nd-fg-2">
          지금까지 {used} / {limit}회 사용 · {over ? "이후 요청은 별도 협의 대상으로 기록됩니다" : "상한 초과 시 별도 협의"}
        </div>
      </div>
      <span className={cn("nd-num shrink-0 text-[16px] font-semibold", over ? "text-nd-warning-text" : "text-nd-accent")}>{left}회</span>
    </div>
  );
}

/** 지난 회차 — 첫 회차면 빈 상태 */
function HistoryList({ history, compact = false }: { history: Info["history"]; compact?: boolean }) {
  if (!history.length) {
    return (
      <div className={cn("flex flex-col items-center rounded-nd-md border border-dashed border-nd-line text-center", compact ? "px-4 py-4" : "px-6 py-8")}>
        <History size={22} aria-hidden className="text-nd-fg-2" />
        <p className="mt-2 text-[14px] font-semibold text-nd-fg">첫 번째 검토입니다</p>
        <p className="mt-1 text-[13px] leading-relaxed text-nd-fg-3">앞선 검토가 생기면 결과와 수정 내용을 이곳에서 확인할 수 있어요.</p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-nd-line">
      {history.map((h) => {
        const l = DECISION_LABEL[h.decision] ?? { text: h.decision, tone: "neutral" as Tone };
        return (
          <li key={h.n} className="py-2.5 first:pt-0 last:pb-0">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px]">
              <span className="font-semibold text-nd-fg">{h.n}차</span>
              <Badge tone={l.tone} size="lg">
                {l.text}
              </Badge>
              {h.decidedAt && <span className="nd-num text-[13px] text-nd-fg-3">{fmtShort(h.decidedAt)}</span>}
            </p>
            {h.feedback && <p className="mt-1 break-words text-[14px] leading-relaxed text-nd-fg-2">{h.feedback}</p>}
          </li>
        );
      })}
    </ul>
  );
}

/** 이미 답한 회차 · 지난 링크 — 답하기 대신 보이는 안내 */
function Answered({ icon: I, tone, quote, children }: { icon: typeof CircleCheck; tone: Tone; quote?: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", toneCls[tone].soft, toneCls[tone].text)}>
        <I size={20} aria-hidden />
      </span>
      <div className="min-w-0 pt-2">
        <p className="text-nd-body leading-relaxed text-nd-fg">{children}</p>
        {quote && <p className="mt-2 break-words rounded-nd-md bg-nd-sunken px-3 py-2 text-nd-body text-nd-fg-2">「{quote}」</p>}
      </div>
    </div>
  );
}
