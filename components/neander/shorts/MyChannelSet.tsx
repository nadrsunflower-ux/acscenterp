"use client";

// ============================================================
//  내 채널 세트 — 내 YouTube · Instagram 계정 + 내 쿠팡 파트너스 + 내 검색 키
// ------------------------------------------------------------
//  ERP 사용자마다 따로다. 쿠팡 키는 나만의 것이라 공유하지 않는다 (파트너스 FAQ —
//  API 키 1개 · 공유 불가). 계정은 공유할 수 있지만, 그 계정용 제휴 링크는 언제나
//  계정 주인(나)의 쿠팡 키 · 채널 아이디로 만들어진다.
//  키는 서버에서 암호화되고, 화면에는 끝 4자리와 상태만 돌아온다.
//  위쪽 카드 네 장은 실제 연결 상태 요약 · 연결 버튼, 아래는 계정 표와 키 입력.
// ============================================================

import { useState, type ReactNode } from "react";
import { Camera, KeyRound, Plug, Plus, Search, ShieldCheck, ShoppingBag, SquarePlay, Trash2, type LucideIcon } from "lucide-react";
import { Badge, Button, Card, Checkbox, Field, FieldAction, FormRow, InlineNotice, Input, SectionHeader, Select, Table, TableScroll, Td, Th, Tr, cn, useConfirm, type Tone } from "@/components/neander/ui";
import { mutate, shortsPost } from "@/lib/neander/shorts/client";
import { PLATFORM_LABEL } from "@/lib/neander/shorts/model";
import type { AccountView, ProfileView } from "@/lib/neander/shorts/types";
import { useShorts } from "./ShortsProvider";
import { fmtWhen, useAction } from "./parts";

const STATUS: Record<ProfileView["coupang"]["status"], { label: string; tone: "neutral" | "warning" | "success" | "danger" }> = {
  none: { label: "키 없음", tone: "neutral" },
  unverified: { label: "넣음 · 확인 전", tone: "warning" },
  ok: { label: "확인됨", tone: "success" },
  failed: { label: "확인 실패", tone: "danger" },
};

/** 게시 계정 상태 — 게시에 꼭 필요하다. 없으면 「연결 필요」 (빨강) */
function publishState(accounts: AccountView[]): { label: string; tone: Tone } {
  if (accounts.some((a) => a.status === "needs_reauth")) return { label: "다시 연결 필요", tone: "danger" };
  const n = accounts.filter((a) => a.status === "connected").length;
  return n ? { label: `연결됨 ${n}`, tone: "success" } : { label: "연결 필요", tone: "danger" };
}

