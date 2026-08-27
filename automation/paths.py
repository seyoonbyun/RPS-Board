# -*- coding: utf-8 -*-
r"""자격증명·키 파일 경로를 한 곳에서 정한다.

경로를 각 스크립트에 하드코딩해 뒀더니, 폴더를 옮긴 뒤 6개 파일이 한꺼번에
없는 곳을 가리키게 됐다(2026-08-01 발견). 여기서만 정하면 그런 일이 없다.

찾는 순서 — **먼저 존재하는 것을 쓴다**:
  1. 환경변수 `MYPT_CRED_DIR`
  2. 바탕화면 `C:\Users\Gram\desktop\connect_tl_report\connect`          ← 정본(작업용)
  3. 볼트   `C:\SEYOON\03. Projects\Active\connect_tl_report\secrets`   ← 사본(다른 PC용)

볼트 쪽은 `connect_tl_report/README.md` 의 방침대로 "볼트만 있으면 어느 PC에서든"
작업하기 위한 사본이다. 폴더 이름이 `connect` 가 아니라 **`secrets`** 라 다르다.
⚠ 볼트는 Obsidian Sync·Dropbox·구글드라이브 3중 동기화 대상이므로, 그 사본에는
  `google_token.json`(드라이브 전체 접근권)이 세 서비스로 복제된다는 점을 알고 쓸 것.
"""
from __future__ import annotations

import os
from pathlib import Path

_CANDIDATES = [
    os.environ.get("MYPT_CRED_DIR"),
    r"C:\Users\Gram\desktop\connect_tl_report\connect",
    r"C:\SEYOON\03. Projects\Active\connect_tl_report\secrets",
]


def _first_existing(paths, what: str) -> Path:
    tried = []
    for p in paths:
        if not p:
            continue
        q = Path(p)
        tried.append(str(q))
        if q.exists():
            return q
    raise SystemExit(
        f"{what} 를 찾지 못했다. 확인한 곳:\n  " + "\n  ".join(tried) +
        "\n환경변수 MYPT_CRED_DIR 로 직접 지정할 수 있다.")


def cred_dir() -> Path:
    """자격증명 폴더 (google_token.json · imweb_profile · 각종 토큰)."""
    return _first_existing(_CANDIDATES, "자격증명 폴더 connect")


# 개별 파일 — 폴더가 없으면 여기서 바로 알려준다.
def client_secret() -> Path:
    return cred_dir() / "client_secret.json"


def google_token() -> Path:
    return cred_dir() / "google_token.json"


def imweb_profile() -> Path:
    return cred_dir() / "imweb_profile"


def bitly_token() -> Path:
    return cred_dir() / "bitly_token.txt"


def airtable_token() -> Path:
    return cred_dir() / "airtable_token.txt"


# ---------------------------------------------------------------- 작업 폴더
#
# **볼트에는 방법만 둔다** — 코드·문서·템플릿(assets). 결과물과 부산물은 볼트 밖이다.
# 볼트만 있으면 어느 기기에서든 같은 작업을 같은 품질로 할 수 있어야 한다는 원칙이고,
# 실제로도 볼트는 3중 동기화라 산출물을 넣으면 세 서비스로 복제된다.
# 완료된 결과물의 보관은 구글 드라이브가 맡는다(`archive_dir`).

_WORK_CANDIDATES = [
    os.environ.get("MYPT_WORK_DIR"),
    r"C:\Users\Gram\desktop\connect_tl_report\mypowerteam",
]


def work_dir() -> Path:
    """결과물·부산물이 쌓이는 로컬 작업 폴더. 없으면 만든다."""
    for p in _WORK_CANDIDATES:
        if p:
            q = Path(p)
            q.mkdir(parents=True, exist_ok=True)
            return q
    raise SystemExit("작업 폴더를 정하지 못했다 (MYPT_WORK_DIR)")


def out_dir() -> Path:
    """생성물 — 배너·QR·챕터별 산출물."""
    d = work_dir() / "output"
    d.mkdir(parents=True, exist_ok=True)
    return d


def snap_dir() -> Path:
    """실행 리포트·스냅샷·백업 — 되돌리기의 근거라 지우지 말 것."""
    d = work_dir() / "snapshots"
    d.mkdir(parents=True, exist_ok=True)
    return d


def archive_dir() -> Path:
    """완료 결과물 보관 — 구글 드라이브. 미연결이면 로컬 작업 폴더로 떨어진다."""
    g = Path(os.environ.get("MYPT_ARCHIVE_DIR", r"G:\내 드라이브\MyPowerteam"))
    try:
        g.mkdir(parents=True, exist_ok=True)
        return g
    except OSError:
        return work_dir() / "archive"


def sa_key() -> Path:
    """서비스계정 키. 읽기·수정은 되지만 드라이브 파일 생성은 못 한다(할당량 0)."""
    return _first_existing([
        os.environ.get("MYPT_SA_KEY"),
        cred_dir() / "gcp-key.json",
        # 볼트가 재정리되면서 옮겨졌다 (2026-08-24 오션 런칭이 옛 경로 탓에 멈췄다).
        # 볼트는 3중 동기화 중이라 자격증명 정본은 위 자격증명 폴더에 둔다.
        r"C:\SEYOON\99. Private\api keys\rpslist\gcp-key.json",
        r"C:\SEYOON\99. Private\mypowerteam app secret\gcp-key.json",
        r"C:\SEYOON\03. Projects\Ongoing\rpslist\gcp-key.json",
    ], "서비스계정 키 gcp-key.json")


def read_token_file(path: Path, what: str) -> str:
    """`TOKEN : pat...` 또는 값만 한 줄 — 둘 다 받는다."""
    if not path.exists():
        raise SystemExit(f"{what} 토큰 파일이 없다: {path}")
    raw = path.read_text(encoding="utf-8").strip()
    head = raw.split("\n")[0]
    return (head.split(":", 1)[1] if ":" in head else head).strip()


if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    print(f"자격증명 폴더 : {cred_dir()}")
    for name, fn in (("client_secret", client_secret), ("google_token", google_token),
                     ("imweb_profile", imweb_profile), ("bitly_token", bitly_token),
                     ("airtable_token", airtable_token), ("gcp-key", sa_key)):
        p = fn()
        print(f"  {'✓' if p.exists() else '✗'} {name:15} {p}")
