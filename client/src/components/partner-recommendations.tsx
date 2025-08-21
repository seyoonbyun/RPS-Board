import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Lightbulb, Users, BarChart3, MapPin, Brain, Sparkles, Target, Clock, Search } from 'lucide-react';

interface PartnerRecommendationsProps {
  userId: string;
}

export function PartnerRecommendations({ userId }: PartnerRecommendationsProps) {
  // 새로운 state 추가
  const [chapterSynergyMembers, setChapterSynergyMembers] = useState<any[]>([]);
  const [regionalBusinesses, setRegionalBusinesses] = useState<any[]>([]);
  const [isLoadingRegionalBusinesses, setIsLoadingRegionalBusinesses] = useState(false);

  // AI 전문분야 분석 조회
  const { 
    data: aiAnalysis, 
    isLoading: isLoadingAI,
    error: aiError,
    refetch: refetchAI
  } = useQuery({
    queryKey: ['/api/ai-specialty-analysis', userId, Date.now()], // 타임스탬프로 강제 캐시 무효화
    queryFn: async () => {
      console.log(`🔄 AI 분석 요청 시작 - userId: ${userId}, timestamp: ${Date.now()}`);
      const response = await fetch(`/api/ai-specialty-analysis/${userId}?t=${Date.now()}`, {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
      console.log(`📡 AI 분석 요청 전송됨 - status: ${response.status}`);
      if (!response.ok) {
        const errorData = await response.json();
        console.error(`❌ AI 분석 요청 실패 - status: ${response.status}, error:`, errorData);
        throw new Error(errorData.message || 'AI 분석을 불러오는데 실패했습니다');
      }
      const data = await response.json();
      console.log(`📊 AI 분석 응답 받음 - userId: ${userId}, specialty: ${data.userSpecialty}, analysis:`, data.analysis?.substring(0, 200));
      return data;
    },
    enabled: !!userId,
    staleTime: 0, // 캐시 비활성화로 항상 새로운 요청
    gcTime: 0, // React Query v5: cacheTime → gcTime으로 변경
    retry: false, // 재시도 비활성화
  });

  // 챕터 내 시너지 멤버 검색 함수
  const searchChapterSynergyMembers = async () => {
    if (!aiAnalysis || !userId) return;
    
    try {
      const response = await fetch(`/api/chapter-synergy-members/${userId}`);
      if (!response.ok) throw new Error('챕터 내 시너지 멤버 검색 실패');
      
      const data = await response.json();
      setChapterSynergyMembers(data.members || []);
    } catch (error) {
      console.error('챕터 내 시너지 멤버 검색 오류:', error);
    }
  };

  // 지역 내 업체 검색 함수
  const searchRegionalBusinesses = async () => {
    if (!aiAnalysis || !userId) return;
    
    setIsLoadingRegionalBusinesses(true);
    try {
      const response = await fetch(`/api/regional-businesses/${userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aiAnalysis: aiAnalysis.analysis,
          synergyFields: aiAnalysis.priorities
        })
      });
      
      if (!response.ok) throw new Error('지역 업체 검색 실패');
      
      const data = await response.json();
      setRegionalBusinesses(data.businesses || []);
    } catch (error) {
      console.error('지역 업체 검색 오류:', error);
    } finally {
      setIsLoadingRegionalBusinesses(false);
    }
  };

  // AI 분석이 완료되면 자동으로 챕터 내 시너지 멤버 검색
  useEffect(() => {
    if (aiAnalysis && userId) {
      console.log(`🔄 AI 분석 완료됨, 추가 검색 시작 - specialty: ${aiAnalysis.userSpecialty}`);
      searchChapterSynergyMembers();
      // 지역 업체 검색은 수동으로만 실행 (자동 실행 제거)
    }
  }, [aiAnalysis, userId]);

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center gap-2">
        <Lightbulb className="w-6 h-6 text-red-600" />
        <h2 className="text-2xl font-bold">파워팀 파트너 추천</h2>
      </div>

      <Tabs defaultValue="ai-analysis" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="ai-analysis" className="flex items-center gap-2">
            <Brain className="w-4 h-4" />
            나의 전문분야 분석
          </TabsTrigger>
          <TabsTrigger value="analytics" className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            K-BNI.AI의 파워팀 파트너 추천
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
                    현재 나의 전문분야
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
                    K-BNI.AI 상세분석
                  </CardTitle>
                  <CardDescription>
                    대표님의 비즈니스 시너지와 확장 가능성에 대한 K-BNI.AI의 분석입니다
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

        {/* AI 시너지 매칭 멤버 탭 */}
        <TabsContent value="analytics" className="space-y-4">
          {/* 1차: 동일 챕터 내 추천 멤버 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-600" />
                나의 챕터 내 파워팀 멤버 추천
              </CardTitle>
              <CardDescription>
                동일 챕터에서 나의 전문분야와 시너지를 일으킬 수 있는 멤버들입니다
              </CardDescription>
            </CardHeader>
            <CardContent>
              {chapterSynergyMembers && chapterSynergyMembers.length > 0 ? (
                <div className="grid grid-cols-1 gap-4">
                  {chapterSynergyMembers.map((member: any, index: number) => (
                    <div key={member.email} className="border rounded-lg p-4 hover:shadow-md transition-shadow bg-blue-50">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-semibold text-gray-700">챕터:</span>
                            <span>{member.chapter}</span>
                            <span className="text-gray-400">|</span>
                            <span className="font-semibold text-gray-700">멤버명:</span>
                            <span className="text-blue-600 font-medium">{member.memberName}</span>
                          </div>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-semibold text-gray-700">회사명:</span>
                            <span>{member.company || '정보 없음'}</span>
                            <span className="text-gray-400">|</span>
                            <span className="font-semibold text-gray-700">전문분야:</span>
                            <span>{member.specialty || '정보 없음'}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-gray-700">이메일:</span>
                            <span className="text-gray-600">{member.email}</span>
                          </div>
                        </div>
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="text-sm text-green-700 font-medium mb-1">
                              시너지 분야: {member.synergyReason}
                            </div>
                          </div>
                          <Badge variant="default" className="text-xs">
                            챕터 내 추천
                          </Badge>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-4">
                  <Users className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-gray-600 text-sm mb-1">아직까지 추천할 멤버가 없습니다.</p>
                  <p className="text-xs text-gray-500">나의 전문분야 분석을 통해 제안드린 분야의 멤버를 영입해보세요!</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 2차: 지역 기반 업체 검색 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="w-5 h-5 text-green-600" />
                지역 내 파워팀 업체 검색
              </CardTitle>
              <CardDescription>
                지역에서 나의 전문분야와 시너지를 일으킬 수 있는 업체 정보입니다
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingRegionalBusinesses ? (
                <div className="animate-pulse space-y-4">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="border rounded-lg p-4">
                      <div className="h-4 bg-gray-200 rounded w-1/3 mb-2"></div>
                      <div className="h-3 bg-gray-200 rounded w-1/2 mb-2"></div>
                      <div className="h-3 bg-gray-200 rounded w-2/3"></div>
                    </div>
                  ))}
                </div>
              ) : regionalBusinesses && regionalBusinesses.length > 0 ? (
                <div className="grid grid-cols-1 gap-4">
                  {regionalBusinesses.map((business: any, index: number) => (
                    <div key={index} className="border rounded-lg p-4 hover:shadow-md transition-shadow bg-green-50">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-semibold text-gray-700">업체명:</span>
                            <span className="text-green-600 font-medium">{business.name}</span>
                          </div>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-semibold text-gray-700">업종:</span>
                            <span>{business.category}</span>
                            <span className="text-gray-400">|</span>
                            <span className="font-semibold text-gray-700">주소:</span>
                            <span>{business.address}</span>
                          </div>
                          {business.phone && (
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-gray-700">연락처:</span>
                              <span className="text-gray-600">{business.phone}</span>
                            </div>
                          )}
                        </div>
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="text-sm text-green-700 font-medium mb-1">
                              시너지 가능성: {business.synergyPotential}
                            </div>
                            <div className="text-xs text-gray-500">
                              {business.description}
                            </div>
                          </div>
                          <Badge variant="secondary" className="text-xs">
                            지역 업체
                          </Badge>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-4">
                  <MapPin className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-gray-600 text-sm mb-2">지역 업체 정보가 검색되지 않았습니다.</p>
                  <p className="text-xs text-gray-500 mb-3">나의 전문분야 분석이 완료되면 자동으로 검색됩니다.</p>
                  {!aiAnalysis && (
                    <p className="text-xs text-yellow-600">먼저 "나의 전문분야 분석"을 실행해주세요</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}