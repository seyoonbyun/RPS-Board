// 산업 호환성 기반 파트너 추천 엔진
import { GoogleSheetsService } from './google-sheets';

export interface IndustryCompatibility {
  industry: string;
  compatibleIndustries: string[];
  synergy: 'high' | 'medium' | 'low';
  description: string;
}

export interface PartnerRecommendation {
  memberName: string;
  email: string;
  specialty: string;
  region: string;
  chapter: string;
  compatibilityScore: number;
  synergyType: 'high' | 'medium' | 'low';
  reasons: string[];
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
  
  // 한국 BNI 업종별 호환성 매트릭스
  private industryCompatibilityMatrix: IndustryCompatibility[] = [
    {
      industry: 'creator', 
      compatibleIndustries: ['marketing', 'design', 'media', 'advertising', 'photography', 'event', 'print', 'technology'],
      synergy: 'high',
      description: '콘텐츠 제작자는 마케팅, 디자인, 미디어 업계와 높은 시너지'
    },
    {
      industry: 'marketing',
      compatibleIndustries: ['creator', 'design', 'advertising', 'sales', 'event', 'photography', 'consulting'],
      synergy: 'high', 
      description: '마케팅은 창작, 디자인, 광고 업계와 상호 보완적 관계'
    },
    {
      industry: 'finance',
      compatibleIndustries: ['accounting', 'insurance', 'legal', 'consulting', 'real-estate', 'tax'],
      synergy: 'high',
      description: '금융업은 회계, 보험, 법무, 컨설팅과 전문 서비스 네트워크 형성'
    },
    {
      industry: 'healthcare',
      compatibleIndustries: ['insurance', 'fitness', 'wellness', 'nutrition', 'pharmacy', 'medical-device'],
      synergy: 'high',
      description: '의료업은 보험, 피트니스, 웰니스 분야와 건강 생태계 구축'
    },
    {
      industry: 'construction',
      compatibleIndustries: ['architecture', 'engineering', 'real-estate', 'interior-design', 'landscaping', 'materials'],
      synergy: 'high',
      description: '건설업은 건축, 설계, 부동산과 건축 생태계 시너지'
    },
    {
      industry: 'technology',
      compatibleIndustries: ['consulting', 'education', 'marketing', 'design', 'security', 'telecommunications'],
      synergy: 'high',
      description: '기술업은 컨설팅, 교육, 마케팅과 디지털 전환 파트너십'
    },
    {
      industry: 'education',
      compatibleIndustries: ['technology', 'publishing', 'training', 'childcare', 'tutoring', 'consulting'],
      synergy: 'medium',
      description: '교육업은 기술, 출판, 교육 관련 서비스와 학습 생태계 형성'
    },
    {
      industry: 'food',
      compatibleIndustries: ['restaurant', 'catering', 'delivery', 'agriculture', 'packaging', 'equipment'],
      synergy: 'medium',
      description: '식품업은 레스토랑, 케이터링, 농업과 식품 공급망 네트워크'
    },
    {
      industry: 'retail',
      compatibleIndustries: ['marketing', 'logistics', 'packaging', 'display', 'security', 'pos-systems'],
      synergy: 'medium',
      description: '소매업은 마케팅, 물류, 포장과 상거래 생태계 구축'
    },
    {
      industry: 'transportation',
      compatibleIndustries: ['logistics', 'fuel', 'maintenance', 'insurance', 'tracking', 'storage'],
      synergy: 'medium',
      description: '운송업은 물류, 연료, 정비와 운송 네트워크 시너지'
    }
  ];

  constructor(googleSheetsService: GoogleSheetsService) {
    this.googleSheetsService = googleSheetsService;
  }

  // 업종 호환성 점수 계산
  private calculateCompatibilityScore(userIndustry: string, candidateIndustry: string): number {
    // 정확한 매치
    const exactMatch = this.industryCompatibilityMatrix.find(
      item => item.industry.toLowerCase() === userIndustry.toLowerCase()
    );
    
    if (exactMatch) {
      const isCompatible = exactMatch.compatibleIndustries.some(
        industry => industry.toLowerCase().includes(candidateIndustry.toLowerCase()) ||
                   candidateIndustry.toLowerCase().includes(industry.toLowerCase())
      );
      
      if (isCompatible) {
        return exactMatch.synergy === 'high' ? 90 : 
               exactMatch.synergy === 'medium' ? 70 : 50;
      }
    }

    // 역방향 매치
    const reverseMatch = this.industryCompatibilityMatrix.find(
      item => item.industry.toLowerCase() === candidateIndustry.toLowerCase()
    );
    
    if (reverseMatch) {
      const isCompatible = reverseMatch.compatibleIndustries.some(
        industry => industry.toLowerCase().includes(userIndustry.toLowerCase()) ||
                   userIndustry.toLowerCase().includes(industry.toLowerCase())
      );
      
      if (isCompatible) {
        return reverseMatch.synergy === 'high' ? 85 : 
               reverseMatch.synergy === 'medium' ? 65 : 45;
      }
    }

    // 부분 문자열 매치
    const partialMatch = this.industryCompatibilityMatrix.find(item => {
      return item.compatibleIndustries.some(industry => 
        industry.toLowerCase().includes(userIndustry.toLowerCase()) ||
        userIndustry.toLowerCase().includes(industry.toLowerCase()) ||
        industry.toLowerCase().includes(candidateIndustry.toLowerCase()) ||
        candidateIndustry.toLowerCase().includes(industry.toLowerCase())
      );
    });

    if (partialMatch) {
      return 40;
    }

    // 기본 점수 (새로운 업종 간 기회)
    return 25;
  }

