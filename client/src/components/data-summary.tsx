import { Card, CardContent } from "@/components/ui/card";
import { BarChart3, Users } from "lucide-react";
import type { ScoreboardData } from "@shared/schema";

interface DataSummaryProps {
  scoreboardData?: ScoreboardData | null;
  userProfile?: any;
  achievement: {
    current: number;
    percent: number;
    remaining: number;
    vStage: number;
    cStage: number;
    total: number;
  };
}

export default function DataSummary({ scoreboardData, userProfile, achievement }: DataSummaryProps) {
  const getPartnersList = () => {
    // 구글 시트 프로필 데이터가 있으면 우선 사용
    if (userProfile) {
      const partners = [];
      const partnerData = [
        { name: userProfile.rpartner1, specialty: userProfile.rpartner1Specialty, stage: userProfile.rpartner1Stage },
        { name: userProfile.rpartner2, specialty: userProfile.rpartner2Specialty, stage: userProfile.rpartner2Stage },
        { name: userProfile.rpartner3, specialty: userProfile.rpartner3Specialty, stage: userProfile.rpartner3Stage },
        { name: userProfile.rpartner4, specialty: userProfile.rpartner4Specialty, stage: userProfile.rpartner4Stage },
      ];

      partnerData.forEach(partner => {
        if (partner.name && partner.name.trim()) {
          partners.push({
            name: partner.name.trim(),
            specialty: partner.specialty || "",
            stage: partner.stage || "",
          });
        }
      });
      return partners;
    }

    // 폴백으로 scoreboardData 사용
    if (!scoreboardData) return [];

    const partners = [];
    for (let i = 1; i <= 4; i++) {
      const name = scoreboardData[`rpartner${i}` as keyof ScoreboardData] as string;
      const specialty = scoreboardData[`rpartner${i}Specialty` as keyof ScoreboardData] as string;
      const stage = scoreboardData[`rpartner${i}Stage` as keyof ScoreboardData] as string;

      if (name && name.trim()) {
        partners.push({
          name: name.trim(),
          specialty: specialty || "",
          stage: stage || "",
        });
      }
    }
    return partners;
  };

  const partners = getPartnersList();
  const lastUpdate = scoreboardData?.updatedAt 
    ? new Date(scoreboardData.updatedAt).toLocaleString('ko-KR')
    : "-";

  const getStageColor = (stage: string) => {
    switch (stage) {
      case 'V': return 'bg-yellow-100 text-yellow-800';
      case 'C': return 'bg-orange-100 text-orange-800';
      case 'P': return 'bg-emerald-100 text-emerald-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStageLabel = (stage: string) => {
    switch (stage) {
      case 'V': return 'V (아는 단계)';
      case 'C': return 'C (신뢰 단계)';
      case 'P': return 'P (수익 단계)';
      default: return '미설정';
    }
  };

  return (
    <Card className="shadow-lg mt-6 print-friendly">
      <CardContent className="p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-6 flex items-center">
          <BarChart3 className="text-emerald-500 mr-3 w-5 h-5" />
          현재 데이터 요약
        </h2>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="text-center p-4 bg-blue-50 rounded-lg border border-blue-100">
            <div className="text-3xl font-bold text-blue-600 mb-1">
              {achievement.total}
            </div>
            <div className="text-sm text-gray-600">총 파트너 수</div>
          </div>

          <div className="text-center p-4 bg-yellow-50 rounded-lg border border-yellow-100">
            <div className="text-3xl font-bold text-yellow-600 mb-1">
              {achievement.vStage}
            </div>
            <div className="text-sm text-gray-600">V 단계</div>
          </div>

          <div className="text-center p-4 bg-orange-50 rounded-lg border border-orange-100">
            <div className="text-3xl font-bold text-orange-600 mb-1">
              {achievement.cStage}
            </div>
            <div className="text-sm text-gray-600">C 단계</div>
          </div>

          <div className="text-center p-4 bg-emerald-50 rounded-lg border border-emerald-100">
            <div className="text-3xl font-bold text-emerald-600 mb-1">
              {achievement.current}
            </div>
            <div className="text-sm text-gray-600">P 단계</div>
          </div>
        </div>

        {/* Detailed Partners List */}
        <div className="space-y-3">
          <h3 className="font-medium text-gray-800 border-b pb-2">파트너 상세 현황</h3>
          
          <div className="space-y-2">
            {partners.length > 0 ? (
              partners.map((partner, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${getStageColor(partner.stage)}`}>
                      {partner.stage || '-'}
                    </span>
                    <div>
                      <div className="font-medium text-gray-800">{partner.name}</div>
                      <div className="text-sm text-gray-500">{partner.specialty || '전문분야 미입력'}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-sm font-medium ${
                      partner.stage === 'P' ? 'text-emerald-600' :
                      partner.stage === 'C' ? 'text-orange-600' :
                      partner.stage === 'V' ? 'text-yellow-600' : 'text-gray-600'
                    }`}>
                      {getStageLabel(partner.stage)}
                    </div>
                    <div className="text-xs text-gray-500">{lastUpdate}</div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-gray-500">
                <Users className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                <p>아직 등록된 파트너가 없습니다.</p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 text-sm text-gray-600">
          마지막 업데이트: <span className="font-medium">{lastUpdate}</span>
        </div>
      </CardContent>
    </Card>
  );
}