"use client";

// ============================================================
//  AI STUDIO 프로젝트 — 채널 하나의 기획 단위 (shorts/spaces.ts)
// ------------------------------------------------------------
//  프로젝트를 고르면 시장 트렌드 · 소재 발굴 · 바이럴 형식 · 성공 공식 · 영상 · 대본 · 게시 · 성과가
//  그 프로젝트 것으로 바뀐다(위 툴바의 「프로젝트」). 대시보드는 모든 프로젝트를 본다.
//  두 종류:
//    자체 운영 — 우리 채널. 팀 공용 — 누구나 만들고 고친다.
//    대행     — 계약 업체(고객사)의 브랜드. 업체 하나에 프로젝트 여러 개. 관리자 · 그 업체 담당자만 본다.
//  보관 · 되살리기는 AI STUDIO 관리자만.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Briefcase, Camera, Check, FolderKanban, Pencil, Plus, SquarePlay } from "lucide-react";
import { Badge, Button, Card, Checkbox, Dialog, EmptyState, Field, Input, PageHeader, PageShell, SectionHeader, SegmentedControl, Select, Textarea, cn } from "@/components/neander/ui";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { useAction } from "@/components/neander/shorts/parts";
import { mutate } from "@/lib/neander/shorts/client";
import { PLATFORM_LABEL } from "@/lib/neander/shorts/model";
import { DEFAULT_SPACE_ID, PRODUCTION_LABEL, SPACE_KIND_LABEL, newSpaceDefaults, spaceKind, spaceOf, type SpaceKind, type SpaceProduction, type SpaceView } from "@/lib/neander/shorts/spaces";
import type { ClientView } from "@/lib/neander/shorts/types";

type Draft = { name: string; description: string; production: SpaceProduction; defaultKind: "coupang" | "general"; writerStyle: "intro" | "story"; archived: boolean; kind: SpaceKind; clientId: string; newClient: string };
const KIND_LABEL = { coupang: "쿠팡 제휴", general: "일반 정보" } as const;
const STYLE_LABEL = { intro: "제품 소개(리뷰형)", story: "스토리 광고" } as const;
const CLIENT_STATUS = { active: "진행 중", paused: "잠시 멈춤", ended: "종료" } as const;
const NEW_CLIENT = "__new";
type Stat = { videos: number; published: number; accounts: { name: string; platform: "youtube" | "instagram" }[] };
const GRID = "grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,360px),1fr))]";

