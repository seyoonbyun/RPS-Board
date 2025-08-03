import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { ScoreboardData } from "@shared/schema";

export function useScoreboard(userId?: string) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const syncMutation = useMutation({
    mutationFn: async (userId: string) => {
      const response = await apiRequest("POST", `/api/sync/${userId}`);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "동기화 완료",
        description: "구글 시트와 동기화가 완료되었습니다.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "동기화 실패",
        description: error.message || "동기화에 실패했습니다",
        variant: "destructive",
      });
    },
  });

  const calculateAchievement = (scoreboardData?: ScoreboardData | null, userProfile?: any) => {
    let vStage = 0;
    let cStage = 0;
    let pStage = 0;
    let total = 0;

    // 구글 시트 프로필 데이터가 있으면 우선 사용
    if (userProfile) {
      const partners = [
        { name: userProfile.rpartner1, stage: userProfile.rpartner1Stage },
        { name: userProfile.rpartner2, stage: userProfile.rpartner2Stage },
        { name: userProfile.rpartner3, stage: userProfile.rpartner3Stage },
        { name: userProfile.rpartner4, stage: userProfile.rpartner4Stage },
      ];

      partners.forEach(partner => {
        if (partner.name && partner.name.trim()) {
          total++;
          if (partner.stage === 'V') vStage++;
          else if (partner.stage === 'C') cStage++;
          else if (partner.stage === 'P') pStage++;
        }
      });
    } else if (scoreboardData) {
      // 폴백으로 scoreboardData 사용
      for (let i = 1; i <= 4; i++) {
        const name = scoreboardData[`rpartner${i}` as keyof ScoreboardData] as string;
        const stage = scoreboardData[`rpartner${i}Stage` as keyof ScoreboardData] as string;

        if (name && name.trim()) {
          total++;
          if (stage === 'V') vStage++;
          else if (stage === 'C') cStage++;
          else if (stage === 'P') pStage++;
        }
      }
    }

    const percent = Math.min(100, Math.round((pStage / 4) * 100));
    const remaining = Math.max(0, 4 - pStage);

    return {
      current: pStage,
      percent,
      remaining,
      vStage,
      cStage,
      total,
    };
  };

  return {
    syncMutation,
    calculateAchievement,
  };
}