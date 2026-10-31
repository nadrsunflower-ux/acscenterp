// ============================================================
//  AI STUDIO 디자인 검증용 가상 운영 데이터 — 브라우저에만 보낸다 (DB · 외부 호출 없음)
// ------------------------------------------------------------
//    npx tsx e2e/shorts-design-fixture.ts <출력 폴더> [--me=이메일] [--variant=populated|empty|error]
//  보통은 e2e/shorts-design-ui.mjs 가 부른다. 쓰는 파일(출력 폴더 안만):
//    data.json    GET /api/neander/shorts/data 응답 (ShortsData)
//    scout.json   GET /api/neander/shorts/scout 응답 (ScoutData)
//    media.json   파일 목록 { items: [{ view: MediaView, draw }], thumbs: [{ name, draw }] } — draw 는 화면 쪽 그리기 설계도
//    jobs.json    { jobs: JobView[] } (GET jobs?projectId= 는 이것을 거른다)
//    review.json  공개 검토 화면 응답 (media 칸은 파일을 만든 뒤 하네스가 채운다)
//  시나리오: ~/Downloads/AI_STUDIO_가상운영_27페이지_목업_20261031/공통_가상데이터_설정.txt
//  지킬 것 — 공개되지 않은 저장 · 공유 · DM 은 null(모름)이지 0 이 아니다. 해외 원본 소재 반응(128만)과
//  우리가 만든 영상 성과(8.42만)는 따로 둔다. 게시 계정은 연결 전(accounts: []). 실제 키 · 실제 링크 없음.
// ============================================================

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_WEIGHTS,
  buildCaption,
  emptyAnalysis,
  emptyDomestic,
  emptyMetrics,
  emptyProject,
  overlayFor,
  scriptHash,
  systemChecks,
  timelineSec,
} from "../lib/neander/shorts/model";
import { DEFAULT_SCOUT_SETTINGS } from "../lib/neander/shorts/scout";
import type { FormatDoc, HitAnalysis, HitDoc, ReportFormatLine, ScoutReportDoc, WatchChannelDoc } from "../lib/neander/shorts/scout";
import type {
  BeatKey,
  ClientView,
  ComplianceCheck,
  ComplianceKey,
  CostEntry,
  JobView,
  Measured,
  MediaView,
  MetricSnapshotView,
  ProfileView,
  ProjectDoc,
  ProjectStage,
  PublicationView,
  ReviewRound,
  Scene,
  ScriptLine,
  SourceClip,
  TemplateDoc,
  TrendDoc,
} from "../lib/neander/shorts/types";
import type { ShortsData, WithId } from "../components/neander/shorts/ShortsProvider";
import type { ScoutData } from "../components/neander/shorts/scout/useScout";

// ---- 인자 ---------------------------------------------------------------

const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith("--"));
if (!outDir) throw new Error("사용법: npx tsx e2e/shorts-design-fixture.ts <출력 폴더> [--me=이메일] [--variant=populated|empty|error]");
const opt = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const ME = (opt("me") || "ldongju33@gmail.com").toLowerCase();
const VARIANT = opt("variant") || "populated";

// ---- 시각 (시나리오 기준 2026-10-31 16:00 KST) ------------------------------

const kst = (s: string) => Date.parse(`${s}+09:00`);
const NOW = kst("2026-10-31T16:00:00");
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const USD_KRW = 1400;
const iso = (ms: number) => new Date(ms).toISOString();

// ---- 그리기 설계도 (화면 쪽 생성기 e2e/shorts-design-ui.mjs 가 해석) ---------------

export type Cue = { start: number; end: number; text: string };
export type Draw =
  | { type: "video"; w: number; h: number; fps: number; parts: { scene: string; sec: number; opt?: Record<string, unknown> }[]; cues?: Cue[]; overlay?: string; mark?: string }
  | { type: "image"; w: number; h: number; scene: string; opt?: Record<string, unknown> }
  | { type: "audio"; seconds: number };

const items: { view: MediaView; draw: Draw }[] = [];
const thumbs: { name: string; draw: Draw }[] = [];

function media(
  id: string,
  m: { projectId?: string; clientId?: string | null; kind: MediaView["kind"]; name: string; createdAt: number; origin?: MediaView["origin"]; overlay?: MediaView["overlay"] },
  draw: Draw,
): string {
  const video = draw.type === "video";
  const seconds = draw.type === "video" ? draw.parts.reduce((n, p) => n + p.sec, 0) : draw.type === "audio" ? draw.seconds : null;
  items.push({
    view: {
      id,
      owner: ME,
      projectId: m.projectId ?? "",
      clientId: m.clientId ?? null,
      kind: m.kind,
      name: m.name,
      type: draw.type === "video" ? "video/mp4" : draw.type === "image" ? "image/jpeg" : "audio/wav",
      size: 0, // 파일을 만든 뒤 하네스가 실제 크기로 채운다
      duration: seconds,
      width: draw.type === "audio" ? null : draw.w,
      height: draw.type === "audio" ? null : draw.h,
      createdAt: m.createdAt,
      origin: m.origin ?? null,
      codecs: video ? { video: "avc", audio: m.kind === "render" ? "aac" : null } : null, // 완성 파일만 소리 트랙 (무음)
      overlay: m.overlay ?? null,
    },
    draw,
  });
  return id;
}

const video = (parts: { scene: string; sec: number; opt?: Record<string, unknown> }[], extra: Partial<Extract<Draw, { type: "video" }>> = {}): Draw => ({
  type: "video",
  w: 720,
  h: 1280,
  fps: 15,
  parts,
  ...extra,
});
const image = (scene: string, opt: Record<string, unknown> = {}, w = 900, h = 900): Draw => ({ type: "image", w, h, scene, opt });

// ---- 작은 도구 ------------------------------------------------------------

const BEAT_LABEL: Record<BeatKey, string> = { hook: "후킹", problem: "문제 제기", empathy: "공감", reveal: "제품 등장", demo: "사용 장면", compare: "비교", twist: "반전", proof: "근거", cta: "CTA" };
const m = (v: number | null, src: Measured["src"] = "manual", ref?: string, at?: number): Measured => ({ v, src, ...(ref ? { ref } : {}), ...(at ? { at } : {}) });
const cost = (id: string, kind: CostEntry["kind"], usd: number | null, note: string, at: number, auto = true, minutes: number | null = null): CostEntry => ({
  id,
  kind,
  usd,
  krw: usd === null ? null : Math.round(usd * USD_KRW),
  minutes,
  note,
  at,
  by: ME,
  auto,
});
const labor = (id: string, minutes: number, note: string, at: number): CostEntry => ({ id, kind: "labor", usd: null, krw: null, minutes, note, at, by: ME, auto: false });

function lines(prefix: string, defs: [BeatKey, string, string?][], sceneIds: (string | null)[]): ScriptLine[] {
  return defs.map(([beat, text, caption], i) => ({ id: `${prefix}-ln${i + 1}`, beat, text, caption: caption ?? "", sceneId: sceneIds[i] ?? null }));
}

function cuesOf(ls: ScriptLine[], scenes: Scene[]) {
  let t = 0;
  const startOf = new Map<string, [number, number]>();
  for (const s of scenes) {
    startOf.set(s.id, [t, t + s.duration]);
    t += s.duration;
  }
  return ls.map((l) => {
    const [start, end] = startOf.get(l.sceneId ?? "") ?? [0, 0];
    return { start, end, text: (l.caption || l.text).trim(), lineId: l.id };
  });
}

const clip = (id: string, label: string, fileId: string, start: number, end: number, sourceId: string | null = null, segmentId: string | null = null): Scene => ({
  id,
  kind: "clip",
  label,
  duration: Math.round((end - start) * 1000) / 1000,
  clip: { fileId, start, end, sourceId, segmentId },
  ai: null,
  image: null,
  keepAudio: false,
});
const aiScene = (id: string, label: string, duration: number, prompt: string, status: NonNullable<Scene["ai"]>["status"], fileId: string | null, jobId: string | null, reviewNote: string): Scene => ({
  id,
  kind: "ai",
  label,
  duration,
  clip: null,
  ai: { prompt, status, jobId, fileId, model: fileId ? "google/veo-3.1-lite" : null, reviewNote },
  image: null,
  keepAudio: false,
});
const imgScene = (id: string, label: string, duration: number, fileId: string): Scene => ({ id, kind: "image", label, duration, clip: null, ai: null, image: { fileId }, keepAudio: false });

// ============================================================
//  게시 원장 · 성과 · 작업 (프로젝트를 만들며 함께 쌓는다)
// ============================================================

const publications: PublicationView[] = [];
const metrics: MetricSnapshotView[] = [];
const jobs: JobView[] = [];

function job(id: string, projectId: string, kind: JobView["kind"], status: JobView["status"], at: number, message: string, extra: Partial<JobView> = {}): JobView {
  const done = ["succeeded", "failed", "cancelled", "uncertain", "interrupted"].includes(status);
  const j: JobView = {
    id,
    owner: ME,
    projectId,
    kind,
    runner: kind === "render" ? "browser" : "server",
    status,
    step: done ? "done" : "start",
    stepState: "idle",
    runAt: at - 10 * MIN,
    leaseUntil: 0,
    attempts: 1,
    progress: { pct: status === "succeeded" ? 100 : status === "failed" ? 64 : 0, message },
    input: {},
    result: status === "succeeded" ? { note: "가상 예시 — 실제 작업 아님" } : null,
    error: null,
    cancelRequested: false,
    createdAt: at - 12 * MIN,
    updatedAt: at,
    finishedAt: done ? at : null,
    log: [
      { at: at - 12 * MIN, msg: "대기열에 넣음 (가상 예시)" },
      { at, msg: message },
    ],
    dedupeKey: null,
    ...extra,
  };
  jobs.push(j);
  return j;
}

const PLANNED_ACCOUNT = { youtube: "planned-youtube-mine", instagram: "planned-instagram-mine" } as const;

function pub(
  id: string,
  projectId: string,
  platform: "youtube" | "instagram",
  renderId: string,
  status: PublicationView["status"],
  at: number,
  title: string,
  extra: Partial<PublicationView> = {},
): PublicationView {
  const p: PublicationView = {
    id,
    owner: ME,
    projectId,
    accountId: PLANNED_ACCOUNT[platform],
    platform,
    renderId,
    status,
    scheduledAt: null,
    jobId: null,
    meta: { title, caption: "", privacy: "public", madeForKids: false, synthetic: true },
    compliance: {},
    result: null,
    error: null,
    history: [{ at, status, msg: status === "published" ? "수동 기록 · 가상 예시 (게시 계정 연결 전)" : status === "scheduled" ? "가상 계획 · 연결 전 실행 불가" : "가상 예시", by: ME }],
    attempts: status === "scheduled" ? 0 : 1,
    createdAt: at - HOUR,
    updatedAt: at,
    ...extra,
  };
  publications.push(p);
  return p;
}

function published(id: string, projectId: string, platform: "youtube" | "instagram", renderId: string, at: number, title: string, memo: string) {
  return pub(id, projectId, platform, renderId, "published", at, title, {
    result: { externalId: `manual-${id}`, url: `https://example.com/mock/${platform}/${id}`, at, by: "manual" },
    history: [
      { at: at - 20 * MIN, status: "queued", msg: "수동 게시 준비 (가상 예시)", by: ME },
      { at, status: "published", msg: `수동 기록 · 가상 예시 — ${memo}`, by: ME },
    ],
  });
}

function snap(id: string, projectId: string, publicationId: string | null, platform: MetricSnapshotView["platform"], at: number, values: MetricSnapshotView["values"], note: string) {
  metrics.push({ id, owner: ME, projectId, publicationId, platform, at, source: "manual", values, note, by: ME });
}

// ============================================================
//  성공 공식 4개
// ============================================================

function template(id: string, name: string, totalSec: number, beats: [BeatKey, number, number, string, string][], hookPattern: string, cta: TemplateDoc["cta"], reveal: number, avgShot: number, originProject: string | null, updatedAt: number, notes: string): WithId<TemplateDoc> {
  return {
    id,
    owner: ME,
    visibility: "team",
    createdAt: updatedAt - 3 * DAY,
    updatedAt,
    updatedBy: ME,
    name,
    beats: beats.map(([key, from, to, summary, pattern]) => ({ key, label: BEAT_LABEL[key], from, to, summary, pattern })),
    totalSec,
    avgShotSec: avgShot,
    productRevealRatio: reveal,
    narrationSubtitle: "same",
    hookPattern,
    cta,
    notes,
    origin: { projectId: originProject, versionId: null, basis: ["transcript", "timing"] },
    sample: false,
  };
}

