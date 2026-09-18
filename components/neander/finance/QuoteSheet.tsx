"use client";

// ============================================================
//  견적서 시트 — 나가는 종이 그 자체
// ------------------------------------------------------------
//  예전에는 「편집」 탭에서 폼을 채우고 「미리보기」 탭에서 결과를 봤다.
//  탭이 둘이면 고치는 화면과 나가는 종이가 서로 다른 물건이 되고,
//  미리보기는 "아마 이렇게 나갈 겁니다" 라는 약속에 그친다. 그래서
//  종이 한 장만 두고 그 위에서 바로 고친다.
//
//  인쇄는 이 DOM 을 떠서 만든다 (quote-pdf.ts 의 sheetPrintHtml) —
//  입력칸을 그 값의 글자로 바꿔치고, 지우기 단추처럼 종이에 없어야 할
//  것(data-noprint)은 떼어 낸다. 렌더러가 하나뿐이라 미리보기가 틀릴
//  자리가 없다.
//
//  종이에 자리가 없는 것 — 상태, 붙인 파일 — 은 여기 들어오지 않는다.
//  편집창이 시트 바깥에 따로 둔다.
// ============================================================

import { createElement, forwardRef, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/components/neander/ui";
import {
  QUOTE_VAT_LABEL,
  koreanDate,
  koreanNumber,
  newQuoteLine,
  quoteLineAmount,
  quoteTotals,
  type FinQuoteInput,
  type FinQuoteLine,
  type FinSupplier,
} from "@/lib/neander/finance/docs";
import { NO_SEAL, SEALS, resolveSeal, sealOwnerFields } from "@/lib/neander/finance/supplier";
import { sheetPrintHtml } from "@/lib/neander/finance/quote-pdf";
import "./quote-sheet.css";

const won = (n: number) => n.toLocaleString("ko-KR");

// ---- 칸 ----------------------------------------------------------

/** 종이 위의 글자처럼 보이는 입력칸. 글꼴·정렬·색은 칸에서 물려받는다 */
function Cell({
  value,
  onChange,
  placeholder,
  label,
  className,
  auto,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label: string;
  className?: string;
  /** 문장 안에 박히는 칸 — 「제 26-001 호」 처럼 뒤에 글자가 붙는다. 내용만큼만 넓힌다 */
  auto?: boolean;
}) {
  return (
    <input
      className={cn("q-cell", auto && "q-auto", className)}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={label}
      // field-sizing 이 없는 브라우저는 size 로 대강 맞춘다 (칸 자체가 안 보이는 게 더 나쁘다)
      size={auto ? Math.max((value || placeholder || "").length, 4) : undefined}
    />
  );
}

/**
 * 숫자 칸. 볼 때는 「12,000」, 커서가 들어가면 「12000」.
 * 인쇄본에는 보이는 그대로(쉼표 붙은 값)가 박히므로 평소 표기가 곧 결과다.
 */
function NumCell({
  value,
  onChange,
  label,
  placeholder = "0",
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(() => (value ? won(value) : ""));
  const [editing, setEditing] = useState(false);

  // 밖에서 값이 바뀌었을 때 (줄 복사 등) 따라간다 — 고치는 중에는 건드리지 않는다
  useEffect(() => {
    if (!editing) setText(value ? won(value) : "");
  }, [value, editing]);

  return (
    <input
      className="q-cell"
      inputMode="numeric"
      aria-label={label}
      placeholder={placeholder}
      value={text}
      onFocus={() => {
        setEditing(true);
        setText(value ? String(value) : "");
      }}
      onBlur={() => {
        setEditing(false);
        setText(value ? won(value) : "");
      }}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value.replace(/[^\d.-]/g, ""));
        onChange(Number.isFinite(n) ? n : 0);
      }}
    />
  );
}

/** 메모칸 — 적은 만큼 늘어난다 (스크롤바가 종이 위에 생기면 안 된다) */
function MemoCell({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      className="q-memo"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="메모 — 배송비·샘플 조건처럼 견적서 아래에 함께 찍을 말"
      aria-label="메모"
    />
  );
}

// ---- 시트 --------------------------------------------------------

