"use client";

// ============================================================
//  메일 — 로그인해 둔 계정들 · 전역 확인 루프 · 읽지 않은 수
// ------------------------------------------------------------
//  한 사람이 메일 계정을 여러 개 로그인해 두고 오간다. 여기 한 곳이
//    - 계정 목록과 「지금 보는 계정」(기기마다 기억 — localStorage)
//    - 계정마다의 메일함 수 (계정 전환 목록의 배지)
//    - ERP 사이드바 배지 = 모든 계정의 안 읽은 수 합
//  를 쥔다. 화면·API 도우미는 지금 보는 계정으로 요청한다 (client.ts ACTIVE).
//
//  카페24 POP3 에는 푸시가 없고 ERP 서버(Vercel)는 상주하지 않는다. 그래서
//  **ERP 를 열어 둔 브라우저가** 20초마다 서버에 「확인해 줘」를 보낸다 —
//  한 번에 **모든 계정**을 돈다. 메일 화면이 아니어도 돈다.
//
//    보이는 탭   20초마다 · 탭으로 돌아오면 바로
//    숨은 탭     90초마다 (알림은 이때 브라우저 알림으로)
//
//  탭을 여러 개 열어도 카페24 에 겹쳐 붙지 않게, 마지막 확인 시각을
//  localStorage 에 두고 10초(카페24 LOGIN-DELAY) 안이면 건너뛴다. 결과는
//  BroadcastChannel 로 다른 탭에 나눠 준다.
//
//  비밀번호가 틀려 서버가 멈춘 계정(auth_failed)은 서버가 건너뛴다. 모든 계정이
//  멈추면 루프도 멈춘다 — 사용자가 메일 설정에서 비밀번호를 다시 넣을 때까지.
// ============================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/neander/auth";
import { useToast } from "@/components/neander/ui";
import { fetchContacts, fetchMailStatus, setActiveMailAccount, syncMail } from "@/lib/neander/mail/client";
import type {
  MailAccountView,
  MailContact,
  MailCounts,
  MailSummary,
  MailSyncResult,
  SharedFolder,
} from "@/lib/neander/mail/types";

const VISIBLE_MS = 20_000;
const HIDDEN_MS = 90_000;
/** 카페24 LOGIN-DELAY — 이 안에 다른 탭이 확인했으면 건너뛴다 */
const MIN_GAP_MS = 10_000;
const LAST_POLL_KEY = "neander.mail.lastPoll";
const ACTIVE_KEY = "neander.mail.active";
const CHANNEL = "neander-mail";

const ZERO: MailCounts = { unread: 0, spamUnread: 0, drafts: 0, scheduled: 0 };

/**
 * 확인 오류를 알리기까지 기다리는 시간. 메일 서버가 잠깐 늦거나 한 번 끊기는 일은 흔하고
 * 다음 확인에서 저절로 풀린다 — 그때마다 띄우면 거슬리기만 한다 (2026-09-18 사용자).
 */
const ERROR_GRACE_MS = 2 * 60_000;

function lastingError(a: MailAccountView | null | undefined): string | undefined {
  if (!a?.lastError) return undefined;
  // 시작 시각을 모르는 예전 오류는 바로 알린다
  return !a.errorSince || Date.now() - a.errorSince >= ERROR_GRACE_MS ? a.lastError : undefined;
}

type Listener = (added: MailSummary[]) => void;
type Syncs = Record<string, MailSyncResult>;

