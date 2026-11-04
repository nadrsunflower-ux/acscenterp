"use client";

// ============================================================
//  아침 브리핑 — 대시보드 「오늘 아침 브리핑」 카드 · 「메일로 받기」 창
// ------------------------------------------------------------
//  카드: 볼 수 있는 프로젝트마다(대행은 관리자 · 그 업체 담당자만) 오늘 브리핑 헤드라인 + 특기 사항 3개.
//  없으면 「아직 없음 (매일 07:30)」, 시장 트렌드 자동 실행이 꺼진 프로젝트는 「꺼져 있음」 — 사실대로.
//  「시장 트렌드에서 보기」 는 그 프로젝트로 바꿔 시장 트렌드를 연다 (대시보드의 「이 프로젝트로」 와 같은 방식).
//  메일로 받기: 사람마다 · 기본 꺼짐 · ERP 메일에 연결한 내 계정으로 나에게(내게쓰기). 저장 버튼 없이 바로 저장.
//  「미리 보기」 는 보내지 않고 본문을 창에 · 「지금 나에게 보내 보기」 만 실제로 보낸다(누를 때만 · 하루 한도).
// ============================================================

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Eye, Mail, Newspaper, Send } from "lucide-react";
import { Badge, Button, Checkbox, Dialog, Select, Skeleton, Switch, buttonClass, cn, useToast, type Tone } from "@/components/neander/ui";
import { SaveIndicator, SpaceKindBadge, StudioCard, StudioNotice, type StudioSaveState } from "@/components/neander/shorts/studio";
import { fmtWhen } from "@/components/neander/shorts/parts";
import { shortsPost } from "@/lib/neander/shorts/client";
import { BRIEF_KIND_LABEL, type MarketBriefItem } from "@/lib/neander/shorts/market";
import { briefDayLabel, type BriefMailPref } from "@/lib/neander/shorts/brief-mail";

type Status = "ready" | "none" | "off";
interface Digest {
  spaceId: string;
  spaceName: string;
  kind: "own" | "agency";
  status: Status;
  day: string;
  brief: { headline: string; at: number; by: string; items: Pick<MarketBriefItem, "kind" | "title" | "numbers">[]; total: number } | null;
  yesterday: { day: string; headline: string } | null;
}
interface MailState {
  pref: BriefMailPref;
  accounts: { key: string; address: string; label: string | null; provider: string; authFailed: boolean }[];
  account: { key: string; address: string } | null;
  blocked: string | null;
  spaces: { id: string; name: string; kind: "own" | "agency" }[];
  test: { used: number; limit: number };
  today: string;
}
interface Preview {
  day: string;
  from: string | null;
  to: string | null;
  mail: { subject: string; html: string; text: string } | null;
  sections: { spaceId: string; spaceName: string; status: Status }[];
  blocked: string | null;
}

const KIND_TONE: Record<MarketBriefItem["kind"], Tone> = { product: "accent", format: "neutral", hit: "warning", keyword: "info", channel: "neutral", mine: "success" };
const PROVIDER_LABEL: Record<string, string> = { cafe24: "카페24", naver: "네이버", gmail: "Gmail" };

/** 대시보드 카드 — onOpen(프로젝트 id) 는 그 프로젝트로 바꿔 시장 트렌드로 간다 */
export function MorningBriefCard({ onOpen, className }: { onOpen: (spaceId: string) => void; className?: string }) {
  const [list, setList] = useState<Digest[] | null>(null);
  const [today, setToday] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [mail, setMail] = useState<MailState | null>(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => {
    setErr(null);
    shortsPost<{ today: string; digests: Digest[] }>("market", { action: "briefs.list" })
      .then((r) => (setList(r.digests), setToday(r.today)))
      .catch((e) => setErr(e instanceof Error ? e.message : "브리핑을 불러오지 못했습니다."));
    shortsPost<{ state: MailState }>("market", { action: "briefmail.get" })
      .then((r) => setMail(r.state))
      .catch(() => setMail(null));
  }, []);
  useEffect(() => load(), [load]);

  const ready = list?.filter((x) => x.status === "ready").length ?? 0;
  const on = !!mail?.pref.enabled;
  return (
    <StudioCard
      className={className}
      title={
        <span className="inline-flex items-center gap-2">
          <Newspaper size={17} aria-hidden className="text-nd-fg-3" />
          오늘 아침 브리핑
          {list && (
            <Badge tone={ready ? "accent" : "neutral"} size="lg">
              {ready}/{list.length}곳
            </Badge>
          )}
        </span>
      }
      description={`${today ? `${briefDayLabel(today)} · ` : ""}매일 07:30 프로젝트마다 AI 가 레이더 · 바이럴 형식 · 검색어 · 채널 변화에서 특기할 것을 고릅니다`}
      action={
        <Button size="sm" variant={on ? "soft" : "secondary"} icon={Mail} onClick={() => setOpen(true)} title="내 메일 계정으로 나에게 매일 아침 한 통">
          {on ? "메일로 받는 중" : "메일로 받기"}
        </Button>
      }
    >
      {mail?.pref.autoOff && (
        <StudioNotice tone="warning" title="메일로 받기가 저절로 꺼졌습니다" className="mb-4" action={<Button size="sm" variant="secondary" onClick={() => setOpen(true)}>설정 보기</Button>}>
          {mail.pref.autoOff}
        </StudioNotice>
      )}
      {err ? (
        <StudioNotice tone="warning" title="브리핑을 불러오지 못했습니다" action={<Button size="sm" variant="secondary" onClick={load}>다시 시도</Button>}>
          {err}
        </StudioNotice>
      ) : !list ? (
        <div className="grid gap-4 lg:grid-cols-2" aria-busy="true">
          <Skeleton className="h-40 rounded-nd-lg" />
          <Skeleton className="h-40 rounded-nd-lg" />
        </div>
      ) : list.length === 0 ? (
        <p className="text-nd-body text-nd-fg-3">볼 수 있는 프로젝트가 없습니다.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.map((x) => (
            <DigestBlock key={x.spaceId} x={x} onOpen={() => onOpen(x.spaceId)} />
          ))}
        </div>
      )}
      <BriefMailDialog open={open} onClose={() => setOpen(false)} state={mail} onState={setMail} />
    </StudioCard>
  );
}

