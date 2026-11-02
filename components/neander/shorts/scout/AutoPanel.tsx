"use client";

// ============================================================
//  바이럴 형식 — 자동 수집 상태 바 (2026-11-02 목업)
// ------------------------------------------------------------
//  한 줄: 자동 시각 · 마지막 실행 · 최근 실행 한 번의 AI 비용과 검색 수 (오늘 누적이 아니다).
//  긴 실행 기록은 「실행 상세」, 자동화 설정은 「설정」 으로 펼친다.
//  실행 네 가지는 따로 둔다 — 합치거나 빼지 않는다:
//    전체 자동화(「지금 돌리기」) · 채널만 훑기 · 보고 새로 만들기 · AI 요약 다시
//  매일 07:00 KST cron-scout 이 전체 자동화를 돈다. shorts/scout-auto.ts
// ============================================================

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Bot, ChevronDown, FileText, Play, RefreshCw, Settings2, Sparkles, TriangleAlert, Workflow } from "lucide-react";
import { Badge, Button, Card, Checkbox, Field, FormRow, InlineNotice, Menu, NumberInput, Skeleton, Switch, cn, type MenuItem } from "@/components/neander/ui";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { shortsGet, shortsPost } from "@/lib/neander/shorts/client";
import { krwOf } from "@/lib/neander/shorts/radar";
import { KOREA_LABEL } from "@/lib/neander/shorts/scout";
import { AUTO_COUNTRIES, AUTO_COUNTRY_SEARCH, type ScoutAutoSettings, type ScoutAutoSummary } from "@/lib/neander/shorts/scout-auto";

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

/** 화면 위 실행 네 가지 — 페이지가 한 곳에서 돌려서(도는 동안 서로 막는다) 상태 바 · 주간 보고가 같이 쓴다 */
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

/** 메뉴 한 줄 — 이름 + 무엇을 하는지 (줄바꿈 허용) */
const MenuLine = ({ title, desc }: { title: string; desc: ReactNode }) => (
  <span className="block whitespace-normal py-0.5">
    <span className="block font-medium text-nd-fg">{title}</span>
    <span className="block text-[13px] leading-snug text-nd-fg-3">{desc}</span>
  </span>
);

