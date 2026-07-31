# -*- coding: utf-8 -*-
"""
RPS 입력시트(구글 스프레드시트) 생성기

운영 중인 _rps 시트 125개를 역산해 얻은 규격:
  - 별도 템플릿 파일은 존재하지 않는다. 활동중 챕터 시트 아무거나 복사하면 된다.
    (챕터 시트 7개 표본의 그리드 2310x34 · 조건부서식 16개가 JSON 수준까지 동일)
  - 시트는 데이터 사본이 아니라 마스터를 필터링하는 '수식 1개짜리 뷰'다.
    A3 의 QUERY(IMPORTRANGE(마스터)) 한 줄이 멤버 목록 전체를 끌어온다.
  - 따라서 복사 후 바꿀 것은 4가지뿐: 파일명 / 탭명 / A2 / A3 의 WHERE 값

  챕터   파일 `<Eng>_rps`          탭 `<Eng>`        A2 `<한글챕터명>`
         A3   ... WHERE Col2 = '<Eng>'          (Col2 = 챕터)
  지역   파일 `<Eng> <Kor> All_rps` 탭 `<Eng> <Kor>` A2 `<Eng> <Kor> All`, B2 `리퍼럴 파트너 지수`
         A3   ... WHERE Col1 = '<Eng> <Kor>'   (Col1 = 지역)

  D2 = `=(SUM(T3:T) / COUNTA(C3:C))`  (RPI. 복사본이 그대로 물려받으므로 건드리지 않는다)
  공유 = 링크가 있는 모든 사용자 '뷰어' + 서비스계정 2개 writer
  PW  = 챕터는 런칭일 MMDD (RPS Viewer 91건 전수 검증, 불일치 0)
        지역은 규칙 없는 임의 4자리 → 자동 채번(random)

⚠ IMPORTRANGE 는 (원본, 대상) 쌍마다 승인이 필요하다. 복사본은 승인을 물려받지
  못할 수 있어 최초 1회 `#REF!` 와 함께 '시트 연결' 승인이 뜰 수 있다.
  이건 API 로 못 누르므로 --verify 로 감지해 사람이 한 번 눌러주는 흐름으로 둔다.

사용법
    python sheet_gen.py --list                             # 현황 확인 (읽기)
    python sheet_gen.py --chapter Awesome --kor 어썸        # dry-run (기본)
    python sheet_gen.py --chapter Awesome --kor 어썸 --apply
    python sheet_gen.py --region Gangnam --kor 강남 --apply
    python sheet_gen.py --verify Awesome_rps               # IMPORTRANGE 승인 확인
"""
from __future__ import annotations

import argparse
import random
import re
import sys
from pathlib import Path

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")   # 에러도 utf-8 로 (cp949 로 나가면 깨진다)

KEY = Path(r"C:\SEYOON\03. Projects\Ongoing\rpslist\gcp-key.json")
FOLDER_ID = "1XqC-OdatL9Dxi9fJ9a3IKr_I4NKvozGf"  # RPS_Sheets
MASTER_ID = "1JM37uOEu64D0r6zzKggOsA9ZdcK4wBCx0rpuNoVcIYg"  # MY PowerTeam (archive)

# 복사 원본. 활동중이고 구조가 정본인 챕터 시트.
SOURCE_NAME = "Ace_rps"

RPI_FORMULA = "=(SUM(T3:T) / COUNTA(C3:C))"
REGION_B2 = "       리퍼럴 파트너 지수 "

SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
]

WRITERS = [
    "id-rps-meberlist@training-register-471610.iam.gserviceaccount.com",
    "mypowerteam@qualified-glow-467905-k0.iam.gserviceaccount.com",
]


def _services(need_create: bool = False):
    """소유계정 OAuth 가 있으면 그걸 쓰고, 없으면 서비스계정으로 떨어진다.

    **파일 생성(사본 만들기)은 서비스계정으로 영원히 불가능하다** — 할당량이 `limit: 0` 이라
    소유자가 될 수 없어 `403 storageQuotaExceeded` 가 난다. 권한 문제가 아니다.
    읽기·수정은 서비스계정으로도 된다.
    """
    try:
        from google_auth import user_services
        return user_services()
    except Exception as e:
        if need_create:
            raise SystemExit(
                f"사본을 만들려면 소유계정 OAuth 가 필요합니다 ({e})\n"
                "  python google_auth.py --login\n"
                "  (서비스계정은 드라이브 할당량이 0 이라 파일을 만들 수 없습니다)")
        creds = Credentials.from_service_account_file(str(KEY), scopes=SCOPES)
        return build("drive", "v3", credentials=creds), build("sheets", "v4", credentials=creds)


