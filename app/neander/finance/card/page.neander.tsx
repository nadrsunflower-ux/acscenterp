"use client";

// ============================================================
//  법인카드 사용 메모 — 휴대폰에서 쓴다
// ------------------------------------------------------------
//  카드 명세서에는 가맹점과 금액밖에 없다. 「쿠팡 20,290원」이 무엇을 산
//  것인지는 결제한 사람만 안다. 지금은 그걸 단톡방에 캡처와 함께 올리고,
//  나중에 사람이 보며 원장에 옮겨 적는다.
//
//  이 화면은 그 기록을 ERP 안으로 옮긴다. 나중에 카드 명세서를 올리면
//  뒷4자리·금액·날짜로 메모가 **자동으로 붙어서**, 옮겨 적는 일이 사라진다.
//
//  ── 캡처만 올리면 칸이 채워진다 ──
//  네 줄을 손으로 치는 건 카톡보다 오히려 불편했다. 그런데 그 네 줄은
//  이미 캡처 안에 있다. 값싼 비전 모델(장당 0.36원)에게 읽히고 사람은
//  **확인만** 한다.
//
//  ⚠️ 읽은 값을 바로 저장하지 않는다. 모델이 채운 칸에는 표시를 달고,
//     확신이 낮으면 눈에 띄게 알린다. 금액을 잘못 읽은 채 저장되는 게
//     아무것도 안 채워 주는 것보다 나쁘다.
//
//  ⚠️ 현장에서 계산대 앞에 서서 쓰는 화면이다. 한 손으로, 30초 안에
//     끝나야 한다. 그래서 —
//       · 한 줄에 한 칸. 두 칸을 나란히 놓지 않는다.
//       · 손가락에 맞는 큰 입력칸(44px)과 큰 버튼.
//       · 금액은 숫자 키패드가 뜨게 inputMode=numeric.
//       · 날짜는 오늘로 채워 둔다. 대부분 오늘 쓴 것이다.
//       · 카드는 마지막에 고른 것을 기억한다. 보통 같은 카드를 계속 쓴다.
//       · 계정·사업구분은 접어 둔다. 몰라도 저장할 수 있어야 한다 —
//         모르면 못 적게 만들면 아예 안 적는다.
//
//  ⚠️ 목업(all-pages/finance-card.png)은 좌 입력 · 우 최근 기록 2단이지만,
//     이 화면의 기본 무대는 **휴대폰**이라 좁은 폭이 의도다(위 layout 의
//     StandaloneChrome). 그래서 폭은 narrow 로 두고, 자리가 남는 lg 이상
//     에서만 「최근 기록」을 오른쪽으로 보낸다 — 입력 칸 자체는 어느 폭에서도
//     한 줄에 하나, 32rem 을 넘지 않는다.
// ============================================================

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Camera,
  CreditCard,
  Images,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  Button,
  Card,
  controlClass,
  DropZone,
  EmptyState,
  Icon,
  IconButton,
  InlineNotice,
  Input,
  LoadingState,
  Money,
  PageHeader,
  PageShell,
  SectionHeader,
  Select,
  StatusDot,
  useConfirm,
  useToast,
} from "@/components/neander/ui";
import { LeavingItem, useLeaving } from "@/components/neander/ui";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import {
  addCardMemo,
  deleteCardMemo,
  fetchCardMemos,
  matchCardMemos,
  readCardReceipt,
} from "@/lib/neander/finance/client";
import type {
  FinCardMemoView,
  ReceiptRead,
} from "@/lib/neander/finance/card-memo";
import { todayStr } from "@/lib/neander/format";

/** 마지막에 고른 카드를 기억한다 — 보통 같은 카드를 계속 쓴다 */
const LAST_CARD_KEY = "neander.finance.cardMemo.last4";

