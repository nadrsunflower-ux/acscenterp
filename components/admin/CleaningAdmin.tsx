"use client";

import { useEffect, useState } from "react";
import Section from "@/components/ui/Section";
import type { Store, CleaningZone } from "@/lib/types";
import { getCleaning, setCleaning, isFirebaseConfigured } from "@/lib/db";
import { storeLabel } from "@/lib/content";
import {
  Field,
  StoreSelect,
  StatusBanner,
  FirebaseNotice,
  MiniButton,
  type StatusMessage,
} from "./adminUi";

export default function CleaningAdmin() {
  const configured = isFirebaseConfigured();
  const [store, setStore] = useState<Store>("id");
  const [zones, setZones] = useState<CleaningZone[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);

  async function load(target: Store) {
    if (!configured) return;
    setLoading(true);
    setStatus(null);
    try {
      const c = await getCleaning(target);
      setZones(c?.zones ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(store);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  // ---- 구역 편집 ----
  function addZone() {
    setZones((zs) => [...zs, { name: "", items: [""] }]);
  }
  function removeZone(zi: number) {
    setZones((zs) => zs.filter((_, i) => i !== zi));
  }
  function setZoneName(zi: number, name: string) {
    setZones((zs) => zs.map((z, i) => (i === zi ? { ...z, name } : z)));
  }

  // ---- 항목 편집 ----
  function addItem(zi: number) {
    setZones((zs) =>
      zs.map((z, i) => (i === zi ? { ...z, items: [...z.items, ""] } : z))
    );
  }
  function removeItem(zi: number, ii: number) {
    setZones((zs) =>
      zs.map((z, i) =>
        i === zi ? { ...z, items: z.items.filter((_, j) => j !== ii) } : z
      )
    );
  }
  function setItem(zi: number, ii: number, text: string) {
    setZones((zs) =>
      zs.map((z, i) =>
        i === zi
          ? { ...z, items: z.items.map((it, j) => (j === ii ? text : it)) }
          : z
      )
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    if (!configured) {
      setStatus({ kind: "error", text: "Firebase 미설정으로 저장할 수 없습니다." });
      return;
    }
    // 정리: 빈 항목 제거 → 이름이 있는 구역만 저장
    const cleaned: CleaningZone[] = zones
      .map((z) => ({
        name: z.name.trim(),
        items: z.items.map((it) => it.trim()).filter(Boolean),
      }))
      .filter((z) => z.name.length > 0);
    try {
      await setCleaning(store, cleaned);
      setZones(cleaned.length ? cleaned : []);
      setStatus({
        kind: "success",
        text: `${storeLabel[store]} 청소 가이드를 저장했습니다. (구역 ${cleaned.length}개)`,
      });
    } catch {
      setStatus({ kind: "error", text: "저장 중 오류가 발생했습니다." });
    }
  }

  return (
    <Section
      title="청소 가이드"
      subtitle="매장별 청소 구역과 각 구역의 청소 항목을 등록/수정합니다."
    >
      {!configured ? <FirebaseNotice /> : null}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="매장">
          <StoreSelect value={store} onChange={(v) => setStore(v as Store)} />
        </Field>

        {loading ? (
          <p className="text-sm text-gray-500">불러오는 중...</p>
        ) : (
          <div className="space-y-3">
            {zones.length === 0 ? (
              <p className="text-sm text-gray-400">
                등록된 구역이 없습니다. 아래 버튼으로 청소 구역을 추가하세요.
              </p>
            ) : (
              zones.map((zone, zi) => (
                <div
                  key={zi}
                  className="rounded-xl border border-gray-200 bg-gray-50 p-3"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <input
                      className="input flex-1 font-medium"
                      value={zone.name}
                      onChange={(e) => setZoneName(zi, e.target.value)}
                      placeholder="구역 이름 (예: 카운터, 진열대, 바닥)"
                    />
                    <MiniButton tone="red" onClick={() => removeZone(zi)}>
                      구역 삭제
                    </MiniButton>
                  </div>

                  <div className="space-y-2 pl-1">
                    {zone.items.map((item, ii) => (
                      <div key={ii} className="flex items-center gap-2">
                        <span className="text-xs text-gray-300">•</span>
                        <input
                          className="input flex-1"
                          value={item}
                          onChange={(e) => setItem(zi, ii, e.target.value)}
                          placeholder="청소 항목 (예: 유리 닦기)"
                        />
                        <MiniButton tone="red" onClick={() => removeItem(zi, ii)}>
                          삭제
                        </MiniButton>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => addItem(zi)}
                    >
                      + 항목 추가
                    </button>
                  </div>
                </div>
              ))
            )}

            <button type="button" className="btn-ghost" onClick={addZone}>
              + 구역 추가
            </button>
            <p className="text-xs text-gray-400">
              구역 이름이 비어 있으면 저장 시 제외됩니다. 빈 항목도 자동으로
              정리됩니다.
            </p>
          </div>
        )}

        <div>
          <button type="submit" className="btn-primary">
            저장
          </button>
        </div>
      </form>

      <div className="mt-4">
        <StatusBanner message={status} />
      </div>
    </Section>
  );
}
