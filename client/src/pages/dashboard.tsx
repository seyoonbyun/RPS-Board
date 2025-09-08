import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useScoreboard } from "@/hooks/use-scoreboard";
import { BarChart3, Printer, LogOut, Compass, Lightbulb, Users } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import PartnerForm from "@/components/partner-form";
import { PartnerRecommendations } from "@/components/partner-recommendations";
import type { ScoreboardData } from "@shared/schema";
import { CACHE_CONFIG, BRAND_COLORS } from "@shared/constants";
// import ChangeHistory from "@/components/change-history";

export default function Dashboard() {
  const [user, setUser] = useState<{id: string, email: string} | null>(null);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    const savedUser = localStorage.getItem("bni_user");
    if (!savedUser) {
      setLocation("/");
      return;
    }
    setUser(JSON.parse(savedUser));
  }, [setLocation]);

  const { data: scoreboardData, refetch } = useQuery<ScoreboardData>({
    queryKey: ["/api/scoreboard", user?.id],
    enabled: !!user?.id,
    refetchInterval: CACHE_CONFIG.REALTIME_REFRESH_INTERVAL, // 5초마다 자동 새로고침
  });

  const { data: userProfile, refetch: refetchProfile } = useQuery<{
    partner?: string;
    memberName?: string;
    rpartner1?: string;
    rpartner1Stage?: string;
    rpartner2?: string;
    rpartner2Stage?: string;
    rpartner3?: string;
    rpartner3Stage?: string;
    rpartner4?: string;
    rpartner4Stage?: string;
  }>({
    queryKey: ["/api/user-profile", user?.id],
    enabled: !!user?.id,
    refetchInterval: CACHE_CONFIG.REALTIME_REFRESH_INTERVAL, // 5초마다 자동 새로고침
  });

  // 관리자 권한 확인
  const { data: adminPermission } = useQuery({
    queryKey: ["/api/admin/check-permission", user?.email],
    queryFn: async () => {
      if (!user?.email) return { isAdmin: false };
      const response = await fetch('/api/admin/check-permission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email })
      });
      if (!response.ok) {
        return { isAdmin: false };
      }
      return response.json();
    },
    enabled: !!user?.email,
    staleTime: CACHE_CONFIG.ADMIN_PERMISSION_STALE_TIME, // 1분간 캐시
  });

  const { calculateAchievement } = useScoreboard(user?.id);

  const handleLogout = () => {
    localStorage.removeItem("bni_user");
    setLocation("/");
    toast({
      title: "로그아웃",
      description: "로그아웃되었습니다",
      duration: CACHE_CONFIG.TOAST_DURATION,
    });
  };

  const handlePrint = () => {
    window.print();
  };

  if (!user) {
    return <div>Loading...</div>;
  }

  const achievement = calculateAchievement(scoreboardData, userProfile);
  
  // 올바른 프로퍼티 매핑으로 수정
  const achievementData = {
    current: achievement.profitable || 0,  // P 단계 (수익 파트너)
    percent: achievement.percentage || 0,
    remaining: Math.max(0, 4 - (achievement.profitable || 0)),
    vStage: achievement.visible || 0,      // V 단계 (인지 파트너)
    cStage: achievement.credible || 0,     // C 단계 (신뢰 파트너)
    total: achievement.total || 0,
  };

  // Format current date and time for print header
  const formatPrintDateTime = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    return `${year}-${month}-${day}, ${hours}:${minutes}:${seconds}`;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Print-only Header */}
      <div className="print-only print-header">
        <h1 className="text-xl font-bold text-gray-900 whitespace-nowrap">BNI Korea My Powerteam RPS Report</h1>
        <div className="print-date">{formatPrintDateTime()}</div>
      </div>

      {/* Header */}
      <header className="bg-white shadow-sm border-b no-print">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* 데스크톱 레이아웃 */}
          <div className="hidden md:flex justify-between items-center py-4">
            <div className="flex items-center">
              <div className="w-10 h-10 rounded-full flex items-center justify-center mr-3" style={{ backgroundColor: BRAND_COLORS.PRIMARY }}>
                <BarChart3 className="text-white w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold" style={{ color: BRAND_COLORS.PRIMARY }}>파워팀 스코어보드</h1>
                <span className="text-sm text-gray-500 truncate max-w-xs" title={user.email}>ID : {user.email}</span>
                {userProfile && (
                  <div className="text-sm text-gray-700 mt-1">
                    {userProfile.partner} {userProfile.memberName} 대표님, 환영합니다 ! :)
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center space-x-4">
              {/* 관리자 패널 버튼 - AUTH 권한 기반 표시 */}
              {adminPermission?.isAdmin && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLocation('/admin')}
                  style={{ 
                    color: BRAND_COLORS.PRIMARY, 
                    borderColor: '#f5c2c7', 
                  }}
                  className="hover:bg-red-50"
                >
                  <Users className="mr-1 w-4 h-4" />
                  관리자 패널
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleLogout}
                className="text-red-800 border-red-200 hover:bg-red-50"
              >
                <LogOut className="mr-1 w-4 h-4" />
                로그아웃
              </Button>
            </div>
          </div>

          {/* 모바일 레이아웃 */}
          <div className="md:hidden py-4">
            {/* 타이틀과 사용자 정보 - 맨 위 */}
            <div className="flex items-center mb-4">
              <div className="w-10 h-10 rounded-full flex items-center justify-center mr-3" style={{ backgroundColor: BRAND_COLORS.PRIMARY }}>
                <BarChart3 className="text-white w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold" style={{ color: BRAND_COLORS.PRIMARY }}>파워팀 스코어보드</h1>
                <span className="text-sm text-gray-500 truncate max-w-xs" title={user.email}>ID : {user.email}</span>
                {userProfile && (
                  <div className="text-sm text-gray-700 mt-1">
                    {userProfile.partner} {userProfile.memberName} 대표님, 환영합니다 ! :)
                  </div>
                )}
              </div>
            </div>

            {/* 버튼들 - 아래에 배치 */}
            <div className="space-y-2">
              {/* 관리자 패널 버튼 - 있으면 첫 번째 줄에 전체 너비 */}
              {adminPermission?.isAdmin && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLocation('/admin')}
                  style={{ 
                    color: BRAND_COLORS.PRIMARY, 
                    borderColor: '#f5c2c7', 
                  }}
                  className="hover:bg-red-50 w-full"
                >
                  <Users className="mr-2 w-4 h-4" />
                  관리자 패널
                </Button>
              )}
              {/* 로그아웃 버튼 */}
              <Button
                variant="outline"
                size="sm"
                onClick={handleLogout}
                className="text-red-800 border-red-200 hover:bg-red-50 w-full"
              >
                <LogOut className="mr-1 w-4 h-4" />
                로그아웃
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Guide Section */}
        <div className="bg-gradient-to-r from-red-50 to-pink-50 border-l-4 p-6 mb-6 print-friendly rounded-lg print-hidden" style={{ borderLeftColor: BRAND_COLORS.PRIMARY }}>
          <h3 className="text-lg font-medium mb-2" style={{ color: BRAND_COLORS.PRIMARY }}>🧭 STEP 3: 나의 파워팀 리퍼럴 파트너 스코어 보드</h3>
          <div className="text-sm text-gray-700 space-y-2">
            <p>나의 파워팀_리퍼럴 파트너 스코어보드(RPS)는 BNI코리아 대표님들의 비즈니스 확장 경험을 측정하고 기록하는 데 도움을 주는 기록 툴로, 성취 경험을 향상시킴은 물론, 비즈니스 인사이트를 도출할 수 있는 의미 있는 성장 데이터를 제공하기 위해 기획되었습니다. 😊</p>
            
            <div className="bg-white p-4 rounded-lg mt-4">
              <p className="font-semibold text-gray-800 mb-2">🔁 관계 단계:</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="flex items-center space-x-2">
                  <span className="w-6 h-6 bg-yellow-100 text-yellow-800 rounded-full flex items-center justify-center text-xs font-bold">V</span>
                  <span className="text-sm"><strong>Visibility</strong>: 아는 단계</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="w-6 h-6 bg-orange-100 text-orange-800 rounded-full flex items-center justify-center text-xs font-bold">C</span>
                  <span className="text-sm"><strong>Credibility</strong>: 신뢰 단계</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="w-6 h-6 bg-emerald-100 text-emerald-800 rounded-full flex items-center justify-center text-xs font-bold">P</span>
                  <span className="text-sm"><strong>Profit</strong>: 수익 단계</span>
                </div>
              </div>
            </div>
            
            <div className="bg-amber-50 border border-amber-200 p-4 rounded-lg mt-4">
              <div className="space-y-3">
                <div className="text-center">
                  <p className="text-sm font-bold text-gray-800">💪 RPS보드를 통해 달성하게 될 나의 파워팀 미션 : 진짜 비즈니스 파트너 4명 만들기 !</p>
                  <p className="text-sm font-medium text-gray-700 mt-1">나의 진짜 리퍼럴 파트너는 누구 ???</p>
                </div>
                
                <div>
                  <p className="text-sm font-bold text-gray-800 mb-2">🔄 P(Profit수익창출)단계 파트너 카운팅 프로세스</p>
                  <div className="space-y-1 pl-4">
                    <div className="flex items-center text-xs text-gray-700">
                      <span className="mr-2">✅1단계 : 파트너 영입</span>
                    </div>
                    <div className="flex items-center text-xs text-gray-700 pl-8">
                      <span>↓</span>
                    </div>
                    <div className="flex items-center text-xs text-gray-700">
                      <span className="mr-2">✅2단계 :</span>
                      <div className="bg-blue-100 border border-blue-300 px-3 py-2 rounded-lg">
                        <span className="text-blue-800 font-semibold">T2 상호거래 2회 이상 달성</span>
                      </div>
                    </div>
                    <div className="flex items-center text-xs text-gray-700 pl-8">
                      <span>↓</span>
                    </div>
                    <div className="flex items-center text-xs text-gray-700">
                      <span className="mr-2">✅3단계 : 파트너의 P단계(수익창출) 도달 확인</span>
                    </div>
                    <div className="flex items-center text-xs text-gray-700 pl-8">
                      <span>↓</span>
                    </div>
                    <div className="flex items-center text-xs text-gray-700">
                      <span className="mr-2">✅4단계 : P(Profit수익창출) 파트너로 인정 🚀</span>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <p className="text-sm"><strong>⚠️</strong> 파트너와의 관계가 수익 창출 단계(P)가 아니라면 성과로 카운트되지 않아요 !!</p>
                  <p className="text-sm"><strong>🏆 최종 목표:</strong> 2년 안에 4명 달성 = 100% 성공!</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Tabs */}
        <Tabs defaultValue="scoreboard" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-6 tabs-list">
            <TabsTrigger value="scoreboard" className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              스코어보드
            </TabsTrigger>
            <TabsTrigger value="recommendations" className="flex items-center gap-2">
              <Lightbulb className="w-4 h-4" />
              <span className="hidden md:inline">AI 파워팀 브리핑</span>
              <span className="md:hidden">AI 파워팀 브리핑</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="scoreboard">
            <PartnerForm
              userId={user.id}
              initialData={scoreboardData}
              achievementData={achievementData}
              onDataSaved={() => {
                refetch();
                refetchProfile();
              }}
            />
          </TabsContent>

          <TabsContent value="recommendations">
            <PartnerRecommendations userId={user.id} />
          </TabsContent>
        </Tabs>

        {/* Change History - Temporarily disabled */}
        {/* <div className="mt-6">
          <ChangeHistory userId={user.id} />
        </div> */}
      </div>

      {/* Print Footer with Custom URL */}
      <footer className="print-only fixed bottom-0 left-0 w-full text-xs text-gray-600 p-2 bg-white">
        <div className="text-left">
          https://www.powerteam-bnikorea.com
        </div>
      </footer>
    </div>
  );
}