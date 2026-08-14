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
  const pool = useMemo(
    () => accounts.filter((a) => a.txType === txType),
    [accounts, txType],
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

  const wrap = compact ? "grid grid-cols-3 gap-2" : "grid gap-3 sm:grid-cols-3";

  return (
    <div>
      <div className={wrap}>
        <Field label={compact ? "" : "계정대분류"}>
          <Select
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
        </Field>
        <Field label={compact ? "" : "계정중분류"}>
          <Select
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
        </Field>
        <Field label={compact ? "" : "계정소분류"}>
          <Select
            value={value.acctMinor ?? ""}
            disabled={!value.acctMid}
            onChange={(e) => onChange({ ...value, acctMinor: e.target.value || undefined })}
          >
            <option value="">소분류</option>
            {minors.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </Select>
        </Field>
      </div>

      {picked && (
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
          <span>회계코드 <b className="font-medium text-zinc-700">{picked.code}</b></span>
          <span>부가세 <b className="font-medium text-zinc-700">{picked.vat}</b></span>
          <span>자산 <b className="font-medium text-zinc-700">{picked.asset}</b></span>
          <span>지점 <b className="font-medium text-zinc-700">{picked.branch}</b></span>
          {picked.example && (
            <span className="w-full text-zinc-400">{picked.example}</span>
          )}
        </p>
      )}
    </div>
  );
}
