import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Lightbulb, Users, BarChart3, Filter, TrendingUp, MapPin, Building2, ChevronDown, Brain, Sparkles, Target, Clock } from 'lucide-react';

interface BusinessSynergyRecommendation {
  memberName: string;
  email: string;
  industry: string;
  company: string;
  specialty: string;
  targetCustomer: string;
  region: string;
  chapter: string;
  synergyScore: number;
  synergyType: 'perfect-match' | 'high-potential' | 'growth-opportunity' | 'new-market';
  businessValue: string;
  collaborationOpportunities: string[];
  targetMarketAlignment: number;
  currentStage?: 'V' | 'C' | 'P' | 'none';
}

interface RecommendationFilters {
  region?: string;
  chapter?: string;
  minCompatibilityScore: number;
  excludeCurrentPartners: boolean;
  maxResults: number;
}

interface PartnerRecommendation {
  memberName: string;
  specialty: string;
  region: string;
  chapter: string;
  compatibilityScore: number;
  synergyType: 'perfect-match' | 'high-potential' | 'growth-opportunity' | 'new-market';
  reasons: string[];
}

interface PartnerRecommendationsProps {
  userId: string;
}

export function PartnerRecommendations({ userId }: PartnerRecommendationsProps) {
  const [filters, setFilters] = useState<RecommendationFilters>({
    minCompatibilityScore: 60,
    excludeCurrentPartners: true,
    maxResults: 8
  });

  const [showFilters, setShowFilters] = useState(false);
  const [regionDropdownOpen, setRegionDropdownOpen] = useState(false);
  const regionDropdownRef = useRef<HTMLDivElement>(null);

  // 드롭다운 바깥 영역 클릭 감지
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (regionDropdownRef.current && !regionDropdownRef.current.contains(event.target as Node)) {
        setRegionDropdownOpen(false);
      }
    };

    if (regionDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [regionDropdownOpen]);

  // 파트너 추천 데이터 조회
  const { 
    data: recommendations, 
    isLoading: isLoadingRecommendations, 
    error: recommendationError,
    refetch: refetchRecommendations 
  } = useQuery({
    queryKey: ['/api/partner-recommendations', userId, filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.region) params.append('region', filters.region);
      if (filters.chapter) params.append('chapter', filters.chapter);
      params.append('minScore', filters.minCompatibilityScore.toString());
      params.append('excludeCurrent', filters.excludeCurrentPartners.toString());
      params.append('maxResults', filters.maxResults.toString());

      const response = await fetch(`/api/partner-recommendations/${userId}?${params}`);
      if (!response.ok) {
        throw new Error('파트너 추천을 불러오는데 실패했습니다');
      }
      return response.json();
    },
    enabled: !!userId
  });

  // 업종 분석 데이터 조회
  const { 
    data: industryAnalytics, 
    isLoading: isLoadingAnalytics 
  } = useQuery({
    queryKey: ['/api/industry-analytics'],
    queryFn: async () => {
      const response = await fetch('/api/industry-analytics');
      if (!response.ok) {
        throw new Error('업종 분석을 불러오는데 실패했습니다');
      }
      return response.json();
    }
  });

  // AI 전문분야 분석 조회
  const { 
    data: aiAnalysis, 
    isLoading: isLoadingAI,
    error: aiError,
    refetch: refetchAI
  } = useQuery({
    queryKey: ['/api/ai-specialty-analysis', userId],
    queryFn: async () => {
      const response = await fetch(`/api/ai-specialty-analysis/${userId}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'AI 분석을 불러오는데 실패했습니다');
      }
      return response.json();
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000, // 5분간 캐시
  });

  const getSynergyColor = (synergyType: 'perfect-match' | 'high-potential' | 'growth-opportunity' | 'new-market') => {
    switch (synergyType) {
      case 'perfect-match': return 'bg-red-100 text-red-800 border-red-200';
      case 'high-potential': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'growth-opportunity': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'new-market': return 'bg-green-100 text-green-800 border-green-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getSynergyText = (synergyType: 'perfect-match' | 'high-potential' | 'growth-opportunity' | 'new-market') => {
    switch (synergyType) {
      case 'perfect-match': return '완벽 매치';
      case 'high-potential': return '높은 잠재력';
      case 'growth-opportunity': return '성장 기회';
      case 'new-market': return '신규 시장';
      default: return '기본';
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-red-600 font-bold';
    if (score >= 60) return 'text-orange-600 font-semibold';
    if (score >= 40) return 'text-blue-600 font-medium';
    return 'text-green-600';
  };

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center gap-2">
        <Lightbulb className="w-6 h-6 text-red-600" />
        <h2 className="text-2xl font-bold">비즈니스 시너지 파트너 추천</h2>
      </div>

      <Tabs defaultValue="recommendations" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="ai-analysis" className="flex items-center gap-2">
            <Brain className="w-4 h-4" />
            나의 전문분야 분석
          </TabsTrigger>
          <TabsTrigger value="recommendations" className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            AI 추천 시너지 분야
          </TabsTrigger>
          <TabsTrigger value="analytics" className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            AI 시너지 매칭 멤버
          </TabsTrigger>
        </TabsList>

        {/* AI 전문분야 분석 탭 */}
        <TabsContent value="ai-analysis" className="space-y-4">
          {isLoadingAI ? (
            <Card className="animate-pulse">
              <CardHeader>
                <div className="h-6 bg-gray-200 rounded w-1/3"></div>
                <div className="h-4 bg-gray-200 rounded w-1/2"></div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="h-4 bg-gray-200 rounded"></div>
                  <div className="h-4 bg-gray-200 rounded w-4/5"></div>
                  <div className="h-4 bg-gray-200 rounded w-3/5"></div>
                </div>
              </CardContent>
            </Card>
          ) : aiError ? (
            <Card className="border-red-200">
              <CardContent className="text-center py-8">
                <p className="text-red-600 mb-2">AI 분석 오류</p>
                <p className="text-sm text-gray-600 mb-4">{(aiError as Error).message}</p>
                <Button 
                  variant="outline" 
                  onClick={() => refetchAI()}
                  className="bg-red-600 hover:bg-red-700 text-white"
                >
                  다시 분석
                </Button>
              </CardContent>
            </Card>
          ) : aiAnalysis ? (
            <div className="space-y-6">
              {/* 현재 전문분야 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-yellow-500" />
                    현재 전문분야 분석
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <p className="font-semibold text-blue-900 text-lg">{aiAnalysis.userSpecialty}</p>
                  </div>
                </CardContent>
              </Card>

              {/* AI 분석 결과 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Brain className="w-5 h-5 text-purple-600" />
                    BNI AI 상세분석
                  </CardTitle>
                  <CardDescription>
                    대표님의 비즈니스 시너지와 확장 가능성에 대한 BNI AI의 분석입니다
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="prose prose-sm max-w-none">
                    <div className="whitespace-pre-wrap text-gray-700 leading-relaxed">
                      {aiAnalysis.analysis}
                    </div>
                  </div>
                </CardContent>
              </Card>



              {/* 우선순위별 전략 */}
              {aiAnalysis.priorities && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-green-700">
                        <Clock className="w-5 h-5" />
                        단기 확장
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {aiAnalysis.priorities.shortTerm?.map((item: string, index: number) => (
                          <div key={index} className="text-sm p-2 bg-green-50 rounded border-l-2 border-green-500">
                            {item}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-orange-700">
                        <Clock className="w-5 h-5" />
                        중기 성장
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {aiAnalysis.priorities.mediumTerm?.map((item: string, index: number) => (
                          <div key={index} className="text-sm p-2 bg-orange-50 rounded border-l-2 border-orange-500">
                            {item}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-purple-700">
                        <Clock className="w-5 h-5" />
                        장기 투자
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {aiAnalysis.priorities.longTerm?.map((item: string, index: number) => (
                          <div key={index} className="text-sm p-2 bg-purple-50 rounded border-l-2 border-purple-500">
                            {item}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}


            </div>
          ) : (
            <Card>
              <CardContent className="text-center py-8">
                <Brain className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">AI 분석 데이터가 없습니다</p>
                <Button 
                  variant="outline" 
                  onClick={() => refetchAI()}
                  className="mt-4 bg-red-600 hover:bg-red-700 text-white"
                >
                  분석 시작
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="recommendations" className="space-y-4">
          {/* AI 추천 시너지 분야 */}
          {aiAnalysis?.synergyFields?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="w-5 h-5 text-green-600" />
                  BNI AI가 분석한 현재 전문분야와 협력 가능한 비즈니스 영역들입니다
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {aiAnalysis.synergyFields.map((field: string, index: number) => (
                    <Badge key={index} variant="secondary" className="text-center p-2">
                      {field}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* 필터 패널 */}
          {showFilters && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Filter className="w-5 h-5" />
                  추천 필터
                </CardTitle>
                <CardDescription>
                  원하는 조건에 맞는 파트너를 찾아보세요
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>지역 필터</Label>
                  <div className="relative" ref={regionDropdownRef}>
                    <button
                      type="button"
                      onClick={() => setRegionDropdownOpen(!regionDropdownOpen)}
                      className="flex h-10 w-full items-center justify-between rounded-md border border-red-600 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2"
                    >
                      <span className={filters.region ? 'text-gray-900' : 'text-gray-400'}>
                        {filters.region || '모든 지역'}
                      </span>
                      <ChevronDown className="h-4 w-4 opacity-50" />
                    </button>
                    {regionDropdownOpen && (
                      <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg">
                        <div 
                          className="px-3 py-2 text-sm cursor-pointer hover:bg-red-600 hover:text-white transition-colors text-gray-900"
                          onClick={() => {
                            setFilters(prev => ({ ...prev, region: undefined }));
                            setRegionDropdownOpen(false);
                          }}
                        >
                          모든 지역
                        </div>
                        <div 
                          className="px-3 py-2 text-sm cursor-pointer hover:bg-red-600 hover:text-white transition-colors text-gray-900"
                          onClick={() => {
                            setFilters(prev => ({ ...prev, region: '서울' }));
                            setRegionDropdownOpen(false);
                          }}
                        >
                          서울
                        </div>
                        <div 
                          className="px-3 py-2 text-sm cursor-pointer hover:bg-red-600 hover:text-white transition-colors text-gray-900"
                          onClick={() => {
                            setFilters(prev => ({ ...prev, region: '경기' }));
                            setRegionDropdownOpen(false);
                          }}
                        >
                          경기
                        </div>
                        <div 
                          className="px-3 py-2 text-sm cursor-pointer hover:bg-red-600 hover:text-white transition-colors text-gray-900"
                          onClick={() => {
                            setFilters(prev => ({ ...prev, region: '인천' }));
                            setRegionDropdownOpen(false);
                          }}
                        >
                          인천
                        </div>
                        <div 
                          className="px-3 py-2 text-sm cursor-pointer hover:bg-red-600 hover:text-white transition-colors text-gray-900"
                          onClick={() => {
                            setFilters(prev => ({ ...prev, region: '부산' }));
                            setRegionDropdownOpen(false);
                          }}
                        >
                          부산
                        </div>
                        <div 
                          className="px-3 py-2 text-sm cursor-pointer hover:bg-red-600 hover:text-white transition-colors text-gray-900"
                          onClick={() => {
                            setFilters(prev => ({ ...prev, region: '대구' }));
                            setRegionDropdownOpen(false);
                          }}
                        >
                          대구
                        </div>
                        <div 
                          className="px-3 py-2 text-sm cursor-pointer hover:bg-red-600 hover:text-white transition-colors text-gray-900"
                          onClick={() => {
                            setFilters(prev => ({ ...prev, region: '광주' }));
                            setRegionDropdownOpen(false);
                          }}
                        >
                          광주
                        </div>
                        <div 
                          className="px-3 py-2 text-sm cursor-pointer hover:bg-red-600 hover:text-white transition-colors text-gray-900"
                          onClick={() => {
                            setFilters(prev => ({ ...prev, region: '대전' }));
                            setRegionDropdownOpen(false);
                          }}
                        >
                          대전
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label>최소 호환성 점수</Label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={filters.minCompatibilityScore}
                    onChange={(e) => setFilters(prev => ({ 
                      ...prev, 
                      minCompatibilityScore: parseInt(e.target.value) || 60 
                    }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label>최대 결과 수</Label>
                  <Input
                    type="number"
                    min="1"
                    max="20"
                    value={filters.maxResults}
                    onChange={(e) => setFilters(prev => ({ 
                      ...prev, 
                      maxResults: parseInt(e.target.value) || 8 
                    }))}
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <Switch
                    checked={filters.excludeCurrentPartners}
                    onCheckedChange={(checked) => setFilters(prev => ({ 
                      ...prev, 
                      excludeCurrentPartners: checked 
                    }))}
                    className="data-[state=checked]:bg-gray-200 data-[state=unchecked]:bg-gray-200 [&>span]:data-[state=checked]:bg-red-600 [&>span]:data-[state=unchecked]:bg-white [&>span]:data-[state=checked]:translate-x-5 [&>span]:transition-all [&>span]:duration-200"
                  />
                  <Label>현재 파트너 제외</Label>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 추천 결과 */}
          {isLoadingRecommendations ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[...Array(4)].map((_, i) => (
                <Card key={i} className="animate-pulse">
                  <CardHeader>
                    <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                    <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="h-3 bg-gray-200 rounded"></div>
                      <div className="h-3 bg-gray-200 rounded w-4/5"></div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : recommendationError ? (
            <Card className="border-red-200">
              <CardContent className="text-center py-8">
                <p className="text-red-600">파트너 추천을 불러오는데 실패했습니다</p>
                <Button 
                  variant="outline" 
                  onClick={() => refetchRecommendations()}
                  className="mt-4"
                >
                  다시 시도
                </Button>
              </CardContent>
            </Card>
          ) : recommendations?.recommendations?.length > 0 ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-600">
                  총 {recommendations.totalRecommendations}개의 추천 파트너
                </p>
                <Badge variant="outline" className="text-red-600 border-red-200">
                  {recommendations.userEmail}
                </Badge>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {recommendations.recommendations.map((rec: PartnerRecommendation, index: number) => (
                  <Card key={index} className="hover:shadow-lg transition-shadow">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-lg">{rec.memberName}</CardTitle>
                          <CardDescription className="font-medium text-blue-600">
                            {rec.specialty}
                          </CardDescription>
                        </div>
                        <div className="text-right">
                          <div className={`text-lg font-bold ${getScoreColor(rec.compatibilityScore)}`}>
                            {rec.compatibilityScore}점
                          </div>
                          <Badge className={getSynergyColor(rec.synergyType)}>
                            {getSynergyText(rec.synergyType)}
                          </Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center gap-4 text-sm text-gray-600">
                        <div className="flex items-center gap-1">
                          <MapPin className="w-4 h-4" />
                          {rec.region}
                        </div>
                        <div className="flex items-center gap-1">
                          <Building2 className="w-4 h-4" />
                          {rec.chapter}
                        </div>
                      </div>
                      
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">추천 이유</Label>
                        <div className="space-y-1">
                          {rec.reasons.map((reason: string, reasonIndex: number) => (
                            <div key={reasonIndex} className="text-sm text-gray-700 flex items-start gap-2">
                              <TrendingUp className="w-3 h-3 mt-0.5 text-red-600 flex-shrink-0" />
                              {reason}
                            </div>
                          ))}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          {/* AI 시너지 매칭 멤버 */}
          {aiAnalysis?.matchingMembers?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-blue-600" />
                  AI가 분석한 총 102명 중 상위 20명 추천
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {aiAnalysis.matchingMembers.map((member: any, index: number) => (
                    <div key={index} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h4 className="font-semibold">{member.name}</h4>
                          <p className="text-sm text-blue-600">{member.specialty}</p>
                        </div>
                        <Badge 
                          variant={member.matchType === 'direct' ? 'default' : 'secondary'}
                          className="text-xs"
                        >
                          {member.matchType === 'direct' ? '직접매칭' : 
                           member.matchType === 'related' ? '관련분야' : '잠재적'}
                        </Badge>
                      </div>
                      <div className="text-xs text-gray-600 mb-2">
                        {member.region} · {member.chapter}
                      </div>
                      <div className="text-sm text-green-700 font-medium">
                        매칭분야: {member.matchedSynergyField}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {isLoadingAnalytics ? (
            <Card className="animate-pulse">
              <CardHeader>
                <div className="h-6 bg-gray-200 rounded w-1/3"></div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="flex justify-between">
                      <div className="h-4 bg-gray-200 rounded w-1/3"></div>
                      <div className="h-4 bg-gray-200 rounded w-16"></div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-600">추가 분석 데이터가 표시됩니다</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}