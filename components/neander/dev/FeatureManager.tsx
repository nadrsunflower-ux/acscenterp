"use client";

// ============================================================
//  프로젝트(구 '기능'/에픽) 관리 — /neander/dev/features 본체
//  - FeatureCreatePanel: 좌측 새 프로젝트 생성 폼(로그인 안내 포함)
//  - FeatureCardGrid: 우측 프로젝트 카드 그리드(2~3컬럼)
//    각 카드 = 진행률 바(연결 작업 done/전체) + 상태 배지 + 연결 작업 수,
//    클릭 시 작업 보드 필터 딥링크(/neander/dev/board?feature=ID).
//  색은 FEATURE_COLORS 스와치. 색 미선택 시 featureColorFor 자동 배정.
//  작성/수정은 currentMember 있을 때만. DB 필드/식별자(feature*)는 그대로.
// ============================================================

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Blocks, ChevronLeft, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useDevData } from "@/components/neander/dev/dev-data";
import { addFeature, updateFeature, deleteFeature } from "@/lib/neander/dev/features";
import { FeatureChip } from "@/components/neander/dev/atoms";
import {
  Button,
  Card,
  Field,
  IconButton,
  Input,
  SectionHeader,
  Select,
  Textarea,
  Badge,
  EmptyState,
  cn,
  useConfirm,
  type Tone,
} from "@/components/neander/ui";
import {
  FEATURE_COLORS,
  FEATURE_STATUSES,
  featureStatusLabel,
  featureColorFor,
  type DevFeature,
  type DevFeatureInput,
  type FeatureStatus,
} from "@/lib/neander/dev/types";
import type { Member } from "@/lib/neander/types";

/** 프로젝트 상태 → 의미 톤 (진행중 info · 출시됨 success · 보류 warning) */
export const FEATURE_STATUS_TONE: Record<FeatureStatus, Tone> = {
  active: "info",
  shipped: "success",
  paused: "warning",
};

// ---- 색 스와치 (FEATURE_COLORS 8색 + 자동) ------------------
function ColorSwatches({
  value,
  onChange,
}: {
  /** 선택된 색(hex) 또는 undefined(자동 배정) */
  value?: string;
  onChange: (color?: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => onChange(undefined)}
        aria-label="색 자동 배정"
        aria-pressed={!value}
        title="자동"
        className={cn(
          "flex h-6 items-center rounded-full border px-2 text-nd-micro transition-colors duration-nd-fast",
          !value
            ? "border-nd-accent bg-nd-accent-soft text-nd-accent-strong shadow-nd-focus"
            : "border-nd-border bg-nd-content text-nd-fg-2 hover:bg-nd-sunken",
        )}
      >
        자동
      </button>
      {FEATURE_COLORS.map((c) => {
        const active = value === c;
        return (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            aria-label={`색 ${c}`}
            aria-pressed={active}
            title={c}
            className={cn(
              "h-6 w-6 rounded-full transition-transform duration-nd-fast",
              active ? "ring-2 ring-nd-fg-3 ring-offset-1 ring-offset-nd-content" : "hover:scale-110",
            )}
            style={{ backgroundColor: c }}
          />
        );
      })}
    </div>
  );
}

