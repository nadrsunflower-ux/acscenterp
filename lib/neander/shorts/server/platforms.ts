import "server-only";

// ============================================================
//  YouTube · Instagram 공식 API 어댑터 (서버 전용)
// ------------------------------------------------------------
//  프로토타입(shoppingshorts/studio/server/publishing.ts)을 옮겼다. 바뀐 점:
//   · 토큰을 환경변수 하나에서 읽지 않고, 호출하는 쪽이 계정 문서에서 꺼내 넘긴다
//     (사람마다 연결한 계정 — access.ts).
//   · Cloudflare FixedLengthStream 대신 Node 의 Buffer 를 그대로 보낸다
//     (쇼츠 완성 파일은 60MB 상한이라 메모리에 올려도 된다).
//
//  원칙 (프로토타입과 같다):
//   · 쓰기(업로드 · 컨테이너 · 게시) 도중 응답을 못 받으면 uncertain=true —
//     다시 보내면 두 번 올라갈 수 있다. 자동으로 다시 하지 않는다.
//   · 오류 문구에 토큰 · 업로드 세션 주소 · 제공사 원문을 넣지 않는다.
//   · 성공은 제공사가 돌려준 실제 id 를 봤을 때만.
//
//  공식 문서 (2026-10-31 확인):
//   YouTube videos.insert · status.containsSyntheticMedia · selfDeclaredMadeForKids
//     https://developers.google.com/youtube/v3/docs/videos/insert
//   Instagram 릴스 게시 (Facebook 로그인 · rupload · is_ai_generated · v26.0)
//     https://developers.facebook.com/docs/instagram-platform/content-publishing
// ============================================================

export class PublishingError extends Error {
  readonly name = "PublishingError";
  constructor(
    readonly code: string,
    message: string,
    readonly status = 502,
    readonly uncertain = false,
    readonly providerCode?: string,
  ) {
    super(message);
  }
}

export const GRAPH_VERSION = "v26.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

type Json = Record<string, unknown>;
const record = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const present = (v: unknown): v is string => typeof v === "string" && Boolean(v.trim());

function providerCode(value: unknown): string | undefined {
  const error = record(record(value).error);
  const errors = Array.isArray(error.errors) ? record(error.errors[0]) : {};
  const code = error.code ?? error.status ?? errors.reason ?? record(value).error;
  const safe = (v: unknown) => ((typeof v === "string" || typeof v === "number") && /^[a-zA-Z0-9_.-]{1,70}$/.test(String(v)) ? String(v) : "");
  return [safe(code), safe(error.error_subcode)].filter(Boolean).join(":") || undefined;
}

interface Ctx {
  code: string;
  label: string;
  /** 되돌릴 수 없는 쓰기인가 — 응답을 못 받으면 결과를 모른다 */
  write?: boolean;
  timeoutMs?: number;
}

/** fetch 를 바꿔 끼울 수 있게 (모의 응답 검증) */
export type Fetcher = typeof fetch;
let fetcher: Fetcher = (...args) => fetch(...args);
export const setPlatformFetch = (f: Fetcher | null) => {
  fetcher = f ?? ((...args) => fetch(...args));
};

async function providerRequest(url: string, init: RequestInit, ctx: Ctx) {
  let response: Response;
  try {
    response = await fetcher(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(ctx.timeoutMs ?? 30_000) });
  } catch {
    throw new PublishingError(
      ctx.code,
      `${ctx.label} 응답을 확인하지 못했습니다.${ctx.write ? " 중복 게시를 막기 위해 자동으로 다시 하지 않습니다. 계정에서 결과를 먼저 확인해 주세요." : " 연결 설정과 서비스 상태를 확인해 주세요."}`,
      502,
      Boolean(ctx.write),
    );
  }
  let data: unknown = null;
  try {
    const text = await response.text();
    if (text.length <= 1_000_000 && text.trim()) {
      try {
        data = JSON.parse(text);
      } catch {
        /* JSON 이 아닌 응답은 아래 일반 오류로 */
      }
    }
  } catch {
    throw new PublishingError(ctx.code, `${ctx.label} 결과를 읽지 못했습니다. 계정에서 처리 결과를 확인해 주세요.`, 502, Boolean(ctx.write));
  }
  if (!response.ok || record(data).error) {
    const uncertain = Boolean(ctx.write) && (response.status >= 500 || response.status === 408 || response.status === 308 || response.ok);
    throw new PublishingError(
      ctx.code,
      `${ctx.label} 요청이 완료되지 않았습니다.${uncertain ? " 계정에서 처리 결과를 확인하기 전에는 다시 게시하지 마세요." : " 권한, 토큰 유효기간과 서비스 할당량을 확인해 주세요."}`,
      response.status === 429 ? 429 : response.status === 401 || response.status === 403 ? 401 : 502,
      uncertain,
      providerCode(data),
    );
  }
  return { response, data: record(data) };
}

