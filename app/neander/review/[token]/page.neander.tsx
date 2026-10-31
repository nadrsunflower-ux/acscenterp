"use client";

// ============================================================
//  고객사 영상 검토 — 로그인 없이 링크로 여는 화면
// ------------------------------------------------------------
//  토큰 하나로 영상 한 편만 받고(api/neander/shorts/review), 그 회차에 한 번만 답한다.
//  ERP 의 다른 자료 · 로그인 · 셸을 쓰지 않는다 (Providers 의 isPublicPath).
//  계약상 수정 횟수를 다 쓰면 「추가 수정 요청 (계약 범위 밖)」 으로 바뀐다 — 막지 않고 알린다.
//  고객은 주로 휴대폰으로 연다 — 좁은 화면은 한 줄(영상 → 앞선 검토 → 답하기),
//  넓은 화면은 영상 왼쪽 · 답하기 오른쪽.
// ============================================================

import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { CircleAlert, CircleCheck, Clock, Film, History, Link2Off, PenLine, TriangleAlert } from "lucide-react";
import { Badge, Button, Card, Field, Input, Spinner, Textarea, cn, type Tone } from "@/components/neander/ui";

interface Info {
  clientName: string;
  title: string;
  round: number;
  latest: boolean;
  decision: "pending" | "approved" | "revision" | "withdrawn";
  feedback: string;
  media: { size: number; type: string; duration: number | null; parts: number };
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

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString("ko-KR");

/** 영상 크기 — 폭 380px 까지, 세로가 창을 넘지 않게 (9:16) */
const VIDEO_BOX = "aspect-[9/16] min-w-[220px]";
const VIDEO_STYLE = { width: "min(100%, 380px, calc((100svh - 150px) * 9 / 16))" };

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