export function MyChannelSet({ onManualInstagram }: { onManualInstagram: () => void }) {
  const { data, refresh, nameOf } = useShorts();
  const d = data!;
  const { busy, run } = useAction();
  const s = d.status;
  const profile = d.profiles.find((x) => x.owner === d.me);
  const mine = d.accounts.filter((a) => a.mine);
  const shared = d.accounts.filter((a) => !a.mine && a.canPublish);
  const yt = mine.filter((a) => a.platform === "youtube");
  const ig = mine.filter((a) => a.platform === "instagram");
  const c = profile?.coupang;
  const coupangSt = STATUS[c?.status ?? "none"];
  const y = profile?.youtubeKey;

  const connect = (platform: "youtube" | "instagram") =>
    run(platform, async () => {
      const r = await shortsPost<{ url: string }>("oauth", { platform });
      window.location.assign(r.url);
    });

  // 연결 버튼이 막힌 이유 — 서버 설정이 빠졌을 때만
  const ytBlocked = !s.youtubeOAuth.configured ? "서버에 YouTube OAuth 가 설정되지 않아 연결할 수 없습니다 — 아래 「서버 연결 상태」 의 빠진 환경변수를 보세요." : !s.tokenKey.configured ? "토큰 암호화 키가 없어 계정을 연결할 수 없습니다." : null;
  const igBlocked = !s.meta.configured ? "서버에 Meta 앱이 설정되지 않아 연결할 수 없습니다 — 아래 「서버 연결 상태」 의 빠진 환경변수를 보세요." : !s.tokenKey.configured ? "토큰 암호화 키가 없어 계정을 연결할 수 없습니다." : null;
  const ytState = publishState(yt);
  const igState = publishState(ig);
  const names = (list: AccountView[]) => list.map((a) => a.externalName).join(", ");

  return (
    <section className="mb-10 space-y-8">
      <div>
        <SectionHeader size="lg" title={`내 채널 세트 — ${nameOf(d.me)}`} hint="토큰 · 키는 서버에서 암호화 — 화면에는 끝 4자리와 상태만 옵니다" />
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
          <ConnCard
            icon={SquarePlay}
            title="YouTube 게시"
            badge={<Badge size="lg" tone={ytState.tone}>{ytState.label}</Badge>}
            detail={yt.length ? <span className="block truncate" title={names(yt)}>{names(yt)}</span> : "연결한 채널이 없습니다 — 게시하려면 연결이 필요합니다."}
            note={ytBlocked}
            actions={<Button size="md" icon={Plug} disabled={!!ytBlocked || busy === "youtube"} onClick={() => void connect("youtube")}>YouTube 연결</Button>}
          />
          <ConnCard
            icon={Camera}
            title="Instagram 게시"
            badge={<Badge size="lg" tone={igState.tone}>{igState.label}</Badge>}
            detail={ig.length ? <span className="block truncate" title={names(ig)}>{names(ig)}</span> : "연결한 프로페셔널 계정이 없습니다 — 게시하려면 연결이 필요합니다."}
            note={igBlocked}
            actions={
              <>
                <Button size="md" icon={Plug} disabled={!!igBlocked || busy === "instagram"} onClick={() => void connect("instagram")}>Instagram 연결</Button>
                <Button size="md" variant="secondary" icon={KeyRound} disabled={!s.tokenKey.configured} onClick={onManualInstagram}>토큰 직접 입력</Button>
              </>
            }
          />
          <ConnCard
            icon={ShoppingBag}
            title="쿠팡 파트너스"
            badge={<Badge size="lg" tone={coupangSt.tone}>{coupangSt.label}</Badge>}
            detail={
              c?.configured ? (
                <>
                  Access Key <span className="font-mono">{c.keyHint ?? "…"}</span>
                  {c.checkedAt ? ` · ${fmtWhen(c.checkedAt)} 확인` : ""}
                </>
              ) : (
                `내 키가 없습니다 — 딥링크 · 리포트는 내 키로만 만듭니다.${s.companyCoupang.configured ? " 검색은 회사 공용 키로 합니다." : ""}`
              )
            }
            note={profile?.subIds.length ? `채널 아이디 ${profile.subIds.length}개 등록` : "채널 아이디 없음"}
            noteTone="muted"
            actions={<a href="#my-coupang" className="text-nd-body font-medium text-nd-accent hover:underline">키 · 채널 아이디 입력</a>}
          />
          <ConnCard
            icon={Search}
            title="YouTube 검색 키 (선택)"
            badge={y?.configured ? <Badge size="lg" tone="success">내 키</Badge> : s.youtubeSearch.configured ? <Badge size="lg" tone="info">회사 키 사용 중</Badge> : <Badge size="lg">미연결</Badge>}
            detail={y?.configured ? <>내 키 <span className="font-mono">{y.hint ?? "…"}</span> — 검색 한도를 회사 키와 따로 씁니다.</> : s.youtubeSearch.configured ? "내 키가 없어 회사 키로 검색합니다 (하루 100회를 함께 씁니다)." : "검색 키가 없습니다 — 검색 표본은 직접 붙여 넣습니다."}
            actions={<a href="#my-youtube-key" className="text-nd-body font-medium text-nd-accent hover:underline">검색 키 입력</a>}
          />
        </div>
      </div>

      <div>
        <SectionHeader title="게시 계정" hint={`YouTube ${yt.length} · Instagram ${ig.length}`} />
        {mine.length === 0 ? (
          <InlineNotice tone="neutral">
            아직 연결한 내 게시 계정이 없습니다 — 게시는 미연결 상태입니다. 아래 「계정 준비」 순서대로 계정과 개발자 앱을 만든 뒤 위 카드에서 연결하세요. 계정이 없어도 소재 발굴 · 대본 · 출력 · 다운로드는 모두 쓸 수 있습니다.
          </InlineNotice>
        ) : (
          <Card padding="none" className="overflow-hidden">
            <TableScroll>
              <Table size="md" minWidth={1040}>
                <thead>
                  <tr>
                    <Th>계정</Th>
                    <Th>상태</Th>
                    <Th>쿠팡 채널 아이디</Th>
                    <Th>쿠팡 활동 채널 등록</Th>
                    <Th>함께 게시할 팀원</Th>
                    <Th> </Th>
                  </tr>
                </thead>
                <tbody>
                  {mine.map((a) => <AccountRow key={a.id} a={a} profile={profile} onChanged={refresh} />)}
                </tbody>
              </Table>
            </TableScroll>
          </Card>
        )}
        {shared.length > 0 && (
          <p className="mt-2 text-[13px] text-nd-fg-3">
            나에게 공유된 계정: {shared.map((a) => `${PLATFORM_LABEL[a.platform]} ${a.externalName} (${nameOf(a.owner)})`).join(" · ")} — 이 계정용 링크는 계정 주인의 쿠팡 키로 만들어집니다.
          </p>
        )}
      </div>

      <CoupangProfile profile={profile} companyKey={s.companyCoupang.configured} onChanged={refresh} />
      <YoutubeKey profile={profile} companyKey={s.youtubeSearch.configured} onChanged={refresh} />
    </section>
  );
}

