"use client";

// ============================================================
//  AI STUDIO 프로젝트 — 채널 하나의 기획 단위 (shorts/spaces.ts)
// ------------------------------------------------------------
//  프로젝트를 고르면 시장 트렌드 · 소재 발굴 · 바이럴 형식 · 성공 공식 · 영상 · 대본 · 게시 · 성과가
//  그 프로젝트 것으로 바뀐다(위 툴바의 「프로젝트」). 대시보드는 모든 프로젝트를 본다.
//  팀 공용 — 누구나 만들고 고친다. 보관 · 되살리기는 AI STUDIO 관리자만.
// ============================================================

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Camera, Check, FolderKanban, Pencil, Plus, SquarePlay } from "lucide-react";
import { Badge, Button, Card, Checkbox, Dialog, Field, Input, PageHeader, PageShell, SectionHeader, SegmentedControl, Textarea, cn } from "@/components/neander/ui";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { useAction } from "@/components/neander/shorts/parts";
import { mutate } from "@/lib/neander/shorts/client";
import { PLATFORM_LABEL } from "@/lib/neander/shorts/model";
import { DEFAULT_SPACE_ID, PRODUCTION_LABEL, newSpaceDefaults, spaceOf, type SpaceProduction, type SpaceView } from "@/lib/neander/shorts/spaces";

type Draft = { name: string; description: string; production: SpaceProduction; defaultKind: "coupang" | "general"; writerStyle: "intro" | "story"; archived: boolean };
const KIND_LABEL = { coupang: "쿠팡 제휴", general: "일반 정보" } as const;
const STYLE_LABEL = { intro: "제품 소개(리뷰형)", story: "스토리 광고" } as const;

export default function SpacesPage() {
  const { data, space, setSpace, refresh } = useShorts();
  const d = data!;
  const router = useRouter();
  const [editing, setEditing] = useState<SpaceView | "new" | null>(null);
  const live = d.spaces.filter((s) => !s.archived);
  const archived = d.spaces.filter((s) => s.archived);
  // 모든 프로젝트의 자료로 센다 (data 는 전체)
  const stats = useMemo(() => {
    const m = new Map<string, { videos: number; published: number; accounts: { name: string; platform: "youtube" | "instagram" }[] }>();
    const projSpace = new Map(d.projects.map((p) => [p.id, spaceOf(p)]));
    for (const s of d.spaces) m.set(s.id, { videos: 0, published: 0, accounts: [] });
    for (const p of d.projects) if (!p.sample) m.get(spaceOf(p)) && m.get(spaceOf(p))!.videos++;
    for (const x of d.publications) if (x.status === "published") {
      const sid = projSpace.get(x.projectId);
      if (sid && m.get(sid)) m.get(sid)!.published++;
    }
    for (const a of d.accounts) if (!a.clientId) m.get(spaceOf(a))?.accounts.push({ name: a.externalName, platform: a.platform });
    return m;
  }, [d]);
  const go = (id: string, href = "/neander/shorts/market") => {
    setSpace(id);
    router.push(href);
  };

  return (
    <PageShell>
      <PageHeader
        title="프로젝트"
        description="채널 하나 = 프로젝트. 위 툴바에서 프로젝트를 고르면 시장 트렌드 · 소재 발굴 · 바이럴 형식 · 성공 공식 · 영상 · 대본 · 게시 · 성과가 그 프로젝트 것으로 바뀝니다. 대시보드는 모든 프로젝트를 봅니다."
        actions={
          <Button icon={Plus} onClick={() => setEditing("new")}>
            새 프로젝트
          </Button>
        }
      />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,360px),1fr))]">
        {live.map((s) => (
          <SpaceCard key={s.id} s={s} current={s.id === space} stat={stats.get(s.id)} onEdit={() => setEditing(s)} onOpen={() => go(s.id)} />
        ))}
      </div>
      {archived.length > 0 && (
        <section className="mt-8">
          <SectionHeader title="보관한 프로젝트" hint="목록 · 자동 실행에서 빠졌고 자료는 그대로입니다" />
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,360px),1fr))]">
            {archived.map((s) => (
              <SpaceCard key={s.id} s={s} current={false} stat={stats.get(s.id)} onEdit={() => setEditing(s)} />
            ))}
          </div>
        </section>
      )}
      <SpaceDialog
        target={editing}
        admin={d.admin}
        onClose={() => setEditing(null)}
        onSaved={async (saved, created) => {
          await refresh();
          if (created) setSpace(saved.id);
        }}
      />
    </PageShell>
  );
}

