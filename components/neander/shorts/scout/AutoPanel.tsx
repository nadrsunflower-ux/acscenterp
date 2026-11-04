"use client";

// ============================================================
//  바이럴 형식 — 자동 수집 띠 · 실행 상세 · 설정 · 「필요한 작업만 실행」 (2026-11-04 목업 09)
// ------------------------------------------------------------
//  띠 윗줄: 자동 시각(매일 07:00) · 설정 · 「지금 돌리기」(옆 ▾ 로 실행 네 가지 고르기).
//  띠 아랫줄: 마지막 실행 결과 | 최근 실행 한 번의 AI 금액 · 검색 수 — 그리고 그 아래 「오늘 누적」 을 따로.
//    · 최근 실행 금액 = 자동 수집 한 번(scout_auto_last.aiUsd).
//    · 오늘 누적 = 오늘 붙은 영상 분석 · 주간 보고 요약 비용 + 오늘 자동 실행의 묶기 · 한국 확인 비용 (남은 기록의 합).
//    · 하루 상한 = 자동 분석 하루 편수(정찰 설정 autoAnalyzePerDay) — 원 단위 상한은 없다 (지어내지 않는다).
//  실행 네 가지는 따로 둔다 — 합치거나 빼지 않는다:
//    전체 자동화(「지금 돌리기」) · 채널만 훑기 · 보고 새로 만들기 · AI 요약 다시
//  설정은 두 가지다: 자동 수집(scout-auto · 관리자만) · 터진 영상 기준 · 자동 분석(scout settings · 회사 공용).
//  둘 다 고치는 대로 저장한다 (저장 버튼 없음 · 조용한 저장 표시).
//  매일 07:00 KST cron-scout 이 전체 자동화를 돈다. shorts/scout-auto.ts
// ============================================================

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, FileText, ListTree, Play, RefreshCw, Settings2, Sparkles, TriangleAlert, Workflow, X } from "lucide-react";
import { Badge, Button, Checkbox, Field, FormRow, Input, Menu, NumberInput, Skeleton, Switch, cn, type MenuItem } from "@/components/neander/ui";
import { AiCostNote, SaveIndicator, StudioCard, StudioNotice, type StudioSaveState } from "@/components/neander/shorts/studio";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { shortsGet, shortsPost } from "@/lib/neander/shorts/client";
import { fmtCount } from "@/lib/neander/shorts/model";
import { krwOf } from "@/lib/neander/shorts/radar";
import { DEFAULT_SCOUT_SETTINGS, KOREA_LABEL, type ScoutSettings } from "@/lib/neander/shorts/scout";
import { AUTO_COUNTRIES, AUTO_COUNTRY_SEARCH, type AutoCountry, type ScoutAutoSettings, type ScoutAutoSummary } from "@/lib/neander/shorts/scout-auto";
import { DEFAULT_SPACE_ID } from "@/lib/neander/shorts/spaces";
import { AiWon, fmtDay, kstDay, wonOf } from "./bits";
import { scout, type ScoutData } from "./useScout";

const COUNTRY_LABEL: Record<string, string> = { KR: "한국", ...Object.fromEntries(AUTO_COUNTRIES.map((c) => [c, AUTO_COUNTRY_SEARCH[c].label])) };
const won = (usd: number) => krwOf(usd).toLocaleString("ko-KR");

export type ScoutAutoData = { admin: boolean; settings: ScoutAutoSettings; last: ScoutAutoSummary | null };

/** 자동화 설정 · 마지막 실행 — 정찰 자료와 따로 받는다 (실패해도 화면은 돈다) */
export function useScoutAuto() {
  const [data, setData] = useState<ScoutAutoData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setData(await shortsGet<ScoutAutoData>("scout-auto"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "자동화 상태를 불러오지 못했습니다.");
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, reload };
}
export type ScoutAuto = ReturnType<typeof useScoutAuto>;

/** 화면 위 실행 네 가지 — 페이지가 한 곳에서 돌려서(도는 동안 서로 막는다) 상태 띠 · 주간 보고 · 설정이 같이 쓴다 */
export interface ScoutRunActions {
  /** 지금 도는 것 — auto · scan · build · narrate */
  busy: string | null;
  runAll: () => void;
  scan: () => void;
  build: () => void;
  narrate: () => void;
  /** 못 누르는 까닭 (누를 수 있으면 null) */
  blocked: { scan: string | null; narrate: string | null };
  /** AI 요약을 붙일 보고 주 · 이미 요약이 있는지 */
  narrateWeek: string | null;
  hasNarrative: boolean;
}

export const BUSY_LABEL: Record<string, string> = { auto: "전체 자동화 도는 중… (최대 5분)", scan: "채널 훑는 중…", build: "보고 만드는 중…", narrate: "요약하는 중…" };

/** 띠 아래로 펼치는 것 — 실행 상세(띠 안) · 설정(띠 아래 구간) */
export type ScoutPanel = "detail" | "settings" | null;

// ---- 비용 계산 (화면에서만) ------------------------------------------------------

