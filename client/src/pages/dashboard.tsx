import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useScoreboard } from "@/hooks/use-scoreboard";
import { BarChart3, Printer, LogOut, Compass } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import PartnerForm from "@/components/partner-form";
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

  const { data: scoreboardData, refetch } = useQuery({
    queryKey: ["/api/scoreboard", user?.id],
    enabled: !!user?.id,
    refetchInterval: 5000, // 5초마다 자동 새로고침
  });

  const { data: userProfile, refetch: refetchProfile } = useQuery({
    queryKey: ["/api/user-profile", user?.id],
    enabled: !!user?.id,
    refetchInterval: 5000, // 5초마다 자동 새로고침
  });

  const { calculateAchievement } = useScoreboard(user?.id);

  const handleLogout = () => {
    localStorage.removeItem("bni_user");
    setLocation("/");
    toast({
      title: "로그아웃",
      description: "로그아웃되었습니다",
    });
  };

  const handlePrint = () => {
    window.print();
  };

  if (!user) {
    return <div>Loading...</div>;
  }

  const achievement = calculateAchievement(scoreboardData, userProfile);
  
  // Type assertions to fix the property mapping issue
  const achievementData = {
    percentage: achievement.percentage || 0,
    profitable: achievement.profitable || 0,
    credible: achievement.credible || 0,
    visible: achievement.visible || 0,
    total: achievement.total || 0,
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b no-print">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center">
              <div className="w-10 h-10 bni-blue rounded-full flex items-center justify-center mr-3">
                <BarChart3 className="text-white w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-800">파워팀 스코어보드</h1>
                <span className="text-sm text-gray-500">{user.email}</span>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrint}
                className="text-blue-800 border-blue-200 hover:bg-blue-50"
              >
                <Printer className="mr-1 w-4 h-4" />
                인쇄
              </Button>
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
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Guide Section */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-l-4 border-blue-500 p-6 mb-6 print-friendly rounded-lg">
          <div className="flex">
            <div className="flex-shrink-0">
              <Compass className="text-blue-500 w-5 h-5" />
            </div>
            <div className="ml-4">
              <h3 className="text-lg font-medium text-blue-800 mb-2">🧭 STEP 3: 나의 리퍼럴 파워팀 스코어 보드</h3>
              <div className="text-sm text-gray-700 space-y-2">
                <p>파워팀: 리퍼럴 파트너 스코어보드는 자신의 성과를 측정하고 기록하는 데 도움을 주는 기록 툴로서, 사용자 경험을 향상시키고, 사용자에게 인사이트를 도출할 수 있는 의미 있는 성장 데이터를 제공하기 위해 기획되었습니다. 😊</p>
                
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
                
                <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg mt-4">
                  <p className="text-sm"><strong>⚠️ 참고:</strong> 파트너와의 관계가 수익 창출 단계(P)가 아니라면 성과로 카운트되지 않습니다. 2년간 총 4명의 파트너를 영입하시면 100% 달성하게 됩니다.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Achievement Ring */}
          <div className="bg-white p-6 rounded-lg shadow print:bg-transparent print:shadow-none">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">달성률</h2>
            <div className="flex items-center justify-center">
              <div className="relative w-32 h-32">
                <svg className="w-32 h-32 transform -rotate-90" viewBox="0 0 36 36">
                  <path
                    d="M18 2.0845
                      a 15.9155 15.9155 0 0 1 0 31.831
                      a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke="#f3f4f6"
                    strokeWidth="2"
                  />
                  <path
                    d="M18 2.0845
                      a 15.9155 15.9155 0 0 1 0 31.831
                      a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke="#3b82f6"
                    strokeWidth="2"
                    strokeDasharray={`${achievementData.percentage}, 100`}
                    className="drop-shadow-sm"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-gray-800">{achievementData.percentage}%</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {achievementData.profitable}/4
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-600">수익 파트너 (P)</span>
                <span className="font-medium text-emerald-600">{achievementData.profitable}명</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-600">신뢰 파트너 (C)</span>
                <span className="font-medium text-orange-600">{achievementData.credible}명</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-600">인지 파트너 (V)</span>
                <span className="font-medium text-yellow-600">{achievementData.visible}명</span>
              </div>
              <div className="flex justify-between items-center text-sm pt-2 border-t">
                <span className="text-gray-600">총 파트너</span>
                <span className="font-medium">{achievementData.total}명</span>
              </div>
            </div>
          </div>

          {/* Partner Form */}
          <div className="lg:col-span-2">
            <PartnerForm
              userId={user.id}
              initialData={scoreboardData}
              onDataSaved={() => {
                refetch();
                refetchProfile();
              }}
            />
          </div>
        </div>

        {/* Change History - Temporarily disabled */}
        {/* <div className="mt-6">
          <ChangeHistory userId={user.id} />
        </div> */}
      </div>
    </div>
  );
}