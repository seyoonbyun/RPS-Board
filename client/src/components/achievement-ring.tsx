import { Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface AchievementRingProps {
  achievement: {
    current: number;
    percent: number;
    remaining: number;
    vStage?: number;
    cStage?: number;
  };
}

export default function AchievementRing({ achievement }: AchievementRingProps) {
  return (
    <Card className="shadow-lg mb-6 print-friendly">
      <CardContent className="p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-6 flex items-center">
          <Trophy className="text-yellow-500 mr-3 w-5 h-5" />
          달성 현황
        </h2>
        
        <div className="flex flex-col lg:flex-row items-center justify-center lg:justify-between">
          <div className="flex items-center justify-center mb-6 lg:mb-0">
            <div className="relative w-40 h-40">
              <div 
                className="achievement-ring w-40 h-40 rounded-full flex items-center justify-center"
                style={{ '--progress': achievement.percent } as React.CSSProperties}
              >
                <div className="bg-white w-32 h-32 rounded-full flex items-center justify-center shadow-inner">
                  <div className="text-center">
                    <div className="text-3xl font-bold text-gray-800">
                      {achievement.percent}%
                    </div>
                    <div className="text-xs text-gray-500">달성률</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* 모바일: 원형 차트 아래에 3개 항목을 한 줄로 배치 - V C P 순서 */}
          <div className="lg:hidden w-full mt-4">
            <div className="flex w-full gap-0.5">
              <div className="flex-1 text-center py-2 px-1 bg-yellow-50 rounded-lg border border-yellow-100 min-h-[60px] flex flex-col justify-center">
                <div className="text-sm leading-tight text-yellow-600 mb-0.5 font-bold">(V) {achievement.vStage || 0} 명</div>
                <div className="text-[9px] leading-tight text-gray-600">인지 파트너</div>
              </div>
              <div className="flex-1 text-center py-2 px-1 bg-orange-50 rounded-lg border border-orange-100 min-h-[60px] flex flex-col justify-center">
                <div className="text-sm leading-tight text-orange-600 mb-0.5 font-bold">(C) {achievement.cStage || 0} 명</div>
                <div className="text-[9px] leading-tight text-gray-600">신뢰 파트너</div>
              </div>
              <div className="flex-1 text-center py-2 px-1 bg-emerald-50 rounded-lg border border-emerald-100 min-h-[60px] flex flex-col justify-center">
                <div className="text-sm leading-tight text-emerald-600 mb-0.5 font-bold">
                  (P) {achievement.current} 명
                </div>
                <div className="text-[9px] leading-tight text-gray-600">수익 파트너</div>
              </div>
            </div>
          </div>
          
          {/* 데스크톱: 원래 레이아웃 유지 */}
          <div className="hidden lg:grid lg:grid-cols-1 gap-4 lg:ml-8">
            <div className="text-center lg:text-left">
              <div className="text-sm text-gray-600 mb-1">목표</div>
              <div className="text-2xl font-bold text-blue-600">4명</div>
              <div className="text-xs text-gray-500">P단계 파트너</div>
            </div>
            
            <div className="text-center lg:text-left">
              <div className="text-sm text-gray-600 mb-1">현재</div>
              <div className="text-2xl font-bold text-emerald-600">
                {achievement.current}명
              </div>
              <div className="text-xs text-gray-500">달성</div>
            </div>
            
            <div className="text-center lg:text-left">
              <div className="text-sm text-gray-600 mb-1">남은 목표</div>
              <div className="text-2xl font-bold text-orange-600">
                {achievement.remaining}명
              </div>
              <div className="text-xs text-gray-500">필요</div>
            </div>
            
            <div className="text-center lg:text-left">
              <div className="text-sm text-gray-600 mb-1">기간</div>
              <div className="text-lg font-semibold text-gray-700">2년</div>
              <div className="text-xs text-gray-500">총 기간</div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}