// 산업 호환성 기반 파트너 추천 엔진
import { GoogleSheetsService } from './google-sheets.js';

export interface IndustryCompatibility {
  industry: string;
  compatibleIndustries: string[];
  synergy: 'high' | 'medium' | 'low';
  description: string;
}

export interface BusinessSynergyRecommendation {
  memberName: string;
  email: string;
  industry: string;
  company: string;
  specialty: string;
  targetCustomer: string;
  region: string;
  chapter: string;
  synergyScore: number;
  synergyType: 'perfect-match' | 'high-potential' | 'growth-opportunity' | 'new-market';
  businessValue: string;
  collaborationOpportunities: string[];
  targetMarketAlignment: number;
  currentStage?: 'V' | 'C' | 'P' | 'none';
}

export interface RecommendationFilters {
  region?: string;
  chapter?: string;
  minCompatibilityScore?: number;
  excludeCurrentPartners?: boolean;
  maxResults?: number;
}

export class PartnerRecommendationEngine {
  private googleSheetsService: GoogleSheetsService;
  
  // 비즈니스 확장을 위한 시너지 매트릭스 (타겟 고객 기반)
  private businessSynergyMatrix = {
    // 대기업 타겟 고객층을 위한 시너지 업종
    '대기업': {
      complementary: ['컨설팅', '법무', '회계', 'IT솔루션', '마케팅', '디자인', '교육', '보안'],
      description: '대기업 클라이언트 서비스를 위한 전문 서비스 네트워크'
    },
    '중소기업': {
      complementary: ['마케팅', '회계', '법무', 'IT', '디자인', '물류', '교육', '보험'],
      description: '중소기업 성장을 위한 종합 비즈니스 솔루션'
    },
    '스타트업': {
      complementary: ['마케팅', 'IT개발', '디자인', '법무', '회계', '투자', '교육', '멘토링'],
      description: '스타트업 생태계 지원을 위한 창업 서비스 네트워크'
    },
    '개인사업자': {
      complementary: ['마케팅', '세무', '법무', '디자인', '교육', '보험', 'IT', '물류'],
      description: '개인사업자 성공을 위한 실무 지원 서비스'
    },
    '일반소비자': {
      complementary: ['마케팅', '디자인', '교육', '건강', '금융', '보험', '여행', '부동산'],
      description: 'B2C 시장 확장을 위한 라이프스타일 서비스 네트워크'
    },
    '병원': {
      complementary: ['의료기기', '보험', '법무', 'IT', '마케팅', '교육', '컨설팅', '부동산'],
      description: '의료 서비스 고도화를 위한 전문 파트너십'
    },
    '학교': {
      complementary: ['교육', 'IT', '급식', '보안', '건설', '디자인', '법무', '보험'],
      description: '교육 환경 개선을 위한 종합 서비스'
    },
    '정부기관': {
      complementary: ['컨설팅', 'IT', '법무', '보안', '교육', '건설', '환경', '마케팅'],
      description: '공공 서비스 향상을 위한 전문 솔루션'
    }
  };

  // 업종별 핵심 서비스 매트릭스
  private industryServiceMatrix = {
    '마케팅': ['브랜딩', '광고', 'SNS', '콘텐츠', '전략기획'],
    '디자인': ['브랜딩', 'UI/UX', '패키지', '인테리어', '웹디자인'],
    'IT': ['솔루션개발', '웹개발', '앱개발', '시스템구축', '보안'],
    '컨설팅': ['경영컨설팅', '전략기획', '프로세스개선', '조직개발', '변화관리'],
    '법무': ['계약', '지적재산권', '준법감시', '소송', '기업법무'],
    '회계': ['세무', '재무관리', '감사', '급여', '경영분석'],
    '부동산': ['매매', '임대', '개발', '투자', '관리'],
    '건설': ['시공', '설계', '감리', '인테리어', '리모델링'],
    '금융': ['대출', '투자', '보험', '자산관리', '핀테크'],
    '교육': ['기업교육', '온라인교육', '자격증', '어학', '전문교육']
  };

  constructor(googleSheetsService: GoogleSheetsService) {
    this.googleSheetsService = googleSheetsService;
  }

