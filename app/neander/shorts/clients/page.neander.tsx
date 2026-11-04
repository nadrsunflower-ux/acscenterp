"use client";

// ============================================================
//  업체 · 계약 — 브랜드 대행 업체(고객사) 목록 (2026-11 목업 03 개편)
// ------------------------------------------------------------
//  위 4칸: 진행 중 업체 · 이번 달 제작/계약 · 고객 검토 대기 · 수금 확인 필요(재무 권한일 때).
//  표: 업체마다 이 달 계약 편수 대비 진행 · 승인 · 검토 대기 · 수정 요청(상한 넘음) · 대행 프로젝트 수 ·
//  월 금액(부가세 기준) · 재무 계약(받음 / 계약 · 연체) · 담당자. 모바일은 카드.
//  담당자와 AI STUDIO 관리자에게 보인다 (관리자는 담당자가 아니면 읽기 전용). 재무 칸은 재무 권한이 있을 때만.
//  조회수 약속 칸은 없다 — 계약은 제작 편수 · 수정 횟수까지다.
// ============================================================

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, FolderOpen, Lock, Plus } from "lucide-react";
import { Badge, Button, Dialog, EmptyState, Field, FilterBar, FilterField, FormRow, Input, NumberInput, PageShell, SearchInput, Select } from "@/components/neander/ui";
import { useAppData } from "@/components/neander/app-data";
import { Won } from "@/components/neander/shorts/agency-ui/won";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { Unknown, useAction } from "@/components/neander/shorts/parts";
import { ProgressLine, RecordTable, StudioCard, StudioHeader, StudioMetric, StudioNotice, type RecordColumn } from "@/components/neander/shorts/studio";
import { rollupFinance, vatText } from "@/components/neander/shorts/agency-ui/finance";
import { mutate } from "@/lib/neander/shorts/client";
import { currentMonth, monthProgress } from "@/lib/neander/shorts/model";
import { inContract } from "@/lib/neander/shorts/agency";
import { spaceKind } from "@/lib/neander/shorts/spaces";
import { CLIENT_DELIVERY_LABEL, type ClientDelivery, type ClientStatus, type ClientView } from "@/lib/neander/shorts/types";

const STATUS = { active: ["진행", "success"], paused: ["멈춤", "warning"], ended: ["종료", "neutral"] } as const;

type Row = { c: ClientView; prog: ReturnType<typeof monthProgress>; overCap: number; inMonth: boolean; spaces: number; waitingTitles: string[] };

