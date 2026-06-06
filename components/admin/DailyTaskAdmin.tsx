"use client";

import { useEffect, useMemo, useState } from "react";
import Section from "@/components/ui/Section";
import type { Store, Task, TaskBlock } from "@/lib/types";
import {
  listTaskBlocks,
  createTaskBlock,
  updateTaskBlock,
  deleteTaskBlock,
  listTasks,
  createTask,
  deleteTask,
  isFirebaseConfigured,
} from "@/lib/db";
import {
  seoulTodayYMD,
  formatMonthDay,
  getMonthMatrix,
  formatKoreanMonth,
  weekdayKo,
  parseYMD,
} from "@/lib/date";
import { storeLabel } from "@/lib/content";
import {
  Field,
  StoreSelect,
  StatusBanner,
  FirebaseNotice,
  MiniButton,
  type StatusMessage,
} from "./adminUi";

const STORES: Store[] = ["id", "wow"];
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

export default function DailyTaskAdmin() {
  const configured = isFirebaseConfigured();

  // 업무 블록 라이브러리
  const [blocks, setBlocks] = useState<TaskBlock[]>([]);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [formStore, setFormStore] = useState<Store>("id");
  const [formTitle, setFormTitle] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 모든 일일(daily) 업무 — 캘린더 건수 + 선택 날짜 목록의 소스
  const [allDaily, setAllDaily] = useState<Task[]>([]);

  // 캘린더 / 선택 날짜(복수 선택)
  const today = seoulTodayYMD();
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set([today]));
  const initd = parseYMD(today);
  const [calYear, setCalYear] = useState(initd.getFullYear());
  const [calMonth, setCalMonth] = useState(initd.getMonth() + 1); // 1-base

  const [status, setStatus] = useState<StatusMessage | null>(null);

  async function loadBlocks() {
    if (!configured) return;
    setBlocks(await listTaskBlocks());
  }

  async function loadTasks() {
    if (!configured) return;
    const all = await listTasks();
    setAllDaily(all.filter((t) => t.type === "daily"));
  }

  useEffect(() => {
    loadBlocks();
    loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 선택한 날짜들(정렬)
  const selectedDateList = useMemo(
    () => Array.from(selectedDates).sort(),
    [selectedDates]
  );

  // 날짜별 업무 건수 (캘린더 마커)
  const countByDate = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of allDaily) if (t.date) m[t.date] = (m[t.date] ?? 0) + 1;
    return m;
  }, [allDaily]);

  const weeks = useMemo(
    () => getMonthMatrix(calYear, calMonth),
    [calYear, calMonth]
  );

  function shiftMonth(delta: number) {
    const d = new Date(calYear, calMonth - 1 + delta, 1);
    setCalYear(d.getFullYear());
    setCalMonth(d.getMonth() + 1);
  }

  // 오늘 달로 이동(선택은 유지)
  function goToday() {
    const d = parseYMD(today);
    setCalYear(d.getFullYear());
    setCalMonth(d.getMonth() + 1);
  }

  function toggleDate(ymd: string) {
    setSelectedDates((prev) => {
      const n = new Set(prev);
      if (n.has(ymd)) n.delete(ymd);
      else n.add(ymd);
      return n;
    });
  }

  function clearDates() {
    setSelectedDates(new Set());
  }

  // ---- 블록 라이브러리 CRUD ----
  function resetForm() {
    setEditingBlockId(null);
    setFormStore("id");
    setFormTitle("");
    setFormDesc("");
  }

  async function handleSubmitBlock(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    const title = formTitle.trim();
    const description = formDesc.trim();
    if (!configured) {
      setStatus({ kind: "error", text: "Firebase 미설정으로 저장할 수 없습니다." });
      return;
    }
    if (!title) {
      setStatus({ kind: "error", text: "업무명을 입력하세요." });
      return;
    }
    try {
      if (editingBlockId) {
        await updateTaskBlock(editingBlockId, { store: formStore, title, description });
      } else {
        await createTaskBlock({ store: formStore, title, description });
      }
      resetForm();
      await loadBlocks();
      setStatus({ kind: "success", text: "업무 블록을 저장했습니다." });
    } catch {
      setStatus({ kind: "error", text: "블록 저장 중 오류가 발생했습니다." });
    }
  }

  function handleEditBlock(b: TaskBlock) {
    setEditingBlockId(b.id);
    setFormStore(b.store);
    setFormTitle(b.title);
    setFormDesc(b.description ?? "");
  }

  async function handleDeleteBlock(id: string) {
    if (!window.confirm("이 업무 블록을 삭제할까요? (이미 날짜에 추가된 업무는 그대로 남습니다)"))
      return;
    try {
      await deleteTaskBlock(id);
      if (editingBlockId === id) resetForm();
      setSelected((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
      await loadBlocks();
    } catch {
      setStatus({ kind: "error", text: "블록 삭제 중 오류가 발생했습니다." });
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  // ---- 선택한 블록을 선택한 여러 날짜에 추가 ----
  async function handleAddToDates() {
    setStatus(null);
    if (!configured) {
      setStatus({ kind: "error", text: "Firebase 미설정으로 추가할 수 없습니다." });
      return;
    }
    if (selectedDateList.length === 0) {
      setStatus({ kind: "error", text: "캘린더에서 날짜를 선택하세요." });
      return;
    }
    const picked = blocks.filter((b) => selected.has(b.id));
    if (picked.length === 0) {
      setStatus({ kind: "error", text: "추가할 블록을 선택하세요." });
      return;
    }
    try {
      let added = 0;
      let skipped = 0;
      for (const date of selectedDateList) {
        // 그 날짜에 이미 있는 업무 + 같은 배치에서 방금 추가한 것 둘 다로 중복 판정
        const existing = allDaily.filter((t) => t.date === date);
        const addedKeys = new Set<string>();
        for (const b of picked) {
          const key = `${b.store}_${b.title}`;
          const dup =
            addedKeys.has(key) ||
            existing.some((t) => t.store === b.store && t.title === b.title);
          if (dup) {
            skipped++;
            continue;
          }
          const desc = (b.description ?? "").trim();
          await createTask({
            store: b.store,
            title: b.title,
            type: "daily",
            date,
            ...(desc ? { description: desc } : {}),
          });
          addedKeys.add(key);
          added++;
        }
      }
      await loadTasks();
      setSelected(new Set());
      setStatus({
        kind: "success",
        text: `${selectedDateList.length}개 날짜에 ${added}건 추가${
          skipped ? `, ${skipped}건 중복 건너뜀` : ""
        }.`,
      });
    } catch {
      setStatus({ kind: "error", text: "추가 중 오류가 발생했습니다." });
    }
  }

  async function handleRemoveTask(id: string) {
    try {
      await deleteTask(id);
      await loadTasks();
    } catch {
      setStatus({ kind: "error", text: "삭제 중 오류가 발생했습니다." });
    }
  }

  return (
    <Section
      title="일일 업무"
      subtitle="업무 블록을 만들어 두고, 캘린더에서 날짜를 여러 개 골라 그 날짜들의 대시보드 업무 체크리스트에 한 번에 추가합니다."
    >
      {!configured ? <FirebaseNotice /> : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* ── 좌: 업무 블록 라이브러리 ── */}
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-bold text-gray-900">
              업무 블록 {editingBlockId ? "수정" : ""}
            </h3>
            {editingBlockId ? (
              <MiniButton onClick={resetForm}>새 블록</MiniButton>
            ) : null}
          </div>

          <form onSubmit={handleSubmitBlock} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[120px_1fr]">
              <Field label="매장">
                <StoreSelect value={formStore} onChange={(v) => setFormStore(v as Store)} />
              </Field>
              <Field label="업무명">
                <input
                  className="input"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="예: 오픈 청소, 재고 확인"
                />
              </Field>
            </div>
            <Field label="세부 설명 (선택)">
              <textarea
                className="input min-h-[60px] resize-y"
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                placeholder="업무 수행 방법·체크 포인트 등 자세한 설명"
                rows={2}
              />
            </Field>
            <div className="flex gap-2">
              <button type="submit" className="btn-primary">
                {editingBlockId ? "수정 완료" : "블록 추가"}
              </button>
              {editingBlockId ? (
                <button type="button" className="btn-ghost" onClick={resetForm}>
                  취소
                </button>
              ) : null}
            </div>
          </form>

          <div className="mt-4 space-y-4">
            {STORES.map((store) => {
              const list = blocks.filter((b) => b.store === store);
              return (
                <div key={store}>
                  <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">
                    {storeLabel[store]}
                    <span className="ml-1 font-medium normal-case text-gray-300">
                      {list.length}개
                    </span>
                  </p>
                  {list.length === 0 ? (
                    <p className="rounded-lg bg-gray-50 px-3 py-2.5 text-center text-xs text-gray-400">
                      등록된 블록이 없습니다.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {list.map((b) => {
                        const isSel = selected.has(b.id);
                        return (
                          <li
                            key={b.id}
                            className={
                              "flex items-start gap-2 rounded-xl border px-3 py-2 transition-colors " +
                              (isSel
                                ? "border-brand bg-brand-light/50"
                                : "border-gray-200 bg-white")
                            }
                          >
                            <label className="flex flex-1 cursor-pointer items-start gap-2.5">
                              <input
                                type="checkbox"
                                checked={isSel}
                                onChange={() => toggleSelect(b.id)}
                                className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
                              />
                              <span className="min-w-0">
                                <span className="block text-sm font-medium text-gray-900">
                                  {b.title}
                                </span>
                                {b.description ? (
                                  <span className="mt-0.5 block whitespace-pre-wrap text-xs text-gray-500">
                                    {b.description}
                                  </span>
                                ) : null}
                              </span>
                            </label>
                            <div className="flex shrink-0 gap-1.5">
                              <MiniButton onClick={() => handleEditBlock(b)}>수정</MiniButton>
                              <MiniButton tone="red" onClick={() => handleDeleteBlock(b.id)}>
                                삭제
                              </MiniButton>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── 우: 캘린더에서 날짜(복수) 선택 → 추가 ── */}
        <div className="card p-4">
          <h3 className="mb-3 text-base font-bold text-gray-900">대시보드에 추가</h3>

          {/* 캘린더 */}
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-bold text-gray-900">
              {formatKoreanMonth(calYear, calMonth)}
            </p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={goToday}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-brand-dark hover:bg-brand-light"
              >
                오늘
              </button>
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                aria-label="이전 달"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                aria-label="다음 달"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
              >
                ›
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((wd) => (
              <div
                key={wd}
                className={
                  "pb-1 text-center text-xs font-semibold " +
                  (wd === 0 ? "text-red-500" : wd === 6 ? "text-blue-500" : "text-gray-400")
                }
              >
                {weekdayKo(wd)}
              </div>
            ))}
            {weeks.flat().map((cell) => {
              const isSelected = selectedDates.has(cell.ymd);
              const isToday = cell.ymd === today;
              const count = countByDate[cell.ymd] ?? 0;
              return (
                <button
                  type="button"
                  key={cell.ymd}
                  onClick={() => toggleDate(cell.ymd)}
                  aria-pressed={isSelected}
                  className={
                    "flex min-h-[44px] flex-col items-center rounded-lg border p-1 text-xs transition-colors " +
                    (isSelected
                      ? "border-brand bg-brand-light ring-1 ring-brand"
                      : "border-gray-100 hover:bg-gray-50") +
                    (cell.inMonth ? "" : " opacity-40")
                  }
                >
                  <span
                    className={
                      "flex h-6 w-6 items-center justify-center rounded-full font-semibold " +
                      (isToday ? "bg-brand text-white" : "text-gray-700")
                    }
                  >
                    {cell.day}
                  </span>
                  {count > 0 ? (
                    <span className="mt-0.5 rounded bg-brand/10 px-1 text-[10px] font-bold text-brand-dark">
                      {count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* 선택 요약 + 추가 액션 */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-gray-50 px-3 py-2.5">
            <span className="text-sm text-gray-600">
              <span className="font-semibold text-gray-900">{selectedDates.size}개</span> 날짜 선택됨
              {selectedDates.size > 0 ? (
                <button
                  type="button"
                  onClick={clearDates}
                  className="ml-2 text-xs text-gray-400 underline hover:text-gray-600"
                >
                  선택 해제
                </button>
              ) : null}
            </span>
            <button
              type="button"
              className="btn-primary disabled:opacity-50"
              onClick={handleAddToDates}
              disabled={!configured || selected.size === 0 || selectedDates.size === 0}
            >
              블록 {selected.size}개 → {selectedDates.size}개 날짜 추가
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            캘린더에서 날짜를 여러 개 눌러 선택(다시 누르면 해제)하고, 왼쪽에서 블록을 선택한 뒤
            추가하면 선택한 모든 날짜의 대시보드 업무 체크리스트에 표시됩니다.
          </p>

          {/* 선택한 날짜들의 업무 */}
          <div className="mt-4">
            <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">
              선택한 날짜의 업무
            </p>
            {selectedDateList.length === 0 ? (
              <p className="rounded-lg bg-gray-50 px-3 py-3 text-center text-sm text-gray-400">
                캘린더에서 날짜를 선택하세요.
              </p>
            ) : selectedDateList.every((d) => !allDaily.some((t) => t.date === d)) ? (
              <p className="rounded-lg bg-gray-50 px-3 py-3 text-center text-sm text-gray-400">
                선택한 날짜에 추가된 업무가 없습니다.
              </p>
            ) : (
              <div className="space-y-3">
                {selectedDateList.map((date) => {
                  const dayTasks = allDaily.filter((t) => t.date === date);
                  if (dayTasks.length === 0) return null;
                  return (
                    <div key={date} className="rounded-xl border border-gray-100 p-3">
                      <p className="mb-2 text-sm font-bold text-gray-800">
                        {formatMonthDay(date)}
                      </p>
                      <div className="space-y-2">
                        {STORES.map((store) => {
                          const list = dayTasks.filter((t) => t.store === store);
                          if (list.length === 0) return null;
                          return (
                            <div key={store}>
                              <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-gray-400">
                                {storeLabel[store]}
                              </p>
                              <ul className="space-y-1.5">
                                {list.map((t) => (
                                  <li
                                    key={t.id}
                                    className="flex items-start justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2"
                                  >
                                    <span className="min-w-0">
                                      <span className="block text-sm font-medium text-gray-900">
                                        {t.title}
                                      </span>
                                      {t.description ? (
                                        <span className="mt-0.5 block whitespace-pre-wrap text-xs text-gray-500">
                                          {t.description}
                                        </span>
                                      ) : null}
                                    </span>
                                    <MiniButton tone="red" onClick={() => handleRemoveTask(t.id)}>
                                      제거
                                    </MiniButton>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <StatusBanner message={status} />
      </div>
    </Section>
  );
}
