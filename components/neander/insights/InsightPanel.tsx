"use client";

// ============================================================
//  InsightPanel — 리포트 화면의 「이번 달 인사이트」
// ------------------------------------------------------------
//  한 달치 해설(InsightDoc)을 보여 주고, 사람이 고치고 승인한다.
//  발표 슬라이드(deck/insight-slides)는 같은 문서를 읽는다 — 여기서 고친
//  문장이 발표에 그대로 나온다. 문장마다 근거 신호를 펼쳐 볼 수 있다:
//  AI 가 쓴 말이 어느 숫자에서 나왔는지 확인할 수 없으면 믿고 발표할 수 없다.
// ============================================================

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  MessageSquareText,
  Pencil,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  InlineNotice,
  Input,
  LoadingState,
  SectionHeader,
  Textarea,
  cn,
  useConfirm,
  useToast,
  type Tone,
} from "@/components/neander/ui";
import { useInsight, type UseInsight } from "./useInsight";
import { InsightDiscussion, type InsightFocus } from "./InsightDiscussion";
import { InsightItemChat } from "./InsightItemChat";
import { applyInsightEdit } from "@/lib/neander/insights/edit";
import {
  SEVERITY_ORDER,
  type InsightDoc,
  type InsightDraft,
  type InsightEditProposal,
  type InsightItem,
  type InsightItemRef,
  type InsightModule,
  type InsightPatch,
  type Signal,
  type SignalMetric,
  type SignalSeverity,
} from "@/lib/neander/insights/types";

type ListKey = "summary" | "actions" | "risks";

const SEVERITY_LABEL: Record<SignalSeverity, string> = { high: "높음", medium: "보통", low: "낮음" };
const SEVERITY_TONE: Record<SignalSeverity, Tone> = { high: "danger", medium: "warning", low: "neutral" };

/** 근거 숫자 한 칸 — 단위를 붙여 읽기 좋게 */
export function formatMetric(m: SignalMetric): string {
  const v = m.unit === "%" || m.unit === "배" ? m.value.toLocaleString("ko-KR", { maximumFractionDigits: 1 }) : Math.round(m.value).toLocaleString("ko-KR");
  return `${m.label} ${v}${m.unit}`;
}

