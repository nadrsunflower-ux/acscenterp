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
//  ⚠️ 현장에서 계산대 앞에 서서 쓰는 화면이다. 한 손으로, 30초 안에
//     끝나야 한다. 그래서 —
//       · 한 줄에 한 칸. 두 칸을 나란히 놓지 않는다.
//       · 손가락에 맞는 큰 입력칸(h-12)과 큰 버튼.
//       · 금액은 숫자 키패드가 뜨게 inputMode=numeric.
//       · 날짜는 오늘로 채워 둔다. 대부분 오늘 쓴 것이다.
//       · 카드는 마지막에 고른 것을 기억한다. 보통 같은 카드를 계속 쓴다.
//       · 계정·사업구분은 접어 둔다. 몰라도 저장할 수 있어야 한다 —
//         모르면 못 적게 만들면 아예 안 적는다.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, EmptyState, Select } from "@/components/neander/ui";
import { useFinance } from "@/components/neander/finance/FinanceProvider";
import { Money } from "@/components/neander/finance/ui";
import {
  addCardMemo,
  deleteCardMemo,
  fetchCardMemos,
  matchCardMemos,
} from "@/lib/neander/finance/client";
import type { FinCardMemoView } from "@/lib/neander/finance/card-memo";
import { todayStr } from "@/lib/neander/format";

/** 마지막에 고른 카드를 기억한다 — 보통 같은 카드를 계속 쓴다 */
const LAST_CARD_KEY = "neander.finance.cardMemo.last4";

const field =
  "h-12 w-full rounded-xl border border-zinc-300 bg-white px-3.5 text-base text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100";

