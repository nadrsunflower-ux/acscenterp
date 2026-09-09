"use client";

// ============================================================
//  회의록 — 문서 위계: 왼쪽 목록 · 오른쪽 읽기/편집
// ------------------------------------------------------------
//  목록에서 회의록을 고르면 오른쪽에 본문·액션플랜(표)·자료 링크가
//  읽기 폭(max-w-3xl)으로 펼쳐진다. "새 회의록"/"수정"은 같은 자리에
//  편집 폼(Card)을 띄운다. 모바일에서는 목록 ↔ 문서를 오간다.
//  저장 로직(액션플랜 ↔ 일일업무 동기화)은 그대로.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarCheck,
  FileText,
  Link2,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useAppData } from "@/components/neander/app-data";
import {
  subscribeMeetings,
  addMeeting,
  updateMeeting,
  deleteMeeting,
} from "@/lib/neander/db/meetings";
import { addTask, updateTask, deleteTask } from "@/lib/neander/db/tasks";
import { emptyToUndef } from "@/lib/neander/db/helpers";
import {
  Badge,
  Button,
  Card,
  CategoryPicker,
  EmptyState,
  Field,
  Icon,
  IconButton,
  Input,
  MemberAvatar,
  PageHeader,
  SectionHeader,
  Table,
  TableScroll,
  Td,
  Textarea,
  Th,
  Tr,
  cn,
  useConfirm,
  useToast,
} from "@/components/neander/ui";
import {
  type Meeting,
  type MeetingLink,
  type ActionItem,
  type TaskCategory,
  taskCategoryLabel,
  taskCategoryColor,
} from "@/lib/neander/types";
import { todayStr, formatDateKo } from "@/lib/neander/format";
import { PrepDocsSection } from "@/components/neander/PrepDocsSection";

const DEFAULT_CATEGORY: TaskCategory = "etc";

interface ActionDraft {
  key: string;
  id?: string; // 기존 액션플랜 id (수정 시)
  taskIds: Record<string, string>; // assigneeId → 연결된 일일업무 id
  text: string;
  category: TaskCategory;
  detail: string;
  assigneeIds: string[]; // 복수 담당자
  dueDate: string;
}

/** 자료 링크 입력 행 */
interface LinkDraft {
  key: string;
  label: string;
  url: string;
}

type MemberLite = { id: string; name: string; color?: string; avatar?: string };