const templates: WithId<TemplateDoc>[] = [
  template("tpl-f001", "F-001 문제공감 → 사용시연 (20초)", 20, [
    ["hook", 0, 0.2, "물튐 · 불편한 순간을 첫 4초에", "{문제 상황}, 늘 이렇죠?"],
    ["problem", 0.2, 0.4, "불편을 공감하게 — 젖은 앞치마 · 닦는 손", "{불편}, 매번 번거롭죠."],
    ["demo", 0.4, 0.75, "제품을 펼치고 접는 실제 사용 장면", "{상품}을 펼쳐 두고, 다 쓰면 접어 두세요."],
    ["cta", 0.75, 1, "치수 확인 + 고정 댓글 안내", "우리 집 {치수}를 확인하고 고정 댓글에서 옵션을 보세요."],
  ], "물튀는 순간을 첫 1초에 — 「설거지할 때, 옷 앞이 늘 젖나요?」", { type: "pinned_comment", keyword: "물막이", wording: "싱크대 앞 길이 확인하고 고정댓글에서 옵션을 보세요.", atSec: 15 }, 0.4, 5, "mock-shopping", NOW - 2 * DAY, "A-001 v1 수동 성과(가상 예시) 기준 · 정보 요청률 0.30% · 클릭률 2.00%."),
  template("tpl-f002", "F-002 전후비교 → 반전 (24초)", 24, [
    ["hook", 0, 0.125, "어질러진 공간을 먼저 보여 주기", "{공간}, 이렇게 꽉 차 있나요?"],
    ["compare", 0.125, 0.5, "정리 전 · 후를 같은 구도로", "{상품} 하나로 전과 후가 이렇게 달라요."],
    ["twist", 0.5, 0.75, "접으면 사라지는 반전", "다 쓰면 접어서 틈에 쏙."],
    ["cta", 0.75, 1, "크기 확인 안내", "우리 집 {치수}부터 재 보세요."],
  ], "정리 전 장면을 0.5초 안에 — 「이 틈, 그냥 두셨죠?」", { type: "comment_keyword", keyword: "수납", wording: "제품 정보가 궁금하면 댓글에 「수납」을 남겨 주세요.", atSec: 18 }, 0.25, 3.4, "shop-a002", NOW - 4 * DAY, "접기 전후 공간 반전 형식 카드(정찰)와 연결된 공식입니다."),
  template("tpl-f003", "F-003 손동작 ASMR (18초)", 18, [
    ["hook", 0, 0.17, "손이 바로 물건을 집는 소리", "(소리만) {상품}을 꺼내는 손"],
    ["demo", 0.17, 0.83, "말 없이 손동작 · 정리 소리만", "{상품}으로 하나씩 제자리에."],
    ["cta", 0.83, 1, "자막 한 줄로 안내", "정리 도구 정보는 고정 댓글에."],
  ], "말 없이 손동작과 소리로 시작 — 자막 최소", { type: "pinned_comment", keyword: "", wording: "정리 도구 정보는 고정 댓글에 있어요.", atSec: 15 }, 0.17, 2.6, "shop-a003", NOW - 6 * DAY, "언어 의존이 낮아 해외 형식을 그대로 옮기기 좋습니다."),
  template("tpl-f004", "F-004 일상루틴 → 제품등장 (20초)", 20, [
    ["hook", 0, 0.2, "하루 루틴의 한 장면 (얼굴 없이 손 · 소품)", "{시간대}, 가볍게 한 번"],
    ["empathy", 0.2, 0.4, "루틴 속 작은 고민", "{고민}, 챙기기 번거롭죠."],
    ["reveal", 0.4, 0.75, "제품이 자연스럽게 등장", "{상품}, 가방 속에 쏙."],
    ["cta", 0.75, 1, "제품명 자막 + 상세 안내", "{상품명}, 제품 상세에서 확인해 보세요."],
  ], "출근 · 외출 직전의 손 — 「출근 전, 가볍게 한 번」", { type: "description_link", keyword: "", wording: "제품 상세에서 향 설명을 확인해 보세요.", atSec: 15 }, 0.4, 4, "mock-brand", NOW - DAY, "브랜드 영상용 — 효능 · 지속시간 주장 없이 루틴과 제품명만."),
];

// ============================================================
//  고객사 3곳
// ============================================================

const photo = (clientId: string, id: string, name: string, product: string, angle: number, at: number) =>
  media(id, { clientId, kind: "image", name, createdAt: at }, image("perfume-product", { product, angle }));

const citrusPhotos = [0, 1, 2].map((i) => photo("mock-client", `photo-citrus-${i + 1}`, `ONSCENT_citrus_woody_${["front", "box", "hand"][i]}.jpg`, "citrus", i, NOW - 9 * DAY + i * MIN));
const greenPhotos = [0, 1, 2].map((i) => photo("mock-client", `photo-green-${i + 1}`, `ONSCENT_greentea_musk_${["front", "box", "hand"][i]}.jpg`, "greentea", i, NOW - 9 * DAY + (i + 3) * MIN));
const miniPhotos = [0, 1, 2].map((i) => photo("mock-client", `photo-mini-${i + 1}`, `ONSCENT_mini_discovery_${["set", "open", "top"][i]}.jpg`, "mini", i, NOW - 9 * DAY + (i + 6) * MIN));
const lumiPhotos = [0, 1].map((i) => media(`photo-lumi-${i + 1}`, { clientId: "client-lumihome", kind: "image", name: `LUMIHOME_lamp_${i + 1}.jpg`, createdAt: NOW - 5 * DAY }, image("item", { item: "lamp", hue: 38, angle: i })));
const monoPhotos = [media("photo-mono-1", { clientId: "client-monoliving", kind: "image", name: "MONO_shelf_1.jpg", createdAt: NOW - 3 * DAY }, image("item", { item: "shelf", hue: 210 }))];

const clients: ClientView[] = [
  {
    id: "mock-client",
    name: "온센트",
    status: "active",
    members: [ME],
    createdBy: ME,
    createdAt: NOW - 40 * DAY,
    updatedAt: NOW - 2 * HOUR,
    updatedBy: ME,
    canEdit: true,
    contactName: "김민아(가상)",
    contract: {
      monthlyFeeKrw: 2_400_000,
      vat: "excluded",
      videosPerMonth: 8,
      revisionLimit: 2,
      startMonth: "2026-10",
      endMonth: "2027-03",
      financeCode: "PJ-2610-ONSCENT (가상)",
      note: "월 8편 · 편당 수정 2회 · 2026-10 ~ 2027-03. 고객사 담당 김민아(가상) mina@example.com · 우리 담당 이동주. 가상 운영 데이터 · 목업 예시.",
    },
    brief: {
      summary: "온센트 시트러스 우디 30mL를 출근 루틴 속 10초로 보여 주는 세로 영상. 얼굴 없이 손 · 손목 · 제품 위주로, 담백한 사용 후기 톤.",
      target: "20~30대 출근러 — 가방에 넣어 다니는 작은 향수를 찾는 사람",
      tone: "담백한 사용 후기 · 과장 없이",
      keyMessages: ["휴대성 — 가방 속 30mL", "출근 루틴 속 10초"],
      mustInclude: ["제품명 「온센트 시트러스 우디 30mL」 자막", "마지막 1초 제품 클로즈업"],
      banned: ["최저가", "1위", "치료", "효과 보장", "하루 종일 지속"],
      references: ["https://example.com/onscent/brand-guide (목업)"],
      notes: "확인 사실: 30mL · 휴대용 · 시트러스·우디 향조. 지속시간 · 의학적 효능 주장 금지. 게시 예정 계정 @onscent_official (예시 계획 · 연결 필요).",
    },
    products: [
      {
        id: "pd-citrus",
        name: "온센트 시트러스 우디 30mL",
        url: "https://example.com/onscent/citrus-woody-30 (목업)",
        facts: ["용량 30mL", "휴대용 투명 사각병 · 검정 뚜껑", "향조: 시트러스 · 우디", "크림색 상자 · 작은 흰 라벨"],
        photoIds: citrusPhotos,
        note: "실사진 3장 (목업 예시) — AI 장면과 병 모양 · 뚜껑 색을 견줘 보세요.",
      },
      {
        id: "pd-greentea",
        name: "온센트 그린티 머스크 30mL",
        url: "https://example.com/onscent/greentea-musk-30 (목업)",
        facts: ["용량 30mL", "휴대용 투명 사각병 · 검정 뚜껑", "향조: 그린티 · 머스크"],
        photoIds: greenPhotos,
        note: "실사진 3장 (목업 예시)",
      },
      {
        id: "pd-mini",
        name: "온센트 미니 디스커버리 세트",
        url: "https://example.com/onscent/mini-discovery (목업)",
        facts: ["5mL × 4종 구성", "베이지 리본 선물 상자"],
        photoIds: miniPhotos,
        note: "실사진 3장 (목업 예시) — 리본 색은 베이지",
      },
    ],
  },
  {
    id: "client-lumihome",
    name: "루미홈",
    status: "active",
    members: [ME],
    createdBy: ME,
    createdAt: NOW - 12 * DAY,
    updatedAt: NOW - 3 * DAY,
    updatedBy: ME,
    canEdit: true,
    contactName: "박서준(가상)",
    contract: { monthlyFeeKrw: 1_800_000, vat: "excluded", videosPerMonth: 6, revisionLimit: 2, startMonth: "2026-11", endMonth: "2027-04", financeCode: "PJ-2611-LUMIHOME (가상)", note: "11월 시작 · 준비 중 (가상 예시)" },
    brief: { summary: "무드등 · 조명 소품 브랜드. 저녁 루틴 속 조명 연출.", target: "1인 가구 20~30대", tone: "차분하게", keyMessages: ["저녁 10분 무드"], mustInclude: ["제품명 자막"], banned: ["최저가", "1위"], references: [], notes: "11월 첫 영상 준비 중 (가상 예시)" },
    products: [{ id: "pd-lumi-lamp", name: "루미홈 무드등 미니", url: "", facts: ["USB-C 충전", "3단계 밝기"], photoIds: lumiPhotos, note: "실사진 2장 (목업 예시)" }],
  },
  {
    id: "client-monoliving",
    name: "모노리빙",
    status: "active",
    members: [ME],
    createdBy: ME,
    createdAt: NOW - 6 * DAY,
    updatedAt: NOW - DAY,
    updatedBy: ME,
    canEdit: true,
    contactName: "최유나(가상)",
    contract: { monthlyFeeKrw: 1_200_000, vat: "excluded", videosPerMonth: 4, revisionLimit: 1, startMonth: "2026-11", endMonth: null, financeCode: "", note: "11월 시작 · 계약 4편 준비 중 (가상 예시)" },
    brief: { summary: "모듈 선반 브랜드.", target: "자취방 정리", tone: "깔끔하게", keyMessages: ["공구 없이 조립"], mustInclude: [], banned: ["최저가"], references: [], notes: "" },
    products: [{ id: "pd-mono-shelf", name: "모노리빙 모듈 선반 3단", url: "", facts: ["공구 없이 조립", "3단 구성"], photoIds: monoPhotos, note: "실사진 1장 (목업 예시)" }],
  },
];

// ============================================================
//  영상 20편 — 쇼핑 12 + 브랜드 8
// ============================================================

const projects: WithId<ProjectDoc>[] = [];

function base(id: string, title: string, product: string, category: string, stage: ProjectStage, mode: ProjectDoc["mode"], updatedAt: number, extra: Partial<ProjectDoc> = {}): WithId<ProjectDoc> {
  const p: WithId<ProjectDoc> = { ...emptyProject(ME, { title, product, category }, updatedAt - 7 * DAY), id };
  p.updatedAt = updatedAt;
  p.stage = stage;
  p.mode = mode;
  Object.assign(p, extra);
  projects.push(p);
  return p;
}

function withCompliance(p: ProjectDoc, renderId: string | null, users: Partial<Record<ComplianceKey, string>>, banned: string[] = []) {
  const r = renderId ? items.find((x) => x.view.id === renderId)?.view ?? null : null;
  const sys = systemChecks(p, buildCaption(p, "youtube"), null, r ? { id: r.id, overlay: r.overlay } : null, NOW - 30 * MIN, banned);
  const out: Partial<Record<ComplianceKey, ComplianceCheck>> = {};
  for (const [k, v] of Object.entries(sys) as [ComplianceKey, ComplianceCheck["system"]][]) out[k] = { system: v, user: null };
  for (const [k, note] of Object.entries(users) as [ComplianceKey, string][]) out[k] = { system: out[k]?.system ?? null, user: { ok: true, by: ME, at: NOW - 40 * MIN, note } };
  p.compliance = out;
}

// ---- 대표 쇼핑 영상 A-001 (mock-shopping) ----------------------------------