/**
 * 오늘(한국 시각) 쓴 정찰 AI — 남은 기록의 합.
 *  · 오늘 붙은 영상 분석(사람 · 자동) + 오늘 쓴 주간 보고 요약
 *  · 오늘 돈 자동 실행이 있으면, 그 실행 금액 중 위 기록에 안 잡힌 몫(형식 묶기 · 한국 확인)
 * 같은 영상을 다시 분석해 덮어쓴 이전 비용은 기록이 없어 빠진다 — 그래서 「약」 이다.
 */
export function todayAi(d: ScoutData, last: ScoutAutoSummary | null, now = Date.now()) {
  const day = kstDay(now);
  const inRun = (at: number) => !!last && at >= last.at - 1000 && at <= last.at + last.ms + 5000;
  let usd = 0;
  let analyses = 0;
  let runPart = 0;
  for (const h of d.hits) {
    const a = h.analysis;
    if (!a || kstDay(a.at) !== day) continue;
    usd += a.costUsd;
    analyses += 1;
    if (inRun(a.at)) runPart += a.costUsd;
  }
  for (const r of d.reports) {
    const x = r.narrative;
    if (!x || kstDay(x.at) !== day) continue;
    usd += x.costUsd;
    if (inRun(x.at)) runPart += x.costUsd;
  }
  if (last && kstDay(last.at) === day) usd += Math.max(0, last.aiUsd - runPart);
  return { usd, analyses };
}

/** 영상 분석 한 편 — 남아 있는 분석 비용의 평균 (기록이 없으면 null) */
export function analysisEstimateUsd(d: ScoutData): number | null {
  const xs = d.hits.map((h) => h.analysis?.costUsd).filter((v): v is number => typeof v === "number" && v > 0);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** 영상 분석 예상 글 — 「약 12원 (지난 분석 평균)」 · 기록이 없으면 화면에 적어 둔 어림(약 10원) */
export function analysisEstimateText(d: ScoutData): string {
  const usd = analysisEstimateUsd(d);
  return usd === null ? "약 10원 (어림)" : `약 ${wonOf(usd)} (지난 분석 평균)`;
}

/** 주간 보고 AI 요약 예상 — 지난 요약 비용의 범위 */
export function narrateEstimateText(d: ScoutData): string {
  const xs = d.reports.map((r) => r.narrative?.costUsd).filter((v): v is number => typeof v === "number" && v > 0);
  if (!xs.length) return "글 모델 한 번 (지난 기록 없음)";
  const lo = krwOf(Math.min(...xs));
  const hi = krwOf(Math.max(...xs));
  return lo === hi ? `약 ${lo.toLocaleString("ko-KR")}원 (지난 요약 기준)` : `약 ${lo.toLocaleString("ko-KR")}~${hi.toLocaleString("ko-KR")}원 (지난 요약 기준)`;
}

/** 자동 분석 하루 상한 — 편수 (원 상한이 아니다) */
function AnalyzeCap({ d }: { d: ScoutData }) {
  const used = d.quotas.autoAnalyzeToday;
  const cap = d.settings.autoAnalyzePerDay;
  if (cap <= 0) return <span className="text-[13px] text-nd-fg-3">자동 분석 꺼짐 (하루 0편)</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <AiCostNote label="자동 분석" used={`${used.toLocaleString("ko-KR")}편`} cap={`${cap.toLocaleString("ko-KR")}편`} />
      {used >= cap && (
        <Badge tone="danger" size="lg">
          상한 도달 · 내일 이어서
        </Badge>
      )}
    </span>
  );
}

// ---- 띠 --------------------------------------------------------------------------

/** 메뉴 한 줄 — 이름 + 무엇을 하는지 (줄바꿈 허용) */
const MenuLine = ({ title, desc }: { title: string; desc: ReactNode }) => (
  <span className="block whitespace-normal py-0.5">
    <span className="block font-medium text-nd-fg">{title}</span>
    <span className="block text-[13px] leading-snug text-nd-fg-3">{desc}</span>
  </span>
);