const fmtTime = (ms?: number) => {
  if (!ms) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function InsightPanel({
  module,
  month,
  scope,
  className,
  insight,
  inDialog = false,
}: {
  module: InsightModule;
  month: string;
  scope?: string;
  className?: string;
  /** 창(Dialog) 안에 띄웠는가 — 「묻기」 팝오버가 창 뒤로 숨지 않게 */
  inDialog?: boolean;
  /**
   * 부르는 쪽이 이미 들고 있는 상태 — 발표 슬라이드의 관리 창처럼, 여기서 고친 것이
   * 곧바로 슬라이드에 보여야 할 때 넘긴다. 없으면 패널이 직접 불러온다.
   */
  insight?: UseInsight;
}) {
  // 훅은 늘 부른다(규칙) — 상태를 받았으면 달을 비워 따로 불러오지 않게 한다
  const own = useInsight(module, insight ? undefined : month, scope);
  const { doc, loading, generating, saving, error, generate, save, remove, discuss, clearDiscussion } = insight ?? own;
  const confirm = useConfirm();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<InsightDraft | null>(null);
  const [chatOpen, setChatOpen] = useState(true);
  const [focus, setFocus] = useState<InsightFocus | null>(null);

  // 달·범위가 바뀌거나 문서가 새로 오면 편집을 접는다
  useEffect(() => {
    setEditing(false);
    setDraft(null);
    setFocus(null);
  }, [doc?.id, doc?.generatedAt]);

  const signalMap = useMemo(() => new Map((doc?.signals ?? []).map((s) => [s.id, s])), [doc?.signals]);

  const savedDraft = (d: InsightDoc): InsightDraft => ({
    summary: d.summary,
    actions: d.actions,
    risks: d.risks,
    comments: d.comments,
  });
  const dirty = !!doc && !!draft && JSON.stringify(draft) !== JSON.stringify(savedDraft(doc));

  /** 고치기 시작 — 문장을 짚고 시작하면(「묻기」) 대화 창을 열고 그 문장을 짚어 둔다 */
  const startEdit = (ask?: InsightFocus) => {
    if (!doc) return;
    if (!editing) {
      setDraft({
        summary: doc.summary.map((x) => ({ ...x })),
        actions: doc.actions.map((x) => ({ ...x })),
        risks: doc.risks.map((x) => ({ ...x })),
        comments: { ...doc.comments },
      });
      setEditing(true);
    }
    if (ask) {
      setChatOpen(true);
      setFocus(ask);
    }
  };

  const cancelEdit = async () => {
    if (dirty) {
      const ok = await confirm({
        title: "고친 내용을 버릴까요?",
        message: "직접 고치거나 AI 수정안을 반영한 문장이 저장되지 않았습니다. 대화 기록은 남습니다.",
        confirmLabel: "버리기",
        tone: "danger",
      });
      if (!ok) return;
    }
    setEditing(false);
    setDraft(null);
    setFocus(null);
  };

  const applyProposal = (p: InsightEditProposal) => setDraft((d) => (d ? applyInsightEdit(d, p) : d));

  // 보기 화면 「묻기」 팝오버 — 편집 초안이 없으니 수정안을 곧바로 저장하고 되돌리기를 준다
  const [asking, setAsking] = useState<InsightItemRef | null>(null);
  useEffect(() => setAsking(null), [doc?.id, doc?.generatedAt, editing]);

  const applyAndSave = async (p: InsightEditProposal): Promise<boolean> => {
    if (!doc || saving) return false;
    const before = savedDraft(doc);
    const after = applyInsightEdit(before, p);
    const patch: InsightPatch = p.kind === "comment" ? { comments: after.comments } : { [p.section]: after[p.section] };
    const undo: InsightPatch = p.kind === "comment" ? { comments: before.comments } : { [p.section]: before[p.section] };
    const next = await save(patch);
    if (next) {
      toast.success("수정안을 반영해 저장했습니다.", { action: { label: "되돌리기", onClick: () => void save(undo) } });
    }
    return !!next;
  };

  // 보기 화면에서 바로 지우기 — 확인 창 대신 저장 후 「되돌리기」 (쓸데없는 문장을 연달아 치우기 좋게)
  const quickRemove = async (key: ListKey, id: string) => {
    if (!doc || saving) return;
    const prev = doc[key];
    const next = await save({ [key]: prev.filter((x) => x.id !== id) });
    if (next) {
      toast.success("문장을 지웠습니다.", { action: { label: "되돌리기", onClick: () => void save({ [key]: prev }) } });
    }
  };

  const quickRemoveComment = async (chapter: string) => {
    if (!doc || saving) return;
    const prev = doc.comments;
    const rest = { ...prev };
    delete rest[chapter];
    const next = await save({ comments: rest });
    if (next) {
      toast.success(`「${chapter}」 한 줄을 지웠습니다.`, {
        action: { label: "되돌리기", onClick: () => void save({ comments: prev }) },
      });
    }
  };

  const onSave = async () => {
    if (!draft) return;
    const comments = Object.fromEntries(Object.entries(draft.comments).filter(([, v]) => v.trim()));
    const next = await save({ ...draft, comments });
    if (next) {
      toast.success("인사이트를 저장했습니다.");
      setEditing(false);
      setDraft(null);
    }
  };

  const onApprove = async () => {
    if (!doc) return;
    const approved = doc.status !== "approved";
    const next = await save({ status: approved ? "approved" : "draft" });
    if (next) toast.success(approved ? "승인했습니다 — 발표 슬라이드에 초안 표시 없이 나옵니다." : "초안으로 되돌렸습니다.");
  };

  const onGenerate = async (again: boolean) => {
    if (again) {
      const ok = await confirm({
        title: "인사이트를 다시 만들까요?",
        message: "지금 문장과 사람이 고친 내용, 승인 상태, AI 와 나눈 대화를 새 초안으로 덮어씁니다. 되돌릴 수 없습니다.",
        confirmLabel: "다시 만들기",
        tone: "danger",
      });
      if (!ok) return;
    }
    const next = await generate();
    if (next) toast.success(next.fallback ? "AI 없이 규칙으로 초안을 만들었습니다." : "인사이트 초안을 만들었습니다.");
  };

  const onDelete = async () => {
    const ok = await confirm({
      title: "이 달의 인사이트를 지울까요?",
      message: "문장·고친 내용·승인 상태·AI 와 나눈 대화가 모두 사라집니다. 되돌릴 수 없고, 필요하면 「인사이트 만들기」로 새 초안을 만들 수 있습니다.",
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (!ok) return;
    if (await remove()) toast.success("인사이트를 지웠습니다.");
  };

  const patchItem = (key: ListKey, id: string, patch: Partial<InsightItem>) =>
    setDraft((d) => (d ? { ...d, [key]: d[key].map((x) => (x.id === id ? { ...x, ...patch } : x)) } : d));
  const removeItem = (key: ListKey, id: string) =>
    setDraft((d) => (d ? { ...d, [key]: d[key].filter((x) => x.id !== id) } : d));

  const header = (
    <SectionHeader
      title={
        <span className="inline-flex items-center gap-2">
          <Lightbulb size={16} className="text-nd-accent" aria-hidden />
          이번 달 인사이트
        </span>
      }
      hint={doc ? undefined : "신호를 읽고 핵심 · 할 일 · 확인할 것을 정리합니다"}
      action={
        doc && !generating ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={doc.status === "approved" ? "success" : "warning"} dot>
              {doc.status === "approved" ? "승인됨" : "초안"}
            </Badge>
            {editing ? (
              <>
                {!chatOpen && (
                  <Button size="sm" variant="ghost" icon={Sparkles} onClick={() => setChatOpen(true)}>
                    AI 와 고치기
                  </Button>
                )}
                <Button size="sm" variant="ghost" icon={X} onClick={() => void cancelEdit()} disabled={saving}>
                  취소
                </Button>
                <Button size="sm" variant="primary" icon={Check} onClick={onSave} loading={saving}>
                  저장
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => void onDelete()} disabled={saving}>
                  삭제
                </Button>
                <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => onGenerate(true)} disabled={saving}>
                  다시 만들기
                </Button>
                <Button size="sm" variant="secondary" icon={Pencil} onClick={() => startEdit()} disabled={saving}>
                  고치기
                </Button>
                <Button size="sm" variant={doc.status === "approved" ? "secondary" : "primary"} icon={Check} onClick={onApprove} loading={saving}>
                  {doc.status === "approved" ? "승인 취소" : "승인"}
                </Button>
              </>
            )}
          </div>
        ) : undefined
      }
    />
  );

  let body;
  if (generating) {
    body = <LoadingState size="block" label="AI 가 이번 달 신호를 읽고 있습니다 · 수십 초 걸릴 수 있습니다…" />;
  } else if (loading && !doc) {
    body = <LoadingState size="block" label="인사이트를 불러오는 중…" />;
  } else if (!doc) {
    body = (
      <EmptyState
        compact
        icon={Sparkles}
        title="아직 이 달의 인사이트가 없습니다"
        description="코드가 데이터에서 평소와 다르거나 돈이 걸린 신호를 뽑고, AI 가 그 신호만 읽어 이번 달 핵심 · 다음 달 할 일 · 확인할 것을 씁니다. 문장마다 근거 신호가 붙고, 고치고 승인하면 발표 슬라이드에 나옵니다 · 수십 초"
        action={
          <Button variant="primary" icon={Sparkles} onClick={() => onGenerate(false)}>
            인사이트 만들기
          </Button>
        }
      />
    );
  } else {
    const view = editing && draft ? draft : doc;
    const chapters = Object.keys(view.comments);
    const withChat = editing && !!draft && chatOpen;
    const sectionProps = (key: ListKey) => ({
      signalMap,
      editing,
      focusedId: focus?.section === key ? focus.itemId : undefined,
      // 고치기 화면에서는 옆 대화에 짚고, 보기 화면에서는 문장 밑 팝오버로
      onAsk: (id: string) => (editing ? startEdit({ section: key, itemId: id }) : setAsking({ section: key, itemId: id })),
      askingId: !editing && asking?.section === key ? asking.itemId : undefined,
      renderAsk: (item: InsightItem, anchorRef: RefObject<HTMLElement | null>) => (
        <InsightItemChat
          key={item.id}
          open
          anchorRef={anchorRef}
          onClose={() => setAsking(null)}
          section={key}
          item={item}
          draft={savedDraft(doc)}
          discussion={doc.discussion ?? []}
          discuss={discuss}
          saving={saving}
          onApply={applyAndSave}
          overDialog={inDialog}
        />
      ),
      onPatch: (id: string, p: Partial<InsightItem>) => patchItem(key, id, p),
      onRemove: (id: string) => (editing ? removeItem(key, id) : void quickRemove(key, id)),
      busy: saving,
    });
    const sections = (
      <div className="flex min-w-0 flex-col gap-5">
        <div className={cn("grid gap-5", withChat ? "2xl:grid-cols-2" : "lg:grid-cols-2")}>
          <ItemSection title="이번 달 핵심" items={view.summary} {...sectionProps("summary")} />
          <ItemSection title="다음 달 할 일" items={view.actions} showImpact {...sectionProps("actions")} />
        </div>

        <ItemSection title="확인이 필요한 것" items={view.risks} {...sectionProps("risks")} />
      </div>
    );
    body = (
      <div className="flex flex-col gap-5">
        {doc.fallback && (
          <InlineNotice tone="warning">
            AI 없이 규칙으로 만든 초안입니다 — 문장이 딱딱할 수 있습니다. 고치고 승인해서 쓰세요.
          </InlineNotice>
        )}

        {withChat ? (
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
            {sections}
            <InsightDiscussion
              draft={draft}
              discussion={doc.discussion ?? []}
              focus={focus}
              onClearFocus={() => setFocus(null)}
              discuss={discuss}
              clearDiscussion={clearDiscussion}
              onApply={applyProposal}
              onClose={() => {
                setChatOpen(false);
                setFocus(null);
              }}
              className="h-[min(640px,calc(100vh-7rem))] xl:sticky xl:top-4"
            />
          </div>
        ) : (
          sections
        )}

        {(chapters.length > 0 || editing) && (
          <section>
            <h3 className="mb-2 text-nd-body font-semibold text-nd-fg">장별 한 줄</h3>
            {chapters.length === 0 ? (
              <p className="text-nd-caption text-nd-fg-3">장별 코멘트가 없습니다.</p>
            ) : (
              <dl className="flex flex-col gap-1.5">
                {chapters.map((ch) => (
                  <div
                    key={ch}
                    className={cn(
                      "grid items-center gap-x-3",
                      editing ? "grid-cols-[minmax(6rem,auto)_1fr]" : "grid-cols-[minmax(6rem,auto)_1fr_auto]",
                    )}
                  >
                    <dt className="text-nd-caption font-medium text-nd-fg-2">{ch}</dt>
                    <dd className="min-w-0 text-nd-body text-nd-fg">
                      {editing && draft ? (
                        <Input
                          size="sm"
                          value={draft.comments[ch] ?? ""}
                          placeholder="비우면 이 장에는 코멘트가 나오지 않습니다"
                          onChange={(e) => setDraft((d) => (d ? { ...d, comments: { ...d.comments, [ch]: e.target.value } } : d))}
                        />
                      ) : (
                        view.comments[ch]
                      )}
                    </dd>
                    {!editing && (
                      <IconButton
                        icon={Trash2}
                        label={`「${ch}」 한 줄 지우기`}
                        size="sm"
                        variant="ghost"
                        disabled={saving}
                        onClick={() => void quickRemoveComment(ch)}
                        className="text-nd-fg-3 hover:text-nd-danger-text"
                      />
                    )}
                  </div>
                ))}
              </dl>
            )}
          </section>
        )}

        <SignalList signals={doc.signals} />

        <p className="text-nd-micro text-nd-fg-3">
          {doc.fallback ? "규칙 초안" : "AI 초안"} {fmtTime(doc.generatedAt)}
          {doc.generatedBy ? ` · ${doc.generatedBy}` : ""}
          {doc.model ? ` · ${doc.model}` : ""}
          {typeof doc.costUsd === "number" ? ` · $${doc.costUsd.toFixed(4)}` : ""}
          {doc.updatedAt && doc.updatedAt !== doc.generatedAt ? ` · 마지막 수정 ${fmtTime(doc.updatedAt)}${doc.updatedBy ? ` ${doc.updatedBy}` : ""}` : ""}
        </p>
      </div>
    );
  }

  return (
    <Card className={cn("mb-4", className)}>
      {header}
      {error && (
        <InlineNotice tone="danger" className="mb-3">
          {error}
        </InlineNotice>
      )}
      {body}
    </Card>
  );
}