// ---- 신규 생성 폼 ------------------------------------------
function AddFeatureForm({ nextOrder, onDone }: { nextOrder: number; onDone?: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<FeatureStatus>("active");
  const [busy, setBusy] = useState(false);

  const canSubmit = name.trim().length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const input: DevFeatureInput = {
        name: name.trim(),
        status,
        order: nextOrder,
      };
      const desc = description.trim();
      if (desc) input.description = desc;
      if (color) input.color = color;
      await addFeature(input);
      setName("");
      setDescription("");
      setColor(undefined);
      setStatus("active");
      onDone?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="self-start">
      <SectionHeader title="새 프로젝트" />
      <div className="flex flex-col gap-3">
        <Field label="이름" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              // 한글 IME 조합 확정 키다운(isComposing/229)에서 제출 방지
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="예: 결제 연동, 온보딩 개선"
          />
        </Field>

        <Field label="상태">
          <Select value={status} onChange={(e) => setStatus(e.target.value as FeatureStatus)}>
            {FEATURE_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="색" hint="미선택 시 자동으로 배정됩니다.">
          <ColorSwatches value={color} onChange={setColor} />
        </Field>

        <Field label="설명">
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="이 프로젝트가 무엇인지 한두 줄로 (선택)"
          />
        </Field>

        <div className="flex items-center justify-between gap-3">
          <FeatureChip
            feature={{ id: "preview", color, name: name.trim() || "미리보기" }}
          />
          <Button onClick={submit} disabled={!canSubmit} loading={busy}>
            {busy ? "추가 중…" : "프로젝트 추가"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ---- 좌측 패널: 생성 폼 or 로그인 안내 ----------------------
export function FeatureCreatePanel({
  features,
  currentMember,
}: {
  features: DevFeature[];
  currentMember: Member | null;
}) {
  const nextOrder =
    features.length === 0 ? 0 : Math.max(...features.map((f) => f.order)) + 1;

  if (!currentMember) {
    return (
      <Card className="self-start">
        <p className="text-nd-body text-nd-fg-2">
          프로젝트를 추가·수정하려면{" "}
          <span className="font-medium text-nd-fg">팀원 계정</span>으로 로그인하세요.
        </p>
      </Card>
    );
  }
  return <AddFeatureForm nextOrder={nextOrder} />;
}

// ---- 개별 프로젝트 카드 -------------------------------------
function FeatureCard({
  feature,
  done,
  total,
  canEdit,
  isFirst,
  isLast,
  onMove,
}: {
  feature: DevFeature;
  /** 연결 작업 중 완료 수 */
  done: number;
  /** 연결 작업 전체 수 */
  total: number;
  canEdit: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMove: (dir: -1 | 1) => void;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(feature.name);
  const [description, setDescription] = useState(feature.description ?? "");
  const [color, setColor] = useState<string | undefined>(feature.color);
  const [status, setStatus] = useState<FeatureStatus>(feature.status);
  const [busy, setBusy] = useState(false);

  const boardHref = `/neander/dev/board?feature=${feature.id}`;
  const barColor = featureColorFor(feature);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  function startEdit() {
    setName(feature.name);
    setDescription(feature.description ?? "");
    setColor(feature.color);
    setStatus(feature.status);
    setEditing(true);
  }

  async function save() {
    if (name.trim().length === 0 || busy) return;
    setBusy(true);
    try {
      await updateFeature(feature.id, {
        name: name.trim(),
        status,
        description: description.trim() || undefined,
        color: color || undefined,
      });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    const ok = await confirm({
      title: `"${feature.name}" 프로젝트를 삭제할까요?`,
      message: total > 0 ? `연결된 작업 ${total}개의 프로젝트 표시가 사라집니다(작업은 유지).` : undefined,
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteFeature(feature.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    // 카드 전체 클릭 → 보드 필터 딥링크. 키보드/스크린리더 경로는 하단 실제 Link.
    <div
      onClick={() => {
        if (!editing && !busy) router.push(boardHref);
      }}
      className={cn("h-full", !editing && "cursor-pointer")}
    >
      <Card
        padding="sm"
        className={cn("flex h-full flex-col gap-3 transition-shadow duration-nd-fast", !editing && "hover:shadow-nd-pop")}
      >
        {/* 상단: 칩 + 상태 배지 + 관리 버튼 */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <FeatureChip feature={feature} />
            <Badge tone={FEATURE_STATUS_TONE[feature.status]} dot>
              {featureStatusLabel(feature.status)}
            </Badge>
          </div>
          {canEdit && !editing && (
            <div
              className="flex shrink-0 items-center gap-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              <IconButton icon={ChevronLeft} label="앞으로 이동" size="sm" onClick={() => onMove(-1)} disabled={isFirst || busy} className="disabled:opacity-30" />
              <IconButton icon={ChevronRight} label="뒤로 이동" size="sm" onClick={() => onMove(1)} disabled={isLast || busy} className="disabled:opacity-30" />
              <IconButton icon={Pencil} label={`${feature.name} 수정`} size="sm" onClick={startEdit} />
              <IconButton
                icon={Trash2}
                label={`${feature.name} 삭제`}
                size="sm"
                onClick={remove}
                disabled={busy}
                className="hover:text-nd-danger"
              />
            </div>
          )}
        </div>

        {feature.description && !editing && (
          <p className="line-clamp-2 whitespace-pre-wrap text-nd-body text-nd-fg-2" title={feature.description}>
            {feature.description}
          </p>
        )}

        {/* 진행률 — 연결 작업 done/전체 (카드 하단 고정) */}
        {!editing && (
          <div className="mt-auto flex flex-col gap-1.5 pt-1">
            <div className="flex items-center justify-between gap-2 text-nd-caption">
              <span className="nd-num text-nd-fg-3">
                연결 작업 {total}개 · 완료 {done}개
              </span>
              <span className="nd-num font-semibold text-nd-fg-2">
                {total > 0 ? `${pct}%` : "—"}
              </span>
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-nd-fg/[.07]"
              role="progressbar"
              aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
              aria-label={`${feature.name} 진행률 ${done}/${total}`}
            >
              <div
                className="h-full rounded-full transition-all duration-nd"
                style={{ width: `${pct}%`, backgroundColor: barColor }}
              />
            </div>
            <Link
              href={boardHref}
              onClick={(e) => e.stopPropagation()}
              className="mt-0.5 inline-flex items-center gap-1 self-start text-nd-caption font-medium text-nd-accent-strong hover:underline"
            >
              보드에서 작업 보기
              <ArrowRight size={12} aria-hidden />
            </Link>
          </div>
        )}

        {/* 인라인 수정 패널 */}
        {editing && (
          <div
            className="flex flex-col gap-3 border-t border-nd-line pt-3"
            onClick={(e) => e.stopPropagation()}
          >
            <Field label="이름" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="프로젝트 이름"
              />
            </Field>
            <Field label="상태">
              <Select
                value={status}
                onChange={(e) => setStatus(e.target.value as FeatureStatus)}
              >
                {FEATURE_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="색">
              <ColorSwatches value={color} onChange={setColor} />
            </Field>
            <Field label="설명">
              <Textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="이 프로젝트가 무엇인지 (선택)"
              />
            </Field>
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setEditing(false)} disabled={busy}>
                취소
              </Button>
              <Button size="sm" onClick={save} disabled={busy || name.trim().length === 0} loading={busy}>
                {busy ? "저장 중…" : "저장"}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---- 우측 패널: 프로젝트 카드 그리드 ------------------------
export function FeatureCardGrid({
  features,
  currentMember,
}: {
  features: DevFeature[];
  currentMember: Member | null;
}) {
  const { tasks } = useDevData();
  const canEdit = !!currentMember;

  const sorted = useMemo(
    () => [...features].sort((a, b) => a.order - b.order),
    [features],
  );

  // featureId → 연결 작업 done/전체 집계
  const statByFeature = useMemo(() => {
    const m = new Map<string, { done: number; total: number }>();
    for (const t of tasks) {
      if (!t.featureId) continue;
      const s = m.get(t.featureId) ?? { done: 0, total: 0 };
      s.total += 1;
      if (t.status === "done") s.done += 1;
      m.set(t.featureId, s);
    }
    return m;
  }, [tasks]);

  // 정규화 리오더 — 이동 시 전체 순서를 0..n-1 로 재부여.
  // 단순 값 교환은 order 동률/중복이 있을 때 의도한 위치를 잃으므로,
  // 매 이동마다 배열을 재배열하고 order 를 인덱스로 정규화해 동률을 해소한다.
  async function move(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= sorted.length) return;
    const arr = [...sorted];
    const [moved] = arr.splice(index, 1);
    arr.splice(j, 0, moved);
    await Promise.all(
      arr
        .map((f, i) => (f.order !== i ? updateFeature(f.id, { order: i }) : null))
        .filter((p): p is Promise<void> => p !== null),
    );
  }

  if (sorted.length === 0) {
    return (
      <EmptyState
        icon={Blocks}
        title="아직 프로젝트가 없어요"
        description={
          canEdit
            ? "프로젝트는 작업을 묶는 단위예요. 예: 결제 연동, 온보딩 개선. 왼쪽 폼에서 첫 프로젝트를 만들어 보세요."
            : "프로젝트는 작업을 묶는 단위예요. 예: 결제 연동, 온보딩 개선. 팀원이 프로젝트를 등록하면 여기에 표시됩니다."
        }
      />
    );
  }

  return (
    <div className="grid content-start gap-3 sm:grid-cols-2 2xl:grid-cols-3">
      {sorted.map((f, i) => {
        const stat = statByFeature.get(f.id) ?? { done: 0, total: 0 };
        return (
          <FeatureCard
            key={f.id}
            feature={f}
            done={stat.done}
            total={stat.total}
            canEdit={canEdit}
            isFirst={i === 0}
            isLast={i === sorted.length - 1}
            onMove={(dir) => move(i, dir)}
          />
        );
      })}
    </div>
  );
}