export function AutoPanel({ auto, actions, d, panel, onPanel }: { auto: ScoutAuto; actions: ScoutRunActions; d: ScoutData; panel: ScoutPanel; onPanel: (p: ScoutPanel) => void }) {
  const { nameOf } = useShorts();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const detailId = useId();
  const { data: a, error } = auto;
  const last = a?.last ?? null;
  const s = a?.settings ?? null;
  const running = actions.busy !== null;
  const ranBy = (by: string) => (by === "company" ? "매일 아침 자동" : nameOf(by));
  const today = todayAi(d, last);

  const items: MenuItem[] = [
    {
      key: "all",
      icon: Workflow,
      label: <MenuLine title="전체 자동화 (지금 돌리기)" desc="채널 추가 → 훑기 → 분석 → 묶기 → 한국 확인 → 보고 · 요약 · 최대 5분" />,
      onSelect: actions.runAll,
      disabled: running,
    },
    {
      key: "scan",
      icon: RefreshCw,
      label: <MenuLine title="채널만 훑기" desc={actions.blocked.scan ?? "감시 채널의 새 영상만 찾습니다 (채널을 늘리거나 AI 분석은 하지 않음)"} />,
      onSelect: actions.scan,
      disabled: running || !!actions.blocked.scan,
    },
    { type: "separator", key: "sep" },
    {
      key: "build",
      icon: FileText,
      label: <MenuLine title="보고 새로 만들기" desc="지금 자료로 최근 7일 보고를 다시 셉니다 · 검색 · AI 없음" />,
      onSelect: actions.build,
      disabled: running,
    },
    {
      key: "narrate",
      icon: Sparkles,
      label: (
        <MenuLine
          title={actions.hasNarrative ? "AI 요약 다시" : "AI 요약 붙이기"}
          desc={actions.blocked.narrate ?? `${actions.narrateWeek} 보고 숫자로 요약을 씁니다 · ${narrateEstimateText(d)}`}
        />
      ),
      onSelect: actions.narrate,
      disabled: running || !!actions.blocked.narrate,
    },
  ];

  const byCountry = last ? Object.entries(last.added.reduce<Record<string, number>>((m, x) => ({ ...m, [x.country]: (m[x.country] ?? 0) + 1 }), {})) : [];

  return (
    <section data-scout-status aria-label="자동 수집" className="nd-surface mb-5 overflow-hidden rounded-nd-lg">
      {/* 윗줄 — 이름 · 자동 시각 · 설정 · 지금 돌리기 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4 sm:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-nd-md border border-nd-line text-nd-fg-2" aria-hidden>
            <Workflow size={18} />
          </span>
          <h2 className="whitespace-nowrap text-[18px] font-bold text-nd-fg">자동 수집</h2>
          {s ? (
            <Badge tone={s.enabled ? "success" : "neutral"} size="lg">
              {s.enabled ? "매일 07:00" : "자동 꺼짐"}
            </Badge>
          ) : (
            !error && <Skeleton className="h-7 w-20" />
          )}
          {!d.companyKey && (
            <span className="inline-flex items-center gap-1 whitespace-nowrap text-[13px] font-medium text-nd-warning-text" title="회사 YouTube 키가 없으면 자동 실행에서 채널 찾기 · 훑기 · 한국 확인을 건너뜁니다">
              <TriangleAlert size={14} aria-hidden />
              회사 키 없음
            </span>
          )}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="secondary" icon={Settings2} aria-expanded={panel === "settings"} onClick={() => onPanel(panel === "settings" ? null : "settings")}>
            설정
          </Button>
          <div className="inline-flex" role="group" aria-label="실행">
            <Button
              icon={Play}
              loading={actions.busy === "auto"}
              disabled={running}
              onClick={actions.runAll}
              className="rounded-r-none"
              title="전체 자동화 — 채널 추가 → 훑기 → 분석 → 묶기 → 한국 확인 → 보고 · 요약 (최대 5분)"
            >
              {actions.busy === "auto" ? "도는 중… (최대 5분)" : "지금 돌리기"}
            </Button>
            <Button
              ref={menuRef}
              icon={ChevronDown}
              aria-label="실행 고르기 — 전체 자동화 · 채널만 훑기 · 보고 새로 만들기 · AI 요약"
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu((v) => !v)}
              className="rounded-l-none border-l border-white/30 px-2.5"
            />
          </div>
          <Menu open={menu} onClose={() => setMenu(false)} anchorRef={menuRef} placement="bottom-end" ariaLabel="실행 고르기" className="w-[min(380px,calc(100vw-24px))]" items={items} />
        </div>
      </div>

      {/* 아랫줄 — 마지막 실행 결과 | 최근 실행 금액 · 오늘 누적 | 실행 상세 */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 border-t border-nd-line px-5 py-3.5 sm:px-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_auto] md:items-center">
        <div className="min-w-0">
          {!a && !error ? (
            <div className="space-y-1.5">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-64" />
            </div>
          ) : error && !a ? (
            <span className="inline-flex flex-wrap items-center gap-2 text-nd-body text-nd-warning-text">
              <TriangleAlert size={15} aria-hidden />
              자동화 상태를 불러오지 못했습니다
              <Button size="sm" variant="secondary" onClick={() => void auto.reload()}>
                다시 시도
              </Button>
            </span>
          ) : last ? (
            <>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-nd-fg">
                <span className="nd-num font-medium" title={`${ranBy(last.by)} · ${Math.round(last.ms / 1000)}초 걸림`}>
                  마지막 {fmtDay(last.at, true)}
                </span>
                {last.notes.length > 0 ? (
                  <button type="button" onClick={() => onPanel("detail")} className="inline-flex" title="실행 상세에서 메모를 봅니다">
                    <Badge tone="warning" size="lg">
                      <TriangleAlert size={13} aria-hidden /> 메모 {last.notes.length}건
                    </Badge>
                  </button>
                ) : (
                  <Badge tone="success" size="lg">
                    성공
                  </Badge>
                )}
              </p>
              <p className="mt-1 text-[13px] text-nd-fg-3">
                새 영상 {last.newHits.toLocaleString("ko-KR")}편 · 새 형식 카드 {last.cardsCreated.length}장 · 채널 {last.added.length}곳 추가 · 자동 묶음 {last.assigned}편 · {ranBy(last.by)}
              </p>
            </>
          ) : (
            <>
              <p className="text-[14px] font-medium text-nd-fg">아직 실행 기록이 없습니다</p>
              <p className="mt-1 text-[13px] text-nd-fg-3">{s?.enabled ? "내일 아침 07:00 에 처음 돌거나 「지금 돌리기」 로 바로 돌립니다." : "자동이 꺼져 있습니다 — 「지금 돌리기」 로만 돕니다."}</p>
            </>
          )}
        </div>

        <div className="min-w-0">
          <p className="text-[14px] text-nd-fg" title="마지막 실행 한 번에서 쓴 AI 비용(달러 어림 환산)과 YouTube 검색 수 — 오늘 누적이 아닙니다">
            최근 실행 AI {last ? <AiWon usd={last.aiUsd} /> : <span className="text-nd-fg-3">기록 없음</span>}
            {last && (
              <>
                {" "}
                · 검색 <b className="nd-num font-semibold">{last.searches}</b>회
              </>
            )}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span
              className="text-[13px] text-nd-fg-3"
              title="오늘 붙은 영상 분석 · 주간 보고 요약 비용과 오늘 자동 실행의 형식 묶기 · 한국 확인 비용의 합 (다시 분석해 덮어쓴 이전 비용은 빠짐) · 달러 어림 환산 · 부가세 별도"
            >
              <span className="font-medium text-nd-fg-2">오늘 AI 누적</span> · 약 <AiWon usd={today.usd} className="font-medium" />
              <span className="text-nd-fg-3"> (기록 기준)</span>
            </span>
            <AnalyzeCap d={d} />
          </div>
        </div>

        <div className="md:justify-self-end">
          <Button
            variant="ghost"
            icon={ListTree}
            trailingIcon={ChevronDown}
            aria-expanded={panel === "detail"}
            aria-controls={detailId}
            onClick={() => onPanel(panel === "detail" ? null : "detail")}
            className={cn("[&>svg:last-child]:transition-transform", panel === "detail" && "[&>svg:last-child]:rotate-180")}
          >
            실행 상세
          </Button>
        </div>
      </div>

      {actions.busy && (
        <p className="border-t border-nd-line px-5 py-2.5 text-[13px] text-nd-fg-2 sm:px-6" role="status">
          {BUSY_LABEL[actions.busy] ?? "처리 중…"} 화면을 떠나도 서버에서 끝까지 돕니다.
        </p>
      )}

      {panel === "detail" && (
        <div id={detailId} className="border-t border-nd-line bg-nd-sunken/50 px-5 py-4 sm:px-6">
          <RunDetail a={a} ranBy={ranBy} byCountry={byCountry} />
        </div>
      )}
    </section>
  );
}

