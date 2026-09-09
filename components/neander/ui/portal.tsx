"use client";

// body 끝에 붙는 포탈 뿌리. data-app="neander" 를 달아 디자인 토큰이
// 포탈 안(대화상자·팝오버·토스트)에도 미치게 한다.
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const ROOT_ID = "nd-portal-root";

export function Portal({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
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
    setEl(root);
  }, []);
  return el ? createPortal(children, el) : null;
}
