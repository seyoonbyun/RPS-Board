# -*- coding: utf-8 -*-
r"""게시판 문의 **자동 진단 → 안전한 조치 → 답변 게시 → 보고** (board_watch 가 새 문의마다 부른다).

    python board_triage.py --post 23               # 게시판 #23 을 진단만 (아무것도 쓰지 않는다)
    python board_triage.py --post 23 --apply       # 진단 + 조치 + 답변 게시 + 나에게 보고
    python board_triage.py --text "..." --email a@b.c   # 임의 문장으로 진단 연습 (쓰지 않음)

왜 만들었나 (2026-11-09 RPS-02·RPS-03)
    서초 매니저의 「Viewer 에 안 보인다」 문의를 **내 쪽 데이터만 세 번 대조**하고 「지연이겠지」로 답했다.
    실제론 매니저가 **2025년 옛 시트**를 보고 있었고, 그 파일을 내 손으로 찾아 놓고도 버렸다.
    사용자: 「이런걸 왜 유저가 여러번 문의를 해야만 알수있는거야????」
    → 사람이 빠뜨린 순서를 코드가 매번 밟게 한다:
      ① 문의에 적힌 **이름 하나하나**를 모 시트·탈퇴 이력에서 찾아 상태를 확정한다
      ② 문의자가 볼 수 있는 **화면 후보 전부**(정식 `_rps` 시트 + 같은 이름의 옛 시트)를 열어
         문의자가 말한 증상(「그대로 보인다」「없다」)과 **맞는 화면**을 찾는다
      ③ 요청이 분명하고 되돌릴 수 있는 것만 고친다(탈퇴 처리 = 탈퇴 이력 보관·복원 가능).
         이메일 없이 못 하는 것(멤버 추가)은 하지 않고 방법을 안내한다
      ④ 답변을 게시판에 올린다 → board_watch 가 문의자 문자 + 검수 사본(나) 을 보낸다
      ⑤ 나에게 진단 근거를 문자(요약)·이메일(전문)로 보낸다

어디서든 돈다
    진단은 웹앱 **어드민 API**(`/api/admin/users`·`withdrawal-history`·`list-admins`)와
    시트의 **익명 CSV 내보내기**만 쓴다 — 구글 자격증명이 없는 PC(SEYOON)에서도 된다.
    자격증명이 있으면(JOY) 두 가지를 더 한다: 드라이브에서 같은 이름의 옛 시트 검색,
    정식 시트 깨우기(`rps_sheet_touch`). 정식 시트 ID 는 `rps_sheet_touch` 가 20분마다
    써 두는 `rps_sheets_index.json` 에서 읽는다(없으면 드라이브 검색, 그것도 없으면 링크 없이 보고만).

하지 않는 것 (일부러)
    - 문의에 없는 멤버를 건드리지 않는다. 오늘 낮 「서버에 삭제가 안 닿았다」는 내 이론으로
      요청받지 않은 3명을 탈퇴 처리했다가 「박은정 대표님은 활동중이신 멤버입니다!」를 들었다.
    - 동명이인은 처리하지 않고 이메일을 묻는다(활동중 멤버 중 같은 이름 266건).
    - 원인을 못 찾으면 답변을 **지어내지 않는다**. 나에게 올리고 끝낸다.
"""
from __future__ import annotations

import argparse
import csv
import dataclasses
import datetime as dt
import io
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

BASE = "https://www.rps-bnikorea.com"
CALLER = "joy.byun@bnikorea.com"
FOLDER_ID = "1XqC-OdatL9Dxi9fJ9a3IKr_I4NKvozGf"     # RPS_Sheets (정식 _rps 시트 폴더)
INDEX_NAME = "rps_sheets_index.json"                # rps_sheet_touch 가 쓴다
UA = {"User-Agent": "Mozilla/5.0"}

# ---------------------------------------------------------------- 분류 어휘
KW_DEL = re.compile(r"탈퇴|삭제|제외|퇴회|빼|지우|제명")
KW_ADD = re.compile(r"추가|신규|입회|등록|넣|개방")
KW_VIEW = re.compile(r"viewer|뷰어|rpi|시트|화면|링크|명단|리스트|목록", re.I)
KW_STALE = re.compile(r"업데이트|반영|그대로|안\s*되|안\s*돼|않|없|변경|바뀌|새로고침|갱신")
KW_LOGIN = re.compile(r"로그인|비밀번호|비번|접속|패스워드|암호")
HANGUL_NAME = re.compile(r"[가-힣]{2,4}")

# ---------------------------------------------------------------- 자료 구조


@dataclasses.dataclass
class NameStatus:
    name: str
    want: str                    # "del" | "add" | "?"
    active: list[dict]           # 모 시트 활동중 행들 (동명이인이면 여럿)
    withdrawn: list[dict]        # 탈퇴 이력 행들

    @property
    def state(self) -> str:
        if len(self.active) == 1:
            return "활동중"
        if len(self.active) > 1:
            return "동명이인"
        if self.withdrawn:
            return "탈퇴"
        return "없음"


