import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Lightbulb, Users, BarChart3, Filter, TrendingUp, MapPin, Building2 } from 'lucide-react';

interface PartnerRecommendation {
  memberName: string;
  email: string;
  specialty: string;
  region: string;
  chapter: string;
  compatibilityScore: number;
  synergyType: 'high' | 'medium' | 'low';
  reasons: string[];
  currentStage?: 'V' | 'C' | 'P' | 'none';
}

interface RecommendationFilters {
  region?: string;
  chapter?: string;
  minCompatibilityScore: number;
  excludeCurrentPartners: boolean;
  maxResults: number;
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

  const getSynergyColor = (synergyType: 'high' | 'medium' | 'low') => {
    switch (synergyType) {
      case 'high': return 'bg-red-100 text-red-800 border-red-200';
      case 'medium': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'low': return 'bg-blue-100 text-blue-800 border-blue-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getSynergyText = (synergyType: 'high' | 'medium' | 'low') => {
    switch (synergyType) {
      case 'high': return '강력 추천';
      case 'medium': return '추천';
      case 'low': return '고려';
      default: return '기본';
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-red-600 font-bold';
    if (score >= 60) return 'text-orange-600 font-semibold';
    return 'text-blue-600';
  };

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-6 h-6 text-red-600" />
          <h2 className="text-2xl font-bold">AI 파트너 추천</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2"
          >
            <Filter className="w-4 h-4" />
            필터 {showFilters ? '숨기기' : '보기'}
          </Button>
          <Button
            size="sm"
            onClick={() => refetchRecommendations()}
            className="bg-red-600 hover:bg-red-700"
          >
            새로고침
          </Button>
        </div>
      </div>

      <Tabs defaultValue="recommendations" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="recommendations" className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            추천 파트너
          </TabsTrigger>
          <TabsTrigger value="analytics" className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            업종 분석
          </TabsTrigger>
        </TabsList>

        <TabsContent value="recommendations" className="space-y-4">
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
                  <Select value={filters.region || 'all'} onValueChange={(value) => 
                    setFilters(prev => ({ ...prev, region: value === 'all' ? undefined : value }))
                  }>
                    <SelectTrigger>
                      <SelectValue placeholder="모든 지역" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">모든 지역</SelectItem>
                      <SelectItem value="서울">서울</SelectItem>
                      <SelectItem value="경기">경기</SelectItem>
                      <SelectItem value="인천">인천</SelectItem>
                      <SelectItem value="부산">부산</SelectItem>
                      <SelectItem value="대구">대구</SelectItem>
                      <SelectItem value="광주">광주</SelectItem>
                      <SelectItem value="대전">대전</SelectItem>
                    </SelectContent>
                  </Select>
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
                          {rec.reasons.map((reason, reasonIndex) => (
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
          ) : (
            <Card>
              <CardContent className="text-center py-8">
                <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">조건에 맞는 추천 파트너가 없습니다</p>
                <p className="text-sm text-gray-500 mt-2">필터 조건을 조정해보세요</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
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
          ) : industryAnalytics ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="w-5 h-5" />
                    업종별 분포
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {Object.entries(industryAnalytics.industryDistribution)
                      .sort(([,a], [,b]) => (b as number) - (a as number))
                      .slice(0, 8)
                      .map(([industry, count]) => (
                      <div key={industry} className="flex justify-between items-center">
                        <span className="text-sm font-medium">{industry}</span>
                        <Badge variant="outline">{count as number}명</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5" />
                    호환성 기회
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {industryAnalytics.compatibilityOpportunities
                      .slice(0, 8)
                      .map((opportunity: any, index: number) => (
                      <div key={index} className="flex justify-between items-center">
                        <span className="text-sm font-medium">{opportunity.industry}</span>
                        <Badge className="bg-red-100 text-red-800">
                          {opportunity.potentialPartners}개 기회
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="text-center py-8">
                <BarChart3 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">업종 분석 데이터를 불러올 수 없습니다</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}