{
  const id = "mock-shopping";
  const T = (h: string) => kst(`2026-10-${h}`);
  const src1 = media("src-a001-1", { projectId: id, kind: "source", name: "sink_demo_01.mp4", createdAt: T("27T15:10:00") }, video([{ scene: "sink-splash", sec: 32, opt: { watermark: "小红书 @小家日记" } }], { fps: 12, mark: "원본 소스 예시" }));
  const src2 = media("src-a001-2", { projectId: id, kind: "source", name: "fold_test_02.mp4", createdAt: T("27T15:20:00") }, video([{ scene: "sink-fold", sec: 24, opt: { watermark: "抖音 @厨房小妙招" } }], { fps: 12, mark: "원본 소스 예시" }));
  const src3 = media("src-a001-3", { projectId: id, kind: "source", name: "kitchen_detail_03.mp4", createdAt: T("28T10:05:00") }, video([{ scene: "sink-detail", sec: 18 }], { fps: 12, mark: "직접 촬영 예시" }));
  const ai2 = media("ai-a001-2", { projectId: id, kind: "ai_scene", name: "A001_scene2_apron_broll.mp4", createdAt: T("30T11:40:00"), origin: { jobId: "job-a001-ai2", model: "google/veo-3.1-lite" } }, video([{ scene: "sink-apron", sec: 4 }], { mark: "AI 장면 예시" }));
  const voice = media("voice-a001", { projectId: id, kind: "audio", name: "이동주_ko_01.wav", createdAt: T("31T13:50:00") }, { type: "audio", seconds: 20 });

  const sc = [
    clip("a001-sc1", "물튀는 싱크대 · 후킹", src1, 2, 6, "src_trend", "a001-seg1"),
    aiScene("a001-sc2", "젖은 앞치마 B-roll (AI)", 4, "Vertical 9:16, realistic, a beige apron with wet spots in front of a stainless kitchen sink, a grey pleated silicone splash guard on the sink edge, no face, no text, no logos", "approved", ai2, "job-a001-ai2", "제품 형태 변경 없음 · 주방 배경과 앞치마만 생성 — 사용 승인 (예시)"),
    clip("a001-sc3", "펼치고 접는 사용 장면", src2, 8, 15, "a001-src2", "a001-seg3"),
    clip("a001-sc4", "흡착 받침 · 길이 클로즈업", src3, 2, 7, "a001-src3", "a001-seg4"),
  ];
  const ls = lines("a001", [
    ["hook", "설거지할 때, 옷 앞이 늘 젖나요?"],
    ["problem", "싱크대 앞 물기, 매번 닦기 번거롭죠."],
    ["demo", "앞쪽에 펼쳐두고, 다 쓰면 접어두세요."],
    ["cta", "집 싱크대 길이를 확인하고 고정댓글에서 옵션을 보세요."],
  ], sc.map((s) => s.id));
  const cues = cuesOf(ls, sc);
  const OVERLAY = overlayFor({ kind: "coupang", brandTarget: "client", clientName: "", virtualHuman: false });
  const renderParts = [
    { scene: "sink-splash", sec: 4 },
    { scene: "sink-apron", sec: 4 },
    { scene: "sink-fold", sec: 7 },
    { scene: "sink-detail", sec: 5 },
  ];
  const r1 = media("render-a001-v1", { projectId: id, kind: "render", name: "A001_v1_20s.mp4", createdAt: T("29T18:30:00"), origin: { jobId: "job-a001-r1", model: null }, overlay: { disclosure: true, text: OVERLAY } }, video(renderParts, { cues, overlay: OVERLAY, fps: 15 }));
  const r2 = media("render-a001-v2", { projectId: id, kind: "render", name: "A001_v2_20s.mp4", createdAt: T("31T14:20:00"), origin: { jobId: "job-a001-r2", model: null }, overlay: { disclosure: true, text: OVERLAY } }, video(renderParts, { cues, overlay: OVERLAY, fps: 15 }));

  const sources: SourceClip[] = [
    {
      id: "src_trend",
      platform: "xiaohongshu",
      url: "https://example.com/mock/xiaohongshu/sink-splash-01",
      creator: "@小家日记 (가상)",
      title: "물튀는 싱크대, 접어서 해결",
      memo: "물튀는 싱크대, 접어서 해결 — 원본 반응 예시 조회 1,280,000 · 좋아요 42,600 · 댓글 1,180 (저장 · DM 미확인). 우리 영상 성과와 별개. 32초 파일.",
      terms: "목업 직접 입력 · 이용 조건 확인 전 (예시)",
      collectedAt: T("27T15:10:00"),
      collectedBy: ME,
      fileIds: [src1],
      segments: [
        { id: "a001-seg1", fileId: src1, start: 2, end: 6, purpose: "hook", note: "물이 튀는 첫 장면" },
        { id: "a001-seg2", fileId: src1, start: 12, end: 16, purpose: "problem", note: "젖은 상판 닦는 손" },
      ],
    },
    {
      id: "a001-src2",
      platform: "douyin",
      url: "https://example.com/mock/douyin/fold-test-02",
      creator: "@厨房小妙招 (가상)",
      title: "접이식 물막이 펼치기 · 접기",
      memo: "펼치고 접는 시연 — 24초 파일 (가상 예시)",
      terms: "목업 직접 입력 (예시)",
      collectedAt: T("27T15:20:00"),
      collectedBy: ME,
      fileIds: [src2],
      segments: [{ id: "a001-seg3", fileId: src2, start: 8, end: 15, purpose: "demo", note: "펼치고 접는 장면" }],
    },
    {
      id: "a001-src3",
      platform: "other",
      url: "",
      creator: "직접 촬영 · 이동주",
      title: "주방 디테일 촬영본",
      memo: "흡착 받침 · 길이 클로즈업 — 18초 파일 (가상 예시)",
      terms: "직접 촬영 (예시)",
      collectedAt: T("28T10:05:00"),
      collectedBy: ME,
      fileIds: [src3],
      segments: [{ id: "a001-seg4", fileId: src3, start: 2, end: 7, purpose: "cta", note: "흡착 받침 · 40cm 길이" }],
    },
  ];

  const p = base(id, "싱크대 물튐 해결 · 접이식 물막이 · A-001", "접이식 실리콘 싱크대 물막이 (회색 · 40×10cm)", "주방용품", "editing", "hybrid", T("31T14:20:00"), {
    trendId: "tr-01",
    templateId: "tpl-f001",
    formatId: "fmt-01",
    facts: [
      "회색 실리콘 접이식 물막이 · 펼쳤을 때 40×10cm (쿠팡 상세 확인 · 예시)",
      "바닥 흡착 받침 · 주름형 패널 (상세 이미지 확인 · 예시)",
      "가격 12,900원 (10/31 14:20 쿠팡 확인 시점 · 예시)",
    ],
    notes: "A-001 · v1 은 수동 게시 · 성과 기록 있음(가상 예시), v2 출력 완료. 원본 소재 반응(128만 조회)과 우리 영상 성과(8.42만 조회)는 섞지 않습니다.",
    chinese: {
      terms: [
        { id: "a001-zh1", text: "水槽挡水板", kind: "name", meaning: "싱크대 물막이", by: "manual" },
        { id: "a001-zh2", text: "厨房防溅水", kind: "use", meaning: "주방 물튐 방지", by: "manual" },
        { id: "a001-zh3", text: "可折叠硅胶挡水板", kind: "synonym", meaning: "접이식 실리콘 물막이", by: "ai" },
      ],
      generatedAt: T("27T14:50:00"),
    },
    sources,
    coupang: {
      candidates: [
        {
          id: "a001-cp1",
          url: "https://www.coupang.com/vp/products/99999999999901",
          productId: "99999999999901",
          name: "노브랜드 접이식 실리콘 싱크대 물막이 그레이 SG-40 (예시)",
          brand: "노브랜드",
          model: "SG-40",
          size: "40×10cm (펼침)",
          material: "실리콘",
          spec: "바닥 흡착 받침 · 주름형 접이식",
          options: "그레이",
          price: 12900,
          saleStatus: "on_sale",
          checkedAt: T("31T14:20:00"),
          source: "manual",
          comparison: "주름 간격 · 흡착 받침 · 회색 색상 · 펼친 길이가 원본 영상과 같음 (목업 예시). 로고 없음.",
          match: "identical",
          checks: { brand: true, model: true, size: true, material: true, options: true, appearance: true },
          confirmedBy: ME,
          confirmedAt: T("31T14:20:00"),
        },
        {
          id: "a001-cp2",
          url: "https://www.coupang.com/vp/products/99999999999902",
          productId: "99999999999902",
          name: "실리콘 싱크대 물막이 45cm 베이지·그레이 (예시)",
          brand: "생활공방(예시)",
          model: "WG-45",
          size: "45×12cm",
          material: "실리콘",
          spec: "접이식 · 흡착 4개",
          options: "그레이 · 베이지",
          price: 15800,
          saleStatus: "on_sale",
          checkedAt: T("31T14:05:00"),
          source: "manual",
          comparison: "길이가 45cm 로 원본(40cm)과 다름 — 비교 중 (예시)",
          match: "candidate",
          checks: { brand: null, model: null, size: false, material: true, options: null, appearance: true },
          confirmedBy: null,
          confirmedAt: null,
        },
        {
          id: "a001-cp3",
          url: "https://www.coupang.com/vp/products/99999999999903",
          productId: "99999999999903",
          name: "투명 아크릴 싱크대 가림막 (예시)",
          brand: "클리어홈(예시)",
          model: "AC-38",
          size: "38×15cm",
          material: "아크릴",
          spec: "고정형 · 접히지 않음",
          options: "투명",
          price: 9900,
          saleStatus: "unknown",
          checkedAt: T("31T13:55:00"),
          source: "manual",
          comparison: "재질(아크릴) · 외형이 다름 — 제외 (예시)",
          match: "rejected",
          checks: { brand: false, model: false, size: false, material: false, options: null, appearance: false },
          confirmedBy: null,
          confirmedAt: null,
        },
      ],
      affiliate: { url: "https://link.coupang.com/a/MOCKUPA001", candidateId: "a001-cp1", subId: "kitchentips01", method: "manual", issuedAt: T("31T14:30:00"), by: ME, coupangOwner: ME, accountId: null },
    },
    reference: {
      url: "https://example.com/mock/xiaohongshu/sink-splash-01",
      title: "물튀는 싱크대, 접어서 해결 (@小家日记 · 가상)",
      transcript: "설거지할 때마다 옷이 젖었는데… 이거 하나 세워 두니까 물이 안 튀어요. 다 쓰면 접어서 쏙. 길이 꼭 재 보세요.",
      timing: "0:00-0:04 후킹 물튐 컷 2\n0:04-0:08 문제 공감 젖은 앞치마\n0:08-0:15 사용 장면 펼치고 접기 컷 3\n0:15-0:20 CTA 길이 확인 · 고정 댓글",
    },
    analysis: {
      ...emptyAnalysis(),
      basis: ["transcript", "timing"],
      refs: [{ url: "https://example.com/mock/xiaohongshu/sink-splash-01", title: "물튀는 싱크대, 접어서 해결" }],
      totalSec: 20,
      productRevealSec: 8,
      avgShotSec: 2.9,
      cutCount: 7,
      hookPattern: "물튀는 순간을 첫 1초에 — 불편을 먼저 보여 준다",
      beats: [
        { key: "hook", label: "후킹", startSec: 0, endSec: 4, summary: "물이 튀는 싱크대 (물튐)", pattern: "{문제 상황}, 늘 이렇죠?" },
        { key: "problem", label: "문제 제기", startSec: 4, endSec: 8, summary: "젖은 앞치마 · 닦는 손", pattern: "{불편}, 매번 번거롭죠." },
        { key: "demo", label: "사용 장면", startSec: 8, endSec: 15, summary: "물막이를 펼치고 접기", pattern: "{상품}을 펼쳐 두고, 다 쓰면 접어 두세요." },
        { key: "cta", label: "CTA", startSec: 15, endSec: 20, summary: "제품 클로즈업 · 길이 확인 · 고정 댓글", pattern: "우리 집 {치수}를 확인하고 고정 댓글에서 옵션을 보세요." },
      ],
      narrationSubtitle: "same",
      cta: { type: "pinned_comment", keyword: "물막이", wording: "싱크대 앞 길이 확인하고 고정댓글에서 옵션을 보세요.", atSec: 15 },
      notes: "사람이 적은 장면 시각 + 붙여 넣은 대본 기준 (URL 미열람 · 가상 예시).",
      by: "manual",
    },
    script: { lines: ls },
    scenes: sc,
    narration: { kind: "file", fileId: voice, duration: 20, voice: null, model: null, segments: [], gapSec: 0.15, scriptHash: scriptHash(ls) },
    subtitles: { cues, edited: true },
    publish: {
      title: "설거지할 때 옷 앞이 젖는다면 · 접이식 물막이 (A-001)",
      description: "싱크대 앞 물튐을 막는 접이식 실리콘 물막이 사용 장면입니다. 우리 집 싱크대 길이를 먼저 확인해 보세요. (가상 운영 데이터 · 목업 예시)",
      hashtags: ["주방꿀팁", "싱크대정리", "살림템", "물막이"],
      privacy: "public",
      madeForKids: false,
      synthetic: true,
    },
    cta: { type: "pinned_comment", keyword: "물막이", wording: "싱크대 앞 길이 확인하고 고정댓글에서 옵션을 보세요.", atSec: 15 },
    costs: [
      cost("a001-c1", "ai_text", 0.24, "구성 분석 · 대본 · 중국어 검색어 (AI · 가상 예시)", T("27T15:00:00")),
      cost("a001-c2", "ai_video", 1.6, "AI 장면 #2 앞치마 B-roll · Veo 3.1 Lite 4초 × 8회 중 승인 1 (가상 예시)", T("30T11:40:00")),
      labor("a001-c3", 52, "소스 정리 · 쿠팡 대조 · 편집 (가상 예시)", T("31T14:20:00")),
    ],
    renderIds: [r1, r2],
  });
  withCompliance(p, r2, { claims: "대본 · 문구 직접 읽음 (예시)", invalidClick: "클릭 유도 없음 (예시)", dmConsent: "DM 은 요청한 사람에게만 (예시)", sourceRights: "목업 직접 입력" });

  job("job-a001-ai2", id, "ai_video", "succeeded", T("30T11:40:00"), "AI 장면 #2 생성 완료 · 검토 후 승인 (가상 예시)", { result: { fileId: ai2 } });
  job("job-a001-r1", id, "render", "succeeded", T("29T18:30:00"), "v1 출력 완료 · H.264/AAC 20초 (가상 예시)", { result: { mediaId: r1 } });
  job("job-a001-r2", id, "render", "succeeded", T("31T14:20:00"), "v2 출력 완료 · H.264/AAC 20초 (가상 예시)", { result: { mediaId: r2 } });

  published("pub-a001-v1", id, "youtube", r1, T("30T14:20:00"), "싱크대 물튐 해결 꿀팁 (A-001 v1)", "물튐 방지 아이템 소개, 조회 반응 양호 (예시)");
  snap("m-a001-yt-1", id, "pub-a001-v1", "youtube", T("30T22:00:00"), { views: 51_300, likes: 1_520, comments: 98, saves: null, shares: null, infoRequests: 141 }, "YouTube Studio 직접 확인 · 1일차 (가상 예시) — 저장 · DM 수 미확인");
  snap("m-a001-yt-2", id, "pub-a001-v1", "youtube", T("31T15:00:00"), { views: 84_200, likes: 2_640, comments: 186, saves: null, shares: null, infoRequests: 252 }, "YouTube Studio 직접 확인 · 정보 요청은 댓글 · DM 직접 셈 (가상 예시) — 저장 · DM 공개 수 미확인");
  snap("m-a001-cp", id, null, "coupang", T("31T15:10:00"), { clicks: 1_684, orders: 37, revenue: 14_319 }, "쿠팡 파트너스 리포트 화면 직접 확인 · 판매액 477,300원 (가상 예시)");
}

