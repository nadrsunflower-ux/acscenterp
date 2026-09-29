// ============================================================
//  장표 지도 — 웹 메르카토르 좌표와 OSM 타일 계산 (순수 함수)
// ------------------------------------------------------------
//  지도 라이브러리를 들이지 않는다. 핀 몇 개를 찍는 정적 지도라 타일
//  몇 장을 이어 붙이고 좌표를 픽셀로 바꾸면 충분하다.
//
//  타일은 장표를 올릴 때 한 번 받아 Firestore 에 둔다(외부 링크에 기대지
//  않는다). 받을 타일과 화면에 그릴 타일이 어긋나지 않게 두 쪽이 모두
//  fitMap · tilesFor 를 쓴다. 지도 크기(MAP_W×MAP_H)를 바꾸면 타일을
//  다시 받아야 한다.
// ============================================================

export const TILE = 256;
export const MAP_W = 520;
export const MAP_H = 520;
export const MAP_PAD = 64;
export const MAP_MAX_ZOOM = 18;

export interface LatLng {
  lat: number;
  lng: number;
}

/** 위경도 → 확대 수준 z 의 세계 픽셀 */
export function toWorld(p: LatLng, z: number): { x: number; y: number } {
  const scale = TILE * 2 ** z;
  const sin = Math.sin((p.lat * Math.PI) / 180);
  return {
    x: ((p.lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

export interface MapView {
  z: number;
  /** 지도 왼쪽 위의 세계 픽셀 */
  ox: number;
  oy: number;
  w: number;
  h: number;
}

/** 점들이 여백 안에 다 들어가는 가장 큰 확대 수준과 가운데 */
export function fitMap(points: LatLng[], w = MAP_W, h = MAP_H, pad = MAP_PAD, maxZoom = MAP_MAX_ZOOM): MapView {
  for (let z = maxZoom; z >= 3; z--) {
    const px = points.map((p) => toWorld(p, z));
    const minX = Math.min(...px.map((p) => p.x));
    const maxX = Math.max(...px.map((p) => p.x));
    const minY = Math.min(...px.map((p) => p.y));
    const maxY = Math.max(...px.map((p) => p.y));
    // 핀은 점 위로 솟으므로 위쪽 여백을 조금 더 둔다
    if (maxX - minX <= w - 2 * pad && maxY - minY <= h - 2 * pad - 20) {
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2 - 10;
      return { z, ox: Math.round(cx - w / 2), oy: Math.round(cy - h / 2), w, h };
    }
  }
  const p = toWorld(points[0], 3);
  return { z: 3, ox: Math.round(p.x - w / 2), oy: Math.round(p.y - h / 2), w, h };
}

/** 지도에 걸치는 타일 목록과 화면 위치 */
export function tilesFor(v: MapView): { x: number; y: number; left: number; top: number; id: string }[] {
  const out: { x: number; y: number; left: number; top: number; id: string }[] = [];
  const x0 = Math.floor(v.ox / TILE);
  const y0 = Math.floor(v.oy / TILE);
  const x1 = Math.floor((v.ox + v.w - 1) / TILE);
  const y1 = Math.floor((v.oy + v.h - 1) / TILE);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      out.push({ x, y, left: x * TILE - v.ox, top: y * TILE - v.oy, id: tileId(v.z, x, y) });
    }
  }
  return out;
}

export const tileId = (z: number, x: number, y: number) => `tile-${z}-${x}-${y}`;

/** 점 → 지도 안 픽셀 */
export function place(p: LatLng, v: MapView): { left: number; top: number } {
  const w = toWorld(p, v.z);
  return { left: w.x - v.ox, top: w.y - v.oy };
}

/** 두 점 사이 거리 (m) */
export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** 겹치는 핀을 옆으로 밀어낸다 — 가까운 두 매물이 한 점으로 보이지 않게 */
export function spreadPins<T extends { left: number; top: number }>(pins: T[], minGap = 34): T[] {
  const out = pins.map((p) => ({ ...p }));
  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const dx = out[j].left - out[i].left;
        const dy = out[j].top - out[i].top;
        if (Math.hypot(dx, dy) < minGap) {
          const push = (minGap - Math.abs(dx)) / 2 + 1;
          const dir = dx >= 0 ? 1 : -1;
          out[i].left -= dir * push;
          out[j].left += dir * push;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return out;
}

// ---- 매물 16곳 한 장 지도 --------------------------------------
//  전체 지도(모든 매물 + 현 매장)와, 현 매장 근처 지역만 크게 본 확대 지도.
//  화면(property.tsx)과 타일 받기(upload-deck)가 같은 값을 써야 타일이 맞는다.

export const OVERVIEW = { w: 560, h: 540, pad: 56, maxZoom: 16 };
export const INSET = { w: 330, h: 540, pad: 46, maxZoom: 18 };

export interface OverviewInput {
  properties: { region: string; lat: number; lng: number }[];
  regions: { id: string; inset?: boolean }[];
  currentStore: LatLng;
}

export function overviewMaps(c: OverviewInput): { main: MapView; inset: MapView | null; insetRegions: Set<string> } {
  const insetRegions = new Set(c.regions.filter((r) => r.inset).map((r) => r.id));
  const all = [...c.properties.map((p) => ({ lat: p.lat, lng: p.lng })), c.currentStore];
  const main = fitMap(all, OVERVIEW.w, OVERVIEW.h, OVERVIEW.pad, OVERVIEW.maxZoom);
  const near = [...c.properties.filter((p) => insetRegions.has(p.region)).map((p) => ({ lat: p.lat, lng: p.lng })), c.currentStore];
  const inset = insetRegions.size ? fitMap(near, INSET.w, INSET.h, INSET.pad, INSET.maxZoom) : null;
  return { main, inset, insetRegions };
}

/** 한 장 지도에 필요한 타일 */
export function overviewTileIds(c: OverviewInput): string[] {
  const { main, inset } = overviewMaps(c);
  return [...tilesFor(main), ...(inset ? tilesFor(inset) : [])].map((t) => t.id);
}