def _folder_files(drive) -> dict[str, str]:
    out, token = {}, None
    while True:
        r = (
            drive.files()
            .list(
                q=f"'{FOLDER_ID}' in parents and trashed=false",
                fields="nextPageToken, files(id,name)",
                pageSize=400,
                pageToken=token,
            )
            .execute()
        )
        out.update({f["name"]: f["id"] for f in r["files"]})
        token = r.get("nextPageToken")
        if not token:
            return out


def _query_formula(col: int, value: str) -> str:
    """A3 의 QUERY(IMPORTRANGE(...)) 수식. col 1=지역, 2=챕터.

    꼬리표는 운영 시트 관행을 그대로 따른다(지역 `?usp=sharing` / 챕터 `#gid=0`).
    둘 다 동작은 같지만 기존 시트와 문자열을 일치시켜 두면 나중에 대조가 쉽다.
    """
    tail = "?usp=sharing" if col == 1 else "#gid=0"
    return (
        f'=QUERY(IMPORTRANGE("https://docs.google.com/spreadsheets/d/{MASTER_ID}'
        f'/edit{tail}","B2:V"),"SELECT * WHERE Col{col} = \'{value}\'")'
    )


def _pw_from_launch(launch: str | None) -> str:
    """챕터 PW = 런칭일 MMDD. 없으면 임의 4자리."""
    if launch:
        m = re.match(r"(\d{4})-(\d{2})-(\d{2})", launch)
        if m:
            return m.group(2) + m.group(3)
    return f"{random.randint(0, 9999):04d}"


def plan(
    kind: str,
    eng: str,
    kor: str,
    launch: str | None = None,
    master: str | None = None,
    file_label: str | None = None,
) -> dict:
    """생성 계획 산출. 네트워크 호출 없음 — dry-run 출력의 근거.

    master     모 시트(RPS 탭) 의 지역/챕터 표기. **탭명과 A3 WHERE 값이 이 값이다.**
    file_label 파일명에 쓸 라벨. 지정 안 하면 master 와 같게 간다.

    둘을 나눠 둔 이유: 운영 지역 시트 20개 중 6개가 파일명과 실제 표기가 다르다.
    (`YDP 영등포 All_rps` 파일의 탭·A3 는 `Youngdeungpo 영등포`,
     `Suwon 수원 All_rps` → `Suwon1 수원1`, `Daegu 대구 All_rps` → `Daegu1 대구1` …)
    탭명 == A3 WHERE 값 == 모 시트 표기 는 20개 전부 예외 없이 성립하므로 이쪽이 진짜 키고,
    파일명은 사람이 붙인 라벨일 뿐이다.
    """
    if kind == "chapter":
        key = master or eng
        label = file_label or key
        return {
            "file": f"{label}_rps",
            "tab": key,
            "a2": kor,
            "b2": None,
            "a3": _query_formula(2, key),
            "pw": _pw_from_launch(launch),
        }
    key = master or f"{eng} {kor}"
    label = file_label or key
    return {
        "file": f"{label} All_rps",
        "tab": key,
        "a2": f"{key} All",
        "b2": REGION_B2,
        "a3": _query_formula(1, key),
        "pw": f"{random.randint(0, 9999):04d}",
    }


