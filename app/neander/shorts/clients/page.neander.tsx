"use client";

// ============================================================
//  업체 · 계약 — 브랜드 대행 업체(고객사) 목록
// ------------------------------------------------------------
//  업체마다 이 달 계약 편수 대비 진행 · 고객 검토 대기 · 수정 요청 · 대행 프로젝트 수 · 재무 계약(입금)을 한 줄로.
//  담당자와 AI STUDIO 관리자에게 보인다 (관리자는 담당자가 아니면 읽기 전용). 재무 칸은 재무 권한이 있을 때만.
//  조회수 약속 칸은 없다 — 계약은 제작 편수 · 수정 횟수까지다.
// ============================================================

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Plus } from "lucide-react";
import { Badge, Button, Card, Dialog, EmptyState, Field, FormRow, Input, Meter, NumberInput, PageHeader, PageShell, Table, TableScroll, Td, Th, Tr } from "@/components/neander/ui";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { KindTile, Unknown, useAction } from "@/components/neander/shorts/parts";
import { mutate } from "@/lib/neander/shorts/client";
import { currentMonth, monthProgress } from "@/lib/neander/shorts/model";
import { spaceKind } from "@/lib/neander/shorts/spaces";

const STATUS = { active: ["진행", "success"], paused: ["멈춤", "warning"], ended: ["종료", "neutral"] } as const;

export default function ClientsPage() {
  const { data, refresh, nameOf } = useShorts();
  const d = data!;
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const month = currentMonth();
  const rows = useMemo(
    () =>
      d.clients.map((c) => {
        const ps = d.projects.filter((p) => p.clientId === c.id && p.month === month);
        return { c, prog: monthProgress(ps, c.contract.videosPerMonth), overCap: ps.filter((p) => p.review.revisionsUsed > c.contract.revisionLimit).length };
      }),
    [d.clients, d.projects, month],
  );

  return (
    <PageShell>
      <PageHeader
        title="업체 · 계약"
        description="브랜드 대행 업체 — 업체마다 계약(월 편수 · 수정 횟수) · 브리프 · 금지 표현 · 제품 사진 · 게시 방식 · 재무 계약 · 계약서를 두고, 브랜드(채널)마다 대행 프로젝트를 만들어 월별로 영상을 만들고 승인받습니다. 조회수는 약속하지 않습니다."
        actions={<Button icon={Plus} onClick={() => setCreating(true)}>새 업체</Button>}
      />
      {rows.length === 0 ? (
        <EmptyState icon={Briefcase} title="계약 업체가 없습니다" description="계약한 업체를 등록하면 대행 프로젝트 · 월별 영상 · 검토 링크 · 월간 보고 · 재무 계약을 여기서 관리합니다. 내가 담당자인 업체(관리자는 전부)가 보입니다." action={<Button onClick={() => setCreating(true)}>새 업체</Button>} />
      ) : (
        <Card padding="none" className="overflow-hidden">
          <TableScroll>
            <Table size="md" minWidth={980}>
              <thead>
                <tr>
                  <Th>업체</Th>
                  <Th>상태</Th>
                  <Th align="right">프로젝트</Th>
                  <Th align="right">{Number(month.slice(5))}월 제작 / 계약</Th>
                  <Th align="right">승인</Th>
                  <Th align="right">검토 대기</Th>
                  <Th align="right">수정 요청</Th>
                  <Th align="right">월 금액</Th>
                  {d.financeAccess && <Th align="right">재무 계약 (받음 / 계약)</Th>}
                  <Th>담당자</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ c, prog, overCap }) => {
                  const members = c.members.map(nameOf).join(", ");
                  return (
                    <Tr key={c.id} className="cursor-pointer" onClick={() => router.push(`/neander/shorts/clients/${c.id}`)}>
                      <Td className="w-full max-w-0">
                        <div className="flex min-w-0 items-center gap-3">
                          <KindTile kind="brand" className="h-9 w-9" />
                          <div className="min-w-0">
                            <Link href={`/neander/shorts/clients/${c.id}`} className="block truncate font-medium hover:underline" title={c.name} onClick={(e) => e.stopPropagation()}>{c.name}</Link>
                            {!c.canEdit && <p className="text-[13px] text-nd-fg-3">읽기 전용</p>}
                          </div>
                        </div>
                      </Td>
                      <Td className="whitespace-nowrap"><Badge size="lg" dot tone={STATUS[c.status][1]}>{STATUS[c.status][0]}</Badge></Td>
                      <Td num>{d.spaces.filter((x) => !x.archived && spaceKind(x) === "agency" && x.clientId === c.id).length}</Td>
                      <Td num className="whitespace-nowrap">
                        <span className="inline-flex items-center gap-2.5">
                          <Meter value={prog.made} max={prog.planned} width={56} />
                          <span className={prog.planned > 0 && prog.made >= prog.planned ? "text-nd-success-text" : ""}>
                            {prog.made} <span className="text-nd-fg-3">/</span> {prog.planned}
                            <span className="ml-0.5 text-[13px] text-nd-fg-3">편</span>
                          </span>
                        </span>
                      </Td>
                      <Td num>{prog.approved}</Td>
                      <Td num className={prog.waiting ? "font-semibold text-nd-warning-text" : ""}>{prog.waiting}</Td>
                      <Td num className="whitespace-nowrap">
                        <span className={prog.revision ? "text-nd-danger-text" : ""}>{prog.revision}</span>
                        {overCap ? <div className="text-[13px] text-nd-danger-text">상한 넘음 {overCap}</div> : null}
                      </Td>
                      <Td num className="whitespace-nowrap">
                        {c.contract.monthlyFeeKrw === null ? (
                          <Unknown title="계약 금액을 아직 적지 않았습니다" />
                        ) : (
                          <>
                            {c.contract.monthlyFeeKrw.toLocaleString("ko-KR")}
                            <span className="ml-0.5 text-nd-fg-3">원</span>
                            <div className="text-[13px] text-nd-fg-3">{c.contract.vat === "excluded" ? "부가세 별도" : "부가세 포함"}</div>
                          </>
                        )}
                      </Td>
                      {d.financeAccess && (
                        <Td num className="whitespace-nowrap">
                          {(() => {
                            const fs = (d.clientFinance[c.id] ?? []).filter((x) => x.projectId);
                            if (!fs.length) return <span className="text-nd-fg-3">이은 계약 없음</span>;
                            const contract = fs.reduce((n, x) => n + x.contractAmount, 0);
                            const known = fs.filter((x) => x.received !== null);
                            const got = known.reduce((n, x) => n + (x.received ?? 0), 0);
                            const overdue = fs.reduce((n, x) => n + x.overdue, 0);
                            return (
                              <>
                                {known.length ? got.toLocaleString("ko-KR") : "—"} <span className="text-nd-fg-3">/</span> {contract.toLocaleString("ko-KR")}
                                <span className="ml-0.5 text-nd-fg-3">원</span>
                                {overdue > 0 && <div className="text-[13px] font-medium text-nd-danger-text">연체 {overdue}건</div>}
                              </>
                            );
                          })()}
                        </Td>
                      )}
                      <Td className="max-w-[220px] truncate text-nd-fg-2" title={members}>{members || <span className="text-nd-fg-3">—</span>}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </TableScroll>
        </Card>
      )}
      {creating && <NewClient onClose={() => setCreating(false)} onCreated={async (id) => { await refresh(); router.push(`/neander/shorts/clients/${id}`); }} />}
    </PageShell>
  );
}