// ---- 다른 쇼핑 영상 ---------------------------------------------------------

interface ShopDef {
  id: string;
  code: string;
  title: string;
  product: string;
  category: string;
  stage: ProjectStage;
  mode: ProjectDoc["mode"];
  item: string;
  hue: number;
  trend: string | null;
  tpl: string | null;
  aiUsd: number;
  minutes: number;
  updated: string;
  cta: ProjectDoc["cta"];
  zh: [string, string][];
  lines: [BeatKey, string][];
  renders?: string[];
}

const SHOPS: ShopDef[] = [
  { id: "shop-a002", code: "A-002", title: "침대 틈새 정리 · 슬림 수납함", product: "슬림 침대 틈새 수납함", category: "수납·정리", stage: "published", mode: "hybrid", item: "slimbox", hue: 205, trend: "tr-05", tpl: "tpl-f002", aiUsd: 1.52, minutes: 46, updated: "31T13:20:00", cta: { type: "comment_keyword", keyword: "수납", wording: "제품 정보가 궁금하면 댓글에 「수납」을 남겨 주세요.", atSec: 18 }, zh: [["床缝收纳盒", "침대 틈새 수납함"], ["窄缝收纳", "좁은 틈 수납"]], lines: [["hook", "침대 옆 틈, 그냥 두셨죠?"], ["compare", "슬림 수납함 하나면 이렇게 달라져요."], ["cta", "틈 너비부터 재 보세요."]], renders: ["v1"] },
  { id: "shop-a003", code: "A-003", title: "가방 속 케이블 한 번에 정리", product: "자석 케이블 정리 홀더", category: "디지털 액세서리", stage: "published", mode: "remix", item: "cable", hue: 265, trend: "tr-06", tpl: "tpl-f003", aiUsd: 0.96, minutes: 38, updated: "31T13:25:00", cta: { type: "pinned_comment", keyword: "", wording: "정리 도구 정보는 고정 댓글에 있어요.", atSec: 15 }, zh: [["磁吸理线器", "자석 케이블 정리"]], lines: [["hook", "가방 속 케이블, 또 엉켰나요?"], ["demo", "자석에 붙이면 한 번에 정리돼요."], ["cta", "정리 도구 정보는 고정 댓글에."]], renders: ["v1", "v2"] },
  { id: "shop-a004", code: "A-004", title: "접이식 빨래바구니 · 공간 회복", product: "접이식 빨래바구니", category: "생활용품", stage: "published", mode: "hybrid", item: "basket", hue: 190, trend: "tr-07", tpl: "tpl-f002", aiUsd: 1.38, minutes: 41, updated: "31T14:05:00", cta: { type: "comment_keyword", keyword: "바구니", wording: "제품 정보가 궁금하면 댓글에 「바구니」를 남겨 주세요.", atSec: 18 }, zh: [["折叠脏衣篮", "접이식 빨래바구니"]], lines: [["hook", "빨래바구니가 자리만 차지하나요?"], ["twist", "다 쓰면 접어서 틈에 쏙."], ["cta", "우리 집 틈 너비를 재 보세요."]], renders: ["v1", "v2"] },
  { id: "shop-a005", code: "A-005", title: "접어서 넓어지는 수납함 · 공간 반전", product: "접이식 패브릭 수납함", category: "수납·정리", stage: "published", mode: "hybrid", item: "organizer", hue: 28, trend: "tr-02", tpl: "tpl-f002", aiUsd: 1.1, minutes: 35, updated: "30T17:40:00", cta: { type: "comment_keyword", keyword: "수납함", wording: "제품 정보가 궁금하면 댓글에 「수납함」을 남겨 주세요.", atSec: 18 }, zh: [["折叠收纳箱", "접이식 수납함"]], lines: [["hook", "옷장 위, 이렇게 꽉 차 있나요?"], ["compare", "접이식 수납함으로 정리 전과 후."], ["cta", "칸 크기부터 확인해 보세요."]], renders: ["v1"] },
  { id: "shop-a006", code: "A-006", title: "손동작 ASMR 정리도구", product: "서랍 칸막이 정리도구 세트", category: "수납·정리", stage: "scripting", mode: "ai", item: "asmr", hue: 330, trend: "tr-03", tpl: "tpl-f003", aiUsd: 0.42, minutes: 20, updated: "31T10:10:00", cta: { type: "pinned_comment", keyword: "", wording: "정리 도구 정보는 고정 댓글에 있어요.", atSec: 15 }, zh: [["抽屉分隔收纳", "서랍 칸막이 정리"]], lines: [["hook", "(소리) 서랍을 여는 손"], ["demo", "칸막이로 하나씩 제자리에."], ["cta", "정리 도구 정보는 고정 댓글에."]] },
  { id: "shop-a007", code: "A-007", title: "냉장고 슬라이드 트레이", product: "냉장고 슬라이드 트레이", category: "주방용품", stage: "matching", mode: "remix", item: "tray", hue: 175, trend: "tr-09", tpl: null, aiUsd: 0.12, minutes: 14, updated: "30T15:30:00", cta: { type: "comment_keyword", keyword: "트레이", wording: "", atSec: null }, zh: [["冰箱抽拉收纳盒", "냉장고 슬라이드 수납"]], lines: [] },
  { id: "shop-a008", code: "A-008", title: "회전형 양념통", product: "360도 회전 양념통 선반", category: "주방용품", stage: "matching", mode: "remix", item: "spice", hue: 12, trend: "tr-12", tpl: null, aiUsd: 0.08, minutes: 12, updated: "30T11:00:00", cta: { type: "comment_keyword", keyword: "양념통", wording: "", atSec: null }, zh: [["旋转调料架", "회전 양념 선반"]], lines: [] },
  { id: "shop-a009", code: "A-009", title: "실리콘 집게 거치대", product: "실리콘 조리도구 거치대", category: "주방용품", stage: "sourcing", mode: "hybrid", item: "clip", hue: 150, trend: "tr-08", tpl: null, aiUsd: 0.05, minutes: 9, updated: "29T16:20:00", cta: { type: "comment_keyword", keyword: "", wording: "", atSec: null }, zh: [["硅胶锅铲架", "실리콘 조리도구 거치대"]], lines: [] },
  { id: "shop-a010", code: "A-010", title: "미니 먼지 브러시", product: "틈새 미니 먼지 브러시", category: "청소용품", stage: "sourcing", mode: "remix", item: "brush", hue: 48, trend: "tr-11", tpl: null, aiUsd: 0.03, minutes: 8, updated: "29T10:45:00", cta: { type: "comment_keyword", keyword: "", wording: "", atSec: null }, zh: [["缝隙清洁刷", "틈새 청소 브러시"]], lines: [] },
  { id: "shop-a011", code: "A-011", title: "여행용 압축 파우치", product: "여행용 압축 파우치", category: "여행용품", stage: "research", mode: "remix", item: "pouch", hue: 230, trend: "tr-10", tpl: null, aiUsd: 0, minutes: 5, updated: "28T18:00:00", cta: { type: "comment_keyword", keyword: "", wording: "", atSec: null }, zh: [], lines: [] },
  { id: "shop-a012", code: "A-012", title: "투명 신발 정리함", product: "투명 신발 정리함", category: "수납·정리", stage: "research", mode: "remix", item: "shoes", hue: 0, trend: null, tpl: null, aiUsd: 0, minutes: 4, updated: "28T14:30:00", cta: { type: "comment_keyword", keyword: "", wording: "", atSec: null }, zh: [], lines: [] },
];

const ORDER: ProjectStage[] = ["research", "sourcing", "matching", "scripting", "editing", "ready", "published"];
const reached = (p: ProjectStage, s: ProjectStage) => ORDER.indexOf(p) >= ORDER.indexOf(s);

for (const s of SHOPS) {
  const at = kst(`2026-10-${s.updated}`);
  const n = s.code.replace("-", "");
  const photoId = media(`img-${s.id}`, { projectId: s.id, kind: "image", name: `${n}_product.jpg`, createdAt: at - 2 * DAY }, image("item", { item: s.item, hue: s.hue }, 720, 1280));
  const p = base(s.id, `${s.title} · ${s.code}`, s.product, s.category, s.stage, s.mode, at, {
    trendId: s.trend,
    templateId: s.tpl,
    cta: s.cta,
    facts: reached(s.stage, "matching") ? [`${s.product} (쿠팡 상세 확인 · 예시)`, "크기 · 색상은 상세 페이지 기준 (예시)"] : [],
    notes: `${s.code} — 가상 운영 데이터 · 목업 예시`,
    chinese: { terms: s.zh.map(([text, meaning], i) => ({ id: `${s.id}-zh${i}`, text, kind: i ? "use" : "name", meaning, by: "manual" as const })), generatedAt: null },
  });
  if (reached(s.stage, "sourcing")) {
    p.sources = [
      {
        // 소재에서 만든 영상의 첫 소스 = 그 소재의 원본 (화면이 원본 반응을 잇는 규칙)
        id: s.trend ? "src_trend" : `${s.id}-src1`,
        platform: s.zh.length ? "douyin" : "youtube",
        url: s.trend ? `https://example.com/mock/trend/${s.trend}` : `https://example.com/mock/source/${s.id}`,
        creator: "@生活好物 (가상)",
        title: `${s.product} 사용 장면`,
        memo: `${s.product} 원본 소스 (가상 예시 · 파일은 소스 탭 미리보기 대상 아님)`,
        terms: "목업 직접 입력",
        collectedAt: at - 3 * DAY,
        collectedBy: ME,
        fileIds: [],
        segments: [],
      },
    ];
  }
  if (reached(s.stage, "matching")) {
    const done = reached(s.stage, "scripting");
    p.coupang.candidates = [
      {
        id: `${s.id}-cp1`,
        url: `https://www.coupang.com/vp/products/999999999990${String(SHOPS.indexOf(s) + 10).padStart(2, "0")}`,
        productId: null,
        name: `${s.product} (예시)`,
        brand: "노브랜드",
        model: "",
        size: "",
        material: "",
        spec: "",
        options: "",
        price: null,
        saleStatus: "unknown",
        checkedAt: at - DAY,
        source: "manual",
        comparison: "외형 · 크기 대조 (가상 예시)",
        match: done ? "identical" : "candidate",
        checks: { brand: done ? true : null, model: done ? true : null, size: done ? true : null, material: done ? true : null, options: done ? true : null, appearance: done ? true : null },
        confirmedBy: done ? ME : null,
        confirmedAt: done ? at - DAY : null,
      },
    ];
  }
  if (s.lines.length) {
    const sec = [3, 4, 3];
    const scenes: Scene[] = s.lines.map((_, i) => imgScene(`${s.id}-sc${i + 1}`, `${BEAT_LABEL[s.lines[i][0]]} 장면`, sec[i] ?? 3, photoId));
    p.scenes = scenes;
    p.script.lines = lines(s.id, s.lines.map(([b, t]) => [b, t] as [BeatKey, string]), scenes.map((x) => x.id));
    p.subtitles = { cues: cuesOf(p.script.lines, scenes), edited: false };
    p.publish = { title: `${s.title} (${s.code})`, description: `${s.product} 사용 장면 (가상 예시)`, hashtags: ["살림템", "정리"], privacy: "public", madeForKids: false, synthetic: s.mode !== "remix" };
  }
  p.costs = [
    ...(s.aiUsd ? [cost(`${s.id}-c1`, s.mode === "remix" ? "ai_text" : "ai_video", s.aiUsd, "AI 생성 비용 (가상 예시)", at - DAY)] : []),
    labor(`${s.id}-c2`, s.minutes, "작업 시간 (가상 예시)", at),
  ];
  const OVER = overlayFor(p);
  for (const v of s.renders ?? []) {
    const rid = `render-${s.id}-${v}`;
    const cues = (p.subtitles.cues.length ? p.subtitles.cues : []).map((c) => ({ start: c.start, end: c.end, text: c.text }));
    media(rid, { projectId: s.id, kind: "render", name: `${n}_${v}_10s.mp4`, createdAt: at - (v === "v1" ? 3 * DAY : 4 * HOUR), overlay: { disclosure: true, text: OVER } }, video([{ scene: "item", sec: 10, opt: { item: s.item, hue: s.hue } }], { fps: 10, cues, overlay: OVER }));
    p.renderIds.push(rid);
    job(`job-${s.id}-${v}`, s.id, "render", "succeeded", at - (v === "v1" ? 3 * DAY : 4 * HOUR), `${v} 출력 완료 (가상 예시)`);
  }
  if (p.renderIds.length) {
    p.coupang.affiliate = { url: `https://link.coupang.com/a/MOCKUP${n}`, candidateId: `${s.id}-cp1`, subId: "kitchentips01", method: "manual", issuedAt: at - 2 * DAY, by: ME, coupangOwner: ME, accountId: null };
    withCompliance(p, p.renderIds[p.renderIds.length - 1], { claims: "확인 (예시)", invalidClick: "확인 (예시)", dmConsent: "확인 (예시)" });
  }
}

