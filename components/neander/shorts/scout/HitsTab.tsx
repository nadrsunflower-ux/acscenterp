"use client";

// 터진 영상 — 감시 채널에서 평소의 몇 배로 터진 쇼츠 + 직접 등록한 해외 영상.
// AI 가 영상을 직접 보고 형식을 뽑으면, 사람이 형식 카드에 묶는다.
import { useMemo, useState } from "react";
import { ExternalLink, Flame, Plus, Sparkles, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  FormRow,
  InlineNotice,
  Input,
  NumberInput,
  Select,
  Table,
  TableScroll,
  Tabs,
  Td,
  Textarea,
  Th,
  Tr,
  useConfirm,
} from "@/components/neander/ui";
import { SourceTag, fmtUsd, fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { PLATFORM_LABEL, fmtCount, fmtPct, platformFromUrl } from "@/lib/neander/shorts/model";
import { COUNTRIES, RISK_LABEL, countryLabel, fmtMultiple, type HitDoc } from "@/lib/neander/shorts/scout";
import { AiBadge, CountrySelect, CountryTag, LangBadge, fmtAgo, fmtDate } from "./bits";
import { scout, type ScoutData, type WithId } from "./useScout";

type Filter = "new" | "assigned" | "dismissed" | "all";

export function HitsTab({ d, refresh, onOpenFormat }: { d: ScoutData; refresh: () => Promise<void>; onOpenFormat: (id: string) => void }) {
  const { busy, run } = useAction();
  const [filter, setFilter] = useState<Filter>("new");
  const [country, setCountry] = useState("");
  const [sort, setSort] = useState<"multiple" | "found" | "published">("multiple");
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const formatName = useMemo(() => new Map(d.formats.map((f) => [f.id, f.name])), [d.formats]);

  const rows = useMemo(() => {
    const list = d.hits.filter((h) => (filter === "all" ? true : h.status === filter) && (!country || h.country === country));
    return list.sort((a, b) =>
      sort === "multiple" ? (b.multiple ?? -1) - (a.multiple ?? -1) : sort === "found" ? b.createdAt - a.createdAt : Date.parse(b.publishedAt ?? "0") - Date.parse(a.publishedAt ?? "0"),
    );
  }, [d.hits, filter, country, sort]);
  const count = (f: Filter) => d.hits.filter((h) => (f === "all" ? true : h.status === f)).length;
  const hit = open ? d.hits.find((h) => h.id === open) ?? null : null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          items={[
            { key: "new", label: "묶기 전", badge: count("new") },
            { key: "assigned", label: "형식에 묶음", badge: count("assigned") },
            { key: "dismissed", label: "제외", badge: count("dismissed") },
            { key: "all", label: "전체" },
          ]}
          value={filter}
          onChange={(k) => setFilter(k as Filter)}
          ariaLabel="상태"
        />
        <div className="flex items-center gap-2">
          <Select size="sm" value={country} onChange={(e) => setCountry(e.target.value)} aria-label="나라">
            <option value="">모든 나라</option>
            {COUNTRIES.filter((c) => d.hits.some((h) => h.country === c.code)).map((c) => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </Select>
          <Select size="sm" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="정렬">
            <option value="multiple">배수 큰 순</option>
            <option value="found">찾은 순</option>
            <option value="published">올린 순</option>
          </Select>
          <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>영상 등록</Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Flame}
          title={filter === "new" ? "묶을 영상이 없습니다" : "영상이 없습니다"}
          description="감시 채널을 훑으면 평소보다 크게 터진 쇼츠가 여기 모입니다. 틱톡 · 더우인 · 인스타에서 본 영상은 「영상 등록」 으로 넣으세요."
        />
      ) : (
        <Card padding="none">
          <TableScroll>
            <Table minWidth={1080}>
              <thead>
                <tr>
                  <Th>영상</Th>
                  <Th>나라</Th>
                  <Th>올린 지</Th>
                  <Th align="right">조회</Th>
                  <Th align="right" title="조회수 ÷ 그 채널 평소 조회수">배수</Th>
                  <Th>형식</Th>
                  <Th align="right" title="댓글 표본 중 한글 댓글 — 한국 사람이 이미 보고 있나">한글 댓글</Th>
                  <Th align="right"> </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => {
                  const suggestion = !h.formatId && h.analysis?.match.formatId ? formatName.get(h.analysis.match.formatId) : null;
                  return (
                    <Tr key={h.id} className={h.status === "dismissed" ? "opacity-60" : undefined}>
                      <Td className="max-w-[380px]">
                        <button type="button" className="flex w-full items-center gap-3 text-left" onClick={() => setOpen(h.id)}>
                          {h.thumbnail ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={h.thumbnail} alt="" className="h-10 w-[72px] shrink-0 rounded-nd-sm object-cover" loading="lazy" />
                          ) : (
                            <span className="flex h-10 w-[72px] shrink-0 items-center justify-center rounded-nd-sm bg-nd-fg/[.06] text-nd-caption text-nd-fg-3">{PLATFORM_LABEL[h.platform]}</span>
                          )}
                          <span className="min-w-0">
                            <span className="line-clamp-1 font-medium hover:underline">{h.title || h.url}</span>
                            <span className="line-clamp-1 text-nd-caption text-nd-fg-3">{h.channel}{h.found === "manual" ? " · 직접 등록" : ""}</span>
                          </span>
                        </button>
                      </Td>
                      <Td>{h.country ? <CountryTag code={h.country} /> : <span className="text-nd-fg-3">—</span>}</Td>
                      <Td className="text-nd-table">{fmtAgo(h.publishedAt)}</Td>
                      <Td num>{fmtCount(h.views.v)}</Td>
                      <Td num title={`평소 ${fmtCount(h.baseline.v)} · ${h.baseline.ref ?? ""}`}>
                        <span className={(h.multiple ?? 0) >= 10 ? "font-semibold text-nd-success-text" : undefined}>{fmtMultiple(h.multiple)}</span>
                      </Td>
                      <Td className="max-w-[220px]">
                        {h.formatId ? (
                          <button type="button" className="line-clamp-1 text-left font-medium hover:underline" onClick={() => onOpenFormat(h.formatId as string)}>{formatName.get(h.formatId) ?? "(지워진 카드)"}</button>
                        ) : h.analysis ? (
                          <span className="line-clamp-1 text-nd-table text-nd-fg-2" title={h.analysis.summary}>
                            {suggestion ? `제안: ${suggestion}` : `새 형식? ${h.analysis.formatName}`}
                          </span>
                        ) : (
                          <span className="text-nd-table text-nd-fg-3">분석 전</span>
                        )}
                      </Td>
                      <Td num>{h.koreanComments ? fmtPct(h.koreanComments.sampled ? h.koreanComments.korean / h.koreanComments.sampled : null, 0) : "—"}</Td>
                      <Td align="right">
                        {!h.analysis && h.platform === "youtube" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={Sparkles}
                            disabled={busy === `an-${h.id}`}
                            onClick={() =>
                              void run(`an-${h.id}`, async () => {
                                await scout("hit.analyze", { id: h.id });
                                await refresh();
                              }, "AI 가 영상을 보고 형식을 뽑았습니다.")
                            }
                          >
                            {busy === `an-${h.id}` ? "보는 중…" : "분석"}
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => setOpen(h.id)}>보기</Button>
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

      {hit && <HitDialog d={d} hit={hit} refresh={refresh} onClose={() => setOpen(null)} onOpenFormat={onOpenFormat} />}
      {adding && <AddHitDialog keyReady={!!d.quotas.youtubeSearch.source} refresh={refresh} onClose={() => setAdding(false)} onAdded={(id) => setOpen(id)} />}
    </div>
  );
}

// ---- 영상 하나 ---------------------------------------------------------------

function HitDialog({ d, hit: h, refresh, onClose, onOpenFormat }: { d: ScoutData; hit: WithId<HitDoc>; refresh: () => Promise<void>; onClose: () => void; onOpenFormat: (id: string) => void }) {
  const ask = useConfirm();
  const { busy, run } = useAction();
  const [model, setModel] = useState(d.models[0]?.id ?? "");
  const [pick, setPick] = useState(h.formatId ?? h.analysis?.match.formatId ?? "");
  const [note, setNote] = useState(h.note);
  const a = h.analysis;
  const formats = d.formats.filter((f) => !f.archived);
  const suggested = a?.match.formatId ? d.formats.find((f) => f.id === a.match.formatId) : null;

  const act = (key: string, action: string, body: object, ok?: string) =>
    run(key, async () => {
      await scout(action, { id: h.id, ...body });
      await refresh();
    }, ok);

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={h.title || "영상"}
      description={`${PLATFORM_LABEL[h.platform]} · ${h.channel || "채널 모름"} · ${h.found === "scan" ? `감시 채널 훑기 ${fmtWhen(h.createdAt)}` : `직접 등록 ${fmtWhen(h.createdAt)}`}`}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            {h.status === "dismissed" ? (
              <Button size="sm" variant="secondary" onClick={() => void act("st", "hit.update", { patch: { status: "new" } })}>되살리기</Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => void act("st", "hit.update", { patch: { status: "dismissed" } }).then(onClose)}>제외 (형식 아님)</Button>
            )}
            {(h.owner === d.me || d.admin) && (
              <Button
                size="sm"
                variant="ghost"
                icon={Trash2}
                onClick={() =>
                  void (async () => {
                    if (!(await ask({ title: "영상을 지울까요?", message: "형식 카드의 근거에서도 빠집니다. 숨기기만 하려면 「제외」 를 쓰세요.", tone: "danger", confirmLabel: "지우기" }))) return;
                    await act("del", "hit.delete", {});
                    onClose();
                  })()
                }
              >
                지우기
              </Button>
            )}
          </div>
          <Button size="sm" variant="secondary" onClick={onClose}>닫기</Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-nd-body">
          <a href={h.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-nd-accent hover:underline">원본 열기 <ExternalLink size={13} /></a>
          <span className="inline-flex items-center gap-1.5">조회 {fmtCount(h.views.v)} <SourceTag src={h.views.src} title={h.views.ref} /></span>
          <span className="inline-flex items-center gap-1.5" title={h.baseline.ref}>평소 {fmtCount(h.baseline.v)} <SourceTag src={h.baseline.src} title={h.baseline.ref} /></span>
          <span className="font-semibold">{fmtMultiple(h.multiple)}</span>
          <span>올린 날 {fmtDate(h.publishedAt)} ({fmtAgo(h.publishedAt)})</span>
          {h.duration ? <span>{Math.round(h.duration)}초</span> : null}
        </div>

        <FormRow className="grid-cols-1 sm:grid-cols-[1fr_2fr]">
          <Field label="나라 (어느 흐름인가)">
            <CountrySelect value={h.country} onChange={(v) => void act("country", "hit.update", { patch: { country: v } })} />
          </Field>
          <Field label="한글 댓글 (한국 사람이 이미 보고 있나)">
            <div className="flex items-center gap-2">
              <span className="text-nd-body">
                {h.koreanComments ? `댓글 ${h.koreanComments.sampled}개 표본 중 ${h.koreanComments.korean}개 (${fmtPct(h.koreanComments.sampled ? h.koreanComments.korean / h.koreanComments.sampled : null, 0)})` : "아직 안 읽음"}
              </span>
              {h.platform === "youtube" && (
                <Button size="sm" variant="ghost" disabled={busy === "kc"} onClick={() => void act("kc", "hit.koreanComments", {})}>댓글 표본 읽기</Button>
              )}
            </div>
          </Field>
        </FormRow>

        {h.found === "manual" && h.platform !== "youtube" && <ManualNumbers hit={h} refresh={refresh} />}

        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-nd-section">형식 분석</h3>
            {h.platform === "youtube" ? (
              <div className="flex items-center gap-2">
                <Select size="sm" value={model} onChange={(e) => setModel(e.target.value)} aria-label="모델">
                  {d.models.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </Select>
                <Button size="sm" icon={Sparkles} disabled={busy === "an"} onClick={() => void act("an", "hit.analyze", { model }, "AI 가 영상을 보고 형식을 뽑았습니다.")}>
                  {busy === "an" ? "영상 보는 중…" : a ? "다시 분석" : "AI 로 영상 분석 (약 10원)"}
                </Button>
              </div>
            ) : null}
          </div>
          {!a ? (
            h.platform === "youtube" ? (
              <p className="text-nd-body text-nd-fg-3">AI 가 영상을 직접 보고(화면 · 소리 · 자막) 훅 · 흐름 · 편집 · 소리 · 먹힌 이유 · AI 재현 난이도를 뽑습니다.</p>
            ) : (
              <InlineNotice tone="info">AI 가 직접 볼 수 있는 것은 YouTube 영상뿐입니다. 같은 영상이 YouTube 에 다시 올라와 있으면 그 주소로 등록하거나, 형식 카드 탭에서 카드를 직접 적어 이 영상을 묶으세요.</InlineNotice>
            )
          ) : (
            <AnalysisView a={a} />
          )}
        </Card>

        <Card>
          <h3 className="mb-3 text-nd-section">형식 카드에 묶기</h3>
          {h.formatId ? (
            <div className="flex flex-wrap items-center gap-2 text-nd-body">
              <span>묶인 형식:</span>
              <button type="button" className="font-medium text-nd-accent hover:underline" onClick={() => { onClose(); onOpenFormat(h.formatId as string); }}>
                {d.formats.find((f) => f.id === h.formatId)?.name ?? "(지워진 카드)"}
              </button>
              <Button size="sm" variant="ghost" disabled={busy === "as"} onClick={() => void act("as", "hit.assign", { formatId: null })}>묶음 풀기</Button>
            </div>
          ) : (
            <div className="space-y-3">
              {suggested && (
                <div className="flex flex-wrap items-center gap-2 text-nd-body">
                  <Badge tone="info" size="sm">AI 제안</Badge>
                  <span className="font-medium">{suggested.name}</span>
                  <span className="text-nd-fg-3">{a?.match.reason}</span>
                  <Button size="sm" variant="secondary" disabled={busy === "as"} onClick={() => void act("as", "hit.assign", { formatId: suggested.id }, "형식 카드에 묶었습니다.")}>여기에 묶기</Button>
                </div>
              )}
              <FormRow className="grid-cols-1 sm:grid-cols-[2fr_auto_auto]">
                <Field label="기존 형식 카드">
                  <Select size="sm" value={pick} onChange={(e) => setPick(e.target.value)}>
                    <option value="">고르기…</option>
                    {formats.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </Select>
                </Field>
                <div className="flex flex-col gap-1.5">
                  <span className="text-nd-caption" aria-hidden>{" "}</span>
                  <Button size="sm" variant="secondary" disabled={!pick || busy === "as"} onClick={() => void act("as", "hit.assign", { formatId: pick }, "형식 카드에 묶었습니다.")}>묶기</Button>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-nd-caption" aria-hidden>{" "}</span>
                  <Button size="sm" disabled={!a || busy === "as"} title={a ? undefined : "먼저 분석해 주세요"} onClick={() => void act("as", "hit.assign", { formatId: "new" }, "분석 내용으로 새 형식 카드를 만들었습니다.")}>
                    새 형식 카드로{a ? ` (「${a.formatName}」)` : ""}
                  </Button>
                </div>
              </FormRow>
            </div>
          )}
        </Card>

        <Field label="메모">
          <Textarea value={note} rows={2} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== h.note && void act("note", "hit.update", { patch: { note } })} placeholder="왜 눈여겨봤는지, 어디서 봤는지" />
        </Field>
      </div>
    </Dialog>
  );
}

export function AnalysisView({ a }: { a: NonNullable<HitDoc["analysis"]> }) {
  const row = (label: string, v: string | undefined) =>
    v ? (
      <div className="grid grid-cols-[96px_1fr] gap-3 py-1.5 text-nd-body">
        <span className="text-nd-fg-3">{label}</span>
        <span className="whitespace-pre-line">{v}</span>
      </div>
    ) : null;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-nd-section">{a.formatName}</span>
        <LangBadge dep={a.languageDependence} />
        <AiBadge level={a.aiFeasibility.level} />
        {a.risks.map((r) => (
          <Badge key={r} tone="warning" size="sm">{RISK_LABEL[r]}</Badge>
        ))}
      </div>
      <div className="divide-y divide-nd-line">
        {row("한 줄", a.summary)}
        {row("훅 (첫 2초)", a.hook)}
        {a.structure.length > 0 && row("흐름", a.structure.map((s, i) => `${i + 1}. ${s}`).join("  "))}
        {row("편집", a.editing)}
        {row("소리", a.sound)}
        {row("화면 글자", a.textOverlay)}
        {row("먹힌 이유 (가설)", a.whyItWorks)}
        {row("AI 로 쉬운 것", a.aiFeasibility.easyParts)}
        {row("AI 로 어려운 것", a.aiFeasibility.hardParts)}
        {row("주의", a.riskNote)}
        {a.brandIdeas.length > 0 && row("제품 접목", a.brandIdeas.map((s) => `· ${s}`).join("\n"))}
        {a.koreanQueries.length > 0 && row("국내 확인 검색어", a.koreanQueries.join(" / "))}
        {row("길이 · 컷", [a.totalSec ? `${a.totalSec}초` : "", a.cutCount ? `${a.cutCount}컷` : ""].filter(Boolean).join(" · ") || undefined)}
      </div>
      <p className="mt-2 text-nd-caption text-nd-fg-3">AI 가 영상을 보고 쓴 관찰 · 가설입니다 (사실 확인 아님) · {a.model} · {fmtUsd(a.costUsd)} · {fmtWhen(a.at)}</p>
    </div>
  );
}

function ManualNumbers({ hit: h, refresh }: { hit: WithId<HitDoc>; refresh: () => Promise<void> }) {
  const { run } = useAction();
  const [v, setV] = useState({ title: h.title, channel: h.channel, views: h.views.v === null ? "" : String(h.views.v), baseline: h.baseline.v === null ? "" : String(h.baseline.v) });
  const save = (patch: object) => run("manual", async () => {
    await scout("hit.update", { id: h.id, patch });
    await refresh();
  });
  return (
    <FormRow className="grid-cols-2 sm:grid-cols-4">
      <Field label="제목">
        <Input size="sm" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} onBlur={() => v.title !== h.title && void save({ title: v.title })} />
      </Field>
      <Field label="계정">
        <Input size="sm" value={v.channel} onChange={(e) => setV({ ...v, channel: e.target.value })} onBlur={() => v.channel !== h.channel && void save({ channel: v.channel })} />
      </Field>
      <Field label="조회수 (직접 봄)">
        <NumberInput size="sm" value={v.views} onValueChange={(raw) => setV({ ...v, views: raw })} onBlur={() => void save({ views: v.views === "" ? null : Number(v.views) })} />
      </Field>
      <Field label="그 계정 평소 조회수">
        <NumberInput size="sm" value={v.baseline} onValueChange={(raw) => setV({ ...v, baseline: raw })} onBlur={() => void save({ baseline: v.baseline === "" ? null : Number(v.baseline) })} />
      </Field>
    </FormRow>
  );
}

