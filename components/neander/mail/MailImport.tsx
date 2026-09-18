"use client";

// ============================================================
//  카페24 웹메일 백업 가져오기
// ------------------------------------------------------------
//  POP3 는 받은메일함만 보인다. 보낸메일함 같은 다른 카페24 메일함은
//  웹메일 → 환경설정 → 메일함 관리 → 백업하기 로 zip 을 받아 여기에 올린다.
//
//  zip 은 브라우저에서 푼다 (JSZip — 이미 재무 가져오기가 쓰는 라이브러리).
//  안에서 .eml 을 찾고, .mbox 는 한 통씩 나누고, 확장자가 없어도 메일 머리글로
//  시작하면 메일로 본다 (백업 형식이 바뀌어도 버티게). 서버에는 몇 통씩 묶어
//  보내고(요청 4.5MB 안), 3MB 넘는 메일은 조각으로 먼저 올린다.
// ============================================================

import { useState } from "react";
import { Archive, CheckCircle2, FolderPlus, Upload } from "lucide-react";
import { Button, Dialog, Field, Icon, InlineNotice, Input, Meter, Select, useToast } from "@/components/neander/ui";
import {
  arrayBufferToBase64,
  createFolder,
  importEmlBatch,
  importEmlBlob,
  uploadBlob,
} from "@/lib/neander/mail/client";
import { BOX_LABEL, MAX_BLOB_BYTES, type MailBox } from "@/lib/neander/mail/types";
import { useMail } from "./MailProvider";

/** 한 번의 요청에 싣는 원문 합계 (base64 로 1/3 늘어 4MB 안) */
const BATCH_BYTES = 2.8 * 1024 * 1024;
const BATCH_COUNT = 25;
/** 이보다 큰 메일은 조각으로 올린다 */
const BIG_BYTES = 2.5 * 1024 * 1024;

const HEADER_RE = /^(Return-Path|Received|From|Date|Message-ID|MIME-Version|Subject|To|Delivered-To|X-[\w-]+):/im;

const latin1 = new TextDecoder("latin1");
const toBytes = (s: string) => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

/** mbox — 빈 줄 뒤 "From " 줄이 한 통의 시작이다. ">From " 은 풀어 준다 */
function splitMbox(bytes: Uint8Array): Uint8Array[] {
  const text = latin1.decode(bytes);
  return text
    .split(/(?:^|\r?\n)From [^\r\n]*\r?\n/)
    .map((m) => m.replace(/^>(>*From )/gm, "$1"))
    .filter((m) => HEADER_RE.test(m.slice(0, 4000)))
    .map(toBytes);
}

async function collectMessages(files: File[]): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  const take = (name: string, bytes: Uint8Array) => {
    const lower = name.toLowerCase();
    if (lower.endsWith(".mbox") || lower.endsWith(".mbx")) out.push(...splitMbox(bytes));
    else if (lower.endsWith(".eml") || HEADER_RE.test(latin1.decode(bytes.subarray(0, 4000)))) out.push(bytes);
  };
  for (const f of files) {
    if (f.name.toLowerCase().endsWith(".zip")) {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(f);
      for (const entry of Object.values(zip.files)) {
        if (entry.dir) continue;
        take(entry.name, await entry.async("uint8array"));
      }
    } else {
      take(f.name, new Uint8Array(await f.arrayBuffer()));
    }
  }
  return out;
}

type Target = MailBox | "__new";

