"use client";

import { useMemo, useState } from "react";
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
  deleteRequest,
} from "@/lib/neander/db/requests";
import { addTask } from "@/lib/neander/db/tasks";
import { emptyToUndef } from "@/lib/neander/db/helpers";
import {
  Button,
  Card,
  Field,
  Input,
  Textarea,
  PageHeader,
  Badge,
  EmptyState,
  MemberAvatar,
  CategoryPicker,
  cn,
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

const STATUS_COLOR: Record<RequestStatus, string> = {
  requested: "#ea580c",
  in_progress: "#2563eb",
  done: "#16a34a",
  on_hold: "#ca8a04",
};

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

  if (!currentMember) {
    return (
      <div>
        <PageHeader title="업무요청" description="구성원에게 업무를 요청하고 진행 상태를 추적합니다." />
        <EmptyState
          icon="👤"
          title="로그인 계정이 팀원과 연결되어야 합니다"
          description="팀원 관리에서 본인 Google 이메일을 등록하면 요청을 주고받을 수 있습니다."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="업무요청" description="구성원에게 업무를 요청하고 진행 상태를 추적합니다." />

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <RequestForm members={members} me={currentMember} />

        <div className="flex flex-col gap-4">
          {/* 탭 */}
          <div className="flex gap-1 rounded-lg border border-zinc-200 bg-white p-1">
            <TabBtn active={tab === "received"} onClick={() => setTab("received")}>
              받은 요청
              {received.filter((r) => !r.acknowledged).length > 0 && (
                <span className="ml-1.5 rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                  {received.filter((r) => !r.acknowledged).length}
                </span>
              )}
            </TabBtn>
            <TabBtn active={tab === "sent"} onClick={() => setTab("sent")}>
              보낸 요청 ({sent.length})
            </TabBtn>
          </div>

          {list.length === 0 ? (
            <EmptyState
              icon="✉️"
              title={tab === "received" ? "받은 요청이 없습니다" : "보낸 요청이 없습니다"}
            />
          ) : (
            <div className="flex flex-col gap-5">
              {grouped.map((week) => (
                <div key={week.key} className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-semibold text-zinc-500">{week.label}</h3>
                    <span className="text-[10px] text-zinc-400">· {week.items.length}건</span>
                    <div className="h-px flex-1 bg-zinc-100" />
                  </div>
                  {week.items.map((r) => (
                    <RequestCard key={r.id} req={r} mode={tab} />
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

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "flex flex-1 items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition " +
        (active ? "bg-indigo-50 text-indigo-700" : "text-zinc-500 hover:bg-zinc-50")
      }
    >
      {children}
    </button>
  );
}

function RequestCard({ req, mode }: { req: WorkRequest; mode: "received" | "sent" }) {
  const { send } = useChat();
  const done = req.status === "done";
  const overdue = !done && isOverdue(req.dueDate);
  const [reply, setReply] = useState(req.replyMessage ?? "");
  const [savingReply, setSavingReply] = useState(false);
  const [nudging, setNudging] = useState(false);
  const [addingTask, setAddingTask] = useState(false);

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
        alert("메시지를 보낼 수 없습니다. 로그인 상태를 확인하고 다시 시도해주세요.");
        return;
      }
      await nudgeRequest(req.id);
    } finally {
      setNudging(false);
    }
  }

  return (
    <Card className={done ? "!border-green-400 !bg-green-50" : ""}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge color={STATUS_COLOR[req.status]}>{requestStatusLabel(req.status)}</Badge>
            {req.category && (
              <Badge color={taskCategoryColor(req.category)}>{taskCategoryLabel(req.category)}</Badge>
            )}
            {overdue && <Badge color="#dc2626">마감 지남</Badge>}
          </div>
          <div className={cn("mt-2 text-sm font-semibold", done ? "text-green-700" : "text-zinc-900")}>
            {req.title}
          </div>
          {req.detail && <p className="mt-1 text-sm text-zinc-600">{req.detail}</p>}
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-400">
            <span>{mode === "received" ? `${req.fromName} → 나` : `나 → ${req.toName}`}</span>
            <span>· {formatTimestamp(req.createdAt)}</span>
            {req.dueDate && <span>· 마감 {formatDateKo(req.dueDate)}</span>}
          </div>
        </div>

        {/* 우측 상단 액션 */}
        <div className="flex shrink-0 items-center gap-1.5">
          {mode === "received" ? (
            req.acknowledged ? (
              <span className="text-xs font-medium text-green-600">✓ 확인완료</span>
            ) : (
              <Button
                className="!px-2.5 !py-1 !text-xs"
                onClick={() => acknowledgeRequest(req.id)}
              >
                확인완료
              </Button>
            )
          ) : (
            <>
              <Button
                variant="secondary"
                className="!px-2.5 !py-1 !text-xs"
                onClick={nudge}
                disabled={nudging}
              >
                🔔 압박 주기
              </Button>
              {nudgeCount > 0 && (
                <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {nudgeCount}
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* 받은 사람: 상태 변경 + 답장 메시지 */}
      {mode === "received" ? (
        <div className="mt-3 flex flex-col gap-3 border-t border-zinc-100 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-zinc-400">상태 변경:</span>
            {RECEIVED_STATUS_ACTIONS.map((s) => (
              <Button
                key={s.value}
                variant={req.status === s.value ? "primary" : "secondary"}
                className="!px-2.5 !py-1 !text-xs"
                onClick={() => setRequestStatus(req.id, s.value)}
                disabled={req.status === s.value}
              >
                {s.label}
              </Button>
            ))}
          </div>

          {/* 일일업무 추가 */}
          <div className="flex flex-wrap items-center gap-2">
            {req.taskId ? (
              <span className="text-xs font-medium text-emerald-600">
                ✓ 일일업무 추가됨{req.dueDate ? ` · ${formatDateKo(req.dueDate)}` : " · 오늘"}
              </span>
            ) : (
              <Button
                variant="secondary"
                className="!px-2.5 !py-1 !text-xs"
                onClick={addToDailyTasks}
                disabled={addingTask}
              >
                {addingTask
                  ? "추가 중…"
                  : `📅 ${req.dueDate ? `${formatDateKo(req.dueDate)} ` : "오늘 "}일일업무에 추가`}
              </Button>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs text-zinc-400">요청자에게 남길 메시지</span>
            <div className="flex items-start gap-2">
              <Textarea
                rows={2}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="예: 오늘 중으로 처리하겠습니다 / 자료가 더 필요해요"
                className="flex-1"
              />
              <Button
                variant="secondary"
                className="!px-3 !py-2 !text-xs"
                onClick={saveReply}
                disabled={!replyDirty || savingReply}
              >
                {savingReply ? "저장 중…" : "메시지 저장"}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        /* 보낸 사람: 상대 답장 표시 + 삭제 */
        <div className="mt-3 flex flex-col gap-3 border-t border-zinc-100 pt-3">
          {req.replyMessage && (
            <div className="rounded-lg bg-white/70 px-3 py-2 ring-1 ring-zinc-100">
              <div className="text-[11px] font-medium text-zinc-400">{req.toName}님의 답장</div>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-zinc-700">{req.replyMessage}</p>
            </div>
          )}
          <div>
            <Button
              variant="danger"
              className="!px-2.5 !py-1 !text-xs"
              onClick={() => {
                if (confirm("이 요청을 삭제할까요?")) deleteRequest(req.id);
              }}
            >
              요청 삭제
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function RequestForm({
  members,
  me,
}: {
  members: { id: string; name: string; color?: string; avatar?: string }[];
  me: { id: string; name: string };
}) {
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
    if (!to) return alert("받는 사람을 선택하세요.");
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
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-zinc-800">업무 요청 보내기</h2>
      <p className="mb-4 text-xs text-zinc-400">보내는 사람: {me.name}</p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="받는 사람" required>
          {others.length === 0 ? (
            <p className="text-xs text-zinc-400">등록된 다른 팀원이 없습니다.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {others.map((m) => {
                const selected = toId === m.id;
                return (
                  <button
                    type="button"
                    key={m.id}
                    onClick={() => setToId(m.id)}
                    className={cn(
                      "flex w-16 flex-col items-center gap-1 rounded-xl border p-2 transition",
                      selected ? "border-indigo-500 bg-indigo-50" : "border-zinc-200 hover:bg-zinc-50",
                    )}
                  >
                    <MemberAvatar name={m.name} color={m.color} avatar={m.avatar} className="h-9 w-9 text-base" />
                    <span className="w-full truncate text-center text-xs text-zinc-700">{m.name}</span>
                  </button>
                );
              })}
            </div>
          )}
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
        <Button type="submit" disabled={saving || !title.trim() || others.length === 0}>
          {saving ? "전송 중…" : "요청 보내기"}
        </Button>
      </form>
    </Card>
  );
}
