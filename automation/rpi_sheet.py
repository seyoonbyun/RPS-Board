# -*- coding: utf-8 -*-
r"""[3-b] RPI 집계 시트에 신규 챕터·지역 행을 추가한다.

    python rpi_sheet.py                      # dry-run
    python rpi_sheet.py --apply
    python rpi_sheet.py --apply --allow-skip # _source 에 없는 항목을 제외하고 진행

대상 = `RPI : BNI K. All`. 시트 3장:
    지역 RPI / 챕터 RPI  — 전국 1행 + 대상별 1행 (전부 수식)
    _source (숨김)       — A1 에 `IMPORTRANGE` 수식 **1개뿐**

`_source` 는 모 시트 `RPS!B2:U` 를 통째로 당겨온다. 즉 [1] 에서 모 시트에 명단을
append 하면 원천은 이미 채워져 있고, **집계 행(수식)만 추가하면 된다.**
그래서 이 단계의 자리는 [3](사본 생성·URL 확보) 바로 다음이다.

하는 일은 좁게 유지한다 — 신규 행 추가 + A→Z 정렬 + No. 재번호.
폐쇄·정지 행 제거나 기존 표기 정비는 **하지 않는다**(남의 시트를 크게 건드리게 된다).

⚠ 수식이 `IFERROR(…,0)` 이라 **매칭 실패도 0, 실제 값이 0인 것도 0**이다.
   - 쓰기 전 : 챕터명/지역 표기가 `_source` 에 실제로 있는지 확인하고, 없으면 중단한다.
   - 쓰기 후 : `R파트너수=0(%)` 열이 100 이면 분모가 살아 있는 것 = 매칭 성공.
               매칭이 실패했다면 이 열도 0 이 된다.

⚠ 표기가 **챕터 마스터 · `_source` · RPI 시트** 세 군데에서 다르다.
   수식은 `_source` 값을 매칭하므로 마스터 표기를 그대로 넣으면 조용히 0 이 된다.
   `지역 RPI` 는 B열 표시명과 수식 criteria 가 원래부터 다르다(`Daegu 대구` = 대구1+대구2 합산).
   → 기존 지역이 이미 커버되는지는 표시명이 아니라 **수식 안의 criteria** 로 판정한다.
"""
from __future__ import annotations

import argparse
import datetime
import json
import re
import sys
from pathlib import Path

import openpyxl

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent))

import paths                                              # noqa: E402
from google_auth import user_credentials                  # noqa: E402
from googleapiclient.discovery import build                # noqa: E402

SID = "14KZrC6w8BUIFCp2AcLF6Uj36HKXsVQgZOY9_H2-DY18"       # RPI : BNI K. All

# 수식 템플릿으로 쓸 행 — criteria 가 하나뿐인 단순한 행을 고른다.
# (`Daegu 대구` 같은 합산 행을 템플릿으로 쓰면 치환이 어긋난다.)
TMPL_CHAPTER = "Crown"
TMPL_REGION = "Seongdong 성동"


def find_master() -> Path:
    """가장 최근 `Chapter Master Origin` 파일. 활동중(N) 시트가 정본이다."""
    base = Path(r"C:\Users\Gram\desktop\connect_tl_report")
    files = [p for p in base.rglob("*Chapter Master Origin*.xlsx")
             if not p.name.startswith("~$")]
    if not files:
        raise SystemExit(f"Chapter Master Origin 파일을 찾지 못했다: {base}")
    return max(files, key=lambda p: p.stat().st_mtime)


def read_all_status(path: Path) -> dict[str, tuple[str, str]]:
    """`ALL 챕터` 시트 → {챕터명(casefold): (상태, 지역명)}. 폐쇄 감지 메시지용.

    ⚠ 공백만 다른 동명이 있다(`The Great` 송파 정지됨 / `TheGreat` 성남 코어 그룹).
      마지막 것이 이기지 않도록 활동중이 아닌 쪽을 덮어쓰지 않는다.
    """
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    if "ALL 챕터" not in wb.sheetnames:
        return {}
    rows = list(wb["ALL 챕터"].iter_rows(values_only=True))
    h = {v: i for i, v in enumerate(rows[0]) if v}
    out: dict[str, tuple[str, str]] = {}
    for r in rows[1:]:
        ch = str(r[h["챕터명(Eng)"]] or "").strip()
        if not ch:
            continue
        st = str(r[h["상태"]] or "").strip()
        rg = str(r[h["지역명"]] or "").strip()
        k = ch.casefold()
        if k not in out or st == "활동중":
            out[k] = (st, rg)
    return out


