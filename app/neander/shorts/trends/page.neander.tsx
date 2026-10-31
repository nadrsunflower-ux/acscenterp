"use client";

// ============================================================
//  소재 발굴 — 국내외 검색 표본 비교 · 저장한 후보 · 반응 점수
// ------------------------------------------------------------
//  · 검색 표본은 YouTube Data API(서버 키)로만 자동 수집한다. Instagram · TikTok ·
//    샤오홍슈는 남의 게시물 검색 API 가 없어 링크 등록 · 직접 입력이다.
//  · 숫자마다 출처(공식 API · 직접 입력 · 추정)를 붙이고, 모르는 값은 비워 둔다.
//  · 국내에서 못 찾은 것은 「이 표본에서 못 찾음」 일 뿐 — 미확산을 단정하지 않는다.
//  · 점수 산식과 가중치를 화면에 보여 주고, 사람이 가중치를 바꾼다.
// ============================================================

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ExternalLink, Plus, Radar, RefreshCw, Search, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  Disclosure,
  EmptyState,
  Field,
  FormRow,
  InlineNotice,
  Input,
  NumberInput,
  PageHeader,
  PageShell,
  SectionHeader,
  Select,
  Table,
  TableScroll,
  Td,
  Textarea,
  Th,
  Tr,
  useConfirm,
} from "@/components/neander/ui";
import { isReadOnlyFor, useScoped, useShorts, type WithId } from "@/components/neander/shorts/ShortsProvider";
import { MeasuredInput, SampleTag, SourceTag, fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { mutate, shortsPost } from "@/lib/neander/shorts/client";
import {
  DEFAULT_WEIGHTS,
  INFO_REQUEST_KEYWORDS,
  METRIC_LABEL,
  PLATFORM_LABEL,
  PLATFORM_SUPPORT,
  domesticLabel,
  emptyDomestic,
  emptyMetrics,
  fmtCount,
  fmtPct,
  infoRequestRate,
  platformFromUrl,
  scoreTrend,
  viewVelocity,
} from "@/lib/neander/shorts/model";
import type { ScoreWeights, ShortsPlatform, TrendDoc, TrendMetricKey } from "@/lib/neander/shorts/types";

interface YtItem {
  id: string;
  url: string;
  title: string;
  channel: string;
  publishedAt: string;
  duration: number;
  views: number | null;
  likes: number | null;
  comments: number | null;
  thumbnail: string;
}

const REGIONS = [
  { code: "KR", lang: "ko", label: "국내 (KR · 한국어)" },
  { code: "US", lang: "en", label: "미국 (US · 영어)" },
  { code: "JP", lang: "ja", label: "일본 (JP · 일본어)" },
  { code: "TW", lang: "zh", label: "대만 (TW · 중국어)" },
  { code: "GB", lang: "en", label: "영국 (GB · 영어)" },
];

export default function TrendsPage() {
  const { data, refresh, nameOf } = useShorts();
  const d = data!;
  const sc = useScoped();
  const router = useRouter();
  const ask = useConfirm();
  const { busy, run } = useAction();
  const [editing, setEditing] = useState<WithId<TrendDoc> | "new" | null>(null);
  const [weights, setWeights] = useState<ScoreWeights>(d.weights);
  const [sort, setSort] = useState<"score" | "velocity" | "recent">("score");

  const rows = useMemo(() => {
    const list = sc.trends.map((t) => ({ t, s: scoreTrend(t, weights), v: viewVelocity(t), info: infoRequestRate(t.infoSample) }));
    return list.sort((a, b) =>
      sort === "score" ? (b.s.score ?? -1) - (a.s.score ?? -1) : sort === "velocity" ? (b.v.perDay ?? -1) - (a.v.perDay ?? -1) : b.t.updatedAt - a.t.updatedAt,
    );
  }, [sc.trends, weights, sort]);

  const saveWeights = (w: ScoreWeights) => run("weights", async () => {
    setWeights(w);
    await mutate("weights.save", { weights: w });
  });

  return (
    <PageShell>
      <PageHeader
        title="소재 발굴"
        description="국내에서 반응이 좋은 소재, 해외에서 반응이 크지만 국내 검색 표본에서 아직 보이지 않는 상품 후보를 모읍니다."
        actions={<Button icon={Plus} onClick={() => setEditing("new")}>직접 등록</Button>}
      />

      <SearchCompare quota={d.quotas.youtubeSearch} configured={!!d.quotas.youtubeSearch.source} onSaved={refresh} />

      <Disclosure
        className="mb-4"
        title="반응 점수 산식과 가중치"
        meta={`좋아요 ${weights.likes} · 댓글 ${weights.comments} · 저장 ${weights.saves} · 공유 ${weights.shares} · 정보 요청 ${weights.infoRequests}`}
      >
        <div className="space-y-3">
          <p className="text-nd-body text-nd-fg-2">
            반응 점수 = Σ(가중치 × 조회 1,000회당 지표) ÷ Σ(쓴 가중치). 모르는 지표(비공개 저장 수 등)는 0 으로 넣지 않고 빼며, 그 가중치도 함께 뺍니다. 정보 요청은 댓글 표본이 있으면 「댓글 수 × 표본에서 정보 요청 댓글의 비율」 로 추정합니다(출처 「추정」).
          </p>
          <FormRow className="grid-cols-2 sm:grid-cols-5">
            {(Object.keys(DEFAULT_WEIGHTS) as (keyof ScoreWeights)[]).map((k) => (
              <Field key={k} label={METRIC_LABEL[k]}>
                <NumberInput size="sm" decimal value={weights[k]} onValueChange={(raw) => setWeights({ ...weights, [k]: Math.min(20, Math.max(0, Number(raw) || 0)) })} />
              </Field>
            ))}
          </FormRow>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void saveWeights(weights)} disabled={busy === "weights"}>내 가중치로 저장</Button>
            <Button size="sm" variant="ghost" onClick={() => void saveWeights(DEFAULT_WEIGHTS)}>기본값으로</Button>
          </div>
        </div>
      </Disclosure>

      <SectionHeader
        title="저장한 소재"
        hint={`${sc.trends.length}건`}
        action={
          <Select size="sm" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="정렬">
            <option value="score">반응 점수 순</option>
            <option value="velocity">증가 속도 순</option>
            <option value="recent">최근 수정 순</option>
          </Select>
        }
      />
      {rows.length === 0 ? (
        <EmptyState icon={Radar} title="저장한 소재가 없습니다" description="위 검색 표본에서 골라 저장하거나, 샤오홍슈 · Instagram 링크를 직접 등록하세요." />
      ) : (
        <Card padding="none">
          <TableScroll>
            <Table minWidth={980}>
              <thead>
                <tr>
                  <Th>소재 · 상품</Th>
                  <Th>플랫폼 · 국가</Th>
                  <Th align="right">조회</Th>
                  <Th align="right">증가 속도</Th>
                  <Th align="right">반응 점수</Th>
                  <Th align="right">정보 요청률</Th>
                  <Th>국내 유사 콘텐츠</Th>
                  <Th align="right"> </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ t, s, v, info }) => {
                  const dom = domesticLabel(t.domestic);
                  return (
                    <Tr key={t.id}>
                      <Td className="max-w-[320px]">
                        <button type="button" className="block w-full text-left" onClick={() => setEditing(t)}>
                          <span className="line-clamp-1 font-medium hover:underline">{t.product || t.title || t.url}</span>
                          <span className="line-clamp-1 text-nd-caption text-nd-fg-3">{t.owner !== d.me ? `${nameOf(t.owner)} · ` : ""}{t.title}{t.channel ? ` · ${t.channel}` : ""}</span>
                        </button>
                        {t.sample && <SampleTag />}
                      </Td>
                      <Td>
                        {PLATFORM_LABEL[t.platform]}
                        {t.country && <span className="ml-1 text-nd-caption text-nd-fg-3">{t.country}</span>}
                      </Td>
                      <Td num>
                        <span className="inline-flex items-center gap-1.5">{fmtCount(t.metrics.views.v)} <SourceTag src={t.metrics.views.src} title={t.metrics.views.ref} /></span>
                      </Td>
                      <Td num title={v.label}>{v.perDay === null ? "—" : `${fmtCount(Math.round(v.perDay))}/일`}{v.basis === "since_publish" && <span className="ml-1 text-nd-micro text-nd-fg-3">평균</span>}</Td>
                      <Td num title={`${s.formula}${s.missing.length ? ` · 빠진 지표: ${s.missing.map((k) => METRIC_LABEL[k]).join(", ")}` : ""}`}>
                        {s.score === null ? "—" : s.score.toFixed(1)}
                        {s.missing.length > 0 && s.score !== null && <span className="ml-1 text-nd-micro text-nd-fg-3">({s.used.length}개 지표)</span>}
                      </Td>
                      <Td num title={t.infoSample.sampled ? `댓글 ${t.infoSample.sampled}개 표본 중 ${t.infoSample.matched}개` : "댓글 표본 없음"}>{fmtPct(info, 1)}</Td>
                      <Td><Badge tone={dom.tone === "success" ? "success" : dom.tone === "info" ? "info" : "neutral"} size="sm">{dom.text.length > 26 ? dom.text.slice(0, 26) + "…" : dom.text}</Badge></Td>
                      <Td align="right">
                        {isReadOnlyFor(t, d.me) ? (
                          <span className="text-nd-caption text-nd-fg-3">읽기 전용</span>
                        ) : t.projectId ? (
                          <Button size="sm" variant="ghost" trailingIcon={ArrowRight} onClick={() => router.push(`/neander/shorts/projects/${t.projectId}`)}>영상</Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy === `p-${t.id}`}
                            onClick={() =>
                              void run(`p-${t.id}`, async () => {
                                const r = await mutate<{ id: string }>("trend.toProject", { id: t.id, visibility: t.visibility });
                                await refresh();
                                router.push(`/neander/shorts/projects/${r.id}`);
                              })
                            }
                          >
                            영상 만들기
                          </Button>
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

      {editing && (
        <TrendEditor
          trend={editing === "new" ? null : editing}
          readOnly={editing !== "new" && isReadOnlyFor(editing, d.me)}
          youtubeReady={!!d.quotas.youtubeSearch.source}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await refresh();
          }}
          onDelete={
            editing !== "new" && editing.owner === d.me
              ? async () => {
                  if (!(await ask({ title: "소재를 지울까요?", message: "영상으로 만든 경우 영상은 남습니다.", tone: "danger", confirmLabel: "지우기" }))) return;
                  await run("del", () => mutate("trend.delete", { id: editing.id }));
                  setEditing(null);
                  await refresh();
                }
              : undefined
          }
        />
      )}
    </PageShell>
  );
}

// ---- 검색 표본 비교 ---------------------------------------------------------

function SearchCompare({ quota, configured, onSaved }: { quota: { used: number; limit: number; source: "personal" | "company" | null }; configured: boolean; onSaved: () => Promise<void> }) {
  const { busy, run } = useAction();
  const [query, setQuery] = useState("");
  const [abroad, setAbroad] = useState({ query: "", region: "US" });
  const [days, setDays] = useState(30);
  const [res, setRes] = useState<{ kr: YtItem[] | null; ab: YtItem[] | null; at: number | null }>({ kr: null, ab: null, at: null });
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [product, setProduct] = useState("");
  const region = REGIONS.find((r) => r.code === abroad.region) ?? REGIONS[1];

  const search = () =>
    run("search", async () => {
      const [kr, ab] = await Promise.all([
        query.trim() ? shortsPost<{ items: YtItem[] }>("research", { action: "yt.search", query, regionCode: "KR", language: "ko", days }) : Promise.resolve(null),
        (abroad.query || query).trim() ? shortsPost<{ items: YtItem[] }>("research", { action: "yt.search", query: abroad.query || query, regionCode: region.code, language: region.lang, days }) : Promise.resolve(null),
      ]);
      setRes({ kr: kr?.items ?? null, ab: ab?.items ?? null, at: Date.now() });
      setPick(new Set());
      if (!product) setProduct(query);
    });

  const save = (side: "kr" | "ab") =>
    run(
      "save",
      async () => {
        const ids = (res[side] ?? []).filter((i) => pick.has(i.id)).map((i) => i.id);
        if (!ids.length) throw new Error("저장할 영상을 골라 주세요.");
        await shortsPost("research", {
          action: "yt.saveTrend",
          videoIds: ids,
          product,
          searchContext: side === "kr" ? { query, regionCode: "KR", language: "ko" } : { query: abroad.query || query, regionCode: region.code, language: region.lang },
        });
        setPick(new Set());
        await onSaved();
      },
      "소재로 저장했습니다 (서버가 공식 API 로 다시 받아 적었습니다).",
    );

  return (
    <Card className="mb-6">
      <SectionHeader
        title="검색 표본 비교 (YouTube Data API)"
        hint={configured ? `${quota.source === "personal" ? "내 키" : "회사 키"} · 오늘 ${quota.used}/${quota.limit}회` : "검색 키 없음"}
      />
      {!configured ? (
        <InlineNotice tone="warning">
          YouTube 검색 키가 없어 자동 검색을 쓸 수 없습니다 — 내 채널·연결에서 내 검색 키를 넣거나 회사 키(NEANDER_SHORTS_YOUTUBE_API_KEY)를 설정하세요. 그 전에는 「직접 등록」 으로 링크와 숫자를 적어 주세요.
        </InlineNotice>
      ) : (
        <>
          <FormRow className="grid-cols-1 sm:grid-cols-[2fr_2fr_1.4fr_0.8fr_auto]">
            <Field label="국내 검색어 (한국어)">
              <Input size="sm" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="예: 접이식 선반" onKeyDown={(e) => e.key === "Enter" && void search()} />
            </Field>
            <Field label="해외 검색어 (비우면 같은 말)">
              <Input size="sm" value={abroad.query} onChange={(e) => setAbroad({ ...abroad, query: e.target.value })} placeholder="예: folding kitchen rack" />
            </Field>
            <Field label="해외 지역 · 언어">
              <Select size="sm" value={abroad.region} onChange={(e) => setAbroad({ ...abroad, region: e.target.value })}>
                {REGIONS.slice(1).map((r) => (
                  <option key={r.code} value={r.code}>{r.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="최근">
              <Select size="sm" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {[7, 30, 90].map((n) => (
                  <option key={n} value={n}>{n}일</option>
                ))}
              </Select>
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-nd-caption" aria-hidden>{" "}</span>
              <Button size="sm" icon={Search} onClick={() => void search()} disabled={busy === "search" || !(query || abroad.query).trim()}>
                검색 (2회 사용)
              </Button>
            </div>
          </FormRow>
          <p className="mt-2 text-nd-caption text-nd-fg-3">
            표본일 뿐입니다 — 지역 · 언어는 관련도를 기울일 뿐 그 나라 전체 시장이 아니고, 「짧은 영상」 은 4분 미만이라는 뜻이지 Shorts 라는 보장이 아닙니다. 검색 결과는 저장하지 않으며, 고른 영상만 서버가 다시 받아 소재로 적습니다.
          </p>
          {res.at && (
            <>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <ResultColumn title="국내 표본 (KR)" items={res.kr} pick={pick} setPick={setPick} />
                <ResultColumn title={`해외 표본 (${region.code})`} items={res.ab} pick={pick} setPick={setPick} />
              </div>
              <FormRow className="mt-4 grid-cols-1 sm:grid-cols-[2fr_auto_auto]">
                <Field label="저장할 때 붙일 상품명">
                  <Input size="sm" value={product} onChange={(e) => setProduct(e.target.value)} />
                </Field>
                <div className="flex flex-col gap-1.5">
                  <span className="text-nd-caption" aria-hidden>{" "}</span>
                  <Button size="sm" variant="secondary" disabled={busy === "save" || !pick.size} onClick={() => void save("kr")}>국내에서 고른 것 저장</Button>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-nd-caption" aria-hidden>{" "}</span>
                  <Button size="sm" disabled={busy === "save" || !pick.size} onClick={() => void save("ab")}>해외에서 고른 것 저장</Button>
                </div>
              </FormRow>
            </>
          )}
        </>
      )}
    </Card>
  );
}

function ResultColumn({ title, items, pick, setPick }: { title: string; items: YtItem[] | null; pick: Set<string>; setPick: (s: Set<string>) => void }) {
  if (items === null) return <div className="rounded-nd-md border border-dashed border-nd-strong p-4 text-nd-caption text-nd-fg-3">{title}: 검색어 없음</div>;
  const total = items.reduce((n, i) => n + (i.views ?? 0), 0);
  return (
    <div>
      <p className="mb-2 text-nd-caption font-medium text-nd-fg-2">
        {title} · {items.length}건 · 조회 합 {fmtCount(total)}
      </p>
      {items.length === 0 ? (
        <p className="rounded-nd-md bg-nd-fg/[.04] p-3 text-nd-caption text-nd-fg-3">이 표본에서는 영상을 찾지 못했습니다 (없다는 뜻은 아닙니다).</p>
      ) : (
        <ul className="nd-scroll max-h-[420px] divide-y divide-nd-line overflow-y-auto rounded-nd-md border border-nd-line">
          {items.map((i) => (
            <li key={i.id} className="flex items-start gap-2.5 px-3 py-2">
              <Checkbox
                className="mt-1"
                checked={pick.has(i.id)}
                aria-label={`${i.title} 선택`}
                onChange={(e) => {
                  const n = new Set(pick);
                  if (e.target.checked) n.add(i.id);
                  else n.delete(i.id);
                  setPick(n);
                }}
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={i.thumbnail} alt="" className="h-12 w-20 shrink-0 rounded object-cover" loading="lazy" />
              <div className="min-w-0 flex-1">
                <a href={i.url} target="_blank" rel="noreferrer" className="line-clamp-2 text-nd-body hover:underline">{i.title}</a>
                <p className="text-nd-caption text-nd-fg-3">
                  {i.channel} · {i.publishedAt.slice(0, 10)} · {Math.round(i.duration)}초
                </p>
                <p className="text-nd-caption text-nd-fg-2">
                  조회 {fmtCount(i.views)} · 좋아요 {i.likes === null ? "비공개" : fmtCount(i.likes)} · 댓글 {i.comments === null ? "꺼짐" : fmtCount(i.comments)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- 소재 한 건 편집 ---------------------------------------------------------

function blankTrend(): Omit<TrendDoc, "owner" | "createdAt" | "updatedAt" | "updatedBy"> {
  return {
    visibility: "private",
    platform: "xiaohongshu",
    url: "",
    externalId: null,
    channel: "",
    title: "",
    publishedAt: null,
    collectedAt: Date.now(),
    collectedBy: "manual",
    searchContext: null,
    product: "",
    category: "",
    country: "",
    language: "",
    identification: { status: "unconfirmed", evidence: "" },
    metrics: emptyMetrics(),
    viewHistory: [],
    infoSample: { sampled: null, matched: null, keywords: INFO_REQUEST_KEYWORDS, src: "manual" },
    domestic: emptyDomestic(),
    tags: [],
    notes: "",
    projectId: null,
    sample: false,
  };
}

function TrendEditor({
  trend,
  readOnly = false,
  youtubeReady,
  onClose,
  onSaved,
  onDelete,
}: {
  trend: WithId<TrendDoc> | null;
  readOnly?: boolean;
  youtubeReady: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const { busy, run } = useAction();
  const [t, setT] = useState<ReturnType<typeof blankTrend> & { id?: string }>(() => (trend ? structuredClone(trend) : blankTrend()));
  const [domResults, setDomResults] = useState<YtItem[] | null>(null);
  const [domPick, setDomPick] = useState<Set<string>>(new Set());
  const set = (patch: Partial<typeof t>) => setT((x) => ({ ...x, ...patch }));
  const support = PLATFORM_SUPPORT[t.platform];
  const metricKeys: TrendMetricKey[] = ["views", "likes", "comments", "saves", "shares", "infoRequests"];
  const isYt = trend?.platform === "youtube" && !!trend.externalId;

  const save = () =>
    run(
      "save",
      async () => {
        await mutate("trend.save", { id: trend?.id, trend: t });
        await onSaved();
        onClose();
      },
      "저장했습니다.",
    );

  const serverAction = (key: string, body: object, ok: string) =>
    run(
      key,
      async () => {
        // 화면에서 고친 것을 먼저 저장하고 서버 동작을 부른다 (서버가 최신 문서 위에 적도록)
        if (trend) await mutate("trend.save", { id: trend.id, trend: t });
        const r = await shortsPost<Record<string, unknown>>("research", body);
        await onSaved();
        return r;
      },
      ok,
    );

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      closeOnOverlay={false}
      title={trend ? "소재 상세" : "소재 직접 등록"}
      description={trend ? `${trend.collectedBy === "youtube_api" ? "YouTube Data API 로 수집" : "직접 등록"} · ${fmtWhen(trend.collectedAt)}` : "자동 수집이 없는 플랫폼은 링크와 숫자를 직접 적습니다. 모르는 숫자는 비워 두세요."}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          {onDelete ? <Button variant="ghost" icon={Trash2} onClick={() => void onDelete()}>지우기</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>닫기</Button>
            <Button onClick={() => void save()} disabled={busy === "save" || readOnly}>{readOnly ? "읽기 전용" : "저장"}</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <FormRow className="grid-cols-1 sm:grid-cols-[2fr_1fr]">
          <Field label="원본 URL">
            <Input value={t.url} onChange={(e) => set({ url: e.target.value, platform: e.target.value ? platformFromUrl(e.target.value) : t.platform })} disabled={isYt} placeholder="https://www.xiaohongshu.com/explore/…" />
          </Field>
          <Field label="플랫폼" hint={support.search === "api" ? "공식 API 수집 가능" : "링크 등록 · 직접 입력"}>
            <Select value={t.platform} onChange={(e) => set({ platform: e.target.value as ShortsPlatform })} disabled={isYt}>
              {(Object.keys(PLATFORM_LABEL) as ShortsPlatform[]).map((p) => (
                <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>
              ))}
            </Select>
          </Field>
        </FormRow>
        <p className="-mt-3 text-nd-caption text-nd-fg-3">{support.note}</p>
        <FormRow className="grid-cols-1 sm:grid-cols-3">
          <Field label="채널 · 제작자"><Input value={t.channel} onChange={(e) => set({ channel: e.target.value })} disabled={isYt} /></Field>
          <Field label="게시일"><Input type="date" value={t.publishedAt?.slice(0, 10) ?? ""} onChange={(e) => set({ publishedAt: e.target.value ? new Date(e.target.value).toISOString() : null })} disabled={isYt} /></Field>
          <Field label="공개 범위">
            <Select value={t.visibility} onChange={(e) => set({ visibility: e.target.value as "private" | "team" })} disabled={!!trend && trend.owner !== undefined && false}>
              <option value="private">나만 보기</option>
              <option value="team">팀 보기</option>
            </Select>
          </Field>
        </FormRow>
        <Field label="영상 제목"><Input value={t.title} onChange={(e) => set({ title: e.target.value })} disabled={isYt} /></Field>
        <FormRow className="grid-cols-1 sm:grid-cols-4">
          <Field label="상품"><Input value={t.product} onChange={(e) => set({ product: e.target.value })} /></Field>
          <Field label="카테고리"><Input value={t.category} onChange={(e) => set({ category: e.target.value })} placeholder="주방 · 수납 …" /></Field>
          <Field label="국가"><Input value={t.country} onChange={(e) => set({ country: e.target.value.toUpperCase().slice(0, 2) })} placeholder="CN · US · KR" /></Field>
          <Field label="언어"><Input value={t.language} onChange={(e) => set({ language: e.target.value.toLowerCase().slice(0, 5) })} placeholder="zh · en · ko" /></Field>
        </FormRow>
        <FormRow className="grid-cols-1 sm:grid-cols-[1fr_2fr]">
          <Field label="상품 확인">
            <Select value={t.identification.status} onChange={(e) => set({ identification: { ...t.identification, status: e.target.value as TrendDoc["identification"]["status"] } })}>
              <option value="unconfirmed">확인 전</option>
              <option value="likely">추정 (근거 있음)</option>
              <option value="confirmed">확인함</option>
            </Select>
          </Field>
          <Field label="확인 근거" hint="영상 속 로고 · 판매 링크 · 댓글 답변 등">
            <Input value={t.identification.evidence} onChange={(e) => set({ identification: { ...t.identification, evidence: e.target.value } })} />
          </Field>
        </FormRow>

        <div>
          <SectionHeader as="h3" title="반응 지표" hint="비우면 모름 · 공개되지 않은 저장 · DM 수는 비워 둡니다" action={isYt && youtubeReady ? <Button size="sm" variant="ghost" icon={RefreshCw} disabled={busy === "refresh"} onClick={() => void serverAction("refresh", { action: "yt.refreshTrend", trendId: trend!.id }, "공식 API 로 다시 모았습니다.")}>다시 모으기</Button> : undefined} />
          <div className="grid gap-3 sm:grid-cols-3">
            {metricKeys.map((k) => (
              <Field key={k} label={METRIC_LABEL[k]}>
                <MeasuredInput ariaLabel={METRIC_LABEL[k]} value={t.metrics[k]} onChange={(m) => set({ metrics: { ...t.metrics, [k]: m } })} />
              </Field>
            ))}
          </div>
          {trend && trend.viewHistory.length > 1 && (
            <p className="mt-2 text-nd-caption text-nd-fg-3">조회수 기록 {trend.viewHistory.length}번 · {viewVelocity(trend).label}</p>
          )}
        </div>

        <div>
          <SectionHeader
            as="h3"
            title="정보 요청 댓글 표본"
            hint="제품 정보 · 구매처 · 링크 · DM 을 묻는 댓글"
            action={isYt && youtubeReady ? <Button size="sm" variant="ghost" disabled={busy === "cs"} onClick={() => void serverAction("cs", { action: "yt.commentSample", trendId: trend!.id, keywords: t.infoSample.keywords }, "댓글 100개 표본을 셌습니다.")}>공식 API 로 댓글 100개 세기</Button> : undefined}
          />
          <FormRow className="grid-cols-2 sm:grid-cols-[1fr_1fr_3fr]">
            <Field label="읽은 댓글"><NumberInput size="sm" value={t.infoSample.sampled} placeholder="모름" onValueChange={(r) => set({ infoSample: { ...t.infoSample, sampled: r === "" ? null : Number(r), src: "manual" } })} /></Field>
            <Field label="정보 요청 댓글"><NumberInput size="sm" value={t.infoSample.matched} placeholder="모름" onValueChange={(r) => set({ infoSample: { ...t.infoSample, matched: r === "" ? null : Number(r), src: "manual" } })} /></Field>
            <Field label="센 낱말 (쉼표)"><Input size="sm" value={t.infoSample.keywords.join(", ")} onChange={(e) => set({ infoSample: { ...t.infoSample, keywords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } })} /></Field>
          </FormRow>
          <p className="mt-1 flex items-center gap-2 text-nd-caption text-nd-fg-3">
            비율 {fmtPct(infoRequestRate(t.infoSample), 1)} <SourceTag src={t.infoSample.src} />
          </p>
        </div>

        {trend && (
          <div>
            <SectionHeader as="h3" title="국내 유사 콘텐츠" hint={domesticLabel(t.domestic).text} />
            {youtubeReady && (
              <div className="mb-3 flex flex-wrap items-end gap-2">
                <Field label="국내 검색어" className="min-w-[220px] flex-1">
                  <Input size="sm" value={t.domestic.query || t.product} onChange={(e) => set({ domestic: { ...t.domestic, query: e.target.value } })} />
                </Field>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={Search}
                  disabled={busy === "dom"}
                  onClick={() =>
                    void run("dom", async () => {
                      const r = await shortsPost<{ items: YtItem[] }>("research", { action: "domestic.search", trendId: trend.id, query: t.domestic.query || t.product });
                      setDomResults(r.items);
                      setDomPick(new Set());
                    })
                  }
                >
                  YouTube 국내 표본 검색
                </Button>
              </div>
            )}
            {domResults && (
              <div className="mb-3 space-y-2">
                <p className="text-nd-caption text-nd-fg-3">표본 {domResults.length}건 중 같은 · 비슷한 상품을 다룬 영상만 고르세요. 아무것도 안 고르면 「이 표본에서 못 찾음」 으로 기록됩니다.</p>
                <ul className="nd-scroll max-h-60 divide-y divide-nd-line overflow-y-auto rounded-nd-md border border-nd-line">
                  {domResults.map((i) => (
                    <li key={i.id} className="flex items-center gap-2 px-3 py-1.5 text-nd-body">
                      <Checkbox checked={domPick.has(i.id)} aria-label={`${i.title} 유사`} onChange={(e) => { const n = new Set(domPick); if (e.target.checked) n.add(i.id); else n.delete(i.id); setDomPick(n); }} />
                      <a href={i.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">{i.title}</a>
                      <span className="text-nd-caption text-nd-fg-3">{fmtCount(i.views)}</span>
                    </li>
                  ))}
                </ul>
                <Button size="sm" onClick={() => void serverAction("mark", { action: "domestic.mark", trendId: trend.id, videoIds: [...domPick] }, "국내 확인을 기록했습니다.").then(() => setDomResults(null))}>
                  고른 {domPick.size}건으로 기록
                </Button>
              </div>
            )}
            {!domResults && (
              <FormRow className="grid-cols-1 sm:grid-cols-[1fr_1fr_2fr]">
                <Field label="직접 확인 결과">
                  <Select value={t.domestic.method === "api" ? "api" : t.domestic.status} disabled={t.domestic.method === "api"} onChange={(e) => set({ domestic: { ...t.domestic, status: e.target.value as TrendDoc["domestic"]["status"] } })}>
                    <option value="unchecked">확인 전</option>
                    <option value="found">유사 콘텐츠 있음</option>
                    <option value="none_in_sample">찾아본 범위에서 없음</option>
                    {t.domestic.method === "api" && <option value="api">API 표본으로 기록됨</option>}
                  </Select>
                </Field>
                <Field label="찾아본 수"><NumberInput size="sm" value={t.domestic.sampleSize} disabled={t.domestic.method === "api"} onValueChange={(r) => set({ domestic: { ...t.domestic, sampleSize: r === "" ? null : Number(r) } })} /></Field>
                <Field label="메모 (어디서 · 어떻게 찾았나)"><Input size="sm" value={t.domestic.note} onChange={(e) => set({ domestic: { ...t.domestic, note: e.target.value } })} /></Field>
              </FormRow>
            )}
            {t.domestic.matches.length > 0 && (
              <ul className="mt-2 space-y-1 text-nd-caption">
                {t.domestic.matches.map((m) => (
                  <li key={m.url} className="flex items-center gap-2">
                    <a href={m.url} target="_blank" rel="noreferrer" className="truncate hover:underline">{m.title || m.url}</a>
                    <span className="text-nd-fg-3">{fmtCount(m.views)}</span>
                    <SourceTag src={m.src} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <Field label="메모"><Textarea rows={3} value={t.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        {t.url && (
          <a href={t.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-nd-caption text-nd-accent">
            원본 열기 <ExternalLink size={12} />
          </a>
        )}
      </div>
    </Dialog>
  );
}
