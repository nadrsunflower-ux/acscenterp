"use client";

// ============================================================
//  매물 — 한 장 지도(16곳) · 지역 비교 카드 · 지역 상세 카드 · 전체 표
// ------------------------------------------------------------
//  매물 카드·지도 핀·표의 행은 네이버 부동산 광고를 새 탭으로 연다
//  (<a target="_blank" rel="noopener noreferrer">). 누른 것이 장 넘기기로
//  번지지 않게 전파를 막는다. 매물번호가 둘인 곳은 카드가 첫 번호(1층)를 열고,
//  층별 작은 링크 칩을 따로 둔다. 인쇄본에서는 링크 대신 매물번호를 글자로 쓴다.
//
//  카드 전체를 덮는 링크 안에 칩 링크를 넣으면 <a> 가 겹친다(HTML 규칙 위반).
//  그래서 카드 위에 투명한 덮개 링크를 깔고, 칩은 그 위 층에 둔다.
// ============================================================

import { useEffect, useState, type MouseEvent } from "react";
import { loadDeckAsset } from "@/lib/neander/decks/client";
import * as F from "@/lib/neander/decks/format";
import { INSET, OVERVIEW, distanceM, overviewMaps, place, spreadPins, tilesFor, type MapView } from "@/lib/neander/decks/map";
import { naverArticleUrl, type DeckProperty, type DeckRegion } from "@/lib/neander/decks/types";
import { Md, useSd } from "./context";
import { Icon } from "./icons";

/** 사진·타일 — 로그인 fetch 로 받은 blob URL */
export function useAsset(id: string | null | undefined): string | null | undefined {
  const { slug } = useSd();
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    if (!id) {
      setUrl(null);
      return;
    }
    loadDeckAsset(slug, id).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [slug, id]);
  return url;
}

const stop = (e: MouseEvent) => e.stopPropagation();

/** 매물 광고 목록 — links 가 없으면 매물번호로 만든다 */
export function adLinks(p: DeckProperty): { no: string; label: string; ended?: boolean }[] {
  if (p.links?.length) return p.links;
  return p.articleNos.map((no, i) => ({ no, label: p.articleNos.length > 1 ? `광고 ${i + 1}` : "광고" }));
}

const regionMap = (regions: DeckRegion[]) => new Map(regions.map((r) => [r.id, r]));
export const pinCode = (p: DeckProperty, regions: Map<string, DeckRegion>) => `${regions.get(p.region)?.code ?? ""}${p.no}`;
const regionColor = (r: DeckRegion | undefined) => r?.color ?? "var(--sd-a)";

function Tile({ id, left, top }: { id: string; left: number; top: number }) {
  const url = useAsset(id);
  return url ? <img src={url} alt="" style={{ left, top }} /> : null;
}

function Tiles({ view }: { view: MapView }) {
  return (
    <div className="sd-map-tiles">
      {tilesFor(view).map((t) => (
        <Tile key={t.id} id={t.id} left={t.left} top={t.top} />
      ))}
    </div>
  );
}

