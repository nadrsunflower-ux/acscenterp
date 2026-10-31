"use client";

// 감시 채널 — 나라별로 지켜볼 YouTube 채널. 채널 찾기(검색 표본) · 직접 추가 · 훑기 · 정찰 설정
import { useMemo, useState } from "react";
import { ExternalLink, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Disclosure,
  EmptyState,
  Field,
  FormRow,
  Input,
  NumberInput,
  SectionHeader,
  Select,
  Switch,
  Table,
  TableScroll,
  Td,
  Th,
  Tr,
  useConfirm,
  useToast,
} from "@/components/neander/ui";
import { fmtWhen, useAction } from "@/components/neander/shorts/parts";
import { fmtCount } from "@/lib/neander/shorts/model";
import { COUNTRIES, DEFAULT_SCOUT_SETTINGS, countryLabel, languageOf, type ScoutSettings } from "@/lib/neander/shorts/scout";
import { CountrySelect, fmtAgo } from "./bits";
import { scout, type ScoutData } from "./useScout";

interface DiscoverGroup {
  channel: { channelId: string; handle: string; title: string; thumbnail: string; country: string; subscribers: number | null };
  videos: { id: string; url: string; title: string; views: number | null; publishedAt: string }[];
  watched: boolean;
}

export function ChannelsTab({ d, refresh }: { d: ScoutData; refresh: () => Promise<void> }) {
  const ask = useConfirm();
  const toast = useToast();
  const { busy, run } = useAction();
  const [add, setAdd] = useState({ ref: "", country: "US", topics: "" });
  const [disc, setDisc] = useState({ query: "", country: "US", days: 14 });
  const [groups, setGroups] = useState<DiscoverGroup[] | null>(null);
  const [filter, setFilter] = useState("");
  const keyReady = !!d.quotas.youtubeSearch.source;

  const byCountry = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of d.channels) if (c.active) m.set(c.country, (m.get(c.country) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [d.channels]);
  const rows = d.channels.filter((c) => !filter || c.country === filter);

  const addChannel = (ref: string, country: string, topics: string) =>
    run(
      `add-${ref}`,
      async () => {
        await scout("watch.add", { ref, country, language: languageOf(country), topics: topics.split(",").map((t) => t.trim()).filter(Boolean) });
        await refresh();
      },
      "감시 채널에 넣었습니다. 「훑기」 를 누르면 바로 평소 조회수와 터진 영상을 찾습니다.",
    );

  const discover = () =>
    run("discover", async () => {
      const r = await scout<{ groups: DiscoverGroup[] }>("watch.discover", { query: disc.query, regionCode: disc.country, language: languageOf(disc.country), days: disc.days });
      setGroups(r.groups);
    });

  const patch = (id: string, p: object) => run(`patch-${id}`, async () => {
    await scout("watch.update", { id, patch: p });
    await refresh();
  });

  return (
    <div className="space-y-6">

      <Card>
        <SectionHeader title="채널 찾기" hint={`검색 표본 · 1회 사용 · 오늘 ${d.quotas.youtubeSearch.used}/${d.quotas.youtubeSearch.limit}회`} />
        <p className="mb-3 text-nd-body text-nd-fg-2">
          그 나라 말로 분야를 검색해, 최근 조회수가 큰 쇼츠를 올린 채널을 묶어 보여 줍니다. 감시할 만한 채널을 골라 넣으세요. 검색 결과는 「관련도를 그 나라 쪽으로 기울인 표본」 이지 그 나라 전체 순위가 아닙니다.
        </p>
        <FormRow className="grid-cols-1 sm:grid-cols-[2fr_1.2fr_0.8fr_auto]">
          <Field label="검색어 (그 나라 말로)">
            <Input size="sm" value={disc.query} onChange={(e) => setDisc({ ...disc, query: e.target.value })} placeholder="예: satisfying product, 開封, 好物分享" onKeyDown={(e) => e.key === "Enter" && void discover()} />
          </Field>
          <Field label="나라">
            <CountrySelect value={disc.country} allowEmpty={false} onChange={(v) => setDisc({ ...disc, country: v })} />
          </Field>
          <Field label="최근">
            <Select size="sm" value={disc.days} onChange={(e) => setDisc({ ...disc, days: Number(e.target.value) })}>
              {[7, 14, 30].map((n) => (
                <option key={n} value={n}>{n}일</option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-nd-caption" aria-hidden>{" "}</span>
            <Button size="sm" icon={Search} onClick={() => void discover()} disabled={!keyReady || busy === "discover" || !disc.query.trim()}>찾기</Button>
          </div>
        </FormRow>
        {groups && (
          <div className="mt-4">
            {groups.length === 0 ? (
              <p className="text-nd-body text-nd-fg-3">표본에서 쇼츠를 찾지 못했습니다. 다른 말로 찾아 보세요.</p>
            ) : (
              <TableScroll>
                <Table minWidth={760}>
                  <thead>
                    <tr>
                      <Th>채널</Th>
                      <Th align="right">구독자</Th>
                      <Th>표본 속 대표 쇼츠</Th>
                      <Th align="right"> </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => (
                      <Tr key={g.channel.channelId}>
                        <Td>
                          <a href={`https://www.youtube.com/channel/${g.channel.channelId}`} target="_blank" rel="noreferrer" className="font-medium hover:underline">{g.channel.title}</a>
                          <span className="block text-nd-caption text-nd-fg-3">{g.channel.handle}{g.channel.country ? ` · 채널 표기 ${countryLabel(g.channel.country)}` : ""}</span>
                        </Td>
                        <Td num>{fmtCount(g.channel.subscribers)}</Td>
                        <Td className="max-w-[360px]">
                          <a href={g.videos[0].url} target="_blank" rel="noreferrer" className="line-clamp-1 hover:underline">{g.videos[0].title}</a>
                          <span className="text-nd-caption text-nd-fg-3">
                            조회 {fmtCount(g.videos[0].views)} · {fmtAgo(g.videos[0].publishedAt)}{g.videos.length > 1 ? ` · 표본에 ${g.videos.length}편` : ""}
                          </span>
                        </Td>
                        <Td align="right">
                          {g.watched ? (
                            <Badge tone="success" size="sm">감시 중</Badge>
                          ) : (
                            <Button size="sm" variant="secondary" icon={Plus} disabled={busy === `add-${g.channel.channelId}`} onClick={() => void addChannel(g.channel.channelId, disc.country, "").then(() => setGroups((gs) => gs?.map((x) => (x.channel.channelId === g.channel.channelId ? { ...x, watched: true } : x)) ?? null))}>
                              감시에 넣기
                            </Button>
                          )}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </TableScroll>
            )}
          </div>
        )}
      </Card>

      <Card>
        <SectionHeader title="직접 넣기" hint="채널 주소 · @핸들 · 그 채널 영상 주소" />
        <FormRow className="grid-cols-1 sm:grid-cols-[2.4fr_1.2fr_1.4fr_auto]">
          <Field label="채널">
            <Input size="sm" value={add.ref} onChange={(e) => setAdd({ ...add, ref: e.target.value })} placeholder="https://www.youtube.com/@… 또는 @핸들" />
          </Field>
          <Field label="어느 나라 흐름으로 볼까">
            <CountrySelect value={add.country} allowEmpty={false} onChange={(v) => setAdd({ ...add, country: v })} />
          </Field>
          <Field label="분야 (쉼표로)">
            <Input size="sm" value={add.topics} onChange={(e) => setAdd({ ...add, topics: e.target.value })} placeholder="뷰티, 음식, 코미디" />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-nd-caption" aria-hidden>{" "}</span>
            <Button size="sm" icon={Plus} disabled={!keyReady || !add.ref.trim() || busy === `add-${add.ref}`} onClick={() => void addChannel(add.ref, add.country, add.topics).then(() => setAdd({ ...add, ref: "" }))}>
              넣기
            </Button>
          </div>
        </FormRow>
      </Card>

      <div>
        <SectionHeader
          title="감시 중인 채널"
          hint={byCountry.length ? byCountry.map(([c, n]) => `${countryLabel(c)} ${n}`).join(" · ") : `${d.channels.length}곳`}
          action={
            <div className="flex items-center gap-2">
              <Select size="sm" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="나라 거르기">
                <option value="">모든 나라</option>
                {COUNTRIES.filter((c) => d.channels.some((x) => x.country === c.code)).map((c) => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </Select>
              <Button
                size="sm"
                variant="secondary"
                icon={RefreshCw}
                disabled={!keyReady || busy === "scan-all" || !d.channels.length}
                onClick={() =>
                  void run("scan-all", async () => {
                    const r = await scout<{ scanned: { created: number }[]; skipped: number; stoppedBy: string | null }>("watch.scan", { force: true });
                    await refresh();
                    const made = r.scanned.reduce((n, x) => n + x.created, 0);
                    return `${r.scanned.length}곳 훑음 · 새로 터진 영상 ${made}편${r.skipped ? ` · 시간이 모자라 ${r.skipped}곳은 다음에` : ""}`;
                  }).then((msg) => msg && toast.success(msg))
                }
              >
                모두 훑기
              </Button>
            </div>
          }
        />
        {rows.length === 0 ? (
          <EmptyState icon={Search} title="감시 중인 채널이 없습니다" description="위에서 나라별로 채널을 찾아 넣으세요. 나라마다 20~30곳이면 흐름이 보이기 시작합니다." />
        ) : (
          <Card padding="none">
            <TableScroll>
              <Table minWidth={1000}>
                <thead>
                  <tr>
                    <Th>채널</Th>
                    <Th>나라</Th>
                    <Th align="right">구독자</Th>
                    <Th align="right" title="최근 쇼츠(올린 지 7일 넘은 것) 조회수 중앙값">평소 조회수</Th>
                    <Th>마지막 훑기</Th>
                    <Th>켜기</Th>
                    <Th align="right"> </Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <Tr key={c.id}>
                      <Td className="max-w-[300px]">
                        <a href={`https://www.youtube.com/channel/${c.channelId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium hover:underline">
                          {c.title} <ExternalLink size={12} className="text-nd-fg-3" />
                        </a>
                        <span className="block text-nd-caption text-nd-fg-3">{[c.handle, c.topics.join(" · ")].filter(Boolean).join(" · ")}</span>
                      </Td>
                      <Td>
                        <CountrySelect value={c.country} onChange={(v) => void patch(c.id, { country: v, language: languageOf(v) })} />
                      </Td>
                      <Td num>{fmtCount(c.subscribers)}</Td>
                      <Td num title={c.scan.baselineBasis === "young" ? "7일 넘은 쇼츠가 모자라 어린 영상까지 넣은 값" : undefined}>
                        {fmtCount(c.scan.baseline)}
                        {c.scan.baselineBasis === "young" && <span className="ml-1 text-nd-caption text-nd-fg-3">어림</span>}
                      </Td>
                      <Td>
                        {c.scan.error ? (
                          <span className="text-nd-table text-nd-danger-text" title={c.scan.error}>실패 · {fmtWhen(c.scan.at)}</span>
                        ) : (
                          <span className="text-nd-table">{c.scan.at ? `${fmtWhen(c.scan.at)} · 쇼츠 ${c.scan.shortsSeen}편` : "아직"}</span>
                        )}
                      </Td>
                      <Td>
                        <Switch size="sm" checked={c.active} onChange={(v) => void patch(c.id, { active: v })} aria-label="훑기 켜기" />
                      </Td>
                      <Td align="right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={RefreshCw}
                            disabled={!keyReady || busy === `scan-${c.id}`}
                            onClick={() =>
                              void run(`scan-${c.id}`, async () => {
                                await scout("watch.scan", { id: c.id });
                                await refresh();
                              })
                            }
                          >
                            훑기
                          </Button>
                          {(c.owner === d.me || d.admin) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={Trash2}
                              aria-label="감시에서 빼기"
                              onClick={() =>
                                void (async () => {
                                  if (!(await ask({ title: "감시에서 뺄까요?", message: "이 채널에서 찾은 터진 영상과 형식 카드는 남습니다.", tone: "danger", confirmLabel: "빼기" }))) return;
                                  await run(`del-${c.id}`, () => scout("watch.delete", { id: c.id }));
                                  await refresh();
                                })()
                              }
                            />
                          )}
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          </Card>
        )}
      </div>

      <SettingsBox d={d} refresh={refresh} />
    </div>
  );
}

function SettingsBox({ d, refresh }: { d: ScoutData; refresh: () => Promise<void> }) {
  const { busy, run } = useAction();
  const [s, setS] = useState<ScoutSettings>(d.settings);
  const save = (next: ScoutSettings) =>
    run(
      "settings",
      async () => {
        setS(next);
        await scout("settings.save", { settings: next });
        await refresh();
      },
      "정찰 설정을 저장했습니다.",
    );
  return (
    <Disclosure
      title="정찰 설정 (회사 공용)"
      meta={`평소의 ${s.threshold}배 · ${fmtCount(s.minViews)}회 이상 · ${s.maxAgeDays}일 안 · 자동 분석 하루 ${s.autoAnalyzePerDay}편`}
    >
      <div className="space-y-3">
        <p className="text-nd-body text-nd-fg-2">
          터진 영상 = 올린 지 {s.maxAgeDays}일 안 · 조회수 {fmtCount(s.minViews)}회 이상 · 그 채널 평소의 {s.threshold}배 이상인 쇼츠(3분 이하). 평소 = 그 채널 최근 쇼츠 중 올린 지 7일 넘은 것 최대 30편의 조회수 중앙값.
          자동 분석은 매일 아침 새로 찾은 영상을 배수 큰 순으로 AI 가 직접 보고 형식을 뽑습니다 (한 편 약 10원 · 오늘 {d.quotas.autoAnalyzeToday}편 씀). 0 이면 끕니다.
        </p>
        <FormRow className="grid-cols-2 sm:grid-cols-4">
          <Field label="평소의 몇 배부터">
            <NumberInput size="sm" decimal value={s.threshold} onValueChange={(raw) => setS({ ...s, threshold: Number(raw) || DEFAULT_SCOUT_SETTINGS.threshold })} />
          </Field>
          <Field label="최소 조회수">
            <NumberInput size="sm" value={s.minViews} onValueChange={(raw) => setS({ ...s, minViews: Number(raw) || 0 })} />
          </Field>
          <Field label="올린 지 며칠 안">
            <NumberInput size="sm" value={s.maxAgeDays} onValueChange={(raw) => setS({ ...s, maxAgeDays: Number(raw) || DEFAULT_SCOUT_SETTINGS.maxAgeDays })} />
          </Field>
          <Field label="자동 분석 (하루 편수)">
            <NumberInput size="sm" value={s.autoAnalyzePerDay} onValueChange={(raw) => setS({ ...s, autoAnalyzePerDay: Number(raw) || 0 })} />
          </Field>
        </FormRow>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void save(s)} disabled={busy === "settings"}>저장</Button>
          <Button size="sm" variant="ghost" onClick={() => void save(DEFAULT_SCOUT_SETTINGS)}>기본값으로</Button>
        </div>
      </div>
    </Disclosure>
  );
}
