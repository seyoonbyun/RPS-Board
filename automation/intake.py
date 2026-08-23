# -*- coding: utf-8 -*-
r"""`신청 접수` — 신규 **지역·챕터** 신청이 모이는 입구.

    python intake.py            # 접수 현황
    python intake.py --check    # 탭·헤더 점검 (없으면 만든다)

2026-08-23 **Airtable 에서 구글시트로 되돌렸다.**
Airtable 은 우리 것이라 상태를 한 곳에 둘 수 있다는 게 장점이었는데, 정작
"모든 과정이 한곳에" 를 하려니 **토큰이 필요한 별도 저장소**라는 게 더 큰 단점이 됐다.
옮길 때 레코드가 **0건**이라 이관 비용이 없었다.

`신청 접수`(입구) 와 `rps new account`(처리 대장) 는 **일부러 나눠 둔다.**
    신청 접수      사람이 신청한 원본 — 무엇을 요청했나
    rps new account 처리 경과 — 어디까지 됐고 문자가 나갔나
둘은 같은 키(`지역 <Eng> <Kor>` · `챕터 <Eng>`)로 이어진다.

⚠ 웹앱(`api/_lib/google-sheets.ts` `addIntakeRow`)도 **같은 탭·같은 열**에 쓴다.
   열을 바꾸면 양쪽을 같이 고칠 것.
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import proclog                                              # noqa: E402

SID = proclog.SID
TAB = "신청 접수"
HEADER = ["접수일시", "구분", "지역", "지역영문", "챕터", "챕터영문", "런칭예정일",
          "담당자", "이메일", "연락처", "Connect등록", "활성화", "처리상태",
          "비고", "결과시트", "결과페이지", "처리로그", "최종수정"]

(C_TS, C_KIND, C_REGION, C_REGION_ENG, C_CHAPTER, C_CHAPTER_ENG, C_LAUNCH,
 C_OWNER, C_EMAIL, C_PHONE, C_CONNECT, C_ACTIVE, C_STATUS,
 C_NOTE, C_SHEET, C_PAGE, C_LOG, C_MTIME) = range(18)

KIND_REGION = "지역"
KIND_CHAPTER = "챕터"

ST_WAIT = "대기"
ST_RUNNING = "처리중"
ST_CREATED = "생성완료"
ST_PUBLISHED = "게시완료"
ST_HOLD = "보류"
#: 아직 손대지 않은 것으로 보는 상태. 빈 값도 포함한다.
OPEN_STATUS = {"", ST_WAIT}


def _svc():
    return proclog._svc()


def stamp() -> str:
    return proclog.stamp()


def _pad(row: list) -> list:
    return list(row) + [""] * max(0, len(HEADER) - len(row))


def read_all(svc=None) -> list[list]:
    rows = (svc or _svc()).spreadsheets().values().get(
        spreadsheetId=SID, range=f"'{TAB}'!A2:R100000",
        valueRenderOption="FORMATTED_VALUE").execute().get("values", [])
    return [_pad(r) for r in rows]


def key_of(row: list) -> str:
    """대장 `rps new account` 와 이어 붙이는 키."""
    if row[C_KIND].strip() == KIND_REGION:
        eng, kor = row[C_REGION_ENG].strip(), row[C_REGION].strip()
        # `지역` 칸에 이미 모 시트 표기(`Suwon2 수원2`)가 들어오면 그대로 쓴다
        return f"지역 {kor}" if kor.startswith(eng + " ") else f"지역 {eng} {kor}".strip()
    return f"챕터 {row[C_CHAPTER_ENG].strip() or row[C_CHAPTER].strip()}"


def applications(svc=None) -> list[dict]:
    """행 → 다루기 쉬운 dict. `row` 는 시트 행번호(1-based)."""
    out = []
    for i, r in enumerate(read_all(svc), start=2):
        if not any(str(x).strip() for x in r):
            continue
        out.append({
            "row": i, "key": key_of(r), "kind": r[C_KIND].strip(),
            "region_kor": r[C_REGION].strip(), "region_eng": r[C_REGION_ENG].strip(),
            "chapter_kor": r[C_CHAPTER].strip(), "chapter_eng": r[C_CHAPTER_ENG].strip(),
            "launch": r[C_LAUNCH].strip(), "owner": r[C_OWNER].strip(),
            "email": r[C_EMAIL].strip(), "owner_phone": r[C_PHONE].strip(),
            "connect_ok": r[C_CONNECT].strip().upper() in ("YES", "Y", "TRUE"),
            "active": r[C_ACTIVE].strip().upper() in ("YES", "Y", "TRUE"),
            "status": r[C_STATUS].strip(), "note": r[C_NOTE].strip(),
            "sheet": r[C_SHEET].strip(), "page": r[C_PAGE].strip(),
            "log": r[C_LOG].strip(), "ts": r[C_TS].strip(),
        })
    return out


def pending(kind: str = "", apps: list[dict] | None = None, svc=None) -> list[dict]:
    """처리 대상.

    챕터는 **`활성화 = YES` 인 것만** — 런칭이 확정되기 전에 페이지를 만들면
    되돌릴 수가 없다(imweb 은 삭제 API 가 없다). 지역은 그 게이트가 없다.
    """
    apps = apps if apps is not None else applications(svc)
    out = [a for a in apps if a["status"] in OPEN_STATUS]
    if kind:
        out = [a for a in out if a["kind"] == kind]
    return [a for a in out if a["kind"] != KIND_CHAPTER or a["active"]]


def add(kind: str, *, region_kor="", region_eng="", chapter_kor="", chapter_eng="",
        launch="", owner="", email="", phone="", connect_ok=False, active=False,
        note="", svc=None) -> int:
    """접수 1건. 시트 행번호를 준다."""
    svc = svc or _svc()
    ts = stamp()
    row = [""] * len(HEADER)
    row[C_TS], row[C_KIND] = ts, kind
    row[C_REGION], row[C_REGION_ENG] = region_kor, region_eng
    row[C_CHAPTER], row[C_CHAPTER_ENG] = chapter_kor, chapter_eng
    row[C_LAUNCH], row[C_OWNER], row[C_EMAIL], row[C_PHONE] = launch, owner, email, phone
    row[C_CONNECT] = "YES" if connect_ok else "NO"
    row[C_ACTIVE] = "YES" if active else "NO"
    row[C_STATUS], row[C_NOTE], row[C_MTIME] = ST_WAIT, note, ts
    r = svc.spreadsheets().values().append(
        spreadsheetId=SID, range=f"'{TAB}'!A:R", valueInputOption="RAW",
        insertDataOption="INSERT_ROWS", body={"values": [row]}).execute()
    rng = (r.get("updates") or {}).get("updatedRange", "")
    import re
    m = re.search(r"![A-Z]+(\d+)", rng)
    return int(m.group(1)) if m else 0


def update(row_no: int, *, svc=None, log: str = "", **fields) -> bool:
    """행 갱신. `log` 를 주면 `처리로그` 에 **줄을 덧붙인다**(덮어쓰지 않는다)."""
    svc = svc or _svc()
    got = svc.spreadsheets().values().get(
        spreadsheetId=SID, range=f"'{TAB}'!A{row_no}:R{row_no}",
        valueRenderOption="FORMATTED_VALUE").execute().get("values", [[]])
    row = _pad(got[0] if got else [])
    m = {"status": C_STATUS, "region_eng": C_REGION_ENG, "chapter_eng": C_CHAPTER_ENG,
         "sheet": C_SHEET, "page": C_PAGE, "note": C_NOTE, "phone": C_PHONE,
         "launch": C_LAUNCH, "active": C_ACTIVE, "connect": C_CONNECT}
    for k, v in fields.items():
        if k in m and v is not None:
            row[m[k]] = str(v)[:2000]
    if log:
        line = f"{datetime.now():%m-%d %H:%M} {log}"
        row[C_LOG] = ((row[C_LOG] + "\n" + line) if row[C_LOG] else line)[-4000:]
    row[C_MTIME] = stamp()
    try:
        svc.spreadsheets().values().update(
            spreadsheetId=SID, range=f"'{TAB}'!A{row_no}:R{row_no}",
            valueInputOption="RAW", body={"values": [row]}).execute()
        return True
    except Exception as e:                                   # noqa: BLE001
        print(f"   [접수] 갱신 실패 {row_no}행: {e}", file=sys.stderr)
        return False


def ensure_tab(svc=None) -> str:
    svc = svc or _svc()
    meta = svc.spreadsheets().get(spreadsheetId=SID, fields="sheets.properties").execute()
    if not any(s["properties"]["title"] == TAB for s in meta["sheets"]):
        svc.spreadsheets().batchUpdate(spreadsheetId=SID, body={"requests": [
            {"addSheet": {"properties": {"title": TAB, "gridProperties": {
                "rowCount": 3000, "columnCount": len(HEADER),
                "frozenRowCount": 1}}}}]}).execute()
        svc.spreadsheets().values().update(
            spreadsheetId=SID, range=f"'{TAB}'!A1:R1",
            valueInputOption="RAW", body={"values": [HEADER]}).execute()
        return "생성"
    got = svc.spreadsheets().values().get(
        spreadsheetId=SID, range=f"'{TAB}'!A1:R1").execute().get("values", [[]])[0]
    return "정상" if _pad(got) == HEADER else f"헤더 불일치: {got}"


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="신청 접수 현황")
    ap.add_argument("--check", action="store_true", help="탭·헤더 점검")
    a = ap.parse_args()
    svc = _svc()
    print(f"탭 `{TAB}` — {ensure_tab(svc)}")
    if a.check:
        return 0
    apps = applications(svc)
    todo = pending(apps=apps)
    print(f"접수 {len(apps)}건 · 미처리 {len(todo)}건\n")
    for x in apps:
        mark = "▶" if x in todo else ("…" if x["status"] else "·")
        gate = "" if (x["kind"] != KIND_CHAPTER or x["active"]) else "  (활성화 미체크 — 대상 아님)"
        what = (x["region_kor"] or x["region_eng"]) if x["kind"] == KIND_REGION \
            else f"{x['region_kor']} {x['chapter_kor']}"
        print(f" {mark} [{x['kind']}] {what} · 담당 {x['owner'] or '-'} "
              f"· 상태 {x['status'] or '(빈값)'}{gate}")
    if not apps:
        print(" (아직 없음)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
