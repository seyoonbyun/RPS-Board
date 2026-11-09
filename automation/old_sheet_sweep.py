# -*- coding: utf-8 -*-
r"""옛 챕터·지역 시트(정식 폴더 밖, 같은 이름)를 찾아 **표지**를 붙이고 이름을 바꾼다 — 재발 방지.

    python old_sheet_sweep.py                 # 찾기만 (dry-run) + rps_sheets_index.json 의 old_sheets 갱신
    python old_sheet_sweep.py --apply         # 1행에 안내문 삽입 + 파일명 `<이름> (옛 2025, 사용 중지)`
    python old_sheet_sweep.py --only Medical Promise

왜 (2026-11-09 RPS-03)
    2025년에 만든 `Medical`·`Promise` 시트가 **익명 공개로 살아 있어** 서초 매니저가 그걸 보고
    「탈퇴자가 그대로 있고 신규가 없다」고 세 번 문의했다. 정식은 `RPS_Sheets` 폴더의 `<Eng>_rps`.
    옛 파일을 지우면 「링크가 안 열린다」가 되므로, 지우지 않고 **열면 바로 알도록** 한다.

무엇을 옛 시트로 보나
    - 스프레드시트이고 휴지통이 아니며 `RPS_Sheets` 폴더 밖
    - 이름이 챕터 영문명·한글명(또는 `<Eng> <Kor> All`)과 같고 `_rps` 로 끝나지 않음
    - 1~3행 어딘가에 `리퍼럴 파트너 지수` 가 있음 (RPS 뷰 시트의 표식)
    ⚠ 이름만 같은 다른 용도의 파일일 수 있으므로 표식이 없으면 건드리지 않고 목록에만 적는다.

하는 일 (--apply)
    1) 1행 위에 행 하나를 끼우고 A1 = 「⚠ 이 시트는 옛 버전입니다 (갱신 중지). 현재 시트 → <정식 링크>」
       (A3 QUERY 수식은 한 줄 아래로 밀릴 뿐 그대로 돈다)
    2) 파일명 → `<이름> (옛 2025, 사용 중지)` — 드라이브·탭 제목에서 한눈에 보이게
    되돌리기: 1행 삭제 + 이름 원복. 실행 전 목록을 `snapshots/old_sheet_sweep_<날짜>.json` 에 남긴다.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import paths                                                  # noqa: E402
from google_auth import enable_transient_retries, user_credentials   # noqa: E402
from googleapiclient.discovery import build                   # noqa: E402

FOLDER_ID = "1XqC-OdatL9Dxi9fJ9a3IKr_I4NKvozGf"               # RPS_Sheets
MARK = "리퍼럴 파트너 지수"
SUFFIX = " (옛 2025, 사용 중지)"
INDEX = "rps_sheets_index.json"


def load_index() -> dict:
    p = paths.snap_dir() / INDEX
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {"sheets": {}, "old_sheets": {}}


def save_index(idx: dict) -> None:
    (paths.snap_dir() / INDEX).write_text(json.dumps(idx, ensure_ascii=False, indent=1), encoding="utf-8")


def all_spreadsheets(drive) -> list[dict]:
    out, token = [], None
    while True:
        r = drive.files().list(
            q="mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
            fields="nextPageToken, files(id,name,parents,createdTime,owners(emailAddress))",
            pageSize=1000, pageToken=token).execute()
        out += r.get("files", [])
        token = r.get("nextPageToken")
        if not token:
            return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--only", nargs="*", help="이 챕터(영문)만")
    a = ap.parse_args()

    enable_transient_retries()
    creds = user_credentials()
    drive = build("drive", "v3", credentials=creds, cache_discovery=False)
    sheets = build("sheets", "v4", credentials=creds, cache_discovery=False)

    idx = load_index()
    official = {n[:-4]: m for n, m in (idx.get("sheets") or {}).items() if n.endswith("_rps")}
    if not official:
        print("색인에 정식 시트가 없다 — 먼저 rps_sheet_touch.py 를 한 번 돌릴 것")
        return 1
    targets = {c: m for c, m in official.items() if not a.only or c in set(a.only)}
    names = {}
    for eng, m in targets.items():
        for n in (eng, (m.get("kor") or "").strip(), f"{eng} {m.get('kor', '')}".strip()):
            if n:
                names[n.lower()] = eng

    files = all_spreadsheets(drive)
    print(f"드라이브 스프레드시트 {len(files)}개 · 정식 {len(targets)}개 이름 대조")
    found, skipped = [], []
    for f in files:
        nm = f["name"].strip()
        if nm.lower().endswith("_rps") or SUFFIX.strip() in nm or FOLDER_ID in (f.get("parents") or []):
            continue
        eng = names.get(nm.lower())
        if not eng:
            continue
        try:
            v = sheets.spreadsheets().values().get(spreadsheetId=f["id"], range="A1:D3").execute().get("values", [])
        except Exception as e:                                 # noqa: BLE001
            skipped.append((nm, f["id"], f"읽기 실패 {str(e)[:60]}"))
            continue
        flat = " ".join(" ".join(r) for r in v)
        if MARK not in flat:
            skipped.append((nm, f["id"], "RPS 뷰 표식 없음 — 다른 용도 파일일 수 있어 건드리지 않음"))
            continue
        found.append({"id": f["id"], "name": nm, "chapter": eng, "created": f.get("createdTime", "")[:10],
                      "official_id": targets[eng].get("id", "")})

    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M")
    (paths.snap_dir() / f"old_sheet_sweep_{stamp}.json").write_text(
        json.dumps({"found": found, "skipped": skipped}, ensure_ascii=False, indent=1), encoding="utf-8")
    idx["old_sheets"] = {x["id"]: {"name": x["name"], "chapter": x["chapter"], "created": x["created"]} for x in found}
    save_index(idx)

    print(f"\n옛 시트 {len(found)}개:")
    for x in found:
        print(f"  {x['chapter']:<14} {x['name']:<22} 생성 {x['created']}  https://docs.google.com/spreadsheets/d/{x['id']}")
    if skipped:
        print(f"\n이름은 같지만 건드리지 않은 파일 {len(skipped)}개:")
        for nm, sid, why in skipped:
            print(f"  {nm:<22} {sid}  {why}")
    if not a.apply:
        print("\n[dry-run] 표지·이름 변경 없음. --apply 를 붙일 것.")
        return 0

    done = 0
    for x in found:
        link = f"https://docs.google.com/spreadsheets/d/{x['official_id']}" if x["official_id"] else "(RPI Viewer 의 현재 링크)"
        notice = f"⚠ 이 시트는 옛 버전입니다 (갱신 중지). 현재 시트 → {link}"
        try:
            meta = sheets.spreadsheets().get(spreadsheetId=x["id"], fields="sheets.properties(sheetId,title,index)").execute()
            first = sorted(meta["sheets"], key=lambda s: s["properties"]["index"])[0]["properties"]
            sheets.spreadsheets().batchUpdate(spreadsheetId=x["id"], body={"requests": [
                {"insertDimension": {"range": {"sheetId": first["sheetId"], "dimension": "ROWS", "startIndex": 0, "endIndex": 1},
                                     "inheritFromBefore": False}}]}).execute()
            sheets.spreadsheets().values().update(
                spreadsheetId=x["id"], range=f"'{first['title']}'!A1", valueInputOption="RAW",
                body={"values": [[notice]]}).execute()
            drive.files().update(fileId=x["id"], body={"name": x["name"] + SUFFIX}).execute()
            done += 1
            print(f"  ✅ {x['name']} → 표지 + 이름 변경")
        except Exception as e:                                 # noqa: BLE001
            print(f"  ❌ {x['name']}: {str(e)[:120]}")
    print(f"\n처리 {done}/{len(found)}")
    return 0 if done == len(found) else 1


if __name__ == "__main__":
    sys.exit(main())