/** 연결 카드 한 장 — 아이콘 · 이름 · 상태 배지 · 한 줄 설명 · 동작 */
function ConnCard({
  icon: I,
  title,
  badge,
  detail,
  note,
  noteTone = "warning",
  actions,
}: {
  icon: LucideIcon;
  title: string;
  badge: ReactNode;
  detail: ReactNode;
  note?: string | null;
  noteTone?: "warning" | "muted";
  actions: ReactNode;
}) {
  return (
    <Card className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-nd-sm bg-nd-fg/[.06] text-nd-fg-2">
          <I size={18} aria-hidden />
        </span>
        <h3 className="min-w-0 flex-1 truncate text-nd-section text-nd-fg">{title}</h3>
        {badge}
      </div>
      <div className="min-w-0 text-nd-body text-nd-fg-2">{detail}</div>
      {note && <p className={cn("text-[13px]", noteTone === "warning" ? "text-nd-warning-text" : "text-nd-fg-3")}>{note}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">{actions}</div>
    </Card>
  );
}

function AccountRow({ a, profile, onChanged }: { a: AccountView; profile: ProfileView | undefined; onChanged: () => Promise<void> }) {
  const ask = useConfirm();
  const { busy, run } = useAction();
  const [share, setShare] = useState(a.sharedWith.join(", "));
  const [url, setUrl] = useState(a.coupangChannel?.url ?? "");
  const subs = profile?.subIds ?? [];
  return (
    <Tr hover={false}>
      <Td className="align-top">
        <span className="font-medium">{PLATFORM_LABEL[a.platform]} · {a.externalName}</span>
        <div className="text-[13px] text-nd-fg-3">{a.authMode === "google_oauth" ? "Google OAuth" : a.authMode === "facebook_login" ? "Facebook 로그인" : "토큰 직접 입력"} · {fmtWhen(a.createdAt)} 연결</div>
      </Td>
      <Td className="align-top whitespace-nowrap">{a.status === "connected" ? <Badge size="lg" tone="success">연결됨</Badge> : <Badge size="lg" tone="danger">다시 연결 필요</Badge>}</Td>
      <Td className="align-top">
        <Select size="sm" aria-label={`${a.externalName} 채널 아이디`} value={a.coupangSubId ?? ""} disabled={busy === "sub"} onChange={(e) => void run("sub", async () => { await mutate("account.update", { id: a.id, coupangSubId: e.target.value }); await onChanged(); })}>
          <option value="">(없음)</option>
          {subs.map((x) => <option key={x.id} value={x.id}>{x.id}{x.label ? ` · ${x.label}` : ""}</option>)}
        </Select>
        {!subs.length && <p className="mt-1 text-[13px] text-nd-fg-3">아래 쿠팡 칸에서 채널 아이디를 먼저 등록</p>}
      </Td>
      <Td className="align-top">
        <div className="flex flex-col gap-1.5">
          <Checkbox
            label={<span className="text-[13px]">내 파트너스에 등록함{a.coupangChannel ? ` (${fmtWhen(a.coupangChannel.at)})` : ""}</span>}
            checked={!!a.coupangChannel?.registered}
            onChange={(e) => void run("cc", async () => { await mutate("account.update", { id: a.id, coupangChannel: e.target.checked ? { registered: true, url } : null }); await onChanged(); })}
          />
          <Input size="sm" value={url} placeholder="등록한 채널 주소" onChange={(e) => setUrl(e.target.value)} aria-label="등록한 채널 주소" />
        </div>
      </Td>
      <Td className="align-top">
        <div className="flex items-center gap-1.5">
          <Input size="sm" value={share} placeholder="팀원 이메일 (쉼표)" onChange={(e) => setShare(e.target.value)} aria-label="공유할 팀원" />
          <Button size="sm" variant="secondary" disabled={busy === "sh"} onClick={() => void run("sh", async () => { await mutate("account.update", { id: a.id, sharedWith: share.split(",").map((x) => x.trim()).filter(Boolean) }); await onChanged(); }, "공유 대상을 저장했습니다.")}>저장</Button>
        </div>
      </Td>
      <Td className="align-top">
        <Button size="sm" variant="ghost" icon={Trash2} aria-label="연결 끊기" title="연결 끊기" onClick={async () => {
          if (!(await ask({ title: "연결을 끊을까요?", message: "ERP 에 보관한 토큰만 지웁니다. Google · Meta 계정의 앱 권한은 각 계정 설정에서 따로 해제하세요.", tone: "danger", confirmLabel: "끊기" }))) return;
          await run("del", async () => { await mutate("account.delete", { id: a.id }); await onChanged(); });
        }} />
      </Td>
    </Tr>
  );
}

function CoupangProfile({ profile, companyKey, onChanged }: { profile: ProfileView | undefined; companyKey: boolean; onChanged: () => Promise<void> }) {
  const ask = useConfirm();
  const { busy, run } = useAction();
  const [keys, setKeys] = useState({ accessKey: "", secretKey: "" });
  const [af, setAf] = useState(profile?.coupang.afCode ?? "");
  const [subs, setSubs] = useState(profile?.subIds ?? []);
  const [newSub, setNewSub] = useState({ id: "", label: "" });
  const c = profile?.coupang;
  const st = STATUS[c?.status ?? "none"];
  return (
    <div id="my-coupang" className="scroll-mt-6">
      <SectionHeader
        title={<span className="inline-flex flex-wrap items-center gap-2">내 쿠팡 파트너스 <Badge size="lg" tone={st.tone}>{st.label}</Badge></span>}
        hint={[c?.keyHint ? `Access Key ${c.keyHint}` : "", c?.checkedAt ? `${fmtWhen(c.checkedAt)} 확인` : ""].filter(Boolean).join(" · ") || undefined}
      />
      <Card className="space-y-5">
        {c?.message && c.status !== "none" && <InlineNotice tone={c.status === "ok" ? "success" : c.status === "failed" ? "danger" : "neutral"}>{c.message}</InlineNotice>}
        <FormRow className="grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,2fr)_auto]">
          <Field label="파트너스 아이디 (AF…)" hint="기록용"><Input value={af} onChange={(e) => setAf(e.target.value)} /></Field>
          <Field label="Access Key"><Input type="password" autoComplete="off" value={keys.accessKey} placeholder={c?.configured ? "바꿀 때만 입력" : ""} onChange={(e) => setKeys({ ...keys, accessKey: e.target.value.trim() })} /></Field>
          <Field label="Secret Key"><Input type="password" autoComplete="off" value={keys.secretKey} placeholder={c?.configured ? "바꿀 때만 입력" : ""} onChange={(e) => setKeys({ ...keys, secretKey: e.target.value.trim() })} /></Field>
          <FieldAction size="md">
            <Button icon={ShieldCheck} disabled={busy === "k" || (!keys.accessKey && !keys.secretKey && af === (c?.afCode ?? ""))} onClick={() => void run("k", async () => {
              if (keys.accessKey || keys.secretKey) await mutate("profile.saveCoupangKeys", { ...keys, afCode: af });
              else await mutate("profile.saveMeta", { afCode: af });
              setKeys({ accessKey: "", secretKey: "" });
              await onChanged();
            }, "저장했습니다 — 키는 서버에서 암호화해 보관합니다.")}>저장</Button>
          </FieldAction>
        </FormRow>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button variant="secondary" disabled={!c?.configured || busy === "v"} onClick={() => void run("v", async () => { await mutate("profile.verifyCoupang"); await onChanged(); })}>키 확인 (검색 1건)</Button>
          {c?.configured && (
            <Button variant="ghost" icon={Trash2} onClick={async () => {
              if (!(await ask({ title: "쿠팡 키를 지울까요?", message: "이미 만든 제휴 링크는 그대로입니다. 새 딥링크 · 리포트를 내 키로 못 만들게 됩니다.", tone: "danger", confirmLabel: "지우기" }))) return;
              await run("dk", async () => { await mutate("profile.deleteCoupangKeys"); await onChanged(); });
            }}>키 지우기</Button>
          )}
          <span className="min-w-0 flex-1 text-[13px] text-nd-fg-3">
            딥링크 · 리포트는 이 키로만 만듭니다 (수수료 · 실적이 키 주인에게 붙습니다). 검색은 이 키가 없으면 {companyKey ? "회사 공용 키" : "직접 검색"}로 합니다.
          </span>
        </div>

        <div className="border-t border-nd-line pt-4">
          <p className="mb-2 text-nd-body font-medium text-nd-fg">채널 아이디 (subId) <span className="text-[13px] font-normal text-nd-fg-3">— 파트너스에 등록한 것만 · 최대 10개</span></p>
          {subs.length > 0 && (
            <ul className="mb-3 divide-y divide-nd-line rounded-nd-md border border-nd-line">
              {subs.map((x, i) => (
                <li key={x.id} className="flex items-center gap-3 px-3 py-2 text-nd-body">
                  <code className="rounded bg-nd-fg/[.05] px-1.5 py-0.5 text-[13px]">{x.id}</code>
                  <span className="min-w-0 flex-1 truncate text-nd-fg-2" title={x.label}>{x.label}</span>
                  <Button size="sm" variant="ghost" icon={Trash2} aria-label={`${x.id} 지우기`} title={`${x.id} 지우기`} onClick={() => setSubs(subs.filter((_, j) => j !== i))} />
                </li>
              ))}
            </ul>
          )}
          <FormRow className="grid-cols-1 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_auto_auto]">
            <Field label="채널 아이디"><Input value={newSub.id} onChange={(e) => setNewSub({ ...newSub, id: e.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 20) })} placeholder="8~20자 영문·숫자" /></Field>
            <Field label="이름"><Input value={newSub.label} onChange={(e) => setNewSub({ ...newSub, label: e.target.value })} placeholder="예: 유튜브 쇼츠" /></Field>
            <FieldAction size="md">
              <Button variant="secondary" icon={Plus} disabled={!/^[A-Za-z0-9]{8,20}$/.test(newSub.id) || subs.length >= 10} onClick={() => { setSubs([...subs.filter((x) => x.id !== newSub.id), newSub]); setNewSub({ id: "", label: "" }); }}>더하기</Button>
            </FieldAction>
            <FieldAction size="md">
              <Button disabled={busy === "subs" || JSON.stringify(subs) === JSON.stringify(profile?.subIds ?? [])} onClick={() => void run("subs", async () => { await mutate("profile.saveMeta", { subIds: subs }); await onChanged(); }, "채널 아이디를 저장했습니다.")}>목록 저장</Button>
            </FieldAction>
          </FormRow>
        </div>
      </Card>
    </div>
  );
}

