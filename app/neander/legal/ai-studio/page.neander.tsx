// AI STUDIO 소개 — Google OAuth 동의 화면의 「앱 홈페이지」 (로그인 없이 열림)
import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, OPERATOR } from "@/components/neander/legal/LegalPage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "NEANDER AI STUDIO", description: "NEANDER ERP 의 영상 제작 · 게시 도구" };

export default function AiStudioHome() {
  return (
    <LegalPage title="AI STUDIO" updated="2026-11-01">
      <section>
        <p>
          AI STUDIO 는 {OPERATOR} 의 업무 시스템(NEANDER ERP) 안에 있는 영상 제작 · 게시 도구입니다. 회사 구성원이 짧은 세로 영상을
          기획 · 편집하고, 회사가 운영하는 YouTube · Instagram 계정에 올리는 데 씁니다. 일반에 공개된 서비스가 아니며, 회사가 등록한
          구성원만 로그인해 쓸 수 있습니다.
        </p>
      </section>
      <section>
        <h2>Google 계정 연결로 하는 일</h2>
        <ul>
          <li>구성원이 ERP 에서 「게시」 를 누른 영상만 연결한 YouTube 채널에 올립니다 (youtube.upload).</li>
          <li>연결한 채널의 이름 · ID 를 확인하고, AI STUDIO 로 올린 영상의 조회수 · 좋아요 등 공개 지표를 읽어 성과 화면에 보여 줍니다 (youtube.readonly).</li>
          <li>그 밖의 영상을 고치거나 지우지 않고, 시청 기록 · 구독 정보 등 다른 정보를 읽지 않습니다.</li>
        </ul>
      </section>
      <section>
        <p>
          자세한 정보 처리 방식은 <Link className="underline" href="/neander/legal/privacy">개인정보처리방침</Link> 에 있습니다.
        </p>
      </section>
    </LegalPage>
  );
}
