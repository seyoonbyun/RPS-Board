# -*- coding: utf-8 -*-
r"""진행 상황 알림 — 이메일(나) · 문자(나·담당자).

런칭 파이프라인이 **시작부터 마무리까지** 어디까지 갔는지 실시간으로 알린다.

    python notify.py --test          # 이메일 1통 보내 경로가 살아있는지 확인

수신
  - 이메일 `hq@joy-bnikorea.com` — **단계마다**
  - 문자   나 = 시작·완료·오류만 / 담당자 = 완료·오류만
    (단계마다 문자를 보내면 건당 6~7통이라 과하고 비용도 든다)

이메일 경로는 **이미 있는 것을 그대로 쓴다** — 백업 리포트가 매일 쓰는
Apps Script 웹훅 릴레이(syoon850 소유)다. `{secret,subject,body}` 를 POST 하면
릴레이가 hq 편지함으로 보낸다. 새 인증도, 새 배포도 필요 없다.

⚠ URL·시크릿을 여기 복사해 두지 않는다 — 이 파일은 볼트(3중 동기화) 안에 있다.
   정본인 `report-backup-email.ps1`(볼트 밖)에서 읽어 쓴다. 값이 한 곳에만 있으니
   나중에 재배포로 URL 이 바뀌어도 여기는 고칠 게 없다.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

import requests                                   # noqa: E402

RELAY_PS1 = Path(r"C:\Users\Gram\ObsidianBackup\report-backup-email.ps1")

#: 문자 발송 설정 — 솔라피. 번호가 없으면 문자만 조용히 건너뛴다(이메일은 나간다).
SOLAPI_CFG = "solapi.json"        # cred_dir() 안. {"api_key","api_secret","sender","to"}

#: 대외 문자의 첫 줄. 받는 사람이 누구한테서 온 문자인지 모르면 스팸으로 읽힌다.
GREETING = "안녕하세요 조이입니다 :)"

#: **테스트 모드** — 켜져 있으면 남의 번호로 안 나가고 전부 내 번호로 온다.
#: 끄려면 환경변수 `MYPT_SMS_LIVE=1`. 기본이 테스트인 이유는, 실수의 방향을
#: "안 갔다"로 몰아두기 위해서다. 잘못 간 문자는 회수할 수 없다.
def sms_test_mode() -> bool:
    import os
    return os.environ.get("MYPT_SMS_LIVE", "").strip() not in ("1", "true", "YES", "yes")


class NotifyError(RuntimeError):
    pass


# ---------------------------------------------------------------- 이메일

def _relay() -> tuple[str, str]:
    """백업 리포트 스크립트에서 웹훅 URL·시크릿을 읽는다."""
    if not RELAY_PS1.exists():
        raise NotifyError(f"릴레이 설정을 찾지 못했다: {RELAY_PS1}")
    text = RELAY_PS1.read_text(encoding="utf-8-sig", errors="replace")

    def grab(name: str) -> str:
        m = re.search(rf"^\s*\${name}\s*=\s*'([^']+)'", text, re.M)
        if not m:
            raise NotifyError(f"{RELAY_PS1.name} 에서 ${name} 를 찾지 못했다")
        return m.group(1)

    return grab("WEBHOOK_URL"), grab("SHARED_SECRET")


def send_email(subject: str, body: str) -> bool:
    """실패해도 예외를 던지지 않는다 — 알림 때문에 런칭 작업이 멈추면 안 된다."""
    try:
        url, secret = _relay()
        r = requests.post(
            url, timeout=30,
            data=json.dumps({"secret": secret, "subject": subject, "body": body},
                            ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json; charset=utf-8"})
        ok = r.status_code < 400 and "error" not in r.text.lower()
        if not ok:
            print(f"   [알림] 이메일 실패 {r.status_code} {r.text[:200]}", file=sys.stderr)
        return ok
    except Exception as e:                          # noqa: BLE001
        print(f"   [알림] 이메일 실패: {e}", file=sys.stderr)
        return False


# ---------------------------------------------------------------- 문자 (솔라피)

def _solapi_cfg() -> dict | None:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import paths
    f = paths.cred_dir() / SOLAPI_CFG
    if not f.exists():
        return None
    return json.loads(f.read_text(encoding="utf-8"))


def _euckr_len(s: str) -> int:
    """솔라피는 길이를 **EUC-KR 바이트**로 센다 (한글 2 · 영문 1). 90 이 SMS 한계."""
    return sum(2 if ord(c) > 127 else 1 for c in s)


def _payload(text: str, to: str, cfg: dict) -> dict:
    """SMS/LMS 를 길이로 갈라 준다.

    ⚠ `type` 을 안 주면 90바이트를 넘는 본문이 잘려 나가거나 거부된다.
      기존 런칭 문자는 짧아서 드러나지 않았다 — 문의 본문을 실어 보내면 바로 걸린다.
    """
    text = text.strip()
    long = _euckr_len(text) > 90
    if long:
        # LMS 는 2000바이트. 자르더라도 **어디서 잘렸는지 보이게** 한다.
        while _euckr_len(text) > 1990:
            text = text[:-20]
        text += "…"
    msg = {
        "to": re.sub(r"\D", "", to),
        "from": re.sub(r"\D", "", cfg["sender"]),
        "text": text,
        "type": "LMS" if long else "SMS",
    }
    if long:
        msg["subject"] = "RPS Board"
    return msg


def admin_phone() -> str:
    """관리자(나) 번호. 모든 내부 보고 문자의 수신처."""
    cfg = _solapi_cfg()
    return (cfg or {}).get("to", "")


def send_sms(text: str, to: str = "") -> bool:
    """솔라피 문자. 설정이 없으면 **조용히 건너뛴다**(아직 미구성 단계이므로).

    `to` 를 주면 그 번호로, 안 주면 관리자 번호로 간다.
    ⚠ **테스트 모드**(기본)에서는 `to` 가 무엇이든 관리자 번호로 돌린다.
      원래 받았어야 할 번호는 본문 첫 줄에 붙여, 무엇이 어디로 갈 뻔했는지 보이게 한다.

    카카오 알림톡은 채널 연동+템플릿 승인이 끝난 뒤 여기서 kakaoOptions 만 얹으면 된다.
    """
    cfg = _solapi_cfg()
    if not cfg:
        return False
    to = to or cfg.get("to", "")
    if not to:
        return False
    if sms_test_mode():
        mine = cfg.get("to", "")
        if mine and re.sub(r"\D", "", to) != re.sub(r"\D", "", mine):
            text = f"[테스트 · 원래 수신 {to}]\n{text}"
        to = mine or to
    try:
        import hashlib
        import hmac
        import os
        import time
        # utcnow() 는 3.12 부터 deprecated — 3.14 에서 지워질 수 있어 tz-aware 로 쓴다
        date = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        salt = os.urandom(16).hex()
        sig = hmac.new(cfg["api_secret"].encode(), (date + salt).encode(),
                       hashlib.sha256).hexdigest()
        auth = (f"HMAC-SHA256 apiKey={cfg['api_key']}, date={date}, "
                f"salt={salt}, signature={sig}")
        r = requests.post(
            "https://api.solapi.com/messages/v4/send", timeout=30,
            headers={"Authorization": auth, "Content-Type": "application/json"},
            data=json.dumps({"message": _payload(text, to, cfg)},
                            ensure_ascii=False).encode("utf-8"))
        if r.status_code >= 400:
            print(f"   [알림] 문자 실패 {r.status_code} {r.text[:200]}", file=sys.stderr)
            return False
        return True
    except Exception as e:                          # noqa: BLE001
        print(f"   [알림] 문자 실패: {e}", file=sys.stderr)
        return False


def send_sms_public(body: str, to: str) -> bool:
    """**대외 문자** — 담당자·문의자처럼 회사 밖 사람에게. 인사말이 앞에 붙는다.

    번호가 없으면 보내지 않는다(빈 문자열로 관리자에게 새는 것을 막는다).
    """
    if not (to or "").strip():
        return False
    return send_sms(f"{GREETING}\n\n{body}", to=to)


def send_sms_admin(body: str) -> bool:
    """**내부 보고 문자** — 나에게. 인사말을 붙이지 않는다(나한테 인사할 일이 없다)."""
    return send_sms(body, to=admin_phone())


# ---------------------------------------------------------------- 파이프라인용

class Reporter:
    """런칭 1건의 진행을 보고한다. 알림이 실패해도 작업은 계속된다."""

    def __init__(self, region_kor: str, chapter_kor: str,
                 enabled: bool = True, owner_phone: str = "") -> None:
        self.region = region_kor
        self.chapter = chapter_kor
        self.enabled = enabled
        self.owner_phone = owner_phone
        self.lines: list[str] = []
        self.started = datetime.now()

    @property
    def title(self) -> str:
        return f"{self.region} {self.chapter}"

    def _stamp(self) -> str:
        return f"{datetime.now():%H:%M:%S}"

    def step(self, name: str, detail: str = "") -> None:
        """단계 하나가 끝날 때마다 — 이메일만."""
        line = f"[{self._stamp()}] {name}" + (f" · {detail}" if detail else "")
        self.lines.append(line)
        if not self.enabled:
            return
        send_email(f"[런칭] {self.title} — {name}",
                   f"{self.title} 런칭 진행 중\n\n" + "\n".join(self.lines))

    def start(self) -> None:
        self.lines.append(f"[{self._stamp()}] 시작")
        if not self.enabled:
            return
        send_email(f"[런칭] {self.title} — 시작",
                   f"{self.title} 런칭 자동 처리를 시작합니다.\n"
                   f"시작 {self.started:%Y-%m-%d %H:%M}")
        send_sms(f"[런칭 시작] {self.title}")

    def done(self, ok: bool, summary: str = "") -> None:
        took = (datetime.now() - self.started).total_seconds()
        head = "완료" if ok else "중단"
        self.lines.append(f"[{self._stamp()}] {head}")
        if not self.enabled:
            return
        body = (f"{self.title} 런칭 처리 {head}\n"
                f"소요 {took/60:.1f}분\n\n{summary}\n\n"
                "── 진행 기록 ──\n" + "\n".join(self.lines) +
                ("\n\n▶ 남은 것: 편집기에서 확인 후 **게시**." if ok else ""))
        send_email(f"[런칭] {self.title} — {head}", body)
        send_sms(f"[런칭 {head}] {self.title}" + (f"\n{summary}" if summary else ""))


# ---------------------------------------------------------------- 확인용

def main() -> None:
    ap = argparse.ArgumentParser(description="알림 경로 확인")
    ap.add_argument("--test", action="store_true", help="테스트 이메일 1통 발송")
    ap.add_argument("--sms", action="store_true", help="테스트 문자도 함께")
    a = ap.parse_args()

    url, _ = _relay()
    print(f"릴레이 : {url[:60]}…  (정본 {RELAY_PS1.name})")
    cfg = _solapi_cfg()
    print(f"솔라피 : {'설정됨 → ' + cfg.get('to', '(수신번호 없음)') if cfg else '미설정 (문자 건너뜀)'}")
    print(f"모드   : {'⚠ 테스트 — 모든 문자가 내 번호로 온다 (MYPT_SMS_LIVE=1 로 해제)' if sms_test_mode() else '실발송'}")

    if not a.test:
        print("\n--test 를 붙이면 실제로 1통 보냅니다.")
        return

    ok = send_email("[런칭] 알림 경로 테스트",
                    "MyPowerteam 런칭 자동화의 진행 보고 경로 테스트입니다.\n"
                    f"보낸 시각 {datetime.now():%Y-%m-%d %H:%M:%S}\n"
                    "이 메일이 보이면 단계별 보고가 정상 작동합니다.")
    print(f"이메일 {'발송' if ok else '실패'}")
    if a.sms:
        print(f"문자   {'발송' if send_sms('[런칭] 알림 경로 테스트') else '건너뜀/실패'}")


if __name__ == "__main__":
    main()
