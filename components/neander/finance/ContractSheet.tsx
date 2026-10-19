"use client";

// ============================================================
//  계약서 시트 — 나가는 종이 그 자체
// ------------------------------------------------------------
//  견적서 시트(QuoteSheet)와 같은 생각이다. 폼을 채우고 미리보기로 넘어가는
//  대신 종이 한 장을 두고 그 위에서 바로 고친다. 인쇄는 이 DOM 을 떠서
//  만든다 — 렌더러가 하나뿐이라 미리보기가 틀릴 자리가 없다.
//
//  위에서 아래로: 제목 · 전문 · 「계약의 개요」 표 · (품목 표) · 조항 ·
//  맺음말 · 날짜 · 서명란.
//
//  사실은 개요 표 한 곳에만 적는다. 상대방 상호는 개요 표와 서명란 두
//  군데에 보이지만 같은 칸이다 — 한쪽을 고치면 다른 쪽이 따라온다.
//
//  조항 번호는 순서에서 나온다. 조항을 옮기고, 사이에 끼우고, 빼면 뒤
//  번호가 따라 바뀐다 — 그래서 조항끼리는 번호로 부르지 않게 양식을
//  썼다(contract-templates.ts). 손으로 「제n조」 를 적어 넣었다가 그 조가
//  없어지면 편집창이 알려 준다(contract.ts 의 checkContract).
//
//  종이에 자리가 없는 것 — 양식 이름, 상태, 비서 — 은 여기 들어오지
//  않는다. 편집창(ContractComposer)이 시트 바깥에 둔다.
// ============================================================