export default function CardMemoPage() {
  const { paymentMethods, loading } = useFinance();
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
  const [saving, setSaving] = useState(false);
  const [matching, setMatching] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      setMemos(await fetchCardMemos());
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "불러오지 못했습니다." });
    }
  }, []);

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

  const amountNum = Math.round(Number(amount.replace(/[^\d.-]/g, "")));
  const canSave = !!date && !!last4 && note.trim() !== "" && Number.isFinite(amountNum) && amountNum !== 0;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setNotice(null);
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
      if (fileRef.current) fileRef.current.value = "";
      setNotice(
        r.warning ? { kind: "error", text: r.warning } : { kind: "ok", text: "기록했습니다." },
      );
      await reload();
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "저장에 실패했습니다." });
    } finally {
      setSaving(false);
    }
  };

  const runMatch = async () => {
    setMatching(true);
    setNotice(null);
    try {
      const r = await matchCardMemos();
      setNotice({
        kind: "ok",
        text:
          r.matched > 0
            ? `${r.matched}건을 카드 명세서에 붙였습니다.` +
              (r.ambiguous > 0 ? ` ${r.ambiguous}건은 후보가 여럿이라 남겼습니다.` : "")
            : r.ambiguous > 0
              ? `붙일 수 있는 건 없고, ${r.ambiguous}건은 후보가 여럿입니다.`
              : "아직 붙일 명세서가 없습니다.",
      });
      await reload();
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "대조에 실패했습니다." });
    } finally {
      setMatching(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("이 기록을 지울까요? 사진도 함께 지워집니다.")) return;
    try {
      await deleteCardMemo(id);
      await reload();
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "삭제에 실패했습니다." });
    }
  };

  const aliasOf = useCallback(
    (l4: string) => paymentMethods.find((p) => p.last4 === l4)?.alias ?? l4,
    [paymentMethods],
  );

  if (loading) return <p className="p-6 text-center text-sm text-zinc-400">불러오는 중…</p>;

  const waiting = memos?.filter((m) => !m.matchedTxId).length ?? 0;

  return (
    // 휴대폰 폭에 맞춘 한 줄 배치. 큰 화면에서도 가운데 좁게 둔다 —
    // 넓게 펴면 칸이 옆으로 늘어져 오히려 누르기 어렵다.
    <div className="mx-auto w-full max-w-lg px-4 py-5">
      <h1 className="text-xl font-bold tracking-tight text-zinc-900">법인카드 사용 기록</h1>
      <p className="mt-1 text-sm leading-relaxed text-zinc-500">
        결제하고 바로 남겨 두세요. 나중에 카드 명세서를 올리면 뒷 4자리·금액·날짜로
        <b className="text-zinc-700"> 자동으로 붙습니다.</b>
      </p>

      {notice && (
        <p
          className={`mt-3 rounded-xl px-3.5 py-2.5 text-sm ${
            notice.kind === "ok"
              ? "bg-emerald-50 text-emerald-800"
              : "bg-rose-50 text-rose-700"
          }`}
        >
          {notice.text}
        </p>
      )}

      {cards.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon="💳"
            title="등록된 법인카드가 없습니다"
            description="마스터 탭에서 결제수단을 먼저 적재하세요."
          />
        </div>
      ) : (
        <Card className="mt-4 space-y-3 rounded-2xl">
          <label className="block">
            <span className="text-xs font-medium text-zinc-500">사용일</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`mt-1 ${field}`} />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-zinc-500">카드</span>
            <Select value={last4} onChange={(e) => setLast4(e.target.value)} className={`mt-1 ${field}`}>
              <option value="">카드를 고르세요</option>
              {cards.map((c) => (
                <option key={c.last4} value={c.last4}>
                  {c.alias} · {c.last4}
                </option>
              ))}
            </Select>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-zinc-500">금액</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              // 휴대폰에서 숫자 키패드가 뜨게 한다
              inputMode="numeric"
              placeholder="20290"
              className={`mt-1 ${field} text-right tabular-nums`}
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-zinc-500">무엇에 썼나요</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="예: JIMFF 러너 조이스틱"
              className={`mt-1 ${field}`}
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-zinc-500">
              가맹점 <span className="font-normal text-zinc-400">(선택)</span>
            </span>
            <input
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="예: 쿠팡"
              className={`mt-1 ${field}`}
            />
          </label>

          <div>
            <span className="text-xs font-medium text-zinc-500">
              사진 <span className="font-normal text-zinc-400">(선택 · 최대 5장)</span>
            </span>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setPhotos([...(e.target.files ?? [])].slice(0, 5))}
              className="mt-1 block w-full text-sm text-zinc-500 file:mr-3 file:h-10 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:text-sm file:font-medium file:text-zinc-700"
            />
            {photos.length > 0 && (
              <p className="mt-1 text-xs text-zinc-500">{photos.length}장 선택됨</p>
            )}
          </div>

          <Button onClick={save} disabled={!canSave || saving} className="h-12 w-full rounded-xl text-base">
            {saving ? "저장 중…" : "기록하기"}
          </Button>
        </Card>
      )}

      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-700">
          최근 기록
          {waiting > 0 && (
            <span className="ml-1.5 font-normal text-zinc-400">명세서 대기 {waiting}건</span>
          )}
        </h2>
        <Button variant="secondary" onClick={runMatch} disabled={matching} className="h-9 px-3 text-xs">
          {matching ? "대조 중…" : "명세서와 대조"}
        </Button>
      </div>

      <div className="mt-2 space-y-2 pb-10">
        {memos === null ? (
          <p className="py-6 text-center text-sm text-zinc-400">불러오는 중…</p>
        ) : memos.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-400">아직 기록이 없습니다.</p>
        ) : (
          memos.slice(0, 50).map((m) => (
            <div key={m.id} className="rounded-xl border border-zinc-200 bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-900">{m.note}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {m.date} · {aliasOf(m.last4)}
                    {m.vendor && ` · ${m.vendor}`}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <Money value={m.amount} className="text-sm font-semibold" />
                  <p className="mt-0.5 text-xs">
                    {m.matchedTxId ? (
                      <span className="text-emerald-600">장부에 반영됨</span>
                    ) : (
                      <span className="text-zinc-400">명세서 대기</span>
                    )}
                  </p>
                </div>
              </div>
              {m.photos && m.photos.length > 0 && (
                <div className="mt-2 flex gap-2 overflow-x-auto">
                  {m.photos.map((p) => (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <a key={p.path} href={p.url} target="_blank" rel="noreferrer" className="shrink-0">
                      <img src={p.url} alt="" className="h-20 w-20 rounded-lg object-cover" />
                    </a>
                  ))}
                </div>
              )}
              {!m.matchedTxId && (
                <button
                  onClick={() => remove(m.id)}
                  className="mt-2 text-xs text-zinc-400 underline hover:text-rose-600"
                >
                  지우기
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
