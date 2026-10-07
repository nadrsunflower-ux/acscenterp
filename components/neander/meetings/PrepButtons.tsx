"use client";

// ============================================================
//  발표 자료 버튼 — 회의 문서 머리의 「발표 자료」 줄
// ------------------------------------------------------------
//  팀원마다 버튼 하나. 링크를 걸어 둔 버튼은 누르면 새 탭으로 그 자료가
//  열리고, 아직 안 건 버튼은 눌러서 주소를 붙여 넣는다. 주소는 팀원 문서의
//  prepUrl 에 있다 — 회의마다가 아니라 사람마다 하나라, 한 번 걸면 모든 회의
//  문서에서 같은 버튼으로 열린다 (저장소가 public 이라 코드에는 적지 않는다).
//
//  건 링크를 바꾸는 연필은 본인 버튼에만 둔다. 남의 버튼까지 연필을 달면 줄이
//  어수선하고 잘못 누르기 쉽다 — 남의 것은 팀원 관리 → 수정 에서 고친다.
//  빈 버튼은 누구나 채울 수 있다 (회의 중에 화면을 잡은 사람이 대신 건다).
// ============================================================
import { useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink, Link2, Pencil, Plus } from "lucide-react";
import { useAppData } from "@/components/neander/app-data";
import { Button, Icon, Input, MemberAvatar, Popover, cn, useToast } from "@/components/neander/ui";
import { updateMember } from "@/lib/neander/db/members";
import { linkHost, normalizeLinkUrl } from "@/lib/neander/prep-docs";
import type { Member } from "@/lib/neander/types";

/** 열 수 있는 주소인가 — 내부 경로이거나, 점이 든 호스트를 가진 URL */
function isOpenable(url: string): boolean {
  if (url.startsWith("/")) return true;
  try {
    return new URL(url).hostname.includes(".");
  } catch {
    return false;
  }
}

export function PrepButtons({ className }: { className?: string }) {
  const { members, currentMember } = useAppData();
  if (members.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <span className="mr-1 text-nd-table font-medium text-nd-fg-3">발표 자료</span>
      {members.map((m) => (
        <PrepButton key={m.id} member={m} mine={m.id === currentMember?.id} />
      ))}
    </div>
  );
}

function PrepButton({ member, mine }: { member: Member; mine: boolean }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const url = member.prepUrl?.trim() ? normalizeLinkUrl(member.prepUrl) : "";
  const internal = url.startsWith("/");
  const avatar = (dim: boolean) => (
    <MemberAvatar
      name={member.name}
      color={member.color}
      avatar={member.avatar}
      className={cn("h-5 w-5 text-[11px]", dim && "opacity-60")}
    />
  );

  const hover = "transition-colors duration-nd-fast hover:bg-nd-accent-soft hover:text-nd-accent-strong";
  const linkClass = cn("inline-flex min-w-0 items-center gap-1.5 rounded-full pl-1.5", mine ? "rounded-r-none pr-2" : "pr-3", hover);
  const linkBody = (
    <>
      {avatar(false)}
      <span className="max-w-[160px] truncate">{member.name}</span>
      <Icon icon={internal ? Link2 : ExternalLink} size={13} className="shrink-0" />
    </>
  );
  const linkTitle = `${member.name} 발표 자료 열기 · ${linkHost(url)}`;

  return (
    <>
      {url ? (
        <span className="inline-flex h-8 max-w-full items-stretch rounded-full bg-nd-fg/[.05] text-nd-table font-medium text-nd-fg-2">
          {internal ? (
            <Link href={url} className={linkClass} title={linkTitle} aria-label={`${member.name} 발표 자료 열기`}>
              {linkBody}
            </Link>
          ) : (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className={linkClass}
              title={linkTitle}
              aria-label={`${member.name} 발표 자료 열기`}
            >
              {linkBody}
            </a>
          )}
          {mine && (
            <button
              ref={anchor}
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label="내 발표 자료 링크 바꾸기"
              title="내 발표 자료 링크 바꾸기"
              className={cn("inline-flex shrink-0 items-center rounded-r-full border-l border-nd-fg/10 pl-2 pr-2.5 text-nd-fg-3", hover)}
            >
              <Icon icon={Pencil} size={13} />
            </button>
          )}
        </span>
      ) : (
        <button
          ref={anchor}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`${member.name} 발표 자료 링크 걸기`}
          title={mine ? "내 발표 자료 링크 걸기" : `${member.name} — 아직 링크가 없습니다. 눌러서 걸 수 있습니다`}
          className={cn(
            "inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-dashed pl-1.5 pr-3 text-nd-table font-medium",
            hover,
            // 내 버튼은 눈에 띄게 — 채울 사람이 나다
            mine ? "border-nd-accent/50 text-nd-accent-strong" : "border-nd-border text-nd-fg-3 hover:border-nd-accent/50",
          )}
        >
          {avatar(!mine)}
          <span className="max-w-[160px] truncate">{member.name}</span>
          {mine && <span className="shrink-0">· 링크 걸기</span>}
          <Icon icon={Plus} size={13} className="shrink-0" />
        </button>
      )}
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchor}
        placement="bottom-start"
        ariaLabel={`${member.name} 발표 자료 링크`}
        unpadded
        className="w-[min(22rem,calc(100vw-2rem))] p-3.5"
      >
        <PrepLinkForm member={member} mine={mine} onDone={() => setOpen(false)} />
      </Popover>
    </>
  );
}

