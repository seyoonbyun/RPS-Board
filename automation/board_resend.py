# -*- coding: utf-8 -*-
r"""게시판 답변 문자를 다시 보낸다 — 감시 작업이 이미 '처리'했는데 문자만 실패한 경우.

    python board_resend.py --answer 20            # 답변 #20 을 원 문의자에게 (실발송)
    python board_resend.py --answer 20 --dry      # 누구에게 무엇이 가는지만

왜 필요한가 (2026-11-09 RPS-02)
    솔라피 키가 만료된 동안 답변 #20·#21 의 문자가 실패했다. board_watch 는 글 단위로
    한 번만 처리하므로 키를 고쳐도 다시 보내지 않는다. 그래서 사람이 골라서 재발송한다.
    문구·검수 사본·대장 기록은 board_watch 와 똑같은 함수를 쓴다.
"""
from __future__ import annotations
import argparse, os, sys
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent))
import board_watch as bw, proclog, contacts                      # noqa: E402
from notify import send_sms_public, send_sms_admin, GREETING     # noqa: E402

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--answer", type=int, required=True, help="답변 글의 번호(index)")
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    if not a.dry:
        os.environ["MYPT_SMS_LIVE"] = "1"
    svc = proclog._svc()
    posts = {p["row"]: p for p in bw.read_board(svc)}
    ans = posts.get(a.answer)
    if not ans or ans["type"] != bw.TYPE_ANSWER:
        print(f"#{a.answer} 은 답변 글이 아니다"); return 1
    q = posts.get(int(ans["parent"]))
    phone = contacts.phone_index(svc).get(q["email"].lower(), "")
    print(f"답변 #{a.answer} → 원 문의 #{q['row']} {q['name']} ({q['email']}) → {phone or '연락처 없음'}")
    print("----\n" + GREETING + "\n\n" + bw.answer_sms_to_owner(q, ans) + "\n----")
    if a.dry or not phone:
        return 0
    ok = send_sms_public(bw.answer_sms_to_owner(q, ans), phone)
    ok_copy = send_sms_admin(f"[검수 사본 → {q['name']} {phone}]\n{GREETING}\n\n{bw.answer_sms_to_owner(q, ans)}")
    print("문의자 문자:", "OK" if ok else "FAIL", "| 검수 사본:", "OK" if ok_copy else "FAIL")
    proclog.update(f"게시판 #{q['row']}", svc=svc,
                   sms_out=proclog.sms_note(ok, phone, "답변안내(재발송)"),
                   trace=f"답변 #{a.answer} 문자 재발송 {'OK' if ok else 'FAIL'} · 검수사본 {'OK' if ok_copy else 'FAIL'}")
    return 0 if ok else 1

if __name__ == "__main__":
    sys.exit(main())
