"use client";

import { Copy } from "lucide-react";
import { Button, ErrorState, useToast } from "@/components/neander/ui";
import { describeFinanceError } from "@/lib/neander/finance/errors";
import { useFinance } from "./FinanceProvider";

/**
 * 재무 영역 상단 오류 배너.
 * 규칙 미게시처럼 "화면은 멀쩡한데 데이터만 안 오는" 상황을 드러낸다.
 */
export function ErrorBanner() {
  const { error } = useFinance();
  const toast = useToast();
  if (!error) return null;

  const { title, detail, command } = describeFinanceError(error);

  return (
    <ErrorState
      className="mb-5"
      title={title}
      description={
        <>
          <p>{detail}</p>
          {command && (
            <code className="mt-2 inline-block rounded-[8px] bg-nd-content px-2 py-1 font-mono text-nd-table text-nd-fg ring-1 ring-nd-danger/25">
              {command}
            </code>
          )}
        </>
      }
      action={
        command ? (
          <Button
            variant="secondary"
            size="sm"
            icon={Copy}
            onClick={() => {
              navigator.clipboard?.writeText(command);
              toast.success("명령을 복사했습니다");
            }}
          >
            복사
          </Button>
        ) : undefined
      }
    />
  );
}