  // 추천 이유 생성
  private generateRecommendationReasons(
    userIndustry: string, 
    candidate: any, 
    compatibilityScore: number
  ): string[] {
    const reasons: string[] = [];
    
    const compatibility = this.industryCompatibilityMatrix.find(
      item => item.industry.toLowerCase() === userIndustry.toLowerCase()
    );

    if (compatibility) {
      const isDirectMatch = compatibility.compatibleIndustries.some(
        industry => industry.toLowerCase().includes(candidate.specialty?.toLowerCase() || '')
      );
      
      if (isDirectMatch) {
        reasons.push(compatibility.description);
      }
    }

    if (compatibilityScore >= 80) {
      reasons.push('높은 업종 시너지로 상호 리퍼럴 기회 풍부');
    } else if (compatibilityScore >= 60) {
      reasons.push('중간 업종 호환성으로 협업 가능성 있음');
    } else if (compatibilityScore >= 40) {
      reasons.push('새로운 업종 간 네트워킹 기회');
    }

    // 지역 기반 추가 이유
    if (candidate.region) {
      reasons.push(`${candidate.region} 지역 네트워크 확장 기회`);
    }

    // 챕터 기반 추가 이유  
    if (candidate.chapter) {
      reasons.push(`${candidate.chapter} 챕터 내 협력 파트너`);
    }

    return reasons.length > 0 ? reasons : ['새로운 비즈니스 네트워킹 기회'];
  }

  // 파트너 추천 실행
  async getPartnerRecommendations(
    userEmail: string,
    filters: RecommendationFilters = {}
  ): Promise<PartnerRecommendation[]> {
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

      // 추천 후보 생성
      const recommendations: PartnerRecommendation[] = [];

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

        // 호환성 점수 계산
        const compatibilityScore = this.calculateCompatibilityScore(
          userProfile.specialty || '',
          candidate.specialty || ''
        );

        // 최소 호환성 점수 필터
        if (filters.minCompatibilityScore && 
            compatibilityScore < filters.minCompatibilityScore) {
          continue;
        }

        // 추천 이유 생성
        const reasons = this.generateRecommendationReasons(
          userProfile.specialty || '',
          candidate,
          compatibilityScore
        );

        // 시너지 타입 결정
        const synergyType: 'high' | 'medium' | 'low' = 
          compatibilityScore >= 80 ? 'high' :
          compatibilityScore >= 60 ? 'medium' : 'low';

        recommendations.push({
          memberName: candidate.memberName || '',
          email: candidate.email || '',
          specialty: candidate.specialty || '',
          region: candidate.region || '',
          chapter: candidate.chapter || '',
          compatibilityScore,
          synergyType,
          reasons,
          currentStage: 'none' // 초기값
        });
      }

      // 호환성 점수순으로 정렬
      recommendations.sort((a, b) => b.compatibilityScore - a.compatibilityScore);

      // 결과 개수 제한
      const maxResults = filters.maxResults || 10;
      const finalRecommendations = recommendations.slice(0, maxResults);

      console.log(`✅ Generated ${finalRecommendations.length} recommendations for ${userEmail}`);
      console.log('Top 3 recommendations:', finalRecommendations.slice(0, 3).map(r => ({
        name: r.memberName,
        specialty: r.specialty,
        score: r.compatibilityScore,
        synergy: r.synergyType
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
        `https://sheets.googleapis.com/v4/spreadsheets/1JM37uOEu64D0r6zzKggOsA9ZdcK4wBCx0rpuNoVcIYg/values/RPS!A1:F5000`,
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
          specialty: row[4] || '',
          targetCustomer: row[5] || ''
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

      // 호환성 기회 분석
      const compatibilityOpportunities = Object.entries(industryDistribution)
        .map(([industry, count]) => {
          const compatibility = this.industryCompatibilityMatrix.find(
            item => item.industry.toLowerCase() === industry.toLowerCase()
          );
          
          const potentialPartners = compatibility ? 
            compatibility.compatibleIndustries.reduce((sum, compatibleIndustry) => {
              return sum + (industryDistribution[compatibleIndustry] || 0);
            }, 0) : 0;

          return { industry, potentialPartners };
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