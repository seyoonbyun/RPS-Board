# -*- coding: utf-8 -*-
r"""`신청 접수` 시트의 **드롭다운을 현재 지역·챕터 현황에 맞춘다.**

    python dropdowns.py            # 현황 비교만 (쓰지 않는다)
    python dropdowns.py --apply    # 목록 갱신 + 데이터 확인(드롭다운) 재적용

왜 필요한가
    지역 표기가 어긋나면 그대로 사고가 된다 — 신청서에 `수원1` 이라 적히면
    imweb 페이지 `수원` 을 못 찾아 **신규 지역으로 오판하고 지역·ALL 페이지를 통째로
    새로 만든다.** 손으로 적게 두지 않고 고르게 만드는 이유다.

구조
    `_목록`(숨김 탭)  A열 지역 · B열 챕터 — `Master` 에서 중복 제거·정렬해 복사
    `신청 접수`        지역/챕터 칸이 `_목록` 을 참조하는 드롭다운

⚠ 드롭다운은 **경고형**(`strict=False`)이다. 목록에 없는 값도 넣을 수 있어야 한다 —
   신규 지역은 정의상 목록에 없기 때문이다. 대신 셀에 경고 표시가 뜬다.
⚠ `Master` A·B 열은 **서로 짝이 아니라 각각 독립된 목록**이다(A n행 ↔ B n행 무관계).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent))

import intake                                               # noqa: E402
import proclog                                              # noqa: E402

SID = proclog.SID
LIST_TAB = "_목록"
LIST_HEADER = ["지역", "챕터", "구분", "활성화", "처리상태", "예/아니오"]

KINDS = [intake.KIND_REGION, intake.KIND_CHAPTER]
STATUSES = [intake.ST_WAIT, intake.ST_RUNNING, intake.ST_CREATED,
            intake.ST_PUBLISHED, intake.ST_HOLD]
YESNO = ["YES", "NO"]
#: `_목록` 각 열의 0-based 인덱스
COL_REGION, COL_CHAPTER, COL_KIND, COL_ACTIVE, COL_STATUS, COL_YESNO = range(6)

MAX_ROWS = 3000


def master_lists(svc) -> tuple[list[str], list[str]]:
    rows = svc.spreadsheets().values().get(
        spreadsheetId=SID, range="'Master'!A2:B2000",
        valueRenderOption="FORMATTED_VALUE").execute().get("values", [])
    regs, chs = [], []
    for r in rows:
        r = list(r) + [""] * (2 - len(r))
        if str(r[0]).strip():
            regs.append(str(r[0]).strip())
        if str(r[1]).strip():
            chs.append(str(r[1]).strip())
    uniq = lambda xs: sorted(dict.fromkeys(xs), key=lambda s: (s.casefold(), s))  # noqa: E731
    return uniq(regs), uniq(chs)


def ensure_list_tab(svc) -> int:
    meta = svc.spreadsheets().get(spreadsheetId=SID, fields="sheets.properties").execute()
    for s in meta["sheets"]:
        if s["properties"]["title"] == LIST_TAB:
            return s["properties"]["sheetId"]
    res = svc.spreadsheets().batchUpdate(spreadsheetId=SID, body={"requests": [
        {"addSheet": {"properties": {
            "title": LIST_TAB, "hidden": True,
            "gridProperties": {"rowCount": MAX_ROWS, "columnCount": len(LIST_HEADER),
                               "frozenRowCount": 1}}}}]}).execute()
    sid = res["replies"][0]["addSheet"]["properties"]["sheetId"]
    svc.spreadsheets().values().update(
        spreadsheetId=SID, range=f"'{LIST_TAB}'!A1:F1",
        valueInputOption="RAW", body={"values": [LIST_HEADER]}).execute()
    return sid


def write_lists(svc, regs: list[str], chs: list[str]) -> None:
    n = max(len(regs), len(chs), len(KINDS), len(STATUSES), len(YESNO))
    out = []
    for i in range(n):
        out.append([
            regs[i] if i < len(regs) else "",
            chs[i] if i < len(chs) else "",
            KINDS[i] if i < len(KINDS) else "",
            YESNO[i] if i < len(YESNO) else "",
            STATUSES[i] if i < len(STATUSES) else "",
            YESNO[i] if i < len(YESNO) else "",
        ])
    # ⚠ 목록이 줄면 꼬리가 남는다 → 넉넉히 빈 줄로 덮는다.
    out += [[""] * 6] * 200
    svc.spreadsheets().values().update(
        spreadsheetId=SID, range=f"'{LIST_TAB}'!A2:F{1 + len(out)}",
        valueInputOption="RAW", body={"values": out}).execute()


def _rule(list_sid: int, col: int, n: int, help_text: str) -> dict:
    return {
        "condition": {"type": "ONE_OF_RANGE", "values": [{"userEnteredValue":
            f"='{LIST_TAB}'!{chr(ord('A') + col)}2:{chr(ord('A') + col)}{1 + max(n, 1)}"}]},
        "showCustomUi": True,
        # strict=False — 신규 지역은 **정의상 목록에 없다.** 막으면 신청 자체가 안 된다.
        "strict": False,
        "inputMessage": help_text,
    }


def apply_validation(svc, intake_sid: int, list_sid: int,
                     n_reg: int, n_ch: int) -> None:
    def rng(col: int) -> dict:
        return {"sheetId": intake_sid, "startRowIndex": 1, "endRowIndex": MAX_ROWS,
                "startColumnIndex": col, "endColumnIndex": col + 1}

    reqs = [
        {"setDataValidation": {"range": rng(intake.C_KIND),
                               "rule": _rule(list_sid, COL_KIND, len(KINDS),
                                             "지역 / 챕터")}},
        {"setDataValidation": {"range": rng(intake.C_REGION),
                               "rule": _rule(list_sid, COL_REGION, n_reg,
                                             "등록된 지역 표기. 신규 지역이면 새로 입력하세요")}},
        {"setDataValidation": {"range": rng(intake.C_CHAPTER),
                               "rule": _rule(list_sid, COL_CHAPTER, n_ch,
                                             "등록된 챕터. 신규 챕터면 새로 입력하세요")}},
        {"setDataValidation": {"range": rng(intake.C_CONNECT),
                               "rule": _rule(list_sid, COL_YESNO, len(YESNO),
                                             "BNI Connect 지원서 등록 완료 여부")}},
        {"setDataValidation": {"range": rng(intake.C_ACTIVE),
                               "rule": _rule(list_sid, COL_ACTIVE, len(YESNO),
                                             "YES 여야 워커가 집어간다")}},
        {"setDataValidation": {"range": rng(intake.C_STATUS),
                               "rule": _rule(list_sid, COL_STATUS, len(STATUSES),
                                             "처리 상태")}},
    ]
    svc.spreadsheets().batchUpdate(spreadsheetId=SID, body={"requests": reqs}).execute()


def main() -> int:
    ap = argparse.ArgumentParser(description="신청 접수 드롭다운을 현황에 맞춘다")
    ap.add_argument("--apply", action="store_true", help="실제 갱신")
    a = ap.parse_args()

    svc = proclog._svc()
    regs, chs = master_lists(svc)
    print(f"Master 현황 — 지역 {len(regs)}개 · 챕터 {len(chs)}개")

    meta = svc.spreadsheets().get(spreadsheetId=SID, fields="sheets.properties").execute()
    tabs = {s["properties"]["title"]: s["properties"] for s in meta["sheets"]}
    if intake.TAB not in tabs:
        print(f"⛔ `{intake.TAB}` 탭이 없다 — `python intake.py --check` 먼저")
        return 1

    cur = []
    if LIST_TAB in tabs:
        cur = svc.spreadsheets().values().get(
            spreadsheetId=SID, range=f"'{LIST_TAB}'!A2:A2000",
            valueRenderOption="FORMATTED_VALUE").execute().get("values", [])
    cur_regs = [str(r[0]).strip() for r in cur if r and str(r[0]).strip()]
    added = [r for r in regs if r not in cur_regs]
    gone = [r for r in cur_regs if r not in regs]
    print(f"드롭다운 목록 — 현재 {len(cur_regs)}개 · 추가 {len(added)} · 제거 {len(gone)}")
    if added:
        print("   + " + ", ".join(added))
    if gone:
        print("   - " + ", ".join(gone))

    if not a.apply:
        print("\n[dry-run] 쓰지 않았다. --apply 를 붙일 것.")
        return 0

    list_sid = ensure_list_tab(svc)
    write_lists(svc, regs, chs)
    apply_validation(svc, tabs[intake.TAB]["sheetId"], list_sid, len(regs), len(chs))
    print(f"\n✓ `{LIST_TAB}` 갱신 · `{intake.TAB}` 드롭다운 6개 열 적용")
    print("   지역·챕터·구분·Connect등록·활성화·처리상태")
    return 0


if __name__ == "__main__":
    sys.exit(main())
