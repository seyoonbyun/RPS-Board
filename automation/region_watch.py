# -*- coding: utf-8 -*-
r"""어드민의 **신규 지역 신청**을 감지해 시트·RPI·QR·배너·imweb 페이지까지 만든다.

    python region_watch.py            # 대기 건 확인만
    python region_watch.py --run      # dry-run — 무엇을 만들지만 찍는다
    python region_watch.py --run --apply    # 실제 생성 (게시는 사람이)

두 탭을 쓴다 — **입구와 대장은 다르다.**
    `신청 접수`        사람이 신청한 원본. 여기서 대기 건을 집어온다
    `rps new account`  처리 경과·문자·결과. 여기에 남긴다

접수 채널
    RPS Board `/admin` → 지역 & 챕터 관리 → 새 지역 등록.
    (Vercel 서버리스는 imweb 을 못 만든다 — imweb 쓰기는 사람이 로그인해 둔 브라우저
     프로필로만 되기 때문이다. 그래서 접수는 웹앱이, 생성은 이 워커가 맡는다.)

⚠ 기본은 **테스트 모드**라 문자가 전부 내 번호로 온다. 실발송은 `MYPT_SMS_LIVE=1`.
⚠ 한 번에 **한 건만** 처리한다. imweb 쓰기는 되돌리기가 없어, 잘못되면 다음 건까지
   같은 실수를 반복하는 것보다 멈추고 사람이 보는 편이 낫다.
"""
from __future__ import annotations

import argparse
import random
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent))

import contacts                                                 # noqa: E402
import intake                                                   # noqa: E402
import proclog                                                  # noqa: E402
from google_auth import user_credentials                        # noqa: E402
from googleapiclient.discovery import build                     # noqa: E402
from notify import send_email, send_sms_admin, sms_test_mode    # noqa: E402
from region_pipeline import RegionPlan, run_region              # noqa: E402


def region_pw(app: dict) -> str:
    """지역 PW = **랜덤 4자리**(챕터는 런칭일 MMDD 지만 지역은 규칙이 없다).

    `비고` 에 `pw=1234` 로 적혀 있으면 그것을 쓴다 — 사람이 정해 둔 값을 존중한다.
    ⛔ imweb 은 비번을 bcrypt 로 저장해 되읽을 수 없다 → 여기서 정하고 반드시 남긴다.
    """
    m = re.search(r"pw\s*=\s*(\d{4})", app.get("note", ""))
    return m.group(1) if m else f"{random.randint(0, 9999):04d}"


