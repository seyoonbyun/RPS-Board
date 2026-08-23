# -*- coding: utf-8 -*-
r"""`rps new account` — 신규 지역 등록·게시판 문의 처리의 **단일 대장**.

    python proclog.py                 # 대장 보기
    python proclog.py --check         # 탭·헤더 점검 (없으면 만든다)

구조는 이벤트 나열이 아니라 **건당 1행**이다. 접수 때 행을 열고, 진행에 따라 같은 행을
갱신한다. "그 문의 어떻게 됐나"를 한 줄로 답하기 위해서다.

    A 접수일시   B 흐름     C 대상(키)   D 담당자   E 이메일   F 연락처
    G 내용       H 처리현황  I 개선내용   J 처리일시
    K 문자-접수  L 문자-완료 M 답신내용   N 진행로그  O 최종수정

`대상`(C) 이 키다. 게시판은 `게시판 #<BoardLog 행번호>`, 지역은 `지역 <Eng> <Kor>`.
같은 키로 다시 열지 않고 **갱신**한다 — 워커가 3분마다 도는데 매번 행이 늘면 대장이 아니다.

⚠ 기록이 실패해도 작업을 멈추지 않는다. 로그 때문에 등록이 죽으면 본말전도다.
⚠ 웹앱(TypeScript)도 **같은 탭·같은 열**에 쓴다 — `api/_lib/google-sheets.ts` `logProcess()`.
   열을 바꾸면 양쪽을 같이 고칠 것.
⚠ `답신내용` 은 **우리가 보낸 답신 문자 본문**이다. 상대가 문자로 되보낸 것은 솔라피
   수신 설정이 없어 들어오지 않는다 — 들어오는 답은 게시판 글로만 남는다.
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

SID = "1JM37uOEu64D0r6zzKggOsA9ZdcK4wBCx0rpuNoVcIYg"   # MY PowerTeam (archive)
TAB = "rps new account"
HEADER = ["접수일시", "흐름", "대상", "담당자", "이메일", "연락처", "내용",
          "처리현황", "개선내용", "처리일시", "문자-접수", "문자-완료",
          "답신내용", "진행로그", "최종수정"]

# 열 인덱스 (0-based) — 이름으로 쓰면 오프셋 실수가 안 난다
C_TS, C_FLOW, C_KEY, C_OWNER, C_EMAIL, C_PHONE, C_BODY = 0, 1, 2, 3, 4, 5, 6
C_STATUS, C_FIX, C_DONE_TS, C_SMS_IN, C_SMS_OUT, C_REPLY, C_TRACE, C_MTIME = \
    7, 8, 9, 10, 11, 12, 13, 14

FLOW_REGION = "지역등록"
FLOW_BOARD = "게시판"

# 처리현황 — 사람이 시트에서 눈으로 고를 수 있는 말로 둔다
ST_RECEIVED = "접수"
ST_RUNNING = "진행중"
ST_DONE = "완료"
ST_HOLD = "보류"
ST_FAILED = "실패"


def _svc():
    from google_auth import user_credentials
    from googleapiclient.discovery import build
    return build("sheets", "v4", credentials=user_credentials(), cache_discovery=False)


def stamp() -> str:
    """기존 로그 탭들과 같은 표기 — `2026-08-23,14-05-31`."""
    return datetime.now().strftime("%Y-%m-%d,%H-%M-%S")


def _pad(row: list, n: int = len(HEADER)) -> list:
    return list(row) + [""] * max(0, n - len(row))


def read_all(svc=None) -> list[list]:
    rows = (svc or _svc()).spreadsheets().values().get(
        spreadsheetId=SID, range=f"'{TAB}'!A2:O100000",
        valueRenderOption="FORMATTED_VALUE").execute().get("values", [])
    return [_pad(r) for r in rows]


def find(key: str, rows: list[list] | None = None, svc=None) -> int | None:
    """키가 있는 **시트 행번호**(1-based, 헤더 포함)를 준다. 없으면 None."""
    rows = rows if rows is not None else read_all(svc)
    k = key.strip()
    for i, r in enumerate(rows, start=2):
        if r[C_KEY].strip() == k:
            return i
    return None


def open_row(flow: str, key: str, *, owner: str = "", email: str = "",
             phone: str = "", body: str = "", status: str = ST_RECEIVED,
             svc=None) -> int:
    """접수 행을 연다. **이미 있으면 열지 않고 그 행번호를 준다**(중복 방지)."""
    svc = svc or _svc()
    existing = find(key, svc=svc)
    if existing:
        return existing
    row = [""] * len(HEADER)
    row[C_TS] = stamp()
    row[C_FLOW] = flow
    row[C_KEY] = key.strip()
    row[C_OWNER] = owner
    row[C_EMAIL] = email
    row[C_PHONE] = phone
    row[C_BODY] = str(body)[:2000]
    row[C_STATUS] = status
    row[C_MTIME] = row[C_TS]
    svc.spreadsheets().values().append(
        spreadsheetId=SID, range=f"'{TAB}'!A:O", valueInputOption="RAW",
        insertDataOption="INSERT_ROWS", body={"values": [row]}).execute()
    return find(key, svc=svc) or -1


def update(key: str, *, svc=None, trace: str = "", **fields) -> bool:
    """같은 행을 갱신한다. `trace` 를 주면 `진행로그` 에 **줄을 덧붙인다**(덮어쓰지 않는다).

    fields 는 열 이름 그대로 — status/fix/done_ts/sms_in/sms_out/reply/phone/owner/body.
    """
    svc = svc or _svc()
    rows = read_all(svc)
    n = find(key, rows, svc)
    if not n:
        return False
    row = rows[n - 2]
    m = {"owner": C_OWNER, "email": C_EMAIL, "phone": C_PHONE, "body": C_BODY,
         "status": C_STATUS, "fix": C_FIX, "done_ts": C_DONE_TS,
         "sms_in": C_SMS_IN, "sms_out": C_SMS_OUT, "reply": C_REPLY}
    for k, v in fields.items():
        if k in m and v is not None:
            row[m[k]] = str(v)[:2000]
    if trace:
        prev = row[C_TRACE]
        line = f"{datetime.now():%m-%d %H:%M} {trace}"
        row[C_TRACE] = (prev + "\n" + line if prev else line)[-4000:]
    row[C_MTIME] = stamp()
    try:
        svc.spreadsheets().values().update(
            spreadsheetId=SID, range=f"'{TAB}'!A{n}:O{n}",
            valueInputOption="RAW", body={"values": [row]}).execute()
        return True
    except Exception as e:                                   # noqa: BLE001
        print(f"   [대장] 갱신 실패 {key}: {e}", file=sys.stderr)
        return False


def sms_note(ok: bool, to: str, what: str = "") -> str:
    """`문자-접수`·`문자-완료` 칸에 넣을 한 줄. 성공·실패·수신처가 다 보이게."""
    import os
    mode = "" if os.environ.get("MYPT_SMS_LIVE", "").strip() in ("1", "true", "yes") else "(테스트) "
    head = "발송" if ok else "실패"
    return f"{mode}{head} {datetime.now():%m-%d %H:%M} → {to}" + (f" · {what}" if what else "")


def ensure_tab(svc=None) -> str:
    """탭·헤더 점검. 없으면 만들고, 헤더가 다르면 알려만 준다(데이터를 덮지 않는다)."""
    svc = svc or _svc()
    meta = svc.spreadsheets().get(spreadsheetId=SID, fields="sheets.properties").execute()
    if not any(s["properties"]["title"] == TAB for s in meta["sheets"]):
        svc.spreadsheets().batchUpdate(spreadsheetId=SID, body={"requests": [
            {"addSheet": {"properties": {"title": TAB, "gridProperties": {
                "rowCount": 5000, "columnCount": len(HEADER),
                "frozenRowCount": 1}}}}]}).execute()
        svc.spreadsheets().values().update(
            spreadsheetId=SID, range=f"'{TAB}'!A1:O1",
            valueInputOption="RAW", body={"values": [HEADER]}).execute()
        return "생성"
    got = svc.spreadsheets().values().get(
        spreadsheetId=SID, range=f"'{TAB}'!A1:O1").execute().get("values", [[]])[0]
    return "정상" if _pad(got) == HEADER else f"헤더 불일치: {got}"


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="rps new account 대장")
    ap.add_argument("--check", action="store_true", help="탭·헤더 점검")
    a = ap.parse_args()

    svc = _svc()
    print(f"탭 `{TAB}` — {ensure_tab(svc)}")
    if a.check:
        return 0
    rows = read_all(svc)
    print(f"{len(rows)}건\n")
    for i, r in enumerate(rows, start=2):
        print(f" {i:>3} [{r[C_FLOW]}] {r[C_KEY]}  · {r[C_OWNER] or '-'} · {r[C_STATUS] or '-'}")
        if r[C_BODY]:
            print(f"      내용   {r[C_BODY][:70]}")
        if r[C_SMS_IN] or r[C_SMS_OUT]:
            print(f"      문자   접수={r[C_SMS_IN] or '-'} / 완료={r[C_SMS_OUT] or '-'}")
        if r[C_FIX]:
            print(f"      개선   {r[C_FIX][:70]}")
    if not rows:
        print(" (아직 없음)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
