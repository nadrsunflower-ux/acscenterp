"use client";

// ============================================================
//  내 채널 · 연결 — 게시 계정(사람마다) · 키 · 서버 연결 상태 · 계정 준비 안내
// ------------------------------------------------------------
//  게시 계정은 연결한 사람의 것이다. 다른 팀원은 소유자가 공유해야 그 계정으로
//  게시할 수 있다. 토큰은 서버에서 암호화되어 브라우저로 오지 않는다.
//  「설정됨」 은 서버에 값이 있다는 뜻일 뿐 계정 · 권한 · 할당량을 확인했다는 뜻이 아니다.
//
//  메뉴는 「내 채널」(/accounts) 과 「연결」(/accounts/connect) 둘이지만 화면은 하나다 —
//  목업(17-accounts)이 한 장으로 이어진 계정 관리 화면이고, 위 요약 카드의 버튼이 아래
//  키 칸으로 이어지기 때문이다. 「연결」 로 들어오면 연결 구간(키 · 준비 순서 · 서버 설정)으로
//  바로 내려가 잠깐 테두리로 짚어 준다.
// ============================================================

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { CalendarClock, HardDrive, KeyRound, Link2, Plug, Server, Trash2, UserCircle2, X } from "lucide-react";
import { Badge, Button, Dialog, Disclosure, Field, Input, cn, useToast } from "@/components/neander/ui";
import { useShorts } from "@/components/neander/shorts/ShortsProvider";
import { CoupangKeyCard, CoupangSubIdsCard, MyChannelSet, YoutubeKeyCard, useSpaceLabel } from "@/components/neander/shorts/MyChannelSet";
import { useAction } from "@/components/neander/shorts/parts";
import { RecordTable, SpaceKindBadge, StageFlow, StudioCard, StudioHeader, StudioNotice, StudioSection, type FlowStep, type RecordColumn } from "@/components/neander/shorts/studio";
import { clearMediaCache, mutate } from "@/lib/neander/shorts/client";

const scrollToId = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

