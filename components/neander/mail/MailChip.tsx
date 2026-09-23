"use client";

// ============================================================
//  「메일에서 옴」 칩 — 업무요청·일일업무·회의에 붙는다 (2026-09-22)
// ------------------------------------------------------------
//  누르면 그 메일을 연다 (/neander/mail?acct=…&box=…&id=…).
//  제목·보낸 사람은 문서에 함께 적혀 있어(MailRef), 그 메일함에 들어갈 수
//  없는 사람도 무엇에서 왔는지는 읽을 수 있다. 메일이 지워졌으면 열 때
//  메일 화면이 「찾지 못했습니다」로 알려 준다.
// ============================================================

import Link from "next/link";
import { Mail } from "lucide-react";
import { Icon, cn } from "@/components/neander/ui";
import { formatDateKo } from "@/lib/neander/format";
import type { MailRef } from "@/lib/neander/mail/types";

export function mailHref(ref: MailRef) {
  const q = new URLSearchParams({ box: ref.box, id: ref.id });
  if (ref.acct) q.set("acct", ref.acct);
  return `/neander/mail?${q}`;
}

export function MailChip({ mail, className }: { mail: MailRef; className?: string }) {
  const who = mail.from.name || mail.from.address;
  return (
    <Link
      href={mailHref(mail)}
      title={`${mail.subject} — ${who}`}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border border-nd-line bg-nd-sunken/60 px-2 py-0.5",
        "text-nd-micro text-nd-fg-2 transition-colors duration-nd-fast hover:border-nd-accent/40 hover:bg-nd-accent-soft hover:text-nd-accent-strong",
        className,
      )}
    >
      <Icon icon={Mail} size={11} className="shrink-0" />
      <span className="truncate">{mail.subject || "제목 없는 메일"}</span>
      <span className="nd-num shrink-0 text-nd-fg-3">
        {who} · {formatDateKo(new Date(mail.date).toISOString().slice(0, 10))}
      </span>
    </Link>
  );
}
