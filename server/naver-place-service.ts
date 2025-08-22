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

    // 딸기농장운영을 위한 특화된 검색 키워드 매핑
    const detailedSearchTerms = this.getDetailedSearchTerms(userSpecialty, userRegion);
    
    console.log(`🎯 검색할 세부 업체 유형: ${detailedSearchTerms.length}개`);

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
          topBusiness.synergyPotential = this.generateSynergyDescription(
            userSpecialty, 
            searchTerm.category, 
            topBusiness.name
          );
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
    return businesses;
  }

  /**
   * 전문분야별 상세 검색 키워드 생성
   */
  private getDetailedSearchTerms(userSpecialty: string, userRegion: string): Array<{keyword: string, category: string}> {
    if (userSpecialty.includes('딸기농장운영')) {
      return [
        // 1. 식품 및 외식업계 협업 - 실제 딸기 활용 업체들
        { keyword: `${userRegion} 딸기케이크`, category: '식품 및 외식업계' },
        { keyword: `${userRegion} 딸기디저트`, category: '식품 및 외식업계' },
        { keyword: `${userRegion} 카페 베이커리`, category: '식품 및 외식업계' },
        { keyword: `${userRegion} 브런치카페`, category: '식품 및 외식업계' },
        { keyword: `${userRegion} 파티시에`, category: '식품 및 외식업계' },
        
        // 2. 유통 및 마케팅 분야 - 농산물 마케팅 전문업체
        { keyword: `${userRegion} 농산물 마케팅`, category: '유통 및 마케팅 분야' },
        { keyword: `${userRegion} 농산물 브랜딩`, category: '유통 및 마케팅 분야' },
        { keyword: `${userRegion} 온라인마케팅`, category: '유통 및 마케팅 분야' },
        { keyword: `${userRegion} SNS마케팅`, category: '유통 및 마케팅 분야' },
        
        // 3. 관광 및 체험 산업 - 실제 체험/축제 관련 업체
        { keyword: `${userRegion} 딸기축제`, category: '관광 및 체험 산업' },
        { keyword: `${userRegion} 농장체험`, category: '관광 및 체험 산업' },
        { keyword: `${userRegion} 기업워크숍`, category: '관광 및 체험 산업' },
        { keyword: `${userRegion} 농촌관광`, category: '관광 및 체험 산업' },
        { keyword: `${userRegion} 체험학습`, category: '관광 및 체험 산업' },
        { keyword: `${userRegion} 이벤트기획`, category: '관광 및 체험 산업' },
        
        // 4. 가공 및 제조업 - 딸기 관련 가공업체
        { keyword: `${userRegion} 딸기잼`, category: '가공 및 제조업' },
        { keyword: `${userRegion} 과일가공`, category: '가공 및 제조업' },
        { keyword: `${userRegion} 농산물포장`, category: '가공 및 제조업' },
        { keyword: `${userRegion} 냉장물류`, category: '가공 및 제조업' },
        { keyword: `${userRegion} 식품포장`, category: '가공 및 제조업' }
      ];
    }

    // 기타 전문분야 기본 검색어
    return [
      { keyword: `${userRegion} 마케팅`, category: '마케팅 분야' },
      { keyword: `${userRegion} 디자인`, category: '디자인 분야' },
      { keyword: `${userRegion} 컨설팅`, category: '컨설팅 분야' },
      { keyword: `${userRegion} IT`, category: 'IT 분야' },
      { keyword: `${userRegion} 제조업`, category: '제조업 분야' }
    ];
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
   * 협업 시너지 설명 생성 (확장된 버전)
   */
  private generateSynergyDescription(userSpecialty: string, synergyField: string, businessName: string): string {
    // 딸기농장운영을 위한 상세 시너지 템플릿
    const detailedSynergyTemplates: { [key: string]: string } = {
      '식품 및 외식업계': {
        '카페': `${businessName}와 협업하여 계절별 딸기 시그니처 메뉴 개발, 프리미엄 딸기 디저트 공급, 농장 직송 신선 딸기 활용 음료 개발`,
        '베이커리': `${businessName}에 고품질 딸기 정기 공급, 딸기 케이크/타르트 전문 제품 공동 개발, 농장 브랜드 스토리 활용 마케팅`,
        '디저트': `${businessName}와 프리미엄 딸기 디저트 라인 구축, 시즌별 한정 메뉴 기획, 딸기 품종별 특성을 살린 전문 디저트 개발`,
        '브런치': `${businessName}와 건강한 딸기 브런치 메뉴 개발, 농장 직송 유기농 딸기 공급, 팜투테이블 콘셉트 구현`
      },
      '유통 및 마케팅 분야': {
        '마케팅': `${businessName}와 딸기농장 브랜드 스토리텔링 협업, 소셜미디어 컨텐츠 제작, 디지털 마케팅을 통한 직판 채널 구축`,
        '광고': `${businessName}와 딸기농장 브랜딩 캠페인 기획, 계절 마케팅 전략 수립, 프리미엄 농산물 포지셔닝 구축`,
        '브랜딩': `${businessName}와 농장 아이덴티티 개발, 패키지 디자인 협업, 친환경 가치 브랜드 스토리 구축`,
        '온라인': `${businessName}를 통한 전자상거래 진출, 온라인 직판 플랫폼 구축, 구독형 딸기 배송 서비스 개발`
      },
      '관광 및 체험 산업': {
        '여행': `${businessName}와 딸기농장 체험 투어 패키지 개발, 농촌관광 프로그램 기획, 가족 단위 체험 상품 공동 마케팅`,
        '체험': `${businessName}와 교육형 농업 체험 프로그램 운영, 어린이 식농 교육 협업, 기업 워크숍 및 팀빌딩 프로그램`,
        '이벤트': `${businessName}와 딸기 축제 기획, 농장 웨딩 및 특별 행사 개최, 시즌별 이벤트 프로그램 운영`,
        '교육': `${businessName}에서 농업 교육 프로그램 제공, 지속가능한 농업 실습 교육, 도시농업 확산을 위한 교육 협력`
      },
      '가공 및 제조업': {
        '식품가공': `${businessName}와 딸기 가공품 개발, 잼/청/주스 등 부가가치 상품 공동 생산, OEM 생산 파트너십`,
        '포장': `${businessName}와 친환경 딸기 포장재 개발, 신선도 유지 포장 기술 협업, 브랜드 아이덴티티 반영 패키지 디자인`,
        '물류': `${businessName}와 콜드체인 시스템 구축, 딸기 신선도 유지 배송 협업, 전국 유통망 확대를 위한 물류 파트너십`,
        '냉동냉장': `${businessName}와 딸기 저장 및 보관 시설 협업, 연중 공급을 위한 냉동 가공 기술 개발, 품질 유지 시스템 구축`
      }
    };

    // 분야별 매칭
    for (const [fieldCategory, templates] of Object.entries(detailedSynergyTemplates)) {
      if (synergyField.includes(fieldCategory)) {
        for (const [keyword, template] of Object.entries(templates)) {
          if (businessName.toLowerCase().includes(keyword) || 
              keyword.includes(businessName.split(' ')[0])) {
            return template;
          }
        }
        // 분야는 맞지만 특정 키워드가 없는 경우 기본 템플릿
        return Object.values(templates)[0];
      }
    }

    // 키워드 기반 매칭 (기존 로직)
    const basicTemplates: { [key: string]: string } = {
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

    for (const [key, template] of Object.entries(basicTemplates)) {
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