interface MailValue {
  /** 계정 상태를 받았는가 */
  ready: boolean;
  /** 서버에 암호화 키가 있는가 */
  configured: boolean;
  /** 로그인해 둔 메일 계정들 (계정마다 counts 가 붙어 있다) */
  accounts: MailAccountView[];
  /** 지금 보는 계정 */
  activeKey?: string;
  setActive: (key: string) => void;
  /** 지금 보는 계정 (없으면 null — 아직 연결 전) */
  account: MailAccountView | null;
  /** 지금 보는 계정을 고친다. null 이면 목록에서 뺀다 (연결 끊기) */
  setAccount: (a: MailAccountView | null) => void;
  /** 모든 계정의 받은메일함 안 읽음 — 사이드바 배지 */
  unread: number;
  /** 지금 보는 계정의 메일함별 수 */
  counts: MailCounts;
  setCounts: (c: MailCounts) => void;
  /** 동료가 공유한 메일함 */
  shared: SharedFolder[];
  /** 계정·수·공유 메일함을 다시 받는다 */
  refresh: () => Promise<void>;
  /** 계정 목록을 새로 들인다 (계정을 더 붙인 뒤 — activate 로 그 계정으로 간다) */
  accountsChanged: (accounts: MailAccountView[], activate?: string) => void;
  /** 주소록 (쓰기 창이 처음 열 때 받는다 · 지금 보는 계정 것) */
  contacts: { mine: MailContact[]; team: { name?: string; address: string }[] } | null;
  loadContacts: (force?: boolean) => Promise<void>;
  setContacts: (mine: MailContact[]) => void;
  checking: boolean;
  lastCheckedAt?: number;
  /** 지금 보는 계정의 확인 오류 — 2분 넘게 이어질 때만 (잠깐 끊겼다 붙는 건 알리지 않는다) */
  error?: string;
  /** error 가 이어진 첫 시각 */
  errorSince?: number;
  /** 지금 확인 (새로고침 단추) — 모든 계정 */
  checkNow: (force?: boolean) => Promise<Syncs | null>;
  /** 새 메일·보낸 메일이 생기면 부른다 — 메일 화면이 목록 앞에 끼운다 (acct 가 붙어 있다) */
  subscribe: (fn: Listener) => () => void;
  /** 이 탭에서 생긴 메일을 알린다 (예: 방금 보낸 메일) */
  publish: (added: MailSummary[]) => void;
}

const MailContext = createContext<MailValue | null>(null);

const store = {
  get(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, v: string) {
    try {
      localStorage.setItem(key, v);
    } catch {
      /* 저장소를 못 쓰면 기억하지 않는다 */
    }
  },
};
const readLastPoll = () => Number(store.get(LAST_POLL_KEY)) || 0;

function notify(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body });
  } catch {
    /* Safari 등에서 생성 실패 시 무시 */
  }
}

