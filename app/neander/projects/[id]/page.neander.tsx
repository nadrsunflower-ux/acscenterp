"use client";

// ============================================================
//  프로젝트 워크스페이스 — 상세 (팀원 모두)
// ------------------------------------------------------------
//  일정 · 장비 배정 · 남은 일 · 다음엔 · 메모를 고친다. 저장 버튼 없이 손을 멈추면 저절로 저장한다.
//  보내는 것은 **바뀐 칸만** — 같은 프로젝트를 다른 사람이 재무 화면에서 고치고 있어도 그 칸을 덮지 않는다.
//  금액 · 입금 · 지출 · 이익 · 견적 · 계약 문서 · 「자료」는 재무 › 프로젝트 손익(재무 권한)에만 있다.
//  재무 권한이 없으면 메모의 「■ 원가」 구역이 빠져 보이고, 저장해도 서버가 그 구역을 그대로 둔다.
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Check, Lock, Plus, X } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  IconButton,
  InlineNotice,
  Input,
  LoadingState,
  PageHeader,
  PageShell,
  SectionHeader,
  Textarea,
  type Tone,
  buttonClass,
  cn,
} from "@/components/neander/ui";
import { useCrumbTail } from "@/components/neander/shell/context";
import { RichNoteEditor } from "@/components/neander/finance/RichNoteEditor";
import { DeliveryDate } from "@/components/neander/finance/DeliveryDate";
import { EquipmentConflictList, EquipmentStepper, mdRange } from "@/components/neander/finance/EquipmentFields";
import { equipmentByDay, equipmentConflicts, equipmentRange, hasEquipment } from "@/lib/neander/finance/equipment";
import { calName } from "@/lib/neander/finance/project-calendar";
import { PROJECT_STATUS_LABEL, newTodo, type FinProjectTodo, type ProjectStatus } from "@/lib/neander/finance/project";
import { patchProject } from "@/lib/neander/projects/client";
import { putProject, useProjects } from "@/lib/neander/projects/useProjects";
import type { OpsPatch, ProjectView } from "@/lib/neander/projects/view";

const AUTOSAVE_MS = 800;

const STATUS_TONE: Record<ProjectStatus, Tone> = { planning: "neutral", hold: "neutral", active: "accent", done: "success", cancelled: "danger" };

type OpsForm = Pick<ProjectView, "startDate" | "endDate" | "deliveryDate" | "equipment" | "todos" | "lessons" | "note" | "noteRich">;
const FORM_KEYS = ["startDate", "endDate", "deliveryDate", "equipment", "todos", "lessons", "note", "noteRich"] as const;

const fromView = (p: ProjectView): OpsForm => ({
  startDate: p.startDate,
  endDate: p.endDate,
  deliveryDate: p.deliveryDate,
  equipment: p.equipment,
  todos: p.todos,
  lessons: p.lessons,
  note: p.note,
  noteRich: p.noteRich,
});

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** 저장본과 달라진 칸만 — 메모는 글자 · 서식을 한 쌍으로 */
function diff(form: OpsForm, base: OpsForm): OpsPatch {
  const out: Record<string, unknown> = {};
  for (const k of FORM_KEYS) if (!same(form[k], base[k])) out[k] = form[k];
  if ("note" in out || "noteRich" in out) {
    out.note = form.note;
    out.noteRich = form.noteRich;
  }
  return out as OpsPatch;
}

export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  return <ProjectOps key={id} id={id} />;
}

