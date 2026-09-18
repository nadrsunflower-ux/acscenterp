"use client";

// ============================================================
//  메일 계정 — 처음 연결 · 설정(기본 · 외부 메일 · 스팸 차단 · 연결 해제)
// ------------------------------------------------------------
//  연결할 때 서버가 받기(POP3)·보내기(SMTP) 로그인을 둘 다 해 본 뒤에야
//  저장한다. 틀린 비밀번호가 저장되면 20초마다 틀린 로그인이 쌓여 카페24
//  계정이 잠길 수 있다.
// ============================================================

import { useEffect, useState } from "react";
import { Ban, KeyRound, Mail, PenLine, Plus, Settings2, ShieldCheck, Trash2, Unplug, Users } from "lucide-react";
import { useAppData } from "@/components/neander/app-data";
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  FieldAction,
  FormRow,
  Icon,
  InlineNotice,
  Input,
  SegmentedControl,
  Select,
  Switch,
  cn,
  useConfirm,
  useToast,
} from "@/components/neander/ui";
import {
  addExternal,
  connectMail,
  disconnectMail,
  removeExternal,
  setTeamAccount,
  saveSignatures,
  setExternalPassword,
  unblockSender,
  updateMail,
} from "@/lib/neander/mail/client";
import {
  EXTERNAL_PRESETS,
  MAIL_PROVIDERS,
  type MailProvider,
  MAX_SIGNATURE_BYTES,
  MAX_SIGNATURE_IMAGE_BYTES,
  type MailSignature,
} from "@/lib/neander/mail/types";
import { RichEditor, htmlToText, textToEditorHtml, type EditorMode } from "./RichEditor";
import { useMail } from "./MailProvider";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 연결 폼 — 처음 연결(카드)과 계정 추가(창)가 같이 쓴다 */
function ConnectForm({ add, onDone }: { add: boolean; onDone?: () => void }) {
  const { configured, accountsChanged, publish } = useMail();
  const { currentMember } = useAppData();
  const toast = useToast();
  const [provider, setProvider] = useState<MailProvider>("cafe24");
  const preset = MAIL_PROVIDERS.find((p) => p.key === provider)!;
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState(currentMember?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const { key, accounts, sync } = await connectMail(address.trim(), password, name.trim(), add, provider);
      setPassword("");
      // 새로 붙인 계정으로 바로 간다
      accountsChanged(accounts, key);
      publish(sync.added);
      const acc = accounts.find((a) => a.key === key);
      toast.success(
        acc?.olderCount
          ? `최근 메일 ${sync.added.length}통을 가져왔어요. 예전 메일 ${acc.olderCount}통은 목록 아래에서 더 가져올 수 있어요.`
          : `메일 ${sync.added.length}통을 가져왔어요.`,
        { title: `${acc?.address ?? "메일"} 연결 완료` },
      );
      setAddress("");
      onDone?.();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {!configured && (
        <InlineNotice tone="warning" className="mb-4">
          서버에 메일 암호화 키(NEANDER_MAIL_KEY)가 없어 아직 연결할 수 없습니다. 관리자에게 알려 주세요.
        </InlineNotice>
      )}

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <span className="text-nd-caption font-medium text-nd-fg-2">메일 서비스</span>
          <SegmentedControl<MailProvider>
            ariaLabel="메일 서비스"
            value={provider}
            onChange={setProvider}
            fill
            options={MAIL_PROVIDERS.map((p) => ({ value: p.key, label: p.key === "cafe24" ? "회사 메일" : p.label }))}
          />
          <p className="text-nd-caption leading-relaxed text-nd-fg-3">{preset.hint}</p>
        </div>
        <Field label="메일 주소" required>
          <Input
            type="email"
            autoComplete="username"
            placeholder={preset.placeholder}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </Field>
        <Field
          label={provider === "cafe24" ? "메일 비밀번호" : provider === "naver" ? "애플리케이션 비밀번호" : "앱 비밀번호"}
          required
          hint={provider === "cafe24" ? "카페24 웹메일에 로그인할 때 쓰는 비밀번호입니다." : "로그인 비밀번호가 아니라, 위 안내대로 만든 전용 비밀번호입니다."}
        >
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="보내는 사람 이름" hint="받는 사람에게 이 이름으로 보입니다 (예: 이동주 · 니앤더 고객센터).">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" />
        </Field>

        {error && (
          <InlineNotice tone="danger" icon={KeyRound}>
            {error}
          </InlineNotice>
        )}

        <Button type="submit" size="lg" loading={busy} disabled={!configured || !address || !password}>
          {busy ? "로그인하고 최근 메일을 가져오는 중…" : add ? "계정 추가" : "연결하기"}
        </Button>
      </form>

      <ul className="mt-5 flex flex-col gap-2 border-t border-nd-line pt-4 text-nd-caption leading-relaxed text-nd-fg-3">
        <li className="flex gap-2">
          <Icon icon={ShieldCheck} size={14} className="mt-0.5 shrink-0" />
          비밀번호는 서버에서 암호화해 보관하고, 화면으로는 다시 내려오지 않습니다.
        </li>
        <li>· 처음에는 최근 메일 30통(네이버·Gmail 은 보낸메일함도 30통)을 가져옵니다. 메일은 서버에도 그대로 남습니다.</li>
        <li>
          · ERP 를 열어 둔 동안 새 메일을 확인합니다 — 회사 메일은 20초, 네이버·Gmail 은 1분마다. 네이버·Gmail 은 ERP 에서 읽은
          표시·중요 표시·영구 삭제가 원래 메일함에도 반영됩니다.
        </li>
      </ul>
    </>
  );
}

