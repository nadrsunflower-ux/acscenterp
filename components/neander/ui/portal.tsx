"use client";

// body 끝에 붙는 포탈 뿌리. data-app="neander" 를 달아 디자인 토큰이
// 포탈 안(대화상자·팝오버·토스트)에도 미치게 한다.
//
// 첫 렌더는 서버와 같게 null 을 그리고(수화 불일치 방지), layout effect 에서
// 뿌리를 잡아 같은 프레임 안에 자식을 붙인다. Popover/Dialog 쪽 위치 계산과
// 포커스 트랩은 패널이 아직 없으면 다음 프레임에 다시 시도한다 (hooks.ts).
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const ROOT_ID = "nd-portal-root";

function ensureRoot(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = ROOT_ID;
    root.setAttribute("data-app", "neander");
    // 토큰 스코프의 배경색이 여기서는 칠해지면 안 된다
    root.style.background = "transparent";
    root.style.minHeight = "0";
    document.body.appendChild(root);
  }
  return root;
}

// 서버에서는 useLayoutEffect 가 경고를 내므로 클라이언트에서만 layout 을 쓴다
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function Portal({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useIsoLayoutEffect(() => {
    setEl(ensureRoot());
  }, []);
  return el ? createPortal(children, el) : null;
}
