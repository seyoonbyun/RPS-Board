# -*- coding: utf-8 -*-
r"""RPS Board **게시판(Admin Board) 문의**를 감지해 문자를 보내고 대장에 남긴다.

    python board_watch.py             # dry-run — 무엇을 보낼지만 찍는다
    python board_watch.py --apply     # 실제 문자 발송 + 대장 기록
    python board_watch.py --replay 5  # 커서를 무시하고 최근 5건 다시 보기 (점검용)

하는 일
    새 **문의**(`요청`)        → 문의자에게 "접수되었습니다" · 나에게 "이런 문의가 있다"
    새 **답변**(`답변`, 내셔널) → 문의자에게 답변 내용 문자 · 원 문의 행을 `완료` 로

⚠ **최초 실행은 아무것도 보내지 않는다.** 커서를 로그 끝에 맞추고 끝낸다.
   그러지 않으면 몇 달 치 옛 문의에 지금 와서 "접수되었습니다" 문자가 날아간다.

⚠ 게시판에는 **연락처가 없다.** `담당자 연락처` 탭에서 이메일로 찾는다(정본은 거기 하나).
   없으면 문의자 문자는 건너뛰고 **나에게만** 보낸다 — 조용히 넘기지 않고 대장에 남긴다.

⚠ 기본은 **테스트 모드**라 문자가 전부 내 번호로 온다. 실발송은 `MYPT_SMS_LIVE=1`.
"""
from __future__ import annotations

import argparse
import datetime
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent))

import contacts                                                 # noqa: E402
import paths                                                    # noqa: E402
import proclog                                                  # noqa: E402
from google_auth import user_credentials                        # noqa: E402
from googleapiclient.discovery import build                     # noqa: E402
from notify import (admin_phone, send_email, send_sms_admin,    # noqa: E402
                    send_sms_public, sms_test_mode)

SID = proclog.SID
BOARD_TAB = "BoardLog"

TYPE_ASK = "요청"
TYPE_ANSWER = "답변"
#: 답변을 문의자에게 문자로 흘려보내는 것은 **본사(내셔널)** 답변일 때만.
ANSWER_ROLES = {"National"}


def state_path() -> Path:
    d = paths.snap_dir()
    d.mkdir(parents=True, exist_ok=True)
    return d / "board_watch_state.json"


def key_of(sheet_row: int) -> str:
    return f"게시판 #{sheet_row}"


def sig_of(p: dict) -> str:
    """글 하나를 **행번호와 무관하게** 가리키는 표시.

    ⛔ 예전에는 처리 지점을 `커서 = 글 개수` 로 기억했다. 그런데 게시판은 글을 지울 수
       있고(`/api/admin/board/delete`), 지우면 개수가 **줄어든다**. 그러면
       `posts[커서:]` 가 비어서 **그 뒤에 올라온 새 문의가 조용히 무시된다** —
       문자도 대장도 없이. 개수를 세는 대신 글 하나하나를 기억한다.

    내용(F열)은 표시에 넣지 않는다. 글 수정(`/board/update`)이 내용만 바꾸는데,
    내용까지 넣으면 수정할 때마다 "새 글"이 되어 접수 문자가 다시 나간다.
    """
    return "|".join((p["ts"], p["email"].lower(), p["type"], p["parent"]))


def save_state(st: dict, posts: list[dict], note: str = "") -> None:
    """지금 보이는 글 전부를 처리한 것으로 적는다.

    건너뛴 글(공지·형식 불명)도 함께 적는다 — 예전 커서가 그랬듯, 한 번 본 글은
    다시 보지 않는다. 지워진 글의 표시는 남지만 몇 바이트라 따로 정리하지 않는다.
    """
    st = dict(st or {})
    seen = set(st.get("seen") or [])
    seen |= {sig_of(p) for p in posts}
    st.pop("cursor", None)                      # 개수 커서는 더 쓰지 않는다
    st["seen"] = sorted(seen)
    st["checked_at"] = datetime.datetime.now().isoformat(timespec="seconds")
    if note:
        st["note"] = note
    state_path().write_text(json.dumps(st, ensure_ascii=False, indent=1), encoding="utf-8")


def phone_index(svc) -> dict[str, str]:
    """{이메일(소문자): 연락처} — 정본은 `담당자 연락처` 탭 하나뿐이다.

    `문자수신 = N` 인 사람은 여기서 이미 빠진다(옵트아웃).
    """
    return contacts.phone_index(svc)