export function AutoPanel({ auto, actions, companyKey }: { auto: ScoutAuto; actions: ScoutRunActions; companyKey: boolean }) {
  const { nameOf } = useShorts();
  const [open, setOpen] = useState<"detail" | "settings" | null>(null);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const regionId = useId();
  const { data: d, error } = auto;
  const last = d?.last ?? null;
  const s = d?.settings ?? null;
  const running = actions.busy !== null;
  const toggle = (k: "detail" | "settings") => setOpen(open === k ? null : k);

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
          desc={actions.blocked.narrate ?? `${actions.narrateWeek} 보고 숫자로 요약을 씁니다 · AI 비용 조금`}
        />
      ),
      onSelect: actions.narrate,
      disabled: running || !!actions.blocked.narrate,
    },
  ];

  const byCountry = last ? Object.entries(last.added.reduce<Record<string, number>>((m, a) => ({ ...m, [a.country]: (m[a.country] ?? 0) + 1 }), {})) : [];
  const ranBy = (by: string) => (by === "company" ? "매일 아침 자동" : nameOf(by));

  return (
    <Card data-scout-status padding="none" className="mb-5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-3.5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-nd-accent-soft text-nd-accent" aria-hidden>
            <Bot size={20} />
          </span>
          <h2 className="whitespace-nowrap text-[17px] font-bold text-nd-fg">자동 수집</h2>
          {s && (
            <Badge tone={s.enabled ? "success" : "neutral"} size="lg">
              {s.enabled ? "매일 07:00" : "자동 꺼짐"}
            </Badge>
          )}
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-nd-body text-nd-fg-2 sm:[&>*+*]:border-l sm:[&>*+*]:border-nd-line sm:[&>*+*]:pl-4">
          {!d && !error ? (
            <>
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-5 w-48" />
            </>
          ) : error && !d ? (
            <span className="inline-flex items-center gap-2 text-nd-warning-text">
              <TriangleAlert size={15} aria-hidden />
              자동화 상태를 불러오지 못했습니다
              <button type="button" className="font-medium text-nd-accent hover:underline" onClick={() => void auto.reload()}>
                다시 시도
              </button>
            </span>
          ) : last ? (
            <>
              <span className="nd-num whitespace-nowrap" title={`마지막 실행 ${fmtWhen(last.at)} · ${ranBy(last.by)}`}>
                마지막 {fmtWhen(last.at)}
              </span>
              <span className="nd-num whitespace-nowrap" title="마지막 실행 한 번에서 쓴 AI 비용(달러 어림 환산)과 YouTube 검색 수 — 오늘 누적이 아닙니다">
                최근 실행 AI <b className="font-semibold text-nd-fg">{won(last.aiUsd)}</b>원 · 검색 <b className="font-semibold text-nd-fg">{last.searches}</b>회
              </span>
            </>
          ) : (
            <span>아직 실행 기록이 없습니다</span>
          )}
          {!companyKey && (
            <span className="inline-flex items-center gap-1 whitespace-nowrap text-[13px] font-medium text-nd-warning-text" title="회사 YouTube 키가 없으면 자동 실행에서 채널 찾기 · 훑기 · 한국 확인을 건너뜁니다">
              <TriangleAlert size={14} aria-hidden />
              회사 키 없음
            </span>
          )}
          {last && last.notes.length > 0 && (
            <button type="button" onClick={() => setOpen("detail")} className="inline-flex items-center gap-1 whitespace-nowrap text-[13px] font-medium text-nd-warning-text hover:underline">
              <TriangleAlert size={14} aria-hidden />
              실행 메모 {last.notes.length}건
            </button>
          )}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            trailingIcon={ChevronDown}
            aria-expanded={open === "detail"}
            aria-controls={regionId}
            onClick={() => toggle("detail")}
            className={cn("[&>svg:last-child]:transition-transform", open === "detail" && "[&>svg:last-child]:rotate-180")}
          >
            실행 상세
          </Button>
          <Button variant="ghost" icon={Settings2} aria-expanded={open === "settings"} aria-controls={regionId} onClick={() => toggle("settings")}>
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

      {actions.busy && (
        <p className="border-t border-nd-line px-5 py-2 text-[13px] text-nd-fg-2" role="status">
          {BUSY_LABEL[actions.busy] ?? "처리 중…"} 화면을 떠나도 서버에서 끝까지 돕니다.
        </p>
      )}

      {open && (
        <div id={regionId} className="border-t border-nd-line px-5 py-4">
          {open === "detail" ? (
            <RunDetail d={d} ranBy={ranBy} byCountry={byCountry} />
          ) : s ? (
            <AutoSettingsForm key={s.updatedAt} s={s} admin={!!d?.admin} onSaved={auto.reload} />
          ) : (
            <p className="text-nd-body text-nd-fg-3">{error ? "설정을 불러오지 못했습니다." : "설정을 불러오는 중…"}</p>
          )}
        </div>
      )}
    </Card>
  );
}

function RunDetail({ d, ranBy, byCountry }: { d: ScoutAutoData | null; ranBy: (by: string) => string; byCountry: [string, number][] }) {
  const s = d?.settings;
  const last = d?.last ?? null;
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
                ["실행 시각", `${fmtWhen(last.at)} · ${Math.round(last.ms / 1000)}초`],
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
                <dd className="nd-num break-words font-medium text-nd-fg">
                  {v}
                </dd>
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
                {last.added.map((a, i) => (
                  <li key={i} className="break-words">
                    · {COUNTRY_LABEL[a.country] ?? a.country} · <span className="text-nd-fg-2">{a.title}</span> — {a.why}
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
          <p className="text-[13px] text-nd-fg-3">AI 비용은 이 실행 한 번의 값을 달러에서 {won(1)}원으로 어림 환산한 것입니다. YouTube 검색은 소재 발굴 · AI 레이더와 같은 하루 한도(90회)를 씁니다.</p>
        </>
      ) : (
        <p className="text-nd-fg-3">아직 돈 적이 없습니다. 내일 아침 07:00 에 처음 돌거나, 「지금 돌리기」 로 바로 돌릴 수 있습니다.</p>
      )}
    </div>
  );
}