// ---- Google OAuth (YouTube) ------------------------------------------------

export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];

export function googleConfig() {
  const clientId = process.env.NEANDER_SHORTS_GOOGLE_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.NEANDER_SHORTS_GOOGLE_CLIENT_SECRET?.trim() ?? "";
  const missing = [!clientId && "NEANDER_SHORTS_GOOGLE_CLIENT_ID", !clientSecret && "NEANDER_SHORTS_GOOGLE_CLIENT_SECRET"].filter(Boolean) as string[];
  return { clientId, clientSecret, configured: missing.length === 0, missing };
}

export function googleAuthUrl(redirectUri: string, state: string): string {
  const { clientId, configured } = googleConfig();
  if (!configured) throw new PublishingError("CONFIGURATION_REQUIRED", "YouTube 연결용 Google OAuth 클라이언트가 서버에 설정되지 않았습니다.", 503);
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: YOUTUBE_SCOPES.join(" "),
    access_type: "offline",
    // 갱신 토큰을 매번 받으려면 동의 화면을 다시 띄워야 한다
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export async function googleExchangeCode(code: string, redirectUri: string) {
  const { clientId, clientSecret } = googleConfig();
  const { data } = await providerRequest(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }),
    },
    { code: "YOUTUBE_AUTH_FAILED", label: "YouTube 인증" },
  );
  if (!present(data.refresh_token) || !present(data.access_token)) {
    throw new PublishingError("YOUTUBE_AUTH_FAILED", "Google 이 갱신 토큰을 주지 않았습니다. 계정 권한에서 이 앱을 지운 뒤 다시 연결해 주세요.");
  }
  return { refreshToken: data.refresh_token, accessToken: data.access_token, scope: String(data.scope ?? "") };
}

export async function googleAccessToken(refreshToken: string): Promise<string> {
  const { clientId, clientSecret, configured } = googleConfig();
  if (!configured) throw new PublishingError("CONFIGURATION_REQUIRED", "YouTube 연결용 Google OAuth 클라이언트가 서버에 설정되지 않았습니다.", 503);
  const { data } = await providerRequest(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }),
    },
    { code: "YOUTUBE_AUTH_FAILED", label: "YouTube 인증" },
  );
  if (!present(data.access_token)) throw new PublishingError("YOUTUBE_AUTH_FAILED", "YouTube 접근 토큰을 받지 못했습니다. 계정을 다시 연결해 주세요.", 401);
  return data.access_token;
}

export async function youtubeMyChannels(accessToken: string): Promise<{ id: string; title: string }[]> {
  const { data } = await providerRequest(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
    { headers: { Authorization: `Bearer ${accessToken}` } },
    { code: "YOUTUBE_CHANNEL_FAILED", label: "YouTube 채널 확인" },
  );
  const items = Array.isArray(data.items) ? data.items : [];
  return items
    .map((it) => record(it))
    .filter((it) => present(it.id))
    .map((it) => ({ id: it.id as string, title: String(record(it.snippet).title ?? "") }));
}

// ---- YouTube 업로드 ---------------------------------------------------------

export interface YouTubeUpload {
  bytes: Uint8Array;
  mime: string;
  title: string;
  description: string;
  privacy: "private" | "unlisted" | "public";
  madeForKids: boolean;
  containsSyntheticMedia: boolean;
}

/**
 * 부르는 쪽이 게시 원장(문서 id = 계정·파일·플랫폼)을 먼저 원자적으로 잡아야 한다.
 * videos.insert 에는 중복 방지 열쇠가 없다. 결과를 모르는 호출은 다시 하지 않는다.
 */
