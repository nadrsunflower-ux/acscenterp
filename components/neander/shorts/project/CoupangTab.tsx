"use client";

// ============================================================
//  쿠팡 확인 탭 — 비슷한 후보와 「동일 상품으로 확인한 결과」 를 나눈다
// ------------------------------------------------------------
//  · 파트너스 API 권한이 있으면 검색 결과를 보여 주되 저장하지 않는다 (Open API
//    약관 제5조). 「후보로」 를 누르면 상품 주소 · 이름만 남는다.
//  · 가격 · 판매 상태는 사람이 쿠팡에서 직접 보고 적는다 (확인 시점이 함께 남는다).
//  · 「동일 상품」 은 사람이 대조 항목을 보고 고르는 것이다. 누가 언제 확인했는지
//    서버가 찍고, 화면은 「사람이 확인함」 으로 표시한다 — 자동 검증이 아니다.
//
//  2026-11 목업 개편(12-video-coupang): 후보 찾기 → (후보가 둘 이상이면 비교표) →
//  고른 후보의 정보 | 대조 · 판정을 나란히 → 파트너스 링크(올릴 계정 · 채널 아이디 ·
//  링크 주인 = 계정 주인 · 채널 아이디 일치 · 활동 채널 등록을 화면에서 표시 · 복사).
// ============================================================

import { useState } from "react";
import { BadgeCheck, CircleCheck, CircleDashed, CircleX, Copy, ExternalLink, Link2, Plus, Search, ShoppingCart, Trash2 } from "lucide-react";
import { Badge, Button, EmptyState, Field, FieldAction, FormRow, IconButton, InlineNotice, Input, NumberInput, Select, Textarea, buttonClass, cn, useToast } from "@/components/neander/ui";
import { shortsPost } from "@/lib/neander/shorts/client";
import { confirmedCandidate, coupangProductId, coupangSearchUrl, isCoupangAffiliateUrl, isCoupangProductUrl, matchChecksSummary, newId } from "@/lib/neander/shorts/model";
import type { CoupangCandidate, MatchCheckKey, ProjectDoc } from "@/lib/neander/shorts/types";
import { spaceOf } from "@/lib/neander/shorts/spaces";
import { isReadOnlyFor, useShorts, type WithId } from "../ShortsProvider";
import { Num, fmtWhen, useAction } from "../parts";
import { RecordTable, StudioCard, StudioNotice, type RecordColumn } from "../studio";
import type { Draft } from "../useProjectDraft";