function RunDetail({ a, ranBy, byCountry }: { a: ScoutAutoData | null; ranBy: (by: string) => string; byCountry: [string, number][] }) {
  const s = a?.settings;
  const last = a?.last ?? null;
  return (
    <div className="space-y-3 text-nd-body text-nd-fg-2">
      {s && (
        <p>
          {s.enabled ? "매일 아침 07:00 (한국 시각)" : "자동 꺼짐 — 「지금 돌리기」 로만"} · 감시 채널 채우기(한국 = AI 레이더 · {s.countries.map((c) => AUTO_COUNTRY_SEARCH[c].label).join(" · ") || "해외 없음"}) →
          훑기 → 분석 → 형식 카드 묶기 → 한국 확인 → 주간 보고 · AI 요약
        </p>
      )}
      {last ? (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3 xl:grid-cols-6">
            {(
              [
                ["실행 시각", `${fmtDay(last.at, true)} · ${Math.round(last.ms / 1000)}초`],
                ["실행", ranBy(last.by)],
                ["채널 추가", `${last.added.length}곳${byCountry.length ? ` (${byCountry.map(([c, n]) => `${COUNTRY_LABEL[c] ?? c} ${n}`).join(" · ")})` : ""}`],
                ["훑은 채널", `${last.scanned}곳`],
                ["새로 찾은 영상", `${last.newHits}편`],
                ["분석", `${last.analyzed}편`],
                ["자동 묶음", `${last.assigned}편`],
                ["새 형식 카드", last.cardsCreated.length ? `${last.cardsCreated.length}장 (${last.cardsCreated.join(", ")})` : "없음"],
                ["한국 확인", `${last.korea.length}장`],
                ["AI 요약", last.narrated ? "붙임" : "안 붙임"],
                ["YouTube 검색", `${last.searches}회`],
                ["AI 비용", `${won(last.aiUsd)}원`],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-[13px] text-nd-fg-3">{k}</dt>
                <dd className={cn("nd-num break-words font-medium", k === "AI 비용" ? "text-nd-danger-text" : "text-nd-fg")}>{v}</dd>
              </div>
            ))}
          </dl>
          {last.korea.length > 0 && (
            <p className="text-[13px] text-nd-fg-3">
              한국 확인: {last.korea.map((k) => `「${k.name}」 ${KOREA_LABEL[k.status] ?? k.status}`).join(" · ")} — 제목 · 설명으로 본 AI 판단, 표본에 없다는 건 국내에 없다는 단정이 아닙니다
            </p>
          )}
          {last.added.length > 0 && (
            <details className="text-[13px] text-nd-fg-3">
              <summary className="cursor-pointer select-none font-medium text-nd-fg-2">추가한 채널 {last.added.length}곳 보기</summary>
              <ul className="mt-1.5 space-y-0.5">
                {last.added.map((x, i) => (
                  <li key={i} className="break-words">
                    · {COUNTRY_LABEL[x.country] ?? x.country} · <span className="text-nd-fg-2">{x.title}</span> — {x.why}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {last.notes.length > 0 && (
            <ul className="space-y-0.5 text-[13px] text-nd-warning-text">
              {last.notes.map((n, i) => (
                <li key={i} className="break-words">
                  · {n}
                </li>
              ))}
            </ul>
          )}
          <p className="text-[13px] text-nd-fg-3">AI 비용은 이 실행 한 번의 값을 달러에서 {won(1)}원으로 어림 환산한 것입니다(부가세 별도). YouTube 검색은 소재 발굴 · AI 레이더와 같은 하루 한도(90회)를 씁니다.</p>
        </>
      ) : (
        <p className="text-nd-fg-3">아직 돈 적이 없습니다. 내일 아침 07:00 에 처음 돌거나, 「지금 돌리기」 로 바로 돌릴 수 있습니다.</p>
      )}
    </div>
  );
}

// ---- 필요한 작업만 실행 -----------------------------------------------------------

function RunCard({ title, scope, button, cost, blocked }: { title: string; scope: ReactNode; button: ReactNode; cost: ReactNode; blocked?: string | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5 rounded-nd-md border border-nd-line bg-nd-sunken/60 px-4 py-3.5">
      <div className="min-w-0">
        <h4 className="text-[15px] font-semibold text-nd-fg">{title}</h4>
        <p className="mt-0.5 text-[13px] leading-relaxed text-nd-fg-2">{scope}</p>
      </div>
      <div>{button}</div>
      <div className="text-[13px] text-nd-fg-3">{cost}</div>
      {blocked && (
        <p className="flex items-start gap-1.5 text-[13px] text-nd-warning-text">
          <TriangleAlert size={14} aria-hidden className="mt-[3px] shrink-0" />
          {blocked}
        </p>
      )}
    </div>
  );
}

/** 실행 네 가지 — 무엇을 하는지(범위) · 비용을 함께. 도는 동안 서로 막는다 */
export function RunCards({ actions, d, last }: { actions: ScoutRunActions; d: ScoutData; last: ScoutAutoSummary | null }) {
  const running = actions.busy !== null;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <RunCard
        title="전체 자동화"
        scope="채널 추가 → 훑기 → 분석 → 묶기 → 국내 확인 → 보고 · 요약 (최대 5분 · 매일 07:00 에 저절로 도는 것과 같습니다)"
        button={
          <Button variant="secondary" icon={Play} loading={actions.busy === "auto"} disabled={running} onClick={actions.runAll}>
            지금 돌리기
          </Button>
        }
        cost={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              최근 실행 {last ? <AiWon usd={last.aiUsd} className="font-medium" /> : "기록 없음"}
              {last ? ` · 검색 ${last.searches}회` : ""}
            </span>
            <AnalyzeCap d={d} />
          </span>
        }
      />
      <RunCard
        title="채널만 훑기"
        scope="감시 채널의 새 영상과 평소 조회수를 갱신합니다 (6시간 안에 훑은 채널은 건너뜀 · 채널을 늘리거나 AI 분석은 하지 않음)"
        button={
          <Button variant="secondary" icon={RefreshCw} loading={actions.busy === "scan"} disabled={running || !!actions.blocked.scan} onClick={actions.scan}>
            채널만 훑기
          </Button>
        }
        cost="AI 비용 없음 · YouTube 검색 한도(90회)는 쓰지 않음"
        blocked={actions.blocked.scan}
      />
      <RunCard
        title="보고 새로 만들기"
        scope="지금 자료로 최근 7일 숫자를 다시 셉니다 (AI 요약은 남깁니다)"
        button={
          <Button variant="secondary" icon={FileText} loading={actions.busy === "build"} disabled={running} onClick={actions.build}>
            보고 새로 만들기
          </Button>
        }
        cost="검색 · AI 비용 없음"
      />
      <RunCard
        title={actions.hasNarrative ? "AI 요약 다시" : "AI 요약 붙이기"}
        scope={actions.narrateWeek ? `${actions.narrateWeek} 보고의 숫자만 근거로 해설을 씁니다` : "주간 보고의 숫자만 근거로 해설을 씁니다"}
        button={
          <Button variant="secondary" icon={Sparkles} loading={actions.busy === "narrate"} disabled={running || !!actions.blocked.narrate} onClick={actions.narrate}>
            {actions.hasNarrative ? "AI 요약 다시" : "AI 요약 붙이기"}
          </Button>
        }
        cost={<AiCostNote compact estimate={narrateEstimateText(d)} />}
        blocked={actions.blocked.narrate}
      />
    </div>
  );
}

// ---- 설정 (고치는 대로 저장) -------------------------------------------------------

/** 고치는 대로 저장 — 마지막 값만 늦춰 보낸다. 실패하면 저장 표시에 머물고 「다시 저장」 */
function useDebouncedSave<T>(save: (v: T) => Promise<unknown>, initialAt: number | null, delay = 800) {
  const [state, setState] = useState<StudioSaveState>("saved");
  const [savedAt, setSavedAt] = useState<number | null>(initialAt || null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ v: T } | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    setState("saving");
    try {
      await saveRef.current(p.v);
      setSavedAt(Date.now());
      setState(pending.current ? "dirty" : "saved");
    } catch {
      if (!pending.current) pending.current = p;
      setState("error");
    }
  }, []);
  const push = useCallback(
    (v: T) => {
      pending.current = { v };
      setState("dirty");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), delay);
    },
    [delay, flush],
  );
  // 구간을 닫거나 화면을 떠나면 남은 것을 바로 보낸다
  useEffect(
    () => () => {
      void flush();
    },
    [flush],
  );
  return { state, savedAt, push, retry: flush };
}