export const QuoteSheet = forwardRef<HTMLDivElement, {
  value: FinQuoteInput;
  onChange: (next: FinQuoteInput) => void;
}>(function QuoteSheet({ value: q, onChange }, ref) {
  const t = quoteTotals(q);
  const seal = resolveSeal(q.sealId);
  const vatLabel = QUOTE_VAT_LABEL[q.vatMode];
  // 도장 파일이 아직 없을 수 있다(등록만 하고 이미지를 안 넣은 경우).
  // 그때 그냥 사라지면 도장을 고를 자리마저 사라져 「인감은 어떻게 넣지」 가 된다.
  const [sealBroken, setSealBroken] = useState(false);
  useEffect(() => setSealBroken(false), [seal?.src]);

  const set = <K extends keyof FinQuoteInput>(k: K, v: FinQuoteInput[K]) => onChange({ ...q, [k]: v });
  const setSupplier = (k: keyof FinSupplier, v: string) => onChange({ ...q, supplier: { ...q.supplier, [k]: v } });
  const setLine = (id: string, patch: Partial<FinQuoteLine>) =>
    onChange({ ...q, lines: q.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) });

  // ---- 줄 고르기 ----
  // 줄을 누르면(칸에 커서가 들어가도) 그 줄이 골라진다. 「줄 추가」 는 고른 줄
  // 바로 아래에 끼워 넣고, 「줄 삭제」 는 고른 줄을 지운다. 지운 뒤에는 아무것도
  // 고르지 않는다 — 단추를 두 번 눌러 이웃 줄까지 날아가는 일이 없게.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = q.lines.find((l) => l.id === selectedId) ?? null;
  const selectedNo = selected ? q.lines.indexOf(selected) + 1 : 0;
  const linesRef = useRef<HTMLTableElement>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  // 새 줄은 품명 칸에 커서를 넣어 둔다 — 추가하자마자 바로 적을 수 있게
  useEffect(() => {
    if (!focusId) return;
    linesRef.current?.querySelector<HTMLInputElement>(`tr[data-line="${focusId}"] input`)?.focus();
    setFocusId(null);
  }, [focusId]);

  const addLine = () => {
    const line = newQuoteLine();
    const at = selected ? q.lines.indexOf(selected) + 1 : q.lines.length;
    onChange({ ...q, lines: [...q.lines.slice(0, at), line, ...q.lines.slice(at)] });
    setSelectedId(line.id);
    setFocusId(line.id);
  };
  const removeSelected = () => {
    if (!selected || q.lines.length <= 1) return;
    onChange({ ...q, lines: q.lines.filter((l) => l.id !== selected.id) });
    setSelectedId(null);
  };

  return (
    <div
      ref={ref}
      className="sheet sheet--edit"
      // 품목 표·줄 단추 바깥을 누르면 고른 줄을 놓는다
      onPointerDown={(e) => {
        if (!(e.target as HTMLElement).closest(".lines, .q-linebar")) setSelectedId(null);
      }}
    >
      <div className="head">
        <div className="left">
          <p className="no" data-print-drop-if-empty>
            견적번호 : 제{" "}
            <Cell
              auto
              label="견적번호"
              placeholder="26-001"
              value={q.quoteNo}
              onChange={(v) => set("quoteNo", v)}
            />
            호
          </p>
          <h1>견 적 서</h1>
          <p className="to">
            <b>
              <Cell
                auto
                label="수신"
                placeholder="수신처"
                value={q.recipient}
                onChange={(v) => set("recipient", v)}
              />
            </b>{" "}
            님 귀하
          </p>
          <p className="date">
            <span className="q-date">
              {koreanDate(q.date)}
              <input
                type="date"
                data-noprint
                aria-label="견적일"
                value={q.date}
                onChange={(e) => set("date", e.target.value || q.date)}
              />
            </span>
          </p>
        </div>
        <table className="supplier">
          <tbody>
            <tr>
              <th className="side" rowSpan={5}>
                공<br />급<br />자
              </th>
              <th>사업자번호</th>
              <td colSpan={3}>
                <Cell label="사업자번호" value={q.supplier.bizNo} onChange={(v) => setSupplier("bizNo", v)} />
              </td>
            </tr>
            <tr>
              <th>상　　호</th>
              <td>
                <Cell label="상호" value={q.supplier.name} onChange={(v) => setSupplier("name", v)} />
              </td>
              <th>대 표 자</th>
              <td className="ceo">
                <Cell label="대표자" value={q.supplier.ceo} onChange={(v) => setSupplier("ceo", v)} />
                {seal && !sealBroken ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="seal" src={seal.src} alt={`${seal.owner} 인감`} onError={() => setSealBroken(true)} />
                ) : (
                  <span className="seal-empty" data-noprint aria-hidden>
                    {sealBroken ? "파일 없음" : "인감 없음"}
                  </span>
                )}
                {/* 도장을 눌러서 바꾼다 — 도장 자리를 투명한 셀렉트가 덮고 있다 */}
                <select
                  className="q-seal"
                  data-noprint
                  aria-label="인감"
                  title={
                    sealBroken
                      ? `${seal?.label ?? ""} 이미지가 없습니다 — public${seal?.src ?? ""} 에 파일을 놓으세요`
                      : "눌러서 찍을 도장을 고릅니다"
                  }
                  value={q.sealId ?? SEALS[0].id}
                  onChange={(e) => {
                    // 도장을 고르면 대표자·담당자·연락처가 그 주인으로 함께 바뀐다.
                    // 네안데르는 대표이사가 둘이라(유재영·이동주) 도장만 갈면 「대표자
                    // 유재영」 옆에 이동주 인감이 찍힌 종이가 나가고, 연락처만 갈면 담당자
                    // 이름과 번호의 주인이 어긋난다. 「찍지 않음」 은 주인이 없으니 세 칸을
                    // 건드리지 않는다 — 도장을 빼는 것과 사람을 지우는 것은 다른 일이다.
                    const nextId = e.target.value;
                    const owner = sealOwnerFields(nextId);
                    onChange({
                      ...q,
                      sealId: nextId,
                      ...(owner ? { supplier: { ...q.supplier, ...owner } } : {}),
                    });
                  }}
                >
                  {SEALS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                  <option value={NO_SEAL}>찍지 않음</option>
                </select>
              </td>
            </tr>
            <tr>
              <th>소 재 지</th>
              <td colSpan={3}>
                <Cell label="소재지" value={q.supplier.address} onChange={(v) => setSupplier("address", v)} />
              </td>
            </tr>
            <tr>
              <th>업　　태</th>
              <td>
                <Cell label="업태" value={q.supplier.bizType} onChange={(v) => setSupplier("bizType", v)} />
              </td>
              <th>종　　목</th>
              <td>
                <Cell label="종목" value={q.supplier.bizItem} onChange={(v) => setSupplier("bizItem", v)} />
              </td>
            </tr>
            <tr>
              <th>담 당 자</th>
              <td>
                <Cell label="담당자" value={q.supplier.contact} onChange={(v) => setSupplier("contact", v)} />
              </td>
              <th>연 락 처</th>
              <td>
                <Cell label="연락처" value={q.supplier.phone} onChange={(v) => setSupplier("phone", v)} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="intro">아래와 같이 견적합니다.</p>

      <table className="terms">
        <tbody>
          <tr>
            <th>견 적 명</th>
            <td>
              <Cell
                label="견적명"
                placeholder="N.Flying 'into REM' 룸스프레이의 건"
                value={q.title}
                onChange={(v) => set("title", v)}
              />
            </td>
          </tr>
          <tr>
            <th>납품기한</th>
            <td>
              <Cell
                label="납품기한"
                placeholder="발주 후 3주 · 납품 완료"
                value={q.delivery ?? ""}
                onChange={(v) => set("delivery", v)}
              />
            </td>
          </tr>
          <tr>
            <th>대금 지불방식</th>
            <td>
              <Cell
                label="대금 지불방식"
                placeholder="납품 후 세금계산서 발행, 30일 내 입금"
                value={q.payment ?? ""}
                onChange={(v) => set("payment", v)}
              />
            </td>
          </tr>
          <tr>
            <th>견적 유효기간</th>
            <td>
              <Cell
                label="견적 유효기간"
                placeholder="견적일로부터 7일간"
                value={q.validity ?? ""}
                onChange={(v) => set("validity", v)}
              />
            </td>
          </tr>
          <tr className="total">
            <th>
              합계금액
              <br />
              <span>(공급가액+세액)</span>
            </th>
            <td>
              일금 <b>{koreanNumber(t.total)}</b> 원정 <span className="won">(₩ {won(t.total)})</span>{" "}
              <span className="vat">{vatLabel}</span>
            </td>
          </tr>
        </tbody>
      </table>

      <table ref={linesRef} className="lines">
        <thead>
          <tr>
            <th className="name">품명</th>
            <th>규격/사양</th>
            <th className="num">수량</th>
            <th className="num">단가</th>
            <th className="num">공급가액</th>
            <th className="note">비고</th>
          </tr>
        </thead>
        <tbody>
          {q.lines.map((l) => (
            <tr
              key={l.id}
              data-line={l.id}
              className={cn(l.id === selectedId && "is-selected")}
              aria-selected={l.id === selectedId}
              onPointerDown={() => setSelectedId(l.id)}
              onFocus={() => setSelectedId(l.id)}
            >
              <td className="name">
                <Cell label="품명" placeholder="품명" value={l.name} onChange={(v) => setLine(l.id, { name: v })} />
              </td>
              <td>
                <Cell
                  label="규격/사양"
                  placeholder="개/200ml"
                  value={l.spec ?? ""}
                  onChange={(v) => setLine(l.id, { spec: v })}
                />
              </td>
              <td className="num">
                <NumCell label="수량" value={l.qty} onChange={(v) => setLine(l.id, { qty: v })} />
              </td>
              <td className="num">
                <NumCell label="단가" value={l.unitPrice} onChange={(v) => setLine(l.id, { unitPrice: v })} />
              </td>
              <td className="num">{won(quoteLineAmount(l))}</td>
              <td className="note">
                <Cell
                  label="비고"
                  placeholder="VAT포함"
                  value={l.note ?? ""}
                  onChange={(v) => setLine(l.id, { note: v })}
                />
              </td>
            </tr>
          ))}
          <tr className="sum">
            <td className="name">합계</td>
            <td />
            <td className="num">{won(t.qty)}</td>
            <td />
            <td className="num">{won(t.sum)}</td>
            <td className="note">{vatLabel}</td>
          </tr>
        </tbody>
      </table>

      <div className="q-linebar" data-noprint>
        <button
          type="button"
          className="q-linebtn"
          onClick={addLine}
          title={selected ? `${selectedNo}번째 줄 아래에 새 줄을 넣습니다` : "맨 아래에 새 줄을 넣습니다"}
        >
          <Plus size={13} strokeWidth={2} aria-hidden />
          줄 추가
        </button>
        <button
          type="button"
          className="q-linebtn q-linebtn--danger"
          onClick={removeSelected}
          disabled={!selected || q.lines.length <= 1}
          title={
            !selected
              ? "지울 줄을 먼저 누르세요"
              : q.lines.length <= 1
                ? "마지막 한 줄은 지울 수 없습니다"
                : `${selectedNo}번째 줄을 지웁니다`
          }
        >
          <Trash2 size={13} strokeWidth={2} aria-hidden />
          {selected ? `${selectedNo}번째 줄 삭제` : "줄 삭제"}
        </button>
        {!selected && <span className="q-linehint">지울 줄을 눌러 고르세요</span>}
      </div>

      <p className="breakdown">
        {q.vatMode === "excluded"
          ? `공급가액 ${won(t.supply)} + 부가세 ${won(t.vat)} = 합계 ${won(t.total)}`
          : `합계 ${won(t.total)} 안에 부가세 ${won(t.vat)} 이 들어 있습니다 (공급가액 ${won(t.supply)})`}
      </p>

      <div className="memo" data-print-drop-if-empty>
        <MemoCell value={q.note ?? ""} onChange={(v) => set("note", v)} />
      </div>
    </div>
  );
});

