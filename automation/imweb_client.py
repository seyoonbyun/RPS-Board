# -*- coding: utf-8 -*-
"""imweb(rpi-bnikorea.imweb.me) 관리자 API 클라이언트.

2026-07-29 하남/시그니아를 실제로 만들며 확보한 규격을 코드로 굳힌 것.
편집기 DOM 을 클릭하지 않고 `/admin/ajax/*.cm` 를 직접 부르므로 UI 개편에 영향받지 않는다.

세션
    쿠키를 파일로 빼내지 않는다. **Playwright 영구 프로필**에 로그인 상태를 남겨 두고
    `context.request` 로 호출하면 브라우저 쿠키가 그대로 붙는다.
    최초 1회만 사람이 로그인한다 →  python imweb_client.py --login

⚠ 이 API 들은 **실패해도 SUCCESS 를 돌려준다.** 두 번 데였다.
   - `menu_edit.cm` 은 `type=edit` 이 없으면 아무것도 안 바꾸고 SUCCESS (응답에 data 키가 없음)
   - `gallery_add_image.cm` 은 파일 필드명이 `file` 이면 SUCCESS + data:[]  (정답은 `files`)
   그래서 이 모듈의 쓰기 메서드는 **전부 재조회로 검증**하고, 다르면 예외를 던진다.

⚠ 되돌리기 API 가 없다. 쓰기 전에 menu_list 스냅샷을 남길 것(`snapshot()`).
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

from playwright.sync_api import sync_playwright

# Windows 콘솔 기본 코덱이 cp949 라 이모지·일부 기호에서 UnicodeEncodeError 로 죽는다.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

SITE = "https://rpi-bnikorea.imweb.me"
PROFILE_DIR = Path(r"C:\Users\Gram\desktop\connect_tl_report\connect\imweb_profile")
# imweb 로그인 쿠키는 **세션 쿠키**라 브라우저가 비정상 종료되면 프로필에 안 남는다.
# 로그인에 성공하면 여기에 따로 받아 두고, 다음 실행 때 프로필이 비어 있으면 되부어 준다.
STATE_FILE = PROFILE_DIR.parent / "imweb_cookies.json"

# 사이트 상수 (site_get_info 로 확인)
SITE_CODE = "S20240219d9788e91a46a5"
RPI_MENU = "m20240412cd7f015dacea2"      # 지역 페이지들의 부모
CDN = "https://cdn.imweb.me/upload/"


class ImwebError(RuntimeError):
    pass


def php_param(obj: Any, prefix: str = "") -> list[tuple[str, str]]:
    """jQuery `$.param` 과 같은 형태로 납작하게 편다 → `data[slide_data][0][text]`.

    PHP 가 이 형식을 중첩 배열로 되읽는다. 리스트는 인덱스를 키로 쓴다.
    """
    out: list[tuple[str, str]] = []
    if isinstance(obj, dict):
        items = obj.items()
    elif isinstance(obj, list):
        items = ((str(i), v) for i, v in enumerate(obj))
    else:
        return [(prefix, "" if obj is None else str(obj))]

    for k, v in items:
        key = f"{prefix}[{k}]" if prefix else str(k)
        if isinstance(v, (dict, list)):
            out += php_param(v, key)
        elif v is None:
            out.append((key, ""))
        elif isinstance(v, bool):
            out.append((key, "Y" if v else "N"))
        else:
            out.append((key, str(v)))
    return out


class ImwebClient:
    """`with ImwebClient() as im:` 로 쓴다."""

    def __init__(self, profile_dir: Path = PROFILE_DIR, headless: bool = True,
                 site: str = SITE) -> None:
        self.profile_dir = Path(profile_dir)
        self.headless = headless
        self.site = site.rstrip("/")
        self._pw = None
        self._ctx = None

    # ---------- 세션 ----------

    def __enter__(self) -> "ImwebClient":
        self.profile_dir.mkdir(parents=True, exist_ok=True)
        self._pw = sync_playwright().start()
        self._ctx = self._pw.chromium.launch_persistent_context(
            str(self.profile_dir), headless=self.headless,
            viewport={"width": 1440, "height": 900},
        )
        return self

    def __exit__(self, *exc) -> None:
        if self._ctx:
            self._ctx.close()
        if self._pw:
            self._pw.stop()

    @property
    def req(self):
        if not self._ctx:
            raise ImwebError("컨텍스트가 없다 — with 문 안에서 써야 한다")
        return self._ctx.request

    def logged_in(self, restore: bool = True) -> bool:
        """site_get_info 가 menu_list 를 주면 로그인된 것.

        비로그인이면 백업해 둔 쿠키를 한 번 되부어 보고 다시 확인한다
        (imweb 로그인 쿠키가 세션 쿠키라 프로필에 안 남는 경우가 있다).
        """
        if self._alive():
            return True
        if restore and self.restore_cookies():
            return self._alive()
        return False

    def _alive(self) -> bool:
        try:
            return bool(self.site_info().get("menu_list"))
        except Exception:
            return False

    def save_cookies(self, path: Path = STATE_FILE) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(self._ctx.cookies(), ensure_ascii=False), encoding="utf-8")
        return path

    def restore_cookies(self, path: Path = STATE_FILE) -> bool:
        path = Path(path)
        if not path.exists():
            return False
        try:
            self._ctx.add_cookies(json.loads(path.read_text(encoding="utf-8")))
            return True
        except Exception:
            return False

    # ---------- 저수준 호출 ----------

    def _post(self, path: str, data: dict | None = None) -> dict:
        pairs = []
        for k, v in (data or {}).items():
            pairs += php_param(v, k) if isinstance(v, (dict, list)) else [(k, "" if v is None else str(v))]
        body = "&".join(
            f"{_q(k)}={_q(v)}" for k, v in pairs
        )
        r = self.req.post(
            f"{self.site}/admin/ajax/{path}",
            headers={"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"},
            data=body,
        )
        if not r.ok:
            raise ImwebError(f"{path} HTTP {r.status}")
        try:
            return r.json()
        except Exception:
            raise ImwebError(f"{path} 응답이 JSON 이 아니다: {r.text()[:200]}")

    def _upload(self, path: str, file: Path, field: str, extra: dict) -> dict:
        """multipart 업로드. `field` 는 엔드포인트마다 다르다(file / files)."""
        file = Path(file)
        mp = {field: {"name": file.name, "mimeType": "image/png",
                      "buffer": file.read_bytes()}}
        mp.update({k: str(v) for k, v in extra.items()})
        r = self.req.post(f"{self.site}/admin/ajax/{path}", multipart=mp)
        if not r.ok:
            raise ImwebError(f"{path} HTTP {r.status}")
        return r.json()

    # ---------- 읽기 ----------

    def site_info(self) -> dict:
        return self._post("site_get_info.cm")

    def menu_list(self) -> dict[str, dict]:
        return self.site_info()["menu_list"]

    def menu_version(self) -> str:
        return self.site_info()["unit"]["menu_version"]

    def page_data(self, code: str) -> dict:
        return self._post("get_page_data.cm", {"code": code})["data"]

    def gallery_items(self, board_code: str) -> list[dict]:
        j = self._post("gallery_image_list_get.cm", {"board_code": board_code})
        return [x.get("data", x) for x in (j.get("data") or [])]

    def snapshot(self, out: Path) -> Path:
        """쓰기 전 menu_list 스냅샷. 되돌리기 API 가 없으니 반드시 남긴다."""
        ml = self.menu_list()
        keep = ("code", "name", "url", "type", "pos", "parent_code", "depth",
                "is_hide", "menu_no")
        slim = [{k: m.get(k) for k in keep} for m in ml.values()]
        out = Path(out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(slim, ensure_ascii=False, indent=1), encoding="utf-8")
        return out

    # ---------- 조회 도우미 ----------

    def find_by_name(self, name: str) -> dict | None:
        for m in self.menu_list().values():
            if (m.get("name") or "").strip() == name.strip():
                return m
        return None

    def regions(self) -> list[dict]:
        """상단 RPI 내비게이션에 걸리는 지역 페이지들."""
        return [m for m in self.menu_list().values() if m.get("parent_code") == RPI_MENU]

    def next_chapter_no(self) -> int:
        """챕터 번호는 전국 통합 연속 채번이다 (2026-07-29 기준 1~108 결번 0)."""
        nos = [int(re.match(r"^(\d+)\s", m["name"]).group(1))
               for m in self.menu_list().values()
               if re.match(r"^\d+\s", m.get("name") or "")]
        return max(nos) + 1 if nos else 1

    # ---------- 쓰기 (전부 재조회 검증) ----------

    def copy_page(self, org_code: str, pos: str) -> str:
        """페이지 복제. 새 code 를 돌려준다. pos: 챕터·ALL='foot', 지역='main'."""
        j = self._post("menu_copy.cm", {"org_code": org_code, "name": "", "pos": pos})
        if j.get("msg") != "SUCCESS" or not j.get("data", {}).get("code"):
            raise ImwebError(f"복제 실패: {str(j)[:200]}")
        return j["data"]["code"]

    def edit_page(self, code: str, **fields) -> dict:
        """이름·url·비밀번호 등 수정.

        ⚠ `type=edit` 이 반드시 있어야 한다. 없으면 SUCCESS 를 주면서 무시한다.
        `password` 는 **평문**을 넣으면 서버가 bcrypt 로 해시한다(빈 문자열이면 해제).
        """
        ml = self.menu_list()
        if code not in ml:
            raise ImwebError(f"없는 페이지: {code}")
        data = dict(ml[code])
        data.update(fields)
        j = self._post("menu_edit.cm", {
            "type": "edit", "data": data, "menu_version": self.menu_version(),
        })
        if "data" not in j:
            raise ImwebError("menu_edit 이 무시됐다 — type=edit 확인 (SUCCESS 라도 실패다)")

        after = self.menu_list()[code]
        for k, v in fields.items():
            if k == "password":
                if v and not after.get("password"):
                    raise ImwebError("비밀번호가 설정되지 않았다")
            elif str(after.get(k)) != str(v):
                raise ImwebError(f"반영 안 됨: {k} = {after.get(k)!r} (기대 {v!r})")
        return after

    def upload_image(self, file: Path, target: str, target_code: str) -> dict:
        """이미지 업로드 → 파일 레코드.

        target: 섹션 텍스트 속 이미지 `section` / 이미지 위젯 `image_widget` / 갤러리 `widget`
        업로드 파일명을 `bnikorea.co_RPI_<이름>.png` 로 주면 org_name 이 기존 관행과 같아진다.
        """
        j = self._upload("upload_image.cm", file, "file", {
            "param_name": "file", "target": target, "target_code": target_code,
        })
        files = j.get("file") or []
        if not files:
            raise ImwebError(f"업로드 실패: {str(j)[:200]}")
        return files[0]

    def save_section(self, menu_code: str, section_code: str, data: dict) -> None:
        j = self._post("section_save.cm", {
            "menu_code": menu_code, "code": section_code, "data": data,
        })
        if j.get("msg") != "SUCCESS":
            raise ImwebError(f"섹션 저장 실패: {str(j)[:200]}")

    def save_widget(self, record: dict) -> None:
        """⚠ 경로에 `widget/` 이 붙는다 — 다른 API 와 다르다."""
        pairs = php_param(record)
        body = "&".join(f"{_q(k)}={_q(v)}" for k, v in pairs)
        r = self.req.post(
            f"{self.site}/admin/ajax/widget/widget_save.cm",
            headers={"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"},
            data=body)
        if not r.ok or r.json().get("msg") != "SUCCESS":
            raise ImwebError(f"위젯 저장 실패: {r.text()[:200]}")

    def gallery_add(self, board_code: str, file: Path) -> dict:
        """카드 추가. ⚠ 파일 필드명은 `file` 이 아니라 **`files`** (틀리면 SUCCESS+빈배열)."""
        before = {i["code"] for i in self.gallery_items(board_code)}
        self._upload("gallery_add_image.cm", file, "files", {"board_code": board_code})
        after = self.gallery_items(board_code)
        new = [i for i in after if i["code"] not in before]
        if not new:
            raise ImwebError("카드가 추가되지 않았다 — 파일 필드명이 files 인지 확인")
        return new[0]

    def gallery_update(self, item: dict, **fields) -> dict:
        rec = dict(item)
        rec.update(fields)
        j = self._post("gallery_image_update.cm", rec)
        if j.get("msg") != "SUCCESS":
            raise ImwebError(f"카드 수정 실패: {str(j)[:200]}")
        now = [i for i in self.gallery_items(rec["board_code"]) if i["code"] == rec["code"]]
        if not now:
            raise ImwebError("수정한 카드를 다시 찾지 못했다")
        for k, v in fields.items():
            if str(now[0].get(k)) != str(v):
                raise ImwebError(f"카드 반영 안 됨: {k} = {now[0].get(k)!r}")
        return now[0]

    # ---------- 페이지 구조 도우미 ----------

    def visual_section(self, page_code: str) -> tuple[str, dict]:
        """챕터·ALL 페이지의 본문은 비주얼 섹션 1개가 전부다."""
        secs = self.page_data(page_code)["section"]
        for code, sec in secs.items():
            if sec.get("category") == "visual":
                return code, sec
        raise ImwebError(f"비주얼 섹션이 없다: {page_code}")

    def set_chapter_content(self, page_code: str, qr_png: Path, sheet_url: str) -> None:
        """챕터·ALL 페이지에서 바뀌는 건 QR 이미지와 시트 링크 **둘뿐**이다.

        둘 다 `slide_data[0].text` 안의 HTML 에 들어 있다.
        (`data.widget` 의 image 위젯들은 페이지에 안 쓰이는 잔재다 — 건드리지 않는다.)
        """
        sec_code, sec = self.visual_section(page_code)
        data = json.loads(json.dumps(sec["data"]))     # 깊은 복사
        slide = data["slide_data"][0]
        text: str = slide["text"]

        imgs = re.findall(r"[a-f0-9]{13}\.png", text)
        if len(imgs) < 2:
            raise ImwebError(f"이미지가 2개가 아니다({len(imgs)}) — 템플릿 구조가 바뀌었나")
        old_qr = imgs[-1]        # 첫째는 CHECK MY CHAPTER RPI(공통), 둘째가 QR

        up = self.upload_image(qr_png, "section", sec_code)
        text = text.replace(old_qr, up["name"])

        text, n = re.subn(r'(href="https://docs\.google\.com/spreadsheets/d/)[^"/]+',
                          lambda m: m.group(1) + _sheet_id(sheet_url), text, count=1)
        if n != 1:
            raise ImwebError("시트 링크를 찾지 못했다")

        slide["text"] = text
        self.save_section(page_code, sec_code, data)

        after = self.visual_section(page_code)[1]["data"]["slide_data"][0]["text"]
        if up["name"] not in after or _sheet_id(sheet_url) not in after:
            raise ImwebError("QR·링크가 반영되지 않았다")
        if old_qr in after:
            raise ImwebError("옛 QR 이 남아 있다")

    def set_region_logos(self, region_page: str, logo_png: Path,
                         all_page_code: str, kor: str) -> None:
        """지역 페이지의 BNI 로고 이미지 2개를 교체하고 ALL 페이지로 링크한다.

        실제 연결은 `link` 문자열이 아니라 **`link_code`** 다.
        """
        widgets = self.page_data(region_page)["widget"]
        images = [(c, w) for c, w in widgets.items() if w.get("type") == "image"]
        if not images:
            raise ImwebError("이미지 위젯이 없다")

        for code, w in images:
            up = self.upload_image(logo_png, "image_widget", code)
            rec = json.loads(json.dumps(w))
            d = rec["data"]
            d["url"] = f"{SITE_CODE}/{up['name']}"
            d["name"] = up["name"]
            d["code"] = up["code"]
            d["link_code"] = all_page_code
            d["use_link_code"] = "Y"
            # link 문자열은 표시용이라 운영 관행이 제각각이다(`/x ALL`, `https://x ALL`).
            # 원본 형식을 유지한 채 지역명만 바꾼다.
            d["link"] = re.sub(r"[가-힣]+(?=\s*ALL)", kor, d.get("link") or f"/{kor} ALL")
            self.save_widget(rec)

        after = self.page_data(region_page)["widget"]
        for code, _ in images:
            if after[code]["data"].get("link_code") != all_page_code:
                raise ImwebError(f"로고 링크가 반영되지 않았다: {code}")

    def gallery_board(self, region_page: str) -> str:
        for w in self.page_data(region_page)["widget"].values():
            if w.get("type") == "gallery2":
                return w["data"]["board_code"]
        raise ImwebError("갤러리 위젯이 없다")

    def add_chapter_card(self, region_page: str, card_png: Path,
                         chapter_page_code: str, chapter_page_name: str) -> dict:
        board = self.gallery_board(region_page)
        item = self.gallery_add(board, card_png)
        return self.gallery_update(
            item, link=f"/{chapter_page_name}", link_code=chapter_page_code,
            use_link_code="Y", link_type="default", new_window="Y")


def _q(s: str) -> str:
    from urllib.parse import quote
    return quote(str(s), safe="")


def _sheet_id(url: str) -> str:
    m = re.search(r"/spreadsheets/d/([^/?#]+)", url)
    if not m:
        raise ImwebError(f"시트 ID 를 못 읽었다: {url}")
    return m.group(1)


# ---------------------------------------------------------------- 자동 로그인

#: 자격증명 파일 — `cred_dir()` 안. `{"id": "...", "pw": "..."}`
#: ⚠ **사람이 직접 채운다.** 저장소에도, 대화에도 값이 남지 않는다.
#:   같은 폴더의 `solapi.json`·`BNI Connect_login ID PW.txt` 와 같은 방식이다.
LOGIN_CFG = "imweb_login.json"

#: 실패한 뒤 다시 시도하기까지 쉬는 시간(초). 비밀번호가 틀린 채로 3분마다 두드리면
#: **계정이 잠긴다.** 한 번 실패하면 한 시간 쉬고, 그동안은 사람에게 맡긴다.
LOGIN_COOLDOWN = 3600


def _login_cfg() -> dict | None:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import paths
    f = paths.cred_dir() / LOGIN_CFG
    if not f.exists():
        return None
    try:
        d = json.loads(f.read_text(encoding="utf-8"))
    except Exception:                                        # noqa: BLE001
        return None
    return d if d.get("id") and d.get("pw") else None


def _cooldown_file() -> Path:
    return PROFILE_DIR.parent / "imweb_login_cooldown.txt"


def _in_cooldown() -> int:
    """남은 쿨다운 초. 0 이면 시도해도 된다."""
    f = _cooldown_file()
    if not f.exists():
        return 0
    try:
        import time
        left = int(float(f.read_text(encoding="utf-8").strip()) + LOGIN_COOLDOWN - time.time())
    except Exception:                                        # noqa: BLE001
        return 0
    return max(0, left)


def auto_login(im: "ImwebClient") -> bool:
    """자격증명 파일로 로그인한다. 성공하면 쿠키까지 받아 둔다.

    ⛔ **캡차·2단계 인증이 뜨면 시도하지 않고 멈춘다.** 그건 사람이 하라고 있는 것이다.
    ⚠ 비밀번호는 어디에도 찍지 않는다(로그·예외 메시지 포함).
    """
    import time

    cfg = _login_cfg()
    if not cfg:
        print(f"   [로그인] 자격증명 파일이 없다: {LOGIN_CFG}", file=sys.stderr)
        return False
    left = _in_cooldown()
    if left:
        print(f"   [로그인] 직전 실패로 쉬는 중 — {left // 60}분 뒤 재시도", file=sys.stderr)
        return False

    try:
        page = im._ctx.pages[0] if im._ctx.pages else im._ctx.new_page()
        page.goto(f"{SITE}/admin", wait_until="networkidle", timeout=60000)
        if page.locator("#txt_email").count() == 0:
            # 폼이 없다 = 이미 로그인됐거나 화면이 바뀌었다
            return im.logged_in(restore=False)
        html = page.content()
        if re.search(r"recaptcha|hcaptcha|captcha", html, re.I):
            print("   [로그인] 캡차가 떴다 — 자동 로그인을 하지 않는다. 사람이 로그인할 것.",
                  file=sys.stderr)
            return False
        page.fill("#txt_email", cfg["id"])
        page.fill("#txt_pass", cfg["pw"])
        page.click("#login-form button[type=submit]")
        page.wait_for_load_state("networkidle", timeout=60000)
        for _ in range(10):
            if im.logged_in(restore=False):
                im.save_cookies()
                print("   [로그인] 자동 로그인 성공 · 쿠키 저장")
                _cooldown_file().unlink(missing_ok=True)
                return True
            time.sleep(2)
        _cooldown_file().write_text(str(time.time()), encoding="utf-8")
        print("   [로그인] 자동 로그인 실패 — 아이디·비밀번호를 확인하세요 "
              f"({LOGIN_COOLDOWN // 60}분간 재시도하지 않는다)", file=sys.stderr)
        return False
    except Exception as e:                                   # noqa: BLE001
        # ⚠ 예외 메시지에 입력값이 섞일 수 있어 **클래스 이름만** 남긴다.
        import time
        _cooldown_file().write_text(str(time.time()), encoding="utf-8")
        print(f"   [로그인] 자동 로그인 오류: {e.__class__.__name__}", file=sys.stderr)
        return False


def ensure_login(im: "ImwebClient") -> bool:
    """로그인돼 있으면 True. 아니면 **한 번** 자동 로그인을 시도한다."""
    if im.logged_in():
        return True
    return auto_login(im)


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="imweb 관리자 API 클라이언트")
    ap.add_argument("--login", action="store_true",
                    help="창을 띄워 사람이 직접 로그인 (최초 1회)")
    ap.add_argument("--check", action="store_true", help="로그인 상태·현황 확인")
    ap.add_argument("--auto-login", action="store_true",
                    help=f"자격증명 파일({LOGIN_CFG})로 로그인 (창 없이)")
    a = ap.parse_args()

    if a.login:
        # 대화형 input 을 쓰지 않는다 — 자동 실행 환경에서는 stdin 이 없어 그대로 죽는다.
        # 창을 띄워 두고 로그인될 때까지 폴링하다가, 되는 순간 알아서 닫는다.
        import time

        print("브라우저 창이 열립니다. imweb 에 로그인하세요. (최대 5분 대기)")
        with ImwebClient(headless=False) as im:
            page = im._ctx.pages[0] if im._ctx.pages else im._ctx.new_page()
            page.goto(f"{SITE}/admin", wait_until="domcontentloaded")
            deadline = time.time() + 300
            while time.time() < deadline:
                if im.logged_in(restore=False):
                    ml = im.menu_list()
                    # 세션 쿠키가 프로필에 안 남는 경우가 있어 **즉시** 따로 받아 둔다.
                    saved = im.save_cookies()
                    print(f"\n[OK] 로그인 완료 — 페이지 {len(ml)}개가 보입니다.")
                    print(f"     쿠키 백업 {saved}")
                    print("     창을 닫습니다. 이제 pipeline.py 가 이 세션을 씁니다.")
                    break
                time.sleep(3)
            else:
                print("\n[FAIL] 5분 안에 로그인되지 않았습니다. 다시 실행해 주세요.")
    elif a.auto_login:
        with ImwebClient(headless=True) as im:
            if im.logged_in():
                print("[OK] 이미 로그인돼 있습니다.")
            elif auto_login(im):
                print(f"[OK] 페이지 {len(im.menu_list())}개가 보입니다.")
            else:
                raise SystemExit("[FAIL] 자동 로그인 실패 — python imweb_client.py --login")
    elif a.check:
        with ImwebClient() as im:
            if not im.logged_in():
                raise SystemExit("로그인 안 됨 —  python imweb_client.py --login")
            ml = im.menu_list()
            print(f"페이지 {len(ml)}개 · 지역 {len(im.regions())}개 · 다음 챕터 번호 {im.next_chapter_no()}")
    else:
        ap.print_help()
