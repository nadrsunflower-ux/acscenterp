// ============================================================
//  메일 — 화면과 서버가 함께 보는 모양
// ------------------------------------------------------------
//  카페24 메일은 POP3(받기)·SMTP(보내기)만 연다. IMAP 이 없어서 카페24
//  웹메일과 읽음·폴더가 맞춰지지 않는다 — ERP 가 자기 메일함을 따로 갖는다.
//  받은 메일은 카페24 서버에 그대로 남겨 둔다 (휴대폰 메일 앱이 계속 받게).
//  POP3 로 보이지 않는 카페24 메일함(보낸메일함 등)은 웹메일 백업 zip 으로
//  한 번 가져온다. 자세한 구조는 docs/mail.md.
// ============================================================

/** 시스템 메일함 — 사용자가 만든 폴더는 `f_xxxxxxxx` */
export type SystemBox = "inbox" | "self" | "sent" | "drafts" | "spam" | "trash";
export type MailBox = SystemBox | `f_${string}`;

/** 목록 화면이 보여 주는 자리 — 메일함 + 모아 보기 */
export type MailView = MailBox | "scheduled" | "receipts";

export const SYSTEM_BOXES: SystemBox[] = ["inbox", "self", "sent", "drafts", "spam", "trash"];

export const BOX_LABEL: Record<SystemBox, string> = {
  inbox: "받은메일함",
  self: "내게쓴메일함",
  sent: "보낸메일함",
  drafts: "임시보관함",
  spam: "스팸메일함",
  trash: "휴지통",
};

export const isCustomBox = (b: string): b is `f_${string}` => /^f_[a-z0-9]{8}$/.test(b);
export const isMailBox = (b: unknown): b is MailBox =>
  typeof b === "string" && (SYSTEM_BOXES.includes(b as SystemBox) || isCustomBox(b));

/** 빠른 거르기 (카페24 사이드바의 안읽음·중요·읽음·첨부) */
export type MailFilter = "unread" | "starred" | "read" | "attach";

export interface MailAddr {
  name?: string;
  address: string;
}

export interface MailAttachmentMeta {
  /** 원문을 다시 해석했을 때 attachments 배열의 자리 */
  index: number;
  name: string;
  type: string;
  size: number;
  /** 원문을 다시 읽었을 때 같은 파일인지 확인하는 값 (mailparser checksum) */
  checksum?: string;
}

/** 목록 한 줄 — 본문은 빠져 있다 */
export interface MailSummary {
  id: string;
  box: MailView;
  /** 어느 메일 계정의 메일인가 (여러 계정을 오갈 때 — 새 메일 알림이 붙인다) */
  acct?: string;
  /** 휴지통에 있을 때 원래 자리 */
  origin?: MailBox;
  from: MailAddr;
  to: MailAddr[];
  cc: MailAddr[];
  subject: string;
  /** 보낸 시각 (ms) — 목록 정렬 기준. 예약 메일은 보낼 시각 */
  date: number;
  snippet: string;
  read: boolean;
  starred: boolean;
  attachments: MailAttachmentMeta[];
  /** 카페24(또는 외부) 서버에 원문이 있는가 — 첨부·전체 본문을 다시 받을 수 있다 */
  onServer: boolean;
  /** 백업 zip 에서 가져온 메일 — 원문이 없어 첨부를 열 수 없다 */
  imported?: boolean;
  /** 외부 메일 계정에서 온 메일이면 그 이름 */
  source?: string;
  /** 보낸 메일 열람 (수신확인) */
  opens?: number;
  /** 예약 메일 상태 */
  schedule?: { status: "pending" | "sending" | "failed"; error?: string };
  /** 안 읽은 받은 메일 중 먼저 봐야 할 것 — 그 이유 (lib/neander/mail/importance.ts) */
  important?: string;
}

/**
 * 다른 화면에서 메일 한 통을 가리키는 표준 참조 (2026-09-22).
 *
 * 업무요청·일일업무·회의에 「이 메일에서 왔다」를 남긴다. 제목·보낸 사람을 **함께
 * 적어 둔다** — 그 메일함에 들어갈 수 없는 사람에게도 무엇이었는지는 보여야 하고,
 * 메일이 지워져도 흔적은 남아야 한다. 누르면 그 메일로 가지만, 남의 메일함이면
 * 열리지 않는다.
 */