def create(
    kind: str,
    eng: str,
    kor: str,
    launch: str | None = None,
    apply: bool = False,
    master: str | None = None,
    file_label: str | None = None,
) -> dict:
    p = plan(kind, eng, kor, launch, master, file_label)
    drive, sheets = _services(need_create=apply)
    existing = _folder_files(drive)

    if p["file"] in existing:
        raise SystemExit(f"이미 존재: {p['file']}  (id={existing[p['file']]})")
    if SOURCE_NAME not in existing:
        raise SystemExit(f"복사 원본 없음: {SOURCE_NAME}")

    print(f"[{'실행' if apply else 'DRY-RUN'}] {kind}  {eng} / {kor}")
    print(f"  복사원본 : {SOURCE_NAME}")
    print(f"  파일명   : {p['file']}")
    print(f"  탭       : {p['tab']}")
    print(f"  A2       : {p['a2']}" + (f"   B2: {p['b2'].strip()}" if p["b2"] else ""))
    print(f"  A3       : ...WHERE Col{1 if kind == 'region' else 2} = '{p['tab']}'   ← 모 시트 표기와 반드시 일치해야 함")
    print(f"  PW       : {p['pw']}" + ("  (런칭일 MMDD)" if launch else "  (임의 4자리)"))
    print("  공유     : 링크 뷰어 + 서비스계정 2개 writer")
    if not apply:
        print("\n  → --apply 를 붙여야 실제로 만들어집니다.")
        return p

    new_id = (
        drive.files()
        .copy(fileId=existing[SOURCE_NAME], body={"name": p["file"], "parents": [FOLDER_ID]})
        .execute()["id"]
    )
    p["id"] = new_id
    p["url"] = f"https://docs.google.com/spreadsheets/d/{new_id}"
    print(f"  ✓ 복사 완료 {p['url']}")

    meta = sheets.spreadsheets().get(spreadsheetId=new_id, fields="sheets(properties)").execute()
    sid = meta["sheets"][0]["properties"]["sheetId"]

    sheets.spreadsheets().batchUpdate(
        spreadsheetId=new_id,
        body={
            "requests": [
                {
                    "updateSheetProperties": {
                        "properties": {"sheetId": sid, "title": p["tab"]},
                        "fields": "title",
                    }
                }
            ]
        },
    ).execute()

    data = [
        {"range": f"'{p['tab']}'!A2", "values": [[p["a2"]]]},
        {"range": f"'{p['tab']}'!A3", "values": [[p["a3"]]]},
        {"range": f"'{p['tab']}'!D2", "values": [[RPI_FORMULA]]},
    ]
    if p["b2"]:
        data.append({"range": f"'{p['tab']}'!B2", "values": [[p["b2"]]]})
    sheets.spreadsheets().values().batchUpdate(
        spreadsheetId=new_id,
        body={"valueInputOption": "USER_ENTERED", "data": data},
    ).execute()
    print("  ✓ 탭명·A2·A3·D2 설정 완료")

    drive.permissions().create(
        fileId=new_id, body={"type": "anyone", "role": "reader"}, fields="id"
    ).execute()
    for w in WRITERS:
        try:
            drive.permissions().create(
                fileId=new_id,
                body={"type": "user", "role": "writer", "emailAddress": w},
                sendNotificationEmail=False,
                fields="id",
            ).execute()
        except Exception as e:
            print(f"  ! writer 추가 실패 {w}: {e.__class__.__name__}")
    print("  ✓ 공유 설정 완료")
    print("\n  다음: --verify 로 IMPORTRANGE 승인 여부를 확인하세요.")
    return p


def adopt(
    src_name: str,
    kind: str,
    eng: str,
    kor: str,
    launch: str | None = None,
    apply: bool = False,
    master: str | None = None,
    file_label: str | None = None,
) -> dict:
    """이미 만들어진 사본에 규격을 입힌다 (파일명·탭명·A2·A3·B2·공유).

    서비스계정은 드라이브 저장 용량이 0 이라 **파일을 새로 만들지 못한다**
    (`storageQuotaExceeded`). 사본 생성만 소유 계정(브라우저)에서 하고,
    나머지 설정은 이 함수가 API 로 마무리한다.
    폴더 `RPS_Sheets` 에 SA 가 writer 로 걸려 있어 사본이 그 권한을 상속받으므로 가능하다.
    """
    p = plan(kind, eng, kor, launch, master, file_label)
    drive, sheets = _services()
    existing = _folder_files(drive)

    if src_name not in existing:
        raise SystemExit(f"사본 없음: {src_name}  (먼저 브라우저에서 사본을 만드세요)")
    fid = existing[src_name]
    p["id"], p["url"] = fid, f"https://docs.google.com/spreadsheets/d/{fid}"

    print(f"[{'실행' if apply else 'DRY-RUN'}] adopt  {src_name}  →  {p['file']}")
    print(f"  탭 : {p['tab']}")
    print(f"  A2 : {p['a2']}" + (f"   B2: {p['b2'].strip()}" if p["b2"] else ""))
    print(f"  A3 : ...WHERE Col{1 if kind == 'region' else 2} = '{p['tab']}'")
    print(f"  PW : {p['pw']}")
    print(f"  {p['url']}")
    if not apply:
        print("\n  → --apply 를 붙여야 반영됩니다.")
        return p

    if src_name != p["file"]:
        drive.files().update(fileId=fid, body={"name": p["file"]}).execute()

    meta = sheets.spreadsheets().get(spreadsheetId=fid, fields="sheets(properties)").execute()
    sid = meta["sheets"][0]["properties"]["sheetId"]
    if meta["sheets"][0]["properties"]["title"] != p["tab"]:
        sheets.spreadsheets().batchUpdate(
            spreadsheetId=fid,
            body={"requests": [{"updateSheetProperties": {
                "properties": {"sheetId": sid, "title": p["tab"]}, "fields": "title"}}]},
        ).execute()

    data = [
        {"range": f"'{p['tab']}'!A2", "values": [[p["a2"]]]},
        {"range": f"'{p['tab']}'!A3", "values": [[p["a3"]]]},
        {"range": f"'{p['tab']}'!D2", "values": [[RPI_FORMULA]]},
    ]
    if p["b2"]:
        data.append({"range": f"'{p['tab']}'!B2", "values": [[p["b2"]]]})
    sheets.spreadsheets().values().batchUpdate(
        spreadsheetId=fid, body={"valueInputOption": "USER_ENTERED", "data": data}
    ).execute()

    # 챕터 시트는 A2 아래 B2:C2 가 비어야 한다 (원본 사본에 값이 남아 있을 수 있음)
    if kind == "chapter":
        sheets.spreadsheets().values().clear(
            spreadsheetId=fid, range=f"'{p['tab']}'!B2:C2", body={}
        ).execute()

    try:
        drive.permissions().create(
            fileId=fid, body={"type": "anyone", "role": "reader"}, fields="id"
        ).execute()
    except Exception as e:
        print(f"  ! 링크공유 설정 실패: {e.__class__.__name__}")
    print("  ✓ 반영 완료")
    return p


