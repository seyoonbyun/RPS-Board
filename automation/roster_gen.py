# -*- coding: utf-8 -*-
"""
[01] 신규 런칭 챕터 멤버 명단 → 모 시트(RPS 탭) 리스트업

입력: BNI Connect `리포트 > 지역 > 지역 오피스 > 데이터베이스 추출` 로 받은 .xls
      (겉은 .xls 지만 실제로는 SpreadsheetML XML)

⚠ **같은 리포트가 두 가지 형식으로 나온다.** 내보내기 대화상자의 `머리글 없이 내보내기`
  체크 여부에 따라 행·열이 통째로 달라진다. 사람이 받으면 보통 체크 안 함,
  스킬 `bni-connect-download` 는 **체크함** — 그래서 파일이 서로 다르다.

    머리글 O : 머리말 3행(1=사용자 6=출력일 11=국가 16=지역) / 4행 헤더 / 5행~ 데이터
               1=한글 2=영문 3=회사 4=산업 5=챕터 7=포지션 8=휴대전화 13=이메일 22=상태
    머리글 X : 머리말 없음 / 1행 헤더 / 2행~ 데이터  ← 열이 앞으로 밀린다
               1=한글 2=영문 3=회사 4=산업 5=챕터 6=포지션 7=휴대전화 11=이메일 18=상태

  고정 행·열 번호로 읽으면 한쪽에서 **데이터 3행이 조용히 사라지고**(30명→27명)
  지역도 못 읽는다. 실제로 그렇게 틀렸었다. → **헤더 이름으로 행·열을 찾는다.**
  ⚠ 머리글 X 형식엔 **지역 정보가 아예 없다** → 파일명이나 `--region` 으로 받아야 한다.

※ '챕터 멤버 현황 리포트'(챕터 명단) 로는 안 된다 — 거기엔 이메일과 산업이 없다.
  데이터베이스 추출이라야 10개 항목이 다 나온다.

출력: 모 시트 `RPS` 탭에 붙일 행. 실제 사용 열은 26개이고 그중 10개만 채운다.
  A 이메일 / B 지역 / C 챕터 / D 멤버명 / E 산업군 / F 회사
  W ID(=이메일) / X PW(휴대폰 끝 4자리) / Y STATUS='활동중' / Z AUTH='Member'
  G~V(전문분야·R파트너·달성)는 유저가 나중에 채우는 칸이라 비워 둔다.

사용법
    python roster_gen.py "<추출.xls>"                    # dry-run (기본)
    python roster_gen.py "<추출.xls>" --chapter Signia    # 특정 챕터만
    python roster_gen.py "<추출.xls>" --region "Hanam 하남"  # 머리글 X 형식일 때 지역 지정
    python roster_gen.py "<추출.xls>" --csv out.csv       # 붙여넣기용 CSV
    python roster_gen.py "<추출.xls>" --apply             # 모 시트에 append
"""
from __future__ import annotations

import argparse
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")   # 에러도 utf-8 로 (cp949 로 나가면 깨진다)

NS = {"ss": "urn:schemas-microsoft-com:office:spreadsheet"}
SS = "{urn:schemas-microsoft-com:office:spreadsheet}"

KEY = Path(r"C:\SEYOON\03. Projects\Ongoing\rpslist\gcp-key.json")
MASTER_ID = "1JM37uOEu64D0r6zzKggOsA9ZdcK4wBCx0rpuNoVcIYg"
TAB = "RPS"

# 헤더에 적힌 이름 → 우리가 쓰는 키. 열 번호는 형식마다 다르므로 **이름으로 찾는다**.
# ⚠ `휴대전화 번호` 는 헤더에 두 번 나온다(둘째는 뒤쪽 중복 열) → **먼저 나온 것**만 쓴다.
HEADER = {
    "이름 (한글)": "kor",
    "이름 (영문)": "eng",
    "회사": "company",
    "산업": "industry",
    "챕터명": "chapter",
    "포지션": "position",
    "휴대전화 번호": "mobile",
    "이메일": "email",
    "상태": "status",
    "가입일": "joined",
}
NEEDED = {"kor", "chapter", "email", "industry", "company", "mobile"}


def _norm(s: str) -> str:
    """헤더 대조용 정규화 — 공백 폭·개수 차이를 무시한다."""
    return re.sub(r"\s+", " ", (s or "").replace("\xa0", " ")).strip()


def _cells(row) -> dict[int, str]:
    """{1-based index: text} — 셀이 전부 명시적 Index + MergeAcross 로 되어 있다."""
    out, idx = {}, 1
    for c in row.findall("ss:Cell", NS):
        at = c.get(SS + "Index")
        if at:
            idx = int(at)
        d = c.find("ss:Data", NS)
        out[idx] = "".join(d.itertext()).strip() if d is not None else ""
        idx += int(c.get(SS + "MergeAcross") or 0) + 1
    return out


