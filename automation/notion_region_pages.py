# -*- coding: utf-8 -*-
r"""팀 노션 `MyPowerTeam RPI Viewer` 의 **지역별 하위 페이지**를 메인 DB 에 맞춘다.

    python notion_region_pages.py            # dry-run (무엇이 빠지고 남았는지)
    python notion_region_pages.py --apply

⛔ 지역 하위 페이지 18개(`Busan 부산 - RPI Viewer` …)의 `Chapter Viewer PW` 는 2026-04-19 에
   만든 **독립 사본 DB** 라 메인이 바뀌어도 안 따라온다. 사람이 보는(외부 게시 중인) 건
   이쪽인데 `notion_pw.py` 는 메인에만 썼다 → 4월 이후 신규 챕터 6개가 화면에 없었다(2026-10-07).

하는 일
    - 메인 `Chapter Viewer PW` 의 `상태=활동중` 행이 해당 지역 페이지에 없으면 **추가**(메인 값 그대로)
    - 지역 페이지에 있는데 메인에서 활동중이 아니면 **휴지통**(복구 가능)
    - 이미 있는 행의 값(PW 등)은 **건드리지 않는다**
    - 지역 페이지 자체가 없으면 용인 페이지와 같은 구성으로 **만들고** 공유 링크 표에 한 줄 붙인다

지역 매칭은 한글 지역명에서 숫자를 뗀 것으로 한다 — 페이지는 `Busan 부산`·`YDP 영등포`,
메인은 `Busan1 부산1`·`Youngdeungpo 영등포` 처럼 영문·숫자 표기가 서로 다르다.
`Daegu 대구` 페이지는 대구1·대구2 를 함께 담는다.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import requests

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent))

import notion_pw as n                                       # noqa: E402

ROOT = "34739e9f-1cf7-80c0-92a4-eabf56cff118"               # 팀 MyPowerTeam RPI Viewer
ACTIVE = "활동중"
WRITABLE = {"title", "rich_text", "url", "select", "date", "number", "multi_select"}


def _region_key(label: str) -> str:
    kor = [w for w in label.split() if re.search(r"[가-힣]", w)]
    return re.sub(r"\d", "", kor[0]) if kor else ""


def _children(bid: str, h: dict) -> list[dict]:
    out, cur = [], None
    while True:
        params = {"page_size": 100}
        if cur:
            params["start_cursor"] = cur
        r = requests.get(f"{n.API}/blocks/{bid}/children", headers=h, params=params, timeout=40)
        if not r.ok:
            raise n.NotionError(f"하위 블록 조회 실패 {r.status_code} {r.text[:200]}")
        d = r.json()
        out += d["results"]
        if not d.get("has_more"):
            return out
        cur = d["next_cursor"]


def _writable(props: dict) -> dict:
    """조회 결과의 속성을 쓰기 형식으로 바꾼다(읽기 전용 유형은 뺀다)."""
    out = {}
    for name, p in props.items():
        t = p["type"]
        if t not in WRITABLE:
            continue
        v = p[t]
        if t in ("title", "rich_text"):
            v = [{"text": {"content": x["plain_text"]}} for x in v]
        elif t == "select":
            v = {"name": v["name"]} if v else None
        elif t == "multi_select":
            v = [{"name": x["name"]} for x in v]
        if v in (None, [], ""):
            continue
        out[name] = {t: v}
    return out


LINK_TABLE_PAGE = "73b14824-ccdb-4514-96f5-633928be60f2"   # RPI Viewer 공유 링크 목록
REG_SCHEMA = {"지역": {"title": {}}, "PW": {"rich_text": {}}, "No.": {"rich_text": {}},
              "Direct Link": {"url": {}}}
CHA_SCHEMA = {"지역": {"title": {}}, "챕터": {"rich_text": {}}, "PW": {"rich_text": {}},
              "No.": {"rich_text": {}}, "Launching effective date": {"date": {}},
              "Direct Link": {"url": {}}, "상태": {"select": {"options": [{"name": ACTIVE}]}}}


def _post(path: str, body: dict, h: dict) -> dict:
    r = requests.post(f"{n.API}/{path}", headers=h, timeout=40,
                      data=json.dumps(body, ensure_ascii=False).encode("utf-8"))
    if not r.ok:
        raise n.NotionError(f"{path} 실패 {r.status_code} {r.text[:200]}")
    return r.json()


def _tt(s: str) -> list:
    return [{"text": {"content": s}}]


def _create_region_page(label: str, chapters: list[dict], token: str, h: dict,
                        reg_rows: list[dict]) -> str:
    """용인 페이지와 같은 구성(인라인 DB 2개)으로 지역 페이지를 만들고 공유 링크 표에 한 줄 붙인다.
    ⚠ 새 페이지는 목록 맨 끝에 붙고, 표의 열 순서는 기존 페이지와 다르다(공개 API 로는 못 정한다)."""
    page = _post("pages", {"parent": {"page_id": ROOT},
                           "properties": {"title": {"title": _tt(f"{label} - RPI Viewer")}}}, h)
    rdb = _post("databases", {"parent": {"page_id": page["id"]}, "is_inline": True,
                              "title": _tt("Admin & By region"), "properties": REG_SCHEMA}, h)
    for p in reg_rows:
        if _region_key(n._plain(p["properties"]["지역"])) == _region_key(label):
            props = _writable(p["properties"])
            props["No."] = {"rich_text": _tt("1")}
            n._create(rdb["id"], token, props)
            break
    cdb = _post("databases", {"parent": {"page_id": page["id"]}, "is_inline": True,
                              "title": _tt("Chapter Viewer PW"), "properties": CHA_SCHEMA}, h)
    for i, p in enumerate(chapters, 1):
        props = _writable(p["properties"])
        props["No."] = {"rich_text": _tt(str(i))}
        n._create(cdb["id"], token, props)
    tbl = [b for b in _children(LINK_TABLE_PAGE, h) if b["type"] == "table"]
    if tbl:
        row = {"type": "table_row", "table_row": {"cells": [
            _tt(label), [{"type": "mention", "mention": {"page": {"id": page["id"]}}}]]}}
        requests.patch(f"{n.API}/blocks/{tbl[0]['id']}/children", headers=h,
                       json={"children": [row]}, timeout=40).raise_for_status()
    return page["url"]


def sync(apply: bool = False, log=print) -> dict:
    """메인 DB 기준으로 지역 페이지를 맞춘다. 결과 요약을 돌려준다."""
    token, reg_db, cha_db = n._conf()
    h = n._headers(token)

    main_rows = n.rows(cha_db, token)
    active = [p for p in main_rows if n._plain(p["properties"].get("상태", {})) == ACTIVE]
    log(f"메인 활동중 {len(active)}개 (전체 {len(main_rows)}행)")

    pages = {}
    for b in _children(ROOT, h):
        if b["type"] != "child_page":
            continue
        title = b["child_page"]["title"]
        dbs = [x for x in _children(b["id"], h) if x["type"] == "child_database"
               and x["child_database"]["title"].startswith("Chapter Viewer")]
        if dbs:
            pages[_region_key(title)] = (title, dbs[0]["id"])

    adds, drops, no_page = [], [], {}
    for key, (title, db) in pages.items():
        have = n.rows(db, token)
        have_names = {n._plain(p["properties"].get("챕터", {})).strip().casefold() for p in have}
        want = [p for p in active if _region_key(n._plain(p["properties"]["지역"])) == key]
        want_names = {n._plain(p["properties"]["챕터"]).strip().casefold() for p in want}
        for p in want:
            if n._plain(p["properties"]["챕터"]).strip().casefold() not in have_names:
                adds.append((title, db, p))
        for p in have:
            if n._plain(p["properties"].get("챕터", {})).strip().casefold() not in want_names:
                drops.append((title, p))
    for p in active:
        label = n._plain(p["properties"]["지역"]).strip()
        if _region_key(label) not in pages:
            no_page.setdefault(re.sub(r"\d", "", label), []).append(p)

    chap = lambda p: n._plain(p["properties"].get("챕터", {})).replace("_rps", "")  # noqa: E731
    log(f"추가 {len(adds)}건")
    for title, _, p in adds:
        log(f"  + {chap(p):12} → {title}  (PW {n._plain(p['properties']['PW'])})")
    log(f"휴지통 {len(drops)}건")
    for title, p in drops:
        log(f"  - {chap(p):12} ← {title}")
    log(f"지역 페이지 새로 만들 것 {len(no_page)}건")
    for label, ps in no_page.items():
        log(f"  * {label} - RPI Viewer  ({', '.join(chap(p) for p in ps)})")

    if not apply:
        log("[dry-run] --apply 로 실행")
    else:
        for title, db, p in adds:
            n._create(db, token, _writable(p["properties"]))
        for title, p in drops:
            r = requests.patch(f"{n.API}/pages/{p['id']}", headers=h,
                               json={"archived": True}, timeout=40)
            if not r.ok:
                raise n.NotionError(f"휴지통 실패 {r.status_code} {r.text[:200]}")
        reg_rows = n.rows(reg_db, token) if no_page else []
        for label, ps in no_page.items():
            log(f"  ✓ 지역 페이지 생성 {_create_region_page(label, ps, token, h, reg_rows)}")
        log(f"✓ 추가 {len(adds)} · 휴지통 {len(drops)} · 지역 페이지 {len(no_page)}")
    return {"add": len(adds), "drop": len(drops), "new_pages": len(no_page)}


# ---------------------------------------------------------------- 정렬·번호

def _is_nation(name: str) -> bool:
    return bool(re.search(r"BNI K|Korea All|전국", name, re.I))


def _numbers(rows: list[dict], name_prop: str) -> list[str]:
    """전국 행은 `00`, 나머지는 `01` `02` …(사용자 지시 2026-10-07)."""
    out, i = [], 0
    for p in rows:
        if _is_nation(n._plain(p["properties"].get(name_prop, {}))):
            out.append("00")
        else:
            i += 1
            out.append(f"{i:02d}")
    return out


def _ordered(rows: list[dict], name_prop: str) -> list[dict]:
    """전국 행 → 활동중(알파벳) → 그 밖(정지 등, 알파벳). 대소문자 무시."""
    def key(p):
        name = n._plain(p["properties"].get(name_prop, {})).strip()
        st = n._plain(p["properties"].get("상태", {})) if "상태" in p["properties"] else ACTIVE
        nation = _is_nation(name)
        return (0 if nation else 1 if st == ACTIVE else 2, name.casefold())
    return sorted(rows, key=key)


def renumber(db: str, label: str, token: str, apply: bool, log=print, force: bool = False) -> bool:
    """표를 알파벳 순으로 다시 세우고 No. 를 1부터 매긴다.
    ⚠ 보기에 정렬이 없어 화면 순서 = 행 생성 순서다. 공개 API 로는 행을 옮길 수 없어
       **순서가 틀리면 행을 새로 만들고 옛 행은 휴지통**으로 보낸다(값은 그대로 복사)."""
    rows = n.rows(db, token)
    if not rows:
        return False
    sch = {k: v["type"] for k, v in rows[0]["properties"].items()}
    name_prop = "챕터" if "챕터" in sch else next(k for k, t in sch.items() if t == "title")
    want = _ordered(rows, name_prop)
    # ⛔ created_time 은 분 단위라 한 번에 만든 행은 시각이 같다 → 생성 순서로 화면 순서를
    #   판정할 수 없다(검증이 매번 「재배치」로 나왔다). 재배치할 때 No. 도 같이 매기므로
    #   **No. 가 기대값과 같으면 순서도 맞은 것**으로 본다.
    nums = _numbers(want, name_prop)
    cur = [n._plain(p["properties"].get("No.", {})).strip() for p in want]
    if not force and cur == nums:
        return False
    names = [n._plain(p["properties"].get(name_prop, {})).replace("_rps", "") for p in want]
    # 지금 No. 순서가 이미 알파벳 순이면(번호 체계만 다르면) 행은 그대로 두고 No. 만 고친다.
    as_int = [int(x) if x.isdigit() else 10 ** 6 for x in cur]
    renum_only = not force and as_int == sorted(as_int) and len(set(as_int)) == len(as_int)
    log(f"  {label}: {len(want)}행 {'번호만' if renum_only else '재배치'} → "
        f"{', '.join(names[:6])}{' …' if len(names) > 6 else ''}")
    if not apply:
        return True
    h = n._headers(token)
    if renum_only:
        for p, no in zip(want, nums):
            if n._plain(p["properties"].get("No.", {})).strip() != no:
                requests.patch(f"{n.API}/pages/{p['id']}", headers=h, timeout=40,
                               json={"properties": {"No.": {"rich_text": _tt(no)}}}).raise_for_status()
        return True
    # ⛔ API 로 만든 행은 표 **맨 위**에 붙는다 → 정순으로 만들면 화면이 12→1 로 뒤집힌다
    #   (2026-10-07 화면 확인). 마지막 것부터 만든다. 새로 만든 뒤에 옛 행을 지운다.
    for p, no in reversed(list(zip(want, nums))):
        props = _writable(p["properties"])
        props["No."] = {"rich_text": _tt(no)}
        n._create(db, token, props)
    for p in want:
        requests.patch(f"{n.API}/pages/{p['id']}", headers=h, json={"archived": True},
                       timeout=40).raise_for_status()
    return True


def renumber_all(apply: bool = False, log=print, backup_dir: Path | None = None) -> int:
    """메인 2개 + 지역 페이지의 모든 DB."""
    token, reg_db, cha_db = n._conf()
    h = n._headers(token)
    targets = [(reg_db, "메인 Admin & By region"), (cha_db, "메인 Chapter Viewer PW")]
    for b in _children(ROOT, h):
        if b["type"] != "child_page":
            continue
        for x in _children(b["id"], h):
            if x["type"] == "child_database":
                targets.append((x["id"], f"{b['child_page']['title'].replace(' - RPI Viewer', '')}"
                                         f" / {x['child_database']['title']}"))
    if apply and backup_dir:
        import datetime
        backup_dir.mkdir(parents=True, exist_ok=True)
        snap = {db: n.rows(db, token) for db, _ in targets}
        f = backup_dir / f"notion_rpi_viewer_{datetime.datetime.now():%Y%m%d_%H%M%S}.json"
        f.write_text(json.dumps(snap, ensure_ascii=False, indent=1), encoding="utf-8")
        log(f"백업 {f}")
    changed = sum(renumber(db, label, token, apply, log) for db, label in targets)
    log(f"{'✓ ' if apply else '[dry-run] '}바꿀 표 {changed}개 / 전체 {len(targets)}개")
    return changed


def main() -> int:
    ap = argparse.ArgumentParser(description="팀 노션 지역 하위 페이지를 메인 DB 에 맞춘다")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--renumber", action="store_true", help="알파벳 순 재배치 + No. 1부터")
    a = ap.parse_args()
    if a.renumber:
        import paths
        renumber_all(a.apply, backup_dir=paths.snap_dir())
    else:
        sync(a.apply)
    return 0


if __name__ == "__main__":
    sys.exit(main())