function SpaceCard({ s, current, stat, onEdit, onOpen }: { s: SpaceView; current: boolean; stat?: { videos: number; published: number; accounts: { name: string; platform: "youtube" | "instagram" }[] }; onEdit: () => void; onOpen?: () => void }) {
  return (
    <Card className={cn("flex flex-col gap-3", current && "ring-2 ring-nd-accent/50", s.archived && "opacity-70")}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-nd-md bg-nd-accent-soft text-nd-accent-strong">
          <FolderKanban size={20} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-[17px] font-semibold">{s.name}</h2>
            {current && <Badge tone="accent" size="md">지금 프로젝트</Badge>}
            {s.archived && <Badge tone="neutral" size="md">보관</Badge>}
          </div>
          <p className="text-[13px] text-nd-fg-3">
            {PRODUCTION_LABEL[s.production]} · 새 영상 {KIND_LABEL[s.defaultKind]} · 대본 {STYLE_LABEL[s.writerStyle]}
          </p>
        </div>
      </div>
      <p className="min-h-[2.5rem] text-nd-body leading-relaxed text-nd-fg-2">{s.description || <span className="text-nd-fg-3">설명 없음 — 「고치기」 에서 어떤 채널인지 적어 두면 AI 가 소재를 고를 때 참고합니다.</span>}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-nd-fg-2">
        <span>영상 <b className="nd-num">{stat?.videos ?? 0}</b>편</span>
        <span>게시 <b className="nd-num">{stat?.published ?? 0}</b>건</span>
        {stat?.accounts.length ? (
          stat.accounts.map((a) => (
            <span key={`${a.platform}${a.name}`} className="inline-flex items-center gap-1">
              {a.platform === "youtube" ? <SquarePlay size={14} aria-hidden /> : <Camera size={14} aria-hidden />}
              <span className="sr-only">{PLATFORM_LABEL[a.platform]}</span>
              {a.name}
            </span>
          ))
        ) : (
          <span className="text-nd-fg-3">연결 계정 없음 — 이 프로젝트를 고른 채 「내 채널 · 연결」 에서 연결</span>
        )}
      </div>
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        {onOpen && !current && (
          <Button size="sm" variant="secondary" icon={Check} onClick={onOpen}>
            이 프로젝트로
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={Pencil} onClick={onEdit}>
          고치기
        </Button>
      </div>
    </Card>
  );
}

function SpaceDialog({
  target,
  admin,
  onClose,
  onSaved,
}: {
  target: SpaceView | "new" | null;
  admin: boolean;
  onClose: () => void;
  onSaved: (s: SpaceView, created: boolean) => Promise<void>;
}) {
  const { busy, run } = useAction();
  const isNew = target === "new";
  // 닫히는 동안(target 이 null) 에도 창이 잠시 그려진다 — 고치는 대상은 따로 붙들어 둔다
  const editingSpace = target && target !== "new" ? target : null;
  const init: Draft | null = target === null ? null : isNew ? { name: "", description: "", ...newSpaceDefaults("ai"), defaultKind: "coupang", archived: false } : { name: target.name, description: target.description, production: target.production, defaultKind: target.defaultKind, writerStyle: target.writerStyle, archived: target.archived };
  const [f, setF] = useState<Draft | null>(init);
  const [key, setKey] = useState<string | null>(null);
  const k = target === null ? null : isNew ? "new" : target.id;
  if (k !== key) {
    setKey(k);
    setF(init);
  }
  const save = () =>
    void run(
      "save",
      async () => {
        if (!f) return;
        if (!isNew && !editingSpace) return;
        const r = isNew ? await mutate<{ space: SpaceView }>("space.create", { space: f }) : await mutate<{ space: SpaceView }>("space.update", { id: editingSpace!.id, space: f });
        await onSaved(r.space, isNew);
        onClose();
      },
      isNew ? "새 프로젝트를 만들었습니다 — 지금 프로젝트로 바꿨습니다." : "프로젝트를 고쳤습니다.",
    );
  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title={isNew ? "새 프로젝트" : "프로젝트 고치기"}
      description="채널 하나 = 프로젝트. 기획 · 영상 · 게시 · 성과가 프로젝트마다 따로 쌓입니다."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            닫기
          </Button>
          <Button loading={busy === "save"} onClick={save} disabled={!f?.name.trim()}>
            {isNew ? "만들기" : "저장"}
          </Button>
        </>
      }
    >
      {f && (
        <div className="space-y-4">
          <Field label="이름" hint="채널 이름 (나중에 바꿀 수 있음)">
            <Input value={f.name} maxLength={40} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="채널 표시 이름" />
          </Field>
          <Field label="어떤 채널인가" hint="주제 · 시청자 · 톤 — AI 가 레이더 상품을 고르고 아침 브리핑을 쓸 때 참고합니다">
            <Textarea rows={4} value={f.description} maxLength={1000} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="예: AI 로 만든 짧은 이야기에 쿠팡 꿀템(반려동물 · 생활용품)을 주인공으로 등장시키는 쇼츠. 20~40대 · 코믹 · 따뜻함" />
          </Field>
          <Field label="만드는 방식">
            <SegmentedControl
              ariaLabel="만드는 방식"
              value={f.production}
              onChange={(v) => setF({ ...f, ...(isNew ? newSpaceDefaults(v as SpaceProduction) : { production: v as SpaceProduction }) })}
              options={(Object.keys(PRODUCTION_LABEL) as SpaceProduction[]).map((p) => ({ value: p, label: PRODUCTION_LABEL[p] }))}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="새 영상 기본 종류">
              <SegmentedControl ariaLabel="새 영상 기본 종류" value={f.defaultKind} onChange={(v) => setF({ ...f, defaultKind: v as Draft["defaultKind"] })} options={(["coupang", "general"] as const).map((x) => ({ value: x, label: KIND_LABEL[x] }))} />
            </Field>
            <Field label="대본 작성기 기본 방식">
              <SegmentedControl ariaLabel="대본 기본 방식" value={f.writerStyle} onChange={(v) => setF({ ...f, writerStyle: v as Draft["writerStyle"] })} options={(["intro", "story"] as const).map((x) => ({ value: x, label: STYLE_LABEL[x] }))} />
            </Field>
          </div>
          {editingSpace && admin && editingSpace.id !== DEFAULT_SPACE_ID && (
            <Checkbox
              checked={f.archived}
              onChange={(e) => setF({ ...f, archived: e.target.checked })}
              label={
                <span className="inline-flex items-center gap-1">
                  {f.archived ? <ArchiveRestore size={14} aria-hidden /> : <Archive size={14} aria-hidden />}
                  보관 — 목록 · 매일 아침 자동 실행에서 뺍니다 (자료는 그대로)
                </span>
              }
            />
          )}
        </div>
      )}
    </Dialog>
  );
}
