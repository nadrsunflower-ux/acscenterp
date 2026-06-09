"use client";

import { useEffect, useState } from "react";
import Section from "@/components/ui/Section";
import Badge, { type BadgeColor } from "@/components/ui/Badge";
import type { Suggestion, SuggestionStatus } from "@/lib/types";
import {
  listSuggestions,
  updateSuggestion,
  setSuggestionResponse,
  deleteSuggestion,
  isFirebaseConfigured,
} from "@/lib/db";
import { suggestionStatusLabel } from "@/lib/content";
import { formatTimestamp, formatKoreanDate, seoulTodayYMD } from "@/lib/date";
import {
  StatusBanner,
  FirebaseNotice,
  MiniButton,
  type StatusMessage,
} from "./adminUi";

// 상태별 뱃지 색
const STATUS_BADGE: Record<SuggestionStatus, BadgeColor> = {
  planned: "blue",
  hold: "orange",
  rejected: "red",
  completed: "green",
};

const STATUS_OPTIONS: { value: SuggestionStatus | ""; label: string }[] = [
  { value: "", label: "미선택" },
  { value: "planned", label: suggestionStatusLabel.planned },
  { value: "hold", label: suggestionStatusLabel.hold },
  { value: "rejected", label: suggestionStatusLabel.rejected },
  { value: "completed", label: suggestionStatusLabel.completed },
];

// 카드별 편집 중인 답변 초안
interface Draft {
  status: SuggestionStatus | "";
  comment: string;
  completedDate: string;
  completedComment: string;
}

function draftFrom(s: Suggestion): Draft {
  return {
    status: s.status ?? "",
    comment: s.adminComment ?? "",
    completedDate: s.completedDate ?? "",
    completedComment: s.completedComment ?? "",
  };
}