// ---- 섹션 (핵심 · 할 일 · 확인할 것) ------------------------------------

function ItemSection({
  title,
  items,
  signalMap,
  editing,
  showImpact = false,
  focusedId,
  onAsk,
  askingId,
  renderAsk,
  onPatch,
  onRemove,
  busy = false,
}: {
  /** 보기 화면에서 「묻기」 팝오버가 열린 문장 */
  askingId?: string;
  /** 그 팝오버 — 문장 블록을 앵커로 받는다 */
  renderAsk: (item: InsightItem, anchorRef: RefObject<HTMLElement | null>) => ReactNode;
  /** 저장 중 — 보기 화면의 바로 지우기를 잠근다 */
  busy?: boolean;
  title: string;
  items: InsightItem[];
  signalMap: Map<string, Signal>;
  editing: boolean;
  showImpact?: boolean;
  /** AI 대화에서 짚고 있는 문장 */
  focusedId?: string;
  onAsk: (id: string) => void;
  onPatch: (id: string, patch: Partial<InsightItem>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <section className="min-w-0">
      <h3 className="mb-2 text-nd-body font-semibold text-nd-fg">{title}</h3>
      {items.length === 0 ? (
        <p className="text-nd-caption text-nd-fg-3">해당하는 내용이 없습니다.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {items.map((item, i) =>
            editing ? (
              <li
                key={item.id}
                className={cn(
                  "flex gap-2 rounded-nd-md bg-nd-fg/[.03] p-2.5 transition-shadow duration-nd-fast",
                  focusedId === item.id && "bg-nd-accent-soft/40 ring-1 ring-nd-accent/50",
                )}
              >
                <span className="nd-num mt-1.5 w-4 shrink-0 text-nd-caption text-nd-fg-3">{i + 1}</span>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Input size="sm" value={item.text} onChange={(e) => onPatch(item.id, { text: e.target.value })} aria-label="문장" />
                  <Textarea
                    size="sm"
                    rows={2}
                    value={item.detail ?? ""}
                    placeholder="부연 (선택)"
                    onChange={(e) => onPatch(item.id, { detail: e.target.value || undefined })}
                    aria-label="부연"
                  />
                  {showImpact && (
                    <Input
                      size="sm"
                      value={item.impact ?? ""}
                      placeholder="예상 영향 (예: 월 +80만원)"
                      onChange={(e) => onPatch(item.id, { impact: e.target.value || undefined })}
                      aria-label="예상 영향"
                    />
                  )}
                  <EvidenceToggle ids={item.signalIds} signalMap={signalMap} />
                </div>
                <div className="flex shrink-0 flex-col gap-0.5">
                  <IconButton
                    icon={MessageSquareText}
                    label="이 문장을 AI 에게 묻기"
                    size="sm"
                    variant="ghost"
                    active={focusedId === item.id}
                    onClick={() => onAsk(item.id)}
                  />
                  <IconButton icon={Trash2} label="이 문장 지우기" size="sm" variant="ghost" onClick={() => onRemove(item.id)} />
                </div>
              </li>
            ) : (
              <AnchoredItem
                key={item.id}
                asking={askingId === item.id}
                renderAsk={(ref) => renderAsk(item, ref)}
              >
                <span className="nd-num mt-0.5 w-4 shrink-0 text-nd-caption text-nd-fg-3">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-nd-body font-medium text-nd-fg">{item.text}</span>
                    {showImpact && item.impact && (
                      <Badge size="sm" tone="accent">
                        {item.impact}
                      </Badge>
                    )}
                  </div>
                  {item.detail && <p className="mt-0.5 text-nd-caption leading-relaxed text-nd-fg-2">{item.detail}</p>}
                  <div className="flex items-start gap-3">
                    <EvidenceToggle ids={item.signalIds} signalMap={signalMap} />
                    <button
                      type="button"
                      onClick={() => onAsk(item.id)}
                      className="mt-1 inline-flex items-center gap-1 text-nd-micro font-medium text-nd-fg-3 hover:text-nd-accent-strong"
                    >
                      <MessageSquareText size={12} aria-hidden />
                      묻기
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(item.id)}
                      disabled={busy}
                      className="mt-1 inline-flex items-center gap-1 text-nd-micro font-medium text-nd-fg-3 hover:text-nd-danger-text disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 size={12} aria-hidden />
                      지우기
                    </button>
                  </div>
                </div>
              </AnchoredItem>
            ),
          )}
        </ol>
      )}
    </section>
  );
}

