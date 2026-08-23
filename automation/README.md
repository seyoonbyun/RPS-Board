# automation — 신규 챕터 런칭 자동화

RPS Board 웹앱과 **별개로 로컬에서 도는 배치 스크립트**다. 배포되지 않는다.
신규 챕터가 런칭될 때 손으로 하던 일(멤버 명단 → 시트 → QR → 배너 → imweb 페이지)을 대신한다.

절차·의사결정 근거는 옵시디언 볼트 `03. Projects/Active/MyPowerteam/` 노트에 있다.
**이 README 는 "어떻게 돌리는가"만 다룬다.**

---

## 전체 흐름 — ① 신규 챕터 런칭

```
담당자: RPS Board /admin → 지역 & 챕터 관리 → [신규 챕터 런칭 신청] (네이티브 폼)
   ↓        `신청 접수` 탭에 `챕터 · 대기` 행이 생긴다
watcher.py   3분 폴링 · 결과 write-back
   ↓
pipeline.py  [1]명단 [2]시트 [3]QR [4]배너 [5]imweb [6]검증   ← 게시 직전까지
   ↓         단계마다 이메일, 시작·완료·오류는 문자
사람이 imweb 편집기에서 확인하고 **게시**   ← 자동화하지 않는다
   ↓
finalize.py  담당자 문자 + 게시판 결과 게시 + 상태 정리 + 완료 보고
```

## 전체 흐름 — ② 신규 **지역** 등록  (2026-08-23 신설)

예전엔 어드민의 `새 지역 추가` 가 **모 시트에 한 줄 넣는 것이 전부**였다. 지역이 실제로
쓰이려면 RPS 시트·RPI 집계 행·QR·지역 로고·imweb ALL/지역 페이지가 다 있어야 하는데,
그것들은 **신규 챕터가 런칭할 때만** 곁다리로 만들어졌다 — 그래서 파이프라인 이전에
런칭한 **안양이 `지역 RPI` 에 넉 달간 없었다**.

```
담당자: RPS Board /admin → 지역 & 챕터 관리 → 새 지역 등록 (영문명·한글명)
   ↓        `신청 접수` 탭에 `지역 · 대기` 행 + 대장에 `지역등록 · 접수` 행
   ↓        (지역 PW = 랜덤 4자리도 여기서 정해 남긴다)
region_watch.py     3분마다 폴링 → 대기 건 1개씩
   ↓
region_pipeline.py  [1]시트 [2]RPI [3]QR [4]로고 [5]imweb [6]검증 [7]비번기록
   ↓
사람이 imweb 편집기에서 확인하고 **게시**   ← 자동화하지 않는다
```

**왜 웹앱이 직접 안 만드는가** — imweb 쓰기는 사람이 로그인해 둔 **Playwright 영구
프로필**로만 된다. Vercel 서버리스에는 그 브라우저가 없다. 그래서 접수는 웹앱이,
생성은 이 로컬 워커가 맡는다.

## 전체 흐름 — ③ 게시판(Admin Board) 문의  (2026-08-23 신설)

```
담당자: RPS Board /admin → 게시판에 문의 등록
   ↓        웹앱이 `BoardLog` + 대장 `rps new account` 에 행을 연다
board_watch.py     3분마다 폴링
   ↓
문의자 → "문의가 접수되었습니다" 문자      나 → "이런 문의가 있다" 문자
   ↓
내가 게시판에 **답변**을 달면
   ↓
문의자 → 답변 내용 문자 · 대장 행이 `완료` + `개선내용`·`답신내용` 기록
```

⚠ 게시판에는 연락처가 없었다 → **`담당자 연락처`** 탭을 신설했다(정본은 여기 하나).
   담당자가 게시판에 처음 글을 쓸 때 한 번만 입력받아 저장한다.
   **글 본문에는 남기지 않는다** — 본문에 남기면 확인 후 지워야 하고, 잊으면
   전 지역 담당자에게 보인다(2026-08-02 에 그래서 되돌렸다).

## 탭 네 개가 하는 일

