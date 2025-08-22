import axios from 'axios';

export interface NaverPlaceBusiness {
  name: string;
  category: string;
  address: string;
  phone: string;
  website: string;
  synergyPotential: string;
  description: string;
  rating?: number;
  reviews?: number;
  businessHours?: string;
}

export class NaverPlaceService {
  private searchApiKey: string | undefined;
  private naverClientId: string | undefined;
  private naverClientSecret: string | undefined;

  constructor() {
    // 다양한 API 키 옵션을 지원
    this.searchApiKey = process.env.SEARCH_API_KEY;
    this.naverClientId = process.env.NAVER_CLIENT_ID;
    this.naverClientSecret = process.env.NAVER_CLIENT_SECRET;
  }

  /**
   * AI 분석으로부터 협업 분야를 추출하고 네이버 플레이스에서 실제 업체를 검색 (강화된 검색)
   */
  async searchSynergyBusinesses(
    userSpecialty: string,
    userRegion: string,
    synergyFields: string[]
  ): Promise<NaverPlaceBusiness[]> {
    console.log(`🔍 네이버 플레이스 업체 검색 시작 (강화된 검색) - 지역: ${userRegion}, 전문분야: ${userSpecialty}, 협업분야: ${synergyFields.length}개`);

    const businesses: NaverPlaceBusiness[] = [];

    // 동적 검색어 생성 (개선된 로직)
    const detailedSearchTerms = this.generateEnhancedSearchTerms(userSpecialty, userRegion, synergyFields);
    
    console.log(`🎯 검색할 동적 업체 유형: ${detailedSearchTerms.length}개`);
    detailedSearchTerms.forEach((term, index) => {
      console.log(`  ${index + 1}. [${term.category}] "${term.keyword}" - 우선순위: ${term.priority}`);
    });

    // 우선순위별로 정렬하여 검색
    const sortedTerms = detailedSearchTerms.sort((a, b) => b.priority - a.priority);
    const categorizedResults: { [key: string]: NaverPlaceBusiness[] } = {};
    
    for (const searchTerm of sortedTerms) {
      try {
        console.log(`🔍 "${searchTerm.keyword}" 검색 중... (카테고리: ${searchTerm.category})`);
        const searchResults = await this.searchBusinessByCategory(searchTerm.keyword, userRegion);
        
        if (searchResults.length > 0) {
          console.log(`✅ "${searchTerm.keyword}"에서 ${searchResults.length}개 업체 발견`);
          
          // 카테고리별로 결과 그룹핑
          if (!categorizedResults[searchTerm.category]) {
            categorizedResults[searchTerm.category] = [];
          }
          
          // 각 검색에서 최고 평점 업체 1개씩 선택
          const topBusiness = searchResults[0];
          topBusiness.synergyPotential = `${userSpecialty}와 ${searchTerm.category} 분야의 ${topBusiness.name} 간 협업으로 상호 고객 확장 및 사업 시너지 창출 기대`;
          topBusiness.category = `${searchTerm.category} > ${topBusiness.category}`;
          categorizedResults[searchTerm.category].push(topBusiness);
        }
      } catch (error) {
        console.error(`❌ ${searchTerm.keyword} 검색 실패:`, error);
      }
    }

    // 각 분야별로 최대 3개씩 선택하여 총 10개 구성
    const maxPerCategory = Math.ceil(10 / Object.keys(categorizedResults).length);
    for (const [category, categoryBusinesses] of Object.entries(categorizedResults)) {
      const selectedFromCategory = categoryBusinesses.slice(0, maxPerCategory);
      businesses.push(...selectedFromCategory);
      
      if (businesses.length >= 10) {
        businesses.splice(10); // 정확히 10개로 제한
        break;
      }
    }

    console.log(`✅ 네이버 플레이스 검색 완료: ${businesses.length}개 업체 발견`);
    
    // 실시간 API 검색 결과가 없는 경우 빈 배열 반환 (가짜 데이터 제공 금지)
    if (businesses.length === 0) {
      console.log(`⚠️ ${userSpecialty} 분야의 ${userRegion} 지역 검색 결과 없음 - 실제 API 검색만 수행`);
    }
    
    return businesses;
  }

