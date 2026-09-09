"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, Eye, EyeOff, Link2, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import {
  subscribeShortcuts,
  addShortcut,
  updateShortcut,
  deleteShortcut,
} from "@/lib/neander/db/shortcuts";
import { emptyToUndef } from "@/lib/neander/db/helpers";
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  Icon,
  IconButton,
  Input,
  PageHeader,
  SegmentedControl,
  Switch,
  cn,
  useConfirm,
  useToast,
  type SegmentOption,
} from "@/components/neander/ui";
import {
  type Shortcut,
  type ShortcutGroup,
  type ShortcutCategory,
  type ShortcutInput,
  SHORTCUT_GROUPS,
  GROUP_CATEGORIES,
  groupHasCategories,
  firstCategoryOf,
  coerceCategory,
  shortcutGroupLabel,
  shortcutCategoryLabel,
  shortcutCategoryColor,
} from "@/lib/neander/types";

// ---- URL 유틸 ----------------------------------------------
/** 스킴이 없으면 https:// 를 붙여 절대 URL 로 정규화 */
function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}
/** 표시용 호스트명 (파싱 실패 시 스킴만 제거한 원본) */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  }
}

// ---- 레거시 보정 -------------------------------------------
const GROUP_VALUES = SHORTCUT_GROUPS.map((g) => g.value);
/** group 미설정·미지값은 '스모트'로 보정 (기존 데이터 호환) */
function normGroup(s: Shortcut): ShortcutGroup {
  return s.group && GROUP_VALUES.includes(s.group) ? s.group : "smoat";
}
/** 그룹 기준으로 category 보정: 유효하면 그대로, 아니면 그룹의 첫 분류. 분류 없는 그룹은 첫 분류 없음. */
function normCat(s: Shortcut): ShortcutCategory {
  const cats = GROUP_CATEGORIES[normGroup(s)];
  if (!cats) return "marketing"; // 와우(분류 없음) — 필터링에 쓰이지 않음
  return cats.find((c) => c.value === s.category)?.value ?? cats[0].value;
}

