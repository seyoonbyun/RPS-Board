# -*- coding: utf-8 -*-
"""신규 챕터(·지역) 런칭 파이프라인 — 신청 1건을 처음부터 끝까지.

    python pipeline.py --chapter Signia --kor 시그니아 --region Hanam --region-kor 하남 \
                       --launch 2026-07-28 --xls "<데이터베이스 추출.xls>"
    (--apply 없으면 dry-run: 무엇을 할지만 찍고 아무것도 만들지 않는다)

단계
    [1] 멤버 명단  BNI Connect 추출 → 모 시트 RPS 탭 append      roster_gen.py
    [2] 구글 시트  `<Eng>_rps` (신규 지역이면 `<Eng> <Kor> All_rps` 도)  sheet_gen.py
    [3] QR        bitly 단축링크 + 브랜드 QR                     qr_gen.py
    [4] 배너      챕터 카드 (신규 지역이면 BNI 지역 로고도)        banner_gen.py
    [5] imweb     페이지 복제 → 이름·PW·QR·링크·카드 → 노션 비번 등재  imweb_client.py
    [6] 검증      만든 것을 전부 재조회해 대조

⚠ **게시(publish)는 하지 않는다.** 사람이 편집기에서 눈으로 보고 누르는 것이 마지막 관문이다.
   게시 전까지 공개 사이트는 404 라 대외 노출이 없다.

⚠ imweb 쓰기는 되돌리기 API 가 없다. 시작할 때 menu_list 스냅샷을 남긴다.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")   # 에러도 utf-8 로 (cp949 로 나가면 깨진다)

sys.path.insert(0, str(Path(__file__).resolve().parent))

import paths                                            # noqa: E402
from imweb_client import RPI_MENU, ImwebClient, ImwebError, SITE   # noqa: E402
from notify import Reporter                              # noqa: E402

HERE = Path(__file__).resolve().parent
OUT = paths.out_dir()
SNAP = paths.snap_dir()

# 복제 원본 — 결함 없는 페이지를 골라 고정한다.
# ⚠ 안양을 쓰면 안 된다: 두 번째 로고가 BNI HWASEONG 이미지·링크 그대로다.
TEMPLATE_CHAPTER = "106 온리원"     # 챕터 페이지
TEMPLATE_ALL = "안양 ALL"           # 지역 ALL 페이지 (본문이 QR 하나뿐이라 결함 무관)
TEMPLATE_REGION = "화성"            # 지역 페이지 (카드 그리드) — 전수 스캔에서 깨끗

BITLY_TOKEN = Path(r"C:\Users\Gram\desktop\connect_tl_report\connect\bitly_token.txt")


@dataclass
class Plan:
    chapter_eng: str
    chapter_kor: str
    region_eng: str
    region_kor: str
    launch: str                      # YYYY-MM-DD
    xls: Path | None = None
    apply: bool = False
    headful: bool = False
    new_region: bool = False
    steps: list[str] = field(default_factory=list)
    result: dict = field(default_factory=dict)

    @property
    def chapter_pw(self) -> str:
        """챕터 시트·페이지 PW = 런칭일 MMDD (91건 전수 검증)."""
        return datetime.strptime(self.launch, "%Y-%m-%d").strftime("%m%d")

    @property
    def chapter_page_name(self) -> str:
        return f"{self.result['chapter_no']} {self.chapter_kor}"

    @property
    def all_page_name(self) -> str:
        return f"{self.region_kor} ALL"


def log(msg: str) -> None:
    print(msg, flush=True)


def run(script: str, *args: str) -> str:
    """기존 단계 스크립트를 그대로 재사용한다."""
    cmd = [sys.executable, str(HERE / script), *args]
    log(f"    $ {script} {' '.join(args)}")
    # errors="replace": 하위 스크립트가 cp949 로 뱉는 줄이 섞이면 디코드가 터진다.
    # 실패 원인을 보여줘야 할 자리에서 그것 때문에 죽으면 안 된다.
    p = subprocess.run(cmd, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if p.returncode != 0:
        raise RuntimeError(f"{script} 실패:\n{(p.stdout or '')[-800:]}\n{(p.stderr or '')[-800:]}")
    return p.stdout or ""


# ---------------------------------------------------------------- [1] BNI Connect

CONNECT_DIR = Path(r"C:\Users\Gram\desktop\connect_tl_report\connect")
DOWNLOAD_PY = Path(r"C:\Users\Gram\.claude\skills\bni-connect-download\download.py")
MASTER_ID = "1JM37uOEu64D0r6zzKggOsA9ZdcK4wBCx0rpuNoVcIYg"   # MY PowerTeam (archive)


def download_connect_extract(region_kor: str, dest: Path, headless: bool = True) -> Path:
    """BNI Connect `리포트 > 지역 > 지역 오피스 > 데이터베이스 추출` 을 받아 온다 (노트 01).

    ⚠ '챕터 멤버 현황 리포트'로는 안 된다 — **이메일·산업군이 없어** 10개 항목 중 2개를 못 채운다.
    기존 스킬 `bni-connect-download` 가 같은 경로를 이미 자동화해 두었으므로 그걸 부른다.

    ⚠ 그 스킬의 `--only` 는 `regions.txt` 에 있는 지역만 필터링한다.
       **신규 지역은 그 목록에 없다**(하남도 없었다) → 임시 목록 파일을 만들어 넘긴다.
       지역 매칭은 드롭다운 anchor title 부분일치라 한글명 한 줄이면 `Hanam 하남` 이 잡힌다.
    """
    if not DOWNLOAD_PY.exists():
        raise RuntimeError(f"다운로드 스킬이 없다: {DOWNLOAD_PY}")

    dest.mkdir(parents=True, exist_ok=True)
    tmp_regions = dest / "_regions.txt"
    tmp_regions.write_text(f"{region_kor}\n", encoding="utf-8")

    before = {p for p in dest.glob("*.xls*")}
    log(f"    BNI Connect 데이터베이스 추출 내려받는 중… ({region_kor})")
    cmd = [sys.executable, str(DOWNLOAD_PY),
           "--regions", str(tmp_regions), "--output", str(dest), "--creds",
           str(CONNECT_DIR / "BNI Connect_login ID PW.txt")]
    if headless:
        cmd.append("--headless")
    r = subprocess.run(cmd, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    tmp_regions.unlink(missing_ok=True)

    new = sorted({p for p in dest.glob("*.xls*")} - before,
                 key=lambda p: p.stat().st_mtime, reverse=True)
    if not new:
        tail = ((r.stdout or "") + (r.stderr or ""))[-800:]
        raise RuntimeError(f"추출 파일을 받지 못했다 (지역 표기가 드롭다운과 다를 수 있다)\n{tail}")
    log(f"    받음: {new[0].name}")
    return new[0]


def master_chapters(region_label: str) -> set[str]:
    """모 시트 RPS 탭에서 해당 지역의 **기존** 챕터 집합 (B=지역, C=챕터)."""
    from google_auth import sa_services
    _, sheets = sa_services()
    v = sheets.spreadsheets().values().get(
        spreadsheetId=MASTER_ID, range="RPS!B2:C").execute().get("values", [])
    out = set()
    for row in v:
        if len(row) >= 2 and row[0].strip() == region_label.strip():
            if row[1].strip():
                out.add(row[1].strip())
    return out


def master_region_label(region_kor: str) -> str:
    """모 시트 B열의 지역 표기(`Hanam 하남`)를 한글명으로 역인덱싱한다.

    스킬이 받는 `머리글 없이 내보내기` 파일에는 **지역 정보가 아예 없다**.
    그래도 신청서로 한글명은 알고 있으니 모 시트에서 되찾는다.

    ⚠ 후보가 2개 이상이면 확정하지 않는다 — `대구` 는 `Daegu1 대구1`·`Daegu2 대구2`,
      `중구`/`센트럴` 은 둘 다 `Seoul Central` 이라 하나로 찍으면 틀린다.
    """
    from google_auth import sa_services
    _, sheets = sa_services()
    v = sheets.spreadsheets().values().get(
        spreadsheetId=MASTER_ID, range="RPS!B2:B").execute().get("values", [])
    labels = {r[0].strip() for r in v if r and r[0].strip()}

    kor = region_kor.strip()
    hits = sorted(l for l in labels if l.split(" ", 1)[-1] == kor)      # 정확 일치 우선
    if len(hits) != 1:
        hits = sorted(l for l in labels if kor in l)                    # 부분 일치 폴백
    if len(hits) == 1:
        return hits[0]
    return ""


def resolve_chapter_eng(xls: Path, chapter_kor: str, region_label: str = "") -> tuple[str, list[str]]:
    """추출 파일에서 **신규 챕터의 영문명을 자동으로 확정**한다.

    신청서에는 한글명(`시그니아`)만 있고, 시트명·QR 슬러그·페이지 url 은 전부 영문이다.
    추출 파일에는 챕터가 **영문명**으로 들어 있으므로,
    `추출에 있는 챕터` - `모 시트에 이미 있는 챕터` = **신규** 로 역산한다.

    후보가 정확히 1개일 때만 확정한다. 0개거나 2개 이상이면 사람이 판단해야 한다
    (오기가 시트명·슬러그·url 세 곳에 그대로 번지므로 추측하지 않는다).

    ⚠ `region_label` 이 비면 `master_chapters()` 가 **빈 집합**을 돌려주고,
      그러면 추출의 챕터가 전부 '신규'로 보여 역산이 통째로 틀린다(후보 여러 개 → 중단).
      그래서 호출 측에서 지역 표기를 확정해 넘긴다.
    """
    from roster_gen import parse
    region_label, people = parse(xls, region_label)
    if not region_label:
        raise SystemExit(
            "지역 표기를 확정하지 못해 챕터 영문명 역산을 중단한다.\n"
            "  --chapter <영문명> 으로 직접 지정하세요.")
    in_extract = {p["chapter"].strip() for p in people if p.get("chapter", "").strip()}
    existing = master_chapters(region_label)
    fresh = sorted(in_extract - existing)
    return (fresh[0] if len(fresh) == 1 else ""), fresh


# ---------------------------------------------------------------- QR 렌더

def qr_png_2000(qrcode_id: str, out: Path, ctx) -> Path:
    """bitly QR 을 2000×2000 PNG 로 만든다.

    bitly 는 512px PNG 만 준다(`image_size` 는 무시된다). 운영 QR 은 2000×2000 이라
    **SVG 를 받아 브라우저 canvas 에서 2000px 로 렌더**한다.
    """
    import requests

    token = BITLY_TOKEN.read_text(encoding="utf-8").split(":", 1)[1].strip()
    r = requests.get(f"https://api-ssl.bitly.com/v4/qr-codes/{qrcode_id}/image",
                     headers={"Authorization": f"Bearer {token}"},
                     params={"format": "svg"}, timeout=30)
    r.raise_for_status()
    svg = r.text

    page = ctx.new_page()
    try:
        b64 = page.evaluate(
            """async (svg) => {
                const url = URL.createObjectURL(new Blob([svg], {type:'image/svg+xml'}));
                const img = new Image();
                await new Promise((ok, err) => { img.onload = ok; img.onerror = err; img.src = url; });
                const S = 2000, c = document.createElement('canvas');
                c.width = c.height = S;
                const g = c.getContext('2d');
                g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
                g.drawImage(img, 0, 0, S, S);
                URL.revokeObjectURL(url);
                return c.toDataURL('image/png').split(',')[1];
            }""", svg)
    finally:
        page.close()

    import base64
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(base64.b64decode(b64))
    return out


# ---------------------------------------------------------------- 단계

def step_roster(p: Plan) -> None:
    log("[1] 멤버 명단 → 모 시트")

    if not p.xls:
        p.xls = download_connect_extract(
            p.region_kor, OUT / f"{p.region_eng}All" / "connect", headless=not p.headful)

    # 지역 표기(모 시트 B열 형식). `머리글 없이 내보내기` 파일엔 지역이 없어 여기서 확정한다.
    from roster_gen import parse
    label = parse(p.xls)[0] or ("" if p.new_region else master_region_label(p.region_kor))
    if not label:
        label = f"{p.region_eng} {p.region_kor}"      # 신규 지역은 모 시트에 아직 없다
        log(f"    지역 표기 신규 생성: {label}")
    else:
        log(f"    지역 표기: {label}")
    p.result["region_label"] = label

    # 챕터 영문명 — 신청서에서 받았으면 **추출 파일과 대조**하고, 없으면 역산한다.
    #
    # 2026-08-23 부터 신청 폼이 영문명을 직접 받는다(담당자가 BNI Connect 를 보고 적는다).
    # 그래도 그대로 믿지 않는다 — 오기 하나가 시트명·QR 슬러그·페이지 url 세 곳에
    # 그대로 번지고, imweb·bitly 는 지우는 API 가 없어 되돌릴 수가 없다.
    if p.chapter_eng:
        from roster_gen import parse as _parse
        _, people = _parse(p.xls, label)
        in_extract = {x["chapter"].strip() for x in people if x.get("chapter", "").strip()}
        match = next((c for c in in_extract if c.casefold() == p.chapter_eng.casefold()), None)
        if not match:
            raise SystemExit(
                f"신청서의 챕터 영문명 `{p.chapter_eng}` 이 BNI Connect 추출에 없다.\n"
                f"  추출에 있는 챕터: {sorted(in_extract)}\n"
                "  표기가 다르면 시트명·QR·페이지 주소가 전부 어긋난다. 신청 내용을 확인하세요.")
        if match != p.chapter_eng:
            log(f"    챕터 영문명 대소문자 교정: {p.chapter_eng} → **{match}** (추출 표기 기준)")
            p.chapter_eng = match
        else:
            log(f"    챕터 영문명 확인: **{p.chapter_eng}** (추출과 일치)")
    else:
        eng, candidates = resolve_chapter_eng(p.xls, p.chapter_kor, label)
        if not eng:
            raise SystemExit(
                f"챕터 영문명을 확정하지 못했다 (신규 후보 {len(candidates)}개: {candidates})\n"
                "  추출 파일의 챕터 중 모 시트에 없는 것이 정확히 1개일 때만 자동 확정한다.\n"
                f"  --chapter <영문명> 으로 직접 지정하세요.")
        p.chapter_eng = eng
        log(f"    챕터 영문명 자동 확정: {p.chapter_kor} → **{eng}**  (모 시트에 없는 신규 챕터)")

    args = [str(p.xls), "--chapter", p.chapter_eng, "--region", p.result["region_label"]]
    if p.apply:
        args.append("--apply")
    out = run("roster_gen.py", *args)
    log("    " + (out.strip().splitlines() or ["(출력 없음)"])[-1])

    # 멤버 수는 완료 보고·게시판 글("총 30명")에 쓰인다.
    m = re.search(r"^멤버 = (\d+)명", out, re.M)
    if m:
        p.result["member_count"] = m.group(1)


def step_sheets(p: Plan) -> None:
    log("[2] 구글 시트")
    log(f"    챕터 {p.chapter_eng}_rps · PW {p.chapter_pw}")
    if p.new_region:
        log(f"    지역 {p.region_eng} {p.region_kor} All_rps")

    try:
        from google_auth import owner_ok
        ok, email = owner_ok()
    except Exception:
        ok, email = False, "(모듈 없음)"

    if not ok:
        log(f"    ⚠ 소유계정 OAuth 미설정({email}) — 사본 생성은 서비스계정으로 불가능하다"
            "(드라이브 할당량 0).")
        log("      python google_auth.py --login  후 다시 실행하거나,"
            " 브라우저로 사본 → sheet_gen.py --adopt 2단으로 처리한다.")
        p.steps.append("sheets:manual")
        return

    log(f"    소유계정 {email} — 사본 생성까지 자동")
    for kind, eng, kor, launch in (
        [("chapter", p.chapter_eng, p.chapter_kor, p.launch)]
        + ([("region", p.region_eng, p.region_kor, None)] if p.new_region else [])
    ):
        args = [f"--{kind}", eng, "--kor", kor]
        if launch:
            args += ["--launch", launch]
        if p.apply:
            args.append("--apply")
        out = run("sheet_gen.py", *args)
        m = re.search(r"(https://docs\.google\.com/spreadsheets/d/\S+)", out)
        if m:
            p.result[f"{kind}_sheet"] = m.group(1)
            log(f"    {kind} 시트 {m.group(1)}")


def _rpi_line(out: str, mark: str, eng: str) -> str:
    """`rpi_sheet` 출력에서 <표시> 뒤에 **이 챕터 이름**이 오는 줄을 돌려준다.

        `   + GAON         (Suwon1 수원1)  _source 30명`
        `   ✓ GAON: RPI=0 R=0%=100 매칭 정상`

    다른 챕터 줄에 속지 않으려고 이름까지 맞춘다. 한 실행에 여러 건이 함께 처리된다.
    """
    for line in out.splitlines():
        s = line.strip()
        if not s.startswith(mark):
            continue
        name = s[len(mark):].strip().split(":")[0].split("(")[0].strip()
        if name.casefold() == eng.casefold():
            return s
    return ""


def _report_rpi(p: Plan, out: str, failed: bool = False) -> None:
    """[2-b] 결과를 **산출물로** 판정한다.

    예외만 안 나면 `행 추가` 라고 적어 두던 탓에, 추가 대상이 0 건이어도 완료로 보고됐다 —
    2026-09-06 에 GAON·Golden·Ocean 이 그렇게 빠진 채 `완료` 로 남아 있는 것이 드러났다.
    이제 **이 챕터 줄이 실제로 찍혔는지**로 가른다.
    """
    eng = p.chapter_eng
    blocked = _rpi_line(out, "⛔", eng)
    verified = _rpi_line(out, "✓", eng)
    warned = _rpi_line(out, "⚠", eng)
    added = _rpi_line(out, "+", eng)
    already = f"--add-chapter {eng} — 이미" in out

    for line in out.splitlines():
        if line.strip().startswith("[챕터] 추가 대상"):
            log("    " + line.strip())
    for s in (added, blocked, verified, warned):
        if s:
            log("    " + s)

    if blocked:
        p.steps.append("rpi:blocked")
        p.result["rpi"] = "제외됨(_source 매칭 없음 · 재실행 필요)"
        log("    ⚠ 모 시트 명단이 `_source` 에 아직 안 올라왔다(IMPORTRANGE 시차).")
        log("      잠시 뒤 `python rpi_sheet.py --apply` 로 단독 재실행할 것.")
    elif verified:
        p.result["rpi"] = f"{eng} 행 추가 · 검증 정상"
    elif warned:
        p.steps.append("rpi:unverified")
        p.result["rpi"] = f"{eng} 행은 있으나 매칭 실패 의심(확인 필요)"
    elif added:
        p.steps.append("rpi:unverified")
        p.result["rpi"] = f"{eng} 행 추가(검증 미확인)"
    elif already:
        p.result["rpi"] = f"{eng} 이미 등재됨"
    elif failed:
        p.steps.append("rpi:failed")
        p.result["rpi"] = "실패(수동 재실행 필요)"
    else:
        p.steps.append("rpi:missing")
        p.result["rpi"] = "행 추가 안 됨(확인 필요)"
        log(f"    ⚠ {eng} 행이 추가되지 않았다 — rpi_sheet 출력을 확인할 것.")


def step_rpi(p: Plan) -> None:
    """[2-b] RPI 집계 시트에 챕터(·지역) 행 추가 — rpi_sheet.py.

    이 단계가 없어서 하남 시그니아·수원1 스타가 통째로 빠져 있었다(2026-08-02 발견).

    ⭐ 추가 대상의 정본은 챕터 마스터 `활동중(N)` 인데 **마스터는 월 1회 갱신**이다.
      이 파이프라인은 런칭 시점에 도니 마스터는 늘 한 달 뒤처져 있고, 그래서 신규 챕터는
      구조적으로 이 단계를 0 건으로 통과했다(2026-09-06 발견 — GAON·Golden·Ocean).
      → 방금 만든 챕터를 `--add-chapter` 로 **직접 넘긴다**.

    ⚠ 실패해도 런칭 전체를 죽이지 않는다. 집계 시트는 나중에 단독 재실행으로 채울 수 있고,
      여기서 멈추면 imweb 페이지가 안 만들어져 손해가 더 크다.
    ⚠ 원천은 모 시트를 당겨오는 `IMPORTRANGE` 라 [1] append 가 **반영되기까지 시차**가
      있을 수 있다. 그때는 `_source` 매칭 없음으로 걸러지므로(0 이 박히지 않는다)
      잠시 뒤 `python rpi_sheet.py --apply` 를 다시 돌리면 된다.
    """
    log("[2-b] RPI 집계 시트")
    if not p.apply:
        log("    $ rpi_sheet.py  (dry-run)")
        return

    # 지역 표기는 [1] 이 확정한 모 시트 B열 형식(`Suwon1 수원1`). 그 단계를 건너뛴 실행을
    # 대비해 지역명 합성으로 되돌아간다 — 표기가 어긋나면 rpi_sheet 가 걸러 준다.
    label = p.result.get("region_label") or f"{p.region_eng} {p.region_kor}"
    try:
        out = run("rpi_sheet.py", "--apply", "--add-chapter", p.chapter_eng, label)
    except RuntimeError as e:
        # ⚠ 종료코드 1 은 두 가지다 — 아예 안 쓴 것과, 쓰고 나서 검증이 어긋난 것.
        #   뭉뚱그려 `건너뜀` 으로 적으면 시트에 행이 있는데도 실패로 남는다. 출력으로 가른다.
        out = str(e)
        log(f"    ⚠ rpi_sheet 종료코드 1 — {out.splitlines()[0]}")
        log("      `python rpi_sheet.py --apply` 로 단독 재실행해 확인할 것.")
        _report_rpi(p, out, failed=True)
        return

    _report_rpi(p, out)


def step_qr(p: Plan) -> None:
    log("[3] bitly 링크·QR")
    targets = [("chapter", p.chapter_eng, p.result.get("chapter_sheet"))]
    if p.new_region:
        targets.append(("region", p.region_eng, p.result.get("region_sheet")))
    for kind, eng, url in targets:
        if not url:
            log(f"    ({kind} 건너뜀: 시트 URL 미확보)")
            continue
        args = [f"--{kind}", eng, "--url", url]
        if p.apply:
            args.append("--apply")
        out = run("qr_gen.py", *args)
        m = re.search(r"✓ QR (\S+)", out)
        if m:
            p.result[f"{kind}_qrcode_id"] = m.group(1)


def step_banner(p: Plan) -> None:
    log("[4] 배너")
    card = OUT / p.chapter_eng / f"card_{p.chapter_eng.lower()}_500.png"
    if p.apply or not card.exists():
        run("banner_gen.py", "--kor", f"{p.chapter_kor} 챕터",
            "--eng", p.chapter_eng.upper(), "--out", str(card))
    p.result["card"] = card
    log(f"    챕터 카드 {card.name}")

    if p.new_region:
        logo = OUT / f"{p.region_eng}All" / f"region_{p.region_eng.lower()}_500.png"
        run("banner_gen.py", "--region", p.region_eng.upper(), "--out", str(logo))
        p.result["logo"] = logo
        log(f"    지역 로고 {logo.name}")


def step_imweb(p: Plan, im: ImwebClient) -> None:
    log("[5] imweb 페이지")
    p.result["chapter_no"] = im.next_chapter_no()
    log(f"    채번: {p.chapter_page_name}")

    if not p.apply:
        log("    (dry-run — 아무것도 만들지 않는다)")
        return

    snap = im.snapshot(SNAP / f"imweb_menu_{datetime.now():%Y%m%d_%H%M%S}.json")
    log(f"    스냅샷 {snap.name}")

    # --- 신규 지역이면 ALL 페이지 + 지역 페이지 먼저
    if p.new_region:
        tpl = im.find_by_name(TEMPLATE_ALL)
        all_code = im.copy_page(tpl["code"], "foot")
        im.edit_page(all_code, name=p.all_page_name, password=p.result["region_pw"])
        # 복제는 `pos` 를 무시할 때가 있다 → 자리를 확정한다 (아래 챕터와 같은 이유).
        if im.place_page(all_code, "foot"):
            log("      · ALL 페이지 자리 교정(foot/최상위)")
        im.set_chapter_content(all_code, p.result["region_qr_png"], p.result["region_sheet"])
        p.result["all_page"] = all_code
        log(f"    ✓ {p.all_page_name} ({all_code})")

        tpl_r = im.find_by_name(TEMPLATE_REGION)
        region_code = im.copy_page(tpl_r["code"], "main")
        # ⚠ `sub_name` 을 반드시 같이 준다 — 안 주면 원본(`화성`)의 영문명이 그대로
        #   따라와 메뉴 호버에 남는다(하남이 `Hwaseong` 인 채로 넉 달 갔다).
        im.edit_page(region_code, name=p.region_kor, url=p.region_eng,
                     sub_name=p.region_eng)
        # 지역 페이지는 상단 RPI 메뉴의 **자식**이어야 `im.regions()` 에 잡힌다.
        if im.place_page(region_code, "main", parent_code=RPI_MENU):
            log("      · 지역 페이지 자리 교정(RPI 하위)")
        im.set_region_logos(region_code, p.result["logo"], all_code, p.region_kor)
        p.result["region_page"] = region_code
        log(f"    ✓ {p.region_kor} (/{p.region_eng}) · sub_name={p.region_eng}")
    else:
        region = im.find_by_name(p.region_kor)
        if not region:
            raise ImwebError(f"지역 페이지를 못 찾았다: {p.region_kor}")
        p.result["region_page"] = region["code"]

    # --- 챕터 페이지
    tpl_c = im.find_by_name(TEMPLATE_CHAPTER)
    ch_code = im.copy_page(tpl_c["code"], "foot")
    # ⚠ `sub_name` — 템플릿(`106 온리원`)의 `Only One` 이 그대로 따라온다. 메뉴 호버에
    #   보이는 값이라 안 고치면 남의 챕터 영문명을 달고 산다(2026-08-26 골든에서 발생).
    fields = {"name": p.chapter_page_name, "password": p.chapter_pw}
    if p.chapter_eng:
        fields["sub_name"] = p.chapter_eng
    im.edit_page(ch_code, **fields)
    # ⛔ 복제가 `pos='foot'` 을 무시하고 RPI 하위(main·depth1)에 붙는 일이 있다.
    #   그 자리에선 숫자 url 이 라우팅되지 않아 **게시해도 404** 다 → 자리를 확정한다.
    if im.place_page(ch_code, "foot"):
        log("      · 챕터 페이지 자리 교정(foot/최상위)")
    im.set_chapter_content(ch_code, p.result["chapter_qr_png"], p.result["chapter_sheet"])
    p.result["chapter_page"] = ch_code
    log(f"    ✓ {p.chapter_page_name} ({ch_code}) · sub_name={p.chapter_eng or '-'}")

    # --- 지역 페이지 카드는 **여기서 붙이지 않는다**
    # imweb 은 `link_code` 가 게시된 페이지로 풀릴 때만 앵커를 그린다. 게시 전에 얹으면
    # 링크 없는 카드가 공개 사이트에 바로 노출되고 클릭이 라이트박스로 떨어진다.
    # 카드는 게시를 감지한 `publish_watch` 가 붙인다 (2026-08-24 순서 교정).
    log("    · 지역 카드는 게시 감지 후 자동 부착 (publish_watch)")

    # --- 비번 등재 (노션이 정본)
    # ⛔ imweb 은 비번을 bcrypt 로 저장해 되읽을 수 없다. **설정한 이 자리에서** 적는다.
    #   실패해도 런칭을 죽이지 않는다 — 나중에 `notion_pw.py` 로 단독 등재가 된다.
    try:
        import notion_pw
        msg = notion_pw.add_chapter(
            p.chapter_eng, p.result.get("region_label", f"{p.region_eng} {p.region_kor}"),
            p.chapter_pw, p.launch, p.result.get("chapter_sheet", "") or "", apply=True)
        log(f"    ✓ 노션 RPI Viewer — {msg}")
    except Exception as e:                                   # noqa: BLE001
        log(f"    ⚠ 노션 등재 실패 (수동 등재 필요): {e.__class__.__name__} {e}")
        p.steps.append("notion:failed")


def step_verify(p: Plan, im: ImwebClient) -> dict:
    log("[6] 검증")
    report = {"ok": True, "checks": []}

    def check(name: str, cond: bool, detail: str = "") -> None:
        report["checks"].append({"name": name, "ok": bool(cond), "detail": detail})
        if not cond:
            report["ok"] = False
        log(f"    {'✅' if cond else '❌'} {name} {detail}")

    ml = im.menu_list()
    for key, name in [("chapter_page", p.chapter_page_name),
                      ("all_page", p.all_page_name),
                      ("region_page", p.region_kor)]:
        code = p.result.get(key)
        if not code:
            continue
        m = ml.get(code)
        check(f"{name} 존재", bool(m), f"url={m['url']}" if m else "")
        if m:
            p.result[f"{key}_url"] = m["url"]      # 게시판 글·담당자 안내에 쓴다
        if m and key != "region_page":
            check(f"{name} 비밀번호", bool(m.get("password")))

    if p.result.get("chapter_page"):
        text = im.visual_section(p.result["chapter_page"])[1]["data"]["slide_data"][0]["text"]
        from imweb_client import _sheet_id
        check("챕터 시트 링크", _sheet_id(p.result["chapter_sheet"]) in text)

    nos = [int(re.match(r"^(\d+)\s", m["name"]).group(1)) for m in ml.values()
           if re.match(r"^\d+\s", m.get("name") or "")]
    check("챕터 번호 중복 없음", len(nos) == len(set(nos)), f"최대 {max(nos)}")

    # ⛔ **챕터 페이지의 메뉴 배치를 반드시 본다.**
    #   `menu_copy.cm` 이 `pos` 를 무시하고 RPI 하위(`pos=main`, `depth=1`)에 붙이는 일이
    #   있다(2026-08-24 오션). 그러면 숫자 url 이 라우팅되지 않아 **게시해도 404** 이고,
    #   지역 카드의 링크 앵커도 안 그려지며, `im.regions()` 에 챕터가 섞여 들어온다.
    #   직전 챕터 109·110 은 `pos=foot, depth=0, 부모없음` 으로 정상 동작한다.
    #   2026-08-27 부터는 `step_imweb` 이 `place_page()` 로 자리를 확정하므로 여기는
    #   **그게 정말 됐는지 보는 자리**다 (그 전엔 여기서 걸리면 사람이 손으로 옮겼다).
    ch = ml.get(p.result.get("chapter_page") or "")
    if ch:
        placed = (ch.get("pos") == "foot" and str(ch.get("depth")) == "0"
                  and not ch.get("parent_code"))
        check("챕터 페이지 배치(foot/depth0/부모없음)", placed,
              f"pos={ch.get('pos')} depth={ch.get('depth')} "
              f"RPI자식={ch.get('parent_code') == RPI_MENU}")

    # 템플릿에서 따라온 `sub_name` 은 메뉴 호버에 그대로 보인다(하남이 `Hwaseong` 으로
    # 넉 달 방치된 적이 있다). 챕터 영문명과 다르면 잡는다.
    if ch and p.chapter_eng:
        check("챕터 sub_name", str(ch.get("sub_name") or "") == p.chapter_eng,
              f"sub_name={ch.get('sub_name')!r} 기대={p.chapter_eng!r}")
    return report


# ---------------------------------------------------------------- main

def main() -> None:
    ap = argparse.ArgumentParser(description="신규 챕터 런칭 파이프라인")
    ap.add_argument("--chapter", default="",
                    help="챕터 영문명 (예: Signia). 생략하면 BNI Connect 추출에서 역산한다")
    ap.add_argument("--kor", required=True, help="챕터 한글명 (예: 시그니아)")
    ap.add_argument("--region", required=True, help="지역 영문명 (예: Hanam)")
    ap.add_argument("--region-kor", required=True, help="지역 한글명 (예: 하남)")
    ap.add_argument("--launch", required=True, help="런칭일 YYYY-MM-DD (PW 가 여기서 나온다)")
    ap.add_argument("--xls", help="BNI Connect 데이터베이스 추출 .xls")
    ap.add_argument("--chapter-sheet", help="챕터 RPS 시트 URL (이미 만들었다면)")
    ap.add_argument("--region-sheet", help="지역 ALL 시트 URL")
    ap.add_argument("--region-pw", help="지역 시트/페이지 PW (규칙 없는 임의 4자리)")
    ap.add_argument("--apply", action="store_true", help="실제 실행 (미지정 시 dry-run)")
    ap.add_argument("--headful", action="store_true", help="브라우저 창을 띄운다")
    ap.add_argument("--skip-roster", action="store_true",
                    help="[1] 멤버 명단을 건너뛴다 (소급 건: 명단이 이미 모 시트에 있을 때). "
                         "--chapter 로 챕터 영문명을 직접 줘야 한다")
    ap.add_argument("--notify", action="store_true",
                    help="단계마다 hq 편지함으로 진행 보고 (--apply 일 때만 의미 있다)")
    ap.add_argument("--owner-phone", default="", help="담당자 연락처 (완료·오류 문자)")
    a = ap.parse_args()

    p = Plan(a.chapter, a.kor, a.region, a.region_kor, a.launch,
             Path(a.xls) if a.xls else None, a.apply, a.headful)
    p.result["chapter_sheet"] = a.chapter_sheet
    p.result["region_sheet"] = a.region_sheet
    p.result["region_pw"] = a.region_pw

    log(f"{'실행' if a.apply else 'DRY-RUN'} · {p.region_kor} {p.chapter_kor} "
        f"· 런칭 {p.launch} · 챕터 PW {p.chapter_pw}\n")

    # 진행 보고 — dry-run 에서는 보내지 않는다(계획만 찍는 것이라 알릴 게 없다).
    rep = Reporter(p.region_kor, p.chapter_kor,
                   enabled=bool(a.notify and a.apply), owner_phone=a.owner_phone)
    rep.start()

    try:
        with ImwebClient(headless=not a.headful) as im:
            if not im.logged_in():
                raise SystemExit("imweb 로그인 안 됨 →  python imweb_client.py --login")

            p.new_region = im.find_by_name(p.region_kor) is None
            log(f"지역 {p.region_kor}: "
                f"{'신규 (지역·ALL 페이지도 만든다)' if p.new_region else '기존'}\n")

            # 신규 지역인데 PW 가 없으면 ALL 페이지가 **비밀번호 없이** 만들어진다.
            # 2026-08-01 리허설에서 실제로 그렇게 나왔다([6] 검증이 잡았다).
            # 지역 PW 는 규칙이 없어 사람이 정해야 하므로, 조용히 넘어가지 않고 막는다.
            if p.apply and p.new_region and not p.result.get("region_pw"):
                raise SystemExit(
                    "신규 지역인데 --region-pw 가 없다.\n"
                    "  ALL 페이지는 비밀번호 보호 페이지다. 없으면 무보호로 만들어진다.\n"
                    "  지역 PW 는 챕터(런칭일 MMDD)와 달리 규칙이 없다 — 4자리를 정해 넘겨주세요.\n"
                    "  예: --region-pw 1234")

            if a.skip_roster:
                # 소급 건 — 명단이 이미 모 시트에 있다. 뒤 단계가 쓰는 값만 채운다.
                if not p.chapter_eng:
                    raise SystemExit("--skip-roster 는 --chapter <영문명> 이 있어야 한다 "
                                     "(역산은 [1] 에서 하기 때문이다)")
                p.result["region_label"] = (
                    f"{p.region_eng} {p.region_kor}" if p.new_region
                    else master_region_label(p.region_kor))
                log(f"[1] 멤버 명단 — 건너뜀 (지역 표기 {p.result['region_label']})")
                rep.step("[1] 멤버 명단", "건너뜀")
            else:
                step_roster(p)
                rep.step("[1] 멤버 명단",
                         f"{p.chapter_eng} · {p.result.get('member_count', '?')}명")
            step_sheets(p)
            rep.step("[2] 구글 시트", str(p.result.get("chapter_sheet") or ""))
            step_rpi(p)
            rep.step("[2-b] RPI 집계 시트", p.result.get("rpi", ""))
            step_qr(p)
            rep.step("[3] QR", str(p.result.get("chapter_qrcode_id") or ""))
            step_banner(p)
            rep.step("[4] 배너")

            for kind in (["chapter"] + (["region"] if p.new_region else [])):
                qid = p.result.get(f"{kind}_qrcode_id")
                if qid:
                    png = OUT / (p.chapter_eng if kind == "chapter" else f"{p.region_eng}All") / \
                          f"qr_{kind}_2000.png"
                    p.result[f"{kind}_qr_png"] = qr_png_2000(qid, png, im._ctx)
                    log(f"    QR 2000px {png.name}")

            need = ["chapter_sheet", "chapter_qr_png"]
            missing = [k for k in need if not p.result.get(k)]
            if a.apply and missing:
                raise SystemExit(f"[5] 진행 불가 — 빠진 값: {missing}\n"
                                 "시트/QR 을 먼저 만들고 --chapter-sheet 등으로 넘겨주세요.")

            step_imweb(p, im)
            rep.step("[5] imweb 페이지", str(p.result.get("chapter_page_name") or ""))
            report = step_verify(p, im) if a.apply else {"ok": None, "checks": []}
            rep.step("[6] 검증", "통과" if report.get("ok") else "불통과")
    except BaseException as e:                       # noqa: BLE001  (SystemExit 포함)
        rep.done(False, f"{type(e).__name__}: {e}")
        raise

    if a.apply:
        out = SNAP / f"launch_{p.chapter_eng}_{datetime.now():%Y%m%d_%H%M%S}.json"
        out.write_text(json.dumps(
            {"plan": {k: str(v) for k, v in p.result.items()}, "report": report},
            ensure_ascii=False, indent=1), encoding="utf-8")
        log(f"\n리포트 {out}")
        log("\n▶ 남은 것: 사람이 편집기에서 확인하고 **게시**. 게시 전까지 공개 사이트는 404 다.")
        rep.done(bool(report.get("ok")),
                 f"시트 {p.result.get('chapter_sheet') or '-'}\n"
                 f"페이지 {p.result.get('chapter_page_name') or '-'}\n"
                 f"리포트 {out.name}")


if __name__ == "__main__":
    # 하위 단계가 "이미 있다"로 멈추는 건 **정상 거부**다(중복 실행 방지).
    # 그걸 traceback 으로 뱉으면 진짜 버그와 구분이 안 된다 → 메시지만 보여주고 끝낸다.
    try:
        main()
    except RuntimeError as e:
        sys.exit(f"\n중단: {e}")