/** 자동 수집 설정 구간 — 자동 수집(관리자) · 터진 영상 기준(회사 공용) · 필요한 작업만 실행 */
export function AutoSettingsSection({
  auto,
  d,
  refresh,
  actions,
  onClose,
}: {
  auto: ScoutAuto;
  d: ScoutData;
  refresh: () => Promise<void>;
  actions: ScoutRunActions;
  onClose: () => void;
}) {
  const a = auto.data;
  return (
    <div className="mb-6 space-y-4" id="scout-settings">
      {a ? (
        <AutoSettingsCard s={a.settings} admin={a.admin} d={d} onSaved={auto.reload} onClose={onClose} />
      ) : (
        <StudioCard title="자동 수집 설정">
          {auto.error ? (
            <StudioNotice
              tone="warning"
              title="자동 수집 설정을 불러오지 못했습니다"
              action={
                <Button size="sm" variant="secondary" onClick={() => void auto.reload()}>
                  다시 시도
                </Button>
              }
            >
              {auto.error}
            </StudioNotice>
          ) : (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-2/3" />
            </div>
          )}
        </StudioCard>
      )}
      <DetectSettingsCard d={d} refresh={refresh} />
      <StudioCard title="필요한 작업만 실행" description="네 가지를 따로 돌릴 수 있습니다 — 도는 동안에는 서로 막습니다">
        <RunCards actions={actions} d={d} last={a?.last ?? null} />
      </StudioCard>
    </div>
  );
}

