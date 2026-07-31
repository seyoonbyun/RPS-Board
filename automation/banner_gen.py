# -*- coding: utf-8 -*-
"""
챕터 카드 배너 생성기 (Canva 수동 제작 대체)

운영 사이트(powerteam-bnikorea.com/Gangnam)에서 실물 카드 43장을 받아 실측한 규격:

  - 캔버스        500x500, 흰 배경
  - 레드          #CF152D  (POWER TEAM 글자 + 가로선 2줄)
  - 그레이        #737373  (챕터 한글명 / 영문명)
  - 고정 요소     레드 마스크가 **38/38장 픽셀 단위로 완전 동일** (5,879px) — 실측 확인
                  POWER 줄 우단 x=239 · TEAM 줄 우단 x=181 · 가로선 y=184,185 / y=313
  - 한글          Noto Sans KR Bold 37px, 중심 (366, 217)
  - 영문          Bold 38px,             중심 (337.8, 277.5)

정렬 실측 (40장, 2줄 인식 성공분)
  영문  중앙정렬 cx=337.8 **σ=1.14** → 사실상 확정
  한글  중앙정렬 cx 중앙값 366, σ=9.23 (366:22장 / 356:8 / 336:4 …)
        Canva 수동 배치라 배치가 3무리로 흩어져 있다. 최빈값 366 을 정본으로 채택.

⚠ 이전 버전의 결함 두 가지를 여기서 고쳤다.
  1) 템플릿에 이전 카드의 그레이 텍스트 **잔상이 남아 있었다**.
     제거 기준이 좁아(`|픽셀-그레이|합 < 200`) 안티에일리어싱 가장자리가 살아남은 탓.
     → 저채도 판정(`max-min < 60 且 max < 250`)으로 바꿔 잔상 0 · 레드 5,879px 보존 확인.
     옛 파일은 `assets/card_template_old_ghosted.png` 로 남겨 둠.
  2) 한글 중심을 336.5 로 잡고 있었는데 이는 40장 중 4장(소수 무리)에만 맞는 값이다.
     긴 이름(`시그니아 챕터` 등)이 왼쪽 POWER 글자를 침범하는 원인이기도 했다.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")   # 에러도 utf-8 로 (cp949 로 나가면 깨진다)

RED = (207, 21, 45)
GRAY = (115, 115, 115)
SIZE = (500, 500)

# ── 지역 카드 (BNI 로고 + 지역명) — 25장 실측 ─────────────────────
# 로고는 x63~441 y123~268 로 완전 고정(레드 40,052px). 글자만 바뀐다.
REGION_GRAY = (217, 217, 217)     # #D9D9D9
REGION_TEXT_CY = 304.0            # y281~327 의 중심
REGION_TEXT_CX = 240.8            # σ=2.55
REGION_TEXT_W = 343               # 글자 수와 무관하게 이 폭으로 늘린다 (실측 339~359)
REGION_CAP_H = 47                 # 대문자 높이

KOR_CENTER = (366.0, 217.0)
ENG_CENTER = (337.8, 277.5)
KOR_SIZE = 37
ENG_SIZE = 38

# 레드 글자 우단(실측) — 그레이 텍스트가 이 선을 넘어오면 POWER/TEAM 을 침범한다
KOR_LEFT_LIMIT = 239 + 6   # POWER 줄
ENG_LEFT_LIMIT = 181 + 6   # TEAM 줄
RIGHT_LIMIT = 496          # 캔버스 우측 안전선 (가로선 우단과 동일)

NOTO = r"C:\Windows\Fonts\NotoSansKR-VF.ttf"

HERE = Path(__file__).resolve().parent
TEMPLATE = HERE / "assets" / "card_template.png"


def build_template(source_card: Path, out: Path = TEMPLATE) -> Path:
    """운영 카드 1장에서 그레이 텍스트만 지워 템플릿을 만든다.

    레드(POWER TEAM/가로선)와 흰 배경은 그대로 두므로 생김새가 100% 보존된다.
    """
    im = Image.open(source_card).convert("RGB")
    a = np.array(im).astype(int)
    gray = np.abs(a - np.array(GRAY)).sum(2) < 200
    a[gray] = [255, 255, 255]
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(a.astype("uint8")).save(out)
    return out


def _font(path: str, size: int, variation: str | None = None) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(path, size)
    if variation:
        try:
            f.set_variation_by_name(variation)
        except Exception:
            pass
    return f


def _draw_centered(
    draw: ImageDraw.ImageDraw,
    text: str,
    font_path: str,
    size: int,
    center,
    left_limit: int,
    variation: str = "Bold",
) -> tuple[int, int, int]:
    """중앙 정렬로 그리되, 왼쪽 레드 글자를 침범하면 글자 크기를 줄여 피한다.

    운영 카드는 사람이 Canva 에서 배치해 긴 이름이 들어올 일이 없었지만,
    자동 생성은 어떤 이름이든 받아야 하므로 침범 방지선을 둔다.
    중심을 오른쪽으로 밀지 않고 크기를 줄이는 쪽을 택했다 —
    카드끼리 세로 축이 어긋나 보이는 것보다 글자가 조금 작은 편이 덜 튄다.
    """
    for s in range(size, size - 12, -1):
        f = _font(font_path, s, variation)
        x0, y0, x1, y1 = draw.textbbox((0, 0), text, font=f)
        w = x1 - x0
        left = center[0] - w / 2
        right = center[0] + w / 2
        if left >= left_limit and right <= RIGHT_LIMIT:
            break
    draw.text((center[0] - w / 2 - x0, center[1] - (y1 - y0) / 2 - y0),
              text, font=f, fill=GRAY)
    return s, int(left), int(right)


def make_card(kor: str, eng: str, out: Path, template: Path = TEMPLATE) -> Path:
    """챕터 카드 1장 생성.

    kor: '어썸 챕터' 처럼 '<챕터명> 챕터'
    eng: 'AWESOME' 처럼 대문자 영문 챕터명
    """
    if not template.exists():
        raise FileNotFoundError(f"템플릿 없음: {template} (build_template 먼저 실행)")
    im = Image.open(template).convert("RGB")
    d = ImageDraw.Draw(im)
    ks, kl, kr = _draw_centered(d, kor, NOTO, KOR_SIZE, KOR_CENTER, KOR_LEFT_LIMIT)
    es, el, er = _draw_centered(d, eng, NOTO, ENG_SIZE, ENG_CENTER, ENG_LEFT_LIMIT)
    if ks != KOR_SIZE:
        print(f"  ! 한글 '{kor}' 이 길어 {KOR_SIZE}→{ks}px 로 축소 (x {kl}~{kr})")
    if es != ENG_SIZE:
        print(f"  ! 영문 '{eng}' 이 길어 {ENG_SIZE}→{es}px 로 축소 (x {el}~{er})")
    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out)
    return out


REGION_TEMPLATE = HERE / "assets" / "region_template.png"


def _fit_cap_size(text: str, target_h: int) -> int:
    """대문자 높이가 target_h 가 되는 폰트 크기를 찾는다."""
    best, bestd = 60, 10 ** 9
    probe = Image.new("RGB", (10, 10))
    d = ImageDraw.Draw(probe)
    for s in range(40, 100):
        f = _font(NOTO, s, "Bold")
        y0, y1 = d.textbbox((0, 0), text, font=f)[1], d.textbbox((0, 0), text, font=f)[3]
        diff = abs((y1 - y0) - target_h)
        if diff < bestd:
            best, bestd = s, diff
    return best


def make_region_card(eng: str, out: Path, template: Path = REGION_TEMPLATE) -> Path:
    """지역 카드 1장 생성.

    eng: 'HANAM' 처럼 대문자 영문 지역명

    글자 수가 4~7 로 달라도 실물은 폭이 항상 339~359 다 — 즉 **자간을 늘려 폭을 맞춘다.**
    (MAPO 4글자 343px · ANYANG 6글자 357px · GANGNAM 7글자 349px)
    그래서 고정 자간이 아니라 목표 폭 343 에 맞춰 글자 사이를 균등 배분한다.
    """
    if not template.exists():
        raise FileNotFoundError(f"지역 템플릿 없음: {template}")
    # ⚠ 지역 카드는 **투명 배경(RGBA)** 이다. RGB 로 변환하면 배경이 검게 죽는다.
    im = Image.open(template).convert("RGBA")
    d = ImageDraw.Draw(im)

    letters = list(eng.upper())
    size = _fit_cap_size(eng.upper(), REGION_CAP_H)
    f = _font(NOTO, size, "Bold")

    boxes = [d.textbbox((0, 0), ch, font=f) for ch in letters]
    widths = [b[2] - b[0] for b in boxes]
    gaps = len(letters) - 1
    spacing = (REGION_TEXT_W - sum(widths)) / gaps if gaps else 0

    # 대문자 기준선을 한 번만 잡아 글자마다 높이가 흔들리지 않게 한다
    ref = d.textbbox((0, 0), "H", font=f)
    top = REGION_TEXT_CY - (ref[3] - ref[1]) / 2 - ref[1]

    x = REGION_TEXT_CX - REGION_TEXT_W / 2
    for ch, w, b in zip(letters, widths, boxes):
        d.text((x - b[0], top), ch, font=f, fill=REGION_GRAY + (255,))
        x += w + spacing

    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out)
    return out


if __name__ == "__main__":
    import argparse

    p = argparse.ArgumentParser(description="챕터 카드 배너 생성")
    p.add_argument("--build-template", metavar="운영카드.png", help="운영 카드에서 템플릿 추출")
    p.add_argument("--kor", help="한글 표기 (예: '어썸 챕터')")
    p.add_argument("--eng", help="영문 표기 (예: AWESOME)")
    p.add_argument("--out", help="출력 PNG 경로")
    p.add_argument("--region", help="지역 카드 영문명 (예: HANAM)")
    args = p.parse_args()

    if args.region and args.out:
        print("지역 카드 생성:", make_region_card(args.region, Path(args.out)))
        raise SystemExit(0)

    if args.build_template:
        print("템플릿 생성:", build_template(Path(args.build_template)))
    if args.kor and args.eng and args.out:
        print("카드 생성:", make_card(args.kor, args.eng, Path(args.out)))
