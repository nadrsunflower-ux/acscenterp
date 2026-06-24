"use client";

import { useEffect, useMemo, useState } from "react";
import {
  subscribeShortcuts,
  addShortcut,
  updateShortcut,
  deleteShortcut,
} from "@/lib/neander/db/shortcuts";
import { emptyToUndef } from "@/lib/neander/db/helpers";
import { Button, Field, Input, PageHeader, EmptyState, cn } from "@/components/neander/ui";
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

  return (
    <div>
      <PageHeader
        title="바로가기"
        description="스모트·아이디·와우별로 자주 쓰는 링크를 모아두고 한 번에 이동하세요. 비밀번호가 필요한 링크는 함께 저장해 팀원과 공유할 수 있습니다."
        actions={
          <Button onClick={() => setModal("new")}>
            <span className="text-base leading-none">＋</span> 바로가기 추가
          </Button>
        }
      />

      {/* 상위 그룹 탭 (스모트 / 아이디 / 와우) */}
      <div className="flex gap-1.5 rounded-2xl bg-zinc-100 p-1">
        {SHORTCUT_GROUPS.map((g) => {
          const active = g.value === activeGroup;
          const count = byGroup[g.value].length;
          return (
            <button
              key={g.value}
              type="button"
              onClick={() => selectGroup(g.value)}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition",
                active ? "text-white shadow-sm" : "text-zinc-500 hover:text-zinc-700",
              )}
              style={active ? { backgroundColor: g.color } : undefined}
            >
              {g.label}
              {count > 0 && (
                <span
                  className={cn(
                    "min-w-[20px] rounded-full px-1.5 py-px text-[11px] font-bold leading-tight",
                    active ? "bg-white/25 text-white" : "bg-zinc-200 text-zinc-500",
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 하위 분류 탭 (그룹별) — 와우 제외 */}
      {showSubTabs && (
        <div className="mt-3 flex gap-1 rounded-2xl bg-zinc-100 p-1">
          {subCats.map((c) => {
            const active = c.value === activeCat;
            const count = catCounts[c.value] ?? 0;
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => setActiveCat(c.value)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition",
                  active ? "bg-white shadow-sm" : "text-zinc-500 hover:text-zinc-700",
                )}
                style={active ? { color: c.color } : undefined}
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: active ? c.color : "#d4d4d8" }}
                />
                {c.label}
                {count > 0 && (
                  <span
                    className={cn(
                      "min-w-[18px] rounded-full px-1.5 py-px text-[11px] font-bold leading-tight",
                      !active && "bg-zinc-200 text-zinc-500",
                    )}
                    style={active ? { backgroundColor: `${c.color}1f`, color: c.color } : undefined}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* 목록 */}
      <div className="mt-5">
        {list.length === 0 ? (
          <EmptyState
            icon="🔗"
            title={`${tabCtxLabel}에 등록된 바로가기가 없습니다`}
            description="‘바로가기 추가’ 버튼으로 이 칸에 첫 링크를 추가해보세요."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((s) => (
              <ShortcutCard key={s.id} shortcut={s} onEdit={() => setModal(s)} />
            ))}
          </div>
        )}
      </div>

      {modal && (
        <ShortcutModal
          initial={modal === "new" ? undefined : modal}
          defaultGroup={activeGroup}
          defaultCategory={activeCat}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

// ---- 바로가기 카드 -----------------------------------------
function ShortcutCard({ shortcut, onEdit }: { shortcut: Shortcut; onEdit: () => void }) {
  const grp = normGroup(shortcut);
  // 아이콘 색: 분류 그룹이면 (보정된) 분류색, 와우면 그룹색
  const grpColor = SHORTCUT_GROUPS.find((g) => g.value === grp)?.color;
  const color = groupHasCategories(grp)
    ? shortcutCategoryColor(normCat(shortcut))
    : grpColor ?? "#71717a";
  const host = hostOf(shortcut.url);
  const initial = shortcut.title.trim().charAt(0).toUpperCase() || "🔗";

  async function remove() {
    if (!confirm(`‘${shortcut.title}’ 바로가기를 삭제할까요?`)) return;
    await deleteShortcut(shortcut.id);
  }

  return (
    <div className="group flex flex-col gap-2.5 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-zinc-300 hover:shadow-md">
      <div className="flex items-start gap-3">
        <a
          href={shortcut.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
        >
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-base font-bold text-white"
            style={{ backgroundColor: color }}
            aria-hidden
          >
            {initial}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-zinc-900 group-hover:text-indigo-600">
              {shortcut.title}
            </span>
            <span className="mt-0.5 flex items-center gap-1 text-xs text-zinc-400">
              <span className="truncate">{host}</span>
              <span aria-hidden className="shrink-0">
                ↗
              </span>
            </span>
          </span>
        </a>
        <div className="flex shrink-0 gap-0.5">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-lg px-2 py-1 text-xs font-medium text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
          >
            수정
          </button>
          <button
            type="button"
            onClick={remove}
            className="rounded-lg px-2 py-1 text-xs font-medium text-zinc-300 hover:bg-red-50 hover:text-red-500"
            aria-label="삭제"
          >
            삭제
          </button>
        </div>
      </div>

      {shortcut.password && <PasswordRow password={shortcut.password} />}
    </div>
  );
}

// ---- 비밀번호 행 (가리기/보기 + 복사) ----------------------
function PasswordRow({ password }: { password: string }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 클립보드 미지원 — 조용히 무시 (보기 토글로 수동 복사 가능)
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-xl bg-zinc-50 px-3 py-2">
      <span className="text-xs" aria-hidden>
        🔒
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-600">
        {revealed ? password : "•".repeat(Math.min(password.length, 12))}
      </span>
      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        className="rounded-md px-1.5 py-0.5 text-xs font-medium text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600"
      >
        {revealed ? "가리기" : "보기"}
      </button>
      <button
        type="button"
        onClick={copy}
        className={cn(
          "rounded-md px-1.5 py-0.5 text-xs font-medium",
          copied ? "text-emerald-600" : "text-indigo-500 hover:bg-indigo-50",
        )}
      >
        {copied ? "복사됨" : "복사"}
      </button>
    </div>
  );
}

// ---- 추가/수정 모달 ----------------------------------------
function ShortcutModal({
  initial,
  defaultGroup,
  defaultCategory,
  onClose,
}: {
  initial?: Shortcut;
  defaultGroup: ShortcutGroup;
  defaultCategory: ShortcutCategory;
  onClose: () => void;
}) {
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

  // ESC 로 닫기 + 열려있는 동안 배경 스크롤 잠금
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return alert("제목을 입력하세요.");
    if (!url.trim()) return alert("링크를 입력하세요.");

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
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcut-modal-title"
      onMouseDown={(e) => {
        // 패널 안에서 시작한 드래그(텍스트 선택 등)로는 닫히지 않도록,
        // 배경에서 직접 누른 경우에만 닫는다.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-6 shadow-xl sm:rounded-3xl">
        <h2 id="shortcut-modal-title" className="mb-5 text-lg font-bold text-zinc-900">
          {isEdit ? "바로가기 수정" : "바로가기 추가"}
        </h2>

        <form onSubmit={submit} className="flex flex-col gap-4">
          {/* 상위 그룹 */}
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-700">그룹</span>
            <div className="grid grid-cols-3 gap-1.5">
              {SHORTCUT_GROUPS.map((g) => {
                const on = group === g.value;
                return (
                  <button
                    type="button"
                    key={g.value}
                    onClick={() => changeGroup(g.value)}
                    className={cn(
                      "rounded-lg border py-2 text-sm font-semibold transition",
                      on ? "text-white" : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50",
                    )}
                    style={on ? { backgroundColor: g.color, borderColor: g.color } : undefined}
                  >
                    {g.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 하위 분류 (그룹별, 와우 제외) */}
          {useCat && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-zinc-700">분류</span>
              <div className="grid grid-cols-4 gap-1.5">
                {catDefs.map((c) => {
                  const on = category === c.value;
                  return (
                    <button
                      type="button"
                      key={c.value}
                      onClick={() => setCategory(c.value)}
                      className={cn(
                        "rounded-lg border py-2 text-xs font-semibold transition",
                        on
                          ? "text-white"
                          : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50",
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
              autoFocus
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
          <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-3">
            <button
              type="button"
              role="switch"
              aria-checked={hasPassword}
              onClick={() => setHasPassword((v) => !v)}
              className="flex items-center justify-between"
            >
              <span className="flex flex-col text-left">
                <span className="text-sm font-medium text-zinc-700">비밀번호</span>
                <span className="text-xs text-zinc-400">로그인이 필요한 링크라면 함께 저장</span>
              </span>
              <span
                className={cn(
                  "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                  hasPassword ? "bg-indigo-600" : "bg-zinc-300",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
                    hasPassword ? "left-[22px]" : "left-0.5",
                  )}
                />
              </span>
            </button>
            {hasPassword && (
              <Input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호 입력"
                autoComplete="off"
              />
            )}
          </div>

          <div className="mt-1 flex gap-2">
            <Button type="submit" disabled={saving} className="flex-1">
              {saving ? "저장 중…" : isEdit ? "수정 저장" : "추가하기"}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              취소
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