export interface MailRef {
  /** 메일 계정 키 (neander_mail_accounts 문서 id) */
  acct: string;
  box: MailBox;
  id: string;
  subject: string;
  from: MailAddr;
  /** 보낸 시각 (ms) */
  date: number;
}

/**
 * 메일 참조 만들기 — Firestore 는 undefined 를 거부한다. 보낸 사람 이름이 없는
 * 메일(대부분의 알림 메일)이 흔해서, 여기서 한 번에 털어 낸다.
 */
export function mailRefOf(m: {
  box: MailView;
  id: string;
  subject?: string;
  from: MailAddr;
  date: number;
}, acct?: string): MailRef {
  return {
    acct: acct ?? "",
    // 예약·수신확인은 메일함이 아니다 — 원본은 보낸메일함에 있다
    box: m.box === "scheduled" || m.box === "receipts" ? "sent" : m.box,
    id: m.id,
    subject: m.subject ?? "",
    from: m.from.name ? { name: m.from.name, address: m.from.address } : { address: m.from.address },
    date: m.date,
  };
}

export interface MailDetail extends MailSummary {
  messageId?: string;
  replyTo?: MailAddr[];
  bcc?: MailAddr[];
  html?: string;
  text?: string;
  /** 본문이 커서 ERP 에는 일부만 있다 — 서버에서 전체를 다시 받을 수 있다 */
  partial?: boolean;
  /** 남의 공유 메일함에서 연 메일 — 고칠 수 없다 */
  readonly?: boolean;
  /** 임시보관함·예약 메일의 작성 내용 (다시 열어 쓴다) */
  compose?: MailComposeState;
}

/** 첨부로 미리 올려 둔 파일 */
export interface MailBlobRef {
  id: string;
  name: string;
  type: string;
  size: number;
}

/** 쓰는 중인 메일 — 임시저장·예약·보내기가 같은 모양을 쓴다 */
export interface MailComposeState {
  to: MailAddr[];
  cc: MailAddr[];
  bcc: MailAddr[];
  subject: string;
  /** 편집기 본문 — TEXT 모드면 없다 */
  html?: string;
  text: string;
  mode: "rich" | "html" | "text";
  /** 답장·전달 원본 (owner 가 있으면 동료의 공유 메일함) */
  ref?: { owner?: string; box: MailBox; id: string; mode: "reply" | "replyAll" | "forward" };
  blobs: MailBlobRef[];
  /** 전달 원본 첨부 중 빼기로 한 것 (index) */
  forwardSkip?: number[];
  /** 내게쓰기 */
  self?: boolean;
  /** 보낸메일함 저장 (기본 켬) */
  saveSent?: boolean;
  /** 한 사람씩 보내기 */
  individually?: boolean;
}

export interface MailSendInput extends MailComposeState {
  /** 보내면 지울 임시저장 */
  draftId?: string;
  /** 예약 발송 시각 (ms) — 없으면 바로 */
  sendAt?: number;
}

export interface MailFolder {
  id: `f_${string}`;
  name: string;
  /** 팀원에게 공유 (카페24 공유메일함) */
  shared: boolean;
}

/** 동료가 공유한 메일함 */
export interface SharedFolder {
  /** 동료의 메일 계정 키 */
  owner: string;
  ownerName: string;
  address: string;
  id: `f_${string}`;
  name: string;
}

/** 서명 — 계정마다 여러 개. 새 메일·답장에 무엇을 자동으로 넣을지 따로 정한다 */
export interface MailSignature {
  id: string;
  name: string;
  /** 편집기 HTML (로고 이미지는 data: URL — 보낼 때 cid 첨부로 바뀐다) */
  html: string;
}

export interface MailSignatureSet {
  list: MailSignature[];
  /** 새 메일(내게쓰기 포함)에 자동으로 넣을 서명 id — 없으면 넣지 않는다 */
  sigNew?: string;
  /** 답장·전달에 자동으로 넣을 서명 id */
  sigReply?: string;
}