export default function SuggestionAdmin() {
  const configured = isFirebaseConfigured();
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  async function refresh() {
    if (!configured) return;
    setLoading(true);
    try {
      const rows = await listSuggestions();
      setItems(rows);
      // 초안을 저장된 값으로 초기화
      const next: Record<string, Draft> = {};
      for (const s of rows) next[s.id] = draftFrom(s);
      setDrafts(next);
    } catch {
      setStatus({ kind: "error", text: "건의 목록을 불러오지 못했습니다." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setDraft(id: string, patch: Partial<Draft>) {
    setDrafts((d) => {
      const base: Draft = d[id] ?? {
        status: "",
        comment: "",
        completedDate: "",
        completedComment: "",
      };
      return { ...d, [id]: { ...base, ...patch } };
    });
  }

  // 상태 변경 — '업데이트 완료' 로 바꾸고 완료일이 비어 있으면 오늘로 채운다.
  function changeStatus(s: Suggestion, draft: Draft, value: SuggestionStatus | "") {
    if (value === "completed" && !draft.completedDate) {
      setDraft(s.id, { status: value, completedDate: seoulTodayYMD() });
    } else {
      setDraft(s.id, { status: value });
    }
  }

  // 확인 체크 토글 — 즉시 저장(낙관적). 확인 시 카드가 회색 처리된다.
  async function toggleConfirmed(s: Suggestion) {
    if (!configured) return;
    const next = !s.confirmed;
    setItems((arr) =>
      arr.map((x) => (x.id === s.id ? { ...x, confirmed: next } : x))
    );
    try {
      await updateSuggestion(s.id, { confirmed: next, handledAt: Date.now() });
    } catch {
      setItems((arr) =>
        arr.map((x) => (x.id === s.id ? { ...x, confirmed: !next } : x))
      );
      setStatus({ kind: "error", text: "확인 상태 저장 중 오류가 발생했습니다." });
    }
  }

  // 상태 + 코멘트 (+ 완료정보) 저장
  async function saveResponse(s: Suggestion) {
    if (!configured) return;
    const draft = drafts[s.id] ?? draftFrom(s);
    const isCompleted = draft.status === "completed";
    setSavingId(s.id);
    setStatus(null);
    try {
      const completedDate = isCompleted ? draft.completedDate || null : null;
      const completedComment = isCompleted
        ? draft.completedComment.trim() || null
        : null;
      await setSuggestionResponse(s.id, {
        status: draft.status || null,
        adminComment: draft.comment.trim(),
        completedDate,
        completedComment,
      });
      setItems((arr) =>
        arr.map((x) =>
          x.id === s.id
            ? {
                ...x,
                status: draft.status || undefined,
                adminComment: draft.comment.trim(),
                completedDate: completedDate ?? undefined,
                completedComment: completedComment ?? undefined,
              }
            : x
        )
      );
      setStatus({ kind: "success", text: "답변을 저장했습니다." });
    } catch {
      setStatus({ kind: "error", text: "저장 중 오류가 발생했습니다." });
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(s: Suggestion) {
    if (!configured) return;
    if (!window.confirm("이 건의를 삭제할까요?")) return;
    try {
      await deleteSuggestion(s.id);
      setStatus({ kind: "success", text: "삭제했습니다." });
      await refresh();
    } catch {
      setStatus({ kind: "error", text: "삭제 중 오류가 발생했습니다." });
    }
  }

  const pendingCount = items.filter((s) => !s.confirmed).length;

  return (
    <Section
      title="건의함"
      subtitle="근무자가 등록한 건의를 확인하고, 처리 상태와 답변을 작성합니다. '확인'을 체크하면 회색으로 처리됩니다."
    >
      {!configured ? <FirebaseNotice /> : null}

      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-700">
          전체 {items.length}건{" "}
          <span className="font-normal text-gray-400">
            (미확인 {pendingCount}건)
          </span>
        </h3>
        <MiniButton onClick={refresh}>새로고침</MiniButton>
      </div>

      <div className="mb-3">
        <StatusBanner message={status} />
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">불러오는 중...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-500">등록된 건의가 없습니다.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((s) => {
            const draft = drafts[s.id] ?? draftFrom(s);
            const isCompleted = draft.status === "completed";
            return (
              <li
                key={s.id}
                className={
                  "rounded-2xl border p-4 transition-colors " +
                  (s.confirmed
                    ? "border-gray-200 bg-gray-100"
                    : "border-gray-100 bg-white shadow-sm ring-1 ring-black/5")
                }
              >
                {/* 헤더: 제목 + 뱃지 + 확인 체크 */}
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={
                          "text-sm font-bold " +
                          (s.confirmed ? "text-gray-500" : "text-gray-900")
                        }
                      >
                        {s.title}
                      </span>
                      {s.status ? (
                        <Badge color={STATUS_BADGE[s.status]}>
                          {suggestionStatusLabel[s.status]}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-400">
                      {s.author} ·{" "}
                      {s.suggestionDate
                        ? `건의일 ${formatKoreanDate(s.suggestionDate)}`
                        : formatTimestamp(s.createdAt)}
                    </div>
                  </div>
                  <label className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-black/5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand"
                      checked={s.confirmed}
                      onChange={() => toggleConfirmed(s)}
                    />
                    확인
                  </label>
                </div>

                {/* 건의 내용 */}
                <p
                  className={
                    "mt-2 whitespace-pre-wrap text-sm " +
                    (s.confirmed ? "text-gray-500" : "text-gray-700")
                  }
                >
                  {s.content}
                </p>

                {/* 관리자 처리: 상태 + 코멘트 + 저장 */}
                <div className="mt-3 grid gap-2 border-t border-gray-200/70 pt-3 sm:grid-cols-[160px_1fr]">
                  <div>
                    <span className="label">처리 상태</span>
                    <select
                      className="input"
                      value={draft.status}
                      onChange={(e) =>
                        changeStatus(
                          s,
                          draft,
                          e.target.value as SuggestionStatus | ""
                        )
                      }
                    >
                      {STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <span className="label">코멘트</span>
                    <textarea
                      className="input min-h-[64px] resize-y"
                      value={draft.comment}
                      onChange={(e) =>
                        setDraft(s.id, { comment: e.target.value })
                      }
                      placeholder="처리에 대한 답변/코멘트를 작성하세요"
                    />
                  </div>
                </div>

                {/* 업데이트 완료 선택 시: 완료 날짜 + 완료 코멘트 (별도) */}
                {isCompleted ? (
                  <div className="mt-2 grid gap-2 rounded-xl bg-emerald-50 p-3 sm:grid-cols-[160px_1fr]">
                    <div>
                      <span className="label">업데이트 완료 날짜</span>
                      <input
                        type="date"
                        className="input"
                        value={draft.completedDate}
                        onChange={(e) =>
                          setDraft(s.id, { completedDate: e.target.value })
                        }
                      />
                    </div>
                    <div>
                      <span className="label">업데이트 완료 코멘트</span>
                      <textarea
                        className="input min-h-[64px] resize-y"
                        value={draft.completedComment}
                        onChange={(e) =>
                          setDraft(s.id, { completedComment: e.target.value })
                        }
                        placeholder="업데이트 완료 내용을 작성하세요"
                      />
                    </div>
                  </div>
                ) : null}

                <div className="mt-2 flex items-center justify-end gap-1.5">
                  <MiniButton tone="brand" onClick={() => saveResponse(s)}>
                    {savingId === s.id ? "저장 중..." : "답변 저장"}
                  </MiniButton>
                  <MiniButton tone="red" onClick={() => handleDelete(s)}>
                    삭제
                  </MiniButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