function YoutubeKey({ profile, companyKey, onChanged }: { profile: ProfileView | undefined; companyKey: boolean; onChanged: () => Promise<void> }) {
  const { busy, run } = useAction();
  const [key, setKey] = useState("");
  const y = profile?.youtubeKey;
  return (
    <div id="my-youtube-key" className="scroll-mt-6">
      <SectionHeader
        title={<span className="inline-flex flex-wrap items-center gap-2">내 YouTube 검색 키 (선택) {y?.configured ? <Badge size="lg" tone="success">{y.hint}</Badge> : <Badge size="lg">{companyKey ? "회사 키 사용 중" : "없음"}</Badge>}</span>}
      />
      <Card>
        <FormRow className="grid-cols-1 lg:grid-cols-[minmax(0,3fr)_auto_auto]">
          <Field label="YouTube Data API 키" hint="내 Google Cloud 프로젝트의 키 — 검색 한도(하루 100회)를 회사 키와 따로 씁니다">
            <Input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value.trim())} />
          </Field>
          <FieldAction size="md">
            <Button disabled={!key || busy === "y"} onClick={() => void run("y", async () => { await mutate("profile.saveYoutubeKey", { key }); setKey(""); await onChanged(); }, "저장했습니다.")}>저장</Button>
          </FieldAction>
          <FieldAction size="md">
            <Button variant="ghost" disabled={!y?.configured || busy === "yd"} onClick={() => void run("yd", async () => { await mutate("profile.saveYoutubeKey", { key: "" }); await onChanged(); })}>지우기</Button>
          </FieldAction>
        </FormRow>
      </Card>
    </div>
  );
}
