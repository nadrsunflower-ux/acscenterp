"use client";

// ============================================================
//  회의 준비 자료 — /neander/meetings 머리의 「준비 자료」 단추
// ------------------------------------------------------------
//  lib/neander/prep-docs.ts 에 등록된 웹 발표자료(16:9 브리핑)를
//  펼침 메뉴로 보여준다. 자료 자체가 코드(슬라이드 페이지)라 배포와 함께
//  자동으로 이 목록에 나타난다.
//
//  팀원이 회의 때마다 여는 자기 발표 자료 사이트(팀원 문서의 prepUrl)는
//  메뉴 맨 위에 선다 — 누르면 새 탭으로 바로 간다. 같은 링크가 회의 문서
//  머리에도 칩으로 뜬다 (app/neander/meetings/page.neander.tsx).
//
//  예전에는 회의 목록 위에 카드 한 장을 통째로 차지했다(발표자 탭 +
//  자료 줄). 자료는 가끔 여는 것이고 회의록은 매번 보는 것이라, 회의록이
//  화면 위쪽을 쓰도록 머리 단추로 옮겼다 (2026-09-19 회의록 화면 다듬기).
// ============================================================
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ExternalLink, Play, Presentation } from "lucide-react";
import { useAppData } from "@/components/neander/app-data";
import { Button, Menu, type MenuItem } from "@/components/neander/ui";
import { PREP_DOCS, linkHost, prepDocHref, standingPreps } from "@/lib/neander/prep-docs";
import { formatDateKo } from "@/lib/neander/format";

export function PrepDocsButton() {
  const router = useRouter();
  const { members } = useAppData();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const standing = standingPreps(members);
  if (PREP_DOCS.length === 0 && standing.length === 0) return null;

  const docs = [...PREP_DOCS].sort((a, b) => b.date.localeCompare(a.date));
  const items: MenuItem[] = [
    ...(standing.length
      ? [
          { type: "label" as const, key: "standing-label", label: "매번 쓰는 발표 자료 · 새 탭으로 열림" },
          ...standing.map((p) => ({
            key: `standing-${p.id}`,
            label: p.name,
            hint: linkHost(p.url),
            icon: ExternalLink,
            onSelect: () => {
              if (p.url.startsWith("/")) router.push(p.url);
              else window.open(p.url, "_blank", "noopener,noreferrer");
            },
          })),
        ]
      : []),
    ...(standing.length && docs.length ? [{ type: "separator" as const, key: "sep" }] : []),
    ...(docs.length
      ? [
          { type: "label" as const, key: "label", label: "회의 전 브리핑 · 웹 16:9 발표자료" },
          ...docs.map((d) => ({
            key: d.slug,
            label: d.title,
            hint: `${formatDateKo(d.date)} · ${d.author}`,
            icon: Play,
            onSelect: () => router.push(prepDocHref(d)),
          })),
        ]
      : []),
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
