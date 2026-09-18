"use client";

// ============================================================
//  받는 사람 입력 · 주소록
// ------------------------------------------------------------
//  입력칸은 주소를 조각(칩)으로 모은다. 쉼표·Enter·Tab 으로 끊고, 붙여 넣은
//  여러 주소도 한 번에 나눈다. 치는 동안 주소록(자주·최근 보낸 주소 + ERP 에
//  메일을 연결한 동료)에서 맞는 것을 보여 준다.
//
//  주소록 창은 카페24 쓰기 화면의 「최근 사용 주소 · 자주 쓰는 주소 · 주소록」을
//  한 창에 모았다. 고른 주소를 받는 사람·참조·숨은참조로 넣는다.
// ============================================================

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Clock, Star, Trash2, UserPlus, Users, X } from "lucide-react";
import {
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  FormRow,
  FieldAction,
  Field,
  Input,
  SearchInput,
  SegmentedControl,
  cn,
  useToast,
} from "@/components/neander/ui";
import { addContact, formatAddr, isEmail, parseAddrInput, removeContact } from "@/lib/neander/mail/client";
import type { MailAddr, MailContact } from "@/lib/neander/mail/types";
import { useMail } from "./MailProvider";

interface Suggestion extends MailAddr {
  team?: boolean;
  count: number;
  last: number;
}

function useSuggestions(): Suggestion[] {
  const { contacts } = useMail();
  return useMemo(() => {
    const map = new Map<string, Suggestion>();
    for (const t of contacts?.team ?? []) map.set(t.address.toLowerCase(), { ...t, team: true, count: 0, last: 0 });
    for (const c of contacts?.mine ?? []) {
      const k = c.address.toLowerCase();
      const prev = map.get(k);
      map.set(k, { name: c.name ?? prev?.name, address: c.address, team: prev?.team, count: c.count, last: c.last });
    }
    return [...map.values()];
  }, [contacts]);
}

const addrKey = (a: MailAddr) => a.address.trim().toLowerCase();

