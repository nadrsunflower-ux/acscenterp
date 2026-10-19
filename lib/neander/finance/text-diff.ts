// ============================================================
//  글 두 벌의 차이 — 낱말 단위
// ------------------------------------------------------------
//  비서가 조항을 고치자고 하면 새 글을 **통째로** 보낸다. 그대로 전/후를
//  나란히 놓으면 사람이 열 줄짜리 조항 두 벌을 눈으로 대조해야 하고,
//  「1,000분의 1」 이 「1,000분의 3」 으로 바뀐 것을 놓친다. 그래서 바뀐
//  낱말만 짚어 준다 — 뺀 것은 줄 긋고, 넣은 것은 칠한다.
//
//  낱말(띄어쓰기) 단위다. 글자 단위는 한글에서 조각이 너무 잘게 나와
//  읽기 어렵고, 줄 단위는 한 항이 한 줄이라 줄 전체가 바뀐 것으로 나온다.
//
//  LCS 표를 그대로 채운다(n×m). 조항 하나는 많아야 몇백 낱말이라 충분하다.
//  아주 긴 글이 들어오면 표를 만들지 않고 「통째로 바뀜」 으로 돌려준다.
// ============================================================

export type DiffOp = "same" | "del" | "ins";
export interface DiffPart {
  op: DiffOp;
  text: string;
}

/** 표 크기 상한 — 이보다 크면 대조하지 않는다 */
const MAX_CELLS = 1_500_000;

/** 낱말과 그 사이 공백을 따로 떼어 낸다 — 줄바꿈이 낱말에 묻히지 않게 */
const tokens = (s: string): string[] => s.match(/\s+|[^\s]+/g) ?? [];

export function diffWords(before: string, after: string): DiffPart[] {
  if (before === after) return before ? [{ op: "same", text: before }] : [];
  const a = tokens(before);
  const b = tokens(after);
  if (a.length === 0) return [{ op: "ins", text: after }];
  if (b.length === 0) return [{ op: "del", text: before }];
  if (a.length * b.length > MAX_CELLS) {
    return [
      { op: "del", text: before },
      { op: "ins", text: after },
    ];
  }

  // lcs[i][j] = a[i..] 와 b[j..] 의 가장 긴 공통 부분열 길이
  const w = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * w + j] = a[i] === b[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }

  const out: DiffPart[] = [];
  const push = (op: DiffOp, text: string) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text;
    else out.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i += 1;
      j += 1;
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) {
      push("del", a[i]);
      i += 1;
    } else {
      push("ins", b[j]);
      j += 1;
    }
  }
  while (i < a.length) push("del", a[i++]);
  while (j < b.length) push("ins", b[j++]);
  return out;
}

/** 바뀐 낱말이 하나라도 있는가 (공백만 달라진 것은 치지 않는다) */
export const hasWordChange = (parts: DiffPart[]) => parts.some((p) => p.op !== "same" && p.text.trim() !== "");
