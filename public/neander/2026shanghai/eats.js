/* 상하이 출장 페이지 — 「맛집」 탭 (먹고 마실 곳 가이드)
 * 데이터: eats-data.js 의 window.EATS (조사 2026-11-27). 사진: img/e/.
 * 본 페이지 스크립트(shanghai2026Html.ts)의 esc · zhSpan · I · openSheet · toast · store · CHE 를 호출 시점에 빌려 쓴다.
 * 그래서 이 파일은 본 스크립트보다 먼저 읽혀도 된다(함수 안에서만 참조).
 */
"use strict";
var ECATS = [
  ["all", "전체", "utensils"],
  ["crab", "털게", "fish"],
  ["unique", "이색 맛집", "sparkles"],
  ["dessert", "디저트·간식", "coffee"],
  ["value", "가성비", "yen"],
  ["market", "시장·야시장", "store"],
  ["drink", "술·낮술", "wine"],
  ["late", "야식", "moon"],
];
var EDAYS = [["any", "아무 때"], ["day0", "금"], ["day1", "토"], ["day2", "일"], ["day3", "월"]];
var ECATK = { crab: "food", unique: "food", dessert: "shop", value: "food", market: "sight", drink: "night", late: "night" };
var eatF = { c: "all", d: "any", smoke: false };

function eatList() { return window.EATS || []; }
function eatById(id) { return eatList().find(function (e) { return e.id === id; }); }
function eatImg(f) { return "/neander/2026shanghai/img/e/" + f; }
function eatAmap(e) {
  return "https://uri.amap.com/search?keyword=" + encodeURIComponent(e.zh) + "&city=" + encodeURIComponent("上海") + "&src=shanghai_trip&callnative=1";
}
function eatCatName(c) { var x = ECATS.find(function (k) { return k[0] === c; }); return x ? x[1] : ""; }
function eatShort(s) { s = String(s || ""); var i = s.search(/[.。!]\s/); return i > 0 && i < 90 ? s.slice(0, i + 1) : (s.length > 90 ? s.slice(0, 88) + "…" : s); }

function eatCard(e) {
  var ph = e.ph && e.ph[0];
  return '<button type="button" class="card ecard k-' + (ECATK[e.cat] || "food") + '" data-eat="' + esc(e.id) + '">' +
    '<span class="eph">' + (ph ? '<img loading="lazy" src="' + eatImg(ph[0]) + '" alt="">' : I(ECATS.find(function (k) { return k[0] === e.cat; })[2])) +
    '<span class="ecat">' + esc(eatCatName(e.cat)) + "</span>" +
    (e.smoke ? '<span class="esmk">' + I("leaf") + "바깥 자리</span>" : "") +
    (e.ph && e.ph.length > 1 ? '<span class="enum">' + I("camera") + e.ph.length + "</span>" : "") + "</span>" +
    '<span class="etx"><b>' + esc(e.ko) + '</b><span class="zh" lang="zh-CN">' + esc(e.zh) + "</span>" +
    '<span class="ewhy">' + zhSpan(eatShort(e.why)) + "</span>" +
    '<span class="emeta">' + (e.price ? "<span>" + I("yen") + esc(e.price) + "</span>" : "") + (e.area ? "<span>" + I("pin") + zhSpan(e.area) + "</span>" : "") + "</span>" +
    (e.fitShort ? '<span class="efit">' + I("cal") + esc(e.fitShort) + "</span>" : "") +
    "</span></button>";
}

function eatFiltered() {
  return eatList().filter(function (e) {
    if (eatF.c !== "all" && e.cat !== eatF.c) return false;
    if (eatF.d !== "any" && (e.days || []).indexOf(eatF.d) < 0) return false;
    if (eatF.smoke && !e.smoke) return false;
    return true;
  });
}