def verify(name: str) -> bool:
    """A3 가 실제 데이터를 끌어오는지 확인. #REF! 면 IMPORTRANGE 승인이 필요하다."""
    drive, sheets = _services()
    fid = _folder_files(drive).get(name)
    if not fid:
        raise SystemExit(f"없음: {name}")
    vals = (
        sheets.spreadsheets()
        .values()
        .get(spreadsheetId=fid, range="A3:C5")
        .execute()
        .get("values", [])
    )
    flat = [c for row in vals for c in row]
    if any("#REF" in str(c) for c in flat):
        print(f"✗ {name}: #REF! — 시트를 열어 '액세스 허용'을 한 번 눌러야 합니다.")
        print(f"   https://docs.google.com/spreadsheets/d/{fid}")
        return False
    if not flat:
        print(f"△ {name}: 데이터 없음 (마스터에 해당 챕터 멤버가 아직 없을 수 있음)")
        return False
    print(f"✓ {name}: 정상 — {len(vals)}행 확인, 첫 행 {vals[0][:3]}")
    return True


def show_list() -> None:
    drive, _ = _services()
    files = _folder_files(drive)
    rps = sorted(n for n in files if n.lower().endswith("_rps"))
    region = [n for n in rps if "All_rps" in n or "ALL_rps" in n]
    chapter = [n for n in rps if n not in region]
    print(f"RPS_Sheets 폴더: 총 {len(files)}개 / _rps {len(rps)}개")
    print(f"  지역 {len(region)}개, 챕터 {len(chapter)}개")
    print(f"  복사원본 {SOURCE_NAME}: {'있음' if SOURCE_NAME in files else '없음'}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="RPS 입력시트 생성")
    ap.add_argument("--list", action="store_true", help="폴더 현황 (읽기 전용)")
    ap.add_argument("--chapter", metavar="ENG", help="신규 챕터 영문명")
    ap.add_argument("--region", metavar="ENG", help="신규 지역 영문명")
    ap.add_argument("--kor", help="한글명 (챕터명 또는 지역명)")
    ap.add_argument("--launch", metavar="YYYY-MM-DD", help="런칭일 — 챕터 PW(MMDD) 산출")
    ap.add_argument("--master", help="모 시트 표기 (탭명·A3 값). 미지정 시 영문+한글 조합")
    ap.add_argument("--file-label", help="파일명 라벨. 미지정 시 --master 와 동일")
    ap.add_argument("--adopt", metavar="사본이름", help="이미 만든 사본에 규격 입히기")
    ap.add_argument("--verify", metavar="NAME", help="IMPORTRANGE 승인 확인")
    ap.add_argument("--apply", action="store_true", help="실제 생성 (미지정 시 dry-run)")
    a = ap.parse_args()

    if a.list:
        show_list()
    elif a.verify:
        verify(a.verify)
    elif a.adopt:
        if not a.kor or not (a.chapter or a.region):
            raise SystemExit("--adopt 는 --chapter/--region 과 --kor 가 함께 필요")
        adopt(
            a.adopt,
            "chapter" if a.chapter else "region",
            a.chapter or a.region,
            a.kor,
            a.launch,
            a.apply,
            a.master,
            a.file_label,
        )
    elif a.chapter or a.region:
        if not a.kor:
            raise SystemExit("--kor 필요")
        create(
            "chapter" if a.chapter else "region",
            a.chapter or a.region,
            a.kor,
            a.launch,
            a.apply,
            a.master,
            a.file_label,
        )
    else:
        ap.print_help()