export function MailProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();

  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [accounts, setAccounts] = useState<MailAccountView[]>([]);
  const [activeKey, setActiveKey] = useState<string>();
  const [shared, setShared] = useState<SharedFolder[]>([]);
  const [contacts, setContactsState] = useState<MailValue["contacts"]>(null);
  const [checking, setChecking] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<number>();

  const listeners = useRef(new Set<Listener>());
  const channel = useRef<BroadcastChannel | null>(null);
  const inFlight = useRef<Promise<Syncs | null> | null>(null);
  const contactsLoaded = useRef(false);
  const onMailPage = useRef(false);
  onMailPage.current = pathname?.startsWith("/neander/mail") ?? false;
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;

  const account = accounts.find((a) => a.key === activeKey) ?? null;
  const counts = account?.counts ?? ZERO;
  const unread = accounts.reduce((s, a) => s + (a.counts?.unread ?? 0), 0);

  const activate = useCallback((key: string | undefined) => {
    activeKeyRef.current = key;
    setActiveKey(key);
    setActiveMailAccount(key);
    if (key) store.set(ACTIVE_KEY, key);
    // 주소록은 계정마다 따로다
    contactsLoaded.current = false;
    setContactsState(null);
  }, []);

  /** 목록을 들이고, 지금 계정이 사라졌으면 기억해 둔 계정이나 첫 계정으로 */
  const accountsChanged = useCallback(
    (list: MailAccountView[], want?: string) => {
      setAccounts(list);
      const keys = list.map((a) => a.key);
      const pick = [want, activeKeyRef.current, store.get(ACTIVE_KEY) ?? undefined].find((k) => k && keys.includes(k)) ?? keys[0];
      if (pick !== activeKeyRef.current) activate(pick);
      else setActiveMailAccount(pick);
    },
    [activate],
  );

  /** 한 계정만 고친다 */
  const patchAccount = useCallback((key: string, fn: (a: MailAccountView) => MailAccountView) => {
    setAccounts((list) => list.map((a) => (a.key === key ? fn(a) : a)));
  }, []);

  const setAccount = useCallback(
    (a: MailAccountView | null) => {
      if (!a) {
        accountsChanged(accountsRef.current.filter((x) => x.key !== activeKeyRef.current));
        return;
      }
      setAccounts((list) =>
        list.some((x) => x.key === a.key)
          ? // 계정을 돌려주는 동작 대부분은 수·서명을 싣지 않는다 — 있던 것을 둔다
            list.map((x) => (x.key === a.key ? { ...a, counts: a.counts ?? x.counts, signatures: a.signatures ?? x.signatures } : x))
          : [...list, a],
      );
    },
    [accountsChanged],
  );

  const setCounts = useCallback(
    (c: MailCounts) => {
      const key = activeKeyRef.current;
      if (key) patchAccount(key, (a) => ({ ...a, counts: c }));
    },
    [patchAccount],
  );

  const emit = useCallback((added: MailSummary[]) => {
    if (added.length) listeners.current.forEach((fn) => fn(added));
  }, []);

  /** 확인 결과를 이 탭에 반영한다 (다른 탭에서 온 결과도 같은 길) */
  const apply = useCallback(
    (syncs: Syncs, local: boolean) => {
      setAccounts((list) =>
        list.map((a) => {
          const r = syncs[a.key];
          if (!r) return a;
          const c = { ...(a.counts ?? ZERO) };
          if (r.unread !== null) c.unread = r.unread;
          // 막아 둔 보낸 사람의 메일은 스팸메일함으로 들어온다 — 수만 올린다
          c.spamUnread += r.added.filter((m) => m.box === "spam" && !m.read).length;
          return {
            ...a,
            counts: c,
            olderCount: r.olderCount,
            lastCheckedAt: r.checkedAt,
            authFailed: r.status === "auth_failed" ? true : a.authFailed,
            lastError: r.status === "error" || r.status === "auth_failed" ? r.error : undefined,
            errorSince: r.status === "error" || r.status === "auth_failed" ? r.errorSince : undefined,
          };
        }),
      );
      const results = Object.values(syncs);
      const latest = Math.max(0, ...results.map((r) => r.checkedAt));
      if (latest) setLastCheckedAt(latest);
      const added = results.flatMap((r) => r.added);
      emit(added);

      // 알림은 확인한 탭 한 곳에서만
      const fresh = added.filter((m) => m.box === "inbox" && !m.read);
      if (!local || !fresh.length) return;
      const head = fresh[0];
      const who = head.from.name || head.from.address;
      const acc = accountsRef.current.find((a) => a.key === head.acct);
      const where = accountsRef.current.length > 1 && acc ? acc.label || acc.address : undefined;
      if (typeof document !== "undefined" && document.hidden) {
        notify(fresh.length > 1 ? `새 메일 ${fresh.length}통` : `새 메일 · ${who}`, where ? `${head.subject} — ${where}` : head.subject);
      } else if (!onMailPage.current) {
        toast.info(fresh.length > 1 ? `${who} 외 ${fresh.length - 1}통` : `${who} · ${head.subject}`, {
          title: where ? `새 메일 · ${where}` : "새 메일",
          action: {
            label: "열기",
            onClick: () => {
              if (head.acct) activate(head.acct);
              router.push("/neander/mail");
            },
          },
        });
      }
    },
    [emit, router, toast, activate],
  );

  const checkNow = useCallback(
    async (force = false) => {
      if (inFlight.current) return inFlight.current;
      const run = (async () => {
        store.set(LAST_POLL_KEY, String(Date.now()));
        setChecking(true);
        try {
          const { syncs } = await syncMail(force);
          apply(syncs, true);
          channel.current?.postMessage({ type: "sync", syncs });
          return syncs;
        } catch {
          return null;
        } finally {
          setChecking(false);
          inFlight.current = null;
        }
      })();
      inFlight.current = run;
      return run;
    },
    [apply],
  );

  const refresh = useCallback(async () => {
    const s = await fetchMailStatus();
    setConfigured(s.configured);
    setShared(s.shared ?? []);
    accountsChanged(s.accounts);
  }, [accountsChanged]);

  // 계정 상태 — 로그인한 사람이 바뀌면 다시
  useEffect(() => {
    if (!user) return;
    let alive = true;
    setReady(false);
    refresh()
      .catch(() => undefined)
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [user, refresh]);

  const loadContacts = useCallback(async (force = false) => {
    if (contactsLoaded.current && !force) return;
    contactsLoaded.current = true;
    try {
      const r = await fetchContacts();
      setContactsState({ mine: r.contacts, team: r.team });
    } catch {
      contactsLoaded.current = false;
    }
  }, []);
  const setContacts = useCallback(
    (mine: MailContact[]) => setContactsState((c) => ({ mine, team: c?.team ?? [] })),
    [],
  );

  // 다른 탭과 결과 나누기
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(CHANNEL);
    channel.current = ch;
    ch.onmessage = (ev: MessageEvent<{ type: string; syncs?: Syncs; added?: MailSummary[] }>) => {
      if (ev.data?.type === "sync" && ev.data.syncs) apply(ev.data.syncs, false);
      if (ev.data?.type === "added" && ev.data.added) emit(ev.data.added);
    };
    return () => {
      ch.close();
      channel.current = null;
    };
  }, [apply, emit]);

  // 확인할 계정이 하나라도 있으면 돈다
  const active = accounts.some((a) => !a.authFailed);

  // 확인 루프
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;

    const tick = async () => {
      if (stopped) return;
      const last = readLastPoll();
      if (Date.now() - last >= MIN_GAP_MS) await checkNow();
      // 다른 탭이 방금 확인했다 — 그 시각을 쓴다 (결과는 BroadcastChannel 로 온다)
      else setLastCheckedAt((v) => (v && v > last ? v : last));
      if (!stopped) timer = setTimeout(tick, document.hidden ? HIDDEN_MS : VISIBLE_MS);
    };
    const onVisible = () => {
      if (document.hidden) return;
      clearTimeout(timer);
      void tick();
    };

    void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, checkNow]);

  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  const publish = useCallback(
    (added: MailSummary[]) => {
      emit(added);
      channel.current?.postMessage({ type: "added", added });
    },
    [emit],
  );

  const value = useMemo<MailValue>(
    () => ({
      ready,
      configured,
      accounts,
      activeKey,
      setActive: activate,
      account,
      setAccount,
      unread,
      counts,
      setCounts,
      shared,
      refresh,
      accountsChanged,
      contacts,
      loadContacts,
      setContacts,
      checking,
      lastCheckedAt,
      error: lastingError(account),
      errorSince: lastingError(account) ? account?.errorSince : undefined,
      checkNow,
      subscribe,
      publish,
    }),
    [
      ready,
      configured,
      accounts,
      activeKey,
      activate,
      account,
      setAccount,
      unread,
      counts,
      setCounts,
      shared,
      refresh,
      accountsChanged,
      contacts,
      loadContacts,
      setContacts,
      checking,
      lastCheckedAt,
      checkNow,
      subscribe,
      publish,
    ],
  );

  return <MailContext.Provider value={value}>{children}</MailContext.Provider>;
}

export function useMail(): MailValue {
  const ctx = useContext(MailContext);
  if (!ctx) throw new Error("useMail must be used within MailProvider");
  return ctx;
}
