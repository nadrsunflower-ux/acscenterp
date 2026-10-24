"use client";

// ============================================================
//  거래 편집 창 아래 「기록」 칸 — 누가 · 무엇으로 · 언제 · 무엇을 바꿨나
// ------------------------------------------------------------
//  변경 이력은 서버가 쓰기마다 남긴다 (finance/tx-log.ts). 여기서는 읽기만.
//  창을 열 때 한 번 받는다 — 편집 창은 짧게 열렸다 닫히는 곳이라 따로 새로 고치지 않는다.
// ============================================================

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { Disclosure, Spinner } from "@/components/neander/ui";
import { useAppData } from "@/components/neander/app-data";
import { fetchTxLog } from "@/lib/neander/finance/client";
import { FIELD_LABEL, logValueText, VIA_LABEL, type TxLogEntry } from "@/lib/neander/finance/tx-log";

const KIND_LABEL: Record<TxLogEntry["kind"], string> = {
  edit: "고침",
  add: "만듦",
  delete: "지움",
  restore: "되돌림",
};

/** 계정 대·중·소는 한 줄로 — 셋이 같이 바뀌는 일이 대부분이다 */
function changeLines(e: TxLogEntry): string[] {
  const ch = e.changes ?? [];
  const acct = ch.filter((c) => c.f === "acctMajor" || c.f === "acctMid" || c.f === "acctMinor");
  const minor = acct.find((c) => c.f === "acctMinor");
  const rest = ch.filter((c) => !acct.includes(c));
  const lines: string[] = [];
  if (minor) lines.push(`계정 ${logValueText("acctMinor", minor.from)} → ${logValueText("acctMinor", minor.to)}`);
  else acct.forEach((c) => lines.push(`${FIELD_LABEL[c.f]} ${logValueText(c.f, c.from)} → ${logValueText(c.f, c.to)}`));
  rest.forEach((c) => lines.push(`${FIELD_LABEL[c.f]} ${logValueText(c.f, c.from)} → ${logValueText(c.f, c.to)}`));
  return lines;
}

export function TxLogSection({ txId, className }: { txId: string; className?: string }) {
  const { members } = useAppData();
  const [entries, setEntries] = useState<TxLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    fetchTxLog(txId)
      .then((list) => !off && setEntries(list))
      .catch((e) => !off && setError(e instanceof Error ? e.message : "기록을 받지 못했습니다."));
    return () => {
      off = true;
    };
  }, [txId]);

  const nameOf = (email: string) => members.find((m) => m.email === email)?.name ?? email;

  return (
    <Disclosure
      icon={History}
      title="기록"
      description={entries ? (entries.length ? `${entries.length}건 — 누가 · 무엇으로 · 언제 바꿨나` : "아직 남은 기록이 없습니다") : "불러오는 중"}
      className={className}
    >
      {error ? (
        <p className="text-nd-body text-nd-danger-text">{error}</p>
      ) : !entries ? (
        <Spinner />
      ) : entries.length === 0 ? (
        <p className="text-nd-body text-nd-fg-3">
          기록은 이 기능이 들어간 뒤의 수정부터 남습니다. 그 전에 고친 것은 마지막 수정 시각만 있습니다.
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => (
            <li key={e.id} className="text-nd-body">
              <p className="text-nd-fg">
                <span className="nd-num text-nd-fg-2">
                  {new Date(e.at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </span>{" "}
                <b className="font-semibold">{nameOf(e.by)}</b> · {KIND_LABEL[e.kind]}
                {e.via && <span className="text-nd-fg-3"> · {VIA_LABEL[e.via] ?? e.via}</span>}
              </p>
              {changeLines(e).map((l) => (
                <p key={l} className="pl-3 text-nd-table text-nd-fg-2">
                  {l}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
    </Disclosure>
  );
}