// 게시 원장 · 성과 (쇼핑)
{
  const T = (h: string) => kst(`2026-10-${h}`);
  published("pub-a002-v1", "shop-a002", "youtube", "render-shop-a002-v1", T("29T11:05:00"), "침대 틈새 정리 아이템 (A-002 v1)", "수납 아이디어로 긍정 댓글 다수 (예시)");
  published("pub-a003-v1", "shop-a003", "instagram", "render-shop-a003-v1", T("28T16:40:00"), "케이블 정리 꿀팁 모음 (A-003 v1)", "정리 전후 비교로 반응 좋음 (예시)");
  published("pub-a004-v1", "shop-a004", "youtube", "render-shop-a004-v1", T("27T13:15:00"), "접이식 빨래바구니 후기 (A-004 v1)", "공간 절약 장점 중심으로 설명 (예시)");
  pub("pub-a004-v2", "shop-a004", "youtube", "render-shop-a004-v2", "uncertain", T("31T14:05:00"), "접이식 빨래바구니 · 공간 회복 (A-004 v2)", {
    error: { code: "manual_check", message: "수동 기록의 게시 결과 확인 대기 (예시) — 플랫폼에서 올라갔는지 보고 기록해 주세요." },
    history: [{ at: T("31T14:05:00"), status: "uncertain", msg: "수동 기록의 게시 결과 확인 대기 (예시)", by: ME }],
  });
  pub("pub-a003-v2", "shop-a003", "instagram", "render-shop-a003-v2", "failed", T("31T13:30:00"), "가방 속 케이블 한 번에 정리 (A-003 v2)", {
    error: { code: "not_connected", message: "연결 필요 (예시) — Instagram 게시 계정이 아직 연결되지 않았습니다." },
    history: [{ at: T("31T13:30:00"), status: "failed", msg: "연결 필요 (예시)", by: ME }],
  });
  snap("m-a002-yt", "shop-a002", "pub-a002-v1", "youtube", T("31T15:00:00"), { views: 62_500, likes: 1_910, comments: 143, saves: null, shares: null, infoRequests: 125 }, "YouTube Studio 직접 확인 (가상 예시) — 저장 · DM 미확인");
  snap("m-a002-cp", "shop-a002", null, "coupang", T("31T15:10:00"), { clicks: 1_250, orders: 25, revenue: 9_675 }, "쿠팡 리포트 직접 확인 (가상 예시)");
  snap("m-a003-ig", "shop-a003", "pub-a003-v1", "instagram", T("31T15:00:00"), { views: 48_300, likes: 2_210, comments: 167, saves: null, shares: null, infoRequests: 145 }, "Instagram 앱 직접 확인 (가상 예시) — 저장 · 공유 · DM 미확인");
  snap("m-a003-cp", "shop-a003", null, "coupang", T("31T15:10:00"), { clicks: 966, orders: 18, revenue: 6_966 }, "쿠팡 리포트 직접 확인 (가상 예시)");
  snap("m-a004-yt", "shop-a004", "pub-a004-v1", "youtube", T("31T15:00:00"), { views: 35_000, likes: 980, comments: 77, saves: null, shares: null, infoRequests: 70 }, "YouTube Studio 직접 확인 (가상 예시) — 저장 · DM 미확인");
  snap("m-a004-cp", "shop-a004", null, "coupang", T("31T15:10:00"), { clicks: 700, orders: 14, revenue: 5_418 }, "쿠팡 리포트 직접 확인 (가상 예시)");
  // 대시보드 「확인할 일」 — A-002 v2 다시 출력이 끊김
  job("job-shop-a002-v2", "shop-a002", "render", "failed", T("31T13:20:00"), "출력 작업 재시도 필요 (예시)", {
    error: { code: "render_failed", message: "출력 작업 재시도 필요 (예시) — 업로드 도중 창이 닫혔습니다." },
  });
}

// ---- 대표 브랜드 영상 B003 (mock-brand) + 온센트 10월 8편 ---------------------------

const ONSCENT = clients[0];

function round(n: number, renderId: string, sentAt: number, decision: ReviewRound["decision"], feedback = "", decidedAt: number | null = null): ReviewRound {
  return {
    n,
    renderId,
    sentAt,
    sentBy: ME,
    decision,
    feedback,
    decidedBy: decision === "pending" ? null : "김민아(가상)",
    decidedVia: decision === "pending" ? null : "link",
    decidedAt: decision === "pending" ? null : decidedAt,
    extra: false,
  };
}

function brandBase(id: string, title: string, productId: string, stage: ProjectStage, updatedAt: number, extra: Partial<ProjectDoc> = {}): WithId<ProjectDoc> {
  const pd = ONSCENT.products.find((x) => x.id === productId)!;
  const p = base(id, title, pd.name, "뷰티 · 향수", stage, "hybrid", updatedAt, {
    kind: "brand",
    clientId: ONSCENT.id,
    clientName: ONSCENT.name,
    month: "2026-10",
    clientProductId: productId,
    members: [ME],
    brandTarget: "client",
    facts: [...pd.facts],
    templateId: "tpl-f004",
    cta: { type: "description_link", keyword: "", wording: "제품 상세에서 향 설명을 확인해 보세요.", atSec: 15 },
    ...extra,
  });
  p.output.disclosureOverlay = false;
  return p;
}

{
  const id = "mock-brand";
  const T = (h: string) => kst(`2026-10-${h}`);
  const src = media("src-b003-1", { projectId: id, kind: "source", name: "ONSCENT_citrus_01.mp4", createdAt: T("27T10:00:00") }, video([{ scene: "perfume-vanity", sec: 12, opt: { product: "citrus" } }], { fps: 12, mark: "고객사 촬영본 예시" }));
  const ai2 = media("ai-b003-2", { projectId: id, kind: "ai_scene", name: "B003_scene2_wrist.mp4", createdAt: T("28T11:00:00"), origin: { jobId: "job-b003-ai2", model: "google/veo-3.1-lite" } }, video([{ scene: "perfume-wrist", sec: 4, opt: { product: "citrus" } }], { mark: "AI 장면 예시" }));
  const ai4 = media("ai-b003-4", { projectId: id, kind: "ai_scene", name: "B003_scene4_closeup.mp4", createdAt: T("30T15:00:00"), origin: { jobId: "job-b003-ai4", model: "google/veo-3.1-lite" } }, video([{ scene: "perfume-box", sec: 5, opt: { product: "citrus" } }], { mark: "AI 장면 예시" }));
  const sc = [
    clip("b003-sc1", "화장대 위 향수 (촬영본)", src, 0, 4, "b003-src1", "b003-seg1"),
    aiScene("b003-sc2", "손목에 한 번 (AI · 얼굴 없음)", 4, "Vertical 9:16, a hand sprays a clear square perfume bottle with a black cap onto the wrist above a beige vanity, no face, soft morning light, no text", "approved", ai2, "job-b003-ai2", "병 모양 · 검정 뚜껑이 실사진과 같음 — 사용 승인 (예시)"),
    clip("b003-sc3", "가방에 넣기 (촬영본)", src, 4, 11, "b003-src1", "b003-seg2"),
    aiScene("b003-sc4", "제품명 클로즈업 (AI)", 5, "Vertical 9:16, close-up of a cream box and a clear square 30mL perfume bottle with a small white label, beige background, no text added", "approved", ai4, "job-b003-ai4", "라벨 글자 대신 자막으로 제품명 표시 — 승인 (예시)"),
  ];
  const ls = lines("b003", [
    ["hook", "출근 전, 가볍게 한 번", "출근 전, 가볍게 한 번"],
    ["empathy", "향수, 챙기기 번거롭죠."],
    ["reveal", "30mL 라 가방 속에 쏙."],
    ["cta", "온센트 시트러스 우디 30mL, 제품 상세에서 확인해 보세요."],
  ], sc.map((s) => s.id));
  const cues = cuesOf(ls, sc);
  const parts = [
    { scene: "perfume-vanity", sec: 4, opt: { product: "citrus" } },
    { scene: "perfume-wrist", sec: 4, opt: { product: "citrus" } },
    { scene: "perfume-desk", sec: 7, opt: { product: "citrus" } },
    { scene: "perfume-box", sec: 5, opt: { product: "citrus" } },
  ];
  const r1 = media("render-b003-v1", { projectId: id, kind: "render", name: "ONSCENT_B003_v1.mp4", createdAt: T("28T16:40:00"), overlay: { disclosure: false, text: "" } }, video(parts, { cues, fps: 15 }));
  const r2 = media("render-b003-v2", { projectId: id, kind: "render", name: "ONSCENT_B003_v2.mp4", createdAt: T("31T11:00:00"), overlay: { disclosure: false, text: "" } }, video(parts, { cues, fps: 15 }));
  const p = brandBase(id, "온센트 향수 · 출근 전 10초 루틴 · B003", "pd-citrus", "editing", T("31T11:20:00"), {
    trendId: "tr-04",
    formatId: "fmt-04",
    notes: "B003 — 2차 검토 대기 (가상 운영 데이터 · 목업 예시)",
    sources: [
      {
        id: "b003-src1",
        platform: "other",
        url: "",
        creator: "온센트 제공 촬영본 (가상)",
        title: "ONSCENT_citrus_01",
        memo: "고객사 제공 화장대 촬영본 12초 (가상 예시)",
        terms: "고객사 제공 자료 (예시)",
        collectedAt: T("27T10:00:00"),
        collectedBy: ME,
        fileIds: [src],
        segments: [
          { id: "b003-seg1", fileId: src, start: 0, end: 4, purpose: "hook", note: "화장대 위 병" },
          { id: "b003-seg2", fileId: src, start: 4, end: 11, purpose: "product", note: "가방에 넣는 손" },
        ],
      },
    ],
    script: { lines: ls },
    scenes: sc,
    narration: { kind: "none", fileId: null, duration: null, voice: null, model: null, segments: [], gapSec: 0.15, scriptHash: null },
    subtitles: { cues, edited: true },
    review: {
      state: "waiting",
      rounds: [
        round(1, r1, T("28T17:00:00"), "revision", "도입 자막을 짧게 하고 제품명을 또렷하게 보여주세요.", T("29T10:12:00")),
        round(2, r2, T("31T11:20:00"), "pending"),
      ],
      revisionsUsed: 1,
    },
    publish: { title: "출근 전, 가볍게 한 번 · 온센트 시트러스 우디 30mL", description: "출근 루틴 속 10초. 가방 속 30mL 향수. (가상 운영 데이터 · 목업 예시)", hashtags: ["온센트", "출근루틴", "향수"], privacy: "public", madeForKids: false, synthetic: true },
    costs: [cost("b003-c1", "ai_text", 0.16, "대본 · 문구 (AI · 가상 예시)", T("27T11:00:00")), cost("b003-c2", "ai_video", 1.9, "AI 장면 #2 · #4 (Veo 3.1 Lite · 가상 예시)", T("30T15:00:00")), labor("b003-c3", 48, "편집 · 검토 대응 (가상 예시)", T("31T11:00:00"))],
    renderIds: [r1, r2],
  });
  withCompliance(p, r2, { claims: "금지 표현 없음 확인 (예시)" }, ONSCENT.brief.banned);
  job("job-b003-ai2", id, "ai_video", "succeeded", T("28T11:00:00"), "AI 장면 #2 생성 완료 (가상 예시)");
  job("job-b003-ai4", id, "ai_video", "succeeded", T("30T15:00:00"), "AI 장면 #4 생성 완료 (가상 예시)");
  job("job-b003-r1", id, "render", "succeeded", T("28T16:40:00"), "v1 출력 완료 (가상 예시)");
  job("job-b003-r2", id, "render", "succeeded", T("31T11:00:00"), "v2 출력 완료 (가상 예시)");
}

interface BrandDef {
  id: string;
  code: string;
  title: string;
  product: string;
  stage: ProjectStage;
  review: "approved" | "waiting" | "revision" | "none";
  scene: string;
  aiUsd: number;
  updated: string;
  lines: [BeatKey, string][];
}