function AutoSettingsCard({ s, admin, d, onSaved, onClose }: { s: ScoutAutoSettings; admin: boolean; d: ScoutData; onSaved: () => Promise<void>; onClose: () => void }) {
  const { space } = useShorts();
  const salim = space === DEFAULT_SPACE_ID;
  // 처음 받은 값에서 시작해 고친 그대로 둔다 (저장 뒤 다시 받아도 입력 중인 칸을 덮지 않는다)
  const [f, setF] = useState<ScoutAutoSettings>(s);
  const [qText, setQText] = useState<Record<AutoCountry, string>>(() => Object.fromEntries(AUTO_COUNTRIES.map((c) => [c, (s.queries?.[c] ?? []).join(", ")])) as Record<AutoCountry, string>);
  const saver = useDebouncedSave<ScoutAutoSettings>(async (v) => {
    await shortsPost("scout-auto", { action: "settings.save", settings: v });
    await onSaved();
  }, s.updatedAt);
  const queriesOf = (t: Record<AutoCountry, string>) => Object.fromEntries(AUTO_COUNTRIES.map((c) => [c, t[c].split(/[,\n]/).map((q) => q.trim()).filter(Boolean)])) as ScoutAutoSettings["queries"];
  const set = (patch: Partial<ScoutAutoSettings>) => {
    const next = { ...f, ...patch };
    setF(next);
    saver.push(next);
  };
  const setQuery = (c: AutoCountry, v: string) => {
    const t = { ...qText, [c]: v };
    setQText(t);
    const next = { ...f, queries: queriesOf(t) };
    setF(next);
    saver.push(next);
  };
  const toggleCountry = (c: AutoCountry, on: boolean) => set({ countries: on ? [...f.countries, c] : f.countries.filter((x) => x !== c) });
  const yt = d.quotas.youtubeSearch;

  return (
    <StudioCard
      title={
        <span className="flex flex-wrap items-center gap-2">
          자동 수집 설정
          <Badge tone="neutral" size="lg">
            관리자만 바꿈
          </Badge>
        </span>
      }
      description="회사 공용 · 매일 아침 자동 실행과 「지금 돌리기」 가 같은 설정을 씁니다"
      action={
        <>
          {admin && <SaveIndicator state={saver.state} savedAt={saver.savedAt} onRetry={() => void saver.retry()} />}
          <Button variant="ghost" icon={X} onClick={onClose}>
            닫기
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {!admin && <StudioNotice tone="neutral">설정은 AI STUDIO 관리자만 바꿉니다. 지금 값을 볼 수만 있습니다.</StudioNotice>}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Switch checked={f.enabled} disabled={!admin} onChange={(v) => set({ enabled: v })} label="매일 아침 07:00 자동으로 돌기" />
          <Badge tone={f.enabled ? "success" : "neutral"} size="lg">
            {f.enabled ? "매일 07:00 켜짐" : "자동 꺼짐"}
          </Badge>
        </div>

        <fieldset className="min-w-0">
          <legend className="mb-2 text-[14px] font-semibold text-nd-fg">수집할 나라</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Checkbox checked={f.fillKorea} disabled={!admin} onChange={(e) => set({ fillKorea: e.target.checked })} label="한국 (AI 레이더에서 채우기)" />
            {AUTO_COUNTRIES.map((c) => (
              <Checkbox key={c} checked={f.countries.includes(c)} disabled={!admin} onChange={(e) => toggleCountry(c, e.target.checked)} label={AUTO_COUNTRY_SEARCH[c].label} />
            ))}
          </div>
          <p className="mt-1.5 text-[13px] text-nd-fg-3">한국은 검색을 더 쓰지 않고 AI 레이더가 이미 찾은 영상의 채널에서 채웁니다. 해외는 나라마다 하루 YouTube 검색 1회.</p>
        </fieldset>

        {f.countries.length > 0 && (
          <fieldset className="min-w-0">
            <legend className="mb-2 text-[14px] font-semibold text-nd-fg">나라별 검색어</legend>
            <FormRow className="grid-cols-1 md:grid-cols-2">
              {f.countries.map((c) => (
                <Field key={c} label={`${AUTO_COUNTRY_SEARCH[c].label} — 쉼표로 여러 개 · 날마다 하나씩 돌려 씀`}>
                  <Input
                    value={qText[c]}
                    disabled={!admin}
                    onChange={(e) => setQuery(c, e.target.value)}
                    placeholder={salim ? `비우면 기본: ${AUTO_COUNTRY_SEARCH[c].queries.slice(0, 3).join(", ")} …` : "비우면 이 나라를 건너뜁니다"}
                  />
                </Field>
              ))}
            </FormRow>
            <p className="mt-1.5 text-[13px] text-nd-fg-3">
              {salim ? "살림설계사무소는 비워 두면 살림 · 수납 · 주방 기본 검색어를 씁니다." : "이 프로젝트는 주제가 달라 기본 검색어가 없습니다 — 검색어를 넣은 나라만 찾습니다."} 최대 12개 · 그 나라 말로 적으세요.
            </p>
          </fieldset>
        )}

        <fieldset className="min-w-0">
          <legend className="mb-2 text-[14px] font-semibold text-nd-fg">상한 · 기준</legend>
          <FormRow className="grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
            <Field label="새 채널 추가 — 나라마다 하루">
              <NumberInput disabled={!admin} value={f.addsPerDay} onValueChange={(r) => set({ addsPerDay: Number(r) || 0 })} />
            </Field>
            <Field label="자동 추가 채널 — 나라마다 최대">
              <NumberInput disabled={!admin} value={f.perCountryCap} onValueChange={(r) => set({ perCountryCap: Number(r) || 0 })} />
            </Field>
            <Field label="한국 확인 — 하루 카드 수">
              <NumberInput disabled={!admin} value={f.koreaPerDay} onValueChange={(r) => set({ koreaPerDay: Number(r) || 0 })} />
            </Field>
            <Field label="채널 추가 기준 — 평소 대비 최소 배수">
              <NumberInput decimal disabled={!admin} value={f.minMultiple} onValueChange={(r) => set({ minMultiple: Number(r) || 0 })} />
            </Field>
            <Field label="채널 추가 기준 — 해외 최소 조회수">
              <NumberInput disabled={!admin} value={f.minViewsAbroad} onValueChange={(r) => set({ minViewsAbroad: Number(r) || 0 })} />
            </Field>
            <Field label="YouTube 검색 하루 상한 (고정)">
              <div className="flex h-ctl-md items-center rounded-nd-md border border-nd-line bg-nd-sunken px-3 text-nd-body text-nd-fg-2">
                <span className="nd-num">{yt.limit.toLocaleString("ko-KR")}회</span>
                <span className="ml-2 truncate text-[13px] text-nd-fg-3">
                  {yt.source === "personal" ? "내 키" : yt.source === "company" ? "회사 키" : "키 없음"} 오늘 {yt.used.toLocaleString("ko-KR")}회
                </span>
              </div>
            </Field>
          </FormRow>
          <p className="mt-1.5 text-[13px] text-nd-fg-3">YouTube 검색은 소재 발굴 · AI 레이더와 하루 한도를 함께 씁니다. 자동으로 넣은 채널에는 주제 「자동 추가」 가 붙고, 사람이 지운 채널은 다시 넣지 않습니다.</p>
        </fieldset>

        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Checkbox checked={f.group} disabled={!admin} onChange={(e) => set({ group: e.target.checked })} label="형식 카드 자동 묶기" />
          <Checkbox checked={f.koreaCheck} disabled={!admin} onChange={(e) => set({ koreaCheck: e.target.checked })} label="한국 확인 자동" />
          <Checkbox checked={f.narrate} disabled={!admin} onChange={(e) => set({ narrate: e.target.checked })} label="주간 보고 AI 요약 자동" />
        </div>

        <div className="rounded-nd-md border border-nd-line bg-nd-sunken/60 px-4 py-3">
          <p className="text-[14px] font-semibold text-nd-fg">자동 실행 순서</p>
          <p className="mt-1 text-[14px] text-nd-fg-2">
            채널 채우기 → 새 영상 수집(훑기) → AI 분석(하루 {d.settings.autoAnalyzePerDay}편까지) → {f.group ? "형식에 묶기" : "형식 묶기 꺼짐"} → {f.koreaCheck ? `국내 표본 확인(하루 ${f.koreaPerDay}장)` : "한국 확인 꺼짐"} → 보고{f.narrate ? " · AI 요약" : ""}
          </p>
          <p className="mt-1 text-[13px] text-nd-fg-3">자동 분석이 하루 편수 상한에 닿으면 AI 분석을 멈추고 다음 날 이어갑니다. 한 번에 최대 5분 안에서만 돕니다.</p>
        </div>
      </div>
    </StudioCard>
  );
}

/** 터진 영상 기준 · 자동 분석 편수 — 회사 공용 정찰 설정 (예전 감시 채널 탭 아래 「정찰 설정」 을 옮김) */
function DetectSettingsCard({ d, refresh }: { d: ScoutData; refresh: () => Promise<void> }) {
  const [s, setS] = useState<ScoutSettings>(d.settings);
  const saver = useDebouncedSave<ScoutSettings>(async (v) => {
    await scout("settings.save", { settings: v });
    await refresh();
  }, null);
  const set = (next: ScoutSettings) => {
    setS(next);
    saver.push(next);
  };
  return (
    <StudioCard
      title="터진 영상 기준 · 자동 분석"
      description="회사 공용 정찰 설정 · 훑기와 매일 아침 자동 분석이 이 기준을 씁니다"
      action={
        <>
          <SaveIndicator state={saver.state} savedAt={saver.savedAt} onRetry={() => void saver.retry()} />
          <Button variant="ghost" onClick={() => set(DEFAULT_SCOUT_SETTINGS)}>
            기본값으로
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-nd-body leading-relaxed text-nd-fg-2">
          터진 영상 = 올린 지 {s.maxAgeDays}일 안 · 조회수 {fmtCount(s.minViews)}회 이상 · 그 채널 평소의 {s.threshold}배 이상인 쇼츠(3분 이하). 평소 = 그 채널 최근 쇼츠 중 올린 지 7일 넘은 것 최대 30편의 조회수 중앙값.
        </p>
        <FormRow className="grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="평소의 몇 배부터">
            <NumberInput decimal value={s.threshold} onValueChange={(raw) => set({ ...s, threshold: Number(raw) || DEFAULT_SCOUT_SETTINGS.threshold })} />
          </Field>
          <Field label="최소 조회수">
            <NumberInput value={s.minViews} onValueChange={(raw) => set({ ...s, minViews: Number(raw) || 0 })} />
          </Field>
          <Field label="올린 지 며칠 안">
            <NumberInput value={s.maxAgeDays} onValueChange={(raw) => set({ ...s, maxAgeDays: Number(raw) || DEFAULT_SCOUT_SETTINGS.maxAgeDays })} />
          </Field>
          <Field label="자동 분석 — 하루 편수 상한">
            <NumberInput value={s.autoAnalyzePerDay} onValueChange={(raw) => set({ ...s, autoAnalyzePerDay: Number(raw) || 0 })} />
          </Field>
        </FormRow>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-nd-fg-3">
          <span>자동 분석은 매일 아침 새로 찾은 영상을 배수 큰 순으로 AI 가 직접 보고 형식을 뽑습니다 · 0 이면 끕니다.</span>
          <AiCostNote label="한 편" estimate={analysisEstimateText(d)} />
          <span>
            오늘 자동 분석 <b className="nd-num font-semibold text-nd-fg-2">{d.quotas.autoAnalyzeToday}</b>편
          </span>
        </p>
      </div>
    </StudioCard>
  );
}
