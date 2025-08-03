import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { ChangeHistory } from "@shared/schema";

interface ChangeNotificationProps {
  userId: string;
}

export default function ChangeNotification({ userId }: ChangeNotificationProps) {
  const { toast } = useToast();

  const { data: changes } = useQuery({
    queryKey: ["/api/changes", userId],
    enabled: !!userId,
    refetchInterval: 30000, // Check for changes every 30 seconds
  });

  // Show toast for recent changes (within last 5 minutes)
  const showRecentChanges = (changes: ChangeHistory[]) => {
    if (!changes || changes.length === 0) return;

    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

    const recentChanges = changes.filter(change => 
      new Date(change.timestamp!) > fiveMinutesAgo
    );

    recentChanges.forEach(change => {
      const timeString = new Date(change.timestamp!).toLocaleString('ko-KR');
      toast({
        title: "데이터 변경 알림",
        description: `${change.fieldName}이(가) "${change.oldValue || '빈 값'}"에서 "${change.newValue || '빈 값'}"(으)로 변경되었습니다. (${timeString})`,
        duration: 5000,
      });
    });
  };

  // Effect to show recent changes (would need useEffect in real implementation)
  // For now, this is a placeholder component structure

  return null;
}