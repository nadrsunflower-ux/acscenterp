import type { Metadata } from "next";
import { Providers } from "@/components/neander/Providers";
import "./neander.css";

export const metadata: Metadata = {
  title: "NEANDER ERP",
  description: "NEANDER 상위 ERP — 매출·일일업무·업무요청·팀원 관리",
};

// NEANDER ERP 영역(/neander/*) 전용 레이아웃.
// 루트 레이아웃의 AC'SCENT <Nav/> 는 AppChrome 에서 /neander 경로에 한해
// 숨겨지므로, 여기서는 NEANDER 전용 인증 게이트 + Shell 만 제공한다.
//
// data-app="neander" 가 디자인 토큰(neander.css)의 유효 범위다. 매장
// 사이트(/id, /wow)는 이 래퍼 밖이라 영향을 받지 않는다. 포탈로 body 에
// 붙는 요소는 Portal 컴포넌트가 같은 속성을 스스로 단다.
export default function NeanderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div data-app="neander" className="min-h-screen">
      <Providers>{children}</Providers>
    </div>
  );
}