const BRANDS: BrandDef[] = [
  { id: "brand-b001", code: "B001", title: "온센트 브랜드 소개", product: "pd-citrus", stage: "published", review: "approved", scene: "perfume-trio", aiUsd: 1.62, updated: "30T16:12:00", lines: [["hook", "일상의 향, 온센트"], ["reveal", "작은 병에 담은 시트러스 · 우디."], ["cta", "제품 상세에서 향 설명을 확인해 보세요."]] },
  { id: "brand-b002", code: "B002", title: "온센트 휴대 루틴", product: "pd-greentea", stage: "published", review: "approved", scene: "perfume-walk", aiUsd: 1.48, updated: "30T14:08:00", lines: [["hook", "언제 어디서나, 온센트와 함께"], ["reveal", "30mL 라 가방 속에 쏙."], ["cta", "제품 상세에서 확인해 보세요."]] },
  { id: "brand-b004", code: "B004", title: "책상 위 향기", product: "pd-greentea", stage: "editing", review: "waiting", scene: "perfume-desk", aiUsd: 1.54, updated: "31T09:40:00", lines: [["hook", "오후 3시, 책상 위 한 번"], ["reveal", "그린티 · 머스크 향조."], ["cta", "제품 상세에서 확인해 보세요."]] },
  { id: "brand-b005", code: "B005", title: "기프트 패키지", product: "pd-mini", stage: "scripting", review: "revision", scene: "perfume-gift", aiUsd: 1.92, updated: "31T11:32:00", lines: [["hook", "고르기 어려운 선물엔"], ["reveal", "5mL × 4종 미니 세트."], ["cta", "제품 상세에서 구성을 확인해 보세요."]] },
  { id: "brand-b006", code: "B006", title: "향 선택 가이드", product: "pd-mini", stage: "ready", review: "approved", scene: "perfume-trio", aiUsd: 1.12, updated: "31T10:30:00", lines: [["hook", "어떤 향이 나에게 맞을까?"], ["demo", "시트러스 · 그린티 · 머스크를 차례로."], ["cta", "제품 상세에서 향 설명을 확인해 보세요."]] },
  { id: "brand-b007", code: "B007", title: "주말 산책", product: "pd-citrus", stage: "ready", review: "approved", scene: "perfume-walk", aiUsd: 0.96, updated: "31T10:50:00", lines: [["hook", "주말 아침 산책길"], ["reveal", "가벼운 시트러스 한 번."], ["cta", "제품 상세에서 확인해 보세요."]] },
  { id: "brand-b008", code: "B008", title: "브랜드 무드", product: "pd-citrus", stage: "scripting", review: "none", scene: "perfume-vanity", aiUsd: 0.2, updated: "31T15:10:00", lines: [["hook", "온센트의 하루"], ["reveal", "크림색 상자 속 작은 병."], ["cta", "제품 상세에서 확인해 보세요."]] },
];

for (const b of BRANDS) {
  const at = kst(`2026-10-${b.updated}`);
  const product = b.product === "pd-citrus" ? "citrus" : b.product === "pd-greentea" ? "greentea" : "mini";
  const pd = ONSCENT.products.find((x) => x.id === b.product)!;
  const scenes: Scene[] = b.lines.map((_, i) => imgScene(`${b.id}-sc${i + 1}`, `${BEAT_LABEL[b.lines[i][0]]} 장면`, [3, 4, 3][i] ?? 3, pd.photoIds[i % pd.photoIds.length]));
  const ls = lines(b.id, b.lines, scenes.map((s) => s.id));
  const p = brandBase(b.id, `온센트 ${b.title} · ${b.code}`.replace("온센트 온센트", "온센트"), b.product, b.stage, at, {
    notes: `${b.code} — 가상 운영 데이터 · 목업 예시`,
    script: { lines: ls },
    scenes,
    subtitles: { cues: cuesOf(ls, scenes), edited: false },
    publish: { title: `${b.title} · 온센트 (${b.code})`, description: `${pd.name} — ${b.title} (가상 예시)`, hashtags: ["온센트", "향수"], privacy: "public", madeForKids: false, synthetic: true },
    costs: [cost(`${b.id}-c1`, "ai_video", b.aiUsd, "AI 장면 · 대본 (가상 예시)", at - DAY), labor(`${b.id}-c2`, 30, "편집 (가상 예시)", at)],
  });
  if (b.id === "brand-b005") {
    // 수정 요청 뒤 다시 만든 AI 장면이 검토를 기다린다 (대시보드 「확인할 일」)
    const ai = media("ai-b005-1", { projectId: b.id, kind: "ai_scene", name: "B005_gift_ribbon_retake.mp4", createdAt: kst("2026-10-31T11:32:00"), origin: { jobId: "job-b005-ai1", model: "google/veo-3.1-lite" } }, video([{ scene: "perfume-gift", sec: 4, opt: { product } }], { mark: "AI 장면 예시" }));
    p.scenes[0] = aiScene(`${b.id}-sc1`, "선물 상자 리본 (AI 다시 만듦)", 3, "Vertical 9:16, a beige ribbon gift box with four 5mL mini perfume bottles, no text", "review", ai, "job-b005-ai1", "");
    job("job-b005-ai1", b.id, "ai_video", "succeeded", kst("2026-10-31T11:32:00"), "AI 장면 다시 생성 완료 · 검토 필요 (가상 예시)");
  }
  if (b.review !== "none") {
    const rid = `render-${b.id}-v1`;
    media(rid, { projectId: b.id, kind: "render", name: `ONSCENT_${b.code}_v1.mp4`, createdAt: at - 2 * DAY, overlay: { disclosure: false, text: "" } }, video([{ scene: b.scene, sec: 10, opt: { product } }], { fps: 10, cues: p.subtitles.cues.map((c) => ({ start: c.start, end: c.end, text: c.text })) }));
    p.renderIds = [rid];
    const sent = at - 2 * DAY + HOUR;
    p.review =
      b.review === "approved"
        ? { state: "approved", rounds: [round(1, rid, sent, "approved", "", sent + 20 * HOUR)], revisionsUsed: 0 }
        : b.review === "waiting"
          ? { state: "waiting", rounds: [round(1, rid, sent, "pending")], revisionsUsed: 0 }
          : { state: "revision", rounds: [round(1, rid, sent, "revision", "기프트 상자 리본 색을 실제 제품(베이지)과 맞춰 주세요.", sent + 18 * HOUR)], revisionsUsed: 1 };
    withCompliance(p, rid, b.review === "approved" ? { claims: "금지 표현 없음 확인 (예시)" } : {}, ONSCENT.brief.banned);
  }
}

{
  const T = (h: string) => kst(`2026-10-${h}`);
  published("pub-b001", "brand-b001", "youtube", "render-brand-b001-v1", T("26T10:30:00"), "온센트 브랜드 소개 (B001)", "브랜드 스토리 소개, 긍정 반응 (예시)");
  published("pub-b002", "brand-b002", "instagram", "render-brand-b002-v1", T("25T17:50:00"), "온센트 휴대 루틴 (B002)", "휴대 루틴 소개, 시청 유지 양호 (예시)");
  pub("pub-b006", "brand-b006", "youtube", "render-brand-b006-v1", "scheduled", T("31T10:40:00"), "향 선택 가이드 · 온센트 (B006)", { scheduledAt: kst("2026-11-02T12:00:00") });
  pub("pub-b007", "brand-b007", "instagram", "render-brand-b007-v1", "scheduled", T("31T10:55:00"), "주말 산책 · 온센트 (B007)", { scheduledAt: kst("2026-11-03T18:00:00") });
  // 브랜드 영상 — 제휴 지표(클릭 · 주문 · 수익)는 없다(모름). 저장 · 공유도 모름.
  snap("m-b001-yt", "brand-b001", "pub-b001", "youtube", T("31T15:00:00"), { views: 23_000, likes: 610, comments: 52, saves: null, shares: null, infoRequests: 46 }, "YouTube Studio 직접 확인 (가상 예시) — 제휴 지표 없음 · 저장 미확인");
  snap("m-b002-ig", "brand-b002", "pub-b002", "instagram", T("31T15:00:00"), { views: 19_000, likes: 840, comments: 61, saves: null, shares: null, infoRequests: 38 }, "Instagram 앱 직접 확인 (가상 예시) — 제휴 지표 없음 · 저장 · 공유 미확인");
}

// ============================================================
//  저장한 소재 12개 — 해외 원본의 반응 (우리 영상 성과와 다른 기록)
// ============================================================

interface TrendDef {
  id: string;
  product: string;
  title: string;
  channel: string;
  platform: TrendDoc["platform"];
  country: string;
  language: string;
  views: number;
  likes: number;
  comments: number;
  info: number; // 댓글 200개 표본 중 정보 요청 수
  dom: "found2" | "found1" | "none" | "some" | "spread" | "unchecked";
  projectId: string | null;
  category: string;
}

const TRENDS: TrendDef[] = [
  { id: "tr-01", product: "접이식 실리콘 물막이", title: "물튀는 싱크대, 접어서 해결", channel: "@小家日记 (가상)", platform: "xiaohongshu", country: "TW", language: "zh", views: 1_280_000, likes: 42_600, comments: 1_180, info: 36, dom: "found2", projectId: "mock-shopping", category: "주방용품" },
  { id: "tr-02", product: "접이식 수납함", title: "접기 전후 공간 반전", channel: "@收纳好物 (가상)", platform: "douyin", country: "US", language: "en", views: 960_000, likes: 31_200, comments: 860, info: 30, dom: "none", projectId: "shop-a005", category: "수납·정리" },
  { id: "tr-03", product: "손동작 정리도구", title: "손동작 ASMR", channel: "@整理控 (가상)", platform: "youtube", country: "JP", language: "ja", views: 720_000, likes: 24_100, comments: 610, info: 24, dom: "some", projectId: "shop-a006", category: "수납·정리" },
  { id: "tr-04", product: "향수 출근 루틴", title: "10초 준비 루틴", channel: "@lifestyle_beauty (가상)", platform: "instagram", country: "KR", language: "ko", views: 480_000, likes: 15_800, comments: 420, info: 20, dom: "spread", projectId: "mock-brand", category: "뷰티 · 향수" },
  { id: "tr-05", product: "슬림 침대 틈새 수납함", title: "침대 틈새 공간 활용", channel: "@home.goods (가상)", platform: "youtube", country: "US", language: "en", views: 350_000, likes: 9_900, comments: 300, info: 18, dom: "found1", projectId: "shop-a002", category: "수납·정리" },
  { id: "tr-06", product: "자석 케이블 정리", title: "책상 정리 꿀팁", channel: "@数码生活 (가상)", platform: "douyin", country: "TW", language: "zh", views: 290_000, likes: 8_400, comments: 250, info: 16, dom: "some", projectId: "shop-a003", category: "디지털 액세서리" },
  { id: "tr-07", product: "접이식 빨래바구니", title: "작은 공간도 넉넉하게", channel: "@家居好物 (가상)", platform: "youtube", country: "US", language: "en", views: 210_000, likes: 6_300, comments: 190, info: 16, dom: "none", projectId: "shop-a004", category: "생활용품" },
  { id: "tr-08", product: "실리콘 집게 거치대", title: "다용도 거치대 활용법", channel: "@生活好物 (가상)", platform: "xiaohongshu", country: "TW", language: "zh", views: 180_000, likes: 5_100, comments: 160, info: 14, dom: "unchecked", projectId: "shop-a009", category: "주방용품" },
  { id: "tr-09", product: "냉장고 슬라이드 트레이", title: "냉장고 정리 아이디어", channel: "@キッチン収納 (가상)", platform: "youtube", country: "JP", language: "ja", views: 150_000, likes: 4_200, comments: 140, info: 12, dom: "some", projectId: "shop-a007", category: "주방용품" },
  { id: "tr-10", product: "여행용 파우치", title: "여행 짐 정리 꿀팁", channel: "@travel_goods (가상)", platform: "instagram", country: "US", language: "en", views: 130_000, likes: 3_600, comments: 120, info: 10, dom: "unchecked", projectId: "shop-a011", category: "여행용품" },
  { id: "tr-11", product: "미니 먼지 브러시", title: "틈새 청소 필수템", channel: "@掃除の達人 (가상)", platform: "youtube", country: "JP", language: "ja", views: 110_000, likes: 2_900, comments: 95, info: 8, dom: "none", projectId: "shop-a010", category: "청소용품" },
  { id: "tr-12", product: "회전형 양념통", title: "주방 정리 아이디어", channel: "@厨房小妙招 (가상)", platform: "douyin", country: "TW", language: "zh", views: 96_000, likes: 2_500, comments: 88, info: 8, dom: "some", projectId: "shop-a008", category: "주방용품" },
];