function Pin({
  p,
  code,
  color,
  left,
  top,
  print,
}: {
  p: DeckProperty;
  code: string;
  color: string;
  left: number;
  top: number;
  print?: boolean;
}) {
  const ads = adLinks(p);
  const ended = ads[0]?.ended;
  const cls = `sd-pin${p.approx ? " sd-pin-approx" : ""}${ended ? " sd-pin-ended" : ""}`;
  const dot = (
    <>
      <div className="sd-pin-dot" style={{ background: color }}>
        {code}
      </div>
      <div className="sd-pin-stem" />
    </>
  );
  if (print || !ads[0]) {
    return (
      <div className={cls} style={{ left, top }}>
        {dot}
      </div>
    );
  }
  return (
    <a
      className={cls}
      style={{ left, top }}
      href={naverArticleUrl(ads[0].no)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={stop}
      title={`${code} ${p.location} · ${p.money}${ended ? " · 광고 종료" : ""} · 네이버 부동산 광고 열기 ↗`}
    >
      {dot}
    </a>
  );
}

// ============================================================
//  한 장 지도 — 전체 + 현 매장 근처 확대 + 지역 비교 카드
// ============================================================

export function PropertyOverview({ opts }: { opts: Record<string, unknown> }) {
  const { content, print } = useSd();
  const regions = regionMap(content.regions);
  const store = content.currentStore;
  const { main, inset, insetRegions } = overviewMaps(content);
  const outer = content.properties.filter((p) => !insetRegions.has(p.region));
  const near = content.properties.filter((p) => insetRegions.has(p.region));
  const mainPins = spreadPins(
    outer.map((p) => ({ ...place(p, main), p })),
    44,
  );
  // 확대 지역이 전체 지도에서 차지하는 네모
  const nearPts = [...near.map((p) => place(p, main)), place(store, main)];
  const frame = nearPts.length
    ? {
        left: Math.min(...nearPts.map((x) => x.left)) - 16,
        top: Math.min(...nearPts.map((x) => x.top)) - 16,
        right: Math.max(...nearPts.map((x) => x.left)) + 16,
        bottom: Math.max(...nearPts.map((x) => x.top)) + 16,
      }
    : null;
  const insetPins = inset
    ? spreadPins(
        [
          ...near.map((p) => ({ ...place(p, inset), p: p as DeckProperty | null })),
          { ...place(store, inset), p: null as DeckProperty | null },
        ],
        44,
      )
    : [];
  return (
    <div
      className="sd-prop"
      style={{ display: "grid", gridTemplateColumns: `${OVERVIEW.w}px ${INSET.w}px minmax(0, 1fr)`, gap: 16, flex: 1, minHeight: 0 }}
    >
      <div className="sd-mapwrap">
        <div className="sd-map" style={{ width: OVERVIEW.w, height: OVERVIEW.h }}>
          <Tiles view={main} />
          <div className="sd-map-dim" />
          {frame && (
            <>
              <div
                className="sd-inset-frame"
                style={{ left: frame.left, top: frame.top, width: frame.right - frame.left, height: frame.bottom - frame.top }}
              />
              {near.map((p) => {
                const at = place(p, main);
                return (
                  <span
                    key={p.id}
                    aria-hidden
                    style={{
                      position: "absolute",
                      left: at.left - 5,
                      top: at.top - 5,
                      width: 10,
                      height: 10,
                      borderRadius: 999,
                      background: regionColor(regions.get(p.region)),
                      border: "1.5px solid #fff",
                    }}
                  />
                );
              })}
              <div className="sd-map-key" style={{ left: Math.max(8, frame.left - 40), top: frame.bottom + 8 }}>
                {str(opts.frameLabel, "확대 →")}
              </div>
            </>
          )}
          {mainPins.map((x) => (
            <Pin
              key={x.p.id}
              p={x.p}
              code={pinCode(x.p, regions)}
              color={regionColor(regions.get(x.p.region))}
              left={x.left}
              top={x.top}
              print={print}
            />
          ))}
          <div className="sd-map-key">{str(opts.mainLabel, `전체 ${content.properties.length}곳`)}</div>
          <div className="sd-map-attr">© OpenStreetMap contributors</div>
        </div>
      </div>
      {inset && (
        <div className="sd-mapwrap">
          <div className="sd-map" style={{ width: INSET.w, height: INSET.h }}>
            <Tiles view={inset} />
            <div className="sd-map-dim" />
            {insetPins.map((x, i) =>
              x.p ? (
                <Pin
                  key={x.p.id}
                  p={x.p}
                  code={pinCode(x.p, regions)}
                  color={regionColor(regions.get(x.p.region))}
                  left={x.left}
                  top={x.top}
                  print={print}
                />
              ) : (
                <div key={`home${i}`} className="sd-pin sd-pin-home" style={{ left: x.left, top: x.top }} title={store.label}>
                  <div className="sd-pin-dot">현</div>
                  <div className="sd-pin-stem" />
                </div>
              ),
            )}
            <div className="sd-map-key">{str(opts.insetLabel, "현 = 지금 매장")}</div>
            <div className="sd-map-attr">© OpenStreetMap</div>
          </div>
        </div>
      )}
      <RegionCards />
    </div>
  );
}

const str = (x: unknown, d = "") => (typeof x === "string" ? x : d);

/** 지역 비교 카드 — 누르면 그 지역 상세(부록) 장으로 */
function RegionCards() {
  const { content, print } = useSd();
  const go = (slideId?: string) => {
    if (!slideId) return;
    const i = content.slides.findIndex((s) => s.id === slideId);
    if (i >= 0) window.location.hash = `slide-${i + 1}`;
  };
  return (
    <div className="sd-rcards" style={{ gridTemplateRows: `repeat(${content.regions.length}, minmax(0, 1fr))` }}>
      {content.regions.map((r) => {
        const list = content.properties.filter((p) => p.region === r.id);
        const lo = Math.min(...list.map((p) => p.fixedMin ?? Infinity));
        const hi = Math.max(...list.map((p) => p.fixedMax ?? -Infinity));
        const fixed = Number.isFinite(lo) && Number.isFinite(hi) ? (lo === hi ? F.man(lo) : `${F.num(lo)}~${F.man(hi)}`) : "";
        const detail = content.slides.find((s) => s.id === r.detailSlide);
        const body = (
          <>
            <div className="sd-rcard-top">
              <span className="sd-rcard-name">
                <span
                  aria-hidden
                  style={{
                    display: "inline-flex",
                    width: 34,
                    height: 34,
                    borderRadius: 999,
                    background: regionColor(r),
                    color: "#fff",
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: 10,
                    verticalAlign: 3,
                  }}
                  className="sd-lbl-s"
                >
                  <b style={{ color: "#fff" }}>{r.code}</b>
                </span>
                {r.name}
              </span>
              <span className="sd-rcard-fixed">{fixed ? `월 ${fixed}` : ""}</span>
            </div>
            <div className="sd-rcard-brief">
              <Md text={r.brief ?? r.verdict} />
              {detail && !print && <span className="sd-ext">{`${detail.no} →`}</span>}
            </div>
          </>
        );
        return print || !detail ? (
          <div key={r.id} className="sd-rcard" style={{ borderLeftColor: regionColor(r), cursor: "default" }} data-box>
            {body}
          </div>
        ) : (
          <button
            key={r.id}
            type="button"
            className="sd-rcard"
            style={{ borderLeftColor: regionColor(r) }}
            onClick={(e) => {
              e.stopPropagation();
              go(r.detailSlide);
            }}
            title={`${r.name} 상세 (${detail.no})로 가기`}
            data-box
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================
//  지역 상세 — 매물 카드 네 장 (사진 · 조건 · 층별 광고 링크)
// ============================================================

function Photo({ p, code, color }: { p: DeckProperty; code: string; color: string }) {
  const url = useAsset(p.photo ?? null);
  const ended = adLinks(p)[0]?.ended;
  return (
    <div className="sd-pcard-photo">
      {url ? <img src={url} alt="" /> : <div className="sd-nophoto">{url === null ? "사진 없음" : ""}</div>}
      <div className="sd-pcard-no" style={{ background: color }}>
        {code}
      </div>
      {ended && <span className="sd-pill sd-tone-bad sd-pcard-ended">광고 종료</span>}
    </div>
  );
}

export function PropertyCards({ opts }: { opts: Record<string, unknown> }) {
  const { content, print } = useSd();
  const regions = regionMap(content.regions);
  const region = regions.get(str(opts.region));
  const list = content.properties.filter((p) => p.region === region?.id).sort((a, b) => a.no - b.no);
  if (!region) return null;
  const store = content.currentStore;
  return (
    <div className="sd-pcards" style={{ gridTemplateColumns: `repeat(${list.length}, minmax(0, 1fr))` }}>
      {list.map((p) => {
        const ads = adLinks(p);
        const code = pinCode(p, regions);
        const far = !p.walk ? distanceM(store, p) : 0;
        return (
          <div key={p.id} className="sd-pcard" data-box>
            {!print && ads[0] && (
              <a
                className="sd-pcard-cover"
                href={naverArticleUrl(ads[0].no)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={stop}
                aria-label={`${code} ${p.location} 네이버 부동산 광고 열기`}
                title="네이버 부동산 광고 열기 ↗"
              >
                <span className="sd-pcard-go">
                  <Icon name="arrow" size={18} />
                </span>
              </a>
            )}
            <Photo p={p} code={code} color={regionColor(region)} />
            <div className="sd-pcard-body">
              <div className="sd-pcard-loc">{p.location}</div>
              <div className="sd-pcard-meta">{`${p.layout} · ${p.walk ?? `지금 매장에서 약 ${F.num(far / 1000, 1)}km`}`}</div>
              <div className="sd-pcard-money">
                {p.money} <span style={{ fontWeight: 500, color: "var(--sd-fg3)" }}>만원</span>
              </div>
              <div className="sd-pcard-feat">{p.feature}</div>
              <div className="sd-links">
                {ads.map((ad) =>
                  print ? (
                    <span key={ad.no} className="sd-link-chip">
                      {`${ad.label} ${ad.no}${ad.ended ? " (종료)" : ""}`}
                    </span>
                  ) : (
                    <a
                      key={ad.no}
                      className="sd-link-chip"
                      href={naverArticleUrl(ad.no)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={stop}
                      title={`매물번호 ${ad.no}${ad.ended ? " · 광고 종료" : ""}`}
                    >
                      {ad.label}
                      {ad.ended ? " (종료)" : ""} ↗
                    </a>
                  ),
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
//  매물 전체 표 — 행을 누르면 첫 광고, 층별 광고는 칩
// ============================================================

export function PropertyTable({ opts }: { opts: Record<string, unknown> }) {
  const { content, print } = useSd();
  const regions = regionMap(content.regions);
  const only = (opts.regions as string[] | undefined) ?? null;
  const list = content.properties.filter((p) => !only || only.includes(p.region));
  const head = ["매물", "구성", "보증금/월세 (월 고정)", "네이버 광고"];
  const widths = [1.6, 1.75, 1.55, 1.1];
  const total = widths.reduce((s, w) => s + w, 0);
  return (
    <div className="sd-table-wrap" data-box>
      <table className="sd-table">
        <colgroup>
          {widths.map((w, i) => (
            <col key={i} style={{ width: `${(w / total) * 100}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.map((p) => {
            const ads = adLinks(p);
            const url = ads[0] ? naverArticleUrl(ads[0].no) : null;
            const cell = (content: React.ReactNode, first = false) =>
              print || !url ? (
                content
              ) : (
                <a
                  className="sd-rowlink"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={stop}
                  tabIndex={first ? 0 : -1}
                  style={{ display: "block" }}
                >
                  {content}
                  {first && <span className="sd-ext">↗</span>}
                </a>
              );
            return (
              <tr key={p.id} className={print ? undefined : "sd-link-row"}>
                <td>
                  {cell(
                    <>
                      <b style={{ color: regionColor(regions.get(p.region)) }}>{pinCode(p, regions)}</b> {p.location}
                    </>,
                    true,
                  )}
                </td>
                <td>{cell(p.layout)}</td>
                <td>{cell(p.money)}</td>
                <td>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {ads.map((ad) =>
                      print ? (
                        <span key={ad.no} className="sd-lbl-s">
                          {`${ad.no}${ad.ended ? " (종료)" : ""}`}
                        </span>
                      ) : (
                        <a
                          key={ad.no}
                          className="sd-link-chip"
                          href={naverArticleUrl(ad.no)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={stop}
                          title={`매물번호 ${ad.no}`}
                        >
                          {ad.label.replace(/\s*광고$/, "") || "광고"}
                          {ad.ended ? " (종료)" : ""} ↗
                        </a>
                      ),
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