  /**
   * 전문분야와 협업 분야를 기반으로 동적 검색어 생성 (강화된 알고리즘)
   */
  private generateEnhancedSearchTerms(
    userSpecialty: string, 
    userRegion: string, 
    synergyFields: string[]
  ): Array<{ keyword: string; category: string; priority: number }> {
    console.log(`🎯 검색어 생성 시작 - 전문분야: "${userSpecialty}", 협업분야: [${synergyFields.join(', ')}]`);
    
    const searchTerms: Array<{ keyword: string; category: string; priority: number }> = [];

    // 동적 검색어 생성: AI 분석에서 추출된 협업 분야를 직접 활용
    for (const field of synergyFields) {
      console.log(`  🔍 협업분야 "${field}" 동적 키워드 생성 중...`);
      
      // 협업 분야 텍스트에서 핵심 키워드 추출
      const coreKeywords = this.extractDynamicKeywords(field, userSpecialty);
      
      // 각 키워드를 검색어로 추가
      coreKeywords.forEach((keyword, index) => {
        const priority = Math.max(10 - index, 5); // 첫 번째 키워드가 가장 높은 우선순위
        
        searchTerms.push({
          keyword,
          category: field, // 협업 분야 자체를 카테고리로 사용
          priority
        });
      });
      
      console.log(`    ✅ "${field}" → 키워드: [${coreKeywords.join(', ')}]`);
    }

    // 중복 제거 및 우선순위 정렬
    const uniqueTerms = this.removeDuplicateTerms(searchTerms);
    console.log(`🎯 최종 생성된 검색어: ${uniqueTerms.length}개`);
    
    return uniqueTerms.slice(0, 15); // 최대 15개 검색어
  }

  /**
   * 협업 분야에서 완전 동적으로 검색 키워드 추출 (하드코딩 없음)
   */
  private extractDynamicKeywords(field: string, userSpecialty: string): string[] {
    const keywords: string[] = [];
    
    // 1. 협업 분야 텍스트 자체를 최우선 키워드로 사용
    const cleanField = field.replace(/업체$|회사$|전문$|서비스$|대행사$/, '').trim();
    if (cleanField) {
      keywords.push(cleanField);
    }
    
    // 2. 텍스트에서 한글/영문 키워드 추출 (2글자 이상)
    const extractedWords = field.match(/[가-힣a-zA-Z]{2,}/g) || [];
    keywords.push(...extractedWords);
    
    // 3. 공백이나 특수문자로 분리된 단어들 추출
    const wordSeparators = field.split(/[\s,&\(\)\/\-]+/);
    for (const word of wordSeparators) {
      const cleanWord = word.replace(/[^가-힣a-zA-Z]/g, '').trim();
      if (cleanWord.length >= 2) {
        keywords.push(cleanWord);
      }
    }
    
    // 4. 일반적인 업체 접미사 변형 (동적 생성)
    const coreWord = cleanField.replace(/[^가-힣a-zA-Z]/g, '');
    if (coreWord.length > 1) {
      const suffixes = ['업체', '전문', '서비스'];
      for (const suffix of suffixes) {
        if (!coreWord.includes(suffix)) {
          keywords.push(`${coreWord}${suffix}`);
        }
      }
    }
    
    // 중복 제거 및 정리 (원본 텍스트 우선)
    const uniqueSet = new Set([field, ...keywords]);
    const uniqueKeywords = Array.from(uniqueSet)
      .filter(k => k && k.length > 1)
      .slice(0, 5); // 최대 5개
    
    console.log(`    🔑 "${field}" 동적 키워드 생성: [${uniqueKeywords.join(', ')}]`);
    return uniqueKeywords;
  }

  /**
   * 중복 검색어 제거
   */
  private removeDuplicateTerms(
    terms: Array<{ keyword: string; category: string; priority: number }>
  ): Array<{ keyword: string; category: string; priority: number }> {
    const seen = new Set<string>();
    const uniqueTerms: Array<{ keyword: string; category: string; priority: number }> = [];
    
    for (const term of terms) {
      if (!seen.has(term.keyword)) {
        seen.add(term.keyword);
        uniqueTerms.push(term);
      }
    }
    
    return uniqueTerms.sort((a, b) => b.priority - a.priority);
  }



