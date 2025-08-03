import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import AchievementRing from "@/components/achievement-ring";
import PartnerForm from "@/components/partner-form";
import DataSummary from "@/components/data-summary";
import ChangeNotification from "@/components/change-notification";
import { useScoreboard } from "@/hooks/use-scoreboard";
import { BarChart3, RefreshCw, LogOut, Printer, Compass, Users } from "lucide-react";
import type { User } from "@shared/schema";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(null);

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
  });

  const { syncMutation, calculateAchievement } = useScoreboard(user?.id);

  const handleLogout = () => {
    localStorage.removeItem("bni_user");
    setLocation("/");
    toast({
      title: "로그아웃",
      description: "로그아웃되었습니다",
    });
  };

  const handleSync = () => {
    if (!user?.id) return;
    syncMutation.mutate(user.id);
  };

  const handlePrint = () => {
    window.print();
  };

  if (!user) {
    return <div>Loading...</div>;
  }

  const achievement = calculateAchievement(scoreboardData);

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
                onClick={handleSync}
                disabled={syncMutation.isPending}
                className="text-emerald-800 border-emerald-200 hover:bg-emerald-50"
              >
                <RefreshCw className={`mr-1 w-4 h-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                {syncMutation.isPending ? '동기화 중...' : '구글 시트 동기화'}
              </Button>
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

        {/* Achievement Section */}
        <AchievementRing achievement={achievement} />

        {/* Data Input Form */}
        <PartnerForm 
          userId={user.id} 
          initialData={scoreboardData} 
          onDataSaved={() => refetch()}
        />

        {/* Data Summary */}
        <DataSummary 
          scoreboardData={scoreboardData} 
          achievement={achievement}
        />
      </div>

      {/* Change Notifications */}
      <ChangeNotification userId={user.id} />
    </div>
  );
}
