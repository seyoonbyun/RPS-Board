// 권한 레벨 상수 정의 - 하드코딩 방지
export const AUTH_LEVELS = {
  NATIONAL: 'National',
  ADMIN: 'Admin', 
  GROWTH: 'Growth',
  MEMBER: 'Member'
} as const;

export type AuthLevel = typeof AUTH_LEVELS[keyof typeof AUTH_LEVELS];

// 사용자 상태 상수 정의
export const USER_STATUS = {
  ACTIVE: '활동중',
  WITHDRAWN: '탈퇴'
} as const;

export type UserStatus = typeof USER_STATUS[keyof typeof USER_STATUS];

// 파트너 단계 상수 정의
export const PARTNER_STAGES = {
  VISIBILITY: 'Visibility : 아는단계',
  CREDIBILITY: 'Credibility : 신뢰단계',
  PROFIT: 'Profit : 수익단계'
} as const;

export type PartnerStage = typeof PARTNER_STAGES[keyof typeof PARTNER_STAGES];

// 단축 형태 매핑
export const STAGE_SHORT_TO_FULL = {
  V: PARTNER_STAGES.VISIBILITY,
  C: PARTNER_STAGES.CREDIBILITY,
  P: PARTNER_STAGES.PROFIT
} as const;

// Google Sheets 컬럼 헤더 상수 - 컬럼명 변경 시 한 곳에서 관리
export const SHEET_COLUMNS = {
  EMAIL: '이메일',
  REGION: '지역',
  CHAPTER: '챕터',
  MEMBER_NAME: '멤버명',
  INDUSTRY: '산업군',
  COMPANY: '회사',
  SPECIALTY: '전문분야',
  TARGET_CUSTOMER: '나의 핵심 고객층',
  RPARTNER_1: ' R파트너 1',
  RPARTNER_1_SPECIALTY: ' R파트너 1 : 전문분야 ',
  RPARTNER_1_STAGE: ' R파트너 1 : V-C-P',
  RPARTNER_2: 'R파트너 2',
  RPARTNER_2_SPECIALTY: ' R파트너 2 :  전문분야 ',
  RPARTNER_2_STAGE: ' R파트너 2 : V-C-P',
  RPARTNER_3: 'R파트너 3',
  RPARTNER_3_SPECIALTY: ' R파트너 3 : 전문분야 ',
  RPARTNER_3_STAGE: ' R파트너 3 : V-C-P',
  RPARTNER_4: 'R파트너 4',
  RPARTNER_4_SPECIALTY: ' R파트너 4 : 전문분야 ',
  RPARTNER_4_STAGE: ' R파트너 4 : V-C-P',
  TOTAL_PARTNERS: '총 R파트너 수',
  ACHIEVEMENT: '달성',
  ID: 'ID',
  PASSWORD: 'PW',
  STATUS: 'STATUS',
  AUTH: 'AUTH'
} as const;

// UI 메시지 상수 - 다국어 대응 준비
export const UI_MESSAGES = {
  ADMIN_ACCESS_DENIED: '관리자 권한이 필요합니다.',
  WITHDRAWAL_COMPLETED: '탈퇴 처리 완료',
  WITHDRAWAL_FAILED: '탈퇴 실패',
  WITHDRAWAL_PROCESSING_ERROR: '탈퇴 처리 중 오류가 발생했습니다.',
  NO_WITHDRAWAL_TARGETS: '탈퇴 대상 없음',
  USER_ALREADY_DELETED: '이미 삭제되었거나 존재하지 않는 사용자입니다.',
  WITHDRAWAL_HISTORY_ERROR: '탈퇴 히스토리를 가져올 수 없습니다',
  USER_LIST_ERROR: '사용자 목록을 가져올 수 없습니다'
} as const;

// API 엔드포인트 상수
export const API_ENDPOINTS = {
  GOOGLE_OAUTH2_TOKEN: 'https://oauth2.googleapis.com/token',
  REPLIT_SIDECAR: 'http://127.0.0.1:1106'
} as const;