def _find_header(rows) -> tuple[int, dict[str, int]]:
    """헤더 행 번호와 {키: 열번호} 를 찾는다.

    머리글 O 형식이면 4행, 머리글 X 형식이면 1행에 헤더가 있다.
    행 번호를 고정하지 않고 `이름 (한글)` 이 있는 행을 헤더로 본다.
    """
    for i, r in enumerate(rows[:12]):
        cells = {idx: _norm(v) for idx, v in _cells(r).items()}
        if "이름 (한글)" not in cells.values():
            continue
        col: dict[str, int] = {}
        for idx in sorted(cells):
            key = HEADER.get(cells[idx])
            if key and key not in col:      # 중복 헤더는 먼저 나온 것 우선
                col[key] = idx
        missing = NEEDED - col.keys()
        if missing:
            raise ValueError(f"헤더에 필요한 열이 없다: {sorted(missing)} (행 {i + 1})")
        return i, col
    raise ValueError("헤더 행(`이름 (한글)`)을 찾지 못했다 — 데이터베이스 추출 파일이 맞습니까?")


def _find_region(rows, header_at: int) -> str:
    """머리말에서 지역 표기를 읽는다. 머리글 X 형식엔 머리말이 없어 빈 문자열."""
    for i in range(header_at):
        cells = {idx: _norm(v) for idx, v in _cells(rows[i]).items()}
        for idx, txt in cells.items():
            if txt == "지역" and i + 1 < header_at:
                return _cells(rows[i + 1]).get(idx, "").strip()
    return ""


def parse(path: Path, region: str = "") -> tuple[str, list[dict]]:
    """(지역 표기, 멤버 리스트). `region` 을 주면 파일에서 읽은 값보다 우선한다."""
    rows = (
        ET.parse(path).getroot().find("ss:Worksheet", NS).find("ss:Table", NS).findall("ss:Row", NS)
    )
    header_at, COL = _find_header(rows)
    region = region or _find_region(rows, header_at)
    people = []
    for r in rows[header_at + 1:]:
        c = _cells(r)
        g = lambda k: c.get(COL[k], "").strip() if k in COL else ""   # noqa: E731
        kor = g("kor")
        if not kor:
            continue
        mob = g("mobile")
        people.append(
            {
                "email": g("email"),
                "kor": kor,
                "eng": g("eng"),
                "company": g("company"),
                "industry": g("industry"),
                "chapter": g("chapter"),
                "position": g("position"),
                "mobile": mob,
                "pw": re.sub(r"\D", "", mob)[-4:] if mob else "",
                "status": g("status"),
            }
        )
    return region, people


def to_rows(region: str, people: list[dict]) -> list[list[str]]:
    """모 시트 RPS 탭 A~Z 26열 행. 10개 항목만 채우고 나머지는 빈칸.

    U(총 R파트너 수)·V(달성)은 **수식**이라 행 번호를 알아야 만들 수 있다 →
    실제 append 시점에 `uv_formulas()` 로 따로 채운다.
    """
    out = []
    for p in people:
        row = [""] * 26
        row[0] = p["email"]           # A 이메일
        row[1] = region               # B 지역
        row[2] = p["chapter"]         # C 챕터
        row[3] = p["kor"]             # D 멤버명
        row[4] = p["industry"]        # E 산업군
        row[5] = p["company"]         # F 회사
        row[22] = p["email"]          # W ID
        row[23] = p["pw"]             # X PW
        row[24] = "활동중"             # Y STATUS
        row[25] = "Member"            # Z AUTH
        out.append(row)
    return out


def uv_formulas(start: int, n: int) -> list[list[str]]:
    """U(총 R파트너 수)·V(달성) 수식.

    U = R파트너 1~4 의 V-C-P 열(K·N·Q·T)에서 `Profit` 단계에 도달한 수
    V = U/4  (4명 영입이 목표라 4로 나눈다. V열은 퍼센트 서식)

    ⚠ 이걸 빼먹으면 새 멤버의 달성률이 빈칸으로 남아 시트가 트래킹을 못 한다.
      실제로 2026-07-29 첫 실행 때 누락해서 30행을 나중에 메웠다.
    """
    out = []
    for r in range(start, start + n):
        out.append([
            f'=COUNTIF(K{r},"Profit*")+COUNTIF(N{r},"Profit*")'
            f'+COUNTIF(Q{r},"Profit*")+COUNTIF(T{r},"Profit*")',
            f"=U{r}/4",
        ])
    return out


def _already_in_master(sh) -> set[tuple[str, str]]:
    """모 시트에 이미 있는 (이메일, 챕터) 쌍.

    ⚠ 이 함수가 없으면 재실행이 **행을 통째로 복제한다**. append 는 중복 검사를 하지
      않으므로, 5월 런칭 챕터처럼 명단이 이미 들어가 있는 소급 건에서 그대로 터진다.
    """
    v = sh.values().get(spreadsheetId=MASTER_ID,
                        range=f"{TAB}!A2:C").execute().get("values", [])
    out = set()
    for r in v:
        r = list(r) + [""] * (3 - len(r))
        if r[0].strip() and r[2].strip():
            out.add((r[0].strip().lower(), r[2].strip()))
    return out