export default function SpacesPage() {
  const { data, space, setSpace, refresh } = useShorts();
  const d = data!;
  const router = useRouter();
  const [editing, setEditing] = useState<SpaceView | { new: true; clientId?: string } | null>(null);
  // 업체 화면의 「이 업체에 프로젝트」 → ?newFor=<업체 id> 로 와서 그 업체로 새 프로젝트 창을 연다
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("newFor");
    if (id && d.clients.some((c) => c.id === id)) setEditing({ new: true, clientId: id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const live = d.spaces.filter((s) => !s.archived);
  const own = live.filter((s) => spaceKind(s) === "own");
  const agency = live.filter((s) => spaceKind(s) === "agency");
  const archived = d.spaces.filter((s) => s.archived);
  // 대행은 업체별로 — 프로젝트가 아직 없는 업체도 보인다
  const byClient = useMemo(() => {
    const ids = [...new Set([...d.clients.map((c) => c.id), ...agency.map((s) => s.clientId ?? "")])].filter(Boolean);
    return ids
      .map((id) => ({ client: d.clients.find((c) => c.id === id) ?? null, id, spaces: agency.filter((s) => s.clientId === id) }))
      .sort((a, b) => (a.client?.name ?? "").localeCompare(b.client?.name ?? "", "ko"));
  }, [d.clients, agency]);
  // 모든 프로젝트의 자료로 센다 (data 는 볼 수 있는 전체)
  const stats = useMemo(() => {
    const m = new Map<string, Stat>();
    const projSpace = new Map(d.projects.map((p) => [p.id, spaceOf(p)]));
    for (const s of d.spaces) m.set(s.id, { videos: 0, published: 0, accounts: [] });
    for (const p of d.projects) if (!p.sample) m.get(spaceOf(p)) && m.get(spaceOf(p))!.videos++;
    for (const x of d.publications)
      if (x.status === "published") {
        const sid = projSpace.get(x.projectId);
        if (sid && m.get(sid)) m.get(sid)!.published++;
      }
    for (const a of d.accounts) m.get(spaceOf(a))?.accounts.push({ name: a.externalName, platform: a.platform });
    return m;
  }, [d]);
  const go = (id: string, href = "/neander/shorts/market") => {
    setSpace(id);
    router.push(href);
  };
  const card = (s: SpaceView) => <SpaceCard key={s.id} s={s} current={s.id === space} stat={stats.get(s.id)} onEdit={() => setEditing(s)} onOpen={s.archived ? undefined : () => go(s.id)} />;

  return (
    <PageShell>
      <PageHeader
        title="프로젝트"
        description="채널 하나 = 프로젝트. 위 툴바에서 프로젝트를 고르면 시장 트렌드 · 소재 발굴 · 바이럴 형식 · 성공 공식 · 영상 · 대본 · 게시 · 성과가 그 프로젝트 것으로 바뀝니다. 대시보드는 모든 프로젝트를 봅니다."
        actions={
          <Button icon={Plus} onClick={() => setEditing({ new: true })}>
            새 프로젝트
          </Button>
        }
      />

      <section>
        <SectionHeader size="lg" title={SPACE_KIND_LABEL.own} hint="우리 채널 — 쿠팡 수수료 · 광고 수익 · 팀 공용" />
        <div className={GRID}>{own.map(card)}</div>
      </section>

      <section className="mt-10">
        <SectionHeader size="lg" title="대행 · 업체별" hint="계약한 업체의 브랜드를 맡아 운영 — AI STUDIO 관리자와 그 업체 담당자만 봅니다" action={<Link href="/neander/shorts/clients" className="text-[13px] font-medium text-nd-accent hover:underline">업체 · 계약 목록</Link>} />
        {byClient.length === 0 ? (
          <EmptyState compact icon={Briefcase} title="아직 계약 업체가 없습니다" description="「새 프로젝트」 에서 종류를 「대행」 으로 고르고 업체를 새로 만드세요. 업체 하나에 프로젝트를 여러 개 둘 수 있습니다." />
        ) : (
          <div className="space-y-6">
            {byClient.map(({ client, id, spaces }) => (
              <div key={id} className="rounded-nd-lg border border-nd-border bg-nd-sunken/40 p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Briefcase size={18} aria-hidden className="text-nd-accent" />
                  <h2 className="text-[17px] font-semibold">{client?.name ?? "(볼 수 없는 업체)"}</h2>
                  {client && <Badge tone={client.status === "active" ? "success" : "neutral"} size="md">{CLIENT_STATUS[client.status]}</Badge>}
                  {client && (
                    <span className="text-[13px] text-nd-fg-3">
                      월 {client.contract.videosPerMonth}편{client.contract.monthlyFeeKrw !== null ? ` · ${client.contract.monthlyFeeKrw.toLocaleString("ko-KR")}원(부가세 ${client.contract.vat === "included" ? "포함" : "별도"})` : ""} · {client.contract.startMonth}~{client.contract.endMonth ?? ""}
                    </span>
                  )}
                  <span className="ml-auto flex gap-2">
                    {client && (
                      <Link href={`/neander/shorts/clients/${id}`} className="inline-flex h-8 items-center rounded-nd-md px-3 text-[13px] font-medium text-nd-accent hover:bg-nd-accent-soft">
                        업체 · 계약 보기
                      </Link>
                    )}
                    {client && (client.canEdit || d.admin) && (
                      <Button size="sm" variant="secondary" icon={Plus} onClick={() => setEditing({ new: true, clientId: id })}>
                        이 업체에 프로젝트
                      </Button>
                    )}
                  </span>
                </div>
                {spaces.length ? <div className={GRID}>{spaces.map(card)}</div> : <p className="text-nd-body text-nd-fg-3">이 업체의 프로젝트가 아직 없습니다 — 「이 업체에 프로젝트」 로 브랜드(채널)마다 만드세요.</p>}
              </div>
            ))}
          </div>
        )}
      </section>

      {archived.length > 0 && (
        <section className="mt-10">
          <SectionHeader title="보관한 프로젝트" hint="목록 · 자동 실행에서 빠졌고 자료는 그대로입니다" />
          <div className={GRID}>{archived.map(card)}</div>
        </section>
      )}
      <SpaceDialog
        target={editing}
        admin={d.admin}
        clients={d.clients.filter((c) => c.canEdit || d.admin)}
        onClose={() => setEditing(null)}
        onSaved={async (saved, created) => {
          await refresh();
          if (created) setSpace(saved.id);
        }}
      />
    </PageShell>
  );
}

function SpaceCard({ s, current, stat, onEdit, onOpen }: { s: SpaceView; current: boolean; stat?: Stat; onEdit: () => void; onOpen?: () => void }) {
  const agency = spaceKind(s) === "agency";
  return (
    <Card className={cn("flex flex-col gap-3", current && "ring-2 ring-nd-accent/50", s.archived && "opacity-70")}>
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-nd-md", agency ? "bg-nd-warning-soft text-nd-warning-text" : "bg-nd-accent-soft text-nd-accent-strong")}>
          {agency ? <Briefcase size={20} aria-hidden /> : <FolderKanban size={20} aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-[17px] font-semibold">{s.name}</h2>
            <Badge tone={agency ? "warning" : "neutral"} size="md">{SPACE_KIND_LABEL[spaceKind(s)]}</Badge>
            {current && <Badge tone="accent" size="md">지금 프로젝트</Badge>}
            {s.archived && <Badge tone="neutral" size="md">보관</Badge>}
          </div>
          <p className="text-[13px] text-nd-fg-3">
            {PRODUCTION_LABEL[s.production]}
            {agency ? " · 새 영상 브랜드 대행" : ` · 새 영상 ${KIND_LABEL[s.defaultKind]}`} · 대본 {STYLE_LABEL[s.writerStyle]}
          </p>
        </div>
      </div>
      <p className="min-h-[2.5rem] text-nd-body leading-relaxed text-nd-fg-2">{s.description || <span className="text-nd-fg-3">설명 없음 — 「고치기」 에서 어떤 채널인지 적어 두면 AI 가 소재를 고를 때 참고합니다.</span>}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-nd-fg-2">
        <span>
          영상 <b className="nd-num">{stat?.videos ?? 0}</b>편
        </span>
        <span>
          게시 <b className="nd-num">{stat?.published ?? 0}</b>건
        </span>
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
  clients,
  onClose,
  onSaved,
}: {
  target: SpaceView | { new: true; clientId?: string } | null;
  admin: boolean;
  clients: ClientView[];
  onClose: () => void;
  onSaved: (s: SpaceView, created: boolean) => Promise<void>;
}) {
  const { busy, run } = useAction();
  const isNew = !!target && "new" in target;
  // 닫히는 동안(target 이 null) 에도 창이 잠시 그려진다 — 고치는 대상은 따로 붙들어 둔다
  const editingSpace = target && !("new" in target) ? target : null;
  const presetClient = target && "new" in target ? target.clientId : undefined;
  const init: Draft | null =
    target === null
      ? null
      : isNew
        ? { name: "", description: "", ...newSpaceDefaults("ai"), defaultKind: "coupang", archived: false, kind: presetClient ? "agency" : "own", clientId: presetClient ?? clients[0]?.id ?? NEW_CLIENT, newClient: "" }
        : { name: editingSpace!.name, description: editingSpace!.description, production: editingSpace!.production, defaultKind: editingSpace!.defaultKind, writerStyle: editingSpace!.writerStyle, archived: editingSpace!.archived, kind: spaceKind(editingSpace), clientId: editingSpace!.clientId ?? "", newClient: "" };
  const [f, setF] = useState<Draft | null>(init);
  const [key, setKey] = useState<string | null>(null);
  const k = target === null ? null : isNew ? `new:${presetClient ?? ""}` : editingSpace!.id;
  if (k !== key) {
    setKey(k);
    setF(init);
  }
  const needsClientName = isNew && f?.kind === "agency" && f.clientId === NEW_CLIENT;
  const save = () =>
    void run(
      "save",
      async () => {
        if (!f) return;
        if (!isNew && !editingSpace) return;
        if (!isNew) {
          const r = await mutate<{ space: SpaceView }>("space.update", { id: editingSpace!.id, space: f });
          await onSaved(r.space, false);
          onClose();
          return;
        }
        let clientId: string | null = null;
        if (f.kind === "agency") {
          // 새 업체면 먼저 만든다 — 계약 · 브리프 · 제품은 업체 화면에서 채운다
          clientId = f.clientId === NEW_CLIENT ? (await mutate<{ id: string }>("client.save", { client: { name: f.newClient.trim() } })).id : f.clientId;
        }
        const r = await mutate<{ space: SpaceView }>("space.create", { space: { ...f, clientId } });
        await onSaved(r.space, true);
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
          <Button loading={busy === "save"} onClick={save} disabled={!f?.name.trim() || (needsClientName && !f?.newClient.trim())}>
            {isNew ? "만들기" : "저장"}
          </Button>
        </>
      }
    >
      {f && (
        <div className="space-y-4">
          {isNew ? (
            <Field label="종류" hint={f.kind === "agency" ? "계약 업체의 브랜드 — 관리자와 그 업체 담당자만 봅니다. 나중에 바꿀 수 없습니다." : "우리 채널 — 팀 공용. 나중에 바꿀 수 없습니다."}>
              <SegmentedControl
                ariaLabel="프로젝트 종류"
                value={f.kind}
                onChange={(v) => setF({ ...f, kind: v as SpaceKind })}
                options={(["own", "agency"] as const).map((x) => ({ value: x, label: SPACE_KIND_LABEL[x] }))}
              />
            </Field>
          ) : (
            <p className="text-[13px] text-nd-fg-3">
              종류: {SPACE_KIND_LABEL[f.kind]}
              {f.kind === "agency" ? ` · 업체 「${clients.find((c) => c.id === f.clientId)?.name ?? "?"}」` : ""} (만든 뒤에는 바꾸지 않습니다)
            </p>
          )}
          {isNew && f.kind === "agency" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="계약 업체">
                <Select value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })}>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  <option value={NEW_CLIENT}>+ 새 업체 만들기</option>
                </Select>
              </Field>
              {needsClientName && (
                <Field label="새 업체 이름" hint="계약 · 브리프 · 제품 · 재무 계약은 만든 뒤 업체 화면에서">
                  <Input value={f.newClient} maxLength={80} onChange={(e) => setF({ ...f, newClient: e.target.value })} placeholder="예: 주식회사 ○○" />
                </Field>
              )}
            </div>
          )}
          <Field label="이름" hint={f.kind === "agency" ? "브랜드 · 채널 이름 (업체 하나에 여러 개)" : "채널 이름 (나중에 바꿀 수 있음)"}>
            <Input value={f.name} maxLength={40} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={f.kind === "agency" ? "브랜드 · 채널 이름" : "채널 표시 이름"} />
          </Field>
          <Field label="어떤 채널인가" hint="주제 · 시청자 · 톤 — AI 가 레이더 상품을 고르고 아침 브리핑을 쓸 때 참고합니다">
            <Textarea rows={4} value={f.description} maxLength={1000} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="예: 20~40대 여성 대상 주방용품 브랜드 — 깔끔 · 실용 · 따뜻한 톤" />
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
            {f.kind === "own" && (
              <Field label="새 영상 기본 종류">
                <SegmentedControl ariaLabel="새 영상 기본 종류" value={f.defaultKind} onChange={(v) => setF({ ...f, defaultKind: v as Draft["defaultKind"] })} options={(["coupang", "general"] as const).map((x) => ({ value: x, label: KIND_LABEL[x] }))} />
              </Field>
            )}
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
