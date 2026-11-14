"use client";

// ============================================================
//  세금 고지서 한 장 — 폰에서 (노션 「돈 나가는 날」 도착 · 납기 알림의 링크)
// ------------------------------------------------------------
//  전자고지 알림에서 못 읽은 금액 · 납기 · 사업자를 채우고, 냈으면 「냈음」.
//  칸을 벗어나면 바로 저장되고 노션 줄도 같이 바뀐다 (api/neander/finance/tax-notices PATCH).
//  재무 화면(/neander/finance/*)은 장부 전체를 받으므로 이 화면은 그 밖에 둔다 — 폰에서 바로 열리게.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Check, EyeOff, List, RotateCcw } from "lucide-react";
import { Badge, Button, Card, ErrorState, LoadingState, Money, PageShell, SectionHeader, useToast } from "@/components/neander/ui";
import { useAuth } from "@/components/neander/auth";
import { TAX_SOURCE, TAX_STATE, TaxNoticeFields, type TaxDraft } from "@/components/neander/finance/TaxNoticeForm";
import { fetchTaxNotice, patchTaxNotice, type TaxNoticeView } from "@/lib/neander/finance/tax-notice-client";
import { noticeLabel, noticeNeeds } from "@/lib/neander/finance/tax-notice";

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}(${WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()]})`;
const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const daysLeft = (date: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${kstToday()}T00:00:00Z`)) / 86_400_000);
const stamp = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ");

const draftOf = (n: TaxNoticeView): TaxDraft => ({
  site: n.site,
  level: n.level,
  item: n.item,
  amount: n.amount,
  dueDate: n.dueDate,
  period: n.period,
  office: n.office,
  payNo: n.payNo,
  note: n.note,
});

export default function TaxNoticePage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params?.id ?? ""));
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();
  const [notice, setNotice] = useState<TaxNoticeView | null>(null);
  const [draft, setDraft] = useState<TaxDraft>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** 칸 저장 상태 — 칸마다 알림을 띄우지 않고 제목 옆에 조용히 (실패만 알림) */
  const [saved, setSaved] = useState<"saving" | number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const n = await fetchTaxNotice(id);
      setNotice(n);
      setDraft(draftOf(n));
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오지 못했습니다.");
    }
  }, [id]);
  useEffect(() => {
    if (authLoading || !user) return;
    void load();
  }, [authLoading, user, load]);

  /** 칸 하나 저장 — 바뀌었을 때만 */
  const commit = async (field: keyof TaxDraft, v: unknown) => {
    if (!notice) return;
    const before = (notice as Record<string, unknown>)[field] ?? null;
    if ((before ?? null) === (v ?? null)) return;
    setSaved("saving");
    try {
      const n = await patchTaxNotice(id, { [field]: v ?? null });
      setNotice(n);
      setSaved(Date.now());
    } catch (e) {
      setSaved(null);
      toast.error(e instanceof Error ? e.message : "저장하지 못했습니다.");
      setDraft(draftOf(notice));
    }
  };
  const setState = async (state: TaxNoticeView["state"], label: string) => {
    setBusy(state);
    try {
      const n = await patchTaxNotice(id, { state, ...(state === "paid" ? { paidDate: kstToday() } : {}) });
      setNotice(n);
      setDraft(draftOf(n));
      toast.success(label);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  if (authLoading || (!notice && !error)) {
    return (
      <PageShell width="narrow">
        <LoadingState label="고지서를 불러오는 중…" />
      </PageShell>
    );
  }
  if (!user) {
    return (
      <PageShell width="narrow">
        <ErrorState title="로그인이 필요합니다" description="ERP 에 로그인한 뒤 다시 열어 주세요." />
      </PageShell>
    );
  }
  if (error || !notice) {
    return (
      <PageShell width="narrow">
        <ErrorState title="고지서를 열지 못했습니다" description={error ?? ""} action={<Button onClick={() => void load()}>다시 시도</Button>} />
      </PageShell>
    );
  }

  const st = TAX_STATE[notice.state];
  const needs = noticeNeeds(notice);
  const left = notice.dueDate ? daysLeft(notice.dueDate) : null;

  return (
    <PageShell width="narrow" className="pb-24">
      <Card className="mb-4">
        <div className="flex items-center gap-2 text-nd-body text-nd-fg-2">
          <span>{[notice.level, TAX_SOURCE[notice.source]].filter(Boolean).join(" · ")}</span>
          <span className="text-nd-fg-3">· {stamp(notice.receivedAt)} 받음</span>
          <Badge tone={st.tone} className="ml-auto">
            {st.label}
          </Badge>
        </div>
        <div className="mt-2 text-nd-title font-semibold">{noticeLabel(notice)}</div>
        <div className="mt-1 text-nd-display font-bold">{notice.amount ? <Money value={-notice.amount} flow="expense" /> : <span className="text-nd-fg-3">금액 모름</span>}</div>
        <div className="mt-2 text-nd-body">
          {notice.dueDate ? (
            <>
              납기 <b>{md(notice.dueDate)}</b>
              {notice.state === "open" && left !== null ? (
                <span className={left < 0 ? "text-nd-danger-text" : left <= 3 ? "text-nd-warning-text" : "text-nd-fg-2"}>
                  {" "}
                  · {left === 0 ? "오늘" : left > 0 ? `${left}일 남음` : `${-left}일 지남`}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-nd-danger-text">납기 모름 — 아래에서 넣어 주세요</span>
          )}
          {notice.state === "paid" && notice.paidDate ? <span className="text-nd-fg-2"> · {md(notice.paidDate)} 냄</span> : null}
        </div>
        {needs.length && notice.state === "open" ? <div className="mt-2 text-nd-body text-nd-fg-3">못 읽은 칸: {needs.join(" · ")}</div> : null}

        <div className="mt-4 flex flex-col gap-2">
          {notice.state === "open" ? (
            <>
              <Button size="lg" icon={Check} loading={busy === "paid"} onClick={() => void setState("paid", "냈음으로 바꿨습니다")}>
                냈음
              </Button>
              <Button variant="secondary" icon={EyeOff} loading={busy === "dismissed"} onClick={() => void setState("dismissed", "무시했습니다 — 알림이 가지 않습니다")}>
                고지서 아님 · 무시
              </Button>
            </>
          ) : (
            <Button variant="secondary" icon={RotateCcw} loading={busy === "open"} onClick={() => void setState("open", "다시 낼 것으로 바꿨습니다")}>
              다시 낼 것으로
            </Button>
          )}
        </div>
      </Card>

      <SectionHeader
        title="고지서 내용"
        hint={
          saved === "saving"
            ? "저장 중…"
            : typeof saved === "number"
              ? `저장됨 ${stamp(saved).slice(11)} · 노션 줄도 바뀌었습니다`
              : "칸을 벗어나면 바로 저장 · 노션 「돈 나가는 날」 줄도 같이 바뀝니다"
        }
      />
      <Card className="mb-4">
        <TaxNoticeFields value={draft} onChange={setDraft} onCommit={(f, v) => void commit(f, v)} />
      </Card>

      {notice.raw ? (
        <>
          <SectionHeader title="받은 알림 원문" hint={notice.from ?? undefined} />
          <Card className="mb-4 whitespace-pre-wrap break-words text-nd-body text-nd-fg-2">{notice.raw}</Card>
        </>
      ) : null}

      <Link href="/neander/finance/tax" className="inline-flex items-center gap-1 text-nd-body text-nd-accent">
        <List size={16} aria-hidden /> 고지서 목록
      </Link>
    </PageShell>
  );
}
