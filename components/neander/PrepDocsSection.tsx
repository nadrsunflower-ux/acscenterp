"use client";

// ============================================================
//  회의 준비 자료 — /neander/meetings 머리의 「준비 자료」 단추
// ------------------------------------------------------------
//  lib/neander/prep-docs.ts 에 등록된 웹 발표자료(16:9 브리핑)를
//  펼침 메뉴로 보여준다. 자료 자체가 코드(슬라이드 페이지)라 배포와 함께
//  자동으로 이 목록에 나타난다.
//
//  예전에는 회의 목록 위에 카드 한 장을 통째로 차지했다(발표자 탭 +
//  자료 줄). 자료는 가끔 여는 것이고 회의록은 매번 보는 것이라, 회의록이
//  화면 위쪽을 쓰도록 머리 단추로 옮겼다 (2026-09-19 회의록 화면 다듬기).
// ============================================================
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Play, Presentation } from "lucide-react";
import { Button, Menu, type MenuItem } from "@/components/neander/ui";
import { PREP_DOCS, prepDocHref } from "@/lib/neander/prep-docs";
import { formatDateKo } from "@/lib/neander/format";

export function PrepDocsButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  if (PREP_DOCS.length === 0) return null;

  const docs = [...PREP_DOCS].sort((a, b) => b.date.localeCompare(a.date));
  const items: MenuItem[] = [
    { type: "label", key: "label", label: "회의 전 브리핑 · 웹 16:9 발표자료" },
    ...docs.map((d) => ({
      key: d.slug,
      label: d.title,
      hint: `${formatDateKo(d.date)} · ${d.author}`,
      icon: Play,
      onSelect: () => router.push(prepDocHref(d)),
    })),
  ];

  return (
    <>
      <Button
        ref={anchor}
        variant="secondary"
        icon={Presentation}
        trailingIcon={ChevronDown}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        준비 자료
      </Button>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchor}
        placement="bottom-end"
        ariaLabel="회의 준비 자료"
        className="w-80"
        items={items}
      />
    </>
  );
}
