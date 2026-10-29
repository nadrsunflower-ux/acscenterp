import { redirect } from "next/navigation";

// 기존 북마크도 독립된 가수금 관리 화면으로 이어진다.
export default function LegacySuspensePage() {
  redirect("/neander/finance/suspense");
}
