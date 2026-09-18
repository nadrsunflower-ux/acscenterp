"use client";

// ============================================================
//  수신확인 — 보낸 메일을 받는 사람이 열었는지 (카페24 「수신확인」)
// ------------------------------------------------------------
//  열람은 「추정」이다 (lib/neander/mail/server/track.ts 주석). 이미지를 막는
//  메일 프로그램은 열어도 안 뜨고, 미리 불러오는 곳은 안 열어도 뜰 수 있다.
//  한 사람씩 보내기로 보낸 메일만 받는 사람마다 따로 보인다.
// ============================================================

import { useEffect, useState } from "react";
import { MailCheck } from "lucide-react";
import { EmptyState, ErrorState, InlineNotice, LoadingState, cn } from "@/components/neander/ui";
import { fetchReceipts } from "@/lib/neander/mail/client";
import type { MailReceipt } from "@/lib/neander/mail/types";

const when = (ms?: number) =>
  ms ? new Date(ms).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

export function MailReceipts({ className }: { className?: string }) {
  const [rows, setRows] = useState<MailReceipt[] | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    fetchReceipts()
      .then((r) => setRows(r.receipts))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div className={cn("flex flex-col overflow-hidden", className)}>
      <InlineNotice tone="info" className="m-3 mb-0">
        받는 사람의 메일 프로그램이 이미지를 불러올 때 「열람」으로 셉니다. 이미지를 막으면 열어도 미열람으로, 일부 프로그램은
        안 열어도 열람으로 보일 수 있습니다.
      </InlineNotice>
      <div className="nd-scroll min-h-0 flex-1 overflow-auto p-3">
        {error ? (
          <ErrorState description={error} />
        ) : !rows ? (
          <LoadingState size="block" />
        ) : rows.length === 0 ? (
          <EmptyState icon={MailCheck} title="수신확인할 메일이 없어요" description="수신확인을 켜 두고 보낸 메일이 여기에 쌓입니다 (메일 설정 → 기본)." />
        ) : (
          <table className="w-full text-nd-table">
            <thead>
              <tr className="border-b border-nd-line text-left text-nd-caption text-nd-fg-3">
                <th className="py-2 pr-3 font-medium">보낸 때</th>
                <th className="py-2 pr-3 font-medium">제목</th>
                <th className="py-2 pr-3 font-medium">받는 사람</th>
                <th className="py-2 font-medium">열람</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.trackId} className="border-b border-nd-line last:border-b-0">
                  <td className="whitespace-nowrap py-2 pr-3 text-nd-fg-3">{when(r.sentAt)}</td>
                  <td className="max-w-[280px] truncate py-2 pr-3 text-nd-fg">{r.subject || "(제목 없음)"}</td>
                  <td className="max-w-[200px] truncate py-2 pr-3 text-nd-fg-2">{r.address}</td>
                  <td className="whitespace-nowrap py-2">
                    {r.opens ? (
                      <span className="text-nd-success">
                        열람 {r.opens}회 <span className="text-nd-fg-3">· {when(r.firstOpenAt)}</span>
                      </span>
                    ) : (
                      <span className="text-nd-fg-3">미열람</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
