// 2026-11 상하이 출장 일정 페이지 — /neander/2026shanghai (일정은 링크 아는 누구나 고칠 수 있다 · API /api/neander/trip/2026shanghai)
// 로그인 없이 링크로 여는 독립 HTML. 사진·지도 타일·Leaflet 은 public/neander/2026shanghai/ 에 있다.
// (중국 안에서도 열리도록 외부 CDN 을 쓰지 않는다. 구글 폰트는 막혀도 화면을 붙잡지 않게 비동기로 읽는다.)
export const SHANGHAI_2026_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#f6f5f3"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="상하이"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
<title>상하이 3박 4일</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=swap" media="print" onload="this.media='all'">
<style>
.leaflet-image-layer,.leaflet-layer,.leaflet-marker-icon,.leaflet-marker-shadow,.leaflet-pane,.leaflet-pane>canvas,.leaflet-pane>svg,.leaflet-tile,.leaflet-tile-container,.leaflet-zoom-box{position:absolute;left:0;top:0}.leaflet-container{overflow:hidden}.leaflet-marker-icon,.leaflet-marker-shadow,.leaflet-tile{-webkit-user-select:none;-moz-user-select:none;user-select:none;-webkit-user-drag:none}.leaflet-tile::selection{background:0 0}.leaflet-safari .leaflet-tile{image-rendering:-webkit-optimize-contrast}.leaflet-safari .leaflet-tile-container{width:1600px;height:1600px;-webkit-transform-origin:0 0}.leaflet-marker-icon,.leaflet-marker-shadow{display:block}.leaflet-container .leaflet-overlay-pane svg{max-width:none!important;max-height:none!important}.leaflet-container .leaflet-marker-pane img,.leaflet-container .leaflet-shadow-pane img,.leaflet-container .leaflet-tile,.leaflet-container .leaflet-tile-pane img,.leaflet-container img.leaflet-image-layer{max-width:none!important;max-height:none!important;width:auto;padding:0}.leaflet-container img.leaflet-tile{mix-blend-mode:plus-lighter}.leaflet-container.leaflet-touch-zoom{-ms-touch-action:pan-x pan-y;touch-action:pan-x pan-y}.leaflet-container.leaflet-touch-drag{-ms-touch-action:pinch-zoom;touch-action:none;touch-action:pinch-zoom}.leaflet-container.leaflet-touch-drag.leaflet-touch-zoom{-ms-touch-action:none;touch-action:none}.leaflet-container{-webkit-tap-highlight-color:transparent}.leaflet-container a{-webkit-tap-highlight-color:rgba(51,181,229,.4)}.leaflet-tile{filter:inherit;visibility:hidden}.leaflet-tile-loaded{visibility:inherit}.leaflet-zoom-box{width:0;height:0;-moz-box-sizing:border-box;box-sizing:border-box;z-index:800}.leaflet-overlay-pane svg{-moz-user-select:none}.leaflet-pane{z-index:400}.leaflet-tile-pane{z-index:200}.leaflet-overlay-pane{z-index:400}.leaflet-shadow-pane{z-index:500}.leaflet-marker-pane{z-index:600}.leaflet-tooltip-pane{z-index:650}.leaflet-popup-pane{z-index:700}.leaflet-map-pane canvas{z-index:100}.leaflet-map-pane svg{z-index:200}.leaflet-vml-shape{width:1px;height:1px}.lvml{behavior:url(#default#VML);display:inline-block;position:absolute}.leaflet-control{position:relative;z-index:800;pointer-events:visiblePainted;pointer-events:auto}.leaflet-bottom,.leaflet-top{position:absolute;z-index:1000;pointer-events:none}.leaflet-top{top:0}.leaflet-right{right:0}.leaflet-bottom{bottom:0}.leaflet-left{left:0}.leaflet-control{float:left;clear:both}.leaflet-right .leaflet-control{float:right}.leaflet-top .leaflet-control{margin-top:10px}.leaflet-bottom .leaflet-control{margin-bottom:10px}.leaflet-left .leaflet-control{margin-left:10px}.leaflet-right .leaflet-control{margin-right:10px}.leaflet-fade-anim .leaflet-popup{opacity:0;-webkit-transition:opacity .2s linear;-moz-transition:opacity .2s linear;transition:opacity .2s linear}.leaflet-fade-anim .leaflet-map-pane .leaflet-popup{opacity:1}.leaflet-zoom-animated{-webkit-transform-origin:0 0;-ms-transform-origin:0 0;transform-origin:0 0}svg.leaflet-zoom-animated{will-change:transform}.leaflet-zoom-anim .leaflet-zoom-animated{-webkit-transition:-webkit-transform .25s cubic-bezier(0,0,.25,1);-moz-transition:-moz-transform .25s cubic-bezier(0,0,.25,1);transition:transform .25s cubic-bezier(0,0,.25,1)}.leaflet-pan-anim .leaflet-tile,.leaflet-zoom-anim .leaflet-tile{-webkit-transition:none;-moz-transition:none;transition:none}.leaflet-zoom-anim .leaflet-zoom-hide{visibility:hidden}.leaflet-interactive{cursor:pointer}.leaflet-grab{cursor:-webkit-grab;cursor:-moz-grab;cursor:grab}.leaflet-crosshair,.leaflet-crosshair .leaflet-interactive{cursor:crosshair}.leaflet-control,.leaflet-popup-pane{cursor:auto}.leaflet-dragging .leaflet-grab,.leaflet-dragging .leaflet-grab .leaflet-interactive,.leaflet-dragging .leaflet-marker-draggable{cursor:move;cursor:-webkit-grabbing;cursor:-moz-grabbing;cursor:grabbing}.leaflet-image-layer,.leaflet-marker-icon,.leaflet-marker-shadow,.leaflet-pane>svg path,.leaflet-tile-container{pointer-events:none}.leaflet-image-layer.leaflet-interactive,.leaflet-marker-icon.leaflet-interactive,.leaflet-pane>svg path.leaflet-interactive,svg.leaflet-image-layer.leaflet-interactive path{pointer-events:visiblePainted;pointer-events:auto}.leaflet-container{background:#ddd;outline-offset:1px}.leaflet-container a{color:#0078a8}.leaflet-zoom-box{border:2px dotted #38f;background:rgba(255,255,255,.5)}.leaflet-container{font-family:"Helvetica Neue",Arial,Helvetica,sans-serif;font-size:12px;font-size:.75rem;line-height:1.5}.leaflet-bar{box-shadow:0 1px 5px rgba(0,0,0,.65);border-radius:4px}.leaflet-bar a{background-color:#fff;border-bottom:1px solid #ccc;width:26px;height:26px;line-height:26px;display:block;text-align:center;text-decoration:none;color:#000}.leaflet-bar a,.leaflet-control-layers-toggle{background-position:50% 50%;background-repeat:no-repeat;display:block}.leaflet-bar a:focus,.leaflet-bar a:hover{background-color:#f4f4f4}.leaflet-bar a:first-child{border-top-left-radius:4px;border-top-right-radius:4px}.leaflet-bar a:last-child{border-bottom-left-radius:4px;border-bottom-right-radius:4px;border-bottom:none}.leaflet-bar a.leaflet-disabled{cursor:default;background-color:#f4f4f4;color:#bbb}.leaflet-touch .leaflet-bar a{width:30px;height:30px;line-height:30px}.leaflet-touch .leaflet-bar a:first-child{border-top-left-radius:2px;border-top-right-radius:2px}.leaflet-touch .leaflet-bar a:last-child{border-bottom-left-radius:2px;border-bottom-right-radius:2px}.leaflet-control-zoom-in,.leaflet-control-zoom-out{font:bold 18px 'Lucida Console',Monaco,monospace;text-indent:1px}.leaflet-touch .leaflet-control-zoom-in,.leaflet-touch .leaflet-control-zoom-out{font-size:22px}.leaflet-control-layers{box-shadow:0 1px 5px rgba(0,0,0,.4);background:#fff;border-radius:5px}.leaflet-control-layers-toggle{background-image:url(images/layers.png);width:36px;height:36px}.leaflet-retina .leaflet-control-layers-toggle{background-image:url(images/layers-2x.png);background-size:26px 26px}.leaflet-touch .leaflet-control-layers-toggle{width:44px;height:44px}.leaflet-control-layers .leaflet-control-layers-list,.leaflet-control-layers-expanded .leaflet-control-layers-toggle{display:none}.leaflet-control-layers-expanded .leaflet-control-layers-list{display:block;position:relative}.leaflet-control-layers-expanded{padding:6px 10px 6px 6px;color:#333;background:#fff}.leaflet-control-layers-scrollbar{overflow-y:scroll;overflow-x:hidden;padding-right:5px}.leaflet-control-layers-selector{margin-top:2px;position:relative;top:1px}.leaflet-control-layers label{display:block;font-size:13px;font-size:1.08333em}.leaflet-control-layers-separator{height:0;border-top:1px solid #ddd;margin:5px -10px 5px -6px}.leaflet-default-icon-path{background-image:url(images/marker-icon.png)}.leaflet-container .leaflet-control-attribution{background:#fff;background:rgba(255,255,255,.8);margin:0}.leaflet-control-attribution,.leaflet-control-scale-line{padding:0 5px;color:#333;line-height:1.4}.leaflet-control-attribution a{text-decoration:none}.leaflet-control-attribution a:focus,.leaflet-control-attribution a:hover{text-decoration:underline}.leaflet-attribution-flag{display:inline!important;vertical-align:baseline!important;width:1em;height:.6669em}.leaflet-left .leaflet-control-scale{margin-left:5px}.leaflet-bottom .leaflet-control-scale{margin-bottom:5px}.leaflet-control-scale-line{border:2px solid #777;border-top:none;line-height:1.1;padding:2px 5px 1px;white-space:nowrap;-moz-box-sizing:border-box;box-sizing:border-box;background:rgba(255,255,255,.8);text-shadow:1px 1px #fff}.leaflet-control-scale-line:not(:first-child){border-top:2px solid #777;border-bottom:none;margin-top:-2px}.leaflet-control-scale-line:not(:first-child):not(:last-child){border-bottom:2px solid #777}.leaflet-touch .leaflet-bar,.leaflet-touch .leaflet-control-attribution,.leaflet-touch .leaflet-control-layers{box-shadow:none}.leaflet-touch .leaflet-bar,.leaflet-touch .leaflet-control-layers{border:2px solid rgba(0,0,0,.2);background-clip:padding-box}.leaflet-popup{position:absolute;text-align:center;margin-bottom:20px}.leaflet-popup-content-wrapper{padding:1px;text-align:left;border-radius:12px}.leaflet-popup-content{margin:13px 24px 13px 20px;line-height:1.3;font-size:13px;font-size:1.08333em;min-height:1px}.leaflet-popup-content p{margin:17px 0;margin:1.3em 0}.leaflet-popup-tip-container{width:40px;height:20px;position:absolute;left:50%;margin-top:-1px;margin-left:-20px;overflow:hidden;pointer-events:none}.leaflet-popup-tip{width:17px;height:17px;padding:1px;margin:-10px auto 0;pointer-events:auto;-webkit-transform:rotate(45deg);-moz-transform:rotate(45deg);-ms-transform:rotate(45deg);transform:rotate(45deg)}.leaflet-popup-content-wrapper,.leaflet-popup-tip{background:#fff;color:#333;box-shadow:0 3px 14px rgba(0,0,0,.4)}.leaflet-container a.leaflet-popup-close-button{position:absolute;top:0;right:0;border:none;text-align:center;width:24px;height:24px;font:16px/24px Tahoma,Verdana,sans-serif;color:#757575;text-decoration:none;background:0 0}.leaflet-container a.leaflet-popup-close-button:focus,.leaflet-container a.leaflet-popup-close-button:hover{color:#585858}.leaflet-popup-scrolled{overflow:auto}.leaflet-oldie .leaflet-popup-content-wrapper{-ms-zoom:1}.leaflet-oldie .leaflet-popup-tip{width:24px;margin:0 auto}.leaflet-oldie .leaflet-control-layers,.leaflet-oldie .leaflet-control-zoom,.leaflet-oldie .leaflet-popup-content-wrapper,.leaflet-oldie .leaflet-popup-tip{border:1px solid #999}.leaflet-div-icon{background:#fff;border:1px solid #666}.leaflet-tooltip{position:absolute;padding:6px;background-color:#fff;border:1px solid #fff;border-radius:3px;color:#222;white-space:nowrap;-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none;pointer-events:none;box-shadow:0 1px 3px rgba(0,0,0,.4)}.leaflet-tooltip.leaflet-interactive{cursor:pointer;pointer-events:auto}.leaflet-tooltip-bottom:before,.leaflet-tooltip-left:before,.leaflet-tooltip-right:before,.leaflet-tooltip-top:before{position:absolute;pointer-events:none;border:6px solid transparent;background:0 0;content:""}.leaflet-tooltip-bottom{margin-top:6px}.leaflet-tooltip-top{margin-top:-6px}.leaflet-tooltip-bottom:before,.leaflet-tooltip-top:before{left:50%;margin-left:-6px}.leaflet-tooltip-top:before{bottom:0;margin-bottom:-12px;border-top-color:#fff}.leaflet-tooltip-bottom:before{top:0;margin-top:-12px;margin-left:-6px;border-bottom-color:#fff}.leaflet-tooltip-left{margin-left:-6px}.leaflet-tooltip-right{margin-left:6px}.leaflet-tooltip-left:before,.leaflet-tooltip-right:before{top:50%;margin-top:-6px}.leaflet-tooltip-left:before{right:0;margin-right:-12px;border-left-color:#fff}.leaflet-tooltip-right:before{left:0;margin-left:-12px;border-right-color:#fff}@media print{.leaflet-control{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
/* 여행 앱 — 흰 카드 · 코랄 한 색 · 사진 썸네일 · 글은 최소. 장소를 누르면 아래에서 상세가 올라온다 */
:root{
  --bg:#f6f5f3; --surface:#ffffff; --sunk:#f1f0ee; --ink:#14213d; --muted:#6b7280; --line:#e8e6e2;
  --coral:#ff5a36; --coral-ink:#ffffff; --coral-soft:#fff0eb; --red:#e5383b; --red-soft:#fdecec; --ok:#16a34a;
  --route:#ff5a36; --route-case:rgba(255,255,255,.95); --walk:#ff5a36; --train:#4f46e5;
  --c-food:#ff6b35; --c-shop:#ec4899; --c-sight:#14b8a6; --c-fun:#3b82f6; --c-scent:#a855f7; --c-spa:#22c55e;
  --c-night:#6366f1; --c-stay:#14213d; --c-move:#64748b; --c-meet:#f59e0b;
  --shadow:0 1px 2px rgba(20,33,61,.04),0 6px 20px rgba(20,33,61,.07);
  --sans:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","IBM Plex Sans KR","Malgun Gothic",system-ui,sans-serif;
  --zh:"PingFang SC","Hiragino Sans GB","Noto Sans SC","Microsoft YaHei",system-ui,sans-serif;
  --navh:64px; --barh:56px;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --bg:#0e1014; --surface:#181b21; --sunk:#22262e; --ink:#f2f4f7; --muted:#9aa3b2; --line:#2a2f38;
  --coral:#ff6a4d; --coral-soft:#3a1f19; --red:#ff6b6b; --red-soft:#3a1d22; --ok:#4ade80;
  --route:#ff6a4d; --route-case:rgba(0,0,0,.75); --train:#a5b4fc; --c-stay:#c7d2fe;
  --shadow:none; color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#0e1014; --surface:#181b21; --sunk:#22262e; --ink:#f2f4f7; --muted:#9aa3b2; --line:#2a2f38;
  --coral:#ff6a4d; --coral-soft:#3a1f19; --red:#ff6b6b; --red-soft:#3a1d22; --ok:#4ade80;
  --route:#ff6a4d; --route-case:rgba(0,0,0,.75); --train:#a5b4fc; --c-stay:#c7d2fe;
  --shadow:none; color-scheme:dark}
.k-food{--cat:var(--c-food)} .k-shop{--cat:var(--c-shop)} .k-sight{--cat:var(--c-sight)} .k-fun{--cat:var(--c-fun)}
.k-scent{--cat:var(--c-scent)} .k-spa{--cat:var(--c-spa)} .k-night{--cat:var(--c-night)} .k-stay{--cat:var(--c-stay)}
.k-fly,.k-rail{--cat:var(--c-move)} .k-meet{--cat:var(--c-meet)}

*{box-sizing:border-box}
html{-webkit-tap-highlight-color:transparent}
body{background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:16px;line-height:1.45;-webkit-text-size-adjust:100%;
  padding-bottom:calc(var(--navh) + env(safe-area-inset-bottom,0px) + 20px)}
.zh{font-family:var(--zh)}
a{color:inherit;text-decoration:none}
button,input,select,textarea{font:inherit;color:inherit}
button{cursor:pointer;background:none;border:0;padding:0}
:focus-visible{outline:3px solid var(--coral);outline-offset:2px;border-radius:10px}
h1,h2,h3{margin:0;line-height:1.2;text-wrap:balance}
p{margin:0}
.ic{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.ic.fill{fill:currentColor;stroke:none}
.px{padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.card{background:var(--surface);border-radius:20px;box-shadow:var(--shadow);border:1px solid var(--line)}
:root:not([data-theme="dark"]) .card{border-color:transparent}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .card{border-color:var(--line)}}
.view[hidden]{display:none!important}
.sh2{display:flex;align-items:center;justify-content:space-between;margin:28px 0 12px}
.sh2 h2{font-size:20px;font-weight:800;letter-spacing:-.01em}
.sh2 .more{font-size:14px;font-weight:700;color:var(--muted);display:flex;align-items:center;gap:2px}
.tnum{font-variant-numeric:tabular-nums}

/* 아래 탭 */
.tabs{position:fixed;left:0;right:0;bottom:0;z-index:950;background:color-mix(in srgb,var(--surface) 92%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-top:1px solid var(--line);padding-bottom:env(safe-area-inset-bottom,0px)}
.tabs .in{display:grid;grid-template-columns:repeat(4,1fr);height:var(--navh);align-items:center}
.tabs a{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;height:56px;color:var(--muted);font-size:13px;font-weight:600}
.tabs a .ic{width:24px;height:24px}
.tabs a[aria-current="page"]{color:var(--coral)}
@media (min-width:900px){
  body{padding-bottom:0;padding-left:96px}
  .tabs{top:0;right:auto;width:96px;border-top:0;border-right:1px solid var(--line);padding:24px 0 0}
  .tabs .in{grid-template-columns:1fr;height:auto;gap:8px}
  .tabs a{height:68px;font-size:13px}
}

/* 홈 */
.hero{position:relative;height:calc(340px + env(safe-area-inset-top,0px));border-radius:0 0 30px 30px;overflow:hidden;background:#0d1424;color:#fff}
.hero img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.28),rgba(0,0,0,0) 30%,rgba(0,0,0,0) 45%,rgba(0,0,0,.62))}
.hero .top{position:absolute;z-index:2;left:0;right:0;top:calc(env(safe-area-inset-top,0px) + 12px);display:flex;justify-content:space-between;align-items:center}
.glass{display:inline-flex;align-items:center;gap:6px;height:38px;padding:0 14px;border-radius:19px;background:rgba(255,255,255,.2);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#fff;font-size:15px;font-weight:700}
.glass.round{width:42px;height:42px;padding:0;justify-content:center;border-radius:50%}
.pill-coral{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 14px;border-radius:17px;background:var(--coral);color:#fff;font-weight:800;font-size:16px}
.hero .bot{position:absolute;z-index:2;left:0;right:0;bottom:46px;display:grid;gap:4px}
.hero h1{font-size:clamp(44px,12vw,72px);font-weight:800;letter-spacing:-.03em;text-shadow:0 2px 16px rgba(0,0,0,.25)}
.hero .dates{font-size:19px;font-weight:600;opacity:.95}
.datecards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:-28px;position:relative;z-index:3}
.datecards a{display:grid;justify-items:center;align-content:center;gap:2px;height:76px;border-radius:18px;background:var(--surface);box-shadow:var(--shadow);border:1px solid var(--line)}
.datecards a b{font-size:24px;font-weight:800}
.datecards a span{font-size:13px;color:var(--muted);font-weight:600}
.datecards a.on{background:var(--coral);color:#fff;border-color:var(--coral)}
.datecards a.on span{color:#fff}
.next{display:grid;grid-template-columns:80px minmax(0,1fr) auto;gap:14px;align-items:center;padding:14px}
.next .lab{grid-column:1/-1;font-size:18px;font-weight:800;display:flex;align-items:center;gap:8px}
.next .lab .live{font-size:13px;font-weight:800;color:#fff;background:var(--coral);border-radius:8px;padding:2px 8px}
.thumb{width:80px;height:80px;border-radius:16px;object-fit:cover;display:grid;place-items:center;background:var(--cat,var(--sunk));color:#fff;flex:none}
.thumb .ic{width:30px;height:30px}
.next .t{font-size:20px;font-weight:800}
.next .n{font-size:17px;font-weight:700;margin-top:2px}
.next .s{font-size:14px;color:var(--muted);margin-top:2px}
.btn-coral{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:44px;padding:0 18px;border-radius:14px;background:var(--coral);color:#fff;font-weight:800;font-size:16px;white-space:nowrap}
.btn-coral .ic{width:18px;height:18px}
.hs{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding:2px 16px 12px;margin:0 -16px;scrollbar-width:none}
.hs::-webkit-scrollbar{display:none}
.mustc{flex:none;width:200px;scroll-snap-align:start;overflow:hidden;display:grid}
.mustc .ph{height:130px;position:relative;background:var(--cat);display:grid;place-items:center;color:#fff}
.mustc .ph img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.mustc .ph .ic{width:40px;height:40px}
.mustc .tx{padding:12px 14px 14px;display:grid;gap:2px}
.mustc .tx span{font-size:13px;font-weight:700;color:var(--coral)}
.mustc .tx b{font-size:16px}
.hotel{padding:16px;display:grid;gap:14px}
.hotel .hh{display:flex;gap:12px;align-items:center}
.hotel .hh .n{width:52px;height:52px;border-radius:16px;background:var(--c-stay);color:var(--surface);display:grid;place-items:center;flex:none}
.hotel .hh .n .ic{width:26px;height:26px}
.hotel h3{font-size:18px;font-weight:800}
.hotel .hh p{font-size:14px;color:var(--muted)}
.facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.fact{display:flex;gap:10px;align-items:center}
.fact .ic{color:var(--coral);width:20px;height:20px}
.fact b{display:block;font-size:16px}
.fact span{font-size:13px;color:var(--muted)}
.rbtns{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.rbtn{display:grid;justify-items:center;gap:6px;font-size:14px;font-weight:700;color:var(--ink)}
.rbtn i{width:56px;height:56px;border-radius:50%;background:var(--sunk);display:grid;place-items:center;font-style:normal}
.rbtn i .ic{width:24px;height:24px}
.rbtn i .che{font-family:var(--zh);font-size:22px;font-weight:700}
.apps{display:flex;flex-wrap:wrap;gap:8px}
.app{display:inline-flex;align-items:center;gap:8px;padding:6px 14px 6px 6px;border-radius:999px;font-size:14px;font-weight:700;background:var(--surface);border:1px solid var(--line)}
.app i{width:28px;height:28px;border-radius:9px;display:grid;place-items:center;color:#fff;font-style:normal;font-size:14px;font-weight:700;font-family:var(--zh)}
.rowbtn{display:flex;align-items:center;gap:12px;padding:16px;font-weight:700;font-size:16px;width:100%;text-align:left}
.rowbtn .ic:first-child{color:var(--coral);width:22px;height:22px}
.rowbtn .ic:last-child{margin-left:auto;color:var(--muted)}
@media (min-width:900px){
  .hero{height:420px;border-radius:0 0 36px 36px}
  .homegrid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:0 28px;align-items:start}
  .datecards{max-width:640px}
}

/* 하루 */
.appbar{position:sticky;top:0;z-index:900;background:color-mix(in srgb,var(--bg) 90%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);padding-top:env(safe-area-inset-top,0px)}
.appbar .in{height:var(--barh);display:grid;grid-template-columns:44px minmax(0,1fr) 44px;align-items:center}
.appbar h2{text-align:center;font-size:19px;font-weight:800}
.appbar h2 small{display:block;font-size:13px;color:var(--muted);font-weight:600;margin-top:1px}
.ibtn{width:44px;height:44px;display:grid;place-items:center;border-radius:50%;color:var(--ink)}
.ibtn .ic{width:24px;height:24px}
.ibtn[aria-pressed="true"]{color:var(--coral)}
.strip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;padding-bottom:10px}
.strip a{height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;gap:6px;font-weight:700;font-size:15px;background:var(--surface);border:1px solid var(--line)}
.strip a span{font-size:13px;color:var(--muted)}
.strip a[aria-current="page"]{background:var(--coral);border-color:var(--coral);color:#fff}
.strip a[aria-current="page"] span{color:#fff}
.dayinfo{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 4px}
.dchip{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:16px;background:var(--surface);border:1px solid var(--line);font-size:14px;font-weight:700}
.dchip .ic{width:16px;height:16px;color:var(--coral)}
.mapbox{position:relative;overflow:hidden;background:var(--sunk)}
.map{height:min(36vh,360px);min-height:230px;background:#eceae6}
.mapbox.hide{display:none}
.daybody{display:grid;gap:14px}
@media (min-width:900px){
  .daybody{grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);align-items:start;gap:24px}
  .mapbox{position:sticky;top:calc(var(--barh) + 64px);border-radius:24px;margin-top:12px}
  .map{height:calc(100vh - var(--barh) - 100px);max-height:none}
  .mapbox.hide{display:block}
}
.leaflet-overlay-pane path.rt-case{stroke:var(--route-case)}
.leaflet-overlay-pane path.rt-base,.leaflet-overlay-pane path.rt-walk{stroke:var(--route)}
.leaflet-overlay-pane path.rt-train{stroke:var(--train)}
:root[data-theme="dark"] .leaflet-tile-pane{filter:invert(.92) hue-rotate(180deg) brightness(.9) contrast(.9)}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .leaflet-tile-pane{filter:invert(.92) hue-rotate(180deg) brightness(.9) contrast(.9)}}
:root[data-theme="dark"] .map{background:#1a1f27}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .map{background:#1a1f27}}
.pin{display:grid;place-items:center;width:32px;height:32px;border-radius:50% 50% 50% 4px;transform:rotate(-45deg);background:var(--coral);border:2.5px solid #fff;box-shadow:0 3px 8px rgba(0,0,0,.3)}
.pin b{transform:rotate(45deg);color:#fff;font:800 14px/1 var(--sans)}
.pin.h{background:#14213d}
.pin.star{background:var(--red)}
.leaflet-popup-content{font-family:var(--sans);font-size:15px;margin:12px 14px;min-width:170px}
.pop b{display:block;font-size:16px}
.pop .pt{color:#c2410c;font-weight:800}
.pop .zh{color:#6b7280;font-size:13px;margin:2px 0 8px}
.pop button{border:0;border-radius:10px;padding:7px 12px;font-size:14px;font-weight:800;background:#ff5a36;color:#fff}
.leaflet-container{font-family:var(--sans)}
.leaflet-control-attribution{font-size:11px}

/* 타임라인 */
.tl{list-style:none;margin:0;padding:8px 0 0}
.stop{display:grid;grid-template-columns:44px minmax(0,1fr);gap:10px;scroll-margin-top:calc(var(--barh) + 70px)}
.rail{position:relative;display:flex;justify-content:center}
.rail::before{content:"";position:absolute;top:0;bottom:0;left:50%;border-left:2px dotted var(--line)}
.tl>li:first-child .rail::before{top:30px}
.tl>li:last-child .rail::before{bottom:auto;height:30px}
.dot{position:relative;z-index:1;margin-top:14px;width:40px;height:40px;border-radius:50%;background:var(--cat);color:#fff;display:grid;place-items:center;box-shadow:0 0 0 4px var(--bg)}
.dot .ic{width:20px;height:20px}
:root[data-theme="dark"] .k-stay .dot{color:#14213d}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .k-stay .dot{color:#14213d}}
.scard{display:grid;grid-template-columns:minmax(0,1fr) 84px;gap:12px;align-items:center;padding:14px;margin:4px 0;width:100%;text-align:left}
.scard.noimg{grid-template-columns:minmax(0,1fr)}
.stop.isnow .scard{box-shadow:0 0 0 3px var(--coral),var(--shadow)}
.scard .tm{font-size:19px;font-weight:800;display:flex;align-items:center;gap:8px}
.scard .tm em{font-style:normal;font-size:13px;font-weight:800;color:#fff;background:var(--coral);border-radius:8px;padding:1px 8px}
.scard h3{font-size:17px;font-weight:800;margin-top:2px;display:flex;align-items:center;gap:5px}
.scard h3 .ic{color:var(--coral);width:16px;height:16px}
.scard .sub{font-size:14px;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.meta{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:8px}
.meta span{display:inline-flex;align-items:center;gap:4px;font-size:14px;color:var(--muted);font-weight:600}
.meta .ic{width:15px;height:15px}
.meta .al{color:var(--red)}
.scard img,.scard .tile0{width:84px;height:84px;border-radius:14px;object-fit:cover;display:block;background:var(--sunk)}
.scard .tile0{display:grid;place-items:center;background:color-mix(in srgb,var(--cat) 16%,var(--surface));color:var(--cat)}
.scard .tile0 .ic{width:32px;height:32px}
.scard{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;touch-action:manipulation}
.tl{position:relative}
.cal{position:relative;display:grid;grid-template-columns:42px minmax(0,1fr);margin:10px 0 0}
.cal .hrs{position:relative}
.cal .hrs span{position:absolute;right:8px;transform:translateY(-50%);font-size:13px;color:var(--muted);font-weight:600;white-space:nowrap}
.cal .col{position:relative;border-left:1px solid var(--line);background-image:linear-gradient(to bottom,var(--line) 1px,transparent 1px)}
.ev{position:absolute;display:flex;gap:8px;align-items:flex-start;border-radius:12px;padding:6px 8px 6px 10px;overflow:hidden;cursor:pointer;
  background:color-mix(in srgb,var(--cat) 15%,var(--surface));border-left:4px solid var(--cat);-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;touch-action:manipulation;transition:box-shadow .15s}
.ev .evc{flex:1;min-width:0;display:grid;gap:1px;align-content:start}
.ev .et{font-size:13px;font-weight:800;color:var(--cat);display:flex;align-items:center;gap:4px;white-space:nowrap}
:root:not([data-theme="dark"]) .k-meet .et,:root:not([data-theme="dark"]) .k-sight .et{filter:brightness(.8)}
.ev .et .ic{width:13px;height:13px;color:var(--red)}
.ev b{font-size:15px;font-weight:800;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ev .es{font-size:13px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ev .meta{margin-top:4px;gap:2px 10px}
.ev .meta span{font-size:13px}
.ev img,.ev .tile0{width:58px;height:58px;border-radius:10px;object-fit:cover;flex:none;display:grid;place-items:center;background:color-mix(in srgb,var(--cat) 22%,var(--surface));color:var(--cat)}
.ev .tile0 .ic{width:26px;height:26px}
.ev.sm{padding-top:4px;padding-bottom:4px}
.ev.sm b{-webkit-line-clamp:1;font-size:14px}
.ev.xs{padding:0 8px 0 10px;align-items:center;border-radius:8px;z-index:2;box-shadow:0 1px 3px rgba(20,33,61,.12)}
.ev.xs .evc{display:flex;gap:6px;align-items:center;white-space:nowrap}
.ev.xs b{font-size:13px;-webkit-line-clamp:1;white-space:nowrap;text-overflow:ellipsis;display:block}
.ev.isnow{box-shadow:0 0 0 2.5px var(--coral)}
.ev.drag{z-index:30;box-shadow:0 14px 32px rgba(20,33,61,.3),0 0 0 2.5px var(--coral);cursor:grabbing}
.ev.saving{opacity:.7}
.ev .rs{position:absolute;left:0;right:0;bottom:0;height:14px;cursor:ns-resize;touch-action:none}
.ev .rs::after{content:"";position:absolute;left:50%;bottom:3px;width:26px;height:4px;margin-left:-13px;border-radius:2px;background:color-mix(in srgb,var(--cat) 55%,transparent)}
.ev.xs .rs{height:8px}.ev.xs .rs::after{display:none}
.nowl{position:absolute;left:-5px;right:0;height:2px;background:var(--red);z-index:25;pointer-events:none}
.nowl::before{content:"";position:absolute;left:-5px;top:-4px;width:10px;height:10px;border-radius:50%;background:var(--red)}
.tl.dragging .hop{display:none}
.tl.dragging .stop:not(.lift){transition:transform .15s}
.stop.lift{position:relative;z-index:20}
.stop.lift .scard{box-shadow:0 18px 40px rgba(20,33,61,.28),0 0 0 2.5px var(--coral);transform:scale(1.03)}
.stop.lift .dot{transform:scale(1.1)}
.dot{cursor:grab;touch-action:none}
.cover .ai{position:absolute;left:14px;bottom:12px;z-index:2;font-size:13px;font-weight:700;color:#fff;background:rgba(0,0,0,.45);border-radius:8px;padding:3px 8px}
.hop{display:grid;grid-template-columns:44px minmax(0,1fr);gap:10px}
.hop .rail::before{border-left-style:dotted}
.hop .seg{display:flex;align-items:center;gap:10px;padding:6px 0;min-width:0}
.hop .seg::before,.hop .seg::after{content:"";flex:1;border-top:2px dotted var(--line);min-width:12px}
.hpill{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:16px;background:var(--sunk);font-size:14px;font-weight:700;color:var(--ink);max-width:80%;white-space:nowrap;overflow:hidden}
.hpill .ic{width:17px;height:17px;color:var(--muted)}
a.hpill .go{color:var(--coral)}
.fab{position:fixed;right:max(16px,env(safe-area-inset-right,0px));bottom:calc(var(--navh) + env(safe-area-inset-bottom,0px) + 16px);z-index:940;display:inline-flex;align-items:center;gap:8px;height:52px;padding:0 20px;border-radius:26px;background:var(--coral);color:#fff;font-weight:800;font-size:16px;box-shadow:0 8px 24px rgba(255,90,54,.4)}
.fab .ic{width:22px;height:22px}
@media (min-width:900px){.fab{bottom:28px;right:28px}}

/* 상세 시트 */
.scrim{position:fixed;inset:0;z-index:1500;background:rgba(10,14,22,.45);opacity:0;transition:opacity .2s}
.scrim.on{opacity:1}
.sheet{position:fixed;left:0;right:0;bottom:0;z-index:1600;max-height:94vh;background:var(--surface);border-radius:28px 28px 0 0;overflow:hidden;display:flex;flex-direction:column;transform:translateY(100%);transition:transform .28s cubic-bezier(.2,.8,.2,1);box-shadow:0 -10px 40px rgba(0,0,0,.2)}
.sheet.on{transform:none}
.sheet[hidden],.scrim[hidden]{display:none}
@media (min-width:900px){
  .sheet{left:auto;top:0;width:460px;max-height:none;border-radius:28px 0 0 28px;transform:translateX(100%)}
}
.sheet .scroll{overflow-y:auto;overscroll-behavior:contain;flex:1;padding-bottom:16px}
.sheet .cover{position:relative;height:250px;background:var(--cat,var(--sunk));display:grid;place-items:center;color:#fff;flex:none}
.sheet .cover img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.sheet .cover>.ic{width:64px;height:64px;opacity:.9}
.sheet .cover .tb{position:absolute;left:14px;right:14px;top:14px;display:flex;justify-content:space-between;z-index:2}
.sheet .cover .glass{background:rgba(0,0,0,.35)}
.sheet .grab{width:44px;height:5px;border-radius:3px;background:var(--line);margin:10px auto 0}
.sheet .body{padding:14px 20px 0;display:grid;gap:18px}
.sheet h2{font-size:26px;font-weight:800;letter-spacing:-.01em;display:flex;gap:8px;align-items:center}
.sheet h2 .ic{color:var(--coral);width:22px;height:22px}
.sheet .zhn{font-size:15px;color:var(--muted);margin-top:4px}
.sheet .meta{margin-top:10px;gap:6px 14px}
.sheet .meta span{font-size:15px;color:var(--ink)}
.sheet .meta .ic{color:var(--muted)}
.sheet .meta .stx .ic{color:var(--coral)}
.warn{display:flex;gap:8px;align-items:flex-start;background:var(--red-soft);color:var(--red);font-weight:700;font-size:15px;border-radius:14px;padding:10px 12px}
.warn .ic{margin-top:2px}
.sec3 h3{font-size:18px;font-weight:800;margin-bottom:10px;display:flex;justify-content:space-between;align-items:baseline}
.sec3 h3 span{font-size:15px;color:var(--coral);font-weight:800}
.mchips{display:flex;flex-wrap:wrap;gap:8px}
.mchips span{padding:8px 14px;border-radius:999px;background:var(--sunk);font-size:15px;font-weight:600}
.tips{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.tips li{display:grid;grid-template-columns:36px minmax(0,1fr);gap:10px;align-items:center;font-size:15px}
.tips li i{width:36px;height:36px;border-radius:12px;background:var(--sunk);display:grid;place-items:center;color:var(--muted);font-style:normal}
.tips li.good i{color:var(--ok)} .tips li.bad i,.tips li.al i{color:var(--red)}
.legs{display:grid;gap:8px}
.leg{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:14px;background:var(--sunk)}
.leg>.ic{color:var(--coral);width:22px;height:22px}
.leg .tx{flex:1;min-width:0}
.leg b{display:block;font-size:15px}
.leg span{font-size:13px;color:var(--muted)}
.leg a{font-size:14px;font-weight:800;color:var(--coral);display:flex;align-items:center;gap:4px}
.others{display:grid;gap:8px}
.other{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:14px;border:1px solid var(--line)}
.other .tx{flex:1;min-width:0}
.other b{display:block;font-family:var(--zh);font-size:15px;font-weight:600;overflow-wrap:anywhere}
.other span{font-size:13px;color:var(--muted)}
.sbtn{width:40px;height:40px;border-radius:50%;background:var(--sunk);display:grid;place-items:center;flex:none}
.sbtn .ic{width:18px;height:18px}
.sbtn .che{font-family:var(--zh);font-weight:700;font-size:17px}
.edits{display:flex;gap:8px}
.obtn{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:46px;border-radius:14px;border:1px solid var(--line);font-weight:700;font-size:15px;background:var(--surface)}
.obtn.danger{color:var(--red)}
.sheet .foot{flex:none;padding:12px 20px calc(12px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--line);background:var(--surface)}
.sheet .foot .btn-coral{width:100%;height:54px;border-radius:16px;font-size:17px}
.sheet .foot .row{display:flex;gap:8px}
.sheet .foot .row>*{flex:1}

/* 편집 폼 */
.form{display:grid;gap:16px}
.form label.f{display:grid;gap:6px;font-size:14px;font-weight:700;color:var(--muted)}
.form input[type=text],.form input[type=time],.form select,.form textarea{width:100%;border:1px solid var(--line);background:var(--bg);border-radius:12px;padding:11px 12px;font-size:16px;color:var(--ink);font-weight:500}
.form textarea{min-height:84px;resize:vertical;line-height:1.5}
.form .two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.form .hint{font-size:13px;color:var(--muted);font-weight:500}
.cats{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:8px}
.cats label{display:grid;justify-items:center;gap:4px;padding:8px 0;border-radius:14px;border:1.5px solid var(--line);font-size:13px;font-weight:700;color:var(--ink);cursor:pointer}
.cats label i{width:36px;height:36px;border-radius:50%;background:var(--cat);color:#fff;display:grid;place-items:center}
.cats input{position:absolute;opacity:0;pointer-events:none}
.cats label:has(input:checked){border-color:var(--coral);background:var(--coral-soft)}
.seg2{display:flex;gap:6px;flex-wrap:wrap}
.seg2 label{display:inline-flex;align-items:center;gap:6px;height:40px;padding:0 12px;border-radius:12px;border:1.5px solid var(--line);font-size:14px;font-weight:700;color:var(--ink);cursor:pointer}
.seg2 input{position:absolute;opacity:0;pointer-events:none}
.seg2 label:has(input:checked){border-color:var(--coral);background:var(--coral-soft);color:var(--coral)}
.tog{display:flex;align-items:center;justify-content:space-between;font-size:16px;font-weight:700;color:var(--ink)}
.tog input{width:24px;height:24px;accent-color:var(--coral)}
.hrows{display:grid;gap:8px}
.hrow{display:grid;grid-template-columns:40px minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 12px;border-radius:14px;background:var(--sunk)}
.hrow i{width:40px;height:40px;border-radius:12px;background:var(--surface);display:grid;place-items:center;font-style:normal}
.hrow i.reorder{color:var(--c-fun)} .hrow i.add{color:var(--ok)} .hrow i.delete{color:var(--red)} .hrow i.update{color:var(--coral)}
.hrow b{display:block;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hrow span{font-size:13px;color:var(--muted)}
.hrow button{height:36px;padding:0 12px;border-radius:10px;background:var(--surface);font-size:14px;font-weight:700;display:inline-flex;gap:4px;align-items:center}

/* 쇼핑 · 준비 */
.ptitle{padding-top:calc(env(safe-area-inset-top,0px) + 20px);display:flex;align-items:flex-end;justify-content:space-between;gap:12px}
.ptitle h1{font-size:30px;font-weight:800;letter-spacing:-.02em}
.ring{--p:0;width:60px;height:60px;border-radius:50%;background:conic-gradient(var(--coral) calc(var(--p)*1%),var(--line) 0);display:grid;place-items:center;flex:none}
.ring b{width:46px;height:46px;border-radius:50%;background:var(--bg);display:grid;place-items:center;font-size:14px;font-weight:800}
.stores{display:flex;gap:10px;overflow-x:auto;padding:2px 16px 10px;margin:0 -16px;scrollbar-width:none}
.stores::-webkit-scrollbar{display:none}
.store{flex:none;width:190px;display:grid;gap:10px;padding:14px;text-align:left}
.store[aria-pressed="true"]{box-shadow:0 0 0 2.5px var(--coral)}
.store .sh{display:flex;align-items:center;gap:10px}
.store .sh i{width:38px;height:38px;border-radius:12px;background:var(--coral-soft);color:var(--coral);display:grid;place-items:center;font-style:normal;flex:none}
.store .sh b{display:block;font-size:15px}
.store .sh span{font-size:13px;color:var(--muted);font-weight:600}
.thumbs{display:flex;align-items:center}
.thumbs img{width:34px;height:34px;border-radius:50%;object-fit:cover;background:#fff;border:2px solid var(--surface);margin-right:-8px}
.thumbs em{font-style:normal;margin-left:16px;font-size:13px;font-weight:700;color:var(--muted)}
.segs{display:flex;gap:8px;margin:6px 0 14px}
.segs button{height:38px;padding:0 16px;border-radius:19px;background:var(--surface);border:1px solid var(--line);font-size:14px;font-weight:700}
.segs button[aria-pressed="true"]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.items{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(min(calc(50% - 6px),210px),1fr))}
.item{overflow:hidden;display:grid;grid-template-rows:auto 1fr}
.item .im{background:#fff;aspect-ratio:1/1;position:relative}
.item .im img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;padding:6px}
.item .ck{position:absolute;right:8px;top:8px;width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.95);border:2px solid #d9d6d0;display:grid;place-items:center;color:transparent;cursor:pointer}
.item .ck input{position:absolute;inset:0;opacity:0;margin:0;cursor:pointer}
.item .ck .ic{stroke-width:3}
.item.got .ck{background:var(--ok);border-color:var(--ok);color:#fff}
.item.got .im img{opacity:.4}
.item .tx{padding:10px 12px 14px;display:grid;gap:2px;align-content:start}
.item h3{font-size:15px;font-weight:800}
.item .zh{font-size:13px;color:var(--muted)}
.item .wh{font-size:13px;color:var(--coral);font-weight:700;margin-top:4px}
.item .nt{font-size:13px;color:var(--red);font-weight:700}
.tiles{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(min(calc(50% - 5px),180px),1fr))}
.tile{padding:14px;display:grid;gap:4px;align-content:start}
.tile .ic{width:24px;height:24px;color:var(--coral)}
.tile.al .ic{color:var(--red)}
.tile b{font-size:17px;font-weight:800}
.tile span{font-size:13px;color:var(--muted)}
.check{list-style:none;margin:0;padding:0;display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr))}
.check label{display:grid;grid-template-columns:44px minmax(0,1fr) 28px;gap:12px;padding:14px;align-items:center;cursor:pointer}
.check i{width:44px;height:44px;border-radius:14px;background:var(--coral-soft);color:var(--coral);display:grid;place-items:center;font-style:normal}
.check b{display:block;font-size:16px}
.check .s{font-size:14px;color:var(--muted)}
.check input{width:26px;height:26px;accent-color:var(--coral);margin:0}
.check li.done b{text-decoration:line-through;color:var(--muted)}
.check li.done i{background:var(--ok);color:#fff}
.kw{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr))}
.kw .row{display:flex;gap:8px;align-items:center;padding:10px 12px}
.kw .row .tx{flex:1;min-width:0}
.kw .row b{display:block;font-family:var(--zh);font-size:15px;font-weight:600;overflow-wrap:anywhere}
.kw .row span{font-size:13px;color:var(--muted)}
details.more>summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:10px;font-size:16px;font-weight:800;padding:16px}
details.more>summary::-webkit-details-marker{display:none}
details.more>summary .ic:last-child{margin-left:auto;color:var(--muted)}
details.more>.kw{padding:0 12px 12px}
.vid{flex:none;width:250px;overflow:hidden;display:grid}
.vid .im{position:relative}
.vid img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block}
.vid .play{position:absolute;inset:0;display:grid;place-items:center}
.vid .play i{width:46px;height:32px;border-radius:10px;background:#e62117;color:#fff;display:grid;place-items:center}
.vid .t{padding:10px 12px 12px;display:grid;gap:4px}
.vid b{font-size:14px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.vid span{font-size:13px;color:var(--muted)}

/* 기사님께 보여주기 */
#driver{position:fixed;inset:0;z-index:2000;background:#0b1019;color:#fff;display:flex;flex-direction:column;justify-content:center;gap:18px;
  padding:calc(env(safe-area-inset-top,0px) + 24px) max(24px,env(safe-area-inset-right,0px)) calc(env(safe-area-inset-bottom,0px) + 24px) max(24px,env(safe-area-inset-left,0px))}
#driver .ask{font-family:var(--zh);font-size:clamp(26px,6vw,40px);color:#ffb199}
#driver .big{font-family:var(--zh);font-size:clamp(40px,11vw,88px);font-weight:700;line-height:1.2;overflow-wrap:anywhere}
#driver .ko{font-size:18px;color:#c5cfe0}
#driver .help{font-size:14px;color:#8d98ad}
#driver button{position:absolute;top:calc(env(safe-area-inset-top,0px) + 14px);right:max(14px,env(safe-area-inset-right,0px));background:#22314f;color:#fff;border-radius:12px;padding:10px 16px;font-size:16px;font-weight:700}
.toast{position:fixed;left:50%;width:max-content;bottom:calc(var(--navh) + env(safe-area-inset-bottom,0px) + 80px);transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:12px 16px;border-radius:14px;font-size:15px;font-weight:700;z-index:2100;max-width:calc(100% - 32px);display:flex;align-items:center;gap:12px;box-shadow:0 8px 24px rgba(0,0,0,.25)}
.toast button{color:var(--coral);font-weight:800}
@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}
</style>

</head><body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
<symbol id="i-utensils" viewBox="0 0 24 24"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/></symbol>
<symbol id="i-bag" viewBox="0 0 24 24"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0"/></symbol>
<symbol id="i-landmark" viewBox="0 0 24 24"><path d="M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 2l8 5H4z"/></symbol>
<symbol id="i-sparkles" viewBox="0 0 24 24"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM5 3v4M3 5h4M19 17v4M17 19h4"/></symbol>
<symbol id="i-perfume" viewBox="0 0 24 24"><path d="M10 2h4v4h-4zM9 6h6v3H9zM6 12a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3zM10 15.5h4"/></symbol>
<symbol id="i-leaf" viewBox="0 0 24 24"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10zM2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></symbol>
<symbol id="i-wine" viewBox="0 0 24 24"><path d="M8 22h8M7 10h10M12 15v7M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5z"/></symbol>
<symbol id="i-bed" viewBox="0 0 24 24"><path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9"/></symbol>
<symbol id="i-plane" viewBox="0 0 24 24"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></symbol>
<symbol id="i-train" viewBox="0 0 24 24"><path d="M2 17V7h11c4.5 0 7.8 4 9 10zM5 11h3M10.5 11h3M16 11h2.5M2 21h20"/></symbol>
<symbol id="i-subway" viewBox="0 0 24 24"><path d="M8 3.1V7a4 4 0 0 0 8 0V3.1M9 15l-1-1M15 15l1-1M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5zM8 19l-2 3M16 19l2 3"/></symbol>
<symbol id="i-car" viewBox="0 0 24 24"><path d="M5 17H3v-5l2.2-5.2A2 2 0 0 1 7 5.5h10a2 2 0 0 1 1.8 1.3L21 12v5h-2M3 12h18M9.5 17h5"/><circle cx="7.2" cy="17" r="2"/><circle cx="16.8" cy="17" r="2"/></symbol>
<symbol id="i-walk" viewBox="0 0 24 24"><path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0zM20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0zM16 17h4M4 13h4"/></symbol>
<symbol id="i-users" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/></symbol>
<symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></symbol>
<symbol id="i-yen" viewBox="0 0 24 24"><path d="M12 10v11M12 10 6 3M12 10l6-7M7 11h10M7 15h10"/></symbol>
<symbol id="i-star" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></symbol>
<symbol id="i-hourglass" viewBox="0 0 24 24"><path d="M5 22h14M5 2h14M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/></symbol>
<symbol id="i-alert" viewBox="0 0 24 24"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01"/></symbol>
<symbol id="i-map" viewBox="0 0 24 24"><path d="M9 3 3 5.5v15L9 18l6 2.5 6-2.5V3l-6 2.5zM9 3v15M15 5.5v15"/></symbol>
<symbol id="i-pin" viewBox="0 0 24 24"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></symbol>
<symbol id="i-nav" viewBox="0 0 24 24"><path d="M3 11l19-9-9 19-2-8z"/></symbol>
<symbol id="i-copy" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></symbol>
<symbol id="i-target" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/></symbol>
<symbol id="i-ext" viewBox="0 0 24 24"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></symbol>
<symbol id="i-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></symbol>
<symbol id="i-coffee" viewBox="0 0 24 24"><path d="M17 8h1a4 4 0 1 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4zM6 2v2M10 2v2M14 2v2"/></symbol>
<symbol id="i-id" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="12" r="2.5"/><path d="M14 10h4M14 14h4"/></symbol>
<symbol id="i-qr" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 21h-3v-3M21 14v.01M14 21v.01"/></symbol>
<symbol id="i-luggage" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="14" rx="2"/><path d="M9 6V3h6v3M10 10v6M14 10v6M8 20v2M16 20v2"/></symbol>
<symbol id="i-ticket" viewBox="0 0 24 24"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2zM13 5v2M13 17v2M13 11v2"/></symbol>
<symbol id="i-moon" viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/></symbol>
<symbol id="i-camera" viewBox="0 0 24 24"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/></symbol>
<symbol id="i-camoff" viewBox="0 0 24 24"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3zM3 3l18 18"/></symbol>
<symbol id="i-gift" viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/></symbol>
<symbol id="i-store" viewBox="0 0 24 24"><path d="M3 9l1.5-5h15L21 9M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M5 12v8h14v-8M10 20v-5h4v5"/></symbol>
<symbol id="i-cart" viewBox="0 0 24 24"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></symbol>
<symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></symbol>
<symbol id="i-phone" viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></symbol>
<symbol id="i-up" viewBox="0 0 24 24"><path d="M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88z"/></symbol>
<symbol id="i-down" viewBox="0 0 24 24"><path transform="rotate(180 12 12)" d="M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88z"/></symbol>
<symbol id="i-shuffle" viewBox="0 0 24 24"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22M18 2l4 4-4 4M2 6h1.9c1.5 0 2.9.9 3.6 2.2M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8M18 14l4 4-4 4"/></symbol>
<symbol id="i-repeat" viewBox="0 0 24 24"><path d="m17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3"/></symbol>
<symbol id="i-receipt" viewBox="0 0 24 24"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1zM8 8h8M8 12h8M8 16h5"/></symbol>
<symbol id="i-card" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/></symbol>
<symbol id="i-cash" viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></symbol>
<symbol id="i-award" viewBox="0 0 24 24"><circle cx="12" cy="8" r="6"/><path d="M15.48 12.89 17 22l-5-3-5 3 1.52-9.11"/></symbol>
<symbol id="i-home" viewBox="0 0 24 24"><path d="M3 10 12 3l9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V13h6v9"/></symbol>
<symbol id="i-cal" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></symbol>
<symbol id="i-check" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></symbol>
<symbol id="i-tick" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></symbol>
<symbol id="i-door" viewBox="0 0 24 24"><path d="M13 4h3a2 2 0 0 1 2 2v14M2 20h3M13 20h9M10 12v.01M13 4.56v16.16a1 1 0 0 1-1.24.97L5 20V5.56a2 2 0 0 1 1.52-1.94l4-1A2 2 0 0 1 13 4.56z"/></symbol>
<symbol id="i-percent" viewBox="0 0 24 24"><path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></symbol>
<symbol id="i-shirt" viewBox="0 0 24 24"><path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/></symbol>
<symbol id="i-waves" viewBox="0 0 24 24"><path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/></symbol>
<symbol id="i-fish" viewBox="0 0 24 24"><path d="M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.47-3.44 6-7 6s-7.56-2.53-8.5-6zM18 12v.5M16 17.93a9.77 9.77 0 0 1 0-11.86M7 10.67C7 8 5.58 5.97 2.73 5.5c-1 1.5-1 5 .23 6.5-1.24 1.5-1.24 5-.23 6.5C5.58 18.03 7 16 7 13.33"/></symbol>
<symbol id="i-building" viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/></symbol>
<symbol id="i-music" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></symbol>
<symbol id="i-zap" viewBox="0 0 24 24"><path d="M13 2 3 14h9l-1 8 10-12h-9z"/></symbol>
<symbol id="i-ruler" viewBox="0 0 24 24"><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0zM14.5 12.5l2-2M11.5 9.5l2-2M8.5 6.5l2-2M17.5 15.5l2-2"/></symbol>
<symbol id="i-lock" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></symbol>
<symbol id="i-ban" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></symbol>
<symbol id="i-play" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></symbol>
<symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
<symbol id="i-pencil" viewBox="0 0 24 24"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></symbol>
<symbol id="i-trash" viewBox="0 0 24 24"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></symbol>
<symbol id="i-history" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M12 7v5l4 2"/></symbol>
<symbol id="i-x" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></symbol>
<symbol id="i-chevl" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></symbol>
<symbol id="i-chevr" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></symbol>
<symbol id="i-undo" viewBox="0 0 24 24"><path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></symbol>
</svg>

<main>
  <section class="view" id="v-overview" data-view="overview"></section>
  <section class="view" id="v-day" data-view="day" hidden>
    <div class="appbar"><div class="in px"><a class="ibtn" href="#overview" aria-label="홈으로"><svg class="ic"><use href="#i-chevl"/></svg></a><h2 id="dayTitle"></h2><button class="ibtn" id="mapToggle" type="button" aria-label="지도 접기 · 펴기" aria-pressed="true"><svg class="ic"><use href="#i-map"/></svg></button></div>
      <nav class="strip px" id="strip" aria-label="날짜"></nav></div>
    <div id="dayWrap"></div>
  </section>
  <section class="view px" id="v-shop" data-view="shop" hidden></section>
  <section class="view px" id="v-prep" data-view="prep" hidden></section>
</main>

<button class="fab" id="fab" type="button" hidden><svg class="ic"><use href="#i-plus"/></svg>일정 추가</button>

<nav class="tabs" aria-label="화면"><div class="in">
  <a href="#overview" data-v="overview"><svg class="ic" aria-hidden="true"><use href="#i-home"/></svg>홈</a>
  <a href="#day0" data-v="day" id="planTab"><svg class="ic" aria-hidden="true"><use href="#i-cal"/></svg>일정</a>
  <a href="#shop" data-v="shop"><svg class="ic" aria-hidden="true"><use href="#i-bag"/></svg>쇼핑</a>
  <a href="#prep" data-v="prep"><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg>준비</a>
</div></nav>

<div class="scrim" id="scrim" hidden></div>
<div class="sheet" id="sheet" role="dialog" aria-modal="true" hidden></div>

<div id="driver" hidden role="dialog" aria-modal="true" aria-label="기사님께 보여줄 화면">
  <button type="button" id="driverClose">닫기</button>
  <p class="ask">请带我去这里</p>
  <p class="big" id="driverZh"></p>
  <p class="ko zh" id="driverAddr" lang="zh-CN" style="font-size:clamp(22px,5vw,34px);color:#fff"></p>
  <p class="ko" id="driverKo"></p>
  <p class="help">「칭 따이 워 취 쩌리」 = 여기로 데려다 주세요. 화면을 기사님께 그대로 보여 주세요.</p>
</div>

<script src="/neander/2026shanghai/leaflet.min.js"></script>
<script>
"use strict";
/* ── 일정 데이터 ── 기본값은 아래 JSON, 누가 고쳤으면 서버(API)의 최신판을 쓴다 */
const DEFAULT_PLAN={"days":[{"id":"day0","n":1,"date":[2026,11,27],"wd":"금","title":"선발대 · 디즈니랜드","ppl":"2명","ic":"sparkles","cover":"p9","fit":["pvg","dis","yang","htl"],"items":[{"t":"15:30","k":"fly","title":"푸동공항 도착","sub":"上海浦东国际机场","img":"p5","pin":"pvg","pts":["pvg","dhub"],"i":[["users","선발대 2명"],["alert","도착 시각 가정"]],"tip":[["luggage","캐리어 · 56×36×23cm 넘는 가방은 파크 반입 금지"],["bed","공항 → 호텔 짐 배송이 제일 편해요"],["lock","못 맡기면 파크 짐 보관 ¥80/개 · 작은 짐 ¥10"]],"id":"s1"},{"t":"16:30","k":"fun","title":"디즈니 · 주토피아","sub":"上海迪士尼乐园","img":"p6","pin":"dis","pts":["dis"],"go":[{"m":"taxi","d":"20~30분","c":"¥80~130","n":"내리는 곳 上海迪士尼度假区西公交枢纽","from":"pvg","to":"dhub"}],"i":[["clock","08:30–21:30"],["yen","가격 미확인 · 다른 금 ¥499"],["id","여권 원본"]],"w":"11/27 1일권 매진 의심 → 공식 앱 · 트립닷컴 · 클룩 확인","tip":[["zap","주토피아 핫 퍼슈트 DPA ¥180대"],["clock","대기 시간은 당일 앱으로"]],"id":"s2"},{"t":"17:45","k":"fun","title":"트론 · 미키 스노우 매직","sub":"TRON · Mickey's Snow Magic","img":"p7","pin":"dis","pts":[],"i":[["ruler","트론 122cm↑"],["music","스노우 매직 17:45 · 19:15"]],"tip":[["moon","트론은 조명 켜진 밤이 최고"],["zap","트론 DPA 가격 미확인"]],"id":"s3"},{"t":"18:15","k":"fun","title":"겨울 퍼레이드 · 캐리비안","sub":"Winter Magic Cavalcade","img":"p8","pin":"dis","pts":[],"i":[["clock","퍼레이드 18:15"]],"tip":[["users","퍼레이드 때 다른 줄이 짧아져요"],["utensils","저녁은 가볍게 — 양꼬치 배 남기기"]],"id":"s4"},{"t":"20:00","k":"fun","title":"ILLUMINATE 불꽃쇼","sub":"성 앞 불꽃 + 프로젝션","img":"p9","pin":"dis","pts":[],"i":[["clock","20:00 · 21:15"],["sparkles","Magic Together 20:15 · 21:30"]],"tip":[["repeat","21:30 폐장까지 트론 · 주토피아 한 번 더"],["car","폐장 직후 택시 줄 김 → 디디 미리 · 11호선"]],"id":"s5"},{"t":"22:30","k":"food","star":1,"title":"오래전 양꼬치","sub":"很久以前羊肉串 · 南京路第一百货 B관 6층","img":"p10","pin":"yang","pts":["yang"],"go":[{"m":"taxi","d":"45~60분","n":"지하철은 1시간 넘게","from":"dis","to":"yang"}],"i":[["users","원격 줄서기"],["alert","마감 미확인"]],"w":"디즈니 나올 때 위챗 「排队订座」로 줄 서며 마감 확인","menu":["쯔란 양꼬치 12개 ¥69.8","막창","단맛 옥수수","烤馒头","칭다오"],"tip":[["hourglass","저녁 200팀 대기도 · QR로 미리 줄 서서 30분"],["shuffle","닫았으면 南京西路818广场店"]],"id":"s6"},{"t":"24:00","k":"spa","title":"캉다오 발마사지","sub":"康道天地(南京路店) · 10층","img":"p11","pin":"kang","pts":["kang"],"go":[{"m":"walk","d":"10분","from":"yang","to":"kang"}],"i":[["clock","24시간"],["hourglass","발+전신 90분"],["cash","4~6만원"]],"w":"01시 넘으면 마사지사 2명 → 예약 필수","id":"s7"},{"t":"01:30","nd":1,"k":"stay","title":"숙소 체크인 · 방 A","sub":"上海虹桥美爵酒店","pin":"htl","pts":["htl"],"go":[{"m":"taxi","d":"30분","from":"kang","to":"htl"}],"tip":[["luggage","짐 배송 맡겼으면 프런트에서 찾기"]],"id":"s8","img":"g_hotel"}]},{"id":"day1","n":2,"date":[2026,11,28],"wd":"토","title":"4명 합류 · 관샤 → 점도덕 → 금붕어","ppl":"2+2","ic":"users","cover":"p1","fit":["htl","zd","bfc"],"items":[{"t":"10:00","k":"stay","title":"선발대 휴식","sub":"디즈니 + 새벽 마사지 다음 날","pin":"htl","pts":[],"i":[["coffee","조식 06:00~ · 현장 추가"]],"tip":[["perfume","쉬스(叙室) 맞춤 조향 · 차로 10~15분 · 30ml ¥388 · 위챗 narratus 예약"]],"id":"s9","img":"g_hotel"},{"t":"15:30","k":"fly","title":"토요일 조 도착","sub":"上海浦东国际机场 → 숙소 · 방 B","pin":"pvg","pts":["pvg"],"i":[["users","2명"],["alert","도착 시각 가정"]],"tip":[["clock","16:15 출발 → 17:30 전 숙소"]],"id":"s10","img":"p5"},{"t":"17:40","k":"meet","title":"4명 합류 · 출발","sub":"숙소 → 관샤","pin":"htl","pts":["htl"],"go":[{"m":"taxi","d":"60~90분","n":"또는 공항연결선 → 虹桥2号航站楼 40분 ¥26 + 택시","from":"pvg","to":"htl"}],"i":[["car","6인승(六座) 1대 · 일반 2대"]],"w":"19:00 넘으면 관샤 건너뛰고 점도덕으로","id":"s11","img":"g_ride"},{"t":"18:05","k":"scent","star":1,"title":"관샤 플래그십 闲庭","sub":"观夏闲庭 · 湖南路111号","pin":null,"pts":["gxxt","gxxp"],"go":[{"m":"taxi","d":"25분"}],"i":[["clock","~20:00"],["hourglass","30~40분"],["ticket","무료"]],"tip":[["home","옛 서양 주택 · 1층 시향 · 2층 공방"],["users","18:00 점도덕 원격 줄서기 시작"],["pin","지도 핀 없음 → 고덕 검색으로"],["perfume","근처 观夏香铺 즉석 블렌딩 · 시간 미확인"]],"id":"s12","img":"g_scent"},{"t":"19:20","k":"food","star":1,"title":"점도덕 딤섬","sub":"点都德·德小馆(正大店) · 6층 614","pin":"zd","pts":["zd"],"go":[{"m":"taxi","d":"35분","n":"18:45 출발 · 延安路 터널"}],"i":[["star","Ctrip 4.2"],["yen","1인 ¥114"],["users","예약 X · 원격 줄"]],"menu":["金莎海虾红米肠 ×2","虾饺皇 ×2","烧卖","叉烧包","凤爪","干炒牛河","白灼菜心","乳鸽"],"menuSum":"4명 ¥450~550","tip":[["info","德小馆 = 점도덕 자매 브랜드 · 볶음 요리 더 있음"],["phone","따종디엔핑 → 排队 · 한국 번호 가입은 출국 전 시험"],["up","홍미창펀 · 하가우 칭찬"],["down","주문 뒤 쪄서 하나씩 늦게 나옴"],["card","QR 주문 · 알리페이 · ¥200↑ 나눠 내기 · 차 1인 ¥8"],["alert","마감 미확인 (다른 지점 21:30)"]],"id":"s13","img":"g_dimsum"},{"t":"20:50","k":"fun","star":1,"title":"금붕어 극장","sub":"金鱼剧场 · BFC 남구 B2","pin":"bfc","pts":["bfc"],"go":[{"m":"taxi","d":"15분","n":"또는 ¥2 페리 东昌路 → 金陵东路","from":"zd","to":"bfc"}],"i":[["clock","입장 ~21:30"],["yen","¥158 · 할인 ¥98"],["hourglass","1시간"]],"tip":[["ticket","SmartShanghai에서 미리 구매"],["fish","살아 있는 금붕어 + 빛·물·소리·향 10개 공간"],["building","푸싱 미술관 회전 외벽 구경"],["moon","十六铺 강변 야경 · 22:00 소등"]],"id":"s14","img":"g_goldfish"},{"t":"22:00","k":"stay","title":"숙소로","sub":"上海虹桥美爵酒店","pin":"htl","pts":[],"go":[{"m":"taxi","d":"35~40분","from":"bfc","to":"htl"}],"tip":[["clock","내일 08:15 출발"]],"id":"s15","img":"g_hotel"}]},{"id":"day2","n":3,"date":[2026,11,29],"wd":"일","title":"예원 → 우캉루 → 교통대 → 장자강 → 와이탄","ppl":"4명","ic":"train","cover":"p16","fit":["yuy","sjtu","wk","hq","vue","htl"],"items":[{"t":"09:00","k":"sight","title":"예원","sub":"豫园 · 구곡교 · 성황묘","img":"p14","pin":"yuy","pts":["yuy"],"go":[{"m":"subway","d":"10호선 직행","n":"08:15 출발 · 伊犁路역까지 걸어서 15분 · 택시 30~40분","from":"htl","to":"yuy"}],"i":[["clock","09:00 · 입장 16:00까지"],["yen","¥40"],["hourglass","1~1.5시간"]],"tip":[["users","주말 → 문 열자마자"]],"id":"s16"},{"t":"11:30","k":"food","title":"남상만두점","sub":"南翔馒头店(豫园路店)","img":"p15","pin":"nx","pts":["nx","lbl"],"go":[{"m":"walk","d":"바로 옆","from":"yuy","to":"nx"}],"i":[["award","미슐랭 가이드"],["hourglass","주말 1시간↑ 대기"]],"menu":["1층 포장 小笼 6개 ¥30","2층 小笼 ¥38","2층 蟹粉小笼 ¥48","3층 蟹黄汤包 ¥49/개"],"tip":[["phone","룸 예약 +86 21 6355 4206"],["down","값에 비해 그저 그렇다는 후기 꾸준"],["shuffle","대안 녹파랑 · 정문 공사 표시 → 021-63280602"]],"id":"s17"},{"t":"12:45","k":"scent","title":"우캉루 향수 산책","sub":"武康路 · 르라보 · 화메이","pin":"wk","pts":["lelabo","harmay","wk"],"go":[{"m":"subway","d":"15분","n":"10호선 豫园 → 交通大学 + 걸어서 10분","from":"nx","to":"wk"}],"i":[["leaf","은행잎 절정"],["camera","武康路390号 은행나무"]],"tip":[["perfume","르라보 × 징야 135号 · 상하이 한정 Myrrhe 55"],["store","화메이 55号 · 4층 뷰티 편집숍 · 영업 확인"],["qr","13:00 「参观交大」 4명 등록"]],"id":"s18","img":"g_wukang"},{"t":"14:30","k":"meet","star":1,"title":"상해교통대","sub":"上海交通大学 徐汇校区 · 华山路1954号","img":"p16","pin":"sjtu","pts":["sjtu"],"go":[{"m":"walk","d":"10분","n":"14:15 출발","from":"wk","to":"sjtu"}],"i":[["id","4명 여권"],["qr","参观交大 당일 등록"]],"tip":[["subway","15:30 10호선 → 虹桥火车站행 (航中路행 X)"]],"id":"s19"},{"t":"16:17","k":"rail","title":"고속철 → 장자강","sub":"G7138 上海虹桥 → 张家港","img":"p18","pin":"hq","pts":["hq"],"go":[{"m":"subway","d":"30분","n":"15:30 출발 · 10호선 직행","from":"sjtu","to":"hq"}],"i":[["clock","16:00 집합"],["hourglass","50분"],["yen","¥53"]],"tip":[["ticket","트립닷컴 · 12306 · 여권으로 4장 미리"],["shuffle","대안 D2136 16:11 · C3802 상하이역 15:46"]],"id":"s20"},{"t":"17:07","k":"meet","title":"장자강 · Kubert 씨 저녁","sub":"张家港站","img":"p19","pin":"zjg","pts":["zjg"],"go":[{"m":"train","d":"50분","n":"G7138","from":"hq","to":"zjg"}],"i":[["utensils","역 근처 식당"]],"tip":[["train","귀가 D5565 19:29 → 20:21 · ¥54"],["shuffle","일찍 G2573 19:04 · 늦게 G8285 20:35"]],"id":"s21"},{"t":"21:10","k":"sight","title":"와이탄 야경 · 스냅","sub":"外滩 · 남경동로 끝 강변","img":"p20","pin":"bund","pts":["bund"],"go":[{"m":"train","d":"52분","n":"D5565 19:29 → 20:21","from":"zjg","to":"hq"},{"m":"subway","d":"40분","n":"2호선 → 南京东路 · 택시 35~45분","from":"hq","to":"bund"}],"i":[["sparkles","조명 ~22:00"],["camera","스냅 1장 ¥30 · 5장 ¥140대"]],"w":"21:30 전에 도착","id":"s22"},{"t":"22:00","k":"night","title":"VUE 루프탑 바","sub":"Hyatt on the Bund 32~33층","img":"p21","pin":"vue","pts":["vue"],"go":[{"m":"walk","d":"15분","from":"bund","to":"vue"}],"i":[["clock","~01:30"],["yen","¥128~158 · 미확인"],["shirt","스마트 캐주얼"]],"tip":[["waves","야외 자쿠지 · 와이탄 + 루자쭈이 뷰"],["moon","야식 홍쿠이지아 · 클럽 INS"]],"id":"s23"},{"t":"24:00","k":"stay","title":"숙소로","sub":"上海虹桥美爵酒店","pin":"htl","pts":[],"go":[{"m":"taxi","d":"30분","from":"vue","to":"htl"}],"tip":[["luggage","짐 미리 싸 두기 · 월 07:50 체크아웃"]],"id":"s24","img":"g_hotel"}]},{"id":"day3","n":4,"date":[2026,11,30],"wd":"월","title":"칭즈 → 짝퉁시장 → 난징동루 → 귀국","ppl":"4명","ic":"plane","cover":"p27","fit":["dhc","ap","jj"],"items":[{"t":"07:50","k":"stay","title":"체크아웃 · 캐리어 맡기기","sub":"上海虹桥美爵酒店","pin":"htl","pts":["htl"],"tip":[["luggage","프런트에 캐리어 → 13:25 찾으러"]],"id":"s25","img":"g_lobby"},{"t":"08:30","k":"food","title":"대호춘 생지엔","sub":"大壶春(四川中路店)","img":"p24","pin":"dhc","pts":["dhc"],"go":[{"m":"taxi","d":"30~40분","from":"htl","to":"dhc"}],"i":[["award","빕 구르망"],["yen","1인 ¥27"],["clock","08:00–21:00"]],"menu":["虾仁生煎 새우 생지엔","生煎 4개 ¥9~13"],"tip":[["cash","카드 · 현금 자료 엇갈림 → 현금 조금"],["hourglass","셀프 주문 · 줄 길기도"]],"id":"s26"},{"t":"09:00","k":"shop","title":"칭즈 핸드크림","sub":"青稚 南京东路66号","img":"p26","pin":"qz","pts":["qz"],"go":[{"m":"walk","d":"5분","from":"dhc","to":"qz"}],"i":[["clock","09:00–24:00"],["yen","¥50~55"]],"tip":[["gift","각인 · 포장 3개 30분 → 급하면 포장만"]],"id":"s27"},{"t":"10:00","k":"shop","title":"AP Plaza 짝퉁시장","sub":"亚太盛汇 · 上海科技馆역 지하","img":"p17","pin":"ap","pts":["ap"],"go":[{"m":"subway","d":"15분","n":"09:35 출발 · 2호선 南京东路 → 上海科技馆","from":"qz","to":"ap"}],"i":[["clock","10:00–20:00"],["hourglass","1시간"]],"w":"짝퉁은 한국 세관에서 압수될 수 있어요","tip":[["door","좋은 건 호객꾼 따라 「창고」"],["camoff","촬영에 예민"],["percent","부른 값 절반 이하로"]],"id":"s28"},{"t":"11:20","k":"shop","title":"팝마트 · 미니소랜드","sub":"POP MART 南京东路299号 · 名创优品 479号","img":"p27","pin":"pop","pts":["pop","mns","mms"],"go":[{"m":"subway","d":"15분","n":"11:00 출발 · 2호선 → 南京东路","from":"ap","to":"pop"}],"i":[["clock","팝마트 10:00–23:00"]],"tip":[["gift","라부부 · 스컬판다 랜덤박스"],["store","미니소 479号 全球壹号店 · M&M's · 레고"]],"id":"s29"},{"t":"11:45","k":"shop","title":"올레 마트","sub":"Ole精品超市 · 新世界新丸中心","pin":"ole","pts":["ole"],"go":[{"m":"walk","d":"5분","from":"pop","to":"ole"}],"i":[["alert","영업시간 미확인"]],"tip":[["cart","마카다미아 · 에그롤 · 오이맛 칩 · 하이디라오 소스"],["yen","수입 식품 위주라 조금 비쌀 수"]],"id":"s30","img":"g_mart"},{"t":"12:05","k":"shop","title":"제일식품상점","sub":"上海市第一食品商店 · 南京东路720号","img":"p28","pin":"ff","pts":["ff"],"go":[{"m":"walk","d":"10분","from":"ole","to":"ff"}],"tip":[["gift","화이트래빗 무게로 · 대추누가 · 나비파이"],["receipt","¥200↑ 여권 내고 택스리펀"]],"id":"s31"},{"t":"12:20","k":"food","title":"자자탕바오","sub":"佳家汤包 · 黄河路127号","pin":"jj","pts":["jj","gj"],"go":[{"m":"walk","d":"5분","from":"ff","to":"jj"}],"i":[["star","Trip 4.4"],["yen","1인 ¥35~41"],["clock","07:30–20:30"]],"w":"옆집 佳乐汤包 아님 · 간판 佳家 확인","menu":["게살 탕바오","황금 게살 비빔면"],"tip":[["gift","앞 국제반점 나비파이 · 줄 길면 패스"]],"id":"s32","img":"g_tangbao"},{"t":"13:25","k":"stay","title":"캐리어 찾기","sub":"上海虹桥美爵酒店 · 프런트","pin":"htl","pts":[],"go":[{"m":"taxi","d":"30~40분","n":"12:50 출발","from":"jj","to":"htl"}],"tip":[["car","캐리어 4개 → 6인승(六座商务) 1대 · 일반 2대"]],"id":"s33","img":"g_lobby"},{"t":"13:35","k":"fly","title":"푸동공항 · 16:50 출발","sub":"上海浦东国际机场","img":"p5","pin":"pvg","pts":["pvg"],"go":[{"m":"taxi","d":"60~70분","n":"약 50km","from":"htl","to":"pvg"}],"i":[["clock","14:40쯤 도착"]],"tip":[["receipt","체크인 → 세관 택스리펀 도장 → 출국심사 → 환급 창구"],["bag","출국장 막판 간식 쇼핑"],["alert","늦어지면 칭즈 · 제일식품부터 빼기"]],"id":"s34"}]}],"places":{"pvg":["푸동공항","上海浦东国际机场",121.808405,31.140627],"htl":["숙소 · 그랜드 머큐어 훙차오","上海虹桥美爵酒店",121.396887,31.205961,"长宁区仙霞路369号"],"dhub":["디즈니 택시 하차장","上海迪士尼度假区西公交枢纽",121.668268,31.145833],"dis":["디즈니랜드","上海迪士尼乐园",121.660536,31.144071],"yang":["오래전 양꼬치","很久以前羊肉串(南京路第一百货店)",121.474374,31.235746],"kang":["캉다오 발마사지","康道天地(南京路店)",121.481325,31.236025],"yuy":["예원","豫园",121.492449,31.226944],"nx":["남상만두점","南翔馒头店(豫园路店)",121.491579,31.226553],"lbl":["녹파랑","绿波廊酒楼(豫园总店)",121.491868,31.226432],"sjtu":["상해교통대","上海交通大学徐汇校区",121.433025,31.199027],"ap":["AP Plaza 짝퉁시장","亚太盛汇购物广场(上海科技馆站)",121.542961,31.21976],"hq":["상하이 훙차오역","上海虹桥站",121.320623,31.194151],"zjg":["장자강역","张家港站",120.673511,31.817305],"bund":["와이탄 야경","外滩(陈毅广场)",121.49108,31.236525],"vue":["VUE 루프탑 바","VUE Bar(上海外滩茂悦大酒店32-33楼)",121.492848,31.244963],"dhc":["대호춘 생지엔","大壶春(四川中路店)",121.489259,31.234732],"rt":["따룬파 마트","大润发(平型关店)",121.466473,31.266769],"qz":["칭즈 핸드크림","青稚护手霜(上海南京东路店)",121.488347,31.238808],"gx":["관샤 와이탄점","观夏(上海洛克外滩源体验店)",121.48829,31.241835],"pop":["팝마트 플래그십","POP MART泡泡玛特(全球旗舰店)",121.484714,31.237309],"mns":["미니소랜드","名创优品IP乐园(全球壹号店)",121.481325,31.236025],"mms":["M&M's 월드","M&M's巧克力世界(南京东路店)",121.476082,31.234756],"ff":["제일식품상점","上海市第一食品商店(南京东路720号)",121.476689,31.23561],"jj":["자자탕바오","佳家汤包(黄河路店)",121.470596,31.235088],"gj":["국제반점 나비파이","国际饭店(蝴蝶酥 南京西路170号)",121.471539,31.233674],"ole":["올레 마트","Ole精品超市(新世界新丸中心店)",121.485967,31.23831],"phw":["포토위드","PHOTOWITH自助照相馆(何东旧居店)",121.452464,31.230397],"sbr":["스벅 리저브 로스터리","星巴克臻选上海烘焙工坊(兴业太古汇)",121.463088,31.229078],"lv":["루이비통 더 루이","路易号 The Louis(兴业太古汇)",121.463568,31.228695],"yyl":["예원 (왕홍체험)","豫园老街",121.491391,31.227392],"hkj":["홍쿠이지아","红盔甲·小龙虾(人民广场店)",121.480363,31.227072],"ins":["클럽 INS","INS新乐园(雁荡路109号)",121.47025,31.217865],"sht":["상하이타워 전망대","上海中心大厦(上海之巅观光厅)",121.505682,31.233629],"cru":["황푸강 크루즈","黄浦江游览(十六铺码头)",121.498233,31.228588],"ljs":["라오지스","老吉士酒家(天平路店)",121.437942,31.20282],"wk":["우캉맨션","武康大楼",121.438278,31.20443],"zd":["점도덕 · 德小馆 정대점","点都德·德小馆(正大店)",121.499171,31.236682,"陆家嘴西路168号 正大广场 西区6楼614室"],"bfc":["금붕어 극장 · BFC","金鱼剧场(BFC外滩金融中心 南区B2)",121.497881,31.226642,"黄浦区中山东二路600号"],"gxxt":["관샤 플래그십 闲庭","观夏闲庭 湖南路111号",null,null,"徐汇区湖南路111号"],"gxxp":["관샤 香铺 (신규)","观夏香铺 淮海中路857号",null,null,"淮海中路857-861号"],"lelabo":["르라보 × 징야 (우캉루)","LE LABO 武康路135号",null,null,"徐汇区武康路135号"],"harmay":["화메이 안푸루 플래그십","HARMAY话梅 安福路",null,null,"武康路55号 (安福路口)"],"vr":["《烧火工》 VR · 과학기술관","上海科技馆 烧火工沉浸体验空间",121.542073,31.218459,"浦东新区世纪大道2000号 B1"]}};
const API="/api/neander/trip/2026shanghai"; // 저장소 빌드에서 "/api/neander/trip/2026shanghai" 로 바뀐다 (아티팩트판은 읽기 전용)
let PLAN=DEFAULT_PLAN,PV=0,P={},DAYS=[],FLAT=[],BYID={};
const TRIP_END=[2026,11,30,16,50];
const enc=encodeURIComponent;
const hasXY=k=>!!(k&&P[k]&&P[k][2]!=null&&P[k][3]!=null);
const amap=k=>{const p=P[k];if(!hasXY(k))return \`https://uri.amap.com/search?keyword=\${enc(p[1])}&city=\${enc("上海")}&src=shanghai_trip&callnative=1\`;return \`https://uri.amap.com/marker?position=\${p[2]},\${p[3]}&name=\${enc(p[1])}&src=shanghai_trip&coordinate=gaode&callnative=1\`};
const MODE={walk:["walk","도보","walk"],taxi:["car","택시","car"],subway:["subway","지하철","bus"],train:["train","고속철",null]};
const CAT={food:["utensils","식사"],shop:["bag","쇼핑"],sight:["landmark","관광"],fun:["sparkles","체험"],scent:["perfume","향"],spa:["leaf","마사지"],night:["wine","바"],stay:["bed","숙소"],fly:["plane","공항"],rail:["train","기차"],meet:["users","약속"]};
const navUrl=(a,b,m)=>{const A=P[a],B=P[b];return \`https://uri.amap.com/navigation?from=\${A[2]},\${A[3]},\${enc(A[1])}&to=\${B[2]},\${B[3]},\${enc(B[1])}&mode=\${m}&policy=1&src=shanghai_trip&coordinate=gaode&callnative=1\`};

/* ── 시간 (상하이 = UTC+8) ── */
const sh=(y,mo,d,h,mi)=>Date.UTC(y,mo-1,d,h-8,mi);
const shNow=()=>new Date(Date.now()+8*3600e3);
const pad=n=>String(n).padStart(2,"0");
function dur(ms){const m=Math.round(ms/60000);if(m<60)return m+"분";const h=Math.floor(m/60),r=m%60;return h+"시간"+(r?" "+r+"분":"")}

const DEF_IMG={};DEFAULT_PLAN.days.forEach(D=>D.items.forEach(it=>{if(it.img)DEF_IMG[it.id]=it.img}));
function applyPlan(plan,v){
  plan.days.forEach(D=>D.items.forEach(it=>{if(!it.img&&DEF_IMG[it.id])it.img=DEF_IMG[it.id]}));
  PLAN=plan;PV=v||0;P=plan.places;DAYS=plan.days;FLAT=[];BYID={};
  DAYS.forEach(D=>D.items.forEach((it,i)=>{const [h,m]=it.t.split(":").map(Number);it.at=sh(D.date[0],D.date[1],D.date[2],h,m)+(h<5?864e5:0);it.day=D;it.idx=i;BYID[it.id]=it;FLAT.push(it)}));
  FLAT.sort((a,b)=>a.at-b.at);
  DAYS.forEach(spans);
}
function status(){
  const now=Date.now();const first=FLAT[0];const end=sh(...TRIP_END);
  if(!first)return {d:"",a:"",go:null};
  if(now<first.at){
    const a=shNow();const today=Date.UTC(a.getUTCFullYear(),a.getUTCMonth(),a.getUTCDate());const fd=first.day.date;const dd=Math.round((Date.UTC(fd[0],fd[1]-1,fd[2])-today)/864e5);
    return {live:false,d:dd>0?\`D-\${dd}\`:"D-DAY",next:first};
  }
  if(now>end)return {live:false,d:"끝",next:null};
  let cur=null,next=null;for(const it of FLAT){if(it.at<=now)cur=it;else{next=it;break}}
  return {live:true,d:"여행 중",cur,next};
}

/* ── 그리기 도우미 ── */
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const zhSpan=s=>esc(s).replace(/([㐀-鿿][㐀-鿿\\w\\-（）()·]*)/g,'<span class="zh" lang="zh-CN">$1</span>');
const I=(n,c="")=>\`<svg class="ic \${c}" aria-hidden="true"><use href="#i-\${n}"/></svg>\`;
const CHE=\`<span class="che" aria-hidden="true">车</span>\`;
const DAYOF=id=>DAYS.find(d=>d.id===id);
function prevPin(it){const D=it.day;const p=D.items[it.idx-1];return p&&hasXY(p.pin)?p.pin:null}
function legOf(it,g){return {from:g.from||(g===it.go[0]?prevPin(it):null),to:g.to||it.pin}}
function legUrl(it,g){const {from,to}=legOf(it,g);const m=MODE[g.m][2];return (m&&hasXY(from)&&hasXY(to))?navUrl(from,to,m):null}
const mainPlace=it=>it.pin||it.pts[0]||null;
function goUrl(it){const g=(it.go||[])[(it.go||[]).length-1];const u=g&&legUrl(it,g);if(u)return u;const k=mainPlace(it);return k?amap(k):null}
function photo(it,cls="thumb"){return it.img?\`<img class="\${cls}" loading="lazy" src="/neander/2026shanghai/img/\${it.img}.jpg" alt="">\`:\`<span class="\${cls} k-\${it.k}" style="background:var(--cat)">\${I(CAT[it.k][0])}</span>\`}
function metaHtml(it,max=9){return (it.i||[]).slice(0,max).map(([ic,tx])=>\`<span class="\${ic==="alert"?"al":""} \${ic==="star"?"stx":""}">\${I(ic)}\${zhSpan(tx)}</span>\`).join("")}

/* ── 홈 ── */
function renderOverview(){
  const S=status();const a=shNow();const ymd=[a.getUTCFullYear(),a.getUTCMonth()+1,a.getUTCDate()].join("-");
  const today=DAYS.find(D=>D.date.join("-")===ymd);
  const focus=S.live?(S.cur||S.next):S.next;
  const nx=focus?\`<div class="card next k-\${focus.k}">\${S.live&&focus===S.cur?'<div class="lab"><span class="live">지금</span></div>':""}<a href="#\${focus.day.id}" data-open="\${focus.id}">\${photo(focus)}</a><a href="#\${focus.day.id}" data-open="\${focus.id}" style="min-width:0"><div class="t tnum">\${focus.t}</div><div class="n">\${esc(focus.title)}</div><div class="s">\${focus.day.date[1]}/\${focus.day.date[2]} \${focus.day.wd}\${S.live&&S.next&&focus===S.cur?\` · 다음 \${S.next.t} \${esc(S.next.title)}\`:""}</div></a>
\${goUrl(focus)?\`<a class="btn-coral" href="\${goUrl(focus)}" target="_blank" rel="noopener">길찾기</a>\`:""}</div>\`:"";
  const must=FLAT.filter(it=>it.star).map(it=>\`<a class="card mustc k-\${it.k}" href="#\${it.day.id}" data-open="\${it.id}"><span class="ph">\${it.img?\`<img loading="lazy" src="/neander/2026shanghai/img/\${it.img}.jpg" alt="">\`:I(CAT[it.k][0])}</span><span class="tx"><span class="tnum">\${it.day.date[1]}/\${it.day.date[2]} \${it.day.wd} \${it.t}</span><b>\${esc(it.title)}</b></span></a>\`).join("");
  const APPS=[["支","#1677ff","알리페이"],["微","#07c160","위챗"],["点","#ff6633","따종디엔핑"],["滴","#ff7a00","디디"],["D","#1a3c8f","디즈니"],["T","#287dfa","트립닷컴"]];
  const htl=P.htl;
  document.getElementById("v-overview").innerHTML=\`
<div class="hero"><img src="/neander/2026shanghai/img/p1.jpg" alt="상하이 루자쭈이 야경"><div class="top px"><span class="glass">\${I("clock")}<span id="clock" class="tnum">--:--</span></span>\${API?\`<button class="glass round" type="button" data-history aria-label="바뀐 기록">\${I("history")}</button>\`:""}</div>
<div class="bot px"><div><span class="pill-coral" id="heroD">\${esc(S.d)}</span></div><h1>상하이</h1><p class="dates">11.27 – 11.30 · 4명</p></div></div>
<div class="px"><div class="datecards">\${DAYS.map(D=>\`<a href="#\${D.id}" class="\${today===D?"on":""}"><b class="tnum">\${D.date[2]}</b><span>\${D.wd}</span></a>\`).join("")}</div></div>
<div class="px homegrid"><div>
<div class="sh2"><h2>\${S.live?"지금 일정":"다음 일정"}</h2></div>\${nx}
<div class="sh2"><h2>꼭 갈 곳</h2></div><div class="hs">\${must}</div>
</div><div>
<div class="sh2"><h2>숙소</h2><a class="more" href="https://kr.trip.com/hotels/detail/?hotelId=345044" target="_blank" rel="noopener">트립닷컴\${I("chevr")}</a></div>
<div class="card hotel"><div class="hh"><span class="n">\${I("bed")}</span><div><h3>그랜드 머큐어 훙차오</h3><p class="zh">上海虹桥美爵酒店</p></div></div>
<div class="facts"><div class="fact">\${I("car")}<span><b>30~40분</b><span>시내 · 와이탄</span></span></div><div class="fact">\${I("train")}<span><b>20분</b><span>훙차오역</span></span></div><div class="fact">\${I("plane")}<span><b>60~70분</b><span>푸동공항</span></span></div><div class="fact">\${I("subway")}<span><b>걸어서 15분</b><span>10호선 <span class="zh">伊犁路</span></span></span></div></div>
\${rbtns("htl")}</div>
<div class="sh2"><h2>필요한 앱</h2></div><div class="apps">\${APPS.map(a=>\`<span class="app"><i style="background:\${a[1]}">\${a[0]}</i>\${a[2]}</span>\`).join("")}</div>
\${API?\`<div class="sh2"><h2>함께 고치기</h2></div><div class="card"><button class="rowbtn" type="button" data-history>\${I("history")}바뀐 기록 · 되돌리기\${I("chevr")}</button></div>\`:""}
</div></div>\`;
  tickClock();
}
function rbtns(k){if(!k)return "";const p=P[k];return \`<div class="rbtns"><a class="rbtn" href="\${amap(k)}" target="_blank" rel="noopener"><i>\${I("pin")}</i>지도</a><button class="rbtn" type="button" data-copy="\${esc(p[1])}"><i>\${I("copy")}</i>복사</button><button class="rbtn" type="button" data-show="\${k}"><i>\${CHE}</i>기사님</button></div>\`}

/* ── 하루 (구글 캘린더처럼 세로 시간표) ── */
let CUR_DAY="day0";const MAPS={};let mapOpen=true;
const HPX=76,SNAP=5,MIN_T=300,MAX_T=1740; // 1시간 높이 · 5분 단위 · 05:00 ~ 다음 날 05:00
const mOf=t=>{const [h,m]=t.split(":").map(Number);return (h<5?h+24:h)*60+m};
const hhmm=m=>{m=((Math.round(m)%1440)+1440)%1440;return pad(Math.floor(m/60))+":"+pad(m%60)};
/** 끝 시각이 없으면 다음 일정 시작까지(최대 2시간), 마지막은 1시간 */
function spans(D){D.items.forEach((it,i)=>{const s=mOf(it.t);const nx=D.items[i+1];let e=it.e?mOf(it.e):(nx&&mOf(nx.t)>s?Math.min(mOf(nx.t),s+120):s+60);if(e<=s)e=s+30;it.sMin=s;it.eMin=e})}
function layout(D){
  // 시간이 실제로 겹치는 일정만 나란히 (짧은 일정이 최소 높이 때문에 살짝 겹쳐 보이는 건 그대로 둔다)
  const evs=D.items.map(it=>({it,s:it.sMin,e:it.eMin})).sort((a,b)=>a.s-b.s||a.e-b.e);
  let group=[],gEnd=-1;const flush=()=>{const cols=[];group.forEach(v=>{let c=cols.findIndex(end=>end<=v.s);if(c<0){c=cols.length;cols.push(0)}cols[c]=v.e;v.col=c});group.forEach(v=>v.n=cols.length);group=[]};
  evs.forEach(v=>{if(v.s>=gEnd&&group.length)flush();group.push(v);gEnd=Math.max(gEnd,v.e)});flush();return evs;
}
function evHtml(v,r0){
  const it=v.it;const top=(it.sMin-r0)/60*HPX;const h=Math.max((it.eMin-it.sMin)/60*HPX-3,19);
  const size=h<36?"xs":h<66?"sm":"lg";const w=100/v.n;
  const leg=(it.go||[])[0];
  return \`<div class="ev k-\${it.k} \${size} \${it.star?"star":""}" id="it-\${it.id}" data-open="\${it.id}" role="button" tabindex="0" style="top:\${top}px;height:\${h}px;left:calc(\${v.col*w}% + 2px);width:calc(\${w}% - 4px)">
<span class="evc"><span class="et tnum">\${it.t} – \${hhmm(it.eMin)}\${it.star?I("star","fill"):""}</span><b>\${esc(it.title)}</b>\${size==="lg"&&it.sub?\`<span class="es">\${zhSpan(it.sub)}</span>\`:""}\${size==="lg"&&h>96?\`<span class="meta">\${leg?\`<span>\${I(MODE[leg.m][0])}\${esc(leg.d||MODE[leg.m][1])}</span>\`:""}\${metaHtml(it,2)}</span>\`:""}</span>
\${size==="lg"&&v.n===1?(it.img?\`<img loading="lazy" draggable="false" src="/neander/2026shanghai/img/\${it.img}.jpg" alt="">\`:\`<span class="tile0">\${I(CAT[it.k][0])}</span>\`):""}\${API?'<span class="rs" aria-hidden="true"></span>':""}</div>\`;
}
function renderDay(id){
  const D=DAYOF(id)||DAYS[0];CUR_DAY=D.id;
  document.getElementById("dayTitle").innerHTML=\`\${D.date[1]}/\${D.date[2]} \${D.wd}<small>\${esc(D.title)}</small>\`;
  document.getElementById("strip").innerHTML=DAYS.map(x=>\`<a href="#\${x.id}" \${x.id===D.id?'aria-current="page"':""}><span class="tnum" style="color:inherit;font-size:15px">\${x.date[2]}</span><span>\${x.wd}</span></a>\`).join("");
  const no={};let c=0;D.items.forEach(it=>{if(hasXY(it.pin)&&!(it.pin in no))no[it.pin]=it.pin==="htl"?"H":++c});D.no=no;
  const evs=layout(D);
  const lo=D.items.length?Math.min(...D.items.map(x=>x.sMin)):540,hi=D.items.length?Math.max(...D.items.map(x=>x.eMin)):1260;
  const r0=Math.max(MIN_T,Math.floor(lo/60)*60-60),r1=Math.min(MAX_T,Math.ceil(hi/60)*60+120);D.r0=r0;D.r1=r1;
  let hrs="";for(let m=r0;m<=r1;m+=60)hrs+=\`<span style="top:\${(m-r0)/60*HPX}px">\${hhmm(m).slice(0,2)}시</span>\`;
  const stars=D.items.filter(it=>it.star).length;
  document.getElementById("dayWrap").innerHTML=\`<div class="daybody px"><div class="mapbox \${mapOpen?"":"hide"}" style="margin-left:-16px;margin-right:-16px" id="mapbox"><div class="map" id="map"></div></div>
<div><div class="dayinfo"><span class="dchip">\${I("users")}\${esc(D.ppl)}</span><span class="dchip">\${I("pin")}\${D.items.length}곳</span>\${stars?\`<span class="dchip">\${I("star","fill")}꼭 \${stars}</span>\`:""}\${API&&D.items.length?\`<span class="dchip" style="color:var(--muted)">\${I("clock")}꾹 눌러 옮기면 시간 변경</span>\`:""}</div>
<div class="cal" style="height:\${(r1-r0)/60*HPX+20}px"><div class="hrs">\${hrs}</div><div class="col" id="calCol" style="background-size:100% \${HPX}px">\${evs.map(v=>evHtml(v,r0)).join("")}<div class="nowl" id="nowl" hidden></div></div></div></div></div>\`;
  if(window.innerWidth>=900){const mb=document.getElementById("mapbox");mb.style.marginLeft=mb.style.marginRight="0"}
  initMap(D);tick();
}
function initMap(D){
  if(!window.L)return;
  if(MAPS.cur){MAPS.cur.map.remove();MAPS.cur=null}
  const Tiles=L.GridLayer.extend({createTile(c,done){const img=document.createElement("img");img.alt="";img.setAttribute("role","presentation");
    pack(c.z).then(d=>{const b=d[c.x+"_"+c.y];if(b){img.onload=img.onerror=()=>done(null,img);img.src="data:image/png;base64,"+b}else{img.src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";done(null,img)}});return img}});
  const map=L.map("map",{zoomControl:window.innerWidth>=900,attributionControl:true,minZoom:9,maxZoom:17});
  map.attributionControl.setPrefix(false);
  new Tiles({minZoom:9,maxZoom:17,maxNativeZoom:16,attribution:"© 高德地图 AutoNavi"}).addTo(map);
  const ll=k=>[P[k][3],P[k][2]];
  D.items.forEach(it=>(it.go||[]).forEach(g=>{const {from,to}=legOf(it,g);if(!hasXY(from)||!hasXY(to))return;
    const k=g.m==="walk"?"walk":g.m==="train"?"train":"base";const pts=[ll(from),ll(to)];const w=g.m==="walk"?4:5;
    L.polyline(pts,{className:"rt-case",weight:w+4,opacity:1,interactive:false}).addTo(map);
    L.polyline(pts,{className:"rt rt-"+k,weight:w,opacity:1,dashArray:(g.m==="walk"||g.m==="train")?"6 8":null,interactive:false}).addTo(map)}));
  const markers={};const ks=Object.keys(D.no);
  ks.forEach(k=>{
    const its=D.items.filter(it=>it.pin===k);const star=its.some(it=>it.star);
    const icon=L.divIcon({className:"",html:\`<span class="pin \${k==="htl"?"h":star?"star":""}"><b>\${D.no[k]}</b></span>\`,iconSize:[32,32],iconAnchor:[16,30],popupAnchor:[0,-28]});
    const html=\`<div class="pop">\${its.map(it=>\`<div><span class="pt">\${it.t}</span> <b style="display:inline">\${esc(it.title)}</b></div>\`).join("")}<div class="zh" lang="zh-CN">\${esc(P[k][1])}</div><button type="button" data-open="\${its[0].id}">자세히</button></div>\`;
    markers[k]=L.marker(ll(k),{icon,title:P[k][0],riseOnHover:true}).addTo(map).bindPopup(html);
  });
  const fit=(D.fit||[]).filter(hasXY);const all=fit.length?fit:ks;
  if(all.length>1)map.fitBounds(L.latLngBounds(all.map(ll)),{padding:[30,30]});else if(all.length)map.setView(ll(all[0]),14);else map.setView([31.2304,121.4737],11);
  MAPS.cur={map,markers,day:D.id};
}
const packs={},loading={};
function pack(z){if(!loading[z])loading[z]=fetch(\`/neander/2026shanghai/tiles/z\${z}.json\`).then(r=>r.ok?r.json():{}).catch(()=>({})).then(d=>packs[z]=d);return loading[z]}
function flyTo(id){
  const it=BYID[id];if(!it||!hasXY(it.pin))return;closeSheet();
  if(location.hash!=="#"+it.day.id){location.hash=it.day.id}
  setTimeout(()=>{const m=MAPS.cur;if(!m)return;if(!mapOpen){mapOpen=true;document.getElementById("mapbox").classList.remove("hide");m.map.invalidateSize()}
    document.getElementById("mapbox").scrollIntoView({behavior:"smooth",block:"center"});
    m.map.flyTo([P[it.pin][3],P[it.pin][2]],it.pin==="zjg"?13:15,{duration:.8});setTimeout(()=>m.markers[it.pin]&&m.markers[it.pin].openPopup(),850)},120);
}

/* ── 꾹 눌러 옮기기 · 아래 끝 잡고 늘리기 ── 5분 단위로 시간이 바뀐다 */
let CD=null,justDragged=false;
function cdStart(e){
  if(!API||CD||e.button>0)return;
  const ev=e.target.closest("#v-day .ev");if(!ev)return;
  const it=BYID[ev.id.slice(3)];if(!it)return;
  const rs=!!e.target.closest(".rs");
  CD={ev,it,mode:rs?"resize":"move",x:e.clientX,y:e.clientY,cy:e.clientY,on:false,touch:e.pointerType!=="mouse",pid:e.pointerId,s0:it.sMin,e0:it.eMin,ns:it.sMin,ne:it.eMin};
  if(rs)cdBegin();else if(CD.touch)CD.timer=setTimeout(cdBegin,350);
}
function cdBegin(){
  if(!CD||CD.on)return;CD.on=true;CD.py0=CD.y+scrollY;CD.top0=parseFloat(CD.ev.style.top);CD.h0=parseFloat(CD.ev.style.height);
  CD.ev.classList.add("drag");CD.ev.style.left="2px";CD.ev.style.width="calc(100% - 4px)";
  if(CD.ev.classList.contains("xs")||CD.ev.classList.contains("sm")){}
  try{navigator.vibrate&&navigator.vibrate(12)}catch(e){}
  cdApply();CD.raf=requestAnimationFrame(cdScroll);
}
function cdApply(){
  const D=CUR_DAY&&DAYOF(CUR_DAY);const dur=CD.e0-CD.s0;
  const dmin=Math.round(((CD.cy+scrollY)-CD.py0)/HPX*60/SNAP)*SNAP;
  if(CD.mode==="move"){CD.ns=Math.min(Math.max(CD.s0+dmin,D.r0),D.r1-dur);CD.ne=CD.ns+dur}
  else{CD.ns=CD.s0;CD.ne=Math.min(Math.max(CD.e0+dmin,CD.s0+15),Math.min(CD.s0+720,D.r1))}
  CD.ev.style.top=(CD.ns-D.r0)/60*HPX+"px";CD.ev.style.height=Math.max((CD.ne-CD.ns)/60*HPX-3,22)+"px";
  const et=CD.ev.querySelector(".et");if(et)et.firstChild.textContent=\`\${hhmm(CD.ns)} – \${hhmm(CD.ne)}\`;
}
function cdScroll(){
  if(!CD||!CD.on)return;const bottom=innerHeight-(innerWidth>=900?0:70);
  const v=CD.cy<130?-9:CD.cy>bottom-60?9:0;if(v){scrollBy(0,v);cdApply()}
  CD.raf=requestAnimationFrame(cdScroll);
}
function cdMove(e){
  if(!CD||e.pointerId!==CD.pid)return;CD.cy=e.clientY;
  if(!CD.on){const dx=Math.abs(e.clientX-CD.x),dy=Math.abs(e.clientY-CD.y);
    if(CD.touch){if(dx>8||dy>8){clearTimeout(CD.timer);CD=null}return}
    if(dy>4)cdBegin();else return}
  e.preventDefault();cdApply();
}
async function cdEnd(e){
  if(!CD||(e&&e.pointerId!==CD.pid))return;const d=CD;CD=null;clearTimeout(d.timer);cancelAnimationFrame(d.raf);
  if(!d.on)return;
  justDragged=true;setTimeout(()=>justDragged=false,80);
  if(e&&e.type==="pointercancel"){renderDay(CUR_DAY);return}
  if(d.ns===d.s0&&d.ne===d.e0){renderDay(CUR_DAY);return}
  d.ev.classList.add("saving");
  const r=await send({op:"time",id:d.it.id,t:hhmm(d.ns),e:hhmm(d.ne),by:ME.get()});
  if(r)toast(\`\${hhmm(d.ns)} – \${hhmm(d.ne)} 로 바꿨어요\`,r.hid);else renderDay(CUR_DAY);
}
document.addEventListener("pointerdown",cdStart);
document.addEventListener("pointermove",cdMove,{passive:false});
document.addEventListener("pointerup",cdEnd);
document.addEventListener("pointercancel",cdEnd);
document.addEventListener("touchmove",e=>{if(CD&&CD.on)e.preventDefault()},{passive:false});
document.addEventListener("contextmenu",e=>{if(CD)e.preventDefault()});
document.addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target.classList&&e.target.classList.contains("ev"))openItem(e.target.id.slice(3))});

/* ── 상세 시트 ── */
const TIPCLS={up:"good",down:"bad",alert:"al"};
let sheetFor=null,lastFocus=null;
function openSheet(html,cls=""){
  const s=document.getElementById("sheet"),sc=document.getElementById("scrim");
  lastFocus=document.activeElement;s.className="sheet "+cls;s.innerHTML=html;s.hidden=false;sc.hidden=false;
  requestAnimationFrame(()=>{s.classList.add("on");sc.classList.add("on")});
  setTimeout(()=>{const f=s.querySelector("[data-close]");f&&f.focus()},60);
}
function closeSheet(){
  const s=document.getElementById("sheet"),sc=document.getElementById("scrim");if(s.hidden)return;
  s.classList.remove("on");sc.classList.remove("on");sheetFor=null;
  setTimeout(()=>{s.hidden=true;sc.hidden=true;s.innerHTML=""},260);if(lastFocus&&lastFocus.focus)lastFocus.focus();
}
function openItem(id){
  const it=BYID[id];if(!it)return;sheetFor=id;
  if(location.hash!=="#"+it.day.id){history.replaceState(null,"","#"+it.day.id);show(it.day.id,{keepScroll:true})}
  const k=mainPlace(it);const others=it.pts.filter(x=>x!==k);
  const legs=(it.go||[]).map(g=>{const u=legUrl(it,g);return \`<div class="leg">\${I(MODE[g.m][0])}<span class="tx"><b>\${MODE[g.m][1]} \${esc(g.d||"")}\${g.c?\` · \${esc(g.c)}\`:""}</b>\${g.n?\`<span>\${zhSpan(g.n)}</span>\`:""}</span>\${u?\`<a href="\${u}" target="_blank" rel="noopener">\${I("nav")}길찾기</a>\`:""}</div>\`}).join("");
  const go=goUrl(it);
  openSheet(\`<div class="scroll"><div class="cover k-\${it.k}">\${it.img?\`<img src="/neander/2026shanghai/img/\${it.img}.jpg" alt="\${esc(it.title)} 사진">\${it.img.startsWith("g_")?'<span class="ai">AI 참고 이미지</span>':""}\`:I(CAT[it.k][0])}<div class="tb"><button class="glass round" type="button" data-close aria-label="닫기">\${I("chevl")}</button>\${hasXY(it.pin)?\`<button class="glass round" type="button" data-fly="\${it.id}" aria-label="지도에서 보기">\${I("target")}</button>\`:""}</div></div>
<div class="body"><div><p class="tnum" style="color:var(--coral);font-weight:800;font-size:15px">\${it.day.date[1]}/\${it.day.date[2]} \${it.day.wd} · \${it.t} – \${hhmm(it.eMin)}</p><h2>\${esc(it.title)}\${it.star?I("star","fill"):""}</h2>\${it.sub?\`<p class="zhn">\${zhSpan(it.sub)}</p>\`:""}\${(it.i||[]).length?\`<div class="meta">\${metaHtml(it)}</div>\`:""}</div>
\${it.w?\`<p class="warn">\${I("alert")}<span>\${zhSpan(it.w)}</span></p>\`:""}
\${rbtns(k)}
\${legs?\`<div class="sec3"><h3>오는 길</h3><div class="legs">\${legs}</div></div>\`:""}
\${it.menu?\`<div class="sec3"><h3>시킬 것\${it.menuSum?\`<span>\${esc(it.menuSum)}</span>\`:""}</h3><div class="mchips">\${it.menu.map(m=>\`<span>\${zhSpan(m)}</span>\`).join("")}</div></div>\`:""}
\${(it.tip||[]).length?\`<div class="sec3"><h3>알아 둘 것</h3><ul class="tips">\${it.tip.map(([ic,tx])=>\`<li class="\${TIPCLS[ic]||""}"><i>\${I(ic)}</i><span>\${zhSpan(tx)}</span></li>\`).join("")}</ul></div>\`:""}
\${others.length?\`<div class="sec3"><h3>근처 장소</h3><div class="others">\${others.map(o=>\`<div class="other"><span class="tx"><b lang="zh-CN">\${esc(P[o][1])}</b><span>\${esc(P[o][0])}</span></span><a class="sbtn" href="\${amap(o)}" target="_blank" rel="noopener" aria-label="고덕지도">\${I("pin")}</a><button class="sbtn" type="button" data-copy="\${esc(P[o][1])}" aria-label="복사">\${I("copy")}</button><button class="sbtn" type="button" data-show="\${o}" aria-label="기사님께 보여주기">\${CHE}</button></div>\`).join("")}</div></div>\`:""}
\${API?\`<div class="edits"><button class="obtn" type="button" data-edit="\${it.id}">\${I("pencil")}수정</button><button class="obtn danger" type="button" data-del="\${it.id}">\${I("trash")}삭제</button></div>\`:""}
</div></div>\${go?\`<div class="foot"><a class="btn-coral" href="\${go}" target="_blank" rel="noopener">\${I("nav")}고덕지도로 길찾기</a></div>\`:""}\`,"k-"+it.k);
}

/* ── 편집 ── */
const ME={get(){try{return localStorage.getItem("sh-me")||""}catch(e){return ""}},set(v){try{localStorage.setItem("sh-me",v)}catch(e){}}};
function autoIcon(tx){
  if(/미확인|주의|금지|압수|않|X\\b|없음/.test(tx))return "alert";
  if(/¥|위안|원\\b|만원/.test(tx))return "yen";
  if(/\\d{1,2}:\\d{2}|~\\d|시까지|영업/.test(tx))return "clock";
  if(/\\d+\\s*(분|시간)/.test(tx))return "hourglass";
  if(/평점|★|\\d\\.\\d\\b/.test(tx))return "star";
  if(/예약|등록|표|티켓/.test(tx))return "ticket";
  if(/택시|디디|차로/.test(tx))return "car";
  if(/지하철|호선/.test(tx))return "subway";
  if(/걸어서|도보/.test(tx))return "walk";
  if(/여권/.test(tx))return "id";
  if(/명\\b|줄|대기/.test(tx))return "users";
  if(/사진|스냅/.test(tx))return "camera";
  return "info";
}
const linesToChips=(txt,old)=>txt.split("\\n").map(s=>s.trim()).filter(Boolean).map(s=>{const o=(old||[]).find(c=>c[1]===s);return [o?o[0]:autoIcon(s),s]});
function openEditor(id,dayId){
  const it=id?BYID[id]:null;const D=it?it.day:DAYOF(dayId||CUR_DAY);
  const g=(it&&it.go&&it.go[0])||null;
  const placeKeys=Object.keys(P).sort((a,b)=>P[a][0].localeCompare(P[b][0],"ko"));
  const curPlace=it?mainPlace(it)||"":"";
  const f=(lab,html,hint)=>\`<label class="f">\${lab}\${html}\${hint?\`<span class="hint">\${hint}</span>\`:""}</label>\`;
  openSheet(\`<div class="scroll"><div class="grab"></div><div class="body">
<div style="display:flex;align-items:center;justify-content:space-between"><h2>\${it?"일정 고치기":"일정 추가"}</h2><button class="ibtn" type="button" data-close aria-label="닫기">\${I("x")}</button></div>
<form class="form" id="edForm" autocomplete="off">
\${f("날짜",\`<select name="day">\${DAYS.map(x=>\`<option value="\${x.id}" \${x===D?"selected":""}>\${x.date[1]}/\${x.date[2]} \${x.wd}</option>\`).join("")}</select>\`)}
<div class="two">\${f("시작",\`<input type="time" name="t" required value="\${it?it.t.replace("24:00","00:00"):"12:00"}">\`,"00~04시는 그날 밤")}\${f("끝",\`<input type="time" name="e" value="\${it&&it.e?it.e.replace("24:00","00:00"):it?hhmm(it.eMin):""}">\`,"비우면 다음 일정까지")}</div>
<div class="f"><span style="font-size:14px;font-weight:700;color:var(--muted)">종류</span><div class="cats">\${Object.entries(CAT).map(([k,v])=>\`<label class="k-\${k}"><input type="radio" name="k" value="\${k}" \${(it?it.k:"sight")===k?"checked":""}><i>\${I(v[0])}</i>\${v[1]}</label>\`).join("")}</div></div>
\${f("제목",\`<input type="text" name="title" maxlength="60" required value="\${esc(it?it.title:"")}" placeholder="예: 와이탄 야경">\`)}
\${f("한 줄 설명",\`<input type="text" name="sub" maxlength="120" value="\${esc(it&&it.sub||"")}" placeholder="중국어 이름 · 층수 같은 것">\`)}
<label class="tog">꼭 갈 곳 (★)<input type="checkbox" name="star" \${it&&it.star?"checked":""}></label>
\${f("장소",\`<select name="place"><option value="">장소 없음</option><option value="__new">+ 새 장소 (고덕 검색어로)</option>\${placeKeys.map(k=>\`<option value="\${k}" \${k===curPlace?"selected":""}>\${esc(P[k][0])} · \${esc(P[k][1])}</option>\`).join("")}</select>\`)}
<div id="newPlace" class="two" hidden>\${f("중국어 이름",\`<input type="text" name="pzh" maxlength="80" placeholder="例: 外滩">\`,"고덕지도 · 기사님 화면에 써요")}\${f("주소 (있으면)",\`<input type="text" name="paddr" maxlength="80">\`)}</div>
<div class="f"><span style="font-size:14px;font-weight:700;color:var(--muted)">오는 길</span><div class="seg2">\${[["","없음"],["walk","도보"],["taxi","택시"],["subway","지하철"],["train","기차"]].map(([m,l])=>\`<label><input type="radio" name="gm" value="\${m}" \${((g&&g.m)||"")===m?"checked":""}>\${m?I(MODE[m][0]):""}\${l}</label>\`).join("")}</div></div>
<div class="two">\${f("걸리는 시간",\`<input type="text" name="gd" maxlength="30" value="\${esc(g&&g.d||"")}" placeholder="25분">\`)}\${f("요금",\`<input type="text" name="gc" maxlength="30" value="\${esc(g&&g.c||"")}" placeholder="¥30">\`)}</div>
\${f("이동 메모",\`<input type="text" name="gn" maxlength="120" value="\${esc(g&&g.n||"")}" placeholder="18:45 출발 · 2호선">\`)}
\${f("정보 (한 줄에 하나)",\`<textarea name="i" placeholder="10:00–22:00&#10;¥158&#10;1시간">\${esc((it&&it.i||[]).map(c=>c[1]).join("\\n"))}</textarea>\`,"시간 · 가격 · 걸리는 시간은 아이콘이 자동으로 붙어요")}
\${f("주의 (빨간 한 줄)",\`<input type="text" name="w" maxlength="120" value="\${esc(it&&it.w||"")}">\`)}
\${f("시킬 것 (쉼표로)",\`<input type="text" name="menu" value="\${esc((it&&it.menu||[]).join(", "))}" placeholder="하가우, 샤오마이">\`)}
\${f("알아 둘 것 (한 줄에 하나)",\`<textarea name="tip">\${esc((it&&it.tip||[]).map(c=>c[1]).join("\\n"))}</textarea>\`)}
\${f("내 이름 (기록에 남아요)",\`<input type="text" name="by" maxlength="20" value="\${esc(ME.get())}" placeholder="익명">\`)}
</form></div></div>
<div class="foot"><div class="row">\${it?\`<button class="obtn danger" type="button" data-del="\${it.id}" style="flex:0 0 auto;padding:0 16px">\${I("trash")}</button>\`:""}<button class="btn-coral" type="submit" form="edForm" id="edSave">\${it?"저장":"추가"}</button></div></div>\`);
  const form=document.getElementById("edForm");
  const np=document.getElementById("newPlace");form.place.addEventListener("change",()=>np.hidden=form.place.value!=="__new");
  form.addEventListener("submit",async e=>{e.preventDefault();
    const fd=new FormData(form);let t=String(fd.get("t")||"");
    const by=String(fd.get("by")||"").trim();ME.set(by);
    const pv=String(fd.get("place")||"");const gm=String(fd.get("gm")||"");
    const item={t,e:String(fd.get("e")||""),k:fd.get("k")||"sight",title:fd.get("title"),sub:fd.get("sub"),star:fd.get("star")?1:0,
      w:fd.get("w"),i:linesToChips(String(fd.get("i")||""),it&&it.i),tip:linesToChips(String(fd.get("tip")||""),it&&it.tip),
      menu:String(fd.get("menu")||"").split(/[,，]/).map(s=>s.trim()).filter(Boolean),menuSum:it&&it.menuSum||"",img:it&&it.img||""};
    const placeSame=it&&pv===curPlace;
    if(pv&&pv!=="__new"){item.pin=hasXY(pv)?pv:null;item.pts=placeSame?it.pts:[pv]}else{item.pin=null;item.pts=[]}
    if(gm){const leg={m:gm,d:fd.get("gd"),c:fd.get("gc"),n:fd.get("gn")};if(g&&g.m===gm&&placeSame){if(g.from)leg.from=g.from;if(g.to)leg.to=g.to}item.go=[leg,...(placeSame&&it.go?it.go.slice(1):[])]}else item.go=[];
    if(it&&placeSame&&it.go&&it.go.length>1&&!gm)item.go=it.go.slice(1);
    const body={op:it?"update":"add",id:it&&it.id,day:fd.get("day"),item,by};
    if(pv==="__new")body.place={name:fd.get("title"),zh:fd.get("pzh"),addr:fd.get("paddr")};
    const btn=document.getElementById("edSave");btn.disabled=true;btn.textContent="저장 중…";
    const r=await send(body);btn.disabled=false;btn.textContent=it?"저장":"추가";
    if(r){closeSheet();toast(it?"고쳤어요":"추가했어요",r.hid);}
  });
}
async function send(body){
  if(!API)return null;
  try{const res=await fetch(API,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
    const j=await res.json().catch(()=>({}));
    if(!res.ok){toast(j.error||"저장하지 못했어요");return null}
    setPlan(j.plan,j.v);return j;
  }catch(e){toast("인터넷 연결을 확인해 주세요");return null}
}
async function delItem(id){
  const it=BYID[id];if(!it)return;
  if(!confirm(\`「\${it.title}」 일정을 지울까요?\\n바뀐 기록에서 되돌릴 수 있어요.\`))return;
  const r=await send({op:"delete",id,by:ME.get()});if(r){closeSheet();toast("지웠어요",r.hid)}
}
async function openHistory(){
  openSheet(\`<div class="scroll"><div class="grab"></div><div class="body"><div style="display:flex;align-items:center;justify-content:space-between"><h2>바뀐 기록</h2><button class="ibtn" type="button" data-close aria-label="닫기">\${I("x")}</button></div><div class="hrows" id="hrows"><p style="color:var(--muted)">불러오는 중…</p></div></div></div>\`);
  try{const j=await (await fetch(API+"?history=1",{cache:"no-store"})).json();
    const OP={add:["plus","추가"],update:["pencil","수정"],delete:["trash","삭제"],reorder:["shuffle","순서"]};
    const ago=t=>{const m=Math.round((Date.now()-t)/60000);return m<1?"방금":m<60?m+"분 전":m<1440?Math.round(m/60)+"시간 전":Math.round(m/1440)+"일 전"};
    document.getElementById("hrows").innerHTML=(j.rows||[]).map(r=>{const d=DAYOF(r.day);return \`<div class="hrow"><i class="\${r.op}">\${I(OP[r.op][0])}</i><span style="min-width:0"><b>\${esc(r.op==="reorder"&&d?d.date[1]+"/"+d.date[2]+" "+d.wd+" 순서 바꿈":r.title)}</b><span>\${OP[r.op][1]}\${r.revertOf?" (되돌림)":""} · \${d?d.date[1]+"/"+d.date[2]:""} · \${esc(r.by||"익명")} · \${ago(r.at)}</span></span><button type="button" data-revert="\${r.id}">\${I("undo")}되돌리기</button></div>\`}).join("")||'<p style="color:var(--muted)">아직 바뀐 것이 없어요. 처음 일정 그대로예요.</p>';
  }catch(e){document.getElementById("hrows").innerHTML='<p style="color:var(--muted)">기록을 불러오지 못했어요.</p>'}
}

/* ── 쇼핑 ── [이름, 중국어, 어디서·얼마, 주의] */
const SHOP=[
["화이트래빗 밀크캔디","大白兔奶糖","제일식품상점 · 마트"],["칭즈 핸드크림","青稚护手霜","칭즈 · ¥50~55"],["나비파이","蝴蝶酥","제일식품상점 · 공항"],["대추누가","枣夹核桃","제일식품상점 1층"],
["마카다미아","三只松鼠 夏威夷果","올레 마트"],["카만 에그롤","KAMAN 鸡蛋卷","올레 마트"],["레이즈 오이맛","乐事 黄瓜味","마트 · 편의점"],["하이디라오 소스","海底捞 火锅底料","마트 · ¥12.9","소기름 제품은 검역 확인"],
["투도우펀 감자면","土豆粉","마트 · 약 ¥11"],["취뚜어뚜어 쿠키","趣多多","마트 · 편의점"],["I❤SH 티셔츠","I LOVE 上海 T恤","난징동루 기념품숍"],["팝마트 라부부","泡泡玛特 LABUBU","팝마트 플래그십"],
["스벅 상하이 시티컵","星巴克 城市杯","스타벅스"],["장샤오바이 고량주","江小白","올레 마트","술 1인 2L · $400까지"],["베이징덕맛 프레첼","百力滋 北京烤鸭味","공항 · 마트"],["홀리랜드 디저트","好利来","홀리랜드","보냉팩 넣기"],
["관샤 향수·디퓨저","观夏 To Summer","관샤 闲庭 · 10만원대"],["블랜버니 차 세트","Blendbunny","티엔즈팡 · 3.5만원~"],["대홍포 · 보이차","大红袍 · 普洱茶","차 전문점 · 2~3만원"],["국제반점 나비파이","国际饭店 蝴蝶酥","자자탕바오 앞"],
["실크 스카프","真丝丝巾","티엔즈팡 · 공항","혼방 표시 확인"],["상하이 여인 크림 세트","老上海雪花膏 礼盒","난징동루 기념품숍"],["마오타이","贵州茅台","공항 면세점","가짜 많음 → 면세점"],["화이트래빗 선물세트","大白兔 礼盒","제일식품상점 · 공항"],
["일본 위스키","山崎 · 白州","공항 주류 면세점"],["우량예 백주","五粮液","공항 주류 면세점"],["석쿠먼 황주","石库门 黄酒","T2 淘青月"],["대추호두말이","枣夹核桃","공항 · ¥85/95"],
["에그롤","鸡蛋卷","공항 · ¥35"],["스벅 중국 시티컵","星巴克 城市杯","T1 스타벅스 · ¥159"],["판다 굿즈","熊猫 公仔","공항 판다샵"],["중국 한정 프레첼","百力滋","공항 면세점"]];
const STORES=[["ole","cart","올레 마트","월 11:45",[4,5,6,7,8,9,13]],["nj","store","난징동루","월 09:00~12:20",[1,11,0,2,3,23,10,21,19]],["gx","perfume","관샤 闲庭","토 18:05",[16]],["air","plane","푸동공항","월 15:00~",[22,24,25,26,27,28,29,30,31,14]],["etc","bag","그 밖","시간 날 때",[12,15,17,18,20]]];
const store={get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
let shopF="all";
function renderShop(){
  const got=store.get("sh-got",{});const cnt=Object.values(got).filter(Boolean).length;
  const S=STORES.find(s=>s[0]===shopF);
  const list=SHOP.map((s,i)=>({s,i})).filter(({i})=>shopF==="all"?true:shopF==="left"?!got[i]:S[4].includes(i));
  if(S)list.sort((a,b)=>S[4].indexOf(a.i)-S[4].indexOf(b.i));
  document.getElementById("v-shop").innerHTML=\`<div class="ptitle"><h1>쇼핑</h1><span class="ring" style="--p:\${Math.round(cnt/SHOP.length*100)}"><b class="tnum">\${cnt}/\${SHOP.length}</b></span></div>
<div class="sh2"><h2>어디서 살까</h2></div><div class="stores">\${STORES.map(s=>\`<button type="button" class="card store" data-f="\${s[0]}" aria-pressed="\${shopF===s[0]}"><span class="sh"><i>\${I(s[1])}</i><span><b>\${zhSpan(s[2])}</b><span>\${s[3]}</span></span></span><span class="thumbs">\${s[4].slice(0,5).map(i=>\`<img loading="lazy" src="/neander/2026shanghai/img/s\${i+1}.jpg" alt="">\`).join("")}<em>\${s[4].length}</em></span></button>\`).join("")}</div>
<div class="segs"><button type="button" data-f="all" aria-pressed="\${shopF==="all"}">전체</button><button type="button" data-f="left" aria-pressed="\${shopF==="left"}">안 산 것 \${SHOP.length-cnt}</button></div>
<div class="items">\${list.map(({s,i})=>\`<div class="card item \${got[i]?"got":""}"><div class="im"><img loading="lazy" src="/neander/2026shanghai/img/s\${i+1}.jpg" alt="\${esc(s[0])}"><label class="ck">\${I("tick")}<input type="checkbox" data-got="\${i}" \${got[i]?"checked":""} aria-label="\${esc(s[0])} 샀어요"></label></div>
<div class="tx"><h3>\${esc(s[0])}</h3><span class="zh" lang="zh-CN">\${esc(s[1])}</span><span class="wh">\${zhSpan(s[2])}</span>\${s[3]?\`<span class="nt">\${zhSpan(s[3])}</span>\`:""}</div></div>\`).join("")||'<p>다 샀어요!</p>'}</div>
<div class="sh2"><h2>한국 들어올 때</h2></div><div class="tiles">
<div class="card tile">\${I("cash")}<b>$800</b><span>1인 면세 · 4명 각자</span></div><div class="card tile">\${I("wine")}<b>2L · $400</b><span>술은 따로 · 나눠 들기</span></div>
<div class="card tile al">\${I("ban")}<b>고기 제품</b><span>육포 · 소시지 반입 X</span></div><div class="card tile al">\${I("ban")}<b>짝퉁</b><span>압수될 수 있음</span></div>
<div class="card tile">\${I("receipt")}<b>¥200↑</b><span>같은 매장 · 택스리펀</span></div><div class="card tile">\${I("percent")}<b>자진신고</b><span>넘으면 관세 30% 감면</span></div></div>
<div class="sh2"><h2>푸동공항 면세점</h2></div><div class="tiles">
<div class="card tile">\${I("plane")}<b>T1 · T2</b><span>대한 T1 · 아시아나 T2 (후기)</span></div><div class="card tile">\${I("clock")}<b>07:00~</b><span>마지막 편까지 · T2 <span class="zh">淘青月</span> ~23:00</span></div>
<div class="card tile">\${I("id")}<b>여권 + 탑승권</b><span>술 · 담배 만 18세↑</span></div><div class="card tile">\${I("wine")}<b>술이 강점</b><span>발베니 일부 인천보다 쌈 (2024)</span></div>
<div class="card tile">\${I("perfume")}<b>화장품 ≈ 한국</b><span>간식은 시내보다 조금 비쌈</span></div><div class="card tile al">\${I("ban")}<b>시내면세점 X</b><span>크루즈 승객 전용 (2025.12)</span></div></div>\`;
}

/* ── 준비 ── */
const PREP=[
["train","고속철 왕복 4장","G7138 16:17 → 17:07 · D5565 19:29 → 20:21 · 트립닷컴 · 12306"],
["sparkles","디즈니 11/27 표 · 짐","매진 의심 → 앱 · 트립닷컴 · 클룩 · 여권 실명 · 캐리어 반입 X"],
["phone","따종디엔핑 가입 · 줄서기 시험","점도덕(토 19:20) · 양꼬치는 위챗 「排队订座」"],
["ticket","금붕어 극장 표","SmartShanghai · ¥158 · 마지막 입장 21:30"],
["id","교통대 4명 등록 · Kubert 씨","11/29 13:00~ 「参观交大」 · 장자강 17:07 도착 · 화메이 영업 확인"],
["leaf","발마사지 예약 · 복장","캉다오 11/27 24:00 · VUE 스마트 캐주얼"],
["card","결제 · 택스리펀","카카오페이 · 본인 신용카드 · 여권 · 같은 매장 ¥200↑"],
["luggage","월요일 짐","일요일 밤에 싸기 · 07:50 체크아웃 · 13:35 공항"]];
const KW=["htl","pvg","dhub","dis","yang","kang","yuy","nx","lbl","sjtu","ap","hq","zjg","bund","vue","dhc","qz","pop","mns","mms","ole","ff","jj","gj","wk","lelabo","harmay","zd","gxxt","gxxp","bfc"];
const SKIP=["rt","gx","vr","phw","sbr","lv","yyl","hkj","ins","sht","cru","ljs"];
const VIDS=[["OrNvBu26NQo","최신 상하이 맛집·카페·3박4일 코스까지 영상 하나로 총정리","또 떠나는 남자 · 2026-11-22"],["JXo3OLIEbDI","2박 3일 상하이 여행 브이로그 | 디즈니랜드부터 현지 mz 맛집까지","김베개 · 2025-09-22"],["1zL_W0O9u_Y","카메라 끄라던 상하이 짝퉁시장, 그 안에서 벌어진 일","또떠나용 · 2025-05-07"],["D05XTLRArJM","나 혼자 첫 상하이 · 동선 집착러의 2박3일 완벽코스","현주zip · 2026-10-04"],["ORr4metVjT4","상해 여행 · 요즘 유행 디저트·인생맛집·헤드스파","끼리 KKIRI · 2026-01-16"],["1ud11IE2GMo","상하이 브이로그 (타임라인·고덕지도 링크)","트윙클린 · 2026-11-14"]];
function kwRow(k){const p=P[k];if(!p)return "";return \`<div class="card row"><span class="tx"><b lang="zh-CN">\${esc(p[1])}</b><span>\${esc(p[0])}</span></span><button class="sbtn" type="button" data-copy="\${esc(p[1])}" aria-label="복사">\${I("copy")}</button><a class="sbtn" href="\${amap(k)}" target="_blank" rel="noopener" aria-label="고덕지도">\${I("pin")}</a></div>\`}
function renderPrep(){
  const done=store.get("sh-prep",{});const n=Object.values(done).filter(Boolean).length;
  const userKw=Object.keys(P).filter(k=>k.startsWith("u_"));
  document.getElementById("v-prep").innerHTML=\`<div class="ptitle"><h1>출발 전에</h1><span class="ring" style="--p:\${Math.round(n/PREP.length*100)}"><b class="tnum">\${n}/\${PREP.length}</b></span></div>
<div class="sh2"><h2>할 일</h2></div><ul class="check">\${PREP.map((p,i)=>\`<li class="card \${done[i]?"done":""}"><label><i>\${I(done[i]?"tick":p[0])}</i><span><b>\${esc(p[1])}</b><span class="s">\${zhSpan(p[2])}</span></span><input type="checkbox" data-prep="\${i}" \${done[i]?"checked":""}></label></li>\`).join("")}</ul>
<div class="sh2"><h2>고덕지도 검색어</h2></div><div class="kw">\${[...KW,...userKw].map(kwRow).join("")}</div>
<div style="margin-top:16px"><details class="card more"><summary>\${I("ban")}이번 일정에서 빠진 곳 \${SKIP.length}\${I("chev")}</summary><div class="kw">\${SKIP.map(kwRow).join("")}</div></details></div>
<div class="sh2"><h2>참고 영상</h2></div><div class="hs">\${VIDS.map((v,i)=>\`<a class="card vid" href="https://www.youtube.com/watch?v=\${v[0]}" target="_blank" rel="noopener"><span class="im"><img loading="lazy" src="/neander/2026shanghai/img/v\${i+1}.jpg" alt=""><span class="play"><i>\${I("play","fill")}</i></span></span><span class="t"><b>\${esc(v[1])}</b><span>\${esc(v[2])}</span></span></a>\`).join("")}</div>\`;
}

/* ── 화면 전환 ── */
const VIEWS=["overview","day0","day1","day2","day3","shop","prep"];
let VIEW="overview";
function show(v,opts={}){
  if(!VIEWS.includes(v))v="overview";VIEW=v;
  const isDay=v.startsWith("day");const sec=isDay?"day":v;
  document.querySelectorAll(".view").forEach(s=>s.hidden=s.dataset.view!==sec);
  document.querySelectorAll(".tabs a").forEach(a=>{if(a.dataset.v===sec)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current")});
  document.getElementById("fab").hidden=!(isDay&&API);
  if(isDay){document.getElementById("planTab").href="#"+v;renderDay(v)}
  else if(v==="overview")renderOverview();
  if(!opts.keepScroll)window.scrollTo(0,0);
}
function rerender(){
  if(VIEW.startsWith("day")){const y=scrollY;renderDay(VIEW);scrollTo(0,y)}else if(VIEW==="overview")renderOverview();else if(VIEW==="prep")renderPrep();
  if(sheetFor&&BYID[sheetFor]&&!document.getElementById("edForm"))openItem(sheetFor);
}
function tickClock(){const a=shNow();const c=document.getElementById("clock");if(c)c.textContent="상하이 "+pad(a.getUTCHours())+":"+pad(a.getUTCMinutes())}
function tick(){
  tickClock();const S=status();const hd=document.getElementById("heroD");if(hd)hd.textContent=S.d;
  document.querySelectorAll(".ev.isnow").forEach(c=>c.classList.remove("isnow"));
  if(S.cur){const c=document.getElementById("it-"+S.cur.id);if(c)c.classList.add("isnow")}
  // 오늘 보는 날이면 지금 시각에 빨간 선
  const nl=document.getElementById("nowl");const CDay=DAYOF(CUR_DAY);
  if(nl&&CDay){const a2=shNow();const nowM=(Date.now()-sh(CDay.date[0],CDay.date[1],CDay.date[2],0,0))/60000;
    const on=VIEW.startsWith("day")&&nowM>=CDay.r0&&nowM<=CDay.r1;nl.hidden=!on;if(on)nl.style.top=(nowM-CDay.r0)/60*HPX+"px"}
  const a=shNow();const ymd=[a.getUTCFullYear(),a.getUTCMonth()+1,a.getUTCDate()].join("-");const td=DAYS.find(D=>D.date.join("-")===ymd);
  if(td&&!VIEW.startsWith("day"))document.getElementById("planTab").href="#"+td.id;
}

/* ── 기사님 화면 · 복사 · 알림 ── */
let dFocus=null;
function driver(k){const p=P[k];dFocus=document.activeElement;document.getElementById("driverZh").textContent=p[1];document.getElementById("driverKo").textContent=p[0];
  const ad=document.getElementById("driverAddr");ad.textContent=p[4]||"";ad.hidden=!p[4];
  document.getElementById("driver").hidden=false;document.getElementById("driverClose").focus();
  try{navigator.wakeLock&&navigator.wakeLock.request("screen").catch(()=>{})}catch(e){}}
function closeDriver(){document.getElementById("driver").hidden=true;if(dFocus)dFocus.focus()}
let toastT;
function toast(msg,undo){let t=document.querySelector(".toast");if(!t){t=document.createElement("div");t.className="toast";t.setAttribute("role","status");document.body.appendChild(t)}
  t.innerHTML=\`<span>\${esc(msg)}</span>\${undo?\`<button type="button" data-revert="\${esc(undo)}">되돌리기</button>\`:""}\`;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>t.hidden=true,undo?6000:2000)}
function copy(text){
  try{navigator.clipboard.writeText(text).then(()=>toast("복사했어요: "+text),()=>toast(text))}catch(e){toast(text)}
}

document.addEventListener("click",e=>{
  if(justDragged){e.preventDefault();e.stopPropagation();return}
  if(e.target.closest(".rs"))return;
  const t=e.target.closest("[data-copy],[data-show],[data-fly],[data-open],[data-f],[data-close],[data-edit],[data-del],[data-history],[data-revert],#fab,#mapToggle,#scrim,#driverClose");if(!t)return;
  if(t.dataset.copy!==undefined){e.preventDefault();copy(t.dataset.copy)}
  else if(t.dataset.show){e.preventDefault();driver(t.dataset.show)}
  else if(t.dataset.fly){flyTo(t.dataset.fly)}
  else if(t.dataset.open){e.preventDefault();openItem(t.dataset.open)}
  else if(t.dataset.f){shopF=(shopF===t.dataset.f&&t.dataset.f!=="all")?"all":t.dataset.f;renderShop()}
  else if(t.dataset.close!==undefined||t.id==="scrim")closeSheet();
  else if(t.dataset.edit)openEditor(t.dataset.edit);
  else if(t.dataset.del)delItem(t.dataset.del);
  else if(t.dataset.history!==undefined)openHistory();
  else if(t.dataset.revert){(async()=>{const r=await send({op:"revert",historyId:t.dataset.revert,by:ME.get()});if(r){toast("되돌렸어요");if(document.getElementById("hrows"))openHistory()}})()}
  else if(t.id==="fab")openEditor(null,CUR_DAY);
  else if(t.id==="mapToggle"){mapOpen=!mapOpen;t.setAttribute("aria-pressed",mapOpen);const mb=document.getElementById("mapbox");if(mb){mb.classList.toggle("hide",!mapOpen);if(mapOpen&&MAPS.cur)setTimeout(()=>MAPS.cur.map.invalidateSize(),30)}}
  else if(t.id==="driverClose")closeDriver();
});
document.addEventListener("keydown",e=>{if(e.key!=="Escape")return;if(!document.getElementById("driver").hidden)closeDriver();else closeSheet()});
document.addEventListener("change",e=>{
  const t=e.target;
  if(t.dataset.got!==undefined){const g=store.get("sh-got",{});g[t.dataset.got]=t.checked;store.set("sh-got",g);setTimeout(renderShop,shopF==="left"?400:0)}
  if(t.dataset.prep!==undefined){const g=store.get("sh-prep",{});g[t.dataset.prep]=t.checked;store.set("sh-prep",g);renderPrep()}
});
window.addEventListener("hashchange",()=>{closeSheet();show(location.hash.slice(1))});
window.addEventListener("resize",()=>{if(MAPS.cur)MAPS.cur.map.invalidateSize()});

/* ── 같이 고치는 일정 받아 오기 ── */
function setPlan(plan,v){applyPlan(plan,v);store.set("sh-plan",{v,plan});rerender()}
async function pull(quiet){
  if(!API)return;
  try{const r=await fetch(API,{cache:"no-store"});if(!r.ok)return;const j=await r.json();
    if(j.v!==PV){const busy=!!document.getElementById("edForm");if(busy)return;const had=PV;setPlan(j.plan,j.v);if(quiet&&had)toast("다른 사람이 일정을 바꿨어요")}
  }catch(e){}
}

/* ── 시작 ── */
(function(){const c=API&&store.get("sh-plan",null);if(c&&c.plan&&c.plan.days)applyPlan(c.plan,c.v);else applyPlan(DEFAULT_PLAN,0)})();
renderShop();renderPrep();
const h0=location.hash.slice(1);show(VIEWS.includes(h0)?h0:"overview");
tick();setInterval(tick,30000);
pull(false);setInterval(()=>{if(!document.hidden)pull(true)},60000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)pull(true)});
</script>

</body></html>
`;
