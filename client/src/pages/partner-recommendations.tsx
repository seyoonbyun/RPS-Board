import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { PartnerRecommendations } from '@/components/partner-recommendations';

export default function PartnerRecommendationsPage() {
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [, setLocation] = useLocation();

  useEffect(() => {
    // 로그인 화면은 'bni_user' 에 저장한다. 예전 키 'user' 만 읽어서 이 주소로 바로 들어오면 로그인으로 튕겼다.
    let parsedUser: { id: string; email: string } | null = null;
    try {
      const userData = localStorage.getItem('bni_user') ?? localStorage.getItem('user');
      parsedUser = userData ? JSON.parse(userData) : null;
    } catch {
      parsedUser = null;
    }
    if (parsedUser?.id) {
      setUser(parsedUser);
    } else {
      setLocation('/');
    }
  }, [setLocation]);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600">로딩 중...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow-sm p-6">
          <PartnerRecommendations userId={user.id} />
        </div>
      </div>
    </div>
  );
}