export async function uploadYouTube(accessToken: string, input: YouTubeUpload): Promise<{ id: string; url: string; privacyStatus: string; uploadStatus: string }> {
  const size = input.bytes.byteLength;
  if (!size || size > 256 * 1024 ** 3) throw new PublishingError("INVALID_VIDEO_SIZE", "업로드할 영상 크기가 올바르지 않습니다.", 400);
  const mime = input.mime.split(";")[0].trim().toLowerCase();
  if (!/^video\/[a-z0-9.+-]+$/.test(mime)) throw new PublishingError("INVALID_VIDEO_TYPE", "지원하는 영상 형식을 확인해 주세요.", 400);
  if (!input.title.trim() || [...input.title].length > 100 || new TextEncoder().encode(input.description).byteLength > 5000) {
    throw new PublishingError("INVALID_METADATA", "제목(100자 이내)과 설명(5,000바이트 이내)을 확인해 주세요.", 400);
  }
  const { response: session } = await providerRequest(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(size),
        "X-Upload-Content-Type": mime,
      },
      body: JSON.stringify({
        snippet: { title: input.title.trim(), description: input.description, categoryId: "26" },
        status: {
          privacyStatus: input.privacy,
          selfDeclaredMadeForKids: input.madeForKids,
          containsSyntheticMedia: input.containsSyntheticMedia,
        },
      }),
    },
    { code: "YOUTUBE_SESSION_FAILED", label: "YouTube 업로드 준비" },
  );
  let uploadUrl: URL;
  try {
    uploadUrl = new URL(session.headers.get("Location") || "");
  } catch {
    throw new PublishingError("YOUTUBE_SESSION_FAILED", "YouTube 업로드 세션을 확인하지 못했습니다.");
  }
  if (uploadUrl.protocol !== "https:" || uploadUrl.hostname !== "www.googleapis.com" || !uploadUrl.pathname.startsWith("/upload/youtube/")) {
    throw new PublishingError("YOUTUBE_SESSION_FAILED", "YouTube 업로드 주소를 확인하지 못했습니다.");
  }
  const { data } = await providerRequest(
    uploadUrl.href,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": mime, "Content-Range": `bytes 0-${size - 1}/${size}` },
      body: input.bytes as unknown as BodyInit,
    },
    { code: "YOUTUBE_UPLOAD_FAILED", label: "YouTube 영상 업로드", write: true, timeoutMs: 240_000 },
  );
  if (!present(data.id) || !/^[a-zA-Z0-9_-]{6,40}$/.test(data.id)) {
    throw new PublishingError("YOUTUBE_UPLOAD_UNCERTAIN", "YouTube 영상 ID를 확인하지 못했습니다. YouTube Studio 에서 결과를 먼저 확인해 주세요.", 502, true);
  }
  const status = record(data.status);
  if (status.uploadStatus === "failed" || status.uploadStatus === "rejected") {
    throw new PublishingError("YOUTUBE_UPLOAD_REJECTED", "YouTube 가 영상 처리를 거절했습니다. YouTube Studio 에서 상세 상태를 확인해 주세요.", 422);
  }
  return {
    id: data.id,
    url: `https://www.youtube.com/shorts/${data.id}`,
    privacyStatus: present(status.privacyStatus) ? status.privacyStatus : "unknown",
    uploadStatus: present(status.uploadStatus) ? status.uploadStatus : "unknown",
  };
}