  // 비즈니스 시너지 점수 계산 (타겟 고객층 + 전문분야 기반)
  private calculateBusinessSynergyScore(
    userTargetCustomer: string,
    userSpecialty: string,
    candidateTargetCustomer: string,
    candidateSpecialty: string
  ): { score: number; alignment: number } {
    let synergyScore = 0;
    let targetAlignment = 0;

    // 1. 타겟 고객층 일치도 분석
    const userTargets = this.extractTargetSegments(userTargetCustomer);
    const candidateTargets = this.extractTargetSegments(candidateTargetCustomer);
    
    // 공통 타겟 고객층 확인
    const commonTargets = userTargets.filter(target => 
      candidateTargets.some(candidateTarget => 
        this.isTargetMatch(target, candidateTarget)
      )
    );

    if (commonTargets.length > 0) {
      targetAlignment = Math.min(100, (commonTargets.length / userTargets.length) * 100);
      synergyScore += 40; // 기본 점수
    }

    // 2. 보완적 서비스 분석
    const userServices = this.extractServices(userSpecialty);
    const candidateServices = this.extractServices(candidateSpecialty);
    
    // 시너지 매트릭스를 통한 보완성 확인
    for (const userTarget of userTargets) {
      const synergyInfo = this.businessSynergyMatrix[userTarget];
      if (synergyInfo) {
        const hasComplementaryService = synergyInfo.complementary.some(service =>
          candidateServices.some(candidateService =>
            candidateService.includes(service) || service.includes(candidateService)
          )
        );
        if (hasComplementaryService) {
          synergyScore += 30;
          break;
        }
      }
    }

    // 3. 전문분야 시너지 분석
    const specialtyScore = this.calculateSpecialtySynergy(userSpecialty, candidateSpecialty);
    synergyScore += specialtyScore;

    // 4. 지역적 시너지 (추후 고려)
    
    return { 
      score: Math.min(100, synergyScore), 
      alignment: targetAlignment 
    };
  }

  private extractTargetSegments(targetCustomer: string): string[] {
    if (!targetCustomer) return [];
    
    const segments = targetCustomer.split(/[,\s]+/).filter(s => s.trim());
    const standardizedSegments = [];
    
    for (const segment of segments) {
      const normalized = segment.trim().toLowerCase();
      
      // 표준화된 타겟 매핑
      if (normalized.includes('대기업') || normalized.includes('대형')) {
        standardizedSegments.push('대기업');
      } else if (normalized.includes('중소기업') || normalized.includes('중기업')) {
        standardizedSegments.push('중소기업');
      } else if (normalized.includes('스타트업') || normalized.includes('창업')) {
        standardizedSegments.push('스타트업');
      } else if (normalized.includes('개인사업자') || normalized.includes('소상공인')) {
        standardizedSegments.push('개인사업자');
      } else if (normalized.includes('일반소비자') || normalized.includes('개인고객')) {
        standardizedSegments.push('일반소비자');
      } else if (normalized.includes('병원') || normalized.includes('의료')) {
        standardizedSegments.push('병원');
      } else if (normalized.includes('학교') || normalized.includes('교육기관')) {
        standardizedSegments.push('학교');
      } else if (normalized.includes('정부') || normalized.includes('공공기관')) {
        standardizedSegments.push('정부기관');
      } else {
        standardizedSegments.push(segment.trim());
      }
    }
    
    return [...new Set(standardizedSegments)];
  }

  private extractServices(specialty: string): string[] {
    if (!specialty) return [];
    return specialty.split(/[,\s]+/).map(s => s.trim()).filter(s => s);
  }

  private isTargetMatch(target1: string, target2: string): boolean {
    return target1.toLowerCase() === target2.toLowerCase() ||
           target1.includes(target2) || 
           target2.includes(target1);
  }

  private calculateSpecialtySynergy(userSpecialty: string, candidateSpecialty: string): number {
    const userServices = this.extractServices(userSpecialty);
    const candidateServices = this.extractServices(candidateSpecialty);
    
    // 직접적 보완성 확인
    let synergyScore = 0;
    
    for (const userService of userServices) {
      for (const candidateService of candidateServices) {
        // 같은 서비스는 경쟁관계이므로 낮은 점수
        if (this.isSimilarService(userService, candidateService)) {
          synergyScore -= 10;
        }
        // 보완적 서비스는 높은 점수
        else if (this.isComplementaryService(userService, candidateService)) {
          synergyScore += 20;
        }
      }
    }
    
    return Math.max(0, Math.min(30, synergyScore));
  }

  private isSimilarService(service1: string, service2: string): boolean {
    const similar = [
      ['마케팅', '광고', '홍보'],
      ['디자인', '브랜딩', '그래픽'],
      ['개발', 'IT', '솔루션'],
      ['컨설팅', '전략', '기획'],
      ['회계', '세무', '재무'],
      ['법무', '변호사', '법률']
    ];
    
    return similar.some(group => 
      group.some(item => service1.includes(item)) &&
      group.some(item => service2.includes(item))
    );
  }

  private isComplementaryService(service1: string, service2: string): boolean {
    const complementary = [
      ['마케팅', '디자인'],
      ['디자인', 'IT'],
      ['컨설팅', '법무'],
      ['회계', '법무'],
      ['마케팅', 'IT'],
      ['건설', '부동산'],
      ['금융', '보험']
    ];
    
    return complementary.some(pair => 
      (pair[0].includes(service1) && pair[1].includes(service2)) ||
      (pair[1].includes(service1) && pair[0].includes(service2))
    );
  }

