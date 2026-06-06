"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Section from "@/components/ui/Section";
import Badge from "@/components/ui/Badge";
import type { Store, Promotion, PromotionType } from "@/lib/types";
import {
  listPromotions,
  createPromotion,
  updatePromotion,
  deletePromotion,
  uploadImage,
  isFirebaseConfigured,
} from "@/lib/db";
import { storeLabel } from "@/lib/content";
import { formatMonthDay, todayYMD } from "@/lib/date";
import {
  Field,
  StoreSelect,
  StatusBanner,
  FirebaseNotice,
  MiniButton,
  type StatusMessage,
} from "./adminUi";

interface FormState {
  store: Store;
  type: PromotionType;
  title: string;
  startDate: string;
  endDate: string;
  target: string;
  caution: string;
  imageUrl: string;
}

function emptyForm(): FormState {
  const t = todayYMD();
  return {
    store: "id",
    type: "discount",
    title: "",
    startDate: t,
    endDate: t,
    target: "",
    caution: "",
    imageUrl: "",
  };
}

// "2026-06" -> "2026년 6월"
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${y}년 ${parseInt(m, 10)}월`;
}

const STORES: Store[] = ["id", "wow"];
const STORE_META: Record<Store, { dot: string; text: string; bg: string }> = {
  id: { dot: "bg-brand", text: "text-brand-dark", bg: "bg-brand-light/60" },
  wow: { dot: "bg-wow", text: "text-orange-700", bg: "bg-orange-50" },
};

export default function PromotionAdmin() {
  const configured = isFirebaseConfigured();
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function refresh() {
    if (!configured) return;
    setLoading(true);
    try {
      setPromotions(await listPromotions());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetForm() {
    setForm(emptyForm());
    setEditingId(null);
  }

  function startEdit(p: Promotion) {
    setEditingId(p.id);
    setForm({
      store: p.store,
      type: p.type,
      title: p.title,
      startDate: p.startDate,
      endDate: p.endDate,
      target: p.target ?? "",
      caution: p.caution ?? "",
      imageUrl: p.imageUrl ?? "",
    });
    setStatus(null);
  }

  async function handleUpload(file: File) {
    if (!configured) {
      setStatus({ kind: "error", text: "Firebase 미설정으로 업로드할 수 없습니다." });
      return;
    }
    setUploading(true);
    setStatus(null);
    try {
      const url = await uploadImage(file, "promotions");
      if (url) {
        setForm((f) => ({ ...f, imageUrl: url }));
        setStatus({ kind: "success", text: "이미지를 업로드했습니다." });
      } else {
        setStatus({ kind: "error", text: "이미지 업로드에 실패했습니다." });
      }
    } catch {
      setStatus({ kind: "error", text: "이미지 업로드 중 오류가 발생했습니다." });
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    if (!configured) {
      setStatus({ kind: "error", text: "Firebase 미설정으로 저장할 수 없습니다." });
      return;
    }
    if (!form.title.trim()) {
      setStatus({ kind: "error", text: "이벤트 제목을 입력하세요." });
      return;
    }
    if (form.endDate < form.startDate) {
      setStatus({ kind: "error", text: "종료일은 시작일 이후여야 합니다." });
      return;
    }
    const payload: Omit<Promotion, "id"> = {
      store: form.store,
      type: form.type,
      title: form.title.trim(),
      startDate: form.startDate,
      endDate: form.endDate,
      active: true, // 노출 상태는 항상 활성
      ...(form.target.trim() ? { target: form.target.trim() } : {}),
      ...(form.caution.trim() ? { caution: form.caution.trim() } : {}),
      ...(form.imageUrl ? { imageUrl: form.imageUrl } : {}),
    };
    try {
      if (editingId) {
        await updatePromotion(editingId, payload);
        setStatus({ kind: "success", text: "매장 이벤트를 수정했습니다." });
      } else {
        await createPromotion(payload);
        setStatus({ kind: "success", text: "매장 이벤트를 등록했습니다." });
      }
      resetForm();
      await refresh();
    } catch {
      setStatus({ kind: "error", text: "저장 중 오류가 발생했습니다." });
    }
  }

  async function handleDelete(id: string) {
    if (!configured) return;
    if (!window.confirm("이 매장 이벤트를 삭제할까요?")) return;
    try {
      await deletePromotion(id);
      if (editingId === id) resetForm();
      setStatus({ kind: "success", text: "삭제했습니다." });
      await refresh();
    } catch {
      setStatus({ kind: "error", text: "삭제 중 오류가 발생했습니다." });
    }
  }

  // 매장별 → 시작일 기준 월별 그룹
  const byStore = useMemo(() => {
    const result: Record<Store, [string, Promotion[]][]> = { id: [], wow: [] };
    for (const store of STORES) {
      const map = new Map<string, Promotion[]>();
      for (const p of promotions.filter((p) => p.store === store)) {
        const ym = (p.startDate || "").slice(0, 7);
        const arr = map.get(ym) ?? [];
        arr.push(p);
        map.set(ym, arr);
      }
      result[store] = Array.from(map.entries())
        .map(
          ([ym, list]) =>
            [
              ym,
              [...list].sort((a, b) => a.startDate.localeCompare(b.startDate)),
            ] as [string, Promotion[]]
        )
        .sort((a, b) => a[0].localeCompare(b[0]));
    }
    return result;
  }, [promotions]);

  return (
    <Section
      title="매장 이벤트"
      subtitle="할인·증정 등 매장 이벤트를 등록/수정/삭제합니다. 기간·대상·주의사항·이미지를 함께 관리합니다."
    >
      {!configured ? <FirebaseNotice /> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 좌측: 등록/수정 폼 */}
        <div>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3">
            <Field label="매장">
              <StoreSelect
                value={form.store}
                onChange={(v) => setForm((f) => ({ ...f, store: v as Store }))}
              />
            </Field>
            <Field label="유형">
              <select
                className="input"
                value={form.type}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    type: e.target.value as PromotionType,
                  }))
                }
              >
                <option value="discount">할인</option>
                <option value="gift">증정</option>
              </select>
            </Field>
            <Field label="제목">
              <input
                className="input"
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
                placeholder="예: 전상품 10%"
              />
            </Field>
            <Field label="시작일">
              <input
                type="date"
                className="input"
                value={form.startDate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, startDate: e.target.value }))
                }
              />
            </Field>
            <Field label="종료일">
              <input
                type="date"
                className="input"
                value={form.endDate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, endDate: e.target.value }))
                }
              />
            </Field>
            <Field label="대상(선택)">
              <input
                className="input"
                value={form.target}
                onChange={(e) =>
                  setForm((f) => ({ ...f, target: e.target.value }))
                }
                placeholder="예: 네이버플레이스에서 10% 쿠폰을 받은 고객"
              />
            </Field>
            <Field label="주의사항(선택)">
              <input
                className="input"
                value={form.caution}
                onChange={(e) =>
                  setForm((f) => ({ ...f, caution: e.target.value }))
                }
                placeholder="예: 포도알 이벤트 적용 불가"
              />
            </Field>

            <Field label="이미지(선택)">
              <div className="flex flex-col gap-2">
                <input
                  type="file"
                  accept="image/*"
                  className="text-sm"
                  disabled={uploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload(file);
                  }}
                />
                {uploading ? (
                  <p className="text-xs text-gray-500">업로드 중...</p>
                ) : null}
                {form.imageUrl ? (
                  <div className="flex items-center gap-3">
                    <div className="relative h-20 w-32 overflow-hidden rounded-lg bg-gray-100">
                      <Image
                        src={form.imageUrl}
                        alt="미리보기"
                        fill
                        sizes="128px"
                        className="object-cover"
                      />
                    </div>
                    <MiniButton
                      tone="red"
                      onClick={() => setForm((f) => ({ ...f, imageUrl: "" }))}
                    >
                      이미지 제거
                    </MiniButton>
                  </div>
                ) : null}
              </div>
            </Field>

            <div className="flex items-center gap-2">
              <button type="submit" className="btn-primary">
                {editingId ? "수정 저장" : "이벤트 등록"}
              </button>
              {editingId ? (
                <button type="button" className="btn-ghost" onClick={resetForm}>
                  취소
                </button>
              ) : null}
            </div>
          </form>

          <div className="mt-3">
            <StatusBanner message={status} />
          </div>
        </div>

        {/* 우측: 등록된 목록 (매장별 → 월별) */}
        <div className="lg:border-l lg:border-gray-100 lg:pl-6">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">
            등록된 매장 이벤트 ({promotions.length})
          </h3>
          {loading ? (
            <p className="text-sm text-gray-500">불러오는 중...</p>
          ) : promotions.length === 0 ? (
            <p className="text-sm text-gray-500">
              등록된 매장 이벤트가 없습니다.
            </p>
          ) : (
            <div className="space-y-5">
              {STORES.map((store) => {
                const meta = STORE_META[store];
                const months = byStore[store];
                return (
                  <div key={store}>
                    <div
                      className={`mb-2 flex items-center gap-2 rounded-lg px-2.5 py-1.5 ${meta.bg}`}
                    >
                      <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                      <span className={`text-sm font-bold ${meta.text}`}>
                        {storeLabel[store]}
                      </span>
                    </div>
                    {months.length === 0 ? (
                      <p className="px-1 py-2 text-xs text-gray-400">
                        등록된 이벤트가 없습니다.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {months.map(([ym, list]) => (
                          <div key={ym}>
                            <h5 className="mb-1.5 px-1 text-xs font-bold text-gray-500">
                              {monthLabel(ym)}
                              <span className="ml-1 font-normal text-gray-400">
                                {list.length}건
                              </span>
                            </h5>
                            <ul className="space-y-2">
                              {list.map((p) => (
                                <li
                                  key={p.id}
                                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2"
                                >
                                  <div className="flex flex-wrap items-center gap-2 text-sm">
                                    <Badge
                                      color={
                                        p.type === "discount" ? "red" : "green"
                                      }
                                    >
                                      {p.type === "discount" ? "할인" : "증정"}
                                    </Badge>
                                    <span className="font-medium text-gray-900">
                                      {p.title}
                                    </span>
                                    <span className="text-gray-600">
                                      {formatMonthDay(p.startDate)} ~{" "}
                                      {formatMonthDay(p.endDate)}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <MiniButton
                                      tone="brand"
                                      onClick={() => startEdit(p)}
                                    >
                                      수정
                                    </MiniButton>
                                    <MiniButton
                                      tone="red"
                                      onClick={() => handleDelete(p.id)}
                                    >
                                      삭제
                                    </MiniButton>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}
