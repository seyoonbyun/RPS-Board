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

    // 전문분야별 맞춤 검색 키워드 매핑 (확장된 데이터베이스)
    const specialtyMappings: { [key: string]: { [key: string]: Array<{ keyword: string; priority: number }> } } = {
      '패션디자이너': {
        '사진작가': [
          { keyword: '사진작가', priority: 10 },
          { keyword: '포토스튜디오', priority: 9 },
          { keyword: '패션사진', priority: 8 },
          { keyword: '상업사진', priority: 7 }
        ],
        '영상제작': [
          { keyword: '영상제작', priority: 10 },
          { keyword: '영상편집', priority: 8 },
          { keyword: '비디오그래퍼', priority: 7 }
        ],
        '헤어메이크업': [
          { keyword: '미용실', priority: 10 },
          { keyword: '메이크업', priority: 9 },
          { keyword: '뷰티샵', priority: 8 },
          { keyword: '헤어샵', priority: 8 }
        ],
        '원단부자재': [
          { keyword: '원단', priority: 10 },
          { keyword: '섬유', priority: 8 },
          { keyword: '부자재', priority: 7 },
          { keyword: '의류자재', priority: 6 }
        ],
        '봉제패턴': [
          { keyword: '봉제공장', priority: 10 },
          { keyword: '의류제조', priority: 9 },
          { keyword: '패턴', priority: 7 }
        ],
        '마케팅': [
          { keyword: '마케팅', priority: 10 },
          { keyword: '광고대행사', priority: 8 },
          { keyword: '브랜딩', priority: 7 }
        ],
        '액세서리': [
          { keyword: '주얼리', priority: 10 },
          { keyword: '가방', priority: 9 },
          { keyword: '신발', priority: 8 },
          { keyword: '액세서리', priority: 7 }
        ],
        '법무': [
          { keyword: '변호사', priority: 10 },
          { keyword: '법무', priority: 8 },
          { keyword: '특허', priority: 6 }
        ]
      },
      '딸기농장운영': {
        '유통판매': [
          { keyword: '카페', priority: 10 },
          { keyword: '레스토랑', priority: 9 },
          { keyword: '베이커리', priority: 8 },
          { keyword: '디저트카페', priority: 7 }
        ],
        '농업기술': [
          { keyword: '농업기술', priority: 10 },
          { keyword: '스마트팜', priority: 9 },
          { keyword: '농자재', priority: 8 }
        ],
        '관광체험': [
          { keyword: '여행사', priority: 10 },
          { keyword: '관광농원', priority: 9 },
          { keyword: '체험농장', priority: 8 }
        ],
        '가공식품': [
          { keyword: '식품제조', priority: 10 },
          { keyword: '가공업체', priority: 8 },
          { keyword: '제과점', priority: 7 }
        ]
      }
    };

    // 현재 전문분야에 맞는 매핑 찾기
    const currentMapping = specialtyMappings[userSpecialty] || {};
    
    // 협업 분야별로 검색어 생성
    for (const field of synergyFields) {
      console.log(`  🔍 협업분야 "${field}" 분석 중...`);
      
      let bestCategory = '';
      let bestKeywords: Array<{ keyword: string; priority: number }> = [];
      let maxScore = 0;

      // 각 카테고리와 매칭 점수 계산
      for (const [category, keywords] of Object.entries(currentMapping)) {
        let score = 0;
        
        // 카테고리명과 협업 분야의 유사도 계산
        if (field.toLowerCase().includes(category.toLowerCase())) {
          score += 10;
        }
        
        // 키워드별 매칭 점수
        for (const keywordObj of keywords) {
          if (field.toLowerCase().includes(keywordObj.keyword.toLowerCase())) {
            score += keywordObj.priority;
          }
        }
        
        if (score > maxScore) {
          maxScore = score;
          bestCategory = category;
          bestKeywords = keywords;
        }
      }

      // 매칭된 키워드가 있으면 추가
      if (bestKeywords.length > 0) {
        console.log(`    ✅ "${field}" → 카테고리: "${bestCategory}" (점수: ${maxScore})`);
        
        for (const keywordObj of bestKeywords.slice(0, 3)) {
          searchTerms.push({
            keyword: keywordObj.keyword,
            category: bestCategory,
            priority: keywordObj.priority + (maxScore > 10 ? 5 : 0) // 높은 매칭 점수 보너스
          });
        }
      } else {
        // 기본 키워드 생성
        console.log(`    ⚠️ "${field}" → 기본 키워드 생성`);
        const basicKeywords = this.generateBasicKeywords(field);
        for (const keyword of basicKeywords) {
          searchTerms.push({
            keyword,
            category: '기본',
            priority: 5
          });
        }
      }
    }

    // 중복 제거 및 우선순위 정렬
    const uniqueTerms = this.removeDuplicateTerms(searchTerms);
    console.log(`🎯 최종 생성된 검색어: ${uniqueTerms.length}개`);
    
    return uniqueTerms.slice(0, 15); // 최대 15개 검색어
  }

  /**
   * 기본 키워드 생성
   */
  private generateBasicKeywords(field: string): string[] {
    const keywords = [field];
    
    // 일반적인 업체 접미사 추가
    const suffixes = ['업체', '전문', '서비스', '대행사'];
    for (const suffix of suffixes) {
      if (!field.includes(suffix)) {
        keywords.push(`${field}${suffix}`);
      }
    }
    
    return keywords.slice(0, 3);
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