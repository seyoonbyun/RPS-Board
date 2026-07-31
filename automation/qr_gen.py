# -*- coding: utf-8 -*-
"""
[04] bitly 단축링크 + 브랜드 QR 생성

운영 중인 RPI 링크 180건 · QR 24개를 조회해 얻은 규격:

  슬러그   챕터 `RPI_<영문챕터명>`   지역 `RPI_<영문지역>All`
           (`RPI_Omega`, `RPI_Episode`, `RPI_ALPHA` / `RPI_AnyangAll`, `RPI_DaejeonAll`)
           ⚠ 공백은 뺀다 — `ONLY ONE` 챕터의 슬러그는 `RPI_ONLYONE`.
              단 QR **제목**은 공백을 살린다(`RPI_ONLY ONE`, `RPI_Anyang All`).
  long_url 해당 챕터/지역의 구글 스프레드시트 URL
  QR       배경 #ffffff · 도트 #000000 · 코너 leaf_inner #000000 · 로고 Io51njATLr9
           bitly_brand=false

⚠ 기존 24개는 수동 제작이라 **도트 모양만 제각각**이다
  (standard 17 / rounded 3 / blob 2 / horizontal 2 — 최근 5건도 rounded·blob·standard 혼재).
  나머지 색·코너·로고는 24개 전부 동일. 여기서는 **다수결 `standard` 를 정본으로 고정**한다.

사용법
    python qr_gen.py --list                                   # 기존 RPI 링크·QR 조회
    python qr_gen.py --chapter Signia --url <시트URL>          # dry-run (기본)
    python qr_gen.py --chapter Signia --url <시트URL> --apply
    python qr_gen.py --region Hanam  --url <시트URL> --apply
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import requests

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")   # 에러도 utf-8 로 (cp949 로 나가면 깨진다)

TOKEN_FILE = Path(r"C:\Users\Gram\desktop\connect_tl_report\connect\bitly_token.txt")
GROUP_GUID = "Bo3tcZSUnEl"
DOMAIN = "bnikorea.co"
API = "https://api-ssl.bitly.com/v4"

DOT_PATTERN = "standard"   # 정본 (다수결 17/24)
LOGO_GUID = "Io51njATLr9"  # 정본 (다수결 18/24)
BLACK, WHITE = "#000000", "#ffffff"


def _token() -> str:
    return TOKEN_FILE.read_text(encoding="utf-8").split(":", 1)[1].strip()


def _headers() -> dict:
    return {"Authorization": f"Bearer {_token()}", "Content-Type": "application/json"}


def _corner() -> dict:
    return {"inner_color": BLACK, "outer_color": BLACK, "shape": "leaf_inner"}


def render_customizations() -> dict:
    return {
        "background_color": WHITE,
        "dot_pattern_color": BLACK,
        "dot_pattern_type": DOT_PATTERN,
        "corners": {"corner_1": _corner(), "corner_2": _corner(), "corner_3": _corner()},
        "logo": {"crop": {"w": 0, "h": 0, "x": 0, "y": 0},
                 "crop_type": "rectangle", "image_guid": LOGO_GUID},
        "branding": {"bitly_brand": False},
        "spec_settings": {"version": 0, "error_correction": 0, "mask": 0},
    }


def plan(kind: str, eng: str, url: str) -> dict:
    """슬러그는 공백 제거, QR 제목은 공백 유지."""
    if kind == "chapter":
        slug, title = f"RPI_{eng.replace(' ', '')}", f"RPI_{eng}"
    else:
        slug, title = f"RPI_{eng.replace(' ', '')}All", f"RPI_{eng} All"
    return {"slug": slug, "title": title, "bitlink": f"{DOMAIN}/{slug}", "url": url}


def exists(slug: str) -> dict | None:
    r = requests.get(f"{API}/bitlinks/{DOMAIN}/{slug}", headers=_headers(), timeout=30)
    return r.json() if r.status_code == 200 else None


def create(kind: str, eng: str, url: str, apply: bool = False) -> dict:
    p = plan(kind, eng, url)
    print(f"[{'실행' if apply else 'DRY-RUN'}] {kind}  {eng}")
    print(f"  단축링크 : https://{p['bitlink']}")
    print(f"  QR 제목  : {p['title']}")
    print(f"  연결대상 : {url[:76]}")
    print(f"  QR 규격  : 도트 {DOT_PATTERN}/{BLACK} · 배경 {WHITE} · 코너 leaf_inner · 로고 {LOGO_GUID}")

    dup = exists(p["slug"])
    if dup:
        print(f"\n  ⚠ 이미 존재: https://{p['bitlink']}  →  {dup.get('long_url','')[:70]}")
        p["existing"] = dup
        if apply:
            raise SystemExit("중복 슬러그 — 중단합니다.")
    if not apply:
        print("\n  → --apply 를 붙여야 실제로 만들어집니다.")
        return p

    r = requests.post(
        f"{API}/bitlinks", headers=_headers(), timeout=30,
        json={"long_url": url, "domain": DOMAIN, "group_guid": GROUP_GUID,
              "custom_bitlinks": [], "title": p["title"]},
    )
    if r.status_code not in (200, 201):
        raise SystemExit(f"단축링크 생성 실패 {r.status_code}: {r.text[:300]}")
    generated = r.json()["id"]

    # 커스텀 슬러그는 POST (PATCH 는 405 Method Not Allowed)
    rr = requests.post(
        f"{API}/custom_bitlinks", headers=_headers(), timeout=30,
        json={"custom_bitlink": f"{DOMAIN}/{p['slug']}", "bitlink_id": generated},
    )
    if rr.status_code not in (200, 201):
        print(f"  ! 커스텀 슬러그 지정 실패 {rr.status_code}: {rr.text[:200]}")
        print(f"    자동 생성 링크로 진행: {generated}")
        p["bitlink"] = generated
    print(f"  ✓ 단축링크 {p['bitlink']}")

    # 생성은 `destination` 을 요구한다 (조회 응답의 bitlink_id 를 그대로 보내면 400
    # INVALID_ARG_MISSING_DESTINATION)
    q = requests.post(
        f"{API}/qr-codes", headers=_headers(), timeout=30,
        json={"group_guid": GROUP_GUID, "title": p["title"],
              "destination": {"bitlink_id": p["bitlink"]},
              "render_customizations": render_customizations()},
    )
    if q.status_code not in (200, 201):
        raise SystemExit(f"QR 생성 실패 {q.status_code}: {q.text[:300]}")
    qd = q.json()
    p["qrcode_id"] = qd.get("qrcode_id")
    print(f"  ✓ QR {p['qrcode_id']}")
    return p


def show_list() -> None:
    h = _headers()
    links, page = [], 1
    while page <= 3:
        r = requests.get(f"{API}/groups/{GROUP_GUID}/bitlinks",
                         headers=h, params={"size": 100, "page": page}, timeout=30)
        if r.status_code != 200:
            break
        b = r.json().get("links", [])
        if not b:
            break
        links += b
        page += 1
    rpi = [L for L in links if "RPI" in L.get("id", "")]
    q = requests.get(f"{API}/groups/{GROUP_GUID}/qr-codes", headers=h, timeout=30).json()
    qrs = [x for x in q.get("qr_codes", []) if "RPI" in (x.get("title") or "")]
    print(f"RPI 단축링크 {len(rpi)}건 / RPI QR {len(qrs)}개")
    for x in qrs[:10]:
        print(f"  {x.get('qrcode_id'):18} {x.get('title')}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="[04] bitly 단축링크 + QR 생성")
    ap.add_argument("--list", action="store_true", help="기존 RPI 링크·QR 조회")
    ap.add_argument("--chapter", metavar="ENG", help="챕터 영문명")
    ap.add_argument("--region", metavar="ENG", help="지역 영문명")
    ap.add_argument("--url", help="연결할 구글시트 URL")
    ap.add_argument("--apply", action="store_true", help="실제 생성 (미지정 시 dry-run)")
    a = ap.parse_args()

    if a.list:
        show_list()
    elif a.chapter or a.region:
        if not a.url:
            raise SystemExit("--url 필요")
        create("chapter" if a.chapter else "region", a.chapter or a.region, a.url, a.apply)
    else:
        ap.print_help()