import { createElement, forwardRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { ArrowDown, ArrowUp, ListPlus, Plus, Table2, Trash2, X } from "lucide-react";
import { cn } from "@/components/neander/ui";
import { koreanNumber } from "@/lib/neander/finance/docs";
import { VAT_LABEL, VAT_MODES, type VatMode } from "@/lib/neander/finance/project";
import { contractTemplate, type ContractBody, type ContractParty, type ContractSide } from "@/lib/neander/finance/contract-body";
import {
  clauseLabel,
  itemAmount,
  itemsTotal,
  newClause,
  newItem,
  newTerm,
  signedLine,
  syncCounterparty,
  type ContractChange,
  type ContractItem,
  type FinContractDraft,
} from "@/lib/neander/finance/contract";
import { longDate } from "@/lib/neander/finance/contract-templates";
import { NO_SEAL, SEALS, resolveSeal, sealOwnerFields } from "@/lib/neander/finance/supplier";
import { useSealImage } from "@/lib/neander/finance/seal-image";
import { sheetPrintHtml } from "@/lib/neander/finance/quote-pdf";
import { AutoText, Cell, NumCell } from "./sheet-cells";
import "./contract-sheet.css";

const won = (n: number) => n.toLocaleString("ko-KR");

/** 개요 행 이름별 예시 — 무엇을 어떤 꼴로 적는지 */
const TERM_HINT: Record<string, string> = {
  납품기한: "2026년 9월 3일",
  "납품 장소": "납품받을 곳의 주소",
  "입금 계좌": "은행 · 계좌번호 · 예금주",
  "행사 기간": "2026년 9월 4일 ~ 9월 7일 (4일간)",
  "행사 장소": "행사가 열리는 곳",
  "협업 상품": "피규어 키링 디퓨저 3종 · 10ml 향수",
  "판매 채널": "자사몰 · 매장",
};

/**
 * 변경 하나가 종이의 어느 자리를 건드리는가 — 그 자리로 굴려 가서 잠깐 칠한다.
 * 조항을 빼는 변경은 가리킬 자리가 사라지므로 없다.
 */
export function changeTarget(change: ContractChange): string | null {
  switch (change.kind) {
    case "clause.edit":
      return change.clauseId;
    case "clause.add":
      return change.clause.id;
    case "clause.remove":
      return null;
    case "text":
      return change.field;
    case "fields":
      if (change.patch.items) return "items";
      if ((change.patch.partyA || change.patch.partyB) && !change.patch.terms && change.patch.amount === undefined) return "sign";
      return "terms";
  }
}

export const ContractSheet = forwardRef<HTMLDivElement, {
  value: FinContractDraft;
  onChange: (next: FinContractDraft) => void;
  /** 방금 바뀐 자리 (data-part 값) */
  flash?: string | null;
  /** 글이 있는 조항을 빼기 전에 묻는다. 없으면 바로 뺀다 */
  confirmRemove?: (label: string) => Promise<boolean>;
}>(function ContractSheet({ value: c, onChange, flash, confirmRemove }, ref) {
  const b = c.body;
  const meta = contractTemplate(b.template);
  const seal = resolveSeal(b.sealId);
  const sealImage = useSealImage(seal?.id);
  const sealBroken = !!seal && sealImage.state === "missing";

  const emit = (next: FinContractDraft) => onChange(syncCounterparty(next));
  const set = <K extends keyof FinContractDraft>(k: K, v: FinContractDraft[K]) => emit({ ...c, [k]: v });
  const setBody = (patch: Partial<ContractBody>) => emit({ ...c, body: { ...b, ...patch } });
  const setParty = (side: ContractSide, k: keyof ContractParty, v: string) => {
    const key = side === "a" ? "partyA" : "partyB";
    setBody({ [key]: { ...b[key], [k]: v } });
  };
  const hot = (part: string) => (flash === part ? "is-flash" : undefined);

  // ---- 조항 ----
  const setClause = (id: string, patch: { title?: string; text?: string }) =>
    setBody({ clauses: b.clauses.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const moveClause = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= b.clauses.length) return;
    const next = [...b.clauses];
    [next[i], next[j]] = [next[j], next[i]];
    setBody({ clauses: next });
  };
  const addClauseAt = (at: number) => setBody({ clauses: [...b.clauses.slice(0, at), newClause(), ...b.clauses.slice(at)] });
  const removeClause = async (i: number) => {
    const x = b.clauses[i];
    if (confirmRemove && (x.title.trim() || x.text.trim()) && !(await confirmRemove(clauseLabel(i, x.title)))) return;
    setBody({ clauses: b.clauses.filter((y) => y.id !== x.id) });
  };

  // ---- 품목 ----
  const setItem = (id: string, patch: Partial<ContractItem>) =>
    setBody({ items: b.items.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const total = itemsTotal(b.items);
  const gap = c.amount > 0 && total > 0 ? total - c.amount : 0;

  /** 서명란의 한 칸 — 우리 쪽 대표자 칸에만 도장이 찍힌다 */
  const ceoCell = (side: ContractSide) => {
    const p = side === "a" ? b.partyA : b.partyB;
    const ours = b.ourSide === side;
    return (
      <td className="ceo">
        <Cell label={`${side === "a" ? "갑" : "을"} 대표자`} placeholder="대표자" value={p.ceo} onChange={(v) => setParty(side, "ceo", v)} />
        <span className="stamp">(인)</span>
        {ours &&
          (seal && sealImage.src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="seal" src={sealImage.src} alt={`${seal.owner} 인감`} />
          ) : seal && sealImage.state === "loading" ? null : (
            <span className="seal-empty" data-noprint aria-hidden>
              {sealBroken ? "파일 없음" : "인감 없음"}
            </span>
          ))}
        {ours && (
          <select
            className="q-seal"
            data-noprint
            aria-label="인감"
            title={
              sealBroken
                ? `${seal?.label ?? ""} 이미지를 받지 못했습니다 — 서버에 올라가 있지 않으면 npm run finance:upload-seals`
                : "눌러서 찍을 도장을 고릅니다"
            }
            value={b.sealId ?? SEALS[0].id}
            onChange={(e) => {
              // 도장은 곧 사람이다 — 도장을 갈면 대표자 이름도 그 주인으로 바뀐다 (supplier.ts).
              // 「찍지 않음」 은 주인이 없으니 이름을 건드리지 않는다.
              const nextId = e.target.value;
              const owner = sealOwnerFields(nextId);
              const key = side === "a" ? "partyA" : "partyB";
              setBody({ sealId: nextId, ...(owner ? { [key]: { ...p, ceo: owner.ceo } } : {}) });
            }}
          >
            {SEALS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
            <option value={NO_SEAL}>찍지 않음</option>
          </select>
        )}
      </td>
    );
  };

  return (
    <div ref={ref} className="csheet sheet--edit">
      <h1 data-part="heading" className={hot("heading")}>
        <AutoText label="제목" placeholder="○○ 계약서" value={b.heading} onChange={(v) => setBody({ heading: v })} />
      </h1>

      <div data-part="preamble" className={cn("pre", hot("preamble"))}>
        <AutoText label="전문" placeholder="“갑”과 “을”은 다음과 같이 계약을 체결한다." value={b.preamble} onChange={(v) => setBody({ preamble: v })} />
      </div>

      <h2>계약의 개요</h2>
      <table data-part="terms" className={cn("terms", hot("terms"))}>
        <tbody>
          <tr>
            <th>
              “갑”<span className="role">{b.roleA}</span>
            </th>
            <td>
              <Cell label="갑 상호" placeholder="상호" value={b.partyA.name} onChange={(v) => setParty("a", "name", v)} />
            </td>
          </tr>
          <tr>
            <th>
              “을”<span className="role">{b.roleB}</span>
            </th>
            <td>
              <Cell label="을 상호" placeholder="상호" value={b.partyB.name} onChange={(v) => setParty("b", "name", v)} />
            </td>
          </tr>
          <tr>
            <th>계 약 명</th>
            <td>
              <Cell label="계약명" placeholder="○○ 용역" value={c.title} onChange={(v) => set("title", v)} />
            </td>
          </tr>
          {/* 금액이 없으면 이 줄은 종이에서 빠진다 — 「일금 영원정」 이 찍힌 계약서는 없다 */}
          <tr className={cn(c.amount <= 0 && "is-dropped")} data-noprint={c.amount <= 0 ? "" : undefined}>
            <th>계약금액</th>
            <td>
              {c.amount > 0 && (
                <>
                  일금 <b>{koreanNumber(c.amount)}</b>원정{" "}
                </>
              )}
              (₩
              <NumCell auto label="계약금액" value={c.amount} onChange={(v) => set("amount", Math.max(0, Math.round(v)))} />){" · "}
              <span className="q-pick">
                {VAT_LABEL[c.vatMode]}
                <select data-noprint aria-label="부가세 기준" value={c.vatMode} onChange={(e) => set("vatMode", e.target.value as VatMode)}>
                  {VAT_MODES.map((m) => (
                    <option key={m} value={m}>
                      {VAT_LABEL[m]}
                    </option>
                  ))}
                </select>
              </span>
              {c.amount <= 0 && <span className="c-dropnote">금액을 적지 않으면 이 줄은 종이에서 빠집니다</span>}
            </td>
          </tr>
          <tr>
            <th>계약기간</th>
            <td>
              <span className="q-date">
                {longDate(c.startDate) || "계약 체결일"}
                <input type="date" data-noprint aria-label="계약기간 시작" value={c.startDate ?? ""} onChange={(e) => set("startDate", e.target.value || undefined)} />
              </span>
              {" ~ "}
              <span className="q-date">
                {longDate(c.endDate) || "____"}
                <input type="date" data-noprint aria-label="계약기간 끝" value={c.endDate ?? ""} onChange={(e) => set("endDate", e.target.value || undefined)} />
              </span>
            </td>
          </tr>
          {b.terms.map((t) => {
            const empty = !t.value.trim();
            return (
              <tr key={t.id} className={cn(empty && "is-dropped")} data-noprint={empty ? "" : undefined}>
                <th>
                  <Cell
                    label="개요 행 이름"
                    placeholder="항목"
                    value={t.label}
                    onChange={(v) => setBody({ terms: b.terms.map((x) => (x.id === t.id ? { ...x, label: v } : x)) })}
                  />
                </th>
                <td className="has-x">
                  <AutoText
                    label={t.label || "개요 행 값"}
                    placeholder={`${TERM_HINT[t.label.trim()] ?? "내용"} — 비워 두면 종이에서 빠집니다`}
                    value={t.value}
                    onChange={(v) => setBody({ terms: b.terms.map((x) => (x.id === t.id ? { ...x, value: v } : x)) })}
                  />
                  <button
                    type="button"
                    className="c-x"
                    data-noprint
                    aria-label={`${t.label || "이"} 행 지우기`}
                    title="이 행을 지웁니다"
                    onClick={() => setBody({ terms: b.terms.filter((x) => x.id !== t.id) })}
                  >
                    <X size={14} strokeWidth={2} aria-hidden />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="q-linebar" data-noprint>
        <button type="button" className="q-linebtn" onClick={() => setBody({ terms: [...b.terms, newTerm()] })} title="납품기한 · 장소 · 계좌처럼 개요에 적어 둘 행을 넣습니다">
          <Plus size={13} strokeWidth={2} aria-hidden />
          개요 행 추가
        </button>
        {b.items.length === 0 && (
          <button type="button" className="q-linebtn" onClick={() => setBody({ items: [newItem()] })} title="품목 · 규격 · 수량 · 단가 표를 개요 아래에 넣습니다">
            <Table2 size={13} strokeWidth={2} aria-hidden />
            품목 표 넣기
          </button>
        )}
      </div>

      {b.items.length > 0 && (
        <>
          <h2>{meta.itemsTitle ?? "품목"}</h2>
          <table data-part="items" className={cn("items", hot("items"))}>
            <thead>
              <tr>
                <th>품명</th>
                <th>규격</th>
                <th>수량</th>
                <th>단가</th>
                <th>금액</th>
                <th>비고</th>
              </tr>
            </thead>
            <tbody>
              {b.items.map((l) => (
                <tr key={l.id}>
                  <td className="name">
                    <Cell label="품명" placeholder="품명" value={l.name} onChange={(v) => setItem(l.id, { name: v })} />
                  </td>
                  <td>
                    <Cell label="규격" placeholder="규격" value={l.spec ?? ""} onChange={(v) => setItem(l.id, { spec: v })} />
                  </td>
                  <td className="num">
                    <NumCell label="수량" value={l.qty} onChange={(v) => setItem(l.id, { qty: v })} />
                  </td>
                  <td className="num">
                    <NumCell label="단가" value={l.unitPrice} onChange={(v) => setItem(l.id, { unitPrice: v })} />
                  </td>
                  <td className="num">{won(itemAmount(l))}</td>
                  <td className="has-x">
                    <Cell label="비고" value={l.note ?? ""} onChange={(v) => setItem(l.id, { note: v })} />
                    <button
                      type="button"
                      className="c-x"
                      data-noprint
                      aria-label={`${l.name || "이"} 줄 지우기`}
                      title="이 줄을 지웁니다"
                      onClick={() => setBody({ items: b.items.filter((x) => x.id !== l.id) })}
                    >
                      <X size={14} strokeWidth={2} aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="sum">
                <td className="name">합계</td>
                <td />
                <td className="num">{won(b.items.reduce((a, l) => a + (Number(l.qty) || 0), 0))}</td>
                <td />
                <td className="num">{won(total)}</td>
                <td />
              </tr>
            </tbody>
          </table>
          <div className="q-linebar" data-noprint>
            <button type="button" className="q-linebtn" onClick={() => setBody({ items: [...b.items, newItem()] })}>
              <Plus size={13} strokeWidth={2} aria-hidden />
              줄 추가
            </button>
            {gap !== 0 && (
              <>
                {/* 품목 합계와 계약금액이 어긋나면 드러낸다 — 단가가 부가세 별도라 어긋나는 것일 수도 있어 막지는 않는다 */}
                <span className="q-linehint">
                  품목 합계가 계약금액보다 {won(Math.abs(gap))}원 {gap > 0 ? "많습니다" : "적습니다"}
                </span>
                <button type="button" className="q-linebtn" onClick={() => set("amount", total)} title="계약금액 칸에 품목 합계를 넣습니다">
                  합계를 계약금액으로
                </button>
              </>
            )}
          </div>
        </>
      )}

      {b.clauses.map((x, i) => (
        <section key={x.id} data-part={x.id} className={cn("clause", hot(x.id))}>
          <h3>
            제{i + 1}조(
            <Cell auto label={`제${i + 1}조 제목`} placeholder="제목" value={x.title} onChange={(v) => setClause(x.id, { title: v })} />)
            <span className="c-tools" data-noprint>
              <button type="button" className="c-tool" onClick={() => moveClause(i, -1)} disabled={i === 0} aria-label={`${clauseLabel(i, x.title)} 위로`} title="위로 옮깁니다">
                <ArrowUp size={14} strokeWidth={2} aria-hidden />
              </button>
              <button type="button" className="c-tool" onClick={() => moveClause(i, 1)} disabled={i === b.clauses.length - 1} aria-label={`${clauseLabel(i, x.title)} 아래로`} title="아래로 옮깁니다">
                <ArrowDown size={14} strokeWidth={2} aria-hidden />
              </button>
              <button type="button" className="c-tool" onClick={() => addClauseAt(i + 1)} aria-label={`${clauseLabel(i, x.title)} 아래에 조항 추가`} title="이 아래에 새 조항을 끼웁니다">
                <ListPlus size={14} strokeWidth={2} aria-hidden />
              </button>
              <button type="button" className="c-tool c-tool--danger" onClick={() => void removeClause(i)} aria-label={`${clauseLabel(i, x.title)} 빼기`} title="이 조항을 뺍니다 — 뒤 조항의 번호가 당겨집니다">
                <Trash2 size={14} strokeWidth={2} aria-hidden />
              </button>
            </span>
          </h3>
          <div className="c-text">
            <AutoText
              label={`${clauseLabel(i, x.title)} 본문`}
              placeholder="① …"
              value={x.text}
              onChange={(v) => setClause(x.id, { text: v })}
            />
          </div>
        </section>
      ))}
      <div className="q-linebar" data-noprint>
        <button type="button" className="q-linebtn" onClick={() => addClauseAt(b.clauses.length)}>
          <Plus size={13} strokeWidth={2} aria-hidden />
          조항 추가
        </button>
      </div>

      <div className="tail">
        <div data-part="closing" className={cn("closing", hot("closing"))}>
          <AutoText label="맺음말" value={b.closing} onChange={(v) => setBody({ closing: v })} />
        </div>

        <p className="signed">
          <span className="q-date" title="체결일 — 아직 모르면 비워 두고 손으로 적습니다">
            {signedLine(c.signedDate)}
            <input type="date" data-noprint aria-label="체결일" value={c.signedDate ?? ""} onChange={(e) => set("signedDate", e.target.value || undefined)} />
          </span>
        </p>

        <table data-part="sign" className={cn("sign", hot("sign"))}>
          <thead>
            <tr>
              <th className="who" colSpan={2}>
                “갑” <Cell auto label="갑의 역할" placeholder="역할" value={b.roleA} onChange={(v) => setBody({ roleA: v })} />
              </th>
              <th className="who" colSpan={2}>
                “을” <Cell auto label="을의 역할" placeholder="역할" value={b.roleB} onChange={(v) => setBody({ roleB: v })} />
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>상호</th>
              <td>
                <Cell label="갑 상호" placeholder="상호" value={b.partyA.name} onChange={(v) => setParty("a", "name", v)} />
              </td>
              <th>상호</th>
              <td>
                <Cell label="을 상호" placeholder="상호" value={b.partyB.name} onChange={(v) => setParty("b", "name", v)} />
              </td>
            </tr>
            <tr>
              <th>사업자등록번호</th>
              <td>
                <Cell label="갑 사업자등록번호" placeholder="000-00-00000" value={b.partyA.bizNo} onChange={(v) => setParty("a", "bizNo", v)} />
              </td>
              <th>사업자등록번호</th>
              <td>
                <Cell label="을 사업자등록번호" placeholder="000-00-00000" value={b.partyB.bizNo} onChange={(v) => setParty("b", "bizNo", v)} />
              </td>
            </tr>
            <tr>
              <th>주소</th>
              <td>
                <AutoText label="갑 주소" placeholder="주소" value={b.partyA.address} onChange={(v) => setParty("a", "address", v)} />
              </td>
              <th>주소</th>
              <td>
                <AutoText label="을 주소" placeholder="주소" value={b.partyB.address} onChange={(v) => setParty("b", "address", v)} />
              </td>
            </tr>
            <tr>
              <th>대표자</th>
              {ceoCell("a")}
              <th>대표자</th>
              {ceoCell("b")}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
});

// ---- 인쇄본 -------------------------------------------------------

/**
 * 계약서 데이터 → 인쇄용 HTML. 눈에 보이지 않는 자리에 시트를 한 번 더 그려서
 * 뜬다(견적서의 printableQuoteHtml 과 같은 이유 — 목록에서 편집창 없이 바로
 * 뽑는 길이 있고, 화면 시트는 커서가 들어간 숫자칸이 쉼표 없이 보인다).
 */
export function printableContractHtml(c: FinContractDraft): string {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:820px;";
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => {
      root.render(createElement(ContractSheet, { value: c, onChange: () => {} }));
    });
    const sheet = host.firstElementChild as HTMLElement | null;
    return sheet ? sheetPrintHtml(sheet) : "";
  } finally {
    setTimeout(() => {
      root.unmount();
      host.remove();
    }, 0);
  }
}
