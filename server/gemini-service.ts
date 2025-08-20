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
    try {
      const prompt = `
당신은 비즈니스 전문가입니다. 아래 전문분야를 분석하여 시너지를 낼 수 있는 분야들을 추천해주세요.

전문분야: ${specialty}

다음 형식으로 답변해주세요:

1. 전문분야 분석 및 시너지 분야 추천 (상세한 설명)
2. 구체적인 시너지 분야 리스트 (10-15개)
3. 우선순위별 분류:
   - 단기적 확장 (즉시 가능한 분야)
   - 중기적 성장 (1-2년 준비 필요)
   - 장기적 투자 (3-5년 계획)

답변은 한국어로 작성하고, BNI 비즈니스 네트워킹 관점에서 실질적이고 구체적인 조언을 제공해주세요.
각 시너지 분야는 해당 전문분야와 어떤 협력이 가능한지 명확히 설명해주세요.
`;

      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
      });

      const analysisText = response.text || "";
      
      // 시너지 분야 추출을 위한 간단한 파싱
      const synergyFields = this.extractSynergyFields(analysisText);
      const synergyDetails = this.extractSynergyDetails(analysisText);
      const priorities = this.extractPriorities(analysisText);

      return {
        analysis: analysisText,
        synergyFields,
        synergyDetails,
        priorities
      };
    } catch (error) {
      console.error('Gemini API error:', error);
      throw new Error('전문분야 분석 중 오류가 발생했습니다');
    }
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
}

// 싱글톤 인스턴스
let geminiService: GeminiService | null = null;

export function getGeminiService(): GeminiService {
  if (!geminiService) {
    geminiService = new GeminiService();
  }
  return geminiService;
}