| 탭 | 성격 | 누가 쓰나 |
|---|---|---|
| `신청 접수` | **입구** — 무엇을 요청했나 (지역·챕터 공통) | 웹앱 폼 · `intake.py` |
| `rps new account` | **처리 대장** — 어디까지 됐고 문자가 나갔나 | 웹앱 · `proclog.py` |
| `담당자 연락처` | **문자 수신처 정본** | 웹앱 · `contacts.py` |
| `_목록` (숨김) | 드롭다운 원본 (`Master` 에서 복사) | `dropdowns.py` |

입구와 대장을 **일부러 나눴다.** 신청서는 사람이 쓴 원본이라 손대면 안 되고,
처리 경과는 워커가 계속 덮어쓴다. 한 표에 두면 둘 중 하나가 반드시 뭉개진다.
둘은 같은 키(`지역 <Eng> <Kor>` · `게시판 #<행번호>`)로 이어진다.

⚠ **`Master` A열(지역)·B열(챕터) 은 짝이 아니라 각각 독립된 목록이다.**
   예전엔 챕터를 만들 때마다 `[지역, 챕터]` 한 행을 통째로 붙여서 **지역이 A열에 계속
   쌓였다**(2026-08-23 정리 시점 30칸 중 8칸이 중복 → 드롭다운에 같은 지역이 두 번).
   지금은 각 열의 첫 빈 칸에만 쓴다.

## 한 곳에 모인다 — `rps new account`

모 시트 `MY PowerTeam (archive)` 의 탭. **건당 1행**이고 진행에 따라 같은 행을 갱신한다.

| A 접수일시 | B 흐름 | C 대상(키) | D 담당자 | E 이메일 | F 연락처 | G 내용 |
| H 처리현황 | I 개선내용 | J 처리일시 | K 문자-접수 | L 문자-완료 | M 답신내용 | N 진행로그 | O 최종수정 |

`대상`(C) 이 키다 — 게시판 `게시판 #<BoardLog 행번호>` · 지역 `지역 <Eng> <Kor>`.
웹앱(`api/_lib/google-sheets.ts` `openProcessRow`)과 워커(`proclog.py`)가 **같은 탭·같은
열**에 쓴다. 열을 바꾸면 양쪽을 같이 고칠 것.

```bash
python proclog.py            # 처리 대장
python intake.py             # 신청 접수 현황
python contacts.py --missing # 연락처 없는 담당자
python dropdowns.py          # 드롭다운이 현황과 맞는지 (--apply 로 갱신)
```

## 파일