function NewClient({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => Promise<void> }) {
  const { busy, run } = useAction();
  const [f, setF] = useState({ name: "", fee: "1500000", videos: "8", revisions: "2" });
  return (
    <Dialog
      open
      onClose={onClose}
      title="새 업체"
      description="자세한 브리프 · 제품 · 담당자 · 게시 방식 · 재무 계약은 만든 뒤 업체 화면에서 채웁니다. 대행 프로젝트(브랜드 · 채널)는 업체 화면의 「프로젝트」 탭에서 만듭니다."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>취소</Button>
          <Button
            disabled={busy === "c" || !f.name.trim()}
            onClick={() =>
              void run("c", async () => {
                const r = await mutate<{ id: string }>("client.save", {
                  client: { name: f.name, contract: { monthlyFeeKrw: f.fee ? Number(f.fee) : null, vat: "excluded", videosPerMonth: Number(f.videos) || 8, revisionLimit: Number(f.revisions) || 0 } },
                });
                await onCreated(r.id);
              })
            }
          >
            만들기
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="업체 이름" required><Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <FormRow className="grid-cols-1 sm:grid-cols-3">
          <Field label="월 금액 (부가세 별도)"><NumberInput value={f.fee} onValueChange={(r) => setF({ ...f, fee: r })} /></Field>
          <Field label="월 편수"><NumberInput value={f.videos} onValueChange={(r) => setF({ ...f, videos: r })} /></Field>
          <Field label="한 편당 수정 횟수"><NumberInput value={f.revisions} onValueChange={(r) => setF({ ...f, revisions: r })} /></Field>
        </FormRow>
      </div>
    </Dialog>
  );
}
