// 2026-11 상하이 2박 3일(11/28~30) 출장 일정 페이지 — /neander/2026shanghai
// 로그인 없이 링크로 여는 독립 HTML. 사진·지도 타일·Leaflet 은 public/neander/2026shanghai/ 에 있다.
// (중국 안에서도 열리도록 외부 CDN 을 쓰지 않는다. 구글 폰트는 막혀도 화면을 붙잡지 않게 비동기로 읽는다.)
export const SHANGHAI_2026_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#16223b"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="상하이 2박3일"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
<title>상하이 3박 4일</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=swap" media="print" onload="this.media='all'">
<style>
.leaflet-image-layer,.leaflet-layer,.leaflet-marker-icon,.leaflet-marker-shadow,.leaflet-pane,.leaflet-pane>canvas,.leaflet-pane>svg,.leaflet-tile,.leaflet-tile-container,.leaflet-zoom-box{position:absolute;left:0;top:0}.leaflet-container{overflow:hidden}.leaflet-marker-icon,.leaflet-marker-shadow,.leaflet-tile{-webkit-user-select:none;-moz-user-select:none;user-select:none;-webkit-user-drag:none}.leaflet-tile::selection{background:0 0}.leaflet-safari .leaflet-tile{image-rendering:-webkit-optimize-contrast}.leaflet-safari .leaflet-tile-container{width:1600px;height:1600px;-webkit-transform-origin:0 0}.leaflet-marker-icon,.leaflet-marker-shadow{display:block}.leaflet-container .leaflet-overlay-pane svg{max-width:none!important;max-height:none!important}.leaflet-container .leaflet-marker-pane img,.leaflet-container .leaflet-shadow-pane img,.leaflet-container .leaflet-tile,.leaflet-container .leaflet-tile-pane img,.leaflet-container img.leaflet-image-layer{max-width:none!important;max-height:none!important;width:auto;padding:0}.leaflet-container img.leaflet-tile{mix-blend-mode:plus-lighter}.leaflet-container.leaflet-touch-zoom{-ms-touch-action:pan-x pan-y;touch-action:pan-x pan-y}.leaflet-container.leaflet-touch-drag{-ms-touch-action:pinch-zoom;touch-action:none;touch-action:pinch-zoom}.leaflet-container.leaflet-touch-drag.leaflet-touch-zoom{-ms-touch-action:none;touch-action:none}.leaflet-container{-webkit-tap-highlight-color:transparent}.leaflet-container a{-webkit-tap-highlight-color:rgba(51,181,229,.4)}.leaflet-tile{filter:inherit;visibility:hidden}.leaflet-tile-loaded{visibility:inherit}.leaflet-zoom-box{width:0;height:0;-moz-box-sizing:border-box;box-sizing:border-box;z-index:800}.leaflet-overlay-pane svg{-moz-user-select:none}.leaflet-pane{z-index:400}.leaflet-tile-pane{z-index:200}.leaflet-overlay-pane{z-index:400}.leaflet-shadow-pane{z-index:500}.leaflet-marker-pane{z-index:600}.leaflet-tooltip-pane{z-index:650}.leaflet-popup-pane{z-index:700}.leaflet-map-pane canvas{z-index:100}.leaflet-map-pane svg{z-index:200}.leaflet-vml-shape{width:1px;height:1px}.lvml{behavior:url(#default#VML);display:inline-block;position:absolute}.leaflet-control{position:relative;z-index:800;pointer-events:visiblePainted;pointer-events:auto}.leaflet-bottom,.leaflet-top{position:absolute;z-index:1000;pointer-events:none}.leaflet-top{top:0}.leaflet-right{right:0}.leaflet-bottom{bottom:0}.leaflet-left{left:0}.leaflet-control{float:left;clear:both}.leaflet-right .leaflet-control{float:right}.leaflet-top .leaflet-control{margin-top:10px}.leaflet-bottom .leaflet-control{margin-bottom:10px}.leaflet-left .leaflet-control{margin-left:10px}.leaflet-right .leaflet-control{margin-right:10px}.leaflet-fade-anim .leaflet-popup{opacity:0;-webkit-transition:opacity .2s linear;-moz-transition:opacity .2s linear;transition:opacity .2s linear}.leaflet-fade-anim .leaflet-map-pane .leaflet-popup{opacity:1}.leaflet-zoom-animated{-webkit-transform-origin:0 0;-ms-transform-origin:0 0;transform-origin:0 0}svg.leaflet-zoom-animated{will-change:transform}.leaflet-zoom-anim .leaflet-zoom-animated{-webkit-transition:-webkit-transform .25s cubic-bezier(0,0,.25,1);-moz-transition:-moz-transform .25s cubic-bezier(0,0,.25,1);transition:transform .25s cubic-bezier(0,0,.25,1)}.leaflet-pan-anim .leaflet-tile,.leaflet-zoom-anim .leaflet-tile{-webkit-transition:none;-moz-transition:none;transition:none}.leaflet-zoom-anim .leaflet-zoom-hide{visibility:hidden}.leaflet-interactive{cursor:pointer}.leaflet-grab{cursor:-webkit-grab;cursor:-moz-grab;cursor:grab}.leaflet-crosshair,.leaflet-crosshair .leaflet-interactive{cursor:crosshair}.leaflet-control,.leaflet-popup-pane{cursor:auto}.leaflet-dragging .leaflet-grab,.leaflet-dragging .leaflet-grab .leaflet-interactive,.leaflet-dragging .leaflet-marker-draggable{cursor:move;cursor:-webkit-grabbing;cursor:-moz-grabbing;cursor:grabbing}.leaflet-image-layer,.leaflet-marker-icon,.leaflet-marker-shadow,.leaflet-pane>svg path,.leaflet-tile-container{pointer-events:none}.leaflet-image-layer.leaflet-interactive,.leaflet-marker-icon.leaflet-interactive,.leaflet-pane>svg path.leaflet-interactive,svg.leaflet-image-layer.leaflet-interactive path{pointer-events:visiblePainted;pointer-events:auto}.leaflet-container{background:#ddd;outline-offset:1px}.leaflet-container a{color:#0078a8}.leaflet-zoom-box{border:2px dotted #38f;background:rgba(255,255,255,.5)}.leaflet-container{font-family:"Helvetica Neue",Arial,Helvetica,sans-serif;font-size:12px;font-size:.75rem;line-height:1.5}.leaflet-bar{box-shadow:0 1px 5px rgba(0,0,0,.65);border-radius:4px}.leaflet-bar a{background-color:#fff;border-bottom:1px solid #ccc;width:26px;height:26px;line-height:26px;display:block;text-align:center;text-decoration:none;color:#000}.leaflet-bar a,.leaflet-control-layers-toggle{background-position:50% 50%;background-repeat:no-repeat;display:block}.leaflet-bar a:focus,.leaflet-bar a:hover{background-color:#f4f4f4}.leaflet-bar a:first-child{border-top-left-radius:4px;border-top-right-radius:4px}.leaflet-bar a:last-child{border-bottom-left-radius:4px;border-bottom-right-radius:4px;border-bottom:none}.leaflet-bar a.leaflet-disabled{cursor:default;background-color:#f4f4f4;color:#bbb}.leaflet-touch .leaflet-bar a{width:30px;height:30px;line-height:30px}.leaflet-touch .leaflet-bar a:first-child{border-top-left-radius:2px;border-top-right-radius:2px}.leaflet-touch .leaflet-bar a:last-child{border-bottom-left-radius:2px;border-bottom-right-radius:2px}.leaflet-control-zoom-in,.leaflet-control-zoom-out{font:bold 18px 'Lucida Console',Monaco,monospace;text-indent:1px}.leaflet-touch .leaflet-control-zoom-in,.leaflet-touch .leaflet-control-zoom-out{font-size:22px}.leaflet-control-layers{box-shadow:0 1px 5px rgba(0,0,0,.4);background:#fff;border-radius:5px}.leaflet-control-layers-toggle{background-image:url(images/layers.png);width:36px;height:36px}.leaflet-retina .leaflet-control-layers-toggle{background-image:url(images/layers-2x.png);background-size:26px 26px}.leaflet-touch .leaflet-control-layers-toggle{width:44px;height:44px}.leaflet-control-layers .leaflet-control-layers-list,.leaflet-control-layers-expanded .leaflet-control-layers-toggle{display:none}.leaflet-control-layers-expanded .leaflet-control-layers-list{display:block;position:relative}.leaflet-control-layers-expanded{padding:6px 10px 6px 6px;color:#333;background:#fff}.leaflet-control-layers-scrollbar{overflow-y:scroll;overflow-x:hidden;padding-right:5px}.leaflet-control-layers-selector{margin-top:2px;position:relative;top:1px}.leaflet-control-layers label{display:block;font-size:13px;font-size:1.08333em}.leaflet-control-layers-separator{height:0;border-top:1px solid #ddd;margin:5px -10px 5px -6px}.leaflet-default-icon-path{background-image:url(images/marker-icon.png)}.leaflet-container .leaflet-control-attribution{background:#fff;background:rgba(255,255,255,.8);margin:0}.leaflet-control-attribution,.leaflet-control-scale-line{padding:0 5px;color:#333;line-height:1.4}.leaflet-control-attribution a{text-decoration:none}.leaflet-control-attribution a:focus,.leaflet-control-attribution a:hover{text-decoration:underline}.leaflet-attribution-flag{display:inline!important;vertical-align:baseline!important;width:1em;height:.6669em}.leaflet-left .leaflet-control-scale{margin-left:5px}.leaflet-bottom .leaflet-control-scale{margin-bottom:5px}.leaflet-control-scale-line{border:2px solid #777;border-top:none;line-height:1.1;padding:2px 5px 1px;white-space:nowrap;-moz-box-sizing:border-box;box-sizing:border-box;background:rgba(255,255,255,.8);text-shadow:1px 1px #fff}.leaflet-control-scale-line:not(:first-child){border-top:2px solid #777;border-bottom:none;margin-top:-2px}.leaflet-control-scale-line:not(:first-child):not(:last-child){border-bottom:2px solid #777}.leaflet-touch .leaflet-bar,.leaflet-touch .leaflet-control-attribution,.leaflet-touch .leaflet-control-layers{box-shadow:none}.leaflet-touch .leaflet-bar,.leaflet-touch .leaflet-control-layers{border:2px solid rgba(0,0,0,.2);background-clip:padding-box}.leaflet-popup{position:absolute;text-align:center;margin-bottom:20px}.leaflet-popup-content-wrapper{padding:1px;text-align:left;border-radius:12px}.leaflet-popup-content{margin:13px 24px 13px 20px;line-height:1.3;font-size:13px;font-size:1.08333em;min-height:1px}.leaflet-popup-content p{margin:17px 0;margin:1.3em 0}.leaflet-popup-tip-container{width:40px;height:20px;position:absolute;left:50%;margin-top:-1px;margin-left:-20px;overflow:hidden;pointer-events:none}.leaflet-popup-tip{width:17px;height:17px;padding:1px;margin:-10px auto 0;pointer-events:auto;-webkit-transform:rotate(45deg);-moz-transform:rotate(45deg);-ms-transform:rotate(45deg);transform:rotate(45deg)}.leaflet-popup-content-wrapper,.leaflet-popup-tip{background:#fff;color:#333;box-shadow:0 3px 14px rgba(0,0,0,.4)}.leaflet-container a.leaflet-popup-close-button{position:absolute;top:0;right:0;border:none;text-align:center;width:24px;height:24px;font:16px/24px Tahoma,Verdana,sans-serif;color:#757575;text-decoration:none;background:0 0}.leaflet-container a.leaflet-popup-close-button:focus,.leaflet-container a.leaflet-popup-close-button:hover{color:#585858}.leaflet-popup-scrolled{overflow:auto}.leaflet-oldie .leaflet-popup-content-wrapper{-ms-zoom:1}.leaflet-oldie .leaflet-popup-tip{width:24px;margin:0 auto}.leaflet-oldie .leaflet-control-layers,.leaflet-oldie .leaflet-control-zoom,.leaflet-oldie .leaflet-popup-content-wrapper,.leaflet-oldie .leaflet-popup-tip{border:1px solid #999}.leaflet-div-icon{background:#fff;border:1px solid #666}.leaflet-tooltip{position:absolute;padding:6px;background-color:#fff;border:1px solid #fff;border-radius:3px;color:#222;white-space:nowrap;-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none;pointer-events:none;box-shadow:0 1px 3px rgba(0,0,0,.4)}.leaflet-tooltip.leaflet-interactive{cursor:pointer;pointer-events:auto}.leaflet-tooltip-bottom:before,.leaflet-tooltip-left:before,.leaflet-tooltip-right:before,.leaflet-tooltip-top:before{position:absolute;pointer-events:none;border:6px solid transparent;background:0 0;content:""}.leaflet-tooltip-bottom{margin-top:6px}.leaflet-tooltip-top{margin-top:-6px}.leaflet-tooltip-bottom:before,.leaflet-tooltip-top:before{left:50%;margin-left:-6px}.leaflet-tooltip-top:before{bottom:0;margin-bottom:-12px;border-top-color:#fff}.leaflet-tooltip-bottom:before{top:0;margin-top:-12px;margin-left:-6px;border-bottom-color:#fff}.leaflet-tooltip-left{margin-left:-6px}.leaflet-tooltip-right{margin-left:6px}.leaflet-tooltip-left:before,.leaflet-tooltip-right:before{top:50%;margin-top:-6px}.leaflet-tooltip-left:before{right:0;margin-right:-12px;border-left-color:#fff}.leaflet-tooltip-right:before{left:0;margin-left:-12px;border-right-color:#fff}@media print{.leaflet-control{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
/* 여행 중 폰 한 손으로 쓰는 일정표 — 장소 종류는 색 아이콘, 이동은 수단 아이콘 + 시간, 정보는 아이콘 칩 */
:root{
  --bg:#f2f4f7; --surface:#ffffff; --sunk:#eceff3; --ink:#111827; --muted:#596273; --line:#e0e4ea;
  --navy:#16223b; --navy-ink:#ffffff; --amber:#f2a31b; --time:#9a5b00;
  --red:#d33838; --red-soft:#fdecec; --ok:#1f8f55; --ga:#2f6fdb; --gb:#7b45d6; --walk:#e08a12;
  --route:#16223b; --route-case:rgba(255,255,255,.92); --toph:60px; --navh:64px;
  --c-food:#e8590c; --c-shop:#d6336c; --c-sight:#0c8599; --c-fun:#4263eb; --c-scent:#9c36b5; --c-spa:#2f9e44;
  --c-night:#5f3dc4; --c-stay:#16223b; --c-move:#5c677d; --c-meet:#b35c00; --on-cat:#ffffff;
  --shadow:0 1px 2px rgba(16,24,40,.05),0 2px 8px rgba(16,24,40,.05);
  --sans:"IBM Plex Sans KR","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;
  --zh:"PingFang SC","Hiragino Sans GB","Noto Sans SC","Microsoft YaHei",system-ui,sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,"SF Mono",Menlo,monospace;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --bg:#0b1019; --surface:#141b29; --sunk:#1c2538; --ink:#e9edf4; --muted:#9ba6ba; --line:#263048;
  --navy:#1d2a45; --amber:#f5b43c; --time:#f5b43c; --red:#ff6b6b; --red-soft:#3a1d22; --ok:#4cc488;
  --ga:#6f9dff; --gb:#ad8cff; --walk:#f0a03a; --route:#eef2fa; --route-case:rgba(0,0,0,.7);
  --c-food:#ff8c4b; --c-shop:#f783ac; --c-sight:#3bc9db; --c-fun:#8ea4ff; --c-scent:#e599f7; --c-spa:#69db7c;
  --c-night:#b197fc; --c-stay:#c5d2ec; --c-move:#b6bfcc; --c-meet:#ffc078; --on-cat:#0b1019; --shadow:none; color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#0b1019; --surface:#141b29; --sunk:#1c2538; --ink:#e9edf4; --muted:#9ba6ba; --line:#263048;
  --navy:#1d2a45; --amber:#f5b43c; --time:#f5b43c; --red:#ff6b6b; --red-soft:#3a1d22; --ok:#4cc488;
  --ga:#6f9dff; --gb:#ad8cff; --walk:#f0a03a; --route:#eef2fa; --route-case:rgba(0,0,0,.7);
  --c-food:#ff8c4b; --c-shop:#f783ac; --c-sight:#3bc9db; --c-fun:#8ea4ff; --c-scent:#e599f7; --c-spa:#69db7c;
  --c-night:#b197fc; --c-stay:#c5d2ec; --c-move:#b6bfcc; --c-meet:#ffc078; --on-cat:#0b1019; --shadow:none; color-scheme:dark}
.k-food{--cat:var(--c-food)} .k-shop{--cat:var(--c-shop)} .k-sight{--cat:var(--c-sight)} .k-fun{--cat:var(--c-fun)}
.k-scent{--cat:var(--c-scent)} .k-spa{--cat:var(--c-spa)} .k-night{--cat:var(--c-night)} .k-stay{--cat:var(--c-stay)}
.k-fly,.k-rail{--cat:var(--c-move)} .k-meet{--cat:var(--c-meet)}

*{box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:16px;line-height:1.5;-webkit-text-size-adjust:100%;
  padding-bottom:calc(var(--navh) + env(safe-area-inset-bottom,0px) + 24px)}
.zh{font-family:var(--zh)}
a{color:inherit}
button{font:inherit;color:inherit;cursor:pointer}
:focus-visible{outline:3px solid var(--amber);outline-offset:2px;border-radius:8px}
.wrap{padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
h1,h2,h3{text-wrap:balance;margin:0;line-height:1.25}
.ic{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;vertical-align:-3px}
.ic.fill{fill:currentColor;stroke:none}

/* 머리줄 */
.top{position:sticky;top:env(safe-area-inset-top,0px);z-index:960;background:var(--navy);color:#fff}
body::before{content:"";position:fixed;inset:0 0 auto;height:env(safe-area-inset-top,0px);z-index:10;background:var(--navy)}
.top .wrap{display:flex;align-items:center;gap:10px;padding-block:8px;min-height:60px}
.brand{font-weight:700;font-size:16px;white-space:nowrap;line-height:1.2}
.brand small{display:block;font-family:var(--mono);font-size:13px;font-weight:500;color:var(--amber)}
.now{flex:1;min-width:0;display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.09);border:0;border-radius:12px;padding:7px 12px;text-align:left;color:#fff}
.now .dot{width:9px;height:9px;border-radius:50%;background:var(--amber);flex:none}
.now.live .dot{animation:pulse 1.8s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(242,163,27,.55)}70%{box-shadow:0 0 0 9px rgba(242,163,27,0)}100%{box-shadow:0 0 0 0 rgba(242,163,27,0)}}
.now .txt{min-width:0;font-size:13px;line-height:1.35}
.now .txt b{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.now .txt span{display:block;color:#c5cfe0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.clock{display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:17px;font-weight:600;white-space:nowrap}
.clock .ic{color:var(--amber)}

/* 아래 탭 (넓은 화면에선 위) */
.tabs{position:fixed;left:0;right:0;bottom:0;z-index:950;background:var(--surface);border-top:1px solid var(--line);padding-bottom:env(safe-area-inset-bottom,0px)}
.tabs .wrap{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;height:var(--navh);align-items:center}
.tabs a{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;height:52px;text-decoration:none;color:var(--muted);font-size:13px;font-weight:600;border-radius:12px}
.tabs a .ic{width:22px;height:22px}
.tabs a[aria-current="page"]{color:var(--ink)}
.tabs a[aria-current="page"] .ic{color:var(--amber)}
@media (min-width:900px){
  body{padding-bottom:40px}
  .tabs{position:sticky;top:calc(env(safe-area-inset-top,0px) + var(--toph));bottom:auto;border-top:0;border-bottom:1px solid var(--line);padding-bottom:0}
  .tabs .wrap{display:flex;height:auto;padding-block:8px;gap:6px}
  .tabs a{flex-direction:row;gap:8px;height:40px;padding:0 16px;font-size:15px}
  .tabs a[aria-current="page"]{background:var(--sunk)}
}

/* 날짜 고르기 */
.days{position:sticky;top:calc(env(safe-area-inset-top,0px) + var(--toph));z-index:800;background:var(--bg);padding-block:10px 8px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.days[hidden]{display:none}
.days a{display:flex;align-items:center;justify-content:center;gap:8px;min-height:50px;border-radius:14px;background:var(--surface);border:1px solid var(--line);text-decoration:none;box-shadow:var(--shadow)}
.days a .d{display:grid;line-height:1.1;text-align:left}
.days a .d b{font-family:var(--mono);font-size:19px}
.days a .d span{font-size:13px;color:var(--muted);font-weight:600}
.days a .ic{width:20px;height:20px;color:var(--muted)}
.days a[aria-current="page"]{background:var(--navy);border-color:var(--navy);color:#fff}
.days a[aria-current="page"] .d span{color:#c5cfe0}
.days a[aria-current="page"] .ic{color:var(--amber)}
@media (min-width:900px){.days{top:calc(env(safe-area-inset-top,0px) + var(--toph) + 57px);grid-template-columns:repeat(4,minmax(0,200px))}}

.view{padding-block:12px 8px}
.view[hidden]{display:none!important}
.sec{margin-top:28px;display:grid;gap:12px}
.sec>h2{font-size:20px;display:flex;align-items:center;gap:8px}
.sec>h2 .ic{color:var(--amber);width:20px;height:20px}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))}
.box{background:var(--surface);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow)}

/* 칩 */
.chips{display:flex;flex-wrap:wrap;gap:6px}
.ch{display:inline-flex;align-items:center;gap:5px;font-size:13px;font-weight:600;line-height:1.3;padding:4px 9px;border-radius:999px;background:var(--sunk);color:var(--ink);max-width:100%}
.ch .ic{width:15px;height:15px;color:var(--muted);vertical-align:0}
.ch.al{background:var(--red-soft);color:var(--red)} .ch.al .ic{color:var(--red)}
.ch.st{background:var(--red);color:#fff} .ch.st .ic{color:#fff}

/* 한눈에 */
.hero{position:relative;border-radius:22px;overflow:hidden;background:#0d1424;color:#fff;min-height:280px;display:flex;align-items:flex-end;margin-top:4px}
.hero img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(5,10,20,.05) 20%,rgba(5,10,20,.82))}
.hero .in{position:relative;z-index:1;padding:22px 20px;display:grid;gap:12px;width:100%}
.hero .eb{font-family:var(--mono);font-size:13px;letter-spacing:.16em;color:var(--amber);font-weight:600;margin:0}
.hero h1{font-size:clamp(34px,8vw,60px);font-weight:700;letter-spacing:-.02em}
.hero .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.hero .pill{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.16);backdrop-filter:blur(6px);border-radius:999px;padding:6px 12px;font-size:14px;font-weight:600}
.hero .pill .ic{width:16px;height:16px;color:var(--amber)}
.hero .dd{background:var(--amber);color:#1b1300}
.hero .dd .ic{color:#1b1300}
.daycards{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))}
.dc{display:grid;grid-template-rows:auto auto 1fr;overflow:hidden;text-decoration:none}
.dc .cv{position:relative;aspect-ratio:16/8;background:var(--sunk)}
.dc .cv img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.dc .cv .dt{position:absolute;left:12px;top:12px;background:var(--surface);color:var(--ink);border-radius:12px;padding:6px 10px;display:grid;justify-items:center;line-height:1.1;box-shadow:0 2px 8px rgba(0,0,0,.2)}
.dc .cv .dt b{font-family:var(--mono);font-size:22px}
.dc .cv .dt span{font-size:13px;font-weight:700;color:var(--muted)}
.dc .cv .pp{position:absolute;right:12px;top:12px;display:inline-flex;align-items:center;gap:5px;background:rgba(0,0,0,.55);color:#fff;border-radius:999px;padding:4px 10px;font-size:13px;font-weight:700}
.dc .cv .pp .ic{width:15px;height:15px}
.dc .bdy{padding:14px;display:grid;gap:10px;align-content:start}
.dc h3{font-size:17px}
.chain{display:flex;flex-wrap:wrap;align-items:center;gap:4px}
.chain .n{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:var(--cat);color:var(--on-cat)}
.chain .n .ic{width:16px;height:16px}
.chain .n.star{box-shadow:0 0 0 2px var(--surface),0 0 0 4px var(--red)}
.chain .ar{width:8px;height:2px;background:var(--line);border-radius:1px}
.must{display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))}
.must a{display:flex;align-items:center;gap:12px;padding:12px 14px;text-decoration:none}
.must .n{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:var(--cat);color:var(--on-cat);flex:none}
.must b{display:block;font-size:16px}
.must span{font-family:var(--mono);font-size:13px;color:var(--time);font-weight:600}
.hotel{padding:16px;display:grid;gap:12px}
.hotel .hh{display:flex;gap:12px;align-items:center}
.hotel .hh .n{width:44px;height:44px;border-radius:12px;background:var(--navy);color:#fff;display:grid;place-items:center;flex:none}
.hotel h3{font-size:17px}
.hotel .hh p{margin:0;font-size:14px;color:var(--muted)}
.stats{display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(min(100%,140px),1fr))}
.stat{background:var(--sunk);border-radius:12px;padding:10px 12px;display:grid;gap:2px}
.stat .ic{color:var(--muted)}
.stat b{font-size:17px;font-family:var(--mono)}
.stat span{font-size:13px;color:var(--muted);font-weight:600}
.legendbtns{display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr))}
.legendbtns div{display:flex;align-items:center;gap:10px;padding:12px 14px}
.legendbtns span{font-size:14px;color:var(--muted)}
.apps{display:flex;flex-wrap:wrap;gap:8px}
.app{display:inline-flex;align-items:center;gap:8px;padding:6px 12px 6px 6px;border-radius:999px;font-size:14px;font-weight:600}
.app i{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;color:#fff;font-style:normal;font-size:13px;font-weight:700;font-family:var(--zh)}

/* 하루 */
.dhead{display:flex;gap:14px;align-items:center;margin:6px 0 14px}
.dhead .dn{width:58px;height:58px;border-radius:16px;background:var(--navy);color:#fff;display:grid;place-items:center;align-content:center;line-height:1.05;flex:none}
.dhead .dn b{font-family:var(--mono);font-size:24px}
.dhead .dn span{font-size:13px;color:var(--amber);font-weight:700}
.dhead h2{font-size:clamp(19px,4.6vw,28px)}
.dhead .chips{margin-top:6px}
.daygrid{display:grid;gap:16px}
.mapwrap{position:relative;border-radius:18px;overflow:hidden;border:1px solid var(--line);background:var(--sunk)}
.map{height:min(40vh,400px);min-height:250px;background:#e8eaed}
.legend{display:flex;flex-wrap:wrap;gap:6px 14px;padding:8px 12px;font-size:13px;color:var(--muted);background:var(--surface);border-top:1px solid var(--line);align-items:center}
.legend i{display:inline-block;width:22px;height:0;border-top:4px solid var(--route);vertical-align:middle;margin-right:6px}
.legend i.walk{border-top:4px dashed var(--walk)} .legend i.train{border-top:4px dashed var(--red)}
/* 동선 선: 색은 화면 모드 토큰을 따르고, 밑에 테두리 선을 깔아 어느 지도 위에서도 보이게 */
.leaflet-overlay-pane path.rt-case{stroke:var(--route-case)}
.leaflet-overlay-pane path.rt-base{stroke:var(--route)}
.leaflet-overlay-pane path.rt-a{stroke:var(--ga)}
.leaflet-overlay-pane path.rt-b{stroke:var(--gb)}
.leaflet-overlay-pane path.rt-walk{stroke:var(--walk)}
.leaflet-overlay-pane path.rt-train{stroke:var(--red)}
@media (min-width:900px){
  .daygrid{grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);align-items:start}
  .mapwrap{position:sticky;top:calc(env(safe-area-inset-top,0px) + var(--toph) + 130px)}
  .map{height:calc(100vh - var(--toph) - 230px);max-height:none}
  .stop{scroll-margin-top:calc(var(--toph) + 140px)}
}
:root[data-theme="dark"] .leaflet-tile-pane{filter:invert(.92) hue-rotate(180deg) brightness(.9) contrast(.9)}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .leaflet-tile-pane{filter:invert(.92) hue-rotate(180deg) brightness(.9) contrast(.9)}}
:root[data-theme="dark"] .map{background:#1a1f27}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .map{background:#1a1f27}}

/* 타임라인 */
.tl{list-style:none;margin:0;padding:0}
.stop,.hop{display:grid;grid-template-columns:46px 38px minmax(0,1fr);column-gap:8px}
.stop{scroll-margin-top:calc(var(--toph) + 84px)}
.tm{font-family:var(--mono);font-weight:600;font-size:15px;color:var(--time);text-align:right;padding-top:12px;font-variant-numeric:tabular-nums}
.stop.star .tm{color:var(--red)}
.ln{position:relative;display:flex;justify-content:center}
.ln::before{content:"";position:absolute;left:50%;top:0;bottom:0;margin-left:-1px;border-left:2px solid var(--line)}
.tl>li:first-child .ln::before{top:22px}
.tl>li:last-child .ln::before{bottom:auto;height:22px}
.node{position:relative;z-index:1;margin-top:5px;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:var(--cat);color:var(--on-cat);box-shadow:0 0 0 3px var(--bg)}
.node .ic{width:18px;height:18px}
.stop.star .node{box-shadow:0 0 0 2px var(--bg),0 0 0 4px var(--red)}
.node .no{position:absolute;right:-7px;bottom:-5px;min-width:20px;height:20px;padding:0 4px;border-radius:10px;background:var(--surface);color:var(--ink);font:600 13px/17px var(--mono);text-align:center;border:1.5px solid var(--cat);font-style:normal}
.cx{background:var(--surface);border:1px solid var(--line);border-radius:16px;margin:2px 0 4px;box-shadow:var(--shadow);overflow:hidden;min-width:0}
.stop.star .cx{border-color:color-mix(in srgb,var(--red) 55%,var(--line))}
.stop.isnow .cx{outline:3px solid var(--amber);outline-offset:-1px}
.stop.isnow .node{animation:pulse 1.8s infinite}
.stop.isnow .tm::after{content:"지금";display:block;margin-top:4px;margin-left:auto;width:max-content;font-family:var(--sans);font-size:13px;font-weight:700;background:var(--amber);color:#1b1300;border-radius:6px;padding:0 6px}
.cx summary{list-style:none;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;padding:12px;cursor:pointer;align-items:start}
.cx summary::-webkit-details-marker{display:none}
.hd{min-width:0;display:grid;gap:6px}
.hd h3{font-size:17px;display:flex;align-items:center;gap:6px}
.hd h3 .ic{color:var(--red);width:17px;height:17px}
.hd .sub{margin:-3px 0 0;font-size:14px;color:var(--muted);overflow-wrap:anywhere}
.wn{margin:0;display:flex;gap:6px;align-items:flex-start;font-size:14px;font-weight:600;color:var(--red);background:var(--red-soft);border-radius:10px;padding:6px 9px}
.wn .ic{width:16px;height:16px;margin-top:2px;vertical-align:0}
.side{display:grid;justify-items:end;gap:6px}
.th{width:64px;height:64px;border-radius:12px;object-fit:cover;background:var(--sunk);display:block}
.chev{width:26px;height:26px;display:grid;place-items:center;color:var(--muted);transition:transform .2s}
.cx[open] .chev{transform:rotate(180deg)}
.bd{padding:0 12px 14px;display:grid;gap:12px}
.bd .ph{border-radius:12px;overflow:hidden;aspect-ratio:16/9;background:var(--sunk)}
.bd .ph img{width:100%;height:100%;object-fit:cover;display:block}
.tips{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.tips li{display:grid;grid-template-columns:28px minmax(0,1fr);gap:8px;align-items:start;font-size:15px}
.tips li .b{width:28px;height:28px;border-radius:8px;background:var(--sunk);display:grid;place-items:center;color:var(--muted)}
.tips li .b .ic{width:16px;height:16px}
.tips li.good .b{color:var(--ok)} .tips li.bad .b,.tips li.al .b{color:var(--red)}
.tips li span:last-child{padding-top:3px}
.menu{background:var(--sunk);border-radius:12px;padding:10px 12px;display:grid;gap:8px}
.menu .mh{display:flex;justify-content:space-between;align-items:center;font-size:14px;font-weight:700}
.menu .mh .ic{color:var(--c-food)}
.menu .mh span{font-family:var(--mono);color:var(--time)}
.menu .chips .ch{background:var(--surface);font-size:14px}
.pls{display:grid;gap:8px}
.pl{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;background:var(--navy);color:#fff;border-radius:12px;padding:10px 12px}
.pl .pn b{display:block;font-family:var(--zh);font-size:16px;font-weight:600;overflow-wrap:anywhere}
.pl .pn span{font-size:13px;color:#b9c4d8}
.acts{display:flex;gap:6px;flex-wrap:wrap}
.ab{display:inline-flex;align-items:center;gap:6px;border:0;border-radius:10px;padding:7px 11px;font-size:14px;font-weight:700;text-decoration:none;background:rgba(255,255,255,.12);color:#fff}
.ab .ic{width:16px;height:16px}
.ab.pri{background:var(--amber);color:#1b1300}
.ab .che{font-family:var(--zh);font-size:15px;line-height:16px}
.ab.lt{background:var(--sunk);color:var(--ink)}
.hop{min-height:42px;align-items:center}
.hop .hl{align-self:stretch}
.hop .hl::before{border-left-style:dashed}
.hop .hi{position:relative;z-index:1;align-self:center;width:28px;height:28px;border-radius:50%;background:var(--bg);border:1.5px solid var(--line);display:grid;place-items:center;color:var(--muted)}
.hop .hi .ic{width:15px;height:15px}
.hop.m-walk .hi{color:var(--walk)} .hop.m-train .hi{color:var(--red)}
.hop .hc{display:flex;align-items:center;gap:8px;min-width:0;font-size:14px;color:var(--muted);padding-block:4px}
.hop .hc .tx{flex:1;min-width:0}
.hop .hc b{color:var(--ink);font-family:var(--mono);font-size:14px}
.hop .hc .hn{display:block;font-size:13px;overflow-wrap:anywhere}
.navb{flex:none;display:inline-flex;align-items:center;gap:5px;height:32px;padding:0 10px;border-radius:999px;background:var(--surface);border:1px solid var(--line);color:var(--ink);text-decoration:none;font-size:13px;font-weight:700}
.navb .ic{width:15px;height:15px;color:var(--ga)}

/* 지도 핀 */
.pin{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:var(--cat,#16223b);color:var(--on-cat);font:600 14px/1 var(--mono);border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)}
.pin.h{background:#fff;color:#16223b;border-color:#16223b;border-radius:8px}
.pin.star{box-shadow:0 0 0 2.5px #d33838,0 2px 6px rgba(0,0,0,.35)}
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
.prog{display:flex;align-items:center;gap:12px}
.prog .bar{flex:1;height:10px;border-radius:5px;background:var(--sunk);overflow:hidden}
.prog .bar i{display:block;height:100%;background:var(--ok);border-radius:5px}
.prog b{font-family:var(--mono);font-size:16px}
.stores{display:flex;gap:10px;overflow-x:auto;padding:2px 2px 8px;scroll-snap-type:x mandatory}
.store{flex:none;width:200px;scroll-snap-align:start;display:grid;gap:8px;padding:12px;text-align:left;border:1px solid var(--line);background:var(--surface);border-radius:16px;box-shadow:var(--shadow)}
.store[aria-pressed="true"]{border-color:var(--navy);box-shadow:inset 0 0 0 2px var(--navy)}
:root[data-theme="dark"] .store[aria-pressed="true"]{border-color:var(--amber);box-shadow:inset 0 0 0 2px var(--amber)}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .store[aria-pressed="true"]{border-color:var(--amber);box-shadow:inset 0 0 0 2px var(--amber)}}
.store .sh{display:flex;align-items:center;gap:8px}
.store .sh .n{width:32px;height:32px;border-radius:10px;background:var(--sunk);display:grid;place-items:center;flex:none}
.store .sh b{display:block;font-size:15px;line-height:1.2}
.store .sh span{font-size:13px;color:var(--time);font-family:var(--mono);font-weight:600}
.thumbs{display:flex}
.thumbs img{width:34px;height:34px;border-radius:50%;object-fit:cover;background:#fff;border:2px solid var(--surface);margin-right:-8px}
.thumbs em{font-style:normal;margin-left:14px;font-size:13px;font-weight:700;color:var(--muted);align-self:center}
.filters{display:flex;gap:8px;flex-wrap:wrap}
.filters button{border:1px solid var(--line);background:var(--surface);border-radius:20px;padding:7px 14px;font-size:14px;font-weight:600;display:inline-flex;align-items:center;gap:6px}
.filters button[aria-pressed="true"]{background:var(--navy);color:#fff;border-color:var(--navy)}
.items{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(min(calc(50% - 5px),200px),1fr))}
.item{overflow:hidden;display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto 1fr;position:relative}
.item .im{background:#fff;aspect-ratio:1/1;position:relative;overflow:hidden}
.item .im img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
.item .ck{position:absolute;right:8px;top:8px;z-index:1;width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.92);border:2px solid #c9d0db;display:grid;place-items:center;cursor:pointer;color:transparent}
.item .ck input{position:absolute;opacity:0;width:100%;height:100%;margin:0;cursor:pointer}
.item .ck .ic{width:18px;height:18px;stroke-width:3}
.item.got .ck{background:var(--ok);border-color:var(--ok);color:#fff}
.item.got .im img{opacity:.45}
.item .tx{padding:10px 12px 12px;display:grid;gap:3px;align-content:start;min-width:0}
.item h3{font-size:15px}
.item .zh{color:var(--muted);font-size:13px}
.item .wh{display:flex;gap:4px;align-items:flex-start;font-size:13px;font-weight:600;color:var(--time);margin-top:2px}
.item .wh .ic{width:14px;height:14px;margin-top:2px;vertical-align:0}
.item .nt{font-size:13px;color:var(--red);font-weight:600;display:flex;gap:4px;align-items:flex-start}
.item .nt .ic{width:14px;height:14px;margin-top:2px;vertical-align:0}
.tiles{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(min(calc(50% - 4px),170px),1fr))}
.tile{padding:12px;display:grid;gap:4px;align-content:start}
.tile .ic{width:22px;height:22px;color:var(--amber)}
.tile.al .ic{color:var(--red)}
.tile b{font-size:16px}
.tile span{font-size:13px;color:var(--muted)}
.flow{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.flow .ch{background:var(--surface);border:1px solid var(--line)}
.flow .to{color:var(--muted)}

/* 준비 */
.check{list-style:none;margin:0;padding:0;display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr))}
.check label{display:grid;grid-template-columns:40px minmax(0,1fr) 28px;gap:12px;padding:12px 14px;cursor:pointer;align-items:center}
.check .n{width:40px;height:40px;border-radius:12px;background:var(--sunk);display:grid;place-items:center;color:var(--muted)}
.check b{display:block;font-size:16px}
.check .s{color:var(--muted);font-size:14px}
.check input{width:26px;height:26px;accent-color:var(--ok);margin:0}
.check li.done b{text-decoration:line-through;color:var(--muted)}
.check li.done .n{background:var(--ok);color:#fff}
.kw{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr))}
.kw .row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:6px;align-items:center;padding:8px 10px 8px 12px}
.kw .row b{display:block;font-family:var(--zh);font-size:15px;font-weight:600;overflow-wrap:anywhere}
.kw .row span{font-size:13px;color:var(--muted)}
.kw .row .ab{background:var(--sunk);color:var(--ink);padding:7px 9px}
.kw .row a.ab{background:var(--navy);color:#fff}
details.more>summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;font-size:16px;font-weight:700;padding:12px 14px}
details.more>summary::-webkit-details-marker{display:none}
details.more>summary .cnt{font-family:var(--mono);color:var(--muted);font-weight:600}
details.more>summary .chev{margin-left:auto}
details.more[open]>summary .chev{transform:rotate(180deg)}
details.more>.kw{padding:0 12px 12px}
.vids{display:flex;gap:10px;overflow-x:auto;padding-bottom:8px;scroll-snap-type:x mandatory}
.vid{flex:none;width:240px;scroll-snap-align:start;overflow:hidden;text-decoration:none;display:grid}
.vid .im{position:relative}
.vid img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block}
.vid .play{position:absolute;inset:0;display:grid;place-items:center}
.vid .play i{width:44px;height:30px;border-radius:9px;background:#e62117;display:grid;place-items:center;color:#fff}
.vid div.t{padding:10px 12px;display:grid;gap:4px}
.vid b{font-size:14px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
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
    <div class="brand">상하이<small>11.27–11.30</small></div>
    <button class="now" id="now" type="button" aria-live="polite"><span class="dot"></span><span class="txt"><b id="nowA">일정 확인 중</b><span id="nowB"></span></span></button>
    <div class="clock" id="clock" title="상하이 시간 (한국보다 1시간 늦음)"><svg class="ic" aria-hidden="true"><use href="#i-clock"/></svg><b>--:--</b></div>
  </div>
</header>

<nav class="tabs" aria-label="화면">
  <div class="wrap">
    <a href="#overview" data-v="overview"><svg class="ic" aria-hidden="true"><use href="#i-home"/></svg>한눈에</a>
    <a href="#day0" data-v="plan" id="planTab"><svg class="ic" aria-hidden="true"><use href="#i-cal"/></svg>일정</a>
    <a href="#shop" data-v="shop"><svg class="ic" aria-hidden="true"><use href="#i-bag"/></svg>쇼핑</a>
    <a href="#prep" data-v="prep"><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg>준비</a>
  </div>
</nav>

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
</svg>

<main>
  <nav class="days wrap" id="days" aria-label="날짜" hidden></nav>
  <section class="view wrap" id="v-overview" data-view="overview"></section>
  <section class="view wrap" id="v-day0" data-view="day0" hidden></section>
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
 zd:["점도덕 · 德小馆 정대점","点都德·德小馆(正大店)",121.499171,31.236682,"陆家嘴西路168号 正大广场 西区6楼614室"],
 bfc:["금붕어 극장 · BFC","金鱼剧场(BFC外滩金融中心 南区B2)",121.497881,31.226642,"黄浦区中山东二路600号"],
 gxxt:["관샤 플래그십 闲庭","观夏闲庭 湖南路111号",null,null,"徐汇区湖南路111号"],
 gxxp:["관샤 香铺 (신규)","观夏香铺 淮海中路857号",null,null,"淮海中路857-861号"],
 lelabo:["르라보 × 징야 (우캉루)","LE LABO 武康路135号",null,null,"徐汇区武康路135号"],
 harmay:["화메이 안푸루 플래그십","HARMAY话梅 安福路",null,null,"武康路55号 (安福路口)"],
 vr:["《烧火工》 VR · 과학기술관","上海科技馆 烧火工沉浸体验空间",121.542073,31.218459,"浦东新区世纪大道2000号 B1"]
};
const enc=encodeURIComponent;
const amap=k=>{const p=P[k];if(p[2]==null)return \`https://uri.amap.com/search?keyword=\${enc(p[1])}&city=\${enc("上海")}&src=shanghai_trip&callnative=1\`;return \`https://uri.amap.com/marker?position=\${p[2]},\${p[3]}&name=\${enc(p[1])}&src=shanghai_trip&coordinate=gaode&callnative=1\`};
const MODE={walk:["walk","도보","walk"],taxi:["car","택시","car"],subway:["subway","지하철","bus"],train:["train","고속철",null]};
const CAT={food:"utensils",shop:"bag",sight:"landmark",fun:"sparkles",scent:"perfume",spa:"leaf",night:"wine",stay:"bed",fly:"plane",rail:"train",meet:"users"};
const navUrl=(a,b,m)=>{const A=P[a],B=P[b];return \`https://uri.amap.com/navigation?from=\${A[2]},\${A[3]},\${enc(A[1])}&to=\${B[2]},\${B[3]},\${enc(B[1])}&mode=\${m}&policy=1&src=shanghai_trip&coordinate=gaode&callnative=1\`};

/* ── 일정 ──
   k: 장소 종류(아이콘·색) · i: 정보 칩 [아이콘, 글] · w: 빨간 경고 한 줄 · tip: 펼치면 보이는 [아이콘, 글]
   menu: 주문할 것 · go: 앞 장소에서 오는 길 {m 수단, d 걸리는 시간, c 요금, n 메모} */
const DAYS=[
{id:"day0",n:1,date:[2026,11,27],wd:"금",title:"선발대 · 디즈니랜드",ppl:"2명",ic:"sparkles",cover:"p9",fit:["pvg","dis","yang","htl"],items:[
 {t:"15:30",k:"fly",title:"푸동공항 도착",sub:"上海浦东国际机场",img:"p5",pin:"pvg",pts:["pvg","dhub"],
  i:[["users","선발대 2명"],["alert","도착 시각 가정"]],
  tip:[["luggage","캐리어 · 56×36×23cm 넘는 가방은 파크 반입 금지"],["bed","공항 → 호텔 짐 배송이 제일 편해요"],["lock","못 맡기면 파크 짐 보관 ¥80/개 · 작은 짐 ¥10"]]},
 {t:"16:30",k:"fun",title:"디즈니 · 주토피아",sub:"上海迪士尼乐园",img:"p6",pin:"dis",pts:["dis"],
  go:[{m:"taxi",d:"20~30분",c:"¥80~130",n:"내리는 곳 上海迪士尼度假区西公交枢纽",from:"pvg",to:"dhub"}],
  i:[["clock","08:30–21:30"],["yen","가격 미확인 · 다른 금 ¥499"],["id","여권 원본"]],
  w:"11/27 1일권 매진 의심 → 공식 앱 · 트립닷컴 · 클룩 확인",
  tip:[["zap","주토피아 핫 퍼슈트 DPA ¥180대"],["clock","대기 시간은 당일 앱으로"]]},
 {t:"17:45",k:"fun",title:"트론 · 미키 스노우 매직",sub:"TRON · Mickey's Snow Magic",img:"p7",pin:"dis",pts:[],
  i:[["ruler","트론 122cm↑"],["music","스노우 매직 17:45 · 19:15"]],
  tip:[["moon","트론은 조명 켜진 밤이 최고"],["zap","트론 DPA 가격 미확인"]]},
 {t:"18:15",k:"fun",title:"겨울 퍼레이드 · 캐리비안",sub:"Winter Magic Cavalcade",img:"p8",pin:"dis",pts:[],
  i:[["clock","퍼레이드 18:15"]],
  tip:[["users","퍼레이드 때 다른 줄이 짧아져요"],["utensils","저녁은 가볍게 — 양꼬치 배 남기기"]]},
 {t:"20:00",k:"fun",title:"ILLUMINATE 불꽃쇼",sub:"성 앞 불꽃 + 프로젝션",img:"p9",pin:"dis",pts:[],
  i:[["clock","20:00 · 21:15"],["sparkles","Magic Together 20:15 · 21:30"]],
  tip:[["repeat","21:30 폐장까지 트론 · 주토피아 한 번 더"],["car","폐장 직후 택시 줄 김 → 디디 미리 · 11호선"]]},
 {t:"22:30",k:"food",star:1,title:"오래전 양꼬치",sub:"很久以前羊肉串 · 南京路第一百货 B관 6층",img:"p10",pin:"yang",pts:["yang"],
  go:[{m:"taxi",d:"45~60분",n:"지하철은 1시간 넘게",from:"dis",to:"yang"}],
  i:[["users","원격 줄서기"],["alert","마감 미확인"]],
  w:"디즈니 나올 때 위챗 「排队订座」로 줄 서며 마감 확인",
  menu:["쯔란 양꼬치 12개 ¥69.8","막창","단맛 옥수수","烤馒头","칭다오"],
  tip:[["hourglass","저녁 200팀 대기도 · QR로 미리 줄 서서 30분"],["shuffle","닫았으면 南京西路818广场店"]]},
 {t:"24:00",k:"spa",title:"캉다오 발마사지",sub:"康道天地(南京路店) · 10층",img:"p11",pin:"kang",pts:["kang"],
  go:[{m:"walk",d:"10분",from:"yang",to:"kang"}],
  i:[["clock","24시간"],["hourglass","발+전신 90분"],["cash","4~6만원"]],
  w:"01시 넘으면 마사지사 2명 → 예약 필수"},
 {t:"01:30",nd:1,k:"stay",title:"숙소 체크인 · 방 A",sub:"上海虹桥美爵酒店",pin:"htl",pts:["htl"],
  go:[{m:"taxi",d:"30분",from:"kang",to:"htl"}],
  tip:[["luggage","짐 배송 맡겼으면 프런트에서 찾기"]]}
]},
{id:"day1",n:2,date:[2026,11,28],wd:"토",title:"4명 합류 · 관샤 → 점도덕 → 금붕어",ppl:"2+2",ic:"users",cover:"p1",fit:["htl","zd","bfc"],items:[
 {t:"10:00",k:"stay",title:"선발대 휴식",sub:"디즈니 + 새벽 마사지 다음 날",pin:"htl",pts:[],
  i:[["coffee","조식 06:00~ · 현장 추가"]],
  tip:[["perfume","쉬스(叙室) 맞춤 조향 · 차로 10~15분 · 30ml ¥388 · 위챗 narratus 예약"]]},
 {t:"15:30",k:"fly",title:"토요일 조 도착",sub:"上海浦东国际机场 → 숙소 · 방 B",pin:"pvg",pts:["pvg"],
  i:[["users","2명"],["alert","도착 시각 가정"]],
  tip:[["clock","16:15 출발 → 17:30 전 숙소"]]},
 {t:"17:40",k:"meet",title:"4명 합류 · 출발",sub:"숙소 → 관샤",pin:"htl",pts:["htl"],
  go:[{m:"taxi",d:"60~90분",n:"또는 공항연결선 → 虹桥2号航站楼 40분 ¥26 + 택시",from:"pvg",to:"htl"}],
  i:[["car","6인승(六座) 1대 · 일반 2대"]],
  w:"19:00 넘으면 관샤 건너뛰고 점도덕으로"},
 {t:"18:05",k:"scent",star:1,title:"관샤 플래그십 闲庭",sub:"观夏闲庭 · 湖南路111号",pin:null,pts:["gxxt","gxxp"],
  go:[{m:"taxi",d:"25분"}],
  i:[["clock","~20:00"],["hourglass","30~40분"],["ticket","무료"]],
  tip:[["home","옛 서양 주택 · 1층 시향 · 2층 공방"],["users","18:00 점도덕 원격 줄서기 시작"],["pin","지도 핀 없음 → 고덕 검색으로"],["perfume","근처 观夏香铺 즉석 블렌딩 · 시간 미확인"]]},
 {t:"19:20",k:"food",star:1,title:"점도덕 딤섬",sub:"点都德·德小馆(正大店) · 6층 614",pin:"zd",pts:["zd"],
  go:[{m:"taxi",d:"35분",n:"18:45 출발 · 延安路 터널"}],
  i:[["star","Ctrip 4.2"],["yen","1인 ¥114"],["users","예약 X · 원격 줄"]],
  menu:["金莎海虾红米肠 ×2","虾饺皇 ×2","烧卖","叉烧包","凤爪","干炒牛河","白灼菜心","乳鸽"],menuSum:"4명 ¥450~550",
  tip:[["info","德小馆 = 점도덕 자매 브랜드 · 볶음 요리 더 있음"],["phone","따종디엔핑 → 排队 · 한국 번호 가입은 출국 전 시험"],["up","홍미창펀 · 하가우 칭찬"],["down","주문 뒤 쪄서 하나씩 늦게 나옴"],["card","QR 주문 · 알리페이 · ¥200↑ 나눠 내기 · 차 1인 ¥8"],["alert","마감 미확인 (다른 지점 21:30)"]]},
 {t:"20:50",k:"fun",star:1,title:"금붕어 극장",sub:"金鱼剧场 · BFC 남구 B2",pin:"bfc",pts:["bfc"],
  go:[{m:"taxi",d:"15분",n:"또는 ¥2 페리 东昌路 → 金陵东路",from:"zd",to:"bfc"}],
  i:[["clock","입장 ~21:30"],["yen","¥158 · 할인 ¥98"],["hourglass","1시간"]],
  tip:[["ticket","SmartShanghai에서 미리 구매"],["fish","살아 있는 금붕어 + 빛·물·소리·향 10개 공간"],["building","푸싱 미술관 회전 외벽 구경"],["moon","十六铺 강변 야경 · 22:00 소등"]]},
 {t:"22:00",k:"stay",title:"숙소로",sub:"上海虹桥美爵酒店",pin:"htl",pts:[],
  go:[{m:"taxi",d:"35~40분",from:"bfc",to:"htl"}],
  tip:[["clock","내일 08:15 출발"]]}
]},
{id:"day2",n:3,date:[2026,11,29],wd:"일",title:"예원 → 우캉루 → 교통대 → 장자강 → 와이탄",ppl:"4명",ic:"train",cover:"p16",fit:["yuy","sjtu","wk","hq","vue","htl"],items:[
 {t:"09:00",k:"sight",title:"예원",sub:"豫园 · 구곡교 · 성황묘",img:"p14",pin:"yuy",pts:["yuy"],
  go:[{m:"subway",d:"10호선 직행",n:"08:15 출발 · 伊犁路역까지 걸어서 15분 · 택시 30~40분",from:"htl",to:"yuy"}],
  i:[["clock","09:00 · 입장 16:00까지"],["yen","¥40"],["hourglass","1~1.5시간"]],
  tip:[["users","주말 → 문 열자마자"]]},
 {t:"11:30",k:"food",title:"남상만두점",sub:"南翔馒头店(豫园路店)",img:"p15",pin:"nx",pts:["nx","lbl"],
  go:[{m:"walk",d:"바로 옆",from:"yuy",to:"nx"}],
  i:[["award","미슐랭 가이드"],["hourglass","주말 1시간↑ 대기"]],
  menu:["1층 포장 小笼 6개 ¥30","2층 小笼 ¥38","2층 蟹粉小笼 ¥48","3층 蟹黄汤包 ¥49/개"],
  tip:[["phone","룸 예약 +86 21 6355 4206"],["down","값에 비해 그저 그렇다는 후기 꾸준"],["shuffle","대안 녹파랑 · 정문 공사 표시 → 021-63280602"]]},
 {t:"12:45",k:"scent",title:"우캉루 향수 산책",sub:"武康路 · 르라보 · 화메이",pin:"wk",pts:["lelabo","harmay","wk"],
  go:[{m:"subway",d:"15분",n:"10호선 豫园 → 交通大学 + 걸어서 10분",from:"nx",to:"wk"}],
  i:[["leaf","은행잎 절정"],["camera","武康路390号 은행나무"]],
  tip:[["perfume","르라보 × 징야 135号 · 상하이 한정 Myrrhe 55"],["store","화메이 55号 · 4층 뷰티 편집숍 · 영업 확인"],["qr","13:00 「参观交大」 4명 등록"]]},
 {t:"14:30",k:"meet",star:1,title:"상해교통대",sub:"上海交通大学 徐汇校区 · 华山路1954号",img:"p16",pin:"sjtu",pts:["sjtu"],
  go:[{m:"walk",d:"10분",n:"14:15 출발",from:"wk",to:"sjtu"}],
  i:[["id","4명 여권"],["qr","参观交大 당일 등록"]],
  tip:[["subway","15:30 10호선 → 虹桥火车站행 (航中路행 X)"]]},
 {t:"16:17",k:"rail",title:"고속철 → 장자강",sub:"G7138 上海虹桥 → 张家港",img:"p18",pin:"hq",pts:["hq"],
  go:[{m:"subway",d:"30분",n:"15:30 출발 · 10호선 직행",from:"sjtu",to:"hq"}],
  i:[["clock","16:00 집합"],["hourglass","50분"],["yen","¥53"]],
  tip:[["ticket","트립닷컴 · 12306 · 여권으로 4장 미리"],["shuffle","대안 D2136 16:11 · C3802 상하이역 15:46"]]},
 {t:"17:07",k:"meet",title:"장자강 · Kubert 씨 저녁",sub:"张家港站",img:"p19",pin:"zjg",pts:["zjg"],
  go:[{m:"train",d:"50분",n:"G7138",from:"hq",to:"zjg"}],
  i:[["utensils","역 근처 식당"]],
  tip:[["train","귀가 D5565 19:29 → 20:21 · ¥54"],["shuffle","일찍 G2573 19:04 · 늦게 G8285 20:35"]]},
 {t:"21:10",k:"sight",title:"와이탄 야경 · 스냅",sub:"外滩 · 남경동로 끝 강변",img:"p20",pin:"bund",pts:["bund"],
  go:[{m:"train",d:"52분",n:"D5565 19:29 → 20:21",from:"zjg",to:"hq"},{m:"subway",d:"40분",n:"2호선 → 南京东路 · 택시 35~45분",from:"hq",to:"bund"}],
  i:[["sparkles","조명 ~22:00"],["camera","스냅 1장 ¥30 · 5장 ¥140대"]],
  w:"21:30 전에 도착"},
 {t:"22:00",k:"night",title:"VUE 루프탑 바",sub:"Hyatt on the Bund 32~33층",img:"p21",pin:"vue",pts:["vue"],
  go:[{m:"walk",d:"15분",from:"bund",to:"vue"}],
  i:[["clock","~01:30"],["yen","¥128~158 · 미확인"],["shirt","스마트 캐주얼"]],
  tip:[["waves","야외 자쿠지 · 와이탄 + 루자쭈이 뷰"],["moon","야식 홍쿠이지아 · 클럽 INS"]]},
 {t:"24:00",k:"stay",title:"숙소로",sub:"上海虹桥美爵酒店",pin:"htl",pts:[],
  go:[{m:"taxi",d:"30분",from:"vue",to:"htl"}],
  tip:[["luggage","짐 미리 싸 두기 · 월 07:50 체크아웃"]]}
]},
{id:"day3",n:4,date:[2026,11,30],wd:"월",title:"칭즈 → 짝퉁시장 → 난징동루 → 귀국",ppl:"4명",ic:"plane",cover:"p27",fit:["dhc","ap","jj"],items:[
 {t:"07:50",k:"stay",title:"체크아웃 · 캐리어 맡기기",sub:"上海虹桥美爵酒店",pin:"htl",pts:["htl"],
  tip:[["luggage","프런트에 캐리어 → 13:25 찾으러"]]},
 {t:"08:30",k:"food",title:"대호춘 생지엔",sub:"大壶春(四川中路店)",img:"p24",pin:"dhc",pts:["dhc"],
  go:[{m:"taxi",d:"30~40분",from:"htl",to:"dhc"}],
  i:[["award","빕 구르망"],["yen","1인 ¥27"],["clock","08:00–21:00"]],
  menu:["虾仁生煎 새우 생지엔","生煎 4개 ¥9~13"],
  tip:[["cash","카드 · 현금 자료 엇갈림 → 현금 조금"],["hourglass","셀프 주문 · 줄 길기도"]]},
 {t:"09:00",k:"shop",title:"칭즈 핸드크림",sub:"青稚 南京东路66号",img:"p26",pin:"qz",pts:["qz"],
  go:[{m:"walk",d:"5분",from:"dhc",to:"qz"}],
  i:[["clock","09:00–24:00"],["yen","¥50~55"]],
  tip:[["gift","각인 · 포장 3개 30분 → 급하면 포장만"]]},
 {t:"10:00",k:"shop",title:"AP Plaza 짝퉁시장",sub:"亚太盛汇 · 上海科技馆역 지하",img:"p17",pin:"ap",pts:["ap"],
  go:[{m:"subway",d:"15분",n:"09:35 출발 · 2호선 南京东路 → 上海科技馆",from:"qz",to:"ap"}],
  i:[["clock","10:00–20:00"],["hourglass","1시간"]],
  w:"짝퉁은 한국 세관에서 압수될 수 있어요",
  tip:[["door","좋은 건 호객꾼 따라 「창고」"],["camoff","촬영에 예민"],["percent","부른 값 절반 이하로"]]},
 {t:"11:20",k:"shop",title:"팝마트 · 미니소랜드",sub:"POP MART 南京东路299号 · 名创优品 479号",img:"p27",pin:"pop",pts:["pop","mns","mms"],
  go:[{m:"subway",d:"15분",n:"11:00 출발 · 2호선 → 南京东路",from:"ap",to:"pop"}],
  i:[["clock","팝마트 10:00–23:00"]],
  tip:[["gift","라부부 · 스컬판다 랜덤박스"],["store","미니소 479号 全球壹号店 · M&M's · 레고"]]},
 {t:"11:45",k:"shop",title:"올레 마트",sub:"Ole精品超市 · 新世界新丸中心",pin:"ole",pts:["ole"],
  go:[{m:"walk",d:"5분",from:"pop",to:"ole"}],
  i:[["alert","영업시간 미확인"]],
  tip:[["cart","마카다미아 · 에그롤 · 오이맛 칩 · 하이디라오 소스"],["yen","수입 식품 위주라 조금 비쌀 수"]]},
 {t:"12:05",k:"shop",title:"제일식품상점",sub:"上海市第一食品商店 · 南京东路720号",img:"p28",pin:"ff",pts:["ff"],
  go:[{m:"walk",d:"10분",from:"ole",to:"ff"}],
  tip:[["gift","화이트래빗 무게로 · 대추누가 · 나비파이"],["receipt","¥200↑ 여권 내고 택스리펀"]]},
 {t:"12:20",k:"food",title:"자자탕바오",sub:"佳家汤包 · 黄河路127号",pin:"jj",pts:["jj","gj"],
  go:[{m:"walk",d:"5분",from:"ff",to:"jj"}],
  i:[["star","Trip 4.4"],["yen","1인 ¥35~41"],["clock","07:30–20:30"]],
  w:"옆집 佳乐汤包 아님 · 간판 佳家 확인",
  menu:["게살 탕바오","황금 게살 비빔면"],
  tip:[["gift","앞 국제반점 나비파이 · 줄 길면 패스"]]},
 {t:"13:25",k:"stay",title:"캐리어 찾기",sub:"上海虹桥美爵酒店 · 프런트",pin:"htl",pts:[],
  go:[{m:"taxi",d:"30~40분",n:"12:50 출발",from:"jj",to:"htl"}],
  tip:[["car","캐리어 4개 → 6인승(六座商务) 1대 · 일반 2대"]]},
 {t:"13:35",k:"fly",title:"푸동공항 · 16:50 출발",sub:"上海浦东国际机场",img:"p5",pin:"pvg",pts:["pvg"],
  go:[{m:"taxi",d:"60~70분",n:"약 50km",from:"htl",to:"pvg"}],
  i:[["clock","14:40쯤 도착"]],
  tip:[["receipt","체크인 → 세관 택스리펀 도장 → 출국심사 → 환급 창구"],["bag","출국장 막판 간식 쇼핑"],["alert","늦어지면 칭즈 · 제일식품부터 빼기"]]}
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
    const a=shNow();const today=Date.UTC(a.getUTCFullYear(),a.getUTCMonth(),a.getUTCDate());const fd=first.day.date;const dd=Math.round((Date.UTC(fd[0],fd[1]-1,fd[2])-today)/864e5);
    return {live:false,d:dd>0?\`D-\${dd}\`:"D-DAY",a:dd>0?\`출발까지 D-\${dd}\`:\`오늘 출발 · \${dur(first.at-now)} 뒤 시작\`,b:\`\${first.day.date[1]}/\${first.day.date[2]}(\${first.day.wd}) \${first.t} \${first.title}부터\`,go:first};
  }
  if(now>end)return {live:false,d:"끝",a:"여행 끝! 다들 수고했어요",b:"11/30(월) 16:50 푸동 출발",go:null};
  let cur=null,next=null;for(const it of FLAT){if(it.at<=now)cur=it;else{next=it;break}}
  if(!next)return {live:true,d:"여행 중",a:\`지금 · \${cur.title}\`,b:\`16:50 비행기 · \${dur(end-now)} 뒤\`,go:cur,cur};
  return {live:true,d:"여행 중",a:\`지금 · \${cur.title}\`,b:\`다음 \${next.t} \${next.title} · \${dur(next.at-now)} 뒤\`,go:cur,cur};
}
let ST=null;
function tick(){
  const a=shNow();document.querySelector("#clock b").textContent=pad(a.getUTCHours())+":"+pad(a.getUTCMinutes());
  ST=status();const btn=document.getElementById("now");btn.classList.toggle("live",ST.live);
  document.getElementById("nowA").textContent=ST.a;document.getElementById("nowB").textContent=ST.b;
  const hd=document.getElementById("heroD");if(hd)hd.textContent=ST.d;
  document.querySelectorAll(".stop.isnow").forEach(c=>c.classList.remove("isnow"));
  if(ST.cur){const c=document.getElementById("it-"+ST.cur.key);if(c)c.closest(".stop").classList.add("isnow")}
  // 「일정」 탭은 여행 중이면 오늘 날짜로
  const ymd=[a.getUTCFullYear(),a.getUTCMonth()+1,a.getUTCDate()].join("-");const td=DAYS.find(D=>D.date.join("-")===ymd);
  if(td&&!DAYS.some(D=>D.id===location.hash.slice(1)))document.getElementById("planTab").href="#"+td.id;
}

/* ── 그리기 ── */
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const zhSpan=s=>esc(s).replace(/([㐀-鿿][㐀-鿿\\w\\-（）()·]*)/g,'<span class="zh" lang="zh-CN">$1</span>');
const I=(n,c="")=>\`<svg class="ic \${c}" aria-hidden="true"><use href="#i-\${n}"/></svg>\`;
const chip=([ic,tx])=>\`<span class="ch \${ic==="alert"?"al":""}">\${I(ic)}\${zhSpan(tx)}</span>\`;
const CHE=\`<span class="che" aria-hidden="true">车</span>\`;
function acts(k){const p=P[k];return \`<div class="acts"><a class="ab pri" href="\${amap(k)}" target="_blank" rel="noopener">\${I("map")}고덕지도</a><button class="ab" type="button" data-copy="\${esc(p[1])}">\${I("copy")}복사</button><button class="ab" type="button" data-show="\${k}">\${CHE}기사님</button></div>\`}
function placeRow(k){const p=P[k];return \`<div class="pl"><div class="pn"><b lang="zh-CN">\${esc(p[1])}</b><span>\${esc(p[0])}</span></div>\${acts(k)}</div>\`}
function pinCls(it){return it.pin==="htl"?"h":"k-"+it.k+(it.star?" star":"")}
const TIPCLS={up:"good",down:"bad",alert:"al"};
function hopRow(g,toPin){
  const [ic,lab,m]=MODE[g.m];const to=g.to||toPin;
  const link=(m&&g.from&&to)?\`<a class="navb" href="\${navUrl(g.from,to,m)}" target="_blank" rel="noopener" aria-label="\${lab} 길찾기">\${I("nav")}길찾기</a>\`:"";
  return \`<li class="hop m-\${g.m}"><span></span><span class="ln hl"><span class="hi" title="\${lab}">\${I(ic)}</span></span><div class="hc"><span class="tx"><b>\${esc(g.d||"")}</b>\${g.c?\` · \${esc(g.c)}\`:""}<span class="hn">\${lab}\${g.n?" · "+zhSpan(g.n):""}</span></span>\${link}</div></li>\`;
}
const PINNO={};
function renderDay(D){
  const no={};let c=0;D.items.forEach(it=>{if(it.pin&&!(it.pin in no))no[it.pin]=it.pin==="htl"?"H":++c});PINNO[D.id]=no;
  const legend=\`<div class="legend"><span><i></i>차 · 지하철</span><span><i class="walk"></i>도보</span>\${D.items.some(it=>(it.go||[]).some(g=>g.m==="train"))?'<span><i class="train"></i>고속철</span>':""}<span>직선은 순서만</span></div>\`;
  const rows=D.items.map((it,i)=>{
    const hops=(it.go||[]).map(g=>hopRow(g,it.pin)).join("");
    const num=it.pin?\`<i class="no">\${no[it.pin]}</i>\`:"";
    const chips=(it.i||[]).length?\`<div class="chips">\${it.i.map(chip).join("")}</div>\`:"";
    const menu=it.menu?\`<div class="menu"><div class="mh"><b>\${I("utensils")} 시킬 것</b>\${it.menuSum?\`<span>\${esc(it.menuSum)}</span>\`:""}</div><div class="chips">\${it.menu.map(m=>\`<span class="ch">\${zhSpan(m)}</span>\`).join("")}</div></div>\`:"";
    const tips=(it.tip||[]).length?\`<ul class="tips">\${it.tip.map(([ic,tx])=>\`<li class="\${TIPCLS[ic]||""}"><span class="b">\${I(ic)}</span><span>\${zhSpan(tx)}</span></li>\`).join("")}</ul>\`:"";
    const pls=it.pts.length?\`<div class="pls">\${it.pts.map(placeRow).join("")}</div>\`:"";
    const fly=it.pin?\`<div class="acts"><button class="ab lt" type="button" data-fly="\${D.id}:\${i}">\${I("target")}지도에서 위치</button></div>\`:"";
    return \`\${hops}<li class="stop k-\${it.k} \${it.star?"star":""}"><div class="tm">\${it.t}</div><div class="ln"><span class="node">\${I(CAT[it.k])}\${num}</span></div>
<details class="cx" id="it-\${it.key}" data-day="\${D.id}" data-i="\${i}"><summary><div class="hd"><h3>\${it.star?I("star","fill"):""}\${esc(it.title)}</h3><p class="sub">\${zhSpan(it.sub)}</p>\${chips}\${it.w?\`<p class="wn">\${I("alert")}<span>\${zhSpan(it.w)}</span></p>\`:""}</div>
<div class="side">\${it.img?\`<img class="th" loading="lazy" src="/neander/2026shanghai/img/\${it.img}.jpg" alt="">\`:""}<span class="chev" aria-hidden="true">\${I("chev")}</span></div></summary>
<div class="bd">\${it.img?\`<div class="ph"><img loading="lazy" src="/neander/2026shanghai/img/\${it.img}.jpg" alt="\${esc(it.title)} 사진"></div>\`:""}\${menu}\${tips}\${pls}\${fly}</div></details></li>\`}).join("");
  const stars=D.items.filter(it=>it.star).length;const places=Object.keys(no).length+D.items.filter(it=>!it.pin).length;
  document.getElementById("v-"+D.id).innerHTML=\`<div class="dhead"><div class="dn"><b>\${D.date[2]}</b><span>\${D.wd}</span></div><div><h2>\${esc(D.title)}</h2><div class="chips"><span class="ch">\${I("users")}\${D.ppl}</span><span class="ch">\${I("pin")}\${places}곳</span>\${stars?\`<span class="ch st">\${I("star","fill")}필수 \${stars}</span>\`:""}</div></div></div>
<div class="daygrid"><div class="mapwrap"><div class="map" id="map-\${D.id}" role="region" aria-label="\${D.date[1]}/\${D.date[2]} 동선 지도"></div>\${legend}</div><ol class="tl">\${rows}</ol></div>\`;
}
function renderDays(){
  document.getElementById("days").innerHTML=DAYS.map(D=>\`<a href="#\${D.id}" data-d="\${D.id}">\${I(D.ic)}<span class="d"><b>\${D.date[2]}</b><span>\${D.wd} · \${D.ppl}</span></span></a>\`).join("");
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
  D.items.forEach(it=>(it.go||[]).forEach(g=>{const to=g.to||it.pin;if(!g.from||!to)return;
    const k=g.m==="walk"?"walk":g.m==="train"?"train":"base";const pts=[ll(g.from),ll(to)];const w=g.m==="walk"?4:5;
    L.polyline(pts,{className:"rt-case",weight:w+4,opacity:1,interactive:false}).addTo(map);
    L.polyline(pts,{className:"rt rt-"+k,weight:w,opacity:1,dashArray:(g.m==="walk"||g.m==="train")?"8 8":null,interactive:false}).addTo(map)}));
  const markers={};
  Object.keys(no).forEach(k=>{
    const its=D.items.filter(it=>it.pin===k);const f=its.find(it=>it.star)||its[0];
    const icon=L.divIcon({className:"",html:\`<span class="pin \${pinCls(f)}">\${no[k]}</span>\`,iconSize:[30,30],iconAnchor:[15,15],popupAnchor:[0,-14]});
    const html=\`<div class="pop">\${its.map(it=>\`<div><span class="pt">\${it.t}</span> <b style="display:inline">\${esc(it.title)}</b></div>\`).join("")}<div class="zh" lang="zh-CN">\${esc(P[k][1])}</div><div class="row"><button type="button" data-open="\${its[0].key}">자세히</button><a href="\${amap(k)}" target="_blank" rel="noopener">고덕지도 ↗</a></div></div>\`;
    markers[k]=L.marker(ll(k),{icon,title:P[k][0],riseOnHover:true}).addTo(map).bindPopup(html);
  });
  map.fitBounds(L.latLngBounds(D.fit.map(ll)),{padding:[28,28]});
  MAPS[D.id]={map,markers};return MAPS[D.id];
}

/* ── 한눈에 ── */
function renderOverview(){
  const dc=DAYS.map(D=>{
    const seq=D.items.filter((it,i,a)=>!(i>0&&a[i-1].pin&&a[i-1].pin===it.pin&&a[i-1].k===it.k));
    const chain=seq.map((it,i)=>\`\${i?'<i class="ar"></i>':""}<span class="n k-\${it.k} \${it.star?"star":""}" title="\${it.t} \${esc(it.title)}">\${I(CAT[it.k])}</span>\`).join("");
    return \`<a class="dc box" href="#\${D.id}"><div class="cv"><img loading="lazy" src="/neander/2026shanghai/img/\${D.cover}.jpg" alt=""><span class="dt"><b>\${D.date[2]}</b><span>\${D.wd}</span></span><span class="pp">\${I("users")}\${D.ppl}</span></div>
<div class="bdy"><h3>\${esc(D.title)}</h3><div class="chain">\${chain}</div></div></a>\`}).join("");
  const must=FLAT.filter(it=>it.star).map(it=>\`<a class="box k-\${it.k}" href="#\${it.day.id}" data-jump="\${it.key}"><span class="n">\${I(CAT[it.k])}</span><span><span>\${it.day.date[1]}/\${it.day.date[2]} \${it.day.wd} \${it.t}</span><b>\${esc(it.title)}</b></span></a>\`).join("")
    +\`<a class="box k-fly" href="#day3" data-jump="day3-9"><span class="n">\${I("plane")}</span><span><span>11/30 월 16:50</span><b>푸동 출발</b></span></a>\`;
  const APPS=[["支","#1677ff","알리페이"],["微","#07c160","위챗"],["点","#ff6633","따종디엔핑"],["滴","#ff7a00","디디"],["D","#1a3c8f","디즈니"],["T","#287dfa","트립닷컴"]];
  document.getElementById("v-overview").innerHTML=\`
<div class="hero"><img src="/neander/2026shanghai/img/p1.jpg" alt="상하이 루자쭈이 야경"><div class="in">
<p class="eb">SHANGHAI · 2026</p><h1>상하이 3박 4일</h1>
<div class="row"><span class="pill dd">\${I("plane")}<span id="heroD">D-?</span></span><span class="pill">\${I("cal")}11.27 금 – 11.30 월</span><span class="pill">\${I("users")}2 + 2명</span><span class="pill">\${I("clock")}한국 −1시간</span></div>
</div></div>
<div class="sec"><h2>\${I("cal")}나흘 동선</h2><div class="daycards">\${dc}</div></div>
<div class="sec"><h2>\${I("star")}꼭 갈 곳</h2><div class="must">\${must}</div></div>
<div class="sec"><h2>\${I("bed")}숙소</h2><div class="hotel box">
<div class="hh"><span class="n">\${I("bed")}</span><div><h3>그랜드 머큐어 상하이 훙차오</h3><p><span class="zh" lang="zh-CN">上海虹桥美爵酒店 · 长宁区仙霞路369号</span></p></div></div>
<div class="stats"><div class="stat">\${I("car")}<b>30~40분</b><span>시내 · 와이탄</span></div><div class="stat">\${I("train")}<b>20분</b><span>훙차오역</span></div><div class="stat">\${I("plane")}<b>60~70분</b><span>푸동공항</span></div><div class="stat">\${I("subway")}<b>도보 15분</b><span>10호선 <span class="zh">伊犁路</span></span></div></div>
<div class="pls">\${placeRow("htl")}</div>
<div class="acts"><a class="ab lt" href="https://kr.trip.com/hotels/detail/?hotelId=345044" target="_blank" rel="noopener">\${I("ext")}트립닷컴</a></div>
</div></div>
<div class="sec"><h2>\${I("info")}버튼</h2><div class="legendbtns">
<div class="box"><span class="ab pri">\${I("map")}고덕지도</span><span>앱에서 핀 열기</span></div>
<div class="box"><span class="ab lt">\${I("copy")}복사</span><span>중국어 이름</span></div>
<div class="box"><span class="ab lt">\${CHE}기사님</span><span>택시에서 보여 주기</span></div>
<div class="box"><span class="navb">\${I("nav")}길찾기</span><span>이 구간 길 안내</span></div>
</div></div>
<div class="sec"><h2>\${I("phone")}필요한 앱</h2><div class="apps">\${APPS.map(a=>\`<span class="app box"><i style="background:\${a[1]}">\${a[0]}</i>\${a[2]}</span>\`).join("")}</div></div>\`;
}

/* ── 쇼핑 ── [이름, 중국어, 어디서·얼마, 주의] */
const SHOP=[
["화이트래빗 밀크캔디","大白兔奶糖","제일식품상점 · 마트"],
["칭즈 핸드크림","青稚护手霜","칭즈 · ¥50~55"],
["나비파이","蝴蝶酥","제일식품상점 · 공항"],
["대추누가","枣夹核桃","제일식품상점 1층"],
["마카다미아","三只松鼠 夏威夷果","올레 마트"],
["카만 에그롤","KAMAN 鸡蛋卷","올레 마트"],
["레이즈 오이맛","乐事 黄瓜味","마트 · 편의점"],
["하이디라오 소스","海底捞 火锅底料","마트 · 토마토탕 ¥12.9","소기름(牛油) 제품은 검역 확인"],
["투도우펀 감자면","土豆粉","마트 · 약 ¥11"],
["취뚜어뚜어 쿠키","趣多多","마트 · 편의점"],
["I❤SH 티셔츠","I LOVE 上海 T恤","난징동루 기념품숍"],
["팝마트 라부부","泡泡玛特 LABUBU","팝마트 플래그십"],
["스벅 상하이 시티컵","星巴克 城市杯","스타벅스"],
["장샤오바이 고량주","江小白","올레 마트","술 1인 2L · $400까지 면세"],
["베이징덕맛 프레첼","百力滋 北京烤鸭味","공항 · 마트"],
["홀리랜드 디저트","好利来","홀리랜드 매장","보냉팩 넣기"],
["관샤 향수·디퓨저","观夏 To Summer","관샤 闲庭 · 향수 10만원대"],
["블랜버니 차 세트","Blendbunny","티엔즈팡 · 신천지 · 3.5만원~"],
["대홍포 · 보이차","大红袍 · 普洱茶","차 전문점 · 2~3만원"],
["국제반점 나비파이","国际饭店 蝴蝶酥","南京西路170号 · 자자탕바오 앞"],
["실크 스카프","真丝丝巾","티엔즈팡 · 공항 · ¥120~880","혼방 표시 확인"],
["상하이 여인 크림 세트","老上海雪花膏 礼盒","난징동루 기념품숍"],
["마오타이","贵州茅台","공항 면세점","가짜 많음 → 면세점에서"],
["화이트래빗 선물세트","大白兔 礼盒","제일식품상점 · 공항"],
["일본 위스키","山崎 · 白州","푸동공항 주류 면세점"],
["우량예 백주","五粮液","푸동공항 주류 면세점"],
["석쿠먼 황주","石库门 黄酒","T2 淘青月"],
["대추호두말이","枣夹核桃","공항 · ¥85/95"],
["에그롤","鸡蛋卷","공항 · ¥35"],
["스벅 중국 시티컵","星巴克 城市杯","T1 스타벅스 · ¥159"],
["판다 굿즈","熊猫 公仔","공항 판다샵"],
["중국 한정 프레첼","百力滋","공항 기념품 면세점"]];
const STORES=[["ole","cart","올레 마트","월 11:45",[4,5,6,7,8,9,13]],["nj","store","난징동루","월 09:00~12:20",[1,11,0,2,3,23,10,21,19]],["gx","perfume","관샤 闲庭","토 18:05",[16]],["air","plane","푸동공항","월 15:00~",[22,24,25,26,27,28,29,30,31,14]],["etc","bag","그 밖","시간 날 때",[12,15,17,18,20]]];
const store={get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
let shopF="all";
function renderShop(){
  const got=store.get("sh-got",{});
  const cnt=Object.values(got).filter(Boolean).length;
  const S=STORES.find(s=>s[0]===shopF);
  const list=SHOP.map((s,i)=>({s,i})).filter(({i})=>shopF==="all"?true:shopF==="left"?!got[i]:S[4].includes(i));
  if(S)list.sort((a,b)=>S[4].indexOf(a.i)-S[4].indexOf(b.i));
  document.getElementById("v-shop").innerHTML=\`<div class="dhead"><div class="dn">\${I("bag")}</div><div style="flex:1;min-width:0"><h2>사올 것</h2><div class="prog" style="margin-top:6px"><span class="bar"><i style="width:\${Math.round(cnt/SHOP.length*100)}%"></i></span><b id="shopCnt">\${cnt}/\${SHOP.length}</b></div></div></div>
<div class="sec" style="margin-top:4px"><h2>\${I("store")}어디서</h2><div class="stores">\${STORES.map(s=>\`<button type="button" class="store" data-f="\${s[0]}" aria-pressed="\${shopF===s[0]}"><span class="sh"><span class="n">\${I(s[1])}</span><span><b>\${zhSpan(s[2])}</b><span>\${s[3]}</span></span></span><span class="thumbs">\${s[4].slice(0,5).map(i=>\`<img loading="lazy" src="/neander/2026shanghai/img/s\${i+1}.jpg" alt="">\`).join("")}<em>\${s[4].length}개</em></span></button>\`).join("")}</div>
<div class="filters" role="group" aria-label="보기"><button type="button" data-f="all" aria-pressed="\${shopF==="all"}">전체 \${SHOP.length}</button><button type="button" data-f="left" aria-pressed="\${shopF==="left"}">\${I("tick")}안 산 것 \${SHOP.length-cnt}</button></div>
<div class="items">\${list.map(({s,i})=>\`<div class="item box \${got[i]?"got":""}"><div class="im"><img loading="lazy" src="/neander/2026shanghai/img/s\${i+1}.jpg" alt="\${esc(s[0])}"><label class="ck" title="샀어요">\${I("tick")}<input type="checkbox" id="got-\${i}" data-got="\${i}" \${got[i]?"checked":""} aria-label="\${esc(s[0])} 샀어요"></label></div>
<div class="tx"><h3>\${esc(s[0])}</h3><span class="zh" lang="zh-CN">\${esc(s[1])}</span><span class="wh">\${I("pin")}<span>\${zhSpan(s[2])}</span></span>\${s[3]?\`<span class="nt">\${I("alert")}<span>\${zhSpan(s[3])}</span></span>\`:""}</div></div>\`).join("")||'<p class="ch">다 샀어요!</p>'}</div></div>
<div class="sec"><h2>\${I("alert")}한국 들어올 때</h2><div class="tiles">
<div class="tile box">\${I("cash")}<b>$800</b><span>1인 면세 · 4명 각자</span></div>
<div class="tile box">\${I("wine")}<b>2L · $400</b><span>술은 따로 · 나눠 들기</span></div>
<div class="tile box al">\${I("ban")}<b>고기 제품</b><span>육포 · 소시지 반입 X</span></div>
<div class="tile box al">\${I("ban")}<b>짝퉁</b><span>압수될 수 있음</span></div>
<div class="tile box">\${I("receipt")}<b>¥200↑</b><span>같은 매장 · 택스리펀</span></div>
<div class="tile box">\${I("percent")}<b>자진신고</b><span>넘으면 관세 30% 감면</span></div>
</div></div>
<div class="sec"><h2>\${I("plane")}푸동공항 면세점</h2>
<div class="flow"><span class="ch">\${I("clock")}14:40 도착</span><span class="to">→</span><span class="ch">체크인</span><span class="to">→</span><span class="ch">\${I("receipt")}세관 택스리펀</span><span class="to">→</span><span class="ch">출국심사</span><span class="to">→</span><span class="ch">\${I("bag")}쇼핑 약 1시간</span></div>
<div class="tiles">
<div class="tile box">\${I("plane")}<b>T1 · T2</b><span>대한항공 T1 · 아시아나 T2 (후기) · 탑승권 확인</span></div>
<div class="tile box">\${I("clock")}<b>07:00~</b><span>마지막 편까지 · T2 <span class="zh">淘青月</span> ~23:00</span></div>
<div class="tile box">\${I("id")}<b>여권 + 탑승권</b><span>술 · 담배 만 18세↑</span></div>
<div class="tile box">\${I("wine")}<b>술이 강점</b><span>발베니 일부 인천보다 쌈 (2024 후기)</span></div>
<div class="tile box">\${I("perfume")}<b>화장품 ≈ 한국</b><span>간식은 시내보다 조금 비쌈</span></div>
<div class="tile box al">\${I("ban")}<b>시내면세점 X</b><span>크루즈 승객 전용 (2025.12)</span></div>
</div></div>\`;
}

/* ── 준비 ── [아이콘, 할 일, 짧은 설명] */
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
const VIDS=[["OrNvBu26NQo","최신 상하이 맛집·카페·3박4일 코스까지 영상 하나로 상하이 여행 총정리하기","또 떠나는 남자 · 2026-11-22"],
["JXo3OLIEbDI","2박 3일 상하이 여행 브이로그 | 디즈니랜드부터 현지 mz 맛집까지","김베개 · 2025-09-22"],
["1zL_W0O9u_Y","카메라 끄라던 상하이 짝퉁시장, 그 안에서 벌어진 일","또떠나용 · 2025-05-07"],
["D05XTLRArJM","나 혼자 첫 상하이 · 동선 집착러의 2박3일 상해여행 완벽코스","현주zip · 2026-10-04"],
["ORr4metVjT4","상해 여행 · 요즘 유행 디저트·인생맛집, 양쯔깐루, 헤드스파, 총경비","끼리 KKIRI · 2026-01-16"],
["1ud11IE2GMo","상하이 브이로그 (타임라인·고덕지도 링크)","트윙클린 · 2026-11-14"]];
function kwRow(k){const p=P[k];return \`<div class="row box"><span><b lang="zh-CN">\${esc(p[1])}</b><span>\${esc(p[0])}</span></span><button class="ab" type="button" data-copy="\${esc(p[1])}" aria-label="복사">\${I("copy")}</button><a class="ab" href="\${amap(k)}" target="_blank" rel="noopener" aria-label="고덕지도">\${I("map")}</a></div>\`}
function renderPrep(){
  const done=store.get("sh-prep",{});const n=Object.values(done).filter(Boolean).length;
  document.getElementById("v-prep").innerHTML=\`<div class="dhead"><div class="dn">\${I("check")}</div><div style="flex:1;min-width:0"><h2>출발 전에</h2><div class="prog" style="margin-top:6px"><span class="bar"><i style="width:\${Math.round(n/PREP.length*100)}%"></i></span><b>\${n}/\${PREP.length}</b></div></div></div>
<ul class="check">\${PREP.map((p,i)=>\`<li class="box \${done[i]?"done":""}"><label><span class="n">\${I(done[i]?"tick":p[0])}</span><span><b>\${esc(p[1])}</b><span class="s">\${zhSpan(p[2])}</span></span><input type="checkbox" id="prep-\${i}" data-prep="\${i}" \${done[i]?"checked":""}></label></li>\`).join("")}</ul>
<div class="sec"><h2>\${I("map")}고덕지도 검색어</h2><div class="kw">\${KW.map(kwRow).join("")}</div></div>
<div class="sec"><details class="more box"><summary>\${I("ban")}이번 일정에서 빠진 곳 <span class="cnt">\${SKIP.length}</span><span class="chev">\${I("chev")}</span></summary><div class="kw">\${SKIP.map(kwRow).join("")}</div></details></div>
<div class="sec"><h2>\${I("play")}참고 영상</h2><div class="vids">\${VIDS.map((v,i)=>\`<a class="vid box" href="https://www.youtube.com/watch?v=\${v[0]}" target="_blank" rel="noopener"><span class="im"><img loading="lazy" src="/neander/2026shanghai/img/v\${i+1}.jpg" alt=""><span class="play"><i>\${I("play","fill")}</i></span></span><div class="t"><b>\${esc(v[1])}</b><span>\${esc(v[2])}</span></div></a>\`).join("")}</div></div>\`;
}

/* ── 화면 전환 ── */
const VIEWS=["overview","day0","day1","day2","day3","shop","prep"];
function show(v,opts={}){
  if(!VIEWS.includes(v))v="overview";
  const isDay=v.startsWith("day");
  document.querySelectorAll(".view").forEach(s=>s.hidden=s.dataset.view!==v);
  document.getElementById("days").hidden=!isDay;
  document.querySelectorAll(".days a").forEach(a=>{if(a.dataset.d===v)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current")});
  document.querySelectorAll(".tabs a").forEach(a=>{const on=a.dataset.v===v||(isDay&&a.dataset.v==="plan");if(on)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current")});
  if(isDay)document.getElementById("planTab").href="#"+v;
  const D=DAYS.find(d=>d.id===v);
  if(D){const m=initMap(D);if(m)setTimeout(()=>m.map.invalidateSize(),30)}
  if(!opts.keepScroll)window.scrollTo(0,0);
}
function openItem(key,{scroll=true,fly=false}={}){
  const [d,i]=key.split("-");const el=document.getElementById("it-"+key);if(!el)return;
  if(location.hash!=="#"+d){history.replaceState(null,"","#"+d);show(d,{keepScroll:true})}
  el.open=true;if(scroll)setTimeout(()=>el.closest(".stop").scrollIntoView({behavior:"smooth",block:"start"}),60);
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
  const fallback=()=>{const r=document.createRange();const tgt=btn.closest(".pl,.row");const n=tgt&&tgt.querySelector("b");if(n){r.selectNodeContents(n);const s=getSelection();s.removeAllRanges();s.addRange(r)}toast("글자를 선택해 뒀어요. 길게 눌러 복사하세요")};
  try{navigator.clipboard.writeText(text).then(()=>toast("복사했어요: "+text),fallback)}catch(e){fallback()}
}

document.addEventListener("click",e=>{
  const t=e.target.closest("[data-copy],[data-show],[data-fly],[data-open],[data-f],[data-jump],#now,#driverClose");if(!t)return;
  if(t.dataset.copy!==undefined){e.preventDefault();copy(t.dataset.copy,t)}
  else if(t.dataset.show){e.preventDefault();driver(t.dataset.show)}
  else if(t.dataset.fly){const [d,i]=t.dataset.fly.split(":");flyTo(d,+i)}
  else if(t.dataset.open){openItem(t.dataset.open)}
  else if(t.dataset.f){shopF=(shopF===t.dataset.f&&t.dataset.f!=="all")?"all":t.dataset.f;renderShop()}
  else if(t.dataset.jump){e.preventDefault();openItem(t.dataset.jump)}
  else if(t.id==="now"){if(ST&&ST.go)openItem(ST.go.key)}
  else if(t.id==="driverClose")closeDriver();
});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!document.getElementById("driver").hidden)closeDriver()});
document.addEventListener("change",e=>{
  const t=e.target;
  if(t.dataset.got!==undefined){const g=store.get("sh-got",{});g[t.dataset.got]=t.checked;store.set("sh-got",g);
    if(shopF==="left")setTimeout(renderShop,400);else renderShop()}
  if(t.dataset.prep!==undefined){const g=store.get("sh-prep",{});g[t.dataset.prep]=t.checked;store.set("sh-prep",g);renderPrep()}
});
window.addEventListener("hashchange",()=>show(location.hash.slice(1)));

/* ── 시작 ── */
// 머리줄 높이를 재서 탭 줄 · 날짜 줄 · 지도 고정 위치에 쓴다
const topEl=document.querySelector(".top");
const setTop=()=>document.documentElement.style.setProperty("--toph",topEl.offsetHeight+"px");
setTop();try{new ResizeObserver(setTop).observe(topEl)}catch(e){window.addEventListener("resize",setTop)}
renderDays();renderOverview();DAYS.forEach(renderDay);renderShop();renderPrep();
tick();setInterval(tick,30000);
const h=location.hash.slice(1);
show(VIEWS.includes(h)?h:"overview");
</script>

</body></html>
`;