  // 비즈니스 가치 및 협력 기회 생성
  private generateBusinessValue(
    userTargetCustomer: string,
    userSpecialty: string,
    candidate: any,
    synergyScore: number,
    targetAlignment: number
  ): { businessValue: string; collaborationOpportunities: string[] } {
    const userTargets = this.extractTargetSegments(userTargetCustomer);
    const candidateTargets = this.extractTargetSegments(candidate.targetCustomer || '');
    const commonTargets = userTargets.filter(target => 
      candidateTargets.some(candidateTarget => this.isTargetMatch(target, candidateTarget))
    );

    let businessValue = '';
    const collaborationOpportunities: string[] = [];

    // 비즈니스 가치 생성
    if (synergyScore >= 80) {
      businessValue = '🎯 완벽한 비즈니스 파트너십';
    } else if (synergyScore >= 60) {
      businessValue = '🚀 높은 성장 잠재력';
    } else if (synergyScore >= 40) {
      businessValue = '💡 새로운 시장 기회';
    } else {
      businessValue = '🌟 혁신적 협력 가능성';
    }

    // 공통 타겟 기반 협력 기회
    for (const target of commonTargets) {
      const synergyInfo = this.businessSynergyMatrix[target];
      if (synergyInfo) {
        collaborationOpportunities.push(`${target} 시장: ${synergyInfo.description}`);
      }
    }

    // 전문분야 기반 협력 기회
    const userServices = this.extractServices(userSpecialty);
    const candidateServices = this.extractServices(candidate.specialty || '');
    
    for (const userService of userServices) {
      for (const candidateService of candidateServices) {
        if (this.isComplementaryService(userService, candidateService)) {
          collaborationOpportunities.push(`${userService}+${candidateService} 통합 솔루션 제공`);
        }
      }
    }

    // 지역 기반 협력 기회
    if (candidate.region) {
      collaborationOpportunities.push(`${candidate.region} 지역 공동 마케팅 및 네트워킹`);
    }

    // 기본 협력 기회 추가
    if (collaborationOpportunities.length === 0) {
      collaborationOpportunities.push('신규 비즈니스 네트워킹 기회');
      collaborationOpportunities.push('상호 추천 및 리퍼럴 파트너십');
    }

    return { businessValue, collaborationOpportunities };
  }

  // 비즈니스 시너지 기반 파트너 추천 실행
  async getBusinessSynergyRecommendations(
    userEmail: string,
    filters: RecommendationFilters = {}
  ): Promise<BusinessSynergyRecommendation[]> {
    try {
      console.log(`🤖 Starting partner recommendation for ${userEmail}...`);
      
      // 현재 사용자 프로필 가져오기
      const userProfile = await this.googleSheetsService.getUserProfile(userEmail);
      if (!userProfile) {
        console.log(`❌ User profile not found for ${userEmail}`);
        return [];
      }

      // Google Sheets에서 모든 활성 사용자 데이터 가져오기
      const allUsersData = await this.getAllUsersFromGoogleSheets();
      
      // 현재 사용자의 기존 파트너 목록
      const currentPartners = [
        userProfile.rpartner1,
        userProfile.rpartner2, 
        userProfile.rpartner3,
        userProfile.rpartner4
      ].filter(partner => partner && partner.trim() !== '');

      console.log(`📊 User ${userEmail} analysis:`, {
        specialty: userProfile.specialty,
        region: userProfile.region,
        chapter: userProfile.chapter,
        currentPartners: currentPartners.length,
        totalCandidates: allUsersData.length
      });

      // 비즈니스 시너지 기반 추천 후보 생성
      const recommendations: BusinessSynergyRecommendation[] = [];

      for (const candidate of allUsersData) {
        // 자기 자신 제외
        if (candidate.email?.toLowerCase() === userEmail.toLowerCase()) {
          continue;
        }

        // 기존 파트너 제외 (필터 옵션)
        if (filters.excludeCurrentPartners && 
            currentPartners.some(partner => 
              partner.toLowerCase().includes(candidate.memberName?.toLowerCase() || '')
            )) {
          continue;
        }

        // 지역 필터
        if (filters.region && candidate.region !== filters.region) {
          continue;
        }

        // 챕터 필터
        if (filters.chapter && candidate.chapter !== filters.chapter) {
          continue;
        }

        // 비즈니스 시너지 점수 계산
        const { score: synergyScore, alignment: targetAlignment } = this.calculateBusinessSynergyScore(
          userProfile.targetCustomer || '',
          userProfile.specialty || '',
          candidate.targetCustomer || '',
          candidate.specialty || ''
        );

        // 최소 시너지 점수 필터
        if (filters.minCompatibilityScore && 
            synergyScore < filters.minCompatibilityScore) {
          continue;
        }

        // 비즈니스 가치 및 협력 기회 생성
        const { businessValue, collaborationOpportunities } = this.generateBusinessValue(
          userProfile.targetCustomer || '',
          userProfile.specialty || '',
          candidate,
          synergyScore,
          targetAlignment
        );

        // 시너지 타입 결정
        const synergyType: 'perfect-match' | 'high-potential' | 'growth-opportunity' | 'new-market' = 
          synergyScore >= 80 ? 'perfect-match' :
          synergyScore >= 60 ? 'high-potential' : 
          synergyScore >= 40 ? 'growth-opportunity' : 'new-market';

        recommendations.push({
          memberName: candidate.memberName || '',
          email: candidate.email || '',
          industry: candidate.industry || '',
          company: candidate.company || '',
          specialty: candidate.specialty || '',
          targetCustomer: candidate.targetCustomer || '',
          region: candidate.region || '',
          chapter: candidate.chapter || '',
          synergyScore,
          synergyType,
          businessValue,
          collaborationOpportunities,
          targetMarketAlignment: targetAlignment,
          currentStage: 'none' // 초기값
        });
      }

      // 시너지 점수순으로 정렬
      recommendations.sort((a, b) => b.synergyScore - a.synergyScore);

      // 결과 개수 제한
      const maxResults = filters.maxResults || 10;
      const finalRecommendations = recommendations.slice(0, maxResults);

      console.log(`✅ Generated ${finalRecommendations.length} recommendations for ${userEmail}`);
      console.log('Top 3 business synergy recommendations:', finalRecommendations.slice(0, 3).map(r => ({
        name: r.memberName,
        specialty: r.specialty,
        targetCustomer: r.targetCustomer,
        synergyScore: r.synergyScore,
        businessValue: r.businessValue,
        synergyType: r.synergyType
      })));

      return finalRecommendations;

    } catch (error) {
      console.error('❌ Error generating partner recommendations:', error);
      return [];
    }
  }