def read_board(svc) -> list[dict]:
    rows = svc.spreadsheets().values().get(
        spreadsheetId=SID, range=f"'{BOARD_TAB}'!A2:G5000",
        valueRenderOption="FORMATTED_VALUE").execute().get("values", [])
    out = []
    for i, r in enumerate(rows, start=2):          # 시트 행번호 = 웹앱의 index
        r = list(r) + [""] * (7 - len(r))
        out.append({"row": i, "ts": str(r[0]).strip(), "email": str(r[1]).strip(),
                    "name": str(r[2]).strip(), "role": str(r[3]).strip(),
                    "type": str(r[4]).strip(), "content": str(r[5]).strip(),
                    "parent": str(r[6]).strip()})
    return out


def pretty_ts(ts: str) -> str:
    """`2026-04-23,04-39-23` -> `2026-04-23 04:39`."""
    try:
        d, t = ts.split(",")
        return f"{d} {':'.join(t.split('-')[:2])}"
    except Exception:                                            # noqa: BLE001
        return ts


def ask_sms_to_owner(p: dict) -> str:
    return ("문의가 접수되었습니다. 확인 후 안내드리겠습니다.\n\n"
            f"· 접수 {pretty_ts(p['ts'])}\n"
            f"· 내용 {p['content'][:200]}\n\n"
            "답변은 RPS Board 게시판에서도 확인하실 수 있습니다.")


def ask_sms_to_admin(p: dict) -> str:
    return (f"[RPS 문의] {p['name'] or p['email']} ({p['role'] or '-'})\n"
            f"{pretty_ts(p['ts'])}\n\n{p['content'][:400]}")


def answer_sms_to_owner(q: dict, a: dict) -> str:
    return ("남겨주신 문의에 답변드렸습니다.\n\n"
            f"· 문의 {q['content'][:120]}\n"
            f"· 답변 {a['content'][:400]}\n\n"
            "전체 내용은 RPS Board 게시판에서 확인하실 수 있습니다.")


