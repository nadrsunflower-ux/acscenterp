"use client";

// ============================================================
//  가정 장표 렌더 맥락 — 모델·내용·익명 표시를 블록들이 같이 본다
// ------------------------------------------------------------
//  문구의 `@{학원 이름}` 은 기본(익명)에서 「학원 A」로 바뀐다. 글자는
//  월 지출이 큰 순서로 붙인다 — 표와 문구가 같은 학원을 같은 글자로 부른다.
// ============================================================

import { createContext, useContext, type ReactNode } from "react";
import type { Model } from "@/lib/neander/decks/model";
import type { DeckContent } from "@/lib/neander/decks/types";
import { fill } from "@/lib/neander/decks/template";

export interface SdContext {
  slug: string;
  content: DeckContent;
  model: Model;
  realNames: boolean;
  /** 인쇄본 — 움직임 없이, 밝은 색으로 */
  print?: boolean;
}

const Ctx = createContext<SdContext | null>(null);

export function SdProvider({ value, children }: { value: SdContext; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSd(): SdContext {
  const c = useContext(Ctx);
  if (!c) throw new Error("SdProvider 밖입니다.");
  return c;
}

const letter = (i: number) => {
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
};

/** 학원 이름 → 표시 이름 (익명이면 「학원 A」) */
export function academyLabeler(ctx: Pick<SdContext, "model" | "realNames">): (name: string, index?: number) => string {
  const list = ctx.model.eff.smoat?.academies ?? [];
  const byName = new Map(list.map((a, i) => [a.name.trim(), i]));
  return (name: string, index?: number) => {
    if (ctx.realNames) return name;
    const i = index ?? byName.get(name.trim());
    return i === undefined ? "학원" : `학원 ${letter(i)}`;
  };
}

/** 문구 채우기 — 가정값(v)·계산 결과(r) */
export function useFill() {
  const { model } = useSd();
  return (text: string) => fill(text, model);
}

// ---- 짧은 표기 문법 ----------------------------------------------
//   **굵게**   ==강조==   [^3] 각주   @{학원 이름}
//   [[a:사업부 ① 색]]  [[b:사업부 ② 색]]  [[bad:빨강]]  [[good:초록]]
//   줄바꿈은 그대로

const TOKEN = /(\*\*[^*]+\*\*|==[^=]+==|\[\^\d+\]|@\{[^}]+\}|\[\[(?:a|b|bad|good):[^\]]+\]\]|[①②③④⑤])/g;
const CIRCLED = "①②③④⑤";

/** ①② — 본문 글꼴(Pretendard)에서는 원문자가 너무 작아 동그라미 숫자로 그린다 */
function Circ({ n }: { n: number }) {
  return <span className="sd-circ">{n}</span>;
}

/** 표기 문법 없이 원문자만 바꾼다 — 머리·범례처럼 짧은 글에 */
export function CircText({ text }: { text: string }) {
  return (
    <>
      {text.split(/([①②③④⑤])/).map((p, i) => {
        const k = CIRCLED.indexOf(p);
        return k >= 0 && p ? <Circ key={i} n={k + 1} /> : <span key={i}>{p}</span>;
      })}
    </>
  );
}

export function Md({ text }: { text: string }) {
  const sd = useSd();
  const label = academyLabeler(sd);
  const filled = fill(text, sd.model);
  const lines = filled.split("\n");
  return (
    <>
      {lines.map((line, li) => (
        <span key={li}>
          {li > 0 && <br />}
          {line.split(TOKEN).map((part, i, all) => {
            if (!part) return null;
            if (part.startsWith("**") && part.endsWith("**")) return <b key={i}>{part.slice(2, -2)}</b>;
            if (part.startsWith("==") && part.endsWith("==")) return <span key={i} className="sd-hl">{part.slice(2, -2)}</span>;
            const fn = /^\[\^(\d+)\]$/.exec(part);
            if (fn) {
              // 각주가 연달아 붙으면 「8,9,10」 처럼 쉼표로 가른다 — 붙여 쓰면 한 숫자로 읽힌다
              const prev = all.slice(0, i).reverse().find(Boolean);
              const joined = prev !== undefined && /^\[\^\d+\]$/.test(prev);
              return <sup key={i} className="sd-fn">{joined ? `,${fn[1]}` : fn[1]}</sup>;
            }
            const ac = /^@\{([^}]+)\}$/.exec(part);
            if (ac) return <span key={i}>{label(ac[1])}</span>;
            const tone = /^\[\[(a|b|bad|good):([^\]]+)\]\]$/.exec(part);
            if (tone)
              return (
                <span key={i} className={`sd-${tone[1]}-text`}>
                  <CircText text={tone[2]} />
                </span>
              );
            const circ = CIRCLED.indexOf(part);
            if (part.length === 1 && circ >= 0) return <Circ key={i} n={circ + 1} />;
            return <span key={i}>{part}</span>;
          })}
        </span>
      ))}
    </>
  );
}

/** 문구에 쓰인 각주 번호 */
export function footnoteIds(texts: string[]): number[] {
  const set = new Set<number>();
  for (const t of texts) for (const m of t.matchAll(/\[\^(\d+)\]/g)) set.add(Number(m[1]));
  return [...set].sort((a, b) => a - b);
}
