# -*- coding: utf-8 -*-
r"""**게시까지 자동으로** — 생성·검증이 끝난 건이 있으면 imweb 사이트를 게시한다.

    python auto_publish.py            # dry-run — 무엇을 왜 게시할지만 찍는다
    python auto_publish.py --apply    # 실제 게시

왜 이 파일이 생겼나
    2026-08-26 까지 사람 손이 남은 곳은 딱 하나, 편집기의 **게시** 버튼이었다.
    그 한 번 때문에 신청부터 공개까지가 이어지지 않고 중간에 멈춰 있었다
    (골든 건은 만들어 놓고 하루 넘게 404 였다).

무엇을 보고 누르나
    `신청 접수` 의 **`생성완료`** 행 중 공개 URL 이 아직 404 인 것.
    `생성완료` 는 `pipeline` 의 [6] 검증 6항목을 **전부 통과**해야 붙는 표시다
    (하나라도 어긋나면 `보류` 로 가고 여기까지 오지 않는다).

⛔ **imweb 의 게시는 페이지 단위가 아니라 사이트 전체이고 되돌릴 수 없다.**
   누르는 순간 저장돼 있는 **다른 사람의 미완성 편집까지 같이 공개된다.**
   그래서 (1) 게시할 이유가 있는 건이 실제로 있을 때만, (2) 한 건당 최대 2번만,
   (3) 누른 사실과 시각을 시트·문자로 남긴다.

게시 뒤는 `publish_watch.py` 가 이어받는다 — 404→200 이 되면 지역 카드 부착 ·
담당자 문자 · 게시판 결과 글 · `게시완료` 까지 자동이다.
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent))

import intake                                               # noqa: E402
import proclog                                              # noqa: E402
from notify import send_sms_admin                           # noqa: E402
from publish_watch import is_published                      # noqa: E402

#: 시트 `처리로그` 에 남기는 표시. 이 표시의 개수가 곧 시도 횟수다.
MARK = "자동게시 요청"
MAX_TRIES = 2

#: 게시 작업이 끝나기를 기다리는 시간. 넘기면 기다리기를 그만두고 다음 주기에
#: `publish_watch` 가 200 을 확인한다 — 게시 자체는 서버에서 계속 돈다.
WAIT_SECONDS = 150
POLL_EVERY = 10


def tries(app: dict) -> int:
    return (app.get("log") or "").count(MARK)


def wait_done(im, quiet: bool = False) -> str:
    """게시 작업이 끝날 때까지 기다린다. 돌려주는 값은 마지막으로 본 상태."""
    deadline = time.time() + WAIT_SECONDS
    state = "?"
    while time.time() < deadline:
        time.sleep(POLL_EVERY)
        try:
            st = im.publish_state()
        except Exception as e:                               # noqa: BLE001
            return f"확인 실패({type(e).__name__})"
        state = str((st.get("publish") or {}).get("status") or "?")
        if not quiet:
            print(f"      · 게시 상태 {state}")
        if state in ("IDLE", "DONE", "SUCCESS", "COMPLETED"):
            return state
        if state in ("FAIL", "FAILED", "ERROR"):
            return f"{state} · {(st.get('publish') or {}).get('failReason')}"
    return f"{state} (대기 시간 초과 — 서버에서는 계속 진행 중)"


def main() -> int:
    ap = argparse.ArgumentParser(description="검증 통과 건이 있으면 사이트를 게시한다")
    ap.add_argument("--apply", action="store_true", help="실제 게시")
    a = ap.parse_args()

    svc = proclog._svc()
    apps = intake.applications(svc)
    created = [x for x in apps if x["status"] == intake.ST_CREATED]

    todo, skipped = [], []
    for x in created:
        if is_published(x["page"]) is not False:      # 이미 200 이거나 판정 불가
            continue
        (skipped if tries(x) >= MAX_TRIES else todo).append(x)

    print(f"`{intake.TAB}` 생성완료 {len(created)}건 · 게시 대상 {len(todo)}건"
          f"{f' · 재시도 한도 초과 {len(skipped)}건' if skipped else ''}")
    for x in skipped:
        print(f"  ⛔ {x['row']}행 {x['region_kor']} {x['chapter_kor']} — "
              f"{MAX_TRIES}번 게시했는데도 /{x['page']} 가 404 다. 사람이 볼 것")
    if not todo:
        if not created:
            print("게시할 이유가 없다 — 검증을 통과한 대기 건이 없다")
        return 0

    for x in todo:
        label = f"{x['region_kor']} {x['chapter_kor']}".strip() or x["key"]
        print(f"  ▶ {x['row']}행 {label} · /{x['page']} 가 아직 404 → 게시 필요")

    if not a.apply:
        print("\n[dry-run] 게시하지 않았다. --apply 를 붙일 것.")
        return 0

    from imweb_client import ImwebClient, ensure_login
    with ImwebClient() as im:
        if not ensure_login(im):
            print("  ⏸ imweb 로그인 대기 — 다음 주기에 다시 시도한다")
            return 0
        try:
            st = im.publish_state()
        except Exception as e:                               # noqa: BLE001
            print(f"  ⚠ 게시 상태를 못 읽었다 ({type(e).__name__}) — 이번 주기는 건너뛴다")
            return 0

        now = str((st.get("publish") or {}).get("status") or "")
        if not st.get("canPublish") or now not in ("", "IDLE"):
            print(f"  ⏸ 지금은 게시할 수 없다 (canPublish={st.get('canPublish')} "
                  f"status={now}) — 다음 주기에 다시 본다")
            return 0

        names = ", ".join(f"{x['region_kor']} {x['chapter_kor']}".strip() for x in todo)
        print(f"  ▶ 사이트 게시 요청 — 대상 {names}")
        # ⚠ 누른 흔적을 **먼저** 남긴다. 게시 요청은 갔는데 기록이 안 남으면
        #   3분 뒤에 또 누른다.
        for x in todo:
            intake.update(x["row"], svc=svc,
                          log=f"{MARK} ({tries(x) + 1}/{MAX_TRIES}) — 검증 통과 건 자동 게시")
        try:
            im.publish()
        except Exception as e:                               # noqa: BLE001
            print(f"  ⛔ 게시 요청 실패: {type(e).__name__} {e}")
            send_sms_admin(f"[자동게시 실패] {names}\n{type(e).__name__} — 편집기에서 직접 게시해 주세요.")
            return 1
        state = wait_done(im)

    print(f"  ✓ 게시 요청 완료 · 마지막 상태 {state}")
    for x in todo:
        intake.update(x["row"], svc=svc, log=f"게시 요청 결과 {state}")
        proclog.update(x["key"], svc=svc, trace=f"자동 게시 요청 · {state}")
    send_sms_admin(
        f"[자동게시] {names}\n"
        f"{datetime.now():%m-%d %H:%M} 사이트를 게시했습니다.\n"
        "※ imweb 게시는 사이트 전체라, 저장돼 있던 다른 편집도 함께 공개됩니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
