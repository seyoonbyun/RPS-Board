# -*- coding: utf-8 -*-
r"""노션 `MyPowerTeam RPI Viewer` 에 페이지 비밀번호를 등재한다.

    python notion_pw.py                          # 현황 (지역·챕터 몇 건씩)
    python notion_pw.py --check                  # 토큰·DB 접근만 확인
    python notion_pw.py --region "Suwon2 수원2" --pw 4821 --sheet <URL> --apply
    python notion_pw.py --chapter Signia --region "Hanam 하남" --pw 0728 \
                        --launch 2026-07-28 --sheet <URL> --apply

왜 필요한가
    ⛔ imweb 은 비밀번호를 **bcrypt 해시로 저장**해 관리자 API 로도 평문을 되읽을 수 없다.
      설정한 즉시 적어 두지 않으면 **영영 모른다** — 실제로 지역 5개가 그렇게 유실됐다
      (2026-08-18 발견). 그래서 페이지를 만든 직후 여기에 남긴다.

    정본은 노션, 볼트 `99. Private/rpi page pw/` 는 사본이다.

두 DB
    `Admin & By region`    지역(title) · PW · Direct Link · No.
    `Chapter Viewer PW`    지역(title) · 챕터 · PW · Launching effective date · 상태 · Direct Link · No.

⚠ `지역`(title) 표기는 기존 행을 그대로 따른다 — 지역 DB 는 `<Eng> <Kor> All_rps`,
   챕터 DB 는 지역이 `<Eng> <Kor>` 이고 `챕터` 가 `<Eng>_rps` 다. 섞으면 사람이 못 찾는다.
⚠ **이미 있으면 덮어쓰지 않는다.** 비번을 바꾸는 건 사람이 판단할 일이고, 잘못 덮으면
   기존 사용자가 못 들어간다.

토큰은 `C:\DEV\rpslist\sync.py` 에 있는 것을 그대로 읽어 쓴다 — 값을 이 저장소에
복사해 두지 않기 위해서다(여기는 GitHub 에 올라간다).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

import requests                                             # noqa: E402

SYNC_PY = Path(r"C:\DEV\rpslist\sync.py")
API = "https://api.notion.com/v1"
VERSION = "2022-06-28"


class NotionError(RuntimeError):
    pass


def _conf() -> tuple[str, str, str]:
    """(토큰, 지역DB, 챕터DB). 값을 이 저장소에 복사하지 않으려고 매번 읽는다."""
    if not SYNC_PY.exists():
        raise NotionError(f"노션 설정을 찾지 못했다: {SYNC_PY}")
    src = SYNC_PY.read_text(encoding="utf-8", errors="replace")

    def grab(name: str) -> str:
        m = re.search(rf"{name}\s*=\s*'([^']+)'", src)
        if not m:
            raise NotionError(f"{SYNC_PY.name} 에서 {name} 를 찾지 못했다")
        return m.group(1)

    return grab("NOTION_TOKEN"), grab("NOTION_REGION_DB"), grab("NOTION_CHAPTER_DB")


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Notion-Version": VERSION,
            "Content-Type": "application/json"}


def _plain(prop: dict) -> str:
    t = prop.get("type")
    v = prop.get(t)
    if t in ("title", "rich_text"):
        return "".join(x["plain_text"] for x in (v or []))
    if t == "select":
        return (v or {}).get("name", "")
    if t == "date":
        return (v or {}).get("start", "") or ""
    return str(v or "")


def rows(db: str, token: str) -> list[dict]:
    out, cursor = [], None
    while True:
        body = {"page_size": 100}
        if cursor:
            body["start_cursor"] = cursor
        r = requests.post(f"{API}/databases/{db}/query", headers=_headers(token),
                          data=json.dumps(body), timeout=40)
        if not r.ok:
            raise NotionError(f"조회 실패 {r.status_code} {r.text[:200]}")
        d = r.json()
        out += d["results"]
        if not d.get("has_more"):
            return out
        cursor = d.get("next_cursor")


def _next_no(existing: list[dict]) -> str:
    """`No.` 는 `01` `02` … 형식의 문자열이다. 최대값 + 1."""
    nums = []
    for p in existing:
        s = _plain(p["properties"].get("No.", {})).strip()
        if s.isdigit():
            nums.append(int(s))
    return f"{(max(nums) + 1) if nums else 1:02d}"


def _rt(s: str) -> dict:
    return {"rich_text": [{"text": {"content": str(s)[:1900]}}]}


def add_region(label: str, pw: str, sheet: str = "", *, apply: bool = False) -> str:
    """지역 등재. `label` 은 모 시트 표기(`Suwon2 수원2`) — DB 표기로 바꿔 넣는다."""
    token, reg_db, _ = _conf()
    title = f"{label.strip()} All_rps"
    existing = rows(reg_db, token)
    for p in existing:
        if _plain(p["properties"]["지역"]).strip().casefold() == title.casefold():
            cur = _plain(p["properties"].get("PW", {}))
            return f"이미 있음 (PW {cur or '(빈값)'}) — 덮어쓰지 않았다"
    if not apply:
        return f"[dry-run] 추가 예정 · 지역 `{title}` · PW {pw}"
    props = {"지역": {"title": [{"text": {"content": title}}]},
             "PW": _rt(pw), "No.": _rt(_next_no(existing))}
    if sheet:
        props["Direct Link"] = {"url": sheet}
    r = requests.post(f"{API}/pages", headers=_headers(token), timeout=40,
                      data=json.dumps({"parent": {"database_id": reg_db},
                                       "properties": props}, ensure_ascii=False))
    if not r.ok:
        raise NotionError(f"등재 실패 {r.status_code} {r.text[:200]}")
    return f"등재 완료 · 지역 `{title}` · PW {pw}"


def add_chapter(chapter_eng: str, region_label: str, pw: str, launch: str = "",
                sheet: str = "", status: str = "활동중", *, apply: bool = False) -> str:
    """챕터 등재. 챕터 DB 는 `지역`(title)=`<Eng> <Kor>` · `챕터`=`<Eng>_rps` 다."""
    token, _, cha_db = _conf()
    chap = f"{chapter_eng.strip()}_rps"
    existing = rows(cha_db, token)
    for p in existing:
        if _plain(p["properties"].get("챕터", {})).strip().casefold() == chap.casefold():
            cur = _plain(p["properties"].get("PW", {}))
            return f"이미 있음 (PW {cur or '(빈값)'}) — 덮어쓰지 않았다"
    if not apply:
        return f"[dry-run] 추가 예정 · 챕터 `{chap}` ({region_label}) · PW {pw}"
    props = {"지역": {"title": [{"text": {"content": region_label.strip()}}]},
             "챕터": _rt(chap), "PW": _rt(pw), "No.": _rt(_next_no(existing))}
    if launch:
        props["Launching effective date"] = {"date": {"start": launch}}
    if status:
        props["상태"] = {"select": {"name": status}}
    if sheet:
        props["Direct Link"] = {"url": sheet}
    r = requests.post(f"{API}/pages", headers=_headers(token), timeout=40,
                      data=json.dumps({"parent": {"database_id": cha_db},
                                       "properties": props}, ensure_ascii=False))
    if not r.ok:
        raise NotionError(f"등재 실패 {r.status_code} {r.text[:200]}")
    return f"등재 완료 · 챕터 `{chap}` ({region_label}) · PW {pw}"


def main() -> int:
    ap = argparse.ArgumentParser(description="노션 RPI Viewer 비밀번호 등재")
    ap.add_argument("--check", action="store_true", help="토큰·DB 접근 확인")
    ap.add_argument("--region", help="지역 (모 시트 표기, 예 'Suwon2 수원2')")
    ap.add_argument("--chapter", help="챕터 영문명 (예 Signia)")
    ap.add_argument("--pw", help="4자리 비밀번호")
    ap.add_argument("--launch", default="", help="런칭일 YYYY-MM-DD (챕터)")
    ap.add_argument("--sheet", default="", help="구글시트 URL")
    ap.add_argument("--apply", action="store_true", help="실제 등재")
    a = ap.parse_args()

    token, reg_db, cha_db = _conf()
    if a.check or not (a.region or a.chapter):
        r = rows(reg_db, token)
        c = rows(cha_db, token)
        print(f"토큰 정상 · `Admin & By region` {len(r)}행 · `Chapter Viewer PW` {len(c)}행")
        if not a.check and not (a.region or a.chapter):
            print("\n등재하려면 --region 또는 --chapter 와 --pw 를 주세요.")
        return 0

    if not a.pw or not re.fullmatch(r"\d{4}", a.pw):
        raise SystemExit("--pw 는 숫자 4자리여야 한다")
    if a.chapter:
        if not a.region:
            raise SystemExit("--chapter 는 --region (지역 표기) 이 함께 필요하다")
        print(add_chapter(a.chapter, a.region, a.pw, a.launch, a.sheet, apply=a.apply))
    else:
        print(add_region(a.region, a.pw, a.sheet, apply=a.apply))
    return 0


if __name__ == "__main__":
    sys.exit(main())
