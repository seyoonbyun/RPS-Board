# -*- coding: utf-8 -*-
"""
`_rps` 시트의 '고아 데이터' 탐지

`_rps` 시트는 **마스터를 필터링해 보여주는 뷰**다. 정상 상태라면 직접 입력된 값은
  1행  헤더
  2행  A2(챕터/지역 표기) · B2(지역 시트만) · D2(RPI 수식)
  3행  A3 의 QUERY(IMPORTRANGE(...)) 수식 하나
뿐이고, 나머지는 전부 그 수식이 뿌린 결과여야 한다.

그 외 위치에 `userEnteredValue` 가 있으면 **사람이 시트에 직접 타이핑한 값**이다.
이런 값은
  - 마스터로 절대 반영되지 않는다 (앱·집계에서 사라진다)
  - 수식 영역 밖이라 눈에 잘 안 띈다
  - 나중에 QUERY 결과가 길어지면 `#REF!` 로 수식을 깨뜨린다

실제로 `Ace_rps` 704행에서 G·H·I·J 에 직접 입력된 값이 발견됐다.

사용법
    python find_orphans.py --sheet Ace_rps
    python find_orphans.py --all
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")   # 에러도 utf-8 로 (cp949 로 나가면 깨진다)

KEY = Path(r"C:\SEYOON\03. Projects\Ongoing\rpslist\gcp-key.json")
FOLDER_ID = "1XqC-OdatL9Dxi9fJ9a3IKr_I4NKvozGf"
COL = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def _svc():
    creds = Credentials.from_service_account_file(str(KEY), scopes=[
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive"])
    return (build("sheets", "v4", credentials=creds).spreadsheets(),
            build("drive", "v3", credentials=creds))


def _retry(fn, tries: int = 5):
    """API 한도(429/5xx)에 걸리면 점점 늦춰 재시도한다."""
    for i in range(tries):
        try:
            return fn()
        except Exception as e:
            code = getattr(getattr(e, "resp", None), "status", None)
            if code not in (429, 500, 502, 503) or i == tries - 1:
                raise
            time.sleep(2 ** i * 3)


def scan(sh, fid: str, name: str) -> list[str]:
    meta = _retry(lambda: sh.get(
        spreadsheetId=fid, includeGridData=False,
        fields="sheets(properties(title,gridProperties(rowCount)))").execute())
    p = meta["sheets"][0]["properties"]
    tab, rows = p["title"], p["gridProperties"]["rowCount"]
    g = _retry(lambda: sh.get(
        spreadsheetId=fid, ranges=[f"'{tab}'!A3:U{rows}"], includeGridData=True,
        fields="sheets(data(startRow,rowData(values(userEnteredValue))))").execute())
    d = g["sheets"][0]["data"][0]
    sr = d.get("startRow", 0)
    out = []
    for ri, row in enumerate(d.get("rowData", [])):
        r = sr + ri + 1
        for ci, cell in enumerate(row.get("values", [])):
            uev = cell.get("userEnteredValue")
            if not uev:
                continue
            # A3 의 QUERY 수식만 정상
            if r == 3 and ci == 0 and "formulaValue" in uev:
                continue
            v = list(uev.values())[0]
            out.append(f"{COL[ci]}{r} = {str(v)[:40]!r}")
    return out


def main(sheet: str | None, do_all: bool) -> None:
    sh, drive = _svc()
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
    if sheet:
        targets = [f for f in targets if f["name"] == sheet]
    elif not do_all:
        raise SystemExit("--sheet 또는 --all 필요")

    print(f"검사 대상 {len(targets)}개\n")
    total = 0
    dirty = []
    for i, f in enumerate(targets, 1):
        try:
            bad = scan(sh, f["id"], f["name"])
        except Exception as e:
            print(f"  ! {f['name']}: {e.__class__.__name__}")
            continue
        if bad:
            dirty.append((f["name"], bad))
            total += len(bad)
            print(f"  ⚠ {f['name']}: 고아 셀 {len(bad)}개  (첫 셀 {bad[0]})", flush=True)
        else:
            print(f"  · {f['name']}: 깨끗", flush=True)
        time.sleep(1.2)

    import json
    rep = Path(__file__).resolve().parent / "snapshots" / "orphan_report.json"
    rep.parent.mkdir(parents=True, exist_ok=True)
    rep.write_text(json.dumps({n: b for n, b in dirty}, ensure_ascii=False, indent=1),
                   encoding="utf-8")
    print(f"\n고아 데이터가 있는 시트 {len(dirty)}개 · 셀 {total}개")
    print(f"보고서: {rep}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="_rps 고아 데이터 탐지")
    ap.add_argument("--sheet", help="특정 파일만")
    ap.add_argument("--all", action="store_true", help="전체 검사")
    a = ap.parse_args()
    main(a.sheet, a.all)