function DigestBlock({ x, onOpen }: { x: Digest; onOpen: () => void }) {
  const b = x.brief;
  return (
    <article className="flex min-w-0 flex-col rounded-nd-lg border border-nd-line bg-nd-content px-4 py-3.5 sm:px-5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="min-w-0 truncate text-[15px] font-semibold text-nd-fg">{x.spaceName}</span>
        {x.kind === "agency" && <SpaceKindBadge kind="agency" />}
        {x.status === "ready" ? (
          <Badge tone="success" size="lg">
            {b?.by === "company" ? "07:30 자동" : `직접 만듦 · ${fmtWhen(b?.at)}`}
          </Badge>
        ) : x.status === "off" ? (
          <Badge tone="neutral" size="lg">
            꺼져 있음
          </Badge>
        ) : (
          <Badge tone="neutral" size="lg">
            아직 없음
          </Badge>
        )}
      </div>
      {b ? (
        <>
          <h4 className="mt-2 text-[17px] font-bold leading-snug text-nd-fg [overflow-wrap:anywhere]">{b.headline}</h4>
          {b.items.length > 0 ? (
            <ol className="mt-2.5 space-y-2">
              {b.items.map((it, i) => (
                <li key={i} className="flex min-w-0 items-start gap-2">
                  <Badge tone={KIND_TONE[it.kind]} size="md" className="mt-0.5 shrink-0">
                    {BRIEF_KIND_LABEL[it.kind]}
                  </Badge>
                  <span className="min-w-0 text-[14px] leading-snug">
                    <span className="font-medium text-nd-fg [overflow-wrap:anywhere]">{it.title}</span>
                    {it.numbers && <span className="nd-num block text-[13px] text-nd-fg-3 [overflow-wrap:anywhere]">{it.numbers}</span>}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-[14px] text-nd-fg-3">이 브리핑에는 특기 사항이 없습니다 (요약만).</p>
          )}
          {b.total > b.items.length && <p className="mt-2 text-[13px] text-nd-fg-3">나머지 {b.total - b.items.length}개는 시장 트렌드에서</p>}
        </>
      ) : x.status === "off" ? (
        <p className="mt-2 text-[14px] leading-relaxed text-nd-fg-3">이 프로젝트는 시장 트렌드 자동 실행(매일 07:30)이 꺼져 있습니다 — 관리자가 시장 트렌드 › 검색어 추이 › 자동 실행 설정에서 켭니다.</p>
      ) : (
        <p className="mt-2 text-[14px] leading-relaxed text-nd-fg-3">
          오늘 브리핑은 아직 없습니다 (매일 07:30 · 볼 자료 — 레이더 · 감시 채널 · 검색어 묶음 — 가 없는 프로젝트는 만들지 않습니다).
          {x.yesterday && (
            <span className="mt-1 block">
              어제 ({briefDayLabel(x.yesterday.day)}): <span className="text-nd-fg-2 [overflow-wrap:anywhere]">{x.yesterday.headline}</span>
            </span>
          )}
        </p>
      )}
      <div className="min-h-3 flex-1" aria-hidden />
      <div className="mt-3 border-t border-nd-line pt-3">
        <Button size="sm" variant="ghost" icon={ArrowUpRight} onClick={onOpen}>
          시장 트렌드에서 보기
        </Button>
      </div>
    </article>
  );
}

// ---- 메일로 받기 --------------------------------------------------------------------

export function BriefMailDialog({ open, onClose, state, onState }: { open: boolean; onClose: () => void; state: MailState | null; onState: (s: MailState) => void }) {
  const toast = useToast();
  const [save, setSave] = useState<StudioSaveState>("saved");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"preview" | "test" | null>(null);

  const put = async (patch: Partial<Pick<BriefMailPref, "enabled" | "all" | "spaces" | "account">>) => {
    if (!state) return;
    const next = { enabled: state.pref.enabled, all: state.pref.all, spaces: state.pref.spaces, account: state.pref.account, ...patch };
    // 먼저 화면에 — 저장이 실패하면 서버 값으로 되돌린다
    onState({ ...state, pref: { ...state.pref, ...next } });
    setSave("saving");
    try {
      const r = await shortsPost<{ state: MailState }>("market", { action: "briefmail.save", pref: next });
      onState(r.state);
      setSave("saved");
    } catch (e) {
      onState(state);
      setSave("error");
      toast.error(e instanceof Error ? e.message : "저장하지 못했습니다.");
    }
  };
  const showPreview = async () => {
    if (!state) return;
    setBusy("preview");
    try {
      const r = await shortsPost<{ preview: Preview }>("market", { action: "briefmail.preview", draft: { all: state.pref.all, spaces: state.pref.spaces, account: state.pref.account } });
      setPreview(r.preview);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "미리 보기를 만들지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };
  const sendTest = async () => {
    setBusy("test");
    try {
      const r = await shortsPost<{ sent: { to: string; subject: string; day: string }; state: MailState }>("market", { action: "briefmail.test" });
      onState(r.state);
      toast.success(`${r.sent.to} 로 보냈습니다 — 「${r.sent.subject}」`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "보내지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  const p = state?.pref;
  const chosen = new Set(p?.spaces ?? []);
  const toggleSpace = (id: string) => void put({ all: false, spaces: chosen.has(id) ? [...chosen].filter((x) => x !== id) : [...chosen, id] });
  const testLeft = state ? Math.max(0, state.test.limit - state.test.used) : 0;
  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        size="md"
        title="아침 브리핑 메일로 받기"
        description="매일 07:30 브리핑이 만들어지면, ERP 메일에 연결한 내 계정으로 나에게 한 통 보냅니다 (내게쓰기 · 회사 명의로 보내지 않습니다)."
        footer={
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <SaveIndicator state={save} onRetry={() => p && void put({})} />
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" icon={Eye} loading={busy === "preview"} disabled={!state} onClick={() => void showPreview()}>
                미리 보기
              </Button>
              <Button icon={Send} loading={busy === "test"} disabled={!state || !!state.blocked || testLeft === 0} onClick={() => void sendTest()} title={`실제로 한 통 보냅니다 · 오늘 ${testLeft}번 남음`}>
                지금 나에게 보내 보기
              </Button>
            </div>
          </div>
        }
      >
        {!state || !p ? (
          <Skeleton className="h-48 rounded-nd-md" />
        ) : (
          <div className="space-y-5">
            {state.blocked && (
              <StudioNotice
                tone="warning"
                title="메일 계정이 있어야 켤 수 있습니다"
                action={
                  <Link href="/neander/mail" className={buttonClass("secondary", "sm")}>
                    메일로 가기
                  </Link>
                }
              >
                {state.blocked}
              </StudioNotice>
            )}
            {p.autoOff && (
              <StudioNotice tone="warning" title="저절로 꺼졌습니다">
                {p.autoOff} — 메일 계정을 확인한 뒤 다시 켜세요.
              </StudioNotice>
            )}
            <div className="flex items-start justify-between gap-4 rounded-nd-md border border-nd-line px-4 py-3">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-nd-fg">매일 아침 메일로 받기</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-nd-fg-3">기본은 꺼짐 · 같은 날 두 번 보내지 않습니다 · 3번 이어 보내지 못하면 저절로 꺼집니다</p>
              </div>
              <Switch checked={p.enabled} disabled={!p.enabled && !!state.blocked} onChange={(v) => void put({ enabled: v })} aria-label="매일 아침 메일로 받기" />
            </div>

            <div>
              <p className="mb-1.5 text-[14px] font-semibold text-nd-fg">보낼 계정 (받는 곳도 같은 주소)</p>
              {state.accounts.length === 0 ? (
                <p className="text-[14px] text-nd-fg-3">연결한 내 메일 계정이 없습니다 — 팀 공용 계정으로는 보내지 않습니다.</p>
              ) : state.accounts.length === 1 ? (
                <p className="text-[14px] text-nd-fg-2">
                  {state.accounts[0].address} · {PROVIDER_LABEL[state.accounts[0].provider] ?? state.accounts[0].provider}
                  {state.accounts[0].authFailed && <span className="ml-1.5 font-medium text-nd-danger-text">비밀번호 확인 필요</span>}
                </p>
              ) : (
                <Select value={p.account ?? state.account?.key ?? ""} onChange={(e) => void put({ account: e.target.value || null })} aria-label="보낼 계정">
                  {state.accounts.map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.label ? `${a.label} · ` : ""}
                      {a.address} · {PROVIDER_LABEL[a.provider] ?? a.provider}
                      {a.authFailed ? " · 비밀번호 확인 필요" : ""}
                    </option>
                  ))}
                </Select>
              )}
            </div>

            <div>
              <p className="mb-1.5 text-[14px] font-semibold text-nd-fg">받을 프로젝트</p>
              <Checkbox label="볼 수 있는 모든 프로젝트 (새로 생긴 것도)" checked={p.all} onChange={(e) => void put({ all: e.target.checked, spaces: e.target.checked ? p.spaces : state.spaces.map((s) => s.id) })} />
              {!p.all && (
                <ul className="mt-2 grid gap-1.5 pl-6 sm:grid-cols-2">
                  {state.spaces.map((s) => (
                    <li key={s.id}>
                      <Checkbox label={`${s.name}${s.kind === "agency" ? " · 대행" : ""}`} checked={chosen.has(s.id)} onChange={() => toggleSpace(s.id)} />
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1.5 text-[13px] text-nd-fg-3">대행 프로젝트는 관리자와 그 업체 담당자에게만 보이고, 메일에도 볼 수 있는 것만 들어갑니다.</p>
            </div>

            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-nd-md bg-nd-sunken/60 px-4 py-3 text-[13px]">
              <dt className="text-nd-fg-3">마지막으로 보낸 날</dt>
              <dd className="text-nd-fg">{p.lastSentDay ? `${briefDayLabel(p.lastSentDay)} · ${fmtWhen(p.lastSentAt)}` : "아직 없음"}</dd>
              <dt className="text-nd-fg-3">마지막 오류</dt>
              <dd className={cn(p.lastError ? "text-nd-danger-text" : "text-nd-fg")}>{p.lastError ? `${fmtWhen(p.lastErrorAt)} · ${p.lastError}${p.failures ? ` (이어서 ${p.failures}번)` : ""}` : "없음"}</dd>
              {p.lastNote && (
                <>
                  <dt className="text-nd-fg-3">마지막 메모</dt>
                  <dd className="text-nd-fg-2">
                    {fmtWhen(p.lastNoteAt)} · {p.lastNote}
                  </dd>
                </>
              )}
              <dt className="text-nd-fg-3">보내 보기</dt>
              <dd className="text-nd-fg-2">
                오늘 {state.test.used}/{state.test.limit}번 — 누를 때만 실제로 보내고, 매일 아침 메일 기록은 건드리지 않습니다
              </dd>
            </dl>
          </div>
        )}
      </Dialog>
      <Dialog open={!!preview} onClose={() => setPreview(null)} size="lg" title="메일 미리 보기" description={preview ? `${briefDayLabel(preview.day)} 브리핑 기준 · 보내지 않았습니다` : undefined}>
        {preview &&
          (preview.mail ? (
            <div className="space-y-3">
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[14px]">
                <dt className="text-nd-fg-3">보내는 · 받는 사람</dt>
                <dd className="min-w-0 truncate text-nd-fg">{preview.to ?? "메일 계정 없음"}</dd>
                <dt className="text-nd-fg-3">제목</dt>
                <dd className="min-w-0 text-nd-fg [overflow-wrap:anywhere]">{preview.mail.subject}</dd>
              </dl>
              {/* 본문은 스크립트 없이 — 브리핑 글은 이스케이프해 지었다 (brief-mail.ts) */}
              <iframe title="메일 본문 미리 보기" sandbox="" srcDoc={preview.mail.html} className="h-[60vh] w-full rounded-nd-md border border-nd-line bg-white" />
            </div>
          ) : (
            <StudioNotice tone="neutral" title="보낼 브리핑이 없습니다">
              받을 프로젝트에 오늘 · 어제 브리핑이 하나도 없어 메일을 만들지 않습니다 — 자동 실행 때도 이런 날은 보내지 않고 건너뜁니다.
              {preview.sections.length > 0 && ` (${preview.sections.map((s) => `${s.spaceName}: ${s.status === "off" ? "꺼져 있음" : "없음"}`).join(" · ")})`}
            </StudioNotice>
          ))}
      </Dialog>
    </>
  );
}