/** 숫자만 남겨 천 단위 콤마를 찍는다. 금액은 항상 양수다(서버도 절댓값을 쓴다). */
const commafy = (raw: string) => {
  const digits = raw.replace(/\D/g, "");
  return digits ? Number(digits).toLocaleString("ko-KR") : "";
};

/** 모델이 채운 칸임을 알린다 — 사람이 어디를 확인해야 하는지 알아야 한다 */
const filled = (v: unknown) =>
  v ? <span className="ml-1 font-normal text-nd-accent-strong">· 캡처에서 읽음</span> : null;

/**
 * 한 줄에 한 칸.
 *
 * 공통 Field 로 바꾸지 않는다 — Field 의 label 은 string 이고, 여기 라벨에는
 * 「· 캡처에서 읽음」 표시가 붙는 ReactNode 가 들어간다. 그 표시가 라벨 옆에
 * 붙어 있어야 사람이 어느 칸을 확인해야 하는지 안다.
 */
function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-nd-caption font-medium text-nd-fg-2">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

export default function CardMemoPage() {
  const { paymentMethods, loading } = useFinance();
  const toast = useToast();
  const confirm = useConfirm();
  const cards = useMemo(
    () => paymentMethods.filter((p) => p.kind === "card").sort((a, b) => a.alias.localeCompare(b.alias, "ko")),
    [paymentMethods],
  );

  const [memos, setMemos] = useState<FinCardMemoView[] | null>(null);
  const [date, setDate] = useState(todayStr());
  const [last4, setLast4] = useState("");
  const [vendor, setVendor] = useState("");
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  /** 캡처에서 읽는 중 */
  const [reading, setReading] = useState(false);
  /** 모델이 읽은 결과 — 어느 칸을 채웠는지 표시하는 데 쓴다 */
  const [read, setRead] = useState<ReceiptRead | null>(null);
  const [saving, setSaving] = useState(false);
  const [matching, setMatching] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  /**
   * 콤마를 찍으면 글자 수가 바뀌어 커서가 끝으로 튄다. 20,290 을 20,190
   * 으로 고치려고 가운데를 눌렀는데 커서가 맨 뒤로 가면, 지웠다 다시
   * 쳐야 한다. 그래서 **몇 번째 숫자 뒤였는지**를 기억했다가 되돌린다.
   */
  const onAmountChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const el = e.target;
    const digitsBeforeCaret = el.value.slice(0, el.selectionStart ?? 0).replace(/\D/g, "").length;
    const next = commafy(el.value);
    setAmount(next);
    requestAnimationFrame(() => {
      const node = amountRef.current;
      if (!node) return;
      if (digitsBeforeCaret === 0) {
        node.setSelectionRange(0, 0);
        return;
      }
      let seen = 0;
      let pos = next.length;
      for (let i = 0; i < next.length; i++) {
        if (/\d/.test(next[i])) seen += 1;
        if (seen === digitsBeforeCaret) {
          pos = i + 1;
          break;
        }
      }
      node.setSelectionRange(pos, pos);
    });
  }, []);

  /**
   * 사진을 고르는 즉시 읽는다. 「읽기」 버튼을 따로 두면 안 누른다 —
   * 카톡에서는 사진 넣는 것이 곧 기록이었다.
   *
   * 이미 사람이 채워 넣은 칸은 덮지 않는다. 모델보다 사람이 맞다.
   */
  const onPickPhotos = useCallback(
    async (files: File[]) => {
      setPhotos(files);
      setRead(null);
      if (files.length === 0) return;
      setReading(true);
      try {
        const r = await readCardReceipt(files);
        setRead(r);
        if (r.amount && !amount) setAmount(commafy(String(r.amount)));
        if (r.items && !note) setNote(r.items);
        if (r.vendor && !vendor) setVendor(r.vendor);
        if (r.date) setDate(r.date);
        if (r.last4 && cards.some((c) => c.last4 === r.last4)) setLast4(r.last4);
        if (!r.amount && !r.vendor) {
          toast.error("캡처에서 읽어내지 못했습니다. 직접 입력해 주세요.");
        }
      } catch (e) {
        toast.error((e instanceof Error ? e.message : "사진을 읽지 못했습니다.") + " 직접 입력할 수 있습니다.");
      } finally {
        setReading(false);
      }
    },
    [amount, note, vendor, cards, toast],
  );

  const reload = useCallback(async () => {
    try {
      setMemos(await fetchCardMemos());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "불러오지 못했습니다.");
    }
  }, [toast]);

  useEffect(() => {
    if (loading) return;
    void reload();
  }, [loading, reload]);

  // 마지막에 쓴 카드를 되살린다 (없으면 카드가 하나뿐일 때 그걸로)
  useEffect(() => {
    if (last4 || cards.length === 0) return;
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(LAST_CARD_KEY) : null;
    if (saved && cards.some((c) => c.last4 === saved)) setLast4(saved);
    else if (cards.length === 1) setLast4(cards[0].last4);
  }, [cards, last4]);

  const amountNum = Number(amount.replace(/\D/g, ""));
  const canSave = !!date && !!last4 && note.trim() !== "" && Number.isFinite(amountNum) && amountNum !== 0;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const form = new FormData();
      form.set("date", date);
      form.set("last4", last4);
      form.set("note", note.trim());
      form.set("amount", String(amountNum));
      if (vendor.trim()) form.set("vendor", vendor.trim());
      photos.forEach((f) => form.append("photos", f));
      const r = await addCardMemo(form);
      try {
        window.localStorage.setItem(LAST_CARD_KEY, last4);
      } catch {
        // 저장 못 해도 기록 자체는 됐다
      }
      // 카드와 날짜는 남긴다 — 보통 연달아 여러 건을 적는다
      setVendor("");
      setNote("");
      setAmount("");
      setPhotos([]);
      setRead(null);
      // 파일 입력칸은 DropZone 이 고를 때마다 스스로 비운다 (같은 사진을 다시 골라도 열린다)
      if (r.warning) toast.error(r.warning);
      else toast.success("기록했습니다.");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const runMatch = async () => {
    setMatching(true);
    try {
      const r = await matchCardMemos();
      toast.success(
        r.matched > 0
          ? `${r.matched}건을 카드 명세서에 붙였습니다.` +
              (r.ambiguous > 0 ? ` ${r.ambiguous}건은 후보가 여럿이라 남겼습니다.` : "")
          : r.ambiguous > 0
            ? `붙일 수 있는 건 없고, ${r.ambiguous}건은 후보가 여럿입니다.`
            : "아직 붙일 명세서가 없습니다.",
      );
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "대조에 실패했습니다.");
    } finally {
      setMatching(false);
    }
  };

  // 지운 기록은 순간 사라지지 않고 흐려지며 접힌다 — 아래 기록이 자연스럽게 올라온다
  const leaving = useLeaving();

  const remove = async (id: string) => {
    const ok = await confirm({
      title: "이 기록을 지울까요?",
      message: "사진도 함께 지워집니다.",
      confirmLabel: "지우기",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await deleteCardMemo(id);
      await leaving.run([id], { message: "지웠습니다", tone: "neutral" }, reload);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "삭제에 실패했습니다.");
    }
  };

  const aliasOf = useCallback(
    (l4: string) => paymentMethods.find((p) => p.last4 === l4)?.alias ?? l4,
    [paymentMethods],
  );

  if (loading) return <LoadingState label="불러오는 중…" />;

  const waiting = memos?.filter((m) => !m.matchedTxId).length ?? 0;

  return (
    // 휴대폰 폭(narrow)이 기본. lg 이상에서는 창 폭을 다 써서 「최근 기록」을
    // 오른쪽에 세운다 — 입력 칸 자체는 아래 그리드가 32rem 으로 묶어 두므로,
    // 넓은 화면에서도 칸이 옆으로 늘어져 누르기 어려워지지 않는다.
    <PageShell width="narrow" className="lg:max-w-none">
      <PageHeader
        compact
        title="법인카드 사용 기록"
        description={
          <>
            결제 화면을 캡처해서 올리면 <b className="font-semibold text-nd-fg">칸이 알아서 채워집니다.</b>{" "}
            확인만 하고 저장하세요. 나중에 카드 명세서를 올리면 뒷 4자리·금액·날짜로 자동으로 붙습니다.
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,32rem)_minmax(0,1fr)] lg:items-start">
        <div>
        {cards.length === 0 ? (
          <EmptyState
            icon={CreditCard}
            title="등록된 법인카드가 없습니다"
            description="마스터 탭에서 결제수단을 먼저 적재하세요."
          />
        ) : (
          <Card className="space-y-3">
            {/* 사진이 먼저다 — 이걸 올리면 아래 칸이 채워진다.
                accept="image/*" 라 휴대폰에서는 카메라 촬영·사진 보관함·파일 선택이
                함께 뜬다. 끌어다 놓기는 데스크톱에서 캡처를 옮길 때 쓴다. */}
            <div>
              <DropZone
                onFiles={(files) => void onPickPhotos(files.slice(0, 3))}
                accept="image/*"
                multiple
                busy={reading}
                // children 을 직접 그리므로 title 은 화면에 안 나오지만, 상태가
                // 세 갈래라 기본 안내로 흘려도 뜻이 맞게 같은 문구를 준다
                title={
                  reading ? "캡처를 읽는 중…" : photos.length > 0 ? `사진 ${photos.length}장 · 다시 고르기` : "결제 화면 캡처 올리기"
                }
                className="border-nd-accent/40 bg-nd-accent-soft/60"
              >
                {reading ? (
                  <>
                    <span className="text-nd-body font-semibold text-nd-accent-strong">캡처를 읽는 중…</span>
                    <span className="text-nd-caption text-nd-accent">2~3초 걸립니다</span>
                  </>
                ) : photos.length > 0 ? (
                  <>
                    <Icon icon={Images} size={24} className="text-nd-accent-strong" />
                    <span className="text-nd-body font-semibold text-nd-accent-strong">사진 {photos.length}장 · 다시 고르기</span>
                    <span className="text-nd-caption text-nd-accent">아래 칸을 확인하세요</span>
                  </>
                ) : (
                  <>
                    <Icon icon={Camera} size={28} className="text-nd-accent-strong" />
                    <span className="text-nd-body font-semibold text-nd-accent-strong">결제 화면 캡처 올리기</span>
                    <span className="text-nd-caption text-nd-accent">사진을 찍거나 골라 주세요 · 없어도 직접 입력 가능</span>
                  </>
                )}
              </DropZone>

              {read && read.confidence !== "high" && (
                <InlineNotice tone="warning" icon={TriangleAlert} className="mt-2 text-nd-caption">
                  <b>또렷하게 읽지 못했습니다.</b> 금액과 가맹점을 꼭 확인해 주세요.
                  {read.uncertain && <span className="mt-0.5 block">{read.uncertain}</span>}
                </InlineNotice>
              )}
            </div>

            <Row label={<>사용일{filled(read?.date)}</>}>
              <Input size="lg" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Row>

            <Row label={<>카드{filled(read?.last4)}</>}>
              <Select size="lg" value={last4} onChange={(e) => setLast4(e.target.value)}>
                <option value="">카드를 고르세요</option>
                {cards.map((c) => (
                  <option key={c.last4} value={c.last4}>
                    {c.alias} · {c.last4}
                  </option>
                ))}
              </Select>
            </Row>

            <Row label={<>금액{filled(read?.amount)}</>}>
              {/*
                여기만 공통 Input 이 아니라 원소를 직접 쓴다 — 콤마를 찍을 때
                커서 자리를 되돌리려면 ref 가 필요한데 Input 은 ref 를 넘기지
                않는다. 대신 높이·모양은 controlClass 로 Input 과 똑같이 맞춘다.
                inputMode=numeric 은 휴대폰 숫자 키패드용이라 함께 남긴다.
              */}
              <input
                ref={amountRef}
                value={amount}
                onChange={onAmountChange}
                // 휴대폰에서 숫자 키패드가 뜨게 한다
                inputMode="numeric"
                placeholder="20,290"
                className={controlClass("lg", "nd-num text-right")}
              />
            </Row>

            <Row label={<>무엇에 썼나요{filled(read?.items)}</>}>
              <Input
                size="lg"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="예: JIMFF 러너 조이스틱"
              />
            </Row>

            <Row
              label={
                <>
                  가맹점 <span className="font-normal text-nd-fg-3">(선택)</span>
                  {filled(read?.vendor)}
                </>
              }
            >
              <Input
                size="lg"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                placeholder="예: 쿠팡"
              />
            </Row>

            <Button size="lg" onClick={save} disabled={!canSave} loading={saving} className="w-full">
              기록하기
            </Button>
          </Card>
        )}
        </div>

        {/* 최근 기록 — 좁은 화면에서는 입력칸 아래로 이어지고, lg 이상에서만 옆에 선다 */}
        <div>
        <SectionHeader
          as="h2"
          className="mt-6 lg:mt-0"
          title="최근 기록"
          hint={waiting > 0 ? `명세서 대기 ${waiting}건` : undefined}
          action={
            <Button variant="secondary" size="sm" onClick={runMatch} loading={matching}>
              명세서와 대조
            </Button>
          }
        />

        <div className="pb-10">
          {memos === null ? (
            <LoadingState size="block" />
          ) : memos.length === 0 ? (
            <EmptyState
              compact
              icon={CreditCard}
              title="아직 기록이 없습니다"
              description="결제하고 나서 캡처만 올리면 여기에 쌓입니다."
            />
          ) : (
            <ul className="divide-y divide-nd-line">
              {memos.slice(0, 50).map((m) => (
                <LeavingItem as="li" key={m.id} state={leaving.state[m.id]} gap="0" bodyClassName="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-nd-body font-medium text-nd-fg" title={m.note}>{m.note}</p>
                      <p className="mt-0.5 text-nd-caption text-nd-fg-3">
                        <span className="nd-num">{m.date}</span> · {aliasOf(m.last4)}
                        {m.vendor && ` · ${m.vendor}`}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <Money value={m.amount} flow="expense" className="text-nd-body font-semibold" />
                      <p className="mt-0.5">
                        {m.matchedTxId ? (
                          <StatusDot tone="success" className="text-nd-success-text">장부에 반영됨</StatusDot>
                        ) : (
                          <StatusDot tone="neutral" className="text-nd-fg-3">명세서 대기</StatusDot>
                        )}
                      </p>
                    </div>
                  </div>
                  {m.photos && m.photos.length > 0 && (
                    <div className="nd-scroll mt-2 flex gap-2 overflow-x-auto">
                      {m.photos.map((p) => (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <a key={p.path} href={p.url} target="_blank" rel="noreferrer" className="shrink-0 rounded-nd-md">
                          <img src={p.url} alt="" className="h-20 w-20 rounded-nd-md object-cover" />
                        </a>
                      ))}
                    </div>
                  )}
                  {!m.matchedTxId && (
                    // 손가락으로 누르는 화면이라 44px 을 확보한다 (밑줄 글자 링크는 너무 작았다)
                    <div className="mt-1 flex justify-end">
                      <IconButton
                        icon={Trash2}
                        label={`${m.note} 기록 지우기`}
                        size="lg"
                        onClick={() => remove(m.id)}
                      />
                    </div>
                  )}
                </LeavingItem>
              ))}
            </ul>
          )}
        </div>
        </div>
      </div>
    </PageShell>
  );
}
