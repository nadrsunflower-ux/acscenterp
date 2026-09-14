// ============================================================
//  공통 화면 부품 검사 — `npm run ui:verify-parts`
// ------------------------------------------------------------
//  ERP 화면은 Google 로그인을 거쳐야 열려서, 브라우저 검증이 막히는 날이
//  있다 (검증 프로필의 세션은 주기적으로 만료된다). 그때도 최소한 이만큼은
//  확인할 수 있어야 한다 — 부품이 **접혀 있을 때 무엇이 남는지**, 라벨과
//  컨트롤이 묶였는지, 상태를 색 말고 글자로도 알리는지, 상품 유형별 사진이
//  섞이지 않는지.
//
//  CSS 값을 그대로 확인하는 형식적인 검사는 넣지 않는다. 여기 있는 것은
//  전부 "틀리면 사람이 화면을 잘못 읽게 되는" 것들이다.
// ============================================================
import React from "react";
import { renderToStaticMarkup as R } from "react-dom/server";
import {
  BasisLine, ChartValues, Disclosure, DisclosureGroup, FilterBar, FilterField,
  InfoPopover, LinkTile, MasterDetail, Meter, Pagination, RatioTile, SearchInput,
  Stepper, PageHeader, PageShell, KpiStrip, DropZone, Wordmark, ProductWordmark, BrandMark, WORDMARK_SRC, BRAND_LOGO,
} from "@/components/neander/ui";
import fs from "node:fs";
import { ProductCell, ProductHero, ProductThumb } from "@/components/neander/sales/ui";
import { SEED_PRODUCTS } from "@/lib/neander/sales/master-data";
import { productImage as productImageOf } from "@/lib/neander/sales/product-image";
import { Package } from "lucide-react";

let bad = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "OK  " : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!cond) bad++;
};
const noop = () => {};

