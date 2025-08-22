import { NaverPlaceBusiness } from './naver-place-service';

/**
 * 완전히 하드코딩 없는 순수 동적 검색 시스템
 * AI 분석 결과만을 사용하여 협업 업체를 검색
 */
export class PureDynamicSearch {
  private clientId: string;
  private clientSecret: string;

  constructor() {
    this.clientId = process.env.NAVER_CLIENT_ID || '';
    this.clientSecret = process.env.NAVER_CLIENT_SECRET || '';
    
    if (!this.clientId || !this.clientSecret) {
      throw new Error('Naver API credentials are required');
    }
  }

  /**
   * AI 분석에서 추출된 협업 분야를 직접 사용하여 업체 검색
   * 하드코딩된 매핑 없이 완전 동적 검색
   */
  async searchCollaborationBusinesses(
    aiAnalysisText: string,
    userSpecialty: string,
    userRegion: string
  ): Promise<NaverPlaceBusiness[]> {
    console.log(`🎯 순수 동적 검색 시작:`);
    console.log(`  전문분야: "${userSpecialty}"`);
    console.log(`  지역: "${userRegion}"`);
    console.log(`  AI 분석 텍스트 길이: ${aiAnalysisText.length}자`);

    // 1. AI 분석에서 협업 분야 직접 추출
    const collaborationFields = this.extractCollaborationFieldsDirectly(aiAnalysisText);
    console.log(`📋 추출된 협업 분야: [${collaborationFields.join(', ')}]`);

    if (collaborationFields.length === 0) {
      console.log('❌ 협업 분야를 찾을 수 없습니다.');
      return [];
    }

    const allBusinesses: NaverPlaceBusiness[] = [];
    const maxPerField = Math.ceil(10 / collaborationFields.length);

    // 2. 각 협업 분야를 검색어로 직접 사용
    for (const field of collaborationFields) {
      console.log(`🔍 "${field}" 검색 중...`);
      
      try {
        const searchKeyword = this.prepareSearchKeyword(field);
        console.log(`  검색어: "${searchKeyword}"`);
        
        const businesses = await this.searchNaver(searchKeyword, userRegion);
        console.log(`  결과: ${businesses.length}개`);
        
        allBusinesses.push(...businesses.slice(0, maxPerField));
        
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
   * AI 분석 텍스트에서 협업 분야를 직접 추출
   * 하드코딩된 패턴 없이 텍스트 분석만으로 추출
   */
  private extractCollaborationFieldsDirectly(analysisText: string): string[] {
    const fields: string[] = [];
    
    // 협업과 관련된 키워드가 포함된 문장들을 찾아서 분석
    const lines = analysisText.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // 협업, 시너지, 파트너 등의 키워드가 포함된 라인에서 업체/분야명 추출
      if (this.isCollaborationLine(trimmedLine)) {
        const extractedFields = this.extractFieldsFromLine(trimmedLine);
        fields.push(...extractedFields);
      }
    }
    
    // 중복 제거 및 정리
    const uniqueSet = new Set(fields);
    const uniqueFields = Array.from(uniqueSet)
      .filter(field => field.length > 1)
      .slice(0, 5); // 최대 5개 분야
    
    console.log(`🔍 AI 텍스트에서 추출한 협업 분야: [${uniqueFields.join(', ')}]`);
    return uniqueFields;
  }

  /**
   * 협업 관련 라인인지 판단
   */
  private isCollaborationLine(line: string): boolean {
    const collaborationKeywords = [
      '협업', '시너지', '파트너', '연계', '제휴',
      '함께', '공동', '매칭', '네트워킹', '상호',
      '분야', '업체', '전문', '서비스'
    ];
    
    return collaborationKeywords.some(keyword => line.includes(keyword));
  }

  /**
   * 라인에서 구체적인 분야/업체명 추출
   */
  private extractFieldsFromLine(line: string): string[] {
    const fields: string[] = [];
    
    // 한글로 된 2-6글자 단어들을 추출 (업체명이나 분야명일 가능성이 높음)
    const koreanWords = line.match(/[가-힣]{2,6}/g) || [];
    
    for (const word of koreanWords) {
      // 일반적인 접속사나 부사는 제외
      if (!this.isCommonWord(word)) {
        fields.push(word);
      }
    }
    
    return fields;
  }

  /**
   * 일반적인 단어인지 확인 (업체명/분야명이 아닐 가능성이 높은 단어들)
   */
  private isCommonWord(word: string): boolean {
    const commonWords = [
      '그리고', '하지만', '또한', '따라서', '그러나', '그래서',
      '이러한', '그러한', '다양한', '여러', '많은', '적은',
      '높은', '낮은', '좋은', '나쁜', '새로운', '기존',
      '경우', '때문', '위해', '통해', '대한', '관한',
      '필요', '중요', '가능', '어려운', '쉬운'
    ];
    
    return commonWords.includes(word);
  }

  /**
   * 검색어 정제 (네이버 검색에 적합하게)
   */
  private prepareSearchKeyword(field: string): string {
    // 특수문자 제거 및 공백 정리
    return field.replace(/[^\w\s가-힣]/g, ' ').trim();
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