# -*- coding: utf-8 -*-
r"""**게시를 감지해** 마무리까지 자동으로 — 담당자 통보 · 게시판 결과 글 · 상태 정리.

    python publish_watch.py            # dry-run — 무엇을 감지했고 무엇을 보낼지
    python publish_watch.py --apply    # 실제 발송·게시

왜 감지인가
    게시(publish)는 사람이 눈으로 보고 누르는 마지막 관문이라 자동화하지 않는다.
    하지만 **누른 뒤에 남는 일**(담당자 통보·게시판 글·상태 정리)까지 손으로 할 이유는
    없다. 예전엔 `finalize.py --record <행> --apply` 를 내가 기억해서 돌려야 했다.

게시 판정 — 공개 사이트 HTTP 상태
    게시 전  `powerteam-bnikorea.com/<url>` → **404**
    게시 후  → **200** (비밀번호 걸린 페이지도 200 으로 비번 입력 화면을 준다)
    2026-08-23 실측: `/Gangseo` `/Hanam` `/Anyang` 200 · `/273` `/Zznotexist` 404.

⚠ **한 건당 한 번만** 마무리한다. 표시는 `신청 접수` 의 `처리상태 = 게시완료`.
   3분마다 도는 워커라 이 표시가 없으면 담당자에게 같은 문자가 계속 간다.
⚠ 기본은 **테스트 모드**라 문자가 전부 내 번호로 온다. 실발송은 `MYPT_SMS_LIVE=1`.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent))

import requests                                             # noqa: E402

import contacts                                             # noqa: E402
import intake                                               # noqa: E402
import paths                                                # noqa: E402
import proclog                                              # noqa: E402
from finalize import (PUBLIC_SITE, compose, korean_dt,      # noqa: E402
                      post_board)
from notify import (send_email, send_sms_admin,             # noqa: E402
                    send_sms_public, sms_test_mode)

SNAP = paths.snap_dir()


#: ⚠ 공개 사이트는 `python-requests` 기본 UA 를 **403 으로 막는다**(2026-08-23 실측).
#:   브라우저 UA 를 주지 않으면 게시된 페이지도 전부 "판정 불가" 가 되어, 마무리가
#:   영영 안 돈다. curl 로는 되는데 스크립트로는 안 되는 종류의 함정이다.
BROWSER_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                            "AppleWebKit/537.36 (KHTML, like Gecko) "
                            "Chrome/126.0 Safari/537.36"}


def is_published(url: str) -> bool | None:
    """공개 URL 이 살아 있으면 True. 판정 불가(네트워크 오류·차단)면 None."""
    if not url:
        return None
    try:
        r = requests.get(f"{PUBLIC_SITE}/{url.lstrip('/')}", timeout=20,
                         allow_redirects=True, headers=BROWSER_UA)
    except Exception as e:                                   # noqa: BLE001
        print(f"   ⚠ 게시 확인 실패({url}): {e}", file=sys.stderr)
        return None
    if r.status_code == 200:
        return True
    if r.status_code == 404:
        return False
    print(f"   ⚠ 예상 밖 응답 {r.status_code} ({url}) — 게시로 보지 않는다", file=sys.stderr)
    return None


def latest_report(kind: str, key_eng: str) -> dict:
    """pipeline 이 남긴 리포트(멤버 수·시트·페이지 url)."""
    pat = f"region_{key_eng}_*.json" if kind == intake.KIND_REGION \
        else f"launch_{key_eng}_*.json"
    files = sorted(SNAP.glob(pat), key=lambda p: p.stat().st_mtime, reverse=True)
    if not files:
        return {}
    try:
        return json.loads(files[0].read_text(encoding="utf-8"))
    except Exception:                                        # noqa: BLE001
        return {}


def region_board_text(app: dict, when: datetime) -> str:
    """지역용 게시판 글. 챕터 문구(`compose`)와 결이 같아야 한다."""
    name = app["region_kor"] or app["region_eng"]
    head = f"{korean_dt(when)}, {name} 지역이 RPS Board 에 개설되었습니다!"
    links = []
    if app["sheet"]:
        links.append(f"· 지역 리퍼럴 파트너 시트: {app['sheet']}")
    if app["page"]:
        links.append(f"· 지역 페이지: {PUBLIC_SITE}/{app['page'].lstrip('/')}")
    return head + ("\n" + "\n".join(links) if links else "")


def owner_sms(app: dict, kind: str) -> str:
    if kind == intake.KIND_REGION:
        name = app["region_kor"] or app["region_eng"]
        body = [f"{name} 지역 RPS 페이지가 열렸습니다."]
    else:
        body = [f"{app['region_kor']} {app['chapter_kor']} 챕터 RPS 계정이 개설되었습니다."]
    body.append("")
    if app["sheet"]:
        body.append(f"· 시트 {app['sheet']}")
    if app["page"]:
        body.append(f"· 페이지 {PUBLIC_SITE}/{app['page'].lstrip('/')}")
    return "\n".join(body).strip()


def main() -> int:
    ap = argparse.ArgumentParser(description="게시 감지 → 마무리 자동 실행")
    ap.add_argument("--apply", action="store_true", help="실제 발송·게시")
    a = ap.parse_args()

    svc = proclog._svc()
    apps = intake.applications(svc)
    # 생성이 끝났고 아직 마무리가 안 된 건만 본다.
    todo = [x for x in apps if x["status"] == intake.ST_CREATED]
    mode = "  [테스트 모드 — 문자는 전부 내 번호로]" if sms_test_mode() else "  [실발송]"
    print(f"`{intake.TAB}` {len(apps)}건 · 게시 대기(생성완료) {len(todo)}건{mode}")
    if not todo:
        print("확인할 건 없음")
        return 0

    phones = contacts.phone_index(svc)
    done = 0
    for x in todo:
        label = (x["region_kor"] or x["region_eng"]) if x["kind"] == intake.KIND_REGION \
            else f"{x['region_kor']} {x['chapter_kor']}"
        state = is_published(x["page"])
        mark = {True: "게시됨", False: "아직 404 (게시 전)", None: "판정 불가"}[state]
        print(f"  · {x['row']}행 [{x['kind']}] {label} · /{x['page'] or '-'} → {mark}")
        if state is not True:
            continue
        if not a.apply:
            print("      → 담당자 문자 + 게시판 글을 올릴 예정")
            continue

        when = datetime.now()
        rep = latest_report(x["kind"], x["region_eng"] if x["kind"] == intake.KIND_REGION
                            else x["chapter_eng"])
        plan = (rep or {}).get("plan", {})
        content = (region_board_text(x, when) if x["kind"] == intake.KIND_REGION
                   else compose(x, plan, when))
        phone = x["owner_phone"] or phones.get(x["email"].lower(), "")
        ok_owner = send_sms_public(owner_sms(x, x["kind"]), phone) if phone else False
        ok_board = post_board(content)

        intake.update(x["row"], svc=svc,
                      status=intake.ST_PUBLISHED if ok_board else intake.ST_CREATED,
                      log=f"게시 감지 · 담당자 통보 {'OK' if ok_owner else '실패/건너뜀'}"
                          f" · 게시판 글 {'OK' if ok_board else '실패'}")
        proclog.update(x["key"], svc=svc,
                       status=proclog.ST_DONE if ok_board else proclog.ST_RUNNING,
                       done_ts=proclog.stamp(),
                       sms_out=(proclog.sms_note(ok_owner, phone, "개설안내")
                                if phone else "미발송 — `담당자 연락처` 미등록"),
                       trace=f"게시 확인 → 마무리 (게시판 {'게시' if ok_board else '실패'})")
        send_email(f"[런칭] {label} — 게시 확인·마무리",
                   f"공개 페이지 {PUBLIC_SITE}/{x['page']}\n\n"
                   f"[게시판 글]\n{content}\n\n"
                   f"담당자 문자 {'발송' if ok_owner else '실패/번호 없음'} ({phone or '-'})\n"
                   f"게시판 게시 {'완료' if ok_board else '실패'}"
                   + ("\n\n⚠ 테스트 모드 — 문자는 관리자 번호로 갔습니다."
                      if sms_test_mode() else ""))
        # ⚠ 게시판 글이 실패하면 `생성완료` 로 남겨 다음 주기에 다시 시도한다.
        #   담당자 문자는 이미 나갔으므로 두 번 갈 수 있다 — 그래도 "결과가 안 올라오는 것"
        #   보다는 낫다(문자는 안내, 게시판 글은 기록이다).
        if not ok_board:
            send_sms_admin(f"[게시판 게시 실패] {label}\n다음 주기에 다시 시도합니다.")
        done += 1

    if not a.apply:
        print("\n[dry-run] 보내지도 올리지도 않았다. --apply 를 붙일 것.")
    else:
        print(f"\n마무리 {done}건")
    return 0


if __name__ == "__main__":
    sys.exit(main())
