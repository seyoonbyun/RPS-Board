import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Trash2, Users, AlertTriangle, Download, Upload, ArrowLeft, BarChart3 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface UserData {
  email: string;
  region: string;
  chapter: string;
  memberName: string;
  specialty: string;
  status: string;
  totalPartners: string;
  achievement: string;
}

export default function AdminPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [bulkEmails, setBulkEmails] = useState('');
  const [currentUser, setCurrentUser] = useState<{id: string, email: string} | null>(null);

  // 관리자 권한 확인
  // 관리자 권한 확인
  const { data: adminPermission, isLoading: isAdminLoading } = useQuery({
    queryKey: ["/api/admin/check-permission", currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return { isAdmin: false };
      const response = await fetch(`/api/admin/check-permission?email=${encodeURIComponent(currentUser.email)}`);
      if (!response.ok) {
        return { isAdmin: false };
      }
      return response.json();
    },
    enabled: !!currentUser?.email,
    staleTime: 60000, // 1분간 캐시
  });

  useEffect(() => {
    const savedUser = localStorage.getItem("bni_user");
    if (!savedUser) {
      setLocation("/");
      return;
    }
    
    const user = JSON.parse(savedUser);
    setCurrentUser(user);
  }, [setLocation]);

  // 권한 확인 후 리다이렉트
  useEffect(() => {
    if (currentUser && adminPermission !== undefined && !adminPermission.isAdmin) {
      setLocation("/dashboard");
      toast({
        title: "접근 거부",
        description: "관리자 권한이 필요합니다.",
        variant: "destructive"
      });
    }
  }, [currentUser, adminPermission, setLocation, toast]);

  // 전체 사용자 목록 조회 - Hook은 항상 조건문 이전에 호출
  const { data: allUsers, isLoading } = useQuery<UserData[]>({
    queryKey: ['/api/admin/users'],
    retry: false,
    enabled: !!currentUser && !!adminPermission?.isAdmin, // 권한이 있을 때만 쿼리 실행
  });

  // 일괄 탈퇴 처리 mutation
  const bulkWithdrawalMutation = useMutation({
    mutationFn: async (userEmails: string[]) => {
      const response = await apiRequest('POST', '/api/admin/bulk-withdrawal', { userEmails });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: '일괄 탈퇴 처리 완료',
        description: `${data.processedCount}명의 사용자가 탈퇴 처리되었습니다.`,
        duration: 5000
      });
      setSelectedUsers([]);
      setBulkEmails('');
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
    },
    onError: (error: any) => {
      toast({
        title: '일괄 탈퇴 처리 실패',
        description: error.message || '처리 중 오류가 발생했습니다.',
        variant: 'destructive',
        duration: 5000
      });
    },
  });

  // 권한 확인 중이거나 권한이 없으면 로딩 또는 리다이렉트
  if (!currentUser || isAdminLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-red-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">권한을 확인하는 중...</p>
        </div>
      </div>
    );
  }

  if (adminPermission && !adminPermission.isAdmin) {
    return null; // useEffect에서 리다이렉트 처리
  }

  const handleUserSelection = (email: string, checked: boolean) => {
    if (checked) {
      setSelectedUsers(prev => [...prev, email]);
    } else {
      setSelectedUsers(prev => prev.filter(e => e !== email));
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const activeUsers = allUsers?.filter(user => user.status !== '탈퇴').map(user => user.email) || [];
      setSelectedUsers(activeUsers);
    } else {
      setSelectedUsers([]);
    }
  };

  const handleBulkEmailsSubmit = () => {
    const emailList = bulkEmails
      .split('\n')
      .map(email => email.trim())
      .filter(email => email && email.includes('@'));
    
    if (emailList.length === 0) {
      toast({
        title: '이메일 입력 오류',
        description: '유효한 이메일을 입력해주세요.',
        variant: 'destructive'
      });
      return;
    }

    bulkWithdrawalMutation.mutate(emailList);
  };

  const handleSelectedUsersWithdrawal = () => {
    if (selectedUsers.length === 0) {
      toast({
        title: '선택 오류',
        description: '탈퇴 처리할 사용자를 선택해주세요.',
        variant: 'destructive'
      });
      return;
    }

    bulkWithdrawalMutation.mutate(selectedUsers);
  };

  const exportUserList = () => {
    if (!allUsers) return;

    const csvContent = [
      '이메일,지역,챕터,멤버명,전문분야,상태,총파트너수,달성률',
      ...allUsers.map(user => 
        `"${user.email}","${user.region || ''}","${user.chapter || ''}","${user.memberName || ''}","${user.specialty || ''}","${user.status}","${user.totalPartners}","${user.achievement}"`
      )
    ].join('\n');

    // BOM을 추가하여 Excel에서 한글이 제대로 표시되도록 함
    const BOM = '\uFEFF';
    const csvWithBOM = BOM + csvContent;

    const blob = new Blob([csvWithBOM], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `BNI_Korea_Users_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600 mx-auto mb-4"></div>
          <p className="text-gray-600">사용자 목록을 불러오는 중...</p>
        </div>
      </div>
    );
  }

  const activeUsers = allUsers?.filter(user => user.status !== '탈퇴') || [];
  const withdrawnUsers = allUsers?.filter(user => user.status === '탈퇴') || [];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-red-600 rounded-full flex items-center justify-center mr-3">
                <Users className="text-white w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-red-600">BNI Korea 관리자 패널</h1>
                <span className="text-sm text-gray-500">사용자 관리 및 일괄 탈퇴 처리</span>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLocation('/dashboard')}
                className="text-gray-600 border-gray-300 hover:bg-gray-50"
              >
                <ArrowLeft className="mr-1 w-4 h-4" />
                대시보드로 돌아가기
              </Button>
              <Button onClick={exportUserList} variant="outline" size="sm">
                <Download className="mr-2 w-4 h-4" />
                사용자 목록 내보내기
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">

      {/* 통계 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <Users className="h-8 w-8 text-blue-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">전체 사용자</p>
                <p className="text-2xl font-bold text-gray-900">{allUsers?.length || 0}명</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <Users className="h-8 w-8 text-green-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">활동 중</p>
                <p className="text-2xl font-bold text-gray-900">{activeUsers.length}명</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <AlertTriangle className="h-8 w-8 text-red-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">탈퇴 처리됨</p>
                <p className="text-2xl font-bold text-gray-900">{withdrawnUsers.length}명</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 일괄 탈퇴 처리 섹션 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Trash2 className="mr-2 w-5 h-5 text-red-600" />
            일괄 탈퇴 처리
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 방법 1: 이메일 직접 입력 */}
          <div>
            <h3 className="text-lg font-medium mb-3">방법 1: 이메일 직접 입력</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  탈퇴 처리할 이메일 목록 (한 줄에 하나씩)
                </label>
                <textarea
                  value={bulkEmails}
                  onChange={(e) => setBulkEmails(e.target.value)}
                  placeholder="user1@example.com&#10;user2@example.com&#10;user3@example.com"
                  className="w-full h-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button 
                    variant="destructive" 
                    disabled={!bulkEmails.trim() || bulkWithdrawalMutation.isPending}
                  >
                    <Upload className="mr-2 w-4 h-4" />
                    이메일 목록으로 일괄 탈퇴 처리
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="alert-dialog-content">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="alert-dialog-title">일괄 탈퇴 처리 확인</AlertDialogTitle>
                    <AlertDialogDescription className="alert-dialog-description">
                      입력한 이메일 목록의 모든 사용자를 탈퇴 처리하시겠습니까?
                      이 작업은 되돌릴 수 없습니다.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="alert-dialog-cancel">취소</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleBulkEmailsSubmit}
                      className="alert-dialog-action-destructive"
                    >
                      탈퇴 처리 실행
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          <Separator />

          {/* 방법 2: 사용자 목록에서 선택 */}
          <div>
            <h3 className="text-lg font-medium mb-3">방법 2: 사용자 목록에서 선택</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="select-all"
                    checked={selectedUsers.length === activeUsers.length && activeUsers.length > 0}
                    onCheckedChange={handleSelectAll}
                  />
                  <label htmlFor="select-all" className="text-sm font-medium">
                    전체 선택 ({selectedUsers.length}명 선택됨)
                  </label>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button 
                      variant="destructive" 
                      disabled={selectedUsers.length === 0 || bulkWithdrawalMutation.isPending}
                    >
                      <Trash2 className="mr-2 w-4 h-4" />
                      선택한 사용자 탈퇴 처리
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="alert-dialog-content">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="alert-dialog-title">선택한 사용자 탈퇴 처리</AlertDialogTitle>
                      <AlertDialogDescription className="alert-dialog-description">
                        선택한 {selectedUsers.length}명의 사용자를 탈퇴 처리하시겠습니까?
                        이 작업은 되돌릴 수 없습니다.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="alert-dialog-cancel">취소</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleSelectedUsersWithdrawal}
                        className="alert-dialog-action-destructive"
                      >
                        탈퇴 처리 실행
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>

              {/* 사용자 목록 테이블 */}
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-4 py-3 border-b">
                  <h4 className="font-medium text-gray-900">활동 중인 사용자 목록</h4>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  {activeUsers.map((user) => (
                    <div key={user.email} className="flex items-center px-4 py-3 border-b last:border-b-0 hover:bg-gray-50">
                      <Checkbox
                        checked={selectedUsers.includes(user.email)}
                        onCheckedChange={(checked) => handleUserSelection(user.email, checked as boolean)}
                        className="mr-3"
                      />
                      <div className="flex-1 grid grid-cols-1 md:grid-cols-6 gap-2 text-sm">
                        <div className="font-medium truncate" title={user.email}>{user.email}</div>
                        <div className="truncate" title={user.region}>{user.region}</div>
                        <div className="truncate" title={user.chapter}>{user.chapter}</div>
                        <div className="truncate" title={user.memberName}>{user.memberName}</div>
                        <div className="truncate" title={user.specialty}>{user.specialty}</div>
                        <div className="flex items-center space-x-2">
                          <Badge variant={user.status === '활동중' ? 'default' : 'secondary'}>
                            {user.status}
                          </Badge>
                          <span className="text-gray-500">{user.totalPartners}명</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 탈퇴된 사용자 목록 */}
      {withdrawnUsers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-red-600">탈퇴 처리된 사용자 목록</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-hidden">
              <div className="max-h-64 overflow-y-auto">
                {withdrawnUsers.map((user) => (
                  <div key={user.email} className="flex items-center px-4 py-3 border-b last:border-b-0 bg-red-50">
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-6 gap-2 text-sm">
                      <div className="font-medium text-red-700 truncate" title={user.email}>{user.email}</div>
                      <div className="text-red-600 truncate" title={user.region}>{user.region}</div>
                      <div className="text-red-600 truncate" title={user.chapter}>{user.chapter}</div>
                      <div className="text-red-600 truncate" title={user.memberName}>{user.memberName}</div>
                      <div className="text-red-600 truncate" title={user.specialty}>{user.specialty}</div>
                      <Badge variant="destructive">탈퇴</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
}