"use client";

import { useEffect, useState } from "react";
import { useAppData } from "@/components/neander/app-data";
import { addMember, updateMember, deleteMember } from "@/lib/neander/db/members";
import { emptyToUndef } from "@/lib/neander/db/helpers";
import {
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  EmptyState,
  MemberAvatar,
} from "@/components/neander/ui";
import type { Member } from "@/lib/neander/types";

const PALETTE = ["#2563eb", "#16a34a", "#ea580c", "#9333ea", "#db2777", "#0891b2", "#ca8a04"];

// 선택 가능한 캐릭터(이모지) 목록
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
    <div className="flex max-w-[260px] flex-wrap gap-1.5">
      <button
        type="button"
        onClick={() => onChange("")}
        className={`flex h-8 w-8 items-center justify-center rounded-full border text-[10px] font-medium transition ${
          value === "" ? "border-zinc-900 bg-zinc-100 text-zinc-700" : "border-zinc-200 text-zinc-400 hover:bg-zinc-100"
        }`}
      >
        없음
      </button>
      {AVATARS.map((a) => (
        <button
          key={a}
          type="button"
          onClick={() => onChange(a)}
          className={`flex h-8 w-8 items-center justify-center rounded-full border text-lg leading-none transition ${
            value === a ? "border-zinc-900 bg-zinc-100" : "border-transparent hover:bg-zinc-100"
          }`}
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
    <div className="flex flex-wrap gap-2">
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`${dim} rounded-full border-2 transition`}
          style={{ backgroundColor: c, borderColor: value === c ? "#18181b" : "transparent" }}
          aria-label={c}
        />
      ))}
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
        <h2 className="mb-4 text-sm font-semibold text-zinc-800">팀원 추가</h2>
        <form onSubmit={handleAdd} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-4">
            <Field label="이름" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 김주연"
                className="w-36"
              />
            </Field>
            <Field label="Google 이메일" hint="로그인 연결용 (선택)">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="예: name@gmail.com"
                className="w-56"
              />
            </Field>
            <Field label="역할" hint="선택 입력">
              <Input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="예: 영업, 디자인"
                className="w-36"
              />
            </Field>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? "추가 중…" : "추가하기"}
            </Button>
          </div>

          {/* 색상·캐릭터 (접이식, 기본 접힘) */}
          <button
            type="button"
            onClick={() => setShowStyle((v) => !v)}
            className="self-start text-xs font-medium text-zinc-500 hover:text-zinc-800"
          >
            색상·캐릭터 설정 {showStyle ? "▾" : "▸"}
          </button>
          {showStyle && (
            <div className="flex flex-wrap gap-8 rounded-lg bg-zinc-50 p-4">
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
        <EmptyState icon="👥" title="등록된 팀원이 없습니다" description="위에서 추가하세요." />
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
    if (!name.trim()) return alert("이름을 입력하세요.");
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
    if (!confirm(`'${member.name}' 팀원을 삭제할까요?`)) return;
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
      <Card className="flex w-full flex-col gap-3">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-zinc-500">이름</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" />
          <span className="text-xs font-medium text-zinc-500">역할</span>
          <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="역할 (선택)" />
          <span className="text-xs font-medium text-zinc-500">Google 이메일</span>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="로그인 연결용 (선택)"
          />
          <span className="text-xs font-medium text-zinc-500">색상</span>
          <ColorPalette value={color} onChange={setColor} size="sm" />
          <span className="text-xs font-medium text-zinc-500">캐릭터</span>
          <AvatarPicker value={avatar} onChange={setAvatar} />
        </div>
        <div className="flex gap-2">
          <Button className="!px-3 !py-1.5 !text-xs" onClick={save} disabled={busy || !name.trim()}>
            {busy ? "저장 중…" : "저장"}
          </Button>
          <Button
            variant="secondary"
            className="!px-3 !py-1.5 !text-xs"
            onClick={() => setEditing(false)}
            disabled={busy}
          >
            취소
          </Button>
        </div>
      </Card>
    );
  }

  // ---- 표시 모드 (캐릭터 카드) ----
  return (
    <Card className="flex w-full flex-col items-center gap-2 text-center">
      <MemberAvatar
        name={member.name}
        color={member.color}
        avatar={member.avatar}
        className="h-16 w-16 text-3xl"
      />
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-semibold text-zinc-900">{member.name}</span>
        {isMe && (
          <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
            나
          </span>
        )}
      </div>
      {member.role ? (
        <span className="text-xs text-zinc-500">{member.role}</span>
      ) : (
        <span className="text-xs text-zinc-300">역할 미지정</span>
      )}
      <span className="w-full truncate text-[11px] text-zinc-400" title={member.email ?? ""}>
        {member.email || "이메일 미등록"}
      </span>
      <div className="mt-1 flex gap-1.5">
        <button
          onClick={() => setEditing(true)}
          className="rounded-lg px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100"
        >
          수정
        </button>
        <button
          onClick={remove}
          disabled={busy}
          className="rounded-lg px-2 py-1 text-xs font-medium text-zinc-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
        >
          삭제
        </button>
      </div>
    </Card>
  );
}
