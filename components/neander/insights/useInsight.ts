"use client";

// ============================================================
//  useInsight — 한 달치 해설을 불러오고, 만들고, 고친다
// ------------------------------------------------------------
//  리포트 화면(InsightPanel)과 발표 슬라이드가 같은 훅을 쓴다 — 화면에서 고친
//  문장이 발표에 그대로 나와야 한다.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import {
  clearInsightDiscussion,
  deleteInsight,
  discussInsight,
  fetchInsight,
  generateInsight,
  saveInsight,
} from "@/lib/neander/insights/client";
import type { AgentMessage, AgentResult } from "@/lib/neander/ai/agent";
import type {
  InsightDoc,
  InsightDraft,
  InsightEditProposal,
  InsightItemRef,
  InsightModule,
  InsightPatch,
} from "@/lib/neander/insights/types";

export interface UseInsight {
  /** 「AI 와 고치기」 한 턴 — 실패하면 던진다 */
  discuss: (
    messages: AgentMessage[],
    draft: InsightDraft,
    /** 문장 하나를 두고 묻는 대화면 그 문장 */
    focus?: InsightItemRef,
  ) => Promise<AgentResult<InsightEditProposal>>;
  clearDiscussion: () => Promise<void>;
  doc: InsightDoc | null;
  loading: boolean;
  /** AI 가 해설을 쓰는 중 (수십 초 걸릴 수 있다) */
  generating: boolean;
  saving: boolean;
  error: string | null;
  generate: (opts?: { model?: string }) => Promise<InsightDoc | null>;
  save: (patch: InsightPatch) => Promise<InsightDoc | null>;
  /** 그 달 해설을 지운다 — 성공하면 true */
  remove: () => Promise<boolean>;
  reload: () => Promise<void>;
}

export function useInsight(module: InsightModule, month: string | undefined, scope?: string): UseInsight {
  const [doc, setDoc] = useState<InsightDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!month) return;
    setLoading(true);
    setError(null);
    try {
      setDoc(await fetchInsight(module, month, scope));
    } catch (e) {
      setError(e instanceof Error ? e.message : "인사이트를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [module, month, scope]);

  useEffect(() => {
    setDoc(null);
    void reload();
  }, [reload]);

  const generate = useCallback(
    async (opts?: { model?: string }) => {
      if (!month) return null;
      setGenerating(true);
      setError(null);
      try {
        const next = await generateInsight(module, month, { scope, model: opts?.model });
        setDoc(next);
        return next;
      } catch (e) {
        setError(e instanceof Error ? e.message : "인사이트를 만들지 못했습니다.");
        return null;
      } finally {
        setGenerating(false);
      }
    },
    [module, month, scope],
  );

  // 대화는 실패를 패널 전체 오류로 올리지 않는다 — 대화 창이 스스로 보여 준다 (그래서 던진다)
  const discuss = useCallback(
    async (messages: AgentMessage[], draft: InsightDraft, focus?: InsightItemRef) => {
      if (!month) throw new Error("달이 정해지지 않았습니다.");
      const { result, discussion } = await discussInsight(module, month, { scope, messages, draft, focus });
      setDoc((d) => (d ? { ...d, discussion } : d));
      return result;
    },
    [module, month, scope],
  );

  const clearDiscussion = useCallback(async () => {
    if (!month) return;
    await clearInsightDiscussion(module, month, scope);
    setDoc((d) => (d ? { ...d, discussion: [] } : d));
  }, [module, month, scope]);

  const remove = useCallback(async () => {
    if (!month) return false;
    setSaving(true);
    setError(null);
    try {
      await deleteInsight(module, month, scope);
      setDoc(null);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "지우지 못했습니다.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [module, month, scope]);

  const save = useCallback(
    async (patch: InsightPatch) => {
      if (!month) return null;
      setSaving(true);
      setError(null);
      try {
        const next = await saveInsight(module, month, patch, scope);
        setDoc(next);
        return next;
      } catch (e) {
        setError(e instanceof Error ? e.message : "저장하지 못했습니다.");
        return null;
      } finally {
        setSaving(false);
      }
    },
    [module, month, scope],
  );

  return { doc, loading, generating, saving, error, generate, save, remove, reload, discuss, clearDiscussion };
}
