# -*- coding: utf-8 -*-
"""
`_rps` 시트의 고아 데이터 제거

`find_orphans.py` 가 만든 `snapshots/orphan_report.json` 을 읽어 그 셀들만 비운다.

⚠ **`values.clear` / `values.batchClear` 를 쓰면 안 된다.**
   문서와 달리 **데이터 확인(V-C-P 컬러 칩)까지 함께 지운다.**
   칩은 Sheets API 로 다시 만들 수 없어(스타일·색이 API 에 없음) 복구가 불가능하다.
   → `updateCells` 에 `fields="userEnteredValue"` 만 지정해 **값만** 비운다.
     이러면 서식·데이터확인·조건부서식은 그대로 남는다.

지우기 전 값은 `snapshots/orphan_backup_<시각>.json` 으로 남긴다.

사용법
    python clean_orphans.py                 # dry-run (기본)
    python clean_orphans.py --apply
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")   # 에러도 utf-8 로 (cp949 로 나가면 깨진다)

KEY = Path(r"C:\SEYOON\03. Projects\Ongoing\rpslist\gcp-key.json")
FOLDER_ID = "1XqC-OdatL9Dxi9fJ9a3IKr_I4NKvozGf"
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import paths                            # noqa: E402
REPORT = paths.snap_dir() / "orphan_report.json"

# 뷰가 아니라 원본 데이터 시트 — 직접 입력값이 정상이므로 건드리지 않는다
EXCLUDE = {"MY PowerTeam_RPS"}

CELL = re.compile(r"^([A-Z]+)(\d+)")


def col_idx(letters: str) -> int:
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def _svc():
    creds = Credentials.from_service_account_file(str(KEY), scopes=[
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive"])
    return (build("sheets", "v4", credentials=creds).spreadsheets(),
            build("drive", "v3", credentials=creds))


def _retry(fn, tries: int = 5):
    for i in range(tries):
        try:
            return fn()
        except Exception as e:
            code = getattr(getattr(e, "resp", None), "status", None)
            if code not in (429, 500, 502, 503) or i == tries - 1:
                raise
            time.sleep(2 ** i * 3)


def main(apply: bool) -> None:
    report = json.loads(REPORT.read_text(encoding="utf-8"))
    for k in EXCLUDE:
        report.pop(k, None)

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
    # ⚠ 이름으로 키를 잡으면 **동명이인 파일**이 조용히 빠진다.
    #   실제로 `Omega_rps` 가 2개(2026-04-14 / 04-18) 있어서 한 번 놓쳤다.
    ids: dict[str, list[str]] = {}
    for f in files:
        ids.setdefault(f["name"], []).append(f["id"])
    dups = {k: len(v) for k, v in ids.items() if len(v) > 1}
    if dups:
        print(f"  ※ 동명 파일 {dups} — 전부 처리합니다")

    print(f"[{'실행' if apply else 'DRY-RUN'}] 대상 시트 {len(report)}개 "
          f"· 셀 {sum(len(v) for v in report.values())}개")
    print(f"  제외: {', '.join(EXCLUDE)}")
    sample = next(iter(report.items()))
    print(f"  예시 {sample[0]}: {sample[1]}\n")

    if not apply:
        print("  → --apply 를 붙여야 실제로 지웁니다.")
        return

    stamp = time.strftime("%Y%m%d_%H%M%S")
    (paths.snap_dir() / f"orphan_backup_{stamp}.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"  백업: snapshots/orphan_backup_{stamp}.json\n")

    ok = fail = 0
    jobs = [(n, fid, cells) for n, cells in sorted(report.items())
            for fid in ids.get(n, [])]
    missing = [n for n in report if not ids.get(n)]
    for n in missing:
        print(f"  ✗ {n}: 파일 없음")
        fail += 1

    for i, (name, fid, cells) in enumerate(jobs, 1):
        try:
            meta = _retry(lambda: sh.get(spreadsheetId=fid,
                                         fields="sheets(properties(sheetId))").execute())
            sid = meta["sheets"][0]["properties"]["sheetId"]
            reqs = []
            for c in cells:
                m = CELL.match(c)
                ci, r = col_idx(m.group(1)), int(m.group(2))
                reqs.append({"updateCells": {
                    "range": {"sheetId": sid, "startRowIndex": r - 1, "endRowIndex": r,
                              "startColumnIndex": ci, "endColumnIndex": ci + 1},
                    "rows": [{"values": [{}]}],
                    # 값만 비운다 — 데이터확인(칩)·서식은 건드리지 않는다
                    "fields": "userEnteredValue"}})
            _retry(lambda: sh.batchUpdate(spreadsheetId=fid,
                                          body={"requests": reqs}).execute())
            ok += 1
            print(f"  ✓ {name} ({len(cells)}셀)", flush=True)
        except Exception as e:
            fail += 1
            print(f"  ✗ {name}: {e.__class__.__name__} {str(e)[:80]}", flush=True)
        time.sleep(0.8)

    print(f"\n완료 {ok} · 실패 {fail}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="_rps 고아 데이터 제거")
    ap.add_argument("--apply", action="store_true", help="실제 삭제")
    main(ap.parse_args().apply)
