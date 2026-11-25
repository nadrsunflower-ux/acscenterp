// 2026-11 상하이 2박 3일(11/28~30) 출장 일정 페이지 — /neander/2026shanghai
// 로그인 없이 링크로 여는 독립 HTML. 사진·지도 타일·Leaflet 은 public/neander/2026shanghai/ 에 있다.
// (중국 안에서도 열리도록 외부 CDN 을 쓰지 않는다. 구글 폰트는 막혀도 화면을 붙잡지 않게 비동기로 읽는다.)
export const SHANGHAI_2026_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#16223b"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="상하이 2박3일"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
<title>상하이 2박 3일</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=swap" media="print" onload="this.media='all'">
<style>
.leaflet-image-layer,.leaflet-layer,.leaflet-marker-icon,.leaflet-marker-shadow,.leaflet-pane,.leaflet-pane>canvas,.leaflet-pane>svg,.leaflet-tile,.leaflet-tile-container,.leaflet-zoom-box{position:absolute;left:0;top:0}.leaflet-container{overflow:hidden}.leaflet-marker-icon,.leaflet-marker-shadow,.leaflet-tile{-webkit-user-select:none;-moz-user-select:none;user-select:none;-webkit-user-drag:none}.leaflet-tile::selection{background:0 0}.leaflet-safari .leaflet-tile{image-rendering:-webkit-optimize-contrast}.leaflet-safari .leaflet-tile-container{width:1600px;height:1600px;-webkit-transform-origin:0 0}.leaflet-marker-icon,.leaflet-marker-shadow{display:block}.leaflet-container .leaflet-overlay-pane svg{max-width:none!important;max-height:none!important}.leaflet-container .leaflet-marker-pane img,.leaflet-container .leaflet-shadow-pane img,.leaflet-container .leaflet-tile,.leaflet-container .leaflet-tile-pane img,.leaflet-container img.leaflet-image-layer{max-width:none!important;max-height:none!important;width:auto;padding:0}.leaflet-container img.leaflet-tile{mix-blend-mode:plus-lighter}.leaflet-container.leaflet-touch-zoom{-ms-touch-action:pan-x pan-y;touch-action:pan-x pan-y}.leaflet-container.leaflet-touch-drag{-ms-touch-action:pinch-zoom;touch-action:none;touch-action:pinch-zoom}.leaflet-container.leaflet-touch-drag.leaflet-touch-zoom{-ms-touch-action:none;touch-action:none}.leaflet-container{-webkit-tap-highlight-color:transparent}.leaflet-container a{-webkit-tap-highlight-color:rgba(51,181,229,.4)}.leaflet-tile{filter:inherit;visibility:hidden}.leaflet-tile-loaded{visibility:inherit}.leaflet-zoom-box{width:0;height:0;-moz-box-sizing:border-box;box-sizing:border-box;z-index:800}.leaflet-overlay-pane svg{-moz-user-select:none}.leaflet-pane{z-index:400}.leaflet-tile-pane{z-index:200}.leaflet-overlay-pane{z-index:400}.leaflet-shadow-pane{z-index:500}.leaflet-marker-pane{z-index:600}.leaflet-tooltip-pane{z-index:650}.leaflet-popup-pane{z-index:700}.leaflet-map-pane canvas{z-index:100}.leaflet-map-pane svg{z-index:200}.leaflet-vml-shape{width:1px;height:1px}.lvml{behavior:url(#default#VML);display:inline-block;position:absolute}.leaflet-control{position:relative;z-index:800;pointer-events:visiblePainted;pointer-events:auto}.leaflet-bottom,.leaflet-top{position:absolute;z-index:1000;pointer-events:none}.leaflet-top{top:0}.leaflet-right{right:0}.leaflet-bottom{bottom:0}.leaflet-left{left:0}.leaflet-control{float:left;clear:both}.leaflet-right .leaflet-control{float:right}.leaflet-top .leaflet-control{margin-top:10px}.leaflet-bottom .leaflet-control{margin-bottom:10px}.leaflet-left .leaflet-control{margin-left:10px}.leaflet-right .leaflet-control{margin-right:10px}.leaflet-fade-anim .leaflet-popup{opacity:0;-webkit-transition:opacity .2s linear;-moz-transition:opacity .2s linear;transition:opacity .2s linear}.leaflet-fade-anim .leaflet-map-pane .leaflet-popup{opacity:1}.leaflet-zoom-animated{-webkit-transform-origin:0 0;-ms-transform-origin:0 0;transform-origin:0 0}svg.leaflet-zoom-animated{will-change:transform}.leaflet-zoom-anim .leaflet-zoom-animated{-webkit-transition:-webkit-transform .25s cubic-bezier(0,0,.25,1);-moz-transition:-moz-transform .25s cubic-bezier(0,0,.25,1);transition:transform .25s cubic-bezier(0,0,.25,1)}.leaflet-pan-anim .leaflet-tile,.leaflet-zoom-anim .leaflet-tile{-webkit-transition:none;-moz-transition:none;transition:none}.leaflet-zoom-anim .leaflet-zoom-hide{visibility:hidden}.leaflet-interactive{cursor:pointer}.leaflet-grab{cursor:-webkit-grab;cursor:-moz-grab;cursor:grab}.leaflet-crosshair,.leaflet-crosshair .leaflet-interactive{cursor:crosshair}.leaflet-control,.leaflet-popup-pane{cursor:auto}.leaflet-dragging .leaflet-grab,.leaflet-dragging .leaflet-grab .leaflet-interactive,.leaflet-dragging .leaflet-marker-draggable{cursor:move;cursor:-webkit-grabbing;cursor:-moz-grabbing;cursor:grabbing}.leaflet-image-layer,.leaflet-marker-icon,.leaflet-marker-shadow,.leaflet-pane>svg path,.leaflet-tile-container{pointer-events:none}.leaflet-image-layer.leaflet-interactive,.leaflet-marker-icon.leaflet-interactive,.leaflet-pane>svg path.leaflet-interactive,svg.leaflet-image-layer.leaflet-interactive path{pointer-events:visiblePainted;pointer-events:auto}.leaflet-container{background:#ddd;outline-offset:1px}.leaflet-container a{color:#0078a8}.leaflet-zoom-box{border:2px dotted #38f;background:rgba(255,255,255,.5)}.leaflet-container{font-family:"Helvetica Neue",Arial,Helvetica,sans-serif;font-size:12px;font-size:.75rem;line-height:1.5}.leaflet-bar{box-shadow:0 1px 5px rgba(0,0,0,.65);border-radius:4px}.leaflet-bar a{background-color:#fff;border-bottom:1px solid #ccc;width:26px;height:26px;line-height:26px;display:block;text-align:center;text-decoration:none;color:#000}.leaflet-bar a,.leaflet-control-layers-toggle{background-position:50% 50%;background-repeat:no-repeat;display:block}.leaflet-bar a:focus,.leaflet-bar a:hover{background-color:#f4f4f4}.leaflet-bar a:first-child{border-top-left-radius:4px;border-top-right-radius:4px}.leaflet-bar a:last-child{border-bottom-left-radius:4px;border-bottom-right-radius:4px;border-bottom:none}.leaflet-bar a.leaflet-disabled{cursor:default;background-color:#f4f4f4;color:#bbb}.leaflet-touch .leaflet-bar a{width:30px;height:30px;line-height:30px}.leaflet-touch .leaflet-bar a:first-child{border-top-left-radius:2px;border-top-right-radius:2px}.leaflet-touch .leaflet-bar a:last-child{border-bottom-left-radius:2px;border-bottom-right-radius:2px}.leaflet-control-zoom-in,.leaflet-control-zoom-out{font:bold 18px 'Lucida Console',Monaco,monospace;text-indent:1px}.leaflet-touch .leaflet-control-zoom-in,.leaflet-touch .leaflet-control-zoom-out{font-size:22px}.leaflet-control-layers{box-shadow:0 1px 5px rgba(0,0,0,.4);background:#fff;border-radius:5px}.leaflet-control-layers-toggle{background-image:url(images/layers.png);width:36px;height:36px}.leaflet-retina .leaflet-control-layers-toggle{background-image:url(images/layers-2x.png);background-size:26px 26px}.leaflet-touch .leaflet-control-layers-toggle{width:44px;height:44px}.leaflet-control-layers .leaflet-control-layers-list,.leaflet-control-layers-expanded .leaflet-control-layers-toggle{display:none}.leaflet-control-layers-expanded .leaflet-control-layers-list{display:block;position:relative}.leaflet-control-layers-expanded{padding:6px 10px 6px 6px;color:#333;background:#fff}.leaflet-control-layers-scrollbar{overflow-y:scroll;overflow-x:hidden;padding-right:5px}.leaflet-control-layers-selector{margin-top:2px;position:relative;top:1px}.leaflet-control-layers label{display:block;font-size:13px;font-size:1.08333em}.leaflet-control-layers-separator{height:0;border-top:1px solid #ddd;margin:5px -10px 5px -6px}.leaflet-default-icon-path{background-image:url(images/marker-icon.png)}.leaflet-container .leaflet-control-attribution{background:#fff;background:rgba(255,255,255,.8);margin:0}.leaflet-control-attribution,.leaflet-control-scale-line{padding:0 5px;color:#333;line-height:1.4}.leaflet-control-attribution a{text-decoration:none}.leaflet-control-attribution a:focus,.leaflet-control-attribution a:hover{text-decoration:underline}.leaflet-attribution-flag{display:inline!important;vertical-align:baseline!important;width:1em;height:.6669em}.leaflet-left .leaflet-control-scale{margin-left:5px}.leaflet-bottom .leaflet-control-scale{margin-bottom:5px}.leaflet-control-scale-line{border:2px solid #777;border-top:none;line-height:1.1;padding:2px 5px 1px;white-space:nowrap;-moz-box-sizing:border-box;box-sizing:border-box;background:rgba(255,255,255,.8);text-shadow:1px 1px #fff}.leaflet-control-scale-line:not(:first-child){border-top:2px solid #777;border-bottom:none;margin-top:-2px}.leaflet-control-scale-line:not(:first-child):not(:last-child){border-bottom:2px solid #777}.leaflet-touch .leaflet-bar,.leaflet-touch .leaflet-control-attribution,.leaflet-touch .leaflet-control-layers{box-shadow:none}.leaflet-touch .leaflet-bar,.leaflet-touch .leaflet-control-layers{border:2px solid rgba(0,0,0,.2);background-clip:padding-box}.leaflet-popup{position:absolute;text-align:center;margin-bottom:20px}.leaflet-popup-content-wrapper{padding:1px;text-align:left;border-radius:12px}.leaflet-popup-content{margin:13px 24px 13px 20px;line-height:1.3;font-size:13px;font-size:1.08333em;min-height:1px}.leaflet-popup-content p{margin:17px 0;margin:1.3em 0}.leaflet-popup-tip-container{width:40px;height:20px;position:absolute;left:50%;margin-top:-1px;margin-left:-20px;overflow:hidden;pointer-events:none}.leaflet-popup-tip{width:17px;height:17px;padding:1px;margin:-10px auto 0;pointer-events:auto;-webkit-transform:rotate(45deg);-moz-transform:rotate(45deg);-ms-transform:rotate(45deg);transform:rotate(45deg)}.leaflet-popup-content-wrapper,.leaflet-popup-tip{background:#fff;color:#333;box-shadow:0 3px 14px rgba(0,0,0,.4)}.leaflet-container a.leaflet-popup-close-button{position:absolute;top:0;right:0;border:none;text-align:center;width:24px;height:24px;font:16px/24px Tahoma,Verdana,sans-serif;color:#757575;text-decoration:none;background:0 0}.leaflet-container a.leaflet-popup-close-button:focus,.leaflet-container a.leaflet-popup-close-button:hover{color:#585858}.leaflet-popup-scrolled{overflow:auto}.leaflet-oldie .leaflet-popup-content-wrapper{-ms-zoom:1}.leaflet-oldie .leaflet-popup-tip{width:24px;margin:0 auto}.leaflet-oldie .leaflet-control-layers,.leaflet-oldie .leaflet-control-zoom,.leaflet-oldie .leaflet-popup-content-wrapper,.leaflet-oldie .leaflet-popup-tip{border:1px solid #999}.leaflet-div-icon{background:#fff;border:1px solid #666}.leaflet-tooltip{position:absolute;padding:6px;background-color:#fff;border:1px solid #fff;border-radius:3px;color:#222;white-space:nowrap;-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none;pointer-events:none;box-shadow:0 1px 3px rgba(0,0,0,.4)}.leaflet-tooltip.leaflet-interactive{cursor:pointer;pointer-events:auto}.leaflet-tooltip-bottom:before,.leaflet-tooltip-left:before,.leaflet-tooltip-right:before,.leaflet-tooltip-top:before{position:absolute;pointer-events:none;border:6px solid transparent;background:0 0;content:""}.leaflet-tooltip-bottom{margin-top:6px}.leaflet-tooltip-top{margin-top:-6px}.leaflet-tooltip-bottom:before,.leaflet-tooltip-top:before{left:50%;margin-left:-6px}.leaflet-tooltip-top:before{bottom:0;margin-bottom:-12px;border-top-color:#fff}.leaflet-tooltip-bottom:before{top:0;margin-top:-12px;margin-left:-6px;border-bottom-color:#fff}.leaflet-tooltip-left{margin-left:-6px}.leaflet-tooltip-right{margin-left:6px}.leaflet-tooltip-left:before,.leaflet-tooltip-right:before{top:50%;margin-top:-6px}.leaflet-tooltip-left:before{right:0;margin-right:-12px;border-left-color:#fff}.leaflet-tooltip-right:before{left:0;margin-left:-12px;border-right-color:#fff}@media print{.leaflet-control{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
/* 여행 중 폰 한 손으로 쓰는 일정표: 아래 탭 · 위 지도 · 아래로 시간표. 넓은 화면은 지도 왼쪽 고정 + 시간표 오른쪽 */
:root{
  --bg:#eef1f5; --surface:#ffffff; --sunk:#e3e8ef; --ink:#121a2b; --muted:#536076; --line:#d6dce6;
  --navy:#16223b; --navy-ink:#ffffff; --amber:#f2a31b; --time:#9a5b00;
  --red:#d33838; --red-soft:#fde8e8; --ga:#2f6fdb; --gb:#7b45d6; --walk:#e08a12; --ok:#1f8f55;
  --route:#16223b; --route-case:rgba(255,255,255,.92); --toph:76px;
  --sans:"IBM Plex Sans KR","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;
  --zh:"PingFang SC","Hiragino Sans GB","Noto Sans SC","Microsoft YaHei",system-ui,sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,"SF Mono",Menlo,monospace;
  --navh:64px;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --bg:#0b1019; --surface:#141b29; --sunk:#1b2436; --ink:#e9edf4; --muted:#9ba6ba; --line:#263048;
  --navy:#22314f; --navy-ink:#ffffff; --amber:#f5b43c; --time:#f5b43c;
  --red:#ff6b6b; --red-soft:#3a1d22; --ga:#6f9dff; --gb:#ad8cff; --walk:#f0a03a; --ok:#4cc488;
  --route:#eef2fa; --route-case:rgba(0,0,0,.7); color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#0b1019; --surface:#141b29; --sunk:#1b2436; --ink:#e9edf4; --muted:#9ba6ba; --line:#263048;
  --navy:#22314f; --navy-ink:#ffffff; --amber:#f5b43c; --time:#f5b43c;
  --red:#ff6b6b; --red-soft:#3a1d22; --ga:#6f9dff; --gb:#ad8cff; --walk:#f0a03a; --ok:#4cc488;
  --route:#eef2fa; --route-case:rgba(0,0,0,.7); color-scheme:dark}

*{box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:16px;line-height:1.55;-webkit-text-size-adjust:100%;
  padding-bottom:calc(var(--navh) + env(safe-area-inset-bottom,0px) + 24px)}
.zh{font-family:var(--zh)}
a{color:inherit}
button{font:inherit;color:inherit;cursor:pointer}
:focus-visible{outline:3px solid var(--amber);outline-offset:2px;border-radius:6px}
.wrap{padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
h1,h2,h3{text-wrap:balance;margin:0;line-height:1.25}
.eyebrow{font-family:var(--mono);font-size:13px;letter-spacing:.14em;color:var(--time);font-weight:600;margin:0}

/* 상단 상태줄 */
.top{position:sticky;top:env(safe-area-inset-top,0px);z-index:960;background:var(--navy);color:var(--navy-ink)}
body::before{content:"";position:fixed;inset:0 0 auto;height:env(safe-area-inset-top,0px);z-index:10;background:var(--navy)}
.top .wrap{display:flex;align-items:center;gap:12px;padding-block:10px;min-height:56px}
.brand{font-weight:700;font-size:17px;white-space:nowrap}
.brand small{display:block;font-family:var(--mono);font-size:13px;font-weight:500;color:var(--amber);letter-spacing:.06em}
.now{flex:1;min-width:0;display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.08);border:0;border-radius:12px;padding:8px 12px;text-align:left}
.now .dot{width:10px;height:10px;border-radius:50%;background:var(--amber);flex:none;box-shadow:0 0 0 0 rgba(242,163,27,.6)}
.now.live .dot{animation:pulse 1.8s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(242,163,27,.55)}70%{box-shadow:0 0 0 10px rgba(242,163,27,0)}100%{box-shadow:0 0 0 0 rgba(242,163,27,0)}}
.now .txt{min-width:0;font-size:14px;line-height:1.35}
.now .txt b{display:block;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.now .txt span{display:block;color:#c5cfe0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.clock{font-family:var(--mono);font-size:13px;color:#c5cfe0;text-align:right;white-space:nowrap}
.clock b{display:block;color:#fff;font-size:17px;font-weight:600}

/* 탭 */
.tabs{position:fixed;left:0;right:0;bottom:0;z-index:950;background:var(--surface);border-top:1px solid var(--line);
  padding-bottom:env(safe-area-inset-bottom,0px)}
.tabs .wrap{display:grid;grid-template-columns:repeat(6,1fr);gap:2px;height:var(--navh);align-items:stretch}
.tabs a{display:flex;flex-direction:column;align-items:center;justify-content:center;text-decoration:none;color:var(--muted);font-size:13px;font-weight:600;border-radius:10px;gap:1px;line-height:1.2}
.tabs a b{font-size:15px;color:var(--ink);font-weight:700}
.tabs a[aria-current="page"]{background:var(--navy);color:#c5cfe0}
.tabs a[aria-current="page"] b{color:var(--amber)}
@media (min-width:900px){
  body{padding-bottom:40px}
  .tabs{position:sticky;top:calc(env(safe-area-inset-top,0px) + var(--toph));bottom:auto;border-top:0;border-bottom:1px solid var(--line);padding-bottom:0}
  .tabs .wrap{display:flex;height:auto;padding-block:8px;gap:6px}
  .tabs a{flex-direction:row;gap:8px;padding:8px 16px;font-size:14px}
}

.view{padding-block:20px 8px}
.view[hidden]{display:none!important}

/* 한눈에 */
.hero{position:relative;border-radius:18px;overflow:hidden;background:#0d1424;color:#fff;min-height:300px;display:flex;align-items:flex-end}
.hero img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.62}
.hero .in{position:relative;padding:28px 22px;display:grid;gap:10px;width:100%}
.hero h1{font-size:clamp(36px,8vw,64px);font-weight:700;letter-spacing:-.02em}
.hero .route{font-size:16px;color:#dfe6f2;display:grid;gap:2px}
.hero .route b{font-family:var(--mono);color:var(--amber);font-weight:600;margin-right:8px}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{display:inline-flex;align-items:center;gap:6px;border-radius:8px;padding:6px 10px;font-size:14px;font-weight:700;background:var(--red);color:#fff;text-decoration:none;border:0}
.chip.navy{background:#22304f}
.chip .t{font-family:var(--mono)}
.sec{margin-top:28px;display:grid;gap:12px}
.sec>h2{font-size:22px}
.sec>p.lead{margin:0;color:var(--muted)}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))}
.daycard{display:grid;gap:8px;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:18px;text-decoration:none}
.daycard .eyebrow{font-size:13px}
.daycard h3{font-size:20px}
.daycard ol{margin:0;padding:0;list-style:none;display:grid;gap:4px;font-size:15px}
.daycard li{display:flex;gap:10px;min-width:0}
.daycard li .t{font-family:var(--mono);color:var(--time);font-weight:600;flex:none;width:48px}
.daycard li.star{font-weight:700}
.daycard li.star .t{color:var(--red)}
.daycard .more{color:var(--muted);font-size:14px;font-weight:600}
.tip{background:var(--surface);border-radius:16px;padding:18px;border:1px solid var(--line);display:grid;gap:6px;align-content:start}
.tip h3{font-size:17px}
.tip p{margin:0;color:var(--muted);font-size:15px}
.tip .k{display:inline-block;font-size:13px;font-weight:700;border-radius:6px;padding:2px 8px;color:#fff}
.k.a{background:var(--ga)} .k.b{background:var(--gb)} .k.n{background:var(--navy)} .k.r{background:var(--red)}
.note{font-size:14px;color:var(--muted);margin:0}

/* 하루 */
.dayhead{display:grid;gap:4px;margin-bottom:14px}
.dayhead h2{font-size:clamp(24px,5vw,34px)}
.dayhead p.sum{margin:0;color:var(--muted)}
.daygrid{display:grid;gap:16px}
.mapwrap{position:relative;border-radius:16px;overflow:hidden;border:1px solid var(--line);background:var(--sunk)}
.map{height:min(48vh,440px);min-height:280px;background:#e8eaed}
.legend{display:flex;flex-wrap:wrap;gap:6px 14px;padding:10px 12px;font-size:13px;color:var(--muted);background:var(--surface);border-top:1px solid var(--line)}
.legend i{display:inline-block;width:22px;height:0;border-top:4px solid var(--route);vertical-align:middle;margin-right:6px}
.legend i.walk{border-top:4px dashed var(--walk)} .legend i.train{border-top:4px dashed var(--red)}
.legend i.ga{border-top-color:var(--ga)} .legend i.gb{border-top-color:var(--gb)}
/* 동선 선: 색은 화면 모드 토큰을 따르고, 밑에 테두리 선을 깔아 어느 지도 위에서도 보이게 */
.leaflet-overlay-pane path.rt-case{stroke:var(--route-case)}
.leaflet-overlay-pane path.rt-base{stroke:var(--route)}
.leaflet-overlay-pane path.rt-a{stroke:var(--ga)}
.leaflet-overlay-pane path.rt-b{stroke:var(--gb)}
.leaflet-overlay-pane path.rt-walk{stroke:var(--walk)}
.leaflet-overlay-pane path.rt-train{stroke:var(--red)}
@media (min-width:900px){
  .daygrid{grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);align-items:start}
  .mapwrap{position:sticky;top:calc(env(safe-area-inset-top,0px) + var(--toph) + 70px)}
  .map{height:calc(100vh - var(--toph) - 170px);max-height:none}
  .card{scroll-margin-top:calc(var(--toph) + 70px)}
}
/* 다크모드에서 지도 어둡게 */
:root[data-theme="dark"] .leaflet-tile-pane{filter:invert(.92) hue-rotate(180deg) brightness(.9) contrast(.9)}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .leaflet-tile-pane{filter:invert(.92) hue-rotate(180deg) brightness(.9) contrast(.9)}}
:root[data-theme="dark"] .map{background:#1a1f27}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .map{background:#1a1f27}}

.tl{list-style:none;margin:0;padding:0;display:grid;gap:0}
.leg{display:flex;align-items:center;gap:10px;padding:8px 4px 8px 22px;font-size:14px;color:var(--muted);position:relative;flex-wrap:wrap}
.leg::before{content:"";position:absolute;left:30px;top:0;bottom:0;border-left:3px solid var(--line)}
.leg .m{position:relative;font-size:13px;font-weight:700;border-radius:6px;padding:2px 8px;background:var(--sunk);color:var(--ink);border:1px solid var(--line)}
.leg .m.walk{color:var(--walk)} .leg .m.train{color:var(--red)}
.leg.ga .m{background:var(--ga);color:#fff;border-color:transparent} .leg.gb .m{background:var(--gb);color:#fff;border-color:transparent}
.leg .txt{flex:1;min-width:0}
.leg a{font-weight:700;color:var(--ink);text-decoration:none;border-bottom:2px solid var(--amber);font-size:14px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:16px;overflow:hidden;scroll-margin-top:140px}
.card.star{border-color:var(--red);box-shadow:inset 4px 0 0 var(--red)}
.card.isnow{outline:3px solid var(--amber);outline-offset:-1px}
.card summary{list-style:none;display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:start;padding:14px 14px 14px 12px;cursor:pointer}
.card summary::-webkit-details-marker{display:none}
.tcol{display:grid;justify-items:center;gap:6px;width:62px}
.tcol .time{font-family:var(--mono);font-weight:600;font-size:18px;color:var(--time);font-variant-numeric:tabular-nums}
.card.star .time{color:var(--red)}
.badge{display:inline-grid;place-items:center;min-width:28px;height:28px;padding:0 6px;border-radius:14px;background:var(--navy);color:var(--amber);font-family:var(--mono);font-weight:600;font-size:14px;border:2px solid #fff}
.badge.ga{background:var(--ga);color:#fff} .badge.gb{background:var(--gb);color:#fff} .badge.star{background:var(--red);color:#fff}
.badge.none{background:var(--sunk);color:var(--muted)}
.badge.h{background:#ffffff;color:#16223b;border-color:#16223b}
.hotel{background:var(--surface);border:2px solid var(--navy);border-radius:16px;padding:18px;display:grid;gap:10px}
.hotel h3{font-size:19px}
.hotel p{margin:0;color:var(--muted);font-size:15px}
.hotel .facts{display:grid;gap:4px;font-size:15px;color:var(--ink);margin:0;padding-left:20px}
.hotel .facts li::marker{color:var(--amber)}
.hd{min-width:0;display:grid;gap:3px}
.tagrow{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.tag{font-size:13px;font-weight:700;border-radius:6px;padding:1px 8px;background:var(--sunk);color:var(--muted)}
.tag.r{background:var(--red);color:#fff} .tag.a{background:var(--ga);color:#fff} .tag.b{background:var(--gb);color:#fff}
.tag.nowtag{background:var(--amber);color:#1b1300}
.hd h3{font-size:18px}
.hd .sub{margin:0;color:var(--muted);font-size:14px}
.chev{width:28px;height:28px;display:grid;place-items:center;color:var(--muted);transition:transform .2s}
.card[open] .chev{transform:rotate(180deg)}
.body{padding:0 14px 16px;display:grid;gap:14px}
.body .ph{border-radius:12px;overflow:hidden;aspect-ratio:16/10;background:var(--sunk);max-width:100%}
.body .ph img{width:100%;height:100%;object-fit:cover;display:block}
.body ul{margin:0;padding-left:20px;display:grid;gap:8px;font-size:16px}
.body ul li::marker{color:var(--amber)}
.places{display:grid;gap:8px}
.place{background:var(--navy);color:var(--navy-ink);border-radius:12px;padding:12px 14px;display:grid;gap:10px}
.place a.open{display:flex;align-items:center;justify-content:space-between;gap:12px;text-decoration:none}
.place .nm{font-size:17px;font-weight:600;min-width:0;overflow-wrap:anywhere}
.place .nm small{display:block;font-family:var(--sans);font-size:13px;color:#b9c4d8;font-weight:500}
.place .go{color:var(--amber);font-weight:700;font-size:14px;white-space:nowrap}
.pact{display:flex;gap:8px;flex-wrap:wrap}
.pact button{border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff;border-radius:8px;padding:6px 10px;font-size:14px;font-weight:600}
.btnrow{display:flex;gap:8px;flex-wrap:wrap}
.btn{border:1px solid var(--line);background:var(--sunk);border-radius:10px;padding:8px 14px;font-size:15px;font-weight:600;text-decoration:none;color:var(--ink)}

/* 지도 핀 */
.pin{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:#16223b;color:#f2a31b;font:600 14px/1 var(--mono);border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)}
.pin.h{background:#fff;color:#16223b;border-color:#16223b;border-radius:8px}
.pin.ga{background:#2f6fdb;color:#fff}.pin.gb{background:#7b45d6;color:#fff}.pin.star{background:#d33838;color:#fff}
.pin.sel{transform:scale(1.25)}
.leaflet-popup-content{font-family:var(--sans);font-size:15px;margin:12px 14px;min-width:180px}
.pop b{display:block;font-size:16px}
.pop .pt{font-family:var(--mono);color:#9a5b00;font-weight:600}
.pop .zh{color:#536076;font-size:13px;margin:2px 0 8px}
.pop .row{display:flex;gap:8px;flex-wrap:wrap}
.pop button,.pop a{border:0;border-radius:8px;padding:6px 10px;font-size:14px;font-weight:700;background:#16223b;color:#fff!important;text-decoration:none}
.pop a{background:#f2a31b;color:#1b1300!important}
.leaflet-container{font-family:var(--sans)}
.leaflet-control-attribution{font-size:11px}

/* 쇼핑 */
.filters{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px}
.filters button{flex:none;border:1px solid var(--line);background:var(--surface);border-radius:20px;padding:8px 14px;font-size:15px;font-weight:600}
.filters button[aria-pressed="true"]{background:var(--navy);color:#fff;border-color:var(--navy)}
.where{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))}
.where .tip p{color:var(--ink)}
.items{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(min(100%,230px),1fr))}
.item{background:var(--surface);border:1px solid var(--line);border-radius:16px;overflow:hidden;display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto 1fr}
.item .im{background:#fff;aspect-ratio:4/3;position:relative;min-width:0;overflow:hidden}
.item .im img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
.item .num{position:absolute;left:10px;top:10px;z-index:1}
.item .tx{padding:12px 14px 14px;display:grid;grid-template-columns:minmax(0,1fr);gap:3px;align-content:start;min-width:0}
.item h3{font-size:17px}
.item .zh{color:var(--ga);font-size:14px}
.item .wh{font-size:14px;font-weight:700;color:var(--time)}
.item p{margin:0;font-size:15px;color:var(--muted)}
.item label{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:15px;font-weight:600;cursor:pointer}
.item input{width:22px;height:22px;accent-color:var(--ok)}
.item.got{opacity:.6}
.warn{background:var(--red-soft);border-radius:14px;padding:14px 16px;font-size:15px;border:1px solid var(--line)}
.warn b{color:var(--red);margin-right:6px}

/* 준비 */
.check{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.check li{background:var(--surface);border:1px solid var(--line);border-radius:14px}
.check label{display:grid;grid-template-columns:auto 1fr;gap:12px;padding:14px;cursor:pointer;align-items:start}
.check input{width:24px;height:24px;margin-top:2px;accent-color:var(--ok)}
.check b{display:block;font-size:17px}
.check span{color:var(--muted);font-size:15px}
.check li.done b{text-decoration:line-through;color:var(--muted)}
.kw{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr))}
.kw .row{display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:10px 12px}
.kw .row .n{min-width:0}
.kw .row .n b{display:block;font-family:var(--zh);font-size:16px;font-weight:600;overflow-wrap:anywhere}
.kw .row .n span{font-size:13px;color:var(--muted)}
.kw .row button,.kw .row a{border:1px solid var(--line);background:var(--sunk);border-radius:8px;padding:6px 10px;font-size:14px;font-weight:600;text-decoration:none;white-space:nowrap}
.kw .row a{background:var(--navy);color:#fff;border-color:var(--navy)}
.vids{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))}
.vid{background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow:hidden;text-decoration:none;display:grid;grid-template-columns:minmax(0,1fr)}
.vid img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block}
.vid div{padding:10px 12px;display:grid;gap:4px}
.vid b{font-size:15px;line-height:1.4}
.vid span{font-size:13px;color:var(--muted)}

/* 기사님께 보여주기 */
#driver{position:fixed;inset:0;z-index:2000;background:#0b1019;color:#fff;display:flex;flex-direction:column;justify-content:center;gap:18px;
  padding:calc(env(safe-area-inset-top,0px) + 24px) max(24px,env(safe-area-inset-right,0px)) calc(env(safe-area-inset-bottom,0px) + 24px) max(24px,env(safe-area-inset-left,0px))}
#driver .ask{font-family:var(--zh);font-size:clamp(26px,6vw,40px);color:var(--amber);margin:0}
#driver .big{font-family:var(--zh);font-size:clamp(40px,11vw,88px);font-weight:700;line-height:1.2;margin:0;overflow-wrap:anywhere}
#driver .ko{font-size:18px;color:#c5cfe0;margin:0}
#driver .help{font-size:14px;color:#8d98ad;margin:0}
#driver button{position:absolute;top:calc(env(safe-area-inset-top,0px) + 14px);right:max(14px,env(safe-area-inset-right,0px));background:#22314f;border:0;color:#fff;border-radius:10px;padding:10px 16px;font-size:16px;font-weight:700}
.toast{position:fixed;left:50%;bottom:calc(var(--navh) + env(safe-area-inset-bottom,0px) + 16px);transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:10px;font-size:15px;font-weight:600;z-index:2100;max-width:calc(100% - 32px)}
@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}
</style>

</head><body>
<header class="top">
  <div class="wrap">
    <div class="brand">상하이 2박 3일<small>11.28 – 11.30</small></div>
    <button class="now" id="now" type="button" aria-live="polite"><span class="dot"></span><span class="txt"><b id="nowA">일정 확인 중</b><span id="nowB"></span></span></button>
    <div class="clock" id="clock" title="상하이 시간 (한국보다 1시간 늦음)"><span>상하이</span><b>--:--</b></div>
  </div>
</header>

<nav class="tabs" aria-label="화면">
  <div class="wrap">
    <a href="#overview" data-v="overview"><b>한눈에</b>전체</a>
    <a href="#day1" data-v="day1"><b>토 28</b>디즈니</a>
    <a href="#day2" data-v="day2"><b>일 29</b>두 조</a>
    <a href="#day3" data-v="day3"><b>월 30</b>귀국</a>
    <a href="#shop" data-v="shop"><b>쇼핑</b>사올 것</a>
    <a href="#prep" data-v="prep"><b>준비</b>참고</a>
  </div>
</nav>

<main>
  <section class="view wrap" id="v-overview" data-view="overview"></section>
  <section class="view wrap" id="v-day1" data-view="day1" hidden></section>
  <section class="view wrap" id="v-day2" data-view="day2" hidden></section>
  <section class="view wrap" id="v-day3" data-view="day3" hidden></section>
  <section class="view wrap" id="v-shop" data-view="shop" hidden></section>
  <section class="view wrap" id="v-prep" data-view="prep" hidden></section>
</main>

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
/* ── 장소 (고덕지도 좌표 · GCJ-02) ── */
const P={
 pvg:["푸동공항","上海浦东国际机场",121.808405,31.140627],
 htl:["숙소 · 그랜드 머큐어 훙차오","上海虹桥美爵酒店",121.396887,31.205961,"长宁区仙霞路369号"],
 dhub:["디즈니 택시 하차장","上海迪士尼度假区西公交枢纽",121.668268,31.145833],
 dis:["디즈니랜드","上海迪士尼乐园",121.660536,31.144071],
 yang:["오래전 양꼬치","很久以前羊肉串(南京路第一百货店)",121.474374,31.235746],
 kang:["캉다오 발마사지","康道天地(南京路店)",121.481325,31.236025],
 yuy:["예원","豫园",121.492449,31.226944],
 nx:["남상만두점","南翔馒头店(豫园路店)",121.491579,31.226553],
 lbl:["녹파랑","绿波廊酒楼(豫园总店)",121.491868,31.226432],
 sjtu:["상해교통대","上海交通大学徐汇校区",121.433025,31.199027],
 ap:["AP Plaza 짝퉁시장","亚太盛汇购物广场(上海科技馆站)",121.542961,31.219760],
 hq:["상하이 훙차오역","上海虹桥站",121.320623,31.194151],
 zjg:["장자강역","张家港站",120.673511,31.817305],
 bund:["와이탄 야경","外滩(陈毅广场)",121.491080,31.236525],
 vue:["VUE 루프탑 바","VUE Bar(上海外滩茂悦大酒店32-33楼)",121.492848,31.244963],
 dhc:["대호춘 생지엔","大壶春(四川中路店)",121.489259,31.234732],
 rt:["따룬파 마트","大润发(平型关店)",121.466473,31.266769],
 qz:["칭즈 핸드크림","青稚护手霜(上海南京东路店)",121.488347,31.238808],
 gx:["관샤 와이탄점","观夏(上海洛克外滩源体验店)",121.488290,31.241835],
 pop:["팝마트 플래그십","POP MART泡泡玛特(全球旗舰店)",121.484714,31.237309],
 mns:["미니소랜드","名创优品IP乐园(全球壹号店)",121.481325,31.236025],
 mms:["M&M's 월드","M&M's巧克力世界(南京东路店)",121.476082,31.234756],
 ff:["제일식품상점","上海市第一食品商店(南京东路720号)",121.476689,31.235610],
 jj:["자자탕바오","佳家汤包(黄河路店)",121.470596,31.235088],
 gj:["국제반점 나비파이","国际饭店(蝴蝶酥 南京西路170号)",121.471539,31.233674],
 ole:["올레 마트","Ole精品超市(新世界新丸中心店)",121.485967,31.238310],
 phw:["포토위드","PHOTOWITH自助照相馆(何东旧居店)",121.452464,31.230397],
 sbr:["스벅 리저브 로스터리","星巴克臻选上海烘焙工坊(兴业太古汇)",121.463088,31.229078],
 lv:["루이비통 더 루이","路易号 The Louis(兴业太古汇)",121.463568,31.228695],
 yyl:["예원 (왕홍체험)","豫园老街",121.491391,31.227392],
 hkj:["홍쿠이지아","红盔甲·小龙虾(人民广场店)",121.480363,31.227072],
 ins:["클럽 INS","INS新乐园(雁荡路109号)",121.470250,31.217865],
 sht:["상하이타워 전망대","上海中心大厦(上海之巅观光厅)",121.505682,31.233629],
 cru:["황푸강 크루즈","黄浦江游览(十六铺码头)",121.498233,31.228588],
 ljs:["라오지스","老吉士酒家(天平路店)",121.437942,31.202820],
 wk:["우캉맨션","武康大楼",121.438278,31.204430],
 lelabo:["르라보 × 징야 (우캉루)","LE LABO 武康路135号",null,null,"徐汇区武康路135号"],
 harmay:["화메이 안푸루 플래그십","HARMAY话梅 安福路",null,null,"武康路55号 (安福路口)"],
 vr:["《烧火工》 VR · 과학기술관","上海科技馆 烧火工沉浸体验空间",121.542073,31.218459,"浦东新区世纪大道2000号 B1"]
};
const enc=encodeURIComponent;
const amap=k=>{const p=P[k];if(p[2]==null)return \`https://uri.amap.com/search?keyword=\${enc(p[1])}&city=\${enc("上海")}&src=shanghai_trip&callnative=1\`;return \`https://uri.amap.com/marker?position=\${p[2]},\${p[3]}&name=\${enc(p[1])}&src=shanghai_trip&coordinate=gaode&callnative=1\`};
const MODE={walk:["도보","walk"],taxi:["택시","car"],subway:["지하철","bus"],train:["고속철",null]};
const navUrl=(a,b,m)=>{const A=P[a],B=P[b];return \`https://uri.amap.com/navigation?from=\${A[2]},\${A[3]},\${enc(A[1])}&to=\${B[2]},\${B[3]},\${enc(B[1])}&mode=\${m}&policy=1&src=shanghai_trip&coordinate=gaode&callnative=1\`};

/* ── 일정 ── */
const DAYS=[
{id:"day1",n:1,date:[2026,11,28],wd:"토",title:"푸동공항 → 디즈니랜드",sum:"디즈니 16:30~21:30 → 양꼬치 → 발마사지 → 훙차오 숙소",fit:["pvg","dis","yang","htl"],items:[
 {t:"15:30",tag:"이동",title:"푸동공항 → 디즈니",sub:"上海浦东国际机场 → 上海迪士尼度假区",img:"p5",pin:"pvg",pts:["pvg","dhub"],b:[
  "디즈니는 바퀴 달린 캐리어 반입 불가. 공항에서 호텔로 짐 배송을 맡기거나 정문 보안검색대 동쪽 유료 보관소 이용",
  "택시·디디 20~30분, 80~130위안. 목적지는 「上海迪士尼度假区西公交枢纽」(택시 하차 지정 장소)",
  "실명제 티켓이라 예약한 여권 원본 필수"]},
 {t:"16:30",tag:"액티비티",title:"디즈니 입장 → 주토피아",sub:"上海迪士尼乐园 · 세계 최초 주토피아 존",img:"p6",pin:"dis",pts:["dis"],
  go:[{m:"taxi",txt:"택시·디디 20~30분 · 80~130위안",from:"pvg",to:"dhub"}],b:[
  "11/28(토) 1일권 569위안 (공식 홈페이지 기준) · 운영 08:30~21:30. 얼리버드는 10일 전 마감이라 일반권",
  "주디·닉 경찰차를 타는 「주토피아 핫 퍼슈트」는 저녁에도 대기 1시간 넘는 날이 많아요",
  "시간 아끼려면 DPA(유료 패스트트랙): 입장 후 공식 앱에서 1개 180위안대, 선착순"]},
 {t:"17:45",tag:"액티비티",title:"트론",sub:"TRON Lightcycle Power Run · 투모로우랜드",img:"p7",pin:"dis",pts:["dis"],b:[
  "오토바이 자세로 엎드려 타는 롤러코스터. 조명 켜진 밤에 타야 분위기 최고",
  "주토피아 + 트론 DPA 2개(360위안대)면 짧은 일정에도 둘 다 확실히 탈 수 있어요",
  "키 122cm 이상, 가방은 탑승 전 보관 카트에"]},
 {t:"18:15",tag:"공연",title:"겨울 퍼레이드 + 캐리비안",sub:"Disney Winter Magic Cavalcade · 캐리비안의 해적",img:"p8",pin:"dis",pts:["dis"],b:[
  "18:15 겨울 퍼레이드 (11/28 공식 시간표)",
  "퍼레이드 시간엔 다른 줄이 짧아져요. 캐리비안의 해적은 전투 장면 퀄리티로 유명",
  "파크 안 저녁은 간단히. 양꼬치 먹을 배 남겨두기"]},
 {t:"20:00",tag:"공연",title:"ILLUMINATE 불꽃 야간쇼",sub:"성 앞 불꽃 + 프로젝션 쇼 · 11/28은 20:00, 21:15",img:"p9",pin:"dis",pts:["dis"],b:[
  "20:00 회차를 보고 21:30 폐장까지 줄 짧아진 트론·주토피아 한 번 더 또는 굿즈 쇼핑",
  "10주년 특별쇼 「Magic Together」도 20:15, 21:30에 있어요",
  "폐장 직후엔 택시 줄이 길어요. 디디를 미리 부르거나 지하철 11호선 디즈니역"]},
 {t:"22:30",tag:"저녁 · 필수",star:1,title:"오래전 양꼬치",sub:"很久以前羊肉串 (南京路第一百货店) · B관 6층",img:"p10",pin:"yang",pts:["yang"],
  go:[{m:"taxi",txt:"택시 45~60분 (지하철은 1시간 이상)",from:"dis",to:"yang"}],b:[
  "디즈니에서 택시 약 45~60분, 지하철로는 1시간 이상",
  "새벽 3시까지 영업이라 늦게 가면 오히려 대기가 짧아요",
  "추천: 呼伦贝尔羊肉串(양꼬치), 烤馒头(꽃빵구이), 烤茄子(가지구이) + 칭다오 맥주"]},
 {t:"24:00",tag:"힐링",title:"발마사지",sub:"캉다오(康道天地) 남경로점 · 남경동로 479호 10층",img:"p11",pin:"kang",pts:["kang"],
  go:[{m:"walk",txt:"걸어서 약 10분",from:"yang",to:"kang"}],b:[
  "디즈니에서 하루 종일 걸은 다리 풀기. 양꼬치집에서 걸어서 약 10분",
  "남경로점은 24시간. 다만 새벽 1시 이후엔 마사지사가 2명뿐이라 예약 필수",
  "발+전신 90분 코스가 가성비. 마이리얼트립 예약 시 4~6만원대"]},
 {t:"01:30",nd:1,tag:"숙소",title:"숙소로 · 체크인",sub:"그랜드 머큐어 상하이 훙차오 · 上海虹桥美爵酒店",pin:"htl",pts:["htl"],
  go:[{m:"taxi",txt:"디디·택시 약 30분 (밤이라 덜 막힘)",from:"kang",to:"htl"}],b:[
  "난징동루에서 서쪽으로 약 10km. 디디 목적지는 「上海虹桥美爵酒店」",
  "기사님께는 「기사님께 보여주기」 화면(주소 长宁区仙霞路369号 포함)을 보여 주세요",
  "공항에서 짐 배송을 맡겼다면 프런트에서 찾기"]}
]},
{id:"day2",n:2,date:[2026,11,29],wd:"일",title:"예원 → 두 조 → 장자강 → 와이탄",sum:"점심 뒤 A조는 우캉루 향수 산책 → 상해교통대, B조는 《烧火工》 VR → 짝퉁시장 · 16:00 훙차오역에서 4명 다시 모임",fit:["yuy","sjtu","wk","vr","hq","vue","htl"],items:[
 {t:"09:00",tag:"관광",title:"예원",sub:"豫园 · 명나라 정원 + 구곡교 · 성황묘",img:"p14",pin:"yuy",pts:["yuy"],
  go:[{m:"subway",txt:"숙소에서 08:15쯤 출발 · 걸어서 약 15분 10호선 伊犁路역 → 豫园역 직행 (택시면 약 30~40분)",from:"htl",to:"yuy"}],b:[
  "9:00 개장, 16:00 입장 마감, 11월 입장료 40위안 (월요일 휴무, 일요일은 OK)",
  "정원 1~1.5시간 + 구곡교·성황묘·예원상가 구경",
  "주말이라 문 열자마자 들어가야 덜 붐벼요"]},
 {t:"11:30",tag:"점심",title:"남상만두점 점심",sub:"南翔馒头店 豫园路 · 샤오롱바오 원조집",img:"p15",pin:"nx",pts:["nx","lbl"],
  go:[{m:"walk",txt:"예원 바로 옆",from:"yuy",to:"nx"}],b:[
  "07:30~20:00 · 2~3층 홀 1인 80~120위안. 주말엔 홀 대기가 1시간 넘을 수 있어 11시 반 전에 줄 서기",
  "대안: 녹파랑(绿波廊) 본방차이·딤섬. 고덕지도에 「정문 공사 중」 표시가 있어 영업 여부 전화 확인 (021-63280602)",
  "12:45 두 조로 나눠 출발"]},
 {t:"12:45",tag:"향수",group:"a",title:"A조 (2명) · 우캉루 향수 산책",sub:"르라보 × 징야 · 화메이 · 은행잎 · 교통대에서 걸어서 10분",pin:"wk",pts:["lelabo","harmay","wk"],
  go:[{m:"subway",txt:"A조 · 예원역 10호선 → 交通大学역 직행 약 15분, 걸어서 10분",from:"nx",to:"wk",g:"a"}],b:[
  "13:05쯤 交通大学역 도착 → 우캉맨션에서 우캉루를 따라 걷기. 11월 하순이 은행잎 절정 (武康路390号 은행나무가 사진 명소)",
  "르라보 × 징야(静雅) 武康路135号: 글로벌 니치 브랜드가 1999년부터 이 거리에 있던 현지 공예 브랜드와 매장을 같이 쓰는 형식. 조향실 + 도자 갤러리, 상하이 한정 향 Myrrhe 55",
  "화메이(话梅) 안푸루 플래그십 武康路55号: 4층 창고형 뷰티 편집숍. 중국에서 팔리는 니치·로컬 향수를 한 번에 시향하고 진열 방식 보기. 2026년 영업 여부는 가기 전 확인",
  "13:00부터 위챗 「参观交大」 당일 등록(여권) 해 두고, 14:15에 교통대로 출발"]},
 {t:"12:45",tag:"VR",group:"b",title:"B조 (2명) · 《烧火工》 VR",sub:"상하이 과학기술관 B1 · 2호선 上海科技馆역 · 짝퉁시장과 같은 역",pin:"vr",pts:["vr"],
  go:[{m:"subway",txt:"B조 · 지하철 약 30분 또는 택시 약 20분",from:"nx",to:"vr",g:"b"}],b:[
  "류츠신의 SF 동화를 옮긴 대형 VR. 아트 전시(600㎡ 넘음) → 프리로밍 VR(500㎡ 넘음, 최대 70명 동시) 두 단계, 약 1.5시간",
  "공간형 VR(LBE) 사업 모델을 직접 보는 자리. 과학기술관 위챗 미니프로그램에서 실명(여권) 사전 예약 필수",
  "회차·가격·일요일 운영 시간은 아직 확인 못 함. 13:15~13:30 회차로 잡아야 짝퉁시장 들를 시간이 남아요",
  "끝나면 같은 역 지하상가 짝퉁시장으로"]},
 {t:"14:30",tag:"필수",group:"a",star:1,title:"A조 · 상해교통대 약속",sub:"上海交通大学 徐汇校区 · 华山路1954号 · 14:30 약속",img:"p16",pin:"sjtu",pts:["sjtu"],
  go:[{m:"walk",txt:"A조 · 14:15 우캉루에서 걸어서 약 10분",from:"wk",to:"sjtu",g:"a"}],b:[
  "13:00부터 위챗 「上海交通大学」 → 「参观交大」 당일 등록, 여권 필수",
  "15:30 출발: 10호선 交通大学 → 虹桥火车站 직행 약 30분 (虹桥火车站행 확인, 航中路행 X)"]},
 {t:"14:45",tag:"쇼핑",group:"b",title:"B조 · AP Plaza 짝퉁시장 (남는 시간만)",sub:"亚太盛汇 · 같은 역 지하상가 · 15:00 출발",img:"p17",pin:"ap",pts:["ap"],
  go:[{m:"walk",txt:"B조 · 같은 역 지하상가 · 걸어서 2~3분",from:"vr",to:"ap",g:"b"}],b:[
  "VR 끝나고 15:00 출발까지 15분 남짓이라 구경 위주. VR 회차가 늦게 잡히면 빼요",
  "영상 속 그곳. 역과 바로 연결된 지하상가, 10:00~20:00",
  "겉 가게는 보세 수준, 퀄리티 좋은 건 호객꾼 따라 들어가는 「창고(비밀의 방)」. 촬영에 예민하니 카메라 조심",
  "부른 값의 절반 이하로 흥정 (영상: 85만원 → 40만원). 짝퉁은 한국 세관에서 압수될 수 있어요",
  "15:00 출발: 2호선 직행 虹桥火车站 약 50분"]},
 {t:"16:17",tag:"이동",title:"고속철 → 장자강",sub:"上海虹桥站 → 张家港站 · G7138 · 약 50분 · 16:00 집합",img:"p18",pin:"hq",pts:["hq","zjg"],
  go:[{m:"subway",txt:"A조 · 15:30 출발 10호선 → 虹桥火车站 약 30분",from:"sjtu",to:"hq",g:"a"},{m:"subway",txt:"B조 · 15:00 출발 2호선 직행 약 50분",from:"ap",to:"hq",g:"b"}],b:[
  "16:00 훙차오역 집합 (여권으로 개찰·보안검사). G7138 16:17 → 17:07, 2등석 53위안",
  "대안: D2136 훙차오 16:11 → 17:15 / C3802 상하이역 15:46 → 17:01",
  "표는 트립닷컴·12306 앱에서 여권으로 예매. 일요일 오후라 4장 미리 사두기"]},
 {t:"17:07",tag:"저녁",title:"장자강 · Kubert 씨와 저녁",sub:"张家港站 · 江苏省 张家港市 塘桥镇",img:"p19",pin:"zjg",pts:["zjg"],
  go:[{m:"train",txt:"G7138 16:17 → 17:07 · 약 50분",from:"hq",to:"zjg"}],b:[
  "역에서 Kubert 씨 만나 저녁. 식당은 귀가 열차 시간에 맞게 역 근처로 (Kubert 씨 추천)",
  "귀가: D5565 张家港 19:29 → 上海虹桥 20:21 (54위안). 일찍 나오면 G2573 19:04 → 19:58",
  "더 있고 싶으면 G8285 20:35 → 상하이역 21:44. 다만 와이탄 조명은 22:00에 꺼져요"]},
 {t:"21:10",tag:"사진",title:"와이탄 야경 + 즉석 스냅",sub:"外滩 · 남경동로 끝 강변 산책로",img:"p20",pin:"bund",pts:["bund"],
  go:[{m:"train",txt:"D5565 19:29 → 20:21 훙차오",from:"zjg",to:"hq"},{m:"subway",txt:"훙차오역에서 2호선 직행 南京东路역 약 40분 (택시 35~45분)",from:"hq",to:"bund"}],b:[
  "훙차오역에서 지하철 2호선 직행 南京东路역 약 40분 (택시 35~45분)",
  "와이탄 조명은 요즘 18:00~22:00. 늦어도 21:30 전에 도착하기",
  "강변 현장 스냅 작가: 1장 30위안, 5장 140위안대에 보정본 바로 전송"]},
 {t:"22:00",tag:"나이트",title:"VUE 루프탑 바",sub:"Hyatt on the Bund 32~33층 · 북와이탄",img:"p21",pin:"vue",pts:["vue"],
  go:[{m:"walk",txt:"걸어서 15분",from:"bund",to:"vue"}],b:[
  "와이탄과 루자쭈이가 양쪽으로 보이는 루프탑. 야외 자쿠지로 유명",
  "일요일 입장 128위안(음료 1잔 포함) · 일~목 01:30까지. 스마트 캐주얼",
  "배고프면 홍쿠이지아 마라롱샤 야식(새벽 2:30까지), 더 놀고 싶으면 클럽 INS"]},
 {t:"24:00",tag:"숙소",title:"숙소로",sub:"VUE는 일~목 01:30까지 · 숙소까지 택시 약 30분",pin:"htl",pts:["htl"],
  go:[{m:"taxi",txt:"디디·택시 약 30분",from:"vue",to:"htl"}],b:[
  "디디 목적지는 「上海虹桥美爵酒店」",
  "월요일은 07:50에 체크아웃하고 나가야 하니 짐은 이날 밤에 미리 싸 두기"]}
]},
{id:"day3",n:3,date:[2026,11,30],wd:"월",title:"따룬파 → 난징동루 쇼핑 → 귀국",sum:"아침에 체크아웃하고 캐리어 맡기기 → 생지엔 → 따룬파 → 칭즈 · 관샤 → 난징동루 한 줄로 걸으며 쇼핑 → 점심 → 숙소에서 짐 찾고 공항",fit:["dhc","rt","gx","jj"],items:[
 {t:"07:50",tag:"숙소",title:"체크아웃 · 캐리어 맡기기",sub:"그랜드 머큐어 상하이 훙차오 · 上海虹桥美爵酒店",pin:"htl",pts:["htl"],b:[
  "숙소가 시내에서 약 10km 떨어진 훙차오라, 낮에 숙소를 두 번 오가지 않도록 아침에 체크아웃까지 끝내고 나가요",
  "짐은 일요일 밤에 미리 싸 두고, 체크아웃하면서 프런트에 캐리어 맡기기 (13:25쯤 찾으러 옴)",
  "디디로 대호춘까지 약 30~40분"]},
 {t:"08:30",tag:"아침",title:"생지엔 아침",sub:"大壶春 四川中路店 · 와이탄 근처 · 상하이식 군만두",img:"p24",pin:"dhc",pts:["dhc"],
  go:[{m:"taxi",txt:"07:50 디디 출발 · 약 30~40분",from:"htl",to:"dhc"}],b:[
  "체크아웃은 끝났고 캐리어는 숙소에 맡겨 둔 상태",
  "바닥이 바삭한 생지엔 노포. 1인 약 27위안, 새우 생지엔(虾仁生煎) 추천",
  "09:00 디디 한 대로 따룬파 출발 (4명이면 6인승 「六座」 선택 안 해도 됨)"]},
 {t:"09:20",tag:"쇼핑",title:"따룬파 마트 털기",sub:"大润发(平型关店) · 俞泾港路11号 B1 · 08:00~22:00",img:"p25",pin:"rt",pts:["rt"],
  go:[{m:"taxi",txt:"09:00 디디 출발 · 20~25분 · 약 28위안",from:"dhc",to:"rt"}],b:[
  "난징동루에서 택시 20~25분, 약 28위안. 입구에 한국인 인기상품 코너가 따로 있어서 그것만 훑어도 충분 (후기 기준 1시간)",
  "필수템: I❤SH 티셔츠 39.9위안, 카만 에그롤, 레이즈 오이맛, 투도우펀, 하이디라오 소스, 세다람쥐 마카다미아",
  "카카오페이로 결제하면 300위안 이상 25위안 할인 (블로그 기준 12/31까지)",
  "10:10 디디로 난징동루 동쪽 끝 칭즈로 바로 이동 (관샤 시간을 내려고 20분 일찍 나와요). 산 물건은 계속 들고 다니니 큰 장바구니 챙기기"]},
 {t:"10:30",tag:"쇼핑",title:"칭즈 핸드크림",sub:"青稚 南京东路66号 · 와이탄 쪽 끝 · 09:00~24:00",img:"p26",pin:"qz",pts:["qz"],
  go:[{m:"taxi",txt:"10:10 디디 출발 · 약 20분",from:"rt",to:"qz"}],b:[
  "탄생화·상하이 에디션 핸드크림 1개 50~55위안. 무료 각인·포장은 3개에 30분 걸렸다는 후기가 있어서, 시간 없으면 포장만",
  "10:55에 관샤 외탄위안점으로 (걸어서 7분, 11시 오픈)",
  "관샤 다음부터는 난징동루를 와이탄 → 인민광장 방향으로 한 줄로 걷기만 하면 돼요 (약 1.2km)"]},
 {t:"11:00",tag:"향수",title:"관샤 외탄위안점",sub:"观夏 圆明园路149号 · 「작가의 서재」 콘셉트 · 11:00~22:00",pin:"gx",pts:["gx"],
  go:[{m:"walk",txt:"걸어서 7분",from:"qz",to:"gx"}],b:[
  "「동양의 향」을 내세운 중국 대표 향 브랜드. 상하이 매장 5곳 콘셉트가 다 다르고, 이곳은 옛 건물을 쓴 「작가의 서재」",
  "향수는 10만원 초중반, 고체향수 4~5만원대, 디퓨저도 있어요. 고급 선물과 사업 참고용으로 시향",
  "11:30 난징동루로 돌아가 팝마트로 (걸어서 약 10분)"]},
 {t:"11:40",tag:"쇼핑",title:"팝마트 · 미니소랜드",sub:"POP MART 南京东路299号 2F · 名创优品 南京东路479号",img:"p27",pin:"pop",pts:["pop","mns","mms"],
  go:[{m:"walk",txt:"걸어서 약 10분",from:"gx",to:"pop"}],b:[
  "팝마트 글로벌 플래그십 10:00~23:00: 라부부·스컬판다·텔레토비 랜덤박스",
  "미니소랜드는 난징동루에 여러 개라 479호 全球壹号店(3층 규모)으로. 산리오·치이카와·디즈니 굿즈",
  "같은 길에 M&M's 월드·레고 스토어도 있어서 지나가면서 구경"]},
 {t:"12:05",tag:"쇼핑",title:"제일식품상점",sub:"上海市第一食品商店 · 南京东路720号",img:"p28",pin:"ff",pts:["ff"],
  go:[{m:"walk",txt:"걸어서 5분",from:"pop",to:"ff"}],b:[
  "화이트래빗 사탕을 맛별로 담아 무게로 계산. 회사·친구 뿌리기용",
  "대추누가·나비파이는 부모님 선물용",
  "같은 매장에서 200위안 넘게 사면 여권 내고 택스리펀 서류 받기"]},
 {t:"12:20",tag:"점심",title:"자자탕바오 점심",sub:"佳家汤包 黄河路 · 난징동루 서쪽 끝에서 걸어서 5분",img:"p29",pin:"jj",pts:["jj","gj"],
  go:[{m:"walk",txt:"걸어서 5분",from:"ff",to:"jj"}],b:[
  "주문하고 빚어 나오는 게살 탕바오. 1인 약 41위안, 게살 비빔면도 유명",
  "바로 앞 국제반점(国际饭店) 나비파이는 258겹 원조, 고급 선물용. 줄 길면 패스",
  "12:50 디디로 숙소 (약 30~40분) → 캐리어 찾기"]},
 {t:"13:25",tag:"숙소",title:"숙소에서 캐리어 찾기",sub:"上海虹桥美爵酒店 · 프런트",pin:"htl",pts:["htl"],
  go:[{m:"taxi",txt:"12:50 디디 출발 · 약 30~40분",from:"jj",to:"htl"}],b:[
  "맡긴 캐리어 찾고 바로 공항으로",
  "공항 가는 디디는 캐리어 4개면 6인승(六座商务) 1대 또는 일반 2대"]},
 {t:"13:35",tag:"이동",title:"푸동공항 → 16:50 귀국",sub:"上海浦东国际机场 · 14:40쯤 도착",img:"p30",pin:"pvg",pts:["pvg"],
  go:[{m:"taxi",txt:"13:35 숙소 출발 · 훙차오 → 푸동 약 50km · 약 60~70분",from:"htl",to:"pvg"}],b:[
  "숙소(훙차오)에서 푸동공항까지 약 50km, 디디 약 60~70분. 16:50 비행기라 14:40쯤 도착하면 2시간 남짓 여유",
  "공항: 체크인 → 세관에서 택스리펀 물건 확인 도장 → 출국심사 → 안쪽 환급 창구",
  "출국장에서 나비파이·베이징덕맛 프레첼 같은 막판 간식 쇼핑 가능",
  "늦어지면 칭즈나 제일식품상점부터 빼기"]}
]}];
const TRIP_END=[2026,11,30,16,50];

/* ── 시간 (상하이 = UTC+8) ── */
const sh=(y,mo,d,h,mi)=>Date.UTC(y,mo-1,d,h-8,mi);
const FLAT=[];
DAYS.forEach(D=>D.items.forEach((it,i)=>{const [h,m]=it.t.split(":").map(Number);it.at=sh(D.date[0],D.date[1],D.date[2],h,m)+(it.nd?864e5:0);it.day=D;it.idx=i;it.key=D.id+"-"+i;FLAT.push(it)}));
FLAT.sort((a,b)=>a.at-b.at);
const shNow=()=>new Date(Date.now()+8*3600e3); // UTC 필드로 읽으면 상하이 시각
const pad=n=>String(n).padStart(2,"0");
function dur(ms){const m=Math.round(ms/60000);if(m<60)return m+"분";const h=Math.floor(m/60),r=m%60;return h+"시간"+(r?" "+r+"분":"")}
function status(){
  const now=Date.now();const first=FLAT[0];const end=sh(...TRIP_END);
  if(now<first.at){
    const a=shNow();const today=Date.UTC(a.getUTCFullYear(),a.getUTCMonth(),a.getUTCDate());const dd=Math.round((Date.UTC(2026,10,28)-today)/864e5);
    return {live:false,a:dd>0?\`출발까지 D-\${dd}\`:\`오늘 출발 · \${dur(first.at-now)} 뒤 시작\`,b:"11/28(토) 15:30 푸동공항 도착부터",go:first};
  }
  if(now>end)return {live:false,a:"여행 끝! 다들 수고했어요",b:"11/30(월) 16:50 푸동 출발",go:null};
  let cur=null,next=null;for(const it of FLAT){if(it.at<=now)cur=it;else{next=it;break}}
  if(!next)return {live:true,a:\`지금 · \${cur.title}\`,b:\`16:50 비행기 · \${dur(end-now)} 뒤\`,go:cur,cur};
  return {live:true,a:\`지금 · \${cur.title}\`,b:\`다음 \${next.t} \${next.title} · \${dur(next.at-now)} 뒤\`,go:cur,cur};
}
let ST=null;
function tick(){
  const a=shNow();document.querySelector("#clock b").textContent=pad(a.getUTCHours())+":"+pad(a.getUTCMinutes());
  ST=status();const btn=document.getElementById("now");btn.classList.toggle("live",ST.live);
  document.getElementById("nowA").textContent=ST.a;document.getElementById("nowB").textContent=ST.b;
  document.querySelectorAll(".card.isnow").forEach(c=>{c.classList.remove("isnow");const t=c.querySelector(".nowtag");if(t)t.remove()});
  if(ST.cur){const c=document.getElementById("it-"+ST.cur.key);if(c){c.classList.add("isnow");const tr=c.querySelector(".tagrow");if(tr&&!tr.querySelector(".nowtag")){const s=document.createElement("span");s.className="tag nowtag";s.textContent="지금";tr.prepend(s)}}}
}

/* ── 그리기 ── */
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const zhSpan=s=>esc(s).replace(/([㐀-鿿][㐀-鿿\\w\\-（）()·]*)/g,'<span class="zh" lang="zh-CN">$1</span>');
function placeRow(k){const p=P[k];return \`<div class="place"><a class="open" href="\${amap(k)}" target="_blank" rel="noopener"><span class="nm zh" lang="zh-CN">\${esc(p[1])}<small>\${esc(p[0])}</small></span><span class="go">고덕지도 열기 ↗</span></a>
<div class="pact"><button type="button" data-copy="\${esc(p[1])}">중국어 복사</button><button type="button" data-show="\${k}">기사님께 보여주기</button></div></div>\`}
function badgeCls(it){return it.pin==="htl"?"h":it.group?"g"+it.group:(it.star?"star":"")}
function legRow(g,toPin){
  const [lab,m]=MODE[g.m];const to=g.to||toPin;
  const link=(m&&g.from&&to)?\`<a href="\${navUrl(g.from,to,m)}" target="_blank" rel="noopener">길찾기 ↗</a>\`:"";
  return \`<div class="leg \${g.g?"g"+g.g:""}"><span class="m \${g.m}">\${lab}</span><span class="txt">\${esc(g.txt)}</span>\${link}</div>\`;
}
const PINNO={};
function renderDay(D){
  const no={};let c=0;D.items.forEach(it=>{if(it.pin&&!(it.pin in no))no[it.pin]=it.pin==="htl"?"H":++c});PINNO[D.id]=no;
  const legend=\`<div class="legend"><span><i></i>택시·지하철</span><span><i class="walk"></i>걷기</span>\${D.n===2?'<span><i class="ga"></i>A조</span><span><i class="gb"></i>B조</span><span><i class="train"></i>고속철</span>':""}<span>선은 순서만 표시 (실제 길 아님)</span></div>\`;
  const items=D.items.map((it,i)=>{
    const legs=(it.go||[]).map(g=>legRow(g,it.pin)).join("");
    const bd=it.pin?\`<span class="badge \${badgeCls(it)}">\${no[it.pin]}</span>\`:\`<span class="badge none">H</span>\`;
    const tags=\`<span class="tag \${it.star?"r":""} \${it.group?it.group:""}">\${esc(it.tag)}</span>\`;
    return \`<li>\${legs}<details class="card \${it.star?"star":""}" id="it-\${it.key}" data-day="\${D.id}" data-i="\${i}">
<summary><span class="tcol"><span class="time">\${it.t}</span>\${bd}</span><span class="hd"><span class="tagrow">\${tags}</span><h3>\${it.star?"★ ":""}\${esc(it.title)}</h3><p class="sub">\${zhSpan(it.sub)}</p></span><span class="chev" aria-hidden="true">▾</span></summary>
<div class="body">\${it.img?\`<div class="ph"><img loading="lazy" src="/neander/2026shanghai/img/\${it.img}.jpg" alt="\${esc(it.title)} 사진"></div>\`:""}
<ul>\${it.b.map(x=>\`<li>\${zhSpan(x)}</li>\`).join("")}</ul>
\${it.pts.length?\`<div class="places">\${it.pts.map(placeRow).join("")}</div>\`:""}
\${it.pin?\`<div class="btnrow"><button class="btn" type="button" data-fly="\${D.id}:\${i}">지도에서 보기</button></div>\`:""}</div></details></li>\`}).join("");
  document.getElementById("v-"+D.id).innerHTML=\`<div class="dayhead"><p class="eyebrow">DAY \${D.n} · 11/\${D.date[2]} \${D.wd}요일</p><h2>\${esc(D.title)}</h2><p class="sum">\${esc(D.sum)}</p></div>
<div class="daygrid"><div class="mapwrap"><div class="map" id="map-\${D.id}" role="region" aria-label="DAY \${D.n} 동선 지도"></div>\${legend}</div><ol class="tl">\${items}</ol></div>\`;
}

/* ── 지도 (고덕지도 타일을 사이트 안에 담아 둠) ── */
const packs={},loading={};
function pack(z){if(!loading[z])loading[z]=fetch(\`/neander/2026shanghai/tiles/z\${z}.json\`).then(r=>r.ok?r.json():{}).catch(()=>({})).then(d=>packs[z]=d);return loading[z]}
const MAPS={};
function initMap(D){
  if(MAPS[D.id]||!window.L)return MAPS[D.id];
  const Tiles=L.GridLayer.extend({createTile(c,done){const img=document.createElement("img");img.alt="";img.setAttribute("role","presentation");
    pack(c.z).then(d=>{const b=d[c.x+"_"+c.y];if(b){img.onload=img.onerror=()=>done(null,img);img.src="data:image/png;base64,"+b}else{img.src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";done(null,img)}});return img}});
  const map=L.map("map-"+D.id,{zoomControl:true,attributionControl:true,minZoom:9,maxZoom:17});
  map.attributionControl.setPrefix(false);
  new Tiles({minZoom:9,maxZoom:17,maxNativeZoom:16,attribution:"© 高德地图 AutoNavi"}).addTo(map);
  const no=PINNO[D.id];const ll=k=>[P[k][3],P[k][2]];
  // 선
  const cs=getComputedStyle(document.documentElement);
  D.items.forEach(it=>(it.go||[]).forEach(g=>{const to=g.to||it.pin;if(!g.from||!to)return;
    const k=g.g?g.g:g.m==="walk"?"walk":g.m==="train"?"train":"base";const pts=[ll(g.from),ll(to)];const w=g.m==="walk"?4:5;
    L.polyline(pts,{className:"rt-case",weight:w+4,opacity:1,interactive:false}).addTo(map);
    L.polyline(pts,{className:"rt rt-"+k,weight:w,opacity:1,dashArray:(g.m==="walk"||g.m==="train")?"8 8":null,interactive:false}).addTo(map)}));
  // 핀
  const markers={};
  Object.keys(no).forEach(k=>{
    const its=D.items.filter(it=>it.pin===k);const f=its[0];
    const icon=L.divIcon({className:"",html:\`<span class="pin \${badgeCls(f)}">\${no[k]}</span>\`,iconSize:[30,30],iconAnchor:[15,15],popupAnchor:[0,-14]});
    const html=\`<div class="pop">\${its.map(it=>\`<div><span class="pt">\${it.t}</span> <b style="display:inline">\${esc(it.title)}</b></div>\`).join("")}<div class="zh" lang="zh-CN">\${esc(P[k][1])}</div><div class="row"><button type="button" data-open="\${f.key}">자세히</button><a href="\${amap(k)}" target="_blank" rel="noopener">고덕지도 ↗</a></div></div>\`;
    markers[k]=L.marker(ll(k),{icon,title:P[k][0],riseOnHover:true}).addTo(map).bindPopup(html);
  });
  map.fitBounds(L.latLngBounds(D.fit.map(ll)),{padding:[28,28]});
  MAPS[D.id]={map,markers};return MAPS[D.id];
}

/* ── 한눈에 ── */
function renderOverview(){
  const dc=DAYS.map(D=>\`<a class="daycard" href="#\${D.id}"><p class="eyebrow">DAY \${D.n} · 11/\${D.date[2]} \${D.wd}</p><h3>\${esc(D.title)}</h3>
<ol>\${D.items.filter((it,i,a)=>!(it.pin==="dis"&&i>1)||it.t==="20:00").map(it=>\`<li class="\${it.star?"star":""}"><span class="t">\${it.t}</span><span>\${esc(it.title)}</span></li>\`).join("")}</ol><span class="more">동선·지도 보기 →</span></a>\`).join("");
  document.getElementById("v-overview").innerHTML=\`
<div class="hero"><img src="/neander/2026shanghai/img/p1.jpg" alt="상하이 루자쭈이 야경"><div class="in">
<p class="eyebrow" style="color:#f2a31b">SHANGHAI · 2026 · 4명</p><h1>상하이 2박 3일</h1>
<div class="route"><span><b>11/28 토</b>푸동공항 → 디즈니랜드</span><span><b>11/29 일</b>예원 → 교통대·짝퉁시장 → 장자강 → 와이탄 → 루프탑</span><span><b>11/30 월</b>따룬파 → 난징동루 쇼핑 → 16:50 귀국</span></div>
<div class="chips"><a class="chip" href="#day1" data-jump="day1-5">★ <span class="t">11/28 22:30</span> 오래전 양꼬치</a><a class="chip" href="#day2" data-jump="day2-4">★ <span class="t">11/29 14:30</span> 상해교통대</a><a class="chip navy" href="#day3" data-jump="day3-9">✈ <span class="t">11/30 16:50</span> 푸동 출발</a></div>
</div></div>
<div class="sec"><h2>사흘 일정</h2><p class="lead">카드를 누르면 그날 지도와 동선이 열려요. 시간은 모두 상하이 시간 (한국보다 1시간 늦음).</p><div class="grid">\${dc}</div></div>
<div class="sec"><h2>이렇게 쓰세요</h2><div class="grid">
<div class="tip"><h3><span class="k n">고덕지도</span> 남색 버튼</h3><p>폰에서 누르면 고덕지도 앱이 열리면서 그 장소에 핀이 꽂혀요. 「기사님께 보여주기」를 누르면 택시에서 보여줄 큰 중국어 화면이 떠요.</p></div>
<div class="tip"><h3>앱 필수</h3><p>알리페이 · 위챗 · 따종디엔핑 · 디디 · 디즈니 공식 앱 · 트립닷컴(고속철 표). 따룬파는 카카오페이 할인.</p></div>
<div class="tip"><h3>일요일은 두 조</h3><p>점심 뒤 <span class="k a">A조 2명</span> 우캉루 향수 산책 → 14:30 상해교통대, <span class="k b">B조 2명</span> 《烧火工》 VR → 짝퉁시장. 16:00 훙차오역에서 다시 4명 집합.</p></div>
<div class="tip"><h3>월요일은 아침에 체크아웃</h3><p>숙소가 훙차오라 07:50에 체크아웃하고 캐리어를 맡긴 채 시내로. 난징동루 쇼핑·점심 뒤 12:50에 숙소로 와서 짐 찾고 13:35 공항으로.</p></div>
</div></div>
<div class="sec"><h2>숙소</h2><div class="hotel">
<h3>그랜드 머큐어 상하이 훙차오</h3>
<p><span class="zh" lang="zh-CN">上海虹桥雅高美爵酒店</span> · Grand Mercure Shanghai Hongqiao</p>
<ul class="facts">
<li>주소: <span class="zh" lang="zh-CN">长宁区仙霞路369号</span> (창닝구 셴샤로 369호)</li>
<li>시내(난징동루·와이탄)까지 택시 약 30~40분 · 훙차오역 약 20분 · 푸동공항 약 60~70분</li>
<li>가까운 지하철: 10호선 <span class="zh" lang="zh-CN">伊犁路</span>역 (걸어서 약 15분) · 예원·교통대·난징동루로 직행</li>
</ul>
<div class="places">\${placeRow("htl")}</div>
<div class="btnrow"><a class="btn" href="https://kr.trip.com/hotels/detail/?hotelId=345044" target="_blank" rel="noopener">트립닷컴 숙소 페이지 ↗</a></div>
</div></div>\`;
}

/* ── 쇼핑 ── */
const SHOP=[
["화이트래빗 밀크캔디","大白兔奶糖","제일식품상점 · 마트","맛별로 골라 무게로 계산. 회사·친구 나눠주기용"],
["칭즈 핸드크림","青稚护手霜","칭즈 매장 · 1개 50~55위안","탄생화·상하이 에디션, 무료 각인·포장"],
["나비파이","蝴蝶酥","제일식품상점 · 공항","바삭한 버터 페이스트리. 부모님 선물"],
["대추누가 (대추+호두)","枣夹核桃","제일식품상점 1층","쫀득·달달해서 어른 선물로 만족도 높음"],
["세다람쥐 마카다미아","三只松鼠 夏威夷果","따룬파","한국보다 싸서 캐리어 채워오는 템"],
["카만 에그롤","KAMAN 鸡蛋卷","따룬파","소포장이라 나눠먹기 좋음. 오리지널·치즈"],
["레이즈 오이맛","乐事 黄瓜味","따룬파 · 편의점","중국에만 있는 맛. 트러플맛도 인기"],
["하이디라오 훠궈 소스","海底捞 火锅底料","따룬파 · 토마토탕 12.9위안","소기름(牛油) 들어간 제품은 검역 확인 필요"],
["투도우펀 (감자면)","土豆粉","따룬파 · 약 11위안","쫄깃한 감자면 컵. 따룬파에 전용 코너"],
["취뚜어뚜어 쿠키","趣多多","마트 · 편의점","초코칩 쿠키. 다크·말차맛 추천"],
["I❤SH 티셔츠","I LOVE 上海 T恤","따룬파 입구 · 39.9위안","4명 맞춰 입고 사진 찍기 좋음"],
["팝마트 라부부","泡泡玛特 LABUBU","팝마트 난징동루 플래그십","랜덤박스 뽑기. 시리즈마다 디자인이 랜덤"],
["스타벅스 상하이 시티컵","星巴克 城市杯","스타벅스 · 리저브 로스터리","Been There 상하이 에디션 머그"],
["장샤오바이 고량주","江小白","따룬파","공항보다 마트가 쌈. 술은 1인 합계 2L·400달러까지 면세"],
["베이징덕맛 프레첼","百力滋 北京烤鸭味","공항 · 마트","중국 한정 맛. 공항에서 막판 쇼핑"],
["홀리랜드 디저트","好利来","홀리랜드 매장","반숙치즈·수건케이크. 보냉팩 넣으면 캐리어로 OK"],
["관샤 향수·디퓨저","观夏 To Summer","와이탄점 圆明园路149号 · 향수 10만원 초중반","차·꽃 같은 동양 향. 고체향수는 4~5만원대"],
["블랜버니 차 세트","Blendbunny","티엔즈팡 · 신천지 · 세트 3.5만원~","토끼 다기 세트는 15~20만원. 시음하고 고르기"],
["대홍포 · 보이차","大红袍 · 普洱茶","차 전문점 · 50~100g 2~3만원","부모님·거래처 선물. 시음 후 구매"],
["국제반점 나비파이","国际饭店 蝴蝶酥","南京西路170号 · 자자탕바오 바로 앞","1934년부터 파는 원조. 줄 서서 사는 집"],
["실크 스카프","真丝丝巾","티엔즈팡 · 공항 · 120~880위안","와이탄·꽃 문양. 혼방 섞여 있으니 표시 확인"],
["상하이 여인 크림 선물세트","老上海雪花膏 礼盒","난징동루 기념품숍 · 티엔즈팡","크림+립밤+핸드크림 세트. 치파오 여인 틴케이스"],
["마오타이","贵州茅台","공항 면세점","중국 최고급 백주. 가짜가 많아 면세점에서 사기"],
["화이트래빗 선물세트","大白兔 礼盒","제일식품상점 · 공항","틴케이스·상하이 한정 패키지"],
["일본 위스키","山崎 · 白州","푸동공항 주류 면세점","야마자키·하쿠슈 재고가 많은 편"],
["우량예 백주","五粮液","푸동공항 주류 면세점","미니어처부터 선물세트까지"],
["석쿠먼 황주","石库门 黄酒","T2 淘青月 기념품 면세점","상하이 특산 14도 황주. 술 처음인 분께"],
["대추호두말이","枣夹核桃","공항 기념품 면세점 · 85/95위안","작은/큰 사이즈. 어른 선물 반응 좋음"],
["에그롤","鸡蛋卷","공항 기념품 면세점 · 35위안","초코맛 추천 후기 많음"],
["스타벅스 중국 시티컵","星巴克 城市杯","T1 안 스타벅스 · 159위안","터미널 안 매장이 굿즈 종류가 더 많음"],
["판다 굿즈","熊猫 公仔","공항 판다샵","인형·마그넷. 싼 편은 아니지만 기념으로"],
["중국 한정 프레첼","百力滋","공항 기념품 면세점","북경오리·사천마라·광동 생선탕 맛"]];
const SHOPCAT=[["all","전체"],["food","먹거리·선물",0,8],["mart","마트·굿즈",8,16],["gift","고급 선물",16,24],["duty","공항 면세점",24,32],["left","아직 안 산 것"]];
const store={get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
let shopF="all";
function renderShop(){
  const got=store.get("sh-got",{});
  const cnt=Object.values(got).filter(Boolean).length;
  const cat=SHOPCAT.find(c=>c[0]===shopF);
  const list=SHOP.map((s,i)=>({s,i})).filter(({i})=>shopF==="all"?true:shopF==="left"?!got[i]:(i>=cat[2]&&i<cat[3]));
  document.getElementById("v-shop").innerHTML=\`<div class="dayhead"><p class="eyebrow">쇼핑 리스트</p><h2>상하이에서 사올 것</h2><p class="sum">한국인 블로그·브이로그 후기에서 많이 사온 것 위주. 산 것은 체크해 두세요 (체크는 이 폰에만 저장돼요). 지금 <b>\${cnt} / \${SHOP.length}</b></p></div>
<div class="where">
<div class="tip"><h3>따룬파 마트 · 월 09:20</h3><p>마카다미아 · 에그롤 · 레이즈 오이맛 · 하이디라오 소스 · 투도우펀 · 취뚜어뚜어 · I❤SH 티셔츠 · 고량주</p></div>
<div class="tip"><h3>난징동루 · 월 11:20~</h3><p>칭즈 핸드크림 · 팝마트 라부부 · 제일식품상점 (화이트래빗 · 나비파이 · 대추누가)</p></div>
<div class="tip"><h3>그 밖의 매장</h3><p>스타벅스 시티컵 · 홀리랜드 디저트 · 고급 선물은 관샤(와이탄) · 국제반점 나비파이 · 블랜버니</p></div>
<div class="tip"><h3>푸동공항 출국장</h3><p>위스키 · 우량예 · 석쿠먼 황주 · 대추호두말이 · 프레첼</p></div>
</div>
<div class="sec"><div class="filters" role="group" aria-label="분류">\${SHOPCAT.map(c=>\`<button type="button" data-f="\${c[0]}" aria-pressed="\${c[0]===shopF}">\${c[1]}</button>\`).join("")}</div>
<div class="items">\${list.map(({s,i})=>\`<div class="item \${got[i]?"got":""}"><div class="im"><span class="badge num">\${i+1}</span><img loading="lazy" src="/neander/2026shanghai/img/s\${i+1}.jpg" alt="\${esc(s[0])}"></div>
<div class="tx"><h3>\${esc(s[0])}</h3><span class="zh" lang="zh-CN">\${esc(s[1])}</span><span class="wh">\${zhSpan(s[2])}</span><p>\${zhSpan(s[3])}</p>
<label><input type="checkbox" id="got-\${i}" data-got="\${i}" \${got[i]?"checked":""}> 샀어요</label></div></div>\`).join("")||'<p class="note">다 샀어요!</p>'}</div></div>
<div class="sec"><div class="warn"><b>세관 주의</b>1인 면세 800달러, 술은 합계 2L·400달러까지 따로 면세 · 육포·소시지 같은 고기 제품은 반입 안 돼요 · 짝퉁은 압수될 수 있어요 · 같은 매장에서 200위안 넘게 사면 택스리펀</div></div>
<div class="sec"><h2>푸동공항 면세점 이용법</h2><p class="lead">월요일 14:25 공항 도착 → 체크인·세관(택스리펀 확인)·출국심사 → 15:20쯤부터 탑승 전까지 약 1시간 쇼핑</p><div class="grid">
<div class="tip"><h3>터미널부터 확인</h3><p>항공사마다 T1/T2가 달라요. 후기 기준 대한항공 T1, 아시아나 T2. 탑승권에서 확인</p></div>
<div class="tip"><h3>영업시간</h3><p>출국 면세점 07:00~마지막 운항까지. T2 중국 기념품 면세점 「<span class="zh">淘青月</span>」(D58~D69 방향)은 07:00~23:00</p></div>
<div class="tip"><h3>준비물</h3><p>여권 + 탑승권. 술·담배는 만 18세 이상만 구매 가능</p></div>
<div class="tip"><h3>가격 감</h3><p>명품 화장품·향수는 한국 면세점과 비슷하다는 후기. 간식은 시내보다 조금 비쌀 수 있어요</p></div>
<div class="tip"><h3>술이 강점</h3><p>위스키·백주 고가 라인업이 인천보다 다양하고, 발베니 일부는 인천보다 쌌다는 후기(2024)</p></div>
<div class="tip"><h3>시내면세점은?</h3><p><span class="zh">南京西路</span> 근처 시내면세점(<span class="zh">江宁路293-5号</span>)은 크루즈 승객 대상(2025.12 기준). 비행기 여행자는 공항 이용</p></div>
</div><div class="warn"><b>한국 입국 면세</b>1인 800달러 + 술 합계 2L·400달러 따로 · 4명이면 각자 한도라 술은 나눠 들기 · 넘으면 자진신고(관세 30% 감면)</div></div>\`;
}

/* ── 준비 ── */
const PREP=[
["고속철 왕복 4장 (11/29)","갈 때 G7138 훙차오 16:17→장자강 17:07, 올 때 D5565 장자강 19:29→훙차오 20:21. 트립닷컴·12306, 여권으로 예매"],
["디즈니 1일권 (11/28 569위안) + 공식 앱 · 짐 처리","실명제라 여권 정보로 예약. 캐리어 반입 불가라 공항→호텔 짐 배송 또는 정문 옆 유료 보관소"],
["《烧火工》 VR 예약 (B조) · 화메이 영업 확인 (A조)","과학기술관 위챗 미니프로그램에서 실명(여권) 예약, 11/29 13:15~13:30 회차 · 가격·일요일 운영 시간도 확인 / 화메이 안푸루점 지금도 여는지"],
["교통대 입장 등록 (A조) · Kubert 씨 약속","11/29 13:00부터 위챗 「参观交大」 등록 / 장자강역 17:07 도착 · 19:29 귀가, 역 근처 식당"],
["발마사지 예약 · 따종디엔핑 · 복장","캉다오(11/28 24:00) 예약, 양꼬치 원격 줄서기. VUE는 스마트 캐주얼"],
["월요일 쇼핑: 카카오페이 · 신용카드 · 여권","따룬파는 카카오페이 할인. 택스리펀은 같은 날·같은 매장 200위안 이상, 즉시환급은 사전승인 되는 본인 신용카드 필요"],
["월요일: 07:50 체크아웃 · 13:35 숙소에서 공항 출발","짐은 일요일 밤에 싸 두기. 12:50 난징동루 출발 → 숙소에서 캐리어 찾기 → 16:50 국제선, 14:40쯤 도착. 늦어지면 칭즈나 제일식품상점부터 빼기"]];
const KW=["htl","pvg","dhub","dis","yang","kang","yuy","nx","lbl","sjtu","ap","hq","zjg","bund","vue","dhc","rt","qz","pop","mns","mms","ff","jj","gj","gx","wk","lelabo","harmay","vr"];
const SKIP=["phw","sbr","lv","yyl","hkj","ins","sht","cru","ljs","ole"];
const VIDS=[["OrNvBu26NQo","최신 상하이 맛집·카페·3박4일 코스까지 영상 하나로 상하이 여행 총정리하기","또 떠나는 남자 ddoddunam · 2026-11-22 · 조회 29만"],
["JXo3OLIEbDI","2박 3일 상하이 여행 브이로그 | 디즈니랜드부터 현지 mz 맛집까지 꽉 채워 보여드립니다","김베개 · 2025-09-22 · 조회 18만"],
["1zL_W0O9u_Y","카메라 끄라던 상하이 짝퉁시장, 그 안에서 벌어진 일","또떠나용 ddonayoung · 2025-05-07 · 조회 6만"],
["D05XTLRArJM","나 혼자 첫 상하이 · 동선 집착러의 2박3일 상해여행 완벽코스 (ft.2박13끼)","현주zip · 2026-10-04 · 조회 9만"],
["ORr4metVjT4","상해 여행 · 요즘 유행 디저트·인생맛집, 양쯔깐루, 도우인 헤메 후기·헤드스파, 총경비 공유","끼리 KKIRI · 2026-01-16 · 조회 9만"],
["1ud11IE2GMo","상하이 브이로그 (타임라인·고덕지도 링크) | 일정 짜는 게 힘들다면 필수시청","트윙클린 Twinkleen · 2026-11-14 · 조회 2만"]];
function kwRow(k){const p=P[k];return \`<div class="row"><span class="n"><b lang="zh-CN">\${esc(p[1])}</b><span>\${esc(p[0])}</span></span><button type="button" data-copy="\${esc(p[1])}">복사</button><a href="\${amap(k)}" target="_blank" rel="noopener">지도 ↗</a></div>\`}
function renderPrep(){
  const done=store.get("sh-prep",{});const n=Object.values(done).filter(Boolean).length;
  document.getElementById("v-prep").innerHTML=\`<div class="dayhead"><p class="eyebrow">출발 전에</p><h2>미리 해둘 것 <span style="font-family:var(--mono);color:var(--time)">\${n}/\${PREP.length}</span></h2><p class="sum">체크는 이 폰에만 저장돼요.</p></div>
<ul class="check">\${PREP.map((p,i)=>\`<li class="\${done[i]?"done":""}"><label><input type="checkbox" id="prep-\${i}" data-prep="\${i}" \${done[i]?"checked":""}><span><b>\${esc(p[0])}</b><span>\${zhSpan(p[1])}</span></span></label></li>\`).join("")}</ul>
<div class="sec"><h2>고덕지도 검색어 전체 목록</h2><p class="lead">복사해서 고덕지도·디디 검색창에 붙여 넣으면 돼요.</p><div class="kw">\${KW.map(kwRow).join("")}</div></div>
<div class="sec"><h2>이번 일정에서 빠진 곳</h2><p class="lead">포토위드, 스벅 리저브·루이비통, 왕홍체험, 홍쿠이지아 등은 빠졌어요. 월요일에 따룬파를 건너뛰면 와이탄 쪽 올레 마트(신세계 B2)에서 간식 기념품을 살 수 있어요.</p><div class="kw">\${SKIP.map(kwRow).join("")}</div></div>
<div class="sec"><h2>참고한 영상</h2><p class="lead">한국인 상하이 브이로그. 누르면 유튜브로 가요.</p><div class="vids">\${VIDS.map((v,i)=>\`<a class="vid" href="https://www.youtube.com/watch?v=\${v[0]}" target="_blank" rel="noopener"><img loading="lazy" src="/neander/2026shanghai/img/v\${i+1}.jpg" alt=""><div><b>\${esc(v[1])}</b><span>\${esc(v[2])}</span></div></a>\`).join("")}</div></div>\`;
}

/* ── 화면 전환 ── */
const VIEWS=["overview","day1","day2","day3","shop","prep"];
function show(v,opts={}){
  if(!VIEWS.includes(v))v="overview";
  document.querySelectorAll(".view").forEach(s=>s.hidden=s.dataset.view!==v);
  document.querySelectorAll(".tabs a").forEach(a=>{if(a.dataset.v===v)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current")});
  const D=DAYS.find(d=>d.id===v);
  if(D){const m=initMap(D);if(m)setTimeout(()=>m.map.invalidateSize(),30)}
  if(!opts.keepScroll)window.scrollTo(0,0);
}
function openItem(key,{scroll=true,fly=false}={}){
  const [d,i]=key.split("-");const el=document.getElementById("it-"+key);if(!el)return;
  if(location.hash!=="#"+d){history.replaceState(null,"","#"+d);show(d,{keepScroll:true})}
  el.open=true;if(scroll)setTimeout(()=>el.scrollIntoView({behavior:"smooth",block:"start"}),60);
  if(fly)flyTo(d,+i);
}
function flyTo(d,i){
  const D=DAYS.find(x=>x.id===d);const it=D.items[i];if(!it.pin)return;const m=initMap(D);if(!m)return;
  const mw=document.getElementById("map-"+d);
  if(window.innerWidth<900)mw.scrollIntoView({behavior:"smooth",block:"center"});
  m.map.flyTo([P[it.pin][3],P[it.pin][2]],it.pin==="zjg"?13:15,{duration:.8});
  setTimeout(()=>m.markers[it.pin].openPopup(),850);
}

/* ── 기사님 화면 · 복사 ── */
let lastFocus=null;
function driver(k){const p=P[k];lastFocus=document.activeElement;document.getElementById("driverZh").textContent=p[1];document.getElementById("driverKo").textContent=p[0];
  const ad=document.getElementById("driverAddr");ad.textContent=p[4]||"";ad.hidden=!p[4];
  const d=document.getElementById("driver");d.hidden=false;document.getElementById("driverClose").focus();
  try{navigator.wakeLock&&navigator.wakeLock.request("screen").catch(()=>{})}catch(e){}}
function closeDriver(){document.getElementById("driver").hidden=true;if(lastFocus)lastFocus.focus()}
let toastT;function toast(msg){let t=document.querySelector(".toast");if(!t){t=document.createElement("div");t.className="toast";t.setAttribute("role","status");document.body.appendChild(t)}t.textContent=msg;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>t.hidden=true,1800)}
function copy(text,btn){
  const fallback=()=>{const r=document.createRange();const tgt=btn.closest(".place,.row");const n=tgt&&(tgt.querySelector(".nm")||tgt.querySelector("b"));if(n){r.selectNodeContents(n);const s=getSelection();s.removeAllRanges();s.addRange(r)}toast("글자를 선택해 뒀어요. 길게 눌러 복사하세요")};
  try{navigator.clipboard.writeText(text).then(()=>toast("복사했어요: "+text),fallback)}catch(e){fallback()}
}

document.addEventListener("click",e=>{
  const t=e.target.closest("[data-copy],[data-show],[data-fly],[data-open],[data-f],[data-jump],#now,#driverClose");if(!t)return;
  if(t.dataset.copy!==undefined){e.preventDefault();copy(t.dataset.copy,t)}
  else if(t.dataset.show){e.preventDefault();driver(t.dataset.show)}
  else if(t.dataset.fly){const [d,i]=t.dataset.fly.split(":");flyTo(d,+i)}
  else if(t.dataset.open){openItem(t.dataset.open)}
  else if(t.dataset.f){shopF=t.dataset.f;renderShop()}
  else if(t.dataset.jump){e.preventDefault();openItem(t.dataset.jump)}
  else if(t.id==="now"){if(ST&&ST.go)openItem(ST.go.key)}
  else if(t.id==="driverClose")closeDriver();
});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!document.getElementById("driver").hidden)closeDriver()});
document.addEventListener("change",e=>{
  const t=e.target;
  if(t.dataset.got!==undefined){const g=store.get("sh-got",{});g[t.dataset.got]=t.checked;store.set("sh-got",g);t.closest(".item").classList.toggle("got",t.checked);
    const b=document.querySelector("#v-shop .sum b");if(b)b.textContent=Object.values(g).filter(Boolean).length+" / "+SHOP.length;if(shopF==="left")setTimeout(renderShop,400)}
  if(t.dataset.prep!==undefined){const g=store.get("sh-prep",{});g[t.dataset.prep]=t.checked;store.set("sh-prep",g);renderPrep()}
});
window.addEventListener("hashchange",()=>show(location.hash.slice(1)));

/* ── 시작 ── */
// 머리줄 높이를 재서 넓은 화면의 탭 줄·지도 고정 위치에 쓴다
const topEl=document.querySelector(".top");
const setTop=()=>document.documentElement.style.setProperty("--toph",topEl.offsetHeight+"px");
setTop();try{new ResizeObserver(setTop).observe(topEl)}catch(e){window.addEventListener("resize",setTop)}
renderOverview();DAYS.forEach(renderDay);renderShop();renderPrep();
tick();setInterval(tick,30000);
const h=location.hash.slice(1);
if(VIEWS.includes(h))show(h);
else if(ST&&ST.live&&ST.cur){show(ST.cur.day.id);openItem(ST.cur.key)}
else show("overview");
</script>

</body></html>
`;
