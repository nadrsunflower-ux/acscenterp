"use client";

// ============================================================
//  AI STUDIO 프로젝트 — 채널 하나의 기획 단위 (shorts/spaces.ts) · 2026-11 목업 02 개편
// ------------------------------------------------------------
//  프로젝트를 고르면 시장 트렌드 · 소재 발굴 · 바이럴 형식 · 성공 공식 · 영상 · 대본 · 게시 · 성과가
//  그 프로젝트 것으로 바뀐다(위 툴바의 「프로젝트」). 대시보드는 모든 프로젝트를 본다.
//  두 종류:
//    자체 운영 — 우리 채널. 팀 공용 — 누구나 만들고 고친다.
//    대행     — 계약 업체(고객사)의 브랜드. 업체 하나에 프로젝트 여러 개. 관리자 · 그 업체 담당자만 본다.
//  보관 · 되살리기는 AI STUDIO 관리자만.
//  주소로 여는 창: ?newFor=<업체 id> (그 업체로 새 프로젝트) · ?edit=<프로젝트 id> (대시보드의 「고치기」)
// ============================================================

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, ArrowUpRight, Building2, FolderOpen, FolderKanban, Info, Pencil, Plus } from "lucide-react";
import { Badge, Button, Checkbox, Dialog, EmptyState, Field, FormRow, Input, PageShell, Select, Textarea, buttonClass } from "@/components/neander/ui";
import { Won } from "@/components/neander/shorts/agency-ui/won";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { useAction } from "@/components/neander/shorts/parts";
import { StudioCard, StudioHeader, StudioNotice, StudioSection } from "@/components/neander/shorts/studio";
import { SPACE_DEFAULT_KIND_LABEL, SPACE_STYLE_LABEL, SpaceSummaryCard, type SpaceCardStat } from "@/components/neander/shorts/agency-ui/space-card";
import { vatText } from "@/components/neander/shorts/agency-ui/finance";
import { mutate } from "@/lib/neander/shorts/client";
import { projectTotals } from "@/lib/neander/shorts/model";
import { DEFAULT_SPACE_ID, PRODUCTION_LABEL, SPACE_KIND_LABEL, newSpaceDefaults, spaceKind, spaceOf, type SpaceKind, type SpaceProduction, type SpaceView } from "@/lib/neander/shorts/spaces";
import type { ClientView } from "@/lib/neander/shorts/types";

type Draft = { name: string; description: string; production: SpaceProduction; defaultKind: "coupang" | "general"; writerStyle: "intro" | "story"; archived: boolean; kind: SpaceKind; clientId: string; newClient: string };
const STYLE_LABEL = { intro: "제품 소개(리뷰형)", story: "스토리 광고" } as const;
const CLIENT_STATUS = { active: ["진행 중", "success"], paused: ["잠시 멈춤", "warning"], ended: ["종료", "neutral"] } as const;
const NEW_CLIENT = "__new";
const GRID = "grid gap-4 lg:grid-cols-2";

