"use client";

// 영상 목록 — 단계별로 보고, 새 영상을 바로 만든다 (소재 없이 시작해도 된다)
// 쿠팡 제휴 영상과 고객사 영상이 한 표에 섞인다 — 고객사 영상은 「쿠팡 · 고객사」 칸에 고객사 이름 · 검토 상태.

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Clapperboard, Plus } from "lucide-react";
import { Button, Card, Dialog, EmptyState, Field, FormRow, Input, PageHeader, PageShell, Select, Table, TableScroll, Tabs, Td, Th, Tr } from "@/components/neander/ui";
import { isReadOnlyFor, useScoped, useShorts } from "@/components/neander/shorts/ShortsProvider";
import { SampleTag, StageBadge, fmtUsd, fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { mutate } from "@/lib/neander/shorts/client";
import { REVIEW_LABEL, STAGE_LABEL, confirmedCandidate, projectCost } from "@/lib/neander/shorts/model";
import type { ProjectStage } from "@/lib/neander/shorts/types";

export default function ProjectsPage() {
  const { data, refresh, nameOf } = useShorts();
  const d = data!;
  const sc = useScoped();
  const router = useRouter();
  const [stage, setStage] = useState<ProjectStage | "all">("all");
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => sc.projects.filter((p) => (stage === "all" ? p.stage !== "archived" : p.stage === stage)), [sc.projects, stage]);
  const tabs = [
    { key: "all", label: "진행 중", hint: String(sc.projects.filter((p) => p.stage !== "archived").length) },
    ...(Object.keys(STAGE_LABEL) as ProjectStage[])
      .map((s) => ({ key: s, label: STAGE_LABEL[s], hint: String(sc.projects.filter((p) => p.stage === s).length) }))
      .filter((t) => t.hint !== "0"),
  ];

  return (
    <PageShell>
      <PageHeader title="영상" description="영상 한 편 = 소스 · 쿠팡 확인(또는 고객사 브리프) · 대본 · 편집 · 검토 · 게시 · 성과. 고객사 영상은 고객사 화면에서 만듭니다." actions={<Button icon={Plus} onClick={() => setCreating(true)}>새 영상</Button>} />
      <Tabs className="mb-4" items={tabs} value={stage} onChange={(k) => setStage(k as typeof stage)} ariaLabel="단계" />
      {rows.length === 0 ? (
        <EmptyState icon={Clapperboard} title="영상이 없습니다" description="소재 발굴에서 「영상 만들기」 를 누르거나 「새 영상」 으로 시작하세요." action={<Button onClick={() => setCreating(true)}>새 영상</Button>} />
      ) : (
        <Card padding="none">
          <TableScroll>
            <Table minWidth={860}>
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
                  return (
                    <Tr key={p.id} className="cursor-pointer" onClick={() => router.push(`/neander/shorts/projects/${p.id}`)}>
                      <Td>
                        <Link href={`/neander/shorts/projects/${p.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{p.title}</Link>
                        <div className="text-nd-caption text-nd-fg-3">{p.product || "상품 미정"}{p.category ? ` · ${p.category}` : ""}</div>
                        {p.sample && <SampleTag />}
                      </Td>
                      <Td><StageBadge stage={p.stage} /></Td>
                      <Td>
                        {p.kind === "brand" ? (
                          <span>
                            <Link href={`/neander/shorts/clients/${p.clientId}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>{p.clientName || "고객사"}</Link>
                            <span className={`ml-1.5 text-nd-caption ${p.review.state === "approved" ? "text-nd-success-text" : p.review.state === "none" ? "text-nd-fg-3" : "text-nd-warning-text"}`}>{REVIEW_LABEL[p.review.state]}</span>
                          </span>
                        ) : c ? <span className="text-nd-success-text">쿠팡 확인함</span> : p.coupang.candidates.length ? <span className="text-nd-fg-2">쿠팡 후보 {p.coupang.candidates.length}개</span> : <span className="text-nd-fg-3">—</span>}
                      </Td>
                      <Td num>{p.scenes.length}</Td>
                      <Td num>{p.renderIds.length}</Td>
                      <Td num>{fmtUsd(projectCost(p).aiUsd || null)}</Td>
                      <Td muted>{p.owner === d.me ? "나" : nameOf(p.owner)} · {p.visibility === "team" ? "팀" : "나만"}{isReadOnlyFor(p, d.me) && " · 읽기 전용"}</Td>
                      <Td align="right" muted>{fmtWhen(p.updatedAt)}</Td>
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
  const [f, setF] = useState({ title: "", product: "", category: "", visibility: "private" });
  return (
    <Dialog
      open
      onClose={onClose}
      title="새 영상"
      description="쿠팡 제휴 영상입니다. 고객사(브랜드) 영상은 고객사 화면의 「영상 추가」 로 만듭니다."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>취소</Button>
          <Button disabled={busy === "c" || !f.product.trim()} onClick={() => void run("c", async () => { const r = await mutate<{ id: string }>("project.create", f); await onCreated(r.id); })}>만들기</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="상품" required><Input value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })} placeholder="예: 접이식 주방 선반" autoFocus /></Field>
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
