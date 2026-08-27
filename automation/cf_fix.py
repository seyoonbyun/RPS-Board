# -*- coding: utf-8 -*-
"""
R파트너 트래킹 조건부 서식 정정

의도한 동작 (사용자 확인)
    이름만 입력        → 이름 칸 초록
    전문분야만 입력    → 전문분야 칸 빨강
    둘 다 입력         → 두 칸 모두 초록
    V-C-P 에서 관계 선택으로 마무리

발견한 문제 2가지

1) **빈 칸에 초록불이 켜진다** (모 시트)
   기존 규칙이 `ISBLANK()` 를 쓴다. 그런데 그 셀들은 완전한 빈칸이 아니라
   **빈 문자열("")** 이 들어 있어 `ISBLANK` 가 FALSE 를 돌려준다.
   → "둘 다 채워짐" 으로 판정되어 초록이 켜진다.
   `=""` / `<>""` 비교로 바꾸면 빈칸과 빈 문자열을 모두 올바르게 처리한다.

2) **"이름만 → 초록" 규칙이 아예 없다** (모 시트)
   모 시트에는 둘 다·전문분야만 규칙만 있고 이름만 채웠을 때의 초록이 빠져 있었다.

※ `_rps` 시트(챕터/지역)는 별개 문제가 있다 — R파트너 1·2 의 규칙이 3·4 와 달라서
  둘 다 채워도 한 칸만 초록이 되고, L열 999행부터 엉뚱한 열을 참조하는 쓰레기 규칙 2개가 있다.
  `--target rps` 로 같은 정본 규칙을 적용한다.

사용법
    python cf_fix.py --target master                # dry-run (기본)
    python cf_fix.py --target master --apply
    python cf_fix.py --target rps --sheet Signia_rps --apply
    python cf_fix.py --restore cf_backup_master.json --apply
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")   # 에러도 utf-8 로 (cp949 로 나가면 깨진다)

KEY = Path(r"C:\Users\Gram\desktop\connect_tl_report\connect\gcp-key.json")
MASTER_ID = "1JM37uOEu64D0r6zzKggOsA9ZdcK4wBCx0rpuNoVcIYg"
FOLDER_ID = "1XqC-OdatL9Dxi9fJ9a3IKr_I4NKvozGf"
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import paths                            # noqa: E402
BACKUP_DIR = paths.snap_dir()

GREEN = {"red": 0.20392157, "green": 0.65882355, "blue": 0.3254902}
RED = {"red": 1.0, "green": 0.0, "blue": 0.0}
WHITE = {"red": 1.0, "green": 1.0, "blue": 1.0}


def _fmt(bg: dict) -> dict:
    """배경 + **흰 글자**.

    ⚠ 글자색을 빼먹으면 초록/빨강 배경에 검은 글자가 남아 읽기 어렵다.
      원본 규칙도 전부 흰 글자였다 — 배경만 바꾸지 말 것.
    """
    return {
        "backgroundColor": bg,
        "backgroundColorStyle": {"rgbColor": bg},
        "textFormat": {"foregroundColor": WHITE,
                       "foregroundColorStyle": {"rgbColor": WHITE}},
    }

# 열 인덱스(0-based) — (이름, 전문분야) 쌍
PAIRS_MASTER = [(8, 9), (11, 12), (14, 15), (17, 18)]     # I·J / L·M / O·P / R·S
PAIRS_RPS = [(7, 8), (10, 11), (13, 14), (16, 17)]        # H·I / K·L / N·O / Q·R
COL = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def _svc():
    creds = Credentials.from_service_account_file(str(KEY), scopes=[
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive"])
    return (build("sheets", "v4", credentials=creds).spreadsheets(),
            build("drive", "v3", credentials=creds))


def rules(sheet_id: int, pairs, last_row: int) -> list[dict]:
    """정본 규칙 — 쌍마다 3개씩. `ISBLANK` 대신 `=\"\"` 비교."""
    out = []
    for name_c, spec_c in pairs:
        n, s = COL[name_c], COL[spec_c]
        both = {"sheetId": sheet_id, "startRowIndex": 1, "endRowIndex": last_row,
                "startColumnIndex": name_c, "endColumnIndex": spec_c + 1}
        only_n = {"sheetId": sheet_id, "startRowIndex": 1, "endRowIndex": last_row,
                  "startColumnIndex": name_c, "endColumnIndex": name_c + 1}
        only_s = {"sheetId": sheet_id, "startRowIndex": 1, "endRowIndex": last_row,
                  "startColumnIndex": spec_c, "endColumnIndex": spec_c + 1}
        out += [
            {"ranges": [both], "booleanRule": {
                "condition": {"type": "CUSTOM_FORMULA", "values": [
                    {"userEnteredValue": f'=AND(${n}2<>"", ${s}2<>"")'}]},
                "format": _fmt(GREEN)}},
            {"ranges": [only_n], "booleanRule": {
                "condition": {"type": "CUSTOM_FORMULA", "values": [
                    {"userEnteredValue": f'=AND(${n}2<>"", ${s}2="")'}]},
                "format": _fmt(GREEN)}},
            {"ranges": [only_s], "booleanRule": {
                "condition": {"type": "CUSTOM_FORMULA", "values": [
                    {"userEnteredValue": f'=AND(${n}2="", ${s}2<>"")'}]},
                "format": _fmt(RED)}},
        ]
    return out


def fix(spreadsheet_id: str, tab: str, pairs, apply: bool, label: str) -> None:
    sh, _ = _svc()
    meta = sh.get(spreadsheetId=spreadsheet_id, includeGridData=False,
                  fields="sheets(properties(title,sheetId,gridProperties(rowCount)))"
                         ",sheets(conditionalFormats)").execute()
    target = next((s for s in meta["sheets"] if s["properties"]["title"] == tab), None)
    if target is None:
        raise SystemExit(f"탭 없음: {tab}")
    sid = target["properties"]["sheetId"]
    last = target["properties"]["gridProperties"]["rowCount"]
    old = target.get("conditionalFormats", [])
    new = rules(sid, pairs, last)

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    bpath = BACKUP_DIR / f"cf_backup_{label}.json"
    bpath.write_text(json.dumps(old, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"[{'실행' if apply else 'DRY-RUN'}] {label}  탭={tab}  행수={last}")
    print(f"  기존 규칙 {len(old)}개 → 새 규칙 {len(new)}개")
    print(f"  백업: {bpath}")
    for name_c, spec_c in pairs:
        n, s = COL[name_c], COL[spec_c]
        print(f'    {n}·{s} :  둘다→초록  {n}만→초록  {s}만→빨강')
    if not apply:
        print("\n  → --apply 를 붙여야 반영됩니다.")
        return

    reqs = [{"deleteConditionalFormatRule": {"sheetId": sid, "index": i}}
            for i in range(len(old) - 1, -1, -1)]
    reqs += [{"addConditionalFormatRule": {"rule": r, "index": i}}
             for i, r in enumerate(new)]
    sh.batchUpdate(spreadsheetId=spreadsheet_id, body={"requests": reqs}).execute()
    print(f"  ✓ 규칙 교체 완료 ({len(old)} 삭제 · {len(new)} 추가)")


def all_rps(apply: bool, skip: set[str] | None = None) -> None:
    """`_rps` 시트 전체에 정본 규칙 적용.

    ⚠ 값·데이터확인(칩)은 건드리지 않는다. 조건부 서식 규칙만 교체한다.
      칩은 API 로 못 만들므로 절대 지우면 안 된다 — `values.clear` 계열 호출 금지.
    """
    import time
    _, drive = _svc()
    files, token = [], None
    while True:
        r = drive.files().list(
            q=f"'{FOLDER_ID}' in parents and trashed=false and "
              "mimeType='application/vnd.google-apps.spreadsheet'",
            fields="nextPageToken, files(id,name)", pageSize=200, pageToken=token).execute()
        files += r["files"]
        token = r.get("nextPageToken")
        if not token:
            break
    targets = [f for f in files if f["name"].lower().endswith("_rps")]
    skip = skip or set()
    targets = [f for f in targets if f["name"] not in skip]
    print(f"대상 {len(targets)}개 (건너뜀 {len(skip)})\n")
    ok = fail = 0
    for i, f in enumerate(targets, 1):
        try:
            sh, _ = _svc()
            tab = sh.get(spreadsheetId=f["id"], fields="sheets(properties(title))"
                         ).execute()["sheets"][0]["properties"]["title"]
            fix(f["id"], tab, PAIRS_RPS, apply, f["name"])
            ok += 1
        except Exception as e:
            print(f"  ✗ {f['name']}: {e.__class__.__name__} {str(e)[:100]}")
            fail += 1
        if i % 10 == 0:
            time.sleep(2)
    print(f"\n완료 {ok} · 실패 {fail}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="R파트너 조건부 서식 정정")
    ap.add_argument("--target", choices=["master", "rps"], help="대상")
    ap.add_argument("--sheet", help="rps 대상일 때 파일명 (예: Signia_rps)")
    ap.add_argument("--all", action="store_true", help="_rps 전체에 적용")
    ap.add_argument("--apply", action="store_true", help="실제 반영")
    a = ap.parse_args()

    if a.all:
        all_rps(a.apply, skip={"Signia_rps", "Ace_rps"})
        raise SystemExit(0)

    if a.target == "master":
        fix(MASTER_ID, "RPS", PAIRS_MASTER, a.apply, "master_RPS")
    elif a.target == "rps":
        if not a.sheet:
            raise SystemExit("--sheet 필요")
        _, drive = _svc()
        files = drive.files().list(
            q=f"'{FOLDER_ID}' in parents and name='{a.sheet}' and trashed=false",
            fields="files(id,name)").execute()["files"]
        if not files:
            raise SystemExit(f"없음: {a.sheet}")
        fid = files[0]["id"]
        sh, _ = _svc()
        tab = sh.get(spreadsheetId=fid, fields="sheets(properties(title))"
                     ).execute()["sheets"][0]["properties"]["title"]
        fix(fid, tab, PAIRS_RPS, a.apply, a.sheet)
    else:
        ap.print_help()
