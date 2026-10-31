// ============================================================
//  공개 안내 페이지 틀 — 로그인 없이 연다 (Providers 의 isPublicPath)
// ------------------------------------------------------------
//  Google OAuth 동의 화면(브랜딩)의 「앱 홈페이지」 · 「개인정보처리방침」 링크가 가리킨다.
//  문의 이메일은 저장소가 공개라 코드에 적지 않고 NEANDER_PUBLIC_CONTACT_EMAIL 에서 읽는다.
// ============================================================
import Link from "next/link";
import type { ReactNode } from "react";

export const OPERATOR = "주식회사 네안데르";

export function contactEmail(): string | null {
  const v = process.env.NEANDER_PUBLIC_CONTACT_EMAIL?.trim();
  return v && /^[^\s@]+@[^\s@]+$/.test(v) ? v : null;
}

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  const email = contactEmail();
  return (
    <main className="mx-auto max-w-2xl px-5 py-12 text-[15px] leading-relaxed text-nd-fg">
      <p className="text-nd-caption text-nd-fg-3">NEANDER AI STUDIO</p>
      <h1 className="mt-1 text-[26px] font-bold">{title}</h1>
      <p className="mt-1 text-nd-caption text-nd-fg-3">시행일 {updated} · 운영 {OPERATOR}</p>
      <div className="mt-8 space-y-7 [&_h2]:mb-2 [&_h2]:text-[17px] [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1">{children}</div>
      <footer className="mt-12 border-t border-nd-line pt-5 text-nd-caption text-nd-fg-3">
        <p>
          {OPERATOR} · 문의 {email ? <a className="underline" href={`mailto:${email}`}>{email}</a> : "ERP 관리자"}
        </p>
        <p className="mt-1 space-x-3">
          <Link className="underline" href="/neander/legal/ai-studio">AI STUDIO 소개</Link>
          <Link className="underline" href="/neander/legal/privacy">개인정보처리방침</Link>
        </p>
      </footer>
    </main>
  );
}
