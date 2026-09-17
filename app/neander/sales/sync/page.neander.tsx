"use client";

// ============================================================
//  매출 › 자동 동기화 — 보이지 않는 일을 보이게 한다
// ------------------------------------------------------------
//  우리 사이트 두 곳(acscent.co.kr · smoat.co.kr)의 매출을 ERP 가 끌어온다.
//  사람이 파일을 올리지 않아도 들어오므로, **조용히 멈추면 아무도 모른다.**
//  지난주부터 매출이 안 들어오고 있는데 화면은 멀쩡해 보이는 상태가
//  틀린 숫자보다 나쁘다.
//
//  그래서 이 화면은 셋을 늘 보여준다:
//    ① 언제 마지막으로 성공했나 (며칠 지났으면 붉게)
//    ② 지난번에 무엇이 바뀌었나 (새로 생기고 고쳐지고 지워진 줄 수)
//    ③ 사람이 봐야 할 것 — 건너뛴 줄, 금액이 안 맞은 주문
//
//  ⚠️ 온라인의 「시작일」은 겹침 방지 장치다. 2026-02~08 은 엑셀로 이미
//     적재돼 있어서, 그 구간까지 자동으로 받으면 같은 판매가 두 번 잡힌다
//     (엑셀 줄은 문서 id 가 달라 멱등키로 막히지 않는다).
// ============================================================

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CircleAlert,
  CircleCheck,
  Download,
  ExternalLink,
  Pause,
  Play,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import {
  Badge,
  BasisLine,
  Button,
  Card,
  Disclosure,
  ErrorState,
  Field,
  FieldAction,
  FormRow,
  InfoPopover,
  InlineNotice,
  Input,
  LoadingState,
  PageHeader,
  PageShell,
  SectionHeader,
  Select,
  StatusDot,
  Table,
  TableNote,
  TableScroll,
  Td,
  Th,
  Tr,
  useToast,
} from "@/components/neander/ui";
import { SmoatActivate, useSmoat } from "@/components/neander/smoat/SmoatProvider";
import {
  backfillSync,
  dismissSyncIssue,
  patchSync,
  runSyncNow,
  type SyncStateView,
} from "@/lib/neander/smoat/client";
import { feedSourceLabel, FEED_SOURCES, type FeedSource } from "@/lib/neander/sync/contract";
import { TRIGGER_LABEL, type SyncIssue, type SyncRun } from "@/lib/neander/sync/types";
import { formatTimestamp, monthLabel } from "@/lib/neander/format";
import { selectableMonths, todayMonth } from "@/lib/neander/months";

/** 마지막 성공에서 이만큼 지나면 붉게 — 하루에 한 번은 돌아야 한다 */
const STALE_MS = 36 * 60 * 60 * 1000;

