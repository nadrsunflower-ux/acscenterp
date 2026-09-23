"use client";

import { useMemo, useState } from "react";
import { Bell, CalendarPlus, Check, Mail, Pencil, UserX } from "lucide-react";
import { useAppData } from "@/components/neander/app-data";
import { useChat } from "@/components/neander/chat";
import { dmConversationId } from "@/lib/neander/db/chat";
import {
  addRequest,
  setRequestStatus,
  setRequestReply,
  acknowledgeRequest,
  nudgeRequest,
  setRequestTask,
  updateRequest,
  deleteRequest,
} from "@/lib/neander/db/requests";
import { addTask } from "@/lib/neander/db/tasks";
import { emptyToUndef } from "@/lib/neander/db/helpers";
import { MailChip } from "@/components/neander/mail/MailChip";
import {
  Button,
  Card,
  CountBadge,
  Field,
  Icon,
  Input,
  Textarea,
  PageHeader,
  Badge,
  EmptyState,
  MemberAvatar,
  CategoryPicker,
  SegmentedControl,
  useConfirm,
  useToast,
  cn,
  type Tone,
} from "@/components/neander/ui";
import {
  RECEIVED_STATUS_ACTIONS,
  requestStatusLabel,
  taskCategoryLabel,
  taskCategoryColor,
  type RequestStatus,
  type TaskCategory,
  type WorkRequest,
} from "@/lib/neander/types";
import {
  formatDateKo,
  formatTimestamp,
  isOverdue,
  todayStr,
  weekKey,
  weekRangeLabel,
} from "@/lib/neander/format";

const STATUS_TONE: Record<RequestStatus, Tone> = {
  requested: "accent",
  in_progress: "info",
  done: "success",
  on_hold: "warning",
};

type MemberLite = { id: string; name: string; color?: string; avatar?: string };

// 요청 목록을 주(week)별로 묶어 최신 주가 위로 오도록 정렬
function groupByWeek(list: WorkRequest[]) {
  const map = new Map<string, WorkRequest[]>();
  for (const r of list) {
    const k = weekKey(r.createdAt);
    const arr = map.get(k);
    if (arr) arr.push(r);
    else map.set(k, [r]);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, items]) => ({
      key,
      label: weekRangeLabel(items[0].createdAt),
      items: [...items].sort((a, b) => b.createdAt - a.createdAt),
    }));
}

