// ============================================================
//  회사폰 부재중 전화 — 번호 정리 · 노션 알림 글 (순수 함수)
// ------------------------------------------------------------
//  회사폰(매크로드로이드 「부재중 전화」 트리거)이 api/neander/phone/missed-call 로 번호와
//  폰 연락처 이름을 보낸다. 서버(server/missed-call.ts)가 남기고 노션 「부재중전화」 표에 한 줄 +
//  받는 사람 @멘션 댓글을 단다 (재무 알림과 같은 노션 연결 · 같은 방식).
// ============================================================

/** 숫자만 남긴 번호 — +82 는 0 으로 (국내 번호끼리 같은 사람으로 묶이게). 없으면 "" */
export function normalizeNumber(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  let d = s.replace(/[^\d+]/g, "");
  if (d.startsWith("+82")) d = "0" + d.slice(3).replace(/^0/, "");
  d = d.replace(/\+/g, "");
  // 폼 본문에서 「+」 가 빈칸으로 풀려 「82 10…」 으로 온 경우 — 국내 번호는 0 · 1 로만 시작한다
  if (/^82[1-9]\d{6,}$/.test(d)) d = "0" + d.slice(2);
  else if (/^820\d{7,}$/.test(d)) d = d.slice(2);
  return d.length >= 3 ? d.slice(0, 20) : "";
}

/** 보기 좋은 번호 — 010-1234-5678 · 02-123-4567 · 1588-1234 */
export function displayNumber(n: string): string {
  if (!n) return "발신번호 없음";
  if (/^02\d{7,8}$/.test(n)) return `02-${n.slice(2, n.length - 4)}-${n.slice(-4)}`;
  if (/^0\d{9,10}$/.test(n)) return `${n.slice(0, 3)}-${n.slice(3, n.length - 4)}-${n.slice(-4)}`;
  if (/^1\d{7}$/.test(n)) return `${n.slice(0, 4)}-${n.slice(4)}`;
  return n;
}

/** 폰 연락처 이름 — 저장 안 된 번호면 매크로드로이드가 번호 · 「알 수 없음」 따위를 넣는다 → "" */
export function cleanContactName(raw: string | null | undefined, number: string): string {
  const s = String(raw ?? "").trim().slice(0, 60);
  if (!s) return "";
  if (/^\[.*\]$/.test(s)) return ""; // 매직 텍스트가 안 바뀌고 그대로 온 것
  if (/^(unknown|private|no name|null|none|n\/a)$/i.test(s)) return "";
  if (/알 ?수 ?없|발신 ?번호 ?없|발신 ?제한|비공개|없음/.test(s)) return "";
  if (number && normalizeNumber(s) === number) return "";
  if (/^[\d\s+\-()]+$/.test(s)) return "";
  return s;
}

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

/** 11/17(월) 14:32 — 한국 시각 */
export function kstCallStamp(at: number): string {
  const d = new Date(at + 9 * 3600_000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEK[d.getUTCDay()]}) ${hh}:${mm}`;
}

/** 댓글의 보낸 이 이름 (노션 화면용 — 폰 알림엔 안 나온다) */
export const MISSED_CALL_HEADLINE = "부재중 전화 📞";

export interface MissedCallNotice {
  number: string;
  name: string;
  at: number;
  /** 이 번호의 최근 30일 부재중 — 이번 것 포함 */
  recent: number;
}

/** 노션 줄 이름 — 폰 알림 굵은 줄. 누가 먼저 */
export function missedCallTitle(n: Pick<MissedCallNotice, "number" | "name">): string {
  const num = displayNumber(n.number);
  return n.name ? `📞 ${n.name} · ${num}` : `📞 ${num}`;
}

/** 댓글 — 맨 앞에 종류, 다음에 시각 · 같은 번호 횟수 */
export function missedCallMessage(n: MissedCallNotice): string {
  const parts = ["부재중 전화", kstCallStamp(n.at)];
  if (n.recent > 1) parts.push(`이 번호 30일 안 ${n.recent}번째`);
  if (!n.name && n.number) parts.push("폰에 저장 안 된 번호");
  return parts.join(" · ");
}