// Google Sheets 컬럼 인덱스 상수 - 하드코딩 방지
export const SHEET_COLUMN_INDICES = {
  EMAIL: 0,           // A열: 이메일
  REGION: 1,          // B열: 지역
  CHAPTER: 2,         // C열: 챕터
  MEMBER_NAME: 3,     // D열: 멤버명
  INDUSTRY: 4,        // E열: 산업군
  COMPANY: 5,         // F열: 회사
  SPECIALTY: 6,       // G열: 전문분야
  TARGET_CUSTOMER: 7, // H열: 나의 핵심 고객층
  RPARTNER_1: 8,      // I열: R파트너 1
  RPARTNER_1_SPECIALTY: 9,  // J열: R파트너 1 전문분야
  RPARTNER_1_STAGE: 10,     // K열: R파트너 1 단계
  RPARTNER_2: 11,     // L열: R파트너 2
  RPARTNER_2_SPECIALTY: 12, // M열: R파트너 2 전문분야
  RPARTNER_2_STAGE: 13,     // N열: R파트너 2 단계
  RPARTNER_3: 14,     // O열: R파트너 3
  RPARTNER_3_SPECIALTY: 15, // P열: R파트너 3 전문분야
  RPARTNER_3_STAGE: 16,     // Q열: R파트너 3 단계
  RPARTNER_4: 17,     // R열: R파트너 4
  RPARTNER_4_SPECIALTY: 18, // S열: R파트너 4 전문분야
  RPARTNER_4_STAGE: 19,     // T열: R파트너 4 단계
  TOTAL_PARTNERS: 20, // U열: 총 R파트너 수
  ACHIEVEMENT: 21,    // V열: 달성
  ID: 22,             // W열: ID
  PASSWORD: 23,       // X열: PW
  STATUS: 24,         // Y열: STATUS
  AUTH: 25            // Z열: AUTH
} as const;

// 비즈니스 로직 상수
export const BUSINESS_CONFIG = {
  PARTNER_TARGET: 4,          // 목표 파트너 수
  ACHIEVEMENT_PERIOD_YEARS: 2, // 달성 목표 기간(년)
  MAX_PARTNERS: 4             // 최대 파트너 수
} as const;

// 캐시 및 타이밍 설정 상수
export const CACHE_CONFIG = {
  ADMIN_PERMISSION_STALE_TIME: 60000,    // 1분 - 관리자 권한 캐시
  SHEETS_DATA_STALE_TIME: 300000,        // 5분 - 시트 데이터 캐시
  REALTIME_REFRESH_INTERVAL: 30000,      // 30초 - 실시간 새로고침 (800명 동시접속 대응)
  ADMIN_REFRESH_INTERVAL: 30000,         // 30초 - 관리자 패널 새로고침
  FAST_REFRESH_INTERVAL: 3000,           // 3초 - 빠른 새로고침
  NO_CACHE: 0,                           // 캐시 없음
  TOAST_DURATION: 3000,                  // 3초 - 토스트 지속시간
  LONG_TOAST_DURATION: 5000,             // 5초 - 긴 토스트 지속시간
  EXTRA_LONG_TOAST_DURATION: 6000        // 6초 - 매우 긴 토스트 지속시간
} as const;

// AI 모델 설정 상수
export const AI_CONFIG = {
  GEMINI_MODEL: 'gemini-2.5-flash',
  GEMINI_PRO_MODEL: 'gemini-2.5-pro',
  GEMINI_IMAGE_MODEL: 'gemini-2.0-flash-preview-image-generation'
} as const;

// 브랜드 컬러 상수
export const BRAND_COLORS = {
  PRIMARY: '#d12031',          // BNI Korea 메인 컬러
  PRIMARY_LIGHT: '#f5c2c7',    // 연한 빨강 (테두리용)
  PRIMARY_BACKGROUND: '#fef2f2' // 매우 연한 빨강 (배경용)
} as const;

// 서버 포트 및 네트워크 설정 상수
export const NETWORK_CONFIG = {
  DEFAULT_PORT: 5000,           // 기본 서버 포트
  REPLIT_SIDECAR_PORT: 1106,    // Replit Sidecar 포트
  TIMEOUT_DEFAULT: 10000,       // 기본 타임아웃 (10초)
  TIMEOUT_SHORT: 5000,          // 짧은 타임아웃 (5초)
  TIMEOUT_MEDIUM: 30000,        // 중간 타임아웃 (30초)
  REPLIT_SIDECAR_HOST: '127.0.0.1'
} as const;