/** 서명 한도 — 계정의 서명 문서(1MB) 안. 로고 이미지는 작게 */
export const MAX_SIGNATURES = 20;
export const MAX_SIGNATURE_BYTES = 300 * 1024;
export const MAX_SIGNATURE_TOTAL_BYTES = 800 * 1024;
export const MAX_SIGNATURE_IMAGE_BYTES = 200 * 1024;

export interface ExternalAccountView {
  id: string;
  label: string;
  address: string;
  host: string;
  lastCheckedAt?: number;
  lastError?: string;
  authFailed: boolean;
}

/** 화면에 보여 줄 계정 상태 — 비밀번호는 절대 내려가지 않는다 */
export interface MailAccountView {
  /** 메일 계정 키 — 요청마다 acct 로 보낸다. 첫 계정은 ERP 이메일과 같다 */
  key: string;
  /** 메일 서비스 — 카페24(POP3) · 네이버 · Gmail (IMAP) */
  provider: MailProvider;
  /** 팀 공용 계정 — ERP 팀원 모두의 계정 목록에 나온다 (앱 비밀번호는 연결한 사람이 한 번만) */
  team?: boolean;
  /** 지금 보는 사람이 이 계정을 연결했는가 — 연결 끊기·비밀번호·공용 켜고 끄기는 이 사람만 */
  mine?: boolean;
  /** 연결한 사람 (공용 계정에서 보인다) */
  connectedBy?: string;
  /** 계정 별칭 (예: 「대표 메일」「고객 문의」) — 계정 목록·보내는 계정·알림에 주소 대신 보인다 */
  label?: string;
  /** 계정 동그라미 — 사진(data URL) › 캐릭터(이모지) › 이름 첫 글자. 색은 캐릭터·글자 배경 */
  avatarPhoto?: string;
  avatarEmoji?: string;
  avatarColor?: string;
  address: string;
  name: string;
  signature: string;
  /** 보낸 메일 사본을 내 카페24 받은편지함에도 남긴다 (숨은 참조) */
  keepSentCopy: boolean;
  /** 보낸 메일에 수신확인(열람 표시)을 붙인다 */
  trackOpens: boolean;
  connectedAt: number;
  lastCheckedAt?: number;
  /** 비밀번호가 바뀌어 로그인에 실패했다 — 다시 입력할 때까지 확인을 멈춘다 */
  authFailed: boolean;
  lastError?: string;
  /** 확인이 이 시각부터 계속 실패하고 있다 — 잠깐의 실패는 알리지 않으려고 */
  errorSince?: number;
  /** 아직 ERP 로 가져오지 않은 예전 메일 수 (받은메일함) */
  olderCount: number;
  /** 보낸메일함의 아직 가져오지 않은 예전 메일 수 — IMAP 계정만 (서버 보낸메일함을 바로 읽는다) */
  olderSent?: number;
  folders: MailFolder[];
  /** 스팸으로 신고한 보낸 사람 */
  blocked: string[];
  externals: ExternalAccountView[];
  /** 카페24 받은메일함 사용량 (POP3 STAT) */
  usage?: { bytes: number; count: number };
  quotaBytes: number;
  /** 메일함별 수 (상태 조회 때 채운다) */
  counts?: MailCounts;
  /** 서명들 (상태 조회 때 채운다) */
  signatures?: MailSignatureSet;
}

export interface MailCounts {
  unread: number;
  spamUnread: number;
  drafts: number;
  scheduled: number;
}

export interface MailSyncResult {
  status: "ok" | "auth_failed" | "busy" | "error";
  /** 이번에 새로 들어온 메일 (최신이 앞) */
  added: MailSummary[];
  /** 읽지 않은 수 — null 이면 지난번과 같다 (세지 않았다) */
  unread: number | null;
  olderCount: number;
  checkedAt: number;
  error?: string;
  /** error 가 이어진 첫 시각 */
  errorSince?: number;
}

export interface MailListResult {
  items: MailSummary[];
  /** 더 오래된 메일이 ERP 안에 더 있다 */
  hasMore: boolean;
}

export interface MailContact {
  address: string;
  name?: string;
  /** 보낸 횟수 — 「자주 쓰는 주소」 */
  count: number;
  /** 마지막으로 보낸 때 — 「최근 사용 주소」 */
  last: number;
  /** 주소록에 직접 넣었다 */
  manual?: boolean;
}

