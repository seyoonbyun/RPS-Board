# -*- coding: utf-8 -*-
r"""[0] 런칭 신청 접수 채널 — Airtable 베이스·테이블 생성 (구글시트 대체)

기존 접수는 구글시트 `런칭 신청서_RPS 보드 계정 개설용` 이었다.
담당자에게 폼 링크를 뿌리려면 Airtable 폼 뷰가 낫다 → **입구만 교체**한다.
파이프라인 본체(pipeline.py)는 그대로다. watcher 가 읽는 곳만 바뀐다.

    python airtable_setup.py --check                       # 토큰·권한·워크스페이스 확인
    python airtable_setup.py --workspace wspXXXX           # dry-run (만들 스키마만 출력)
    python airtable_setup.py --workspace wspXXXX --apply   # 베이스 생성
    python airtable_setup.py --base appXXXX --apply        # 기존 베이스에 테이블만 추가
    python airtable_setup.py --base appXXXX --import-sheet # 구글시트 기존 신청 건 이관

⚠ **폼 뷰는 API 로 못 만든다.** Airtable 메타 API 에 뷰 생성 엔드포인트가 없다.
  테이블·필드까지 여기서 만들고, 폼 뷰 1개는 UI 에서 만든다(필드가 이미 있으니 클릭 몇 번).

토큰: `desktop\connect_tl_report\connect\airtable_token.txt`  (`TOKEN : pat...` 형식)
  ⛔ 볼트(C:\SEYOON)에 두면 안 된다 — Obsidian Sync·Dropbox·구글드라이브 3중 동기화.
  필요 스코프: data.records:read / data.records:write / schema.bases:read / schema.bases:write
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

import requests                                          # noqa: E402

TOKEN_FILE = Path(r"C:\Users\Gram\desktop\connect_tl_report\connect\airtable_token.txt")
API = "https://api.airtable.com/v0"

BASE_NAME = "MyPowerteam 런칭 신청"
TABLE_NAME = "런칭 신청"

# 구글시트 신청서 (이관 원본)
FORM_SHEET_ID = "1kY75gqWj-eEQ_-fGUJWGNfRt7OwfO46aRcsxMrehd-U"
FORM_SHEET_TAB = "시트1"

YESNO = {"type": "singleSelect", "options": {"choices": [{"name": "YES"}, {"name": "NO"}]}}

# 신청자(담당자)가 폼에서 채우는 칸 + 우리가 처리하며 채우는 칸.
# `form` 이 True 인 것만 폼 뷰에 노출한다 (UI 에서 그렇게 고른다).
FIELDS = [
    # --- 담당자가 채운다 (구글시트 C~H 열과 1:1)
    {"name": "런칭 지역", "type": "singleLineText", "form": True,
     "description": "한글명. 예: 하남"},
    {"name": "런칭 챕터", "type": "singleLineText", "form": True,
     "description": "한글명. 예: 시그니아"},
    {"name": "런칭 예정일", "type": "date", "form": True,
     "options": {"dateFormat": {"name": "iso"}},
     "description": "챕터 시트·페이지 비밀번호가 이 날짜의 MMDD 로 정해진다"},
    {"name": "BNI Connect 지원서 등록 완료", **YESNO, "form": True,
     "description": "NO 면 멤버 명단을 받을 수 없다"},
    {"name": "런칭 버튼 활성화", **YESNO, "form": True,
     "description": "YES 인 건만 처리 대상이다"},
    {"name": "담당자", "type": "singleLineText", "form": True},
    {"name": "비고", "type": "multilineText", "form": True},

    # --- 파이프라인이 채운다 (폼에는 안 보인다)
    # 남의 구글시트에는 처리 이력을 못 남겨 로컬 JSON 에 뒀었다.
    # Airtable 은 우리 것이라 여기에 바로 쓸 수 있다.
    {"name": "처리 상태", "type": "singleSelect", "form": False,
     "options": {"choices": [{"name": "대기"}, {"name": "생성완료"},
                             {"name": "게시완료"}, {"name": "보류"}]}},
    {"name": "지역 영문명", "type": "singleLineText", "form": False,
     "description": "기존 지역이면 imweb 페이지 url 에서 자동 획득"},
    {"name": "챕터 영문명", "type": "singleLineText", "form": False,
     "description": "BNI Connect 추출에서 역산 — 추측하지 않는다"},
    {"name": "챕터 시트", "type": "url", "form": False},
    {"name": "챕터 페이지", "type": "singleLineText", "form": False},
    {"name": "처리 로그", "type": "multilineText", "form": False},
]


# ---------------------------------------------------------------- API

class AirtableError(RuntimeError):
    pass


def token() -> str:
    if not TOKEN_FILE.exists():
        raise SystemExit(
            f"토큰 파일이 없다: {TOKEN_FILE}\n"
            "  https://airtable.com/create/tokens 에서 PAT 를 만들고\n"
            "  `TOKEN : pat...` 한 줄로 저장하세요.\n"
            "  스코프: data.records:read, data.records:write,"
            " schema.bases:read, schema.bases:write")
    raw = TOKEN_FILE.read_text(encoding="utf-8").strip()
    return (raw.split(":", 1)[1] if ":" in raw.split("\n")[0] else raw).strip()


def call(method: str, path: str, **kw) -> dict:
    r = requests.request(method, f"{API}/{path}",
                         headers={"Authorization": f"Bearer {token()}",
                                  "Content-Type": "application/json"},
                         timeout=30, **kw)
    if r.status_code >= 400:
        raise AirtableError(f"{method} {path} → {r.status_code}\n{r.text[:600]}")
    return r.json() if r.text else {}


def list_bases() -> list[dict]:
    out, offset = [], None
    while True:
        p = f"meta/bases?offset={offset}" if offset else "meta/bases"
        d = call("GET", p)
        out += d.get("bases", [])
        offset = d.get("offset")
        if not offset:
            return out


def base_tables(base_id: str) -> list[dict]:
    return call("GET", f"meta/bases/{base_id}/tables").get("tables", [])


def field_payload(f: dict) -> dict:
    """FIELDS 항목 → Airtable 필드 생성 페이로드 (`form` 키는 우리 것이라 뺀다)."""
    return {k: v for k, v in f.items() if k in ("name", "type", "options", "description")}


# ---------------------------------------------------------------- 생성

def create_base(workspace_id: str) -> dict:
    """베이스 생성. 베이스는 테이블 없이 못 만들어 첫 테이블을 같이 넘긴다."""
    return call("POST", "meta/bases", data=json.dumps({
        "name": BASE_NAME,
        "workspaceId": workspace_id,
        "tables": [{"name": TABLE_NAME,
                    "fields": [field_payload(f) for f in FIELDS]}],
    }))


def create_table(base_id: str) -> dict:
    return call("POST", f"meta/bases/{base_id}/tables", data=json.dumps({
        "name": TABLE_NAME,
        "fields": [field_payload(f) for f in FIELDS],
    }))


def sync_fields(base_id: str, table: dict) -> list[str]:
    """이미 있는 테이블에 빠진 필드만 더한다 (있는 필드는 건드리지 않는다)."""
    have = {f["name"] for f in table["fields"]}
    added = []
    for f in FIELDS:
        if f["name"] in have:
            continue
        call("POST", f"meta/bases/{base_id}/tables/{table['id']}/fields",
             data=json.dumps(field_payload(f)))
        added.append(f["name"])
    return added


# ---------------------------------------------------------------- 구글시트 이관

def sheet_rows() -> list[dict]:
    """기존 구글시트 신청 건을 읽어 Airtable 레코드 형태로."""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from google_auth import sa_services
    _, sheets = sa_services()
    v = sheets.spreadsheets().values().get(
        spreadsheetId=FORM_SHEET_ID, range=f"{FORM_SHEET_TAB}!A2:H").execute().get("values", [])
    out = []
    for row in v:
        row = row + [""] * (8 - len(row))
        _no, _when, region, chapter, launch, connect_ok, active, owner = row[:8]
        if not (region.strip() or chapter.strip()):
            continue
        rec = {
            "런칭 지역": region.strip(),
            "런칭 챕터": chapter.strip(),
            "담당자": owner.strip(),
            "처리 상태": "대기",
        }
        if launch.strip():
            rec["런칭 예정일"] = launch.strip()
        for k, val in (("BNI Connect 지원서 등록 완료", connect_ok), ("런칭 버튼 활성화", active)):
            s = val.strip().upper()
            if s in ("YES", "NO"):
                rec[k] = s
        out.append(rec)
    return out


def push_records(base_id: str, table_id: str, records: list[dict]) -> int:
    n = 0
    for i in range(0, len(records), 10):           # Airtable 은 한 번에 10건
        call("POST", f"{base_id}/{table_id}", data=json.dumps({
            "records": [{"fields": r} for r in records[i:i + 10]],
            "typecast": True,
        }))
        n += len(records[i:i + 10])
    return n


# ---------------------------------------------------------------- main

def main() -> None:
    ap = argparse.ArgumentParser(description="[0] Airtable 접수 채널 세팅")
    ap.add_argument("--check", action="store_true", help="토큰·권한 확인만")
    ap.add_argument("--workspace", help="새 베이스를 만들 워크스페이스 id (wsp…)")
    ap.add_argument("--base", help="기존 베이스 id (app…)")
    ap.add_argument("--import-sheet", action="store_true", help="구글시트 기존 건 이관")
    ap.add_argument("--apply", action="store_true", help="실제 생성 (미지정 시 dry-run)")
    a = ap.parse_args()

    if a.check or not (a.workspace or a.base):
        bases = list_bases()
        print(f"토큰 OK · 접근 가능한 베이스 {len(bases)}개")
        for b in bases:
            print(f"  {b['id']}  {b['name']}   (권한 {b.get('permissionLevel')})")
        if not a.check:
            print("\n--workspace wsp… (새 베이스) 또는 --base app… (기존 베이스) 를 주세요.")
            print("  워크스페이스 id 는 브라우저 주소 airtable.com/wspXXXXXXXX/... 에 있습니다.")
        return

    if not a.apply:
        print(f"[DRY-RUN] 베이스 `{BASE_NAME}` · 테이블 `{TABLE_NAME}` · 필드 {len(FIELDS)}개")
        for f in FIELDS:
            print(f"  {'폼' if f['form'] else '  '} {f['name']:28} {f['type']}")
        print("\n--apply 를 붙여야 실제로 만듭니다.")
        return

    if a.workspace:
        b = create_base(a.workspace)
        base_id, table_id = b["id"], b["tables"][0]["id"]
        print(f"✓ 베이스 생성 {base_id} · 테이블 {table_id}")
    else:
        base_id = a.base
        tables = base_tables(base_id)
        t = next((x for x in tables if x["name"] == TABLE_NAME), None)
        if t:
            added = sync_fields(base_id, t)
            table_id = t["id"]
            print(f"✓ 기존 테이블 {table_id} · 필드 추가 {added or '없음'}")
        else:
            t = create_table(base_id)
            table_id = t["id"]
            print(f"✓ 테이블 생성 {table_id}")

    if a.import_sheet:
        rows = sheet_rows()
        n = push_records(base_id, table_id, rows)
        print(f"✓ 구글시트 신청 {n}건 이관")

    print(f"\n베이스: https://airtable.com/{base_id}")
    print("▶ 남은 것(UI): 폼 뷰 1개 만들기 — 위 `폼` 표시 필드만 켜고 나머지는 끄세요.")


if __name__ == "__main__":
    main()
