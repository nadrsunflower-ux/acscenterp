"use client";

import type { ReactNode } from "react";
import type { Store } from "@/lib/types";
import { storeLabel } from "@/lib/content";

// 관리자 탭들이 공유하는 작은 UI 조각 모음.

// 저장/오류 등 상태 메시지 (성공=초록 / 오류=빨강 / 정보=회색)
export type StatusKind = "success" | "error" | "info";

export interface StatusMessage {
  kind: StatusKind;
  text: string;
}

export function StatusBanner({ message }: { message: StatusMessage | null }) {
  if (!message) return null;
  const color =
    message.kind === "success"
      ? "bg-emerald-50 text-emerald-700"
      : message.kind === "error"
        ? "bg-red-50 text-red-600"
        : "bg-gray-100 text-gray-600";
  return (
    <p className={`rounded-lg px-3 py-2 text-sm ${color}`}>{message.text}</p>
  );
}

// Firebase 미설정 시 공통 안내 배너
export function FirebaseNotice() {
  return (
    <p className="mb-4 rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-700">
      Firebase 환경변수가 설정되지 않아 저장/조회가 동작하지 않습니다. .env.local
      설정 후 다시 시도하세요.
    </p>
  );
}

// 라벨 + 자식 입력 묶음
export function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <span className="label">{label}</span>
      {children}
    </div>
  );
}

// 매장 선택 셀렉트 (id / wow)
export function StoreSelect({
  value,
  onChange,
  includeAll = false,
  id,
}: {
  value: Store | "all";
  onChange: (v: Store | "all") => void;
  includeAll?: boolean;
  id?: string;
}) {
  return (
    <select
      id={id}
      className="input"
      value={value}
      onChange={(e) => onChange(e.target.value as Store | "all")}
    >
      {includeAll ? <option value="all">전체(공통)</option> : null}
      <option value="id">{storeLabel.id}</option>
      <option value="wow">{storeLabel.wow}</option>
    </select>
  );
}

// 작은 보조 버튼 (목록 내 수정/삭제 등)
export function MiniButton({
  children,
  onClick,
  tone = "gray",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "gray" | "red" | "brand";
  type?: "button" | "submit";
}) {
  const cls =
    tone === "red"
      ? "bg-red-50 text-red-600 hover:bg-red-100"
      : tone === "brand"
        ? "bg-brand-light text-brand-dark hover:bg-brand/20"
        : "bg-gray-100 text-gray-700 hover:bg-gray-200";
  return (
    <button
      type={type}
      onClick={onClick}
      className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${cls}`}
    >
      {children}
    </button>
  );
}