| 구분 | 파일 | 하는 일 |
|---|---|---|
| **지휘** | `watcher.py` | 챕터 신청 폴링 → pipeline 실행 → `신청 접수` write-back |
| | `pipeline.py` | 챕터 런칭 1건의 6단계 |
| | `finalize.py` | 게시 후 마무리 |
| **입구** | `intake.py` | `신청 접수` 탭 읽기·쓰기 (지역·챕터 공통) |
| | `intake_ack.py` | 신청 접수 즉시 담당자에게 확인 문자 (멱등) |
| | `contacts.py` | `담당자 연락처` 탭 — 문자 수신처 정본 |
| | `dropdowns.py` | `신청 접수` 지역·챕터 드롭다운을 현황에 맞춘다 |
| **지역 등록** | `region_watch.py` | 지역 신청 폴링 → region_pipeline 실행 → 대장 기록 |
| | `region_pipeline.py` | 지역 1건의 7단계 (챕터와 무관하게 단독) |
| **게시판** | `board_watch.py` | 새 문의·답변 감지 → 문자 발송 → 대장 기록 |
| **마무리** | `publish_watch.py` | 게시 감지 → 담당자 통보 + 게시판 결과 글 + 상태 정리 |
| **대장** | `proclog.py` | `rps new account` 탭 읽기·쓰기 (건당 1행, 갱신형) |
| **스케줄** | `watch_run.cmd` | 위 워처들을 3분마다 (Windows 작업 `RPS Board Admin Watch`) |
| **폐기** | `airtable_client.py` `airtable_setup.py` | ⛔ 2026-08-23 은퇴. 스키마 참고용으로만 남긴다 |
| **단계** | `roster_gen.py` | [1] BNI Connect 추출 → 모 시트 멤버 append |
| | `sheet_gen.py` | [2] 챕터·지역 RPS 구글시트 생성 |
| | `rpi_sheet.py` | [2-b] `RPI : BNI K. All` 집계 시트에 챕터·지역 행 추가 |
| **감시** | `rpi_watch.py` | 어드민 챕터 삭제 감지 → RPI 시트 행 제거 + 이메일 보고 (1시간 스케줄) |
| | `qr_gen.py` | [3] bitly 단축링크 + 브랜드 QR |
| | `banner_gen.py` | [4] 챕터 카드 500×500 · 지역 로고 |
| | `imweb_client.py` | [5] imweb 내부 API 래퍼 |
| **공용** | `paths.py` | 자격증명·작업 폴더 경로 (여기서만 정한다) |
| | `google_auth.py` | 구글 OAuth(소유계정) / 서비스계정 |
| | `notify.py` | 이메일(웹훅 릴레이) · 문자(솔라피) |
| **유지보수** | `verify_master.py` | 모 시트 전수 검수 |
| | `cf_fix.py` | 조건부서식 정본화 |
| | `fix_pw.py` | PW 앞자리 0 복구 |
| | `find_orphans.py` `clean_orphans.py` | 고아 데이터 탐지·제거 |

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
python intake.py                # 접수 현황
python notify.py                # 알림 경로 표시 (발송 안 함)
```

## 실행

```bash
python watcher.py                  # 접수 확인만
python watcher.py --run            # dry-run — 무엇을 할지만 찍는다
python watcher.py --run --apply    # 실제 생성 (게시는 안 한다)

# 게시를 마친 뒤
python finalize.py                          # 마무리 대기 목록
python finalize.py --record 5               # 보낼 문구 확인 (`신청 접수` 행번호)
python finalize.py --record 5 --apply       # 실제 발송·게시
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

## 상시 워처 (3분마다)

`watch_run.cmd` 가 여섯 단계를 이 순서로 돌린다 — **접수 알림 → 생성 → 마무리** 순이다.

```
intake_ack     신청 접수 → 담당자 "접수되었습니다" 문자
board_watch    게시판 문의 → 문자 + 대장
region_watch   지역 신청  → 시트·RPI·QR·로고·imweb
watcher        챕터 신청  → 런칭 파이프라인 전 단계
publish_watch  게시 감지  → 담당자 통보 + 게시판 결과 글 + 상태 종료
dropdowns      지역·챕터 드롭다운 현행화
```

**사람이 하는 것은 둘뿐이다** — ① 로그인(imweb·BNI Connect) ② 게시 전 확인·게시 클릭.

```bash
python intake_ack.py                 # dry-run
python publish_watch.py              # 게시됐는지만 확인
python board_watch.py                # dry-run — 무엇을 보낼지만
python board_watch.py --apply        # 실제 문자 + 대장 기록
python board_watch.py --replay 5     # 최근 5건 재검토 (커서는 안 옮긴다)

python region_watch.py               # 대기 건 확인만
python region_watch.py --run         # dry-run
python region_watch.py --run --apply # 실제 생성 (게시는 사람이)

python watcher.py --run --apply      # 챕터 런칭 (스케줄에도 들어 있다)
python dropdowns.py --apply          # 지역·챕터 드롭다운 현행화
```

### 담당자에게 가는 문자는 **두 통뿐**이다

접수 1통(`intake_ack`) · 게시완료 1통(`publish_watch`). 생성이 끝난 시점엔 공개
사이트가 아직 404 라, 그때 알려 봐야 담당자가 링크를 눌러도 안 열린다.
중간 경과(생성 완료·오류·로그인 대기)는 **나에게만** 간다.

### ⚠ 공개 사이트는 `python-requests` 를 403 으로 막는다

