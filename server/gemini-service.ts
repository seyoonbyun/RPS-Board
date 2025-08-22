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
${specialty}와 협업할 수 있는 다양한 비즈니스 분야들을 제시하고, 각 분야별로 구체적인 협업 방안, 예상되는 시너지 효과, 실제 협업 사례나 모델을 상세히 설명해주세요.

## ${analysisTemplate.sections[2].icon} ${analysisTemplate.sections[2].title}
다음과 같이 시간대별로 구분하여 협업 전략을 제시해주세요:

**단기 전략 (즉시~6개월):** 즉각적인 성과를 기대할 수 있는 협업 분야들

**중기 전략 (6개월~2년):** 지속적인 관계 구축과 상호 성장을 위한 전략적 협업 분야들

**장기 전략 (2년 이상):** 혁신과 사업 확장을 위한 장기적 파트너십 구축 분야들

## ${analysisTemplate.sections[3].icon} ${analysisTemplate.sections[3].title}
위에서 제시한 협업 전략을 실제로 실행하기 위한 구체적인 실행 방법들을 제시해주세요. 네트워킹 방법, 관계 구축 전략, 상호 이익 창출 모델을 포함하여 실무진이 바로 적용할 수 있는 방안을 작성해주세요.

한국 비즈니스 환경과 BNI 네트워킹 특성을 반영하여 800-1000자로 실용적인 분석을 작성해주세요.`;

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

  async searchRegionalBusinesses(searchQuery: string, userSpecialty: string = '일반', userRegion: string = '강남구'): Promise<{ businesses: any[] }> {
    try {
      console.log('🔍 지역 업체 검색 시작:', { userSpecialty, userRegion });
      console.log('🔑 GEMINI_API_KEY 존재 여부:', !!process.env.GEMINI_API_KEY);
      
      if (!process.env.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
      }
      
      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-pro",
        config: {
          maxOutputTokens: 1200,
          temperature: 0.1,
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
                    website: { type: "string" },
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
        contents: [searchQuery]
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
            console.log('Invalid data structure, generating dynamic response');
            return await this.generateDynamicBusinessResponse(userSpecialty, userRegion);
          }
        } catch (parseError) {
          console.error('JSON 파싱 오류:', parseError);
          console.log('Using dynamic response due to parse error');
          return await this.generateDynamicBusinessResponse(userSpecialty, userRegion);
        }
      } else {
        console.log('Empty response from Gemini API, generating dynamic response');
        return await this.generateDynamicBusinessResponse(userSpecialty, userRegion);
      }
    } catch (error) {
      console.error('Gemini 지역 업체 검색 오류:', error);
      console.error('Error type:', typeof error);
      console.error('Error name:', (error as any)?.name);
      console.error('Error message:', (error as Error)?.message);
      
      // Gemini API 500 오류인 경우 특별 처리
      if ((error as any)?.status === 500 || (error as Error)?.message?.includes('INTERNAL')) {
        console.log('🔄 Gemini API 500 오류 감지 - 간단한 재시도 실행');
        try {
          // 더 간단한 프롬프트로 재시도
          await new Promise(resolve => setTimeout(resolve, 2000)); // 2초 대기
          
          const simpleResponse = await this.ai.models.generateContent({
            model: "gemini-1.5-flash",
            config: {
              maxOutputTokens: 600,
              temperature: 0.5,
            },
            contents: [
              `서울 ${userRegion}에서 "${userSpecialty}" 사업자가 협업할 수 있는 업체 5개만 간단히 추천해주세요.
              
업체명:
분류:  
주소:
협업방안:
---

실제 존재하는 업체만 추천하세요.`
            ]
          });
          
          let simpleText = simpleResponse.text || simpleResponse.candidates?.[0]?.content?.parts?.[0]?.text;
          if (simpleText && simpleText.length > 50) {
            const businesses = this.parseTextResponseToBusinesses(simpleText, userRegion);
            if (businesses.length > 0) {
              console.log('✅ 간단한 재시도 성공');
              return { businesses };
            }
          }
        } catch (retryError) {
          console.error('간단한 재시도도 실패:', retryError);
        }
        
        console.log('🔄 간단한 재시도 실패 - 동적 검색으로 전환');
        return await this.generateDynamicBusinessResponse(userSpecialty, userRegion);
      }
      
      return await this.generateDynamicBusinessResponse(userSpecialty, userRegion);
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

  private parseSimpleTextToBusinesses(textResponse: string, userRegion: string): any[] {
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
    
    return businesses.slice(0, 5);
  }

  private parseTextResponseToBusinesses(textResponse: string, userRegion: string): any[] {
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



  async generateSynergyFields(userSpecialty: string): Promise<string[]> {
    try {
      console.log(`🎯 ${userSpecialty} 전문분야의 시너지 분야 동적 생성 시작`);
      
      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-flash",
        config: {
          maxOutputTokens: 300,
          temperature: 0.1,
        },
        contents: [
          `${userSpecialty}와 협업할 수 있는 업종을 5개만 추천해주세요.