function renderEat() {
  var el = document.getElementById("v-eat");
  if (!el) return;
  try { var s = store.get("sh-eatf", null); if (s && s.c) eatF = s; } catch (err) {}
  var all = eatList(), list = eatFiltered();
  var cnt = function (c) { return c === "all" ? all.length : all.filter(function (e) { return e.cat === c; }).length; };
  el.innerHTML = '<div class="ptitle"><h1>먹고 마실 곳</h1><span class="ecount tnum">' + all.length + "곳</span></div>" +
    '<p class="elead">조사 11/27 · 사진은 손님 후기·블로그·가게 사진(사진마다 출처) · 상하이는 실내 전면 금연이라 <b>바깥 자리</b> 표시를 붙였어요</p>' +
    '<div class="echips" role="group" aria-label="종류">' + ECATS.map(function (k) {
      return '<button type="button" data-ecat="' + k[0] + '" aria-pressed="' + (eatF.c === k[0]) + '">' + I(k[2]) + esc(k[1]) + "<em>" + cnt(k[0]) + "</em></button>";
    }).join("") + "</div>" +
    '<div class="segs eseg" role="group" aria-label="날짜">' + EDAYS.map(function (d) {
      return '<button type="button" data-eday="' + d[0] + '" aria-pressed="' + (eatF.d === d[0]) + '">' + esc(d[1]) + (d[0] === "any" ? "" : " 근처") + "</button>";
    }).join("") + '<button type="button" data-esmoke aria-pressed="' + eatF.smoke + '">' + I("leaf") + "바깥 자리</button></div>" +
    '<div class="elist">' + (list.map(eatCard).join("") || '<p class="eempty">조건에 맞는 곳이 없어요</p>') + "</div>" +
    '<p class="efoot">평점·가격·영업시간은 조사 시점 기준이에요. <b>가기 전 고덕지도에서 영업 중인지</b> 한 번 확인하세요.</p>';
  var on = el.querySelector('.echips [aria-pressed="true"]');
  if (on && on.offsetLeft > on.parentElement.clientWidth - 60) on.parentElement.scrollLeft = on.offsetLeft - 16;
}

function openEat(id) {
  var e = eatById(id);
  if (!e) return;
  var gal = (e.ph || []).map(function (p, i) {
    return '<figure class="eslide"><img src="' + eatImg(p[0]) + '" alt="' + esc(e.ko) + " 사진 " + (i + 1) + '"' + (i ? ' loading="lazy"' : "") + ">" +
      '<figcaption>' + (p[2] ? '<a href="' + esc(p[2]) + '" target="_blank" rel="noopener">' + esc(p[1]) + " ↗</a>" : esc(p[1])) + "</figcaption></figure>";
  }).join("");
  var dots = (e.ph || []).length > 1 ? '<span class="edots">' + e.ph.map(function (_, i) { return "<i" + (i ? "" : ' class="on"') + "></i>"; }).join("") + "</span>" : "";
  var meta = [];
  if (e.price) meta.push("<span>" + I("yen") + esc(e.price) + "</span>");
  if (e.hours) meta.push("<span>" + I("clock") + zhSpan(e.hours) + "</span>");
  if (e.area) meta.push("<span>" + I("pin") + zhSpan(e.area) + "</span>");
  if (e.conf === "low") meta.push('<span class="al">' + I("alert") + "근거 약함</span>");
  var tips = [];
  if (e.fit) tips.push(["cal", e.fit, ""]);
  if (e.smoke) tips.push(["leaf", e.smoke, "good"]);
  (e.tips || []).forEach(function (t) { tips.push(["info", t, ""]); });
  if (e.addr) tips.push(["home", e.addr, ""]);
  var html = '<div class="scroll"><div class="cover ecover k-' + (ECATK[e.cat] || "food") + '">' +
    (gal ? '<div class="egal" id="egal">' + gal + "</div>" + dots : I("utensils")) +
    '<div class="tb"><button class="glass round" type="button" data-close aria-label="닫기">' + I("chevl") + "</button></div></div>" +
    '<div class="body"><div><p class="tnum" style="color:var(--coral);font-weight:800;font-size:15px">' + esc(eatCatName(e.cat)) + (e.fitShort ? " · " + esc(e.fitShort) : "") + "</p>" +
    "<h2>" + esc(e.ko) + '</h2><p class="zhn"><span class="zh" lang="zh-CN">' + esc(e.zh) + "</span></p>" +
    (meta.length ? '<div class="meta">' + meta.join("") + "</div>" : "") + "</div>" +
    (e.warn ? '<p class="warn">' + I("alert") + "<span>" + zhSpan(e.warn) + "</span></p>" : "") +
    '<div class="rbtns"><a class="rbtn" href="' + eatAmap(e) + '" target="_blank" rel="noopener"><i>' + I("pin") + "</i>지도</a>" +
    '<button class="rbtn" type="button" data-copy="' + esc(e.zh) + '"><i>' + I("copy") + "</i>복사</button>" +
    '<button class="rbtn" type="button" data-edrv="' + esc(e.id) + '"><i>' + CHE + "</i>기사님</button></div>" +
    '<div class="sec3"><h3>왜 가나</h3><p class="ewhyl">' + zhSpan(e.why) + "</p></div>" +
    ((e.menu || []).length ? '<div class="sec3"><h3>시킬 것</h3><div class="emenu">' + e.menu.map(function (m) {
      return '<span><b class="zh" lang="zh-CN">' + esc(m[0]) + "</b>" + (m[1] ? "<em>" + esc(m[1]) + "</em>" : "") + "</span>";
    }).join("") + "</div></div>" : "") +
    ((e.rev || []).length ? '<div class="sec3"><h3>후기</h3><ul class="erev">' + e.rev.map(function (r) {
      return "<li><q>" + zhSpan(r[0]) + "</q><span>" + esc(r[1]) + "</span></li>";
    }).join("") + "</ul></div>" : "") +
    (tips.length ? '<div class="sec3"><h3>알아 둘 것</h3><ul class="tips">' + tips.map(function (t) {
      return '<li class="' + t[2] + '"><i>' + I(t[0]) + "</i><span>" + zhSpan(t[1]) + "</span></li>";
    }).join("") + "</ul></div>" : "") +
    ((e.src || []).length ? '<div class="sec3"><h3>출처</h3><div class="esrc">' + e.src.map(function (s) {
      return '<a href="' + esc(s[1]) + '" target="_blank" rel="noopener">' + esc(s[0]) + " ↗</a>";
    }).join("") + "</div></div>" : "") +
    '</div></div><div class="foot"><a class="btn-coral" href="' + eatAmap(e) + '" target="_blank" rel="noopener">' + I("nav") + "고덕지도에서 열기</a></div>";
  openSheet(html, "k-" + (ECATK[e.cat] || "food"));
  var g = document.getElementById("egal");
  if (g && e.ph.length > 1) {
    g.addEventListener("scroll", function () {
      var n = Math.round(g.scrollLeft / g.clientWidth);
      document.querySelectorAll(".edots i").forEach(function (d, i) { d.classList.toggle("on", i === n); });
    }, { passive: true });
  }
}

