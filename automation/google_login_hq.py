# -*- coding: utf-8 -*-
r"""`hq@joy-bnikorea.com` 계정용 구글 토큰을 따로 만든다.

    python google_login_hq.py            # 브라우저가 열린다 — hq 로 로그인 후 '허용'
    python google_login_hq.py --check    # 이미 있는 토큰이 누구인지만 확인

왜 필요한가
    `google_token.json` 은 `bnikorea.joybyun@gmail.com` 이다. 그 계정은 hq 가 소유한
    파일 일부에 **뷰어**로만 들어가 있어 내용을 바꿀 수 없다(예: 담당자 매뉴얼 .pptx).
    소유 계정 토큰이 하나 더 있으면 브라우저를 거치지 않고 API 로 바로 고칠 수 있다.

⚠ 비밀번호는 **구글 로그인 화면에 사람이 직접** 넣는다. 이 스크립트도, 대화도 값을
   보지 않는다. 받는 것은 refresh token 뿐이다.
⚠ 기존 `google_token.json` 은 건드리지 않는다 — 다른 자동화가 전부 그걸 쓴다.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent))

from google.auth.transport.requests import Request              # noqa: E402
from google.oauth2.credentials import Credentials               # noqa: E402
from google_auth_oauthlib.flow import InstalledAppFlow          # noqa: E402
from googleapiclient.discovery import build                     # noqa: E402

import paths                                                    # noqa: E402
from google_auth import SCOPES                                  # noqa: E402

TARGET = "hq@joy-bnikorea.com"


def token_path() -> Path:
    return paths.cred_dir() / "google_token_hq.json"


def hq_credentials(interactive: bool = False) -> Credentials:
    tp = token_path()
    creds = Credentials.from_authorized_user_file(str(tp), SCOPES) if tp.exists() else None
    if creds and creds.valid:
        return creds
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
        tp.write_text(creds.to_json(), encoding="utf-8")
        return creds
    if not interactive:
        raise RuntimeError(f"hq 토큰이 없다 →  python google_login_hq.py")

    cs = paths.cred_dir() / "client_secret.json"
    if not cs.exists():
        raise SystemExit(f"OAuth 클라이언트 JSON 이 없다: {cs}")
    flow = InstalledAppFlow.from_client_secrets_file(str(cs), SCOPES)
    creds = flow.run_local_server(
        port=0, access_type="offline", prompt="consent",
        authorization_prompt_message=(
            f"\n브라우저가 열립니다. **{TARGET}** 계정으로 로그인하고 '허용'을 누르세요.\n"
            "  (다른 계정으로 로그인하면 이 파일을 못 고칩니다)\n"),
        success_message="완료했습니다. 이 창을 닫아도 됩니다.")
    tp.write_text(creds.to_json(), encoding="utf-8")
    return creds


def whoami(creds) -> str:
    d = build("drive", "v3", credentials=creds, cache_discovery=False)
    return d.about().get(fields="user(emailAddress)").execute()["user"]["emailAddress"]


def main() -> int:
    ap = argparse.ArgumentParser(description="hq 계정 구글 토큰 발급")
    ap.add_argument("--check", action="store_true", help="이미 있는 토큰의 계정만 확인")
    a = ap.parse_args()

    if a.check:
        if not token_path().exists():
            print(f"토큰 없음: {token_path().name}")
            return 1
        print("계정:", whoami(hq_credentials()))
        return 0

    creds = hq_credentials(interactive=True)
    who = whoami(creds)
    print(f"\n토큰 저장: {token_path()}")
    print(f"계정      : {who}")
    if who.lower() != TARGET:
        print(f"\n⚠ {TARGET} 이 아닙니다. 다시 실행해 그 계정으로 로그인하세요.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
