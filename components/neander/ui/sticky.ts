"use client";

// ============================================================
//  걸어 둔 필터 기억하기 — useStickyState
// ------------------------------------------------------------
//  「필터를 한 번 걸어 두면 다른 데 갔다 와도 그대로」(2026-10-19 사용자 요청).
//  useState 와 똑같이 쓰고, 값이 바뀔 때마다 이 브라우저(localStorage)에
//  적어 두었다가 화면에 다시 들어오면 꺼내 쓴다.
//
//  · 다시 꺼내는 건 첫 그림 **뒤**(effect)다. 서버가 그린 첫 화면과 달라지면
//    React 가 어긋남(hydration) 경고를 내기 때문이다. 주소(?month= 등)로 실려
//    온 조건은 화면이 그 뒤 effect 에서 넣으므로 저장된 값보다 이긴다 —
//    리포트 숫자를 눌러 원장으로 왔을 때 예전 필터가 덮어쓰지 않는다.
//  · 쪽 번호 같은 「지금 어디 보고 있나」 는 기억하지 않는다 — 필터가 바뀌면
//    범위를 벗어날 수 있다. 부르는 쪽이 고른다.
//  · 필터 값에 거래처 이름 같은 회사 데이터가 들어갈 수 있어 로그아웃 ·
//    세션 만료 때 지운다 (auth.tsx → clearStickyState).
//  · 저장소를 못 쓰는 창(사생활 보호 등)이면 그냥 useState 처럼 동작한다.
// ============================================================

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

const PREFIX = "neander.sticky.";

function read(key: string): { ok: true; value: unknown } | { ok: false } {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) return { ok: false };
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // 가득 찼거나 막힌 저장소 — 기억만 못 할 뿐 화면은 그대로
  }
}

/**
 * useState 와 같되 값을 기억한다.
 *
 * @param key     화면마다 겹치지 않는 이름 (`finance.ledger.filters`). 값 모양을 바꾸면 이름도 바꾼다.
 * @param initial 처음 값 — 기억된 값이 없거나 `accept` 를 통과하지 못하면 이것
 * @param accept  꺼낸 값이 지금도 쓸 수 있는지 (예: 고를 수 있는 값 목록 안에 있는지)
 */
export function useStickyState<T>(
  key: string,
  initial: T,
  accept?: (v: unknown) => boolean,
): [T, Dispatch<SetStateAction<T>>, boolean] {
  const [value, setValue] = useState<T>(initial);
  // 꺼내기 전에는 적지 않는다 — 처음 값이 기억된 값을 덮어쓰지 않게
  const [ready, setReady] = useState(false);
  const acceptRef = useRef(accept);
  acceptRef.current = accept;

  useEffect(() => {
    const got = read(key);
    if (got.ok && (!acceptRef.current || acceptRef.current(got.value))) setValue(got.value as T);
    setReady(true);
  }, [key]);

  useEffect(() => {
    if (ready) write(key, value);
  }, [key, value, ready]);

  const set = useCallback<Dispatch<SetStateAction<T>>>((v) => setValue(v), []);
  // 셋째 값 — 기억된 값을 꺼내 넣었는가 (useStickyGuard 가 그 뒤에 검사한다)
  return [value, set, ready];
}

/**
 * 기억해 둔 값이 지금은 없는 값이면(지운 사업장 · 다 처리한 계정) 처음 값으로
 * 되돌린다. 화면에 들어온 뒤 **한 번만** — 데이터가 뜨고(ready), 기억된 값을
 * 꺼낸 뒤에. 같은 자리에서 일하는 동안 목록이 줄어드는 건 건드리지 않는다
 * (검토 대기함은 다 처리한 계정을 「(0)」 으로 남겨 보여 준다).
 */
export function useStickyGuard(ready: boolean, stale: boolean, reset: () => void) {
  const done = useRef(false);
  const resetRef = useRef(reset);
  resetRef.current = reset;
  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    if (stale) resetRef.current();
  }, [ready, stale]);
}

/** 정해진 값 중 하나인지 — accept 에 쓴다 */
export const oneOf =
  <T,>(list: readonly T[]) =>
  (v: unknown) =>
    list.includes(v as T);

/** 기억해 둔 필터를 모두 지운다 — 로그아웃 · 세션 만료 */
export function clearStickyState() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    // 저장소를 못 쓰면 지울 것도 없다
  }
}
