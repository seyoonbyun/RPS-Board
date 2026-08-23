# -*- coding: utf-8 -*-
r"""런칭 신청 감시 — 새 신청이 들어오면 파이프라인을 띄운다.

    python watcher.py                  # 확인만 (신규 건 목록 + 준비 상태)
    python watcher.py --run            # 신규 건을 dry-run 으로 돌려 계획을 찍는다
    python watcher.py --run --apply    # 실제 생성까지 (게시는 하지 않는다)

접수 채널 = 모 시트 **`신청 접수`** 탭 (2026-08-23 Airtable 에서 되돌렸다 — 레코드 0건이라
이관 비용이 없었고, 임베드 iframe 이 어드민 로딩을 끌었다).
담당자는 RPS Board `/admin` → 지역 & 챕터 관리 → [신규 챕터 런칭 신청] 에서
**네이티브 폼**으로 제출한다. `활성화 = YES` 인 건만 처리 대상이다.

처리 이력은 같은 행의 `처리상태`·`처리로그` 열에 남긴다 — 상태가 한 곳에만 있다.

⚠ 신청서에는 **한글 이름만** 있다. imweb·시트·QR 은 전부 영문명을 쓴다.
   - 지역: 기존 지역이면 imweb 지역 페이지의 url 이 곧 영문명이다.
   - 챕터: pipeline 이 BNI Connect 추출에서 **역산**한다(음차 추론은 하지 않는다).
     오기가 시트 이름·QR 슬러그·페이지 url 에 전부 번지기 때문이다.

⚠ **지역 한글명은 imweb 페이지 이름 기준으로 넘겨야 한다.**
   모 시트는 `Suwon1 수원1`, imweb 페이지는 `수원` 처럼 서로 다른 경우가 있고,
   pipeline 은 `--region-kor` 하나를 양쪽에 쓴다. 신청서에 `수원1` 이라 적혀 오면
   **신규 지역으로 오판해 지역·ALL 페이지를 새로 만든다** → 아래에서 미리 경고한다.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")   # 에러도 utf-8 로 (cp949 로 나가면 깨진다)
except Exception:
    pass

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import intake                                   # noqa: E402
import paths                                    # noqa: E402

SNAP = paths.snap_dir()


def region_english(region_kor: str) -> tuple[str | None, bool]:
    """기존 지역이면 imweb 지역 페이지 url 이 곧 영문명이다.

    돌려주는 값: (영문명, imweb 로그인 여부)
    영문명이 None 이면 **신규 지역이거나 로그인이 안 된 것** — 둘은 구분해야 한다.
    """
    from imweb_client import ImwebClient
    with ImwebClient() as im:
        if not im.logged_in():
            return None, False
        m = im.find_by_name(region_kor)
        if m and not str(m.get("url", "")).isdigit():
            return m["url"], True
    return None, True


def latest_report(before: set[Path]) -> Path | None:
    """pipeline 이 방금 남긴 리포트 파일을 찾는다(실행 전후 비교)."""
    now = set(SNAP.glob("launch_*.json"))
    fresh = now - before
    return max(fresh, key=lambda p: p.stat().st_mtime) if fresh else None


def run_pipeline(app: dict, region_eng: str, apply: bool) -> tuple[int, str, Path | None]:
    """pipeline.py 를 띄운다. 챕터 영문명은 넘기지 않는다(추출에서 역산)."""
    cmd = [sys.executable, str(HERE / "pipeline.py"),
           "--kor", app["chapter_kor"],
           "--region", region_eng,
           "--region-kor", app["region_kor"],
           "--launch", app["launch"]]
    if app["chapter_eng"]:                       # 사람이 미리 확정해 둔 경우만
        cmd += ["--chapter", app["chapter_eng"]]
    if apply:
        cmd += ["--apply", "--notify"]
        if app["owner_phone"]:
            cmd += ["--owner-phone", app["owner_phone"]]

    SNAP.mkdir(parents=True, exist_ok=True)
    before = set(SNAP.glob("launch_*.json"))
    print("   $ " + " ".join(cmd[1:]))
    r = subprocess.run(cmd, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    out = (r.stdout or "") + (r.stderr or "")
    print("\n".join("   " + ln for ln in out.strip().splitlines()))
    return r.returncode, out, (latest_report(before) if apply else None)


def write_back(app: dict, region_eng: str, report_path: Path | None,
               rc: int, tail: str) -> None:
    """실행 결과를 `신청 접수` 시트로 되돌려 쓴다."""
    stamp = f"{datetime.now():%Y-%m-%d %H:%M}"
    fields = {"region_eng": region_eng}

    if report_path and report_path.exists():
        data = json.loads(report_path.read_text(encoding="utf-8"))
        plan = data.get("plan", {})
        ok = data.get("report", {}).get("ok")
        fields["chapter_eng"] = plan.get("chapter_eng", "")
        fields["sheet"] = plan.get("chapter_sheet", "")
        fields["page"] = plan.get("chapter_page_name", "")
        fields["status"] = intake.ST_CREATED if ok else intake.ST_HOLD
        line = (f"생성 {'완료' if ok else '실패(검증 불통과)'} · "
                f"리포트 {report_path.name}")
    else:
        fields["status"] = intake.ST_HOLD
        line = f"중단 (rc={rc}) · {tail.strip().splitlines()[-1] if tail.strip() else ''}"

    intake.update(app["row"], log=line, **fields)
    print(f"   → 접수 시트 {app['row']}행: {fields.get('status')} / {stamp} {line}")


def main() -> None:
    ap = argparse.ArgumentParser(description="챕터 런칭 신청 감시 (`신청 접수` 시트)")
    ap.add_argument("--run", action="store_true", help="신규 건에 파이프라인을 돌린다")
    ap.add_argument("--apply", action="store_true", help="실제 생성 (게시는 안 함)")
    ap.add_argument("--all", action="store_true", help="처리 상태를 무시하고 전부 대상")
    a = ap.parse_args()

    apps = [x for x in intake.applications() if x["kind"] == intake.KIND_CHAPTER]
    todo = ([x for x in apps if x["active"]] if a.all
            else intake.pending(intake.KIND_CHAPTER, apps))

    print(f"신청 {len(apps)}건 · 런칭버튼 YES {sum(1 for x in apps if x['active'])}건 "
          f"· 미처리 {len(todo)}건\n")
    for x in apps:
        mark = "▶" if x in todo else ("…" if x["status"] else "·")
        note = "" if x["active"] else "  (런칭버튼 미활성 — 대상 아님)"
        print(f" {mark} {x['region_kor']} {x['chapter_kor']} · 런칭 {x['launch'] or '-'} "
              f"· 담당 {x['owner'] or '-'} · 상태 {x['status'] or '(빈값)'}{note}")
    if not todo:
        print("\n새로 처리할 건이 없다.")
        return

    for x in todo:
        print(f"\n=== {x['region_kor']} {x['chapter_kor']} ===")

        if not x["launch"]:
            print("  ⚠ 런칭 예정일이 없다 — 시트·페이지 비밀번호(MMDD)를 정할 수 없다. 건너뛴다.")
            continue
        if not x["connect_ok"]:
            print("  ⚠ BNI Connect 지원서 등록이 아직 YES 가 아니다 — 멤버 명단을 못 받는다")

        eng = x["region_eng"] or None
        logged_in = True
        if not eng:
            eng, logged_in = region_english(x["region_kor"])

        if eng:
            print(f"  지역: 기존 — 영문명 `{eng}`")
        elif not logged_in:
            print("  ⛔ imweb 로그인이 안 됐다 →  python imweb_client.py --login")
        else:
            print(f"  지역: imweb 에 `{x['region_kor']}` 페이지가 없다 → **신규 지역으로 처리된다**")
            print("     (지역·ALL 페이지까지 새로 만든다. 기존 지역인데 이름 표기만 다른 것은 아닌지"
                  " 확인하세요 — 예: 신청 `수원1` ↔ imweb `수원`)")

        print(f"  챕터 영문명: {x['chapter_eng'] or 'pipeline 이 BNI Connect 추출에서 역산'}")

        if not a.run:
            continue
        if not logged_in:
            continue
        if not eng:
            print("  → 지역 영문명이 없어 자동 실행하지 않는다. 확인 후 직접 넘겨주세요:")
            print(f"     python pipeline.py --kor {x['chapter_kor']} --region <Eng> "
                  f"--region-kor {x['region_kor']} --launch {x['launch']} --apply")
            continue

        rc, out, rep = run_pipeline(x, eng, a.apply)
        if a.apply:
            write_back(x, eng, rep, rc, out)
        elif rc != 0:
            print("   (dry-run 실패 — 위 메시지를 먼저 해결하세요)")

    if not a.apply and a.run:
        print("\n(dry-run 이라 Airtable 에 아무것도 쓰지 않았다. --apply 를 붙이면 실제 생성)")


if __name__ == "__main__":
    main()
