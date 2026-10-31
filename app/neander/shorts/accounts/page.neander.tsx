"use client";

// ============================================================
//  계정 · 연결 — 게시 계정(사람마다) · 서버 연결 상태 · 계정 준비 안내
// ------------------------------------------------------------
//  게시 계정은 연결한 사람의 것이다. 다른 팀원은 소유자가 공유해야 그 계정으로
//  게시할 수 있다. 토큰은 서버에서 암호화되어 브라우저로 오지 않는다.
//  「설정됨」 은 서버에 값이 있다는 뜻일 뿐 계정 · 권한 · 할당량을 확인했다는 뜻이 아니다.
// ============================================================

import { Suspense, useEffect, useState } from "react";
import { HardDrive, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Button, Card, Dialog, Disclosure, Field, Input, PageHeader, PageShell, SectionHeader, Table, TableScroll, Td, Th, Tr, useToast } from "@/components/neander/ui";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { MyChannelSet } from "@/components/neander/shorts/MyChannelSet";
import { ConnBadge, useAction } from "@/components/neander/shorts/parts";
import { clearMediaCache, mutate } from "@/lib/neander/shorts/client";

export default function AccountsPage() {
  // useSearchParams 를 쓰는 화면은 Suspense 경계가 있어야 정적 빌드가 된다
  return (
    <Suspense>
      <Accounts />
    </Suspense>
  );
}

