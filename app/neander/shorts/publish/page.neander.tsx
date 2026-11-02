"use client";

// 게시 현황 — 모든 프로젝트의 게시를 플랫폼별 상태로. 결과 확인이 필요한 것을 맨 위에.
// 밖에서(YouTube Studio · 인스타 앱) 올린 게시물도 자동으로 찾아 붙인다 (server/external.ts) — 위 카드 · 「다른 영상에 붙이기」.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Camera, Link2, Plug, RefreshCw, Send, SquarePlay } from "lucide-react";
import { Badge, Button, Card, Dialog, EmptyState, Field, InlineNotice, PageHeader, PageShell, SectionHeader, Select, Table, TableScroll, Tabs, Td, Th, Tr, useToast } from "@/components/neander/ui";
import { useScoped, useShorts } from "@/components/neander/shorts/ShortsProvider";
import { KindTile, PubBadge, fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { shortsPost } from "@/lib/neander/shorts/client";
import type { ExternalAccountStatus } from "@/lib/neander/shorts/external";
import { PLATFORM_LABEL } from "@/lib/neander/shorts/model";
import type { PublicationStatus, PublicationView } from "@/lib/neander/shorts/types";

const ORDER: PublicationStatus[] = ["uncertain", "failed", "uploading", "processing", "queued", "scheduled", "published", "cancelled"];
const TAB_LABEL: Record<PublicationStatus, string> = {
  uncertain: "확인 필요",
  failed: "실패",
  uploading: "전송 중",
  processing: "처리 중",
  queued: "대기",
  scheduled: "예약",
  published: "게시됨",
  cancelled: "취소",
};

/** 탭 이름 + 건수 (13px — 탭 기본 꼬리표보다 크게) */
const tabLabel = (label: string, n: number) => (
  <>
    {label}
    <span className="nd-num text-[13px] font-normal text-nd-fg-3">{n.toLocaleString("ko-KR")}</span>
  </>
);

/** 밖에서 올린 게시물 자동 연결 — 계정별 마지막 확인 · 지금 확인 */
function ExternalCard({ me, all, onSynced }: { me: string; all: boolean; onSynced: () => Promise<void> }) {
  const { nameOf } = useShorts();
  const { busy, run } = useAction();
  const toast = useToast();
  const [rows, setRows] = useState<ExternalAccountStatus[] | null>(null);
  const load = useCallback(async () => {
    const r = await shortsPost<{ accounts: ExternalAccountStatus[] }>("publish", { action: "external.status", scope: all ? "all" : "mine" }).catch(() => null);
    setRows(r?.accounts ?? []);
  }, [all]);
  useEffect(() => {
    void load();
  }, [load]);
  const mine = (rows ?? []).filter((r) => r.owner === me);
  const sync = () =>
    void run("sync", async () => {
      const r = await shortsPost<{ imported: number; accounts: ExternalAccountStatus[] }>("publish", { action: "external.sync" });
      setRows(all ? ((await shortsPost<{ accounts: ExternalAccountStatus[] }>("publish", { action: "external.status", scope: "all" }).catch(() => null))?.accounts ?? r.accounts) : r.accounts);
      await onSynced();
      toast.success(r.imported ? `새로 올린 게시물 ${r.imported}건을 연결했습니다.` : "새로 연결할 게시물이 없습니다.");
    });
  if (rows && !rows.length) return null;
  return (
    <Card className="mb-4 space-y-3">
      <SectionHeader
        title="밖에서 올린 게시물 자동 연결"
        hint="YouTube Studio · 인스타 앱에서 직접 올린 것도 매일 아침 찾아 영상에 붙이고 성과를 받아 옵니다 · 같은 영상을 두 곳에 올렸으면 한 영상으로"
        action={
          mine.length > 0 && (
            <Button size="sm" variant="secondary" icon={RefreshCw} loading={busy === "sync"} onClick={sync}>
              지금 확인
            </Button>
          )
        }
      />
      {rows === null ? (
        <p className="text-nd-body text-nd-fg-3">불러오는 중…</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {rows.map((r) => {
            const Icon = r.platform === "youtube" ? SquarePlay : Camera;
            return (
              <li key={r.accountId} className="flex min-w-0 items-start gap-2.5 rounded-nd-md bg-nd-sunken px-3 py-2.5">
                <Icon size={18} aria-hidden className="mt-0.5 shrink-0 text-nd-fg-3" />
                <div className="min-w-0">
                  <p className="truncate font-medium" title={r.name}>
                    {PLATFORM_LABEL[r.platform]} · {r.name}
                    {r.owner !== me && <span className="font-normal text-nd-fg-3"> ({nameOf(r.owner)})</span>}
                  </p>
                  <p className="text-[13px] text-nd-fg-3">
                    {r.checkedAt ? <>마지막 확인 <span className="nd-num">{fmtWhen(r.checkedAt)}</span></> : "아직 확인 전 — 내일 아침 또는 「지금 확인」"} · 연결 <span className="nd-num">{r.linked}</span>건
                  </p>
                  {r.error && <p className="text-[13px] text-nd-danger-text">{r.error}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** 밖에서 올린 게시를 다른 영상으로 — 잘못 붙었을 때 · ERP 에서 기획한 영상에 붙일 때 */
function AttachDialog({ pub, onClose, onDone }: { pub: PublicationView | null; onClose: () => void; onDone: () => Promise<void> }) {
  const { data } = useShorts();
  const sc = useScoped();
  const { busy, run } = useAction();
  const [target, setTarget] = useState("new");
  useEffect(() => setTarget("new"), [pub?.id]);
  const options = sc.projects.filter((p) => p.owner === data?.me && p.id !== pub?.projectId && !p.sample);
  const current = sc.projects.find((p) => p.id === pub?.projectId);
  const save = () =>
    void run(
      "attach",
      async () => {
        await shortsPost("publish", { action: "external.attach", publicationId: pub!.id, projectId: target });
        await onDone();
        onClose();
      },
      target === "new" ? "새 영상으로 떼어 냈습니다." : "다른 영상에 붙였습니다 — 성과 기록도 함께 옮겼습니다.",
    );
  return (
    <Dialog
      open={!!pub}
      onClose={onClose}
      title="다른 영상에 붙이기"
      description={pub ? `${PLATFORM_LABEL[pub.platform]} 게시 「${pub.meta.title || pub.meta.caption.split("\n")[0] || pub.result?.externalId}」 — 지금은 「${current?.title ?? "?"}」 에 붙어 있습니다.` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            닫기
          </Button>
          <Button loading={busy === "attach"} onClick={save}>
            옮기기
          </Button>
        </>
      }
    >
      <Field label="붙일 영상" hint="자동으로 만든 영상이 비면 지웁니다. 게시 기록 · 성과는 그대로 따라갑니다.">
        <Select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="new">— 새 영상으로 따로</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title || p.product || "(이름 없음)"}
            </option>
          ))}
        </Select>
      </Field>
    </Dialog>
  );
}

export default function PublishStatusPage() {
  const { data, nameOf, refresh } = useShorts();
  const d = data!;
  const sc = useScoped();
  const [filter, setFilter] = useState<"all" | PublicationStatus>("all");
  const [attachFor, setAttachFor] = useState<PublicationView | null>(null);
  const projectById = useMemo(() => new Map(sc.projects.map((p) => [p.id, p])), [sc.projects]);
  const accountById = useMemo(() => new Map(d.accounts.map((a) => [a.id, a])), [d.accounts]);
  const rows = [...sc.publications]
    .filter((p) => filter === "all" || p.status === filter)
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.updatedAt - a.updatedAt);
  const tabs = [
    { key: "all", label: tabLabel("전체", sc.publications.length) },
    ...ORDER.map((s) => ({ key: s, n: sc.publications.filter((p) => p.status === s).length }))
      .filter((t) => t.n > 0)
      .map((t) => ({ key: t.key, label: tabLabel(TAB_LABEL[t.key], t.n) })),
  ];
  // 게시할 수 있는 연결된 계정이 하나도 없을 때만 알린다 (실제 연결 상태 기준)
  const noPublishAccount = !d.accounts.some((a) => a.canPublish && a.status === "connected");

  return (
    <PageShell>
      <PageHeader title="게시 현황" description="플랫폼별 게시 결과. 같은 계정 · 같은 완성 파일 · 같은 플랫폼은 한 번만 게시되고, 결과가 불확실한 게시는 자동으로 다시 올리지 않습니다." />
      {sc.publications.some((p) => p.status === "uncertain") && (
        <InlineNotice tone="warning" className="mb-4">결과 확인이 필요한 게시가 있습니다. 플랫폼(YouTube Studio · Instagram)에서 올라갔는지 보고, 그 영상의 게시 탭에서 「결과 기록」 을 눌러 주세요.</InlineNotice>
      )}
      {noPublishAccount && (
        <InlineNotice
          tone="neutral"
          icon={Plug}
          className="mb-4"
          action={<Link href="/neander/shorts/accounts"><Button size="sm" variant="secondary">내 채널 · 연결</Button></Link>}
        >
          연결된 SNS 게시 계정이 없습니다 — 새 게시와 예약 실행에는 계정 연결이 필요합니다.
        </InlineNotice>
      )}
      <ExternalCard me={d.me} all={d.scope === "all"} onSynced={refresh} />
      <Tabs className="mb-4" items={tabs} value={filter} onChange={(k) => setFilter(k as typeof filter)} ariaLabel="상태" />
      {rows.length === 0 ? (
        <EmptyState icon={Send} title="게시 기록이 없습니다" description="영상의 게시 탭에서 게시하거나, 플랫폼에서 직접 올리면 위 자동 연결이 찾아 여기에 쌓습니다." />
      ) : (
        <Card padding="none" className="overflow-hidden">
          <TableScroll>
            <Table size="md" minWidth={1040}>
              <thead>
                <tr>
                  <Th>영상</Th>
                  <Th>플랫폼 · 계정</Th>
                  <Th>상태</Th>
                  <Th>결과</Th>
                  <Th align="right">예약 · 갱신</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const project = projectById.get(p.projectId);
                  const acc = accountById.get(p.accountId);
                  const title = project?.title ?? "(볼 수 없는 영상)";
                  const sub = project ? (project.kind === "brand" ? project.clientName || "고객사" : project.product || (project.kind === "general" ? "일반 영상" : "상품 미정")) : "";
                  const PlatformIcon = p.platform === "youtube" ? SquarePlay : Camera;
                  return (
                    <Tr key={p.id}>
                      <Td className="w-[30%] max-w-0">
                        <div className="flex min-w-0 items-center gap-3">
                          <KindTile kind={project?.kind ?? "coupang"} className="h-9 w-9" />
                          <div className="min-w-0">
                            <Link href={`/neander/shorts/projects/${p.projectId}?tab=publish`} className="block truncate font-medium hover:underline" title={title}>{title}</Link>
                            {sub && <p className="truncate text-[13px] text-nd-fg-3" title={sub}>{sub}</p>}
                          </div>
                        </div>
                      </Td>
                      <Td className="whitespace-nowrap">
                        <div className="flex items-center gap-2.5">
                          <PlatformIcon size={18} aria-hidden className="shrink-0 text-nd-fg-3" />
                          <div className="min-w-0">
                            <p>{PLATFORM_LABEL[p.platform]}</p>
                            <p className="max-w-[220px] truncate text-[13px] text-nd-fg-3" title={acc ? `${acc.externalName} (${nameOf(acc.owner)})` : undefined}>
                              {acc ? `${acc.externalName} (${nameOf(acc.owner)})` : "(공유 끊김)"}
                            </p>
                          </div>
                          {acc?.status === "needs_reauth" && <Badge tone="danger" size="lg">다시 연결 필요</Badge>}
                        </div>
                      </Td>
                      <Td className="whitespace-nowrap"><PubBadge status={p.status} size="lg" /></Td>
                      <Td className="w-[34%] max-w-0">
                        {p.result ? (
                          <>
                            {p.result.url ? (
                              <a href={p.result.url} target="_blank" rel="noreferrer" className="block truncate text-nd-accent hover:underline" title={p.result.url}>{p.result.url}</a>
                            ) : (
                              <p className="text-nd-fg-3">주소 기록 없음</p>
                            )}
                            <p className="text-[13px] text-nd-fg-3">
                              {p.origin === "external" ? "밖에서 올림 · 자동 연결" : p.result.by === "manual" ? "직접 기록" : "API 확인"} · <span className="nd-num">{fmtWhen(p.result.at)}</span>
                              {p.origin === "external" && p.owner === d.me && (
                                <button type="button" onClick={() => setAttachFor(p)} className="ml-2 inline-flex items-center gap-1 text-nd-accent hover:underline">
                                  <Link2 size={13} aria-hidden />
                                  다른 영상에 붙이기
                                </button>
                              )}
                            </p>
                          </>
                        ) : p.error?.message ? (
                          <p className="line-clamp-2 text-[13px] text-nd-fg-2" title={p.error.message}>{p.error.message}</p>
                        ) : (
                          <span className="text-nd-fg-3">—</span>
                        )}
                      </Td>
                      <Td num className="whitespace-nowrap">
                        {p.status === "scheduled" ? (
                          <>
                            {fmtWhen(p.scheduledAt)}
                            <span className="ml-1 text-[13px] text-nd-fg-3">이후</span>
                          </>
                        ) : (
                          <span className="text-nd-fg-2">{fmtWhen(p.updatedAt)}</span>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </TableScroll>
        </Card>
      )}
      <AttachDialog pub={attachFor} onClose={() => setAttachFor(null)} onDone={refresh} />
    </PageShell>
  );
}