/** 내 영상의 통계 · 처리 상태 (읽기) */
export async function youtubeVideoStats(accessToken: string, ids: string[]) {
  if (!ids.length) return [];
  const { data } = await providerRequest(
    `https://www.googleapis.com/youtube/v3/videos?part=statistics,status&id=${ids.map(encodeURIComponent).join(",")}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    { code: "YOUTUBE_STATS_FAILED", label: "YouTube 통계 확인" },
  );
  const items = Array.isArray(data.items) ? data.items : [];
  const n = (v: unknown) => (v === undefined || v === null ? null : Number(v));
  return items.map((it) => {
    const r = record(it);
    const s = record(r.statistics);
    return {
      id: String(r.id),
      views: n(s.viewCount),
      likes: n(s.likeCount),
      comments: n(s.commentCount),
      uploadStatus: String(record(r.status).uploadStatus ?? ""),
      privacyStatus: String(record(r.status).privacyStatus ?? ""),
    };
  });
}

// ---- Meta (Instagram, Facebook 로그인) ---------------------------------------

export const META_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_insights",
  "instagram_manage_comments",
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
];

export function metaConfig() {
  const appId = process.env.NEANDER_SHORTS_META_APP_ID?.trim() ?? "";
  const appSecret = process.env.NEANDER_SHORTS_META_APP_SECRET?.trim() ?? "";
  const configId = process.env.NEANDER_SHORTS_META_CONFIG_ID?.trim() ?? "";
  const missing = [!appId && "NEANDER_SHORTS_META_APP_ID", !appSecret && "NEANDER_SHORTS_META_APP_SECRET"].filter(Boolean) as string[];
  return { appId, appSecret, configId, configured: missing.length === 0, missing };
}

export function metaAuthUrl(redirectUri: string, state: string): string {
  const { appId, configId, configured } = metaConfig();
  if (!configured) throw new PublishingError("CONFIGURATION_REQUIRED", "Instagram 연결용 Meta 앱이 서버에 설정되지 않았습니다.", 503);
  const q = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, state, response_type: "code" });
  // 「Facebook 로그인 for Business」 는 권한 묶음을 config_id 로 받는다. 없으면 일반 scope
  if (configId) q.set("config_id", configId);
  else q.set("scope", META_SCOPES.join(","));
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${q}`;
}

/** 코드 → 오래 가는 사용자 토큰 → 페이지마다 연결된 Instagram 프로페셔널 계정과 페이지 토큰 */
export async function metaExchangeCode(code: string, redirectUri: string) {
  const { appId, appSecret } = metaConfig();
  const short = await providerRequest(
    `${GRAPH}/oauth/access_token?${new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code })}`,
    {},
    { code: "INSTAGRAM_AUTH_FAILED", label: "Instagram(Meta) 인증" },
  );
  if (!present(short.data.access_token)) throw new PublishingError("INSTAGRAM_AUTH_FAILED", "Meta 접근 토큰을 받지 못했습니다.");
  const long = await providerRequest(
    `${GRAPH}/oauth/access_token?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: short.data.access_token })}`,
    {},
    { code: "INSTAGRAM_AUTH_FAILED", label: "Instagram(Meta) 장기 토큰" },
  );
  const userToken = present(long.data.access_token) ? long.data.access_token : short.data.access_token;
  const pages = await providerRequest(
    `${GRAPH}/me/accounts?fields=${encodeURIComponent("id,name,access_token,instagram_business_account{id,username}")}&limit=50`,
    { headers: { Authorization: `Bearer ${userToken}` } },
    { code: "INSTAGRAM_PAGES_FAILED", label: "Facebook 페이지 확인" },
  );
  const list = Array.isArray(pages.data.data) ? pages.data.data : [];
  return list
    .map((p) => record(p))
    .filter((p) => present(record(p.instagram_business_account).id) && present(p.access_token))
    .map((p) => ({
      pageId: String(p.id),
      pageName: String(p.name ?? ""),
      pageToken: p.access_token as string,
      igUserId: String(record(p.instagram_business_account).id),
      igUsername: String(record(p.instagram_business_account).username ?? ""),
    }));
}

const igHeaders = (token: string) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
const validIgId = (id: string, what: string) => {
  if (!/^\d{1,40}$/.test(id)) throw new PublishingError("INSTAGRAM_ID_INVALID", `${what} ID 가 올바르지 않습니다.`, 400);
};

/** 직접 입력한 토큰 확인 (읽기) */
export async function instagramWhoAmI(token: string, igUserId: string): Promise<{ id: string; username: string }> {
  validIgId(igUserId, "Instagram 계정");
  const { data } = await providerRequest(`${GRAPH}/${igUserId}?fields=id,username`, { headers: igHeaders(token) }, { code: "INSTAGRAM_ACCOUNT_FAILED", label: "Instagram 계정 확인" });
  if (!present(data.id)) throw new PublishingError("INSTAGRAM_ACCOUNT_FAILED", "Instagram 계정을 확인하지 못했습니다.");
  return { id: data.id, username: String(data.username ?? "") };
}

/** 24시간 게시 한도 — 숫자는 문서마다 달라 서버가 주는 값을 읽는다 */
export async function instagramPublishingLimit(token: string, igUserId: string): Promise<{ used: number | null; total: number | null }> {
  validIgId(igUserId, "Instagram 계정");
  const { data } = await providerRequest(
    `${GRAPH}/${igUserId}/content_publishing_limit?fields=config,quota_usage`,
    { headers: igHeaders(token) },
    { code: "INSTAGRAM_LIMIT_FAILED", label: "Instagram 게시 한도 확인" },
  );
  const row = record(Array.isArray(data.data) ? data.data[0] : null);
  const used = typeof row.quota_usage === "number" ? row.quota_usage : null;
  const total = typeof record(row.config).quota_total === "number" ? (record(row.config).quota_total as number) : null;
  return { used, total };
}

/** 컨테이너 만들고 영상 바이트를 rupload 로 보낸다 (공개 주소 없이) — 쓰기 두 번 */
export async function instagramCreateContainer(token: string, igUserId: string, input: { caption: string; isAiGenerated: boolean }): Promise<{ containerId: string; uploadUri: string }> {
  validIgId(igUserId, "Instagram 계정");
  if ([...input.caption].length > 2200) throw new PublishingError("INVALID_CAPTION", "Instagram 게시 문구는 2,200자 이내여야 합니다.", 400);
  const { data } = await providerRequest(
    `${GRAPH}/${igUserId}/media`,
    {
      method: "POST",
      headers: igHeaders(token),
      body: JSON.stringify({ media_type: "REELS", upload_type: "resumable", caption: input.caption, share_to_feed: true, is_ai_generated: input.isAiGenerated }),
    },
    { code: "INSTAGRAM_CONTAINER_FAILED", label: "Instagram 파일 업로드 준비", write: true },
  );
  if (!present(data.id) || !/^\d{1,40}$/.test(data.id)) {
    throw new PublishingError("INSTAGRAM_CONTAINER_UNCERTAIN", "Instagram 컨테이너 결과를 확인하지 못했습니다. 자동으로 다시 하지 않습니다.", 502, true);
  }
  let uri: URL;
  try {
    uri = new URL(present(data.uri) ? data.uri : `https://rupload.facebook.com/ig-api-upload/${GRAPH_VERSION}/${data.id}`);
  } catch {
    throw new PublishingError("INSTAGRAM_UPLOAD_URI_INVALID", "Instagram 파일 업로드 주소를 확인하지 못했습니다.", 502, true);
  }
  if (uri.protocol !== "https:" || uri.hostname !== "rupload.facebook.com" || !uri.pathname.startsWith("/ig-api-upload/")) {
    throw new PublishingError("INSTAGRAM_UPLOAD_URI_INVALID", "Instagram 파일 업로드 주소를 확인하지 못했습니다.", 502, true);
  }
  return { containerId: data.id, uploadUri: uri.href };
}

export async function instagramUploadBytes(token: string, uploadUri: string, bytes: Uint8Array, mime: string): Promise<void> {
  const m = mime.split(";")[0].trim().toLowerCase();
  if (!["video/mp4", "video/quicktime"].includes(m)) {
    throw new PublishingError("INSTAGRAM_VIDEO_FORMAT", "Instagram 에는 H.264/AAC MP4 또는 MOV 파일이 필요합니다.", 400);
  }
  const u = new URL(uploadUri);
  if (u.hostname !== "rupload.facebook.com") throw new PublishingError("INSTAGRAM_UPLOAD_URI_INVALID", "Instagram 파일 업로드 주소가 올바르지 않습니다.", 400);
  const { data } = await providerRequest(
    u.href,
    {
      method: "POST",
      headers: { Authorization: `OAuth ${token}`, offset: "0", file_size: String(bytes.byteLength), "Content-Type": m },
      body: bytes as unknown as BodyInit,
    },
    { code: "INSTAGRAM_FILE_UPLOAD_FAILED", label: "Instagram 영상 파일 전송", write: true, timeoutMs: 240_000 },
  );
  if (data.success !== true) {
    throw new PublishingError("INSTAGRAM_UPLOAD_UNCERTAIN", "Instagram 파일 전송 결과를 확인하지 못했습니다. 컨테이너 처리 상태를 확인해 주세요.", 502, data.success !== false);
  }
}

export type IgContainerStatus = "IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED" | "PUBLISHED";

export async function instagramContainerStatus(token: string, containerId: string): Promise<IgContainerStatus> {
  validIgId(containerId, "Instagram 컨테이너");
  const { data } = await providerRequest(`${GRAPH}/${containerId}?fields=status_code`, { headers: igHeaders(token) }, { code: "INSTAGRAM_STATUS_FAILED", label: "Instagram 처리 상태 확인" });
  if (!present(data.status_code) || !["IN_PROGRESS", "FINISHED", "ERROR", "EXPIRED", "PUBLISHED"].includes(data.status_code)) {
    throw new PublishingError("INSTAGRAM_STATUS_UNKNOWN", "Instagram 영상 처리 상태를 확인하지 못했습니다. 게시 요청은 보내지 않았습니다.");
  }
  return data.status_code as IgContainerStatus;
}

export async function instagramPublish(token: string, igUserId: string, containerId: string): Promise<{ id: string }> {
  validIgId(igUserId, "Instagram 계정");
  validIgId(containerId, "Instagram 컨테이너");
  const { data } = await providerRequest(
    `${GRAPH}/${igUserId}/media_publish`,
    { method: "POST", headers: igHeaders(token), body: JSON.stringify({ creation_id: containerId }) },
    { code: "INSTAGRAM_PUBLISH_FAILED", label: "Instagram 릴스 게시", write: true },
  );
  if (!present(data.id) || !/^\d{1,40}$/.test(data.id)) {
    throw new PublishingError("INSTAGRAM_PUBLISH_UNCERTAIN", "Instagram 게시 결과를 확인하지 못했습니다. 계정에서 결과를 먼저 확인해 주세요.", 502, true);
  }
  return { id: data.id };
}

/** 게시 주소 (읽기) — 실패해도 게시는 이미 끝났다. 다시 게시하지 않는다 */
export async function instagramPermalink(token: string, mediaId: string): Promise<string | null> {
  try {
    const { data } = await providerRequest(`${GRAPH}/${mediaId}?fields=permalink`, { headers: igHeaders(token) }, { code: "INSTAGRAM_PERMALINK_FAILED", label: "Instagram 게시 주소 확인" });
    if (!present(data.permalink)) return null;
    const u = new URL(data.permalink);
    return u.protocol === "https:" && ["instagram.com", "www.instagram.com"].includes(u.hostname) ? u.href : null;
  } catch {
    return null;
  }
}

/** 릴스 성과 (읽기) — views 는 Meta 문서상 개발 중 지표라 없으면 null */
export async function instagramInsights(token: string, mediaId: string) {
  validIgId(mediaId, "Instagram 게시물");
  const { data } = await providerRequest(
    `${GRAPH}/${mediaId}/insights?metric=${encodeURIComponent("views,likes,comments,saved,shares")}`,
    { headers: igHeaders(token) },
    { code: "INSTAGRAM_INSIGHTS_FAILED", label: "Instagram 성과 확인" },
  );
  const rows = Array.isArray(data.data) ? data.data.map(record) : [];
  const val = (name: string) => {
    const row = rows.find((r) => r.name === name);
    const v = row ? record(Array.isArray(row.values) ? row.values[0] : null).value ?? row.total_value : undefined;
    const n = typeof v === "number" ? v : typeof record(v).value === "number" ? (record(v).value as number) : null;
    return n;
  };
  return { views: val("views"), likes: val("likes"), comments: val("comments"), saves: val("saved"), shares: val("shares") };
}

/** 최근 댓글 (최상위 · 최대 50개) — 정보 요청 낱말을 우리 쪽에서 센다 */
export async function instagramComments(token: string, mediaId: string): Promise<string[]> {
  validIgId(mediaId, "Instagram 게시물");
  const { data } = await providerRequest(`${GRAPH}/${mediaId}/comments?fields=text&limit=50`, { headers: igHeaders(token) }, { code: "INSTAGRAM_COMMENTS_FAILED", label: "Instagram 댓글 읽기" });
  return (Array.isArray(data.data) ? data.data : []).map((c) => String(record(c).text ?? "")).filter(Boolean);
}
