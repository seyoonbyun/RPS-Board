import { GoogleGenAI } from "@google/genai";
import { NaverPlaceService, NaverPlaceBusiness } from './naver-place-service';
import { PureDynamicSearch } from './pure-dynamic-search';
import { AI_CONFIG } from '@shared/constants';

export class GeminiService {
  private ai: GoogleGenAI;
  private naverPlaceService: NaverPlaceService;
  private pureDynamicSearch: PureDynamicSearch;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }
    this.ai = new GoogleGenAI({ apiKey });
    this.naverPlaceService = new NaverPlaceService();
    this.pureDynamicSearch = new PureDynamicSearch();
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
      const analysisTemplate = {
        title: `${specialty} 전문분야 BNI 네트워킹 분석`,
        sections: [
          {
            icon: '🏢',
            title: '핵심 역량 및 시장 포지셔닝 분석',
            description: '상세한 업무 분석, 시장 역할, 비즈니스 과제'
          },
          {
            icon: '🤝', 
            title: '시너지 창출 가능 비즈니스 분야 및 협업 전략',
            description: '협업 방안, 시너지 효과, 실제 사례'
          },
          {
            icon: '🎯',
            title: '시간대별 협업 우선순위 및 실행 로드맵', 
            description: '단기/중기/장기 전략'
          },
          {
            icon: '💡',
            title: '비즈니스 시너지 극대화 및 실행 방안',
            description: '구체적 실행 방법'
          }
        ]
      };

      const prompt = `당신은 BNI 한국의 전문 비즈니스 네트워킹 분석가입니다. "${specialty}" 전문분야에 대한 체계적인 분석을 다음 구조로 작성해주세요:

# ${analysisTemplate.title}

## ${analysisTemplate.sections[0].icon} ${analysisTemplate.sections[0].title}
${specialty} 전문가의 상세한 업무 분석, 한국 시장에서의 역할, 그리고 직면한 비즈니스 과제와 기회를 구체적으로 분석해주세요. 전문 지식과 서비스 범위, 가치 창출 방식을 포함하여 작성해주세요.

## ${analysisTemplate.sections[1].icon} ${analysisTemplate.sections[1].title}
${specialty}와 협업할 수 있는 **구체적인 업체 유형들**을 제시해주세요. 

다음과 같은 형태로 작성해주세요:

1. **제조/생산 분야 (봉제공장, 원단업체, 부자재업체):** 구체적인 협업 방안 설명
2. **마케팅/홍보 분야 (광고대행사, PR업체, SNS전문가):** 구체적인 협업 방안 설명  
3. **서비스 분야 (사진작가, 스타일리스트, 컨설팅업체):** 구체적인 협업 방안 설명
4. **유통/판매 분야 (쇼핑몰, 편집숍, 백화점):** 구체적인 협업 방안 설명
5. **기술/IT 분야 (웹개발업체, 앱개발업체, 이커머스업체):** 구체적인 협업 방안 설명

반드시 괄호 안에 **실제로 검색 가능한 구체적인 업체명/업종명**을 포함시켜주세요.

## ${analysisTemplate.sections[2].icon} ${analysisTemplate.sections[2].title}
다음과 같이 시간대별로 구분하여 협업 전략을 제시해주세요:

**단기 전략 (즉시~6개월):** 즉각적인 성과를 기대할 수 있는 **검색 가능한 구체적인 업체명/업종명**을 반드시 포함하여 작성

**중기 전략 (6개월~2년):** 지속적인 관계 구축과 상호 성장을 위한 **검색 가능한 구체적인 업체명/업종명**을 반드시 포함하여 작성

**장기 전략 (2년 이상):** 혁신과 사업 확장을 위한 **검색 가능한 구체적인 업체명/업종명**을 반드시 포함하여 작성

## ${analysisTemplate.sections[3].icon} ${analysisTemplate.sections[3].title}
위에서 제시한 협업 전략을 실제로 실행하기 위한 구체적인 실행 방법들을 제시해주세요. 네트워킹 방법, 관계 구축 전략, 상호 이익 창출 모델을 포함하여 실무진이 바로 적용할 수 있는 방안을 작성해주세요.

한국 비즈니스 환경과 BNI 네트워킹 특성을 반영하여 800-1000자로 실용적인 분석을 작성해주세요.`;

      const response = await this.ai.models.generateContent({
        model: AI_CONFIG.GEMINI_MODEL,
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
      console.error('Error type:', typeof error);
      console.error('Error name:', (error as any)?.name);
      console.error('Error message:', (error as Error)?.message);
      console.error('Error status:', (error as any)?.status);
      console.error('Error response:', (error as any)?.response?.data);
      
      // API 키 확인
      const apiKey = process.env.GEMINI_API_KEY;
      console.log('API Key 존재 여부:', !!apiKey);
      console.log('API Key 길이:', apiKey?.length || 0);
      
      // 실시간 API만 사용 - 실패시 오류 메시지 반환
      throw new Error(`AI 분석 서비스가 일시적으로 이용 불가능합니다. 잠시 후 다시 시도해주세요. (상세 오류: ${(error as Error)?.message || error})`);
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

  /**
   * 상세한 폴백 분석 생성 (이전 형식 유지)
   */
  private generateDetailedFallbackAnalysis(specialty: string): string {
    // 동적 분석 생성 - 모든 전문분야에 대해 범용적으로 적용
    return `# ${specialty} 전문분야 BNI 네트워킹 분석

## 🏢 핵심 역량 및 시장 포지셔닝 분석

${specialty} 전문가로서 한국 시장에서의 역할과 비즈니스 기회를 분석합니다.

**주요 업무 영역:**
• 전문 서비스 제공 및 고객 만족도 향상
• 시장 동향 분석 및 경쟁력 강화
• 기술 혁신 및 품질 개선
• 고객 관계 관리 및 네트워크 구축

## 🤝 시너지 창출 가능 비즈니스 분야 및 협업 전략

${specialty}와 협업 가능한 다양한 비즈니스 분야를 제시합니다.

**주요 협업 분야:**
• **마케팅 및 브랜딩:** 전문 브랜드 구축 및 디지털 마케팅 강화
• **디자인 및 크리에이티브:** 시각적 브랜드 아이덴티티 및 창작물 개발
• **컨설팅 및 전문 서비스:** 경영 최적화 및 전문성 향상
• **IT 및 기술:** 디지털 전환 및 업무 효율성 개선

## 🎯 시간대별 협업 우선순위 및 실행 로드맵

**단기 전략 (즉시~6개월):** 즉각적 성과를 위한 협업
• 마케팅 파트너십을 통한 인지도 향상
• 브랜딩 강화 및 고객 확장

**중기 전략 (6개월~2년):** 지속 성장을 위한 전략적 협업  
• 서비스 다각화 및 시장 확장
• 기술 혁신 및 프로세스 개선

**장기 전략 (2년 이상):** 종합적 발전을 위한 장기 파트너십
• 업계 리더십 확보
• 지속가능한 성장 모델 구축

## 💡 비즈니스 시너지 극대화 및 실행 방안

**실행 전략:**
• BNI 네트워킹을 통한 신뢰 기반 파트너십 구축
• 상호 추천 시스템 활용한 고객 확장
• 공동 프로젝트를 통한 윈-윈 관계 창출
• 지속적인 전문성 공유 및 상호 발전

${specialty} 분야의 특성을 살린 맞춤형 협업 전략으로 지속 가능한 비즈니스 성장을 실현할 수 있습니다.`;
  }


  /**
   * 기본 시너지 분야 반환
   */
  private getDefaultSynergyFields(specialty: string): string[] {
    // 완전히 동적인 기본값 - 전문분야와 관련된 일반적 협업 분야
    return [
      `${specialty} 관련업체`,
      '마케팅업체', 
      '브랜딩업체', 
      '디자인업체', 
      '컨설팅업체',
      'IT업체'
    ];
  }

  /**
   * 기본 시너지 상세 정보 반환
   */
  private getDefaultSynergyDetails(specialty: string): string {
    return `${specialty} 분야와 협업 가능한 주요 비즈니스 분야들:

• 마케팅 및 브랜딩: 전문적인 홍보 전략 수립
• 디자인 및 크리에이티브: 시각적 브랜드 아이덴티티 구축  
• 제조 및 생산: 제품 개발 및 생산 프로세스 최적화
• 유통 및 판매: 효율적인 유통 채널 구축
• 서비스 및 컨설팅: 전문 서비스 제공 및 경영 컨설팅`;
  }

  /**
   * 기본 우선순위 반환
   */
  private getDefaultPriorities(specialty: string): {
    shortTerm: string[];
    mediumTerm: string[];
    longTerm: string[];
  } {
    // 완전히 동적인 우선순위 - 전문분야 기반
    return {
      shortTerm: [`${specialty} 관련업체`, '마케팅업체', '브랜딩업체'],
      mediumTerm: ['디자인업체', '제조업체', '유통업체'],
      longTerm: ['컨설팅업체', '기술업체', '교육업체']
    };
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
          // 🚨 추상적/검색 불가능한 키워드 강력 필터링
          const invalidKeywords = ['실행 로드맵', '위클리 프리젠테이션', '피처드 프리젠테이션', '방문객 초대', '전략', '협업', '추천', '우선순위', '방안', '로드맵', '프리젠테이션'];
          const isValid = item.length > 2 && item.length < 20 && 
                         !invalidKeywords.some(invalid => item.includes(invalid)) &&
                         (item.includes('업체') || item.includes('업') || item.includes('법인') || item.includes('회사') || item.includes('기관') || item.includes('센터'));
          if (isValid) {
            priorities[currentSection as keyof typeof priorities].push(item);
          }
        }
      }
    }

    // 🚫 하드코딩 완전 제거: AI가 생성하지 못하면 빈 배열로 유지
    // 기본값 설정 없음 - 100% AI 동적 생성만 사용

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

  /**
   * AI 분석에서 협업 분야 구조화 추출 (범용 동적 시스템) - 강화된 파싱
   */
  private parseSynergyCollaborationFields(analysisText: string): Array<{
    index: number;
    title: string;
    description: string;
    collaborationMethod: string;
    keywords: string[];
  }> {
    console.log('🔍 AI 분석에서 협업 분야 구조화 추출 시작 (강화된 파싱)');
    console.log(`📄 분석 텍스트 길이: ${analysisText.length}자`);
    
    const collaborationFields: Array<{
      index: number;
      title: string; 
      description: string;
      collaborationMethod: string;
      keywords: string[];
    }> = [];

    // "🤝 시너지 창출 가능 비즈니스 분야" 섹션 찾기 (더 유연한 매칭)
    const sectionPatterns = [
      /🤝\s*시너지.*?분야[\s\S]*?\n([\s\S]*?)(?=\n\n|$)/i,
      /시너지.*?창출.*?분야[\s\S]*?\n([\s\S]*?)(?=\n\n|$)/i,
      /협업.*?분야[\s\S]*?\n([\s\S]*?)(?=\n\n|$)/i
    ];

    let content = '';
    for (const pattern of sectionPatterns) {
      const match = analysisText.match(pattern);
      if (match && match[1]) {
        content = match[1];
        console.log(`✅ 협업 분야 섹션 발견 (길이: ${content.length}자)`);
        break;
      }
    }
    
    if (!content) {
      console.log('⚠️ 협업 분야 섹션을 찾을 수 없음 - 전체 텍스트에서 협업 분야 추출 시도');
      content = analysisText;
    }

    // 강화된 파싱: 패션디자이너 텍스트 구조에 최적화된 패턴들
    const fieldPatterns = [
      // 1. "숫자. **제목 (괄호 설명):**" 패턴 - 패션디자이너 전용
      /(\d+)\.?\s*\*{2,3}\s*([^*:]+?)\s*\(([^)]+?)\)\s*\*{2,3}\s*:\s*([\s\S]*?)(?=\n\s*\d+\.|\n\s*\*{1,3}|$)/g,
      // 2. "숫자. **제목:**" 패턴
      /(\d+)\.?\s*\*{2,3}\s*([^*:]+?)\s*\*{2,3}\s*:\s*([\s\S]*?)(?=\n\s*\d+\.|\n\s*\*{2,3}|$)/g,
      // 3. 일반 "숫자. 제목:" 패턴 (별표 없음)
      /(\d+)\.?\s*([^:\n]+?):\s*([\s\S]*?)(?=\n\s*\d+\.|\n\s*\*|$)/g,
      // 4. "- **제목:**" 패턴
      /\-\s*\*{2,3}\s*([^*:]+?)\s*\*{2,3}\s*:\s*([\s\S]*?)(?=\n\s*\-|\n\s*\*{2,3}|$)/g
    ];

    let totalMatches = 0;
    for (const pattern of fieldPatterns) {
      let match: RegExpExecArray | null;
      pattern.lastIndex = 0; // 정규식 초기화
      
      while ((match = pattern.exec(content)) !== null) {
        totalMatches++;
        let title = '';
        let description = '';
        
        if (match.length >= 5) {
          // 괄호 포함 패턴 (match[1]은 숫자, match[2]는 제목, match[3]은 괄호내용, match[4]는 설명)
          title = match[2].trim().replace(/\*{1,3}/g, '').trim();
          const parenthesis = match[3] ? match[3].trim() : '';
          description = match[4].trim();
          
          // 괄호 내용을 제목에 포함
          if (parenthesis && !title.includes(parenthesis)) {
            title = `${title} ${parenthesis}`.trim();
          }
        } else if (match.length >= 4) {
          // 숫자가 있는 일반 패턴 (match[1]은 숫자, match[2]는 제목, match[3]은 설명)
          title = match[2].trim().replace(/\*{1,3}/g, '').trim();
          description = match[3].trim();
        } else if (match.length >= 3) {
          // 숫자가 없는 패턴 (match[1]은 제목, match[2]는 설명)
          title = match[1].trim().replace(/\*{1,3}/g, '').trim();
          description = match[2].trim();
        }
        
        // 제목 정리 (불필요한 괄호 내용은 제거하되 핵심은 유지)
        const titleWithoutParens = title.replace(/\s*\([^)]*그래퍼[^)]*\)/g, '').trim();
        
        if (titleWithoutParens && description && titleWithoutParens.length > 2) {
          console.log(`🎯 협업 분야 발견: "${titleWithoutParens}" (설명 길이: ${description.length}자)`);
          
          // 키워드 추출 (업종명들)
          const keywords = this.extractKeywordsFromDescription(titleWithoutParens, description);
          
          // 협업 방안 추출
          const collaborationMethod = this.extractCollaborationMethod(description);
          
          collaborationFields.push({
            index: collaborationFields.length + 1,
            title: titleWithoutParens,
            description: description.split('\n')[0].trim(), // 첫 번째 줄만
            collaborationMethod,
            keywords
          });
          
          console.log(`  📋 키워드: [${keywords.join(', ')}]`);
          console.log(`  🤝 협업방안: ${collaborationMethod}`);
        }
      }
      
      if (collaborationFields.length > 0) {
        console.log(`✅ 패턴 ${fieldPatterns.indexOf(pattern) + 1}에서 ${collaborationFields.length}개 분야 추출 성공`);
        break; // 첫 번째 성공한 패턴에서 중단
      }
    }

    console.log(`🔍 총 매칭 시도: ${totalMatches}회, 최종 추출: ${collaborationFields.length}개 협업 분야`);
    return collaborationFields.slice(0, 10); // 최대 10개
  }

  /**
   * 설명에서 키워드 추출 (강화된 키워드 매칭)
   */
  private extractKeywordsFromDescription(title: string, description: string): string[] {
    const keywords: string[] = [];
    
    // 제목에서 핵심 키워드 추출
    const titleKeywords = title.split(/[\/,&\s\(\)]+/).map(k => k.trim()).filter(k => k.length > 1);
    keywords.push(...titleKeywords);
    
    // 업종별 전문 키워드 매칭
    const industryMappings = {
      '사진작가': ['사진', '포토', '스튜디오', '촬영'],
      '영상': ['영상', '비디오', '촬영', '편집'],
      '헤어': ['미용실', '헤어', '미용'],
      '메이크업': ['메이크업', '화장', '뷰티'],
      '스타일리스트': ['스타일링', '코디'],
      '원단': ['원단', '섬유', '텍스타일', '직물'],
      '부자재': ['부자재', '자재', '원료'],
      '봉제': ['봉제', '의류제조', '재봉'],
      '패턴': ['패턴', '의류설계'],
      '마케팅': ['마케팅', '광고', '홍보'],
      '인플루언서': ['인플루언서', 'SNS', '소셜미디어'],
      '쥬얼리': ['주얼리', '보석', '귀금속'],
      '가방': ['가방', '핸드백', '백'],
      '슈즈': ['신발', '구두', '슈즈'],
      '변호사': ['변호사', '법무', '법률']
    };

    // 제목과 설명에서 업종 매칭
    const fullText = `${title} ${description}`.toLowerCase();
    for (const [industry, relatedKeywords] of Object.entries(industryMappings)) {
      if (fullText.includes(industry.toLowerCase())) {
        keywords.push(industry);
        keywords.push(...relatedKeywords);
      }
      
      for (const keyword of relatedKeywords) {
        if (fullText.includes(keyword.toLowerCase())) {
          keywords.push(keyword);
          keywords.push(industry);
        }
      }
    }
    
    // 설명에서 업체 유형 키워드 추출
    const businessTypes = description.match(/[가-힣a-zA-Z]+업체|[가-힣a-zA-Z]+사|[가-힣a-zA-Z]+점|[가-힣a-zA-Z]+관|[가-힣a-zA-Z]+원/g) || [];
    keywords.push(...businessTypes.map(k => k.replace(/업체|사|점|관|원$/g, '')));
    
    // 일반적인 비즈니스 키워드
    const businessKeywords = description.match(/사진|영상|스튜디오|원단|부자재|패턴|봉제|주얼리|액세서리|법무|변호사|회계|세무|인테리어|디자인|마케팅|광고|브랜딩|미용실|화장|뷰티|스타일링/g) || [];
    keywords.push(...businessKeywords);
    
    // 중복 제거 및 필터링
    const uniqueKeywords: string[] = [];
    for (const keyword of keywords) {
      if (keyword.length > 1 && uniqueKeywords.indexOf(keyword) === -1) {
        uniqueKeywords.push(keyword);
      }
    }
    
    console.log(`    🔑 "${title}"에서 추출된 키워드: [${uniqueKeywords.slice(0, 8).join(', ')}]`);
    return uniqueKeywords;
  }

  /**
   * 협업 방안 추출
   */
  private extractCollaborationMethod(description: string): string {
    // 괄호 안의 협업 방안 추출
    const methodMatch = description.match(/\((.*?)\)/);
    if (methodMatch) {
      return methodMatch[1].trim();
    }
    
    // 협업 관련 키워드 기반 추출
    const methodKeywords = description.match(/협업|공동|파트너십|제휴|연계|지원|개발|기획|제작|컨설팅/g);
    if (methodKeywords) {
      return `${methodKeywords.join(', ')} 기반 협력`;
    }
    
    return '전략적 파트너십 구축';
  }

  /**
   * 업체와 협업 분야 동적 매칭
   */
  private matchBusinessToCollaborationField(
    businessName: string, 
    category: string, 
    collaborationFields: Array<{
      index: number;
      title: string;
      description: string;
      collaborationMethod: string;
      keywords: string[];
    }>
  ): { 
    categoryName: string; 
    categoryIndex: number; 
    description: string;
    collaborationMethod: string;
  } | null {
    const name = businessName.toLowerCase();
    const cat = category.toLowerCase();
    
    // 각 협업 분야와 매칭 점수 계산
    let bestMatch: any = null;
    let bestScore = 0;
    
    for (const field of collaborationFields) {
      let score = 0;
      
      // 키워드 매칭 점수
      for (const keyword of field.keywords) {
        if (name.includes(keyword.toLowerCase()) || cat.includes(keyword.toLowerCase())) {
          score += 2;
        }
      }
      
      // 제목과의 유사도 점수
      if (name.includes(field.title.toLowerCase()) || cat.includes(field.title.toLowerCase())) {
        score += 3;
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          categoryName: field.title,
          categoryIndex: field.index,
          description: field.description,
          collaborationMethod: field.collaborationMethod
        };
      }
    }
    
    return bestScore > 0 ? bestMatch : null;
  }

  async searchRegionalBusinesses(searchQuery: string, userSpecialty: string = '일반', userRegion: string = '강남구'): Promise<{ businesses: NaverPlaceBusiness[] }> {
    console.log('🎯 순수 동적 검색 시작 - 하드코딩 완전 제거');
    console.log(`  전문분야: "${userSpecialty}", 지역: "${userRegion}", AI 분석 길이: ${searchQuery.length}자`);
      
    try {
      // 새로운 순수 동적 검색 시스템 사용 - AI 분석만을 사용한 완전 동적 검색
      const businesses = await this.pureDynamicSearch.searchCollaborationBusinesses(
        searchQuery,
        userSpecialty,
        userRegion
      );
      
      console.log(`🎯 순수 동적 검색 완료 - ${businesses.length}개 업체 발견`);
      
      if (businesses.length > 0) {
        console.log(`📊 검색된 업체 목록:`);
        businesses.forEach((business, index) => {
          console.log(`  ${index + 1}. ${business.name} (${business.category}) - ${business.address}`);
        });
        return { businesses };
      } else {
        console.log(`⚠️ "${userSpecialty}" 전문분야의 "${userRegion}" 지역에서 AI 분석 기반 협업 가능한 업체를 찾을 수 없습니다.`);
      }
      
      return { businesses: [] };
    } catch (error) {
      console.error(`❌ 순수 동적 검색 실패:`, error);
      return { businesses: [] };
    }
  }

  private async generateDynamicBusinessResponse(userSpecialty: string = '', userRegion: string = '') {
    // 사용자 정보가 없으면 오류 반환
    if (!userSpecialty || !userRegion) {
      throw new Error('사용자의 전문분야 또는 지역 정보가 확인되지 않습니다. 프로필을 확인해주세요.');
    }

    console.log(`🔄 ${userSpecialty} 전문분야 실제 업체 검색 시작 - 지역: ${userRegion}`);

    // 실제 업체 검색 실행
    try {
      
      const retryResponse = await this.ai.models.generateContent({
        model: "gemini-1.5-pro",
        config: {
          maxOutputTokens: 1000,
          temperature: 0.1,
        },
        contents: [
          `서울 ${userRegion} 지역에서 "${userSpecialty}" 전문분야와 협업 가능한 실제 업체들을 찾아주세요.

다음 형태로 답변해주세요:

업체명: [실제 업체명]
분류: [협업 분야]
주소: 서울 ${userRegion} [실제 주소]  
연락처: [실제 전화번호]
웹사이트: [실제 URL]
협업방안: [${userSpecialty}와의 구체적 협업 내용]
---

**중요**: 
- 실제로 존재하는 업체만 추천하세요
- ${userSpecialty}와 실제 협업이 가능한 업체들로만 구성
- 최소 5개 이상 추천`
        ]
      });

      let textResponse = retryResponse.text || retryResponse.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (textResponse && textResponse.length > 50) {
        console.log(`✅ ${userSpecialty} 동적 검색 성공 - 응답 길이: ${textResponse.length}`);
        
        const businesses = this.parseTextResponseToBusinesses(textResponse, userRegion);
        
        if (businesses.length > 0) {
          console.log(`📊 파싱 성공: ${businesses.length}개 업체 발견`);
          return { businesses };
        }
      }
    } catch (retryError) {
      console.error('동적 업체 검색 실패:', retryError);
    }

    // 최종 시도: 가장 간단한 방법으로 실제 업체 검색
    console.log('🔄 최종 시도: gemini-1.5-flash로 간단한 지역 업체 검색');
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const finalResponse = await this.ai.models.generateContent({
        model: "gemini-1.5-flash",
        config: {
          maxOutputTokens: 800,
          temperature: 0.3,
        },
        contents: [`서울 ${userRegion}에서 ${userSpecialty}와 협업할 수 있는 실제 업체를 찾아주세요.

다음과 같은 대형 프랜차이즈나 알려진 업체들 중에서 선택해주세요:

**베이커리/카페**: 파리바게뜨, 뚜레쥬르, 스타벅스, 이디야, 투썸플레이스
**대형마트**: 롯데마트, 홈플러스, 이마트, 코스트코
**배송/물류**: CJ대한통운, 로젠택배, 한진택배
**온라인몰**: 쿠팡, 마켓컬리, SSG닷컴
**호텔/관광**: 롯데호텔, 신라호텔, 그랜드하얏트

형식: 업체명 - 업종 - 서울 ${userRegion} - 협업내용

실제 업체 5개:`]
      });

      const responseText = finalResponse.text || finalResponse.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (responseText && responseText.length > 100) {
        console.log('✅ 최종 시도 성공 - 실제 업체 정보 획득');
        const businesses = this.parseSimpleTextToBusinesses(responseText, userRegion);
        
        if (businesses.length > 0) {
          console.log(`✅ ${businesses.length}개 실제 업체 발견`);
          return { businesses };
        }
      }
    } catch (finalError) {
      console.error('최종 시도도 실패:', finalError);
    }

    // 모든 시도 실패 시 솔직한 안내
    console.log(`❌ 모든 검색 시도 실패 - 외부 서비스 일시 불안정`);
    throw new Error(`현재 외부 검색 서비스가 일시적으로 불안정합니다. 잠시 후 다시 시도해주세요.`);
  }

  private parseSimpleTextToBusinesses(textResponse: string, userRegion: string): NaverPlaceBusiness[] {
    const businesses: any[] = [];
    const lines = textResponse.split('\n').filter(line => line.trim().length > 10);
    
    for (const line of lines) {
      // 다양한 패턴 매칭
      const patterns = [
        /(\d+\.?\s*)?(.+?)\s*-\s*(.+?)\s*-\s*(.+?)\s*-\s*(.+)/,
        /(.+?)\s*:\s*(.+?)\s*,\s*(.+?)\s*,\s*(.+)/,
        /(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+)/
      ];
      
      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match) {
          const name = (match[2] || match[1] || '').trim();
          const category = (match[3] || match[2] || '').trim();
          const location = (match[4] || match[3] || '').trim();
          const synergy = (match[5] || match[4] || '').trim();
          
          // 가상/예시 표현 필터링
          const isRealBusiness = !name.includes('가상') && !name.includes('예시') && 
                                !name.includes('(가상)') && !name.includes('(예시)') &&
                                !name.includes('[가상]') && !name.includes('[예시]');
          
          if (name && category && name.length > 1 && category.length > 1 && isRealBusiness) {
            businesses.push({
              name,
              category,
              address: location.includes(userRegion) ? location : `서울 ${userRegion} ${location}`,
              phone: '02-0000-0000',
              website: '',
              synergyPotential: synergy || '파트너십 협업 가능',
              description: `${category} 전문업체로 ${name}에서 서비스 제공`
            });
            break;
          }
        }
      }
    }
    
    return businesses.slice(0, 10);
  }

  /**
   * AI 분석 텍스트에서 협업 분야 추출 (유틸리티 함수)
   */
  private async extractSynergyFieldsFromAnalysis(analysisText: string, userSpecialty: string): Promise<string[]> {
    console.log(`🔍 동적 협업 분야 추출 시작 - 전문분야: "${userSpecialty}"`);
    
    // Gemini AI를 활용한 동적 협업 분야 추출
    try {
      const prompt = `"${userSpecialty}" 전문분야와 협업 가능한 업종 5-8개를 추출해주세요.

다음 형태로만 답변하세요:
업종1, 업종2, 업종3, 업종4, 업종5

예시:
- 건축설계사 → 인테리어업체, 시공업체, 자재업체, 부동산업체, 엔지니어링업체
- 의료진 → 의료기기업체, 제약업체, 헬스케어업체, 의료정보업체, 보험업체
- 마케팅전문가 → 광고대행사, 디자인업체, IT업체, 이벤트업체, 컨설팅업체

중요: 업체명이 아닌 업종만 나열하고, 쉼표로만 구분하세요.`;

      const response = await this.ai.models.generateContent({
        model: "gemini-1.5-flash",
        config: {
          maxOutputTokens: 200,
          temperature: 0.1,
        },
        contents: [prompt]
      });

      const responseText = response.text || '';
      
      if (responseText && responseText.length > 10) {
        // 응답에서 협업 분야 추출
        const extractedFields = responseText
          .split(',')
          .map(field => field.trim())
          .filter(field => field.length > 1 && field.length < 20)
          .slice(0, 8);
        
        if (extractedFields.length >= 3) {
          console.log(`✅ AI 동적 추출 성공 - "${userSpecialty}": [${extractedFields.join(', ')}]`);
          return extractedFields;
        }
      }
      
      console.log(`⚠️ AI 추출 결과 부족 - 텍스트 분석으로 전환`);
    } catch (error) {
      console.log(`❌ AI 동적 추출 실패 - 텍스트 분석으로 전환:`, error);
    }

    // AI 추출 실패 시 더 스마트한 분석 텍스트 기반 시너지 분야 추출
    if (analysisText && analysisText.length > 50) {
      console.log(`📊 분석 텍스트 기반 시너지 분야 추출 시작 (텍스트 길이: ${analysisText.length}자)`);
      
      const extractedFields: string[] = [];
      
      // 1. 직접적인 협업 분야 언급 찾기
      const collaborationPatterns = [
        /협업[^.]*?([가-힣]{2,8}업체|[가-힣]{2,8}회사|[가-힣]{2,8}기업)/g,
        /파트너[^.]*?([가-힣]{2,8}업체|[가-힣]{2,8}회사|[가-힣]{2,8}기업)/g,
        /시너지[^.]*?([가-힣]{2,8}업체|[가-힣]{2,8}회사|[가-힣]{2,8}기업)/g,
        /연계[^.]*?([가-힣]{2,8}업체|[가-힣]{2,8}회사|[가-힣]{2,8}기업)/g
      ];
      
      for (const pattern of collaborationPatterns) {
        let match;
        while ((match = pattern.exec(analysisText)) !== null) {
          if (match[1] && !extractedFields.includes(match[1])) {
            extractedFields.push(match[1]);
          }
        }
      }
      
      // 2. 전문분야별 맞춤형 시너지 분야 추출
      const contextualFields = this.extractContextualSynergyFields(userSpecialty, analysisText);
      for (const field of contextualFields) {
        if (!extractedFields.includes(field)) {
          extractedFields.push(field);
        }
      }

      // 3. 산업 키워드 기반 추출 (개선된 로직)
      const industryKeywords = this.getIndustryKeywords(userSpecialty);
      for (const keyword of industryKeywords) {
        if (analysisText.includes(keyword) && !extractedFields.includes(keyword + '업체')) {
          extractedFields.push(keyword + '업체');
        }
      }

      // 결과 필터링 및 정리
      const finalFields = extractedFields
        .filter(field => field.length > 2 && field.length < 15)
        .slice(0, 8);

      if (finalFields.length > 0) {
        console.log(`✅ 스마트 텍스트 분석 성공 - "${userSpecialty}": [${finalFields.join(', ')}]`);
        return finalFields;
      }
    }

    // 최종 기본값
    const defaultFields = [`${userSpecialty} 관련업체`, '마케팅업체', '컨설팅업체', '디자인업체', 'IT업체'];
    console.log(`📋 기본 협업 분야 사용 - "${userSpecialty}": [${defaultFields.join(', ')}]`);
    return defaultFields;
  }

  private parseTextResponseToBusinesses(textResponse: string, userRegion: string): NaverPlaceBusiness[] {
    const businesses: any[] = [];
    const sections = textResponse.split('---');
    
    for (const section of sections) {
      if (section.trim().length < 20) continue;
      
      const lines = section.trim().split('\n');
      const business: any = {};
      
      for (const line of lines) {
        const [key, ...valueParts] = line.split(':');
        const value = valueParts.join(':').trim();
        
        if (key.includes('업체명') || key.includes('이름')) {
          business.name = value;
        } else if (key.includes('분류') || key.includes('업종')) {
          business.category = value;
        } else if (key.includes('주소')) {
          business.address = value;
        } else if (key.includes('연락처') || key.includes('전화')) {
          business.phone = value === '정보 없음' ? '' : value;
        } else if (key.includes('웹사이트') || key.includes('URL')) {
          business.website = value === '정보 없음' ? '' : value;
        } else if (key.includes('협업') || key.includes('시너지')) {
          business.synergyPotential = value;
        }
      }
      
      // 필수 정보가 있는 경우에만 추가
      if (business.name && business.category && business.synergyPotential) {
        business.description = business.category + ' 전문업체';
        if (!business.address) business.address = `서울 ${userRegion}`;
        businesses.push(business);
      }
    }
    
    return businesses;
  }



  /**
   * 전문분야별 맞춤형 시너지 분야 추출
   */
  private extractContextualSynergyFields(userSpecialty: string, analysisText: string): string[] {
    const fields: string[] = [];
    const specialty = userSpecialty.toLowerCase();
    
    // 농업 관련
    if (specialty.includes('농장') || specialty.includes('농업') || specialty.includes('재배')) {
      const agriKeywords = ['식품', '유통', '마케팅', '포장', '가공', '물류', '카페', '레스토랑', '관광'];
      for (const keyword of agriKeywords) {
        if (analysisText.includes(keyword)) {
          fields.push(keyword + '업체');
        }
      }
    }
    
    // IT/기술 관련
    else if (specialty.includes('IT') || specialty.includes('개발') || specialty.includes('프로그래밍')) {
      const techKeywords = ['마케팅', '디자인', '컨설팅', '교육', '금융', '의료', '제조'];
      for (const keyword of techKeywords) {
        if (analysisText.includes(keyword)) {
          fields.push(keyword + '업체');
        }
      }
    }
    
    // 의료/건강 관련
    else if (specialty.includes('의료') || specialty.includes('의사') || specialty.includes('간호') || specialty.includes('치료')) {
      const medicalKeywords = ['의료기기', '제약', '헬스케어', '보험', 'IT', '교육'];
      for (const keyword of medicalKeywords) {
        if (analysisText.includes(keyword)) {
          fields.push(keyword + '업체');
        }
      }
    }
    
    // 건축/부동산 관련
    else if (specialty.includes('건축') || specialty.includes('부동산') || specialty.includes('인테리어')) {
      const constructionKeywords = ['시공', '자재', '인테리어', '부동산', '금융', '법무'];
      for (const keyword of constructionKeywords) {
        if (analysisText.includes(keyword)) {
          fields.push(keyword + '업체');
        }
      }
    }
    
    // 법무/금융 관련
    else if (specialty.includes('법무') || specialty.includes('변호사') || specialty.includes('회계') || specialty.includes('세무')) {
      const legalKeywords = ['부동산', '금융', '보험', '컨설팅', 'IT', '기업'];
      for (const keyword of legalKeywords) {
        if (analysisText.includes(keyword)) {
          fields.push(keyword + '업체');
        }
      }
    }
    
    return fields;
  }

  /**
   * 전문분야별 산업 키워드 반환
   */
  private getIndustryKeywords(userSpecialty: string): string[] {
    const specialty = userSpecialty.toLowerCase();
    
    // 농업 관련
    if (specialty.includes('농장') || specialty.includes('농업') || specialty.includes('재배')) {
      return ['카페', '레스토랑', '식품', '유통', '마케팅', '포장', '가공', '물류', '관광', '교육'];
    }
    
    // IT/기술 관련
    if (specialty.includes('IT') || specialty.includes('개발') || specialty.includes('프로그래밍')) {
      return ['마케팅', '디자인', '컨설팅', '교육', '금융', '의료', '제조', '유통', '게임', '미디어'];
    }
    
    // 의료/건강 관련
    if (specialty.includes('의료') || specialty.includes('의사') || specialty.includes('간호') || specialty.includes('치료')) {
      return ['의료기기', '제약', '헬스케어', '보험', 'IT', '교육', '바이오', '화학', '연구'];
    }
    
    // 건축/부동산 관련
    if (specialty.includes('건축') || specialty.includes('부동산') || specialty.includes('인테리어')) {
      return ['시공', '자재', '인테리어', '부동산', '금융', '법무', '설계', '조경', '전기'];
    }
    
    // 법무/금융 관련
    if (specialty.includes('법무') || specialty.includes('변호사') || specialty.includes('회계') || specialty.includes('세무')) {
      return ['부동산', '금융', '보험', '컨설팅', 'IT', '기업', '투자', '감사', '세무'];
    }
    
    // 마케팅/광고 관련
    if (specialty.includes('마케팅') || specialty.includes('광고') || specialty.includes('브랜딩')) {
      return ['디자인', 'IT', '미디어', '이벤트', '인쇄', '방송', '출판', '웹에이전시'];
    }
    
    // 교육 관련
    if (specialty.includes('교육') || specialty.includes('강사') || specialty.includes('학원')) {
      return ['IT', '출판', '미디어', '완구', '문구', '교구', '컨설팅', '심리'];
    }
    
    // 제조업 관련
    if (specialty.includes('제조') || specialty.includes('생산') || specialty.includes('공장')) {
      return ['자동화', '물류', '품질관리', '환경', '안전', '포장', '유통', '마케팅'];
    }
    
    // 기본 키워드 (다른 분야)
    return ['마케팅', '컨설팅', 'IT', '디자인', '금융', '법무', '교육', '유통'];
  }

  async generateSynergyFields(userSpecialty: string): Promise<string[]> {
    try {
      console.log(`🎯 ${userSpecialty} 전문분야의 시너지 분야 동적 생성 시작`);
      
      const response = await this.ai.models.generateContent({
        model: AI_CONFIG.GEMINI_MODEL,
        config: {
          maxOutputTokens: 300,
          temperature: 0.1,
        },
        contents: [
          `${userSpecialty}와 협업할 수 있는 업종을 10개 추천해주세요.

- 카페/레스토랑
- 물류업체
- 마케팅업체
- 유통업체
- 관광업체
- 제조업체
- 서비스업체
- 교육업체
- IT업체
- 컨설팅업체

위 형태로 간단히 답변하세요.`
        ]
      });

      let responseText = response.text || response.candidates?.[0]?.content?.parts?.[0]?.text;
      console.log(`📥 시너지 분야 원본 응답: "${responseText}"`);
      
      if (responseText) {
        // "-"로 시작하는 라인들을 추출하여 시너지 분야 리스트 생성
        const fields = responseText
          .split('\n')
          .filter(line => line.trim().startsWith('-'))
          .map(line => line.replace(/^-\s*/, '').trim())
          .filter(field => field.length > 0 && field.length < 20)
          .slice(0, 10); // 최대 10개로 제한

        console.log(`✅ ${userSpecialty} 시너지 분야 생성 완료: [${fields.join(', ')}]`);
        
        if (fields.length === 0) {
          console.log('⚠️ 시너지 분야 파싱 실패 - 기본값 사용');
          return ['카페업체', '마케팅업체', '유통업체', '물류업체', '서비스업체', '제조업체', '교육업체', 'IT업체', '컨설팅업체', '관광업체'];
        }
        
        return fields;
      }
      
      console.log('⚠️ 빈 응답 - 기본 시너지 분야 사용');
      return ['카페업체', '마케팅업체', '유통업체', '물류업체', '서비스업체', '제조업체', '교육업체', 'IT업체', '컨설팅업체', '관광업체'];
    } catch (error) {
      console.error(`시너지 분야 생성 오류 (${userSpecialty}):`, error);
      return ['카페업체', '마케팅업체', '유통업체', '물류업체', '서비스업체', '제조업체', '교육업체', 'IT업체', '컨설팅업체', '관광업체'];
    }
  }

  private getFallbackBusinesses(userSpecialty: string = '', userRegion: string = '') {
    // 더 이상 하드코딩된 데이터를 사용하지 않음
    throw new Error(`'${userSpecialty}' 전문분야에 대한 실제 업체 데이터를 현재 조회할 수 없습니다. 잠시 후 다시 시도해주세요.`);
  }

  private getOldFallbackData() {
    // 완전히 삭제됨 - 가짜 데이터 제공 금지
    throw new Error("하드코딩된 가짜 데이터는 더 이상 제공하지 않습니다. 실제 API 데이터만 사용합니다.");
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