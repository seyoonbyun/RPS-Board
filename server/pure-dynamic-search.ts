import { NaverPlaceBusiness } from './naver-place-service';

export class PureDynamicSearch {
  private clientId: string;
  private clientSecret: string;

  constructor() {
    this.clientId = process.env.NAVER_CLIENT_ID || '';
    this.clientSecret = process.env.NAVER_CLIENT_SECRET || '';
  }

  /**
   * 순수 동적 검색: AI 분석 결과의 시너지 섹션에서 키워드를 직접 추출하여 검색
   */
  async searchPureDynamic(
    userSpecialty: string,
    userRegion: string,
    aiAnalysisText: string
  ): Promise<(NaverPlaceBusiness & { synergyInfo?: { collaborationField: string; synergyDescription: string } })[]> {
    console.log('🎯 순수 동적 검색 시작:');
    console.log(`  전문분야: "${userSpecialty}"`);
    console.log(`  지역: "${userRegion}"`);
    console.log(`  AI 분석 텍스트 길이: ${aiAnalysisText.length}자`);

    // 1. AI 분석의 시너지 섹션에서 협업 분야 직접 추출
    const collaborationFields = this.extractFromSynergySection(aiAnalysisText);
    console.log(`📋 추출된 협업 분야: [${collaborationFields.join(', ')}]`);

    if (collaborationFields.length === 0) {
      console.log('❌ 협업 분야를 찾을 수 없습니다.');
      return [];
    }

    const allBusinesses = [];
    const maxPerField = 2;

    // 2. 각 협업 분야를 검색어로 직접 사용
    for (const field of collaborationFields) {
      console.log(`🔍 "${field}" 검색 중...`);
      
      try {
        const businesses = await this.searchNaver(field, userRegion);
        console.log(`  결과: ${businesses.length}개`);
        
        // 각 업체에 시너지 정보 추가
        const businessesWithSynergy = businesses.slice(0, maxPerField).map(business => ({
          ...business,
          synergyInfo: {
            collaborationField: field,
            synergyDescription: `${userSpecialty}와 ${field} 분야의 전문적 협업을 통한 시너지 창출 기대`
          }
        }));
        
        allBusinesses.push(...businessesWithSynergy);
        
        // API 호출 간격
        await new Promise(resolve => setTimeout(resolve, 300));
        
      } catch (error) {
        console.error(`❌ "${field}" 검색 실패:`, error);
      }
    }

    console.log(`🎯 검색 완료 - 총 ${allBusinesses.length}개 업체`);
    return allBusinesses.slice(0, 10);
  }

  /**
   * AI 분석에서 시너지 섹션의 키워드를 간단하게 추출
   */
  private extractFromSynergySection(analysisText: string): string[] {
    console.log('🔍 시너지 섹션에서 협업 분야 추출 시작');
    
    // "## 🤝 시너지 창출 가능 비즈니스 분야 및 협업 전략" 섹션 찾기
    const synergyMatch = analysisText.match(/## 🤝 시너지 창출 가능 비즈니스 분야.*?([\s\S]*?)(?=##|$)/);
    
    if (!synergyMatch || !synergyMatch[1]) {
      console.log('⚠️ 시너지 섹션을 찾을 수 없음');
      return [];
    }
    
    const synergySection = synergyMatch[1].trim();
    console.log(`📋 시너지 섹션 발견 (길이: ${synergySection.length}자)`);
    
    // 간단한 방식: 숫자나 대시로 시작하는 라인에서 콜론 앞의 텍스트 추출
    const keywords = [];
    const lines = synergySection.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      // "1. 제과점:" 또는 "- 카페:" 형태 찾기
      const match = trimmed.match(/^(?:\d+\.|\-|\*)\s*([^:]+):/);
      if (match && match[1]) {
        const keyword = match[1].trim();
        // 기본 필터링: 너무 일반적이지 않은 키워드만
        if (keyword.length >= 2 && keyword !== '협업' && keyword !== '시너지') {
          keywords.push(keyword);
        }
      }
    }
    
    console.log(`✅ 추출된 협업 분야: [${keywords.join(', ')}]`);
    return keywords.slice(0, 5); // 최대 5개
  }

  /**
   * 네이버 플레이스 API 검색
   */
  private async searchNaver(keyword: string, region: string): Promise<NaverPlaceBusiness[]> {
    const query = `${region} ${keyword}`;
    const url = 'https://openapi.naver.com/v1/search/local.json';
    
    const response = await fetch(`${url}?query=${encodeURIComponent(query)}&display=10`, {
      headers: {
        'X-Naver-Client-Id': this.clientId,
        'X-Naver-Client-Secret': this.clientSecret,
      },
    });

    if (!response.ok) {
      throw new Error(`Naver API Error: ${response.status}`);
    }

    const data = await response.json();
    const items = data.items || [];

    return items.map((item: any) => ({
      name: this.cleanHtmlTags(item.title),
      category: this.cleanHtmlTags(item.category),
      address: this.cleanHtmlTags(item.address),
      roadAddress: this.cleanHtmlTags(item.roadAddress),
      phone: item.telephone || '',
      website: item.link || '',
      mapx: item.mapx,
      mapy: item.mapy,
    }));
  }

  /**
   * HTML 태그 제거
   */
  private cleanHtmlTags(text: string): string {
    return text.replace(/<[^>]*>/g, '');
  }
}