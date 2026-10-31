"use client";

// 형식 카드 — 터진 영상을 「어떻게 만들었나」 로 묶은 것. 나라별 처음 본 날 · 국내 확인 · 시차.
// 카드 내용은 고치는 대로 저장한다 (저장 버튼 없음).
import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Layers, Plus, Search, Trash2 } from "lucide-react";
import {
  Button,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  Field,
  FormRow,
  Input,
  Select,
  Switch,
  Table,
  TableScroll,
  Td,
  Textarea,
  Th,
  Tr,
  useConfirm,
} from "@/components/neander/ui";
import { fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { fmtCount } from "@/lib/neander/shorts/model";
import {
  AI_LEVEL_LABEL,
  KOREA_LABEL,
  LANG_DEP_LABEL,
  RISK_LABEL,
  countryLabel,
  fmtMultiple,
  formatStats,
  type FormatDoc,
  type ScoutRisk,
} from "@/lib/neander/shorts/scout";
import { AiBadge, CountryTag, KoreaBadge, LangBadge, LifeBadge, fmtAgo, fmtDate } from "./bits";
import { scout, type ScoutData, type WithId } from "./useScout";

export function FormatsTab({ d, refresh, openId, setOpenId }: { d: ScoutData; refresh: () => Promise<void>; openId: string | null; setOpenId: (id: string | null) => void }) {
  const { busy, run } = useAction();
  const [showArchived, setShowArchived] = useState(false);
  const now = Date.now();
  const rows = useMemo(
    () =>
      d.formats
        .filter((f) => showArchived || !f.archived)
        .map((f) => ({ f, s: formatStats(f, d.hits.filter((h) => h.formatId === f.id), now) }))
        .sort((a, b) => (a.s.life.stage === "rising" ? 0 : 1) - (b.s.life.stage === "rising" ? 0 : 1) || (b.s.medianMultiple ?? 0) - (a.s.medianMultiple ?? 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [d.formats, d.hits, showArchived],
  );
  const open = openId ? d.formats.find((f) => f.id === openId) ?? null : null;

  const create = () =>
    run("new", async () => {
      const r = await scout<{ id: string }>("format.save", { format: { name: "새 형식" } });
      await refresh();
      setOpenId(r.id);
    });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-nd-body text-nd-fg-2">소재가 아니라 「어떻게 만들었나」 로 묶습니다. 같은 카드에 여러 나라 영상이 쌓이면 나라별 처음 본 날과 한국에 나타난 날의 시차가 계산됩니다.</p>
        <div className="flex items-center gap-3">
          <Switch size="sm" checked={showArchived} onChange={setShowArchived} label="보관한 카드도" />
          <Button size="sm" icon={Plus} onClick={() => void create()} disabled={busy === "new"}>카드 직접 만들기</Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={Layers} title="형식 카드가 없습니다" description="터진 영상을 AI 로 분석한 뒤 「새 형식 카드로」 를 누르면 카드가 생깁니다." />
      ) : (
        <Card padding="none">
          <TableScroll>
            <Table minWidth={1100}>
              <thead>
                <tr>
                  <Th>형식</Th>
                  <Th>수명</Th>
                  <Th>나라 (처음 본 순)</Th>
                  <Th align="right">예시</Th>
                  <Th align="right">배수 중앙값</Th>
                  <Th>한국</Th>
                  <Th align="right" title="해외에서 처음 본 날 → 한국에 처음 나타난 날">시차</Th>
                  <Th>AI 재현 · 언어</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ f, s }) => (
                  <Tr key={f.id} className={f.archived ? "opacity-60" : undefined}>
                    <Td className="max-w-[320px]">
                      <button type="button" className="block w-full text-left" onClick={() => setOpenId(f.id)}>
                        <span className="line-clamp-1 font-medium hover:underline">{f.name}</span>
                        <span className="line-clamp-1 text-nd-caption text-nd-fg-3">{f.summary || "설명 없음"}</span>
                      </button>
                    </Td>
                    <Td><LifeBadge stage={s.life.stage} basis={s.life.basis} /></Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {s.countries.map((c) => (
                          <span key={c.code} title={`처음 본 날 ${fmtDate(c.firstSeen)} · ${c.n}편`}>
                            <CountryTag code={c.code} />
                          </span>
                        ))}
                        {!s.countries.length && <span className="text-nd-fg-3">—</span>}
                      </div>
                    </Td>
                    <Td num>{s.examples}</Td>
                    <Td num>{fmtMultiple(s.medianMultiple)}</Td>
                    <Td><KoreaBadge status={s.korea} /></Td>
                    <Td num>{s.lagDays === null ? "—" : `${s.lagDays}일`}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        <AiBadge level={f.aiFeasibility.level} />
                        <LangBadge dep={f.languageDependence} />
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        </Card>
      )}
      {open && <FormatDialog key={open.id} d={d} f={open} refresh={refresh} onClose={() => setOpenId(null)} />}
    </div>
  );
}