export function AccountsScreen({ focus }: { focus?: "connect" }) {
  const { data, refresh } = useShorts();
  const d = data!;
  const toast = useToast();
  const search = useSearchParams();
  const pathname = usePathname();
  const [manual, setManual] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const s = d.status;
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  // 연결 창(OAuth)에서 돌아왔을 때 — 성공은 알림, 실패는 닫을 때까지 머무는 안내로
  useEffect(() => {
    const err = search.get("error");
    const ok = search.get("connected");
    if (err) setOauthError(err);
    if (ok) {
      toast.success(`${ok === "youtube" ? "YouTube" : "Instagram"} 계정 ${search.get("n") ?? ""}개를 연결했습니다.`);
      void refresh();
    }
    if (err || ok) window.history.replaceState(null, "", pathname || "/neander/shorts/accounts");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 「연결」 메뉴로 들어오면 연결 구간으로 내려가 잠깐 짚어 준다 (다시 그려도 한 번만 — 타이머는 정리)
  useEffect(() => {
    if (focus !== "connect") return;
    const t1 = window.setTimeout(() => {
      scrollToId("connect");
      setFlash(true);
    }, 120);
    const t2 = window.setTimeout(() => setFlash(false), 2800);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [focus]);

  // 계정 준비 순서 — 실제 연결 상태로 끝남 · 지금 · 남음을 정한다
  const mine = d.accounts.filter((a) => a.mine);
  const own = mine.filter((a) => !a.clientId);
  const mineIds = new Set(mine.map((a) => a.id));
  const appReady = (s.youtubeOAuth.configured || s.meta.configured) && s.tokenKey.configured;
  const connected = mine.filter((a) => a.status === "connected").length;
  const registered = own.filter((a) => a.coupangChannel?.registered).length;
  const withSub = own.filter((a) => a.coupangSubId).length;
  const publishedN = d.publications.filter((p) => mineIds.has(p.accountId) && p.status === "published").length;
  const doneFlags = [appReady, connected > 0, own.length > 0 && registered === own.length, own.length > 0 && withSub === own.length, publishedN > 0];
  const firstTodo = doneFlags.findIndex((x) => !x);
  const stepState = (i: number): FlowStep["state"] => (doneFlags[i] ? "done" : i === firstTodo ? "current" : "todo");
  const steps: FlowStep[] = [
    { key: "app", label: "채널 · 앱 준비", hint: appReady ? "서버 설정됨" : "서버 설정 필요", state: stepState(0), onSelect: () => scrollToId("server-status") },
    { key: "conn", label: "계정 연결", hint: `연결됨 ${connected}개`, state: stepState(1), onSelect: () => scrollToId("my-accounts") },
    { key: "reg", label: "쿠팡 활동 채널 등록", hint: own.length ? `${registered}/${own.length}개 등록` : "계정 없음", state: stepState(2), onSelect: () => scrollToId("my-accounts") },
    { key: "sub", label: "채널 아이디 연결", hint: own.length ? `${withSub}/${own.length}개 연결` : "계정 없음", state: stepState(3), onSelect: () => scrollToId("my-coupang-subids") },
    { key: "pub", label: "비공개 시험 게시", hint: publishedN ? `게시 ${publishedN}건` : "아직 없음", state: stepState(4) },
  ];

  // publish — 게시에 꼭 필요한 연결. 없으면 「연결 필요」 (빨강), 선택은 「선택 · 없음」, 나머지는 「미연결」
  type EnvRow = { label: string; ok: boolean; missing: string[]; enables: string; publish?: boolean; optional?: boolean };
  const ENV_ROWS: EnvRow[] = [
    { label: "AI (OpenRouter)", ok: s.openrouter.configured, missing: s.openrouter.configured ? [] : ["OPENROUTER_API_KEY"], enables: "구성 분석 · 대본 · 중국어 검색어 · AI 음성 · AI 영상" },
    { label: "회사 YouTube 검색 키", ok: s.youtubeSearch.configured, missing: s.youtubeSearch.missing, enables: "개인 키가 없는 사람의 검색 표본 · 공개 통계 · 댓글 표본 (search 하루 100회)" },
    { label: "YouTube 게시 OAuth", ok: s.youtubeOAuth.configured, missing: s.youtubeOAuth.missing, enables: "사람마다 YouTube 채널 연결 · 업로드 · 내 영상 통계", publish: true },
    { label: "Instagram (Meta 앱)", ok: s.meta.configured, missing: s.meta.missing, enables: "Facebook 로그인으로 프로페셔널 계정 연결 · 릴스 게시 · 인사이트", publish: true },
    { label: "회사 공용 쿠팡 키", ok: s.companyCoupang.configured, missing: s.coupang.missing, enables: "개인 키가 없는 사람의 상품 검색만 — 딥링크 · 리포트는 각자의 키로", optional: true },
    { label: "토큰 암호화 키", ok: s.tokenKey.configured, missing: s.tokenKey.missing, enables: "게시 계정 토큰 보관 (없으면 NEANDER_MAIL_KEY 에서 끌어냄)", publish: true },
    { label: "주기 실행 (Cron)", ok: s.cron.configured, missing: s.cron.configured ? [] : ["CRON_SECRET"], enables: "매일 06:30 실행기 · 예약 게시 · 성과 다시 읽기" },
  ];
  const envColumns: RecordColumn<EnvRow>[] = [
    {
      key: "label",
      header: "연결",
      mobile: "title",
      cell: (r) => (
        <span className="font-medium">
          {r.label}
          {r.publish && <span className="ml-1.5 text-[13px] font-normal text-nd-fg-3">게시에 필요</span>}
        </span>
      ),
    },
    {
      key: "st",
      header: "설정",
      cell: (r) =>
        r.ok ? (
          <Badge size="lg" tone={r.optional ? "neutral" : "success"}>{r.optional ? "선택 · 설정됨" : "설정됨"}</Badge>
        ) : (
          <Badge size="lg" tone={r.publish ? "danger" : "neutral"}>{r.publish ? "연결 필요" : r.optional ? "선택 · 없음" : "미연결"}</Badge>
        ),
    },
    {
      key: "missing",
      header: "빠진 환경변수",
      className: "md:w-[30%]",
      cell: (r) =>
        r.missing.length && !r.ok ? (
          <ul className="font-mono text-[13px] text-nd-fg-2">
            {r.missing.map((m) => (
              <li key={m} className="break-all">{m}</li>
            ))}
          </ul>
        ) : (
          <span className="text-nd-fg-3">—</span>
        ),
    },
    { key: "en", header: "켜지는 기능", cell: (r) => <span className="text-[13px] text-nd-fg-2">{r.enables}</span> },
  ];
  const usedRatio = s.storage.quotaMb > 0 ? s.storage.usedMb / s.storage.quotaMb : null;
  const nearFull = usedRatio !== null && usedRatio >= 0.9;

  return (
    <div className="space-y-8">
      <StudioHeader
        kicker="사람별"
        kickerIcon={UserCircle2}
        title="내 채널 · 연결"
        description="내 게시 계정과 쿠팡 키를 연결하고, 계정이 속한 프로젝트와 함께 게시할 팀원을 정합니다. 토큰 · 키는 서버에서 암호화되어 화면으로 오지 않습니다 — 모든 사람의 현황은 「사용자별 현황」 에서 봅니다."
      />

      {oauthError && (
        <StudioNotice
          tone="danger"
          title="계정을 연결하지 못했습니다"
          action={
            <Button size="sm" variant="ghost" icon={X} onClick={() => setOauthError(null)}>
              닫기
            </Button>
          }
        >
          {oauthError}
        </StudioNotice>
      )}

      <MyChannelSet onManualInstagram={() => setManual(true)} />

      <StudioSection
        id="connect"
        icon={Plug}
        title="연결 · 키와 서버 설정"
        description="내 키 · 토큰은 나만 씁니다. 서버 설정은 배포 환경변수 — 「설정됨」 은 값이 있다는 뜻일 뿐 계정 · 권한 · 할당량을 확인했다는 뜻이 아닙니다."
        className={cn("rounded-nd-xl transition-shadow duration-500", flash && "ring-2 ring-nd-accent ring-offset-8 ring-offset-nd-page")}
      >
        <div className="space-y-6">
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-4">
              <CoupangKeyCard />
              <YoutubeKeyCard />
            </div>
            <CoupangSubIdsCard />
          </div>

          <StudioCard title="계정 준비 순서" description="계정 · 앱 생성은 사람이 직접 합니다 (ERP 가 만들지 않습니다). 단계는 지금 연결 상태로 표시하고, 누르면 그 칸으로 갑니다.">
            <div className="space-y-4">
              {/* relative — 단계 글자의 sr-only(절대 위치)가 가로 스크롤 상자 밖으로 새어 모바일 화면을 넓히지 않게 */}
              <StageFlow steps={steps} ariaLabel="계정 준비 순서" className="relative" />
              <div className="grid gap-3 lg:grid-cols-3">
                <PrepCard title="YouTube" flow="채널 준비 → 게시 앱 권한 확인 → 계정 연결 → 비공개 시험 게시">
                  <ol className="list-decimal space-y-1.5 pl-5">
                    <li>게시할 Google 계정으로 YouTube 채널을 만듭니다.</li>
                    <li>Google Cloud 프로젝트에서 <b>YouTube Data API v3</b> 를 켭니다.</li>
                    <li>OAuth 동의 화면을 만들고 범위 <code>youtube.upload</code> · <code>youtube.readonly</code> 를 넣습니다. 앱이 「테스트」 상태면 테스트 사용자로 게시 계정을 추가합니다.</li>
                    <li>
                      OAuth 클라이언트(웹 애플리케이션)를 만들고 승인된 리디렉션 URI 에 <code className="break-all">{origin}/api/neander/shorts/oauth/callback</code> 와 운영 주소{" "}
                      <code className="break-all">https://neander-erp.vercel.app/api/neander/shorts/oauth/callback</code> 을 넣습니다.
                    </li>
                    <li>
                      Vercel 환경변수 <code>NEANDER_SHORTS_GOOGLE_CLIENT_ID</code> · <code>NEANDER_SHORTS_GOOGLE_CLIENT_SECRET</code> 을 넣고, 검색용 API 키는 <code>NEANDER_SHORTS_YOUTUBE_API_KEY</code> 에 넣습니다 (HTTP 리퍼러 제한 없이 · API 제한은 YouTube Data API v3 만).
                    </li>
                    <li>감사(audit)를 받지 않은 API 프로젝트의 업로드는 비공개로 제한될 수 있습니다 — 첫 게시는 「비공개」 로 시험하고 YouTube Studio 에서 확인하세요. 업로드는 하루 100회(2026-06 개편) 한도가 따로 있습니다.</li>
                  </ol>
                </PrepCard>
                <PrepCard title="Instagram" flow="프로페셔널 계정 · 페이지 준비 → 앱 권한 확인 → 계정 연결 → 릴스 시험 게시">
                  <ol className="list-decimal space-y-1.5 pl-5">
                    <li>Instagram 계정을 프로페셔널(비즈니스 · 크리에이터) 계정으로 바꾸고 Facebook 페이지에 연결합니다.</li>
                    <li>Meta 개발자 앱(비즈니스 유형)을 만들고 「Facebook 로그인 for Business」 와 Instagram Graph API 를 추가합니다.</li>
                    <li>
                      권한: <code>instagram_basic</code> · <code>instagram_content_publish</code> · <code>instagram_manage_insights</code> · <code>instagram_manage_comments</code> · <code>pages_show_list</code> · <code>pages_read_engagement</code> · <code>business_management</code>. 개발 모드에서는 앱 역할(테스터)인 계정만 됩니다 — 실제 운영은 앱 검수가 필요합니다.
                    </li>
                    <li>
                      유효한 OAuth 리디렉션 URI 에 위와 같은 콜백 주소를 넣고, <code>NEANDER_SHORTS_META_APP_ID</code> · <code>NEANDER_SHORTS_META_APP_SECRET</code> (권한 묶음을 쓰면 <code>NEANDER_SHORTS_META_CONFIG_ID</code>) 을 넣습니다.
                    </li>
                    <li>파일 직접 전송(rupload)은 Facebook 로그인 방식에서만 문서화돼 있어 이 방식을 씁니다. 24시간 게시 한도는 게시 전에 API 로 읽습니다.</li>
                  </ol>
                </PrepCard>
                <PrepCard title="쿠팡 파트너스" flow="최종 승인 → 활동 채널 등록 → 내 키 확인 → 채널 아이디 연결">
                  <ol className="list-decimal space-y-1.5 pl-5">
                    <li>파트너스 최종 승인을 받습니다 (Open API 키는 최종 승인 회원만 · 1개 · 재발급 없음).</li>
                    <li>게시할 YouTube 채널 · Instagram 계정 주소를 <b>활동 채널</b>로 등록합니다 — 미등록 채널 활동은 수익 몰수 · 해지 사유입니다. 등록했으면 위 게시 계정 표의 「활동 채널 등록」 에 체크합니다.</li>
                    <li>채널 아이디(subId, 8~20자 영문·숫자)를 등록하면 리포트를 채널별로 나눠 볼 수 있습니다 (최대 10개 · 미등록 아이디는 정산 제외).</li>
                    <li>
                      Tools → 파트너스 API 에서 받은 키를 이 화면의 「내 쿠팡 키」 에 넣고 「키 확인」 을 누릅니다 (사람마다 자기 키 · 공유 불가). 환경변수 <code>NEANDER_SHORTS_COUPANG_ACCESS_KEY</code> · <code>_SECRET_KEY</code> 는 키가 없는 사람의 <b>검색</b>에만 쓰는 회사 공용 키입니다. 검색 분당 50회 · 리포트 시간당 500회 — 넘으면 24시간 막힙니다.
                    </li>
                  </ol>
                </PrepCard>
              </div>
              <StudioNotice tone="warning" icon={CalendarClock} title="예약 시각에 맞춰 실행되는지 확인하세요">
                실행기는 ERP 화면이 열려 있을 때(AI STUDIO 화면이거나 작업을 만든 브라우저)와 매일 06:30 Vercel Cron 에 돕니다{s.cron.configured ? "" : " — 지금은 CRON_SECRET 이 없어 Cron 이 돌지 않습니다"}. 예약 시각에 아무도 ERP 를 열고 있지 않으면 다음 실행 때 게시됩니다.
              </StudioNotice>
              <Disclosure title="정시에 게시하려면">
                <p className="text-nd-body leading-relaxed">
                  Vercel 요금제를 올려 <code>vercel.json</code> 의 <code>/api/neander/shorts/cron</code> 주기를 <code>*/5 * * * *</code> 로 바꾸거나, 외부 스케줄러가 <code>Authorization: Bearer CRON_SECRET</code> 으로 이 주소를 5분마다 부르게 하세요.
                </p>
              </Disclosure>
            </div>
          </StudioCard>

          <StudioCard id="server-status" className="scroll-mt-24" title={<span className="inline-flex items-center gap-2"><Server size={17} aria-hidden className="text-nd-fg-3" />서버 연결 상태</span>} description="배포 환경변수 — 값은 보이지 않습니다 (있음 · 없음과 빠진 이름만). 위의 내 연결과 다릅니다." flush>
            <RecordTable rows={ENV_ROWS} columns={envColumns} rowKey={(r) => r.label} ariaLabel="서버 연결 상태" className="[&>ul]:px-4" />
            <div className="p-4 sm:px-6 sm:pb-5">
              <div className="rounded-nd-md border border-nd-line bg-nd-sunken/60 px-4 py-3.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="inline-flex items-center gap-2 text-nd-body font-semibold text-nd-fg">
                    <HardDrive size={16} aria-hidden className="text-nd-fg-3" />
                    파일 저장 용량 · Firestore 조각
                  </span>
                  <span className="nd-num text-[13px] text-nd-fg-2">
                    {s.storage.usedMb.toLocaleString("ko-KR")}MB / {s.storage.quotaMb.toLocaleString("ko-KR")}MB
                    {usedRatio !== null && <b className={nearFull ? "ml-2 text-nd-danger-text" : "ml-2 text-nd-fg"}>{Math.round(usedRatio * 100)}%</b>}
                    {nearFull && <span className="ml-1.5 font-medium text-nd-danger-text">거의 참</span>}
                  </span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-nd-fg/[.08]" role="meter" aria-label="파일 저장 사용량" aria-valuemin={0} aria-valuemax={s.storage.quotaMb} aria-valuenow={s.storage.usedMb}>
                  <div className={nearFull ? "h-full rounded-full bg-nd-danger" : "h-full rounded-full bg-nd-accent"} style={{ width: `${Math.max(0, Math.min(100, (usedRatio ?? 0) * 100))}%` }} />
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-nd-fg-3">
                  한도 NEANDER_SHORTS_MEDIA_QUOTA_MB · Firebase Storage 버킷이 없어 ERP 전체의 Firestore 용량을 나눠 씁니다.
                  {s.allowlist.restricted ? " · 사용자 제한: NEANDER_SHORTS_EMAILS 에 있는 사람만" : " · 사용자 제한 없음 (NEANDER 팀원 전체)"}
                </p>
                <Button className="mt-3" size="md" variant="secondary" icon={Trash2} onClick={() => void clearMediaCache().then(() => toast.success("이 브라우저의 파일 사본을 지웠습니다 (서버 파일은 그대로)."))}>
                  이 브라우저의 파일 사본 지우기
                </Button>
              </div>
            </div>
          </StudioCard>
        </div>
      </StudioSection>

      <ManualInstagram open={manual} onClose={() => setManual(false)} onDone={async () => { setManual(false); await refresh(); }} />
    </div>
  );
}

/** 준비 순서 카드 — 한 줄 흐름 + 자세한 순서(펼치기) */
function PrepCard({ title, flow, children }: { title: string; flow: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-nd-md border border-nd-line bg-nd-sunken/60 px-4 py-3.5">
      <h4 className="text-[15px] font-semibold text-nd-fg">{title}</h4>
      <p className="mt-1 text-[14px] leading-relaxed text-nd-fg-2">{flow}</p>
      <Disclosure title="자세한 순서" className="mt-2" bodyClassName="text-[14px] leading-relaxed text-nd-fg-2">
        {children}
      </Disclosure>
    </div>
  );
}

/** Instagram 토큰 직접 입력 — 개발 모드의 시험 계정 · 서버가 확인한 뒤에만 암호화해 저장 */
function ManualInstagram({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const { busy, run } = useAction();
  const here = useSpaceLabel();
  const [f, setF] = useState({ igUserId: "", token: "" });
  useEffect(() => {
    if (open) setF({ igUserId: "", token: "" });
  }, [open]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      closeOnOverlay={false}
      title="Instagram 토큰 직접 입력"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>취소</Button>
          <Button
            icon={Link2}
            disabled={!f.igUserId || !f.token}
            loading={busy === "m"}
            onClick={() => void run("m", async () => { await mutate("account.manualInstagram", f); await onDone(); }, "계정을 확인하고 연결했습니다.")}
          >
            확인 후 연결
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <StudioNotice tone="info" icon={KeyRound} title="Meta 앱 개발 모드의 시험 계정에 쓰세요">
          서버가 읽기 요청으로 계정을 확인한 뒤에만 토큰을 암호화해 보관합니다. 토큰은 다시 보이지 않습니다.
        </StudioNotice>
        <Field label="Instagram 프로페셔널 계정 ID (숫자)">
          <Input value={f.igUserId} inputMode="numeric" placeholder="숫자 계정 아이디" onChange={(e) => setF({ ...f, igUserId: e.target.value.trim() })} />
        </Field>
        <Field label="페이지 접근 토큰" hint="instagram_content_publish 권한이 있는 Facebook 로그인 토큰">
          <Input type="password" value={f.token} onChange={(e) => setF({ ...f, token: e.target.value.trim() })} autoComplete="off" />
        </Field>
        <div>
          <p className="nd-field-label text-nd-caption font-medium text-nd-fg-2">연결할 프로젝트</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-nd-md border border-nd-line bg-nd-sunken/60 px-3 py-2.5">
            <span className="text-nd-body font-medium text-nd-fg">{here.name}</span>
            <SpaceKindBadge kind={here.kind} clientName={here.client} />
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-nd-fg-3">지금 프로젝트에 붙습니다 (이미 연결한 계정이면 원래 프로젝트 그대로). 다른 프로젝트면 창을 닫고 위에서 프로젝트를 먼저 고르세요.</p>
        </div>
      </div>
    </Dialog>
  );
}
