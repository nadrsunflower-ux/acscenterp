// ============================================================
//  보고 있는 것 — 화면에서 고른 대상을 비서에게 알린다
// ------------------------------------------------------------
//  검토 대기함에서 한 거래에 커서를 두고 비서를 열면, 묻는 말은 대개 대상을
//  말하지 않는다 (「이거 뭐로 분류해?」). 비서가 **지금 어느 거래를 보고
//  있는지** 알아야 그 질문에 답할 수 있다. 발표 중인 달을 알리는 것
//  (presentation.ts)과 같은 통로다.
//
//  ⚠️ 브라우저가 보낸 글은 프롬프트에 넣지 않는다. 받는 것은 **id 뿐**이고,
//     거래의 내용(거래처 · 금액 · 비고)은 서버가 장부에서 직접 읽어 안내문을
//     만든다 (finance/server/ai-focus.ts). 화면이 보낸 이름표(label)는 그 화면에
//     보여 주는 데만 쓴다.
// ============================================================

export interface AssistantFocus {
  /** 무엇을 보고 있나 — 지금은 재무 거래뿐 */
  kind: "finTransaction";
  /** 커서가 놓인 거래 */
  id: string;
  /** 체크박스로 함께 고른 거래들 (커서 거래 제외) */
  selectedIds?: string[];
  /** 패널에 보여 줄 이름표 — 서버는 읽지 않는다 */
  label?: string;
}

/** 함께 보낼 수 있는 체크 거래 수 — 그보다 많으면 앞에서부터 자른다 */
export const MAX_FOCUS_SELECTED = 30;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** 요청 본문의 focus — 검사를 통과한 것만 돌려준다 (id 만 남긴다) */
export function parseFocus(raw: unknown): AssistantFocus | undefined {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return undefined;
    }
  }
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if (o.kind !== "finTransaction") return undefined;
  if (typeof o.id !== "string" || !ID_RE.test(o.id)) return undefined;
  const selectedIds = Array.isArray(o.selectedIds)
    ? [...new Set(o.selectedIds.filter((x): x is string => typeof x === "string" && ID_RE.test(x) && x !== o.id))].slice(
        0,
        MAX_FOCUS_SELECTED,
      )
    : [];
  return { kind: "finTransaction", id: o.id, ...(selectedIds.length ? { selectedIds } : {}) };
}
