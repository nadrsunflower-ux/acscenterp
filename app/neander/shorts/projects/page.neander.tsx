"use client";

// 영상 목록 — 단계별로 보고, 새 영상을 바로 만든다 (소재 없이 시작해도 된다)
// 쿠팡 제휴 · 고객사 · 일반 영상이 한 표에 섞인다 — 고객사 영상은 「쿠팡 · 고객사」 칸에 고객사 이름 · 검토 상태, 일반 영상은 「일반」.

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Clapperboard, Plug, Plus } from "lucide-react";
import { Badge, Button, Card, Dialog, EmptyState, Field, FormRow, InlineNotice, Input, PageHeader, PageShell, Select, Table, TableScroll, Tabs, Td, Th, Tr, type Tone } from "@/components/neander/ui";
import { isReadOnlyFor, useScoped, useShorts } from "@/components/neander/shorts/ShortsProvider";
import { KindTile, SampleTag, StageBadge, fmtUsd, fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { mutate } from "@/lib/neander/shorts/client";
import { REVIEW_LABEL, STAGE_LABEL, confirmedCandidate, projectCost } from "@/lib/neander/shorts/model";
import type { ProjectDoc, ProjectStage } from "@/lib/neander/shorts/types";

const REVIEW_TONE: Record<ProjectDoc["review"]["state"], Tone> = { none: "neutral", waiting: "warning", revision: "danger", approved: "success" };

/** 탭 이름 + 건수 (13px — 탭 기본 꼬리표보다 크게) */
const tabLabel = (label: string, n: number) => (
  <>
    {label}
    <span className="nd-num text-[13px] font-normal text-nd-fg-3">{n.toLocaleString("ko-KR")}</span>
  </>
);

export default function ProjectsPage() {
  const { data, refresh, nameOf } = useShorts();
  const d = data!;
  const sc = useScoped();
  const router = useRouter();
  const [stage, setStage] = useState<ProjectStage | "all">("all");
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => sc.projects.filter((p) => (stage === "all" ? p.stage !== "archived" : p.stage === stage)), [sc.projects, stage]);
  const active = sc.projects.filter((p) => p.stage !== "archived");
  const brandCount = active.filter((p) => p.kind === "brand").length;
  const generalCount = active.filter((p) => p.kind === "general").length;
  const tabs = [
    { key: "all", label: tabLabel("진행 중", active.length) },
    ...(Object.keys(STAGE_LABEL) as ProjectStage[])
      .map((s) => ({ key: s, n: sc.projects.filter((p) => p.stage === s).length }))
      .filter((t) => t.n > 0)
      .map((t) => ({ key: t.key, label: tabLabel(STAGE_LABEL[t.key], t.n) })),
  ];
  // 게시할 수 있는 연결된 계정이 하나도 없을 때만 알린다 (실제 연결 상태 기준)
  const noPublishAccount = !d.accounts.some((a) => a.canPublish && a.status === "connected");

  return (
    <PageShell>
      <PageHeader
        title="영상"
        description="영상 한 편 = 소스 · 쿠팡 확인(또는 고객사 브리프) · 대본 · 편집 · 검토 · 게시 · 성과. 고객사 영상은 고객사 화면에서 만듭니다."
        meta={active.length ? <span className="nd-num text-[13px] text-nd-fg-2">쿠팡 제휴 {active.length - brandCount - generalCount} · 고객사 {brandCount}{generalCount ? ` · 일반 ${generalCount}` : ""}</span> : undefined}
        actions={<Button icon={Plus} onClick={() => setCreating(true)}>새 영상</Button>}
      />
      {noPublishAccount && (
        <InlineNotice
          tone="neutral"
          icon={Plug}
          className="mb-4"
          action={<Link href="/neander/shorts/accounts"><Button size="sm" variant="secondary">내 채널 · 연결</Button></Link>}
        >
          SNS 게시 계정이 연결되지 않았습니다 — 게시하려면 계정 연결이 필요합니다. 소스 · 대본 · 편집 · 출력 · 다운로드는 그대로 쓸 수 있습니다.
        </InlineNotice>
      )}
      <Tabs className="mb-4" items={tabs} value={stage} onChange={(k) => setStage(k as typeof stage)} ariaLabel="단계" />
      {rows.length === 0 ? (
        <EmptyState icon={Clapperboard} title="영상이 없습니다" description="소재 발굴에서 「영상 만들기」 를 누르거나 「새 영상」 으로 시작하세요." action={<Button onClick={() => setCreating(true)}>새 영상</Button>} />
      ) : (
        <Card padding="none" className="overflow-hidden">
          <TableScroll>
            <Table size="md" minWidth={1040}>
              <thead>
                <tr>
                  <Th>제목 · 상품</Th>
                  <Th>단계</Th>
                  <Th>쿠팡 · 고객사</Th>
                  <Th align="right">장면</Th>
                  <Th align="right">완성 파일</Th>
                  <Th align="right">AI 비용</Th>
                  <Th>만든 사람 · 공개</Th>
                  <Th align="right">수정</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const c = confirmedCandidate(p);
                  const sub = p.kind === "brand" ? p.product || "제품 미정" : `${p.product || "상품 미정"}${p.category ? ` · ${p.category}` : ""}`;
                  return (
                    <Tr key={p.id} className="cursor-pointer" onClick={() => router.push(`/neander/shorts/projects/${p.id}`)}>
                      <Td className="w-full max-w-0">
                        <div className="flex min-w-0 items-center gap-3">
                          <KindTile kind={p.kind} className="h-9 w-9" />
                          <div className="min-w-0">
                            <Link href={`/neander/shorts/projects/${p.id}`} className="block truncate font-medium hover:underline" title={p.title} onClick={(e) => e.stopPropagation()}>{p.title}</Link>
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-[13px] text-nd-fg-3" title={sub}>{sub}</span>
                              {p.sample && <SampleTag />}
                            </div>
                          </div>
                        </div>
                      </Td>
                      <Td className="whitespace-nowrap"><StageBadge stage={p.stage} size="lg" /></Td>
                      <Td className="whitespace-nowrap">
                        {p.kind === "brand" ? (
                          <span className="flex items-center gap-2">
                            <Link href={`/neander/shorts/clients/${p.clientId}`} className="max-w-[140px] truncate hover:underline" title={p.clientName || "고객사"} onClick={(e) => e.stopPropagation()}>{p.clientName || "고객사"}</Link>
                            <Badge size="lg" tone={REVIEW_TONE[p.review.state]}>{REVIEW_LABEL[p.review.state]}</Badge>
                          </span>
                        ) : p.kind === "general" ? (
                          <Badge size="lg">일반 · 제휴 없음</Badge>
                        ) : c ? (
                          <Badge size="lg" tone="success">쿠팡 확인함</Badge>
                        ) : p.coupang.candidates.length ? (
                          <Badge size="lg" tone="info">쿠팡 후보 {p.coupang.candidates.length}개</Badge>
                        ) : (
                          <span className="text-nd-fg-3" title="아직 쿠팡 후보가 없습니다">—</span>
                        )}
                      </Td>
                      <Td num>{p.scenes.length}</Td>
                      <Td num>{p.renderIds.length}</Td>
                      <Td num>{fmtUsd(projectCost(p).aiUsd || null)}</Td>
                      <Td className="whitespace-nowrap">
                        <span className="text-nd-fg-2">{p.owner === d.me ? "나" : nameOf(p.owner)} · {p.visibility === "team" ? "팀" : "나만"}</span>
                        {isReadOnlyFor(p, d.me) && <div className="text-[13px] text-nd-fg-3">읽기 전용</div>}
                      </Td>
                      <Td num muted className="whitespace-nowrap">{fmtWhen(p.updatedAt)}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </TableScroll>
        </Card>
      )}
      {creating && <NewProjectDialog onClose={() => setCreating(false)} onCreated={async (id) => { await refresh(); router.push(`/neander/shorts/projects/${id}`); }} />}
    </PageShell>
  );
}

function NewProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => Promise<void> }) {
  const { busy, run } = useAction();
  const [f, setF] = useState({ kind: "coupang", title: "", product: "", category: "", visibility: "private" });
  return (
    <Dialog
      open
      onClose={onClose}
      title="새 영상"
      description="고객사(브랜드) 영상은 고객사 화면의 「영상 추가」 로 만듭니다."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>취소</Button>
          <Button disabled={busy === "c" || !f.product.trim()} onClick={() => void run("c", async () => { const r = await mutate<{ id: string }>("project.create", f); await onCreated(r.id); })}>만들기</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="종류" hint={f.kind === "general" ? "제휴 링크 · 협찬 · 대가가 없는 영상 — 고지 문구 · 쿠팡 확인이 없습니다. 나중에 바꿀 수 있습니다." : "쿠팡 파트너스 링크를 거는 영상 — 쿠팡 동일 상품 확인 · 고지가 들어갑니다."}>
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="coupang">쿠팡 제휴 영상</option>
            <option value="general">일반 영상 (제휴 없음)</option>
          </Select>
        </Field>
        <Field label={f.kind === "general" ? "다루는 것" : "상품"} required><Input value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })} placeholder="예: 접이식 주방 선반" autoFocus /></Field>
        <FormRow className="grid-cols-1 sm:grid-cols-2">
          <Field label="제목 (비우면 상품명)"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="카테고리"><Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="주방 · 수납 …" /></Field>
        </FormRow>
        <Field label="공개 범위" hint="팀 보기는 AI STUDIO 사용자 누구나 읽고 고칩니다. 지우기는 만든 사람만.">
          <Select value={f.visibility} onChange={(e) => setF({ ...f, visibility: e.target.value })}>
            <option value="private">나만 보기</option>
            <option value="team">팀 보기</option>
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}
