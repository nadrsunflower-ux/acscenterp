"use client";

import { useEffect, useState } from "react";
import { Check, ChevronRight, Pencil, Trash2, Users } from "lucide-react";
import { useAppData } from "@/components/neander/app-data";
import { addMember, updateMember, deleteMember } from "@/lib/neander/db/members";
import { emptyToUndef } from "@/lib/neander/db/helpers";
import {
  Badge,
  Button,
  Card,
  Field,
  Icon,
  Input,
  PageHeader,
  EmptyState,
  MemberAvatar,
  useConfirm,
  useToast,
  cn,
} from "@/components/neander/ui";
import type { Member } from "@/lib/neander/types";

// 팀원이 고르는 색 — 데이터에 저장되는 값이라 그대로 둔다
const PALETTE = ["#2563eb", "#16a34a", "#ea580c", "#9333ea", "#db2777", "#0891b2", "#ca8a04"];

// 선택 가능한 캐릭터(이모지) 목록 — 사용자가 고르는 데이터
const AVATARS = [
  "🐱", "🐶", "🦊", "🐰", "🐻", "🐼", "🐨", "🐯",
  "🦁", "🐸", "🐵", "🐧", "🦄", "🐙", "🐢", "🐳",
  "🦉", "🐝", "🐤", "🦋",
];

function AvatarPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (a: string) => void;
}) {
  return (
    <div className="flex max-w-[260px] flex-wrap gap-1.5" role="group" aria-label="캐릭터">
      <button
        type="button"
        onClick={() => onChange("")}
        aria-pressed={value === ""}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-full border text-nd-micro font-medium transition-colors duration-nd-fast",
          value === ""
            ? "border-nd-fg bg-nd-fg/[.06] text-nd-fg"
            : "border-nd-line text-nd-fg-3 hover:bg-nd-fg/[.06]",
        )}
      >
        없음
      </button>
      {AVATARS.map((a) => (
        <button
          key={a}
          type="button"
          onClick={() => onChange(a)}
          aria-pressed={value === a}
          aria-label={`캐릭터 ${a}`}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full border text-lg leading-none transition-colors duration-nd-fast",
            value === a ? "border-nd-fg bg-nd-fg/[.06]" : "border-transparent hover:bg-nd-fg/[.06]",
          )}
        >
          {a}
        </button>
      ))}
    </div>
  );
}

function ColorPalette({
  value,
  onChange,
  size = "md",
}: {
  value: string;
  onChange: (c: string) => void;
  size?: "sm" | "md";
}) {
  const dim = size === "sm" ? "h-5 w-5" : "h-7 w-7";
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="색상">
      {PALETTE.map((c) => {
        const on = value === c;
        return (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            aria-pressed={on}
            aria-label={`색상 ${c}`}
            className={cn(
              dim,
              "flex items-center justify-center rounded-full text-white transition-shadow duration-nd-fast",
              on && "ring-2 ring-nd-fg ring-offset-2 ring-offset-nd-content",
            )}
            style={{ backgroundColor: c }}
          >
            {on && <Icon icon={Check} size={size === "sm" ? 11 : 14} strokeWidth={2.5} />}
          </button>
        );
      })}
    </div>
  );
}

export default function MembersPage() {
  const { members, currentMember } = useAppData();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [avatar, setAvatar] = useState("");
  const [showStyle, setShowStyle] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await addMember({
        name: name.trim(),
        role: emptyToUndef(role),
        email: emptyToUndef(email)?.toLowerCase(),
        color,
        avatar: emptyToUndef(avatar),
      });
      setName("");
      setRole("");
      setEmail("");
      setColor(PALETTE[0]);
      setAvatar("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="팀원 관리"
        description="구성원을 등록합니다. Google 이메일을 입력하면 그 계정으로 로그인 시 이 팀원으로 연결됩니다."
      />

      {/* 추가 폼 (상단) */}
      <Card className="mb-6">
        <h2 className="mb-4 text-nd-section text-nd-fg">팀원 추가</h2>
        <form onSubmit={handleAdd} className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-nowrap sm:items-end sm:gap-3">
            <Field label="이름" required className="min-w-0 sm:flex-[2]">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 김주연"
              />
            </Field>
            <Field label="Google 이메일 · 선택" className="min-w-0 sm:flex-[3]">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="예: name@gmail.com"
              />
            </Field>
            <Field label="역할 · 선택" className="min-w-0 sm:flex-[2]">
              <Input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="예: 영업, 디자인"
              />
            </Field>
            <Button type="submit" loading={saving} disabled={!name.trim()} className="w-full sm:w-auto">
              {saving ? "추가 중…" : "추가하기"}
            </Button>
          </div>

          {/* 색상·캐릭터 (접이식, 기본 접힘) */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowStyle((v) => !v)}
            aria-expanded={showStyle}
            aria-controls="member-style-panel"
            className="self-start"
          >
            색상·캐릭터 설정
            <Icon
              icon={ChevronRight}
              size={14}
              className={cn("transition-transform duration-nd-fast", showStyle && "rotate-90")}
            />
          </Button>
          {showStyle && (
            <div id="member-style-panel" className="flex flex-wrap gap-8 rounded-nd-md bg-nd-sunken p-4">
              <Field label="색상">
                <ColorPalette value={color} onChange={setColor} />
              </Field>
              <Field label="캐릭터" hint="없으면 이름 첫 글자">
                <AvatarPicker value={avatar} onChange={setAvatar} />
              </Field>
            </div>
          )}
        </form>
      </Card>

      {/* 캐릭터 카드 (그리드 정렬) */}
      {members.length === 0 ? (
        <EmptyState icon={Users} title="등록된 팀원이 없습니다" description="위에서 추가하세요." />
      ) : (
        <div className="grid grid-cols-2 items-start gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {members.map((m) => (
            <MemberCard key={m.id} member={m} isMe={m.id === currentMember?.id} />
          ))}
        </div>
      )}
    </div>
  );
}