const CHECK_LABEL: Record<MatchCheckKey, string> = { brand: "브랜드", model: "모델", size: "크기", material: "재질", options: "옵션", appearance: "외형" };
const SALE_LABEL: Record<CoupangCandidate["saleStatus"], string> = { unknown: "판매 상태 확인 전", on_sale: "판매 중", sold_out: "품절" };

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
  const { data, nameOf } = useShorts();
  const { busy, run } = useAction();
  // 검색은 내 키, 없으면 회사 공용 키 (결과를 저장하지 않으니 누구 키든 같다)
  const myProfile = data!.profiles.find((x) => x.owner === data!.me);
  const apiReady = !!myProfile?.coupang.configured || data!.status.companyCoupang.configured;
  const [kw, setKw] = useState(p.product);
  const [items, setItems] = useState<ApiItem[] | null>(null);
  const confirmed = confirmedCandidate(p);
  const term = (kw || p.product).trim();
  const count = (m: CoupangCandidate["match"]) => p.coupang.candidates.filter((c) => c.match === m).length;
  // 나란히 보는 후보 하나 — 고른 것 · 없으면 확인한 상품 · 그것도 없으면 첫 후보
  const [selId, setSelId] = useState<string | null>(null);
  const selIndex = (() => {
    const list = p.coupang.candidates;
    const i = list.findIndex((c) => c.id === selId);
    if (i >= 0) return i;
    const j = confirmed ? list.findIndex((c) => c.id === confirmed.id) : -1;
    return j >= 0 ? j : list.length ? 0 : -1;
  })();
  const sel = selIndex >= 0 ? p.coupang.candidates[selIndex] : null;
  const who = (e: string) => (e === data!.me ? "나" : nameOf(e));

  const addManual = () => {
    const id = newId("cp_");
    update((x) =>
      void x.coupang.candidates.push({
        id,
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
    setSelId(id);
  };

  type Row = { c: CoupangCandidate; i: number };
  const columns: RecordColumn<Row>[] = [
    {
      key: "n",
      header: "후보",
      mobile: "title",
      cell: ({ c, i }) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <span className={cn("nd-num inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold", MATCH_STYLE[c.match].dot)} aria-hidden>
            {i + 1}
          </span>
          <span className="min-w-0 truncate font-semibold" title={c.name}>
            {c.name || "(상품명 없음)"}
          </span>
        </span>
      ),
    },
    { key: "match", header: "판정", cell: ({ c }) => <MatchBadge c={c} /> },
    { key: "price", header: "확인 시점 가격", align: "right", cell: ({ c }) => <Num value={c.price} unit="원" /> },
    {
      key: "checks",
      header: "대조",
      cell: ({ c }) => {
        const sum = matchChecksSummary(c);
        return (
          <span className="nd-num whitespace-nowrap text-[13px] text-nd-fg-2">
            {sum.seen}/{sum.total} 확인 · <span className="text-nd-success-text">같음 {sum.same}</span> · <span className={sum.different ? "font-medium text-nd-danger-text" : ""}>다름 {sum.different}</span>
          </span>
        );
      },
    },
    { key: "src", header: "찾은 방법", cell: ({ c }) => <span className="text-[13px] text-nd-fg-3">{c.source === "api" ? "API 검색" : "직접 찾음"}</span> },
  ];

  return (
    <div className="space-y-6">
      <StudioCard title="같은 상품 후보 찾기" description={apiReady ? `파트너스 API (${myProfile?.coupang.configured ? "내 키" : "회사 공용 키"}) · 결과는 저장하지 않습니다` : "API 키 없음 — 쿠팡에서 직접 검색해 「직접 추가」 로 적습니다"}>
        <div className="space-y-3">
          <FormRow className="grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
            <Field label="쿠팡 검색어">
              <Input value={kw} onChange={(e) => setKw(e.target.value)} />
            </Field>
            <FieldAction size="md">
              <Button
                icon={Search}
                loading={busy === "s"}
                disabled={!apiReady || busy === "s" || !kw.trim()}
                title={!apiReady ? "파트너스 API 키가 없어 쓸 수 없습니다" : undefined}
                onClick={() => void run("s", async () => setItems((await shortsPost<{ items: ApiItem[] }>("research", { action: "coupang.search", keyword: kw })).items))}
              >
                {apiReady ? "API 검색" : "API 검색 (키 없음)"}
              </Button>
            </FieldAction>
            <FieldAction size="md">
              {term ? (
                <a href={coupangSearchUrl(term)} target="_blank" rel="noreferrer" className={buttonClass("secondary", "md", "gap-1.5")}>
                  쿠팡에서 직접 검색 <ExternalLink size={15} aria-hidden />
                </a>
              ) : (
                <Button variant="secondary" trailingIcon={ExternalLink} disabled>
                  쿠팡에서 직접 검색
                </Button>
              )}
            </FieldAction>
            <FieldAction size="md">
              <Button variant="secondary" icon={Plus} onClick={addManual}>
                직접 추가
              </Button>
            </FieldAction>
          </FormRow>
          <p className="text-[13px] text-nd-fg-3">브랜드 · 모델 · 크기 · 재질 · 옵션 · 외형을 대조한 뒤 같은 상품으로 확인합니다.</p>
          {!apiReady && (
            <InlineNotice tone="neutral">
              쿠팡 파트너스 Open API 는 최종 승인된 회원만 키를 받습니다. 내 채널·연결 화면에서 내 파트너스 키를 넣거나, 쿠팡에서 직접 찾아 「직접 추가」 로 적으세요. 검색은 키마다 분당 30회에서 멈춥니다 (쿠팡 한도 분당 50회 · 넘으면 하루 동안 막힘).
            </InlineNotice>
          )}
          {items && (
            <ul className="divide-y divide-nd-line rounded-nd-md border border-nd-line">
              {items.length === 0 && <li className="p-3 text-nd-body text-nd-fg-3">검색 결과가 없습니다 (품절 상품은 API 결과에 나오지 않습니다).</li>}
              {items.map((i) => (
                <li key={i.productId} className="flex items-center gap-3 px-3 py-2.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={i.productImage} alt="" className="h-14 w-14 shrink-0 rounded object-cover" loading="lazy" />
                  <div className="min-w-0 flex-1">
                    <a href={i.productUrl} target="_blank" rel="noreferrer" className="line-clamp-1 text-nd-body font-medium hover:underline" title={i.productName}>
                      {i.productName}
                    </a>
                    <p className="text-[13px] text-nd-fg-3">
                      검색 시점 {i.productPrice?.toLocaleString("ko-KR") ?? "—"}원{i.isRocket ? " · 로켓" : ""} · 화면 표시용 (저장 안 함)
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy === i.productId || p.coupang.candidates.some((c) => c.productId === i.productId)}
                    onClick={() =>
                      void run(
                        i.productId,
                        async () => {
                          await flush();
                          const r = await shortsPost<{ project: WithId<ProjectDoc> }>("research", { action: "coupang.addCandidate", projectId: p.id, productId: i.productId, productUrl: i.productUrl, productName: i.productName });
                          replace({ ...r.project, id: p.id });
                        },
                        "후보로 넣었습니다 — 가격 · 사양은 쿠팡에서 직접 확인해 적어 주세요.",
                      )
                    }
                  >
                    {p.coupang.candidates.some((c) => c.productId === i.productId) ? "후보에 있음" : "후보로"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </StudioCard>

      {p.coupang.candidates.length === 0 ? (
        <div className="nd-surface rounded-nd-lg p-5">
          <EmptyState
            compact
            icon={ShoppingCart}
            title="후보가 없습니다"
            description="해외 영상 속 상품과 같은 상품이 쿠팡에서 팔리는지 찾아 후보로 넣고, 대조 항목을 하나씩 확인하세요."
            action={
              <Button size="sm" icon={Plus} onClick={addManual}>
                직접 추가
              </Button>
            }
          />
        </div>
      ) : (
        <>
          {p.coupang.candidates.length > 1 && (
            <StudioCard
              flush
              title="후보 비교"
              description={`동일 상품 ${count("identical")} · 비교 중 ${count("candidate")} · 다른 상품 ${count("rejected")} — 줄을 누르면 아래에 나란히 봅니다`}
            >
              <RecordTable
                rows={p.coupang.candidates.map((c, i) => ({ c, i }))}
                columns={columns}
                rowKey={(r) => r.c.id}
                onRowClick={(r) => setSelId(r.c.id)}
                rowClassName={(r) => (r.i === selIndex ? "bg-nd-accent-soft/50" : undefined)}
                ariaLabel="쿠팡 후보"
                className="max-md:px-4 max-md:pb-4"
              />
            </StudioCard>
          )}
          {isReadOnlyFor(p, data!.me) ? (
            // 읽기 전용(관리자 몰아보기)은 줄을 골라 바꿀 수 없으니 모든 후보를 차례로 펼친다
            p.coupang.candidates.map((c, i) => (
              <CandidatePanels key={c.id} n={i + 1} total={p.coupang.candidates.length} c={c} confirmedName={confirmed ? confirmed.name || confirmed.url : null} who={who} onChange={() => undefined} onRemove={() => undefined} />
            ))
          ) : sel && (
            <CandidatePanels
              key={sel.id}
              n={selIndex + 1}
              total={p.coupang.candidates.length}
              c={sel}
              confirmedName={confirmed ? confirmed.name || confirmed.url : null}
              who={who}
              onChange={(fn) => update((x) => fn(x.coupang.candidates[selIndex]))}
              onRemove={() => {
                update((x) => void x.coupang.candidates.splice(selIndex, 1));
                setSelId(null);
              }}
            />
          )}
        </>
      )}

      <AffiliateSection draft={draft} />
    </div>
  );
}

// 번호 점 색 — 같은 색 배지가 배경에 묻히지 않게 판정마다 다르게
const MATCH_STYLE: Record<CoupangCandidate["match"], { dot: string }> = {
  identical: { dot: "bg-nd-success-text text-white" },
  candidate: { dot: "bg-nd-warning-text text-white" },
  rejected: { dot: "bg-nd-fg-3 text-white" },
};

function MatchBadge({ c }: { c: CoupangCandidate }) {
  return c.match === "identical" ? (
    <Badge tone="success" size="lg">
      <BadgeCheck size={14} aria-hidden />
      동일 상품 · 사람이 확인함
    </Badge>
  ) : c.match === "rejected" ? (
    <Badge size="lg">다른 상품</Badge>
  ) : (
    <Badge tone="warning" size="lg">
      비슷한 후보 (확인 전)
    </Badge>
  );
}

/** 고른 후보 — 왼쪽 후보 정보 · 오른쪽 대조와 판정 (근거를 나란히) */
function CandidatePanels({
  n,
  total,
  c,
  confirmedName,
  who,
  onChange,
  onRemove,
}: {
  n: number;
  total: number;
  c: CoupangCandidate;
  confirmedName: string | null;
  who: (email: string) => string;
  onChange: (fn: (c: CoupangCandidate) => void) => void;
  onRemove: () => void;
}) {
  const sum = matchChecksSummary(c);
  const urlOk = !c.url || isCoupangProductUrl(c.url);
  const value: Record<MatchCheckKey, string> = { brand: c.brand, model: c.model, size: c.size, material: c.material, options: c.options, appearance: "영상 속 모양과 비교" };
  const link = /^https?:\/\//.test(c.url.trim()) ? c.url.trim() : null;
  return (
    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <StudioCard
        className={cn(c.match === "identical" && "ring-1 ring-nd-success/40")}
        title={
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span>선택한 후보{total > 1 ? ` · ${n}/${total}` : ""}</span>
            <MatchBadge c={c} />
          </span>
        }
        description={`${c.source === "api" ? "API 검색에서 찾음" : "직접 찾음"} · ${SALE_LABEL[c.saleStatus]}${c.price !== null ? ` · 확인 시점 ${c.price.toLocaleString("ko-KR")}원 (${fmtWhen(c.checkedAt)} 기준)` : ""}`}
        action={<IconButton icon={Trash2} size="sm" label="후보 지우기" onClick={onRemove} />}
      >
        <div className="min-w-0 space-y-3">
          <FormRow className="grid-cols-1 sm:grid-cols-2">
            <Field label="쿠팡 상품 URL" error={urlOk ? undefined : "www.coupang.com/vp/products/숫자 형식이어야 합니다"}>
              <Input
                value={c.url}
                onChange={(e) =>
                  onChange((x) => {
                    x.url = e.target.value;
                    x.productId = coupangProductId(e.target.value);
                  })
                }
                placeholder="https://www.coupang.com/vp/products/…"
              />
            </Field>
            <Field label="상품명">
              <Input value={c.name} onChange={(e) => onChange((x) => void (x.name = e.target.value))} />
            </Field>
          </FormRow>
          <FormRow className="grid-cols-2 sm:grid-cols-3 2xl:grid-cols-5">
            <Field label="브랜드">
              <Input value={c.brand} onChange={(e) => onChange((x) => void (x.brand = e.target.value))} />
            </Field>
            <Field label="모델">
              <Input value={c.model} onChange={(e) => onChange((x) => void (x.model = e.target.value))} />
            </Field>
            <Field label="크기">
              <Input value={c.size} onChange={(e) => onChange((x) => void (x.size = e.target.value))} />
            </Field>
            <Field label="재질">
              <Input value={c.material} onChange={(e) => onChange((x) => void (x.material = e.target.value))} />
            </Field>
            <Field label="옵션">
              <Input value={c.options} onChange={(e) => onChange((x) => void (x.options = e.target.value))} />
            </Field>
          </FormRow>
          <FormRow className="grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <Field label="규격 · 사양">
              <Input value={c.spec} onChange={(e) => onChange((x) => void (x.spec = e.target.value))} />
            </Field>
            <Field label="확인 시점 가격 (원)" hint={c.price !== null ? `${fmtWhen(c.checkedAt)} 기준` : "쿠팡에서 직접 보고 적기"}>
              <NumberInput value={c.price} placeholder="미확인" onValueChange={(r) => onChange((x) => void (x.price = r === "" ? null : Number(r)))} />
            </Field>
            <Field label="판매 상태">
              <Select value={c.saleStatus} onChange={(e) => onChange((x) => void (x.saleStatus = e.target.value as CoupangCandidate["saleStatus"]))}>
                <option value="unknown">확인 전</option>
                <option value="on_sale">판매 중</option>
                <option value="sold_out">품절</option>
              </Select>
            </Field>
          </FormRow>
          <p className="text-[13px] text-nd-fg-3">가격 · 판매 상태는 사람이 쿠팡에서 직접 보고 적은 값입니다 ({fmtWhen(c.checkedAt)} 기준).</p>
        </div>
      </StudioCard>

      {/* 대조 — 사람이 하나씩 보고 고른다 */}
      <StudioCard
        title="동일 상품 확인"
        description={confirmedName ? `확인한 상품: ${confirmedName}` : "아직 동일 상품으로 확인한 것이 없습니다"}
        action={
          <span className="nd-num whitespace-nowrap text-[13px] text-nd-fg-2">
            {sum.seen}/{sum.total} 확인 · <span className="text-nd-success-text">같음 {sum.same}</span> · <span className={sum.different ? "font-medium text-nd-danger-text" : ""}>다름 {sum.different}</span>
          </span>
        }
      >
        <div className="space-y-4">
          <ul className="space-y-1.5" aria-label="대조 항목">
            {(Object.keys(CHECK_LABEL) as MatchCheckKey[]).map((k) => {
              const v = c.checks[k];
              const Icon = v === null ? CircleDashed : v ? CircleCheck : CircleX;
              return (
                <li key={k} className="grid grid-cols-[1.1rem_3.5rem_minmax(0,1fr)_6.5rem] items-center gap-2">
                  <Icon size={16} aria-hidden className={v === null ? "text-nd-fg-3" : v ? "text-nd-success-text" : "text-nd-danger-text"} />
                  <span className="text-nd-body font-medium text-nd-fg">{CHECK_LABEL[k]}</span>
                  <span className="min-w-0 truncate text-[13px] text-nd-fg-3" title={value[k]}>
                    {value[k] || "적은 값 없음"}
                  </span>
                  <Select size="sm" aria-label={CHECK_LABEL[k]} value={v === null ? "" : v ? "same" : "diff"} onChange={(e) => onChange((x) => void (x.checks[k] = e.target.value === "" ? null : e.target.value === "same"))}>
                    <option value="">미확인</option>
                    <option value="same">같음</option>
                    <option value="diff">다름</option>
                  </Select>
                </li>
              );
            })}
          </ul>
          <Field label="해외 영상 속 상품과 비교한 근거">
            <Textarea rows={3} value={c.comparison} onChange={(e) => onChange((x) => void (x.comparison = e.target.value))} placeholder="예: 경첩 모양 · 색상 3종 · 접었을 때 두께가 영상과 같음. 로고 위치 다름(OEM 추정)" />
          </Field>
          <div className="border-t border-nd-line pt-3">
            <FormRow className="grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Field label="최종 판정">
                <Select value={c.match} onChange={(e) => onChange((x) => void (x.match = e.target.value as CoupangCandidate["match"]))}>
                  <option value="candidate">비슷한 후보</option>
                  <option value="identical" disabled={!c.url || !urlOk || sum.different > 0}>
                    동일 상품으로 확인
                  </option>
                  <option value="rejected">다른 상품</option>
                </Select>
              </Field>
              <FieldAction size="md">
                {link ? (
                  <a href={link} target="_blank" rel="noreferrer" className={buttonClass("secondary", "md", "gap-1.5")}>
                    <ExternalLink size={15} aria-hidden />
                    쿠팡 상품 열기
                  </a>
                ) : (
                  <Button variant="secondary" icon={ExternalLink} disabled title="쿠팡 상품 URL 을 먼저 적어 주세요">
                    쿠팡 상품 열기
                  </Button>
                )}
              </FieldAction>
            </FormRow>
            <p className={cn("mt-1.5 text-[13px]", sum.different > 0 ? "text-nd-danger-text" : "text-nd-fg-3")}>
              {sum.different > 0
                ? "「다름」 이 있는 후보는 동일 상품으로 확인할 수 없습니다."
                : !c.url || !urlOk
                  ? "쿠팡 상품 URL 을 적어야 동일 상품으로 확인할 수 있습니다."
                  : "동일 상품으로 고르면 확인한 사람과 시각이 서버에 남습니다. 브랜드 · 모델을 바꾼 비슷한 상품을 같은 상품처럼 소개하지 마세요."}
            </p>
            {c.confirmedBy && (
              <p className="mt-1 text-[13px] text-nd-fg-2">
                확인: {who(c.confirmedBy)} · {fmtWhen(c.confirmedAt)}
              </p>
            )}
          </div>
        </div>
      </StudioCard>
    </div>
  );
}

/** 일치 표시 한 줄 — 맞음 · 다름 · 모름을 아이콘과 글자로 */
function MatchLine({ ok, label, detail }: { ok: boolean | null; label: string; detail: string }) {
  const Icon = ok === null ? CircleDashed : ok ? CircleCheck : CircleX;
  return (
    <li className="flex min-w-0 items-start gap-2">
      <Icon size={16} aria-hidden className={cn("mt-0.5 shrink-0", ok === null ? "text-nd-fg-3" : ok ? "text-nd-success-text" : "text-nd-danger-text")} />
      <span className="min-w-0 text-[13px]">
        <span className="font-medium text-nd-fg">{label}</span> <span className={ok === false ? "text-nd-danger-text" : "text-nd-fg-3"}>{detail}</span>
      </span>
    </li>
  );
}

function AffiliateSection({ draft }: { draft: Draft }) {
  const { p, update, flush, replace } = draft;
  const { data, nameOf } = useShorts();
  const d = data!;
  const toast = useToast();
  const { busy, run } = useAction();
  const confirmed = confirmedCandidate(p);
  const aff = p.coupang.affiliate;
  const myProfile = d.profiles.find((x) => x.owner === d.me);
  // 이 영상의 프로젝트에 붙은 계정만 (다른 채널 계정에 링크를 붙이지 않게)
  const accounts = d.accounts.filter((a) => a.canPublish && spaceOf(a) === spaceOf(p));
  const [accountId, setAccountId] = useState(aff?.accountId ?? accounts.find((a) => a.mine)?.id ?? "");
  const target = accounts.find((a) => a.id === accountId) ?? null;
  const linkOwner = target?.owner ?? d.me;
  const [url, setUrl] = useState(aff?.url ?? "");
  const [subId, setSubId] = useState(aff?.subId ?? "");
  const valid = isCoupangAffiliateUrl(url);
  const ownerKeyReady = linkOwner === d.me ? !!myProfile?.coupang.configured : true; // 남의 키 상태는 서버가 확인한다
  const effectiveSub = target?.coupangSubId ?? subId;
  const name = (e: string) => (e === d.me ? "나" : nameOf(e));
  // 일치 표시 — 게시 전 점검(링크 주인 = 게시 계정 주인)과 같은 기준으로 화면에서만 본다
  const ownerOk: boolean | null = !aff || !target || !aff.coupangOwner ? null : aff.coupangOwner === target.owner;
  const subOk: boolean | null = !aff || !target?.coupangSubId ? null : aff.subId === target.coupangSubId;
  const channelOk: boolean | null = !target ? null : !!target.coupangChannel?.registered;
  const copy = async () => {
    if (!aff) return;
    try {
      await navigator.clipboard.writeText(aff.url);
      toast.success("제휴 링크를 복사했습니다.");
    } catch {
      toast.error("복사하지 못했습니다 — 링크를 직접 골라 복사해 주세요.");
    }
  };
  return (
    <StudioCard title="파트너스 링크" description="게시할 계정 주인의 쿠팡 파트너스 링크여야 합니다 — 수수료는 링크를 만든 파트너스 계정에 갑니다">
      <div className="space-y-4">
        {!confirmed && <InlineNotice tone="warning">먼저 동일 상품을 확인해 주세요. 제휴 링크는 확인한 상품에 연결합니다.</InlineNotice>}
        <FormRow className="grid-cols-1 sm:grid-cols-2">
          <Field label="올릴 계정" hint={accounts.length ? "그 계정 주인의 쿠팡 키 · 채널 아이디로 만듭니다" : "게시할 수 있는 계정이 아직 없습니다 — 내 채널 · 연결에서 연결합니다"}>
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">(계정 미정 — 내 파트너스 링크)</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.platform === "youtube" ? "YouTube" : "Instagram"} · {a.externalName} · {a.mine ? "내 계정" : `${a.owner.split("@")[0]} 님 계정`}
                  {a.coupangSubId ? ` · 채널 ${a.coupangSubId}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="채널 아이디 (subId)" hint={target?.coupangSubId ? "계정에 붙은 채널 아이디를 씁니다" : "내 파트너스에 등록한 것 중에서"}>
            <Select value={effectiveSub} disabled={!!target?.coupangSubId || linkOwner !== d.me} onChange={(e) => setSubId(e.target.value)}>
              <option value="">(없음)</option>
              {target?.coupangSubId && <option value={target.coupangSubId}>{target.coupangSubId}</option>}
              {(myProfile?.subIds ?? [])
                .filter((x) => x.id !== target?.coupangSubId)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.id}
                    {x.label ? ` · ${x.label}` : ""}
                  </option>
                ))}
            </Select>
          </Field>
        </FormRow>
        <StudioNotice tone="info" title="계정 주인의 제휴 링크를 씁니다">
          {linkOwner === d.me ? "내" : `${name(linkOwner)} 님의`} 쿠팡 키{effectiveSub ? `와 채널 아이디 ${effectiveSub}` : ""}로 링크를 만듭니다. 그 계정에 활동 채널로 등록된 채널에서만 써야 해서, 게시 전 점검이 「링크 주인 = 게시 계정 주인」 을 확인합니다.
        </StudioNotice>

        <div className="rounded-nd-md border border-nd-line bg-nd-sunken/50 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-medium text-nd-fg-2">현재 연결된 링크</span>
              {aff && confirmed && aff.candidateId !== confirmed.id ? (
                <Badge tone="danger" size="lg">
                  확인한 상품과 다른 후보에 연결됨
                </Badge>
              ) : aff && confirmed ? (
                <Badge tone="success" size="lg">
                  확인한 상품에 연결됨
                </Badge>
              ) : null}
            </span>
            {aff && (
              <Button size="sm" variant="secondary" icon={Copy} onClick={() => void copy()}>
                복사
              </Button>
            )}
          </div>
          {aff ? (
            <>
              <a href={aff.url} target="_blank" rel="noreferrer" className="mt-1 block break-all text-nd-body text-nd-accent hover:underline">
                {aff.url}
              </a>
              <p className="mt-1 text-[13px] text-nd-fg-3">
                {aff.coupangOwner ? `${aff.coupangOwner === d.me ? "내" : `${aff.coupangOwner} 님의`} 파트너스 링크` : "주인 기록 없음"} · {aff.method === "api" ? "딥링크 API" : "직접 붙여 넣음"} · {fmtWhen(aff.issuedAt)}
                {aff.subId ? ` · 채널 ${aff.subId}` : ""}
              </p>
            </>
          ) : (
            <p className="mt-1 text-nd-body text-nd-fg-3">아직 연결된 제휴 링크가 없습니다.</p>
          )}
          <ul className="mt-3 space-y-1.5 border-t border-nd-line pt-3" aria-label="일치 확인">
            <MatchLine
              ok={ownerOk}
              label="링크 주인 = 게시 계정 주인"
              detail={ownerOk === null ? (!aff ? "링크가 아직 없습니다" : !target ? "올릴 계정을 고르면 확인합니다" : "링크 주인 기록이 없습니다") : ownerOk ? `같음 · ${name(target!.owner)}` : `다름 — 링크 ${name(aff!.coupangOwner!)} · 계정 ${name(target!.owner)}`}
            />
            <MatchLine
              ok={subOk}
              label="채널 아이디"
              detail={subOk === null ? (!target ? "올릴 계정을 고르면 확인합니다" : !target.coupangSubId ? "계정에 붙은 채널 아이디가 없습니다" : "링크가 아직 없습니다") : subOk ? `같음 · ${target!.coupangSubId}` : `다름 — 링크 ${aff!.subId || "(없음)"} · 계정 ${target!.coupangSubId}`}
            />
            <MatchLine
              ok={channelOk}
              label="활동 채널 등록 확인"
              detail={channelOk === null ? "올릴 계정을 고르면 확인합니다" : channelOk ? `계정 설정에 등록 확인 기록이 있습니다 (${name(target!.coupangChannel!.by)})` : "계정 설정에 등록 확인 기록이 없습니다 — 내 채널 · 연결에서 적습니다"}
            />
          </ul>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            icon={Link2}
            loading={busy === "dl"}
            disabled={!confirmed || !ownerKeyReady || busy === "dl"}
            onClick={() =>
              void run(
                "dl",
                async () => {
                  await flush();
                  const r = await shortsPost<{ project: WithId<ProjectDoc> }>("research", { action: "coupang.deeplink", projectId: p.id, candidateId: confirmed!.id, accountId: accountId || undefined, subId: effectiveSub || undefined });
                  replace({ ...r.project, id: p.id });
                  setUrl(r.project.coupang.affiliate?.url ?? "");
                },
                `${linkOwner === d.me ? "내" : `${linkOwner} 님의`} 쿠팡 키로 제휴 링크를 만들었습니다.`,
              )
            }
          >
            {linkOwner === d.me ? "내 쿠팡 키로 딥링크 만들기" : `${linkOwner.split("@")[0]} 님의 쿠팡 키로 딥링크 만들기`}
          </Button>
          {linkOwner === d.me && !myProfile?.coupang.configured && <span className="text-[13px] text-nd-fg-3">내 파트너스 키가 없습니다 — 내 채널·연결에서 넣거나 아래에 직접 붙여 넣으세요.</span>}
        </div>
        <FormRow className="grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Field label="직접 붙여 넣기 (내 파트너스에서 발급한 링크)" error={url && !valid ? "link.coupang.com/a/… 형식이어야 합니다" : undefined}>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://link.coupang.com/a/…" />
          </Field>
          <FieldAction size="md">
            <Button
              variant="secondary"
              icon={Link2}
              disabled={!confirmed || !valid || url === aff?.url}
              onClick={() => update((x) => void (x.coupang.affiliate = { url, candidateId: confirmed!.id, subId: effectiveSub, method: "manual", issuedAt: Date.now(), by: "", coupangOwner: null, accountId: accountId || null }))}
            >
              확인한 상품에 연결
            </Button>
          </FieldAction>
        </FormRow>
        {linkOwner !== d.me && (
          <InlineNotice tone="warning">
            직접 붙여 넣은 링크는 <b>내</b> 파트너스 링크로 기록됩니다. {linkOwner} 님의 계정에 올리려면 그 사람의 링크가 필요해서, 게시 전 점검에서 막힙니다 — 위의 딥링크 버튼으로 계정 주인의 키로 만드세요.
          </InlineNotice>
        )}
        <p className="text-[13px] leading-relaxed text-nd-fg-3">채널 아이디를 계정마다 다르게 두면 쿠팡 클릭 리포트를 채널별로 나눠 볼 수 있습니다.</p>
      </div>
    </StudioCard>
  );
}
