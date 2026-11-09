# -*- coding: utf-8 -*-
r"""어드민 API 로 멤버를 탈퇴 처리한다 — 담당자의 삭제가 서버에 닿지 않았을 때 대신 처리하는 용도.

    python admin_withdraw.py --emails a@x.com b@y.com            # 실제 처리
    python admin_withdraw.py --emails a@x.com --dry              # 대상 행만 보여 준다

웹앱의 `/api/admin/bulk-withdrawal` 을 그대로 부르므로 어드민 화면에서 누른 것과 똑같이
RPS 행 삭제 → `WithdrawalHistory` 보관(R파트너 값까지) → `AdminLog` 기록이 남고,
어드민 화면의 「탈퇴 멤버 복원」으로 되돌릴 수 있다. 시트를 직접 지우지 않는다.

2026-11-09 RPS-02 8절: 서초 메디컬의 커넥트 탈퇴 멤버 2명·빈 중복 계정 1개가 RPS 에 남아 있었고
담당자의 삭제 기록이 없어 여기로 처리했다.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent))

import requests                                   # noqa: E402
from google_auth import user_credentials          # noqa: E402
from googleapiclient.discovery import build       # noqa: E402

MASTER = "1JM37uOEu64D0r6zzKggOsA9ZdcK4wBCx0rpuNoVcIYg"
API = "https://www.rps-bnikorea.com/api/admin/bulk-withdrawal"
CALLER = "joy.byun@bnikorea.com"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--emails", nargs="+", required=True)
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    targets = {e.strip().lower() for e in a.emails}

    svc = build("sheets", "v4", credentials=user_credentials(), cache_discovery=False)
    rows = svc.spreadsheets().values().get(spreadsheetId=MASTER, range="RPS!A1:Z").execute().get("values", [])
    found = []
    for i, r in enumerate(rows[1:], start=2):
        if r and r[0].strip().lower() in targets:
            r = r + [""] * (26 - len(r))
            found.append(r[0].strip().lower())
            print(f"{i}행 {r[3]} ({r[0]}) {r[1]} / {r[2]} · R파트너 {[r[k] for k in (8, 11, 14, 17)]} · 총 {r[20]!r}")
    missing = sorted(targets - set(found))
    if missing:
        print("⚠ RPS 에 없음:", missing)
    if a.dry or not found:
        print("[dry] 처리하지 않음" if a.dry else "처리할 대상 없음")
        return 0

    r = requests.post(API, headers={"x-caller-email": CALLER, "Content-Type": "application/json"},
                      data=json.dumps({"userEmails": sorted(found), "adminEmail": CALLER}, ensure_ascii=False).encode("utf-8"),
                      timeout=120)
    print("API:", r.status_code, r.text[:300])
    if not r.ok:
        return 1
    rows = svc.spreadsheets().values().get(spreadsheetId=MASTER, range="RPS!A1:D").execute().get("values", [])
    left = [x[0] for x in rows if x and x[0].strip().lower() in targets]
    print("남은 대상:", left or "없음")
    return 0 if not left else 1


if __name__ == "__main__":
    sys.exit(main())