function eatDriver(id) {
  var e = eatById(id);
  if (!e) return;
  try { dFocus = document.activeElement; } catch (err) {}
  document.getElementById("driverZh").textContent = e.zh;
  document.getElementById("driverKo").textContent = e.ko;
  var ad = document.getElementById("driverAddr");
  ad.textContent = e.addr || "";
  ad.hidden = !e.addr;
  document.getElementById("driver").hidden = false;
  document.getElementById("driverClose").focus();
}

function eatMini(e) {
  var ph = e.ph && e.ph[0];
  return '<button type="button" class="card mustc k-' + (ECATK[e.cat] || "food") + '" data-eat="' + esc(e.id) + '" style="text-align:left">' +
    '<span class="ph">' + (ph ? '<img loading="lazy" src="' + eatImg(ph[0]) + '" alt="">' : I("utensils")) + "</span>" +
    '<span class="tx"><span>' + esc(eatCatName(e.cat)) + (e.fitShort ? " · " + esc(e.fitShort) : "") + "</span><b>" + esc(e.ko) + "</b></span></button>";
}

/* 홈 — 「먹고 마실 곳」 추천 줄 (window.EATS_HOME 순서, 없으면 사진 있는 앞쪽) */
function eatHome() {
  var ids = window.EATS_HOME || [];
  var list = ids.map(eatById).filter(Boolean);
  if (!list.length) list = eatList().filter(function (e) { return e.ph && e.ph.length; }).slice(0, 10);
  if (!list.length) return "";
  return '<div class="sh2"><h2>먹고 마실 곳</h2><a class="more" href="#eat">' + eatList().length + "곳 전체" + I("chevr") + "</a></div>" +
    '<div class="hs">' + list.map(eatMini).join("") + "</div>";
}

/* 하루 화면 아래에 붙는 「이 날 근처」 줄 */
function eatDay(dayId) {
  var wrap = document.querySelector("#dayWrap .daybody > div:last-child");
  if (!wrap) return;
  var list = eatList().filter(function (e) { return (e.days || []).indexOf(dayId) >= 0; });
  if (!list.length) return;
  wrap.insertAdjacentHTML("beforeend", '<div class="sh2"><h2>이 날 근처 먹고 마실 곳</h2><a class="more" href="#eat" data-eday-go="' + dayId + '">' + list.length + "곳" + I("chevr") + "</a></div>" +
    '<div class="hs">' + list.map(eatMini).join("") + "</div>");
}

document.addEventListener("click", function (ev) {
  var t = ev.target.closest("[data-eat],[data-ecat],[data-eday],[data-esmoke],[data-edrv],[data-eday-go]");
  if (!t) return;
  if (t.dataset.eat) { ev.preventDefault(); openEat(t.dataset.eat); return; }
  if (t.dataset.edrv) { ev.preventDefault(); eatDriver(t.dataset.edrv); return; }
  if (t.dataset.edayGo) { eatF = { c: "all", d: t.dataset.edayGo, smoke: false }; try { store.set("sh-eatf", eatF); } catch (err) {} return; }
  if (t.dataset.ecat) eatF.c = t.dataset.ecat;
  else if (t.dataset.eday) eatF.d = t.dataset.eday;
  else if (t.dataset.esmoke !== undefined) eatF.smoke = !eatF.smoke;
  try { store.set("sh-eatf", eatF); } catch (err) {}
  renderEat();
});