/** 주소 붙여 넣는 칸 — 걸기 · 바꾸기 · 빼기 */
function PrepLinkForm({ member, mine, onDone }: { member: Member; mine: boolean; onDone: () => void }) {
  const toast = useToast();
  const current = member.prepUrl?.trim() ?? "";
  const [value, setValue] = useState(current);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(raw: string) {
    const next = raw.trim() ? normalizeLinkUrl(raw) : undefined;
    if (next && !isOpenable(next)) {
      setError("주소를 다시 확인해 주세요 (예: https://example.com)");
      return;
    }
    setBusy(true);
    try {
      await updateMember(member.id, { prepUrl: next });
      toast.success(next ? `${member.name} 발표 자료 링크를 걸었습니다` : `${member.name} 발표 자료 링크를 뺐습니다`);
      onDone();
    } catch (e) {
      toast.error(`저장하지 못했습니다 — ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save(value);
      }}
      className="flex flex-col gap-2.5"
    >
      <p className="flex items-center gap-2 text-nd-body font-semibold text-nd-fg">
        <MemberAvatar name={member.name} color={member.color} avatar={member.avatar} className="h-6 w-6 text-[13px]" />
        {mine ? "내 발표 자료" : `${member.name} 발표 자료`}
      </p>
      <Input
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError("");
        }}
        inputMode="url"
        placeholder="https://… 주소 붙여넣기"
        aria-label="발표 자료 주소"
        aria-invalid={!!error}
        className="w-full"
      />
      {error ? (
        <p className="text-nd-table text-nd-danger-text" role="alert">
          {error}
        </p>
      ) : (
        <p className="text-nd-table text-nd-fg-3">한 번 걸어 두면 모든 회의 문서에서 이 버튼으로 열립니다.</p>
      )}
      <div className="flex items-center gap-2">
        {current && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void save("")}
            disabled={busy}
            className="-ml-2 hover:!text-nd-danger-text"
          >
            링크 빼기
          </Button>
        )}
        <span className="ml-auto flex gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onDone} disabled={busy}>
            취소
          </Button>
          <Button type="submit" size="sm" loading={busy} disabled={busy || !value.trim() || value.trim() === current}>
            {current ? "바꾸기" : "링크 걸기"}
          </Button>
        </span>
      </div>
    </form>
  );
}
