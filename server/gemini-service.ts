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
    
    try {
      // 상세 분석 유지하면서 속도 최적화
      const prompt = `당신은 BNI 한국 지부 비즈니스 네트워킹 전문가입니다. "${specialty}" 전문분야에 대한 상세한 시너지 분석을 제공해주세요.

# ${specialty} 전문분야 비즈니스 시너지 분석

## 🏢 핵심 역량 분석
${specialty} 전문가의 주요 업무와 시장 역할을 간략히 분석해주세요.

## 🤝 시너지 창출 분야
${specialty}와 협업 가능한 비즈니스 분야들을 구체적으로 제시해주세요:

### 직접 연관 분야
- 분야1: 구체적 업종명 - 협업 방안
- 분야2: 구체적 업종명 - 협업 방안

### 간접 시너지 분야  
- 분야3: 구체적 업종명 - 시너지 효과
- 분야4: 구체적 업종명 - 시너지 효과

## 🎯 시간대별 협업 전략

### 단기 전략 (6개월)
1. 구체적업종1 - 실행방안
2. 구체적업종2 - 실행방안
3. 구체적업종3 - 실행방안

### 중기 전략 (1-2년)
1. 구체적업종4 - 성장방안
2. 구체적업종5 - 성장방안
3. 구체적업종6 - 성장방안

### 장기 전략 (3-5년)
1. 구체적업종7 - 투자전략
2. 구체적업종8 - 투자전략
3. 구체적업종9 - 투자전략

## 💡 실행 방안
실제 적용 가능한 구체적 방안을 3-4개 제시해주세요.

한국 비즈니스 환경에 맞는 실용적 분석을 800-1000자로 작성해주세요.`;

      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
      });

      const analysisText = response.text || `${specialty} 전문분야에 대한 분석을 수행할 수 없습니다.`;
      
      // AI 분석 결과에서 시너지 분야 추출
      const extractedSynergyFields = this.extractSynergyFields(analysisText);
      console.log(`🔍 추출된 시너지 분야 (${extractedSynergyFields.length}개):`, extractedSynergyFields);
      
      // 우선순위 추출
      const extractedPriorities = this.extractPriorities(analysisText);
      console.log(`📋 추출된 우선순위:`, extractedPriorities);

      console.log(`✅ AI 분석 완료 - specialty: ${specialty}, fields: ${extractedSynergyFields.length}개`);

      return {
        analysis: analysisText,
        synergyFields: extractedSynergyFields,
        synergyDetails: analysisText,
        priorities: extractedPriorities
      };
      
    } catch (error) {
      console.error(`❌ Gemini API 오류 (${specialty}):`, error);
      
      // 폴백: 기본 분석 제공
      const fallbackAnalysis = `${specialty} 전문분야 분석

현재 AI 분석 서비스에 일시적인 문제가 있어 상세 분석을 제공할 수 없습니다. 

${specialty} 전문가로서 BNI 네트워킹을 통해 다양한 분야의 전문가들과 협업 기회를 모색해보시기 바랍니다. 

향후 서비스가 정상화되면 더욱 상세하고 맞춤형 시너지 분석을 제공하겠습니다.`;

      return {
        analysis: fallbackAnalysis,
        synergyFields: [specialty],
        synergyDetails: fallbackAnalysis,
        priorities: {
          shortTerm: [],
          mediumTerm: [],
          longTerm: []
        }
      };
    }
  }

  private extractSynergyFields(text: string): string[] {
    const fields: string[] = [];
    const lines = text.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // 다양한 패턴으로 시너지 분야 추출
      // 1. "• 분야명:" 패턴
      let match = trimmed.match(/^[•-]\s*([가-힣\s\w/]+):/);
      if (match && match[1]) {
        const field = match[1].trim();
        if (field.length > 2 && field.length < 30) {
          fields.push(field);
        }
        continue;
      }
      
      // 2. "분야명 -" 패턴  
      match = trimmed.match(/^([가-힣\s\w/]+)\s*[-:]/);
      if (match && match[1]) {
        const field = match[1].trim();
        if (field.length > 2 && field.length < 30) {
          fields.push(field);
        }
        continue;
      }
      
      // 3. "1. 분야명" 패턴
      match = trimmed.match(/^\d+\.\s*([가-힣\s\w/]+)/);
      if (match && match[1]) {
        const field = match[1].trim();
        if (field.length > 2 && field.length < 30 && !field.includes('전략') && !field.includes('분석')) {
          fields.push(field);
        }
        continue;
      }
      
      // 4. "**분야명**" 패턴
      match = trimmed.match(/\*\*([가-힣\s\w/]+)\*\*/);
      if (match && match[1]) {
        const field = match[1].trim();
        if (field.length > 2 && field.length < 30 && !field.includes('분야') && !field.includes('전략')) {
          fields.push(field);
        }
        continue;
      }
      
      // 5. 일반적인 분야명 추출 (괄호 안이나 따옴표 안)
      match = trimmed.match(/[\(\"\']([\w\s/가-힣]+)[\)\"\']/);
      if (match && match[1]) {
        const field = match[1].trim();
        if (field.length > 2 && field.length < 20) {
          fields.push(field);
        }
      }
    }
    
    // 기본 시너지 분야 추가 (분석 결과가 부족할 경우)
    if (fields.length < 3) {
      fields.push('마케팅', '브랜딩', '디자인', '제조업', '소매업', '이벤트기획');
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
      
      // 섹션 감지
      if (trimmed.includes('단기') || trimmed.includes('즉시') || trimmed.includes('6개월')) {
        currentSection = 'shortTerm';
        continue;
      } else if (trimmed.includes('중기') || trimmed.includes('1-2년') || trimmed.includes('2년')) {
        currentSection = 'mediumTerm';
        continue;
      } else if (trimmed.includes('장기') || trimmed.includes('3-5년') || trimmed.includes('이상')) {
        currentSection = 'longTerm';
        continue;
      }
      
      // 각 섹션 내에서 항목 추출
      if (currentSection && trimmed.length > 3) {
        // 번호나 bullet point로 시작하는 라인에서 분야명 추출
        let match = trimmed.match(/^\d+\.\s*([가-힣\s\w/]+)/);
        if (!match) {
          match = trimmed.match(/^[•-]\s*([가-힣\s\w/]+)/);
        }
        if (!match) {
          match = trimmed.match(/([가-힣\s\w/]+)(?:\s*:|\s*-|\s*–)/);
        }
        
        if (match && match[1]) {
          const item = match[1].trim();
          if (item.length > 2 && item.length < 20 && 
              !item.includes('전략') && !item.includes('협업') && 
              !item.includes('추천') && !item.includes('우선순위')) {
            priorities[currentSection as keyof typeof priorities].push(item);
          }
        }
      }
    }

    // 기본값 설정 (추출된 항목이 없을 경우)
    if (priorities.shortTerm.length === 0) {
      priorities.shortTerm = ['마케팅업체', '브랜딩업체', '제조업체'];
    }
    if (priorities.mediumTerm.length === 0) {
      priorities.mediumTerm = ['소매업체', '유통업체', '이벤트기획사'];
    }
    if (priorities.longTerm.length === 0) {
      priorities.longTerm = ['IT솔루션', '글로벌파트너', '투자업체'];
    }

    // 각 배열을 최대 3개로 제한하고 의미 있는 내용만 유지
    priorities.shortTerm = priorities.shortTerm.slice(0, 3).filter(item => item.length > 1 && !item.match(/^\d+$/));
    priorities.mediumTerm = priorities.mediumTerm.slice(0, 3).filter(item => item.length > 1 && !item.match(/^\d+$/));
    priorities.longTerm = priorities.longTerm.slice(0, 3).filter(item => item.length > 1 && !item.match(/^\d+$/));

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