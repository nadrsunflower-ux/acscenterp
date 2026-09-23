"use client";

// ============================================================
//  이 메일을 업무로 — 업무요청 · 일일업무 · 회의 자료 (2026-09-22)
// ------------------------------------------------------------
//  팀 피드백 「메일 내용을 ERP 다른 화면에서도 쓰게 해 달라」.
//  협찬·제휴 제안서가 메일로 오면 지금은 사람이 제목과 내용을 옮겨 적는다.
//  그 옮겨 적기를 한 번의 손짓으로 만든다.
//
//  · 업무요청 · 일일업무는 첨부가 없어 화면에서 바로 만든다(db/requests·tasks).
//  · 회의 자료는 **첨부까지 옮겨야** 해서 서버가 한다 (api/neander/mail/handoff).
//    첨부 원본은 ERP 에 없고 메일 서버에 있다 (docs/mail.md).
//  · 만들어진 문서에는 `mail` 참조가 남아 「메일에서 옴」 칩으로 보인다 (MailChip).
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { ListChecks, Send, ListTree, ExternalLink } from "lucide-react";
import {
  Button,
  Checkbox,
  Dialog,
  Field,
  FormRow,
  Icon,
  Input,
  SegmentedControl,
  Select,
  Textarea,
  useToast,
} from "@/components/neander/ui";
import { CategoryPicker } from "@/components/neander/ui/member";
import { useAppData } from "@/components/neander/app-data";
import { addRequest } from "@/lib/neander/db/requests";
import { addTask } from "@/lib/neander/db/tasks";
import { subscribeMeetings } from "@/lib/neander/db/meetings";
import { mailToMeeting } from "@/lib/neander/mail/client";
import { formatDateKo } from "@/lib/neander/format";
import type { Meeting, TaskCategory } from "@/lib/neander/types";
import { mailRefOf, type MailDetail } from "@/lib/neander/mail/types";

type Target = "request" | "task" | "meeting";

const TARGETS = [
  { value: "request" as const, label: "업무요청" },
  { value: "task" as const, label: "일일업무" },
  { value: "meeting" as const, label: "회의 자료" },
];

const today = () => new Date().toISOString().slice(0, 10);

/**
 * 업무 설명에 넣을 만큼만 — 목록 한 줄에 들어가야 하므로 **짧게**.
 * 주소(https://…)와 `[http…]` 자국은 뺀다. 원문은 칩을 눌러 메일에서 본다.
 */