// ---- Disclosure: 접힌 채로도 제목·설명·meta 가 남고, 버튼이 aria 로 연결된다
const d = R(
  <Disclosure icon={Package} title="계산식 안내" description="순금액과 순손익이 다른 이유" meta="개인사용 12,800원">
    <p>내용</p>
  </Disclosure>,
);
ok("Disclosure 접힘 기본", d.includes('aria-expanded="false"') && d.includes("hidden"));
ok("Disclosure 제목·설명·meta 노출", d.includes("계산식 안내") && d.includes("순금액과") && d.includes("개인사용 12,800원"));
ok("Disclosure 접히면 내용 미렌더", !d.includes("<p>내용</p>"));
ok("Disclosure aria-controls 연결", /aria-controls="([^"]+)"/.test(d) && d.includes('id="' + (d.match(/aria-controls="([^"]+)"/) as RegExpMatchArray)[1] + '"'));
const dOpen = R(<Disclosure title="t" defaultOpen><p>내용</p></Disclosure>);
ok("Disclosure 펼치면 내용 렌더", dOpen.includes("<p>내용</p>") && dOpen.includes('aria-expanded="true"'));
// hidden 을 이기는 display 유틸이 껍데기에 없어야 한다
const shell = (d.match(/<div id="[^"]+" hidden[^>]*class="([^"]*)"/) || [])[1] ?? "";
ok("Disclosure 껍데기에 display 유틸 없음", !/\b(flex|grid|block|inline-flex)\b/.test(shell), shell || "(class 없음)");

// ---- FilterBar / FilterField: 라벨이 컨트롤과 묶인다
const f = R(
  <FilterBar actions={<span>액션</span>}>
    <FilterField label="사업장" htmlFor="x"><select id="x" /></FilterField>
    <FilterField label="기준" as="div"><span /></FilterField>
  </FilterBar>,
);
ok("FilterField label→for 연결", f.includes('for="x"') && f.includes('id="x"'));
ok("FilterField as=div 는 label 아님", (f.match(/<label/g) || []).length === 1);
ok("FilterBar actions 렌더", f.includes("액션"));

// ---- Pagination
const pg = R(<Pagination total={317} page={2} pageSize={50} onPageChange={noop} onPageSizeChange={noop} />);
ok("Pagination 총 건수", pg.includes("317"));
ok("Pagination 범위 표시", pg.includes("51") && pg.includes("100"));
ok("Pagination 쪽 수", pg.includes(">2<") && pg.includes("/ 7"));
ok("Pagination 이전/다음 이름", pg.includes('aria-label="이전 쪽"') && pg.includes('aria-label="다음 쪽"'));
const pg1 = R(<Pagination total={10} page={1} pageSize={50} onPageChange={noop} />);
ok("Pagination 한 쪽이면 버튼 없음", !pg1.includes("이전 쪽") && pg1.includes("10"));

// ---- SearchInput
const si = R(<SearchInput value="쿠팡" onValueChange={noop} placeholder="거래 검색" />);
ok("SearchInput type=search", si.includes('type="search"'));
ok("SearchInput 지우기 버튼", si.includes('aria-label="검색어 지우기"'));
ok("SearchInput 값 없으면 지우기 없음", !R(<SearchInput value="" onValueChange={noop} />).includes("검색어 지우기"));

// ---- Stepper: 완료/진행/예정을 색 아닌 글자로도
const st = R(<Stepper steps={[{key:"a",label:"점검"},{key:"b",label:"차이 확인"},{key:"c",label:"마감"}]} current={1} />);
ok("Stepper 완료 표시", st.includes("(완료)"));
ok("Stepper 진행 중 표시", st.includes("(진행 중)") && st.includes('aria-current="step"'));
ok("Stepper 예정 표시", st.includes("(예정)"));

// ---- Meter / RatioTile
const rt = R(<KpiStrip><RatioTile label="집행률" value={1.2} warnAbove={1} hint="예산 대비" /></KpiStrip>);
ok("RatioTile 퍼센트", rt.includes("120.0%"));
ok("RatioTile 초과를 글자로", rt.includes("초과"));
ok("RatioTile 분모 없음 → —", R(<KpiStrip><RatioTile label="x" value={null} /></KpiStrip>).includes("—"));
ok("Meter 폭 100% 상한", R(<Meter value={3} max={1} />).includes("width:100%"));

// ---- MasterDetail: 넓은 화면 기본은 두 판, 상세 없으면 목록만
const md = R(<MasterDetail selected={false} list={<div>목록</div>} detail={<div>상세</div>} />);
ok("MasterDetail 양쪽을 늘 그린다(서버=브라우저)", md.includes("목록") && md.includes("상세"));
ok("MasterDetail 미선택이면 좁은 화면에서 상세를 감춤", md.includes("max-lg:hidden") && !md.includes("목록으로"));
const mdSel = R(<MasterDetail selected list={<div>목록</div>} detail={<div>상세</div>} onBack={noop} />);
ok("MasterDetail 선택하면 좁은 화면에 「목록으로」", mdSel.includes("목록으로") && mdSel.includes("lg:hidden"));
ok("MasterDetail 목록 폭은 CSS 변수", md.includes("--nd-md-list"));

// ---- 상품 사진
const p10 = SEED_PRODUCTS.find((p) => p.id === "IDI-001")!;
const pSachet = SEED_PRODUCTS.find((p) => p.id === "IDE-003")!;
const t10 = R(<ProductThumb product={p10} />);
ok("10ml 썸네일 = perfume-10ml 파생본", t10.includes("perfume-10ml-01-128.webp"));
ok("썸네일 object-contain·lazy", t10.includes("object-contain") && t10.includes('loading="lazy"'));
ok("이름이 옆에 있으면 alt 빈 값", t10.includes('alt=""'));
const tSachet = R(<ProductThumb product={pSachet} />);
ok("사쉐는 사진 없이 중립 아이콘", !tSachet.includes("<img") && tSachet.includes("svg"));
ok("사진 없는 이유를 title 로", tSachet.includes("사쉐 사진을 찾지 못했습니다"));
const cell = R(<ProductCell product={p10} />);
ok("ProductCell 이름·옵션·코드", cell.includes("일반AI") && cell.includes("10ml") && cell.includes("IDI-001"));
const hero = R(<ProductHero product={SEED_PRODUCTS.find((p) => p.id === "IDI-013")!} />);
ok("세트 상세는 세트 사진", hero.includes("1777901298869_cp1pkk-320.webp") || hero.includes("chemistry"));
ok("ProductHero 정사각·contain", hero.includes("aspect-square") && hero.includes("object-contain"));
{
  // 화면이 가리키는 파생본이 실제로 있는가 (없으면 상품마다 깨진 사진)
  const missing = SEED_PRODUCTS.flatMap((p) => {
    const im = productImageOf(p);
    return [im.thumb, im.hero].filter(Boolean).filter((u) => !fs.existsSync("public" + u));
  });
  ok("가리키는 사진 파일이 전부 있다", missing.length === 0, missing.slice(0, 3).join(", "));
}
const heroNone = R(<ProductHero product={pSachet} />);
ok("사진 없는 상세는 이유를 글자로", heroNone.includes("찾지 못했습니다"));

// ---- PageHeader: 설명이 제목 아래 줄
const ph = R(<PageHeader title="거래 원장" description="모든 거래를 조회합니다" meta={<span>상태</span>} actions={<button>저장</button>} />);
ok("PageHeader h1", ph.includes("<h1") && ph.includes("거래 원장"));
ok("PageHeader 설명이 별도 p", /<\/h1>[\s\S]*<p[^>]*>모든 거래를 조회합니다<\/p>/.test(ph));
ok("PageShell 폭 토큰", R(<PageShell width="wide"><i /></PageShell>).includes("max-w-[1400px]"));

// ---- DropZone: 키보드로도 파일을 고를 수 있어야 한다
const dz = R(<DropZone onFiles={noop} title="파일을 끌어다 놓으세요" hint="xlsx" />);
ok("DropZone 누를 수 있는 버튼", dz.includes("<button") && dz.includes("파일을 끌어다 놓으세요"));
ok("DropZone 숨은 file input", dz.includes('type="file"'));

// ---- ChartValues / BasisLine / InfoPopover / LinkTile (앞 세션 부품 회귀)
ok("ChartValues 접힘 기본", R(<ChartValues columns={[{key:"a",label:"수입"}]} rows={[{key:"m",label:"7월",values:{a:1000}}]} />).includes('aria-expanded="false"'));
ok("BasisLine 구분점", R(<BasisLine items={["A","B"]} />).includes(">·<"));
ok("InfoPopover 닫힘 기본", R(<InfoPopover label="집계 기준" terms={[{term:"t",desc:"d"}]} />).includes('aria-haspopup="dialog"'));
ok("LinkTile 링크", R(<LinkTile href="/x" icon={Package} title="t" />).includes('href="/x"'));
ok("DisclosureGroup 렌더", R(<DisclosureGroup><Disclosure title="a"><i/></Disclosure></DisclosureGroup>).includes("a"));

// ---- 회사 로고: 공식 파일만, 비율 유지, 바탕에 맞는 벌
const wmInk = R(<Wordmark />);
ok("로고는 공식 ink 파일", wmInk.includes("acscent-wordmark-ink.png"));
ok("로고 alt 는 회사 이름", wmInk.includes('alt="AC&#x27;SCENT"') || wmInk.includes("alt=\"AC'SCENT\""));
ok("로고 폭은 자동(비율 유지)", wmInk.includes("width:auto"));
ok("로고 높이 지정", R(<Wordmark height={22} />).includes("height:22px"));
ok("어두운 바탕은 cream 벌", R(<Wordmark variant="cream" />).includes("acscent-wordmark-cream.png"));
ok("제품 상표는 ERP 자기 이름", R(<ProductWordmark />).includes("NEANDER") && R(<ProductWordmark />).includes("ERP"));
ok("제품 로고 파일이 없으면 글자로", BRAND_LOGO === null ? !R(<ProductWordmark />).includes("<img") : R(<ProductWordmark />).includes("<img"));
ok("좁은 자리는 제품 머리글자", R(<BrandMark />).includes('aria-label="NEANDER ERP"'));
for (const [k, v] of Object.entries(WORDMARK_SRC)) {
  ok(`로고 파일 존재 (${k})`, fs.existsSync("public" + v), v);
}

console.log(bad === 0 ? `\n전부 통과` : `\n실패 ${bad}건`);
process.exit(bad ? 1 : 0);