  // Google Sheets에서 모든 사용자 데이터 가져오기
  private async getAllUsersFromGoogleSheets(): Promise<any[]> {
    try {
      const accessToken = await this.googleSheetsService.getAccessToken();
      
      const getResponse = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/1JM37uOEu64D0r6zzKggOsA9ZdcK4wBCx0rpuNoVcIYg/values/RPS!A1:H5000`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!getResponse.ok) {
        throw new Error('Failed to read all users data from Google Sheets');
      }

      const data = await getResponse.json();
      const rows = data.values || [];
      
      // 헤더 제외하고 사용자 데이터 변환
      const users = rows.slice(1)
        .filter(row => row && row[0] && row[0].toString().trim())
        .map(row => ({
          email: row[0] || '',
          region: row[1] || '',
          chapter: row[2] || '',
          memberName: row[3] || '',
          industry: row[4] || '',
          company: row[5] || '',
          specialty: row[6] || '',
          targetCustomer: row[7] || ''
        }));

      console.log(`📊 Loaded ${users.length} users for recommendation analysis`);
      return users;

    } catch (error) {
      console.error('❌ Error loading users data:', error);
      return [];
    }
  }

  // 업종별 통계 분석
  async getIndustryAnalytics(): Promise<{
    industryDistribution: { [key: string]: number };
    compatibilityOpportunities: { industry: string; potentialPartners: number }[];
    recommendationStats: any;
  }> {
    try {
      const allUsers = await this.getAllUsersFromGoogleSheets();
      
      // 업종 분포 계산
      const industryDistribution: { [key: string]: number } = {};
      allUsers.forEach(user => {
        const specialty = user.specialty || 'Unknown';
        industryDistribution[specialty] = (industryDistribution[specialty] || 0) + 1;
      });

      // 비즈니스 시너지 기회 분석 (타겟 고객층 기반)
      const compatibilityOpportunities = Object.entries(industryDistribution)
        .map(([industry, count]) => {
          // 간단한 시너지 계산: 각 업종별 예상 파트너 수
          const estimatedSynergy = Math.floor(count * 0.3); // 30% 시너지 추정치
          return { industry, potentialPartners: estimatedSynergy };
        })
        .sort((a, b) => b.potentialPartners - a.potentialPartners);

      return {
        industryDistribution,
        compatibilityOpportunities,
        recommendationStats: {
          totalUsers: allUsers.length,
          totalIndustries: Object.keys(industryDistribution).length,
          avgCompatibilityScore: 65.5 // 예시 값
        }
      };

    } catch (error) {
      console.error('❌ Error generating industry analytics:', error);
      return {
        industryDistribution: {},
        compatibilityOpportunities: [],
        recommendationStats: {}
      };
    }
  }
}