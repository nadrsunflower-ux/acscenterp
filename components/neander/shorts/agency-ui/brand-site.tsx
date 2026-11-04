"use client";

// ============================================================
//  업체 「계약 · 브리프」 탭 — 홈페이지 · 상세페이지 주소로 브리프 칸 채우기
// ------------------------------------------------------------
//  주소를 넣고 누르면 서버가 그 페이지 한 장을 읽어 「제안」 만 돌려준다 (저장 없음 · AI 한 번).
//  결과 창에서 칸마다 지금 값 · 제안 · 근거 문장을 보고 고른 것만 넣는다.
//  기본은 비어 있는 칸만 골라 둔다 — 사람이 이미 쓴 칸을 AI 가 덮지 않게.
//  넣기는 이 화면의 update(...) (1.2초 뒤 자동 저장) 로만 한다. 담당자가 아니면 막는다.
// ============================================================

import { useEffect, useState, type ReactNode } from "react";
import { Globe, Quote, Sparkles } from "lucide-react";
import { Badge, Button, Checkbox, Dialog, Field, FieldAction, FormRow, Input, cn, useToast } from "@/components/neander/ui";
import { useAction } from "@/components/neander/shorts/parts";
import { AiCostNote, StudioNotice } from "@/components/neander/shorts/studio";
import { shortsGet, shortsPost } from "@/lib/neander/shorts/client";
import {
  BRAND_SITE_DAILY_LIMIT,
  BRAND_SITE_EST_KRW,
  applyPicks,
  defaultPicks,
  hasMessage,
  pickCount,
  prefillSiteUrl,
  sameProduct,
  type BrandSitePicks,
  type BrandSitePreview,
  type Proposal,
} from "@/lib/neander/shorts/brand-site";
import { todayStrKST } from "@/lib/neander/format";
import type { ClientView } from "@/lib/neander/shorts/types";

/** 읽기만 하는 동작 (이름이 .preview) — 저장하지 않는다 */
export const previewBrandSite = (clientId: string, url: string) =>
  shortsPost<{ preview: BrandSitePreview }>("brand-site", { action: "site.preview", clientId, url }).then((r) => r.preview);
const loadBrandSiteQuota = () => shortsGet<{ quota: { used: number; limit: number } }>("brand-site").then((r) => r.quota);

const fmtUsd = (v: number) => `$${v < 0.01 ? v.toFixed(4) : v.toFixed(3)}`;

export function BrandSiteFill({ c, update }: { c: ClientView; update: (fn: (x: ClientView) => void) => void }) {
  const toast = useToast();
  const { busy, run } = useAction();
  const [url, setUrl] = useState(() => prefillSiteUrl(c));
  const [quota, setQuota] = useState<{ used: number; limit: number } | null>(null);
  const [preview, setPreview] = useState<BrandSitePreview | null>(null);
  useEffect(() => {
    loadBrandSiteQuota().then(setQuota, () => setQuota(null));
  }, []);
  const limit = quota?.limit ?? BRAND_SITE_DAILY_LIMIT;
  const blocked = !c.canEdit
    ? "이 업체의 담당자만 읽어 채울 수 있습니다 — 관리자 몰아보기는 읽기만 합니다."
    : quota && quota.used >= quota.limit
      ? `오늘 회사 전체 하루 상한(${quota.limit}번)을 다 썼습니다 — 내일 다시 해 주세요.`
      : null;
  const go = () => {
    if (blocked || !url.trim() || busy) return;
    void run("read", async () => {
      const p = await previewBrandSite(c.id, url.trim());
      setQuota(p.quota);
      setPreview(p);
    });
  };
  return (
    <div className="space-y-3 rounded-nd-md border border-nd-line bg-nd-sunken/60 p-4">
      <div className="flex items-start gap-2.5">
        <Globe size={18} aria-hidden className="mt-0.5 shrink-0 text-nd-fg-3" />
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-nd-fg">홈페이지에서 읽어 채우기</div>
          <p className="mt-0.5 text-[13px] leading-relaxed text-nd-fg-3">
            업체 홈페이지 · 상세페이지 한 장을 읽어 아래 칸에 넣을 제안을 만듭니다. 고른 것만 들어가고, 근거 문장이 페이지에 없는 제안은 버립니다.
          </p>
        </div>
      </div>
      <FormRow className="grid-cols-[minmax(0,1fr)_auto]">
        <Field label="홈페이지 · 상세페이지 주소">
          <Input
            size="sm"
            type="url"
            inputMode="url"
            value={url}
            disabled={!c.canEdit}
            placeholder="https://…"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                go();
              }
            }}
          />
        </Field>
        <FieldAction>
          <Button size="sm" icon={Sparkles} loading={busy === "read"} disabled={!!blocked || !url.trim() || busy === "read"} onClick={go}>
            읽어 오기
          </Button>
        </FieldAction>
      </FormRow>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <AiCostNote estimate={`약 ${BRAND_SITE_EST_KRW}원 (실측 기준)`} used={quota ? `${quota.used.toLocaleString("ko-KR")}번` : undefined} cap={`${limit.toLocaleString("ko-KR")}번`} />
        {blocked && <span className="text-[13px] font-medium text-nd-warning-text">{blocked}</span>}
      </div>
      {preview && (
        <BrandSiteDialog
          c={c}
          p={preview}
          onClose={() => setPreview(null)}
          onApply={(picks) => {
            const today = todayStrKST();
            update((x) => applyPicks(x, preview, picks, today));
            setPreview(null);
            toast.success("고른 것을 넣었습니다 — 저절로 저장됩니다.");
          }}
        />
      )}
    </div>
  );
}

