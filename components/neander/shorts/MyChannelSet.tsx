"use client";

// ============================================================
//  내 채널 세트 — 내 YouTube · Instagram 계정 + 내 쿠팡 파트너스 + 내 검색 키
// ------------------------------------------------------------
//  ERP 사용자마다 따로다. 쿠팡 키는 나만의 것이라 공유하지 않는다 (파트너스 FAQ —
//  API 키 1개 · 공유 불가). 계정은 공유할 수 있지만, 그 계정용 제휴 링크는 언제나
//  계정 주인(나)의 쿠팡 키 · 채널 아이디로 만들어진다.
//  키는 서버에서 암호화되고, 화면에는 끝 4자리와 상태만 돌아온다.
// ============================================================

import { useState } from "react";
import { KeyRound, Plug, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Badge, Button, Card, Checkbox, Field, FormRow, InlineNotice, Input, SectionHeader, Select, Table, TableScroll, Td, Th, Tr, useConfirm } from "@/components/neander/ui";
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

export function MyChannelSet({ onManualInstagram }: { onManualInstagram: () => void }) {
  const { data, refresh, nameOf } = useShorts();
  const d = data!;
  const { busy, run } = useAction();
  const s = d.status;
  const profile = d.profiles.find((x) => x.owner === d.me);
  const mine = d.accounts.filter((a) => a.mine);
  const shared = d.accounts.filter((a) => !a.mine && a.canPublish);

  const connect = (platform: "youtube" | "instagram") =>
    run(platform, async () => {
      const r = await shortsPost<{ url: string }>("oauth", { platform });
      window.location.assign(r.url);
    });

  return (
    <section className="mb-8 space-y-6">
      <SectionHeader
        title={`내 채널 세트 — ${nameOf(d.me)}`}
        hint={`YouTube ${mine.filter((a) => a.platform === "youtube").length} · Instagram ${mine.filter((a) => a.platform === "instagram").length} · 쿠팡 ${profile ? STATUS[profile.coupang.status].label : "키 없음"}`}
      />

      <div>
        <p className="mb-2 text-nd-body font-medium">게시 계정</p>
        <div className="mb-3 flex flex-wrap gap-2">
          <Button size="sm" icon={Plug} disabled={!s.youtubeOAuth.configured || !s.tokenKey.configured || busy === "youtube"} onClick={() => void connect("youtube")}>YouTube 연결</Button>
          <Button size="sm" icon={Plug} disabled={!s.meta.configured || !s.tokenKey.configured || busy === "instagram"} onClick={() => void connect("instagram")}>Instagram 연결</Button>
          <Button size="sm" variant="secondary" icon={KeyRound} disabled={!s.tokenKey.configured} onClick={onManualInstagram}>Instagram 토큰 직접 입력</Button>
        </div>
        {mine.length === 0 ? (
          <InlineNotice tone="neutral">
            아직 연결한 내 게시 계정이 없습니다 — 게시는 미연결 상태입니다. 아래 「계정 준비」 순서대로 계정과 개발자 앱을 만든 뒤 연결하세요. 계정이 없어도 소재 발굴 · 대본 · 출력 · 다운로드는 모두 쓸 수 있습니다.
          </InlineNotice>
        ) : (
          <Card padding="none">
            <TableScroll>
              <Table minWidth={980}>
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
          <p className="mt-2 text-nd-caption text-nd-fg-3">
            나에게 공유된 계정: {shared.map((a) => `${PLATFORM_LABEL[a.platform]} ${a.externalName} (${nameOf(a.owner)})`).join(" · ")} — 이 계정용 링크는 계정 주인의 쿠팡 키로 만들어집니다.
          </p>
        )}
      </div>

      <CoupangProfile profile={profile} companyKey={s.companyCoupang.configured} onChanged={refresh} />
      <YoutubeKey profile={profile} companyKey={s.youtubeSearch.configured} onChanged={refresh} />
    </section>
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
      <Td>
        <span className="font-medium">{PLATFORM_LABEL[a.platform]} · {a.externalName}</span>
        <div className="text-nd-caption text-nd-fg-3">{a.authMode === "google_oauth" ? "Google OAuth" : a.authMode === "facebook_login" ? "Facebook 로그인" : "토큰 직접 입력"} · {fmtWhen(a.createdAt)} 연결</div>
      </Td>
      <Td>{a.status === "connected" ? <Badge tone="success">연결됨</Badge> : <Badge tone="warning">다시 연결 필요</Badge>}</Td>
      <Td>
        <Select size="sm" aria-label={`${a.externalName} 채널 아이디`} value={a.coupangSubId ?? ""} disabled={busy === "sub"} onChange={(e) => void run("sub", async () => { await mutate("account.update", { id: a.id, coupangSubId: e.target.value }); await onChanged(); })}>
          <option value="">(없음)</option>
          {subs.map((x) => <option key={x.id} value={x.id}>{x.id}{x.label ? ` · ${x.label}` : ""}</option>)}
        </Select>
        {!subs.length && <p className="mt-1 text-nd-caption text-nd-fg-3">아래 쿠팡 칸에서 채널 아이디를 먼저 등록</p>}
      </Td>
      <Td>
        <div className="flex flex-col gap-1">
          <Checkbox
            label={<span className="text-nd-caption">내 파트너스에 등록함{a.coupangChannel ? ` (${fmtWhen(a.coupangChannel.at)})` : ""}</span>}
            checked={!!a.coupangChannel?.registered}
            onChange={(e) => void run("cc", async () => { await mutate("account.update", { id: a.id, coupangChannel: e.target.checked ? { registered: true, url } : null }); await onChanged(); })}
          />
          <Input size="sm" value={url} placeholder="등록한 채널 주소" onChange={(e) => setUrl(e.target.value)} aria-label="등록한 채널 주소" />
        </div>
      </Td>
      <Td>
        <div className="flex items-center gap-1">
          <Input size="sm" value={share} placeholder="팀원 이메일 (쉼표)" onChange={(e) => setShare(e.target.value)} aria-label="공유할 팀원" />
          <Button size="sm" variant="secondary" disabled={busy === "sh"} onClick={() => void run("sh", async () => { await mutate("account.update", { id: a.id, sharedWith: share.split(",").map((x) => x.trim()).filter(Boolean) }); await onChanged(); }, "공유 대상을 저장했습니다.")}>저장</Button>
        </div>
      </Td>
      <Td>
        <Button size="sm" variant="ghost" icon={Trash2} aria-label="연결 끊기" onClick={async () => {
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
    <div>
      <p className="mb-2 flex flex-wrap items-center gap-2 text-nd-body font-medium">
        내 쿠팡 파트너스 <Badge tone={st.tone}>{st.label}</Badge>
        {c?.keyHint && <span className="text-nd-caption text-nd-fg-3">Access Key {c.keyHint}</span>}
        {c?.checkedAt && <span className="text-nd-caption text-nd-fg-3">· {fmtWhen(c.checkedAt)} 확인</span>}
      </p>
      <Card className="space-y-4">
        {c?.message && c.status !== "none" && <InlineNotice tone={c.status === "ok" ? "success" : c.status === "failed" ? "danger" : "neutral"}>{c.message}</InlineNotice>}
        <FormRow className="grid-cols-1 sm:grid-cols-[1fr_2fr_2fr_auto]">
          <Field label="파트너스 아이디 (AF…)" hint="기록용"><Input size="sm" value={af} onChange={(e) => setAf(e.target.value)} /></Field>
          <Field label="Access Key"><Input size="sm" type="password" autoComplete="off" value={keys.accessKey} placeholder={c?.configured ? "바꿀 때만 입력" : ""} onChange={(e) => setKeys({ ...keys, accessKey: e.target.value.trim() })} /></Field>
          <Field label="Secret Key"><Input size="sm" type="password" autoComplete="off" value={keys.secretKey} placeholder={c?.configured ? "바꿀 때만 입력" : ""} onChange={(e) => setKeys({ ...keys, secretKey: e.target.value.trim() })} /></Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-nd-caption" aria-hidden>{" "}</span>
            <Button size="sm" icon={ShieldCheck} disabled={busy === "k" || (!keys.accessKey && !keys.secretKey && af === (c?.afCode ?? ""))} onClick={() => void run("k", async () => {
              if (keys.accessKey || keys.secretKey) await mutate("profile.saveCoupangKeys", { ...keys, afCode: af });
              else await mutate("profile.saveMeta", { afCode: af });
              setKeys({ accessKey: "", secretKey: "" });
              await onChanged();
            }, "저장했습니다 — 키는 서버에서 암호화해 보관합니다.")}>저장</Button>
          </div>
        </FormRow>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" disabled={!c?.configured || busy === "v"} onClick={() => void run("v", async () => { await mutate("profile.verifyCoupang"); await onChanged(); })}>키 확인 (검색 1건)</Button>
          {c?.configured && (
            <Button size="sm" variant="ghost" icon={Trash2} onClick={async () => {
              if (!(await ask({ title: "쿠팡 키를 지울까요?", message: "이미 만든 제휴 링크는 그대로입니다. 새 딥링크 · 리포트를 내 키로 못 만들게 됩니다.", tone: "danger", confirmLabel: "지우기" }))) return;
              await run("dk", async () => { await mutate("profile.deleteCoupangKeys"); await onChanged(); });
            }}>키 지우기</Button>
          )}
          <span className="text-nd-caption text-nd-fg-3">
            딥링크 · 리포트는 이 키로만 만듭니다 (수수료 · 실적이 키 주인에게 붙습니다). 검색은 이 키가 없으면 {companyKey ? "회사 공용 키" : "직접 검색"}로 합니다.
          </span>
        </div>

        <div>
          <p className="mb-1.5 text-nd-caption font-medium text-nd-fg-2">채널 아이디 (subId) — 파트너스에 등록한 것만 · 최대 10개</p>
          <ul className="mb-2 space-y-1">
            {subs.map((x, i) => (
              <li key={x.id} className="flex items-center gap-2 text-nd-body">
                <code className="rounded bg-nd-fg/[.05] px-1.5 py-0.5 text-nd-caption">{x.id}</code>
                <span className="text-nd-fg-2">{x.label}</span>
                <Button size="sm" variant="ghost" icon={Trash2} aria-label={`${x.id} 지우기`} onClick={() => setSubs(subs.filter((_, j) => j !== i))} />
              </li>
            ))}
          </ul>
          <FormRow className="grid-cols-1 sm:grid-cols-[1.2fr_1.6fr_auto_auto]">
            <Field label="채널 아이디"><Input size="sm" value={newSub.id} onChange={(e) => setNewSub({ ...newSub, id: e.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 20) })} placeholder="8~20자 영문·숫자" /></Field>
            <Field label="이름"><Input size="sm" value={newSub.label} onChange={(e) => setNewSub({ ...newSub, label: e.target.value })} placeholder="예: 유튜브 쇼츠" /></Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-nd-caption" aria-hidden>{" "}</span>
              <Button size="sm" variant="secondary" icon={Plus} disabled={!/^[A-Za-z0-9]{8,20}$/.test(newSub.id) || subs.length >= 10} onClick={() => { setSubs([...subs.filter((x) => x.id !== newSub.id), newSub]); setNewSub({ id: "", label: "" }); }}>더하기</Button>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-nd-caption" aria-hidden>{" "}</span>
              <Button size="sm" disabled={busy === "subs" || JSON.stringify(subs) === JSON.stringify(profile?.subIds ?? [])} onClick={() => void run("subs", async () => { await mutate("profile.saveMeta", { subIds: subs }); await onChanged(); }, "채널 아이디를 저장했습니다.")}>목록 저장</Button>
            </div>
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
    <div>
      <p className="mb-2 text-nd-body font-medium">
        내 YouTube 검색 키 (선택) {y?.configured ? <Badge tone="success">{y.hint}</Badge> : <Badge>{companyKey ? "회사 키 사용 중" : "없음"}</Badge>}
      </p>
      <Card className="space-y-2">
        <FormRow className="grid-cols-1 sm:grid-cols-[3fr_auto_auto]">
          <Field label="YouTube Data API 키" hint="내 Google Cloud 프로젝트의 키 — 검색 한도(하루 100회)를 회사 키와 따로 씁니다">
            <Input size="sm" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value.trim())} />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-nd-caption" aria-hidden>{" "}</span>
            <Button size="sm" disabled={!key || busy === "y"} onClick={() => void run("y", async () => { await mutate("profile.saveYoutubeKey", { key }); setKey(""); await onChanged(); }, "저장했습니다.")}>저장</Button>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-nd-caption" aria-hidden>{" "}</span>
            <Button size="sm" variant="ghost" disabled={!y?.configured || busy === "yd"} onClick={() => void run("yd", async () => { await mutate("profile.saveYoutubeKey", { key: "" }); await onChanged(); })}>지우기</Button>
          </div>
        </FormRow>
      </Card>
    </div>
  );
}