export default function ClientsPage() {
  const { data, refresh, nameOf } = useShorts();
  const d = data!;
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | ClientStatus>("");
  const month = currentMonth();
  const M = Number(month.slice(5));
  const rows: Row[] = useMemo(
    () =>
      d.clients.map((c) => {
        const ps = d.projects.filter((p) => p.clientId === c.id && p.month === month);
        return {
          c,
          prog: monthProgress(ps, c.contract.videosPerMonth),
          overCap: ps.filter((p) => p.review.revisionsUsed > c.contract.revisionLimit).length,
          inMonth: inContract(c, month),
          spaces: d.spaces.filter((x) => !x.archived && spaceKind(x) === "agency" && x.clientId === c.id).length,
          waitingTitles: ps.filter((p) => p.review.state === "waiting").map((p) => p.title),
        };
      }),
    [d.clients, d.projects, d.spaces, month],
  );
  const shown = rows.filter(({ c }) => {
    if (status && c.status !== status) return false;
    const t = q.trim().toLowerCase();
    if (!t) return true;
    return c.name.toLowerCase().includes(t) || c.members.some((m) => m.toLowerCase().includes(t) || nameOf(m).toLowerCase().includes(t)) || c.contactName.toLowerCase().includes(t);
  });

  // 위 4칸 — 진행 중이고 이 달이 계약 기간 안인 업체 기준
  const running = rows.filter((r) => r.c.status === "active");
  const counted = running.filter((r) => r.inMonth);
  const made = counted.reduce((n, r) => n + r.prog.made, 0);
  const planned = counted.reduce((n, r) => n + r.prog.planned, 0);
  const waiting = rows.reduce((n, r) => n + r.prog.waiting, 0);
  const waitingTitles = rows.flatMap((r) => r.waitingTitles);
  const overdue = d.financeAccess ? rows.reduce((n, r) => n + (rollupFinance(d.clientFinance[r.c.id])?.overdue ?? 0), 0) : 0;
  const revision = rows.reduce((n, r) => n + r.prog.revision, 0);
  const overCap = rows.reduce((n, r) => n + r.overCap, 0);
  const people = new Set(running.flatMap((r) => r.c.members)).size;

  const columns: RecordColumn<Row>[] = [
    {
      key: "name",
      header: "업체 · 담당자",
      mobile: "title",
      cell: ({ c }) => (
        <span className="block min-w-0">
          <span className="block truncate font-semibold" title={c.name}>
            {c.name}
          </span>
          <span className="block truncate text-[13px] font-normal text-nd-fg-3">
            담당 · {c.members.map(nameOf).join(", ") || "없음"}
            {!c.canEdit ? " · 읽기 전용" : ""}
          </span>
        </span>
      ),
    },
    {
      key: "status",
      header: "상태",
      cell: ({ c }) => (
        <Badge size="lg" dot tone={STATUS[c.status][1]}>
          {STATUS[c.status][0]}
        </Badge>
      ),
    },
    { key: "spaces", header: "프로젝트", align: "right", cell: (r) => `${r.spaces}개` },
    {
      key: "month",
      header: `${M}월 제작 / 계약`,
      className: "w-[170px]",
      cell: ({ prog, inMonth, c }) =>
        !inMonth && prog.made === 0 ? (
          <span className="text-nd-fg-3">{c.status === "ended" ? "계약 종료" : "계약 기간 밖"}</span>
        ) : (
          <span className="block min-w-[120px]">
            <span className={prog.planned > 0 && prog.made >= prog.planned ? "nd-num font-semibold text-nd-success-text" : "nd-num font-semibold"}>
              {prog.made} / {prog.planned}편
            </span>
            <ProgressLine className="mt-1.5 hidden md:block" value={prog.made} total={prog.planned} />
          </span>
        ),
    },
    {
      key: "review",
      header: "승인 · 검토 · 수정",
      cell: ({ prog, overCap: over, c }) => (
        <span className="block whitespace-nowrap text-[13px] leading-relaxed">
          <span className="block">
            승인 {prog.approved} · <span className={prog.waiting ? "font-semibold text-nd-warning-text" : undefined}>검토 대기 {prog.waiting}</span>
          </span>
          <span className="block">
            <span className={prog.revision ? "text-nd-danger-text" : undefined}>수정 요청 {prog.revision}</span>
            {over > 0 && <span className="font-medium text-nd-danger-text"> · 상한 넘음 {over}편</span>}
            <span className="text-nd-fg-3"> · 편당 {c.contract.revisionLimit}회</span>
          </span>
        </span>
      ),
    },
    {
      key: "fee",
      header: "월 금액",
      align: "right",
      cell: ({ c }) =>
        c.contract.monthlyFeeKrw === null ? (
          <Unknown title="계약 금액을 아직 적지 않았습니다" />
        ) : (
          <span className="block whitespace-nowrap">
            <Won value={c.contract.monthlyFeeKrw} flow="income" className="font-semibold" />
            <span className="block text-[13px] text-nd-fg-3">{vatText(c.contract.vat)}</span>
          </span>
        ),
    },
    ...(d.financeAccess
      ? [
          {
            key: "finance",
            header: "재무 계약 (받음 / 계약)",
            align: "right",
            cell: ({ c }) => {
              const f = rollupFinance(d.clientFinance[c.id]);
              if (!f) return <span className="text-nd-fg-3">이은 계약 없음</span>;
              return (
                <span className="block whitespace-nowrap">
                  {f.received === null ? <Unknown title="회차가 없어 받은 돈을 셀 수 없습니다" /> : <Won value={f.received} flow="income" className="font-semibold" />}
                  <span className="text-nd-fg-3"> 받음</span>
                  <span className="block text-[13px] text-nd-fg-3">
                    / {f.contract.toLocaleString("ko-KR")}원 계약 · {vatText(f.vat)}
                  </span>
                  {f.overdue > 0 && (
                    <Badge tone="danger" size="lg" className="mt-1">
                      연체 {f.overdue}건
                    </Badge>
                  )}
                </span>
              );
            },
          } satisfies RecordColumn<Row>,
        ]
      : []),
  ];

  return (
    <PageShell>
      <StudioHeader
        kicker="AI STUDIO 워크스페이스"
        kickerIcon={FolderOpen}
        title="업체 · 계약"
        description="월별 납품, 고객 승인, 수정 요청과 수금 상태를 한 줄에서 확인하세요. 업체마다 계약 · 브리프 · 금지 표현 · 제품 사진 · 게시 방식 · 재무 계약 · 계약서를 두고, 브랜드(채널)마다 대행 프로젝트를 만듭니다."
        actions={
          <Button icon={Plus} onClick={() => setCreating(true)}>
            새 업체
          </Button>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StudioMetric label="진행 중 업체" value={running.length.toLocaleString("ko-KR")} unit="곳" detail={`업체 담당자 ${people}명`} />
        <StudioMetric
          label="이번 달 제작 / 계약"
          value={made.toLocaleString("ko-KR")}
          unit={`/ ${planned.toLocaleString("ko-KR")}편`}
          detail={planned > 0 ? `제작 진행률 ${Math.round((made / planned) * 1000) / 10}% (제작 기준)` : "계약 기간 안인 업체 없음"}
        />
        <StudioMetric label="고객 검토 대기" value={waiting.toLocaleString("ko-KR")} unit="편" tone={waiting ? "warning" : undefined} detail={waitingTitles.length ? waitingTitles.slice(0, 2).join(" · ") + (waitingTitles.length > 2 ? ` 외 ${waitingTitles.length - 2}` : "") : "기다리는 검토 없음"} />
        {d.financeAccess ? (
          <StudioMetric label="수금 확인 필요" value={overdue.toLocaleString("ko-KR")} unit="건" tone={overdue ? "danger" : undefined} detail="기한 지난 미수금 (재무 회차 기준)" />
        ) : (
          <StudioMetric label="수정 요청 중" value={revision.toLocaleString("ko-KR")} unit="편" tone={revision ? "danger" : undefined} detail={overCap ? `상한 넘음 ${overCap}편` : "상한 넘은 영상 없음"} />
        )}
      </div>
      <StudioNotice tone="info" title="대행 계약은 제작 편수와 수정 횟수를 기준으로 관리합니다" className="mb-5">
        월 고정 금액 · 월 계약 편수 · 수정 횟수 상한을 관리하며 조회수는 계약상 보장하지 않습니다.
      </StudioNotice>

      {rows.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="계약 업체가 없습니다"
          description="계약한 업체를 등록하면 대행 프로젝트 · 월별 영상 · 검토 링크 · 월간 보고 · 재무 계약을 여기서 관리합니다. 내가 담당자인 업체(관리자는 전부)가 보입니다."
          action={
            <Button icon={Plus} onClick={() => setCreating(true)}>
              새 업체
            </Button>
          }
        />
      ) : (
        <StudioCard
          flush
          title="업체 목록"
          action={
            <Badge tone="neutral" size="lg">
              {shown.length === rows.length ? `${rows.length}곳` : `${shown.length} / ${rows.length}곳`}
            </Badge>
          }
        >
          <div className="px-5 pb-4 sm:px-6">
            <FilterBar>
              <FilterField label="업체 검색">
                <SearchInput value={q} onValueChange={setQ} placeholder="업체 이름 또는 담당자" ariaLabel="업체 검색" />
              </FilterField>
              <FilterField label="진행 상태">
                <Select size="sm" value={status} onChange={(e) => setStatus(e.target.value as "" | ClientStatus)} aria-label="진행 상태">
                  <option value="">전체 상태</option>
                  <option value="active">진행</option>
                  <option value="paused">멈춤</option>
                  <option value="ended">종료</option>
                </Select>
              </FilterField>
            </FilterBar>
          </div>
          <RecordTable
            rows={shown}
            columns={columns}
            rowKey={(r) => r.c.id}
            rowHref={(r) => `/neander/shorts/clients/${r.c.id}`}
            ariaLabel="업체 목록"
            className="[&>ul]:px-4 [&>ul]:pb-4"
            empty={<p className="px-5 pb-5 text-nd-body text-nd-fg-3 sm:px-6">조건에 맞는 업체가 없습니다.</p>}
          />
        </StudioCard>
      )}
      <p className="mt-3 flex items-start gap-1.5 text-[13px] text-nd-fg-3">
        <Lock size={14} aria-hidden className="mt-0.5 shrink-0" />
        AI STUDIO 관리자와 그 업체 담당자에게만 보입니다{d.financeAccess ? "" : " · 재무 계약 칸은 재무 권한이 있는 사람에게만 보입니다"}. 업체를 누르면 계약 · 브리프 · 월별 영상을 볼 수 있습니다.
      </p>
      {creating && (
        <NewClient
          me={d.me}
          onClose={() => setCreating(false)}
          onCreated={async (id) => {
            await refresh();
            router.push(`/neander/shorts/clients/${id}`);
          }}
        />
      )}
    </PageShell>
  );
}

