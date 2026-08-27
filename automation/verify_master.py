# -*- coding: utf-8 -*-
"""
모 시트(MY PowerTeam archive · RPS 탭) 전수 검수

데이터를 넣은 뒤 **셀 하나라도 수식·조건부서식·드롭다운이 빠지면 서비스가 깨진다.**
그래서 append 후에는 항상 전 행을 훑어 아래 5가지를 확인한다.

  [1] U(총 R파트너 수)·V(달성) 수식이 모든 데이터 행에 있는가
  [2] V-C-P 열(K·N·Q·T)에 드롭다운(데이터 확인)이 걸려 있는가
  [3] 조건부 서식 12개 규칙이 정본과 일치하는가
  [4] 로그인 4종 세트(W ID·X PW·Y STATUS·Z AUTH)가 온전한가
  [5] '보이진 않는데 빈칸이 아닌' 셀(빈 문자열)이 있는가
      → 이게 있으면 드롭다운 칩이 안 뜨고 조건부 서식이 오작동한다.
        API 로는 값이 없는 것처럼 보여서 눈으로는 못 찾는다. 시트에 임시 수식을
        넣어 `ISBLANK` 로 직접 세는 수밖에 없다(검사 후 즉시 지운다).

사용법
    python verify_master.py                # 검수만 (읽기 + 임시셀 1회)
    python verify_master.py --fix          # 발견한 문제 교정
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")   # 에러도 utf-8 로 (cp949 로 나가면 깨진다)

KEY = Path(r"C:\Users\Gram\desktop\connect_tl_report\connect\gcp-key.json")
MASTER_ID = "1JM37uOEu64D0r6zzKggOsA9ZdcK4wBCx0rpuNoVcIYg"
TAB = "RPS"
SCRATCH = "AL"          # 진단용 임시 열 (데이터 영역 밖)

PAIRS = [("I", "J", "K"), ("L", "M", "N"), ("O", "P", "Q"), ("R", "S", "T")]
VCP = ["K", "N", "Q", "T"]
VCP_OPTIONS = ["Visibility : 아는단계", "Credibility : 신뢰단계", "Profit : 수익단계"]


def _sh():
    creds = Credentials.from_service_account_file(str(KEY), scopes=[
        "https://www.googleapis.com/auth/spreadsheets"])
    return build("sheets", "v4", credentials=creds).spreadsheets()


def last_data_row(sh) -> int:
    col = sh.values().get(spreadsheetId=MASTER_ID,
                          range=f"{TAB}!C1:C40000").execute().get("values", [])
    return max(i for i, v in enumerate(col, 1) if v and str(v[0]).strip())


def check_uv(sh, last: int) -> list[str]:
    """U·V 수식 검사. 옛 행은 값이 박혀 있기도 해서 '수식 또는 숫자' 를 정상으로 본다."""
    vals = sh.values().get(spreadsheetId=MASTER_ID, range=f"{TAB}!U2:V{last}",
                           valueRenderOption="FORMULA").execute().get("values", [])
    bad = []
    for i in range(last - 1):
        row = vals[i] if i < len(vals) else []
        u = str(row[0]) if len(row) > 0 else ""
        v = str(row[1]) if len(row) > 1 else ""
        r = i + 2
        if not u.strip():
            bad.append(f"U{r} 비어있음")
        elif u.startswith("=") and "COUNTIF" not in u:
            bad.append(f"U{r} 수식이 다름: {u[:40]}")
        if not v.strip():
            bad.append(f"V{r} 비어있음")
    return bad


def check_validation(sh, last: int) -> list[str]:
    bad = []
    for c in VCP:
        m = sh.get(spreadsheetId=MASTER_ID, ranges=[f"{TAB}!{c}2:{c}{last}"],
                   includeGridData=True,
                   fields="sheets(data(startRow,rowData(values(dataValidation(condition(type,values(userEnteredValue)))))))"
                   ).execute()
        d = m["sheets"][0]["data"][0]
        sr = d.get("startRow", 0)
        rows = d.get("rowData", [])
        for ri in range(last - 1):
            row = rows[ri] if ri < len(rows) else {}
            v = (row.get("values") or [{}])[0]
            dv = v.get("dataValidation")
            r = sr + ri + 1
            if not dv:
                bad.append(f"{c}{r} 드롭다운 없음")
            else:
                opts = [x.get("userEnteredValue") for x in dv["condition"].get("values", [])]
                if opts != VCP_OPTIONS:
                    bad.append(f"{c}{r} 항목 다름: {opts}")
    return bad


def check_cf(sh) -> list[str]:
    m = sh.get(spreadsheetId=MASTER_ID, includeGridData=False,
               fields="sheets(properties(title),conditionalFormats)").execute()
    tgt = next(s for s in m["sheets"] if s["properties"]["title"] == TAB)
    cfs = tgt.get("conditionalFormats", [])
    want = set()
    for n, s, _ in PAIRS:
        want |= {f'=AND(${n}2<>"", ${s}2<>"")',
                 f'=AND(${n}2<>"", ${s}2="")',
                 f'=AND(${n}2="", ${s}2<>"")'}
    got = set()
    for c in cfs:
        rule = c.get("booleanRule") or {}
        for v in rule.get("condition", {}).get("values", []):
            got.add(v.get("userEnteredValue"))
    bad = [f"규칙 없음: {w}" for w in sorted(want - got)]
    if len(cfs) != 12:
        bad.append(f"규칙 수 {len(cfs)}개 (정본 12개)")
    return bad


def check_login(sh, last: int) -> list[str]:
    vals = sh.values().get(spreadsheetId=MASTER_ID,
                           range=f"{TAB}!A2:Z{last}").execute().get("values", [])
    bad = []
    for i, row in enumerate(vals):
        r = i + 2

        def g(j):
            return row[j].strip() if len(row) > j and row[j] else ""
        email, chap = g(0), g(2)
        if not email and not chap:
            continue
        # 이메일은 대소문자를 가리지 않으므로 표기 차이는 오류로 보지 않는다.
        # (실제로 40건이 대소문자만 다르다 — `Sangchang586@` vs `sangchang586@`)
        if not g(22):
            bad.append(f"{r}행 ID 비어있음")
        elif g(22).lower() != email.lower():
            bad.append(f"{r}행 ID≠이메일: {email} / {g(22)}")
        pw = g(23)
        if not (len(pw) == 4 and pw.isdigit()):
            bad.append(f"{r}행 PW 이상({pw})")
        if g(24) not in ("활동중", "탈퇴", "정지"):
            bad.append(f"{r}행 STATUS({g(24)})")
        # 운영 계정이 섞여 있다 — Admin·National 은 정상이고 멤버만 Member 다
        if g(25) not in ("Member", "Admin", "National"):
            bad.append(f"{r}행 AUTH({g(25)})")
    return bad


def check_empty_strings(sh, last: int) -> tuple[list[str], dict]:
    """'빈칸이 아닌데 아무것도 안 보이는' 셀을 시트에게 직접 세게 한다.

    API 는 이런 셀을 값 없음으로 보고해서 밖에서는 구분이 안 된다.
    임시 수식을 넣어 ISBLANK 로 센 뒤 바로 지운다.
    """
    cols = [c for p in PAIRS for c in p]
    formulas = []
    for c in cols:
        rng = f"{c}2:{c}{last}"
        # `=""` 는 빈칸과 빈 문자열을 둘 다 참으로 본다. 거기서 진짜 빈칸을 빼면
        # 남는 것이 '보이진 않는데 빈칸도 아닌' 셀이다.
        # (COUNTA 와 ISBLANK 를 더하면 항상 전체 칸 수라 그 조합으로는 검출이 안 된다)
        formulas.append([f'=SUMPRODUCT(--({rng}=""))-SUMPRODUCT(--ISBLANK({rng}))'])
    sh.values().update(spreadsheetId=MASTER_ID,
                       range=f"{TAB}!{SCRATCH}1:{SCRATCH}{len(cols)}",
                       valueInputOption="USER_ENTERED",
                       body={"values": formulas}).execute()
    got = sh.values().get(spreadsheetId=MASTER_ID,
                          range=f"{TAB}!{SCRATCH}1:{SCRATCH}{len(cols)}").execute().get("values", [])
    sh.values().clear(spreadsheetId=MASTER_ID,
                      range=f"{TAB}!{SCRATCH}1:{SCRATCH}{len(cols)}", body={}).execute()
    detail, bad = {}, []
    for c, v in zip(cols, got):
        n = int(float(v[0])) if v and str(v[0]).strip() else 0
        detail[c] = n
        if n:
            bad.append(f"{c}열: 빈 문자열 {n}칸")
    return bad, detail


def main(fix: bool) -> None:
    sh = _sh()
    last = last_data_row(sh)
    print(f"모 시트 {TAB} 탭 · 데이터 마지막 행 {last}\n")

    sections = [
        ("[1] U·V 수식", check_uv(sh, last)),
        ("[3] 조건부 서식", check_cf(sh)),
        ("[4] 로그인 4종", check_login(sh, last)),
    ]
    es_bad, es_detail = check_empty_strings(sh, last)
    sections.append(("[5] 빈 문자열 셀", es_bad))
    sections.append(("[2] V-C-P 드롭다운", check_validation(sh, last)))

    total = 0
    for name, bad in sections:
        total += len(bad)
        if not bad:
            print(f"  ✓ {name}: 이상 없음")
        else:
            print(f"  ✗ {name}: {len(bad)}건")
            for b in bad[:12]:
                print(f"      · {b}")
            if len(bad) > 12:
                print(f"      … 외 {len(bad)-12}건")

    print(f"\n빈 문자열 분포: {es_detail}")
    print(f"\n총 이상 {total}건")

    if fix and any(es_detail.values()):
        clean_empty_strings(sh, last, es_detail)


def clean_empty_strings(sh, last: int, detail: dict) -> None:
    """'보이진 않는데 빈칸이 아닌' 셀만 진짜 빈칸으로 만든다.

    ⚠ 구간을 통째로 지우면 안 된다 — 오염 구간 안에도 실제 R파트너 데이터가 섞여 있다.
      셀 단위로 '눈에 보이는 값이 없는' 칸만 골라 지운다.
      (이미 진짜 빈칸인 셀을 지우는 건 무해하므로 함께 지워도 된다)
    """
    cols = [c for c, n in detail.items() if n]
    print(f"\n[교정] 대상 열 {cols}")
    grid = sh.values().get(
        spreadsheetId=MASTER_ID, range=f"{TAB}!I2:T{last}",
        valueRenderOption="UNFORMATTED_VALUE").execute().get("values", [])
    order = [c for p in PAIRS for c in p]           # I..T 순서
    ranges = []
    for ci, col in enumerate(order):
        if col not in cols:
            continue
        empties = []
        for r in range(2, last + 1):
            row = grid[r - 2] if r - 2 < len(grid) else []
            v = row[ci] if ci < len(row) else ""
            if not str(v).strip():
                empties.append(r)
        run_s = None
        for i, r in enumerate(empties):
            if run_s is None:
                run_s = prev = r
            elif r == prev + 1:
                prev = r
            else:
                ranges.append(f"{TAB}!{col}{run_s}:{col}{prev}")
                run_s = prev = r
        if run_s is not None:
            ranges.append(f"{TAB}!{col}{run_s}:{col}{prev}")

    print(f"   정리할 구간 {len(ranges)}개")
    for i in range(0, len(ranges), 100):
        sh.values().batchClear(spreadsheetId=MASTER_ID,
                               body={"ranges": ranges[i:i + 100]}).execute()
    # ⚠ values.batchClear 는 문서와 달리 **데이터 확인(드롭다운)까지 날린다.**
    #   지운 뒤에는 반드시 V-C-P 드롭다운을 다시 깔아야 한다.
    restore_validation(sh)
    print("   ✓ 완료 — 다시 검수하세요.")


def restore_validation(sh) -> None:
    """V-C-P 4개 열에 드롭다운을 균일하게 다시 적용한다 (멱등)."""
    meta = sh.get(spreadsheetId=MASTER_ID, includeGridData=False,
                  fields="sheets(properties(title,sheetId,gridProperties(rowCount)))").execute()
    p = next(s["properties"] for s in meta["sheets"] if s["properties"]["title"] == TAB)
    sid, rows = p["sheetId"], p["gridProperties"]["rowCount"]
    colidx = {"K": 10, "N": 13, "Q": 16, "T": 19}
    reqs = []
    for c in VCP:
        reqs.append({"setDataValidation": {
            "range": {"sheetId": sid, "startRowIndex": 1, "endRowIndex": rows,
                      "startColumnIndex": colidx[c], "endColumnIndex": colidx[c] + 1},
            "rule": {"condition": {"type": "ONE_OF_LIST",
                                   "values": [{"userEnteredValue": v} for v in VCP_OPTIONS]},
                     "strict": True, "showCustomUi": True}}})
    sh.batchUpdate(spreadsheetId=MASTER_ID, body={"requests": reqs}).execute()
    print(f"   ✓ V-C-P 드롭다운 재적용 ({', '.join(VCP)}열 · 2~{rows}행)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="모 시트 전수 검수")
    ap.add_argument("--fix", action="store_true", help="발견한 문제 교정")
    main(ap.parse_args().fix)
