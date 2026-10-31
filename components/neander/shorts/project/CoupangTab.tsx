"use client";

// ============================================================
//  쿠팡 확인 탭 — 비슷한 후보와 「동일 상품으로 확인한 결과」 를 나눈다
// ------------------------------------------------------------
//  · 파트너스 API 권한이 있으면 검색 결과를 보여 주되 저장하지 않는다 (Open API
//    약관 제5조). 「후보로」 를 누르면 상품 주소 · 이름만 남는다.
//  · 가격 · 판매 상태는 사람이 쿠팡에서 직접 보고 적는다 (확인 시점이 함께 남는다).
//  · 「동일 상품」 은 사람이 대조 항목을 보고 고르는 것이다. 누가 언제 확인했는지
//    서버가 찍고, 화면은 「사람이 확인함」 으로 표시한다 — 자동 검증이 아니다.
// ============================================================

import { useState } from "react";
import { BadgeCheck, ExternalLink, Link2, Plus, Search, ShoppingCart, Trash2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, FormRow, InlineNotice, Input, NumberInput, SectionHeader, Select, Textarea } from "@/components/neander/ui";
import { shortsPost } from "@/lib/neander/shorts/client";
import { confirmedCandidate, coupangProductId, coupangSearchUrl, isCoupangAffiliateUrl, isCoupangProductUrl, matchChecksSummary, newId } from "@/lib/neander/shorts/model";
import type { CoupangCandidate, MatchCheckKey, ProjectDoc } from "@/lib/neander/shorts/types";
import { useShorts, type WithId } from "../ShortsProvider";
import { fmtWhen, useAction } from "../parts";
import type { Draft } from "../useProjectDraft";

const CHECK_LABEL: Record<MatchCheckKey, string> = { brand: "브랜드", model: "모델", size: "크기", material: "재질", options: "옵션", appearance: "외형" };

interface ApiItem {
  productId: string;
  productName: string;
  productPrice: number | null;
  productImage: string;
  productUrl: string;
  isRocket: boolean;
}

