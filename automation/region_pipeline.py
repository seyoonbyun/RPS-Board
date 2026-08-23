# -*- coding: utf-8 -*-
r"""신규 **지역** 등록 파이프라인 — 챕터 런칭과 무관하게 지역 하나를 끝까지.

    python region_pipeline.py --eng Suwon2 --kor 수원2 --apply

단계
    [1] 구글시트  `<Eng> <Kor> All_rps` 생성                 sheet_gen.py
    [2] RPI       `지역 RPI` 탭에 행 추가                     rpi_sheet.py --add-region
    [3] QR        bitly 단축링크 + 브랜드 QR                  qr_gen.py
    [4] 배너      BNI 지역 로고 500×500                       banner_gen.py
    [5] imweb     `<Kor> ALL` 페이지 + `<Kor>` 지역 페이지     imweb_client.py
    [6] 검증      만든 것을 전부 재조회해 대조
    [7] 비번      볼트 대장에 4자리 기록                       99. Private/rpi page pw/

왜 따로 있는가
    `pipeline.py` 는 **신규 챕터의 지역**일 때만 지역 페이지를 만든다. 그래서 파이프라인
    이전에 런칭한 안양이 `지역 RPI` 에 넉 달간 없었다(2026-08-18 수동 등록).
    어드민에서 지역만 등록하는 길이 없으면 같은 구멍이 계속 난다.

⚠ **게시(publish)는 하지 않는다.** 사람이 편집기에서 보고 누르는 것이 마지막 관문이다.
⚠ **지역 페이지는 화성 페이지를 복제**해서 만든다. 원본의 챕터 카드가 따라올 수 있어
   [6] 이 카드 수를 세어 보고한다. **지우지는 않는다** — 갤러리 삭제 API 를 모르는 채
   추측해서 호출하면 남의 페이지를 건드릴 수 있다.
⚠ 신규 지역은 `_source` 에 멤버가 아직 없어 [2] 가 **정상적으로 보류**된다(RPI 0 방지).
   멤버가 모 시트에 들어온 뒤 `python rpi_sheet.py --add-region "<표기>" --apply` 로 마무리한다.
⚠ imweb 쓰기는 되돌리기 API 가 없다. 시작할 때 `menu_list` 스냅샷을 남긴다.
"""
from __future__ import annotations

import argparse
import json
import random
import re
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent))

import paths                                              # noqa: E402
from imweb_client import (ImwebClient, ImwebError,         # noqa: E402
                          ensure_login)
from pipeline import TEMPLATE_ALL, TEMPLATE_REGION, qr_png_2000   # noqa: E402

HERE = Path(__file__).resolve().parent
OUT = paths.out_dir()
SNAP = paths.snap_dir()
PW_VAULT = Path(r"C:\SEYOON\99. Private\rpi page pw")


@dataclass
class RegionPlan:
    eng: str                       # Suwon2      — url · sub_name · 시트/QR 슬러그
    kor: str                       # 수원2        — imweb 페이지 표시명
    master: str                    # Suwon2 수원2 — 모 시트 표기(권위). 탭명·A3 WHERE 값
    pw: str                        # 4자리
    apply: bool = False
    headful: bool = False
    result: dict = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)

    @property
    def all_page_name(self) -> str:
        return f"{self.kor} ALL"


def log(msg: str) -> None:
    print(msg, flush=True)