export function RecipientInput({
  value,
  onChange,
  ariaLabel,
  placeholder,
  autoFocus,
  inputRef,
}: {
  value: MailAddr[];
  onChange: (v: MailAddr[]) => void;
  ariaLabel: string;
  placeholder?: string;
  autoFocus?: boolean;
  inputRef?: React.RefObject<HTMLInputElement>;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const ownRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? ownRef;
  const all = useSuggestions();

  const q = text.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return [];
    const taken = new Set(value.map(addrKey));
    return all
      .filter((s) => !taken.has(addrKey(s)))
      .filter((s) => s.address.toLowerCase().includes(q) || (s.name ?? "").toLowerCase().includes(q))
      .sort((a, b) => Number(!!b.team) - Number(!!a.team) || b.count - a.count || b.last - a.last)
      .slice(0, 8);
  }, [all, q, value]);

  const add = (list: MailAddr[]) => {
    const taken = new Set(value.map(addrKey));
    const fresh = list.filter((a) => a.address && !taken.has(addrKey(a)) && (taken.add(addrKey(a)), true));
    if (fresh.length) onChange([...value, ...fresh]);
  };

  const commit = () => {
    if (!text.trim()) return;
    add(parseAddrInput(text));
    setText("");
    setOpen(false);
  };

  const pick = (s: MailAddr) => {
    add([{ name: s.name, address: s.address }]);
    setText("");
    setOpen(false);
    ref.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (open && matches.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setCursor((c) => (c + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
      return;
    }
    if (e.key === "Enter" || e.key === "," || e.key === ";" || (e.key === "Tab" && text.trim())) {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) return; // ⌘Enter 는 보내기
      e.preventDefault();
      if (open && matches[cursor]) pick(matches[cursor]);
      else commit();
      return;
    }
    if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <div
        className="flex min-h-ctl-md w-full cursor-text flex-wrap items-center gap-1 rounded-nd-md border border-nd-border bg-nd-content px-1.5 py-1 transition-colors duration-nd-fast focus-within:border-nd-accent"
        onClick={() => ref.current?.focus()}
      >
        {value.map((a, i) => {
          const ok = isEmail(a.address);
          return (
            <span
              key={`${a.address}-${i}`}
              title={formatAddr(a)}
              className={cn(
                "inline-flex max-w-full items-center gap-1 rounded-full py-0.5 pl-2.5 pr-1 text-[13px]",
                ok ? "bg-nd-accent-soft text-nd-accent-strong" : "bg-nd-danger-soft text-nd-danger-text",
              )}
            >
              <span className="truncate">{a.name || a.address}</span>
              <button
                type="button"
                aria-label={`${a.name || a.address} 빼기`}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(value.filter((_, j) => j !== i));
                }}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-nd-fg/10"
              >
                <X size={11} />
              </button>
            </span>
          );
        })}
        <input
          ref={ref}
          aria-label={ariaLabel}
          autoFocus={autoFocus}
          value={text}
          placeholder={value.length ? "" : placeholder}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setCursor(0);
          }}
          onKeyDown={onKey}
          onPaste={(e) => {
            const t = e.clipboardData.getData("text");
            if (/[,;\n]/.test(t)) {
              e.preventDefault();
              add(parseAddrInput(t));
            }
          }}
          onBlur={() => setTimeout(commit, 120)}
          className="h-7 min-w-[140px] flex-1 bg-transparent px-1 text-nd-body text-nd-fg outline-none placeholder:text-nd-fg-3"
        />
      </div>
      {open && matches.length > 0 && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-nd-popover-over mt-1 max-h-64 overflow-y-auto rounded-nd-md border border-nd-border bg-nd-content py-1 shadow-nd-pop"
        >
          {matches.map((s, i) => (
            <li key={s.address} role="option" aria-selected={i === cursor}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-nd-body",
                  i === cursor ? "bg-nd-accent-soft" : "hover:bg-nd-sunken",
                )}
              >
                <span className="truncate text-nd-fg">{s.name || s.address}</span>
                {s.name && <span className="truncate text-nd-caption text-nd-fg-3">{s.address}</span>}
                {s.team && <span className="ml-auto shrink-0 text-nd-micro text-nd-accent-strong">팀</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- 주소록 창 ------------------------------------------------

type Tab = "recent" | "frequent" | "book";
type Target = "to" | "cc" | "bcc";

export function AddressBook({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (target: Target, list: MailAddr[]) => void;
}) {
  const { contacts, setContacts } = useMail();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("recent");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Record<string, MailAddr>>({});
  const [newName, setNewName] = useState("");
  const [newAddr, setNewAddr] = useState("");
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    const mine = contacts?.mine ?? [];
    let list: (MailContact & { team?: boolean })[];
    if (tab === "recent") list = mine.filter((c) => c.last > 0).sort((a, b) => b.last - a.last).slice(0, 50);
    else if (tab === "frequent") list = mine.filter((c) => c.count > 0).sort((a, b) => b.count - a.count).slice(0, 50);
    else
      list = [
        ...(contacts?.team ?? []).map((t) => ({ ...t, count: 0, last: 0, team: true })),
        ...mine.filter((c) => c.manual),
      ];
    const q = query.trim().toLowerCase();
    return q ? list.filter((c) => c.address.toLowerCase().includes(q) || (c.name ?? "").toLowerCase().includes(q)) : list;
  }, [contacts, tab, query]);

  const chosen = Object.values(picked);
  const give = (target: Target) => {
    if (!chosen.length) return;
    onAdd(target, chosen);
    setPicked({});
    onClose();
  };

  const addManual = async () => {
    if (!isEmail(newAddr)) {
      toast.error("메일 주소 형식이 아닙니다.");
      return;
    }
    setBusy(true);
    try {
      const { contacts: list } = await addContact(newName.trim(), newAddr.trim());
      setContacts(list);
      setNewName("");
      setNewAddr("");
      setTab("book");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (address: string) => {
    try {
      const { contacts: list } = await removeContact(address);
      setContacts(list);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="주소록"
      size="md"
      footer={
        <>
          <span className="mr-auto text-nd-caption text-nd-fg-3">{chosen.length ? `${chosen.length}명 고름` : "주소를 고르세요"}</span>
          <Button variant="secondary" size="sm" disabled={!chosen.length} onClick={() => give("bcc")}>
            숨은참조
          </Button>
          <Button variant="secondary" size="sm" disabled={!chosen.length} onClick={() => give("cc")}>
            참조
          </Button>
          <Button size="sm" disabled={!chosen.length} onClick={() => give("to")}>
            받는 사람
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl<Tab>
            size="sm"
            ariaLabel="주소 모음"
            value={tab}
            onChange={setTab}
            options={[
              { value: "recent", label: "최근 사용", icon: Clock },
              { value: "frequent", label: "자주 쓰는", icon: Star },
              { value: "book", label: "주소록", icon: Users },
            ]}
          />
          <SearchInput value={query} onValueChange={setQuery} placeholder="이름·주소 찾기" className="w-full sm:ml-auto sm:w-48" />
        </div>

        <div className="nd-scroll max-h-[320px] overflow-y-auto rounded-nd-md border border-nd-line">
          {rows.length === 0 ? (
            <EmptyState
              compact
              className="m-3"
              title={tab === "book" ? "주소록이 비어 있어요" : "아직 보낸 주소가 없어요"}
              description={tab === "book" ? "아래에서 주소를 넣거나, 메일을 연결한 동료가 여기에 보입니다." : "메일을 보내면 받는 사람이 여기에 쌓입니다."}
            />
          ) : (
            rows.map((c) => {
              const k = c.address.toLowerCase();
              return (
                <div key={k} className="flex items-center gap-2 border-b border-nd-line px-3 py-2 last:border-b-0">
                  <Checkbox
                    checked={!!picked[k]}
                    onChange={(e) =>
                      setPicked((p) => {
                        const next = { ...p };
                        if (e.target.checked) next[k] = { name: c.name, address: c.address };
                        else delete next[k];
                        return next;
                      })
                    }
                    aria-label={`${c.name || c.address} 고르기`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-nd-body text-nd-fg">{c.name || c.address}</span>
                    {c.name && <span className="block truncate text-nd-caption text-nd-fg-3">{c.address}</span>}
                  </span>
                  {c.team && <span className="text-nd-micro text-nd-accent-strong">팀</span>}
                  {tab === "frequent" && <span className="text-nd-caption text-nd-fg-3">{c.count}회</span>}
                  {tab === "book" && c.manual && (
                    <button
                      type="button"
                      aria-label={`${c.address} 주소록에서 지우기`}
                      onClick={() => remove(c.address)}
                      className="rounded p-1 text-nd-fg-3 hover:bg-nd-sunken hover:text-nd-danger-text"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        <FormRow className="grid-cols-1 sm:grid-cols-[1fr_1.4fr_auto]">
          <Field label="이름">
            <Input size="sm" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="홍길동" />
          </Field>
          <Field label="주소록에 넣을 주소">
            <Input size="sm" value={newAddr} onChange={(e) => setNewAddr(e.target.value)} placeholder="name@example.com" />
          </Field>
          <FieldAction>
            <Button size="sm" variant="secondary" icon={UserPlus} loading={busy} onClick={addManual}>
              추가
            </Button>
          </FieldAction>
        </FormRow>
      </div>
    </Dialog>
  );
}