// 파일 및 데이터 크기 제한 상수
export const FILE_CONFIG = {
  MAX_FILE_SIZE_5MB: 5 * 1024 * 1024,     // 5MB
  MAX_FILE_SIZE_10MB: 10 * 1024 * 1024,   // 10MB  
  SHEETS_MAX_ROWS: 5000,                  // Google Sheets 최대 행 수
  HISTORY_MAX_ENTRIES: 50,                // 히스토리 최대 항목 수
  BUSINESS_SEARCH_LIMIT: 10,              // 업체 검색 결과 제한
  SEARCH_TERMS_LIMIT: 15                  // 검색어 최대 개수
} as const;

// UI 레이어 (Z-Index) 상수
export const UI_LAYERS = {
  MODAL_OVERLAY: 9999,         // 모달 오버레이
  MODAL_CONTENT: 10000,        // 모달 콘텐츠
  TOAST: 999999,               // 토스트 알림
  ALERT_DIALOG_OVERLAY: 9999,  // 알럿 다이얼로그 오버레이
  ALERT_DIALOG_CONTENT: 10000  // 알럿 다이얼로그 콘텐츠
} as const;

// 기본값 상수
export const DEFAULT_VALUES = {
  PASSWORD: '1234',            // 기본 비밀번호
  JWT_EXPIRY_HOURS: 1,         // JWT 토큰 만료 시간 (시간)
  TOKEN_BUFFER_MINUTES: 1,     // 토큰 갱신 버퍼 (분)
  MAX_SEARCH_RESULTS_PER_CATEGORY: 3,  // 카테고리별 최대 검색 결과
  ANALYSIS_MIN_LENGTH: 800,    // AI 분석 최소 길이
  ANALYSIS_MAX_LENGTH: 1000,   // AI 분석 최대 길이
  MAX_OUTPUT_TOKENS: 1000      // AI 최대 출력 토큰
} as const;

// Google Sheets 설정 상수
export const SHEETS_CONFIG = {
  SPREADSHEET_ID: '1JM37uOEu64D0r6zzKggOsA9ZdcK4wBCx0rpuNoVcIYg',
  WORKSHEET_NAME: 'RPS',
  RANGE_FULL: 'A1:Z5000',      // 전체 범위
  RANGE_PARTIAL: 'A1:Y5000',   // 부분 범위
  RANGE_EMAIL_ONLY: 'A1:A5000' // 이메일만
} as const;

// Google Sheets API Rate Limiting 및 동시성 제어 상수
export const API_RATE_LIMITS = {
  // Google Sheets API 공식 제한: 100 requests per 100 seconds per user
  MAX_REQUESTS_PER_WINDOW: 200,       // 200 req/100s (Google 한도 300/min 내, 800명 대응)
  RATE_LIMIT_WINDOW_MS: 100000,       // 100초 윈도우

  // 동시 요청 제어
  MAX_CONCURRENT_REQUESTS: 50,        // 최대 50개 동시 요청 (800명 동시접속 대응)

  // Retry 설정
  MAX_RETRY_ATTEMPTS: 3,              // 최대 3번 재시도
  RETRY_DELAY_MS: 1000,               // 1초 대기 후 재시도
  RETRY_BACKOFF_MULTIPLIER: 2,        // 지수 백오프 (1초 -> 2초 -> 4초)

  // 요청 타임아웃
  REQUEST_TIMEOUT_MS: 60000,          // 60초 타임아웃 (100명 큐 대기 여유)

  // 큐 관리
  QUEUE_CLEANUP_INTERVAL_MS: 60000,   // 1분마다 큐 정리
  MAX_QUEUE_SIZE: 2000                // 최대 큐 크기 (800명 동시접속 대응)
} as const;

// Google Sheets 읽기 캐시 설정
export const SHEET_CACHE_CONFIG = {
  READ_CACHE_TTL_MS: 300000,          // 5분 캐시 TTL (800명 동시접속 시 시트 API 호출 대폭 감소)
  MAX_CACHE_ENTRIES: 50,              // 최대 캐시 항목 수
} as const;