function AutoSettingsForm({ s, admin, onSaved }: { s: ScoutAutoSettings; admin: boolean; onSaved: () => Promise<void> }) {
  const { busy, run } = useAction();
  const [f, setF] = useState(s);
  const toggleCountry = (c: (typeof AUTO_COUNTRIES)[number], on: boolean) => setF({ ...f, countries: on ? [...f.countries, c] : f.countries.filter((x) => x !== c) });
  return (
    <div className="space-y-4">
      <p className="text-nd-body leading-relaxed text-nd-fg-2">
        자동으로 넣은 감시 채널에는 주제 「자동 추가」 가 붙습니다. 아니다 싶으면 감시 채널 탭에서 끄거나 지우세요 — 지운 채널은 다시 넣지 않습니다. 해외는 나라마다 하루 YouTube 검색 1회, 한국 확인은 카드마다 1회를 소재 발굴 · AI 레이더와 같은 하루 한도(90회)에서 씁니다.
      </p>
      {!admin && <InlineNotice tone="neutral">설정은 AI STUDIO 관리자만 바꿉니다.</InlineNotice>}
      <Switch checked={f.enabled} disabled={!admin} onChange={(v) => setF({ ...f, enabled: v })} label="매일 아침 자동으로 돌기" />
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <Checkbox checked={f.fillKorea} disabled={!admin} onChange={(e) => setF({ ...f, fillKorea: e.target.checked })} label="한국 채널을 AI 레이더에서 채우기" />
        {AUTO_COUNTRIES.map((c) => (
          <Checkbox key={c} checked={f.countries.includes(c)} disabled={!admin} onChange={(e) => toggleCountry(c, e.target.checked)} label={`${AUTO_COUNTRY_SEARCH[c].label} 찾기`} />
        ))}
      </div>
      <FormRow className="grid-cols-2 sm:grid-cols-4">
        <Field label="나라마다 하루 추가"><NumberInput disabled={!admin} value={f.addsPerDay} onValueChange={(r) => setF({ ...f, addsPerDay: Number(r) || 0 })} /></Field>
        <Field label="나라마다 최대 (자동분)"><NumberInput disabled={!admin} value={f.perCountryCap} onValueChange={(r) => setF({ ...f, perCountryCap: Number(r) || 0 })} /></Field>
        <Field label="평소 대비 최소 배수"><NumberInput decimal disabled={!admin} value={f.minMultiple} onValueChange={(r) => setF({ ...f, minMultiple: Number(r) || 0 })} /></Field>
        <Field label="해외 최소 조회수"><NumberInput disabled={!admin} value={f.minViewsAbroad} onValueChange={(r) => setF({ ...f, minViewsAbroad: Number(r) || 0 })} /></Field>
      </FormRow>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <Checkbox checked={f.group} disabled={!admin} onChange={(e) => setF({ ...f, group: e.target.checked })} label="형식 카드 자동 묶기" />
        <Checkbox checked={f.koreaCheck} disabled={!admin} onChange={(e) => setF({ ...f, koreaCheck: e.target.checked })} label="한국 확인 자동" />
        <Checkbox checked={f.narrate} disabled={!admin} onChange={(e) => setF({ ...f, narrate: e.target.checked })} label="주간 보고 AI 요약 자동" />
      </div>
      <FormRow className="grid-cols-2 sm:grid-cols-4">
        <Field label="하루 한국 확인 카드 수"><NumberInput disabled={!admin} value={f.koreaPerDay} onValueChange={(r) => setF({ ...f, koreaPerDay: Number(r) || 0 })} /></Field>
      </FormRow>
      {admin && (
        <Button size="sm" disabled={busy === "s"} onClick={() => void run("s", async () => { await shortsPost("scout-auto", { action: "settings.save", settings: f }); await onSaved(); }, "자동화 설정을 저장했습니다.")}>
          설정 저장
        </Button>
      )}
    </div>
  );
}