function ProjectOps({ id }: { id: string }) {
  const { projects, financeAccess, loading, error } = useProjects();
  const saved = useMemo(() => projects.find((p) => p.id === id) ?? null, [projects, id]);
  useCrumbTail(saved?.name);

  /** 고치는 중인 초안 — null 이면 저장본 그대로 */
  const [draft, setDraft] = useState<OpsForm | null>(null);
  const form = draft ?? (saved ? fromView(saved) : null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  /** 실패한 초안과 연달아 실패한 횟수 — 한 번은 조용히 다시 해 보고, 두 번째부터는 「다시 시도」 를 기다린다 */
  const [failed, setFailed] = useState<{ draft: OpsForm; count: number; message: string } | null>(null);
  const inflight = useRef(false);

  const edit = useCallback(
    (fn: (f: OpsForm) => OpsForm) => {
      if (!saved) return;
      setDraft((d) => fn(d ?? fromView(saved)));
    },
    [saved],
  );

  // ---- 자동 저장 — 손을 멈추면 바뀐 칸만 보낸다 ----
  useEffect(() => {
    if (!draft || !saved || inflight.current) return;
    const patch = diff(draft, fromView(saved));
    if (Object.keys(patch).length === 0) {
      setDraft(null);
      return;
    }
    const isRetry = failed?.draft === draft;
    if (isRetry && failed.count >= 2) return;
    const t = window.setTimeout(async () => {
      inflight.current = true;
      setSaving(true);
      const snap = draft;
      try {
        const next = await patchProject(id, patch);
        putProject(next);
        setSavedAt(Date.now());
        setFailed(null);
        // 보낸 뒤 더 고치지 않았으면 저장본을 따라간다 — 다른 사람이 고친 것도 보인다
        setDraft((d) => (d === snap ? null : d));
      } catch (e) {
        const message = e instanceof Error ? e.message : "저장하지 못했습니다.";
        setFailed((f) => ({ draft: snap, count: f?.draft === snap ? f.count + 1 : 1, message }));
      } finally {
        inflight.current = false;
        setSaving(false);
      }
    }, isRetry ? 3000 : AUTOSAVE_MS);
    return () => window.clearTimeout(t);
  }, [draft, saved, id, saving, failed]);

  // 떠날 때 남은 변경을 보낸다
  const leaveRef = useRef<{ draft: OpsForm | null; saved: ProjectView | null }>({ draft: null, saved: null });
  leaveRef.current = { draft, saved };
  useEffect(
    () => () => {
      const { draft: left, saved: base } = leaveRef.current;
      if (!left || !base) return;
      const patch = diff(left, fromView(base));
      if (Object.keys(patch).length) void patchProject(id, patch).then(putProject).catch(() => undefined);
    },
    [id],
  );

  // ---- 장비 겹침 — 고치는 중인 초안으로 다른 프로젝트와 견준다 ----
  const range = form ? equipmentRange(form) : null;
  const conflicts = useMemo(() => {
    if (!form || !saved) return [];
    const list = projects.map((p) => (p.id === id ? { ...p, ...form } : p));
    return equipmentConflicts(equipmentByDay(list)).filter((c) => c.users.some((u) => u.id === id));
  }, [projects, form, saved, id]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState description={error} />;
  if (!saved || !form) {
    return (
      <PageShell className="py-6">
        <EmptyState
          title="프로젝트를 찾을 수 없습니다"
          description="지워졌거나 주소가 틀렸습니다."
          action={
            <Link href="/neander/projects" className={buttonClass("secondary", "md")}>
              <Icon icon={ArrowLeft} size={15} /> 프로젝트 목록
            </Link>
          }
        />
      </PageShell>
    );
  }

  const todos = form.todos ?? [];
  const setTodos = (next: FinProjectTodo[]) => edit((f) => ({ ...f, todos: next.length ? next : undefined }));

  return (
    <PageShell>
      <PageHeader
        title={saved.name}
        titleSuffix={<Badge tone={STATUS_TONE[saved.status]} dot>{PROJECT_STATUS_LABEL[saved.status]}</Badge>}
        description={[saved.code, saved.client].filter(Boolean).join(" · ")}
        className="mb-4"
        actions={
          <div className="flex items-center gap-3">
            <SaveState
              saving={saving}
              savedAt={savedAt}
              failed={failed && failed.count >= 2 ? failed.message : null}
              onRetry={() => setFailed((f) => (f ? { ...f, count: 0 } : f))}
            />
            {financeAccess && (
              <Link href={`/neander/finance/projects/${id}`} className={buttonClass("secondary", "md")}>
                손익 · 수금 <Icon icon={ArrowUpRight} size={15} />
              </Link>
            )}
          </div>
        }
      />

      {/* ---- 일정 ---- */}
      <Card as="section" aria-label="일정" padding="sm" className="mb-5">
        <SectionHeader title="일정" hint="납기 = 설치 첫날(설치일이 없으면 행사 첫날)" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="진행 시작일">
            <Input size="sm" type="date" value={form.startDate ?? ""} onChange={(e) => edit((f) => ({ ...f, startDate: e.target.value || undefined }))} />
          </Field>
          <Field label="진행 종료일">
            <Input size="sm" type="date" value={form.endDate ?? ""} onChange={(e) => edit((f) => ({ ...f, endDate: e.target.value || undefined }))} />
          </Field>
          <Field label="납기">
            <Input size="sm" type="date" value={form.deliveryDate ?? ""} onChange={(e) => edit((f) => ({ ...f, deliveryDate: e.target.value || undefined }))} />
          </Field>
        </div>
        {form.deliveryDate && (
          <p className="mt-3 text-[14px] text-nd-fg-2">
            납기 <DeliveryDate project={{ deliveryDate: form.deliveryDate, status: saved.status }} />
          </p>
        )}
      </Card>

      {/* ---- 장비 배정 ---- */}
      <Card as="section" aria-label="장비 배정" padding="sm" className="mb-5">
        <SectionHeader title="장비 배정" hint="같은 날 다른 프로젝트와 더해 보유 대수를 넘으면 여기와 프로젝트 달력에 알립니다" />
        <EquipmentStepper value={form.equipment} onChange={(equipment) => edit((f) => ({ ...f, equipment }))} />
        <p className="mt-3 text-[13px] text-nd-fg-2">
          {range ? `쓰는 날 ${mdRange(range.from, range.to)} — 설치 첫날(납기)부터 행사 끝날까지로 셉니다.` : "진행 기간 · 납기를 적으면 다른 프로젝트와 겹치는지 셉니다."}
        </p>
        {conflicts.length > 0 ? (
          <EquipmentConflictList className="mt-2" conflicts={conflicts} me={id} name={calName} />
        ) : hasEquipment(form.equipment) && range ? (
          <p className="mt-2 text-[14px] text-nd-success-text">겹쳐서 모자라는 날이 없습니다.</p>
        ) : null}
      </Card>

      {/* ---- 남은 일 · 다음엔 ---- */}
      <Card as="section" aria-label="남은 일 · 다음엔" padding="sm" className="mb-5">
        <SectionHeader title="남은 일 · 다음엔" />
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <h3 className="mb-1.5 text-nd-caption font-medium text-nd-fg-2">남은 일</h3>
            <ul className="mb-2 flex flex-col gap-1.5">
              {todos.map((t) => (
                <li key={t.id} className="flex items-center gap-2">
                  <Checkbox
                    checked={!!t.done}
                    onChange={(e) => setTodos(todos.map((x) => (x.id === t.id ? { ...x, done: e.target.checked || undefined } : x)))}
                    aria-label={`${t.text} 끝냄`}
                  />
                  <Input
                    size="sm"
                    value={t.text}
                    onChange={(e) => setTodos(todos.map((x) => (x.id === t.id ? { ...x, text: e.target.value } : x)))}
                    className={cn(t.done && "text-nd-fg-3 line-through")}
                    aria-label="남은 일"
                  />
                  <IconButton icon={X} label="지우기" size="sm" onClick={() => setTodos(todos.filter((x) => x.id !== t.id))} className="text-nd-fg-3 hover:text-nd-danger-text" />
                </li>
              ))}
            </ul>
            <TodoAdder onAdd={(text) => setTodos([...todos, newTodo(text)])} />
          </div>
          <div>
            <h3 className="mb-1.5 text-nd-caption font-medium text-nd-fg-2">다음엔</h3>
            <Textarea
              size="sm"
              rows={4}
              className="w-full"
              value={form.lessons ?? ""}
              onChange={(e) => edit((f) => ({ ...f, lessons: e.target.value || undefined }))}
              placeholder="이 건에서 배운 것 · 다음 행사에 넘길 것"
            />
          </div>
        </div>
      </Card>

      {/* ---- 메모 ---- */}
      <Card as="section" aria-label="메모" padding="sm" className="mb-5">
        <SectionHeader title="메모" hint="■ 지금 상태 · 행사 · 고객 · 구성 · 견적 · 확인할 것 · 파일 순서로 적습니다" />
        {!!saved.hiddenSections && (
          <InlineNotice icon={Lock} className="mb-3">
            「■ 원가」 구역은 재무 권한이 있는 사람에게만 보입니다. 메모를 고쳐도 그 구역은 그대로 남습니다.
          </InlineNotice>
        )}
        {/* <label>(Field) 로 감싸지 않는다 — label 안의 글자를 누르면 브라우저가 첫 도구 버튼을 대신 누른다 */}
        <RichNoteEditor
          note={form.note}
          rich={form.noteRich}
          onChange={(note, noteRich) => edit((f) => ({ ...f, note, noteRich }))}
          placeholder="지금 상태 · 고객 · 일정 · 확인할 것 …"
        />
      </Card>
    </PageShell>
  );
}

function SaveState({ saving, savedAt, failed, onRetry }: { saving: boolean; savedAt: number | null; failed: string | null; onRetry: () => void }) {
  if (saving) return <span className="text-nd-caption text-nd-fg-3">저장하는 중…</span>;
  if (failed)
    return (
      <span className="flex items-center gap-2 text-nd-caption text-nd-danger-text">
        저장하지 못했습니다 — {failed}
        <Button size="sm" variant="secondary" onClick={onRetry}>
          다시 시도
        </Button>
      </span>
    );
  if (savedAt)
    return (
      <span className="flex items-center gap-1 text-nd-caption text-nd-fg-3">
        <Icon icon={Check} size={14} /> 저장했습니다
      </span>
    );
  return null;
}

function TodoAdder({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = useState("");
  const add = () => {
    const t = text.trim();
    if (!t) return;
    onAdd(t);
    setText("");
  };
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <Input size="sm" value={text} onChange={(e) => setText(e.target.value)} placeholder="예: 회신 받기 · 장비 반납" aria-label="남은 일 더하기" />
      <Button type="submit" variant="secondary" size="sm" icon={Plus} disabled={!text.trim()}>
        추가
      </Button>
    </form>
  );
}
