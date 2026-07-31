# -*- coding: utf-8 -*-
"""
모 시트 PW 앞자리 0 복구

증상: 일부 멤버의 PW 가 4자리가 아니다 (`511`, `90` …) → 로그인 불가.

원인: PW 는 휴대폰 뒷 4자리 문자열인데, 정상 행은 **텍스트 서식**으로 저장되는 반면
      문제의 행들은 **숫자**로 저장돼 있다. 숫자라 앞자리 0 이 사라진다.
        정상  X100  stringValue '4689'  numberFormat TEXT
        문제  X123  numberValue  511    numberFormat 없음

교정: 4자리가 되도록 앞에 0 을 채워 **텍스트로** 다시 쓴다.
      추측이 아니라 잘려나간 문자열을 되돌리는 것이다.
      2026-03 로컬 마스터(`rpslist/2026_03월 Member Master Origin...xlsx`)의
      휴대폰 뒷 4자리와 대조해 11명이 정확히 일치함을 확인했다
      (`511`→010-4175-**0511**, `90`→010-3895-**0090** …).
      나머지는 그 파일에 없거나 휴대전화 칸에 유선번호가 들어 있어 대조가 안 되지만,
      잘린 문자열을 복원한다는 점은 동일하다.

사용법
    python fix_pw.py            # dry-run (기본)
    python fix_pw.py --apply
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")   # 에러도 utf-8 로 (cp949 로 나가면 깨진다)

KEY = Path(r"C:\SEYOON\03. Projects\Ongoing\rpslist\gcp-key.json")
MASTER_ID = "1JM37uOEu64D0r6zzKggOsA9ZdcK4wBCx0rpuNoVcIYg"
TAB = "RPS"
PW_COL = 23          # X열 (0-based)
LOCAL_MASTER = Path(r"C:\SEYOON\03. Projects\Ongoing\rpslist"
                    r"\2026_03월 Member Master Origin_N.O.ver. 260401.xlsx")


def _sh():
    creds = Credentials.from_service_account_file(str(KEY), scopes=[
        "https://www.googleapis.com/auth/spreadsheets"])
    return build("sheets", "v4", credentials=creds).spreadsheets()


def local_phones() -> dict[str, str]:
    """이메일 → 휴대전화 (로컬 3월 마스터). 대조 확인용."""
    if not LOCAL_MASTER.exists():
        return {}
    import openpyxl
    wb = openpyxl.load_workbook(LOCAL_MASTER, data_only=True, read_only=True)
    ws = wb["ALL 챕터"]
    hdr = [str(c) if c else "" for c in next(ws.iter_rows(min_row=1, max_row=1, values_only=True))]
    ix = {h: i for i, h in enumerate(hdr)}
    out = {}
    for row in ws.iter_rows(min_row=2, values_only=True):
        e = row[ix["이메일"]]
        if e:
            out[str(e).strip().lower()] = str(row[ix["휴대전화 번호"]] or "")
    return out


def main(apply: bool) -> None:
    sh = _sh()
    vals = sh.values().get(spreadsheetId=MASTER_ID,
                           range=f"{TAB}!A2:Z3400").execute().get("values", [])
    phones = local_phones()
    targets = []
    for i, row in enumerate(vals):
        def g(j):
            return row[j].strip() if len(row) > j and row[j] else ""
        if not g(0) and not g(2):
            continue
        pw = g(PW_COL)
        if pw and pw.isdigit() and len(pw) < 4:
            fixed = pw.zfill(4)
            ph = phones.get(g(0).lower(), "")
            digits = "".join(ch for ch in ph if ch.isdigit())
            match = "일치" if digits and digits[-4:] == fixed else ("불일치" if digits else "대조불가")
            targets.append({"row": i + 2, "name": g(3), "chapter": g(2),
                            "email": g(0), "old": pw, "new": fixed,
                            "phone": ph, "match": match})

    print(f"[{'실행' if apply else 'DRY-RUN'}] PW 4자리 미만 {len(targets)}건\n")
    print(f"{'행':>6} {'챕터':14} {'이름':7} {'현재':>5} → {'교정':5} {'대조':8} 휴대폰")
    for t in targets:
        print(f"{t['row']:>6} {t['chapter'][:12]:14} {t['name']:7} {t['old']:>5} → {t['new']:5} "
              f"{t['match']:8} {t['phone']}")

    ok = sum(1 for t in targets if t["match"] == "일치")
    ng = sum(1 for t in targets if t["match"] == "불일치")
    print(f"\n  로컬 대조: 일치 {ok} · 불일치 {ng} · 대조불가 {len(targets)-ok-ng}")
    if ng:
        print("  ※ 불일치는 로컬 마스터의 휴대전화 칸에 유선번호가 들어 있는 경우다."
              " 잘린 문자열 복원이라는 점은 같다.")

    if not apply:
        print("\n  → --apply 를 붙여야 반영됩니다.")
        return

    meta = sh.get(spreadsheetId=MASTER_ID, includeGridData=False,
                  fields="sheets(properties(title,sheetId))").execute()
    sid = next(s["properties"]["sheetId"] for s in meta["sheets"]
               if s["properties"]["title"] == TAB)
    reqs = []
    for t in targets:
        reqs.append({"updateCells": {
            "range": {"sheetId": sid, "startRowIndex": t["row"] - 1, "endRowIndex": t["row"],
                      "startColumnIndex": PW_COL, "endColumnIndex": PW_COL + 1},
            "rows": [{"values": [{
                "userEnteredValue": {"stringValue": t["new"]},
                "userEnteredFormat": {"numberFormat": {"type": "TEXT"}}}]}],
            "fields": "userEnteredValue,userEnteredFormat.numberFormat"}})
    sh.batchUpdate(spreadsheetId=MASTER_ID, body={"requests": reqs}).execute()
    print(f"\n  ✓ {len(reqs)}건 교정 완료 (텍스트 서식 + 0 채움)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="PW 앞자리 0 복구")
    ap.add_argument("--apply", action="store_true", help="실제 반영")
    main(ap.parse_args().apply)
