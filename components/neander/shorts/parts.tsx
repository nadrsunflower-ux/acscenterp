"use client";

// 쇼핑쇼츠 공용 화면 조각 — 출처 표시 · 상태 배지 · 「모름」 이 되는 숫자 칸

import { useCallback, useState } from "react";
import { Badge, NumberInput, type Tone, useToast } from "@/components/neander/ui";
import { PUBLICATION_LABEL, SOURCE_LABEL, STAGE_LABEL } from "@/lib/neander/shorts/model";
import type { JobStatus, Measured, ProjectStage, PublicationStatus } from "@/lib/neander/shorts/types";

const SRC_TONE: Record<Measured["src"], Tone> = { api: "info", manual: "neutral", estimate: "warning", ai: "accent" };

/** 숫자의 출처 — 공식 API · 직접 입력 · 추정 · AI 제안 */
export function SourceTag({ src, title }: { src: Measured["src"]; title?: string }) {
  return (
    <Badge tone={SRC_TONE[src]} size="sm" className="shrink-0" >
      <span title={title}>{SOURCE_LABEL[src]}</span>
    </Badge>
  );
}

export function SampleTag() {
  return (
    <Badge tone="warning" size="sm">
      예시 · 실제 수치 아님
    </Badge>
  );
}

const STAGE_TONE: Record<ProjectStage, Tone> = {
  research: "neutral",
  sourcing: "neutral",
  matching: "info",
  scripting: "info",
  editing: "accent",
  ready: "accent",
  published: "success",
  archived: "neutral",
};
export const StageBadge = ({ stage }: { stage: ProjectStage }) => <Badge tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</Badge>;

export const JOB_LABEL: Record<JobStatus, string> = {
  queued: "대기",
  running: "진행 중",
  waiting: "제공사 처리 대기",
  succeeded: "완료",
  failed: "실패",
  cancelled: "취소됨",
  uncertain: "결과 확인 필요",
  interrupted: "중단됨",
};
const JOB_TONE: Record<JobStatus, Tone> = {
  queued: "neutral",
  running: "accent",
  waiting: "info",
  succeeded: "success",
  failed: "danger",
  cancelled: "neutral",
  uncertain: "warning",
  interrupted: "warning",
};
export const JobBadge = ({ status }: { status: JobStatus }) => <Badge tone={JOB_TONE[status]}>{JOB_LABEL[status]}</Badge>;

const PUB_TONE: Record<PublicationStatus, Tone> = {
  scheduled: "info",
  queued: "neutral",
  uploading: "accent",
  processing: "accent",
  published: "success",
  failed: "danger",
  uncertain: "warning",
  cancelled: "neutral",
};
export const PubBadge = ({ status }: { status: PublicationStatus }) => <Badge tone={PUB_TONE[status]}>{PUBLICATION_LABEL[status]}</Badge>;

export const ConnBadge = ({ ok, on = "설정됨", off = "미연결" }: { ok: boolean; on?: string; off?: string }) => (
  <Badge tone={ok ? "success" : "neutral"}>{ok ? on : off}</Badge>
);

/**
 * 숫자 칸 — 비우면 null(모름 · 비공개). 0 을 치면 0 (확인해 보니 없음).
 * 출처 표시가 옆에 붙는다. 사람이 고치면 출처는 「직접 입력」 이 된다.
 */
export function MeasuredInput({
  value,
  onChange,
  placeholder = "모름",
  disabled,
  ariaLabel,
}: {
  value: Measured;
  onChange: (m: Measured) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <NumberInput
        size="sm"
        value={value.v}
        aria-label={ariaLabel}
        placeholder={placeholder}
        disabled={disabled}
        onValueChange={(raw) => onChange({ v: raw === "" ? null : Math.max(0, Math.round(Number(raw))), src: "manual" })}
      />
      <SourceTag src={value.src} title={value.ref} />
    </div>
  );
}

export const fmtUsd = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`);

export function fmtWhen(ms: number | null | undefined): string {
  if (!ms) return "—";
  const d = new Date(ms + 9 * 3600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** 버튼 하나의 비동기 동작 — 도는 동안 막고, 실패는 토스트로 */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
      setBusy(key);
      try {
        const r = await fn();
        if (ok) toast.success(ok);
        return r;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "처리하지 못했습니다.");
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );
  return { busy, run };
}