  useEffect(() => {
    let url: string | null = null;
    (async () => {
      const res = await fetch(`/api/neander/shorts/review?token=${encodeURIComponent(token)}`, { cache: "no-store" });
      if (!res.ok) throw new LoadError(await readErr(res), res.status);
      const i = ((await res.json()) as { review: Info }).review;
      setInfo(i);
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
      <main data-nd-text="comfortable" className="flex min-h-screen items-center justify-center bg-nd-sunken px-4 py-10">
        <Card padding="lg" className="w-full max-w-md text-center">
          <span className={cn("mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full", expired ? "bg-nd-warning-soft text-nd-warning-text" : "bg-nd-danger-soft text-nd-danger-text")}>
            {expired ? <Clock size={22} aria-hidden /> : <Link2Off size={22} aria-hidden />}
          </span>
          <p className="text-[13px] text-nd-fg-3">영상 검토</p>
          <h1 className="mt-1 text-nd-title font-semibold">{expired ? "검토 링크가 만료됐습니다" : "검토 링크를 열 수 없습니다"}</h1>
          <p role="alert" className="mt-3 text-nd-body leading-relaxed text-nd-fg-2">{loadError.message}</p>
        </Card>
      </main>
    );
  }

  const over = info ? info.revisionsUsed >= info.revisionLimit : false;
  const left = info ? Math.max(0, info.revisionLimit - info.revisionsUsed) : 0;
  const stale = !!info && (!info.latest || info.decision === "withdrawn");
  // 버튼이 왜 아직 안 눌리는지 — 승인은 이름 + 영상, 수정 요청은 이름 + 수정할 점
  const waitHint = [
    !video ? "영상을 다 받으면 승인할 수 있습니다." : !name.trim() ? "이름을 적으면 승인할 수 있습니다." : "",
    !name.trim() || !feedback.trim() ? "수정 요청은 이름과 수정할 점을 모두 적어야 보낼 수 있습니다." : "",
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

  return (
    <main data-nd-text="comfortable" className="min-h-screen bg-nd-sunken">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        <header className="mb-5 sm:mb-7">
          <p className="text-[13px] text-nd-fg-3">영상 검토</p>
          <div className="mt-1 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <h1 className="min-w-0 break-words text-[22px] font-bold leading-snug text-nd-fg sm:text-[26px]">{info ? `${info.clientName} · ${info.title}` : "불러오는 중…"}</h1>
            {status && <Badge tone={status.tone} size="lg">{status.label}</Badge>}
          </div>
          {info && (
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-nd-body text-nd-fg-2">
              <li><b className="nd-num font-semibold text-nd-fg">{info.round}차</b> 검토</li>
              <li className={cn(over && "text-nd-danger-text")}>
                수정 <b className="nd-num font-semibold">{info.revisionsUsed}/{info.revisionLimit}회</b> 사용
              </li>
              <li>링크 만료 <span className="nd-num">{fmtDate(info.expiresAt)}</span></li>
            </ul>
          )}
        </header>

        <div className="grid items-start gap-6 lg:grid-cols-[380px_minmax(0,1fr)] lg:gap-8">
          {/* 영상 — 이 화면의 주인공 */}
          <div className="flex justify-center lg:sticky lg:top-6">
            {video ? (
              <video src={video} controls playsInline style={VIDEO_STYLE} className={cn(VIDEO_BOX, "rounded-nd-lg bg-black object-contain shadow-lg")} />
            ) : (
              <div style={VIDEO_STYLE} className={cn(VIDEO_BOX, "flex flex-col items-center justify-center gap-3 rounded-nd-lg bg-nd-fg/[.08] px-6 text-center")}>
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

          <div className="min-w-0 space-y-5">
            {loadError && <p role="alert" className="rounded-nd-md bg-nd-danger-soft p-3 text-nd-body text-nd-danger-text">{loadError.message}</p>}

            {info && info.history.length > 0 && (
              <Card className="space-y-2.5">
                <h2 className="flex items-center gap-1.5 text-nd-section text-nd-fg"><History size={16} aria-hidden className="text-nd-fg-3" /> 앞선 검토</h2>
                <ul className="space-y-2">
                  {info.history.map((h) => (
                    <li key={h.n} className="rounded-nd-md bg-nd-sunken px-3 py-2.5">
                      <p className="text-nd-body leading-relaxed">
                        <span className={cn("font-semibold", h.decision === "approved" ? "text-nd-success-text" : "text-nd-danger-text")}>{h.n}차 · {h.decision === "approved" ? "승인" : "수정 요청"}</span>
                        <span className="text-nd-fg-2">{h.feedback ? ` — 「${h.feedback}」` : ""}</span>
                      </p>
                      {h.decidedAt && <p className="mt-0.5 text-[13px] text-nd-fg-3">{fmtDate(h.decidedAt)}</p>}
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {info && (
              <Card className="space-y-4">
                {stale ? (
                  <Answered icon={Link2Off} tone="neutral">
                    이 링크보다 새 검토 영상이 있습니다. 담당자가 보낸 가장 최근 링크로 확인해 주세요.
                  </Answered>
                ) : info.decision !== "pending" ? (
                  <Answered icon={info.decision === "approved" ? CircleCheck : PenLine} tone={info.decision === "approved" ? "success" : "info"} quote={info.feedback}>
                    {info.decision === "approved" ? "승인해 주셔서 감사합니다. 이 영상으로 게시를 준비합니다." : "수정 요청을 받았습니다. 고친 영상을 새 링크로 보내 드리겠습니다."}
                  </Answered>
                ) : (
                  <>
                    <h2 className="text-nd-section text-nd-fg">답하기</h2>
                    <Field label="검토하신 분 이름" required><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>
                    <Field label="수정할 점 (수정 요청 때 필수)" hint={over ? `계약상 수정 ${info.revisionLimit}회를 모두 사용했습니다 — 이후 요청은 별도 협의 대상으로 기록됩니다.` : `남은 수정 ${left}회`}>
                      <Textarea rows={5} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="예: 마지막 제품명 자막을 1초 더 보여 주세요" />
                    </Field>
                    {error && <p role="alert" className="rounded-nd-md bg-nd-danger-soft p-3 text-nd-body text-nd-danger-text">{error}</p>}
                    <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
                      <Button size="lg" icon={CircleCheck} disabled={busy || !name.trim() || !video} onClick={() => void answer("approved")}>승인</Button>
                      <Button size="lg" variant="secondary" icon={PenLine} disabled={busy || !name.trim() || !feedback.trim()} onClick={() => void answer("revision")} className="whitespace-normal text-center">
                        {over ? "추가 수정 요청 (계약 범위 밖)" : "수정 요청"}
                      </Button>
                    </div>
                    {waitHint && <p className="text-[13px] text-nd-fg-3">{waitHint}</p>}
                    <p className="flex items-start gap-2 rounded-nd-md bg-nd-warning-soft px-3 py-2.5 text-nd-body text-nd-warning-text">
                      <TriangleAlert size={16} aria-hidden className="mt-0.5 shrink-0" />
                      <span>한 번 답하면 이 회차는 바꿀 수 없습니다. 영상을 끝까지 보신 뒤 답해 주세요.</span>
                    </p>
                  </>
                )}
              </Card>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

/** 이미 답한 회차 · 지난 링크 — 답하기 대신 보이는 안내 */
function Answered({ icon: I, tone, quote, children }: { icon: typeof CircleCheck; tone: Tone; quote?: string; children: ReactNode }) {
  const cls: Record<Tone, string> = {
    success: "bg-nd-success-soft text-nd-success-text",
    info: "bg-nd-info-soft text-nd-info-text",
    neutral: "bg-nd-fg/[.06] text-nd-fg-2",
    warning: "bg-nd-warning-soft text-nd-warning-text",
    danger: "bg-nd-danger-soft text-nd-danger-text",
    accent: "bg-nd-accent-soft text-nd-accent-strong",
  };
  return (
    <div className="flex items-start gap-3">
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", cls[tone])}>
        <I size={20} aria-hidden />
      </span>
      <div className="min-w-0 pt-2">
        <p className="text-nd-body leading-relaxed text-nd-fg">{children}</p>
        {quote && <p className="mt-2 break-words rounded-nd-md bg-nd-sunken px-3 py-2 text-nd-body text-nd-fg-2">「{quote}」</p>}
      </div>
    </div>
  );
}