// ---- 인쇄본 -------------------------------------------------------

/**
 * 견적서 데이터 → 인쇄용 HTML.
 *
 * 화면에 떠 있는 시트를 그대로 뜨지 않고, 눈에 보이지 않는 자리에 시트를
 * 한 번 더 그려서 뜬다. 이유가 둘 있다.
 *  - 목록에서 편집창을 열지 않고 바로 인쇄하는 길이 있다 (ProjectDocs).
 *  - 화면 시트는 커서가 들어가 있는 숫자칸이 「12000」 처럼 쉼표 없이
 *    보인다. 그 순간 뜨면 그대로 종이에 박힌다.
 * 어느 쪽이든 렌더러는 QuoteSheet 하나라 인쇄본이 화면과 어긋나지 않는다.
 */
export function printableQuoteHtml(q: FinQuoteInput): string {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:820px;";
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => {
      root.render(createElement(QuoteSheet, { value: q, onChange: () => {} }));
    });
    const sheet = host.firstElementChild as HTMLElement | null;
    return sheet ? sheetPrintHtml(sheet) : "";
  } finally {
    // 그리는 중에 곧바로 걷어내면 React 가 경고한다 — 다음 틱에 치운다
    setTimeout(() => {
      root.unmount();
      host.remove();
    }, 0);
  }
}
