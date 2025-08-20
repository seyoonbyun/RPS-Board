import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { PartnerRecommendations } from '@/components/partner-recommendations';

export default function PartnerRecommendationsPage() {
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [, setLocation] = useLocation();

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      const parsedUser = JSON.parse(userData);
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