  /**
   * 특정 카테고리의 업체를 지역별로 검색
   */
  private async searchBusinessByCategory(category: string, region: string): Promise<NaverPlaceBusiness[]> {
    const searchQuery = `${region} ${category}`;
    
    // SearchAPI.io를 우선 시도
    if (this.searchApiKey) {
      try {
        return await this.searchWithSearchAPI(searchQuery);
      } catch (error) {
        console.log(`SearchAPI 실패, 네이버 API 시도: ${error}`);
      }
    }

    // 네이버 공식 API 시도
    if (this.naverClientId && this.naverClientSecret) {
      try {
        return await this.searchWithNaverAPI(searchQuery);
      } catch (error) {
        console.log(`네이버 API 실패: ${error}`);
      }
    }

    // 모든 API 실패 시 빈 배열 반환
    console.log(`⚠️ ${category} 검색 실패 - API 키가 설정되지 않았거나 모든 API 호출 실패`);
    return [];
  }

  /**
   * SearchAPI.io를 통한 네이버 플레이스 검색
   */
  private async searchWithSearchAPI(query: string): Promise<NaverPlaceBusiness[]> {
    const response = await axios.get('https://www.searchapi.io/api/v1/search', {
      params: {
        engine: 'naver',
        q: query,
        location: 'South Korea',
        type: 'places'
      },
      headers: {
        'Authorization': `Bearer ${this.searchApiKey}`
      },
      timeout: 10000
    });

    return this.parseSearchAPIResponse(response.data);
  }

  /**
   * 네이버 공식 API를 통한 검색
   */
  private async searchWithNaverAPI(query: string): Promise<NaverPlaceBusiness[]> {
    const response = await axios.get('https://openapi.naver.com/v1/search/local.json', {
      params: {
        query: query,
        display: 5,
        start: 1,
        sort: 'comment' // 리뷰 많은 순으로 정렬하여 신뢰도 높은 업체 우선
      },
      headers: {
        'X-Naver-Client-Id': this.naverClientId,
        'X-Naver-Client-Secret': this.naverClientSecret
      },
      timeout: 10000
    });

    return this.parseNaverAPIResponse(response.data);
  }

  /**
   * SearchAPI.io 응답 파싱
   */
  private parseSearchAPIResponse(data: any): NaverPlaceBusiness[] {
    const businesses: NaverPlaceBusiness[] = [];

    if (data.places && Array.isArray(data.places)) {
      for (const place of data.places.slice(0, 3)) { // 각 검색당 최대 3개
        businesses.push({
          name: place.name || '업체명 정보 없음',
          category: place.type || place.category || '업종 정보 없음',
          address: place.address || '주소 정보 없음',
          phone: place.phone || '연락처 정보 없음',
          website: place.website || place.link || '',
          rating: place.rating || 0,
          reviews: place.reviews || 0,
          businessHours: place.hours || '',
          synergyPotential: '', // 나중에 설정
          description: `${place.type || '전문업체'}로 ${place.name}에서 서비스 제공`
        });
      }
    }

    return businesses;
  }

  /**
   * 네이버 공식 API 응답 파싱
   */
  private parseNaverAPIResponse(data: any): NaverPlaceBusiness[] {
    const businesses: NaverPlaceBusiness[] = [];

    if (data.items && Array.isArray(data.items)) {
      for (const item of data.items.slice(0, 3)) { // 각 검색당 최대 3개
        // HTML 태그 제거
        const cleanName = item.title?.replace(/<[^>]*>/g, '') || '업체명 정보 없음';
        const cleanCategory = item.category?.replace(/<[^>]*>/g, '') || '업종 정보 없음';
        const cleanAddress = item.address?.replace(/<[^>]*>/g, '') || '주소 정보 없음';

        businesses.push({
          name: cleanName,
          category: cleanCategory,
          address: cleanAddress,
          phone: item.telephone || '연락처 정보 없음',
          website: item.link || '',
          synergyPotential: '', // 나중에 설정
          description: `${cleanCategory} 전문업체로 ${cleanName}에서 서비스 제공`
        });
      }
    }

    return businesses;
  }



  /**
   * API 키 설정 상태 확인
   */
  getAPIStatus(): { searchAPI: boolean; naverAPI: boolean } {
    return {
      searchAPI: !!this.searchApiKey,
      naverAPI: !!(this.naverClientId && this.naverClientSecret)
    };
  }
}