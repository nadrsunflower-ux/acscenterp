"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Section from "@/components/ui/Section";
import Badge from "@/components/ui/Badge";
import type { Store, Product, PriceOption } from "@/lib/types";
import {
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  uploadImage,
  isFirebaseConfigured,
} from "@/lib/db";
import { storeLabel } from "@/lib/content";
import { formatPrice } from "@/lib/date";
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
  name: string;
  tagline: string;
  prices: PriceOption[];
  composition: string;
  note: string;
  order: number;
  active: boolean;
  imageUrl: string;
}

function emptyForm(): FormState {
  return {
    store: "id",
    name: "",
    tagline: "",
    prices: [{ label: "", amount: 0 }],
    composition: "",
    note: "",
    order: 0,
    active: true,
    imageUrl: "",
  };
}

const STORES: Store[] = ["id", "wow"];
const STORE_META: Record<Store, { dot: string; text: string; bg: string }> = {
  id: { dot: "bg-brand", text: "text-brand-dark", bg: "bg-brand-light/60" },
  wow: { dot: "bg-wow", text: "text-orange-700", bg: "bg-orange-50" },
};

export default function ProductAdmin() {
  const configured = isFirebaseConfigured();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  async function refresh() {
    if (!configured) return;
    setLoading(true);
    try {
      setProducts(await listProducts());
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

  function startEdit(p: Product) {
    setEditingId(p.id);
    setForm({
      store: p.store,
      name: p.name,
      tagline: p.tagline ?? "",
      prices: p.prices.length ? p.prices : [{ label: "", amount: 0 }],
      composition: p.composition,
      note: p.note ?? "",
      order: p.order,
      active: p.active,
      imageUrl: p.imageUrl ?? "",
    });
    setStatus(null);
  }

  // ---- 가격 옵션 편집 ----
  function setPrice(idx: number, patch: Partial<PriceOption>) {
    setForm((f) => ({
      ...f,
      prices: f.prices.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    }));
  }
  function addPrice() {
    setForm((f) => ({ ...f, prices: [...f.prices, { label: "", amount: 0 }] }));
  }
  function removePrice(idx: number) {
    setForm((f) => ({ ...f, prices: f.prices.filter((_, i) => i !== idx) }));
  }

  async function handleUpload(file: File) {
    if (!configured) {
      setStatus({ kind: "error", text: "Firebase 미설정으로 업로드할 수 없습니다." });
      return;
    }
    setUploading(true);
    setStatus(null);
    try {
      const url = await uploadImage(file, "products");
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
    if (!form.name.trim()) {
      setStatus({ kind: "error", text: "상품명을 입력하세요." });
      return;
    }
    const prices = form.prices
      .map((p) => ({ label: p.label.trim(), amount: Number(p.amount) || 0 }))
      .filter((p) => p.label && p.amount > 0);

    // 표시 순서: 신규는 그 매장 맨 뒤로, 수정은 기존 순서 유지(목록 드래그로 변경)
    const order = editingId
      ? form.order
      : products
          .filter((p) => p.store === form.store)
          .reduce((m, p) => Math.max(m, p.order), 0) + 1;

    const payload: Omit<Product, "id"> = {
      store: form.store,
      name: form.name.trim(),
      prices,
      composition: form.composition.trim(),
      order,
      active: form.active,
      ...(form.tagline.trim() ? { tagline: form.tagline.trim() } : {}),
      ...(form.note.trim() ? { note: form.note.trim() } : {}),
      ...(form.imageUrl ? { imageUrl: form.imageUrl } : {}),
    };

    try {
      if (editingId) {
        await updateProduct(editingId, payload);
        setStatus({ kind: "success", text: "상품을 수정했습니다." });
      } else {
        await createProduct(payload);
        setStatus({ kind: "success", text: "상품을 등록했습니다." });
      }
      resetForm();
      await refresh();
    } catch {
      setStatus({ kind: "error", text: "저장 중 오류가 발생했습니다." });
    }
  }

  async function handleDelete(id: string) {
    if (!configured) return;
    if (!window.confirm("이 상품을 삭제할까요?")) return;
    try {
      await deleteProduct(id);
      if (editingId === id) resetForm();
      setStatus({ kind: "success", text: "삭제했습니다." });
      await refresh();
    } catch {
      setStatus({ kind: "error", text: "삭제 중 오류가 발생했습니다." });
    }
  }

  // ---- 드래그 순서 변경(같은 매장 내) ----
  function handleDrop(store: Store, targetId: string) {
    const src = dragId;
    setDragId(null);
    if (!src || src === targetId) return;
    const list = products
      .filter((p) => p.store === store)
      .sort((a, b) => a.order - b.order);
    const from = list.findIndex((p) => p.id === src);
    const to = list.findIndex((p) => p.id === targetId);
    if (from < 0 || to < 0) return; // 다른 매장 간 이동은 무시
    const reordered = [...list];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    // 새 순서(1-base) 로컬 반영 + 변경분만 백그라운드 저장
    const orderMap = new Map(reordered.map((p, i) => [p.id, i + 1]));
    setProducts((prev) =>
      prev.map((p) =>
        orderMap.has(p.id) ? { ...p, order: orderMap.get(p.id)! } : p
      )
    );
    reordered.forEach((p, i) => {
      if (p.order !== i + 1) void updateProduct(p.id, { order: i + 1 }).catch(() => {});
    });
  }

  return (
    <Section
      title="상품"
      subtitle="매장별 운영 상품을 등록/수정/삭제합니다. 목록에서 드래그로 표시 순서를 바꿀 수 있습니다."
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
            <Field label="상품명">
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="예: 뿌리는 덕질 1탄"
              />
            </Field>
            <Field label="태그라인(선택)">
              <input
                className="input"
                value={form.tagline}
                onChange={(e) =>
                  setForm((f) => ({ ...f, tagline: e.target.value }))
                }
                placeholder="예: AI 이미지 분석 퍼퓸"
              />
            </Field>

            <Field label="가격 옵션">
              <div className="space-y-2">
                {form.prices.map((p, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      className="input flex-1"
                      value={p.label}
                      onChange={(e) => setPrice(idx, { label: e.target.value })}
                      placeholder="라벨(예: 50ml)"
                    />
                    <input
                      type="number"
                      className="input w-28"
                      value={p.amount || ""}
                      onChange={(e) =>
                        setPrice(idx, { amount: Number(e.target.value) || 0 })
                      }
                      placeholder="금액(원)"
                    />
                    <MiniButton tone="red" onClick={() => removePrice(idx)}>
                      삭제
                    </MiniButton>
                  </div>
                ))}
                <button type="button" className="btn-ghost" onClick={addPrice}>
                  + 가격 옵션 추가
                </button>
                <p className="text-xs text-gray-400">
                  라벨과 금액이 모두 채워진 옵션만 저장됩니다.
                </p>
              </div>
            </Field>

            <Field label="구성">
              <input
                className="input"
                value={form.composition}
                onChange={(e) =>
                  setForm((f) => ({ ...f, composition: e.target.value }))
                }
                placeholder="예: 퍼퓸+분석보고서"
              />
            </Field>
            <Field label="메모(선택)">
              <input
                className="input"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="예: 특전 구성은 이벤트별 상이"
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
                    <div className="relative h-20 w-28 overflow-hidden rounded-lg bg-gray-100">
                      <Image
                        src={form.imageUrl}
                        alt="미리보기"
                        fill
                        sizes="112px"
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

            <Field label="노출 상태">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, active: e.target.checked }))
                  }
                />
                활성(고객 페이지 노출)
              </label>
            </Field>

            <div className="flex items-center gap-2">
              <button type="submit" className="btn-primary">
                {editingId ? "수정 저장" : "상품 등록"}
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

        {/* 우측: 등록된 목록 (매장별 그룹 + 드래그 정렬) */}
        <div className="lg:border-l lg:border-gray-100 lg:pl-6">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">
            등록된 상품 ({products.length})
            <span className="ml-1 font-normal text-gray-400">
              · 드래그로 순서 변경
            </span>
          </h3>
          {loading ? (
            <p className="text-sm text-gray-500">불러오는 중...</p>
          ) : products.length === 0 ? (
            <p className="text-sm text-gray-500">등록된 상품이 없습니다.</p>
          ) : (
            <div className="space-y-5">
              {STORES.map((store) => {
                const meta = STORE_META[store];
                const list = products
                  .filter((p) => p.store === store)
                  .sort((a, b) => a.order - b.order);
                return (
                  <div key={store}>
                    <div
                      className={`mb-2 flex items-center gap-2 rounded-lg px-2.5 py-1.5 ${meta.bg}`}
                    >
                      <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                      <span className={`text-sm font-bold ${meta.text}`}>
                        {storeLabel[store]}
                      </span>
                      <span className="text-xs font-normal text-gray-400">
                        {list.length}개
                      </span>
                    </div>
                    {list.length === 0 ? (
                      <p className="px-1 py-2 text-xs text-gray-400">
                        등록된 상품이 없습니다.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {list.map((p) => (
                          <li
                            key={p.id}
                            draggable
                            onDragStart={() => setDragId(p.id)}
                            onDragEnd={() => setDragId(null)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => handleDrop(store, p.id)}
                            className={
                              "flex items-center justify-between gap-2 rounded-xl border border-gray-100 bg-gray-50 px-2.5 py-2 " +
                              (dragId === p.id ? "opacity-40" : "")
                            }
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <span
                                className="cursor-grab select-none text-gray-300 active:cursor-grabbing"
                                title="드래그로 순서 변경"
                                aria-hidden
                              >
                                ⠿
                              </span>
                              <div className="min-w-0 text-sm">
                                <p className="flex flex-wrap items-center gap-1.5">
                                  <span className="font-medium text-gray-900">
                                    {p.name}
                                  </span>
                                  {!p.active ? (
                                    <Badge color="gray">비활성</Badge>
                                  ) : null}
                                </p>
                                <p className="mt-0.5 text-xs text-gray-500">
                                  {p.prices.length
                                    ? p.prices
                                        .map(
                                          (pr) =>
                                            `${pr.label} ${formatPrice(pr.amount)}`
                                        )
                                        .join(" / ")
                                    : "가격 이벤트별 상이"}
                                </p>
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <MiniButton tone="brand" onClick={() => startEdit(p)}>
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