const SUMMARY_MAX = 400;
function quote(m: MailDetail): string {
  const text = (m.text?.trim() || (m.html ?? "").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/&nbsp;/g, " ")
    .replace(/\[https?:\/\/[^\]]*\]/g, " ") // 메일 본문을 글로 바꿀 때 남는 링크 자국
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  const who = m.from.name ? `${m.from.name} <${m.from.address}>` : m.from.address;
  const body = text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX).trimEnd()}…` : text;
  return `보낸 사람: ${who}\n\n${body}`.trim();
}

export function MailHandoff({
  mail,
  acct,
  onClose,
}: {
  /** 열려 있는 메일 — null 이면 창을 닫는다 */
  mail: MailDetail | null;
  /** 이 메일이 있는 메일 계정 키 */
  acct?: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const { members, currentMember } = useAppData();
  const [target, setTarget] = useState<Target>("request");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [category, setCategory] = useState<TaskCategory | undefined>();
  const [toId, setToId] = useState("");
  const [date, setDate] = useState(today());
  const [dueDate, setDueDate] = useState("");
  const [parentId, setParentId] = useState("");
  const [files, setFiles] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [meetings, setMeetings] = useState<Meeting[]>([]);

  // 메일이 바뀌면 값을 다시 채운다
  useEffect(() => {
    if (!mail) return;
    setTitle(mail.subject || "제목 없는 메일");
    setDetail(quote(mail));
    setTarget("request");
    setToId("");
    setDate(today());
    setDueDate("");
    setParentId("");
    setFiles(mail.attachments.map((a) => a.index));
  }, [mail]);

  // 회의 자료로 보낼 때만 회의 목록이 필요하다
  useEffect(() => {
    if (!mail || target !== "meeting") return;
    return subscribeMeetings(setMeetings);
  }, [mail, target]);

  const roots = useMemo(
    () => meetings.filter((m) => !m.parentId).slice(0, 40),
    [meetings],
  );
  const others = members.filter((m) => m.id !== currentMember?.id);

  if (!mail) return null;

  const ref = () => mailRefOf(mail, acct);

  async function save() {
    if (!mail || !title.trim()) return;
    setSaving(true);
    try {
      if (target === "request") {
        const to = members.find((m) => m.id === toId);
        if (!to) {
          toast.error("받는 사람을 고르세요.");
          return;
        }
        if (!currentMember) throw new Error("팀원 정보를 찾지 못했습니다.");
        await addRequest({
          fromId: currentMember.id,
          fromName: currentMember.name,
          toId: to.id,
          toName: to.name,
          title: title.trim(),
          detail: detail.trim() || undefined,
          category,
          dueDate: dueDate || undefined,
          mail: ref(),
        });
        toast.success(`「${to.name}」 님에게 업무요청을 보냈습니다`);
      } else if (target === "task") {
        const who = members.find((m) => m.id === (toId || currentMember?.id));
        if (!who) throw new Error("담당자를 찾지 못했습니다.");
        await addTask({
          memberId: who.id,
          memberName: who.name,
          date,
          category: category ?? "etc",
          title: title.trim(),
          detail: detail.trim() || undefined,
          status: "todo",
          sourceType: "mail",
          mail: ref(),
        });
        toast.success(`${who.name} 님의 ${formatDateKo(date)} 일일업무로 넣었습니다`);
      } else {
        const res = await mailToMeeting({
          acct,
          box: ref().box,
          id: mail.id,
          parentId: parentId || undefined,
          date,
          title: title.trim(),
          attachments: files,
        });
        const where = parentId ? "자료로" : "회의로";
        toast.success(
          `회의록에 ${where} 옮겼습니다${res.files ? ` · 첨부 ${res.files}개` : ""}`,
          {
            action: {
              label: "열기",
              onClick: () => window.open(`/neander/meetings?id=${res.meetingId}`, "_self"),
            },
          },
        );
        if (res.skipped.length > 0) {
          toast.error(`첨부 ${res.skipped.length}개는 옮기지 못했습니다 — ${res.skipped[0].reason}`);
        }
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "알 수 없는 오류", { title: "옮기지 못했어요" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="이 메일을 업무로"
      description="제목·내용이 그대로 옮겨지고, 만들어진 곳에는 이 메일로 가는 링크가 남습니다."
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            닫기
          </Button>
          <Button
            icon={target === "request" ? Send : target === "task" ? ListChecks : ListTree}
            loading={saving}
            disabled={saving || !title.trim()}
            onClick={() => void save()}
          >
            {target === "request" ? "업무요청 보내기" : target === "task" ? "일일업무로 넣기" : "회의록으로 옮기기"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <SegmentedControl
          value={target}
          onChange={(v) => setTarget(v as Target)}
          options={TARGETS}
          ariaLabel="어디로 보낼지"
        />

        <Field label="제목" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full" />
        </Field>

        {target === "request" && (
          <FormRow>
            <Field label="받는 사람" required>
              <Select value={toId} onChange={(e) => setToId(e.target.value)} className="w-full">
                <option value="">고르세요</option>
                {others.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="마감일">
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full" />
            </Field>
          </FormRow>
        )}

        {target === "task" && (
          <FormRow>
            <Field label="담당자">
              <Select value={toId} onChange={(e) => setToId(e.target.value)} className="w-full">
                <option value="">{currentMember?.name ?? "나"}</option>
                {others.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="날짜">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full" />
            </Field>
          </FormRow>
        )}

        {target === "meeting" ? (
          <>
            <FormRow>
              <Field label="어느 회의에" hint="고르면 그 회의의 자료가 됩니다">
                <Select value={parentId} onChange={(e) => setParentId(e.target.value)} className="w-full">
                  <option value="">따로 선 회의로 만들기</option>
                  {roots.map((m) => (
                    <option key={m.id} value={m.id}>
                      {formatDateKo(m.date)} · {m.title || "제목 없는 회의"}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="날짜">
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full" />
              </Field>
            </FormRow>
            {mail.attachments.length > 0 && (
              <Field label={`첨부 ${mail.attachments.length}개`} hint="고른 것만 회의 첨부로 옮깁니다">
                <div className="flex flex-col gap-1.5">
                  {mail.attachments.map((a) => (
                    <Checkbox
                      key={a.index}
                      checked={files.includes(a.index)}
                      onChange={(e) =>
                        setFiles((v) => (e.target.checked ? [...v, a.index] : v.filter((n) => n !== a.index)))
                      }
                      label={`${a.name} · ${Math.max(1, Math.round((a.size ?? 0) / 1024))}KB`}
                    />
                  ))}
                </div>
              </Field>
            )}
            <p className="flex items-start gap-1.5 text-nd-caption text-nd-fg-3">
              <Icon icon={ExternalLink} size={13} className="mt-0.5 shrink-0" />
              본문은 회의록 글로 들어갑니다. 회의록에서 고쳐 쓸 수 있습니다.
            </p>
          </>
        ) : (
          <>
            <Field label="분류">
              <CategoryPicker value={category} onChange={setCategory} />
            </Field>
            <Field label="내용" hint="메일 본문을 가져왔습니다 — 고쳐도 됩니다">
              <Textarea
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                rows={6}
                className="w-full"
              />
            </Field>
          </>
        )}
      </div>
    </Dialog>
  );
}
