# 권한 모델 명세 (RPS Board)

## 권한 등급 (`AUTH_LEVELS`)

`shared/constants.ts` 에 정의.

| 등급 | 의미 | 관리자 여부 |
|---|---|---|
| `National` | 전국 총괄 | ✅ 관리자 |
| `Admin` | 지역/챕터 관리자 | ✅ 관리자 |
| `Growth` | 성장 담당 관리자 | ✅ 관리자 |
| `Member` | 일반 멤버 | ❌ 일반 |

관리자 판정 규칙: **`AUTH ∈ { National, Admin, Growth }` ⇒ 관리자, 그 외 ⇒ 일반.**
구현: `GoogleSheetsService.checkAdminPermission` (api/_lib/google-sheets.ts).

---

## 단일 진실 원천 (Single Source of Truth)

| 질문 | SSOT |
|---|---|
| "이 사용자가 관리자인가?" / "이 사용자의 권한 등급은?" | **RPS!Z열 (AUTH)** |
| "관리자 목록 UI에 표시할 대상은?" | **Auth 시트** (지역명 A · 담당자명 B · ID C · PW D · AUTH E) |

**결론**: 권한 판정은 RPS Z열이 절대 원천이고, Auth 시트는 "관리자 관리" UI의 보조 인덱스.  
두 원천은 **관리자 CRUD 흐름에서 원자적으로 함께 갱신**되어야 하며, drift가 생기면 `audit` 스크립트가 경고한다.

---

## Auth 시트 규칙

- **AUTH 는 관리자 tier (Admin/National/Growth) 중 하나.** Member 행이 섞이면 audit 경고.
- 이메일 기준 중복 금지 (upsert).
- 백엔드(`/api/admin/add-admin`)는 클라이언트가 보낸 auth 값을 무시하고 `Admin` 으로 강제 저장 (National/Growth 승격은 이 라우트가 아닌 별도 경로로 관리).
- 구현: `GoogleSheetsService.addAdminToSheet` + `syncAdminEntry` (api/_lib/google-sheets.ts).

---

## RPS 시트 Z열 규칙

- 모든 멤버는 정확히 한 값을 가진다: `National | Admin | Growth | Member`.
- 비어있는 행은 `Member` 로 간주하지 않는다 — **읽기 측에서 빈 값은 경고 대상**.
- Auth 시트에 등록된 이메일은 **반드시 RPS에 존재**해야 하며 Z열이 `National | Admin | Growth` 중 하나.

---

## 관리자 CRUD 동기화 흐름

### 추가 (`POST /api/admin/add-admin`)
1. Auth 시트에 upsert (AUTH=Admin 강제)
2. RPS 시트에 upsert (`upsertAdminRowInRPS`)
   - 기존 행 있으면 A~D, W~Z 갱신
   - 없으면 `addNewUser` 로 전체 행 신규 생성
3. `AdminLog` 시트에 감사 로그 기록

### 삭제 (`DELETE /api/admin/delete-admin`)
1. Auth 시트에서 해당 행 삭제
2. (현재 미구현) RPS Z열을 `Member`로 강등해야 함 — **개선 대상**

### 권한 변경 (`PUT /api/admin/update-user`)
- 현재는 일반 필드(region, chapter, memberName, industry, company, password) 만 수정
- **AUTH 변경 경로 부재** — 관리자로 승격/강등은 add-admin 또는 delete-admin 으로만 가능 — **개선 대상**

---

## 패스워드 저장 규칙

- 문자열 4자리 고정 ("0001" ~ "9999"). 앞자리 0 필수.
- 시트 셀 포맷: **`TEXT` 고정** (RPS!X:X, Auth!D:D). `set-pw-text-format.mjs` 로 일회 설정.
- 쓰기: Google Sheets API 호출 시 항상 `valueInputOption=RAW`.
- 읽기: 방어적으로 `padStart(4, '0')` 적용.

---

## 코드 위치 (api/_lib/ = canonical, server/ = re-export)

| 관심사 | 파일 |
|---|---|
| 권한 체크 | `api/_lib/google-sheets.ts → checkAdminPermission, getUserAuth` |
| 관리자 추가 | `api/_lib/google-sheets.ts → addAdminToSheet, upsertAdminRowInRPS` |
| 관리자 목록 | `api/_lib/google-sheets.ts → getAdminList` |
| 관리자 삭제 | `api/_lib/google-sheets.ts → deleteAdminFromSheet` |
| 라우트 | `api/_lib/routes.ts` |
| 상수 | `shared/constants.ts` (api/_lib/constants.ts, server/ 는 re-export) |

---

## 위반 사례 (과거 발생, 현재 수습 완료)

- `Auth!E22` 허재영 Member 중복 행 → 삭제 완료 (`cleanup-dup-admin.mjs`)
- `Auth!E24` 모니카 Member → Admin 교정 (`fix-monica.mjs`)
- `RPS!Z3242` 모니카 Member → Admin 교정
- PW 앞자리 0 손실 (USER_ENTERED 자동 숫자 변환) → RAW + TEXT 포맷으로 방지