export default function ShortcutsPage() {
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [activeGroup, setActiveGroup] = useState<ShortcutGroup>("smoat");
  const [activeCat, setActiveCat] = useState<ShortcutCategory>(
    firstCategoryOf("smoat") ?? "smoat",
  );
  // 모달: null=닫힘, "new"=추가, Shortcut=수정
  const [modal, setModal] = useState<null | "new" | Shortcut>(null);

  useEffect(() => subscribeShortcuts(setShortcuts), []);

  // 그룹 전환 시 활성 분류를 새 그룹에 맞게 보정(공유 분류는 유지)
  function selectGroup(g: ShortcutGroup) {
    setActiveGroup(g);
    const c = coerceCategory(g, activeCat);
    if (c) setActiveCat(c);
  }

  // 상위 그룹별 묶음 (생성순 유지)
  const byGroup = useMemo(() => {
    const g: Record<ShortcutGroup, Shortcut[]> = { smoat: [], id: [], wow: [] };
    for (const s of shortcuts) g[normGroup(s)].push(s);
    return g;
  }, [shortcuts]);

  // 현재 그룹의 하위 분류별 개수
  const catCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    const cats = GROUP_CATEGORIES[activeGroup];
    if (cats) {
      for (const c of cats) counts[c.value] = 0;
      for (const s of byGroup[activeGroup]) {
        const k = normCat(s);
        counts[k] = (counts[k] ?? 0) + 1;
      }
    }
    return counts;
  }, [byGroup, activeGroup]);

  // 화면에 보일 목록
  const list = useMemo(() => {
    const items = byGroup[activeGroup];
    if (!groupHasCategories(activeGroup)) return items; // 와우: 분류 없이 전체
    return items.filter((s) => normCat(s) === activeCat);
  }, [byGroup, activeGroup, activeCat]);

  const showSubTabs = groupHasCategories(activeGroup);
  const subCats = GROUP_CATEGORIES[activeGroup] ?? [];
  // 현재 보고 있는 탭 맥락 (빈 상태 문구용)
  const tabCtxLabel = showSubTabs
    ? `${shortcutGroupLabel(activeGroup)} · ${shortcutCategoryLabel(activeCat)}`
    : shortcutGroupLabel(activeGroup);

  // 상위 그룹 / 하위 분류 — 같은 목록의 보기 전환
  const groupOptions: SegmentOption<ShortcutGroup>[] = SHORTCUT_GROUPS.map((g) => {
    const count = byGroup[g.value].length;
    return { value: g.value, label: g.label, hint: count > 0 ? String(count) : undefined };
  });
  const catOptions: SegmentOption<ShortcutCategory>[] = subCats.map((c) => {
    const count = catCounts[c.value] ?? 0;
    return {
      value: c.value,
      label: (
        <span className="inline-flex items-center gap-1.5">
          {/* 분류 색은 데이터 — 점으로만 */}
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
          {c.label}
        </span>
      ),
      hint: count > 0 ? String(count) : undefined,
    };
  });

  return (
    <div>
      <PageHeader
        title="바로가기"
        description="스모트·아이디·와우별로 자주 쓰는 링크를 모아두고 한 번에 이동하세요. 비밀번호가 필요한 링크는 함께 저장해 팀원과 공유할 수 있습니다."
        actions={
          <Button icon={Plus} onClick={() => setModal("new")}>
            바로가기 추가
          </Button>
        }
      />

      {/* 상위 그룹 (스모트 / 아이디 / 와우) */}
      <div className="nd-scroll overflow-x-auto">
        <SegmentedControl options={groupOptions} value={activeGroup} onChange={selectGroup} ariaLabel="그룹" />
      </div>

      {/* 하위 분류 (그룹별) — 와우 제외 */}
      {showSubTabs && (
        <div className="nd-scroll mt-3 overflow-x-auto">
          <SegmentedControl options={catOptions} value={activeCat} onChange={setActiveCat} size="sm" ariaLabel="분류" />
        </div>
      )}

      {/* 목록 */}
      <div className="mt-5">
        {list.length === 0 ? (
          <EmptyState
            icon={Link2}
            title={`${tabCtxLabel}에 등록된 바로가기가 없습니다`}
            description="‘바로가기 추가’ 버튼으로 이 칸에 첫 링크를 추가해보세요."
            action={
              <Button variant="secondary" icon={Plus} onClick={() => setModal("new")}>
                바로가기 추가
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((s) => (
              <ShortcutCard key={s.id} shortcut={s} onEdit={() => setModal(s)} />
            ))}
          </div>
        )}
      </div>

      <ShortcutModal
        key={modal === null ? "closed" : modal === "new" ? "new" : modal.id}
        open={modal !== null}
        initial={modal === null || modal === "new" ? undefined : modal}
        defaultGroup={activeGroup}
        defaultCategory={activeCat}
        onClose={() => setModal(null)}
      />
    </div>
  );
}