const trends: WithId<TrendDoc>[] = TRENDS.map((t, i) => {
  const collectedAt = NOW - (2 + i) * HOUR;
  const domestic = emptyDomestic();
  domestic.query = t.product;
  if (t.dom !== "unchecked") {
    domestic.method = "manual";
    domestic.checkedAt = collectedAt + 30 * MIN;
    domestic.sampleSize = 20;
    domestic.status = t.dom === "none" ? "none_in_sample" : "found";
    const n = t.dom === "found2" ? 2 : t.dom === "found1" || t.dom === "some" ? 1 : t.dom === "spread" ? 5 : 0;
    domestic.matches = Array.from({ length: n }, (_, k) => ({ url: `https://example.com/mock/kr-sample/${t.id}-${k + 1}`, title: `국내 유사 영상 ${k + 1} · ${t.product} (가상)`, views: Math.round(t.views / (8 + k * 4)), src: "manual" as const }));
    domestic.note = "국내 수동 검색 표본 20건 기준 (가상 예시) — 표본에서 못 찾은 것은 국내 미유행을 뜻하지 않습니다.";
  }
  const metrics = emptyMetrics();
  metrics.views = m(t.views, "manual", "원본 화면 직접 확인 (가상 예시)", collectedAt);
  metrics.likes = m(t.likes, "manual", undefined, collectedAt);
  metrics.comments = m(t.comments, "manual", undefined, collectedAt);
  // 저장 · 공유는 공개되지 않아 모름 (null). 정보 요청은 댓글 표본 비율로 추정된다.
  return {
    id: t.id,
    owner: ME,
    visibility: "private",
    createdAt: collectedAt,
    updatedAt: collectedAt + HOUR,
    updatedBy: ME,
    platform: t.platform,
    url: t.id === "tr-01" ? "https://example.com/mock/xiaohongshu/sink-splash-01" : `https://example.com/mock/trend/${t.id}`,
    externalId: null,
    channel: t.channel,
    title: t.title,
    publishedAt: iso(collectedAt - 10 * DAY),
    collectedAt,
    collectedBy: "manual",
    searchContext: null,
    product: t.product,
    category: t.category,
    country: t.country,
    language: t.language,
    identification: { status: i < 7 ? "confirmed" : "likely", evidence: i < 7 ? "쿠팡 상세와 외형 대조 (가상 예시)" : "영상 속 외형으로 추정 (가상 예시)" },
    metrics,
    viewHistory: [{ at: collectedAt, views: t.views, src: "manual" }],
    infoSample: { sampled: 200, matched: t.info, keywords: ["어디서", "링크", "정보", "구매", "哪里买", "链接"], src: "manual", at: collectedAt },
    domestic,
    tags: [t.category, "가상 예시"],
    notes: i === 0 ? "원본 소재 반응 예시: 조회 1,280,000 · 좋아요 42,600 · 댓글 1,180 · 저장 · DM 미확인. 댓글 200개 표본 중 상품 정보 요청 36개(18%). 국내 수동 검색 표본 20건 중 유사 2건. 우리 영상 A-001 성과와 별개입니다." : "목업 직접 입력 (가상 예시)",
    projectId: t.projectId,
    sample: false,
  };
});

// ============================================================
//  바이럴 형식 정찰 — 감시 채널 8 · 터진 영상 10 · 형식 카드 4 · 주간 보고
// ============================================================

const channelDefs: [string, string, string, string, number, number, number][] = [
  // id, 이름, 나라, 분야, 구독자, 평소 조회, 이번 주 본 쇼츠
  ["ch-us-1", "Home Hacks Daily (가상)", "US", "생활 · 정리", 1_240_000, 80_000, 4],
  ["ch-us-2", "Tiny Space Living (가상)", "US", "수납 · 인테리어", 860_000, 80_000, 3],
  ["ch-us-3", "Kitchen Fix Lab (가상)", "US", "주방", 540_000, 60_000, 3],
  ["ch-jp-1", "整理の時間 (가상)", "JP", "정리 · ASMR", 720_000, 80_000, 3],
  ["ch-jp-2", "朝ルーティン帖 (가상)", "JP", "뷰티 · 루틴", 410_000, 60_000, 2],
  ["ch-tw-1", "小家日记 (가상)", "TW", "주방 · 살림", 980_000, 80_000, 4],
  ["ch-tw-2", "收纳好物 (가상)", "TW", "수납", 530_000, 80_000, 3],
  ["ch-kr-1", "출근룩 다이어리 (가상)", "KR", "뷰티 · 루틴", 310_000, 60_000, 2],
];

const channels: WithId<WatchChannelDoc>[] = channelDefs.map(([id, title, country, topic, subs, baseline, seen], i) => ({
  id,
  owner: ME,
  createdAt: NOW - (30 - i) * DAY,
  updatedAt: NOW - 3 * HOUR,
  updatedBy: ME,
  platform: "youtube",
  channelId: `UCmock${id.replace(/-/g, "").padEnd(16, "0")}`.slice(0, 24),
  handle: `@${id.replace(/-/g, "_")}_mock`,
  title,
  thumbnail: "",
  country,
  language: country === "US" ? "en" : country === "JP" ? "ja" : country === "TW" ? "zh" : "ko",
  topics: topic.split(" · "),
  subscribers: subs,
  active: true,
  note: "가상 운영 데이터 · 목업 예시 — 원본 채널 감시는 게시용 SNS 계정과 다릅니다.",
  scan: { at: NOW - (3 + i * 0.25) * HOUR, baseline, baselineN: 24, baselineBasis: "mature", shortsSeen: seen, error: null },
}));

const analysis = (formatName: string, summary: string, hook: string, structure: string[], lang: HitAnalysis["languageDependence"], ai: HitAnalysis["aiFeasibility"]["level"], matchId: string | null, at: number, total: number): HitAnalysis => ({
  formatName,
  summary,
  hook,
  structure,
  editing: "컷 2~3초 · 손 클로즈업 위주 · 자막 한 줄",
  sound: "원본 생활 소리 + 잔잔한 배경음 (유행 음원 아님)",
  textOverlay: "첫 장면 질문형 자막 한 줄",
  whyItWorks: "불편 → 해결이 3초 안에 보여 저장 · 공유 욕구가 생김 (AI 관찰 · 가설)",
  languageDependence: lang,
  aiFeasibility: { level: ai, easyParts: "배경 · 손 · 제품 단독 컷", hardParts: "물 · 천 같은 실제 물리 표현" },
  risks: [],
  riskNote: "",
  brandIdeas: ["주방 · 생활 소품 제품 시연", "브랜드 제품의 전후 비교"],
  koreanQueries: [formatName.split(" ")[0]],
  totalSec: total,
  cutCount: Math.round(total / 2.5),
  match: { formatId: matchId, reason: matchId ? "기존 카드와 훅 · 구성이 같음 (AI 제안)" : "새 형식으로 보임" },
  model: "google/gemini-3.7-flash",
  costUsd: 0.007,
  at,
  by: ME,
});

const hitDefs: { id: string; title: string; ch: string; country: string; views: number; baseline: number; daysAgo: number; formatId: string | null; status: HitDoc["status"]; analyzed: boolean; scene: string; created: number }[] = [
  { id: "hit-01", title: "물튀김 차단 사용시연 · 물튀는 싱크대, 접어서 해결", ch: "ch-tw-1", country: "TW", views: 1_280_000, baseline: 80_000, daysAgo: 2, formatId: "fmt-01", status: "assigned", analyzed: true, scene: "sink-splash", created: 2 },
  { id: "hit-02", title: "접이식 공간반전 · 접으면 생기는 넓은 공간", ch: "ch-us-2", country: "US", views: 960_000, baseline: 80_000, daysAgo: 3, formatId: "fmt-02", status: "assigned", analyzed: true, scene: "item:organizer", created: 3 },
  { id: "hit-03", title: "손동작 ASMR · 포장 뜯는 손소리 모음", ch: "ch-jp-1", country: "JP", views: 720_000, baseline: 80_000, daysAgo: 4, formatId: "fmt-03", status: "assigned", analyzed: true, scene: "item:asmr", created: 4 },
  { id: "hit-04", title: "향수 출근 루틴 · 출근 전, 가볍게 한 번", ch: "ch-kr-1", country: "KR", views: 480_000, baseline: 60_000, daysAgo: 5, formatId: "fmt-04", status: "assigned", analyzed: true, scene: "perfume-wrist", created: 5 },
  { id: "hit-05", title: "Sink splash guard test · before & after", ch: "ch-us-3", country: "US", views: 390_000, baseline: 60_000, daysAgo: 6, formatId: "fmt-01", status: "assigned", analyzed: true, scene: "sink-fold", created: 6 },
  { id: "hit-06", title: "收纳盒 折叠前后 空间对比", ch: "ch-tw-2", country: "TW", views: 416_000, baseline: 80_000, daysAgo: 5, formatId: "fmt-02", status: "assigned", analyzed: false, scene: "item:basket", created: 5 },
  { id: "hit-07", title: "冷蔵庫トレー整理 · 引き出すだけ", ch: "ch-jp-1", country: "JP", views: 328_000, baseline: 80_000, daysAgo: 3, formatId: null, status: "new", analyzed: true, scene: "item:tray", created: 2 },
  { id: "hit-08", title: "Magnetic cable trick for your bag", ch: "ch-us-1", country: "US", views: 288_000, baseline: 80_000, daysAgo: 1, formatId: null, status: "new", analyzed: false, scene: "item:cable", created: 1 },
  { id: "hit-09", title: "引き出し整理 ASMR (지난달)", ch: "ch-jp-1", country: "JP", views: 400_000, baseline: 80_000, daysAgo: 30, formatId: "fmt-03", status: "assigned", analyzed: true, scene: "item:asmr", created: 29 },
  { id: "hit-11", title: "防溅挡板 实测 (지난달 · 처음 본 영상)", ch: "ch-tw-1", country: "TW", views: 560_000, baseline: 80_000, daysAgo: 19, formatId: "fmt-01", status: "assigned", analyzed: true, scene: "sink-splash", created: 18 },
  { id: "hit-10", title: "朝の10秒ルーティン (지난달)", ch: "ch-jp-2", country: "JP", views: 300_000, baseline: 60_000, daysAgo: 30, formatId: "fmt-04", status: "assigned", analyzed: true, scene: "perfume-vanity", created: 29 },
];

const FORMAT_NAMES: Record<string, string> = { "fmt-01": "문제공감 → 사용시연", "fmt-02": "접기 전후 공간반전", "fmt-03": "손동작 ASMR", "fmt-04": "10초 루틴" };

const hits: WithId<HitDoc>[] = hitDefs.map((h) => {
  const ch = channels.find((c) => c.id === h.ch)!;
  const createdAt = NOW - h.created * DAY + 2 * HOUR;
  thumbs.push({ name: h.id, draw: image(h.scene.startsWith("item:") ? "item" : h.scene, h.scene.startsWith("item:") ? { item: h.scene.slice(5), hue: 200 } : { product: "citrus" }, 480, 270) });
  return {
    id: h.id,
    owner: "company",
    createdAt,
    updatedAt: createdAt + HOUR,
    updatedBy: ME,
    platform: "youtube",
    url: `https://example.com/mock/shorts/${h.id}`,
    externalId: null,
    watchId: ch.id,
    channel: ch.title,
    country: h.country,
    language: ch.language,
    title: h.title,
    thumbnail: `https://shorts-fixture.invalid/thumb/${h.id}.jpg`,
    publishedAt: iso(NOW - h.daysAgo * DAY),
    duration: 24,
    views: m(h.views, "manual", "가상 예시 — 자동 수집 결과 아님"),
    likes: m(Math.round(h.views * 0.03), "manual"),
    comments: m(Math.round(h.views * 0.0009), "manual"),
    baseline: m(h.baseline, "estimate", "채널 최근 쇼츠 24편 중앙값 (가상 예시)"),
    multiple: Math.round((h.views / h.baseline) * 10) / 10,
    viewHistory: [{ at: createdAt, views: h.views }],
    found: "scan",
    analysis: h.analyzed ? analysis(FORMAT_NAMES[h.formatId ?? ""] ?? (h.id === "hit-07" ? "꺼내기 한 번 정리" : "새 형식"), `${h.title} — 형식 관찰 (AI · 가설)`, "첫 1초에 불편한 장면", ["불편 장면", "해결 시연", "결과 보여 주기", "안내"], h.country === "KR" ? "mixed" : "visual", h.scene.startsWith("sink") ? "possible" : "easy", h.formatId, createdAt + 2 * HOUR, 24) : null,
    formatId: h.formatId,
    status: h.status,
    koreanComments: h.analyzed ? { sampled: 100, korean: h.country === "KR" ? 100 : h.id === "hit-01" ? 6 : 2, at: createdAt + HOUR } : null,
    note: "가상 운영 데이터 · 목업 예시",
  };
});

function format(id: string, korea: FormatDoc["korea"]["status"], ai: FormatDoc["aiFeasibility"]["level"], lang: FormatDoc["languageDependence"], summary: string, hook: string, structure: string[], krMatches: number, krFirst = "2026-10-24"): WithId<FormatDoc> {
  return {
    id,
    owner: ME,
    createdAt: NOW - 20 * DAY,
    updatedAt: NOW - 5 * HOUR,
    updatedBy: ME,
    name: FORMAT_NAMES[id],
    summary,
    hook,
    structure,
    editing: "컷 2~4초 · 손 클로즈업 · 자막 한 줄",
    sound: "생활 소리 + 잔잔한 배경음",
    textOverlay: "첫 장면 질문형 자막",
    whyItWorks: "불편 → 해결이 짧게 이어져 끝까지 보게 됨 (관찰 · 가설)",
    languageDependence: lang,
    aiFeasibility: { level: ai, easyParts: "배경 · 제품 단독 컷 · 손", hardParts: "물 · 천의 실제 물리 표현" },
    risks: id === "fmt-04" ? ["claims"] : [],
    riskNote: id === "fmt-04" ? "향 지속시간 · 효능 표현 주의" : "",
    brandIdeas: ["생활 소품 시연", "브랜드 제품 루틴"],
    koreanQueries: [FORMAT_NAMES[id]],
    korea: {
      status: korea,
      query: FORMAT_NAMES[id],
      checkedAt: korea === "unchecked" ? null : NOW - DAY,
      by: korea === "unchecked" ? null : ME,
      sampleSize: korea === "unchecked" ? null : 20,
      matches: Array.from({ length: krMatches }, (_, k) => ({ url: `https://example.com/mock/kr/${id}-${k + 1}`, title: `국내 유사 ${FORMAT_NAMES[id]} ${k + 1} (가상)`, views: 40_000 - k * 9_000, publishedAt: iso(kst(`${krFirst}T12:00:00`) + k * 3 * DAY) })),
      lastSearch: null,
      note: korea === "none_in_sample" ? "국내 표본 20건에 없음 — 미유행 확정 아님 (가상 예시)" : "가상 예시",
    },
    archived: false,
    note: "가상 운영 데이터 · 목업 예시",
  };
}

