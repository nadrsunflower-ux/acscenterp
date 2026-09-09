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
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Camera, CreditCard, Images, TriangleAlert } from "lucide-react";
import {
  Button,
  Card,
  EmptyState,
  Icon,
  InlineNotice,
  Input,
  LoadingState,
  PageHeader,
  SectionHeader,
  Select,
  StatusDot,
  controlClass,
  useConfirm,
  useToast,
} from "@/components/neander/ui";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { Money } from "@/components/neander/finance/ui";
import {
  addCardMemo,
  deleteCardMemo,
  fetchCardMemos,
  matchCardMemos,
  readCardReceipt,
} from "@/lib/neander/finance/client";
import type { FinCardMemoView, ReceiptRead } from "@/lib/neander/finance/card-memo";
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

/** 한 줄에 한 칸 — 라벨은 ReactNode(「캡처에서 읽음」 표시)라 Field 대신 지역 부품 */
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
  const fileRef = useRef<HTMLInputElement>(null);
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
      if (fileRef.current) fileRef.current.value = "";
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
      await reload();
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
    // 휴대폰 폭에 맞춘 한 줄 배치. 큰 화면에서도 가운데 좁게 둔다 —
    // 넓게 펴면 칸이 옆으로 늘어져 오히려 누르기 어렵다.
    <div className="mx-auto max-w-lg">
      <PageHeader compact title="법인카드 사용 기록" />
      <p className="-mt-2 mb-4 text-nd-body leading-relaxed text-nd-fg-2">
        결제 화면을 캡처해서 올리면 <b className="font-semibold text-nd-fg">칸이 알아서 채워집니다.</b>{" "}
        확인만 하고 저장하세요. 나중에 카드 명세서를 올리면 뒷 4자리·금액·날짜로 자동으로 붙습니다.
      </p>

      {cards.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title="등록된 법인카드가 없습니다"
          description="마스터 탭에서 결제수단을 먼저 적재하세요."
        />
      ) : (
        <Card className="space-y-3">
          {/* 사진이 먼저다 — 이걸 올리면 아래 칸이 채워진다 */}
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => void onPickPhotos([...(e.target.files ?? [])].slice(0, 3))}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={reading}
              aria-busy={reading || undefined}
              className="flex min-h-[6rem] w-full flex-col items-center justify-center gap-1 rounded-nd-lg border-2 border-dashed border-nd-accent/40 bg-nd-accent-soft/60 px-4 py-3 text-nd-accent-strong transition-colors duration-nd-fast active:bg-nd-accent-soft disabled:opacity-60"
            >
              {reading ? (
                <>
                  <span className="text-nd-body font-semibold">캡처를 읽는 중…</span>
                  <span className="text-nd-caption text-nd-accent">2~3초 걸립니다</span>
                </>
              ) : photos.length > 0 ? (
                <>
                  <Icon icon={Images} size={24} />
                  <span className="text-nd-body font-semibold">사진 {photos.length}장 · 다시 고르기</span>
                  <span className="text-nd-caption text-nd-accent">아래 칸을 확인하세요</span>
                </>
              ) : (
                <>
                  <Icon icon={Camera} size={28} />
                  <span className="text-nd-body font-semibold">결제 화면 캡처 올리기</span>
                  <span className="text-nd-caption text-nd-accent">칸이 알아서 채워집니다 · 없어도 직접 입력 가능</span>
                </>
              )}
            </button>

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
            {/* 커서 위치 복원에 ref 가 필요해 원소를 직접 쓴다 (Input 은 ref 를 넘기지 않는다) */}
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

      <SectionHeader
        as="h2"
        className="mt-6"
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
          <p className="py-6 text-center text-nd-body text-nd-fg-3">아직 기록이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-nd-line">
            {memos.slice(0, 50).map((m) => (
              <li key={m.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-nd-body font-medium text-nd-fg" title={m.note}>{m.note}</p>
                    <p className="mt-0.5 text-nd-caption text-nd-fg-3">
                      <span className="nd-num">{m.date}</span> · {aliasOf(m.last4)}
                      {m.vendor && ` · ${m.vendor}`}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Money value={m.amount} className="text-nd-body font-semibold" />
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
                  <button
                    type="button"
                    onClick={() => remove(m.id)}
                    className="mt-2 min-h-[28px] text-nd-caption text-nd-fg-3 underline hover:text-nd-danger-text"
                  >
                    지우기
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