// ---- 영상 등록 ---------------------------------------------------------------

function AddHitDialog({ keyReady, refresh, onClose, onAdded }: { keyReady: boolean; refresh: () => Promise<void>; onClose: () => void; onAdded: (id: string) => void }) {
  const { busy, run } = useAction();
  const [f, setF] = useState({ url: "", country: "", title: "", channel: "", publishedAt: "", views: "", baseline: "", note: "" });
  const platform = platformFromUrl(f.url);
  const yt = platform === "youtube";
  const submit = () =>
    run(
      "add",
      async () => {
        const r = await scout<{ id: string }>("hit.add", {
          url: f.url,
          country: f.country,
          note: f.note,
          ...(yt ? {} : { title: f.title, channel: f.channel, publishedAt: f.publishedAt, views: f.views === "" ? null : Number(f.views), baseline: f.baseline === "" ? null : Number(f.baseline) }),
        });
        await refresh();
        onClose();
        onAdded(r.id);
      },
      yt ? "공식 API 로 조회수와 그 채널 평소 조회수를 받아 등록했습니다." : "등록했습니다.",
    );
  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      closeOnOverlay={false}
      title="영상 등록"
      description="YouTube 주소면 서버가 공식 API 로 숫자와 그 채널의 평소 조회수를 받습니다. 틱톡 · 더우인 · 샤오홍슈 · 인스타는 보고 적은 숫자를 넣으세요 (모르면 비워 두기)."
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>취소</Button>
          <Button size="sm" onClick={() => void submit()} disabled={!f.url.trim() || busy === "add" || (yt && !keyReady)}>등록</Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label={`주소${f.url ? ` · ${PLATFORM_LABEL[platform]}` : ""}`}>
          <Input size="sm" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://…" autoFocus />
        </Field>
        {yt && !keyReady && <InlineNotice tone="warning">YouTube 검색 키가 없어 YouTube 영상은 등록할 수 없습니다.</InlineNotice>}
        <FormRow className="grid-cols-1 sm:grid-cols-2">
          <Field label="나라 (어느 흐름인가)">
            <CountrySelect value={f.country} onChange={(v) => setF({ ...f, country: v })} />
          </Field>
          {!yt && (
            <Field label="올린 날">
              <Input size="sm" type="date" value={f.publishedAt} onChange={(e) => setF({ ...f, publishedAt: e.target.value })} />
            </Field>
          )}
        </FormRow>
        {!yt && f.url && (
          <>
            <FormRow className="grid-cols-1 sm:grid-cols-2">
              <Field label="제목 · 내용 한 줄">
                <Input size="sm" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
              </Field>
              <Field label="계정">
                <Input size="sm" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} />
              </Field>
            </FormRow>
            <FormRow className="grid-cols-1 sm:grid-cols-2">
              <Field label="조회수 · 좋아요 (본 숫자)">
                <NumberInput size="sm" value={f.views} onValueChange={(raw) => setF({ ...f, views: raw })} />
              </Field>
              <Field label="그 계정 평소 조회수 (어림)">
                <NumberInput size="sm" value={f.baseline} onValueChange={(raw) => setF({ ...f, baseline: raw })} />
              </Field>
            </FormRow>
          </>
        )}
        <Field label="메모">
          <Textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={`어디서 봤나 · 왜 눈여겨봤나${f.country ? ` (${countryLabel(f.country)})` : ""}`} />
        </Field>
      </div>
    </Dialog>
  );
}