const ago = (at: number | undefined) => {
  if (!at) return "한 번도 돌지 않았습니다";
  const diff = Date.now() - at;
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.floor(diff / 60_000))}분 전`;
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
};

function RunSummary({ run }: { run: SyncRun }) {
  const changed = run.created + run.updated + run.deleted;
  return (
    <div className="text-nd-sm text-nd-fg-2">
      {run.ok ? (
        changed > 0 ? (
          <>
            새 줄 <b>{run.created}</b> · 고침 <b>{run.updated}</b> · 지움 <b>{run.deleted}</b>
            {run.needsReview > 0 && (
              <>
                {" · "}
                <Link
                  href="/neander/sales/review"
                  className="font-medium text-nd-accent-strong hover:underline"
                >
                  검토 {run.needsReview}
                </Link>
              </>
            )}
            {run.skipped > 0 && <> · 건너뜀 {run.skipped}</>}
          </>
        ) : (
          <>바뀐 것이 없습니다 ({run.fetched}건 확인)</>
        )
      ) : (
        <span className="text-nd-danger">{run.error}</span>
      )}
    </div>
  );
}

export default function SalesSyncPage() {
  const { states, issues, loading, error, refresh } = useSmoat();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const months = useMemo(() => selectableMonths([todayMonth()]), []);
  const [backfillMonth, setBackfillMonth] = useState(months[0] ?? todayMonth());

  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      const res = (await fn()) as { runs?: SyncRun[] } | undefined;
      await refresh();
      const runs = res?.runs ?? [];
      const failed = runs.filter((r) => !r.ok);
      if (failed.length > 0) {
        toast.error(failed.map((r) => `${feedSourceLabel(r.source)}: ${r.error ?? "실패"}`).join(" · "));
      } else if (runs.some((r) => r.deferred)) {
        // 이미 도는 실행이 있었다 — 그 실행이 끝나면 한 번 더 돌아 반영한다
        toast.info("이미 동기화가 돌고 있습니다. 끝나면 이어서 반영됩니다.");
      } else {
        toast.success(done);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <LoadingState label="동기화 상태를 불러오는 중…" />;

  if (error) {
    return (
      <PageShell width="form">
        <PageHeader title="자동 동기화" description="우리 사이트의 매출을 ERP 가 끌어옵니다." />
        <ErrorState
          title="동기화 상태를 불러올 수 없습니다"
          description={error instanceof Error ? error.message : "알 수 없는 오류"}
        />
      </PageShell>
    );
  }

  const byId = new Map(states.map((s) => [s.id, s]));

  return (
    <PageShell>
      <SmoatActivate />
      <PageHeader
        title="자동 동기화"
        description="우리 사이트 두 곳의 매출을 ERP 가 직접 끌어옵니다. 파일을 올릴 필요가 없습니다."
        className="mb-3"
        actions={
          <Button
            icon={RefreshCw}
            onClick={() => void act("all", () => runSyncNow(), "동기화했습니다")}
            disabled={busy !== null}
          >
            {busy === "all" ? "동기화 중…" : "지금 동기화"}
          </Button>
        }
      />

      <BasisLine
        className="mb-4"
        items={["사이트가 신호를 보내면 즉시", "주기 실행이 그물", "같은 것을 두 번 받아도 한 줄"]}
      >
        <InfoPopover
          label="어떻게 도나"
          title="자동 동기화가 도는 방식"
          terms={[
            {
              term: "신호 뒤 끌어오기",
              desc: "사이트가 결제를 확정하면 ERP 에 「가져가라」는 빈 신호만 보냅니다. 금액은 우리가 피드에서 직접 읽습니다. 결제 내용을 밀어 넣지 않는 이유는, 신호를 놓쳐도 다음 주기 실행이 같은 것을 가져가기 때문입니다.",
            },
            {
              term: "멱등",
              desc: "판매 줄의 문서 번호가 사이트의 주문·품목 번호로 정해져 있습니다. 신호와 주기 실행이 동시에 돌아도 같은 줄이 두 개 생기지 않습니다.",
            },
            {
              term: "사람이 이깁니다",
              desc: "검토 대기함에서 사람이 고친 줄은 동기화가 건드리지 않습니다. 사이트 금액과 달라지면 아래 「사람이 봐야 할 것」에 남습니다.",
            },
            {
              term: "시작일",
              desc: "그 날짜 앞의 매출은 가져오지 않습니다. 엑셀로 이미 적재한 구간을 자동으로 또 받으면 매출이 두 번 잡힙니다.",
            },
            {
              term: "지우기",
              desc: "주문이 취소되거나 전액 환불되면 그 줄을 지웁니다. 원본은 휴지통에 남아 되돌릴 수 있습니다.",
            },
          ]}
        />
      </BasisLine>

      {issues.length > 0 && (
        <IssueList
          issues={issues}
          busy={busy}
          onDismiss={(id) => act(`issue:${id}`, () => dismissSyncIssue(id), "목록에서 내렸습니다")}
        />
      )}

      <div className="grid gap-4">
        {FEED_SOURCES.map((src) => {
          const state = byId.get(src.value);
          return (
            <SourceCard
              key={src.value}
              source={src.value}
              site={src.site}
              state={state}
              busy={busy}
              onRun={() =>
                act(src.value, () => runSyncNow(src.value), `${feedSourceLabel(src.value)} 동기화했습니다`)
              }
              onPause={(paused) =>
                act(
                  `${src.value}:pause`,
                  () => patchSync(src.value, { paused }),
                  paused ? "자동 실행을 멈췄습니다" : "자동 실행을 켰습니다",
                )
              }
              onStartFrom={(startFrom) =>
                act(`${src.value}:start`, () => patchSync(src.value, { startFrom }), "시작일을 바꿨습니다")
              }
            />
          );
        })}
      </div>

      {/* 과거 달 다시 받기 — 엑셀 적재를 되돌린 뒤에만 쓴다 */}
      <Disclosure className="mt-4" title="과거 달 다시 받기" icon={Download}>
        <InlineNotice tone="warning" icon={TriangleAlert} className="mb-3">
          이 기능은 <b>엑셀 적재를 먼저 되돌린 뒤에</b> 쓰세요. 엑셀로 올린 줄과 자동으로 받은 줄은
          문서 번호가 달라 서로를 덮지 않습니다 — 되돌리지 않고 받으면 그 달 온라인 매출이 두 배가
          됩니다.{" "}
          <Link
            href="/neander/sales/import"
            className="font-medium text-nd-accent-strong hover:underline"
          >
            매출 적재 › 적재 이력
          </Link>
          에서 그 달의 온라인 배치를 되돌릴 수 있습니다.
        </InlineNotice>
        <FormRow>
          <Field label="달">
            <Select value={backfillMonth} onChange={(e) => setBackfillMonth(e.target.value)}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </Select>
          </Field>
          <FieldAction>
            <Button
              variant="secondary"
              icon={Download}
              disabled={busy !== null}
              onClick={() => {
                const from = `${backfillMonth}-01`;
                const [y, mo] = backfillMonth.split("-").map(Number);
                const next = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10);
                void act(
                  "backfill",
                  () => backfillSync("acscent-online", { from, to: next }),
                  `${monthLabel(backfillMonth)} 온라인 주문을 다시 받았습니다`,
                );
              }}
            >
              {busy === "backfill" ? "받는 중…" : "온라인 주문 다시 받기"}
            </Button>
          </FieldAction>
        </FormRow>
        <TableNote>
          시작일보다 앞선 달은 시작일을 먼저 옮겨야 들어옵니다.
        </TableNote>
      </Disclosure>
    </PageShell>
  );
}

/**
 * 풀릴 때까지 남는 것 — 실행 결과와 달리 다음 실행이 덮지 않는다.
 *
 * 적재하지 못한 주문은 커서가 이미 지나가 다시 오지 않는다. 여기서 사라지면
 * 그 매출은 조용히 없어진다. 그래서 사이트에서 고쳐져 다시 들어오거나
 * 사람이 「확인」을 누를 때까지 남는다.
 */
function IssueList({
  issues,
  busy,
  onDismiss,
}: {
  issues: SyncIssue[];
  busy: string | null;
  onDismiss: (id: string) => void;
}) {
  return (
    <Card padding="none" className="mb-4 overflow-hidden">
      <div className="px-5 pt-4">
        <SectionHeader
          title={`사람이 봐야 할 것 ${issues.length}건`}
          hint="사이트에서 고쳐져 다시 들어오거나 「확인」을 누를 때까지 남습니다"
        />
      </div>
      <TableScroll>
        <Table minWidth={720} dense>
          <thead>
            <tr>
              <Th sticky="top" className="pl-5">어디</Th>
              <Th sticky="top">어느 것</Th>
              <Th sticky="top">무슨 일</Th>
              <Th sticky="top" className="pr-5" />
            </tr>
          </thead>
          <tbody>
            {issues.map((i) => (
              <Tr key={i.id}>
                <Td className="whitespace-nowrap pl-5">
                  <Badge tone={i.kind === "not_loaded" ? "danger" : "warning"} size="sm">
                    {i.kind === "not_loaded" ? "적재 못 함" : "사람 손과 어긋남"}
                  </Badge>
                  <div className="mt-1 text-nd-micro text-nd-fg-3">{feedSourceLabel(i.source)}</div>
                </Td>
                <Td className="whitespace-nowrap font-medium">
                  {i.key}
                  {i.date && <div className="text-nd-micro font-normal text-nd-fg-3">{i.date}</div>}
                </Td>
                <Td>{i.note}</Td>
                <Td className="pr-5 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => onDismiss(i.id)}
                  >
                    확인
                  </Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableScroll>
      <TableNote>
        「확인」은 목록에서 내리기만 합니다. 매출을 고치려면 검토 대기함이나 사이트에서 직접 고치세요.
      </TableNote>
    </Card>
  );
}

function SourceCard({
  source,
  site,
  state,
  busy,
  onRun,
  onPause,
  onStartFrom,
}: {
  source: FeedSource;
  site: string;
  state: SyncStateView | undefined;
  busy: string | null;
  onRun: () => void;
  onPause: (paused: boolean) => void;
  onStartFrom: (startFrom: string) => void;
}) {
  const [draftStart, setDraftStart] = useState(state?.startFrom ?? "");
  const run = state?.lastRun;
  const stale = !state?.lastOkAt || Date.now() - state.lastOkAt > STALE_MS;
  const configured = state?.configured ?? false;

  const tone = !configured ? "neutral" : state?.paused ? "warning" : stale ? "danger" : "success";
  const warns = (run?.notes ?? []).filter((n) => n.level === "warn");

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot tone={tone} />
            <span className="font-semibold">{feedSourceLabel(source)}</span>
            <a
              href={`https://${site}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-nd-sm text-nd-fg-3 hover:text-nd-fg hover:underline"
            >
              {site}
              <ExternalLink className="h-3 w-3" />
            </a>
            {state?.paused && <Badge tone="warning">멈춤</Badge>}
          </div>
          <div className="mt-1 text-nd-sm text-nd-fg-3">
            {!configured ? (
              <span className="text-nd-fg-3">
                피드 주소·토큰이 설정되지 않았습니다 (환경변수).
              </span>
            ) : (
              <>
                마지막 성공 {ago(state?.lastOkAt)}
                {run && (
                  <>
                    {" · "}
                    {TRIGGER_LABEL[run.trigger]} · {formatTimestamp(run.at)}
                  </>
                )}
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {configured && (
            <Button
              variant="ghost"
              size="sm"
              icon={state?.paused ? Play : Pause}
              disabled={busy !== null}
              onClick={() => onPause(!state?.paused)}
            >
              {state?.paused ? "자동 실행 켜기" : "자동 실행 멈춤"}
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            icon={RefreshCw}
            disabled={busy !== null || !configured}
            onClick={onRun}
          >
            {busy === source ? "동기화 중…" : "지금 동기화"}
          </Button>
        </div>
      </div>

      <div className="px-5 pb-4 pt-3">
        {configured && stale && !state?.paused && (
          <InlineNotice tone="danger" icon={CircleAlert} className="mb-3">
            하루 넘게 성공한 적이 없습니다. 피드가 닿는지 확인하세요.
          </InlineNotice>
        )}

        {run && <RunSummary run={run} />}

        {source === "acscent-online" && configured && (
          <FormRow className="mt-3">
            <Field
              label="시작일"
              hint="이 날짜 앞의 주문은 가져오지 않습니다 (엑셀로 이미 적재한 구간)"
            >
              <Input
                type="date"
                value={draftStart || state?.startFrom || ""}
                onChange={(e) => setDraftStart(e.target.value)}
              />
            </Field>
            <FieldAction>
              <Button
                variant="secondary"
                disabled={busy !== null || !draftStart || draftStart === state?.startFrom}
                onClick={() => onStartFrom(draftStart)}
              >
                바꾸기
              </Button>
            </FieldAction>
          </FormRow>
        )}

        {warns.length > 0 && (
          <Disclosure
            className="mt-3"
            title={`지난 실행에서 주의할 것 ${warns.length}건`}
            icon={TriangleAlert}
          >
            <TableScroll>
              <Table minWidth={520} dense>
                <thead>
                  <tr>
                    <Th sticky="top">어느 것</Th>
                    <Th sticky="top">무슨 일</Th>
                  </tr>
                </thead>
                <tbody>
                  {warns.map((n, i) => (
                    <Tr key={`${n.key}-${i}`}>
                      <Td className="whitespace-nowrap font-medium">{n.key}</Td>
                      <Td>{n.note}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          </Disclosure>
        )}

        {run?.ok && warns.length === 0 && (
          <div className="mt-2 flex items-center gap-1.5 text-nd-sm text-nd-fg-3">
            <CircleCheck className="h-4 w-4 text-nd-success" />
            사람이 볼 것은 없습니다.
          </div>
        )}
      </div>
    </Card>
  );
}