// ---- 결과 창 -----------------------------------------------------------------

function Evidence({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p className="flex min-w-0 items-start gap-1.5 text-[13px] leading-relaxed text-nd-fg-3">
      <Quote size={13} aria-hidden className="mt-1 shrink-0" />
      <span className="min-w-0 break-words">
        근거 · <span className="text-nd-fg-2">「{text}」</span>
      </span>
    </p>
  );
}

function Group({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div>
        <h3 className="text-[15px] font-semibold text-nd-fg">{title}</h3>
        {note && <p className="mt-0.5 text-[13px] text-nd-fg-3">{note}</p>}
      </div>
      {children}
    </section>
  );
}

/** 고를 수 있는 한 줄 — 칸 전체를 눌러도 체크가 바뀐다 */
function PickRow({ checked, disabled, onChange, label, children }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string; children: ReactNode }) {
  return (
    <label
      className={cn(
        "flex min-w-0 items-start gap-3 rounded-nd-md border p-3 transition-colors",
        disabled ? "cursor-not-allowed border-nd-line opacity-70" : "cursor-pointer",
        checked && !disabled ? "border-nd-accent/50 bg-nd-accent-soft/40" : "border-nd-line",
      )}
    >
      <Checkbox checked={checked} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.checked)} className="mt-[3px]" />
      <div className="min-w-0 flex-1 space-y-1.5">{children}</div>
    </label>
  );
}

