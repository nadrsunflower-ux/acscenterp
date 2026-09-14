#!/usr/bin/env python3
# ============================================================
#  공식 상품 사진 → 화면 크기 파생본
# ------------------------------------------------------------
#  원본은 장당 1.5~2.4MB 다. 40px 썸네일에 그대로 쓰면 상품 목록 한 번에
#  40MB 를 받는다. next/image 는 이 저장소에서 unoptimized 라 런타임 최적화가
#  없으므로, 미리 줄여 둔다 (fragrance-v1 의 `-128.webp` 규칙과 같다).
#
#  ⚠️ 원본은 지우지 않는다. 출처·해시가 manifest.json 에 기록돼 있고,
#     사진 내부를 변형하지 않았다는 근거가 원본이다. 파생본은 크기만 줄인
#     것이고 잘라내지 않는다 (contain).
#
#  실행: python3 scripts/neander/make-official-derivatives.py
#  필요: Pillow (webp 지원)
# ============================================================
import json, os, pathlib
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "public/neander/assets/acscent-official/images"
OUT = ROOT / "public/neander/assets/acscent-official/derived"
SEL = ROOT / "output/design-assets/acscent-official/selection.json"

# 목록 40~64px(2x = 128) · 카드/상세 128~160px(2x = 320)
SIZES = [128, 320]

# 화면이 실제로 쓰는 파일만 줄인다 (product-image.ts 와 같은 목록)
USED = [
    "0e527b2b-perfume-10ml-01.png",
    "16f8a5b1-perfume-50ml-01.png",
    "2a6bdff1-chemistry-10ml-set-square.png",
    "983c045e-chemistry-50ml-set-square.png",
    "7909492f-1780672690139_c69j01.png",
    "83c34def-1780674676242_5yl7hc.png",
    "3b88fae5-1780671700412_aet6f6.png",
    "4097994a-1777901298869_cp1pkk.png",
    "65e03a8a-scent-paper-hand-light-01.png",
]

def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    total_before = total_after = 0
    for name in USED:
        src = SRC / name
        if not src.exists():
            raise SystemExit(f"원본이 없습니다: {src}")
        total_before += src.stat().st_size
        im = Image.open(src).convert("RGBA")
        # 사진 뒤가 비어 있으면 흰 종이를 깐다 — 화면 바탕이 흰색이라
        # 투명 그대로 둬도 같아 보이지만, webp 로 줄일 때 가장자리가 깨끗하다
        flat = Image.new("RGBA", im.size, (255, 255, 255, 255))
        flat.alpha_composite(im)
        for px in SIZES:
            d = flat.copy()
            d.thumbnail((px, px), Image.LANCZOS)
            dst = OUT / f"{src.stem}-{px}.webp"
            d.convert("RGB").save(dst, "WEBP", quality=82, method=6)
            total_after += dst.stat().st_size
    print(f"원본 {total_before/1e6:.1f}MB → 파생본 {total_after/1e6:.2f}MB ({len(USED)}장 × {len(SIZES)}크기)")

if __name__ == "__main__":
    main()
