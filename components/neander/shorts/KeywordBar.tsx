"use client";

// ============================================================
//  조사 키워드 막대 — 기획 네 화면(시장 트렌드 · 소재 발굴 · 바이럴 형식 · 성공 공식) 맨 위
// ------------------------------------------------------------
//  크롬의 북마크 막대처럼 지금 프로젝트의 키워드가 늘 떠 있고, 그 자리에서 「+」 로 더하고
//  「×」 로 지운다. 누르는 즉시 저장한다 (저장 단추 없음 — 사용자 선호).
//  정본은 프로젝트 하나의 목록이다 (shorts/keywords.ts) — 여기서 고치면 소재 발굴 검색어와
//  시장 트렌드 네이버 묶음이 같이 바뀐다. 프로젝트 › 고치기 창도 같은 KeywordChips 를 쓴다.
//  고치기는 AI STUDIO 관리자만 (그 밖의 사람은 읽기만).
// ============================================================

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, Plus, Tags, X } from "lucide-react";
import { cn, useToast } from "@/components/neander/ui";
import { shortsGet, shortsPost } from "@/lib/neander/shorts/client";
import { keywordKey, MAX_PROJECT_KEYWORDS, NAVER_KEYWORDS, sanitizeProjectKeywords } from "@/lib/neander/shorts/keywords";
import { useShorts } from "./ShortsProvider";

export interface KeywordsResponse {
  keywords: string[];
  saved: boolean;
  admin: boolean;
  max: number;
  naverMax: number;
}

/** 키워드 칩 줄 — 값은 부르는 쪽이 든다 (막대는 바로 저장, 고치기 창은 창을 저장할 때) */
export function KeywordChips({
  value,
  onChange,
  editable,
  className,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  editable: boolean;
  className?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (adding) input.current?.focus();
  }, [adding]);
  const full = value.length >= MAX_PROJECT_KEYWORDS;

  /** 쉼표로 여럿을 한 번에 — 이미 있는 것은 건너뛴다 */
  const commit = () => {
    const add = sanitizeProjectKeywords(text);
    if (add.length) onChange(sanitizeProjectKeywords([...value, ...add]));
    setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    // 한글을 조합하는 중의 Enter 는 글자를 확정하는 것이다
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      setText("");
      setAdding(false);
    } else if (e.key === "Backspace" && !text && value.length) {
      // 빈 칸에서 지우기 — 마지막 키워드를 칸으로 돌려 고칠 수 있게
      e.preventDefault();
      setText(value[value.length - 1]);
      onChange(value.slice(0, -1));
    }
  };

  return (
    <ul className={cn("flex flex-wrap items-center gap-2", className)}>
      {value.map((k, i) => (
        <li
          key={keywordKey(k)}
          className={cn(
            "inline-flex h-8 items-center gap-1 rounded-full border border-nd-line bg-nd-content pl-3 text-[14px] text-nd-fg",
            editable ? "pr-1" : "pr-3",
          )}
          title={i < NAVER_KEYWORDS ? undefined : `앞 ${NAVER_KEYWORDS}개만 네이버 추이로 봅니다 — 이 키워드는 소재 발굴 검색에만 씁니다`}
        >
          <span className={cn("max-w-[14rem] truncate", i >= NAVER_KEYWORDS && "text-nd-fg-2")}>{k}</span>
          {editable && (
            <button
              type="button"
              aria-label={`「${k}」 지우기`}
              onClick={() => onChange(value.filter((x) => x !== k))}
              className="flex h-6 w-6 items-center justify-center rounded-full text-nd-fg-3 hover:bg-nd-sunken hover:text-nd-fg"
            >
              <X size={14} aria-hidden />
            </button>
          )}
        </li>
      ))}
      {editable &&
        (adding ? (
          <li>
            <input
              ref={input}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              onBlur={() => {
                commit();
                setAdding(false);
              }}
              placeholder="키워드 · 쉼표로 여러 개"
              aria-label="추가할 키워드"
              maxLength={200}
              className="h-8 w-52 rounded-full border border-nd-accent bg-nd-content px-3 text-[14px] text-nd-fg outline-none placeholder:text-nd-fg-3"
            />
          </li>
        ) : (
          <li>
            <button
              type="button"
              disabled={full}
              onClick={() => setAdding(true)}
              title={full ? `키워드는 ${MAX_PROJECT_KEYWORDS}개까지입니다` : undefined}
              className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-nd-line px-3 text-[14px] text-nd-fg-2 hover:border-nd-accent hover:text-nd-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus size={14} aria-hidden />
              키워드
            </button>
          </li>
        ))}
      {!editable && value.length === 0 && <li className="text-[14px] text-nd-fg-3">아직 키워드가 없습니다</li>}
    </ul>
  );
}

