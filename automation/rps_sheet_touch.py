# -*- coding: utf-8 -*-
r"""RPS_Sheets 폴더의 챕터·지역 `_rps` 시트를 전부 한 번씩 읽어 IMPORTRANGE 를 깨운다.

    python rps_sheet_touch.py            # 전 시트 읽기 + 요약
    python rps_sheet_touch.py --only Medical_rps Promise_rps

왜 필요한가 (2026-11-09, 게시판 #18·#19 서초 김희섭)
    `_rps` 시트는 데이터가 아니라 모 시트를 끌어오는 **QUERY(IMPORTRANGE) 뷰**다.
    IMPORTRANGE 는 문서가 열려 있을 때만 30분마다 갱신되고, 아무도 열지 않은 문서는
    지난 계산값을 그대로 보여 준다. 담당자가 어드민에서 멤버를 지우고 넣은 뒤
    RPI Viewer 링크로 시트를 열면 **몇 시간 지난 명단**이 보일 수 있다.
    API 로 값을 읽으면 구글이 문서를 다시 계산하므로, 주기적으로 전부 읽어 두면
    누가 언제 열어도 최신에 가깝다.

하는 일은 읽기뿐이다. 아무것도 쓰지 않는다.
    - A2:D3 만 읽는다(제목·RPI·첫 멤버 행). 계산을 깨우는 데는 이것으로 충분하다.
    - `#REF!`·빈 A3 는 IMPORTRANGE 승인/연결 문제이므로 따로 적어 올린다.
    - `#N/A` 는 QUERY 결과가 0행이라는 뜻 — 정지·폐쇄 챕터(멤버 0명) 시트가 그렇다. 정상으로 센다.

⚠ 자격증명 — 운영 웹앱(`mypowerteam@qualified-glow-467905-k0`)과 소유계정 OAuth(`client_secret.json`)는
    **같은 GCP 프로젝트**라 Sheets 읽기 한도(프로젝트당 분당 300)를 나눠 쓴다. 이 작업은 20분마다
    130여 번 읽으므로 **다른 프로젝트의 서비스계정**(`id-rps-meberlist@training-register-471610`)으로
    돈다. 그 계정은 RPS_Sheets 폴더에 writer 라 읽기엔 충분하다. 호출 간격도 1초로 둬 분당 60건 아래다.
    (2026-11-09 RPS-02 8절 — 첫 버전이 OAuth 로 돌아 운영과 한도를 나눠 쓸 뻔했다)
"""
from __future__ import annotations

import argparse
import datetime
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent))

from google_auth import enable_transient_retries                      # noqa: E402
from google.oauth2.service_account import Credentials               # noqa: E402
from googleapiclient.discovery import build                           # noqa: E402

FOLDER_ID = "1XqC-OdatL9Dxi9fJ9a3IKr_I4NKvozGf"   # RPS_Sheets
SA_KEY = Path(r"C:\Users\Gram\desktop\connect_tl_report\connect\gcp-key.json")
SCOPES = ["https://www.googleapis.com/auth/drive.readonly",
          "https://www.googleapis.com/auth/spreadsheets.readonly"]
GAP_SEC = 1.0


def folder_files(drive) -> dict[str, str]:
    out, token = {}, None
    while True:
        r = drive.files().list(
            q=f"'{FOLDER_ID}' in parents and trashed=false "
              "and mimeType='application/vnd.google-apps.spreadsheet'",
            fields="nextPageToken, files(id,name)", pageSize=400, pageToken=token,
        ).execute()
        out.update({f["name"]: f["id"] for f in r.get("files", [])})
        token = r.get("nextPageToken")
        if not token:
            return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", help="이 파일명들만")
    a = ap.parse_args()

    enable_transient_retries()
    creds = Credentials.from_service_account_file(str(SA_KEY), scopes=SCOPES)
    drive = build("drive", "v3", credentials=creds, cache_discovery=False)
    sheets = build("sheets", "v4", credentials=creds, cache_discovery=False)

    files = folder_files(drive)
    targets = {n: i for n, i in files.items() if n.lower().endswith("_rps")}
    if a.only:
        targets = {n: i for n, i in targets.items() if n in set(a.only)}
    print(f"{datetime.datetime.now():%Y-%m-%d %H:%M:%S} · _rps 시트 {len(targets)}개 읽기 시작 (서비스계정 {creds.service_account_email.split('@')[0]})")

    ok, empty, problems = 0, [], []
    for name in sorted(targets):
        sid = targets[name]
        try:
            v = sheets.spreadsheets().values().get(
                spreadsheetId=sid, range="A2:D3").execute().get("values", [])
            a3 = (v[1][0] if len(v) > 1 and v[1] else "")
            if a3 == "#N/A":
                empty.append(name)
            elif not a3 or a3.startswith("#"):
                problems.append(f"{name}: A3={a3!r} (IMPORTRANGE 연결 확인 필요)")
            else:
                ok += 1
        except Exception as e:  # noqa: BLE001
            problems.append(f"{name}: 읽기 실패 {str(e)[:120]}")
        time.sleep(GAP_SEC)

    print(f"정상 {ok}개 · 빈 결과(멤버 0명) {len(empty)}개 · 문제 {len(problems)}개")
    if empty:
        print("  빈 결과:", ", ".join(empty))
    for p in problems:
        print("  ⚠", p)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
