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
    console.log(`🔍 네이버 플레이스 업체 검색 시작 - 지역: ${userRegion}, 협업분야: ${synergyFields.length}개`);

    const businesses: NaverPlaceBusiness[] = [];

    // 각 협업 분야별로 검색
    for (const field of synergyFields.slice(0, 5)) { // 최대 5개 분야
      try {
        const searchResults = await this.searchBusinessByCategory(field, userRegion);
        if (searchResults.length > 0) {
          // 각 분야에서 최고 평점 업체 1개 선택
          const bestBusiness = searchResults[0];
          bestBusiness.synergyPotential = this.generateSynergyDescription(userSpecialty, field, bestBusiness.name);
          businesses.push(bestBusiness);
        }
      } catch (error) {
        console.error(`❌ ${field} 검색 실패:`, error);
      }
    }

    console.log(`✅ 네이버 플레이스 검색 완료: ${businesses.length}개 업체 발견`);
    return businesses;
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
        sort: 'random'
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
      for (const place of data.places.slice(0, 3)) {
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
      for (const item of data.items.slice(0, 3)) {
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
   * 협업 시너지 설명 생성
   */
  private generateSynergyDescription(userSpecialty: string, synergyField: string, businessName: string): string {
    const synergyTemplates: { [key: string]: string } = {
      '카페': `${businessName}와 협업하여 딸기를 활용한 시즌 메뉴 개발, 딸기 디저트 및 음료 공급, 농장 체험 고객 유치`,
      '레스토랑': `${businessName}에 신선한 딸기 공급, 딸기 요리 메뉴 개발 협업, 농장투어와 연계한 팜투테이블 프로그램`,
      '마케팅': `${businessName}와 딸기농장 브랜딩 및 온라인 마케팅 협업, SNS 컨텐츠 제작, 판로 확대 전략 수립`,
      '유통': `${businessName}를 통한 딸기 유통 채널 확보, 물류 최적화, 전국 배송 네트워크 활용`,
      '관광': `${businessName}와 딸기농장 체험 프로그램 연계, 농촌관광 패키지 개발, 가족 단위 고객 유치`,
      '교육': `${businessName}에서 농업 체험 교육 프로그램 제공, 어린이 농장 견학, 식농 교육 협업`,
      '물류': `${businessName}와 딸기 신선도 유지 배송 협업, 콜드체인 시스템 구축, 배송 최적화`,
      '포장': `${businessName}와 딸기 포장재 개발, 브랜딩 포장 디자인, 친환경 포장재 협업`,
      '가공': `${businessName}와 딸기 가공식품 개발, 잼/주스 등 제품화, 부가가치 창출`
    };

    // 키워드 매칭으로 적절한 템플릿 찾기
    for (const [key, template] of Object.entries(synergyTemplates)) {
      if (synergyField.includes(key) || key.includes(synergyField.split(' ')[0])) {
        return template;
      }
    }

    // 기본 템플릿
    return `${businessName}와 ${userSpecialty} 분야의 상호 협력을 통한 비즈니스 시너지 창출 및 고객 네트워크 확장`;
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