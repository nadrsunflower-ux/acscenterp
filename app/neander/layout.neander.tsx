import type { Metadata } from "next";
import { Providers } from "@/components/neander/Providers";

export const metadata: Metadata = {
  title: "NEANDER ERP",
  description: "NEANDER 상위 ERP — 매출·일일업무·업무요청·팀원 관리",
};

// NEANDER ERP 영역(/neander/*) 전용 레이아웃.
// 루트 레이아웃의 AC'SCENT <Nav/> 는 AppChrome 에서 /neander 경로에 한해
// 숨겨지므로, 여기서는 NEANDER 전용 인증 게이트 + Shell 만 제공한다.
export default function NeanderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Providers>{children}</Providers>;
}