export function CoupangTab({ draft }: { draft: Draft }) {
  const { p, update, flush, replace } = draft;
  const { data } = useShorts();
  const { busy, run } = useAction();
  // 검색은 내 키, 없으면 회사 공용 키 (결과를 저장하지 않으니 누구 키든 같다)
  const myProfile = data!.profiles.find((x) => x.owner === data!.me);
  const apiReady = !!myProfile?.coupang.configured || data!.status.companyCoupang.configured;
  const [kw, setKw] = useState(p.product);
  const [items, setItems] = useState<ApiItem[] | null>(null);
  const confirmed = confirmedCandidate(p);

  const addManual = () =>
    update((x) =>
      void x.coupang.candidates.push({
        id: newId("cp_"),
        url: "",
        productId: null,
        name: "",
        brand: "",
        model: "",
        size: "",
        material: "",
        spec: "",
        options: "",
        price: null,
        saleStatus: "unknown",
        checkedAt: Date.now(),
        source: "manual",
        comparison: "",
        match: "candidate",
        checks: { brand: null, model: null, size: null, material: null, options: null, appearance: null },
        confirmedBy: null,
        confirmedAt: null,
      }),
    );

  return (
    <div className="space-y-8">
      <section>
        <SectionHeader title="쿠팡에서 찾기" hint={apiReady ? `파트너스 API (${myProfile?.coupang.configured ? "내 키" : "회사 공용 키"}) · 결과는 저장하지 않습니다` : "API 키 없음 — 직접 검색"} />
        <Card className="space-y-3">
          <FormRow className="grid-cols-1 sm:grid-cols-[2fr_auto_auto]">
            <Field label="검색어"><Input size="sm" value={kw} onChange={(e) => setKw(e.target.value)} /></Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-nd-caption" aria-hidden>{" "}</span>
              <a href={coupangSearchUrl(kw || p.product)} target="_blank" rel="noreferrer">
                <Button size="sm" variant="secondary" trailingIcon={ExternalLink} disabled={!(kw || p.product).trim()}>쿠팡에서 직접 검색</Button>
              </a>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-nd-caption" aria-hidden>{" "}</span>
              <Button
                size="sm"
                icon={Search}
                disabled={!apiReady || busy === "s" || !kw.trim()}
                onClick={() => void run("s", async () => setItems((await shortsPost<{ items: ApiItem[] }>("research", { action: "coupang.search", keyword: kw })).items))}
              >
                API 검색
              </Button>
            </div>
          </FormRow>
          {!apiReady && (
            <InlineNotice tone="neutral">
              쿠팡 파트너스 Open API 는 최종 승인된 회원만 키를 받습니다. 내 채널·연결 화면에서 내 파트너스 키를 넣거나, 쿠팡에서 직접 찾아 「직접 추가」 로 적으세요. 검색은 키마다 분당 30회에서 멈춥니다 (쿠팡 한도 분당 50회 · 넘으면 하루 동안 막힘).
            </InlineNotice>
          )}
          {items && (
            <ul className="divide-y divide-nd-line rounded-nd-md border border-nd-line">
              {items.length === 0 && <li className="p-3 text-nd-body text-nd-fg-3">검색 결과가 없습니다 (품절 상품은 API 결과에 나오지 않습니다).</li>}
              {items.map((i) => (
                <li key={i.productId} className="flex items-center gap-3 px-3 py-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={i.productImage} alt="" className="h-12 w-12 rounded object-cover" loading="lazy" />
                  <div className="min-w-0 flex-1">
                    <a href={i.productUrl} target="_blank" rel="noreferrer" className="line-clamp-1 text-nd-body hover:underline">{i.productName}</a>
                    <p className="text-nd-caption text-nd-fg-3">검색 시점 {i.productPrice?.toLocaleString("ko-KR") ?? "—"}원{i.isRocket ? " · 로켓" : ""} · 화면 표시용 (저장 안 함)</p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy === i.productId || p.coupang.candidates.some((c) => c.productId === i.productId)}
                    onClick={() =>
                      void run(i.productId, async () => {
                        await flush();
                        const r = await shortsPost<{ project: WithId<ProjectDoc> }>("research", { action: "coupang.addCandidate", projectId: p.id, productId: i.productId, productUrl: i.productUrl, productName: i.productName });
                        replace({ ...r.project, id: p.id });
                      }, "후보로 넣었습니다 — 가격 · 사양은 쿠팡에서 직접 확인해 적어 주세요.")
                    }
                  >
                    후보로
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section>
        <SectionHeader
          title="후보와 동일 상품 확인"
          hint={confirmed ? `동일 상품: ${confirmed.name || confirmed.url}` : "아직 동일 상품으로 확인한 것이 없습니다"}
          action={<Button size="sm" icon={Plus} onClick={addManual}>직접 추가</Button>}
        />
        {p.coupang.candidates.length === 0 ? (
          <EmptyState compact icon={ShoppingCart} title="후보가 없습니다" description="해외 영상 속 상품과 같은 상품이 쿠팡에서 팔리는지 찾아 후보로 넣고, 대조 항목을 하나씩 확인하세요." />
        ) : (
          <div className="space-y-4">
            {p.coupang.candidates.map((c, ci) => (
              <CandidateCard key={c.id} c={c} me={data!.me} onChange={(fn) => update((x) => fn(x.coupang.candidates[ci]))} onRemove={() => update((x) => void x.coupang.candidates.splice(ci, 1))} />
            ))}
          </div>
        )}
      </section>

      <AffiliateSection draft={draft} />
    </div>
  );
}

function CandidateCard({ c, me, onChange, onRemove }: { c: CoupangCandidate; me: string; onChange: (fn: (c: CoupangCandidate) => void) => void; onRemove: () => void }) {
  const sum = matchChecksSummary(c);
  const urlOk = !c.url || isCoupangProductUrl(c.url);
  return (
    <Card className={c.match === "identical" ? "ring-1 ring-nd-success/40" : c.match === "rejected" ? "opacity-70" : ""}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {c.match === "identical" ? (
          <Badge tone="success"><BadgeCheck size={12} className="mr-1 inline" />동일 상품 · 사람이 확인함</Badge>
        ) : c.match === "rejected" ? (
          <Badge>다른 상품</Badge>
        ) : (
          <Badge tone="warning">비슷한 후보 (확인 전)</Badge>
        )}
        <Badge size="sm" tone={c.source === "api" ? "info" : "neutral"}>{c.source === "api" ? "API 검색에서 찾음" : "직접 찾음"}</Badge>
        {c.confirmedBy && <span className="text-nd-caption text-nd-fg-3">{c.confirmedBy === me ? "내가" : c.confirmedBy} {fmtWhen(c.confirmedAt)} 확인</span>}
        <span className="ml-auto flex items-center gap-1">
          {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-nd-caption text-nd-accent">쿠팡에서 보기 <ExternalLink size={11} /></a>}
          <Button size="sm" variant="ghost" icon={Trash2} aria-label="후보 지우기" onClick={onRemove} />
        </span>
      </div>
      <FormRow className="grid-cols-1 sm:grid-cols-[2fr_2fr]">
        <Field label="쿠팡 상품 URL" error={urlOk ? undefined : "www.coupang.com/vp/products/숫자 형식이어야 합니다"}>
          <Input size="sm" value={c.url} onChange={(e) => onChange((x) => { x.url = e.target.value; x.productId = coupangProductId(e.target.value); })} />
        </Field>
        <Field label="상품명"><Input size="sm" value={c.name} onChange={(e) => onChange((x) => void (x.name = e.target.value))} /></Field>
      </FormRow>
      <FormRow className="mt-3 grid-cols-2 sm:grid-cols-5">
        <Field label="브랜드"><Input size="sm" value={c.brand} onChange={(e) => onChange((x) => void (x.brand = e.target.value))} /></Field>
        <Field label="모델"><Input size="sm" value={c.model} onChange={(e) => onChange((x) => void (x.model = e.target.value))} /></Field>
        <Field label="크기"><Input size="sm" value={c.size} onChange={(e) => onChange((x) => void (x.size = e.target.value))} /></Field>
        <Field label="재질"><Input size="sm" value={c.material} onChange={(e) => onChange((x) => void (x.material = e.target.value))} /></Field>
        <Field label="옵션"><Input size="sm" value={c.options} onChange={(e) => onChange((x) => void (x.options = e.target.value))} /></Field>
      </FormRow>
      <FormRow className="mt-3 grid-cols-1 sm:grid-cols-[2fr_1fr_1fr]">
        <Field label="규격 · 사양"><Input size="sm" value={c.spec} onChange={(e) => onChange((x) => void (x.spec = e.target.value))} /></Field>
        <Field label="확인 시점 가격 (원)" hint={c.price !== null ? `${fmtWhen(c.checkedAt)} 기준` : "쿠팡에서 직접 보고 적기"}>
          <NumberInput size="sm" value={c.price} placeholder="모름" onValueChange={(r) => onChange((x) => void (x.price = r === "" ? null : Number(r)))} />
        </Field>
        <Field label="판매 상태">
          <Select size="sm" value={c.saleStatus} onChange={(e) => onChange((x) => void (x.saleStatus = e.target.value as CoupangCandidate["saleStatus"]))}>
            <option value="unknown">확인 전</option>
            <option value="on_sale">판매 중</option>
            <option value="sold_out">품절</option>
          </Select>
        </Field>
      </FormRow>
      <Field className="mt-3" label="해외 영상 속 상품과 비교한 근거">
        <Textarea rows={2} value={c.comparison} onChange={(e) => onChange((x) => void (x.comparison = e.target.value))} placeholder="예: 경첩 모양 · 색상 3종 · 접었을 때 두께가 영상과 같음. 로고 위치 다름(OEM 추정)" />
      </Field>
      <div className="mt-3">
        <p className="mb-1.5 text-nd-caption font-medium text-nd-fg-2">대조 (사람이 봄) · {sum.seen}/{sum.total} 확인 · 같음 {sum.same} · 다름 {sum.different}</p>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(CHECK_LABEL) as MatchCheckKey[]).map((k) => (
            <Select key={k} size="sm" aria-label={CHECK_LABEL[k]} className="w-auto" value={c.checks[k] === null ? "" : c.checks[k] ? "same" : "diff"} onChange={(e) => onChange((x) => void (x.checks[k] = e.target.value === "" ? null : e.target.value === "same"))}>
              <option value="">{CHECK_LABEL[k]}: 미확인</option>
              <option value="same">{CHECK_LABEL[k]}: 같음</option>
              <option value="diff">{CHECK_LABEL[k]}: 다름</option>
            </Select>
          ))}
        </div>
      </div>
      <FormRow className="mt-4 grid-cols-1 sm:grid-cols-[1fr_2fr]">
        <Field label="판정">
          <Select size="sm" value={c.match} onChange={(e) => onChange((x) => void (x.match = e.target.value as CoupangCandidate["match"]))}>
            <option value="candidate">비슷한 후보</option>
            <option value="identical" disabled={!c.url || !urlOk || sum.different > 0}>동일 상품으로 확인</option>
            <option value="rejected">다른 상품</option>
          </Select>
        </Field>
        <p className="self-end pb-2 text-nd-caption text-nd-fg-3">
          {sum.different > 0 ? "「다름」 이 있는 후보는 동일 상품으로 확인할 수 없습니다." : "동일 상품으로 고르면 확인한 사람과 시각이 서버에 남습니다. 브랜드 · 모델을 바꾼 비슷한 상품을 같은 상품처럼 소개하지 마세요."}
        </p>
      </FormRow>
    </Card>
  );
}

function AffiliateSection({ draft }: { draft: Draft }) {
  const { p, update, flush, replace } = draft;
  const { data } = useShorts();
  const d = data!;
  const { busy, run } = useAction();
  const confirmed = confirmedCandidate(p);
  const aff = p.coupang.affiliate;
  const myProfile = d.profiles.find((x) => x.owner === d.me);
  const accounts = d.accounts.filter((a) => a.canPublish);
  const [accountId, setAccountId] = useState(aff?.accountId ?? accounts.find((a) => a.mine)?.id ?? "");
  const target = accounts.find((a) => a.id === accountId) ?? null;
  const linkOwner = target?.owner ?? d.me;
  const [url, setUrl] = useState(aff?.url ?? "");
  const [subId, setSubId] = useState(aff?.subId ?? "");
  const valid = isCoupangAffiliateUrl(url);
  const ownerKeyReady = linkOwner === d.me ? !!myProfile?.coupang.configured : true; // 남의 키 상태는 서버가 확인한다
  const effectiveSub = target?.coupangSubId ?? subId;
  return (
    <section>
      <SectionHeader title="제휴 링크" hint="게시할 계정 주인의 쿠팡 파트너스 링크여야 합니다" />
      <Card className="space-y-3">
        {!confirmed && <InlineNotice tone="warning">먼저 동일 상품을 확인해 주세요. 제휴 링크는 확인한 상품에 연결합니다.</InlineNotice>}
        {aff && (
          <p className="text-nd-body">
            현재: <a href={aff.url} target="_blank" rel="noreferrer" className="text-nd-accent">{aff.url}</a>
            <span className="ml-2 text-nd-caption text-nd-fg-3">
              {aff.coupangOwner ? `${aff.coupangOwner === d.me ? "내" : `${aff.coupangOwner} 님의`} 파트너스 링크` : "주인 기록 없음"} · {aff.method === "api" ? "딥링크 API" : "직접 붙여 넣음"} · {fmtWhen(aff.issuedAt)}{aff.subId ? ` · 채널 ${aff.subId}` : ""}
            </span>
            {confirmed && aff.candidateId !== confirmed.id && <Badge tone="danger" size="sm" className="ml-2">확인한 상품과 다른 후보에 연결됨</Badge>}
          </p>
        )}
        <FormRow className="grid-cols-1 sm:grid-cols-2">
          <Field label="어느 계정에 올릴 링크인가" hint="그 계정 주인의 쿠팡 키 · 채널 아이디로 만듭니다">
            <Select size="sm" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">(계정 미정 — 내 파트너스 링크)</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.platform === "youtube" ? "YouTube" : "Instagram"} · {a.externalName} · {a.mine ? "내 계정" : `${a.owner.split("@")[0]} 님 계정`}{a.coupangSubId ? ` · 채널 ${a.coupangSubId}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="채널 아이디 (subId)" hint={target?.coupangSubId ? "계정에 붙은 채널 아이디를 씁니다" : "내 파트너스에 등록한 것 중에서"}>
            <Select size="sm" value={effectiveSub} disabled={!!target?.coupangSubId || linkOwner !== d.me} onChange={(e) => setSubId(e.target.value)}>
              <option value="">(없음)</option>
              {target?.coupangSubId && <option value={target.coupangSubId}>{target.coupangSubId}</option>}
              {(myProfile?.subIds ?? []).filter((x) => x.id !== target?.coupangSubId).map((x) => <option key={x.id} value={x.id}>{x.id}{x.label ? ` · ${x.label}` : ""}</option>)}
            </Select>
          </Field>
        </FormRow>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={!confirmed || !ownerKeyReady || busy === "dl"}
            onClick={() =>
              void run("dl", async () => {
                await flush();
                const r = await shortsPost<{ project: WithId<ProjectDoc> }>("research", { action: "coupang.deeplink", projectId: p.id, candidateId: confirmed!.id, accountId: accountId || undefined, subId: effectiveSub || undefined });
                replace({ ...r.project, id: p.id });
                setUrl(r.project.coupang.affiliate?.url ?? "");
              }, `${linkOwner === d.me ? "내" : `${linkOwner} 님의`} 쿠팡 키로 제휴 링크를 만들었습니다.`)
            }
          >
            {linkOwner === d.me ? "내 쿠팡 키로 딥링크 만들기" : `${linkOwner.split("@")[0]} 님의 쿠팡 키로 딥링크 만들기`}
          </Button>
          {linkOwner === d.me && !myProfile?.coupang.configured && <span className="text-nd-caption text-nd-fg-3">내 파트너스 키가 없습니다 — 내 채널·연결에서 넣거나 아래에 직접 붙여 넣으세요.</span>}
        </div>
        <FormRow className="grid-cols-1 sm:grid-cols-[2.5fr_auto]">
          <Field label="직접 붙여 넣기 (내 파트너스에서 발급한 링크)" error={url && !valid ? "link.coupang.com/a/… 형식이어야 합니다" : undefined}>
            <Input size="sm" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://link.coupang.com/a/…" />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-nd-caption" aria-hidden>{"\u00a0"}</span>
            <Button size="sm" icon={Link2} disabled={!confirmed || !valid || url === aff?.url} onClick={() => update((x) => void (x.coupang.affiliate = { url, candidateId: confirmed!.id, subId: effectiveSub, method: "manual", issuedAt: Date.now(), by: "", coupangOwner: null, accountId: accountId || null }))}>
              확인한 상품에 연결
            </Button>
          </div>
        </FormRow>
        {linkOwner !== d.me && (
          <InlineNotice tone="warning">
            직접 붙여 넣은 링크는 <b>내</b> 파트너스 링크로 기록됩니다. {linkOwner} 님의 계정에 올리려면 그 사람의 링크가 필요해서, 게시 전 점검에서 막힙니다 — 위의 딥링크 버튼으로 계정 주인의 키로 만드세요.
          </InlineNotice>
        )}
        <p className="text-nd-caption text-nd-fg-3">
          수수료는 링크를 만든 파트너스 계정에 갑니다. 그 계정에 활동 채널로 등록된 채널에서만 써야 해서, 게시 전 점검이 「링크 주인 = 게시 계정 주인」 을 확인합니다. 채널 아이디를 계정마다 다르게 두면 쿠팡 클릭 리포트를 채널별로 나눠 볼 수 있습니다.
        </p>
      </Card>
    </section>
  );
}