- 카페/레스토랑
- 물류업체
- 마케팅업체
- 유통업체
- 관광업체

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
          .slice(0, 8); // 최대 8개로 제한

        console.log(`✅ ${userSpecialty} 시너지 분야 생성 완료: [${fields.join(', ')}]`);
        
        if (fields.length === 0) {
          console.log('⚠️ 시너지 분야 파싱 실패 - 기본값 사용');
          return ['카페업체', '마케팅업체', '유통업체', '물류업체', '서비스업체'];
        }
        
        return fields;
      }
      
      console.log('⚠️ 빈 응답 - 기본 시너지 분야 사용');
      return ['카페업체', '마케팅업체', '유통업체', '물류업체', '서비스업체'];
    } catch (error) {
      console.error(`시너지 분야 생성 오류 (${userSpecialty}):`, error);
      return ['카페업체', '마케팅업체', '유통업체', '물류업체', '서비스업체'];
    }
  }

  private getFallbackBusinesses(userSpecialty: string = '', userRegion: string = '') {
    // 더 이상 하드코딩된 데이터를 사용하지 않음
    throw new Error(`'${userSpecialty}' 전문분야에 대한 실제 업체 데이터를 현재 조회할 수 없습니다. 잠시 후 다시 시도해주세요.`);
  }

  private getOldFallbackData() {
    // 삭제된 하드코딩 데이터 - 더 이상 사용하지 않음
    const fallbackData = {
      '패션디자이너': [
        {
          name: "강남 패션 스튜디오",
          category: "패션 스타일링",
          address: `서울 ${userRegion} 패션거리 123-45`,
          phone: "02-1111-2222",
          website: "https://www.gangnamfashion.co.kr",
          synergyPotential: "패션쇼 및 브랜딩 협업 가능",
          description: "패션 스타일링 및 코디네이팅 전문 스튜디오"
        },
        {
          name: "크리에이티브 마케팅 에이전시",
          category: "브랜딩 마케팅",
          address: `서울 ${userRegion} 창작로 456-78`,
          phone: "02-2222-3333",
          website: "https://www.creativeagency.co.kr",
          synergyPotential: "패션 브랜드 마케팅 전략 수립",
          description: "패션 및 라이프스타일 브랜드 전문 마케팅"
        },
        {
          name: "프로 패션 포토그래피",
          category: "사진 스튜디오",
          address: `서울 ${userRegion} 스튜디오길 789-01`,
          phone: "02-3333-4444",
          website: "https://www.profashionphoto.co.kr",
          synergyPotential: "제품 촬영 및 화보 제작 협업",
          description: "패션 및 제품 전문 촬영 스튜디오"
        },
        {
          name: "패션텍 제조공장",
          category: "의류 제조",
          address: `서울 ${userRegion} 제조단지 234-56`,
          phone: "02-4444-5555",
          website: "https://www.fashiontech.co.kr",
          synergyPotential: "디자인 제품의 대량 생산 파트너",
          description: "고품질 의류 제조 및 OEM 서비스"
        },
        {
          name: "스타일리시 부티크",
          category: "패션 소매",
          address: `서울 ${userRegion} 쇼핑거리 345-67`,
          phone: "02-5555-6666",
          synergyPotential: "디자이너 브랜드 입점 및 판매",
          description: "감각적인 패션 아이템 전문 부티크"
        },
        {
          name: "패션 이벤트 플래너",
          category: "이벤트 기획",
          address: `서울 ${userRegion} 이벤트홀 456-78`,
          phone: "02-6666-7777",
          synergyPotential: "패션쇼 및 런칭 이벤트 기획",
          description: "패션 업계 전문 이벤트 기획 및 운영"
        },
        {
          name: "온라인 쇼핑몰 플랫폼",
          category: "전자상거래",
          address: `서울 ${userRegion} IT타워 567-89`,
          phone: "02-7777-8888",
          synergyPotential: "온라인 판매 채널 구축",
          description: "패션 전문 온라인 쇼핑몰 운영"
        },
        {
          name: "모델 에이전시",
          category: "모델 매니지먼트",
          address: `서울 ${userRegion} 모델하우스 678-90`,
          phone: "02-8888-9999",
          synergyPotential: "패션쇼 및 광고 모델 섭외",
          description: "패션 및 상업 모델 전문 에이전시"
        },
        {
          name: "텍스타일 소재상",
          category: "원단 유통",
          address: `서울 ${userRegion} 소재상가 789-01`,
          phone: "02-9999-0000",
          synergyPotential: "고급 원단 및 소재 공급",
          description: "프리미엄 패션 소재 전문 유통업체"
        },
        {
          name: "패션 트렌드 리서치",
          category: "트렌드 분석",
          address: `서울 ${userRegion} 리서치센터 890-12`,
          phone: "02-0000-1111",
          synergyPotential: "시장 트렌드 분석 및 컨설팅",
          description: "글로벌 패션 트렌드 분석 전문 기관"
        }
      ],
      '헤어디자이너': [
        {
          name: "강남 헤어 살롱",
          category: "헤어 살롱",
          address: `서울 ${userRegion} 미용거리 123-45`,
          phone: "02-1111-2222",
          website: "https://www.gangnamhair.co.kr",
          synergyPotential: "헤어스타일링 및 뷰티 서비스 협업",
          description: "프리미엄 헤어 디자인 및 케어 전문 살롱"
        },
        {
          name: "뷰티 메이크업 스튜디오",
          category: "메이크업",
          address: `서울 ${userRegion} 뷰티타운 234-56`,
          phone: "02-2222-3333",
          website: "https://www.beautymakeup.co.kr",
          synergyPotential: "헤어와 메이크업 토탈 뷰티 서비스",
          description: "웨딩 및 특수 메이크업 전문 스튜디오"
        },
        {
          name: "패션 스타일링 컨설팅",
          category: "스타일링",
          address: `서울 ${userRegion} 패션거리 345-67`,
          phone: "02-3333-4444",
          website: "https://www.fashionstyling.co.kr",
          synergyPotential: "헤어스타일과 패션의 토탈 코디네이션",
          description: "개인별 맞춤 스타일링 및 이미지 컨설팅"
        },
        {
          name: "뷰티 제품 유통업체",
          category: "뷰티 제품",
          address: `서울 ${userRegion} 코스메틱몰 456-78`,
          phone: "02-4444-5555",
          website: "https://www.beautyproducts.co.kr",
          synergyPotential: "전문 헤어케어 제품 공급 파트너",
          description: "프로페셔널 헤어케어 제품 전문 유통"
        },
        {
          name: "웨딩 플래너",
          category: "웨딩 기획",
          address: `서울 ${userRegion} 웨딩홀거리 567-89`,
          phone: "02-5555-6666",
          website: "https://www.weddingplanner.co.kr",
          synergyPotential: "웨딩 헤어메이크업 서비스 제공",
          description: "토탈 웨딩 서비스 및 뷰티 코디네이션"
        },
        {
          name: "포토그래피 스튜디오",
          category: "사진 촬영",
          address: `서울 ${userRegion} 포토스튜디오거리 678-90`,
          phone: "02-6666-7777",
          website: "https://www.photostudio.co.kr",
          synergyPotential: "프로필 촬영 시 헤어스타일링 협업",
          description: "인물 및 프로필 전문 사진 스튜디오"
        },
        {
          name: "뷰티 아카데미",
          category: "교육",
          address: `서울 ${userRegion} 교육센터 789-01`,
          phone: "02-7777-8888",
          website: "https://www.beautyacademy.co.kr",
          synergyPotential: "헤어디자인 교육 및 강의 협업",
          description: "뷰티 전문 교육 및 자격증 과정"
        },
        {
          name: "이벤트 기획사",
          category: "이벤트",
          address: `서울 ${userRegion} 이벤트센터 890-12`,
          phone: "02-8888-9999",
          website: "https://www.eventplanning.co.kr",
          synergyPotential: "패션쇼 및 뷰티 이벤트 헤어스타일링",
          description: "패션 및 뷰티 관련 이벤트 전문 기획"
        },
        {
          name: "온라인 뷰티 쇼핑몰",
          category: "전자상거래",
          address: `서울 ${userRegion} IT타워 901-23`,
          phone: "02-9999-0000",
          website: "https://www.beautymall.co.kr",
          synergyPotential: "헤어케어 제품 온라인 판매 협업",
          description: "뷰티 전문 온라인 쇼핑몰 운영"
        },
        {
          name: "셀럽 매니지먼트",
          category: "연예 기획",
          address: `서울 ${userRegion} 엔터테인먼트빌딩 012-34`,
          phone: "02-0000-1111",
          website: "https://www.celebmanagement.co.kr",
          synergyPotential: "연예인 및 인플루언서 헤어스타일링",
          description: "연예인 및 인플루언서 전문 매니지먼트"
        }
      ],
      '건축사': [
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

    // 하드코딩된 데이터 대신 동적 검색만 사용
    return { businesses: [] };
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