/** 보기 화면의 문장 한 줄 — 「묻기」 팝오버가 이 블록 전체를 앵커로 붙는다 (문장을 가리지 않게) */
function AnchoredItem({
  asking,
  renderAsk,
  children,
}: {
  asking: boolean;
  renderAsk: (anchorRef: RefObject<HTMLElement | null>) => ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLLIElement>(null);
  return (
    <li
      ref={ref}
      className={cn(
        "-mx-2 flex gap-2 rounded-nd-md px-2 py-1 transition-colors duration-nd-fast",
        asking && "bg-nd-accent-soft/40 ring-1 ring-nd-accent/40",
      )}
    >
      {children}
      {asking && renderAsk(ref)}
    </li>
  );
}

/** 「근거 N」 — 누르면 인용한 신호의 제목·숫자가 펼쳐진다 */
function EvidenceToggle({ ids, signalMap }: { ids: string[]; signalMap: Map<string, Signal> }) {
  const [open, setOpen] = useState(false);
  const cited = ids.map((id) => signalMap.get(id)).filter((s): s is Signal => !!s);
  if (cited.length === 0) return null;
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-0.5 text-nd-micro font-medium text-nd-fg-3 hover:text-nd-accent-strong"
      >
        {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
        근거 {cited.length}
      </button>
      {open && (
        <ul className="mt-1 flex flex-col gap-1 border-l-2 border-nd-fg/10 pl-2.5">
          {cited.map((s) => (
            <li key={s.id} className="text-nd-caption">
              <span className="text-nd-fg-2">{s.title}</span>
              {s.metrics.length > 0 && (
                <span className="nd-num ml-1.5 text-nd-fg-3">{s.metrics.map(formatMetric).join(" · ")}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- 근거 신호 전체 ------------------------------------------------------

function SignalList({ signals }: { signals: Signal[] }) {
  const [open, setOpen] = useState(false);
  if (signals.length === 0) return null;
  const groups = (["high", "medium", "low"] as SignalSeverity[])
    .map((sev) => ({ sev, list: signals.filter((s) => s.severity === sev) }))
    .filter((g) => g.list.length > 0)
    .sort((a, b) => SEVERITY_ORDER[a.sev] - SEVERITY_ORDER[b.sev]);
  return (
    <section className="border-t border-nd-fg/10 pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-nd-body font-medium text-nd-fg-2 hover:text-nd-fg"
      >
        {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        근거 신호 {signals.length}개
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-4">
          {groups.map((g) => (
            <div key={g.sev}>
              <div className="mb-1.5">
                <Badge size="sm" tone={SEVERITY_TONE[g.sev]}>
                  중요도 {SEVERITY_LABEL[g.sev]} · {g.list.length}
                </Badge>
              </div>
              <ul className="flex flex-col gap-2">
                {g.list.map((s) => (
                  <li key={s.id} className="rounded-nd-md bg-nd-fg/[.03] px-3 py-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-nd-body font-medium text-nd-fg">{s.title}</span>
                      <span className="text-nd-micro text-nd-fg-3">
                        {s.chapter ?? s.topic}
                        {s.href && (
                          <Link href={s.href} className="ml-2 font-medium text-nd-accent-strong hover:underline">
                            확인하기 →
                          </Link>
                        )}
                      </span>
                    </div>
                    <p className="mt-0.5 text-nd-caption leading-relaxed text-nd-fg-2">{s.detail}</p>
                    {s.metrics.length > 0 && (
                      <p className="nd-num mt-1 text-nd-micro text-nd-fg-3">{s.metrics.map(formatMetric).join(" · ")}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