/** 첫 연결 — 메일 화면 가운데 카드 */
export function MailConnect() {
  return (
    <Card padding="lg" className="mx-auto max-w-[560px]">
      <div className="mb-5 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-nd-accent-soft text-nd-accent-strong">
          <Icon icon={Mail} size={20} />
        </span>
        <div>
          <h2 className="text-nd-title text-nd-fg">메일 연결</h2>
          <p className="mt-1 text-nd-body text-nd-fg-2">
            회사 메일(카페24) · 네이버 · Gmail 을 ERP 에서 받고 보냅니다. 여러 계정을 연결해 두고 한 곳에서 오갑니다.
          </p>
        </div>
      </div>
      <ConnectForm add={false} />
    </Card>
  );
}

/** 계정 더 붙이기 — 로그인해 둔 계정들 사이를 오간다 */
export function AddAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="메일 계정 추가"
      description="회사 메일 · 네이버 · Gmail 계정을 함께 로그인해 두고 한 곳에서 오갑니다."
      size="sm"
      closeOnOverlay={false}
    >
      <ConnectForm add onDone={onClose} />
    </Dialog>
  );
}

export type SettingsTab = "basic" | "signature" | "external" | "blocked";

export function MailSettings({
  open,
  onClose,
  initialTab = "basic",
}: {
  open: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
}) {
  const { account } = useMail();
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);
  if (!account) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="메일 설정"
      description={account.label ? `${account.label} · ${account.address}` : account.address}
      // 탭마다 내용 길이가 달라도 창 크기는 하나로 — 넓이는 서명 편집기 기준, 넘치면 안에서 스크롤
      size="lg"
      className="h-[min(700px,88vh)]"
      bodyClassName="flex flex-col"
      closeOnOverlay={false}
    >
      <SegmentedControl<SettingsTab>
        className="mb-4 shrink-0"
        size="sm"
        ariaLabel="설정 구역"
        value={tab}
        onChange={setTab}
        options={[
          { value: "basic", label: "기본", icon: Settings2 },
          { value: "signature", label: "서명", icon: PenLine },
          // 외부 메일 가져오기(POP3)는 카페24 계정에 붙이는 것 — 네이버·Gmail 은 계정으로 따로 붙인다
          ...(account.provider === "cafe24" ? [{ value: "external" as const, label: "외부 메일", icon: Mail }] : []),
          { value: "blocked", label: "스팸 차단", icon: Ban },
        ]}
      />
      {tab === "basic" && <BasicSettings onDone={onClose} />}
      {tab === "external" && <ExternalSettings />}
      {tab === "blocked" && <BlockedSettings />}
      {tab === "signature" && <SignatureSettings onDone={onClose} />}
    </Dialog>
  );
}