@dataclasses.dataclass
class SheetView:
    sid: str
    title: str                   # 드라이브 파일명 (모르면 '')
    kor: str                     # A2 (예: 메디컬)
    rpi: str                     # D2
    names: list[str]
    official: bool
    error: str = ""

    @property
    def url(self) -> str:
        return f"https://docs.google.com/spreadsheets/d/{self.sid}"


@dataclasses.dataclass
class Diagnosis:
    post: dict
    tags: set[str]
    region: str                          # 문의자 지역 (list-admins)
    is_admin: bool
    chapters: list[str]                  # 확정한 챕터(Eng)
    names: list[NameStatus]
    official: dict[str, SheetView]       # chapter → 정식 시트
    old_matches: list[SheetView]         # 증상과 맞는 옛 시트
    old_others: list[SheetView]          # 찾았지만 증상과 안 맞는 옛 시트
    causes: list[str]
    actions_done: list[str]
    answer: str
    confidence: str                      # high | low | none
    notes: list[str]

    @property
    def auto_post(self) -> bool:
        return self.confidence == "high" and bool(self.answer)


# ---------------------------------------------------------------- 외부 자료 (전부 바꿔 끼울 수 있다 → 테스트)

def api_get(path: str) -> object:
    req = urllib.request.Request(f"{BASE}/api/admin/{path}", headers={"x-caller-email": CALLER})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def api_post(path: str, body: dict) -> tuple[int, str]:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(f"{BASE}/api/admin/{path}", data=data, method="POST",
                                 headers={"x-caller-email": CALLER, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def parse_sheet_csv(text: str) -> tuple[str, str, list[str]]:
    """챕터 시트 CSV → (A2 한글명, D2 RPI, 멤버명 목록). 정식·옛 시트 모두 같은 틀이다."""
    rows = [r for r in csv.reader(io.StringIO(text)) if any(c.strip() for c in r)]
    if not rows:
        return "", "", []
    head = rows[0]
    try:
        c_name = next(i for i, h in enumerate(head) if "멤버명" in h or "이름" in h)
    except StopIteration:
        c_name = 2
    kor, rpi, names, started = "", "", [], False
    for r in rows[1:]:
        r = r + [""] * (max(c_name, 3) + 1 - len(r))
        if "리퍼럴 파트너 지수" in r[1]:
            kor, rpi, started = r[0].strip(), r[3].strip(), True
            continue
        n = r[c_name].strip()
        if n and (started or len(rows) > 2):
            names.append(n.replace(" ", ""))
    return kor, rpi, names


def fetch_sheet(sid: str, title: str = "", official: bool = False) -> SheetView:
    """익명 CSV 내보내기 — 문의자가 링크로 보는 것과 같은 권한으로 본다."""
    url = f"https://docs.google.com/spreadsheets/d/{sid}/export?format=csv"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
            body = r.read().decode("utf-8-sig", "replace")
        if "<html" in body[:200].lower():
            return SheetView(sid, title, "", "", [], official, error="익명 열람 불가(로그인 필요)")
        kor, rpi, names = parse_sheet_csv(body)
        return SheetView(sid, title, kor, rpi, names, official)
    except Exception as e:                                        # noqa: BLE001
        return SheetView(sid, title, "", "", [], official, error=str(e)[:120])


def load_index() -> dict:
    """`rps_sheets_index.json` — {"sheets": {"Medical_rps": {"id", "kor", "rpi"}}, "old_sheets": {...}}."""
    for p in _index_candidates():
        if p.exists():
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except Exception:                                      # noqa: BLE001
                pass
    return {}


def _index_candidates() -> list[Path]:
    import os
    out = [HERE / INDEX_NAME]
    if os.environ.get("RPS_SHEETS_INDEX"):
        out.insert(0, Path(os.environ["RPS_SHEETS_INDEX"]))
    try:
        import paths
        out.insert(0, paths.snap_dir() / INDEX_NAME)
    except Exception:                                              # noqa: BLE001
        pass
    return out


def google_creds():
    """소유계정 OAuth. 자격증명 폴더가 없는 PC 면 None — 진단은 그대로 진행한다."""
    try:
        from google_auth import user_credentials
        return user_credentials()
    except Exception:                                              # noqa: BLE001
        return None


def drive_find_old_sheets(creds, eng: str, kor: str) -> list[tuple[str, str]]:
    """드라이브에서 챕터 이름(영·한)과 같은 이름의 스프레드시트 중 **정식 폴더 밖** 파일 → [(id, name)]."""
    if creds is None:
        return []
    try:
        from googleapiclient.discovery import build
        drive = build("drive", "v3", credentials=creds, cache_discovery=False)
        names = [n for n in {eng, kor, f"{eng} ", f"{kor} "} if n and n.strip()]
        q_names = " or ".join(f"name = '{n.replace(chr(39), chr(92) + chr(39))}'" for n in names)
        q = (f"mimeType='application/vnd.google-apps.spreadsheet' and trashed=false and ({q_names})")
        r = drive.files().list(q=q, fields="files(id,name,parents,createdTime)", pageSize=50,
                               supportsAllDrives=True, includeItemsFromAllDrives=True).execute()
        out = []
        for f in r.get("files", []):
            if FOLDER_ID in (f.get("parents") or []):
                continue
            if f["name"].strip().lower().endswith("_rps"):
                continue
            out.append((f["id"], f["name"]))
        return out
    except Exception as e:                                         # noqa: BLE001
        print(f"   [triage] 드라이브 검색 실패: {str(e)[:120]}", file=sys.stderr)
        return []


# ---------------------------------------------------------------- 문장 해석

def classify(text: str) -> set[str]:
    t = text or ""
    tags = set()
    if KW_DEL.search(t):
        tags.add("del")
    if KW_ADD.search(t):
        tags.add("add")
    if KW_VIEW.search(t) and KW_STALE.search(t):
        tags.add("view")
    if KW_LOGIN.search(t):
        tags.add("login")
    return tags


def _norm(s: str) -> str:
    return re.sub(r"\s+", "", s or "")


def extract_names(text: str, known: set[str]) -> list[tuple[str, str]]:
    """문장 속 한글 2~4자 토큰 중 **실제 멤버명과 같은 것**만, 등장 순서대로 → [(이름, want)].

    want 는 그 이름에 가장 가까운 앞쪽 어휘(탈퇴/추가)로 정하고, 앞에 없으면 뒤쪽 어휘로 정한다.
      #23 「[탈퇴멤버] 최상봉, 오춘택 … 삭제한명단입니다」 → 앞의 '탈퇴' → del
      #24 「오지인 임강수 … (메디컬 챕터 추가명단인데) 명단추가가되지않았습니다」 → 앞에 없음, 뒤의 '추가' → add
    """
    t = text or ""
    marks = [(m.start(), "del") for m in KW_DEL.finditer(t)] + [(m.start(), "add") for m in KW_ADD.finditer(t)]
    marks.sort()
    out, seen = [], set()
    for m in HANGUL_NAME.finditer(t):
        n = m.group(0)
        if n not in known or n in seen:
            continue
        seen.add(n)
        before = [w for pos, w in marks if pos < m.start()]
        after = [w for pos, w in marks if pos > m.end()]
        want = before[-1] if before else (after[0] if after else "?")
        out.append((n, want))
    return out


# ---------------------------------------------------------------- 진단 본체

class Context:
    """진단에 필요한 자료를 한 번만 읽어 둔다. 테스트에서는 생성자에 바로 넣는다."""

    def __init__(self, *, users=None, withdrawals=None, admins=None, index=None,
                 sheet_fetcher=fetch_sheet, creds="auto", drive_finder=None):
        self.users = users if users is not None else api_get("users")
        self.withdrawals = withdrawals if withdrawals is not None else api_get("withdrawal-history")
        self.admins = admins if admins is not None else api_get("list-admins")
        self.index = index if index is not None else load_index()
        self.fetch = sheet_fetcher
        self.creds = google_creds() if creds == "auto" else creds
        self.drive_finder = drive_finder or (lambda eng, kor: drive_find_old_sheets(self.creds, eng, kor))
        self.active = [u for u in self.users if (u.get("status") or "").strip() != "탈퇴"]
        self.by_name: dict[str, list[dict]] = {}
        for u in self.active:
            self.by_name.setdefault(_norm(u.get("memberName")), []).append(u)
        self.wd_by_name: dict[str, list[dict]] = {}
        for w in self.withdrawals:
            self.wd_by_name.setdefault(_norm(w.get("memberName")), []).append(w)
        self.known = set(self.by_name) | set(self.wd_by_name)
        self.chapters = sorted({(u.get("chapter") or "").strip() for u in self.users if u.get("chapter")})
        self.kor2eng = {}
        for name, meta in (self.index.get("sheets") or {}).items():
            if name.endswith("_rps") and meta.get("kor"):
                self.kor2eng[_norm(meta["kor"])] = name[:-4]

    def admin_of(self, email: str) -> dict | None:
        e = (email or "").strip().lower()
        return next((a for a in self.admins if (a.get("email") or "").strip().lower() == e), None)

    def region_chapters(self, region: str) -> set[str]:
        return {(u.get("chapter") or "").strip() for u in self.users if (u.get("region") or "").strip() == region}

    def official_id(self, chapter: str) -> tuple[str, str]:
        meta = (self.index.get("sheets") or {}).get(f"{chapter}_rps") or {}
        return meta.get("id", ""), meta.get("kor", "")


def resolve_chapters(text: str, names: list[NameStatus], ctx: Context, region: str) -> list[str]:
    """문장에 적힌 챕터(영문 그대로 / 한글명은 색인으로) + 이름들이 속한 챕터. 우선순위는 이름 쪽."""
    found: dict[str, int] = {}
    t = _norm(text).lower()
    for ns in names:
        for u in ns.active:
            found[(u.get("chapter") or "").strip()] = found.get((u.get("chapter") or "").strip(), 0) + 3
        for w in ns.withdrawn:
            found[(w.get("chapter") or "").strip()] = found.get((w.get("chapter") or "").strip(), 0) + 2
    for ch in ctx.chapters:
        if len(ch) >= 3 and ch.lower() in t:
            found[ch] = found.get(ch, 0) + 2
    for kor, eng in ctx.kor2eng.items():
        if len(kor) >= 2 and kor in t:
            found[eng] = found.get(eng, 0) + 2
    found.pop("", None)
    # 문의자 지역 밖 챕터는 동명이인 잡음일 가능성이 커서 뒤로 민다
    mine = ctx.region_chapters(region) if region else set()
    ranked = sorted(found.items(), key=lambda kv: (-(kv[1] + (1 if kv[0] in mine else 0)), kv[0]))
    top = [c for c, s in ranked if s >= 2]
    return top[:3]


def _fmt_names(ns: list[NameStatus]) -> str:
    return "·".join(n.name for n in ns)


def _wd_date(ns: NameStatus) -> str:
    """탈퇴 이력 시각 `2026. 04. 14. 오후 6:46:39` → `4월 14일`."""
    raw = (ns.withdrawn[-1].get("withdrawalTime") or "") if ns.withdrawn else ""
    m = re.search(r"(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})", raw)
    if not m:
        return ""
    y, mo, d = (int(x) for x in m.groups())
    return f"{mo}월 {d}일" if y == dt.date.today().year else f"{y}년 {mo}월 {d}일"


def diagnose(post: dict, ctx: Context) -> Diagnosis:
    text = post.get("content") or ""
    tags = classify(text)
    adm = ctx.admin_of(post.get("email", ""))
    region = (adm or {}).get("region", "")
    is_admin = bool(adm)
    notes: list[str] = []

    names = []
    for n, want in extract_names(text, ctx.known):
        names.append(NameStatus(n, want, ctx.by_name.get(n, []), ctx.wd_by_name.get(n, [])))
    # 문의자 지역이 있으면 동명이인을 그 지역으로 좁힌다.
    #   서초 매니저의 「이승희 탈퇴」 = 서초 메디컬 탈퇴자(04-14)이지 강남 Goood 의 활동중 이승희가 아니다.
    #   지역 안에 기록(활동중이든 탈퇴든)이 하나라도 있으면 지역 밖 기록은 버린다.
    if region and not region.startswith("National"):
        for ns in names:
            in_act = [u for u in ns.active if (u.get("region") or "").strip() == region]
            in_wd = [w for w in ns.withdrawn if (w.get("region") or "").strip() == region]
            if in_act:
                ns.active = in_act
            elif in_wd:
                if ns.active:
                    notes.append(f"{ns.name}: 타지역 활동중 동명이인 {len(ns.active)}명은 제외(문의자 지역 탈퇴 기록 우선)")
                ns.active = []
            if in_wd:
                ns.withdrawn = in_wd

    chapters = resolve_chapters(text, names, ctx, region)
    if not chapters and names:
        notes.append("이름은 찾았지만 챕터를 확정하지 못했다")

    # ① 정식 시트
    official: dict[str, SheetView] = {}
    for ch in chapters:
        sid, kor = ctx.official_id(ch)
        if not sid and ctx.creds is not None:
            try:
                from googleapiclient.discovery import build
                drive = build("drive", "v3", credentials=ctx.creds, cache_discovery=False)
                r = drive.files().list(q=f"name='{ch}_rps' and '{FOLDER_ID}' in parents and trashed=false",
                                       fields="files(id,name)", pageSize=2).execute()
                if r.get("files"):
                    sid = r["files"][0]["id"]
            except Exception as e:                                 # noqa: BLE001
                notes.append(f"정식 시트 검색 실패 {ch}: {str(e)[:80]}")
        if sid:
            v = ctx.fetch(sid, f"{ch}_rps", True)
            official[ch] = v
            if v.error:
                notes.append(f"정식 시트 {ch}_rps 읽기 실패: {v.error}")
        else:
            notes.append(f"정식 시트 ID 를 모른다: {ch}_rps (색인 없음 — JOY 에서 rps_sheet_touch 가 만든다)")

    # ② 옛 시트 후보 — 문의자가 말한 증상과 맞는 화면을 찾는다
    del_gone = [n for n in names if n.want == "del" and n.state in ("탈퇴", "없음")]
    add_present = [n for n in names if n.want == "add" and n.state == "활동중"]
    old_matches, old_others = [], []
    for ch in chapters:
        kor = official.get(ch).kor if ch in official else ctx.official_id(ch)[1]
        cands = list(ctx.drive_finder(ch, kor))
        for sid, meta in ((ctx.index.get("old_sheets") or {}).items()):
            if (meta.get("chapter") or "") == ch and sid not in {c[0] for c in cands}:
                cands.append((sid, meta.get("name", "")))
        for sid, name in cands:
            if ch in official and sid == official[ch].sid:
                continue
            v = ctx.fetch(sid, name, False)
            if v.error:
                old_others.append(v)
                continue
            shows_deleted = [n for n in del_gone if _norm(n.name) in set(v.names)]
            lacks_added = [n for n in add_present if _norm(n.name) not in set(v.names)]
            if (del_gone or add_present) and (len(shows_deleted) == len(del_gone)) and (len(lacks_added) == len(add_present)):
                old_matches.append(v)
            else:
                old_others.append(v)

    # ③ 원인·조치·답변
    causes: list[str] = []
    lines: list[str] = []
    link_ch = chapters[0] if chapters else ""
    off = official.get(link_ch)
    off_kor = (off.kor if off and off.kor else (ctx.official_id(link_ch)[1] or link_ch)) if link_ch else ""

    def _old_year(v: SheetView) -> str:
        meta = (ctx.index.get("old_sheets") or {}).get(v.sid) or {}
        m = re.match(r"(\d{4})", meta.get("created") or "")
        return f"{m.group(1)}년에 만든 " if m else "예전에 만든 "

    if old_matches:
        causes.append("OLD_SHEET")
        v = old_matches[0]
        bits = []
        if del_gone:
            bits.append(f"탈퇴한 {_fmt_names(del_gone)} 님이 그대로 보이")
        if add_present:
            bits.append(f"추가하신 {_fmt_names(add_present)} 님이 없")
        tail = "고 ".join(bits) + "습니다." if bits else "습니다."
        tail = tail.replace("보이습니다", "보입니다").replace("없습니다.", "없습니다.")
        lines.append(f"보고 계신 화면은 {_old_year(v)}옛 {v.kor or off_kor} 시트(제목 '{v.title or v.kor}', "
                     f"리퍼럴 파트너 지수 {v.rpi or '-'})입니다. 이 시트는 갱신이 멈춰 있어 {tail}")
    # 탈퇴자는 같은 날짜끼리 묶어 한 문장으로
    by_date: dict[str, list[NameStatus]] = {}
    for ns in del_gone:
        if ns.state == "탈퇴":
            by_date.setdefault(_wd_date(ns), []).append(ns)
    for when, group in by_date.items():
        who = (f"위 {len(group)}명" if old_matches and len(by_date) == 1 and len(group) == len(del_gone)
               else f"{_fmt_names(group)} 님")
        lines.append(f"{who}은 {when + '에 ' if when else ''}탈퇴 처리되어 현재 명단에 없습니다.")
    if add_present:
        lines.append(f"{_fmt_names(add_present)} 님은 현재 명단에 등록되어 있습니다.")

    # 이름 없이 「화면에 안 보인다」만 적은 문의 — 원인을 짚지 않고 **어느 화면을 봐야 하는지**와
    # 같은 이름의 옛 시트가 있다는 사실만 말한다. 2026-11-09 14:24 에 이렇게 답했어야 했다.
    if not names and chapters and "view" in tags:
        causes.append("VIEW_GENERIC")
        olds = [v for v in old_others if not v.error and v.kor]
        if olds:
            v = olds[0]
            lines.append(f"{off_kor} 챕터는 같은 이름의 옛 시트(제목 '{v.title or v.kor}', 리퍼럴 파트너 지수 {v.rpi or '-'})가 "
                         "따로 있습니다. 보고 계신 화면의 제목이 아래 링크의 제목과 다르면 옛 시트입니다.")
        lines.append("삭제·추가하신 멤버 이름을 게시판에 남겨 주시면 한 분씩 확인해 드리겠습니다.")

    # 삭제 요청인데 아직 활동중 → 되돌릴 수 있는 처리만 자동
    del_active = [n for n in names if n.want == "del" and n.state == "활동중"]
    del_ambig = [n for n in names if n.want == "del" and n.state == "동명이인"]
    todo_withdraw = []
    for ns in del_active:
        u = ns.active[0]
        ok_region = (not region) or (u.get("region") or "").strip() == region or region.startswith("National")
        ok_chapter = (not chapters) or (u.get("chapter") or "").strip() in chapters
        if is_admin and ok_region and ok_chapter:
            todo_withdraw.append(ns)
        else:
            del_ambig.append(ns)
            notes.append(f"{ns.name}: 문의자 지역/챕터 밖이라 자동 처리 안 함 ({u.get('region')}/{u.get('chapter')})")
    if todo_withdraw:
        causes.append("DELETE_PENDING")
        lines.append(f"{_fmt_names(todo_withdraw)} 님 {len(todo_withdraw)}명은 아직 명단에 있어 탈퇴 처리합니다. "
                     "입력된 데이터는 탈퇴 이력에 보관되어 필요하면 복원할 수 있습니다.")
    if del_ambig:
        causes.append("DELETE_AMBIGUOUS")
        lines.append(f"{_fmt_names(del_ambig)} 님은 같은 이름의 멤버가 여럿 있거나 담당 지역 밖이라 이메일을 확인한 뒤 처리하겠습니다. "
                     "해당 멤버의 이메일을 게시판에 남겨 주세요.")

    add_missing = [n for n in names if n.want == "add" and n.state in ("없음", "탈퇴")]
    if add_missing:
        causes.append("ADD_MISSING")
        lines.append(f"{_fmt_names(add_missing)} 님은 아직 등록되어 있지 않습니다. 관리자 대시보드 > 새 멤버 추가에서 "
                     "이메일과 산업군을 입력해 등록해 주시면 Viewer 에 바로 반영됩니다. 등록 중 화면이 「권한 없음」이나 "
                     "로그인 화면으로 돌아가면 PC 크롬에서 다시 로그인한 뒤 시도해 주세요. 그래도 안 되면 멤버 이메일을 "
                     "게시판에 남겨 주세요. 본사에서 등록하겠습니다.")
    unknown = [n for n in names if n.want == "?" and n.state in ("없음",)]
    if unknown:
        causes.append("NOT_FOUND")
        lines.append(f"{_fmt_names(unknown)} 님은 RPS 명단과 탈퇴 이력에서 찾지 못했습니다. 이름 표기나 챕터를 알려 주세요.")

    if not causes and names and (del_gone or add_present):
        causes.append("ALREADY_OK")

    # 링크 문단 — URL 은 한 줄에 단독으로 (대외 문구 규칙)
    link_par = ""
    if off and not off.error:
        link_par = (f"RPI Viewer 의 {off_kor} 시트(제목 '{link_ch}_rps')는 아래 링크이며 현재 {len(off.names)}명, "
                    f"RPI {off.rpi or '-'}입니다.\n{off.url}")
        if old_matches:
            link_par += "\n즐겨찾기나 카톡에 저장해 두신 옛 링크는 위 링크로 바꿔 주세요."
        elif "ALREADY_OK" in causes or "VIEW_GENERIC" in causes:
            link_par += "\n보고 계신 화면이 위 링크와 다르면 그 화면의 링크나 캡처를 게시판에 남겨 주세요. 바로 확인하겠습니다."

    answer = ""
    if lines:
        answer = "문의 주신 내용을 확인했습니다. " + " ".join(lines)
        if link_par:
            answer += "\n" + link_par
        answer += "\n감사합니다."

    # 신뢰도 — 자동 게시 여부. 원인을 못 짚었으면(답변이 없으면) 지어내지 않고 사람에게 넘긴다.
    if not answer:
        confidence = "none"
    elif "OLD_SHEET" in causes or "DELETE_PENDING" in causes:
        confidence = "high"
    elif off and not off.error:
        confidence = "high"          # 이름별 상태 + 정식 링크까지 확인된 답
    else:
        confidence = "low"           # 정식 링크를 못 찾았으면 초안만 — 사람이 본다
    if "login" in tags and not names and "VIEW_GENERIC" not in causes:
        confidence = "none"

    return Diagnosis(post=post, tags=tags, region=region, is_admin=is_admin, chapters=chapters,
                     names=names, official=official, old_matches=old_matches, old_others=old_others,
                     causes=causes, actions_done=[], answer=answer, confidence=confidence, notes=notes)


# ---------------------------------------------------------------- 조치 · 게시 · 보고

def do_withdrawals(diag: Diagnosis, ctx: Context, apply: bool) -> None:
    """요청받은, 문의자 지역·챕터 안의, 유일한 활동중 멤버만 웹앱 API 로 탈퇴 처리한다(복원 가능)."""
    targets = [n for n in diag.names if n.want == "del" and n.state == "활동중"
               and "DELETE_PENDING" in diag.causes
               and (not diag.region or (n.active[0].get("region") or "").strip() == diag.region
                    or diag.region.startswith("National"))
               and (not diag.chapters or (n.active[0].get("chapter") or "").strip() in diag.chapters)]
    if not targets:
        return
    emails = [n.active[0]["email"].strip().lower() for n in targets]
    label = f"탈퇴 처리 {len(emails)}명: " + ", ".join(f"{n.name}({n.active[0]['email']})" for n in targets)
    if not apply:
        diag.actions_done.append("[dry] " + label)
        return
    st, body = api_post("bulk-withdrawal", {"userEmails": emails,
                                            "adminEmail": f"{CALLER} (자동 · 게시판 #{diag.post.get('row')} {diag.post.get('name')} 요청)"})
    ok = st == 200
    diag.actions_done.append(("✅ " if ok else "❌ ") + label + f" → API {st} {body[:120]}")
    if ok:
        ch = (targets[0].active[0].get("chapter") or "").strip()
        diag.answer = diag.answer.replace("아직 명단에 있어 탈퇴 처리합니다.", "탈퇴 처리했습니다.", 1)
        touch_sheets(diag, [ch])
    else:
        # 처리가 안 됐는데 「처리합니다」로 나가면 거짓말이 된다 → 게시하지 않고 사람에게
        diag.confidence = "low"
        diag.notes.append("탈퇴 API 실패 — 답변 보류")


def touch_sheets(diag: Diagnosis, chapters: list[str]) -> None:
    """정식 시트를 한 번 읽어 IMPORTRANGE 를 깨운다 — 자격증명 있는 PC 에서만."""
    try:
        import subprocess
        names = [f"{c}_rps" for c in chapters if c]
        if not names or not (HERE / "rps_sheet_touch.py").exists():
            return
        r = subprocess.run([sys.executable, "-X", "utf8", str(HERE / "rps_sheet_touch.py"), "--only", *names],
                           capture_output=True, text=True, timeout=120, encoding="utf-8", errors="replace")
        diag.actions_done.append(f"시트 깨우기 {', '.join(names)} → {'OK' if r.returncode == 0 else 'FAIL'}")
    except Exception as e:                                         # noqa: BLE001
        diag.actions_done.append(f"시트 깨우기 건너뜀: {str(e)[:80]}")


def post_answer(diag: Diagnosis, apply: bool) -> int | None:
    if not diag.answer:
        return None
    if not apply:
        return -1
    st, body = api_post("board/reply", {"email": CALLER, "name": "joy.byun", "role": "National",
                                        "content": diag.answer, "parentIndex": str(diag.post["row"])})
    if st != 200:
        diag.notes.append(f"답변 게시 실패 {st} {body[:120]}")
        return None
    try:
        posts = api_get("board")
        mine = [p for p in posts if p.get("type") == "답변" and str(p.get("parentIndex")) == str(diag.post["row"])]
        return int(mine[-1]["index"]) if mine else 0
    except Exception:                                              # noqa: BLE001
        return 0


def report_text(diag: Diagnosis, answer_no: int | None) -> tuple[str, str]:
    """(문자 요약, 이메일 전문)."""
    p = diag.post
    cause = ", ".join(diag.causes) or "원인 미확정"
    head = f"[RPS 자동진단] #{p.get('row')} {p.get('name') or p.get('email')} ({diag.region or '지역?'})\n원인: {cause}"
    if answer_no and answer_no > 0:
        head += f"\n답변 #{answer_no} 게시 → 문자는 감시작업이 발송"
    elif answer_no == -1:
        head += "\n[dry] 답변 게시 안 함"
    elif diag.answer:
        head += "\n⚠ 답변 초안만 — 검토 필요(자동 게시 조건 미달)"
    else:
        head += "\n⚠ 답변 없음 — 사람이 봐야 함"
    if diag.actions_done:
        head += "\n조치: " + " / ".join(a[:60] for a in diag.actions_done)

    rows = [f"문의 #{p.get('row')} · {p.get('ts')} · {p.get('name')} <{p.get('email')}> · 지역 {diag.region or '?'} · 관리자 {'Y' if diag.is_admin else 'N'}",
            f"원문: {p.get('content')}", "", f"분류: {sorted(diag.tags)} · 챕터: {diag.chapters} · 신뢰도: {diag.confidence}", ""]
    rows.append("■ 이름별 상태")
    for ns in diag.names:
        where = ""
        if ns.active:
            where = " / ".join(f"{u.get('chapter')} {u.get('email')}" for u in ns.active[:3])
        elif ns.withdrawn:
            where = " / ".join(f"{w.get('chapter')} {w.get('withdrawalTime')}" for w in ns.withdrawn[-2:])
        rows.append(f"  {ns.name:6} 요청={ns.want:3} 상태={ns.state:4} {where}")
    rows.append("")
    rows.append("■ 정식 시트")
    for ch, v in diag.official.items():
        rows.append(f"  {ch}_rps {v.kor} RPI {v.rpi} {len(v.names)}명 {v.url}" + (f" ⚠ {v.error}" if v.error else ""))
    rows.append("■ 옛 시트 — 증상과 맞음")
    for v in diag.old_matches:
        rows.append(f"  ★ {v.title} ({v.kor}) RPI {v.rpi} {len(v.names)}명 {v.url}")
    rows.append("■ 옛 시트 — 찾았지만 증상과 안 맞음 / 못 읽음")
    for v in diag.old_others:
        rows.append(f"  · {v.title} RPI {v.rpi} {len(v.names)}명 {v.url}" + (f" ⚠ {v.error}" if v.error else ""))
    rows.append("")
    rows.append("■ 조치")
    rows += [f"  {a}" for a in diag.actions_done] or ["  없음"]
    rows.append("■ 메모")
    rows += [f"  {n}" for n in diag.notes] or ["  없음"]
    rows.append("")
    rows.append("■ 답변" + (f" (#{answer_no} 게시)" if answer_no and answer_no > 0 else " (초안 — 게시 안 함)" if diag.answer else ""))
    rows.append(diag.answer or "  (없음)")
    return head, "\n".join(rows)


def notify_me(head: str, body: str, apply: bool) -> None:
    if not apply:
        print("\n[dry] 나에게 보낼 요약:\n" + head)
        return
    try:
        from notify import send_email, send_sms_admin
        send_sms_admin(head)
        send_email(head.splitlines()[0], body)
    except Exception as e:                                         # noqa: BLE001
        print(f"   [triage] 보고 실패: {str(e)[:120]}", file=sys.stderr)


def already_answered(post: dict, board_posts: list[dict] | None) -> int | None:
    """이 문의에 본사(National) 답변이 이미 달려 있으면 그 답변 번호. 없으면 None.

    ⛔ JOY 가 꺼져 있는 동안 SEYOON 에서 사람이 답한 문의(11-09 #23~25 → #26~28)를, JOY 가 켜지며
       「새 문의」로 집어 자동 진단이 **또 답변을 달면** 문의자에게 같은 문자가 두 번 간다. 그래서 먼저 본다.
    """
    posts = board_posts
    if posts is None:
        try:
            raw = api_get("board")
            posts = [{"row": int(p["index"]), "type": p.get("type", ""), "role": p.get("role", ""),
                      "parent": str(p.get("parentIndex", ""))} for p in raw]
        except Exception:                                          # noqa: BLE001
            return None
    for p in posts:
        if p.get("type") == "답변" and str(p.get("parent")) == str(post["row"]) and p.get("role") in ("National",):
            return int(p["row"])
    return None


def handle(post: dict, *, apply: bool = False, ctx: Context | None = None, svc=None,
           board_posts: list[dict] | None = None) -> Diagnosis:
    """board_watch 진입점. 예외를 밖으로 던지지 않는다 — 접수 문자가 이것 때문에 멈추면 안 된다."""
    prior = already_answered(post, board_posts)
    if prior:
        d = Diagnosis(post=post, tags=set(), region="", is_admin=False, chapters=[], names=[], official={},
                      old_matches=[], old_others=[], causes=["ALREADY_ANSWERED"], actions_done=[], answer="",
                      confidence="none", notes=[f"본사 답변 #{prior} 가 이미 있어 자동 진단을 건너뜀"])
        print(f"   [triage] #{post['row']}: 본사 답변 #{prior} 가 이미 있다 — 건너뜀")
        return d
    ctx = ctx or Context()
    diag = diagnose(post, ctx)
    do_withdrawals(diag, ctx, apply)
    if "OLD_SHEET" in diag.causes or "ALREADY_OK" in diag.causes:
        touch_sheets(diag, diag.chapters[:1]) if apply else None
    answer_no = post_answer(diag, apply) if diag.auto_post else (-1 if not apply else None)
    head, body = report_text(diag, answer_no)
    notify_me(head, body, apply)
    _ledger(diag, answer_no, apply, svc)
    print(body)
    return diag


def _ledger(diag: Diagnosis, answer_no: int | None, apply: bool, svc) -> None:
    if not apply:
        return
    try:
        import proclog
        key = f"게시판 #{diag.post['row']}"
        status = proclog.ST_RUNNING if (answer_no and answer_no > 0) else proclog.ST_HOLD
        proclog.update(key, svc=svc, status=status,
                       fix=("자동진단 " + ", ".join(diag.causes or ["미확정"]) + (" · " + " / ".join(diag.actions_done) if diag.actions_done else ""))[:500],
                       trace=f"자동진단 {diag.confidence} · " + (f"답변 #{answer_no} 게시" if answer_no and answer_no > 0 else "답변 보류(검토 필요)"))
    except Exception as e:                                         # noqa: BLE001
        print(f"   [triage] 대장 기록 실패: {str(e)[:120]}", file=sys.stderr)


# ---------------------------------------------------------------- CLI

def main() -> int:
    ap = argparse.ArgumentParser(description="게시판 문의 자동 진단")
    ap.add_argument("--post", type=int, help="게시판 글 번호(index)")
    ap.add_argument("--text", help="임의 문장으로 진단 연습")
    ap.add_argument("--email", default="", help="--text 와 함께: 문의자 이메일(지역 판정용)")
    ap.add_argument("--apply", action="store_true", help="조치·답변 게시·보고까지 실제로")
    a = ap.parse_args()
    if a.post:
        posts = api_get("board")
        p = next((x for x in posts if str(x.get("index")) == str(a.post)), None)
        if not p:
            print(f"#{a.post} 없음")
            return 1
        post = {"row": int(p["index"]), "ts": p.get("timestamp", ""), "email": p.get("email", ""),
                "name": p.get("name", ""), "role": p.get("role", ""), "type": p.get("type", ""),
                "content": p.get("content", ""), "parent": p.get("parentIndex", "")}
    elif a.text:
        post = {"row": 0, "ts": "", "email": a.email, "name": a.email.split("@")[0], "role": "Admin",
                "type": "요청", "content": a.text, "parent": ""}
        a.apply = False
    else:
        ap.print_help()
        return 1
    handle(post, apply=a.apply)
    return 0


if __name__ == "__main__":
    sys.exit(main())