def main() -> int:
    ap = argparse.ArgumentParser(description="신규 지역 신청 감시 → 생성")
    ap.add_argument("--run", action="store_true", help="대기 건을 처리한다")
    ap.add_argument("--apply", action="store_true", help="실제 생성 (게시는 안 함)")
    ap.add_argument("--headful", action="store_true", help="브라우저 창을 띄운다")
    a = ap.parse_args()

    svc = build("sheets", "v4", credentials=user_credentials(), cache_discovery=False)
    apps = intake.applications(svc)
    todo = intake.pending(intake.KIND_REGION, apps, svc)
    mode = "  [테스트 모드 — 문자는 전부 내 번호로]" if sms_test_mode() else "  [실발송]"
    print(f"`{intake.TAB}` {len(apps)}건 · 지역 대기 {len(todo)}건{mode}")

    for x in todo:
        print(f"  ▶ {x['row']}행 {x['key']} · 영문={x['region_eng'] or '-'} "
              f"· 담당 {x['owner'] or '-'}")
    if not todo:
        print("대기 건 없음 — 할 일 없음")
        return 0
    if not a.run:
        print("\n(--run 을 붙이면 처리한다)")
        return 0

    # 한 번에 한 건. imweb 쓰기는 되돌릴 수 없다.
    x = todo[0]
    key, row_no = x["key"], x["row"]
    master = key[len("지역 "):].strip()
    eng = x["region_eng"]
    # imweb 표시명 — 모 시트 표기(`Suwon2 수원2`)에서 영문을 뗀 나머지
    kor = master[len(eng):].strip() if eng and master.startswith(eng) else x["region_kor"]
    phone = x["owner_phone"] or contacts.phone_index(svc).get(x["email"].lower(), "")
    pw = region_pw(x)

    print(f"\n=== {master} ===")
    missing = [k for k, v in (("지역영문", eng), ("지역 한글명", kor)) if not v]
    if missing:
        msg = f"필수 값이 없다: {', '.join(missing)} — 신청 내용을 확인하세요"
        print(f"  ⛔ {msg}")
        if a.apply:
            intake.update(row_no, svc=svc, status=intake.ST_HOLD, log=f"보류 · {msg}")
            send_sms_admin(f"[지역등록 보류] {master}\n{msg}")
        return 1

    # 대장에 처리 행을 연다(이미 있으면 그 행을 쓴다)
    if a.apply:
        proclog.open_row(proclog.FLOW_REGION, key, owner=x["owner"], email=x["email"],
                         phone=phone, body=f"imweb={kor} | url={eng} | pw={pw}",
                         status=proclog.ST_RECEIVED, svc=svc)
        ledger = proclog.read_all(svc)
        n = proclog.find(key, ledger, svc)
        prev_trace = ledger[n - 2][proclog.C_TRACE] if n else ""
        # 3분마다 도는 워커라, 재시도마다 "생성 시작"을 남기면 진행로그가 그것만으로 찬다.
        proclog.update(key, svc=svc, status=proclog.ST_RUNNING,
                       trace="" if "생성 시작" in prev_trace else "생성 시작")
        intake.update(row_no, svc=svc, status=intake.ST_RUNNING, phone=phone,
                      log="" if "생성 시작" in prev_trace else "생성 시작")
    else:
        prev_trace = ""

    p = RegionPlan(eng, kor, master, pw, a.apply, a.headful)
    try:
        out = run_region(p)
    except SystemExit as e:
        msg = str(e)
        print(f"  ⛔ 중단 — {msg}")
        if not a.apply:
            return 1
        # ⚠ imweb 로그인 만료는 **사람이 한 번 붙으면 풀리는 일시 상태**다.
        #   이걸 `보류` 로 확정하고 문자를 보내면, 3분마다 도는 워커가 같은 문자를
        #   하루 480통 보낸다. 상태는 `대기` 로 되돌리고, 알림은 **키당 한 번만**.
        if "로그인" in msg:
            already = "imweb 로그인 대기" in prev_trace
            note = "imweb 로그인 대기 — `python imweb_client.py --login` 후 자동 재시도"
            proclog.update(key, svc=svc, status=proclog.ST_RECEIVED,
                           trace="" if already else note)
            intake.update(row_no, svc=svc, status=intake.ST_WAIT,
                          log="" if already else note)
            if not already:
                send_sms_admin(f"[지역등록 대기] {master}\n"
                               "imweb 로그인이 필요합니다. 로그인하면 자동으로 이어서 진행됩니다.")
            print("     (상태는 `대기` 로 되돌렸다 — 로그인하면 다음 주기에 저절로 재시도한다)")
            return 1
        proclog.update(key, svc=svc, status=proclog.ST_HOLD, trace=f"중단 · {msg[:200]}")
        intake.update(row_no, svc=svc, status=intake.ST_HOLD, log=f"중단 · {msg[:200]}")
        send_sms_admin(f"[지역등록 중단] {master}\n{msg[:300]}")
        return 1
    except Exception as e:                                       # noqa: BLE001
        msg = f"{e.__class__.__name__}: {e}"
        print(f"  ⛔ 실패 — {msg}")
        if a.apply:
            proclog.update(key, svc=svc, status=proclog.ST_FAILED, trace=f"실패 · {msg[:200]}")
            intake.update(row_no, svc=svc, status=intake.ST_HOLD, log=f"실패 · {msg[:200]}")
            send_sms_admin(f"[지역등록 실패] {master}\n{msg[:300]}")
        return 1

    if not a.apply:
        print("\n(dry-run — 어느 시트에도 쓰지 않았다. --apply 를 붙일 것)")
        return 0

    ok = out["report"]["ok"]
    notes = out.get("notes", [])
    made = " · ".join(f"{label} {value}" for label, value in [
        ("시트", p.result.get("sheet", "")),
        ("QR", p.result.get("short_link", "")),
        ("ALL", p.result.get("all_page_url", "")),
        ("지역", "/" + p.result["region_page_url"] if p.result.get("region_page_url") else ""),
    ] if str(value).strip()) or "(생성 결과 없음)"

    # ⚠ 담당자에게는 여기서 보내지 않는다. 담당자 문자는 **접수 1통 + 게시완료 1통**뿐이다
    #   (`intake_ack.py` · `publish_watch.py`). 생성이 끝났다고 알려 봐야 그 시점엔
    #   공개 사이트가 아직 404 라, 링크를 눌러도 안 열린다.
    send_sms_admin(f"[지역등록 {'완료' if ok else '확인필요'}] {master}\n{made}"
                   + (f"\n\n확인: {notes[0]}" if notes else "")
                   + "\n\n▶ 편집기에서 확인 후 게시하세요. 게시하면 마무리는 자동입니다.")

    proclog.update(
        key, svc=svc,
        # 생성이 끝나도 **완료가 아니다.** 게시까지 돼야 담당자가 쓸 수 있다.
        # `publish_watch.py` 가 게시를 감지해 `완료` 로 닫는다.
        status=proclog.ST_RUNNING if ok else proclog.ST_HOLD,
        fix=made,
        trace=("생성 완료 · 게시 대기" if ok else "검증 불통과 — 사람 확인 필요")
              + (" · " + " / ".join(notes) if notes else ""))

    intake.update(row_no, svc=svc,
                  status=intake.ST_CREATED if ok else intake.ST_HOLD,
                  sheet=p.result.get("sheet", ""),
                  # ⚠ 게시 판정용 url 이다(publish_watch 가 쓴다). ALL 페이지는 비번이 걸린
                  #   내부 코드 url 이라, 공개 내비 페이지인 **지역 페이지 url** 을 넣는다.
                  page=p.result.get("region_page_url", "") or eng,
                  log=("생성 완료 · 게시 대기" if ok else "검증 불통과"))

    send_email(f"[지역등록] {master} — {'완료' if ok else '확인필요'}",
               f"{made}\n\n" + "\n".join(f"- {x}" for x in notes)
               + f"\n\n신청 접수: `{intake.TAB}` {row_no}행"
               + f"\n처리 대장: `{proclog.TAB}` 탭\n리포트: {out.get('report_path', '')}"
               + ("\n\n⚠ 테스트 모드 — 문자는 전부 관리자 번호로 갔습니다."
                  if sms_test_mode() else ""))
    print(f"\n{'완료' if ok else '확인필요'} — 접수 {row_no}행 · 대장 갱신")
    print("▶ 남은 것: imweb 편집기에서 확인 후 **게시**")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