function BasicSettings({ onDone }: { onDone: () => void }) {
  const { account, setAccount } = useMail();
  const isCafe24 = (account?.provider ?? "cafe24") === "cafe24";
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState(account?.name ?? "");
  const [keepSentCopy, setKeepSentCopy] = useState(account?.keepSentCopy ?? true);
  const [trackOpens, setTrackOpens] = useState(account?.trackOpens ?? true);
  const [quotaMB, setQuotaMB] = useState(String(Math.round((account?.quotaBytes ?? 0) / 1024 / 1024) || 1024));
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [teamBusy, setTeamBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!account) return null;
  // 팀 공용 계정의 비밀번호 · 공용 여부 · 연결 끊기는 연결한 사람만 (서버도 막는다)
  const owner = account.mine !== false;

  const toggleTeam = async (team: boolean) => {
    if (team) {
      const ok = await confirm({
        title: "팀 공용 계정으로 바꿀까요?",
        message: `ERP 팀원 모두의 메일 계정 목록에 ${account.address} 가 나오고, 앱 비밀번호 없이 읽고 보낼 수 있습니다. 읽음 표시와 서명도 함께 씁니다.`,
        confirmLabel: "공용으로 바꾸기",
      });
      if (!ok) return;
    }
    setTeamBusy(true);
    setError(undefined);
    try {
      const { account: next } = await setTeamAccount(team);
      setAccount(next);
      toast.success(team ? "팀원 모두에게 이 계정이 보여요." : "이제 나만 이 계정을 봐요.");
    } catch (e) {
      setError(errText(e));
    } finally {
      setTeamBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const { account: next } = await updateMail({
        name,
        keepSentCopy,
        trackOpens,
        quotaMB: isCafe24 ? Number(quotaMB) || undefined : undefined,
        ...(password && owner ? { password } : {}),
      });
      setAccount(next);
      toast.success(password ? "비밀번호를 바꾸고 다시 확인을 시작했어요." : "메일 설정을 저장했어요.");
      onDone();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    const ok = await confirm({
      title: "메일 연결을 끊을까요?",
      message: `${account.address} 의 비밀번호와 ERP 메일 목록·임시저장·예약 메일을 지웁니다. 카페24 메일함의 메일은 그대로 남습니다. 다른 계정은 그대로입니다.`,
      confirmLabel: "연결 끊기",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await disconnectMail();
      // 목록에서 빼면 남은 계정(없으면 첫 연결 화면)으로 간다
      setAccount(null);
      onDone();
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-4">
      {account.authFailed && (
        <InlineNotice tone="danger" icon={KeyRound}>
          {owner
            ? "메일 비밀번호가 맞지 않아 새 메일 확인을 멈췄습니다. 비밀번호를 바꿨다면 아래에 새 비밀번호를 넣어 주세요."
            : `메일 비밀번호가 맞지 않아 새 메일 확인을 멈췄습니다. 연결한 ${account.connectedBy} 에게 새 비밀번호를 넣어 달라고 해 주세요.`}
        </InlineNotice>
      )}
      {owner ? (
        <div className="flex flex-col gap-1.5">
          <Switch
            checked={!!account.team}
            onChange={toggleTeam}
            disabled={teamBusy}
            label="팀 공용 계정 (ERP 팀원 모두에게 보이기)"
          />
          <p className="text-nd-caption leading-relaxed text-nd-fg-3">
            켜면 팀원들은 앱 비밀번호를 넣지 않아도 이 계정으로 받고 보낼 수 있습니다. 비밀번호 바꾸기와 연결 끊기는 연결한
            사람(나)만 할 수 있습니다.
          </p>
        </div>
      ) : (
        <InlineNotice icon={Users}>
          팀 공용 계정입니다 — {account.connectedBy} 가 연결했습니다. 앱 비밀번호 바꾸기와 연결 끊기는 연결한 사람만 할 수
          있습니다.
        </InlineNotice>
      )}
      <Field label="보내는 사람 이름">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {isCafe24 && (
        <div className="flex flex-col gap-1.5">
          <Switch checked={keepSentCopy} onChange={setKeepSentCopy} label="보낸 메일 사본을 카페24 받은편지함에도 남기기" />
          <p className="text-nd-caption leading-relaxed text-nd-fg-3">
            카페24 웹메일의 보낸메일함에는 ERP 에서 보낸 메일이 남지 않습니다. 켜 두면 사본이 남고, 보낸 첨부를 ERP 에서 다시
            열 수 있습니다.
          </p>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Switch checked={trackOpens} onChange={setTrackOpens} label="수신확인 (받는 사람이 열었는지 표시)" />
        <p className="text-nd-caption leading-relaxed text-nd-fg-3">
          메일에 보이지 않는 작은 이미지를 붙여 열람을 셉니다. 이미지를 막는 메일 프로그램에서는 열어도 표시되지 않고, 일부
          프로그램은 미리 불러와 안 열어도 표시될 수 있어 「추정」입니다.
        </p>
      </div>
      {isCafe24 && (
        <Field label="카페24 메일함 용량 (MB)" hint="사이드바의 용량 막대 기준입니다. 카페24 웹메일 왼쪽 위의 전체 용량을 넣으세요.">
          <Input type="number" min={1} value={quotaMB} onChange={(e) => setQuotaMB(e.target.value)} />
        </Field>
      )}
      {owner && (
        <Field
          label={isCafe24 ? "메일 비밀번호 바꾸기" : "앱 비밀번호 바꾸기"}
          hint="바꿀 때만 넣으세요. 받기·보내기 로그인을 확인한 뒤 저장합니다."
        >
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
      )}
      {error && <InlineNotice tone="danger">{error}</InlineNotice>}
      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-nd-line pt-4">
        {owner ? (
          <Button variant="danger" icon={Unplug} className="mr-auto" onClick={disconnect}>
            연결 끊기
          </Button>
        ) : (
          <span className="mr-auto" />
        )}
        <Button variant="secondary" onClick={onDone}>
          취소
        </Button>
        <Button loading={busy} onClick={save}>
          저장
        </Button>
      </div>
    </div>
  );
}

/** 카페24 「외부 메일 설정」 — 다른 메일(네이버·Gmail 등)을 받은메일함으로 가져온다 */
function ExternalSettings() {
  const { account, setAccount, setCounts, publish } = useMail();
  const toast = useToast();
  const confirm = useConfirm();
  const [preset, setPreset] = useState<string>(EXTERNAL_PRESETS[0].key);
  const [host, setHost] = useState<string>(EXTERNAL_PRESETS[0].host);
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!account) return null;
  const hint = EXTERNAL_PRESETS.find((p) => p.key === preset)?.hint;

  const add = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const res = await addExternal({ label: label || EXTERNAL_PRESETS.find((p) => p.key === preset)?.label || "", address, host, password });
      setAccount(res.account);
      setCounts(res.counts);
      publish(res.added);
      setAddress("");
      setPassword("");
      setLabel("");
      toast.success(`최근 메일 ${res.added.length}통을 가져왔어요. 이제 2분마다 새 메일을 확인합니다.`, { title: "외부 메일 연결" });
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, name: string) => {
    const ok = await confirm({
      title: `${name} 연결을 끊을까요?`,
      message: "이미 가져온 메일은 받은메일함에 남습니다.",
      confirmLabel: "연결 끊기",
      tone: "danger",
    });
    if (!ok) return;
    try {
      setAccount((await removeExternal(id)).account);
    } catch (e) {
      toast.error(errText(e));
    }
  };

  const repass = async (id: string) => {
    const pw = window.prompt("새 비밀번호(또는 앱 비밀번호)를 넣어 주세요.");
    if (!pw) return;
    try {
      setAccount((await setExternalPassword(id, pw)).account);
      toast.success("비밀번호를 바꿨어요.");
    } catch (e) {
      toast.error(errText(e));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-nd-caption leading-relaxed text-nd-fg-3">
        다른 메일 계정의 받은 메일을 이 받은메일함으로 가져옵니다 (POP3 · 2분마다). 가져오기만 하고, 보내기는 회사 메일로 합니다.
      </p>
      {account.externals.length === 0 ? (
        <EmptyState compact title="연결한 외부 메일이 없어요" />
      ) : (
        <ul className="flex flex-col divide-y divide-nd-line rounded-nd-md border border-nd-line">
          {account.externals.map((x) => (
            <li key={x.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-nd-body font-medium text-nd-fg">{x.label}</span>
                <span className="block truncate text-nd-caption text-nd-fg-3">
                  {x.address} · {x.host}
                  {x.authFailed ? " · 비밀번호 오류로 멈춤" : x.lastError ? ` · ${x.lastError}` : ""}
                </span>
              </span>
              {x.authFailed && (
                <Button size="sm" variant="secondary" onClick={() => repass(x.id)}>
                  비밀번호
                </Button>
              )}
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(x.id, x.label)}>
                끊기
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-3 rounded-nd-md border border-nd-line p-3">
        <FormRow className="grid-cols-1 sm:grid-cols-2">
          <Field label="메일 서비스">
            <Select
              value={preset}
              onChange={(e) => {
                const p = EXTERNAL_PRESETS.find((x) => x.key === e.target.value);
                setPreset(e.target.value);
                if (p) setHost(p.host);
              }}
            >
              {EXTERNAL_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
              <option value="custom">직접 입력</option>
            </Select>
          </Field>
          <Field label="받는 서버 (POP3, 995)">
            <Input value={host} onChange={(e) => setHost(e.target.value)} disabled={preset !== "custom"} />
          </Field>
        </FormRow>
        <FormRow className="grid-cols-1 sm:grid-cols-2">
          <Field label="아이디 (메일 주소)">
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="name@naver.com" />
          </Field>
          <Field label="비밀번호 (앱 비밀번호)">
            <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        </FormRow>
        <FormRow className="grid-cols-1 sm:grid-cols-[1fr_auto]">
          <Field label="이름 (목록에 보일 이름)">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="개인 네이버" />
          </Field>
          <FieldAction>
            <Button icon={Plus} loading={busy} disabled={!address || !password || !host} onClick={add}>
              연결하고 가져오기
            </Button>
          </FieldAction>
        </FormRow>
        {hint && preset !== "custom" && <p className="text-nd-caption leading-relaxed text-nd-fg-3">{hint}</p>}
        {error && <InlineNotice tone="danger">{error}</InlineNotice>}
      </div>
    </div>
  );
}

/** 스팸 신고로 막은 보낸 사람 */
function BlockedSettings() {
  const { account, setAccount } = useMail();
  const toast = useToast();
  if (!account) return null;
  const unblock = async (address: string) => {
    try {
      setAccount((await unblockSender(address)).account);
      toast.success(`${address} 차단을 풀었어요.`);
    } catch (e) {
      toast.error(errText(e));
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-nd-caption leading-relaxed text-nd-fg-3">
        스팸 신고한 보낸 사람의 새 메일은 받은메일함 대신 스팸메일함으로 들어옵니다. 카페24 서버가 걸러 낸 스팸은 POP3 로
        보이지 않아 여기에 없습니다.
      </p>
      {account.blocked.length === 0 ? (
        <EmptyState compact icon={Ban} title="막은 보낸 사람이 없어요" />
      ) : (
        <ul className="flex flex-col divide-y divide-nd-line rounded-nd-md border border-nd-line">
          {account.blocked.map((a) => (
            <li key={a} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-nd-body text-nd-fg">{a}</span>
              <Button size="sm" variant="ghost" onClick={() => unblock(a)}>
                차단 풀기
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * 서명 관리 — 서명을 여러 개 두고, 새 메일과 답장·전달에 자동으로 넣을 것을 따로
 * 고른다. 메일쓰기 창이 열릴 때 고른 서명이 본문 아래에 들어가고, 창에서 바꿀 수 있다.
 */
function SignatureSettings({ onDone }: { onDone: () => void }) {
  const { account, setAccount } = useMail();
  const toast = useToast();
  const confirm = useConfirm();
  const initial = account?.signatures;
  const [list, setList] = useState<MailSignature[]>(() => initial?.list.map((x) => ({ ...x })) ?? []);
  const [sigNew, setSigNew] = useState(initial?.sigNew ?? "");
  const [sigReply, setSigReply] = useState(initial?.sigReply ?? "");
  const [selected, setSelected] = useState<string | null>(initial?.list[0]?.id ?? null);
  const [mode, setMode] = useState<EditorMode>("rich");
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!account) return null;

  const current = list.find((x) => x.id === selected) ?? null;
  const patchCurrent = (p: Partial<MailSignature>) =>
    setList((l) => l.map((x) => (x.id === selected ? { ...x, ...p } : x)));

  const pick = (id: string) => {
    setSelected(id);
    setMode("rich");
    setResetKey((k) => k + 1);
  };

  const add = () => {
    const id = `s${Date.now().toString(36)}`;
    const name = `서명 ${list.length + 1}`;
    const base = [account.name, account.address].filter(Boolean).join("<br>");
    setList((l) => [...l, { id, name, html: base ? `<div>${base}</div>` : "" }]);
    // 첫 서명이면 새 메일·답장 모두에 쓰도록
    if (!list.length) {
      setSigNew(id);
      setSigReply(id);
    }
    pick(id);
  };

  const remove = async () => {
    if (!current) return;
    const ok = await confirm({ title: `「${current.name}」을 지울까요?`, confirmLabel: "지우기", tone: "danger" });
    if (!ok) return;
    const rest = list.filter((x) => x.id !== current.id);
    setList(rest);
    if (sigNew === current.id) setSigNew("");
    if (sigReply === current.id) setSigReply("");
    setSelected(rest[0]?.id ?? null);
    setResetKey((k) => k + 1);
  };

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const big = list.find((x) => new Blob([x.html]).size > MAX_SIGNATURE_BYTES);
      if (big) throw new Error(`「${big.name}」이 너무 큽니다. 로고 이미지를 더 작게 넣어 주세요 (서명 하나 300KB).`);
      const { account: next } = await saveSignatures({ list, sigNew: sigNew || undefined, sigReply: sigReply || undefined });
      setAccount(next);
      toast.success("서명을 저장했어요. 메일쓰기 창을 열면 본문 아래에 들어갑니다.");
      onDone();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const options = [{ id: "", name: "넣지 않음" }, ...list];

  return (
    <div className="flex flex-1 flex-col gap-4">
      <FormRow className="grid-cols-1 sm:grid-cols-2">
        <Field label="새 메일에 넣을 서명" hint="메일쓰기 · 내게쓰기">
          <Select value={sigNew} onChange={(e) => setSigNew(e.target.value)}>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="답장 · 전달에 넣을 서명" hint="원문 인용 위에 들어갑니다">
          <Select value={sigReply} onChange={(e) => setSigReply(e.target.value)}>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </Field>
      </FormRow>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[168px_minmax(0,1fr)]">
        <div className="flex flex-col gap-1">
          {list.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => pick(x.id)}
              aria-current={x.id === selected || undefined}
              className={cn(
                "flex items-center justify-between gap-2 rounded-nd-md px-2.5 py-2 text-left text-nd-body transition-colors duration-nd-fast",
                x.id === selected ? "bg-nd-accent-soft font-medium text-nd-accent-strong" : "text-nd-fg-2 hover:bg-nd-fg/[.05]",
              )}
            >
              <span className="truncate">{x.name}</span>
              {(x.id === sigNew || x.id === sigReply) && (
                <span className="shrink-0 text-nd-micro text-nd-fg-3">
                  {x.id === sigNew && x.id === sigReply ? "기본" : x.id === sigNew ? "새 메일" : "답장"}
                </span>
              )}
            </button>
          ))}
          <Button variant="ghost" size="sm" icon={Plus} className="justify-start" onClick={add}>
            새 서명
          </Button>
        </div>

        {current ? (
          <div className="flex min-w-0 flex-col gap-3">
            <FormRow className="grid-cols-[minmax(0,1fr)_auto]">
              <Field label="서명 이름">
                <Input value={current.name} maxLength={30} onChange={(e) => patchCurrent({ name: e.target.value })} />
              </Field>
              <FieldAction size="md">
                <Button variant="danger" icon={Trash2} onClick={() => void remove()}>
                  지우기
                </Button>
              </FieldAction>
            </FormRow>
            <RichEditor
              mode={mode}
              onModeChange={setMode}
              html={current.html}
              text={htmlToText(current.html)}
              resetKey={`${selected}-${resetKey}`}
              minHeight={180}
              maxImageBytes={MAX_SIGNATURE_IMAGE_BYTES}
              onChange={(v) => patchCurrent({ html: v.html !== undefined ? v.html : textToEditorHtml(v.text) })}
            />
            <p className="text-nd-caption leading-relaxed text-nd-fg-3">
              로고는 「이미지 넣기」로 200KB 까지 넣을 수 있습니다. 보낼 때 메일 안에 함께 실려 받는 사람에게도 보입니다.
            </p>
          </div>
        ) : (
          <EmptyState
            compact
            icon={PenLine}
            title="서명이 없어요"
            description="「새 서명」으로 만들면 메일을 쓸 때마다 본문 아래에 저절로 들어갑니다."
            action={
              <Button size="sm" icon={Plus} onClick={add}>
                새 서명
              </Button>
            }
          />
        )}
      </div>

      {error && <InlineNotice tone="danger">{error}</InlineNotice>}
      <div className="mt-auto flex flex-wrap items-center justify-end gap-2 border-t border-nd-line pt-4">
        <Button variant="secondary" onClick={onDone}>
          취소
        </Button>
        <Button loading={busy} onClick={() => void save()}>
          저장
        </Button>
      </div>
    </div>
  );
}
