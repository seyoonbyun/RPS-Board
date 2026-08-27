# -*- coding: utf-8 -*-
r"""접수 확인 문자 — 신청이 들어오면 담당자에게 **바로** 한 통.

    python intake_ack.py            # dry-run — 누구에게 무엇을 보낼지만
    python intake_ack.py --apply    # 실제 발송

왜 필요한가
    예전엔 문자가 **완료·오류일 때만** 나갔다. 담당자는 신청 버튼을 누른 뒤 화면 토스트
    하나만 보고, 그다음엔 완료될 때까지 아무 소식이 없다. 그 침묵 동안 "접수가 된 건가"
    싶어 **같은 신청을 또 낸다**. 접수 확인은 그걸 막는 한 통이다.

    ⚠ 웹앱이 직접 못 보낸다 — 솔라피 키는 로컬에만 있다. 그래서 3분 워커의 첫 단계다.

멱등성
    보냈다는 사실을 `신청 접수` 의 `처리로그` 에 `접수안내` 로 남긴다. 그 표시가 있으면
    다시 보내지 않는다. **3분마다 도는 워커라 이 표시가 없으면 하루 480통이 나간다.**

⚠ 기본은 **테스트 모드**라 문자가 전부 내 번호로 온다. 실발송은 `MYPT_SMS_LIVE=1`.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent))

import contacts                                             # noqa: E402
import intake                                               # noqa: E402
import proclog                                              # noqa: E402
from notify import (send_sms_admin, send_sms_public,      # noqa: E402
                    sms_test_mode)

ACK_MARK = "접수안내"


def target_label(app: dict) -> str:
    if app["kind"] == intake.KIND_REGION:
        return app["region_kor"] or app["region_eng"]
    return f"{app['region_kor']} {app['chapter_kor']}".strip()


def ack_text(app: dict) -> str:
    what = "신규 지역 등록" if app["kind"] == intake.KIND_REGION else "신규 챕터 런칭"
    lines = [f"{what} 신청이 접수되었습니다.", "", f"· 대상 {target_label(app)}"]
    if app["launch"]:
        lines.append(f"· 런칭 {app['launch']}")
    lines += ["",
              "RPS 시트 · QR · 페이지 생성이 순차적으로 진행됩니다.",
              "준비가 끝나면 다시 안내드리겠습니다."]
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description="신청 접수 확인 문자")
    ap.add_argument("--apply", action="store_true", help="실제 발송")
    a = ap.parse_args()

    svc = proclog._svc()
    apps = intake.applications(svc)
    # 상태와 무관하게 **아직 안내를 안 보낸 건**이 대상이다. 워커가 먼저 처리를 끝내
    # 버려도 접수 안내는 나가야 한다(담당자 입장에선 순서가 아니라 유무가 중요하다).
    todo = [x for x in apps if ACK_MARK not in (x["log"] or "")]
    mode = "  [테스트 모드 — 문자는 전부 내 번호로]" if sms_test_mode() else "  [실발송]"
    print(f"`{intake.TAB}` {len(apps)}건 · 접수안내 대상 {len(todo)}건{mode}")
    if not todo:
        return 0

    phones = contacts.phone_index(svc)
    sent = 0
    for x in todo:
        phone = x["owner_phone"] or phones.get(x["email"].lower(), "")
        print(f"  ▶ {x['row']}행 [{x['kind']}] {target_label(x)} → "
              f"{phone or '⚠ 연락처 없음 — 보낼 곳이 없다'}")
        if not a.apply:
            continue
        if not phone:
            # 연락처가 없으면 **다시 시도하지 않는다.** 3분마다 같은 행을 붙들고 있으면
            # 진짜 대상이 뒤로 밀린다. 대신 왜 못 보냈는지 로그에 남긴다.
            intake.update(x["row"], svc=svc,
                          log=f"{ACK_MARK} 미발송 — `담당자 연락처` 미등록")
            # ⚠ 여기서 끝내면 **아무도 모른다.** 담당자는 접수 안내를 못 받고, 나는
            #   시트를 열어보기 전까지 그 사실을 모른다. 21명 중 17명이 연락처가 없어
            #   가장 흔한 실패 경로다 → 나에게 한 번 알린다(로그 표시가 있으니 재발송 없음).
            send_sms_admin(f"[접수안내 미발송] {target_label(x)}\n"
                           f"{x['owner'] or x['email'] or '담당자'} 연락처가 "
                           "`담당자 연락처` 탭에 없습니다. 번호를 넣으면 다음 안내부터 나갑니다.")
            continue
        ok = send_sms_public(ack_text(x), phone)
        intake.update(x["row"], svc=svc,
                      log=f"{ACK_MARK} {'발송' if ok else '실패'} → {phone}")
        # 대장에도 이 시점에 행을 연다 — 챕터는 여기가 첫 진입점이다(지역은 웹앱이 이미 열었다).
        proclog.open_row(
            proclog.FLOW_REGION if x["kind"] == intake.KIND_REGION else proclog.FLOW_CHAPTER,
            x["key"], owner=x["owner"], email=x["email"], phone=phone,
            body=target_label(x) + (f" · 런칭 {x['launch']}" if x["launch"] else ""),
            status=proclog.ST_RECEIVED, svc=svc)
        proclog.update(x["key"], svc=svc,
                       sms_in=proclog.sms_note(ok, phone, "접수안내"),
                       trace="접수안내 발송" if ok else "접수안내 실패")
        sent += 1
    if a.apply:
        print(f"접수안내 {sent}건 발송")
    else:
        print("\n[dry-run] 보내지 않았다. --apply 를 붙일 것.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
