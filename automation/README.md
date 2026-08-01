# automation — 신규 챕터 런칭 자동화

RPS Board 웹앱과 **별개로 로컬에서 도는 배치 스크립트**다. 배포되지 않는다.
신규 챕터가 런칭될 때 손으로 하던 일(멤버 명단 → 시트 → QR → 배너 → imweb 페이지)을 대신한다.

절차·의사결정 근거는 옵시디언 볼트 `03. Projects/Active/MyPowerteam/` 노트에 있다.
**이 README 는 "어떻게 돌리는가"만 다룬다.**

---

## 전체 흐름

```
담당자: RPS Board /admin → 지역 & 챕터 관리 → [신규 챕터 런칭 신청] → Airtable 폼
   ↓
watcher.py   Airtable 폴링 · 중복 차단 · 결과 write-back
   ↓
pipeline.py  [1]명단 [2]시트 [3]QR [4]배너 [5]imweb [6]검증   ← 게시 직전까지
   ↓         단계마다 이메일, 시작·완료·오류는 문자
사람이 imweb 편집기에서 확인하고 **게시**   ← 자동화하지 않는다
   ↓
finalize.py  담당자 문자 + 게시판 결과 게시 + 상태 정리 + 완료 보고
```

## 파일

| 구분 | 파일 | 하는 일 |
|---|---|---|
| **지휘** | `watcher.py` | 신청 폴링 → pipeline 실행 → Airtable 기록 |
| | `pipeline.py` | 런칭 1건의 6단계 |
| | `finalize.py` | 게시 후 마무리 |
| **단계** | `roster_gen.py` | [1] BNI Connect 추출 → 모 시트 멤버 append |
| | `sheet_gen.py` | [2] 챕터·지역 RPS 구글시트 생성 |
| | `rpi_sheet.py` | [2-b] `RPI : BNI K. All` 집계 시트에 챕터·지역 행 추가 |
| | `qr_gen.py` | [3] bitly 단축링크 + 브랜드 QR |
| | `banner_gen.py` | [4] 챕터 카드 500×500 · 지역 로고 |
| | `imweb_client.py` | [5] imweb 내부 API 래퍼 |
| **공용** | `paths.py` | 자격증명·작업 폴더 경로 (여기서만 정한다) |
| | `google_auth.py` | 구글 OAuth(소유계정) / 서비스계정 |
| | `airtable_client.py` | 접수 테이블 읽기·쓰기 |
| | `notify.py` | 이메일(웹훅 릴레이) · 문자(솔라피) |
| **유지보수** | `verify_master.py` | 모 시트 전수 검수 |
| | `cf_fix.py` | 조건부서식 정본화 |
| | `fix_pw.py` | PW 앞자리 0 복구 |
| | `find_orphans.py` `clean_orphans.py` | 고아 데이터 탐지·제거 |
| | `airtable_setup.py` | Airtable 테이블 생성 (1회성) |

`assets/` 는 배너 생성 재료(카드 템플릿·지역 로고)라 저장소에 포함한다.

---

## 준비

```bash
pip install requests google-api-python-client google-auth-oauthlib playwright pillow openpyxl
python -m playwright install chromium
```

**자격증명은 저장소에 없다.** 볼트 `99. private/MyPowerteam app secret/` 의 파일을
자격증명 폴더에 복사한다(그 폴더의 `00_읽어주세요` 참조). 경로가 다르면 환경변수로:

```powershell
setx MYPT_CRED_DIR    "D:\...\connect"      # 자격증명
setx MYPT_WORK_DIR    "D:\...\mypowerteam"  # 결과물·부산물 (기본: desktop\connect_tl_report\mypowerteam)
setx MYPT_ARCHIVE_DIR "G:\내 드라이브\MyPowerteam"
```

확인:
```bash
python paths.py                 # 6개 항목이 전부 ✓
python imweb_client.py --login  # imweb 은 쿠키를 파일로 못 옮긴다 — 사람이 1회
python airtable_client.py       # 접수 현황
python notify.py                # 알림 경로 표시 (발송 안 함)
```

## 실행

```bash
python watcher.py                  # 접수 확인만
python watcher.py --run            # dry-run — 무엇을 할지만 찍는다
python watcher.py --run --apply    # 실제 생성 (게시는 안 한다)

# 게시를 마친 뒤
python finalize.py                          # 마무리 대기 목록
python finalize.py --record recXXXX         # 보낼 문구 확인
python finalize.py --record recXXXX --apply # 실제 발송·게시
```

**신규 지역이면 지역 PW 4자리가 필요하다**(챕터는 런칭일 MMDD 규칙이지만 지역은 규칙이 없다).
없이 실행하면 ALL 페이지가 무보호로 만들어지므로 **실행 전에 막아 둔다**:

```bash
python pipeline.py --kor <한글> --region <Eng> --region-kor <imweb 이름> \
                   --launch YYYY-MM-DD --region-pw 1234 --apply --notify
```

**소급 건**(명단이 이미 모 시트에 있는 경우)은 `--skip-roster` 와
`--chapter <영문명>` 을 함께 준다. 시트도 이미 있으면 `--chapter-sheet <URL>` 로 넘긴다.

---

## 안전장치 (일부러 이렇게 해 둔 것)

- **게시는 사람이 한다.** 게시 전까지 공개 사이트는 404 라 대외 노출이 없다.
- **챕터 영문명을 추측하지 않는다.** BNI Connect 추출에서 역산하고, 신규 후보가
  정확히 1개일 때만 확정한다. 오기가 시트명·QR 슬러그·페이지 url 에 전부 번진다.
- **지역명 표기가 세 곳에서 다르다**(모 시트 `Suwon1 수원1` / imweb `수원` / 파일명).
  자동 매칭하지 않고 경고만 한다 — 잘못 판단하면 지역·ALL 페이지를 통째로 새로 만든다.
- **imweb 쓰기는 되돌리기 API 가 없다.** 시작할 때 `menu_list` 스냅샷을 남긴다.
- **bitly QR 은 만들면 API 로 못 지운다**(커스텀 슬러그). 테스트에서 QR 부터 만들지 말 것.
- `--apply` 없이 실행하면 **아무것도 만들지 않는다**(기본이 dry-run).
