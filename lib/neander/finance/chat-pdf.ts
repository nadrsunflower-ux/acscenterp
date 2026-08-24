// ============================================================
//  재무 비서 답변 → PDF 저장
// ------------------------------------------------------------
//  새 창에 인쇄용 HTML 을 그리고 브라우저 인쇄 대화상자를 연다. 사용자는
//  대상에서 「PDF로 저장」을 고르면 된다. 라이브러리로 직접 PDF 를 만들지
//  않는 이유: 한글 폰트를 임베드해야 하고, 브라우저 인쇄가 표·줄바꿈을
//  더 잘 처리한다.
//
//  마크다운 변환은 FinanceChat.tsx 의 <Markdown> 과 같은 부분집합만 다룬다
//  — 표 · **굵게** · `코드`. 비서 프롬프트가 그것만 쓰라고 하기 때문이다.
// ============================================================

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** **굵게** 와 `코드` 만 — 이스케이프를 먼저 해서 원문 HTML 은 그대로 글자가 된다 */
const inline = (s: string) =>
  esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");

const isTableRow = (l: string) => l.trim().startsWith("|") && l.trim().endsWith("|");
const cells = (l: string) => l.trim().slice(1, -1).split("|").map((c) => c.trim());
/** 숫자스러운 셀은 오른쪽 정렬 — 화면 렌더러와 같은 판별식 */
const isNumeric = (c: string) => /^[\d,.\-△()₩원%]+$/.test(c);

function markdownToHtml(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isTableRow(line) && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
      const head = cells(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        body.push(cells(lines[i]));
        i += 1;
      }
      out.push(
        "<table><thead><tr>" +
          head.map((h) => `<th>${inline(h)}</th>`).join("") +
          "</tr></thead><tbody>" +
          body
            .map(
              (r) =>
                "<tr>" +
                r.map((c) => `<td${isNumeric(c) ? ' class="num"' : ""}>${inline(c)}</td>`).join("") +
                "</tr>",
            )
            .join("") +
          "</tbody></table>",
      );
      continue;
    }
    out.push(line.trim() === "" ? '<div class="gap"></div>' : `<p>${inline(line)}</p>`);
    i += 1;
  }
  return out.join("\n");
}

/**
 * 인쇄용 보고서 창을 연다. 팝업이 차단되면 false 를 돌려준다 — 호출한 쪽이
 * 사용자에게 알려야 한다.
 */
export function openChatReportPdf(args: {
  /** 이 답변을 만들어 낸 질문 */
  question: string;
  /** 비서의 마크다운 답변 */
  answer: string;
  model?: string;
}): boolean {
  const win = window.open("", "_blank");
  if (!win) return false;

  const now = new Date();
  const dateLabel = now.toLocaleString("ko-KR", { dateStyle: "long", timeStyle: "short" });
  // 창 제목이 「PDF로 저장」의 기본 파일명이 된다
  const title = `재무비서 보고서 ${now.toISOString().slice(0, 10)}`;

  win.document.write(`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif;
    color: #18181b; margin: 0 auto; padding: 40px; max-width: 800px;
    font-size: 13px; line-height: 1.6;
  }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #71717a; font-size: 12px; margin: 0 0 24px; padding-bottom: 16px; border-bottom: 1px solid #e4e4e7; }
  .question { background: #f4f4f5; border-radius: 8px; padding: 10px 14px; margin-bottom: 20px; }
  .question h2 { font-size: 12px; color: #71717a; margin: 0 0 4px; font-weight: 600; }
  .question p { margin: 0; white-space: pre-wrap; }
  p { margin: 0 0 2px; white-space: pre-wrap; }
  .gap { height: 10px; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 12px; page-break-inside: auto; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #d4d4d8; padding: 5px 8px; text-align: left; vertical-align: top; }
  th { background: #f4f4f5; font-weight: 600; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  code { background: #f4f4f5; border-radius: 3px; padding: 1px 4px; font-size: 0.92em; }
  footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #e4e4e7; color: #a1a1aa; font-size: 11px; }
  .print-btn {
    position: fixed; top: 16px; right: 16px; border: 0; border-radius: 8px;
    background: #4f46e5; color: #fff; padding: 8px 14px; font-size: 13px; cursor: pointer;
  }
  @media print { .print-btn { display: none; } body { padding: 0; } }
  @page { margin: 18mm; }
</style>
</head>
<body>
  <button type="button" class="print-btn" onclick="window.print()">인쇄 / PDF 저장</button>
  <h1>재무 비서 보고서</h1>
  <p class="meta">${esc(dateLabel)} · NEANDER ERP 재무${args.model ? ` · ${esc(args.model)}` : ""}</p>
  <section class="question">
    <h2>질문</h2>
    <p>${esc(args.question)}</p>
  </section>
  <section>${markdownToHtml(args.answer)}</section>
  <footer>이 보고서는 재무 비서(AI)가 장부를 조회해 작성했습니다. 수치는 거래 원장에서 재확인할 수 있습니다.</footer>
  <script>window.addEventListener("load", () => setTimeout(() => window.print(), 300));</script>
</body>
</html>`);
  win.document.close();
  return true;
}