/** 받는 사람 선택 — 아바타 칸 (등록·수정 폼 공용) */
function RecipientPicker({
  members,
  value,
  onChange,
}: {
  members: MemberLite[];
  value: string;
  onChange: (id: string) => void;
}) {
  if (members.length === 0) {
    return <p className="text-nd-caption text-nd-fg-3">등록된 다른 팀원이 없습니다.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="받는 사람">
      {members.map((m) => {
        const selected = value === m.id;
        return (
          <button
            type="button"
            key={m.id}
            onClick={() => onChange(m.id)}
            aria-pressed={selected}
            className={cn(
              "flex w-16 flex-col items-center gap-1 rounded-nd-md border p-2 transition-colors duration-nd-fast",
              selected ? "border-nd-accent bg-nd-accent-soft" : "border-nd-line hover:bg-nd-sunken",
            )}
          >
            <MemberAvatar name={m.name} color={m.color} avatar={m.avatar} className="h-9 w-9 text-base" />
            <span className="w-full truncate text-center text-nd-caption text-nd-fg-2" title={m.name}>
              {m.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function RequestsPage() {
  const { requests, members, currentMember } = useAppData();
  const [tab, setTab] = useState<"received" | "sent">("received");

  const received = useMemo(
    () => requests.filter((r) => r.toId === currentMember?.id),
    [requests, currentMember],
  );
  const sent = useMemo(
    () => requests.filter((r) => r.fromId === currentMember?.id),
    [requests, currentMember],
  );

  const list = tab === "received" ? received : sent;
  const grouped = useMemo(() => groupByWeek(list), [list]);
  const unacked = received.filter((r) => !r.acknowledged).length;

  if (!currentMember) {
    return (
      <div>
        <PageHeader title="업무요청" description="구성원에게 업무를 요청하고 진행 상태를 추적합니다." />
        <EmptyState
          icon={UserX}
          title="로그인 계정이 팀원과 연결되어야 합니다"
          description="팀원 관리에서 본인 Google 이메일을 등록하면 요청을 주고받을 수 있습니다."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="업무요청" description="구성원에게 업무를 요청하고 진행 상태를 추적합니다." />

      <div className="grid gap-6 lg:grid-cols-[360px_1fr] [&>*]:min-w-0">
        <RequestForm members={members} me={currentMember} />

        <div className="flex flex-col gap-4">
          {/* 받은/보낸 전환 */}
          <SegmentedControl<"received" | "sent">
            fill
            ariaLabel="요청 구분"
            value={tab}
            onChange={setTab}
            options={[
              {
                value: "received",
                label: (
                  <>
                    받은 요청
                    {unacked > 0 && <CountBadge count={unacked} label={`미확인 ${unacked}건`} />}
                  </>
                ),
              },
              { value: "sent", label: "보낸 요청", hint: `${sent.length}` },
            ]}
          />

          {list.length === 0 ? (
            <EmptyState
              icon={Mail}
              title={tab === "received" ? "받은 요청이 없습니다" : "보낸 요청이 없습니다"}
            />
          ) : (
            <div className="flex flex-col gap-5">
              {grouped.map((week) => (
                <div key={week.key} className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-nd-caption font-semibold text-nd-fg-2">{week.label}</h3>
                    <span className="nd-num text-nd-micro text-nd-fg-3">· {week.items.length}건</span>
                    <div className="h-px flex-1 bg-nd-line" />
                  </div>
                  {week.items.map((r) => (
                    <RequestCard key={r.id} req={r} mode={tab} members={members} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RequestCard({
  req,
  mode,
  members,
}: {
  req: WorkRequest;
  mode: "received" | "sent";
  members: MemberLite[];
}) {
  const { send } = useChat();
  const toast = useToast();
  const confirm = useConfirm();
  const done = req.status === "done";
  const overdue = !done && isOverdue(req.dueDate);
  const [reply, setReply] = useState(req.replyMessage ?? "");
  const [savingReply, setSavingReply] = useState(false);
  const [nudging, setNudging] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [editing, setEditing] = useState(false);

  const replyDirty = reply.trim() !== (req.replyMessage ?? "").trim();
  const nudgeCount = req.nudgeCount ?? 0;

  // 받은 요청 → 마감일(없으면 오늘) 일일업무로 등록
  async function addToDailyTasks() {
    setAddingTask(true);
    try {
      const taskId = await addTask({
        memberId: req.toId,
        memberName: req.toName,
        date: req.dueDate || todayStr(),
        category: req.category ?? "etc",
        title: req.title,
        detail: req.detail
          ? `[업무요청·${req.fromName}] ${req.detail}`
          : `${req.fromName}님의 업무요청`,
        status: "todo",
      });
      await setRequestTask(req.id, taskId);
    } finally {
      setAddingTask(false);
    }
  }

  async function saveReply() {
    setSavingReply(true);
    try {
      await setRequestReply(req.id, reply.trim());
    } finally {
      setSavingReply(false);
    }
  }

  // 압박 주기: 받은 사람과의 DM에 메시지 1건 전송 + (전송 성공 시에만) 횟수 증가
  async function nudge() {
    setNudging(true);
    try {
      const convId = dmConversationId(req.fromId, req.toId);
      const sent = await send(
        convId,
        `${req.fromName}님이 '${req.title}'에 압박을 주고 있습니다. 빠르게 처리해주세요.`,
      );
      if (!sent) {
        toast.error("메시지를 보낼 수 없습니다. 로그인 상태를 확인하고 다시 시도해주세요.");
        return;
      }
      await nudgeRequest(req.id);
    } finally {
      setNudging(false);
    }
  }

  async function remove() {
    if (!(await confirm({ title: "이 요청을 삭제할까요?", confirmLabel: "삭제", tone: "danger" }))) return;
    deleteRequest(req.id);
  }

  // 보낸 요청 수정 모드
  if (editing && mode === "sent") {
    return (
      <RequestEditForm
        req={req}
        members={members}
        onClose={() => setEditing(false)}
      />
    );
  }

  return (
    <Card className={cn(done && "ring-1 ring-nd-success/40")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[req.status]} dot>
              {requestStatusLabel(req.status)}
            </Badge>
            {req.category && (
              <Badge color={taskCategoryColor(req.category)}>{taskCategoryLabel(req.category)}</Badge>
            )}
            {overdue && <Badge tone="danger">마감 지남</Badge>}
          </div>
          <div className={cn("mt-2 text-nd-body font-semibold", done ? "text-nd-success-text" : "text-nd-fg")}>
            {req.title}
          </div>
          {req.detail && <p className="mt-1 text-nd-body text-nd-fg-2">{req.detail}</p>}
          {/* 메일에서 만든 요청이면 원본으로 가는 길 (MailChip) */}
          {req.mail && <MailChip mail={req.mail} className="mt-2" />}
          <div className="mt-2 flex flex-wrap gap-2 text-nd-caption text-nd-fg-3">
            <span>{mode === "received" ? `${req.fromName} → 나` : `나 → ${req.toName}`}</span>
            <span className="nd-num">· {formatTimestamp(req.createdAt)}</span>
            {req.dueDate && <span className="nd-num">· 마감 {formatDateKo(req.dueDate)}</span>}
          </div>
        </div>

        {/* 우측 상단 액션 */}
        <div className="flex shrink-0 items-center gap-1.5">
          {mode === "received" ? (
            req.acknowledged ? (
              <Badge tone="success">
                <Icon icon={Check} size={12} /> 확인완료
              </Badge>
            ) : (
              <Button size="sm" onClick={() => acknowledgeRequest(req.id)}>
                확인완료
              </Button>
            )
          ) : (
            <>
              <Button variant="secondary" size="sm" icon={Bell} onClick={nudge} loading={nudging}>
                압박 주기
              </Button>
              {nudgeCount > 0 && <CountBadge count={nudgeCount} label={`압박 ${nudgeCount}회`} />}
            </>
          )}
        </div>
      </div>

      {/* 받은 사람: 상태 변경 + 답장 메시지 */}
      {mode === "received" ? (
        <div className="mt-3 flex flex-col gap-3 border-t border-nd-line pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-nd-caption text-nd-fg-3">상태 변경:</span>
            {RECEIVED_STATUS_ACTIONS.map((s) => (
              <Button
                key={s.value}
                variant={req.status === s.value ? "primary" : "secondary"}
                size="sm"
                onClick={() => setRequestStatus(req.id, s.value)}
                disabled={req.status === s.value}
                aria-pressed={req.status === s.value}
              >
                {s.label}
              </Button>
            ))}
          </div>

          {/* 일일업무 추가 */}
          <div className="flex flex-wrap items-center gap-2">
            {req.taskId ? (
              <span className="inline-flex items-center gap-1 text-nd-caption font-medium text-nd-success-text">
                <Icon icon={Check} size={13} />
                일일업무 추가됨{req.dueDate ? ` · ${formatDateKo(req.dueDate)}` : " · 오늘"}
              </span>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                icon={CalendarPlus}
                onClick={addToDailyTasks}
                loading={addingTask}
              >
                {addingTask
                  ? "추가 중…"
                  : `${req.dueDate ? `${formatDateKo(req.dueDate)} ` : "오늘 "}일일업무에 추가`}
              </Button>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-nd-caption text-nd-fg-3">요청자에게 남길 메시지</span>
            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-start">
              <Textarea
                rows={2}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="예: 오늘 중으로 처리하겠습니다 / 자료가 더 필요해요"
                className="flex-1"
                aria-label="요청자에게 남길 메시지"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={saveReply}
                loading={savingReply}
                disabled={!replyDirty}
                className="self-end sm:self-start"
              >
                {savingReply ? "저장 중…" : "메시지 저장"}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        /* 보낸 사람: 상대 답장 표시 + 삭제 */
        <div className="mt-3 flex flex-col gap-3 border-t border-nd-line pt-3">
          {req.replyMessage && (
            <div className="rounded-nd-md bg-nd-sunken px-3 py-2">
              <div className="text-nd-micro font-medium text-nd-fg-3">{req.toName}님의 답장</div>
              <p className="mt-0.5 whitespace-pre-wrap text-nd-body text-nd-fg-2">{req.replyMessage}</p>
            </div>
          )}
          <div className="flex gap-1.5">
            <Button variant="secondary" size="sm" icon={Pencil} onClick={() => setEditing(true)}>
              수정
            </Button>
            <Button variant="danger" size="sm" onClick={remove}>
              요청 삭제
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function RequestEditForm({
  req,
  members,
  onClose,
}: {
  req: WorkRequest;
  members: MemberLite[];
  onClose: () => void;
}) {
  const toast = useToast();
  const others = members.filter((m) => m.id !== req.fromId);
  const [toId, setToId] = useState(req.toId);
  // 원래 분류가 없던(레거시) 요청은 빈 상태를 유지 — 임의로 '아이디'를 강제하지 않음
  const [category, setCategory] = useState<TaskCategory | undefined>(req.category);
  const [title, setTitle] = useState(req.title);
  const [detail, setDetail] = useState(req.detail ?? "");
  const [dueDate, setDueDate] = useState(req.dueDate ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!title.trim()) {
      toast.error("제목을 입력하세요.");
      return;
    }
    const to = members.find((m) => m.id === toId);
    if (!to) {
      toast.error("받는 사람을 선택하세요.");
      return;
    }
    setSaving(true);
    try {
      await updateRequest(req.id, {
        toId: to.id,
        toName: to.name,
        category,
        title: title.trim(),
        detail: emptyToUndef(detail),
        dueDate: emptyToUndef(dueDate),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="ring-2 ring-nd-accent/60">
      <h3 className="mb-3 text-nd-section text-nd-fg">요청 수정</h3>
      <div className="flex flex-col gap-4">
        <Field label="받는 사람" required>
          <RecipientPicker members={others} value={toId} onChange={setToId} />
        </Field>
        <Field label="분류" hint="비워두면 분류 없음">
          <CategoryPicker value={category} onChange={setCategory} />
        </Field>
        <Field label="요청 제목" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="상세 내용" hint="선택 입력">
          <Textarea rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} />
        </Field>
        <Field label="마감일" hint="선택">
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <div className="flex gap-2">
          <Button onClick={save} loading={saving} disabled={!title.trim()}>
            {saving ? "저장 중…" : "저장"}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            취소
          </Button>
        </div>
      </div>
    </Card>
  );
}

function RequestForm({
  members,
  me,
}: {
  members: MemberLite[];
  me: { id: string; name: string };
}) {
  const toast = useToast();
  const others = members.filter((m) => m.id !== me.id);
  const [toId, setToId] = useState("");
  const [category, setCategory] = useState<TaskCategory>("id");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const to = members.find((m) => m.id === toId);
    if (!to) {
      toast.error("받는 사람을 선택하세요.");
      return;
    }
    setSaving(true);
    try {
      await addRequest({
        fromId: me.id,
        fromName: me.name,
        toId: to.id,
        toName: to.name,
        category,
        title: title.trim(),
        detail: emptyToUndef(detail),
        dueDate: emptyToUndef(dueDate),
      });
      setToId("");
      setTitle("");
      setDetail("");
      setDueDate("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="self-start">
      <h2 className="mb-1 text-nd-section text-nd-fg">업무 요청 보내기</h2>
      <p className="mb-4 text-nd-caption text-nd-fg-3">보내는 사람: {me.name}</p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="받는 사람" required>
          <RecipientPicker members={others} value={toId} onChange={setToId} />
        </Field>
        <Field label="분류" required>
          <CategoryPicker value={category} onChange={setCategory} />
        </Field>
        <Field label="요청 제목" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 매출 자료 정리 부탁" />
        </Field>
        <Field label="상세 내용" hint="선택 입력">
          <Textarea rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} />
        </Field>
        <Field label="마감일" hint="선택">
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Button type="submit" loading={saving} disabled={!title.trim() || others.length === 0}>
          {saving ? "전송 중…" : "요청 보내기"}
        </Button>
      </form>
    </Card>
  );
}
