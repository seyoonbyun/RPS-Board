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
   * AI 분석으로부터 협업 분야를 추출하고 네이버 플레이스에서 실제 업체를 검색
   */
  async searchSynergyBusinesses(
    userSpecialty: string,
    userRegion: string,
    synergyFields: string[]
  ): Promise<NaverPlaceBusiness[]> {
    console.log(`🔍 네이버 플레이스 업체 검색 시작 - 지역: ${userRegion}, 전문분야: ${userSpecialty}, 협업분야: ${synergyFields.length}개`);

    const businesses: NaverPlaceBusiness[] = [];

    // 동적 검색어 생성
    const detailedSearchTerms = this.generateDynamicSearchTerms(userSpecialty, userRegion, synergyFields);
    
    console.log(`🎯 검색할 동적 업체 유형: ${detailedSearchTerms.length}개`);

    // 4개 협업 분야별로 균형있게 검색 (분야당 2-3개씩 총 10개)
    const categorizedResults: { [key: string]: NaverPlaceBusiness[] } = {};
    
    for (const searchTerm of detailedSearchTerms) {
      try {
        const searchResults = await this.searchBusinessByCategory(searchTerm.keyword, userRegion);
        if (searchResults.length > 0) {
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
   * 동적 검색 키워드 생성 - 협업 분야를 기반으로 검색어 생성
   */
  private generateDynamicSearchTerms(userSpecialty: string, userRegion: string, synergyFields: string[]): Array<{keyword: string, category: string}> {
    console.log(`🔄 동적 검색어 생성 - 전문분야: "${userSpecialty}", 협업분야: [${synergyFields.join(', ')}]`);
    
    const searchTerms: Array<{keyword: string, category: string}> = [];
    
    // 협업 분야를 기반으로 검색어 생성
    for (const field of synergyFields) {
      const cleanField = field.replace('업체', '').replace('회사', '').trim();
      searchTerms.push({
        keyword: `${userRegion} ${cleanField}`,
        category: field
      });
    }
    
    // 전문분야와 직접 관련된 검색어도 추가
    searchTerms.push({
      keyword: `${userRegion} ${userSpecialty}`,
      category: `${userSpecialty} 관련`
    });
    
    console.log(`✅ ${searchTerms.length}개 동적 검색어 생성 완료`);
    return searchTerms;
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