def read_master(path: Path) -> list[tuple[str, str]]:
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    name = next((n for n in wb.sheetnames if n.startswith("활동중")), None)
    if not name:
        raise SystemExit(f"`활동중(N)` 시트가 없다: {path.name}")
    rows = list(wb[name].iter_rows(values_only=True))
    h = {v: i for i, v in enumerate(rows[0]) if v}
    out = []
    for r in rows[1:]:
        ch = str(r[h["챕터명(Eng)"]] or "").strip()
        if not ch:
            continue
        rn = r[h["지역명"]]
        # ⚠ `지역명`(F) 은 비어 있는 행이 있다 → 지역(Eng)+지역(Kor) 로 합성
        region = str(rn).strip() if rn and str(rn).strip() else (
            f"{str(r[h['지역(Eng)']] or '').strip()} {str(r[h['지역(Kor)']] or '').strip()}".strip())
        out.append((ch, region))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="[3-b] RPI 집계 시트 행 추가")
    ap.add_argument("--master", help="Chapter Master Origin .xlsx (생략 시 최신본 자동 탐색)")
    ap.add_argument("--apply", action="store_true", help="실제 쓰기 (미지정 시 dry-run)")
    ap.add_argument("--allow-skip", action="store_true",
                    help="_source 에 없는 항목을 중단 대신 제외하고 진행")
    ap.add_argument("--reconcile", action="store_true",
                    help="마스터 활동중에 없는 행도 제거한다. 기본은 추가만. "
                         "평시 제거는 `rpi_watch.py`(어드민 삭제 로그 감지)가 보고와 함께 맡는다")
    a = ap.parse_args()

    svc = build("sheets", "v4", credentials=user_credentials(), cache_discovery=False)

    def get(rng: str, render: str) -> list[list]:
        return svc.spreadsheets().values().get(
            spreadsheetId=SID, range=rng, valueRenderOption=render).execute().get("values", [])

    def pad(row, n):
        return list(row) + [""] * (n - len(row))

    # ── 0) 스냅샷 (되돌리기용) ────────────────────────────────
    snap = {n: {"formula": get(r, "FORMULA"), "value": get(r, "UNFORMATTED_VALUE")}
            for n, r in [("지역 RPI", "'지역 RPI'!A1:F1020"),
                         ("챕터 RPI", "'챕터 RPI'!A1:G1093")]}
    snap_dir = paths.snap_dir() if hasattr(paths, "snap_dir") else Path.cwd()
    snap_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    snap_path = snap_dir / f"rpi_{stamp}.json"
    snap_path.write_text(json.dumps(snap, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"스냅샷 {snap_path}")

    # ── 1) 정본 = 챕터 마스터 활동중 ──────────────────────────
    master_path = Path(a.master) if a.master else find_master()
    master = read_master(master_path)
    print(f"마스터 {master_path.name} — 활동중 {len(master)}개")

    # ── 2) _source 실제 표기 (수식 criteria 검증용) ───────────
    src = get("'_source'!A2:B5000", "UNFORMATTED_VALUE")
    src_regions = {str(r[0]).strip() for r in src if r and str(r[0]).strip()}
    src_chapters: dict[str, int] = {}
    for r in src:
        if len(r) > 1 and str(r[1]).strip():
            k = str(r[1]).strip().casefold()
            src_chapters[k] = src_chapters.get(k, 0) + 1

    # ── 3) 챕터 RPI ──────────────────────────────────────────
    ch_rows = [pad(r, 7) for r in snap["챕터 RPI"]["formula"][1:]
               if len(r) > 2 and str(r[2]).strip()]
    ch_head, ch_body = ch_rows[0], ch_rows[1:]        # 0번 = 전국/BNI K. ALL, 정렬 제외

    # 같은 챕터가 두 줄이면 앞의 것만 남긴다. 행이 줄어드는 쓰기에서 꼬리 행이 남으면
    # 중복이 생기는데(2026-08-02 Zeus), 그것을 다음 실행이 스스로 걷어내게 하는 안전망이다.
    seen, deduped = set(), []
    for r in ch_body:
        k = str(r[2]).strip().casefold()
        if k in seen:
            print(f"   ⚠ 중복 행 제거: {str(r[2]).strip()}")
            continue
        seen.add(k)
        deduped.append(r)
    ch_body = deduped
    existing = set(seen)
    tmpl = next(r for r in ch_body if str(r[2]).strip() == TMPL_CHAPTER)

    new_ch = [(c, rg) for c, rg in master if c.casefold() not in existing]
    ch_blocked = []
    print(f"\n[챕터] 추가 대상 {len(new_ch)}건")
    for c, rg in new_ch:
        n = src_chapters.get(c.casefold(), 0)
        if n == 0:
            ch_blocked.append(c)
            print(f"   ⛔ {c:<12} ({rg})  _source 매칭 없음 → RPI 0 이 된다")
            continue
        row = [""] * 7
        row[1], row[2] = rg, c
        for i in range(3, 7):
            row[i] = str(tmpl[i]).replace(f'"{TMPL_CHAPTER}"', f'"{c}"')
        ch_body.append(row)
        print(f"   + {c:<12} ({rg})  _source {n}명")

    # ── 3-b) 폐쇄·정지 챕터 자동 제거 ──────────────────────────
    #
    # RPS Board 는 지역 담당자가 실시간으로 관리하는데 이 시트는 그렇지 않아, 챕터가
    # 문을 닫아도 행이 남는다. 멤버가 `_source` 에서 빠지면 분모가 0 이 되고 IFERROR 가
    # 0 을 돌려주므로 **폐쇄 챕터가 RPI 0.00 짜리 활동 챕터처럼 보인다.**
    #
    # 정본은 챕터 마스터 `활동중(N)` — 거기 없으면 지운다.
    # ⚠ `RPI = 0` 을 기준으로 삼으면 안 된다. 활동중인데 R파트너 기록이 없어 0 인 챕터가 많다.
    # ⚠ 마스터는 월 1회 갱신이라, 이번 달 마스터가 아니면 갓 런칭한 챕터를 지울 수 있다.
    #    그래서 **이번 달에 만든 마스터인지 확인**하고, 아니면 제거를 건너뛴다.
    # 되돌리기는 맨 위에서 뜬 스냅샷으로 한다(수식까지 그대로 들어 있다).
    status = read_all_status(master_path)
    active = {c.casefold() for c, _ in master}
    fresh_master = master_path.stat().st_mtime >= (
        datetime.datetime.now() - datetime.timedelta(days=40)).timestamp()

    removable = [r for r in ch_body if str(r[2]).strip().casefold() not in active]
    if removable and not a.reconcile:
        print(f"\n[챕터] 마스터 활동중 아닌 행 {len(removable)}건 — 제거하지 않음 (--reconcile 필요)")
        for r in removable:
            name = str(r[2]).strip()
            st, _ = status.get(name.casefold(), ("(마스터에 없음)", ""))
            print(f"   · {name:<14} {str(r[1]).strip():<18} 마스터 상태: {st}")
        removable = []
    elif removable and not fresh_master:
        print(f"\n⚠ 마스터가 40일 이상 지난 파일이라 제거를 건너뛴다 ({master_path.name})")
        print(f"   대상이었던 {len(removable)}건: {[str(r[2]).strip() for r in removable]}")
    elif removable:
        print(f"\n[챕터] 제거 {len(removable)}건 (마스터 활동중 아님)")
        for r in removable:
            name = str(r[2]).strip()
            st, rg = status.get(name.casefold(), ("(마스터에 없음)", str(r[1]).strip()))
            n = src_chapters.get(name.casefold(), 0)
            mark = "" if n == 0 else f"  ⚠ 아직 _source 에 {n}명 남아 있다"
            print(f"   - {name:<14} {rg:<18} 마스터 상태: {st}{mark}")
        ch_body = [r for r in ch_body if str(r[2]).strip().casefold() in active]
    else:
        print("\n[챕터] 제거 0건")

    ch_body.sort(key=lambda r: str(r[2]).strip().casefold())
    for i, r in enumerate(ch_body, start=2):
        r[0] = i
    ch_head[0] = 1
    ch_out = [ch_head] + ch_body

    # ── 4) 지역 RPI — 신규 챕터의 지역만 본다 ──────────────────
    rg_rows = [pad(r, 6) for r in snap["지역 RPI"]["formula"][1:]
               if len(r) > 1 and str(r[1]).strip()]
    rg_head, rg_body = rg_rows[0], rg_rows[1:]
    # ⚠ 표시명이 아니라 수식 안의 criteria 로 '이미 커버됨' 을 판정한다
    covered: set[str] = set()
    for r in rg_body:
        covered |= set(re.findall(r"_source.!A:A,\"([^\"]*)\"", str(r[2])))
    rg_tmpl = next(r for r in rg_body if str(r[1]).strip() == TMPL_REGION)

    added_regions = {rg for c, rg in new_ch if c not in ch_blocked}
    new_rg = sorted(added_regions - covered)
    untouched = sorted({rg for _, rg in master} - covered - added_regions)
    if untouched:
        print(f"\n(참고) 마스터에 있으나 지역 RPI 미등재 — 범위 밖, 손대지 않음: {untouched}")

    rg_blocked = []
    print(f"\n[지역] 추가 대상 {len(new_rg)}건")
    for rg in new_rg:
        if rg not in src_regions:
            rg_blocked.append(rg)
            print(f"   ⛔ {rg:<22} _source 매칭 없음 → RPI 0 이 된다")
            continue
        row = [""] * 6
        row[1] = rg
        for i in range(2, 6):
            row[i] = str(rg_tmpl[i]).replace(f'"{TMPL_REGION}"', f'"{rg}"')
        rg_body.append(row)
        print(f"   + {rg:<22} _source 매칭 있음")

    rg_body.sort(key=lambda r: str(r[1]).strip().casefold())
    for i, r in enumerate(rg_body, start=2):
        r[0] = i
    rg_head[0] = 1
    rg_out = [rg_head] + rg_body

    print(f"\n챕터 RPI {len(ch_rows)}행 → {len(ch_out)}행 · 지역 RPI {len(rg_rows)}행 → {len(rg_out)}행")

    # ⚠ 행이 줄면 쓰기 범위도 줄어 **이전 마지막 행이 시트에 남는다**(2026-08-02 실제로 발생:
    #   95→94 로 줄였더니 96행에 Zeus 가 중복으로 남았다). 줄어든 만큼 빈 행으로 덮는다.
    #   `batchClear` 는 쓰지 않는다 — 데이터 확인·서식까지 지운다.
    ch_write = ch_out + [[""] * 7] * max(0, len(ch_rows) - len(ch_out))
    rg_write = rg_out + [[""] * 6] * max(0, len(rg_rows) - len(rg_out))

    if ch_blocked or rg_blocked:
        print(f"\n⛔ _source 에 없어 수식이 0 을 반환한다. 챕터={ch_blocked} 지역={rg_blocked}")
        if not a.allow_skip:
            print("   → 중단. 대개 [1] 명단이 아직 모 시트에 안 들어간 것이다."
                  " 제외하고 진행하려면 --allow-skip 을 명시할 것.")
            return 1
        print("   → --allow-skip: 위 항목을 제외하고 나머지만 진행한다.")

    if not a.apply:
        print("\n[dry-run] 쓰지 않았다. --apply 를 붙일 것.")
        return 0

    # 값·수식만 덮어쓴다. ⚠ batchClear 는 쓰지 않는다(드롭다운·서식까지 지운다).
    svc.spreadsheets().values().batchUpdate(spreadsheetId=SID, body={
        "valueInputOption": "USER_ENTERED",
        "data": [
            {"range": f"'챕터 RPI'!A2:G{1 + len(ch_write)}", "values": ch_write},
            {"range": f"'지역 RPI'!A2:F{1 + len(rg_write)}", "values": rg_write},
        ]}).execute()
    print("\n✓ 쓰기 완료 — 재조회 검증")

    # ── 5) 검증: R파트너수=0(%) 가 100 이면 분모가 살아 있다 = 매칭 성공 ──
    ok = True
    v_ch = get(f"'챕터 RPI'!A2:G{1 + len(ch_out)}", "UNFORMATTED_VALUE")
    names = [str(r[2]).strip() for r in v_ch[1:] if len(r) > 2]
    print(f"   챕터 {len(v_ch)}행 · 정렬 A→Z {'정상' if names == sorted(names, key=str.casefold) else '⚠ 어긋남'}")
    for c, _ in new_ch:
        if c in ch_blocked:
            continue
        hit = [r for r in v_ch if len(r) > 4 and str(r[2]).strip() == c]
        if not hit:
            print(f"   ⚠ {c}: 행을 찾지 못했다")
            ok = False
            continue
        r = hit[0]
        matched = not (r[3] == 0 and r[4] == 0)      # 둘 다 0 이면 매칭 실패
        print(f"   {'✓' if matched else '⚠'} {c}: RPI={r[3]} R=0%={r[4]} "
              f"{'매칭 정상' if matched else '**매칭 실패 의심**'}")
        ok &= matched
    v_rg = get(f"'지역 RPI'!A2:F{1 + len(rg_out)}", "UNFORMATTED_VALUE")
    for rg in new_rg:
        if rg in rg_blocked:
            continue
        hit = [r for r in v_rg if len(r) > 3 and str(r[1]).strip() == rg]
        r = hit[0] if hit else None
        matched = bool(r) and not (r[2] == 0 and r[3] == 0)
        print(f"   {'✓' if matched else '⚠'} {rg}: {r[2:4] if r else '행 없음'}")
        ok &= matched
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
