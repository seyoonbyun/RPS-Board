# -*- coding: utf-8 -*-
"""board_triage 진단 로직 — 네트워크 없이 2026-11-09 서초 메디컬 사례를 그대로 재현한다.

    python -m unittest automation.tests.test_board_triage -v     (레포 루트에서)
    python -m unittest tests.test_board_triage -v                (automation 폴더에서)
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import board_triage as bt  # noqa: E402

REGION = "Seocho 서초"
MANAGER = "hskimsu@hanmail.net"


def user(name, email, chapter="Medical", region=REGION, status="활동중"):
    return {"email": email, "region": region, "chapter": chapter, "memberName": name, "status": status}


def wd(name, email, chapter="Medical", when="2026. 04. 14. 오후 6:46:39"):
    return {"withdrawalTime": when, "email": email, "region": REGION, "chapter": chapter, "memberName": name}


USERS = [
    user("강주연", "juyeon521@naver.com"), user("공윤희", "imgyh77@gmail.com"), user("송동헌", "thdehdgjs2@naver.com"),
    user("조은영", "joajoa681@naver.com"), user("오지인", "passionest@naver.com"), user("임강수", "kangsoo.lim@daum.net"),
    user("정성진", "readymed7@gmail.com"), user("박은정", "therese88@hanmail.net"), user("김근호", "nyny124@naver.com"),
    # 동명이인 — 다른 지역·챕터
    user("조은영", "airworld9256@naver.com", chapter="Pioneer", region="Gangnam 강남"),
    user("이승희", "aisiteiru787878@gmail.com", chapter="Goood", region="Gangnam 강남"),
    # 삭제 요청이 들어올 수 있는 활동중 멤버
    user("김재홍", "rrkdkjh@nate.com"), user("박용진", "yongjin@withinbiz.com"),
    user("홍길동", "hong1@x.com", chapter="Honors"), user("홍길동", "hong2@x.com", chapter="Promise"),
]
WITHDRAWN = [wd("최상봉", "csb0919@gmail.com"), wd("오춘택", "oct1976@naver.com"), wd("윤선행", "smhl1470@gmail.com"),
             wd("강성한", "leonaru@naver.com"), wd("이승희", "ceo@realbiz.kr"), wd("이윤재", "tj_pharma@naver.com"),
             wd("윤지환", "puzu1124@hanmail.net"), wd("김장훈", "kim@intellectualcreative.kr")]
ADMINS = [{"region": REGION, "memberName": "김희섭", "email": MANAGER, "auth": "Admin"},
          {"region": "National 내셔널", "memberName": "Joy", "email": "joy.byun@bnikorea.com", "auth": "National"}]
INDEX = {"sheets": {"Medical_rps": {"id": "NEW_MED", "kor": "메디컬", "rpi": "1.28"},
                    "Promise_rps": {"id": "NEW_PRO", "kor": "프라미스", "rpi": "1.1"}},
         "old_sheets": {}}

NEW_NAMES = [u["memberName"] for u in USERS if u["chapter"] == "Medical" and u["memberName"] not in ("김재홍", "박용진")]
OLD_NAMES = ["강선미", "최상봉", "오춘택", "윤선행", "강성한", "이승희", "이윤재", "윤지환", "김장훈", "박은정", "김근호"]


def fetcher(sid, title="", official=False):
    data = {"NEW_MED": ("메디컬", "1.28", NEW_NAMES), "OLD_MED": ("메디컬", "1.03", OLD_NAMES),
            "NEW_PRO": ("프라미스", "1.1", ["우은경"])}
    if sid not in data:
        return bt.SheetView(sid, title, "", "", [], official, error="없음")
    kor, rpi, names = data[sid]
    return bt.SheetView(sid, title or sid, kor, rpi, list(names), official)


def ctx(old=True):
    finder = (lambda eng, kor: [("OLD_MED", "Medical")] if eng == "Medical" else []) if old else (lambda e, k: [])
    return bt.Context(users=USERS, withdrawals=WITHDRAWN, admins=ADMINS, index=INDEX,
                      sheet_fetcher=fetcher, creds=None, drive_finder=finder)


def post(text, email=MANAGER, row=23):
    return {"row": row, "ts": "2026-11-09,09-40-38", "email": email, "name": "hskimsu", "role": "Admin",
            "type": "요청", "content": text, "parent": ""}


T23 = "안녕하세요  [탈퇴멤버] 최상봉, 오춘택, 윤선행, 강성한,  이승희, 이윤재, 윤지환, 메디컬챕터 삭제한명단입니다  그대로뜨고있습니다"
T24 = "오지인 임강수 정성진 송동헌 공윤희 강주연 조은영  (메디컬 챕터 추가명단인데) 명단추가가되지않았습니다.  제가 대표님들 아이디와 비번으로 로그인 진행 했습니다.    삭제,추가명단 확인부탁드립니다!!^^"
T19 = "Rps  관리자 대시보드에서  챕터의  멤버  삭제 추가 진행했는데  Rpi  viewer  화면에서 업데이트가  안되어있습니다 확인부탁드립니다!! 서초 메디컬챕터"


class Parse(unittest.TestCase):
    def test_names_and_intent_23(self):
        got = bt.extract_names(T23, ctx().known)
        self.assertEqual([n for n, _ in got], ["최상봉", "오춘택", "윤선행", "강성한", "이승희", "이윤재", "윤지환"])
        self.assertTrue(all(w == "del" for _, w in got))

    def test_names_and_intent_24(self):
        got = bt.extract_names(T24, ctx().known)
        self.assertEqual([n for n, _ in got], ["오지인", "임강수", "정성진", "송동헌", "공윤희", "강주연", "조은영"])
        self.assertTrue(all(w == "add" for _, w in got), got)

    def test_classify(self):
        self.assertIn("view", bt.classify(T19))
        self.assertIn("del", bt.classify(T23))
        self.assertIn("add", bt.classify(T24))
        self.assertIn("login", bt.classify("비밀번호를 잊어서 로그인이 안 됩니다"))

    def test_csv_parse(self):
        text = ("지역,챕터,멤버명,산업군\n\n메디컬,       리퍼럴 파트너 지수 ,,1.28\n\n"
                "Seocho 서초,Medical,강 주연,x\nSeocho 서초,Medical,공윤희,y\n")
        kor, rpi, names = bt.parse_sheet_csv(text)
        self.assertEqual((kor, rpi, names), ("메디컬", "1.28", ["강주연", "공윤희"]))


class Diagnose(unittest.TestCase):
    def test_23_old_sheet_found(self):
        d = bt.diagnose(post(T23), ctx())
        self.assertEqual(d.region, REGION)
        self.assertEqual(d.chapters[0], "Medical")
        self.assertIn("OLD_SHEET", d.causes)
        self.assertEqual(d.confidence, "high")
        self.assertIn("NEW_MED", d.answer)                      # 정식 링크
        self.assertIn("옛", d.answer)
        self.assertIn("4월 14일", d.answer)
        self.assertNotIn("죄송", d.answer)
        self.assertEqual(d.actions_done, [])                    # 데이터를 건드리지 않았다
        # 동명이인 이승희(강남 Goood)는 서초 탈퇴자로 좁혀져야 한다
        lee = next(n for n in d.names if n.name == "이승희")
        self.assertEqual(lee.state, "탈퇴")

    def test_24_additions_present(self):
        d = bt.diagnose(post(T24, row=24), ctx())
        self.assertIn("OLD_SHEET", d.causes)
        self.assertTrue(all(n.state == "활동중" for n in d.names), [(n.name, n.state) for n in d.names])
        self.assertIn("등록되어 있습니다", d.answer)
        # 조은영 동명이인(강남 Pioneer)은 서초 쪽 하나로 좁혀진다
        cho = next(n for n in d.names if n.name == "조은영")
        self.assertEqual(cho.active[0]["chapter"], "Medical")

    def test_23_without_old_sheet_is_still_answered_but_asks_for_link(self):
        d = bt.diagnose(post(T23), ctx(old=False))
        self.assertIn("ALREADY_OK", d.causes)
        self.assertNotIn("OLD_SHEET", d.causes)
        self.assertIn("링크나 캡처", d.answer)
        self.assertEqual(d.confidence, "high")

    def test_19_no_names_generic_view_answer(self):
        d = bt.diagnose(post(T19, row=19), ctx())
        self.assertEqual(d.names, [])
        self.assertEqual(d.chapters, ["Medical"])               # 한글 챕터명으로 챕터는 잡는다
        self.assertEqual(d.causes, ["VIEW_GENERIC"])            # 원인을 단정하지 않는다
        self.assertNotIn("지연", d.answer)                      # 14:24 의 「IMPORTRANGE 지연」 추정을 되풀이하지 않는다
        self.assertIn("옛 시트", d.answer)                      # 같은 이름의 옛 시트가 있다는 사실은 말한다
        self.assertIn("이름을 게시판에", d.answer)              # 이름을 청한다
        self.assertIn("NEW_MED", d.answer)

    def test_already_answered_is_skipped(self):
        board = [{"row": 23, "type": "요청", "role": "Admin", "parent": ""},
                 {"row": 26, "type": "답변", "role": "National", "parent": "23"}]
        self.assertEqual(bt.already_answered(post(T23, row=23), board), 26)
        d = bt.handle(post(T23, row=23), apply=False, ctx=ctx(), board_posts=board)
        self.assertEqual(d.causes, ["ALREADY_ANSWERED"])
        self.assertEqual(d.answer, "")
        # 담당자(Admin)가 단 댓글은 답변으로 치지 않는다
        board2 = [{"row": 23, "type": "요청", "role": "Admin", "parent": ""},
                  {"row": 27, "type": "답변", "role": "Admin", "parent": "23"}]
        self.assertIsNone(bt.already_answered(post(T23, row=23), board2))

    def test_unrelated_text_no_answer(self):
        d = bt.diagnose(post("QR 코드 배너 다시 보내주실 수 있나요?"), ctx())
        self.assertEqual(d.confidence, "none")
        self.assertEqual(d.answer, "")

    def test_delete_pending_in_own_region_is_actionable(self):
        d = bt.diagnose(post("김재홍, 박용진 탈퇴했는데 메디컬 명단에 그대로 있어요"), ctx(old=False))
        self.assertIn("DELETE_PENDING", d.causes)
        self.assertEqual(d.confidence, "high")
        d2 = bt.diagnose(post("김재홍, 박용진 탈퇴했는데 메디컬 명단에 그대로 있어요"), ctx(old=False))
        bt.do_withdrawals(d2, ctx(old=False), apply=False)
        self.assertTrue(d2.actions_done and d2.actions_done[0].startswith("[dry] 탈퇴 처리 2명"))

    def test_delete_ambiguous_asks_email(self):
        d = bt.diagnose(post("홍길동 탈퇴 처리해 주세요"), ctx(old=False))
        self.assertIn("DELETE_AMBIGUOUS", d.causes)
        self.assertNotIn("DELETE_PENDING", d.causes)
        self.assertIn("이메일", d.answer)

    def test_delete_outside_region_not_auto(self):
        d = bt.diagnose(post("이승희 탈퇴 처리해 주세요", email="joanne.baek@bnikorea.com"), ctx(old=False))
        # 문의자가 관리자 목록에 없으면(지역 미상) 자동 탈퇴하지 않는다
        self.assertNotIn("DELETE_PENDING", d.causes)

    def test_add_missing_guides_not_adds(self):
        d = bt.diagnose(post("신규 멤버 김신규 추가했는데 안 보여요"), ctx(old=False))
        self.assertEqual(d.names, [])                           # 모르는 이름은 집지 않는다
        d = bt.diagnose(post("최상봉 님 추가 등록 부탁드립니다. 명단에 안 보입니다"), ctx(old=False))
        self.assertIn("ADD_MISSING", d.causes)
        self.assertIn("새 멤버 추가", d.answer)
        self.assertEqual(d.actions_done, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
