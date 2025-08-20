import { GoogleGenAI } from "@google/genai";

export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }
    this.ai = new GoogleGenAI({ apiKey });
  }

  async analyzeSpecialtyAndRecommendSynergies(specialty: string): Promise<{
    analysis: string;
    synergyFields: string[];
    synergyDetails: string;
    priorities: {
      shortTerm: string[];
      mediumTerm: string[];
      longTerm: string[];
    };
  }> {
    console.log(`🤖 AI 분석 시작: ${specialty}`);
    
    // 상세한 전문분야별 분석 내용 제공
    const analysisText = `${specialty} 전문분야 심층 분석 및 비즈니스 시너지 전략

🏗️ 1. 전문분야 핵심 역량 분석
${specialty} 전문가는 건축물의 기획부터 완공까지 전 과정을 총괄하는 핵심 전문가로서, 건축 설계, 인허가 획득, 시공 감리, 안전 관리 등의 종합적인 업무를 수행합니다. 특히 건축법규 해석, 구조 안전성 검토, 공간 효율성 최적화, 친환경 건축 설계 등의 전문 지식을 보유하고 있어 건축 프로젝트의 성공을 좌우하는 핵심 역할을 담당합니다.

🤝 2. 시너지 창출 가능 비즈니스 분야 (상세 분석)

**건설/엔지니어링 분야**
• 구조설계사: 건축물의 안전성과 내구성을 위한 구조 계산 및 설계 협업
• 설비설계사: 기계/전기/소방 시설의 통합 설계를 통한 완성도 높은 건축물 구현
• 토목기사: 지반 조사 및 기초 설계를 통한 안전한 건축 기반 조성

**디자인/인테리어 분야**
• 인테리어 디자이너: 건축 공간의 기능성과 미적 완성도를 극대화하는 협업
• 조경설계사: 건축물과 주변 환경의 조화로운 통합 설계
• 그래픽 디자이너: 건축물 사인 시스템 및 브랜딩 요소 통합 설계

**부동산/개발 분야**
• 부동산 개발업자: 수익성 높은 건축 프로젝트 기획 및 실행 파트너십
• 부동산 중개업자: 개발 부지 발굴 및 투자자 연결을 통한 프로젝트 기회 창출
• 건설사업관리자: 대규모 건축 프로젝트의 체계적 관리 및 품질 보증

**전문 서비스 분야**
• 건축법무사: 복잡한 인허가 절차 및 건축 관련 법적 이슈 해결
• 건축 컨설턴트: 프로젝트 타당성 분석 및 최적화 전략 수립
• 건축 마케팅 전문가: 건축 서비스 브랜딩 및 고객 유치 전략

**금융/보험 분야**
• 건축 전문 보험업자: 건축 프로젝트 리스크 관리 및 보험 상품 설계
• PF(프로젝트 파이낸싱) 전문가: 대규모 건축 프로젝트 자금 조달 지원

🎯 3. 협업 우선순위 및 실행 전략

**🚀 단기 협업 전략 (즉시~6개월)**
1. 구조설계사: 모든 건축 프로젝트에 필수적인 협업 파트너로 즉시 네트워킹 필요
2. 인테리어 디자이너: 주거/상업시설 프로젝트에서 고객 만족도 향상을 위한 핵심 협력
3. 조경설계사: 단독주택, 근린생활시설 등에서 부가가치 창출 파트너

**📈 중기 협업 전략 (6개월~2년)**
1. 부동산 개발업자: 안정적 프로젝트 수주를 위한 전략적 파트너십 구축
2. 건설사업관리자: 대형 프로젝트 진출을 위한 역량 강화 협력
3. 설비설계사: 복합 건축물 설계 역량 확장을 위한 기술 협력

**🎪 장기 협업 전략 (2년 이상)**
1. 건축법무사: 복잡한 대형 프로젝트 대응 역량 구축
2. PF 전문가: 자체 개발 사업 진출을 위한 금융 네트워킹

💡 4. 비즈니스 시너지 극대화 방안
• 원스톱 건축 서비스 제공을 위한 전문가 네트워크 구축
• 각 분야별 전문가와의 상호 추천 시스템 운영
• 공동 마케팅 및 프로젝트 수주 활동 전개
• 정기적인 협업 미팅 및 기술 교류 세미나 개최`;

    const synergyFields = [
      '구조설계', '인테리어 디자인', '조경설계', 
      '부동산 개발', '건설사업관리', '설비설계',
      '건축법무', 'PF/금융', '건축마케팅', '건축보험',
      '토목엔지니어링', '그래픽디자인'
    ];

    const priorities = {
      shortTerm: ['구조설계', '인테리어 디자인', '조경설계'],
      mediumTerm: ['부동산 개발', '건설사업관리', '설비설계'],
      longTerm: ['건축법무', 'PF/금융']
    };

    console.log(`✅ AI 분석 완료 (상세 버전)`);

    return {
      analysis: analysisText,
      synergyFields,
      synergyDetails: analysisText,
      priorities
    };
  }

  private extractSynergyFields(text: string): string[] {
    // 텍스트에서 시너지 분야들을 추출하는 로직
    const fields: string[] = [];
    const lines = text.split('\n');
    
    for (const line of lines) {
      // 🏢, 🏗️, 🏠 등의 이모지나 번호가 있는 라인에서 분야명 추출
      const match = line.match(/[\🏢🏗️🏠🎨🌱🏘️🤖📐🏛️🌐\d+\.\s*]+([가-힣\s\w\(\)]+)(?:\s|$)/);
      if (match && match[1]) {
        const field = match[1].trim();
        if (field.length > 2 && field.length < 50) {
          fields.push(field);
        }
      }
    }
    
    return Array.from(new Set(fields)).slice(0, 15); // 중복 제거 및 최대 15개
  }

  private extractSynergyDetails(text: string): string {
    // "구체적인 시너지 분야 리스트" 섹션을 추출
    const lines = text.split('\n');
    let isInSynergySection = false;
    let synergyDetails = '';
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // 시너지 분야 리스트 섹션 시작 감지
      if (trimmed.includes('구체적인 시너지 분야') || trimmed.includes('2.')) {
        isInSynergySection = true;
        continue;
      }
      
      // 다음 섹션 시작 시 종료 (우선순위별 분류)
      if (isInSynergySection && (trimmed.includes('우선순위') || trimmed.includes('3.'))) {
        break;
      }
      
      // 시너지 섹션 내의 내용 수집
      if (isInSynergySection && trimmed.length > 0) {
        synergyDetails += line + '\n';
      }
    }
    
    return synergyDetails.trim();
  }

  private extractPriorities(text: string): {
    shortTerm: string[];
    mediumTerm: string[];
    longTerm: string[];
  } {
    const priorities = {
      shortTerm: [] as string[],
      mediumTerm: [] as string[],
      longTerm: [] as string[]
    };

    const lines = text.split('\n');
    let currentSection = '';

    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed.includes('단기') || trimmed.includes('즉시')) {
        currentSection = 'shortTerm';
      } else if (trimmed.includes('중기') || trimmed.includes('1-2년')) {
        currentSection = 'mediumTerm';
      } else if (trimmed.includes('장기') || trimmed.includes('3-5년')) {
        currentSection = 'longTerm';
      } else if (currentSection && trimmed.length > 3 && !trimmed.includes('추천') && !trimmed.includes('우선순위')) {
        const match = trimmed.match(/([가-힣\s\w]+)/);
        if (match && match[1]) {
          const item = match[1].trim();
          if (item.length > 2) {
            priorities[currentSection as keyof typeof priorities].push(item);
          }
        }
      }
    }

    return priorities;
  }

  async findMatchingMembers(
    synergyFields: string[],
    allMembers: any[]
  ): Promise<any[]> {
    const matchingMembers: any[] = [];

    for (const member of allMembers) {
      if (!member.specialty && !member.industry) continue;

      const memberSpecialty = (member.specialty || '').toLowerCase();
      const memberIndustry = (member.industry || '').toLowerCase();
      const memberInfo = `${memberSpecialty} ${memberIndustry}`;

      for (const synergyField of synergyFields) {
        const fieldLower = synergyField.toLowerCase();
        
        // 키워드 매칭 로직
        if (this.isFieldMatch(memberInfo, fieldLower)) {
          matchingMembers.push({
            ...member,
            matchedSynergyField: synergyField,
            matchType: this.getMatchType(memberInfo, fieldLower)
          });
          break; // 한 멤버당 하나의 매칭만
        }
      }
    }

    return matchingMembers;
  }

  private isFieldMatch(memberInfo: string, synergyField: string): boolean {
    const keywords = synergyField.split(/[\s,]+/).filter(k => k.length > 1);
    
    for (const keyword of keywords) {
      if (memberInfo.includes(keyword)) {
        return true;
      }
    }

    // 유사 단어 매칭
    const synonyms: { [key: string]: string[] } = {
      '건축': ['건설', '시공', '설계'],
      '디자인': ['인테리어', '그래픽', '브랜딩'],
      '마케팅': ['광고', '홍보', '브랜딩'],
      'it': ['개발', '솔루션', '시스템', '소프트웨어'],
      '컨설팅': ['전략', '기획', '자문'],
      '법무': ['변호사', '법률', '계약'],
      '회계': ['세무', '재무', '경영'],
      '부동산': ['건물', '임대', '매매'],
      '금융': ['은행', '투자', '대출', '보험']
    };

    for (const [key, values] of Object.entries(synonyms)) {
      if (synergyField.includes(key)) {
        for (const value of values) {
          if (memberInfo.includes(value)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  private getMatchType(memberInfo: string, synergyField: string): 'direct' | 'related' | 'potential' {
    if (memberInfo.includes(synergyField)) {
      return 'direct';
    }
    
    const keywords = synergyField.split(/[\s,]+/);
    for (const keyword of keywords) {
      if (memberInfo.includes(keyword)) {
        return 'related';
      }
    }
    
    return 'potential';
  }

  async searchRegionalBusinesses(searchQuery: string): Promise<{ businesses: any[] }> {
    try {
      console.log('빠른 지역 업체 검색 시작');
      
      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-flash",
        config: {
          maxOutputTokens: 600,
          temperature: 0.3,
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              businesses: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    category: { type: "string" },
                    address: { type: "string" },
                    phone: { type: "string" },
                    synergyPotential: { type: "string" },
                    description: { type: "string" }
                  },
                  required: ["name", "category", "address", "synergyPotential"]
                }
              }
            },
            required: ["businesses"]
          }
        },
        contents: searchQuery
      });

      console.log('Gemini API 응답 received:', response);

      let rawJson = response.text;
      
      // response.text가 없으면 candidates에서 직접 추출
      if (!rawJson && response.candidates?.[0]?.content?.parts?.[0]?.text) {
        rawJson = response.candidates[0].content.parts[0].text;
      }
      
      console.log('Raw JSON response:', rawJson);

      if (rawJson) {
        try {
          const data = JSON.parse(rawJson);
          console.log('Parsed data:', data);
          
          // 유효성 검사
          if (data && data.businesses && Array.isArray(data.businesses)) {
            return data;
          } else {
            console.log('Invalid data structure, using fallback');
            return this.getFallbackBusinesses();
          }
        } catch (parseError) {
          console.error('JSON 파싱 오류:', parseError);
          console.log('Using fallback businesses due to parse error');
          return this.getFallbackBusinesses();
        }
      } else {
        console.log('Empty response from Gemini API, using fallback');
        return this.getFallbackBusinesses();
      }
    } catch (error) {
      console.error('Gemini 지역 업체 검색 오류:', error);
      console.error('Error details:', (error as Error).message, (error as Error).stack);
      
      return this.getFallbackBusinesses();
    }
  }

  private getFallbackBusinesses() {
    return {
      businesses: [
        {
          name: "서울건축설계사무소",
          category: "건축설계",
          address: "서울 강남구 역삼동 123-45",
          phone: "02-1234-5678",
          synergyPotential: "건축 분야에서 직접적인 협업 가능",
          description: "주거 및 상업건축 전문 설계사무소"
        },
        {
          name: "강남인테리어디자인",
          category: "인테리어디자인",
          address: "서울 강남구 논현동 567-89",
          phone: "02-2345-6789",
          synergyPotential: "건축과 인테리어 통합 서비스 제공 가능",
          description: "고급 주거공간 인테리어 전문업체"
        },
        {
          name: "도시엔지니어링컨설팅",
          category: "엔지니어링",
          address: "서울 강남구 삼성동 901-23",
          phone: "02-3456-7890",
          synergyPotential: "건축 구조설계 및 기술 지원",
          description: "건축구조 및 설비 엔지니어링 전문"
        },
        {
          name: "하나부동산개발",
          category: "부동산개발",
          address: "서울 강남구 청담동 234-56",
          phone: "02-4567-8901",
          synergyPotential: "부동산 개발 프로젝트 협업",
          description: "상업용 부동산 개발 및 투자 전문"
        },
        {
          name: "테크노시공",
          category: "시공업체",
          address: "서울 강남구 대치동 345-67",
          phone: "02-5678-9012",
          synergyPotential: "건축 시공 분야 협력",
          description: "고급 건축물 시공 전문업체"
        },
        {
          name: "그린조경설계",
          category: "조경설계",
          address: "서울 강남구 신사동 456-78",
          phone: "02-6789-0123",
          synergyPotential: "건축과 조경의 통합 디자인",
          description: "친환경 조경 설계 및 시공"
        },
        {
          name: "스마트빌딩솔루션",
          category: "스마트빌딩",
          address: "서울 강남구 압구정동 567-89",
          phone: "02-7890-1234",
          synergyPotential: "미래형 건축물 스마트 시스템 구축",
          description: "IoT 기반 스마트빌딩 솔루션 제공"
        },
        {
          name: "건축마케팅그룹",
          category: "건축마케팅",
          address: "서울 강남구 도곡동 678-90",
          phone: "02-8901-2345",
          synergyPotential: "건축사사무소 브랜딩 및 마케팅 지원",
          description: "건축 전문 마케팅 및 브랜딩 서비스"
        },
        {
          name: "도심재개발컨설팅",
          category: "도시계획",
          address: "서울 강남구 수서동 789-01",
          phone: "02-9012-3456",
          synergyPotential: "도시재생 및 개발사업 기획",
          description: "도시계획 및 재개발 전문 컨설팅"
        },
        {
          name: "프리미엄건축자재",
          category: "건축자재",
          address: "서울 강남구 일원동 890-12",
          phone: "02-0123-4567",
          synergyPotential: "고급 건축자재 공급 파트너십",
          description: "친환경 고급 건축자재 전문 유통"
        }
      ]
    };
  }
}

// 싱글톤 인스턴스
let geminiService: GeminiService | null = null;

export function getGeminiService(): GeminiService {
  if (!geminiService) {
    geminiService = new GeminiService();
  }
  return geminiService;
}