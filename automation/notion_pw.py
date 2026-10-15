# -*- coding: utf-8 -*-
r"""노션 `MyPowerTeam RPI Viewer` 에 페이지 비밀번호를 등재한다 — 정본·사본 두 벌 모두.

    python notion_pw.py                          # 현황 (정본·사본 지역·챕터 몇 건씩)
    python notion_pw.py --check                  # 토큰·DB 접근만 확인
    python notion_pw.py --region "Suwon2 수원2" --pw 4821 --sheet <URL> --apply
    python notion_pw.py --chapter Signia --kor 시그니아 --region "Hanam 하남" --pw 0728 \
                        --launch 2026-07-28 --sheet <URL> --apply

왜 필요한가
    ⛔ imweb 은 비밀번호를 **bcrypt 해시로 저장**해 관리자 API 로도 평문을 되읽을 수 없다.
      설정한 즉시 적어 두지 않으면 **영영 모른다** — 실제로 지역 5개가 그렇게 유실됐다
      (2026-08-18 발견). 그래서 페이지를 만든 직후 여기에 남긴다.

노션은 두 벌이다 (2026-10-07 사용자 확정)
    정본 = 개인 `SYOON` 워크스페이스 (seyoonbyun/MyPowerTeam-RPI-Viewer-52064f13…)
           사람이 보는 쪽. 토큰 = 자격증명 폴더 `notion_syoon_token.txt`
    사본 = 팀 `BNI Korea님의 워크스페이스` (MyPowerTeam-RPI-Viewer-34739e9f…)
           토큰·DB = `C:\DEV\rpslist\sync.py`
    ⛔ 예전엔 사본에만 썼다 → 신규 챕터가 정본에 안 들어가 둘이 어긋났다(2026-09-21 발견).
       **정본 먼저, 그다음 사본.** 한쪽이 실패해도 다른 쪽은 쓰고, 끝에 실패를 올린다.
    볼트 `99. Private/rpi page pw/` 는 또 다른 사본이다.

DB 구성이 서로 다르다
    정본 `Admin & By region`  `<Eng> <Kor> All`(title) · PW. · Direct Link. …
    정본 `Chapter Viewer PW.` 직영/지역(title) · 지역명 · PW. · Direct Link. · 챕터명_Kor.
                              · 챕터명_Eng.(multi_select) · 상태(있으면)
    사본 `Admin & By region`  지역(title)=`<Eng> <Kor> All_rps` · PW · Direct Link · No.
    사본 `Chapter Viewer PW`  지역(title)=`<Eng> <Kor>` · 챕터=`<Eng>_rps` · PW
                              · Launching effective date · 상태 · Direct Link · No.
    정본 열 이름은 `PW.`·`Direct Link. ※ 관계자 외 …` 처럼 꼬리가 붙어 있어 **앞부분으로 찾는다.**

⚠ 표기는 기존 행을 그대로 따른다. 섞으면 사람이 못 찾는다.
⚠ **이미 있으면 덮어쓰지 않는다.** 비번을 바꾸는 건 사람이 판단할 일이고, 잘못 덮으면
   기존 사용자가 못 들어간다.

토큰 값은 이 저장소에 복사하지 않는다(여기는 GitHub 에 올라간다).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent))

import requests                                             # noqa: E402

import paths                                                # noqa: E402

SYNC_PY = Path(r"C:\DEV\rpslist\sync.py")
API = "https://api.notion.com/v1"
VERSION = "2022-06-28"

# 정본 (개인 SYOON). 노션 공개 API 의 database_id = 컬렉션 id.
MASTER_TOKEN_FILE = "notion_syoon_token.txt"
MASTER_REGION_DB = "0a31f7f1-2e20-48c9-bd4a-d369f1883e79"
MASTER_CHAPTER_DB = "6e20825b-40d4-459c-a6b5-a084580a11a1"

# 모 시트 표기 → 정본 `지역명` 표기. 정본은 `Central 중구` 로 통일돼 있다(2026-10-07 사용자 확정).
MASTER_REGION_ALIAS = {"Seoul Central 중구": "Central 중구"}


class NotionError(RuntimeError):
    pass


def _conf() -> tuple[str, str, str]:
    """사본 (토큰, 지역DB, 챕터DB). 값을 이 저장소에 복사하지 않으려고 매번 읽는다."""
    if not SYNC_PY.exists():
        raise NotionError(f"노션 설정을 찾지 못했다: {SYNC_PY}")
    src = SYNC_PY.read_text(encoding="utf-8", errors="replace")

    def grab(name: str) -> str:
        m = re.search(rf"{name}\s*=\s*'([^']+)'", src)
        if not m:
            raise NotionError(f"{SYNC_PY.name} 에서 {name} 를 찾지 못했다")
        return m.group(1)

    return grab("NOTION_TOKEN"), grab("NOTION_REGION_DB"), grab("NOTION_CHAPTER_DB")


def _master_token() -> str:
    path = paths.cred_dir() / MASTER_TOKEN_FILE
    if not path.exists():
        raise NotionError(f"정본 토큰 파일이 없다: {path}")
    tok = paths.read_token_file(path, "노션 정본")
    if not tok:
        raise NotionError(f"정본 토큰 파일이 비어 있다: {path}")
    return tok


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
    if t == "multi_select":
        return ",".join(x.get("name", "") for x in (v or []))
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


def _schema(db: str, token: str) -> dict[str, str]:
    """{열 이름: 유형}"""
    r = requests.get(f"{API}/databases/{db}", headers=_headers(token), timeout=40)
    if not r.ok:
        raise NotionError(f"DB 조회 실패 {r.status_code} {r.text[:200]}")
    return {k: v["type"] for k, v in r.json()["properties"].items()}


def _col(schema: dict[str, str], prefix: str = "", type_: str = "") -> str:
    """앞부분(또는 유형)으로 열 이름을 찾는다. 없으면 빈 문자열."""
    for name, t in schema.items():
        if type_ and t != type_:
            continue
        if not prefix or name.startswith(prefix):
            return name
    return ""


def _create(db: str, token: str, props: dict) -> None:
    r = requests.post(f"{API}/pages", headers=_headers(token), timeout=40,
                      data=json.dumps({"parent": {"database_id": db},
                                       "properties": props}, ensure_ascii=False))
    if not r.ok:
        raise NotionError(f"등재 실패 {r.status_code} {r.text[:200]}")


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


def _title(s: str) -> dict:
    return {"title": [{"text": {"content": str(s)}}]}


def _eng_part(label: str) -> str:
    """`Seoul Central 중구` → `seoul central`. 커넥트·모 시트 표기가 한글 쪽만 달라서 영문으로 맞춘다."""
    return " ".join(w for w in label.split() if re.fullmatch(r"[A-Za-z0-9]+", w)).casefold()


def is_direct(region_label: str) -> bool:
    """직영 판정은 지역 단위, 정본은 `direct_regions.txt`."""
    path = paths.cred_dir() / "direct_regions.txt"
    if not path.exists():
        raise NotionError(f"직영 지역 목록이 없다: {path}")
    direct = {_eng_part(s) for s in path.read_text(encoding="utf-8").splitlines()
              if s.strip() and not s.lstrip().startswith("#")}
    return _eng_part(region_label) in direct


def _master_region_name(label: str) -> str:
    label = label.strip()
    return MASTER_REGION_ALIAS.get(label, label)


# ---------------------------------------------------------------- 정본 (개인)

def _master_add_region(label: str, pw: str, sheet: str, apply: bool) -> str:
    token = _master_token()
    sch = _schema(MASTER_REGION_DB, token)
    title_col = _col(sch, type_="title")
    pw_col, link_col = _col(sch, "PW"), _col(sch, "Direct Link")
    title = f"{_master_region_name(label)} All"
    for p in rows(MASTER_REGION_DB, token):
        if _plain(p["properties"][title_col]).strip().casefold() == title.casefold():
            cur = _plain(p["properties"].get(pw_col, {}))
            return f"정본: 이미 있음 (PW {cur or '(빈값)'}) — 덮어쓰지 않았다"
    if not apply:
        return f"정본: [dry-run] 추가 예정 · `{title}` · PW {pw}"
    props = {title_col: _title(title), pw_col: _rt(pw)}
    if sheet and link_col:
        props[link_col] = {"url": sheet}
    _create(MASTER_REGION_DB, token, props)
    return f"정본: 등재 완료 · `{title}` · PW {pw}"


def _master_add_chapter(eng: str, kor: str, region_label: str, pw: str, sheet: str,
                        status: str, apply: bool) -> str:
    token = _master_token()
    sch = _schema(MASTER_CHAPTER_DB, token)
    title_col = _col(sch, type_="title")                     # 직영/지역
    eng_col, kor_col = _col(sch, "챕터명_Eng"), _col(sch, "챕터명_Kor")
    reg_col, pw_col, link_col = _col(sch, "지역명"), _col(sch, "PW"), _col(sch, "Direct Link")
    status_col = _col(sch, "상태")
    for p in rows(MASTER_CHAPTER_DB, token):
        names = [x.casefold() for x in _plain(p["properties"].get(eng_col, {})).split(",")]
        if eng.casefold() in names:
            cur = _plain(p["properties"].get(pw_col, {}))
            return f"정본: 이미 있음 (PW {cur or '(빈값)'}) — 덮어쓰지 않았다"
    kind = "직영" if is_direct(region_label) else "지역"
    region = _master_region_name(region_label)
    if not apply:
        return f"정본: [dry-run] 추가 예정 · {eng} {kor} ({region}·{kind}) · PW {pw}"
    props = {title_col: _title(kind), eng_col: {"multi_select": [{"name": eng}]},
             reg_col: _rt(region), pw_col: _rt(pw)}
    if kor and kor_col:
        props[kor_col] = _rt(kor)
    if sheet and link_col:
        props[link_col] = {"url": sheet}
    if status and status_col:
        props[status_col] = {"select": {"name": status}}
    _create(MASTER_CHAPTER_DB, token, props)
    return f"정본: 등재 완료 · {eng} {kor} ({region}·{kind}) · PW {pw}"


# ---------------------------------------------------------------- 사본 (팀)

def _copy_add_region(label: str, pw: str, sheet: str, apply: bool) -> str:
    token, reg_db, _ = _conf()
    title = f"{label.strip()} All_rps"
    existing = rows(reg_db, token)
    for p in existing:
        if _plain(p["properties"]["지역"]).strip().casefold() == title.casefold():
            cur = _plain(p["properties"].get("PW", {}))
            return f"사본: 이미 있음 (PW {cur or '(빈값)'}) — 덮어쓰지 않았다"
    if not apply:
        return f"사본: [dry-run] 추가 예정 · 지역 `{title}` · PW {pw}"
    props = {"지역": _title(title), "PW": _rt(pw), "No.": _rt(_next_no(existing))}
    if sheet:
        props["Direct Link"] = {"url": sheet}
    _create(reg_db, token, props)
    return f"사본: 등재 완료 · 지역 `{title}` · PW {pw}"


def _copy_add_chapter(chapter_eng: str, region_label: str, pw: str, launch: str,
                      sheet: str, status: str, apply: bool) -> str:
    token, _, cha_db = _conf()
    chap = f"{chapter_eng.strip()}_rps"
    existing = rows(cha_db, token)
    for p in existing:
        if _plain(p["properties"].get("챕터", {})).strip().casefold() == chap.casefold():
            cur = _plain(p["properties"].get("PW", {}))
            return f"사본: 이미 있음 (PW {cur or '(빈값)'}) — 덮어쓰지 않았다"
    if not apply:
        return f"사본: [dry-run] 추가 예정 · 챕터 `{chap}` ({region_label}) · PW {pw}"
    props = {"지역": _title(region_label.strip()),
             "챕터": _rt(chap), "PW": _rt(pw), "No.": _rt(_next_no(existing))}
    if launch:
        props["Launching effective date"] = {"date": {"start": launch}}
    if status:
        props["상태"] = {"select": {"name": status}}
    if sheet:
        props["Direct Link"] = {"url": sheet}
    _create(cha_db, token, props)
    return f"사본: 등재 완료 · 챕터 `{chap}` ({region_label}) · PW {pw}"


# ---------------------------------------------------------------- 공개 함수

def _both(*calls) -> str:
    """정본 → 사본 순서로 둘 다 시도한다. 하나라도 실패하면 둘의 결과를 담아 올린다."""
    msgs, failed = [], False
    for fn in calls:
        try:
            msgs.append(fn())
        except Exception as e:                               # noqa: BLE001
            failed = True
            msgs.append(f"⚠ {fn.__name__}: 실패 {e.__class__.__name__} {e}")
    msg = " / ".join(msgs)
    if failed:
        raise NotionError(msg)
    return msg


def add_region(label: str, pw: str, sheet: str = "", *, apply: bool = False) -> str:
    """지역 등재. `label` 은 모 시트 표기(`Suwon2 수원2`) — DB 마다 표기를 바꿔 넣는다."""
    def 정본(): return _master_add_region(label, pw, sheet, apply)
    def 사본(): return _copy_add_region(label, pw, sheet, apply)
    return _both(정본, 사본)


def add_chapter(chapter_eng: str, region_label: str, pw: str, launch: str = "",
                sheet: str = "", status: str = "활동중", *, chapter_kor: str = "",
                apply: bool = False) -> str:
    """챕터 등재. 정본엔 한글명·직영/지역까지, 사본엔 `<Eng>_rps`·런칭일까지 넣는다."""
    eng = chapter_eng.strip()

    def 정본(): return _master_add_chapter(eng, chapter_kor.strip(), region_label, pw,
                                           sheet, status, apply)

    def 사본(): return _copy_add_chapter(eng, region_label, pw, launch, sheet, status, apply)
    return _both(정본, 사본)


def main() -> int:
    ap = argparse.ArgumentParser(description="노션 RPI Viewer 비밀번호 등재 (정본·사본)")
    ap.add_argument("--check", action="store_true", help="토큰·DB 접근 확인")
    ap.add_argument("--region", help="지역 (모 시트 표기, 예 'Suwon2 수원2')")
    ap.add_argument("--chapter", help="챕터 영문명 (예 Signia)")
    ap.add_argument("--kor", default="", help="챕터 한글명 (정본 `챕터명_Kor.`)")
    ap.add_argument("--pw", help="4자리 비밀번호")
    ap.add_argument("--launch", default="", help="런칭일 YYYY-MM-DD (챕터)")
    ap.add_argument("--sheet", default="", help="구글시트 URL")
    ap.add_argument("--apply", action="store_true", help="실제 등재")
    a = ap.parse_args()

    if a.check or not (a.region or a.chapter):
        ok = True
        try:
            t = _master_token()
            print(f"정본 토큰 정상 · `Admin & By region` {len(rows(MASTER_REGION_DB, t))}행"
                  f" · `Chapter Viewer PW.` {len(rows(MASTER_CHAPTER_DB, t))}행")
        except Exception as e:                               # noqa: BLE001
            ok = False
            print(f"⚠ 정본 접근 실패: {e}")
        try:
            token, reg_db, cha_db = _conf()
            print(f"사본 토큰 정상 · `Admin & By region` {len(rows(reg_db, token))}행"
                  f" · `Chapter Viewer PW` {len(rows(cha_db, token))}행")
        except Exception as e:                               # noqa: BLE001
            ok = False
            print(f"⚠ 사본 접근 실패: {e}")
        if not a.check and not (a.region or a.chapter):
            print("\n등재하려면 --region 또는 --chapter 와 --pw 를 주세요.")
        return 0 if ok else 1

    if not a.pw or not re.fullmatch(r"\d{4}", a.pw):
        raise SystemExit("--pw 는 숫자 4자리여야 한다")
    if a.chapter:
        if not a.region:
            raise SystemExit("--chapter 는 --region (지역 표기) 이 함께 필요하다")
        print(add_chapter(a.chapter, a.region, a.pw, a.launch, a.sheet,
                          chapter_kor=a.kor, apply=a.apply))
    else:
        print(add_region(a.region, a.pw, a.sheet, apply=a.apply))
    return 0


if __name__ == "__main__":
    sys.exit(main())