게시 판정(`publish_watch.is_published`)에 **브라우저 User-Agent 를 반드시 준다.**
안 주면 게시된 페이지도 전부 `판정 불가` 가 되어 마무리가 영영 안 돈다.
curl 로는 되는데 스크립트로는 안 되는 종류라 눈치채기 어렵다.

### ⚠ 내셔널이 쓴 `요청` 은 문의가 아니다

`publish_watch` 가 결과 글을 게시판에 자동으로 올리는데, 그것을 `board_watch` 가
새 문의로 잡으면 **나에게 "이런 문의가 있다" 문자가 오고 나 자신에게 접수 안내가 간다.**
`board_watch` 는 `role=National` 의 `요청` 을 공지로 보고 건너뛴다.

Windows 작업 스케줄러 **`RPS Board Admin Watch`** 가 `watch_run.cmd` 를 3분마다 돌린다.
로그는 `automation/watch_run.log` (**UTF-8 로 읽을 것**).

```powershell
Get-ScheduledTaskInfo -TaskName "RPS Board Admin Watch"
Get-Content "C:\DEV\RPS-Board\automation\watch_run.log" -Encoding UTF8 -Tail 20
```

### ⛔ 문자는 기본이 **테스트 모드**다

`send_sms` 는 수신번호가 무엇이든 **관리자 번호로 돌린다**(본문 첫 줄에 원래 수신처를
붙여서). 실수의 방향을 "안 갔다" 로 몰아두기 위한 것이다 — 잘못 간 문자는 회수할 수 없다.

실발송으로 바꾸려면 작업 스케줄러 환경에 **`MYPT_SMS_LIVE=1`** 을 준다.
현재 상태는 `python notify.py` 가 `모드 :` 줄에 찍는다.

### ⚠ 작업 스케줄러 함정 — `StopOnIdleEnd`

기본값이 켜져 있어 **PC 가 유휴 상태를 벗어나는 순간 실행 중인 작업에 Ctrl+C 를 보낸다.**
증상은 "로그에 헤더만 찍히고 아무 일도 안 일어남" + `LastTaskResult 3221225786`(0xC000013A).
파이썬 출력이 버퍼링되면 흔적조차 안 남으니 `python -u` 로 돌린다.
작업 XML 에 아래가 **반드시** 있어야 한다.

```xml
<IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
```

`New-ScheduledTaskSettingsSet` 로 만들면 이 값이 안 들어간다 — **XML 로 등록할 것.**

### ⚠ `watch_run.cmd` 는 ASCII·CRLF 만

cmd.exe 는 이 파일을 OEM 코드페이지로 읽는다. **주석에 한글 한 글자만 들어가도 배치가
통째로 죽는다**(2026-08-23 실제로 그랬다 — 로그가 0바이트, `LastTaskResult 255`).
줄바꿈도 CRLF 여야 한다. 편집은 `Set-Content -Encoding ascii` 로.

## 안전장치 (일부러 이렇게 해 둔 것)

- **게시는 사람이 한다.** 게시 전까지 공개 사이트는 404 라 대외 노출이 없다.
- **챕터 영문명을 추측하지 않는다.** BNI Connect 추출에서 역산하고, 신규 후보가
  정확히 1개일 때만 확정한다. 오기가 시트명·QR 슬러그·페이지 url 에 전부 번진다.
- **지역명 표기가 세 곳에서 다르다**(모 시트 `Suwon1 수원1` / imweb `수원` / 파일명).
  자동 매칭하지 않고 경고만 한다 — 잘못 판단하면 지역·ALL 페이지를 통째로 새로 만든다.
- **imweb 쓰기는 되돌리기 API 가 없다.** 시작할 때 `menu_list` 스냅샷을 남긴다.
- **bitly QR 은 만들면 API 로 못 지운다**(커스텀 슬러그). 테스트에서 QR 부터 만들지 말 것.
- `--apply` 없이 실행하면 **아무것도 만들지 않는다**(기본이 dry-run).