/** 수신확인 한 줄 */
export interface MailReceipt {
  trackId: string;
  sentId: string;
  address: string;
  subject: string;
  sentAt: number;
  opens: number;
  firstOpenAt?: number;
  lastOpenAt?: number;
}

/**
 * 보내기 첨부 한도 — 카페24 SMTP 는 한 통 30MB(SIZE 30720000)까지 받는다.
 * base64 로 1/3 늘어나므로 원본 20MB 가 안전선이다 (카페24 웹메일 「일반 20MB」와 같다).
 * Vercel 요청 한도(4.5MB)는 첨부를 조각으로 미리 올려 비켜 간다 (blob).
 */
export const MAX_SEND_ATTACH_BYTES = 20 * 1024 * 1024;

/**
 * 조각 저장소에 한 번에 올릴 수 있는 크기. 보내기 첨부는 20MB 로 따로 막고,
 * 이 한도는 백업 가져오기용이다 — 카페24 보낸메일함에는 첨부 포함 20MB 가 넘는
 * 메일이 흔하다 (27MB 파일전달 메일 확인).
 */
export const MAX_BLOB_BYTES = 60 * 1024 * 1024;

/** 첨부 조각 크기 — Firestore 문서 1MB 안, base64 로 올려도 요청 4.5MB 안 */
export const BLOB_PART_BYTES = 768 * 1024;

export const DEFAULT_QUOTA_BYTES = 1024 * 1024 * 1024;

/**
 * 계정으로 붙일 수 있는 메일 서비스. 카페24 는 POP3 만 열어 따로 다루고(cafe24.ts),
 * 네이버·Gmail 은 IMAP 으로 받고 각자의 SMTP 로 보낸다 (imap.ts).
 */
export type MailProvider = "cafe24" | "naver" | "gmail";

export const MAIL_PROVIDERS: { key: MailProvider; label: string; placeholder: string; hint: string }[] = [
  {
    key: "cafe24",
    label: "회사 메일 (카페24)",
    placeholder: "name@neander.co.kr",
    hint: "그 계정으로 카페24 웹메일에 로그인해 환경설정 → POP3/SMTP 사용설정을 「사용함」으로 켜 주세요. 비밀번호는 웹메일 비밀번호입니다.",
  },
  {
    key: "naver",
    label: "네이버",
    placeholder: "아이디@naver.com",
    hint: "네이버 메일 → 환경설정 → POP3/IMAP 설정 → IMAP/SMTP 설정을 「사용함」으로 켜 주세요. 비밀번호 칸에는 네이버 로그인 비밀번호가 아니라 2단계 인증의 「애플리케이션 비밀번호」를 넣습니다 (네이버 ID → 보안 설정 → 2단계 인증 관리).",
  },
  {
    key: "gmail",
    label: "Gmail",
    placeholder: "아이디@gmail.com",
    hint: "Google 계정의 2단계 인증을 켠 뒤 myaccount.google.com/apppasswords 에서 「앱 비밀번호」를 만들어 16자리를 넣습니다 (띄어쓰기는 그대로 붙여 넣어도 됩니다). IMAP 은 Gmail 이 늘 켜 둡니다. 회사 Google Workspace 계정은 비밀번호 로그인이 막혀 있어 연결되지 않습니다.",
  },
];

/** 외부 메일 받는 서버 — 이름만 고르면 되게 자주 쓰는 곳을 둔다 (POP3 over TLS, 995) */
export const EXTERNAL_PRESETS = [
  { key: "naver", label: "네이버", host: "pop.naver.com", hint: "네이버 메일 → 환경설정 → POP3/IMAP 설정에서 POP3 사용을 켜 주세요. 2단계 인증을 쓰면 애플리케이션 비밀번호를 넣습니다." },
  { key: "gmail", label: "Gmail", host: "pop.gmail.com", hint: "Gmail 설정 → 전달 및 POP/IMAP 에서 POP 을 켜고, Google 계정의 앱 비밀번호를 넣습니다." },
  { key: "daum", label: "다음", host: "pop.daum.net", hint: "다음 메일 → 환경설정 → IMAP/POP3 에서 POP3 사용을 켜 주세요." },
] as const;
