"use client";

import { useEffect, useMemo, useState } from "react";
import Section from "@/components/ui/Section";
import Badge, { type BadgeColor } from "@/components/ui/Badge";
import type { Suggestion, SuggestionStatus } from "@/lib/types";
import {
  listSuggestions,
  createSuggestion,
  isFirebaseConfigured,
} from "@/lib/db";
import { suggestionAuthors, suggestionStatusLabel } from "@/lib/content";
import { seoulTodayYMD, formatKoreanDate } from "@/lib/date";

// 상태별 뱃지 색
const STATUS_BADGE: Record<SuggestionStatus, BadgeColor> = {
  planned: "blue",
  hold: "orange",
  rejected: "red",
  completed: "green",
};

// 밀리초 -> 서울 기준 "YYYY-MM-DD"
function seoulYMD(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

// 그룹/표시에 쓰는 기준 일자 — 건의 일자가 있으면 그것을, 없으면(레거시) 등록 시각.
function effectiveYMD(s: Suggestion): string {
  return s.suggestionDate || seoulYMD(s.createdAt);
}

// "2026-06" -> "2026년 6월"
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${y}년 ${parseInt(m, 10)}월`;
}

interface FormState {
  title: string;
  author: string;
  content: string;
  date: string; // 건의 일자
}

function makeEmptyForm(): FormState {
  return { title: "", author: "", content: "", date: seoulTodayYMD() };
}

export default function SuggestionsPage() {
  const configured = isFirebaseConfigured();
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<FormState>(makeEmptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null
  );
  // 우측 목록: 펼쳐진 월(YYYY-MM) 집합 (월별 토글)
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set());

  async function refresh() {
    if (!configured) return;
    setLoading(true);
    try {
      const rows = await listSuggestions();
      setItems(rows);
      // 기본으로 가장 최근 월만 펼침
      if (rows.length) {
        const newest = rows
          .map((s) => effectiveYMD(s).slice(0, 7))
          .sort((a, b) => b.localeCompare(a))[0];
        setOpenMonths(new Set([newest]));
      }
    } catch {
      // 조회 실패는 조용히 무시 (제출 기능은 계속 사용 가능)
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 월별 그룹 (건의 일자 기준, 최신월 먼저 / 월 내부도 최신 일자순)
  const byMonth = useMemo(() => {
    const sorted = [...items].sort((a, b) => {
      const ea = effectiveYMD(a);
      const eb = effectiveYMD(b);
      if (ea !== eb) return eb.localeCompare(ea);
      return b.createdAt - a.createdAt;
    });
    const map = new Map<string, Suggestion[]>();
    for (const s of sorted) {
      const k = effectiveYMD(s).slice(0, 7);
      const arr = map.get(k) ?? [];
      arr.push(s);
      map.set(k, arr);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [items]);

  function toggleMonth(k: string) {
    setOpenMonths((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!configured) {
      setMsg({ kind: "err", text: "Firebase 미설정으로 제출할 수 없습니다." });
      return;
    }
    if (!form.title.trim()) {
      setMsg({ kind: "err", text: "제목을 입력하세요." });
      return;
    }
    if (!form.author) {
      setMsg({ kind: "err", text: "근무자를 선택하세요." });
      return;
    }
    if (!form.date) {
      setMsg({ kind: "err", text: "건의 일자를 선택하세요." });
      return;
    }
    if (!form.content.trim()) {
      setMsg({ kind: "err", text: "건의 내용을 입력하세요." });
      return;
    }
    setSubmitting(true);
    try {
      await createSuggestion({
        title: form.title.trim(),
        author: form.author,
        content: form.content.trim(),
        suggestionDate: form.date,
      });
      setForm(makeEmptyForm());
      setMsg({ kind: "ok", text: "건의가 등록되었습니다. 감사합니다!" });
      await refresh();
    } catch {
      setMsg({ kind: "err", text: "제출 중 오류가 발생했습니다. 다시 시도해 주세요." });
    } finally {
      setSubmitting(false);
    }
  }

  // 건의 1건 카드 (우측 목록용)
  function suggestionCard(s: Suggestion) {
    return (
      <li
        key={s.id}
        className={
          "rounded-xl border p-3 transition-colors " +
          (s.confirmed
            ? "border-gray-200 bg-gray-100 text-gray-500"
            : "border-gray-100 bg-white")
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={
              "text-sm font-bold " +
              (s.confirmed ? "text-gray-500" : "text-gray-900")
            }
          >
            {s.title}
          </span>
          {s.confirmed ? <Badge color="gray">확인됨</Badge> : null}
          {s.status ? (
            <Badge color={STATUS_BADGE[s.status]}>
              {suggestionStatusLabel[s.status]}
            </Badge>
          ) : null}
        </div>
        <div className="mt-0.5 text-xs text-gray-400">
          {s.author} · {formatKoreanDate(effectiveYMD(s))}
        </div>
        <p className="mt-2 whitespace-pre-wrap text-sm">{s.content}</p>
        {s.adminComment ? (
          <div className="mt-3 rounded-lg bg-brand-light/50 px-3 py-2 text-sm text-brand-dark">
            <span className="font-semibold">관리자 답변</span>
            <p className="mt-0.5 whitespace-pre-wrap text-gray-700">
              {s.adminComment}
            </p>
          </div>
        ) : null}
        {s.status === "completed" ? (
          <div className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            <span className="font-semibold">
              업데이트 완료
              {s.completedDate
                ? ` · ${formatKoreanDate(s.completedDate)}`
                : ""}
            </span>
            {s.completedComment ? (
              <p className="mt-0.5 whitespace-pre-wrap text-gray-700">
                {s.completedComment}
              </p>
            ) : null}
          </div>
        ) : null}
      </li>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">건의함</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          매장 운영에 대한 건의를 자유롭게 남겨 주세요. 관리자가 확인 후 처리
          상태와 답변을 등록합니다.
        </p>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        {/* 좌측: 작성 폼 */}
        <Section title="건의 작성">
          {!configured ? (
            <p className="mb-4 rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-700">
              Firebase 환경변수가 설정되지 않아 제출이 동작하지 않습니다.
            </p>
          ) : null}
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3">
            <div>
              <span className="label">제목</span>
              <input
                className="input"
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
                placeholder="건의 제목을 입력하세요"
                maxLength={100}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <span className="label">근무자</span>
                <select
                  className="input"
                  value={form.author}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, author: e.target.value }))
                  }
                >
                  <option value="">근무자를 선택하세요</option>
                  {suggestionAuthors.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <span className="label">건의 일자</span>
                <input
                  type="date"
                  className="input"
                  value={form.date}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, date: e.target.value }))
                  }
                />
              </div>
            </div>
            <div>
              <span className="label">건의 내용</span>
              <textarea
                className="input min-h-[160px] resize-y"
                value={form.content}
                onChange={(e) =>
                  setForm((f) => ({ ...f, content: e.target.value }))
                }
                placeholder="매장 운영에 대한 건의 내용을 작성해 주세요"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="btn-primary disabled:opacity-60"
                disabled={submitting}
              >
                {submitting ? "등록 중..." : "건의 등록"}
              </button>
              {msg ? (
                <span
                  className={
                    "text-sm " +
                    (msg.kind === "ok" ? "text-emerald-600" : "text-red-600")
                  }
                >
                  {msg.text}
                </span>
              ) : null}
            </div>
          </form>
        </Section>

        {/* 우측: 등록된 건의 (월별 토글) */}
        <Section
          title="등록된 건의"
          subtitle="월을 눌러 펼치거나 접을 수 있습니다. 관리자가 확인하면 회색으로 표시됩니다."
        >
          {loading ? (
            <p className="text-sm text-gray-500">불러오는 중...</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-gray-500">아직 등록된 건의가 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {byMonth.map(([ym, list]) => {
                const open = openMonths.has(ym);
                return (
                  <div
                    key={ym}
                    className="overflow-hidden rounded-xl border border-gray-200"
                  >
                    <button
                      type="button"
                      onClick={() => toggleMonth(ym)}
                      aria-expanded={open}
                      className="flex w-full items-center justify-between gap-2 bg-gray-50 px-3 py-2.5 text-left transition-colors hover:bg-gray-100"
                    >
                      <span className="flex items-center gap-2 text-sm font-bold text-gray-800">
                        {monthLabel(ym)}
                        <span className="text-xs font-normal text-gray-400">
                          {list.length}건
                        </span>
                      </span>
                      <span className="text-xs text-gray-400">
                        {open ? "▲" : "▼"}
                      </span>
                    </button>
                    {open ? (
                      <ul className="space-y-2 p-2">
                        {list.map((s) => suggestionCard(s))}
                      </ul>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
