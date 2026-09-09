"use client";

// ============================================================
//  계정 3단 종속 드롭다운
// ------------------------------------------------------------
//  계정 마스터(통합_MAP 317개)에서 거래유형 → 대분류 → 중분류 →
//  소분류 순으로 후보를 좁힌다. 상위를 바꾸면 하위는 초기화된다.
//
//  소분류 이름은 가지 간 중복이 있다(예: 공간대관이 B2C·B2B 양쪽에
//  존재). 그래서 계정의 자연키는 소분류명이 아니라 4단 경로 전체다.
// ============================================================

import { useMemo } from "react";
import { Field, Select } from "@/components/neander/ui";
import type { FinAccountDoc } from "@/lib/neander/finance/db-types";
import type { TxType } from "@/lib/neander/finance/types";

export interface AccountValue {
  acctMajor?: string;
  acctMid?: string;
  acctMinor?: string;
}

const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));

export function AccountPicker({
  accounts,
  txType,
  value,
  onChange,
  compact = false,
}: {
  accounts: FinAccountDoc[];
  txType: TxType;
  value: AccountValue;
  onChange: (v: AccountValue) => void;
  compact?: boolean;
}) {
  // 은퇴 계정(active:false)은 후보에서 뺀다 — 단, 지금 이 거래가 이미 그
  // 계정을 들고 있으면 보여준다 (과거 거래를 열었을 때 값이 사라지면 안 된다)
  const pool = useMemo(
    () =>
      accounts.filter(
        (a) =>
          a.txType === txType &&
          (a.active !== false ||
            (a.major === value.acctMajor && a.mid === value.acctMid && a.minor === value.acctMinor)),
      ),
    [accounts, txType, value.acctMajor, value.acctMid, value.acctMinor],
  );
  const majors = useMemo(() => uniq(pool.map((a) => a.major)), [pool]);
  const mids = useMemo(
    () => uniq(pool.filter((a) => a.major === value.acctMajor).map((a) => a.mid)),
    [pool, value.acctMajor],
  );
  const minors = useMemo(
    () =>
      uniq(
        pool
          .filter((a) => a.major === value.acctMajor && a.mid === value.acctMid)
          .map((a) => a.minor),
      ),
    [pool, value.acctMajor, value.acctMid],
  );

  // 선택된 계정의 파생 정보 (회계코드 등) — 사람이 맞게 골랐는지 확인하는 근거
  const picked = pool.find(
    (a) =>
      a.major === value.acctMajor && a.mid === value.acctMid && a.minor === value.acctMinor,
  );

  const size = compact ? "sm" : "md";

  // compact 는 라벨 없이 한 줄 — 접근 가능한 이름은 aria-label 로 준다
  const major = (
    <Select
      size={size}
      aria-label="계정대분류"
      value={value.acctMajor ?? ""}
      onChange={(e) =>
        onChange({ acctMajor: e.target.value || undefined, acctMid: undefined, acctMinor: undefined })
      }
    >
      <option value="">대분류</option>
      {majors.map((m) => (
        <option key={m} value={m}>{m}</option>
      ))}
    </Select>
  );
  const mid = (
    <Select
      size={size}
      aria-label="계정중분류"
      value={value.acctMid ?? ""}
      disabled={!value.acctMajor}
      onChange={(e) =>
        onChange({ ...value, acctMid: e.target.value || undefined, acctMinor: undefined })
      }
    >
      <option value="">중분류</option>
      {mids.map((m) => (
        <option key={m} value={m}>{m}</option>
      ))}
    </Select>
  );
  const minor = (
    <Select
      size={size}
      aria-label="계정소분류"
      value={value.acctMinor ?? ""}
      disabled={!value.acctMid}
      onChange={(e) => onChange({ ...value, acctMinor: e.target.value || undefined })}
    >
      <option value="">소분류</option>
      {minors.map((m) => (
        <option key={m} value={m}>{m}</option>
      ))}
    </Select>
  );

  return (
    <div>
      {compact ? (
        <div className="grid grid-cols-3 gap-2">
          {major}
          {mid}
          {minor}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="계정대분류">{major}</Field>
          <Field label="계정중분류">{mid}</Field>
          <Field label="계정소분류">{minor}</Field>
        </div>
      )}

      {picked && (
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-nd-caption text-nd-fg-3">
          <span>회계코드 <b className="font-medium text-nd-fg-2">{picked.code}</b></span>
          <span>부가세 <b className="font-medium text-nd-fg-2">{picked.vat}</b></span>
          <span>자산 <b className="font-medium text-nd-fg-2">{picked.asset}</b></span>
          <span>지점 <b className="font-medium text-nd-fg-2">{picked.branch}</b></span>
          {picked.example && (
            <span className="w-full text-nd-fg-3">{picked.example}</span>
          )}
        </p>
      )}
    </div>
  );
}
