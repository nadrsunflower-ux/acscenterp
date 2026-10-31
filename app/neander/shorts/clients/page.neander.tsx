"use client";

// ============================================================
//  고객사 — 브랜드 대행 목록
// ------------------------------------------------------------
//  고객사마다 이 달 계약 편수 대비 진행 · 고객 검토 대기 · 수정 요청을 한 줄로.
//  담당자만 보인다 (관리자는 「모든 사용자」 보기에서 전부 · 읽기 전용).
//  조회수 약속 칸은 없다 — 계약은 제작 편수 · 수정 횟수까지다.
// ============================================================

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Plus } from "lucide-react";
import { Badge, Button, Card, Dialog, EmptyState, Field, FormRow, Input, NumberInput, PageHeader, PageShell, Table, TableScroll, Td, Th, Tr } from "@/components/neander/ui";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { useAction } from "@/components/neander/shorts/parts";
import { mutate } from "@/lib/neander/shorts/client";
import { currentMonth, monthProgress } from "@/lib/neander/shorts/model";

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
        title="고객사"
        description="브랜드 대행 — 고객사마다 계약(월 편수 · 수정 횟수) · 브리프 · 금지 표현 · 제품 사진 · 게시 계정을 두고, 월별로 영상을 만들어 승인받습니다. 조회수는 약속하지 않습니다."
        actions={<Button icon={Plus} onClick={() => setCreating(true)}>새 고객사</Button>}
      />
      {rows.length === 0 ? (
        <EmptyState icon={Briefcase} title="고객사가 없습니다" description="계약한 브랜드를 등록하면 월별 영상 · 검토 링크 · 월간 보고를 여기서 관리합니다. 내가 담당자인 고객사만 보입니다." action={<Button onClick={() => setCreating(true)}>새 고객사</Button>} />
      ) : (
        <Card padding="none">
          <TableScroll>
            <Table minWidth={900}>
              <thead>
                <tr>
                  <Th>고객사</Th>
                  <Th>상태</Th>
                  <Th align="right">{month.slice(5)}월 제작 / 계약</Th>
                  <Th align="right">승인</Th>
                  <Th align="right">검토 대기</Th>
                  <Th align="right">수정 요청</Th>
                  <Th align="right">월 금액</Th>
                  <Th>담당자</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ c, prog, overCap }) => (
                  <Tr key={c.id} className="cursor-pointer" onClick={() => router.push(`/neander/shorts/clients/${c.id}`)}>
                    <Td>
                      <Link href={`/neander/shorts/clients/${c.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{c.name}</Link>
                      {!c.canEdit && <span className="ml-2 text-nd-caption text-nd-fg-3">읽기 전용</span>}
                    </Td>
                    <Td><Badge size="sm" tone={STATUS[c.status][1]}>{STATUS[c.status][0]}</Badge></Td>
                    <Td num className={prog.made < prog.planned ? "" : "text-nd-success-text"}>{prog.made} / {prog.planned}</Td>
                    <Td num>{prog.approved}</Td>
                    <Td num className={prog.waiting ? "text-nd-warning-text" : ""}>{prog.waiting}</Td>
                    <Td num>{prog.revision}{overCap ? <span className="ml-1 text-nd-caption text-nd-danger-text">(상한 넘음 {overCap})</span> : null}</Td>
                    <Td num>{c.contract.monthlyFeeKrw === null ? "—" : `${c.contract.monthlyFeeKrw.toLocaleString("ko-KR")}원 ${c.contract.vat === "excluded" ? "(부가세 별도)" : "(부가세 포함)"}`}</Td>
                    <Td muted>{c.members.map(nameOf).join(", ")}</Td>
                  </Tr>
                ))}
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
      title="새 고객사"
      description="자세한 브리프 · 제품 · 담당자는 만든 뒤 고객사 화면에서 채웁니다."
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
        <Field label="고객사(브랜드) 이름" required><Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <FormRow className="grid-cols-1 sm:grid-cols-3">
          <Field label="월 금액 (부가세 별도)"><NumberInput value={f.fee} onValueChange={(r) => setF({ ...f, fee: r })} /></Field>
          <Field label="월 편수"><NumberInput value={f.videos} onValueChange={(r) => setF({ ...f, videos: r })} /></Field>
          <Field label="한 편당 수정 횟수"><NumberInput value={f.revisions} onValueChange={(r) => setF({ ...f, revisions: r })} /></Field>
        </FormRow>
      </div>
    </Dialog>
  );
}