def main() -> int:
    ap = argparse.ArgumentParser(description="게시판 문의 감지 → 문자 + 대장")
    ap.add_argument("--apply", action="store_true", help="실제 발송·기록")
    ap.add_argument("--replay", type=int, default=0,
                    help="커서를 무시하고 마지막 N건 재검토 (커서는 안 옮긴다)")
    a = ap.parse_args()

    svc = build("sheets", "v4", credentials=user_credentials(), cache_discovery=False)
    posts = read_board(svc)

    st = json.loads(state_path().read_text(encoding="utf-8")) if state_path().exists() else None
    if st is None and not a.replay:
        save_state({}, posts, note="최초 실행 — 기존 게시글은 처리하지 않았다")
        print(f"최초 실행 — 기존 {len(posts)}건을 처리한 것으로 적고 종료한다 "
              "(옛 글에 문자를 보내지 않는다).")
        print(f"   상태 파일 {state_path()}")
        return 0

    st = st or {}
    seen = set(st.get("seen") or [])
    if not seen and "cursor" in st:
        # 옛 상태(개수 커서) → 표시 목록으로 한 번만 옮긴다. 커서 앞의 글이 처리된 것이다.
        seen = {sig_of(p) for p in posts[:int(st.get("cursor", 0))]}
        print(f"상태 이관 — 커서 {st.get('cursor')} → 처리 표시 {len(seen)}건")
    fresh = posts[-a.replay:] if a.replay else [p for p in posts if sig_of(p) not in seen]
    mode = "  [테스트 모드 — 문자는 전부 내 번호로]" if sms_test_mode() else "  [실발송]"
    print(f"{BOARD_TAB} {len(posts)}건 · 처리 {len(seen)}건 · 신규 {len(fresh)}건{mode}")

    if not fresh:
        print("새 글 없음 — 할 일 없음")
        if a.apply and not a.replay:
            save_state(st, posts)
        return 0

    phones = phone_index(svc)
    by_row = {p["row"]: p for p in posts}
    mine = admin_phone()
    handled, report = 0, []

    for p in fresh:
        who = p["name"] or p["email"]
        phone = phones.get(p["email"].lower(), "")

        # ⚠ **내셔널이 쓴 `요청` 은 문의가 아니다.** 결과 공지·안내를 올리는 자리다.
        #   `publish_watch.py` 가 게시 후 결과 글을 자동으로 올리는데, 그것까지 문의로
        #   잡으면 나에게 "이런 문의가 있다" 문자가 오고 나 자신에게 접수 안내가 간다
        #   (2026-08-23 실제로 그랬다).
        if p["type"] == TYPE_ASK and p["role"] in ANSWER_ROLES:
            print(f"\n· 공지/결과 글 #{p['row']} ({who}) — 문의 아님, 건너뜀")
            continue

        # 새 문의
        if p["type"] == TYPE_ASK:
            key = key_of(p["row"])
            print(f"\n▶ 문의 {key} · {who} · {p['content'][:50]}")
            print(f"    문의자 문자 → {phone or '⚠ 연락처 없음 (`담당자 연락처` 미등록) — 건너뜀'}")
            print(f"    관리자 문자 → {mine}")
            if not a.apply:
                continue

            proclog.open_row(proclog.FLOW_BOARD, key, owner=who, email=p["email"],
                             phone=phone, body=p["content"],
                             status=proclog.ST_RECEIVED, svc=svc)
            ok_owner = send_sms_public(ask_sms_to_owner(p), phone) if phone else False
            ok_admin = send_sms_admin(ask_sms_to_admin(p))
            proclog.update(
                key, svc=svc,
                sms_in=(proclog.sms_note(ok_owner, phone, "접수안내") if phone
                        else "미발송 — `담당자 연락처` 미등록"),
                trace=f"접수 · 관리자알림 {'OK' if ok_admin else 'FAIL'}")
            report.append(f"[문의] {who} · {p['content'][:60]}"
                          + ("" if phone else "  ⚠ 연락처 없어 접수문자 미발송"))
            handled += 1
            continue

        # 답변 (내셔널)
        if p["type"] == TYPE_ANSWER and p["role"] in ANSWER_ROLES:
            try:
                parent_row = int(p["parent"])
            except (TypeError, ValueError):
                print(f"\n· 답변 #{p['row']} — 원 문의 번호를 못 읽었다({p['parent']!r}), 건너뜀")
                continue
            q = by_row.get(parent_row)
            if not q:
                print(f"\n· 답변 #{p['row']} — 원 문의 #{parent_row} 가 없다(삭제됨), 건너뜀")
                continue
            key = key_of(parent_row)
            q_phone = phones.get(q["email"].lower(), "")
            print(f"\n▶ 답변 #{p['row']} → 원 문의 {key} · {q['name'] or q['email']}")
            print(f"    답변 문자 → {q_phone or '⚠ 연락처 없음 — 건너뜀'}")
            if not a.apply:
                continue

            # 원 문의가 대장에 없을 수 있다(커서 이전 글) → 그 자리에서 연다
            proclog.open_row(proclog.FLOW_BOARD, key, owner=q["name"] or q["email"],
                             email=q["email"], phone=q_phone, body=q["content"],
                             status=proclog.ST_RECEIVED, svc=svc)
            ok = send_sms_public(answer_sms_to_owner(q, p), q_phone) if q_phone else False
            proclog.update(
                key, svc=svc, status=proclog.ST_DONE, done_ts=proclog.stamp(),
                reply=p["content"], fix=p["content"][:500],
                sms_out=(proclog.sms_note(ok, q_phone, "답변안내") if q_phone
                         else "미발송 — `담당자 연락처` 미등록"),
                trace=f"답변 게시 #{p['row']} → 완료")
            report.append(f"[답변] {q['name'] or q['email']} · {p['content'][:60]}")
            handled += 1
            continue

        print(f"\n· 건너뜀 #{p['row']} type={p['type']!r} role={p['role']!r}")

    if not a.apply:
        print("\n[dry-run] 보내지도 쓰지도 않았다. --apply 를 붙일 것.")
        return 0

    if report:
        note = ("\n\n⚠ 테스트 모드 — 문자는 전부 관리자 번호로 갔습니다."
                if sms_test_mode() else "")
        send_email(f"[RPS 게시판] 처리 {handled}건",
                   "\n".join(report) + f"\n\n대장: `{proclog.TAB}` 탭" + note)

    if not a.replay:
        save_state(st, posts)
    print(f"\n처리 {handled}건 · 대장 `{proclog.TAB}` 기록 완료")
    return 0


if __name__ == "__main__":
    sys.exit(main())