const formats: WithId<FormatDoc>[] = [
  format("fmt-01", "some", "possible", "visual", "생활 불편을 먼저 보여 주고 바로 제품 사용 시연으로 해결", "물튀는 순간 · 젖은 옷 앞섶을 첫 1초에", ["불편 장면 0~4초", "공감 4~8초", "사용 시연 8~15초", "치수 확인 · 고정 댓글 15~20초"], 2),
  format("fmt-02", "none_in_sample", "easy", "visual", "접기 전 꽉 찬 공간 → 접은 뒤 넓어진 공간 반전", "꽉 찬 공간을 0.5초에", ["정리 전", "접기", "정리 후 반전", "안내"], 0),
  format("fmt-03", "some", "easy", "visual", "말 없이 손동작과 정리 소리만으로 끝까지", "손이 바로 물건을 집는 소리", ["손 등장", "하나씩 정리", "완성 컷"], 1),
  format("fmt-04", "spread", "possible", "mixed", "아침 루틴 속 제품이 자연스럽게 등장", "「출근 전, 가볍게 한 번」", ["루틴 장면", "작은 고민", "제품 등장", "제품명 자막"], 5, "2026-10-15"),
];

const line = (formatId: string, stage: ReportFormatLine["stage"], countries: string[], examples: number, median: number, korea: ReportFormatLine["korea"], ai: ReportFormatLine["ai"], lang: ReportFormatLine["lang"], top: string): ReportFormatLine => {
  const h = hits.find((x) => x.id === top)!;
  return { formatId, name: FORMAT_NAMES[formatId], stage, basis: "최근 2주 2편(채널 2곳) · 그 전 4주 0편 (가상 예시)", countries, examples, medianMultiple: median, korea, ai, lang, top: { url: h.url, title: h.title, multiple: h.multiple, country: h.country } };
};

const thisWeek = hits.filter((h) => h.createdAt >= NOW - 7 * DAY).sort((a, b) => (b.multiple ?? 0) - (a.multiple ?? 0));
const reportW44: ScoutReportDoc = {
  week: "2026-W44",
  from: kst("2026-10-26T00:00:00"),
  to: NOW,
  createdAt: NOW,
  createdBy: ME,
  counts: {
    channels: 8,
    scanned: 8,
    newHits: 8,
    analyzed: 6,
    unassigned: 2,
    formats: 4,
    byCountry: [
      { country: "US", hits: 3 },
      { country: "TW", hits: 2 },
      { country: "JP", hits: 2 },
      { country: "KR", hits: 1 },
    ],
  },
  rising: [line("fmt-01", "rising", ["TW", "US"], 2, 16.0, "some", "possible", "visual", "hit-01"), line("fmt-02", "rising", ["US", "TW"], 2, 12.0, "none_in_sample", "easy", "visual", "hit-02")],
  abroadOnly: [line("fmt-02", "rising", ["US", "TW"], 2, 12.0, "none_in_sample", "easy", "visual", "hit-02")],
  saturating: [],
  newHits: thisWeek.map((h) => ({ hitId: h.id, url: h.url, title: h.title, channel: h.channel, country: h.country, multiple: h.multiple, views: h.views.v, publishedAt: h.publishedAt, formatName: h.formatId ? FORMAT_NAMES[h.formatId] : null, analyzed: !!h.analysis })),
  lags: [
    { formatId: "fmt-01", name: FORMAT_NAMES["fmt-01"], from: "TW", foreignFirst: iso(kst("2026-10-12T12:00:00")), koreaFirst: iso(kst("2026-10-24T12:00:00")), days: 12 },
    { formatId: "fmt-04", name: FORMAT_NAMES["fmt-04"], from: "JP", foreignFirst: iso(kst("2026-10-01T12:00:00")), koreaFirst: iso(kst("2026-10-15T12:00:00")), days: 14 },
  ],
  narrative: {
    text: "• 문제공감 뒤 사용시연이 이어지는 형식과 접기 전후 공간 반전이 떠오릅니다.\n• 국내 유사 2건이 확인된 물막이 소재는 시연 중심으로 검토하세요.\n• 국내 표본에 없다는 사실만으로 미유행을 확정할 수는 없습니다.",
    model: "google/gemini-3.7-flash",
    costUsd: 0.002,
    at: NOW, // 보고와 같은 시각 — 「요약 뒤에 보고가 고쳐졌다」 가 뜨지 않게
    by: ME,
  },
};
const reportW43: ScoutReportDoc = {
  ...reportW44,
  week: "2026-W43",
  from: kst("2026-10-19T00:00:00"),
  to: kst("2026-10-25T23:59:00"),
  createdAt: kst("2026-10-25T07:00:00"),
  createdBy: "company",
  counts: { ...reportW44.counts, newHits: 5, analyzed: 4, unassigned: 1, byCountry: [{ country: "JP", hits: 2 }, { country: "US", hits: 2 }, { country: "TW", hits: 1 }] },
  newHits: [],
  narrative: null,
};

// ============================================================
//  묶기 · 쓰기
// ============================================================

const status: ShortsData["status"] = {
  openrouter: { configured: true },
  youtubeSearch: { configured: false, missing: ["NEANDER_SHORTS_YOUTUBE_API_KEY"] },
  youtubeOAuth: { configured: false, missing: ["NEANDER_SHORTS_GOOGLE_CLIENT_ID", "NEANDER_SHORTS_GOOGLE_CLIENT_SECRET"] },
  meta: { configured: false, missing: ["NEANDER_SHORTS_META_APP_ID", "NEANDER_SHORTS_META_APP_SECRET"] },
  coupang: { configured: false, missing: ["NEANDER_SHORTS_COUPANG_ACCESS_KEY", "NEANDER_SHORTS_COUPANG_SECRET_KEY"] },
  tokenKey: { configured: true, missing: [] },
  cron: { configured: true },
  companyCoupang: { configured: false },
  storage: { driver: "firestore-chunks", quotaMb: 500, usedMb: 186 },
  allowlist: { restricted: false },
};

const models: ShortsData["models"] = {
  tts: [
    { id: "microsoft/mai-voice-2.1", label: "MAI Voice 2.1", usdPerChar: 0.000022, voices: [{ id: "ko-KR-Haena", label: "해나 (여성)" }, { id: "ko-KR-Junho", label: "준호 (남성)" }, { id: "ko-KR-Harper", label: "하퍼" }, { id: "ko-KR-Grant", label: "그랜트" }] },
    { id: "microsoft/mai-voice-2.1-flash", label: "MAI Voice 2.1 Flash (저렴)", usdPerChar: 0.000015, voices: [{ id: "ko-KR-Haena", label: "해나 (여성)" }, { id: "ko-KR-Junho", label: "준호 (남성)" }] },
  ],
  video: [
    { id: "google/veo-3.1-lite", label: "Veo 3.1 Lite", durations: [4, 6, 8], resolutions: ["720p"], usdPerSec: 0.05 },
    { id: "kwaivgi/kling-v3.0-std", label: "Kling 3.0 Std", durations: [5, 10], resolutions: ["720p"], usdPerSec: 0.084 },
    { id: "bytedance/seedance-2.5", label: "Seedance 2.5", durations: [4, 5, 6, 8, 10], resolutions: ["480p", "720p"], usdPerSec: null },
  ],
};

// 쿠팡 키는 넣지 않았다(키 없음 · 연결 필요). 파트너스 아이디 · 채널 아이디는 기록용 예시.
const profiles: ProfileView[] = [
  {
    owner: ME,
    coupang: { keyHint: null, afCode: "AF0001234 (예시)", status: "none", checkedAt: null, message: "", blockedUntil: null, configured: false },
    subIds: [
      { id: "kitchentips01", label: "주방생활팁 (예시)" },
      { id: "lifetips2026", label: "생활정리 (예시)" },
    ],
    youtubeKey: { configured: false, hint: null },
    updatedAt: NOW - 2 * DAY,
  },
];

const populated = VARIANT !== "empty";
const byNewest = <T extends { updatedAt: number }>(xs: T[]) => [...xs].sort((a, b) => b.updatedAt - a.updatedAt);

const data: ShortsData = {
  me: ME,
  admin: false,
  scope: "mine",
  profiles: populated ? profiles : [],
  clients: populated ? clients : [],
  trends: populated ? byNewest(trends) : [],
  projects: populated ? byNewest(projects) : [],
  templates: populated ? templates : [],
  accounts: [], // YouTube · Instagram 은 아직 연결 전 — 연결 필요
  jobs: populated ? [...jobs].sort((a, b) => b.updatedAt - a.updatedAt) : [],
  publications: populated ? publications : [],
  metrics: populated ? metrics : [],
  weights: DEFAULT_WEIGHTS,
  status,
  quotas: { youtubeSearch: { used: 0, limit: 90, source: null } },
  models,
};

const scout: ScoutData = {
  me: ME,
  admin: false,
  channels: populated ? channels : [],
  hits: populated ? hits : [],
  formats: populated ? formats : [],
  reports: populated ? [reportW44, reportW43] : [],
  settings: DEFAULT_SCOUT_SETTINGS,
  quotas: { youtubeSearch: { used: 0, limit: 90, source: null }, autoAnalyzeToday: 0 },
  companyKey: false,
  models: [
    { id: "google/gemini-3.7-flash", label: "Gemini 3.7 Flash (기본)" },
    { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash" },
  ],
};

// 공개 검토 화면 (B003 2차) — media 는 하네스가 render-b003-v2 파일로 채운다
const review = {
  renderId: "render-b003-v2",
  review: {
    clientName: ONSCENT.name,
    // 서버(reviews.ts)와 같게 — 게시 제목, 없으면 영상 제목
    title: (() => {
      const b = projects.find((p) => p.id === "mock-brand")!;
      return b.publish.title || b.title;
    })(),
    round: 2,
    latest: true,
    decision: "pending" as const,
    feedback: "",
    media: { size: 0, type: "video/mp4", duration: 20, parts: 0 },
    revisionLimit: 2,
    revisionsUsed: 1,
    history: [{ n: 1, decision: "revision", feedback: "도입 자막을 짧게 하고 제품명을 또렷하게 보여주세요.", decidedAt: kst("2026-10-29T10:12:00") }],
    expiresAt: kst("2026-11-07T23:59:00"),
  },
};

// ---- 지켜야 할 것 (어기면 멈춘다) ---------------------------------------------

function assert(c: unknown, msg: string): asserts c {
  if (!c) throw new Error(`fixture 검사 실패: ${msg}`);
}
const count = (s: ProjectStage) => projects.filter((p) => p.stage === s).length;
assert(projects.length === 20 && projects.filter((p) => p.kind === "brand").length === 8, "영상 20편 (쇼핑 12 + 브랜드 8)");
assert([2, 2, 2, 3, 3, 2, 6].every((n, i) => count(ORDER[i]) === n), `단계별 수 ${ORDER.map((s) => `${s}=${count(s)}`).join(" ")}`);
assert(publications.length === 10 && publications.filter((p) => p.status === "published").length === 6, "게시 원장 10 · 게시됨 6");
assert(timelineSec(projects.find((p) => p.id === "mock-shopping")!.scenes) === 20 && timelineSec(projects.find((p) => p.id === "mock-brand")!.scenes) === 20, "대표 영상 20초");
for (const s of metrics) for (const k of ["saves", "shares"] as const) assert(s.values[k] !== 0, `${s.id}.${k} 는 0 이 아니라 null`);
for (const t of trends) assert(t.metrics.saves.v === null && t.metrics.shares.v === null, `${t.id} 저장 · 공유는 모름`);
const views = (pid: string) => metrics.filter((x) => x.projectId === pid && x.values.views).reduce((n, x) => Math.max(n, x.values.views ?? 0), 0);
assert(views("mock-shopping") === 84_200 && trends[0].metrics.views.v === 1_280_000, "원본 소재(128만)와 우리 영상(8.42만)은 다른 기록");
const aiUsd = projects.reduce((n, p) => n + p.costs.filter((c) => c.kind.startsWith("ai_")).reduce((a, c) => a + (c.usd ?? 0), 0), 0);
assert(Math.abs(aiUsd - 18.4) < 0.001, `AI 비용 합 $18.40 (지금 ${aiUsd.toFixed(2)})`);
for (const p of projects) for (const s of p.scenes) {
  const f = s.clip?.fileId ?? s.ai?.fileId ?? s.image?.fileId;
  if (f) assert(items.some((x) => x.view.id === f), `${p.id} 장면 파일 ${f}`);
}

mkdirSync(resolve(outDir), { recursive: true });
const write = (name: string, v: unknown) => writeFileSync(resolve(outDir, name), `${JSON.stringify(v, null, 1)}\n`);
write("data.json", data);
write("scout.json", scout);
write("media.json", { items: populated ? items : [], thumbs: populated ? thumbs : [] });
write("jobs.json", { jobs: data.jobs });
write("review.json", populated ? review : null);
console.log(JSON.stringify({ fixture: resolve(outDir), variant: VARIANT, me: ME, projects: data.projects.length, trends: data.trends.length, publications: data.publications.length, media: populated ? items.length : 0, thumbs: populated ? thumbs.length : 0 }));
