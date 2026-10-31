"use client";

// 프로젝트 파일 — 목록 · 미리보기 주소 · 올리기 (조각 업로드는 lib/neander/shorts/client.ts)

import { useCallback, useEffect, useState } from "react";
import { Upload } from "lucide-react";
import { DropZone, useToast } from "@/components/neander/ui";
import { listClientMedia, listProjectMedia, loadMedia, uploadMedia } from "@/lib/neander/shorts/client";
import { probeMedia } from "@/lib/neander/shorts/render";
import type { MediaKind, MediaView } from "@/lib/neander/shorts/types";

const lists = new Map<string, MediaView[]>();

export function useProjectMedia(projectId: string) {
  const [media, setMedia] = useState<MediaView[]>(lists.get(projectId) ?? []);
  const [loading, setLoading] = useState(!lists.has(projectId));
  const refresh = useCallback(async () => {
    try {
      const m = await listProjectMedia(projectId);
      lists.set(projectId, m);
      setMedia(m);
    } finally {
      setLoading(false);
    }
  }, [projectId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { media, loading, refresh };
}

/** 고객사 자료 (제품 실사진) */
export function useClientMedia(clientId: string) {
  const [media, setMedia] = useState<MediaView[]>([]);
  const refresh = useCallback(async () => {
    setMedia(await listClientMedia(clientId).catch(() => []));
  }, [clientId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { media, refresh };
}

/** 파일 → 미리보기 주소 (브라우저 사본이 있으면 바로) */
export function useBlobUrl(id: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return setUrl(null);
    let alive = true;
    let made: string | null = null;
    loadMedia(id)
      .then((b) => {
        if (!alive) return;
        made = URL.createObjectURL(b);
        setUrl(made);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "파일을 받지 못했습니다."));
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [id]);
  return { url, error };
}

const ACCEPT: Record<string, string> = {
  source: "video/*",
  ai_scene: "video/*",
  image: "image/*",
  audio: "audio/*",
  recording: "audio/*",
  voice: "audio/*",
};

export function MediaUpload({
  projectId,
  clientId,
  kind,
  title,
  hint,
  multiple = true,
  compact,
  onUploaded,
}: {
  projectId: string;
  /** 고객사 자료로 올릴 때 (projectId 는 "") */
  clientId?: string;
  kind: MediaKind;
  title: string;
  hint?: string;
  multiple?: boolean;
  compact?: boolean;
  onUploaded: (m: MediaView[]) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const take = async (files: File[]) => {
    const done: MediaView[] = [];
    for (const [i, f] of files.entries()) {
      try {
        const probe = f.type.startsWith("video/") || f.type.startsWith("audio/") ? await probeMedia(f) : { duration: null, width: null, height: null };
        if (f.type.startsWith("video/") && probe.duration === null) throw new Error(`「${f.name}」 을(를) 읽지 못했습니다. MP4(H.264) 로 바꿔 올려 주세요.`);
        const m = await uploadMedia(
          f,
          { projectId, clientId, kind, name: f.name, type: f.type || "application/octet-stream", duration: probe.duration, width: probe.width, height: probe.height },
          (p) => setBusy(`${i + 1}/${files.length} · ${Math.round(p * 100)}%`),
        );
        done.push(m);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "올리지 못했습니다.");
      }
    }
    setBusy(null);
    if (done.length) onUploaded(done);
  };
  return (
    <DropZone
      onFiles={(f) => void take(f)}
      accept={ACCEPT[kind]}
      multiple={multiple}
      busy={!!busy}
      compact={compact}
      icon={Upload}
      title={busy ? `올리는 중 ${busy}` : title}
      hint={hint ?? "파일 하나 60MB 까지 · 서버(Firestore 조각)에 저장되고 이 브라우저에 사본이 남습니다"}
    />
  );
}

export const mediaLabel = (m: MediaView) =>
  `${m.name}${m.duration ? ` · ${m.duration.toFixed(1)}초` : ""}${m.width && m.height ? ` · ${m.width}×${m.height}` : ""}`;
