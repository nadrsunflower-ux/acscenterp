"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { seedInitialData, isFirebaseConfigured } from "@/lib/db";
import { ADMIN_LOGIN_PATH } from "@/lib/auth";
import EventAdmin from "@/components/admin/EventAdmin";
import ProductAdmin from "@/components/admin/ProductAdmin";
import PromotionAdmin from "@/components/admin/PromotionAdmin";
import FragranceAdmin from "@/components/admin/FragranceAdmin";
import CleaningAdmin from "@/components/admin/CleaningAdmin";
import DailyTaskAdmin from "@/components/admin/DailyTaskAdmin";
import SchedulerApp from "@/components/scheduler/SchedulerApp";

type TabKey =
  | "worklog"
  | "dailytask"
  | "event"
  | "product"
  | "promotion"
  | "fragrance"
  | "cleaning";

const TABS: { key: TabKey; label: string }[] = [
  { key: "worklog", label: "근무 일지" },
  { key: "dailytask", label: "일일 업무" },
  { key: "event", label: "생일 이벤트" },
  { key: "product", label: "상품" },
  { key: "promotion", label: "매장 이벤트" },
  { key: "fragrance", label: "향료 교체일" },
  { key: "cleaning", label: "청소 가이드" },
];

export default function AdminPage() {
  const router = useRouter();
  const configured = isFirebaseConfigured();
  const [tab, setTab] = useState<TabKey>("worklog");
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState<string | null>(null);

  async function handleSeed() {
    setSeedMsg(null);
    if (!configured) {
      setSeedMsg("Firebase 미설정으로 초기 데이터를 불러올 수 없습니다.");
      return;
    }
    if (
      !window.confirm(
        "기본 상품/이벤트/향료/청소 데이터를 불러옵니다.\n기존 동일 항목은 덮어쓰여집니다. 진행할까요?"
      )
    ) {
      return;
    }
    setSeeding(true);
    try {
      await seedInitialData();
      setSeedMsg("초기 데이터를 불러왔습니다. 각 탭에서 확인하세요.");
    } catch {
      setSeedMsg("초기 데이터를 불러오는 중 오류가 발생했습니다.");
    } finally {
      setSeeding(false);
    }
  }

  async function handleLogout() {
    try {
      await fetch("/api/admin-logout", { method: "POST" });
    } catch {
      // 무시 — 쿠키는 만료 처리됨
    }
    router.replace(ADMIN_LOGIN_PATH);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">관리자 콘솔</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            근무·업무·이벤트·상품·운영 데이터를 관리합니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost disabled:opacity-60"
            onClick={handleSeed}
            disabled={seeding}
          >
            {seeding ? "불러오는 중..." : "초기 데이터 불러오기"}
          </button>
          <button
            type="button"
            className="btn bg-gray-100 text-gray-700 hover:bg-gray-200"
            onClick={handleLogout}
          >
            로그아웃
          </button>
        </div>
      </div>

      {!configured ? (
        <p className="rounded-xl bg-orange-50 px-4 py-3 text-sm text-orange-700">
          Firebase 환경변수가 설정되지 않았습니다. .env.local 설정 전까지
          저장·조회 기능이 동작하지 않습니다.
        </p>
      ) : null}

      {seedMsg ? (
        <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {seedMsg}
        </p>
      ) : null}

      {/* 탭 네비게이션 */}
      <div className="flex flex-wrap gap-1.5 overflow-x-auto">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-current={active ? "page" : undefined}
              className={
                "whitespace-nowrap rounded-xl px-3 py-1.5 text-sm font-medium transition-colors " +
                (active
                  ? "bg-brand text-white"
                  : "bg-white text-gray-600 ring-1 ring-black/5 hover:bg-brand-light hover:text-brand-dark")
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* 탭 콘텐츠 */}
      <div>
        {tab === "dailytask" ? <DailyTaskAdmin /> : null}
        {tab === "event" ? <EventAdmin /> : null}
        {tab === "product" ? <ProductAdmin /> : null}
        {tab === "promotion" ? <PromotionAdmin /> : null}
        {tab === "fragrance" ? <FragranceAdmin /> : null}
        {tab === "cleaning" ? <CleaningAdmin /> : null}
        {/* 근무 일지: 주간 그리드/리포트가 넓어 max-w-5xl 컨테이너를 벗어나
            전체 폭(full-bleed)으로 표시한다. 안쪽은 max-w-[1600px]로 재중앙정렬. */}
        {tab === "worklog" ? (
          <div className="relative left-1/2 right-1/2 -mx-[50vw] w-screen overflow-x-clip">
            <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-4">
              <SchedulerApp />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