def run(script: str, *args: str) -> str:
    cmd = [sys.executable, str(HERE / script), *args]
    log(f"    $ {script} {' '.join(args)}")
    p = subprocess.run(cmd, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if p.returncode != 0:
        raise RuntimeError(f"{script} 실패:\n{(p.stdout or '')[-900:]}\n{(p.stderr or '')[-900:]}")
    return p.stdout or ""


# ---------------------------------------------------------------- 단계

def step_sheet(p: RegionPlan) -> None:
    log(f"[1] 구글시트 {p.master} All_rps")
    args = ["--region", p.eng, "--kor", p.kor, "--master", p.master]
    if p.apply:
        args.append("--apply")
    out = run("sheet_gen.py", *args)
    m = re.search(r"(https://docs\.google\.com/spreadsheets/d/\S+)", out)
    if m:
        p.result["sheet"] = m.group(1)
        log(f"    ✓ {m.group(1)}")
    elif p.apply:
        raise RuntimeError("시트 URL 을 못 받았다 — sheet_gen 출력 확인")


def step_rpi(p: RegionPlan) -> None:
    """[2] `지역 RPI` 행. 실패해도 전체를 죽이지 않는다 — 나중에 단독 재실행이 된다."""
    log("[2] RPI 집계 시트")
    if not p.apply:
        log(f"    $ rpi_sheet.py --add-region '{p.master}'  (dry-run)")
        return
    try:
        out = run("rpi_sheet.py", "--add-region", p.master, "--apply", "--allow-skip")
        blocked = f"'{p.master}'" in out and "_source 매칭 없음" in out
        if blocked:
            p.result["rpi"] = "보류 — _source 에 멤버 없음"
            p.notes.append(
                f"[2] RPI 행 보류 — `_source` 에 `{p.master}` 멤버가 아직 없다(정상). "
                f"멤버 등록 후 `python rpi_sheet.py --add-region \"{p.master}\" --apply`")
            log("    ⏸ 보류 — 멤버가 아직 없다 (RPI 0 이 박히는 것을 막은 것)")
        else:
            p.result["rpi"] = "행 추가"
            log("    ✓ 행 추가")
    except RuntimeError as e:
        p.result["rpi"] = "실패(수동 재실행 필요)"
        p.notes.append(f"[2] RPI 실패 — {str(e).splitlines()[0]}")
        log(f"    ⚠ 건너뜀 — {str(e).splitlines()[0]}")


def step_qr(p: RegionPlan) -> None:
    log("[3] bitly 링크·QR")
    url = p.result.get("sheet")
    if not url:
        log("    (건너뜀: 시트 URL 미확보)")
        return
    args = ["--region", p.eng, "--url", url]
    if p.apply:
        args.append("--apply")
    out = run("qr_gen.py", *args)
    m = re.search(r"✓ QR (\S+)", out)
    if m:
        p.result["qrcode_id"] = m.group(1)
        log(f"    ✓ QR {m.group(1)}")
    m2 = re.search(r"(https://bnikorea\.co/\S+)", out)
    if m2:
        p.result["short_link"] = m2.group(1)


def step_banner(p: RegionPlan) -> None:
    log("[4] 지역 로고")
    logo = OUT / f"{p.eng}All" / f"region_{p.eng.lower()}_500.png"
    run("banner_gen.py", "--region", p.eng.upper(), "--out", str(logo))
    p.result["logo"] = str(logo)
    log(f"    ✓ {logo.name}")


def step_imweb(p: RegionPlan, im: ImwebClient) -> None:
    log("[5] imweb 페이지")
    if not p.apply:
        log(f"    (dry-run) `{p.all_page_name}` + `{p.kor}` (/{p.eng}) 를 만들 예정")
        return

    snap = im.snapshot(SNAP / f"imweb_menu_{datetime.now():%Y%m%d_%H%M%S}.json")
    log(f"    스냅샷 {snap.name}")

    # --- ALL 페이지 (비번 보호 · 본문 = QR + 시트 링크)
    tpl = im.find_by_name(TEMPLATE_ALL)
    if not tpl:
        raise ImwebError(f"복제 원본을 못 찾았다: {TEMPLATE_ALL}")
    all_code = im.copy_page(tpl["code"], "foot")
    im.edit_page(all_code, name=p.all_page_name, password=p.pw)
    im.set_chapter_content(all_code, Path(p.result["qr_png"]), p.result["sheet"])
    p.result["all_page"] = all_code
    log(f"    ✓ {p.all_page_name} ({all_code}) · PW 설정됨")

    # --- 지역 페이지 (내비게이션 · 카드 그리드)
    tpl_r = im.find_by_name(TEMPLATE_REGION)
    if not tpl_r:
        raise ImwebError(f"복제 원본을 못 찾았다: {TEMPLATE_REGION}")
    region_code = im.copy_page(tpl_r["code"], "main")
    # ⚠ `sub_name` 을 반드시 같이 준다. 안 주면 원본 값이 그대로 따라온다 —
    #   하남이 `Hwaseong` 인 채로 넉 달을 갔다(2026-08-18 교정).
    im.edit_page(region_code, name=p.kor, url=p.eng, sub_name=p.eng)
    im.set_region_logos(region_code, Path(p.result["logo"]), all_code, p.kor)
    p.result["region_page"] = region_code
    log(f"    ✓ {p.kor} (/{p.eng}) · sub_name={p.eng}")


def step_verify(p: RegionPlan, im: ImwebClient) -> dict:
    log("[6] 검증")
    report = {"ok": True, "checks": []}

    def check(name: str, cond: bool, detail: str = "") -> None:
        report["checks"].append({"name": name, "ok": bool(cond), "detail": detail})
        if not cond:
            report["ok"] = False
        log(f"    {'✅' if cond else '❌'} {name} {detail}")

    if not p.apply:
        log("    (dry-run — 검증할 대상이 없다)")
        return report

    ml = im.menu_list()
    for key, name in [("all_page", p.all_page_name), ("region_page", p.kor)]:
        code = p.result.get(key)
        if not code:
            continue
        m = ml.get(code)
        check(f"{name} 존재", bool(m), f"url={m['url']}" if m else "")
        if m:
            p.result[f"{key}_url"] = m["url"]
    if p.result.get("all_page"):
        check("ALL 페이지 비밀번호", bool(ml[p.result["all_page"]].get("password")))
        from imweb_client import _sheet_id
        text = im.visual_section(p.result["all_page"])[1]["data"]["slide_data"][0]["text"]
        check("ALL 시트 링크", _sheet_id(p.result["sheet"]) in text)
    if p.result.get("region_page"):
        rp = ml[p.result["region_page"]]
        check("지역 url 영문", not str(rp.get("url", "")).isdigit(), f"url={rp.get('url')}")
        check("지역 sub_name", str(rp.get("sub_name") or "") == p.eng,
              f"sub_name={rp.get('sub_name')!r}")
        # 복제 잔재 — 원본(화성)의 챕터 카드가 따라왔을 수 있다. 세기만 하고 지우지 않는다.
        try:
            left = len(im.gallery_items(im.gallery_board(p.result["region_page"])))
        except Exception:                                     # noqa: BLE001
            left = -1
        if left > 0:
            p.notes.append(f"[6] 지역 페이지에 복제 원본({TEMPLATE_REGION})의 챕터 카드 "
                           f"{left}개가 남아 있다 — **게시 전에 편집기에서 삭제**할 것")
            log(f"    ⚠ 복제 카드 {left}개 잔존 — 게시 전 수동 삭제 필요")
        elif left == 0:
            log("    ✅ 복제 카드 잔존 없음")
    return report


def step_pw_note(p: RegionPlan) -> None:
    """[7] 비번을 볼트 대장에 남긴다.

    ⛔ imweb 은 비번을 bcrypt 로 저장해 **관리자 API 로도 평문을 되읽을 수 없다.**
       설정 즉시 적어 두지 않으면 영영 모른다 — 실제로 지역 5개가 그렇게 유실됐다.
    """
    log("[7] 비번 기록")
    note = PW_VAULT / f"지역 {p.master}.md"
    if not p.apply:
        log(f"    (dry-run) {note.name} · pw {p.pw}")
        return
    if note.exists():
        p.notes.append(f"[7] 비번 노트가 이미 있다 — 덮어쓰지 않았다: {note.name}")
        log(f"    ⚠ 이미 있음 — 덮어쓰지 않는다 ({note.name})")
        return
    PW_VAULT.mkdir(parents=True, exist_ok=True)
    today = f"{datetime.now():%Y-%m-%d}"
    note.write_text(
        "---\n"
        "구분: 지역\n"
        f"지역: {p.master}\n"
        '챕터: ""\n'
        f"pw: {p.pw}\n"
        f"pw출처: {today} 신규 등록 자동 생성(랜덤 4자리)\n"
        "pw검증: 확정\n"
        "상태: 운영\n"
        '런칭일: ""\n'
        f"imweb페이지: /{p.eng}\n"
        f"imweb표기: {p.all_page_name}\n"
        "imweb잠금: Y\n"
        f"링크: {p.result.get('short_link', '')}\n"
        f"갱신: {today}\n"
        "tags:\n  - rpi-pw\n  - 지역\n"
        "---\n\n"
        f"imweb 지역 ALL 페이지 — `{p.master}`\n\n"
        "- 비번 룰: **지역 = 랜덤 4자리**\n"
        "- 정본은 노션 [MyPowerTeam RPI Viewer]"
        "(https://www.notion.so/seyoonbyun/MyPowerTeam-RPI-Viewer-52064f13aebd48e688bf48337c11ba3f)"
        " — 이 노트는 **사본**이다.\n\n"
        f"✅ **{today} 신규 지역 등록 자동화로 생성.**\n"
        "⛔ **노션 `MyPowerTeam RPI Viewer` 에는 아직 등재 전이다.**\n",
        encoding="utf-8")
    p.notes.append("[7] 노션 `MyPowerTeam RPI Viewer` 등재는 **아직** — 사람이 해야 한다")
    log(f"    ✓ {note.name}")


# ---------------------------------------------------------------- main

def run_region(p: RegionPlan) -> dict:
    """단계를 순서대로. 리포트 dict 를 돌려준다(워커가 대장에 옮겨 적는다)."""
    with ImwebClient(headless=not p.headful) as im:
        # 세션이 끊겼으면 자격증명 파일로 **스스로 한 번** 붙어 본다.
        # 실패하면(파일 없음·비번 틀림·캡차) 사람에게 넘긴다 — 재시도는 쿨다운이 막는다.
        if not ensure_login(im):
            raise SystemExit("imweb 로그인 안 됨 →  python imweb_client.py --auto-login "
                             "(자격증명 파일) 또는 --login (창 띄워 직접)")
        if im.find_by_name(p.kor):
            raise SystemExit(f"imweb 에 `{p.kor}` 페이지가 이미 있다 — 신규 지역이 아니다.\n"
                             "  표기만 다른 기존 지역은 아닌지 확인하세요 (예: `수원1` ↔ imweb `수원`).")
        if im.find_by_name(p.all_page_name):
            raise SystemExit(f"imweb 에 `{p.all_page_name}` 페이지가 이미 있다.")

        step_sheet(p)
        step_rpi(p)
        step_qr(p)
        step_banner(p)

        qid = p.result.get("qrcode_id")
        if qid and p.apply:
            png = OUT / f"{p.eng}All" / "qr_region_2000.png"
            p.result["qr_png"] = str(qr_png_2000(qid, png, im._ctx))
            log(f"    QR 2000px {png.name}")
        if p.apply and not p.result.get("qr_png"):
            raise RuntimeError("QR PNG 가 없다 — imweb 본문을 채울 수 없다")

        step_imweb(p, im)
        report = step_verify(p, im)

    step_pw_note(p)

    out = {"plan": {"eng": p.eng, "kor": p.kor, "master": p.master,
                    "pw": p.pw, "apply": p.apply, **{k: str(v) for k, v in p.result.items()}},
           "report": report, "notes": p.notes}
    if p.apply:
        SNAP.mkdir(parents=True, exist_ok=True)
        f = SNAP / f"region_{p.eng}_{datetime.now():%Y%m%d_%H%M%S}.json"
        f.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
        out["report_path"] = str(f)
        log(f"\n리포트 {f}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="신규 지역 등록 파이프라인")
    ap.add_argument("--eng", required=True, help="지역 영문명 (imweb url·sub_name, 예 Suwon2)")
    ap.add_argument("--kor", required=True, help="지역 한글명 (imweb 페이지 표시명, 예 수원2)")
    ap.add_argument("--master", help="모 시트 표기 (기본 '<Eng> <Kor>')")
    ap.add_argument("--pw", help="지역 페이지 비밀번호 4자리 (생략 시 랜덤)")
    ap.add_argument("--apply", action="store_true", help="실제 생성 (게시는 안 한다)")
    ap.add_argument("--headful", action="store_true", help="브라우저 창을 띄운다")
    a = ap.parse_args()

    pw = (a.pw or "").strip() or f"{random.randint(0, 9999):04d}"
    if not re.fullmatch(r"\d{4}", pw):
        raise SystemExit(f"비밀번호는 숫자 4자리여야 한다: {pw!r}")

    p = RegionPlan(a.eng.strip(), a.kor.strip(),
                   (a.master or f"{a.eng.strip()} {a.kor.strip()}").strip(),
                   pw, a.apply, a.headful)
    log(f"{'실행' if a.apply else 'DRY-RUN'} · 신규 지역 {p.master} "
        f"· imweb `{p.kor}` (/{p.eng}) · PW {p.pw}\n")

    out = run_region(p)
    if p.notes:
        log("\n남은 것 / 확인할 것")
        for n in p.notes:
            log(f"  - {n}")
    if not a.apply:
        log("\n(dry-run — 아무것도 만들지 않았다. --apply 를 붙일 것)")
    return 0 if out["report"]["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