function FieldPick({ label, current, prop, checked, onChange }: { label: string; current: string; prop: Proposal | null; checked: boolean; onChange: (v: boolean) => void }) {
  if (!prop)
    return (
      <div className="rounded-nd-md border border-dashed border-nd-line px-3 py-2.5 text-[13px] text-nd-fg-3">
        <span className="font-medium text-nd-fg-2">{label}</span> — 제안 없음 (페이지에서 근거를 찾지 못했습니다)
      </div>
    );
  const filled = !!current.trim();
  return (
    <PickRow checked={checked} onChange={onChange} label={`${label} 넣기`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-semibold text-nd-fg">{label}</span>
        {filled ? (
          <Badge tone="warning" size="lg">
            고르면 지금 값을 바꿉니다
          </Badge>
        ) : (
          <Badge size="lg">지금 비어 있음</Badge>
        )}
      </div>
      <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        <div className="min-w-0">
          <div className="text-[13px] text-nd-fg-3">지금 값</div>
          <p className="whitespace-pre-wrap break-words text-[14px] text-nd-fg-2">{filled ? current : "—"}</p>
        </div>
        <div className="min-w-0">
          <div className="text-[13px] text-nd-fg-3">제안 · AI</div>
          <p className="break-words text-[14px] text-nd-fg">{prop.value}</p>
        </div>
      </div>
      <Evidence text={prop.evidence} />
    </PickRow>
  );
}

function BrandSiteDialog({ c, p, onClose, onApply }: { c: ClientView; p: BrandSitePreview; onClose: () => void; onApply: (picks: BrandSitePicks) => void }) {
  const [picks, setPicks] = useState<BrandSitePicks>(() => defaultPicks(c, p.suggestion));
  const s = p.suggestion;
  const n = pickCount(picks);
  const set = (fn: (x: BrandSitePicks) => void) =>
    setPicks((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
  const nothing = !s.summary && !s.target && !s.tone && !s.keyMessages.length && !s.products.length;
  const msgRoom = Math.max(0, 15 - c.brief.keyMessages.length);
  const pickedMsgs = picks.keyMessages.filter(Boolean).length;
  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title="홈페이지에서 읽은 제안"
      description="고른 것만 브리프 · 제품에 들어갑니다. 제안은 AI 가 페이지 글로 만든 것이라 확인한 뒤 넣어 주세요."
      footer={
        <>
          <span className="mr-auto text-[13px] text-nd-fg-3">{n ? `${n}개 골랐음` : "고른 것 없음"}</span>
          <Button variant="secondary" onClick={onClose}>
            닫기
          </Button>
          <Button disabled={!n || !c.canEdit} onClick={() => onApply(picks)}>
            선택한 것 넣기
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="space-y-1.5 rounded-nd-md bg-nd-sunken/70 px-4 py-3 text-[13px] text-nd-fg-2">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span className="text-nd-fg-3">읽은 주소</span>
            <a href={p.finalUrl} target="_blank" rel="noreferrer noopener" className="min-w-0 break-all text-nd-accent hover:underline">
              {p.finalUrl}
            </a>
          </div>
          {(p.page.title || p.page.siteName) && (
            <div className="break-words">
              <span className="text-nd-fg-3">페이지</span> {[p.page.siteName, p.page.title].filter(Boolean).join(" · ")}
            </div>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            <span>
              글 {p.page.chars.toLocaleString("ko-KR")}자 읽음{p.page.truncated ? " (상한에서 자름)" : ""}
            </span>
            <span>
              AI 실제 비용 {fmtUsd(p.costUsd)} · 약 {p.costKrw.toLocaleString("ko-KR")}원
            </span>
            <span>
              오늘 {p.quota.used} / 하루 상한 {p.quota.limit}번
            </span>
          </div>
          {p.dropped.count > 0 && (
            <div className="text-nd-warning-text" title={p.dropped.labels.join(" · ")}>
              근거 문장이 페이지 글에 없어 버린 제안 {p.dropped.count}개 — {p.dropped.labels.slice(0, 4).join(" · ")}
              {p.dropped.labels.length > 4 ? " …" : ""}
            </div>
          )}
        </div>

        {nothing && (
          <StudioNotice tone="warning" title="넣을 만한 제안이 없습니다">
            페이지 글에서 근거를 찾은 제안이 없습니다. 회사 소개 · 제품 상세페이지 주소로 다시 해 보세요.
          </StudioNotice>
        )}

        <Group title="브리프 칸" note="이미 쓴 칸은 기본으로 고르지 않습니다 — 고르면 지금 값을 바꿉니다.">
          <div className="space-y-2.5">
            <FieldPick label="브랜드 · 캠페인 요약" current={c.brief.summary} prop={s.summary} checked={picks.summary} onChange={(v) => set((x) => void (x.summary = v))} />
            <FieldPick label="대상 (누구에게)" current={c.brief.target} prop={s.target} checked={picks.target} onChange={(v) => set((x) => void (x.target = v))} />
            <FieldPick label="톤 · 말투" current={c.brief.tone} prop={s.tone} checked={picks.tone} onChange={(v) => set((x) => void (x.tone = v))} />
          </div>
        </Group>

        {s.keyMessages.length > 0 && (
          <Group title="핵심 메시지" note={`지금 ${c.brief.keyMessages.length}개 — 고른 것은 겹치지 않게 뒤에 덧붙입니다 (15개 상한 · 남은 자리 ${msgRoom}개).`}>
            <div className="space-y-2">
              {s.keyMessages.map((m, i) => {
                const had = hasMessage(c.brief.keyMessages, m.value);
                const full = !picks.keyMessages[i] && pickedMsgs >= msgRoom;
                return (
                  <PickRow key={i} checked={picks.keyMessages[i] && !had} disabled={had || full} onChange={(v) => set((x) => void (x.keyMessages[i] = v))} label={`핵심 메시지 ${i + 1} 넣기`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="break-words text-[14px] text-nd-fg">{m.value}</span>
                      {had && <Badge size="lg">이미 있음</Badge>}
                      {full && !had && <Badge size="lg">자리 없음</Badge>}
                    </div>
                    <Evidence text={m.evidence} />
                  </PickRow>
                );
              })}
            </div>
          </Group>
        )}

        {s.products.length > 0 && (
          <Group title="제품 후보" note="고른 제품은 「제품 · 사진」 탭에 들어갑니다 — 메모에 「홈페이지 기준 · 확인 필요 · 날짜」 를 남깁니다. 효능 · 과장 표현은 확인된 사실 칸이 아니라 메모에 「업체 주장」 으로 들어갑니다.">
            <div className="grid items-start gap-3 lg:grid-cols-2">
              {s.products.map((pp, i) => {
                const pk = picks.products[i];
                const had = sameProduct(c.products, pp.name);
                return (
                  <div key={i} className={cn("min-w-0 rounded-nd-md border p-3", pk.on ? "border-nd-accent/50 bg-nd-accent-soft/30" : "border-nd-line")}>
                    <label className="flex min-w-0 cursor-pointer items-start gap-3">
                      <Checkbox checked={pk.on} aria-label={`제품 「${pp.name}」 넣기`} onChange={(e) => set((x) => void (x.products[i].on = e.target.checked))} className="mt-[3px]" />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="break-words text-[14px] font-semibold text-nd-fg">{pp.name}</span>
                          {had ? (
                            <Badge tone="info" size="lg">
                              같은 이름 제품에 사실만 덧붙임
                            </Badge>
                          ) : (
                            <Badge size="lg">새 제품</Badge>
                          )}
                        </div>
                        <Evidence text={pp.evidence} />
                      </div>
                    </label>
                    {(pp.facts.length > 0 || pp.claims.length > 0) && (
                      <div className="mt-2.5 space-y-2 border-t border-nd-line pt-2.5 pl-7">
                        {pp.facts.length > 0 && <div className="text-[13px] font-medium text-nd-fg-2">확인된 사실 후보 (홈페이지 기준)</div>}
                        {pp.facts.map((f, j) => (
                          <SubPick key={`f${j}`} checked={pk.facts[j]} disabled={!pk.on} onChange={(v) => set((x) => void (x.products[i].facts[j] = v))} item={f} label={`「${pp.name}」 사실 ${j + 1}`} />
                        ))}
                        {pp.claims.length > 0 && <div className="pt-1 text-[13px] font-medium text-nd-warning-text">업체 주장 — 사실 칸이 아니라 제품 메모로</div>}
                        {pp.claims.map((f, j) => (
                          <SubPick key={`c${j}`} checked={pk.claims[j]} disabled={!pk.on} onChange={(v) => set((x) => void (x.products[i].claims[j] = v))} item={f} label={`「${pp.name}」 업체 주장 ${j + 1}`} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Group>
        )}

        <Group title="색 후보 (코드로 찾음)" note="theme-color 와 페이지 안 CSS 에 자주 나온 색입니다 — 브랜드 색 확정이 아닙니다. 바깥 CSS 파일은 읽지 않습니다.">
          {p.colors.length ? (
            <PickRow checked={picks.colors} onChange={(v) => set((x) => void (x.colors = v))} label="색 후보를 그 밖의 지시에 넣기">
              <div className="text-[14px] text-nd-fg">「그 밖의 지시」 에 「색 후보(코드로 찾음 · 확인 필요)」 한 줄로 넣기</div>
              <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                {p.colors.map((col) => (
                  <span key={col.hex} className="inline-flex items-center gap-1.5 text-[13px] text-nd-fg-2">
                    <span aria-hidden className="h-4 w-4 shrink-0 rounded-[4px] border border-nd-line" style={{ background: col.hex }} />
                    <span className="font-mono">{col.hex}</span>
                    <span className="text-nd-fg-3">{col.source === "theme-color" ? "theme-color" : `CSS ${col.count}번`}</span>
                  </span>
                ))}
              </div>
            </PickRow>
          ) : (
            <p className="text-[13px] text-nd-fg-3">찾은 색 후보가 없습니다 — 페이지 안 CSS 에 색이 거의 없습니다.</p>
          )}
        </Group>

        <p className="text-[13px] leading-relaxed text-nd-fg-3">
          넣으면 이 주소를 「참고 영상 · 자료 주소」 에 더하고(없을 때만), 「그 밖의 지시」 끝에 「홈페이지에서 읽음 {todayStrKST()}」 한 줄을 남깁니다. 꼭 넣을 것 · 금지 표현은 업체가 정할 일이라 제안하지 않습니다.
        </p>
      </div>
    </Dialog>
  );
}

function SubPick({ checked, disabled, onChange, item, label }: { checked: boolean; disabled: boolean; onChange: (v: boolean) => void; item: Proposal; label: string }) {
  return (
    <label className={cn("flex min-w-0 items-start gap-2.5", disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
      <Checkbox checked={checked && !disabled} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.checked)} className="mt-[3px]" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="break-words text-[14px] text-nd-fg">{item.value}</div>
        <Evidence text={item.evidence} />
      </div>
    </label>
  );
}