def append_master(rows: list[list[str]]) -> int:
    from google.oauth2.service_account import Credentials
    from googleapiclient.discovery import build

    creds = Credentials.from_service_account_file(
        str(KEY), scopes=["https://www.googleapis.com/auth/spreadsheets"]
    )
    sh = build("sheets", "v4", credentials=creds).spreadsheets()

    have = _already_in_master(sh)
    dup = [r for r in rows if (r[0].strip().lower(), r[2].strip()) in have]
    rows = [r for r in rows if (r[0].strip().lower(), r[2].strip()) not in have]
    if dup:
        print(f"  이미 모 시트에 있어 건너뜀 {len(dup)}명: "
              f"{', '.join(r[3] for r in dup[:8])}{' …' if len(dup) > 8 else ''}")
    if not rows:
        raise SystemExit("추가할 신규 멤버가 없다 (전원 이미 모 시트에 있음) — append 하지 않는다.")

    col_c = sh.values().get(spreadsheetId=MASTER_ID, range=f"{TAB}!C1:C50000").execute().get("values", [])
    last = max((i for i, x in enumerate(col_c, 1) if x and str(x[0]).strip()), default=1)
    start = last + 1
    sh.values().update(
        spreadsheetId=MASTER_ID,
        range=f"{TAB}!A{start}",
        valueInputOption="USER_ENTERED",
        body={"values": rows},
    ).execute()
    # U·V 는 행 번호가 들어간 수식이라 append 후에 따로 채운다
    sh.values().update(
        spreadsheetId=MASTER_ID,
        range=f"{TAB}!U{start}:V{start + len(rows) - 1}",
        valueInputOption="USER_ENTERED",
        body={"values": uv_formulas(start, len(rows))},
    ).execute()
    return start, len(rows)          # 중복을 걸러낸 **실제 append 건수**를 같이 준다


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="[01] 신규 챕터 멤버 명단 리스트업")
    ap.add_argument("xls", help="데이터베이스 추출 .xls 경로")
    ap.add_argument("--chapter", help="이 챕터만 (미지정 시 전체)")
    ap.add_argument("--region", default="",
                    help="지역 표기 (예: 'Hanam 하남'). `머리글 없이 내보내기` 파일은 "
                         "지역 정보가 없어 이걸 줘야 한다")
    ap.add_argument("--only-active", action="store_true",
                    help="상태가 `활동중` 인 멤버만. 신규 런칭은 전원 활동중이라 차이가 없지만, "
                         "런칭 후 시간이 지난 **소급 건**에는 탈퇴·무효가 섞여 있다")
    ap.add_argument("--csv", help="붙여넣기용 CSV 저장 경로")
    ap.add_argument("--apply", action="store_true", help="모 시트에 실제 append")
    a = ap.parse_args()

    region, people = parse(Path(a.xls), a.region)
    if a.chapter:
        people = [p for p in people if p["chapter"] == a.chapter]
    if a.only_active:
        before = len(people)
        people = [p for p in people if p["status"].strip() == "활동중"]
        print(f"상태 필터: 활동중 {len(people)}명 (제외 {before - len(people)}명)")

    print(f"지역 = {region or '(파일에 없음)'}")
    chaps = sorted({p['chapter'] for p in people})
    print(f"챕터 = {', '.join(chaps)}")
    print(f"멤버 = {len(people)}명\n")

    no_mail = [p["kor"] for p in people if not p["email"]]
    no_pw = [p["kor"] for p in people if len(p["pw"]) != 4]
    dup = {e for e in (p["email"] for p in people if p["email"]) if
           [p["email"] for p in people].count(e) > 1}
    print(f"  이메일 없음 : {no_mail or '없음'}")
    print(f"  PW 산출불가 : {no_pw or '없음'}")
    print(f"  이메일 중복 : {sorted(dup) or '없음'}\n")

    for i, p in enumerate(people, 1):
        print(f"  {i:2} {p['kor']:5} {p['email'][:30]:32} {p['industry'][:24]:26} PW={p['pw']}")

    rows = to_rows(region, people)

    if a.csv:
        import csv
        with open(a.csv, "w", encoding="utf-8-sig", newline="") as f:
            csv.writer(f).writerows(rows)
        print(f"\nCSV 저장: {a.csv}")

    if a.apply:
        # 지역(B열)이 비면 모 시트에서 그 행들을 영영 못 찾는다 — 쓰기 전에 막는다.
        if not region:
            raise SystemExit(
                "지역을 알 수 없어 append 하지 않는다 (`머리글 없이 내보내기` 파일에는 지역이 없다).\n"
                "  --region \"Hanam 하남\" 처럼 모 시트 B열 표기 그대로 넘겨주세요.")
        start, n = append_master(rows)      # n = 중복 제외 후 실제로 들어간 건수
        print(f"\n✓ 모 시트 {TAB} 탭 {start}행부터 {n}건 append 완료")
    else:
        print(f"\n[DRY-RUN] {len(rows)}행 준비됨 — --apply 를 붙여야 모 시트에 들어갑니다.")
