"use client";

// ============================================================
//  고객사 영상 검토 — 로그인 없이 링크로 여는 화면
// ------------------------------------------------------------
//  토큰 하나로 영상 한 편만 받고(api/neander/shorts/review), 그 회차에 한 번만 답한다.
//  ERP 의 다른 자료 · 로그인 · 셸을 쓰지 않는다 (Providers 의 isPublicPath).
//  계약상 수정 횟수를 다 쓰면 「추가 수정 요청 (계약 범위 밖)」 으로 바뀐다 — 막지 않고 알린다.
// ============================================================

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button, Card, Field, Input, Textarea } from "@/components/neander/ui";

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

async function readErr(res: Response) {
  try {
    return ((await res.json()) as { error?: string }).error ?? `요청이 실패했습니다 (HTTP ${res.status})`;
  } catch {
    return `요청이 실패했습니다 (HTTP ${res.status})`;
  }
}

export default function ReviewPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<Info | null>(null);
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
      if (!res.ok) throw new Error(await readErr(res));
      const i = ((await res.json()) as { review: Info }).review;
      setInfo(i);
      const chunks: ArrayBuffer[] = [];
      for (let from = 0; from < i.media.parts; from += 5) {
        const r = await fetch(`/api/neander/shorts/review?token=${encodeURIComponent(token)}&from=${from}&count=5`, { cache: "no-store" });
        if (!r.ok) throw new Error(await readErr(r));
        chunks.push(await r.arrayBuffer());
        setLoaded(Math.min(1, (from + 5) / i.media.parts));
      }
      url = URL.createObjectURL(new Blob(chunks, { type: i.media.type }));
      setVideo(url);
    })().catch((e) => setError(e instanceof Error ? e.message : "영상을 불러오지 못했습니다."));
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

  const over = info ? info.revisionsUsed >= info.revisionLimit : false;
  return (
    <main className="mx-auto min-h-screen max-w-xl px-4 py-8">
      <p className="text-nd-caption text-nd-fg-3">영상 검토</p>
      <h1 className="mt-1 text-nd-title font-semibold">{info ? `${info.clientName} · ${info.title}` : "불러오는 중…"}</h1>
      {info && <p className="mt-1 text-nd-caption text-nd-fg-3">{info.round}차 검토 · 수정 {info.revisionsUsed}/{info.revisionLimit}회 사용 · 링크 만료 {new Date(info.expiresAt).toLocaleDateString("ko-KR")}</p>}
      {error && <p role="alert" className="mt-4 rounded-nd-md bg-nd-danger-soft p-3 text-nd-body text-nd-danger-text">{error}</p>}

      <div className="mt-5 flex justify-center">
        {video ? (
          <video src={video} controls playsInline className="aspect-[9/16] w-full max-w-[340px] rounded-nd-lg bg-black" />
        ) : (
          <div className="flex aspect-[9/16] w-full max-w-[340px] items-center justify-center rounded-nd-lg bg-nd-fg/10 text-nd-caption text-nd-fg-3">{error ? "" : `영상 받는 중 ${Math.round(loaded * 100)}%`}</div>
        )}
      </div>

      {info && info.history.length > 0 && (
        <Card className="mt-5 space-y-1 text-nd-body">
          <p className="text-nd-caption font-medium text-nd-fg-2">앞선 검토</p>
          {info.history.map((h) => <p key={h.n}>{h.n}차 · {h.decision === "approved" ? "승인" : "수정 요청"}{h.feedback ? ` — 「${h.feedback}」` : ""}</p>)}
        </Card>
      )}

      {info && (
        <Card className="mt-5 space-y-3">
          {!info.latest || info.decision === "withdrawn" ? (
            <p className="text-nd-body">이 링크보다 새 검토 영상이 있습니다. 담당자가 보낸 가장 최근 링크로 확인해 주세요.</p>
          ) : info.decision !== "pending" ? (
            <p className="text-nd-body">
              {info.decision === "approved" ? "승인해 주셔서 감사합니다. 이 영상으로 게시를 준비합니다." : "수정 요청을 받았습니다. 고친 영상을 새 링크로 보내 드리겠습니다."}
              {info.feedback && <span className="mt-1 block text-nd-fg-2">「{info.feedback}」</span>}
            </p>
          ) : (
            <>
              <Field label="검토하신 분 이름" required><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>
              <Field label="수정할 점 (수정 요청 때 필수)" hint={over ? `계약상 수정 ${info.revisionLimit}회를 모두 사용했습니다 — 이후 요청은 별도 협의 대상으로 기록됩니다.` : `남은 수정 ${info.revisionLimit - info.revisionsUsed}회`}>
                <Textarea rows={4} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy || !name.trim() || !video} onClick={() => void answer("approved")}>승인</Button>
                <Button variant="secondary" disabled={busy || !name.trim() || !feedback.trim()} onClick={() => void answer("revision")}>{over ? "추가 수정 요청 (계약 범위 밖)" : "수정 요청"}</Button>
              </div>
              <p className="text-nd-caption text-nd-fg-3">한 번 답하면 이 회차는 바꿀 수 없습니다. 영상을 끝까지 보신 뒤 답해 주세요.</p>
            </>
          )}
        </Card>
      )}
    </main>
  );
}
