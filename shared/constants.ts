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
  GOOGLE_OAUTH2_TOKEN: process.env.GOOGLE_OAUTH2_TOKEN_URL || 'https://oauth2.googleapis.com/token',
  REPLIT_SIDECAR: process.env.REPLIT_SIDECAR_ENDPOINT || 'http://127.0.0.1:1106'
} as const;