// ---- 카드 하나 (고치는 대로 저장) ------------------------------------------------

type Draft = Omit<FormatDoc, "owner" | "createdAt" | "updatedAt" | "updatedBy" | "korea">;
const draftOf = (f: FormatDoc): Draft => {
  const { owner: _o, createdAt: _c, updatedAt: _u, updatedBy: _b, korea: _k, ...rest } = f;
  return rest;
};

function FormatDialog({ d, f, refresh, onClose }: { d: ScoutData; f: WithId<FormatDoc>; refresh: () => Promise<void>; onClose: () => void }) {
  const ask = useConfirm();
  const { nameOf } = useShorts();
  const { busy, run } = useAction();
  const [draft, setDraft] = useState<Draft>(() => draftOf(f));
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(draft);
  const dirty = useRef(false);
  const hits = d.hits.filter((h) => h.formatId === f.id).sort((a, b) => Date.parse(a.publishedAt ?? "9") - Date.parse(b.publishedAt ?? "9"));
  const s = formatStats(f, hits, Date.now());

  const flush = async () => {
    if (!dirty.current) return;
    dirty.current = false;
    if (!latest.current.name.trim()) return;
    setSaveState("saving");
    try {
      await scout("format.save", { id: f.id, format: latest.current });
      setSaveState("saved");
    } catch {
      setSaveState("error");
      dirty.current = true;
    }
  };
  const set = (patch: Partial<Draft>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    dirty.current = true;
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 700);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const close = async () => {
    if (timer.current) clearTimeout(timer.current);
    await flush();
    await refresh();
    onClose();
  };

  const lines = (v: string) => v.split("\n").map((x) => x.trim()).filter(Boolean);
  const toggleRisk = (r: ScoutRisk) => set({ risks: draft.risks.includes(r) ? draft.risks.filter((x) => x !== r) : [...draft.risks, r] });

  return (
    <Dialog
      open
      onClose={() => void close()}
      size="xl"
      title={draft.name || "형식 카드"}
      description={`${f.owner === "company" ? "자동" : d.me === f.owner ? "내가 만듦" : `${nameOf(f.owner)} 만듦`} · 처음 ${fmtWhen(f.createdAt)} · ${saveState === "saving" ? "저장 중…" : saveState === "saved" ? "저장됨" : saveState === "error" ? "저장 실패 — 다시 고치면 다시 저장합니다" : "고치는 대로 저장됩니다"}`}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <Switch size="sm" checked={draft.archived} onChange={(v) => set({ archived: v })} label="보관 (보고에서 뺌)" />
            {(f.owner === d.me || d.admin) && (
              <Button
                size="sm"
                variant="ghost"
                icon={Trash2}
                onClick={() =>
                  void (async () => {
                    if (!(await ask({ title: "형식 카드를 지울까요?", message: "묶인 영상은 「묶기 전」 으로 돌아갑니다.", tone: "danger", confirmLabel: "지우기" }))) return;
                    if (timer.current) clearTimeout(timer.current);
                    dirty.current = false;
                    await run("del", () => scout("format.delete", { id: f.id }));
                    await refresh();
                    onClose();
                  })()
                }
              >
                지우기
              </Button>
            )}
          </div>
          <Button size="sm" variant="secondary" onClick={() => void close()}>닫기</Button>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <div className="space-y-3">
          <FormRow className="grid-cols-1 sm:grid-cols-[2fr_1fr_1fr]">
            <Field label="형식 이름">
              <Input size="sm" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="AI 재현">
              <Select size="sm" value={draft.aiFeasibility.level} onChange={(e) => set({ aiFeasibility: { ...draft.aiFeasibility, level: e.target.value as Draft["aiFeasibility"]["level"] } })}>
                {Object.entries(AI_LEVEL_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </Select>
            </Field>
            <Field label="언어 의존">
              <Select size="sm" value={draft.languageDependence} onChange={(e) => set({ languageDependence: e.target.value as Draft["languageDependence"] })}>
                {Object.entries(LANG_DEP_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </Select>
            </Field>
          </FormRow>
          <Field label="한 줄 설명">
            <Input size="sm" value={draft.summary} onChange={(e) => set({ summary: e.target.value })} />
          </Field>
          <Field label="훅 (첫 2초)">
            <Textarea rows={2} value={draft.hook} onChange={(e) => set({ hook: e.target.value })} />
          </Field>
          <Field label="흐름 (한 줄에 한 단계)">
            <Textarea rows={4} value={draft.structure.join("\n")} onChange={(e) => set({ structure: lines(e.target.value) })} />
          </Field>
          <FormRow className="grid-cols-1 sm:grid-cols-2">
            <Field label="편집 (컷 · 전환 · 카메라)">
              <Textarea rows={2} value={draft.editing} onChange={(e) => set({ editing: e.target.value })} />
            </Field>
            <Field label="소리 (음악 · 효과음 · 말)">
              <Textarea rows={2} value={draft.sound} onChange={(e) => set({ sound: e.target.value })} />
            </Field>
          </FormRow>
          <Field label="화면 글자">
            <Input size="sm" value={draft.textOverlay} onChange={(e) => set({ textOverlay: e.target.value })} />
          </Field>
          <Field label="먹힌 이유 (가설)">
            <Textarea rows={2} value={draft.whyItWorks} onChange={(e) => set({ whyItWorks: e.target.value })} />
          </Field>
          <FormRow className="grid-cols-1 sm:grid-cols-2">
            <Field label="AI 로 쉬운 것">
              <Textarea rows={2} value={draft.aiFeasibility.easyParts} onChange={(e) => set({ aiFeasibility: { ...draft.aiFeasibility, easyParts: e.target.value } })} />
            </Field>
            <Field label="AI 로 어려운 것">
              <Textarea rows={2} value={draft.aiFeasibility.hardParts} onChange={(e) => set({ aiFeasibility: { ...draft.aiFeasibility, hardParts: e.target.value } })} />
            </Field>
          </FormRow>
          <Field label="제품 접목 아이디어 (한 줄에 하나)">
            <Textarea rows={3} value={draft.brandIdeas.join("\n")} onChange={(e) => set({ brandIdeas: lines(e.target.value) })} />
          </Field>
          <div>
            <span className="mb-1.5 block text-nd-caption text-nd-fg-2">주의할 점</span>
            <div className="flex flex-wrap gap-3">
              {(Object.keys(RISK_LABEL) as ScoutRisk[]).map((r) => (
                <Checkbox key={r} checked={draft.risks.includes(r)} onChange={() => toggleRisk(r)} label={RISK_LABEL[r]} />
              ))}
            </div>
          </div>
          <Field label="메모">
            <Textarea rows={2} value={draft.note} onChange={(e) => set({ note: e.target.value })} />
          </Field>
        </div>

        <div className="space-y-5">
          <Card>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="text-nd-section">흐름</h3>
              <LifeBadge stage={s.life.stage} basis={s.life.basis} />
            </div>
            <p className="text-nd-body text-nd-fg-2">{s.life.basis} · 배수 중앙값 {fmtMultiple(s.medianMultiple)}</p>
            <div className="mt-3 space-y-1.5">
              {s.countries.map((c) => (
                <div key={c.code} className="flex items-center justify-between text-nd-body">
                  <CountryTag code={c.code} />
                  <span className="text-nd-fg-2">처음 본 날 {fmtDate(c.firstSeen)} · {c.n}편</span>
                </div>
              ))}
            </div>
            {s.lagDays !== null && s.foreignFirst && (
              <p className="mt-3 text-nd-body">
                {countryLabel(s.foreignFirst.code)}에서 처음 본 뒤 <b>{s.lagDays}일</b> 만에 한국에 나타났습니다.
              </p>
            )}
          </Card>

          <KoreaCheckBox d={d} f={f} refresh={refresh} stats={s} />

          <Card>
            <h3 className="mb-2 text-nd-section">묶인 영상 {hits.length}편</h3>
            {hits.length === 0 ? (
              <p className="text-nd-body text-nd-fg-3">아직 없습니다. 「터진 영상」 탭에서 이 카드에 묶으세요.</p>
            ) : (
              <ul className="space-y-2">
                {hits.map((h) => (
                  <li key={h.id} className="flex items-start justify-between gap-3 text-nd-body">
                    <a href={h.url} target="_blank" rel="noreferrer" className="min-w-0 hover:underline">
                      <span className="line-clamp-1">{h.title || h.url}</span>
                      <span className="text-nd-caption text-nd-fg-3">{h.channel} · {fmtDate(h.publishedAt)} · 조회 {fmtCount(h.views.v)}</span>
                    </a>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {h.country && <CountryTag code={h.country} />}
                      <span className="font-medium">{fmtMultiple(h.multiple)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </Dialog>
  );
}

// ---- 국내 확인 -------------------------------------------------------------

function KoreaCheckBox({ d, f, refresh, stats }: { d: ScoutData; f: WithId<FormatDoc>; refresh: () => Promise<void>; stats: ReturnType<typeof formatStats> }) {
  const { busy, run } = useAction();
  const [query, setQuery] = useState(f.korea.query || f.koreanQueries[0] || "");
  const [pick, setPick] = useState<Set<string>>(new Set());
  const last = f.korea.lastSearch;
  const keyReady = !!d.quotas.youtubeSearch.source;
  const mark = (status: "some" | "spread" | "none_in_sample") =>
    run(
      "mark",
      async () => {
        await scout("format.koreaMark", { id: f.id, videoIds: status === "none_in_sample" ? [] : [...pick], status });
        await refresh();
      },
      status === "none_in_sample" ? "「국내 표본에 없음」 으로 적었습니다 (없다는 단정은 아닙니다)." : "국내 사례로 적었습니다.",
    );
  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-nd-section">한국에 이미 있나</h3>
        <KoreaBadge status={stats.korea} />
      </div>
      <p className="mb-3 text-nd-body text-nd-fg-2">
        {f.korea.checkedAt ? `${fmtWhen(f.korea.checkedAt)} 「${f.korea.query}」 표본 ${f.korea.sampleSize ?? 0}편에서 ${f.korea.matches.length}편 골랐습니다. ` : ""}
        국내(KR) 터진 영상이 이 카드에 묶이면 자동으로 「조금 있음」 이 됩니다. 표본에서 못 찾은 것은 「{KOREA_LABEL.none_in_sample}」 일 뿐 없다는 단정이 아닙니다.
      </p>
      <FormRow className="grid-cols-[1fr_auto]">
        <Field label={`국내 검색어${f.koreanQueries.length ? ` · AI 제안: ${f.koreanQueries.join(", ")}` : ""}`}>
          <Input size="sm" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && keyReady && void run("ks", async () => { await scout("format.koreaSearch", { id: f.id, query }); await refresh(); setPick(new Set()); })} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-nd-caption" aria-hidden>{" "}</span>
          <Button
            size="sm"
            variant="secondary"
            icon={Search}
            disabled={!keyReady || !query.trim() || busy === "ks"}
            onClick={() =>
              void run("ks", async () => {
                await scout("format.koreaSearch", { id: f.id, query });
                await refresh();
                setPick(new Set());
              })
            }
          >
            국내 검색 (1회)
          </Button>
        </div>
      </FormRow>
      {last && (
        <div className="mt-3">
          <p className="mb-2 text-nd-caption text-nd-fg-3">「{last.query}」 · 최근 90일 · 한국 · 조회수 순 표본 {last.results.length}편 — 같은 형식인 것을 고르세요</p>
          <div className="max-h-[260px] space-y-1 overflow-auto pr-1">
            {last.results.map((r) => (
              <label key={r.id} className="flex cursor-pointer items-start gap-2 rounded-nd-sm px-1 py-1 text-nd-body hover:bg-nd-fg/[.04]">
                <Checkbox checked={pick.has(r.id)} onChange={() => setPick((p) => { const n = new Set(p); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-1">{r.title}</span>
                  <span className="text-nd-caption text-nd-fg-3">{r.channel} · 조회 {fmtCount(r.views)} · {fmtAgo(r.publishedAt)}</span>
                </span>
                <a href={r.url} target="_blank" rel="noreferrer" className="shrink-0 text-nd-fg-3 hover:text-nd-fg" aria-label="열기" onClick={(e) => e.stopPropagation()}>
                  <ExternalLink size={13} />
                </a>
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={!pick.size || busy === "mark"} onClick={() => void mark("some")}>고른 것 = 국내에 조금 있음</Button>
            <Button size="sm" variant="secondary" disabled={!pick.size || busy === "mark"} onClick={() => void mark("spread")}>고른 것 = 이미 퍼짐</Button>
            <Button size="sm" variant="ghost" disabled={busy === "mark"} onClick={() => void mark("none_in_sample")}>같은 형식 없음</Button>
          </div>
        </div>
      )}
      {f.korea.matches.length > 0 && (
        <div className="mt-3 border-t border-nd-line pt-3">
          <p className="mb-1 text-nd-caption text-nd-fg-3">국내 사례로 고른 영상</p>
          <ul className="space-y-1">
            {f.korea.matches.map((m) => (
              <li key={m.url} className="text-nd-body">
                <a href={m.url} target="_blank" rel="noreferrer" className="hover:underline">{m.title}</a>
                <span className="ml-2 text-nd-caption text-nd-fg-3">{fmtDate(m.publishedAt)} · 조회 {fmtCount(m.views)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