/** "/neander/…" 내부 경로와 프로토콜 있는 URL 은 그대로, 그 외에는 https:// 를 붙인다 */
function normalizeLinkUrl(u: string): string {
  const t = u.trim();
  if (t.startsWith("/") || /^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

let _seq = 0;
function newDraft(): ActionDraft {
  _seq += 1;
  return {
    key: `d${_seq}`,
    text: "",
    category: DEFAULT_CATEGORY,
    detail: "",
    assigneeIds: [],
    taskIds: {},
    dueDate: "",
  };
}
function draftsFromMeeting(m: Meeting): ActionDraft[] {
  const ds = m.actionItems.map((a) => {
    _seq += 1;
    // 복수(신규) 우선, 없으면 단수(레거시)에서 정규화
    const assigneeIds = a.assigneeIds ?? (a.assigneeId ? [a.assigneeId] : []);
    const taskIds =
      a.taskIds ?? (a.taskId && a.assigneeId ? { [a.assigneeId]: a.taskId } : {});
    return {
      key: `e${_seq}`,
      id: a.id,
      taskIds,
      text: a.text,
      category: a.category ?? DEFAULT_CATEGORY,
      detail: a.detail ?? "",
      assigneeIds,
      dueDate: a.dueDate ?? "",
    };
  });
  return ds.length ? ds : [newDraft()];
}

/** 표 셀 위 정렬 — Td 기본 align-middle 을 인라인으로 덮는다 (여러 줄 액션 내용) */
const TOP = { verticalAlign: "top" } as const;

type Mode = { kind: "idle" } | { kind: "read"; id: string } | { kind: "edit"; id: string } | { kind: "new" };

export default function MeetingsPage() {
  const { members } = useAppData();
  const confirm = useConfirm();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [mode, setMode] = useState<Mode>({ kind: "idle" });

  useEffect(() => subscribeMeetings(setMeetings), []);

  const memberColor = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach((m) => map.set(m.id, m.color ?? "#71717a"));
    return (id: string) => map.get(id) ?? "#71717a";
  }, [members]);

  const selectedId = mode.kind === "read" || mode.kind === "edit" ? mode.id : null;
  const selected = selectedId ? meetings.find((m) => m.id === selectedId) ?? null : null;

  // 선택한 회의록이 (다른 곳에서) 지워지면 목록으로
  useEffect(() => {
    if (selectedId && meetings.length > 0 && !meetings.some((m) => m.id === selectedId)) {
      setMode({ kind: "idle" });
    }
  }, [meetings, selectedId]);

  async function remove(m: Meeting) {
    const ok = await confirm({
      title: "이 회의록을 삭제할까요?",
      message: "이미 등록된 일일업무는 그대로 유지됩니다.",
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (!ok) return;
    await deleteMeeting(m.id);
    setMode({ kind: "idle" });
  }

  // 모바일: 문서/편집이 열려 있으면 목록을 숨긴다
  const showDoc = mode.kind !== "idle";

  return (
    <div>
      <PageHeader
        title="회의록"
        description="회의 내용을 정리하고, 액션플랜을 담당자·마감기한과 함께 기록합니다. 담당자가 지정된 액션플랜은 해당 담당자의 일일업무에 자동 등록됩니다."
        actions={
          <Button icon={Plus} onClick={() => setMode({ kind: "new" })}>
            새 회의록
          </Button>
        }
      />

      <PrepDocsSection members={members} />

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* 왼쪽: 회의록 목록 */}
        <Card padding="none" className={cn("self-start lg:sticky lg:top-4", showDoc && "hidden lg:block")}>
          <div className="flex items-baseline justify-between px-4 pb-2 pt-4">
            <h2 className="text-nd-section text-nd-fg">회의록</h2>
            <span className="nd-num text-nd-caption text-nd-fg-3">{meetings.length}건</span>
          </div>
          {meetings.length === 0 ? (
            <div className="px-4 pb-4">
              <EmptyState
                compact
                icon={FileText}
                title="작성된 회의록이 없습니다"
                description="오른쪽 위 ‘새 회의록’으로 첫 회의록을 작성하세요."
              />
            </div>
          ) : (
            <ul className="nd-scroll max-h-[calc(100dvh-var(--nd-topbar-h)-12rem)] divide-y divide-nd-line overflow-y-auto border-t border-nd-line">
              {meetings.map((m) => {
                const active = m.id === selectedId;
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => setMode({ kind: "read", id: m.id })}
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "flex w-full min-h-[44px] flex-col gap-0.5 px-4 py-2.5 text-left transition-colors duration-nd-fast",
                        active ? "bg-nd-accent-soft" : "hover:bg-nd-fg/[.04]",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span className={cn("nd-num text-nd-caption", active ? "text-nd-accent-strong" : "text-nd-fg-3")}>
                          {formatDateKo(m.date)}
                        </span>
                        {m.actionItems.length > 0 && (
                          <span className="nd-num ml-auto text-nd-micro font-normal text-nd-fg-3">
                            액션 {m.actionItems.length}
                          </span>
                        )}
                      </span>
                      <span
                        className={cn("truncate text-nd-body", active ? "font-semibold text-nd-fg" : "font-medium text-nd-fg")}
                        title={m.title || undefined}
                      >
                        {m.title || "제목 없음"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* 오른쪽: 읽기 / 편집 */}
        <div className={cn("min-w-0", !showDoc && "hidden lg:block")}>
          {mode.kind === "new" ? (
            <MeetingEditor
              members={members}
              onDone={() => setMode({ kind: "idle" })}
              onBack={() => setMode({ kind: "idle" })}
            />
          ) : mode.kind === "edit" && selected ? (
            <MeetingEditor
              key={selected.id}
              members={members}
              initial={selected}
              onDone={() => setMode({ kind: "read", id: selected.id })}
              onBack={() => setMode({ kind: "read", id: selected.id })}
            />
          ) : selected ? (
            <MeetingReader
              meeting={selected}
              memberColor={memberColor}
              onEdit={() => setMode({ kind: "edit", id: selected.id })}
              onRemove={() => remove(selected)}
              onBack={() => setMode({ kind: "idle" })}
            />
          ) : (
            <EmptyState
              icon={FileText}
              title="회의록을 선택하세요"
              description="왼쪽 목록에서 회의록을 고르면 여기에 내용이 펼쳐집니다."
              action={
                <Button variant="secondary" icon={Plus} onClick={() => setMode({ kind: "new" })}>
                  새 회의록 작성
                </Button>
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ---- 읽기 ---------------------------------------------------
function MeetingReader({
  meeting,
  memberColor,
  onEdit,
  onRemove,
  onBack,
}: {
  meeting: Meeting;
  memberColor: (id: string) => string;
  onEdit: () => void;
  onRemove: () => void;
  onBack: () => void;
}) {
  return (
    <article className="mx-auto w-full max-w-3xl">
      <div className="mb-4 flex items-start gap-2">
        <IconButton icon={ArrowLeft} label="목록으로" onClick={onBack} className="-ml-2 mt-0.5 lg:hidden" />
        <div className="min-w-0 flex-1">
          <p className="nd-num text-nd-caption font-medium text-nd-fg-3">{formatDateKo(meeting.date)}</p>
          <h2 className="mt-0.5 text-nd-title text-nd-fg">{meeting.title || "제목 없음"}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="secondary" size="sm" icon={Pencil} onClick={onEdit}>
            수정
          </Button>
          <IconButton icon={Trash2} label="회의록 삭제" size="sm" onClick={onRemove} className="hover:text-nd-danger" />
        </div>
      </div>

      {(meeting.links?.length ?? 0) > 0 && (
        <div className="mb-5 flex flex-wrap gap-1.5">
          {meeting.links!.map((l, i) => (
            <MeetingLinkChip key={`${l.url}-${i}`} link={l} />
          ))}
        </div>
      )}

      {meeting.content ? (
        <p className="whitespace-pre-wrap text-nd-body leading-relaxed text-nd-fg">{meeting.content}</p>
      ) : (
        <p className="text-nd-body text-nd-fg-3">회의 내용이 없습니다.</p>
      )}

      {meeting.actionItems.length > 0 && (
        <section className="mt-6 border-t border-nd-line pt-5">
          <SectionHeader title="액션플랜" hint={`${meeting.actionItems.length}건`} />
          <TableScroll>
            <Table minWidth={640}>
              <thead>
                <tr>
                  <Th>내용</Th>
                  <Th>분류</Th>
                  <Th>담당자</Th>
                  <Th>마감</Th>
                  <Th>일일업무</Th>
                </tr>
              </thead>
              <tbody>
                {meeting.actionItems.map((a) => {
                  const ids = a.assigneeIds ?? (a.assigneeId ? [a.assigneeId] : []);
                  const names = a.assigneeNames ?? (a.assigneeName ? [a.assigneeName] : []);
                  const linked = (a.taskIds && Object.keys(a.taskIds).length > 0) || !!a.taskId;
                  return (
                    <Tr key={a.id}>
                      <Td style={TOP}>
                        <span className="text-nd-fg">{a.text}</span>
                        {a.detail && (
                          <p className="mt-0.5 whitespace-pre-wrap text-nd-caption text-nd-fg-2">{a.detail}</p>
                        )}
                      </Td>
                      <Td style={TOP}>
                        {a.category && (
                          <Badge size="sm" color={taskCategoryColor(a.category)}>
                            {taskCategoryLabel(a.category)}
                          </Badge>
                        )}
                      </Td>
                      <Td style={TOP}>
                        {ids.length > 0 ? (
                          <span className="flex flex-wrap gap-1">
                            {ids.map((id, i) => (
                              <Badge key={id} size="sm" color={memberColor(id)}>
                                {names[i] ?? ""}
                              </Badge>
                            ))}
                          </span>
                        ) : (
                          <span className="text-nd-fg-3">미지정</span>
                        )}
                      </Td>
                      <Td className="nd-num whitespace-nowrap" style={TOP} muted={!a.dueDate}>
                        {a.dueDate ? formatDateKo(a.dueDate) : "—"}
                      </Td>
                      <Td style={TOP}>
                        {linked ? (
                          <span className="inline-flex items-center gap-1 text-nd-success-text">
                            <Icon icon={CalendarCheck} size={13} />
                            등록됨
                          </span>
                        ) : (
                          <span className="text-nd-fg-3">—</span>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </TableScroll>
        </section>
      )}
    </article>
  );
}

/** 회의록 자료 링크 칩 — 내부 경로("/…")는 같은 탭, 외부 URL은 새 탭 */
function MeetingLinkChip({ link }: { link: MeetingLink }) {
  const className =
    "inline-flex h-7 items-center gap-1 rounded-[8px] border border-nd-accent/30 bg-nd-accent-soft px-2.5 text-nd-caption font-medium text-nd-accent-strong transition-colors duration-nd-fast hover:bg-nd-accent/20";
  const label = (
    <>
      <Icon icon={Link2} size={12} />
      <span className="max-w-[180px] truncate">{link.label}</span>
    </>
  );
  return link.url.startsWith("/") ? (
    <Link href={link.url} className={className} title={link.label}>
      {label}
    </Link>
  ) : (
    <a href={link.url} target="_blank" rel="noreferrer" className={className} title={link.label}>
      {label}
    </a>
  );
}

// ---- 편집 ---------------------------------------------------
function MeetingEditor({
  members,
  initial,
  onDone,
  onBack,
}: {
  members: MemberLite[];
  initial?: Meeting;
  onDone?: () => void;
  onBack?: () => void;
}) {
  const toast = useToast();
  const isEdit = Boolean(initial);
  const [date, setDate] = useState(initial?.date ?? todayStr());
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [drafts, setDrafts] = useState<ActionDraft[]>(
    initial ? draftsFromMeeting(initial) : [newDraft()],
  );
  const [linkDrafts, setLinkDrafts] = useState<LinkDraft[]>(
    initial?.links?.map((l) => {
      _seq += 1;
      return { key: `l${_seq}`, label: l.label, url: l.url };
    }) ?? [],
  );
  const [saving, setSaving] = useState(false);

  function updateLink(key: string, patch: Partial<LinkDraft>) {
    setLinkDrafts((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function addLinkRow() {
    _seq += 1;
    setLinkDrafts((ls) => [...ls, { key: `l${_seq}`, label: "", url: "" }]);
  }
  function removeLinkRow(key: string) {
    setLinkDrafts((ls) => ls.filter((l) => l.key !== key));
  }

  function updateDraft(key: string, patch: Partial<ActionDraft>) {
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }
  function toggleAssignee(key: string, id: string) {
    setDrafts((ds) =>
      ds.map((d) =>
        d.key === key
          ? {
              ...d,
              assigneeIds: d.assigneeIds.includes(id)
                ? d.assigneeIds.filter((x) => x !== id)
                : [...d.assigneeIds, id],
            }
          : d,
      ),
    );
  }
  function addRow() {
    setDrafts((ds) => [...ds, newDraft()]);
  }
  function removeRow(key: string) {
    setDrafts((ds) => (ds.length === 1 ? ds : ds.filter((d) => d.key !== key)));
  }

  function resetForCreate() {
    setTitle("");
    setContent("");
    setDrafts([newDraft()]);
    setLinkDrafts([]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim() && drafts.every((d) => !d.text.trim())) {
      toast.error("회의 내용 또는 액션플랜을 하나 이상 입력하세요.");
      return;
    }
    setSaving(true);
    try {
      const items: ActionItem[] = [];
      let idx = 0;
      for (const d of drafts) {
        if (!d.text.trim()) continue;
        idx += 1;
        const dueDate = emptyToUndef(d.dueDate);
        const text = d.text.trim();
        const detail = emptyToUndef(d.detail);

        // 일일업무에 들어갈 상세: 사용자 세부사항 + 회의록 출처 표기
        const taskDetail = detail
          ? `${detail}\n(회의록 ${date} 액션플랜)`
          : `회의록(${date}) 액션플랜`;

        // 선택된 담당자(현존 팀원만)
        const assignees = d.assigneeIds
          .map((id) => members.find((m) => m.id === id))
          .filter((m): m is { id: string; name: string } => Boolean(m));

        // 담당자별 일일업무 동기화: 기존 연결은 갱신, 신규는 추가, 빠진 담당자는 삭제
        const prevTaskIds = d.taskIds ?? {};
        const nextTaskIds: Record<string, string> = {};
        for (const a of assignees) {
          const existing = prevTaskIds[a.id];
          if (existing) {
            await updateTask(existing, {
              memberId: a.id,
              memberName: a.name,
              date: dueDate || date,
              category: d.category,
              title: text,
              detail: taskDetail,
            });
            nextTaskIds[a.id] = existing;
          } else {
            nextTaskIds[a.id] = await addTask({
              memberId: a.id,
              memberName: a.name,
              date: dueDate || date,
              category: d.category,
              title: text,
              detail: taskDetail,
              status: "todo",
            });
          }
        }
        // 담당자에서 빠진 사람의 일일업무는 제거
        for (const [aid, tid] of Object.entries(prevTaskIds)) {
          if (!nextTaskIds[aid]) await deleteTask(tid).catch(() => {});
        }

        // undefined 필드는 넣지 않는다 (Firestore는 배열 내부 undefined 거부)
        const item: ActionItem = {
          id: d.id ?? `${Date.now().toString(36)}-${idx}`,
          text,
          category: d.category,
          assigneeIds: assignees.map((a) => a.id),
          assigneeNames: assignees.map((a) => a.name),
        };
        if (detail) item.detail = detail;
        if (dueDate) item.dueDate = dueDate;
        if (Object.keys(nextTaskIds).length) item.taskIds = nextTaskIds;
        items.push(item);
      }

      // 자료 링크: URL 이 있는 행만 저장, 라벨 비면 URL 로 대체
      const links: MeetingLink[] = linkDrafts
        .filter((l) => l.url.trim())
        .map((l) => ({
          label: l.label.trim() || l.url.trim(),
          url: normalizeLinkUrl(l.url),
        }));

      const payload = {
        date,
        title: emptyToUndef(title),
        content: content.trim(),
        actionItems: items,
        links: links.length ? links : undefined,
      };

      if (isEdit && initial) {
        await updateMeeting(initial.id, payload);
        toast.success("회의록을 수정했습니다");
        onDone?.();
      } else {
        await addMeeting(payload);
        toast.success("회의록을 저장했습니다");
        resetForCreate();
        onDone?.();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mx-auto w-full max-w-3xl">
      <div className="mb-4 flex items-center gap-2">
        {onBack && <IconButton icon={ArrowLeft} label="돌아가기" onClick={onBack} className="-ml-2 lg:hidden" />}
        <h2 className="text-nd-section text-nd-fg">{isEdit ? "회의록 수정" : "새 회의록"}</h2>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="회의 날짜" required>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="제목" hint="선택 입력">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 6월 정기회의" />
          </Field>
        </div>

        <Field label="회의 내용 정리">
          <Textarea
            rows={6}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="논의 사항, 결정 사항 등을 정리하세요."
          />
        </Field>

        {/* 자료 링크 */}
        <div className="flex flex-col gap-2">
          <span className="text-nd-caption font-medium text-nd-fg-2">
            자료 링크{" "}
            <span className="font-normal text-nd-fg-3">(선택 — 발표자료·문서를 회의록에 직접 연결)</span>
          </span>
          {linkDrafts.map((l) => (
            <div key={l.key} className="flex items-center gap-2">
              <div className="w-32 shrink-0 sm:w-36">
                <Input
                  size="sm"
                  value={l.label}
                  onChange={(e) => updateLink(l.key, { label: e.target.value })}
                  placeholder="라벨 (예: 발표자료)"
                  aria-label="링크 라벨"
                />
              </div>
              <div className="min-w-0 flex-1">
                <Input
                  size="sm"
                  value={l.url}
                  onChange={(e) => updateLink(l.key, { url: e.target.value })}
                  placeholder="https://… 또는 /neander/…"
                  aria-label="링크 주소"
                />
              </div>
              <IconButton
                icon={X}
                label="링크 삭제"
                size="sm"
                onClick={() => removeLinkRow(l.key)}
                className="text-nd-fg-3 hover:text-nd-danger"
              />
            </div>
          ))}
          <Button type="button" variant="ghost" size="sm" icon={Plus} className="self-start" onClick={addLinkRow}>
            링크 추가
          </Button>
        </div>

        {/* 액션플랜 */}
        <div className="flex flex-col gap-2">
          <span className="text-nd-caption font-medium text-nd-fg-2">액션플랜</span>

          <div className="flex flex-col gap-3">
            {drafts.map((d) => {
              const linkedCount = Object.keys(d.taskIds).length;
              return (
                <div key={d.key} className="rounded-nd-md border border-nd-line bg-nd-sunken p-3">
                  <div className="mb-2 flex min-h-[28px] items-center justify-between">
                    {linkedCount > 0 ? (
                      <span className="inline-flex items-center gap-1 text-nd-caption font-medium text-nd-success-text">
                        <Icon icon={CalendarCheck} size={13} />
                        일일업무 연결됨{linkedCount > 1 ? ` (${linkedCount})` : ""}
                      </span>
                    ) : (
                      <span />
                    )}
                    {drafts.length > 1 && (
                      <IconButton
                        icon={X}
                        label="액션플랜 삭제"
                        size="sm"
                        onClick={() => removeRow(d.key)}
                        className="text-nd-fg-3 hover:text-nd-danger"
                      />
                    )}
                  </div>
                  <Input
                    value={d.text}
                    onChange={(e) => updateDraft(d.key, { text: e.target.value })}
                    placeholder="액션 내용 (예: 신상품 입고 일정 확정)"
                    className="mb-2"
                    aria-label="액션 내용"
                  />
                  <div className="mb-2">
                    <span className="mb-1 block text-nd-caption font-medium text-nd-fg-2">분류</span>
                    <CategoryPicker
                      value={d.category}
                      onChange={(c) => updateDraft(d.key, { category: c })}
                    />
                  </div>
                  <Textarea
                    rows={2}
                    value={d.detail}
                    onChange={(e) => updateDraft(d.key, { detail: e.target.value })}
                    placeholder="세부사항 (선택)"
                    className="mb-2"
                    aria-label="세부사항"
                  />
                  <div className="mb-2">
                    <span className="mb-1 block text-nd-caption font-medium text-nd-fg-2">
                      담당자 <span className="font-normal text-nd-fg-3">(복수 선택 가능)</span>
                    </span>
                    {members.length === 0 ? (
                      <p className="text-nd-caption text-nd-fg-3">등록된 팀원이 없습니다.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {members.map((m) => {
                          const on = d.assigneeIds.includes(m.id);
                          return (
                            <button
                              type="button"
                              key={m.id}
                              onClick={() => toggleAssignee(d.key, m.id)}
                              aria-pressed={on}
                              className={cn(
                                "flex h-ctl-sm items-center gap-1.5 rounded-[8px] border pl-1.5 pr-2.5 text-[13px] transition-colors duration-nd-fast",
                                on
                                  ? "border-nd-accent bg-nd-accent-soft text-nd-accent-strong"
                                  : "border-nd-border bg-nd-content text-nd-fg-2 hover:bg-nd-fg/[.04]",
                              )}
                            >
                              <MemberAvatar
                                name={m.name}
                                color={m.color}
                                avatar={m.avatar}
                                className="h-5 w-5 text-[10px]"
                              />
                              {m.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div>
                    <span className="mb-1 block text-nd-caption font-medium text-nd-fg-2">마감일</span>
                    <Input
                      type="date"
                      value={d.dueDate}
                      onChange={(e) => updateDraft(d.key, { dueDate: e.target.value })}
                      aria-label="마감일"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <Button type="button" variant="ghost" size="sm" icon={Plus} className="self-start" onClick={addRow}>
            액션플랜 추가
          </Button>
          <p className="text-nd-caption text-nd-fg-3">
            담당자를 지정한 항목은 저장 시 해당 담당자의 일일업무(마감일 또는 회의 날짜)에 자동 등록·갱신됩니다.
          </p>
        </div>

        <div className="flex gap-2 border-t border-nd-line pt-4">
          <Button type="submit" disabled={saving} loading={saving} className="flex-1">
            {saving ? "저장 중…" : isEdit ? "수정 저장" : "회의록 저장"}
          </Button>
          {onBack && (
            <Button type="button" variant="secondary" onClick={onBack} disabled={saving}>
              취소
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}