function Accounts() {
  const { data, refresh } = useShorts();
  const d = data!;
  const toast = useToast();
  const search = useSearchParams();
  const [manual, setManual] = useState(false);
  const s = d.status;
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  useEffect(() => {
    const err = search.get("error");
    const ok = search.get("connected");
    if (err) toast.error(err);
    if (ok) {
      toast.success(`${ok === "youtube" ? "YouTube" : "Instagram"} 계정 ${search.get("n") ?? ""}개를 연결했습니다.`);
      void refresh();
    }
    if (err || ok) window.history.replaceState(null, "", "/neander/shorts/accounts");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // publish — 게시에 꼭 필요한 연결. 없으면 「연결 필요」 (빨강), 나머지는 「미연결」
  const ENV_ROWS: { label: string; ok: boolean; missing: string[]; enables: string; publish?: boolean }[] = [
    { label: "AI (OpenRouter)", ok: s.openrouter.configured, missing: s.openrouter.configured ? [] : ["OPENROUTER_API_KEY"], enables: "구성 분석 · 대본 · 중국어 검색어 · AI 음성 · AI 영상" },
    { label: "회사 YouTube 검색 키", ok: s.youtubeSearch.configured, missing: s.youtubeSearch.missing, enables: "개인 키가 없는 사람의 검색 표본 · 공개 통계 · 댓글 표본 (search 하루 100회)" },
    { label: "YouTube 게시 OAuth", ok: s.youtubeOAuth.configured, missing: s.youtubeOAuth.missing, enables: "사람마다 YouTube 채널 연결 · 업로드 · 내 영상 통계", publish: true },
    { label: "Instagram (Meta 앱)", ok: s.meta.configured, missing: s.meta.missing, enables: "Facebook 로그인으로 프로페셔널 계정 연결 · 릴스 게시 · 인사이트", publish: true },
    { label: "회사 공용 쿠팡 키 (선택)", ok: s.companyCoupang.configured, missing: s.coupang.missing, enables: "개인 키가 없는 사람의 상품 검색만 — 딥링크 · 리포트는 각자의 키로" },
    { label: "토큰 암호화 키", ok: s.tokenKey.configured, missing: s.tokenKey.missing, enables: "게시 계정 토큰 보관 (없으면 NEANDER_MAIL_KEY 에서 끌어냄)", publish: true },
    { label: "주기 실행 (Cron)", ok: s.cron.configured, missing: s.cron.configured ? [] : ["CRON_SECRET"], enables: "매일 06:30 실행기 · 예약 게시 · 성과 다시 읽기" },
  ];
  const usedRatio = s.storage.quotaMb > 0 ? s.storage.usedMb / s.storage.quotaMb : null;
  const nearFull = usedRatio !== null && usedRatio >= 0.9;

  return (
    <PageShell>
      <PageHeader title="내 채널 · 연결" description="사람마다 자기 채널 세트(YouTube · Instagram 계정 + 쿠팡 파트너스 키 · 채널 아이디)를 따로 둡니다. 토큰 · 키는 서버에서 암호화되어 화면으로 오지 않습니다. 모든 사람의 현황은 「사용자별 현황」 에서 봅니다." />

      <MyChannelSet onManualInstagram={() => setManual(true)} />

      <section className="mb-10">
        <SectionHeader size="lg" title="서버 연결 상태" hint="값은 보이지 않습니다 — 있음 · 없음과 빠진 이름만" />
        <Card padding="none" className="overflow-hidden">
          <TableScroll>
            <Table size="md" minWidth={900}>
              <thead>
                <tr>
                  <Th>연결</Th>
                  <Th>상태</Th>
                  <Th>빠진 환경변수</Th>
                  <Th>켜지는 기능</Th>
                </tr>
              </thead>
              <tbody>
                {ENV_ROWS.map((r) => (
                  <Tr key={r.label}>
                    <Td className="whitespace-nowrap font-medium">{r.label}</Td>
                    <Td className="whitespace-nowrap">
                      <ConnBadge ok={r.ok} size="lg" off={r.publish ? "연결 필요" : "미연결"} offTone={r.publish ? "danger" : "neutral"} />
                    </Td>
                    <Td className="w-[34%] max-w-0">
                      {r.missing.length ? (
                        <ul className="font-mono text-[13px] text-nd-fg-2">
                          {r.missing.map((m) => <li key={m} className="break-all">{m}</li>)}
                        </ul>
                      ) : (
                        <span className="text-nd-fg-3">—</span>
                      )}
                    </Td>
                    <Td className="text-[13px] text-nd-fg-2">{r.enables}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        </Card>

        <Card className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <HardDrive size={18} aria-hidden className="shrink-0 text-nd-fg-3" />
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-nd-body font-medium text-nd-fg">파일 저장 · Firestore 조각</span>
                  <span className="nd-num text-[13px] text-nd-fg-2">
                    {s.storage.usedMb.toLocaleString("ko-KR")}MB / {s.storage.quotaMb.toLocaleString("ko-KR")}MB
                    {usedRatio !== null && <b className={nearFull ? "ml-2 text-nd-danger-text" : "ml-2 text-nd-fg"}>{Math.round(usedRatio * 100)}%</b>}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-nd-fg/[.08]" role="meter" aria-label="파일 저장 사용량" aria-valuemin={0} aria-valuemax={s.storage.quotaMb} aria-valuenow={s.storage.usedMb}>
                  <div className={nearFull ? "h-full rounded-full bg-nd-danger" : "h-full rounded-full bg-nd-accent"} style={{ width: `${Math.max(0, Math.min(100, (usedRatio ?? 0) * 100))}%` }} />
                </div>
                <p className="mt-2 text-[13px] text-nd-fg-3">
                  한도 NEANDER_SHORTS_MEDIA_QUOTA_MB · Firebase Storage 버킷이 없어 ERP 전체의 Firestore 용량을 나눠 씁니다.
                  {s.allowlist.restricted ? " · 사용자 제한: NEANDER_SHORTS_EMAILS 에 있는 사람만" : " · 사용자 제한 없음 (NEANDER 팀원 전체)"}
                </p>
              </div>
            </div>
            <Button size="md" variant="secondary" icon={Trash2} onClick={() => void clearMediaCache().then(() => toast.success("이 브라우저의 파일 사본을 지웠습니다 (서버 파일은 그대로)."))}>이 브라우저의 파일 사본 지우기</Button>
          </div>
        </Card>
      </section>

      <section>
        <SectionHeader size="lg" title="계정 준비" hint="계정 · 앱 생성은 사람이 직접 합니다 (ERP 가 만들지 않습니다)" />
        <div className="space-y-2">
          <Disclosure title="① YouTube — 채널 · Google Cloud OAuth">
            <ol className="list-decimal space-y-1.5 pl-5 text-nd-body">
              <li>게시할 Google 계정으로 YouTube 채널을 만듭니다.</li>
              <li>Google Cloud 프로젝트에서 <b>YouTube Data API v3</b> 를 켭니다.</li>
              <li>OAuth 동의 화면을 만들고 범위 <code>youtube.upload</code> · <code>youtube.readonly</code> 를 넣습니다. 앱이 「테스트」 상태면 테스트 사용자로 게시 계정을 추가합니다.</li>
              <li>OAuth 클라이언트(웹 애플리케이션)를 만들고 승인된 리디렉션 URI 에 <code>{origin}/api/neander/shorts/oauth/callback</code> 와 운영 주소 <code>https://neander-erp.vercel.app/api/neander/shorts/oauth/callback</code> 을 넣습니다.</li>
              <li>Vercel 환경변수 <code>NEANDER_SHORTS_GOOGLE_CLIENT_ID</code> · <code>NEANDER_SHORTS_GOOGLE_CLIENT_SECRET</code> 을 넣고, 검색용 API 키는 <code>NEANDER_SHORTS_YOUTUBE_API_KEY</code> 에 넣습니다 (HTTP 리퍼러 제한 없이 · API 제한은 YouTube Data API v3 만).</li>
              <li>감사(audit)를 받지 않은 API 프로젝트의 업로드는 비공개로 제한될 수 있습니다 — 첫 게시는 「비공개」 로 시험하고 YouTube Studio 에서 확인하세요. 업로드는 하루 100회(2026-06 개편) 한도가 따로 있습니다.</li>
            </ol>
          </Disclosure>
          <Disclosure title="② Instagram — 프로페셔널 계정 · Facebook 페이지 · Meta 앱">
            <ol className="list-decimal space-y-1.5 pl-5 text-nd-body">
              <li>Instagram 계정을 프로페셔널(비즈니스 · 크리에이터) 계정으로 바꾸고 Facebook 페이지에 연결합니다.</li>
              <li>Meta 개발자 앱(비즈니스 유형)을 만들고 「Facebook 로그인 for Business」 와 Instagram Graph API 를 추가합니다.</li>
              <li>권한: <code>instagram_basic</code> · <code>instagram_content_publish</code> · <code>instagram_manage_insights</code> · <code>instagram_manage_comments</code> · <code>pages_show_list</code> · <code>pages_read_engagement</code> · <code>business_management</code>. 개발 모드에서는 앱 역할(테스터)인 계정만 됩니다 — 실제 운영은 앱 검수가 필요합니다.</li>
              <li>유효한 OAuth 리디렉션 URI 에 위와 같은 콜백 주소를 넣고, <code>NEANDER_SHORTS_META_APP_ID</code> · <code>NEANDER_SHORTS_META_APP_SECRET</code> (권한 묶음을 쓰면 <code>NEANDER_SHORTS_META_CONFIG_ID</code>) 을 넣습니다.</li>
              <li>파일 직접 전송(rupload)은 Facebook 로그인 방식에서만 문서화돼 있어 이 방식을 씁니다. 24시간 게시 한도는 게시 전에 API 로 읽습니다.</li>
            </ol>
          </Disclosure>
          <Disclosure title="③ 쿠팡 파트너스 — 최종 승인 · 활동 채널 · API 키">
            <ol className="list-decimal space-y-1.5 pl-5 text-nd-body">
              <li>파트너스 최종 승인을 받습니다 (Open API 키는 최종 승인 회원만 · 1개 · 재발급 없음).</li>
              <li>게시할 YouTube 채널 · Instagram 계정 주소를 <b>활동 채널</b>로 등록합니다 — 미등록 채널 활동은 수익 몰수 · 해지 사유입니다. 등록했으면 위 표의 「쿠팡 활동 채널 등록」 에 체크합니다.</li>
              <li>채널 아이디(subId, 8~20자 영문·숫자)를 등록하면 리포트를 채널별로 나눠 볼 수 있습니다 (최대 10개 · 미등록 아이디는 정산 제외).</li>
              <li>Tools → 파트너스 API 에서 받은 키를 이 화면 위 「내 채널 세트」 에 넣고 「키 확인」 을 누릅니다 (사람마다 자기 키 · 공유 불가). 환경변수 <code>NEANDER_SHORTS_COUPANG_ACCESS_KEY</code> · <code>_SECRET_KEY</code> 는 키가 없는 사람의 <b>검색</b>에만 쓰는 회사 공용 키입니다. 검색 분당 50회 · 리포트 시간당 500회 — 넘으면 24시간 막힙니다.</li>
            </ol>
          </Disclosure>
          <Disclosure title="④ 예약 게시를 정시에">
            <p className="text-nd-body">
              실행기는 ERP 화면이 열려 있을 때(AI STUDIO 화면이거나 작업을 만든 브라우저)와 매일 06:30 Vercel Cron 에 돕니다. 기존 cron 과 같은 하루 한 번 주기라, 예약 시각에 아무도 ERP 를 열고 있지 않으면 다음 실행 때 게시됩니다.
              정시가 필요하면 Vercel 요금제를 올려 <code>vercel.json</code> 의 <code>/api/neander/shorts/cron</code> 주기를 <code>*/5 * * * *</code> 로 바꾸거나, 외부 스케줄러가 <code>Authorization: Bearer CRON_SECRET</code> 으로 이 주소를 5분마다 부르게 하세요.
            </p>
          </Disclosure>
        </div>
      </section>

      {manual && <ManualInstagram onClose={() => setManual(false)} onDone={async () => { setManual(false); await refresh(); }} />}
    </PageShell>
  );
}

function ManualInstagram({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const { busy, run } = useAction();
  const [f, setF] = useState({ igUserId: "", token: "" });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Instagram 토큰 직접 입력"
      description="Meta 앱 개발 모드에서 테스터 계정으로 시험할 때 씁니다. 서버가 읽기 요청으로 계정을 확인한 뒤에만 암호화해 저장합니다."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>취소</Button>
          <Button disabled={busy === "m" || !f.igUserId || !f.token} onClick={() => void run("m", async () => { await mutate("account.manualInstagram", f); await onDone(); }, "계정을 확인하고 연결했습니다.")}>확인 후 연결</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Instagram 프로페셔널 계정 ID (숫자)"><Input value={f.igUserId} onChange={(e) => setF({ ...f, igUserId: e.target.value.trim() })} /></Field>
        <Field label="페이지 접근 토큰" hint="instagram_content_publish 권한이 있는 Facebook 로그인 토큰"><Input type="password" value={f.token} onChange={(e) => setF({ ...f, token: e.target.value.trim() })} autoComplete="off" /></Field>
      </div>
    </Dialog>
  );
}
