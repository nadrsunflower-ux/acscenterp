// AI STUDIO 개인정보처리방침 — Google OAuth 동의 화면의 「개인정보처리방침」 링크 (로그인 없이 열림)
// 실제 동작과 어긋나면 안 된다: 토큰 암호화(shorts/server/secret.ts) · 연결 끊기(accounts.deleteAccount) ·
// 범위(platforms.YOUTUBE_SCOPES · META_SCOPES) · 외부 처리(OpenRouter) 를 고치면 이 글도 고친다.
import type { Metadata } from "next";
import { LegalPage, OPERATOR, contactEmail } from "@/components/neander/legal/LegalPage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "개인정보처리방침 · NEANDER AI STUDIO" };

export default function Privacy() {
  const email = contactEmail();
  return (
    <LegalPage title="개인정보처리방침" updated="2026-11-01">
      <section>
        <h2>1. 적용 범위</h2>
        <p>
          이 방침은 {OPERATOR}(이하 「회사」)가 운영하는 NEANDER ERP 의 영상 제작 · 게시 도구 AI STUDIO 에 적용됩니다. AI STUDIO 는 회사가 등록한
          구성원만 쓰는 내부 도구입니다.
        </p>
      </section>
      <section>
        <h2>2. 받는 정보</h2>
        <ul>
          <li>ERP 로그인 정보: 구성원의 Google 계정 이메일 · 이름</li>
          <li>YouTube 연결 정보: 채널 ID · 채널 이름, Google 이 발급한 OAuth 토큰 (범위: youtube.upload · youtube.readonly)</li>
          <li>Instagram 연결 정보(연결한 경우): 계정 ID · 이름, Meta 가 발급한 접근 토큰</li>
          <li>AI STUDIO 로 올린 영상의 공개 지표: 조회수 · 좋아요 · 댓글 수 등</li>
          <li>구성원이 직접 올리거나 입력한 것: 영상 · 음성 · 이미지 파일, 대본, 게시 문구, 제휴 프로그램 키</li>
        </ul>
      </section>
      <section>
        <h2>3. 쓰는 목적</h2>
        <ul>
          <li>구성원이 요청한 영상 업로드 · 예약 게시를 실행하고 그 결과를 기록합니다.</li>
          <li>올린 영상의 성과를 ERP 화면에 보여 줍니다.</li>
          <li>받은 정보를 광고, 판매, 다른 서비스 제공, AI 모델 학습에 쓰지 않습니다.</li>
        </ul>
        <p className="mt-2">
          AI STUDIO 가 Google API 에서 받은 정보를 쓰고 다른 앱으로 옮기는 방식은{" "}
          <a className="underline" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
            Google API 서비스 사용자 데이터 정책
          </a>
          (제한적 사용 요건 포함)을 따릅니다.
        </p>
      </section>
      <section>
        <h2>4. 보관과 보호</h2>
        <ul>
          <li>OAuth · 접근 토큰은 AES-256-GCM 으로 암호화해 회사 서버(Google Cloud Firestore)에만 보관하며, 브라우저로 보내지 않습니다.</li>
          <li>파일과 기록은 회사 서버에 보관하고, 구성원이 지우면 함께 지웁니다.</li>
          <li>로그인한 구성원만, 자기 것 또는 공유받은 것만 볼 수 있습니다.</li>
        </ul>
      </section>
      <section>
        <h2>5. 제3자 제공과 처리 위탁</h2>
        <ul>
          <li>받은 정보를 제3자에게 팔거나 제공하지 않습니다.</li>
          <li>서비스 운영을 위해 Vercel(호스팅), Google Cloud(데이터 보관), Google YouTube API · Meta Instagram API(게시 · 지표)를 씁니다.</li>
          <li>
            구성원이 AI 대본 · 음성 · 영상 생성 기능을 쓰면, 그 요청에 들어간 글 · 설정이 OpenRouter 를 거쳐 AI 모델 제공자에게 전달됩니다. YouTube ·
            Instagram 에서 받은 정보는 이 경로로 보내지 않습니다.
          </li>
        </ul>
      </section>
      <section>
        <h2>6. 연결 해제와 삭제</h2>
        <ul>
          <li>ERP 「내 채널 · 연결」 에서 연결을 끊으면 회사 서버에 보관한 토큰을 바로 지웁니다.</li>
          <li>
            Google 계정의{" "}
            <a className="underline" href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
              타사 앱 액세스
            </a>{" "}
            에서 언제든 AI STUDIO 권한을 철회할 수 있습니다.
          </li>
          <li>그 밖의 정보 삭제 · 열람 요청은 아래 문의처로 보내 주시면 처리합니다.</li>
        </ul>
      </section>
      <section>
        <h2>7. 문의</h2>
        <p>
          {OPERATOR} · {email ? <a className="underline" href={`mailto:${email}`}>{email}</a> : "ERP 관리자에게 문의해 주세요."}
        </p>
      </section>
    </LegalPage>
  );
}