/**
 * 기획 화면 맨 위 막대. `use` 는 이 화면이 키워드로 무엇을 하는지 한 마디.
 * onSaved — 저장한 뒤 화면이 자기 자료(레이더 설정 · 시장 설정)를 다시 받을 때.
 */
export function KeywordBar({ use, onSaved, className }: { use: string; onSaved?: (keywords: string[]) => void; className?: string }) {
  const { space } = useShorts();
  const toast = useToast();
  const [state, setState] = useState<KeywordsResponse | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  // 프로젝트를 바꾸면 그 프로젝트의 키워드로
  useEffect(() => {
    let off = false;
    setState(null);
    shortsGet<KeywordsResponse>("keywords")
      .then((r) => !off && setState(r))
      .catch(() => !off && setState(null));
    return () => {
      off = true;
    };
  }, [space]);

  const save = async (next: string[]) => {
    if (!state) return;
    const before = state.keywords;
    setState({ ...state, keywords: next });
    setSaving("saving");
    try {
      const r = await shortsPost<{ keywords: string[] }>("keywords", { keywords: next });
      setState((s) => (s ? { ...s, keywords: r.keywords, saved: true } : s));
      setSaving("saved");
      onSaved?.(r.keywords);
    } catch (e) {
      setState((s) => (s ? { ...s, keywords: before } : s));
      setSaving("idle");
      toast.error(e instanceof Error ? e.message : "키워드를 저장하지 못했습니다.");
    }
  };

  return (
    <section aria-label="조사 키워드" className={cn("mb-6 rounded-nd-lg border border-nd-line bg-nd-sunken/60 px-4 py-3", className)}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <p className="flex h-8 shrink-0 items-center gap-1.5 text-[14px] font-semibold text-nd-fg">
          <Tags size={16} aria-hidden className="text-nd-fg-2" />
          조사 키워드
          {state && <span className="nd-num font-normal text-nd-fg-3">{state.keywords.length}/{state.max}</span>}
        </p>
        <div className="min-w-0 flex-1">
          {state ? (
            <KeywordChips value={state.keywords} onChange={(n) => void save(n)} editable={state.admin} />
          ) : (
            <p className="flex h-8 items-center text-[14px] text-nd-fg-3">불러오는 중…</p>
          )}
        </div>
        {saving !== "idle" && (
          <p className="flex h-8 shrink-0 items-center gap-1 text-[13px] text-nd-fg-3" aria-live="polite">
            {saving === "saving" ? "저장 중…" : (
              <>
                <Check size={14} aria-hidden className="text-nd-success-text" />
                저장됨
              </>
            )}
          </p>
        )}
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-nd-fg-3">
        {use} 이 프로젝트의 키워드라 소재 발굴 · 시장 트렌드 · 바이럴 형식이 같이 씁니다
        {state && state.keywords.length > NAVER_KEYWORDS ? ` (네이버 추이는 앞 ${NAVER_KEYWORDS}개)` : ""}.
        {state && !state.admin && " 고치기는 AI STUDIO 관리자만 합니다."}
        {state && state.admin && state.keywords.length === 0 && " 아직 비어 있어 아침 자동 조사가 이 프로젝트는 건너뜁니다 — 「+ 키워드」 로 넣어 주세요."}
      </p>
    </section>
  );
}
