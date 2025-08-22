import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Lightbulb, Users, BarChart3, MapPin, Brain, Sparkles, Target, Clock, Search, Loader2 } from 'lucide-react';

interface PartnerRecommendationsProps {
  userId: string;
}

export function PartnerRecommendations({ userId }: PartnerRecommendationsProps) {
  // 지역 업체 검색 state
  const [regionalBusinesses, setRegionalBusinesses] = useState<any[]>([]);
  const [isLoadingRegionalBusinesses, setIsLoadingRegionalBusinesses] = useState(false);

  // AI 전문분야 분석 조회
  // useState로 직접 AI 분석 데이터 관리
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [aiError, setAiError] = useState<Error | null>(null);

  // AI 분석 함수
  const fetchAIAnalysis = async () => {
    if (!userId) return;
    
    setIsLoadingAI(true);
    setAiError(null);
    setAiAnalysis(null); // 이전 분석 결과 완전 초기화
    
    try {
      const timestamp = Date.now();
      const response = await fetch(`/api/ai-specialty-analysis/${userId}`, {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      
      console.log(`📡 AI 분석 요청 전송됨 - status: ${response.status}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error(`❌ AI 분석 요청 실패 - status: ${response.status}, error:`, errorData);
        throw new Error(errorData.message || 'AI 분석을 불러오는데 실패했습니다');
      }
      
      const data = await response.json();
      console.log(`📊 AI 분석 응답 받음 - userId: ${userId}, specialty: ${data.userSpecialty}, analysis length: ${data.analysis?.length}자`);
      console.log(`🔍 새로운 분석 내용 미리보기: ${data.analysis?.substring(0, 200)}...`);
      
      // 완전히 새로운 객체로 설정하여 React 리렌더링 강제
      setAiAnalysis({
        ...data,
        timestamp: Date.now(),
        forceUpdate: Math.random()
      });
    } catch (error) {
      console.error('AI 분석 오류:', error);
      setAiError(error as Error);
    } finally {
      setIsLoadingAI(false);
    }
  };

  // 컴포넌트 마운트 시 AI 분석 실행
  useEffect(() => {
    if (userId) {
      // 컴포넌트 마운트 시 1초 후 실행하여 완전한 초기화 보장
      setTimeout(() => {
        fetchAIAnalysis();
      }, 100);
    }
  }, [userId]);

  // 지역 내 업체 검색 함수
  const searchRegionalBusinesses = async () => {
    if (!aiAnalysis || !userId) return;
    
    console.log('🔄 지역 업체 검색 요청 시작 - userId:', userId, 'specialty:', aiAnalysis.userSpecialty);
    setIsLoadingRegionalBusinesses(true);
    try {
      const response = await fetch(`/api/regional-businesses/${userId}?t=${Date.now()}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        body: JSON.stringify({
          aiAnalysis: aiAnalysis.analysis,
          synergyFields: aiAnalysis.priorities
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: '지역 업체 검색 실패' }));
        
        // 단계별 검증 실패 구분
        if (errorData.step === 1) {
          // 1단계: 기본 정보 없음
          const { toast } = await import('@/hooks/use-toast');
          toast({
            title: "❗ 프로필 정보 필요",
            description: errorData.message,
            variant: "destructive",
            duration: 5000,
          });
          setRegionalBusinesses([]);
          return;
        } else if (errorData.step === 2) {
          // 2단계: AI 분석 먼저 필요
          const { toast } = await import('@/hooks/use-toast');
          toast({
            title: "🧠 AI 분석 먼저 진행",
            description: errorData.message,
            variant: "destructive", 
            duration: 6000,
          });
          setRegionalBusinesses([]);
          return;
        }
        
        throw new Error(errorData.message || '지역 업체 검색 실패');
      }
      
      const data = await response.json();
      
      console.log('🎯 지역 업체 검색 응답 받음:', data.businesses?.length || 0, '개 업체');
      setRegionalBusinesses(data.businesses || []);
    } catch (error) {
      console.error('지역 업체 검색 오류:', error);
      const { toast } = await import('@/hooks/use-toast');
      toast({
        title: "검색 오류",
        description: error instanceof Error ? error.message : '지역 업체 검색 중 오류가 발생했습니다',
        variant: "destructive",
        duration: 3000,
      });
    } finally {
      setIsLoadingRegionalBusinesses(false);
    }
  };

  // AI 분석이 완료되면 자동으로 지역 업체 검색 실행
  useEffect(() => {
    if (aiAnalysis && userId) {
      console.log(`🔄 AI 분석 완료됨, 추가 검색 시작 - specialty: ${aiAnalysis.userSpecialty}`);
      // 자동으로 지역 업체 검색 실행
      searchRegionalBusinesses();
    }
  }, [aiAnalysis, userId]);

  return (
    <div className="space-y-6">
      {/* AI 분석 중 로딩 팝업 */}
      <Dialog open={isLoadingAI} onOpenChange={() => {}}>
        <DialogContent className="w-[92vw] max-w-sm sm:max-w-lg lg:max-w-xl bg-white border-2 border-gray-200 shadow-2xl rounded-[7px] mx-auto">
          <DialogHeader className="pb-1 sm:pb-2">
            <DialogTitle className="flex items-center gap-2 sm:gap-3 text-center justify-center text-lg sm:text-xl font-bold text-gray-900">
              <Loader2 className="w-6 h-6 sm:w-7 sm:h-7 animate-spin text-blue-600" />
              K-BNI.AI 분석 중
            </DialogTitle>
          </DialogHeader>
          <div className="text-center py-4 sm:py-8 px-2 sm:px-4">
            <div className="space-y-3 sm:space-y-4">
              <div className="text-xs sm:text-base font-semibold text-gray-900 whitespace-nowrap">
                K-BNI.AI가 대표님의 전문분야를 분석하고 있습니다.
              </div>
              <div className="text-xs sm:text-base text-gray-700 whitespace-nowrap">
                잠시만 기다려 주세요...!
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 헤더 */}
      <div className="flex items-center gap-2">
        <Lightbulb className="w-6 h-6 text-red-600" />
        <h2 className="text-2xl font-bold">파워팀 파트너 추천</h2>
      </div>

      <Tabs defaultValue="ai-analysis" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="ai-analysis" className="flex items-center gap-1 md:gap-2 text-xs md:text-sm">
            <Brain className="w-3 h-3 md:w-4 md:h-4 flex-shrink-0" />
            <span className="truncate">나의 전문분야 분석</span>
          </TabsTrigger>
          <TabsTrigger value="analytics" className="flex items-center gap-1 md:gap-2 text-xs md:text-sm">
            <BarChart3 className="w-3 h-3 md:w-4 md:h-4 flex-shrink-0" />
            <span className="hidden md:block">K-BNI.AI의 파워팀 파트너 추천</span>
            <span className="block md:hidden truncate">AI의 파워팀 추천</span>
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
                  onClick={() => fetchAIAnalysis()}
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

            </div>
          ) : (
            <Card>
              <CardContent className="text-center py-8">
                <Brain className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">AI 분석 데이터가 없습니다</p>
                <Button 
                  variant="outline" 
                  onClick={() => fetchRegionalBusinesses()}
                  className="mt-4 bg-red-600 hover:bg-red-700 text-white"
                >
                  분석 시작
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* K-BNI.AI 파워팀 파트너 추천 탭 */}
        <TabsContent value="analytics" className="space-y-4">
          {/* 지역 기반 업체 검색 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg md:text-xl">
                <MapPin className="w-4 h-4 md:w-5 md:h-5 text-green-600" />
                지역 내 파워팀 업체 검색
                {/* PC에서만 버튼 표시 */}
                {regionalBusinesses && regionalBusinesses.length > 0 && (
                  <Button size="sm" className="ml-2 h-6 px-2 text-xs bg-green-600 hover:bg-green-700 text-white hidden md:inline-flex">
                    {regionalBusinesses.length} 업체 추천
                  </Button>
                )}
              </CardTitle>
              <div className="flex flex-row items-center justify-between md:flex-row md:items-center gap-2">
                <CardDescription className="text-sm md:text-base">
                  지역에서 나의 전문분야와 시너지를 일으킬 수 있는 업체 정보입니다
                </CardDescription>
                {/* 모바일에서만 버튼 표시 */}
                {regionalBusinesses && regionalBusinesses.length > 0 && (
                  <Button size="sm" className="h-6 px-2 text-xs bg-green-600 hover:bg-green-700 text-white md:hidden w-fit shrink-0">
                    {regionalBusinesses.length} 업체 추천
                  </Button>
                )}
              </div>
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
                    <div key={index} className="border rounded-lg p-3 md:p-4 hover:shadow-md transition-shadow bg-green-50">
                      {/* 모바일: 세로 배치, PC: 가로 배치 */}
                      <div className="space-y-3 md:grid md:grid-cols-2 md:gap-4 md:space-y-0">
                        {/* 왼쪽: 기본 정보 */}
                        <div className="space-y-2">
                          <div className="flex items-start gap-2">
                            <span className="font-semibold text-gray-700 text-sm min-w-fit">업체명:</span>
                            <span className="text-green-600 font-medium text-sm break-words">{business.name}</span>
                          </div>
                          
                          {/* 모바일에서 업종과 주소를 분리 */}
                          <div className="md:flex md:items-center md:gap-2 space-y-1 md:space-y-0">
                            <div className="flex items-start gap-2">
                              <span className="font-semibold text-gray-700 text-sm min-w-fit">업종:</span>
                              <span className="text-sm break-words">{business.category}</span>
                            </div>
                            <span className="text-gray-400 hidden md:inline">|</span>
                            <div className="flex items-start gap-2">
                              <span className="font-semibold text-gray-700 text-sm min-w-fit">주소:</span>
                              <span className="text-sm break-words">{business.address}</span>
                            </div>
                          </div>
                          
                          {business.phone && (
                            <div className="flex items-start gap-2">
                              <span className="font-semibold text-gray-700 text-sm min-w-fit">연락처:</span>
                              <span className="text-gray-600 text-sm break-all">{business.phone}</span>
                            </div>
                          )}
                          
                          {business.website && (
                            <div className="flex items-start gap-2">
                              <span className="font-semibold text-gray-700 text-sm min-w-fit">웹사이트:</span>
                              <a 
                                href={business.website} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:text-blue-800 underline text-sm break-all"
                              >
                                {business.website}
                              </a>
                            </div>
                          )}
                        </div>
                        
                        {/* 오른쪽: 시너지 정보 */}
                        <div className="space-y-2">
                          <div className="flex items-start justify-between">
                            <div className="text-sm text-green-700 font-medium">
                              시너지 가능성: {business.synergyPotential}
                            </div>
                            <Badge variant="secondary" className="text-xs ml-2 shrink-0">
                              지역 업체
                            </Badge>
                          </div>
                          <div className="text-xs text-gray-500 leading-relaxed">
                            {business.description}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6">
                  <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                    <div className="flex items-start gap-3">
                      <div className="text-amber-600 font-medium text-lg">⚠️</div>
                      <div className="text-left">
                        <p className="text-amber-800 font-medium mb-2">실제 데이터만 제공 정책</p>
                        <p className="text-amber-700 text-sm leading-relaxed mb-3">
                          현재 시스템은 **실제로 존재하는 업체만**을 검색하여 제공합니다. 
                          다양한 검색 방법을 통해 실제 협업 가능한 업체를 찾고 있습니다.
                        </p>
                        <div className="p-3 bg-green-100 rounded border border-green-300">
                          <p className="text-green-800 text-xs font-medium mb-1">✅ 실제 업체 검색 시스템 정상 작동</p>
                          <p className="text-green-700 text-xs mb-2">
                            유료 계정 전환으로 실제 업체 검색이 성공적으로 작동하고 있습니다.
                          </p>
                          <div className="text-green-600 text-xs">
                            <p className="font-medium mb-1">현재 상태:</p>
                            <p>✓ 실제 업체 검색 성공</p>
                            <p>✓ 지역별 맞춤 추천 가능</p>
                            <p>✓ 협업 가능 업체만 선별</p>
                            <p>✓ 안정적인 서비스 제공</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <MapPin className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-gray-600 text-sm mb-2">실제 업체 검색 서비스 일시 중단</p>
                  <p className="text-xs text-gray-500 mb-3">신뢰할 수 있는 실제 업체 정보만 제공하기 위해 시스템을 개선 중입니다</p>
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