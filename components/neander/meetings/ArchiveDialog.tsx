"use client";

// ============================================================
//  오래된 회의 자료 보관 — 노션으로 옮기고 ERP 저장소를 비운다
// ------------------------------------------------------------
//  옮길 회의를 먼저 보여 주고, 사람이 눌러야 옮긴다. 한 번에 회의 하나씩
//  서버에 부탁한다 (30MB 파일을 올리는 동안 서버 시간을 넘기지 않게).
//  옮기고 나면 ERP 첨부 칸은 「노션에 보관됨」 으로 바뀌고, 누르면 노션에서
//  열린다. 회의록 본문·액션플랜·받아쓴 글은 ERP 에 그대로 남는다.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { Archive, CheckCircle2, ExternalLink, RotateCw, TriangleAlert } from "lucide-react";
import {
  Button,
  Dialog,
  Icon,
  InlineNotice,
  LoadingState,
  Meter,
  Spinner,
  cn,
  useToast,
} from "@/components/neander/ui";
import { getNeanderAuth } from "@/lib/neander/firebase";
import { formatDateKo, formatFileSize } from "@/lib/neander/format";

const BASE = "/api/neander/meetings/archive";

interface Candidate {
  meetingId: string;
  date: string;
  title: string;
  files: number;
  recordings: number;
  bytes: number;
  pageUrl?: string;
}

interface ArchiveInfo {
  enabled: boolean;
  access: { ok: true; title: string } | { ok: false; error: string } | null;
  days: number;
  candidates: Candidate[];
}

async function token(): Promise<string> {
  const user = getNeanderAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  return user.getIdToken();
}

const errText = (e: unknown) => (e instanceof Error ? e.message : "알 수 없는 오류");

