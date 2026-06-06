"use client";

import { useEffect, useState } from "react";
import Section from "@/components/ui/Section";
import type { Store } from "@/lib/types";
import { getFragrance, setFragrance, isFirebaseConfigured } from "@/lib/db";
import { formatKoreanDate } from "@/lib/date";
import {
  Field,
  StoreSelect,
  StatusBanner,
  FirebaseNotice,
  type StatusMessage,
} from "./adminUi";

export default function FragranceAdmin() {
  const configured = isFirebaseConfigured();
  const [store, setStore] = useState<Store>("id");
  const [recentDate, setRecentDate] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);

  async function refresh(target: Store) {
    if (!configured) return;
    setLoading(true);
    setStatus(null);
    try {
      const f = await getFragrance(target);
      setRecentDate(f?.recentDate ?? "");
      setNextDate(f?.nextDate ?? "");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh(store);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    if (!configured) {
      setStatus({ kind: "error", text: "Firebase 미설정으로 저장할 수 없습니다." });
      return;
    }
    if (!recentDate || !nextDate) {
      setStatus({ kind: "error", text: "최근/다음 교체일을 모두 입력하세요." });
      return;
    }
    try {
      await setFragrance(store, recentDate, nextDate);
      setStatus({ kind: "success", text: "향료 교체일을 저장했습니다." });
    } catch {
      setStatus({ kind: "error", text: "저장 중 오류가 발생했습니다." });
    }
  }

  return (
    <Section
      title="향료 교체일"
      subtitle="매장별 향료의 최근/다음 교체일을 관리합니다."
    >
      {!configured ? <FirebaseNotice /> : null}

      <form
        onSubmit={handleSubmit}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        <Field label="매장">
          <StoreSelect value={store} onChange={(v) => setStore(v as Store)} />
        </Field>
        <div className="hidden sm:block" aria-hidden />

        <Field label="최근 교체일">
          <input
            type="date"
            className="input"
            value={recentDate}
            onChange={(e) => setRecentDate(e.target.value)}
          />
        </Field>
        <Field label="다음 교체일">
          <input
            type="date"
            className="input"
            value={nextDate}
            onChange={(e) => setNextDate(e.target.value)}
          />
        </Field>

        {loading ? (
          <p className="text-sm text-gray-500 sm:col-span-2">불러오는 중...</p>
        ) : recentDate && nextDate ? (
          <p className="text-sm text-gray-500 sm:col-span-2">
            최근 {formatKoreanDate(recentDate)} · 다음{" "}
            {formatKoreanDate(nextDate)}
          </p>
        ) : null}

        <div className="sm:col-span-2">
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
