"use client";

// 영상 폴더 — 이름 적기(새 폴더 · 이름 바꾸기) · 영상을 폴더로 옮기기

import { useMemo, useState } from "react";
import { Button, Dialog, Field, Input, Select } from "@/components/neander/ui";
import { FOLDER_NAME_MAX, folderLabel, type FolderTree } from "@/lib/neander/shorts/folders";

export function FolderNameDialog({
  title,
  description,
  initial = "",
  confirmLabel,
  onClose,
  onSubmit,
}: {
  title: string;
  description?: string;
  initial?: string;
  confirmLabel: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했습니다.");
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button loading={busy} disabled={!name.trim() || busy} onClick={() => void submit()}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="폴더 이름" error={error ?? undefined} hint={`${[...name].length}/${FOLDER_NAME_MAX}자`}>
          <Input value={name} maxLength={FOLDER_NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder="예: 다이소 시리즈" autoFocus />
        </Field>
      </form>
    </Dialog>
  );
}

/** 영상(들)을 고른 폴더로 — 「폴더 밖」 은 빈 값 */
export function MoveVideosDialog({
  tree,
  count,
  current,
  onClose,
  onMove,
}: {
  tree: FolderTree;
  count: number;
  /** 지금 들어 있는 폴더 (하나만 옮길 때) */
  current: string | null;
  onClose: () => void;
  onMove: (folderId: string | null) => Promise<void>;
}) {
  // 나무 순서대로 「살림 › 주방」 처럼 펼친 목록
  const options = useMemo(() => {
    const out: { id: string; label: string }[] = [];
    const walk = (parent: string | null) => {
      for (const f of tree.children.get(parent) ?? []) {
        out.push({ id: f.id, label: folderLabel(tree, f.id) });
        walk(f.id);
      }
    };
    walk(null);
    return out;
  }, [tree]);
  const [target, setTarget] = useState<string>(current ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      title={count > 1 ? `영상 ${count}편 옮기기` : "폴더로 옮기기"}
      description="영상 하나는 폴더 하나에 들어갑니다. 「폴더 밖」 을 고르면 전체 영상에만 보입니다."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button
            loading={busy}
            disabled={busy || (target || null) === current}
            onClick={() => {
              setBusy(true);
              void onMove(target || null).catch(() => setBusy(false));
            }}
          >
            옮기기
          </Button>
        </>
      }
    >
      <Field label="옮길 폴더">
        <Select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">폴더 밖 (전체 영상)</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
    </Dialog>
  );
}
