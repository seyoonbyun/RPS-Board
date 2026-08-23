# -*- coding: utf-8 -*-
r"""`담당자 연락처` — 문자 수신처의 **정본**.

    python contacts.py            # 명단 · 연락처 채워진 비율
    python contacts.py --missing  # 번호 없는 사람만

왜 `Auth` 시트가 아닌가
    `Auth` 는 **로그인·권한** 시트다. 거기에 연락처를 얹으면 성격이 다른 두 가지가
    한 표에 섞이고, 권한을 만지다 연락처를 날리기 쉽다. 무엇보다 **정본이 두 곳이 되면
    반드시 어긋난다** — 그래서 여기 하나만 둔다.

⚠ 문자 수신은 `문자수신` 열이 `N` 이면 **보내지 않는다**(옵트아웃).
⚠ 웹앱(`api/_lib/google-sheets.ts` `getContactPhone`/`setContactPhone`)도 같은 탭을 쓴다.
"""
from __future__ import annotations

import argparse
import re
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import proclog                                              # noqa: E402

SID = proclog.SID
TAB = "담당자 연락처"
HEADER = ["지역", "담당자명", "이메일", "연락처", "권한", "문자수신", "비고", "갱신"]
C_REGION, C_NAME, C_EMAIL, C_PHONE, C_AUTH, C_OPTIN, C_NOTE, C_MTIME = range(8)


def _svc():
    return proclog._svc()


def _pad(row: list) -> list:
    return list(row) + [""] * max(0, len(HEADER) - len(row))


def read_all(svc=None) -> list[list]:
    rows = (svc or _svc()).spreadsheets().values().get(
        spreadsheetId=SID, range=f"'{TAB}'!A2:H5000",
        valueRenderOption="FORMATTED_VALUE").execute().get("values", [])
    return [_pad(r) for r in rows]


def normalize(phone: str) -> str:
    """`010-1234-5678` · `+82 10 …` → `01012345678`. 형식이 아니면 빈 문자열."""
    d = re.sub(r"\D", "", phone or "")
    if d.startswith("8210"):
        d = "0" + d[2:]
    return d if re.fullmatch(r"01\d{8,9}", d) else ""


def phone_index(svc=None) -> dict[str, str]:
    """{이메일(소문자): 연락처}. **`문자수신 = N` 은 넣지 않는다**(옵트아웃)."""
    idx = {}
    for r in read_all(svc):
        email = r[C_EMAIL].strip().lower()
        phone = normalize(r[C_PHONE])
        if not email or not phone:
            continue
        if r[C_OPTIN].strip().upper() in ("N", "NO", "FALSE"):
            continue
        idx[email] = phone
    return idx


def find_row(email: str, svc=None) -> int:
    for i, r in enumerate(read_all(svc), start=2):
        if r[C_EMAIL].strip().lower() == email.strip().lower():
            return i
    return 0


def set_phone(email: str, phone: str, *, name: str = "", region: str = "",
              auth: str = "", svc=None) -> bool:
    """번호 기록. 명단에 없는 사람이면 **행을 새로 만든다**(게시판에 처음 글을 쓴 사람)."""
    svc = svc or _svc()
    d = normalize(phone)
    if not d:
        return False
    today = f"{datetime.now():%Y-%m-%d}"
    n = find_row(email, svc)
    if n:
        svc.spreadsheets().values().batchUpdate(
            spreadsheetId=SID, body={"valueInputOption": "RAW", "data": [
                {"range": f"'{TAB}'!D{n}", "values": [[d]]},
                {"range": f"'{TAB}'!H{n}", "values": [[today]]}]}).execute()
        return True
    row = [region, name, email.strip(), d, auth or "Admin", "Y", "", today]
    svc.spreadsheets().values().append(
        spreadsheetId=SID, range=f"'{TAB}'!A:H", valueInputOption="RAW",
        insertDataOption="INSERT_ROWS", body={"values": [row]}).execute()
    return True


def ensure_tab(svc=None) -> str:
    svc = svc or _svc()
    meta = svc.spreadsheets().get(spreadsheetId=SID, fields="sheets.properties").execute()
    if not any(s["properties"]["title"] == TAB for s in meta["sheets"]):
        svc.spreadsheets().batchUpdate(spreadsheetId=SID, body={"requests": [
            {"addSheet": {"properties": {"title": TAB, "gridProperties": {
                "rowCount": 3000, "columnCount": len(HEADER),
                "frozenRowCount": 1}}}}]}).execute()
        svc.spreadsheets().values().update(
            spreadsheetId=SID, range=f"'{TAB}'!A1:H1",
            valueInputOption="RAW", body={"values": [HEADER]}).execute()
        return "생성"
    got = svc.spreadsheets().values().get(
        spreadsheetId=SID, range=f"'{TAB}'!A1:H1").execute().get("values", [[]])[0]
    return "정상" if _pad(got) == HEADER else f"헤더 불일치: {got}"


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="담당자 연락처")
    ap.add_argument("--missing", action="store_true", help="번호 없는 사람만")
    a = ap.parse_args()
    svc = _svc()
    print(f"탭 `{TAB}` — {ensure_tab(svc)}")
    rows = read_all(svc)
    have = [r for r in rows if normalize(r[C_PHONE])]
    out = [r for r in rows if not normalize(r[C_PHONE])] if a.missing else rows
    print(f"{len(rows)}명 · 연락처 {len(have)}명 "
          f"({len(have) * 100 // max(1, len(rows))}%) · 미등록 {len(rows) - len(have)}명\n")
    for r in out:
        mark = "·" if normalize(r[C_PHONE]) else "⚠"
        opt = "" if r[C_OPTIN].strip().upper() not in ("N", "NO") else "  [문자수신 N]"
        print(f" {mark} {r[C_REGION]:<16} {r[C_NAME]:<8} {r[C_EMAIL]:<32} "
              f"{normalize(r[C_PHONE]) or '(없음)'}{opt}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