// ---- 바로가기 카드 -----------------------------------------
function ShortcutCard({ shortcut, onEdit }: { shortcut: Shortcut; onEdit: () => void }) {
  const confirm = useConfirm();
  const grp = normGroup(shortcut);
  // 아이콘 색: 분류 그룹이면 (보정된) 분류색, 와우면 그룹색 — 데이터가 가진 색
  const grpColor = SHORTCUT_GROUPS.find((g) => g.value === grp)?.color;
  const color = groupHasCategories(grp)
    ? shortcutCategoryColor(normCat(shortcut))
    : grpColor ?? "#71717a";
  const host = hostOf(shortcut.url);
  const initial = shortcut.title.trim().charAt(0).toUpperCase();

  async function remove() {
    const ok = await confirm({
      title: `‘${shortcut.title}’ 바로가기를 삭제할까요?`,
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (!ok) return;
    await deleteShortcut(shortcut.id);
  }

  return (
    <Card padding="sm" className="group flex flex-col gap-2.5 transition-shadow duration-nd-fast hover:shadow-nd-pop">
      <div className="flex items-start gap-3">
        <a
          href={shortcut.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-nd-md outline-none focus-visible:shadow-nd-focus"
        >
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-nd-md text-base font-bold text-white"
            style={{ backgroundColor: color }}
            aria-hidden
          >
            {initial || <Icon icon={Link2} size={16} />}
          </span>
          <span className="min-w-0 flex-1">
            <span
              className="block truncate text-nd-body font-semibold text-nd-fg transition-colors duration-nd-fast group-hover:text-nd-accent-strong"
              title={shortcut.title}
            >
              {shortcut.title}
            </span>
            <span className="mt-0.5 flex items-center gap-1 text-nd-caption text-nd-fg-3">
              <span className="truncate" title={shortcut.url}>
                {host}
              </span>
              <Icon icon={ExternalLink} size={11} className="shrink-0" />
            </span>
          </span>
        </a>
        <div className="flex shrink-0 gap-0.5">
          <IconButton icon={Pencil} label={`${shortcut.title} 수정`} size="sm" onClick={onEdit} />
          <IconButton
            icon={Trash2}
            label={`${shortcut.title} 삭제`}
            size="sm"
            onClick={remove}
            className="hover:text-nd-danger"
          />
        </div>
      </div>

      {shortcut.password && <PasswordRow password={shortcut.password} />}
    </Card>
  );
}

// ---- 비밀번호 행 (가리기/보기 + 복사) ----------------------
function PasswordRow({ password }: { password: string }) {
  const toast = useToast();
  const [revealed, setRevealed] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      toast.success("비밀번호를 복사했습니다");
    } catch {
      // 클립보드 미지원 — 조용히 무시 (보기 토글로 수동 복사 가능)
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-nd-md bg-nd-sunken py-1 pl-3 pr-1">
      <Icon icon={Lock} size={12} className="text-nd-fg-3" />
      <span className="min-w-0 flex-1 truncate font-mono text-nd-caption text-nd-fg-2">
        {revealed ? password : "•".repeat(Math.min(password.length, 12))}
      </span>
      <IconButton
        icon={revealed ? EyeOff : Eye}
        label={revealed ? "비밀번호 가리기" : "비밀번호 보기"}
        size="sm"
        active={revealed}
        onClick={() => setRevealed((v) => !v)}
      />
      <IconButton icon={Copy} label="비밀번호 복사" size="sm" onClick={copy} />
    </div>
  );
}

// ---- 추가/수정 모달 ----------------------------------------
function ShortcutModal({
  open,
  initial,
  defaultGroup,
  defaultCategory,
  onClose,
}: {
  open: boolean;
  initial?: Shortcut;
  defaultGroup: ShortcutGroup;
  defaultCategory: ShortcutCategory;
  onClose: () => void;
}) {
  const toast = useToast();
  const isEdit = Boolean(initial);
  const initGroup = initial ? normGroup(initial) : defaultGroup;
  const [group, setGroup] = useState<ShortcutGroup>(initGroup);
  const [category, setCategory] = useState<ShortcutCategory | undefined>(
    coerceCategory(initGroup, initial?.category ?? defaultCategory),
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [hasPassword, setHasPassword] = useState(Boolean(initial?.password));
  const [password, setPassword] = useState(initial?.password ?? "");
  const [saving, setSaving] = useState(false);

  const useCat = groupHasCategories(group);
  const catDefs = GROUP_CATEGORIES[group] ?? [];

  // 그룹 변경 시 분류를 새 그룹에 맞게 보정(공유 분류는 유지)
  function changeGroup(g: ShortcutGroup) {
    setGroup(g);
    setCategory(coerceCategory(g, category));
  }

  // ESC 닫기·배경 스크롤 잠금·포커스 가두기는 Dialog 가 담당한다.

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return toast.error("제목을 입력하세요.");
    if (!url.trim()) return toast.error("링크를 입력하세요.");

    setSaving(true);
    try {
      const payload: ShortcutInput = {
        group,
        category: useCat ? category ?? firstCategoryOf(group) : undefined,
        title: title.trim(),
        url: normalizeUrl(url),
        password: hasPassword ? emptyToUndef(password) : undefined,
      };
      if (isEdit && initial) {
        await updateShortcut(initial.id, payload);
      } else {
        await addShortcut(payload);
      }
      toast.success(isEdit ? "바로가기를 수정했습니다" : "바로가기를 추가했습니다");
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title={isEdit ? "바로가기 수정" : "바로가기 추가"}
      closeOnOverlay={!saving}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            취소
          </Button>
          <Button type="submit" form="shortcut-form" disabled={saving} loading={saving}>
            {saving ? "저장 중…" : isEdit ? "수정 저장" : "추가하기"}
          </Button>
        </>
      }
    >
      <form id="shortcut-form" onSubmit={submit} className="flex flex-col gap-4">
        {/* 상위 그룹 — 그룹 색은 데이터 */}
        <div className="flex flex-col gap-1.5">
          <span className="text-nd-caption font-medium text-nd-fg-2">그룹</span>
          <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="그룹">
            {SHORTCUT_GROUPS.map((g) => {
              const on = group === g.value;
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  key={g.value}
                  onClick={() => changeGroup(g.value)}
                  className={cn(
                    "h-ctl-md rounded-nd-md border text-nd-body font-semibold transition-colors duration-nd-fast",
                    on ? "text-white" : "border-nd-border bg-nd-content text-nd-fg-2 hover:bg-nd-sunken",
                  )}
                  style={on ? { backgroundColor: g.color, borderColor: g.color } : undefined}
                >
                  {g.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 하위 분류 (그룹별, 와우 제외) — 분류 색은 데이터 */}
        {useCat && (
          <div className="flex flex-col gap-1.5">
            <span className="text-nd-caption font-medium text-nd-fg-2">분류</span>
            <div
              className="grid gap-1.5"
              style={{ gridTemplateColumns: `repeat(${catDefs.length}, minmax(0, 1fr))` }}
              role="radiogroup"
              aria-label="분류"
            >
              {catDefs.map((c) => {
                const on = category === c.value;
                return (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    key={c.value}
                    onClick={() => setCategory(c.value)}
                    className={cn(
                      "h-ctl-md rounded-nd-md border text-[13px] font-semibold transition-colors duration-nd-fast",
                      on ? "text-white" : "border-nd-border bg-nd-content text-nd-fg-2 hover:bg-nd-sunken",
                    )}
                    style={on ? { backgroundColor: c.color, borderColor: c.color } : undefined}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <Field label="제목" required>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 인스타그램 광고 관리자"
            data-autofocus
          />
        </Field>

        <Field label="링크" required hint="https:// 를 생략하면 자동으로 붙습니다.">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="예: business.facebook.com"
            inputMode="url"
          />
        </Field>

        {/* 비밀번호 유무 토글 */}
        <div className="flex flex-col gap-3 rounded-nd-md border border-nd-line p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="flex flex-col text-left">
              <span className="text-nd-body font-medium text-nd-fg">비밀번호</span>
              <span className="text-nd-caption text-nd-fg-3">로그인이 필요한 링크라면 함께 저장</span>
            </span>
            <Switch checked={hasPassword} onChange={setHasPassword} aria-label="비밀번호 저장" />
          </div>
          {hasPassword && (
            <Input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호 입력"
              autoComplete="off"
              aria-label="비밀번호"
            />
          )}
        </div>
      </form>
    </Dialog>
  );
}
