# -*- coding: utf-8 -*-
"""구글 자격증명 — 서비스계정 / 소유계정 OAuth 두 갈래.

왜 두 갈래인가
    **서비스계정은 드라이브 파일을 만들 수 없다.** 권한 문제가 아니라 저장공간 문제다.
    구글 드라이브의 파일은 반드시 누군가의 저장공간을 차지하는데, 서비스계정
    `id-rps-meberlist@…` 의 할당량은 `limit: 0` 이다(실측). 폴더에 writer 로 들어가
    `canAddChildren: True` 여도, 파일을 만드는 순간 소유자가 되어야 하므로
    `403 storageQuotaExceeded` 로 막힌다. 권한을 올려도 영원히 안 된다.

    → **읽기·수정은 서비스계정, 파일 생성(사본 만들기)은 소유계정 OAuth** 로 나눈다.

소유계정
    `RPS_Sheets` 폴더와 기존 시트 125개의 소유자 = **bnikorea.joybyun@gmail.com**
    새 시트도 같은 계정 소유여야 소유권이 흩어지지 않는다.

최초 1회
    1) Google Cloud 콘솔에서 **OAuth 클라이언트 ID(데스크톱 앱)** 를 만들어 JSON 을 받는다
    2) 그 파일을 `client_secret.json` 이라는 이름으로 아래 CRED_DIR 에 둔다
    3) `python google_auth.py --login` → 브라우저에서 joybyun 계정으로 '허용'
    → `token.json` 이 생기고, 이후로는 무인으로 갱신된다.

⚠ 토큰은 그 계정의 **드라이브 전체 권한**을 가진다. 볼트(C:\\SEYOON)는 Obsidian Sync·
   Dropbox·구글드라이브 3중 동기화 중이라 자격증명을 두면 세 서비스에 복제된다.
   그래서 **볼트 밖** `desktop\\connect_tl_report\\connect\\` 에 둔다.
"""
from __future__ import annotations

import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")   # 에러도 utf-8 로 (cp949 로 나가면 깨진다)
except Exception:
    pass

from google.oauth2.credentials import Credentials as UserCredentials
from google.oauth2.service_account import Credentials as SACredentials
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

CRED_DIR = Path(r"C:\Users\Gram\desktop\connect_tl_report\connect")
CLIENT_SECRET = CRED_DIR / "client_secret.json"
TOKEN = CRED_DIR / "google_token.json"
SA_KEY = Path(r"C:\SEYOON\03. Projects\Ongoing\rpslist\gcp-key.json")

OWNER_EMAIL = "bnikorea.joybyun@gmail.com"

SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
]


class MissingClientSecret(RuntimeError):
    pass


# ---------------------------------------------------------------- 서비스계정

def sa_credentials(scopes: list[str] | None = None) -> SACredentials:
    return SACredentials.from_service_account_file(str(SA_KEY), scopes=scopes or SCOPES)


def sa_services():
    c = sa_credentials()
    return build("drive", "v3", credentials=c), build("sheets", "v4", credentials=c)


# ---------------------------------------------------------------- 소유계정 OAuth

def user_credentials(interactive: bool = False) -> UserCredentials:
    """저장된 토큰을 쓰고, 만료됐으면 조용히 갱신한다.

    interactive=True 일 때만 브라우저를 띄운다(최초 1회).
    """
    creds: UserCredentials | None = None
    if TOKEN.exists():
        creds = UserCredentials.from_authorized_user_file(str(TOKEN), SCOPES)

    if creds and creds.valid:
        return creds

    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
        TOKEN.write_text(creds.to_json(), encoding="utf-8")
        return creds

    if not interactive:
        raise RuntimeError(
            "구글 소유계정 토큰이 없거나 만료됐다 →  python google_auth.py --login")

    if not CLIENT_SECRET.exists():
        raise MissingClientSecret(
            f"OAuth 클라이언트 JSON 이 없다: {CLIENT_SECRET}\n"
            "Google Cloud 콘솔 > 사용자 인증 정보 > OAuth 클라이언트 ID(데스크톱 앱) 로 받아 두세요.")

    flow = InstalledAppFlow.from_client_secrets_file(str(CLIENT_SECRET), SCOPES)
    # access_type=offline + prompt=consent 라야 refresh_token 이 온다.
    # (이미 동의한 적이 있으면 구글이 refresh_token 을 생략해서, 다음 실행에 또 로그인하게 된다)
    creds = flow.run_local_server(
        port=0, access_type="offline", prompt="consent",
        authorization_prompt_message="브라우저에서 {} 계정으로 로그인하고 '허용'을 누르세요.".format(OWNER_EMAIL),
        success_message="완료했습니다. 이 창을 닫아도 됩니다.")
    TOKEN.parent.mkdir(parents=True, exist_ok=True)
    TOKEN.write_text(creds.to_json(), encoding="utf-8")
    return creds


def user_services(interactive: bool = False):
    c = user_credentials(interactive)
    return build("drive", "v3", credentials=c), build("sheets", "v4", credentials=c)


def owner_ok() -> tuple[bool, str]:
    """토큰이 **의도한 소유계정** 것인지 확인한다.

    다른 계정으로 동의해 버리면 새 시트만 소유자가 갈려서 나중에 알아채기 어렵다.
    """
    try:
        drive, _ = user_services()
        me = drive.about().get(fields="user(emailAddress),storageQuota(limit,usage)").execute()
        email = me["user"]["emailAddress"]
        return email.lower() == OWNER_EMAIL.lower(), email
    except Exception as e:
        return False, f"({e})"


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="구글 자격증명 셋업")
    ap.add_argument("--login", action="store_true", help="소유계정 OAuth 최초 동의 (브라우저)")
    ap.add_argument("--check", action="store_true", help="서비스계정·소유계정 상태 확인")
    a = ap.parse_args()

    if a.login:
        if not CLIENT_SECRET.exists():
            raise SystemExit(
                f"[FAIL] 먼저 OAuth 클라이언트 JSON 을 두세요:\n       {CLIENT_SECRET}")
        user_credentials(interactive=True)
        ok, email = owner_ok()
        print(f"\n[{'OK' if ok else '주의'}] 로그인 계정: {email}")
        if not ok:
            print(f"       기대한 소유계정은 {OWNER_EMAIL} 입니다.")
            print(f"       다른 계정으로 하면 새 시트만 소유자가 갈립니다. "
                  f"{TOKEN.name} 을 지우고 다시 로그인하세요.")
        else:
            print(f"       토큰 {TOKEN}")
    elif a.check:
        import json
        sa = json.loads(SA_KEY.read_text(encoding="utf-8"))
        drive, _ = sa_services()
        q = drive.about().get(fields="storageQuota").execute()["storageQuota"]
        print(f"서비스계정 {sa['client_email']}")
        print(f"  저장공간 limit={q.get('limit')}  → {'파일 생성 불가(정상)' if q.get('limit')=='0' else '?'}")
        print(f"클라이언트 JSON : {'있음' if CLIENT_SECRET.exists() else '없음 — 콘솔에서 발급 필요'}")
        print(f"소유계정 토큰   : {'있음' if TOKEN.exists() else '없음 —  python google_auth.py --login'}")
        if TOKEN.exists():
            ok, email = owner_ok()
            print(f"  계정 {email}  {'(소유계정 일치)' if ok else '(⚠ 소유계정과 다르다)'}")
    else:
        ap.print_help()