export function MailImport({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (box: MailBox, label: string) => void }) {
  const { account, setAccount, refresh } = useMail();
  const toast = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [target, setTarget] = useState<Target>("sent");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ added: number; duplicate: number; failed: number } | null>(null);
  const [error, setError] = useState<string>();

  const reset = () => {
    setFiles([]);
    setProgress(null);
    setResult(null);
    setError(undefined);
  };

  const run = async () => {
    setBusy(true);
    setError(undefined);
    setResult(null);
    try {
      let box: MailBox;
      let label = targets.find((t) => t.value === target)?.label ?? "메일함";
      if (target === "__new") {
        const name = newName.trim();
        if (!name) throw new Error("새 메일함 이름을 넣어 주세요.");
        const { account: next } = await createFolder(name);
        setAccount(next);
        const made = next.folders.find((f) => f.name === name);
        if (!made) throw new Error("메일함을 만들지 못했습니다.");
        box = made.id;
        label = made.name;
      } else {
        box = target;
      }

      const messages = await collectMessages(files);
      if (!messages.length) throw new Error("파일 안에서 메일(.eml)을 찾지 못했습니다. 카페24 메일함 백업 zip 인지 확인해 주세요.");
      const sum = { added: 0, duplicate: 0, failed: 0 };
      const add = (r: typeof sum) => {
        sum.added += r.added;
        sum.duplicate += r.duplicate;
        sum.failed += r.failed;
      };
      setProgress({ done: 0, total: messages.length });

      let batch: { base64: string }[] = [];
      let batchBytes = 0;
      let done = 0;
      const flush = async () => {
        if (!batch.length) return;
        add(await importEmlBatch(box, batch));
        done += batch.length;
        setProgress({ done, total: messages.length });
        batch = [];
        batchBytes = 0;
      };
      for (const m of messages) {
        if (m.length > MAX_BLOB_BYTES) {
          // 60MB 넘는 한 통은 건너뛴다 (웹메일에서 직접 받아 주세요)
          sum.failed++;
          done++;
          setProgress({ done, total: messages.length });
          continue;
        }
        if (m.length > BIG_BYTES) {
          await flush();
          const blob = await uploadBlob(new Blob([m], { type: "message/rfc822" }), "import.eml");
          add(await importEmlBlob(box, blob.id));
          done++;
          setProgress({ done, total: messages.length });
          continue;
        }
        if (batchBytes + m.length > BATCH_BYTES || batch.length >= BATCH_COUNT) await flush();
        batch.push({ base64: arrayBufferToBase64(m.buffer.slice(m.byteOffset, m.byteOffset + m.byteLength) as ArrayBuffer) });
        batchBytes += m.length;
      }
      await flush();
      setResult(sum);
      void refresh();
      toast.success(`${sum.added}통을 가져왔어요.`, { title: "백업 가져오기" });
      onDone(box, label.replace(/^내 메일함 · /, ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const targets: { value: Target; label: string }[] = [
    { value: "sent", label: BOX_LABEL.sent },
    { value: "inbox", label: BOX_LABEL.inbox },
    { value: "self", label: BOX_LABEL.self },
    { value: "spam", label: BOX_LABEL.spam },
    ...(account?.folders ?? []).map((f) => ({ value: f.id as Target, label: `내 메일함 · ${f.name}` })),
    { value: "__new", label: "새 메일함 만들어 넣기" },
  ];

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (busy) return;
        reset();
        onClose();
      }}
      title="카페24 메일함 가져오기"
      description="POP3 로 보이지 않는 보낸메일함 같은 메일함을 백업 파일로 한 번에 가져옵니다."
      size="md"
      closeOnOverlay={!busy}
      footer={
        result ? (
          <Button
            onClick={() => {
              reset();
              onClose();
            }}
          >
            닫기
          </Button>
        ) : (
          <>
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              취소
            </Button>
            <Button icon={Upload} loading={busy} disabled={!files.length} onClick={() => void run()}>
              가져오기
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-nd-caption leading-relaxed text-nd-fg-2">
          <li>카페24 웹메일에 로그인 → 환경설정 → 메일함 관리</li>
          <li>가져올 메일함(예: 보낸메일함)의 <b className="font-medium">백업하기</b> → zip 받기 (500MB 넘으면 다음 날 메일로 링크가 옵니다)</li>
          <li>받은 zip 을 아래에 올리고, 넣을 메일함을 고릅니다</li>
        </ol>

        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-nd-md border border-dashed border-nd-border px-4 py-6 text-center transition-colors duration-nd-fast hover:bg-nd-sunken">
          <Icon icon={Archive} size={22} className="text-nd-fg-3" />
          <span className="text-nd-body text-nd-fg">
            {files.length ? files.map((f) => f.name).join(", ") : "백업 zip (또는 .eml · .mbox) 고르기"}
          </span>
          <span className="text-nd-caption text-nd-fg-3">여러 개를 한꺼번에 골라도 됩니다</span>
          <input
            type="file"
            multiple
            accept=".zip,.eml,.mbox,.mbx,message/rfc822"
            className="sr-only"
            onChange={(e) => {
              setFiles(Array.from(e.target.files ?? []));
              setResult(null);
              e.target.value = "";
            }}
          />
        </label>

        <Field label="넣을 메일함">
          <Select value={target} onChange={(e) => setTarget(e.target.value as Target)}>
            {targets.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        {target === "__new" && (
          <Field label="새 메일함 이름">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="예: 2025 보낸메일" />
          </Field>
        )}

        {progress && !result && (
          <div className="flex flex-col gap-1.5">
            <Meter value={progress.total ? progress.done / progress.total : 0} />
            <span className="text-nd-caption text-nd-fg-3">
              {progress.done} / {progress.total}통
            </span>
          </div>
        )}
        {result && (
          <InlineNotice tone="success" icon={CheckCircle2}>
            {result.added}통을 가져왔습니다.
            {result.duplicate ? ` 이미 있던 ${result.duplicate}통은 건너뛰었습니다.` : ""}
            {result.failed ? ` 읽지 못한 ${result.failed}통이 있습니다.` : ""}
          </InlineNotice>
        )}
        {error && <InlineNotice tone="danger">{error}</InlineNotice>}
        <p className="flex items-start gap-1.5 text-nd-caption leading-relaxed text-nd-fg-3">
          <Icon icon={FolderPlus} size={13} className="mt-0.5 shrink-0" />
          가져온 메일은 본문까지 보이지만, 첨부는 이름만 남습니다 (원본 파일은 카페24 웹메일에서 받아 주세요). 같은 백업을 다시
          올려도 겹쳐 들어가지 않습니다.
        </p>
      </div>
    </Dialog>
  );
}
