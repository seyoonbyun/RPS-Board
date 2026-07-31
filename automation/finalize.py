# -*- coding: utf-8 -*-
r"""게시 후 마무리 — 담당자 연락 → 게시판 결과 게시 → 상태 정리.

    python finalize.py                          # 마무리 대기 건 표시
    python finalize.py --record recXXXX         # dry-run (보낼 문구를 그대로 보여준다)
    python finalize.py --record recXXXX --apply # 실제 발송·게시

**왜 파이프라인이 자동으로 하지 않는가** — pipeline 은 게시 직전까지만 한다(사용자 결정).
게시 전에는 공개 사이트가 404 라, 그 상태로 "개설되었습니다 + 링크" 를 올리면
담당자가 죽은 링크를 받는다. 그래서 **사람이 게시한 뒤** 이걸 돌린다.

하는 일
  1. 담당자에게 알림 (문자 → 카카오 채널 연동·템플릿 승인 후 알림톡으로 교체)
  2. **RPS Board 게시판에 결과 글 게시**
  3. Airtable `처리 상태` → 게시완료
  4. 나에게 완료 보고 (이메일·문자)

⚠ 게시판 글은 **내가 직접 쓴 것처럼** 보여야 한다(사용자 결정).
   봇 이름·`System` 배지를 넣지 않는다. 게시판 위젯은 작성자명을 `이메일 앞부분`,
   배지를 `권한` 으로 표시하므로, 본인 계정으로 올리면 손으로 쓴 글과 구분되지 않는다.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

import requests                                   # noqa: E402

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import airtable_client as at                      # noqa: E402
import paths                                      # noqa: E402
from notify import send_email, send_sms           # noqa: E402

SNAP = paths.snap_dir()

BOARD_API = "https://www.rps-bnikorea.com/api/admin/board"
POSTER_EMAIL = "joy.byun@bnikorea.com"            # 게시판에 이 사람 명의로 올라간다
POSTER_ROLE = "National"
PUBLIC_SITE = "https://www.powerteam-bnikorea.com"


def korean_dt(dt: datetime) -> str:
    """`2026년 7월 29일 오후 3시 30분` — %p 는 로케일을 타서 직접 만든다."""
    ampm = "오전" if dt.hour < 12 else "오후"
    h12 = dt.hour % 12 or 12
    return (f"{dt.year}년 {dt.month}월 {dt.day}일 {ampm} {h12}시 "
            f"{dt.minute}분" if dt.minute else
            f"{dt.year}년 {dt.month}월 {dt.day}일 {ampm} {h12}시 정각")


def find_report(chapter_eng: str) -> dict | None:
    """pipeline 이 남긴 최신 리포트(멤버 수·페이지 url 이 여기 있다)."""
    if not chapter_eng:
        return None
    files = sorted(SNAP.glob(f"launch_{chapter_eng}_*.json"),
                   key=lambda p: p.stat().st_mtime, reverse=True)
    if not files:
        return None
    return json.loads(files[0].read_text(encoding="utf-8"))


def compose(app: dict, plan: dict, when: datetime) -> str:
    """게시판 본문. 첫 줄은 사용자가 정한 문구 그대로."""
    # 멤버 수를 모르면 그 문구를 통째로 뺀다 — "총 ?명" 이 나가면 안 된다.
    members = plan.get("member_count")
    head = (f"{korean_dt(when)}, {app['region_kor']} 지역의 {app['chapter_kor']} 챕터 "
            f"RPS 계정이 개설되었습니다!" + (f" 총 {members}명" if members else ""))

    links = []
    if app["sheet"] or plan.get("chapter_sheet"):
        links.append(f"· 리퍼럴 파트너 시트: {app['sheet'] or plan.get('chapter_sheet')}")
    url = plan.get("chapter_page_url")
    if url:
        links.append(f"· 챕터 페이지: {PUBLIC_SITE}/{url}")
    return head + ("\n" + "\n".join(links) if links else "")


def post_board(content: str) -> bool:
    """게시판 API. `x-caller-email` 로 호출자를 검증한다(RPS 시트 Z열 기준)."""
    try:
        r = requests.post(
            BOARD_API, timeout=30,
            headers={"Content-Type": "application/json",
                     "x-caller-email": POSTER_EMAIL},
            data=json.dumps({
                "email": POSTER_EMAIL,
                "name": POSTER_EMAIL.split("@")[0],   # 위젯이 쓰는 방식 그대로
                "role": POSTER_ROLE,
                "content": content,
                "adminEmail": POSTER_EMAIL,           # 헤더가 막히는 환경 대비
            }, ensure_ascii=False).encode("utf-8"))
        if r.status_code >= 400:
            print(f"   게시 실패 {r.status_code} {r.text[:300]}", file=sys.stderr)
            return False
        return True
    except Exception as e:                            # noqa: BLE001
        print(f"   게시 실패: {e}", file=sys.stderr)
        return False


def main() -> None:
    ap = argparse.ArgumentParser(description="게시 후 마무리")
    ap.add_argument("--record", help="Airtable 레코드 id (rec…)")
    ap.add_argument("--apply", action="store_true", help="실제 발송·게시")
    a = ap.parse_args()

    apps = at.applications()
    ready = [x for x in apps if x["status"] == at.ST_CREATED]

    if not a.record:
        print(f"마무리 대기(생성완료) {len(ready)}건\n")
        for x in ready:
            print(f"  {x['id']}  {x['region_kor']} {x['chapter_kor']} "
                  f"· 담당 {x['owner'] or '-'} {x['owner_phone'] or '(번호 없음)'}")
        if not ready:
            print("  없음 — pipeline 이 '생성완료' 로 만든 건이 대상이다.")
        else:
            print("\n게시를 마친 뒤  --record <id> [--apply]  로 마무리하세요.")
        return

    app = next((x for x in apps if x["id"] == a.record), None)
    if not app:
        raise SystemExit(f"레코드를 찾지 못했다: {a.record}")

    rep = find_report(app["chapter_eng"])
    plan = (rep or {}).get("plan", {})
    if not rep:
        print(f"  ⚠ 리포트 파일이 없다(챕터 영문명 {app['chapter_eng'] or '미확정'}) "
              f"— 멤버 수·페이지 링크 없이 진행한다.")

    when = datetime.now()
    content = compose(app, plan, when)

    print(f"=== {app['region_kor']} {app['chapter_kor']} ===")
    print("\n[게시판 글]")
    print("\n".join("   " + ln for ln in content.splitlines()))
    owner_msg = (f"[BNI 파워팀] {app['region_kor']} {app['chapter_kor']} 챕터 "
                 f"RPS 계정이 개설되었습니다.\n{app['sheet'] or ''}").strip()
    print(f"\n[담당자 문자 → {app['owner_phone'] or '(번호 없음)'}]")
    print("\n".join("   " + ln for ln in owner_msg.splitlines()))

    if not a.apply:
        print("\n--apply 를 붙여야 실제로 보내고 게시합니다.")
        return

    ok_owner = send_sms(owner_msg, app["owner_phone"]) if app["owner_phone"] else False
    print(f"\n담당자 문자 : {'발송' if ok_owner else '건너뜀/실패'}")

    ok_board = post_board(content)
    print(f"게시판 게시 : {'완료' if ok_board else '실패'}")

    if ok_board:
        at.update(app["id"], {at.F_STATUS: at.ST_PUBLISHED})
        at.append_log(app["id"], f"{when:%Y-%m-%d %H:%M}  게시완료 · 담당자 통보"
                                 f"{'' if ok_owner else '(문자 실패)'} · 게시판 게시",
                      app["log"])
        print("Airtable    : 게시완료")

    send_email(f"[런칭] {app['region_kor']} {app['chapter_kor']} — 마무리",
               f"게시 후 마무리를 마쳤습니다.\n\n"
               f"게시판 글\n{content}\n\n"
               f"담당자 문자 {'발송' if ok_owner else '실패/건너뜀'} "
               f"({app['owner_phone'] or '번호 없음'})\n"
               f"게시판 게시 {'완료' if ok_board else '실패'}")
    send_sms(f"[런칭 마무리] {app['region_kor']} {app['chapter_kor']} · "
             f"게시판 {'게시' if ok_board else '실패'}")


if __name__ == "__main__":
    main()