function MemberCard({ member, isMe }: { member: Member; isMe: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(member.name);
  const [role, setRole] = useState(member.role ?? "");
  const [email, setEmail] = useState(member.email ?? "");
  const [color, setColor] = useState(member.color ?? PALETTE[0]);
  const [avatar, setAvatar] = useState(member.avatar ?? "");
  const [busy, setBusy] = useState(false);

  // 원격 변경(onSnapshot)이 prop으로 내려오면 표시값 동기화 (편집 중이 아닐 때)
  useEffect(() => {
    if (editing) return;
    setName(member.name);
    setRole(member.role ?? "");
    setEmail(member.email ?? "");
    setColor(member.color ?? PALETTE[0]);
    setAvatar(member.avatar ?? "");
  }, [member.name, member.role, member.email, member.color, member.avatar, editing]);

  async function save() {
    if (!name.trim()) {
      toast.error("이름을 입력하세요.");
      return;
    }
    setBusy(true);
    try {
      await updateMember(member.id, {
        name: name.trim(),
        role: emptyToUndef(role),
        email: emptyToUndef(email)?.toLowerCase(),
        color,
        avatar: emptyToUndef(avatar),
      });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (
      !(await confirm({
        title: `'${member.name}' 팀원을 삭제할까요?`,
        confirmLabel: "삭제",
        tone: "danger",
      }))
    )
      return;
    setBusy(true);
    try {
      await deleteMember(member.id);
    } finally {
      setBusy(false);
    }
  }

  // ---- 편집 모드 ----
  if (editing) {
    return (
      <Card padding="sm" className="flex w-full flex-col gap-3 ring-2 ring-nd-accent/60">
        <div className="flex flex-col gap-3">
          <Field label="이름" required>
            <Input size="sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" />
          </Field>
          <Field label="역할">
            <Input size="sm" value={role} onChange={(e) => setRole(e.target.value)} placeholder="역할 (선택)" />
          </Field>
          <Field label="Google 이메일">
            <Input
              size="sm"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="로그인 연결용 (선택)"
            />
          </Field>
          <Field label="색상">
            <ColorPalette value={color} onChange={setColor} size="sm" />
          </Field>
          <Field label="캐릭터">
            <AvatarPicker value={avatar} onChange={setAvatar} />
          </Field>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={save} loading={busy} disabled={!name.trim()}>
            {busy ? "저장 중…" : "저장"}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setEditing(false)} disabled={busy}>
            취소
          </Button>
        </div>
      </Card>
    );
  }

  // ---- 표시 모드 (캐릭터 카드) ----
  return (
    <Card padding="sm" className="flex w-full flex-col items-center gap-2 text-center">
      <MemberAvatar
        name={member.name}
        color={member.color}
        avatar={member.avatar}
        className="h-16 w-16 text-3xl"
      />
      <div className="flex items-center gap-1.5">
        <span className="text-nd-body font-semibold text-nd-fg">{member.name}</span>
        {isMe && (
          <Badge tone="accent" size="sm">
            나
          </Badge>
        )}
      </div>
      {member.role ? (
        <span className="text-nd-caption text-nd-fg-2">{member.role}</span>
      ) : (
        <span className="text-nd-caption text-nd-fg-4">역할 미지정</span>
      )}
      <span className="w-full truncate text-nd-micro text-nd-fg-3" title={member.email ?? ""}>
        {member.email || "이메일 미등록"}
      </span>
      <div className="mt-1 flex gap-1">
        <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setEditing(true)}>
          수정
        </Button>
        <Button variant="ghost" size="sm" icon={Trash2} onClick={remove} disabled={busy} className="hover:!text-nd-danger-text">
          삭제
        </Button>
      </div>
    </Card>
  );
}