export function ArchiveDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [info, setInfo] = useState<ArchiveInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [done, setDone] = useState<{ n: number; bytes: number; last?: string }>({ n: 0, bytes: 0 });
  /** 노션이 받지 않아 ERP 에 그대로 둔 파일 — 사람이 알아야 한다 */
  const [skipped, setSkipped] = useState<{ name: string; reason: string }[]>([]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(BASE, { headers: { Authorization: `Bearer ${await token()}` }, cache: "no-store" });
      const body = (await res.json()) as ArchiveInfo & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `요청이 실패했습니다 (HTTP ${res.status})`);
      setInfo(body);
    } catch (e) {
      setError(errText(e));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setInfo(null);
    setDone({ n: 0, bytes: 0 });
    setSkipped([]);
    void load();
  }, [open, load]);

  async function archiveAll() {
    if (!info) return;
    const left = info.candidates.filter((c) => c.files > 0 || c.recordings > 0);
    for (const c of left) {
      setRunning(c.meetingId);
      try {
        const res = await fetch(BASE, {
          method: "POST",
          headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
          body: JSON.stringify({ meetingId: c.meetingId }),
        });
        const body = (await res.json()) as {
          pageUrl?: string;
          bytes?: number;
          error?: string;
          skipped?: { name: string; reason: string }[];
        };
        if (!res.ok) throw new Error(body.error ?? `요청이 실패했습니다 (HTTP ${res.status})`);
        setDone((d) => ({ n: d.n + 1, bytes: d.bytes + (body.bytes ?? 0), last: body.pageUrl }));
        if (body.skipped?.length) setSkipped((v) => [...v, ...body.skipped!]);
      } catch (e) {
        toast.error(`「${c.title || formatDateKo(c.date)}」 을 옮기지 못했습니다 — ${errText(e)}`);
        break;
      } finally {
        setRunning(null);
      }
    }
    await load();
    onDone();
  }

  const total = info?.candidates.reduce((s, c) => s + c.bytes, 0) ?? 0;
  const movable = info?.candidates.filter((c) => c.files > 0 || c.recordings > 0) ?? [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="오래된 회의 자료 보관"
      description={
        info
          ? `회의 날짜가 ${info.days}일 넘은 회의의 첨부와 녹음 음성을 회사 노션으로 옮기고, ERP 에는 링크만 남깁니다. 회의록 본문·액션플랜·받아쓴 글은 ERP 에 그대로 있습니다.`
          : undefined
      }
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            닫기
          </Button>
          <Button
            icon={Archive}
            disabled={!info?.enabled || movable.length === 0 || running !== null}
            loading={running !== null}
            onClick={() => void archiveAll()}
          >
            {movable.length > 0 ? `${movable.length}건 노션으로 옮기기` : "옮길 자료 없음"}
          </Button>
        </>
      }
    >
      {error ? (
        <InlineNotice
          tone="danger"
          action={
            <Button variant="secondary" size="sm" icon={RotateCw} onClick={() => void load()}>
              다시
            </Button>
          }
        >
          {error}
        </InlineNotice>
      ) : !info ? (
        <LoadingState label="옮길 자료를 세는 중…" />
      ) : (
        <div className="flex flex-col gap-3">
          {/* 설정 상태 */}
          {!info.enabled ? (
            <InlineNotice tone="warning">
              노션 보관이 아직 설정되지 않았습니다. 노션 내부 연결을 만들고 <code>NOTION_ARCHIVE_TOKEN</code> 과 보관함 페이지
              주소 <code>NOTION_ARCHIVE_PAGE</code> 를 넣어야 옮길 수 있습니다.
              <span className="mt-0.5 block text-nd-caption opacity-80">설정 방법은 저장소의 docs/notion-archive.md 에 적어 두었습니다.</span>
            </InlineNotice>
          ) : info.access && !info.access.ok ? (
            <InlineNotice tone="danger">
              노션 보관함에 접근하지 못했습니다 — {info.access.error}
              <span className="mt-0.5 block text-nd-caption opacity-80">
                노션에서 보관함 페이지를 이 연결에 공유했는지 확인해 주세요.
              </span>
            </InlineNotice>
          ) : (
            info.access?.ok && (
              <p className="text-nd-caption text-nd-fg-2">
                보관함: <span className="font-medium text-nd-fg">{info.access.title}</span>
              </p>
            )
          )}

          {done.n > 0 && (
            <InlineNotice
              tone="success"
              icon={CheckCircle2}
              action={
                done.last ? (
                  <Button variant="secondary" size="sm" icon={ExternalLink} onClick={() => window.open(done.last, "_blank", "noopener")}>
                    노션에서 보기
                  </Button>
                ) : undefined
              }
            >
              회의 {done.n}건 · {formatFileSize(done.bytes)} 를 노션으로 옮겼습니다.
            </InlineNotice>
          )}

          {skipped.length > 0 && (
            <InlineNotice tone="warning" icon={TriangleAlert}>
              {skipped.length}개는 옮기지 못해 ERP 에 그대로 두었습니다 —{" "}
              {skipped
                .slice(0, 3)
                .map((s) => `「${s.name}」 ${s.reason}`)
                .join(" · ")}
              {skipped.length > 3 && ` 외 ${skipped.length - 3}개`}
            </InlineNotice>
          )}

          {info.candidates.length === 0 ? (
            <p className="py-8 text-center text-nd-body text-nd-fg-3">
              {info.days}일이 지난 회의 중 옮길 자료가 없습니다. ERP 저장소는 아직 여유가 있습니다.
            </p>
          ) : (
            <>
              <p className="nd-num text-nd-caption text-nd-fg-3">
                옮길 회의 {movable.length}건 · 모두 {formatFileSize(total)}
              </p>
              <ul className="nd-scroll flex max-h-[40vh] flex-col divide-y divide-nd-line overflow-y-auto rounded-nd-md border border-nd-line">
                {info.candidates.map((c) => {
                  const moving = running === c.meetingId;
                  return (
                    <li key={c.meetingId} className={cn("flex items-center gap-3 px-3 py-2.5", moving && "bg-nd-accent-soft/50")}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-nd-body font-medium text-nd-fg">
                          {c.title || "제목 없는 회의"}
                        </span>
                        <span className="nd-num block text-nd-caption text-nd-fg-3">
                          {formatDateKo(c.date)}
                          {c.files > 0 && ` · 첨부 ${c.files}개`}
                          {c.recordings > 0 && ` · 녹음 ${c.recordings}개`}
                          {c.pageUrl && " · 일부는 이미 노션에 있음"}
                        </span>
                      </span>
                      <span className="nd-num shrink-0 text-nd-caption text-nd-fg-2">{formatFileSize(c.bytes)}</span>
                      {moving ? <Spinner size={16} /> : <span className="w-4" />}
                    </li>
                  );
                })}
              </ul>
              {running !== null && (
                <div className="flex items-center gap-2">
                  <Meter value={done.n} max={Math.max(1, movable.length)} width={160} label="보관 진행" />
                  <span className="nd-num text-nd-caption text-nd-fg-2">
                    {done.n}/{movable.length} — 파일이 크면 한 건에 1분쯤 걸립니다
                  </span>
                </div>
              )}
            </>
          )}

          <p className="text-nd-caption text-nd-fg-3">
            <Icon icon={ExternalLink} size={12} className="mr-1 inline" />
            옮긴 뒤에도 ERP 첨부 칸에 이름·크기·올린 사람이 남고, 누르면 노션에서 열립니다. 노션 파일 주소는 만료되므로 누를
            때마다 새로 받아 옵니다.
          </p>
        </div>
      )}
    </Dialog>
  );
}