/** 새 업체 — 서버의 업체 저장(client.save)이 받는 계약 칸을 처음부터 함께 받는다 */
function NewClient({ me, onClose, onCreated }: { me: string; onClose: () => void; onCreated: (id: string) => Promise<void> }) {
  const { busy, run } = useAction();
  const { members } = useAppData();
  const team = members.filter((m) => !!m.email);
  const month = currentMonth();
  const [f, setF] = useState({
    name: "",
    status: "active" as ClientStatus,
    member: me,
    fee: "1500000",
    vat: "excluded" as "excluded" | "included",
    videos: "8",
    revisions: "2",
    delivery: "upload" as ClientDelivery,
    startMonth: month,
    endMonth: "",
  });
  const endBad = !!f.endMonth && f.endMonth < f.startMonth;
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="새 업체"
      description="월 제작 약속과 담당자를 먼저 정하세요. 브리프 · 제품 · 재무 계약은 만든 뒤 업체 화면에서 채우고, 대행 프로젝트(브랜드 · 채널)는 업체 화면의 「프로젝트」 탭에서 만듭니다."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button
            icon={Plus}
            loading={busy === "c"}
            disabled={busy === "c" || !f.name.trim() || endBad}
            onClick={() =>
              void run("c", async () => {
                const r = await mutate<{ id: string }>("client.save", {
                  client: {
                    name: f.name,
                    status: f.status,
                    // 만든 사람은 서버가 늘 담당자로 넣는다
                    members: [...new Set([me, f.member].filter(Boolean))],
                    delivery: f.delivery,
                    contract: {
                      monthlyFeeKrw: f.fee ? Number(f.fee) : null,
                      vat: f.vat,
                      videosPerMonth: Number(f.videos) || 8,
                      revisionLimit: Number(f.revisions) || 0,
                      startMonth: f.startMonth,
                      endMonth: f.endMonth || null,
                    },
                  },
                });
                await onCreated(r.id);
              })
            }
          >
            업체 만들기
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormRow className="grid-cols-1 sm:grid-cols-2">
          <Field label="업체 이름" required>
            <Input autoFocus value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="예: 주식회사 ○○" />
          </Field>
          <Field label="상태">
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as ClientStatus })}>
              <option value="active">진행</option>
              <option value="paused">멈춤</option>
              <option value="ended">종료</option>
            </Select>
          </Field>
        </FormRow>
        <FormRow className="grid-cols-1 sm:grid-cols-2">
          <Field label="담당자 (함께 쓰는 팀원)" hint="나는 늘 담당자입니다 — 더 넣거나 빼는 것은 업체 화면의 「계약 · 브리프」 에서">
            <Select value={f.member} onChange={(e) => setF({ ...f, member: e.target.value })}>
              <option value={me}>나만</option>
              {team
                .filter((m) => m.email!.toLowerCase() !== me.toLowerCase())
                .map((m) => (
                  <option key={m.id} value={m.email!.toLowerCase()}>
                    나 + {m.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="월 계약 금액 (원)">
            <NumberInput value={f.fee} onValueChange={(r) => setF({ ...f, fee: r })} />
          </Field>
        </FormRow>
        <FormRow className="grid-cols-1 sm:grid-cols-2">
          <Field label="부가세 기준">
            <Select value={f.vat} onChange={(e) => setF({ ...f, vat: e.target.value as "excluded" | "included" })}>
              <option value="excluded">별도</option>
              <option value="included">포함</option>
            </Select>
          </Field>
          <Field label="월 계약 편수">
            <NumberInput value={f.videos} onValueChange={(r) => setF({ ...f, videos: r })} />
          </Field>
        </FormRow>
        <FormRow className="grid-cols-1 sm:grid-cols-2">
          <Field label="수정 횟수 상한 (영상 한 편당)">
            <NumberInput value={f.revisions} onValueChange={(r) => setF({ ...f, revisions: r })} />
          </Field>
          <Field label="게시 방식">
            <Select value={f.delivery} onChange={(e) => setF({ ...f, delivery: e.target.value as ClientDelivery })}>
              {(Object.keys(CLIENT_DELIVERY_LABEL) as ClientDelivery[]).map((k) => (
                <option key={k} value={k}>
                  {CLIENT_DELIVERY_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
        </FormRow>
        <FormRow className="grid-cols-1 sm:grid-cols-2">
          <Field label="시작 월">
            <Input type="month" value={f.startMonth} onChange={(e) => setF({ ...f, startMonth: e.target.value || month })} />
          </Field>
          <Field label="끝 월 (비우면 계속)" error={endBad ? "끝 월이 시작 월보다 앞입니다" : undefined}>
            <Input type="month" value={f.endMonth} onChange={(e) => setF({ ...f, endMonth: e.target.value })} />
          </Field>
        </FormRow>
        <StudioNotice tone="info" title="조회수를 약속하지 않는 제작 계약">
          월 고정 금액, 편수와 수정 횟수 상한을 기준으로 이행을 관리합니다.
        </StudioNotice>
      </div>
    </Dialog>
  );
}