export default function SpacesPage() {
  const { data, space, setSpace, refresh } = useShorts();
  const d = data!;
  const router = useRouter();
  const { busy, run } = useAction();
  const [editing, setEditing] = useState<SpaceView | { new: true; clientId?: string } | null>(null);
  // 업체 화면의 「이 업체에 프로젝트」 → ?newFor=<업체 id> 로 와서 그 업체로 새 프로젝트 창을 연다
  // 대시보드의 「고치기」 → ?edit=<프로젝트 id> 로 와서 그 프로젝트의 고치기 창을 연다
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const id = q.get("newFor");
    const edit = q.get("edit");
    if (id && d.clients.some((c) => c.id === id)) setEditing({ new: true, clientId: id });
    else if (edit) {
      const s = d.spaces.find((x) => x.id === edit);
      if (s) setEditing(s);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const live = d.spaces.filter((s) => !s.archived);
  const own = live.filter((s) => spaceKind(s) === "own");
  const agency = live.filter((s) => spaceKind(s) === "agency");
  const archived = d.spaces.filter((s) => s.archived);
  const clientName = useMemo(() => new Map(d.clients.map((c) => [c.id, c.name])), [d.clients]);
  // 대행은 업체별로 — 프로젝트가 아직 없는 업체도 보인다
  const byClient = useMemo(() => {
    const ids = [...new Set([...d.clients.map((c) => c.id), ...agency.map((s) => s.clientId ?? "")])].filter(Boolean);
    return ids
      .map((id) => ({ client: d.clients.find((c) => c.id === id) ?? null, id, spaces: agency.filter((s) => s.clientId === id) }))
      .sort((a, b) => (a.client?.name ?? "").localeCompare(b.client?.name ?? "", "ko"));
  }, [d.clients, agency]);
  // 모든 프로젝트의 자료로 센다 (data 는 볼 수 있는 전체)
  const stats = useMemo(() => {
    const m = new Map<string, SpaceCardStat>();
    for (const s of d.spaces) {
      const agencySpace = spaceKind(s) === "agency";
      const ps = d.projects.filter((p) => !p.sample && spaceOf(p) === s.id);
      const ids = new Set(ps.map((p) => p.id));
      const pubs = d.publications.filter((x) => ids.has(x.projectId));
      const views = ps.map((p) => projectTotals(d.metrics.filter((x) => x.projectId === p.id)).views).filter((v): v is number => v !== null);
      const review = ps.reduce((n, p) => n + p.scenes.filter((sc) => sc.kind === "ai" && sc.ai?.status === "review").length, 0);
      const making = ps.filter((p) => p.stage !== "published" && p.stage !== "archived");
      const latest = [...making].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      m.set(s.id, {
        videos: ps.length,
        inProgress: making.length,
        published: pubs.filter((x) => x.status === "published").length,
        views: views.length ? views.reduce((a, b) => a + b, 0) : null,
        attention: pubs.filter((x) => x.status === "uncertain" || x.status === "failed").length + review,
        accounts: d.accounts.filter((a) => spaceOf(a) === s.id && (agencySpace || !a.clientId)).map((a) => ({ name: a.externalName, platform: a.platform, reauth: a.status === "needs_reauth" })),
        latest: latest ? { id: latest.id, title: latest.title, stage: latest.stage } : null,
      });
    }
    return m;
  }, [d]);
  const go = (id: string, href = "/neander/shorts/market") => {
    setSpace(id);
    router.push(href);
  };
  const card = (s: SpaceView) => (
    <SpaceSummaryCard
      key={s.id}
      s={s}
      stat={stats.get(s.id)!}
      current={s.id === space}
      onEdit={() => setEditing(s)}
      onOpen={s.archived ? undefined : () => go(s.id)}
    />
  );
  const restore = (s: SpaceView) =>
    void run(
      `restore-${s.id}`,
      async () => {
        // 고치기 창의 「보관」 끄기와 같은 요청 — 보관만 푼다
        await mutate<{ space: SpaceView }>("space.update", { id: s.id, space: { name: s.name, description: s.description, production: s.production, defaultKind: s.defaultKind, writerStyle: s.writerStyle, archived: false } });
        await refresh();
      },
      `「${s.name}」 을 되살렸습니다.`,
    );

  return (
    <PageShell>
      <StudioHeader
        kicker="AI STUDIO 워크스페이스"
        kickerIcon={FolderOpen}
        title="프로젝트"
        description="채널별 방향과 제작 기본값을 관리하세요. 자체 운영과 대행을 나눠 보여 줍니다."
        actions={
          <Button icon={Plus} onClick={() => setEditing({ new: true })}>
            새 프로젝트
          </Button>
        }
      />
      <StudioNotice tone="info" title="프로젝트는 채널 하나의 기획 단위입니다" className="mb-7">
        위 툴바에서 프로젝트를 고르면 시장 트렌드 · 소재 발굴 · 바이럴 형식 · 성공 공식 · 영상 · 대본 · 게시 · 성과가 그 프로젝트 것으로 바뀝니다. 대시보드는 모든 프로젝트를 합쳐 보여 줍니다.
      </StudioNotice>

      <StudioSection title={SPACE_KIND_LABEL.own} description="우리 채널 — 쿠팡 수수료 · 광고 수익 · 프로젝트 설정은 팀 공용">
        <div className={GRID}>{own.map(card)}</div>
      </StudioSection>

      <StudioSection
        className="mt-10"
        title="대행 · 업체별"
        description="계약한 업체의 브랜드를 맡아 운영 — AI STUDIO 관리자와 그 업체 담당자만 계약 · 브리프를 볼 수 있습니다."
        action={
          <Link href="/neander/shorts/clients" className={buttonClass("ghost", "sm", "gap-1.5")}>
            <ArrowUpRight size={15} aria-hidden />
            업체 · 계약 목록
          </Link>
        }
      >
        {byClient.length === 0 ? (
          <EmptyState compact icon={Building2} title="아직 계약 업체가 없습니다" description="「새 프로젝트」 에서 종류를 「대행」 으로 고르고 업체를 새로 만드세요. 업체 하나에 프로젝트를 여러 개 둘 수 있습니다." />
        ) : (
          <div className="space-y-5">
            {byClient.map(({ client, id, spaces }) => (
              <StudioCard
                key={id}
                title={client?.name ?? "(볼 수 없는 업체)"}
                action={
                  <>
                    {client && (
                      <Link href={`/neander/shorts/clients/${id}`} className={buttonClass("secondary", "sm", "gap-1.5")}>
                        <Building2 size={15} aria-hidden />
                        업체 · 계약 보기
                      </Link>
                    )}
                    {client && (client.canEdit || d.admin) && (
                      <Button size="sm" variant="secondary" icon={Plus} onClick={() => setEditing({ new: true, clientId: id })}>
                        이 업체에 프로젝트
                      </Button>
                    )}
                  </>
                }
              >
                {client && (
                  <div className="-mt-1 mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-nd-line pb-4 text-[14px] text-nd-fg-2">
                    <Badge tone={CLIENT_STATUS[client.status][1]} size="lg">
                      {CLIENT_STATUS[client.status][0]}
                    </Badge>
                    <span>월 {client.contract.videosPerMonth}편</span>
                    {client.contract.monthlyFeeKrw !== null && (
                      <span className="inline-flex items-baseline gap-1.5">
                        <b className="font-semibold">
                          월 <Won value={client.contract.monthlyFeeKrw} flow="income" />
                        </b>
                        <span className="text-[13px] text-nd-fg-3">{vatText(client.contract.vat)}</span>
                      </span>
                    )}
                    <span className="nd-num ml-auto text-[13px] text-nd-fg-3">
                      계약 {client.contract.startMonth} ~ {client.contract.endMonth ?? "끝 월 없음"}
                    </span>
                  </div>
                )}
                {spaces.length ? (
                  <div className={GRID}>{spaces.map(card)}</div>
                ) : (
                  <p className="text-nd-body text-nd-fg-3">이 업체의 프로젝트가 아직 없습니다 — 「이 업체에 프로젝트」 로 브랜드(채널)마다 만드세요.</p>
                )}
              </StudioCard>
            ))}
          </div>
        )}
      </StudioSection>

      {archived.length > 0 && (
        <StudioSection className="mt-10" title="보관한 프로젝트" description={d.admin ? "목록 · 자동 실행에서 빠졌고 자료는 그대로입니다. 관리자는 다시 쓸 수 있게 되살릴 수 있습니다." : "목록 · 자동 실행에서 빠졌고 자료는 그대로입니다. 되살리기는 관리자만 합니다."}>
          <StudioCard flush>
            <ul className="divide-y divide-nd-line">
              {archived.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5 sm:px-6">
                  <Archive size={18} aria-hidden className="shrink-0 text-nd-fg-3" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-nd-fg">{s.name}</p>
                    <p className="truncate text-[13px] text-nd-fg-3">
                      {SPACE_KIND_LABEL[spaceKind(s)]}
                      {spaceKind(s) === "agency" && s.clientId ? ` · ${clientName.get(s.clientId) ?? "업체"}` : ""} · 영상 {stats.get(s.id)?.videos ?? 0}편 · {PRODUCTION_LABEL[s.production]}
                    </p>
                  </div>
                  <span className="flex shrink-0 gap-2">
                    <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(s)}>
                      고치기
                    </Button>
                    {d.admin && (
                      <Button size="sm" variant="secondary" icon={ArchiveRestore} loading={busy === `restore-${s.id}`} onClick={() => restore(s)}>
                        되살리기
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </StudioCard>
        </StudioSection>
      )}
      <SpaceDialog
        target={editing}
        admin={d.admin}
        adminCount={d.access ? new Set([...d.access.admins, ...d.access.fixedAdmins]).size : null}
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

function SpaceDialog({
  target,
  admin,
  adminCount,
  clients,
  onClose,
  onSaved,
}: {
  target: SpaceView | { new: true; clientId?: string } | null;
  admin: boolean;
  /** AI STUDIO 관리자 수 — 관리자에게만 알 수 있다 */
  adminCount: number | null;
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
  const agency = f?.kind === "agency";
  const clientLabel = f && agency ? (clients.find((c) => c.id === f.clientId)?.name ?? (f.clientId === NEW_CLIENT ? "새 업체" : "업체")) : "";
  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      size="lg"
      title={isNew ? "새 프로젝트" : "프로젝트 고치기"}
      description="채널의 방향과 제작 기본값을 정합니다. 기획 · 영상 · 게시 · 성과가 프로젝트마다 따로 쌓입니다."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button icon={isNew ? Plus : undefined} loading={busy === "save"} onClick={save} disabled={!f?.name.trim() || (needsClientName && !f?.newClient.trim())}>
            {isNew ? "프로젝트 만들기" : "저장"}
          </Button>
        </>
      }
    >
      {f && (
        <div className="space-y-5">
          {agency && (
            <StudioNotice tone="info" title="대행 프로젝트는 계약 정보를 함께 보호합니다">
              {adminCount ? `AI STUDIO 관리자 ${adminCount}명과` : "AI STUDIO 관리자와"} 이 업체 담당자만 볼 수 있습니다.
            </StudioNotice>
          )}
          {isNew ? (
            <FormRow className="grid-cols-1 sm:grid-cols-2">
              <Field label="프로젝트 종류" hint={agency ? "계약 업체의 브랜드 — 만든 뒤에는 바꿀 수 없습니다" : "우리 채널 · 팀 공용 — 만든 뒤에는 바꿀 수 없습니다"}>
                <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as SpaceKind })}>
                  {(["own", "agency"] as const).map((x) => (
                    <option key={x} value={x}>
                      {SPACE_KIND_LABEL[x]}
                    </option>
                  ))}
                </Select>
              </Field>
              {agency ? (
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
              ) : (
                <div aria-hidden className="hidden sm:block" />
              )}
            </FormRow>
          ) : (
            <p className="flex items-start gap-2 rounded-nd-md bg-nd-sunken px-3.5 py-2.5 text-[14px] text-nd-fg-2">
              <Info size={16} aria-hidden className="mt-0.5 shrink-0 text-nd-fg-3" />
              <span>
                종류: <b className="font-semibold">{SPACE_KIND_LABEL[f.kind]}</b>
                {agency ? ` · 업체 「${clientLabel}」` : ""} — 만든 뒤에는 바꾸지 않습니다.
              </span>
            </p>
          )}
          {needsClientName && (
            <Field label="새 업체 이름" hint="계약 · 브리프 · 제품 · 재무 계약은 만든 뒤 업체 화면에서 채웁니다">
              <Input value={f.newClient} maxLength={80} onChange={(e) => setF({ ...f, newClient: e.target.value })} placeholder="예: 주식회사 ○○" />
            </Field>
          )}
          <Field label="프로젝트 이름" hint={agency ? "브랜드 · 채널 이름 (업체 하나에 여러 개)" : "채널 이름 (나중에 바꿀 수 있음)"}>
            <Input value={f.name} maxLength={40} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={agency ? "브랜드 · 채널 이름" : "채널 표시 이름"} />
          </Field>
          <Field label="어떤 채널인가 · AI 가 참고" hint="주제 · 시청자 · 톤을 적으면 AI 가 레이더 상품을 고르고 아침 브리핑을 쓸 때 참고합니다">
            <Textarea rows={4} value={f.description} maxLength={1000} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="예: 20~40대 여성 대상 주방용품 브랜드 — 깔끔 · 실용 · 따뜻한 톤" />
          </Field>
          <FormRow className="grid-cols-1 sm:grid-cols-2">
            <Field label="만드는 방식" hint={isNew ? "바꾸면 대본 기본 방식이 맞춰집니다 (직접 촬영 → 제품 소개 · AI 생성 → 스토리 광고)" : undefined}>
              <Select value={f.production} onChange={(e) => setF({ ...f, ...(isNew ? newSpaceDefaults(e.target.value as SpaceProduction) : { production: e.target.value as SpaceProduction }) })}>
                {(Object.keys(PRODUCTION_LABEL) as SpaceProduction[]).map((p) => (
                  <option key={p} value={p}>
                    {PRODUCTION_LABEL[p]}
                  </option>
                ))}
              </Select>
            </Field>
            {agency ? (
              <Field label="새 영상 기본 종류" hint="대행 프로젝트의 영상은 고객사 브랜드 영상입니다">
                <div className="flex h-ctl-md items-center rounded-nd-md border border-nd-line bg-nd-sunken px-3 text-[14px] text-nd-fg-2">고객사 브랜드</div>
              </Field>
            ) : (
              <Field label="새 영상 기본 종류">
                <Select value={f.defaultKind} onChange={(e) => setF({ ...f, defaultKind: e.target.value as Draft["defaultKind"] })}>
                  {(["coupang", "general"] as const).map((x) => (
                    <option key={x} value={x}>
                      {SPACE_DEFAULT_KIND_LABEL[x]}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </FormRow>
          <FormRow className="grid-cols-1 sm:grid-cols-2">
            <Field label="대본 작성기 기본 방식">
              <Select value={f.writerStyle} onChange={(e) => setF({ ...f, writerStyle: e.target.value as Draft["writerStyle"] })}>
                {(["intro", "story"] as const).map((x) => (
                  <option key={x} value={x}>
                    {STYLE_LABEL[x]}
                  </option>
                ))}
              </Select>
            </Field>
          </FormRow>
          <div className="rounded-nd-md border border-nd-line bg-nd-sunken/60 px-4 py-3">
            <p className="flex items-center gap-1.5 text-[14px] font-semibold text-nd-fg">
              <FolderKanban size={15} aria-hidden className="text-nd-fg-3" />
              적용 범위
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-nd-fg-2">
              이 프로젝트에서 새로 만드는 영상에 기본값({agency ? "고객사 브랜드" : SPACE_DEFAULT_KIND_LABEL[f.defaultKind]} · {PRODUCTION_LABEL[f.production]} · 대본 {SPACE_STYLE_LABEL[f.writerStyle]})이 적용됩니다. 이미 만든 영상은 바뀌지 않습니다.
            </p>
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
