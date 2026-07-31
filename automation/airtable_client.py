# -*- coding: utf-8 -*-
r"""Airtable `런칭 신청` 테이블 읽기·쓰기 — watcher / pipeline 공용.

접수 채널이 구글시트에서 Airtable 로 바뀌었다(2026-08-01).
바뀐 것은 **입구뿐**이고 pipeline 본체는 그대로다.

구글시트 때와 결정적으로 다른 점: **이 테이블은 우리 것**이다.
남의 시트라 처리 이력을 로컬 `launch_state.json` 에 따로 뒀었는데,
이제 `처리 상태`·`처리 로그` 필드에 바로 쓴다 → 상태가 한 곳에만 있다.

    python airtable_client.py            # 접수 현황 출력 (연결 확인용)

스키마는 `airtable_setup.py` 의 FIELDS 가 원본이다. 여기서는 읽고 쓸 뿐이다.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

import requests                                    # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
import paths                                       # noqa: E402

API = "https://api.airtable.com/v0"
BASE_ID = "appmBdOMAhjhyATUI"
TABLE_ID = "tbl9jNapBtLTjijjc"          # `런칭 신청`

# 필드명은 한글이라 오타가 나면 조용히 무시된다(Airtable 이 400 을 주지만
# 이름이 미세하게 다르면 찾기 어렵다) → 여기 상수로만 쓴다.
F_REGION_KOR = "런칭 지역"
F_CHAPTER_KOR = "런칭 챕터"
F_LAUNCH = "런칭 예정일"
F_CONNECT_OK = "BNI Connect 지원서 등록 완료"
F_ACTIVE = "런칭 버튼 활성화"
F_OWNER = "담당자"
F_OWNER_PHONE = "담당자 연락처"
F_NOTE = "비고"
F_STATUS = "처리 상태"
F_REGION_ENG = "지역 영문명"
F_CHAPTER_ENG = "챕터 영문명"
F_SHEET = "챕터 시트"
F_PAGE = "챕터 페이지"
F_LOG = "처리 로그"

# `처리 상태` singleSelect 의 선택지 (airtable_setup.py 와 같아야 한다)
ST_WAIT = "대기"
ST_CREATED = "생성완료"
ST_PUBLISHED = "게시완료"
ST_HOLD = "보류"

#: 아직 손대지 않은 것으로 보는 상태. 빈 값도 포함한다.
OPEN_STATUS = {"", ST_WAIT}


class AirtableError(RuntimeError):
    pass


def _token() -> str:
    return paths.read_token_file(paths.airtable_token(), "Airtable")


def call(method: str, path: str, **kw) -> dict:
    r = requests.request(method, f"{API}/{path}",
                         headers={"Authorization": f"Bearer {_token()}",
                                  "Content-Type": "application/json"},
                         timeout=30, **kw)
    if r.status_code >= 400:
        raise AirtableError(f"{method} {path} → {r.status_code}\n{r.text[:600]}")
    return r.json() if r.text else {}


# ---------------------------------------------------------------- 읽기

def list_records() -> list[dict]:
    """전체 신청 레코드. `{id, fields}` 그대로 돌려준다."""
    out, offset = [], None
    while True:
        p = f"{BASE_ID}/{TABLE_ID}"
        if offset:
            p += f"?offset={offset}"
        d = call("GET", p)
        out += d.get("records", [])
        offset = d.get("offset")
        if not offset:
            return out


def as_application(rec: dict) -> dict:
    """레코드 → watcher 가 다루기 쉬운 납작한 dict.

    구글시트 때의 키 이름을 그대로 유지한다(watcher 아래쪽 코드가 그대로 돈다).
    """
    f = rec.get("fields", {})

    def s(name: str) -> str:
        return str(f.get(name, "") or "").strip()

    return {
        "id": rec["id"],
        "region_kor": s(F_REGION_KOR),
        "chapter_kor": s(F_CHAPTER_KOR),
        "launch": s(F_LAUNCH),                      # date 필드는 ISO(YYYY-MM-DD)
        "connect_ok": s(F_CONNECT_OK).upper() == "YES",
        "active": s(F_ACTIVE).upper() == "YES",
        "owner": s(F_OWNER),
        "owner_phone": s(F_OWNER_PHONE),
        "note": s(F_NOTE),
        "status": s(F_STATUS),
        "region_eng": s(F_REGION_ENG),
        "chapter_eng": s(F_CHAPTER_ENG),
        "sheet": s(F_SHEET),
        "page": s(F_PAGE),
        "log": s(F_LOG),
        "created": rec.get("createdTime", ""),
    }


def applications() -> list[dict]:
    """접수 순서(오래된 것부터)로 정렬해 돌려준다."""
    return sorted((as_application(r) for r in list_records()),
                  key=lambda x: x["created"])


def pending(apps: list[dict] | None = None) -> list[dict]:
    """처리 대상 — `런칭 버튼 활성화 = YES` 이고 아직 손대지 않은 건."""
    return [x for x in (apps if apps is not None else applications())
            if x["active"] and x["status"] in OPEN_STATUS]


# ---------------------------------------------------------------- 쓰기

def update(record_id: str, fields: dict) -> dict:
    """빈 값은 보내지 않는다 — 이미 있는 값을 실수로 지우지 않기 위해서다."""
    clean = {k: v for k, v in fields.items() if v not in ("", None)}
    if not clean:
        return {}
    return call("PATCH", f"{BASE_ID}/{TABLE_ID}/{record_id}",
                data=json.dumps({"fields": clean, "typecast": True}))


def append_log(record_id: str, line: str, current: str = "") -> dict:
    """처리 로그에 한 줄 덧붙인다(덮어쓰지 않는다)."""
    text = (current + "\n" + line).strip() if current else line
    return update(record_id, {F_LOG: text})


# ---------------------------------------------------------------- 확인용

def main() -> None:
    apps = applications()
    todo = pending(apps)
    print(f"접수 {len(apps)}건 · 런칭버튼 YES {sum(1 for x in apps if x['active'])}건 "
          f"· 미처리 {len(todo)}건\n")
    for x in apps:
        mark = "▶" if x in todo else ("…" if x["status"] else "·")
        note = "" if x["active"] else "  (런칭버튼 미활성 — 대상 아님)"
        print(f" {mark} {x['region_kor']} {x['chapter_kor']} · 런칭 {x['launch'] or '-'} "
              f"· 담당 {x['owner'] or '-'} · 상태 {x['status'] or '(빈값)'}{note}")


if __name__ == "__main__":
    main()
