import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Trash2, Users, AlertTriangle, Download, Upload, ArrowLeft, BarChart3, Plus, UserPlus, FileText, UserX, UserCheck, ChevronDown } from 'lucide-react';
import { ObjectUploader } from '@/components/ObjectUploader';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  industry: string;
  company: string;
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
  
  // 이메일 유효성 검사 함수
  const isValidEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
  };

  // 벌크 이메일 유효성 검사
  const validateBulkEmails = () => {
    if (!bulkEmails.trim()) return { isValid: false, invalidEmails: [], validCount: 0 };
    
    const emailList = bulkEmails.trim().split('\n').map(email => email.trim()).filter(email => email);
    const invalidEmails = emailList.filter(email => !isValidEmail(email));
    const validCount = emailList.length - invalidEmails.length;
    
    return {
      isValid: emailList.length > 0 && invalidEmails.length === 0,
      invalidEmails,
      validCount,
      totalCount: emailList.length
    };
  };

  const emailValidation = validateBulkEmails();
  const [currentUser, setCurrentUser] = useState<{id: string, email: string} | null>(null);
  const [showAddUserDialog, setShowAddUserDialog] = useState(false);
  const [addMode, setAddMode] = useState<'single' | 'csv'>('single');
  const [regionFilter, setRegionFilter] = useState<string>('__all__');
  const [chapterFilter, setChapterFilter] = useState<string>('__all__');
  const [withdrawnRegionFilter, setWithdrawnRegionFilter] = useState<string>('__all__');
  const [withdrawnChapterFilter, setWithdrawnChapterFilter] = useState<string>('__all__');
  const [authDropdownOpen, setAuthDropdownOpen] = useState(false);
  const authDropdownRef = useRef<HTMLDivElement>(null);
  const [chapterDropdownOpen, setChapterDropdownOpen] = useState(false);
  const chapterDropdownRef = useRef<HTMLDivElement>(null);
  const [selectedWithdrawnUsers, setSelectedWithdrawnUsers] = useState<string[]>([]);
  const [newUser, setNewUser] = useState({
    email: '',
    region: '',
    chapter: '',
    memberName: '',
    industry: '',
    company: '',
    specialty: '',
    password: '',
    auth: ''
  });


  // 관리자 권한 확인
  const { data: adminPermission, isLoading: isAdminLoading } = useQuery({
    queryKey: ["/api/admin/check-permission", currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return { isAdmin: false, auth: null };
      const response = await fetch('/api/admin/check-permission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentUser.email })
      });
      if (!response.ok) {
        return { isAdmin: false, auth: null };
      }
      return response.json();
    },
    enabled: !!currentUser?.email,
    staleTime: 60000, // 1분간 캐시
  });

  // 챕터 목록 가져오기
  const { data: chapters = [], isLoading: isChaptersLoading } = useQuery({
    queryKey: ["/api/admin/chapters"],
    queryFn: async () => {
      const response = await fetch('/api/admin/chapters');
      if (!response.ok) {
        throw new Error('챕터 목록을 가져올 수 없습니다');
      }
      return response.json();
    },
    enabled: !!adminPermission?.isAdmin,
    staleTime: 300000, // 5분간 캐시
  });

  // 드롭다운 바깥 영역 클릭 감지
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (authDropdownRef.current && !authDropdownRef.current.contains(event.target as Node)) {
        setAuthDropdownOpen(false);
      }
      if (chapterDropdownRef.current && !chapterDropdownRef.current.contains(event.target as Node)) {
        setChapterDropdownOpen(false);
      }
    };

    if (authDropdownOpen || chapterDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [authDropdownOpen, chapterDropdownOpen]);

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
    queryFn: async () => {
      const timestamp = Date.now();
      const response = await fetch(`/api/admin/users?t=${timestamp}`, {
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      if (!response.ok) {
        throw new Error('사용자 목록을 가져올 수 없습니다');
      }
      return response.json();
    },
    retry: false,
    enabled: !!currentUser && !!adminPermission?.isAdmin, // 권한이 있을 때만 쿼리 실행
    staleTime: 0, // 항상 새로운 데이터 가져오기
    refetchInterval: 3000, // 3초마다 자동 새로고침
    refetchOnWindowFocus: true, // 윈도우 포커스 시 새로고침
    refetchOnMount: true // 마운트 시 새로고침
  });

  // 일괄 탈퇴 처리 mutation
  const bulkWithdrawalMutation = useMutation({
    mutationFn: async (userEmails: string[]) => {
      const response = await apiRequest('POST', '/api/admin/bulk-withdrawal', { userEmails });
      return response.json();
    },
    onSuccess: (data) => {
      if (data.processedCount === 0) {
        // Case 2: 탈퇴 대상이 없는 경우
        toast({
          title: '탈퇴 대상 없음',
          description: '이미 삭제되었거나 존재하지 않는 사용자입니다.',
          variant: 'destructive',
          duration: 5000
        });
      } else {
        // Case 1: 탈퇴 처리가 진행된 경우
        toast({
          title: '탈퇴 처리 완료',
          description: `선택한 멤버 탈퇴가 정상적으로 완료되었습니다. (${data.processedCount}명)`,
          duration: 3000
        });
      }
      setSelectedUsers([]);
      setBulkEmails('');
      // 탈퇴 처리 완료 후 모든 필터 초기화 (활성 멤버와 탈퇴된 멤버 모두)
      setRegionFilter('__all__');
      setChapterFilter('__all__');
      setWithdrawnRegionFilter('__all__');
      setWithdrawnChapterFilter('__all__');
      // 강제로 사용자 목록 다시 가져오기
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      queryClient.refetchQueries({ queryKey: ['/api/admin/users'] });
    },
    onError: (error: any) => {
      toast({
        title: '일괄 탈퇴 처리 실패',
        description: error.message || '처리 중 오류가 발생했습니다.',
        variant: 'destructive',
        duration: 3000
      });
    },
  });

  // 멤버 복원 mutation
  const restoreUsersMutation = useMutation({
    mutationFn: async (userEmails: string[]) => {
      const response = await apiRequest('POST', '/api/admin/restore-users', { userEmails });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: '멤버 복원 완료',
        description: `${data.restoredCount}명의 멤버가 복원되었습니다.`,
        duration: 3000
      });
      setSelectedWithdrawnUsers([]);
      // 멤버 복원 완료 후 탈퇴된 멤버 필터 초기화
      setWithdrawnRegionFilter('__all__');
      setWithdrawnChapterFilter('__all__');
      // 강제로 사용자 목록 다시 가져오기
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      queryClient.refetchQueries({ queryKey: ['/api/admin/users'] });
    },
    onError: (error: any) => {
      toast({
        title: '멤버 복원 실패',
        description: error.message || '복원 중 오류가 발생했습니다.',
        variant: 'destructive',
        duration: 3000
      });
    },
  });

  // 사용자 추가 관련 mutation
  const addUserMutation = useMutation({
    mutationFn: async (userData: typeof newUser) => {
      const response = await apiRequest('POST', '/api/admin/add-user', userData);
      return response.json();
    },
    onSuccess: (data) => {
      // 강제로 사용자 목록 다시 가져오기
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      queryClient.refetchQueries({ queryKey: ['/api/admin/users'] });
      setShowAddUserDialog(false);
      setNewUser({
        email: '',
        region: '',
        chapter: '',
        memberName: '',
        industry: '',
        company: '',
        specialty: '',
        password: '1234',
        auth: 'Member'
      });
      toast({
        title: "멤버 추가 완료",
        description: data.message,
        className: "bg-white text-gray-900",
        duration: 3000
      });
    },
    onError: (error: any) => {
      toast({
        title: "멤버 추가 오류",
        description: error.message || "멤버 추가 중 오류가 발생했습니다",
        variant: "destructive",
        className: "bg-white text-gray-900"
      });
    }
  });

  const bulkAddUserMutation = useMutation({
    mutationFn: async (users: any[]) => {
      const response = await apiRequest('POST', '/api/admin/bulk-add-users', { users });
      return response.json();
    },
    onSuccess: (data) => {
      // 강제로 사용자 목록 다시 가져오기
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      queryClient.refetchQueries({ queryKey: ['/api/admin/users'] });
      setShowAddUserDialog(false);
      
      const hasErrors = data.errors && data.errors.length > 0;
      const title = hasErrors 
        ? `멤버 일괄 추가 오류 : ${data.processedCount}명 추가 (${data.errors.length}명 오류)`
        : `멤버 일괄 추가 성공 : ${data.processedCount}명 추가`;
      
      const description = hasErrors
        ? "이미 존재하는 멤버이거나 잘못된 양식의 파일입니다."
        : "새로운 멤버의 시트 생성이 완료되었습니다 !";
      
      toast({
        title,
        description,
        className: "bg-white text-gray-900"
      });
    },
    onError: (error: any) => {
      toast({
        title: "일괄 멤버 추가 오류",
        description: error.message || "일괄 멤버 추가 중 오류가 발생했습니다",
        variant: "destructive",
        className: "bg-white text-gray-900"
      });
    }
  });

  // CSV 파일 업로드 처리
  const csvProcessMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const response = await fetch('/api/csv/process', {
        method: 'POST',
        body: formData
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'CSV 파일 처리 실패');
      }
      return await response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      
      const hasErrors = data.errors && data.errors.length > 0;
      const title = data.message; // 서버에서 온 메시지 그대로 사용
      const description = hasErrors
        ? "이미 존재하는 멤버이거나 잘못된 양식의 파일입니다."
        : "새로운 멤버의 시트 생성이 완료되었습니다 !";
      
      toast({
        title,
        description,
        className: "bg-white text-gray-900"
      });
    },
    onError: (error: any) => {
      toast({
        title: "CSV 파일 처리 오류",
        description: error.message || "CSV 파일 처리 중 오류가 발생했습니다",
        variant: "destructive",
        className: "bg-white text-gray-900"
      });
    }
  });

  // CSV 파일 선택 완료 처리
  const handleCSVFileSelected = (file: File) => {
    // 파일을 FormData로 변환해서 서버로 전송
    const formData = new FormData();
    formData.append('file', file);
    
    csvProcessMutation.mutate(formData);
  };

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
      // 필터링된 활동중인 사용자들만 선택
      const filteredEmails = filteredActiveUsers.map(user => user.email);
      setSelectedUsers(prev => {
        // 기존 선택된 사용자 + 필터링된 사용자들을 합치되, 중복 제거
        const combined = [...prev, ...filteredEmails];
        return Array.from(new Set(combined));
      });
    } else {
      // 필터링된 사용자들만 선택 해제
      const filteredEmails = filteredActiveUsers.map(user => user.email);
      setSelectedUsers(prev => prev.filter(email => !filteredEmails.includes(email)));
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
      '이메일,지역,챕터,멤버명,산업군,회사,전문분야,상태,총파트너수,달성률',
      ...allUsers.map(user => 
        `"${user.email}","${user.region || ''}","${user.chapter || ''}","${user.memberName || ''}","${user.industry || ''}","${user.company || ''}","${user.specialty || ''}","${user.status}","${user.totalPartners}","${user.achievement}"`
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

  const downloadCSVTemplate = () => {
    const csvContent = [
      'ID_BNI커넥트 등록 이메일,지역,챕터,멤버명,산업군,회사,전문분야,권한,PW_H.P. 뒷 4자리',
      'example@test.com,서울,테스트챕터,홍길동,IT,테스트회사,개발자,Member,1234'
    ].join('\n');

    // BOM을 추가하여 Excel에서 한글이 제대로 표시되도록 함
    const BOM = '\uFEFF';
    const csvWithBOM = BOM + csvContent;

    const blob = new Blob([csvWithBOM], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'CSV_템플릿_멤버추가.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleAddUser = () => {
    if (!newUser.email || !newUser.memberName || !newUser.region || !newUser.chapter || !newUser.specialty || !newUser.password || !newUser.auth) {
      toast({
        title: "입력 오류",
        description: "모든 항목은 필수 입력 사항입니다",
        variant: "destructive",
        className: "bg-white text-gray-900"
      });
      return;
    }
    addUserMutation.mutate(newUser);
  };

  // 탈퇴된 멤버 선택 관련 핸들러
  const handleWithdrawnUserSelection = (email: string, checked: boolean) => {
    if (checked) {
      setSelectedWithdrawnUsers(prev => [...prev, email]);
    } else {
      setSelectedWithdrawnUsers(prev => prev.filter(e => e !== email));
    }
  };

  const handleSelectAllWithdrawnUsers = (checked: boolean | string) => {
    if (checked) {
      // 현재 필터링된 탈퇴 사용자들을 모두 선택
      const filteredEmails = filteredWithdrawnUsers.map(user => user.email);
      setSelectedWithdrawnUsers(prev => {
        const combined = [...prev, ...filteredEmails];
        return Array.from(new Set(combined));
      });
    } else {
      // 필터링된 사용자들만 선택 해제
      const filteredEmails = filteredWithdrawnUsers.map(user => user.email);
      setSelectedWithdrawnUsers(prev => prev.filter(email => !filteredEmails.includes(email)));
    }
  };

  const handleSelectedUsersRestore = () => {
    if (selectedWithdrawnUsers.length === 0) {
      toast({
        title: '선택 오류',
        description: '복원할 멤버를 선택해주세요.',
        variant: 'destructive'
      });
      return;
    }

    restoreUsersMutation.mutate(selectedWithdrawnUsers);
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
  
  // 필터링된 활성 사용자 목록
  const filteredActiveUsers = activeUsers.filter(user => {
    const regionMatch = regionFilter === '__all__' || user.region === regionFilter;
    const chapterMatch = chapterFilter === '__all__' || user.chapter === chapterFilter;
    return regionMatch && chapterMatch;
  });
  
  // 필터링된 탈퇴 사용자 목록
  const filteredWithdrawnUsers = withdrawnUsers.filter(user => {
    const regionMatch = withdrawnRegionFilter === '__all__' || user.region === withdrawnRegionFilter;
    const chapterMatch = withdrawnChapterFilter === '__all__' || user.chapter === withdrawnChapterFilter;
    return regionMatch && chapterMatch;
  });
  
  // 고유한 지역 및 챕터 목록 생성 (활성 사용자용)
  const uniqueRegions = Array.from(new Set(activeUsers.map(user => user.region).filter(region => region && region.trim() !== ''))).sort();
  const uniqueChapters = Array.from(new Set(activeUsers.map(user => user.chapter).filter(chapter => chapter && chapter.trim() !== ''))).sort();
  
  // 고유한 지역 및 챕터 목록 생성 (탈퇴 사용자용)
  const withdrawnUniqueRegions = Array.from(new Set(withdrawnUsers.map(user => user.region).filter(region => region && region.trim() !== ''))).sort();
  const withdrawnUniqueChapters = Array.from(new Set(withdrawnUsers.map(user => user.chapter).filter(chapter => chapter && chapter.trim() !== ''))).sort();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* 데스크톱 레이아웃 */}
          <div className="hidden md:flex justify-between items-center py-4">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-red-600 rounded-full flex items-center justify-center mr-3">
                <Users className="text-white w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-red-600">BNI Korea 관리자 패널</h1>
                <span className="text-sm text-gray-500">파워팀 멤버 관리 (입회/탈퇴)</span>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <Button 
                onClick={() => setShowAddUserDialog(true)}
                className="bg-red-600 hover:bg-white hover:text-red-600 text-white border border-red-600"
                size="sm"
              >
                <Plus className="w-4 h-4 mr-2" />
                멤버 추가하기
              </Button>
              {adminPermission?.auth === 'National' && (
                <Button 
                  onClick={exportUserList} 
                  variant="outline" 
                  size="sm"
                  className="border-gray-300 text-gray-700 hover:bg-red-600 hover:text-white hover:border-red-600"
                >
                  <Download className="mr-2 w-4 h-4" />
                  RPS 목록 내보내기
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLocation('/dashboard')}
                className="text-gray-600 border-gray-300 hover:bg-red-600 hover:text-white hover:border-red-600"
              >
                <ArrowLeft className="mr-1 w-4 h-4" />
                대시보드로 돌아가기
              </Button>
            </div>
          </div>

          {/* 모바일 레이아웃 */}
          <div className="md:hidden py-4">
            {/* 타이틀과 서브텍스트 - 맨 위 */}
            <div className="flex items-center mb-4">
              <div className="w-10 h-10 bg-red-600 rounded-full flex items-center justify-center mr-3">
                <Users className="text-white w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-red-600">BNI Korea 관리자 패널</h1>
                <span className="text-sm text-gray-500">파워팀 멤버 관리 (입회/탈퇴)</span>
              </div>
            </div>

            {/* 버튼들 - 아래에 수직 배치 */}
            <div className="space-y-2">
              <Button 
                onClick={() => setShowAddUserDialog(true)}
                className="bg-red-600 hover:bg-white hover:text-red-600 text-white border border-red-600 w-full"
                size="sm"
              >
                <Plus className="w-4 h-4 mr-2" />
                멤버 추가하기
              </Button>
              <div className="flex gap-2">
                {adminPermission?.auth === 'National' && (
                  <Button 
                    onClick={exportUserList} 
                    variant="outline" 
                    size="sm"
                    className="border-gray-300 text-gray-700 hover:bg-red-600 hover:text-white hover:border-red-600 flex-1"
                  >
                    <Download className="mr-1 w-4 h-4" />
                    RPS 목록 내보내기
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLocation('/dashboard')}
                  className="text-gray-600 border-gray-300 hover:bg-red-600 hover:text-white hover:border-red-600 flex-1"
                >
                  <ArrowLeft className="mr-1 w-4 h-4" />
                  대시보드로 돌아가기
                </Button>
              </div>
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
                <p className="text-sm font-medium text-gray-600">멤버 ALL (탈퇴 포함)</p>
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
                <p className="text-sm font-medium text-gray-600">활동중</p>
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
            멤버 탈퇴 처리
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 방법 1: ID(이메일) 직접 입력 */}
          <div>
            <h3 className="text-lg font-medium mb-3">방법 1: ID(이메일) 직접 입력</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  탈퇴 처리할 이메일 목록 (한 줄에 하나씩)
                </label>
                <textarea
                  value={bulkEmails}
                  onChange={(e) => setBulkEmails(e.target.value)}
                  placeholder="member1@example.com&#10;member2@example.com&#10;member3@example.com"
                  className={`admin-email-textarea w-full h-32 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 placeholder:text-gray-500 ${
                    bulkEmails.trim() && !emailValidation.isValid 
                      ? 'border-red-300 focus:ring-red-500 focus:border-red-500' 
                      : 'border-gray-300 focus:ring-red-500'
                  }`}
                />
                
                {/* 유효성 검사 메시지 */}
                {bulkEmails.trim() && (
                  <div className="mt-2">
                    {emailValidation.isValid ? (
                      <div className="flex items-center text-sm text-green-600">
                        <svg className="w-4 h-4 mr-1 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        유효한 이메일 {emailValidation.validCount}개가 입력되었습니다.
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <div className="flex items-center text-sm text-red-600">
                          <svg className="w-4 h-4 mr-1 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                          올바른 이메일 형식으로 입력해주세요 (예: user@example.com)
                        </div>
                        {emailValidation.invalidEmails.length > 0 && (
                          <div className="text-xs text-red-500 pl-5">
                            잘못된 형식: {emailValidation.invalidEmails.join(', ')}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button 
                    variant="destructive" 
                    disabled={!emailValidation.isValid || bulkWithdrawalMutation.isPending}
                    className="bg-red-600 hover:bg-white hover:text-red-600 hover:border hover:border-red-600 text-white disabled:bg-gray-300 disabled:text-gray-500 disabled:border-gray-300 disabled:cursor-not-allowed w-full md:w-auto"
                  >
                    <Upload className="mr-2 w-4 h-4" />
                    이메일 목록으로 일괄 탈퇴 처리
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="alert-dialog-content">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="alert-dialog-title">일괄 탈퇴 진행</AlertDialogTitle>
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
                      탈퇴 처리 계속하기
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          <Separator />

          {/* 방법 2: 멤버 목록에서 선택 */}
          <div>
            <h3 className="text-lg font-medium mb-3">방법 2: 멤버 목록에서 선택</h3>
            <div className="space-y-3">
              <div className="flex justify-end">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button 
                      variant="destructive" 
                      disabled={selectedUsers.length === 0 || bulkWithdrawalMutation.isPending}
                      className="bg-red-600 hover:bg-white hover:text-red-600 hover:border hover:border-red-600 text-white disabled:bg-gray-300 disabled:text-gray-500 disabled:border-gray-300 disabled:cursor-not-allowed w-full md:w-auto"
                    >
                      <Trash2 className="mr-2 w-4 h-4" />
                      선택한 멤버 탈퇴 처리
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="alert-dialog-content">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="alert-dialog-title">선택한 멤버 탈퇴 처리</AlertDialogTitle>
                      <AlertDialogDescription className="alert-dialog-description">
                        선택한 {selectedUsers.length}명의 멤버를 탈퇴 처리 하시겠습니까?
                        <br />이 작업은 되돌릴 수 없습니다.
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

              {/* 필터링 옵션 */}
              <div className="flex flex-wrap gap-4 p-4 bg-gray-50 rounded-lg border">
                <div className="flex items-center space-x-2 w-full md:w-auto">
                  <label className="text-sm font-medium text-gray-700 whitespace-nowrap">지역:</label>
                  <div className="relative flex-1 md:w-40">
                    <Select value={regionFilter} onValueChange={setRegionFilter}>
                      <SelectTrigger className="w-full bg-white pr-8">
                        <SelectValue placeholder="전체" />
                      </SelectTrigger>
                      <SelectContent className="bg-white">
                        <SelectItem value="__all__">선택</SelectItem>
                        {uniqueRegions.map(region => (
                          <SelectItem key={region} value={region}>{region}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {regionFilter !== '__all__' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setRegionFilter('__all__')}
                        className="absolute -top-2 -right-2 h-5 w-5 p-0 text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-full bg-white border border-gray-200"
                      >
                        ✕
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex items-center space-x-2 w-full md:w-auto">
                  <label className="text-sm font-medium text-gray-700 whitespace-nowrap">챕터:</label>
                  <div className="relative flex-1 md:w-40">
                    <Select value={chapterFilter} onValueChange={setChapterFilter}>
                      <SelectTrigger className="w-full bg-white pr-8">
                        <SelectValue placeholder="전체" />
                      </SelectTrigger>
                      <SelectContent className="bg-white">
                        <SelectItem value="__all__">선택</SelectItem>
                        {uniqueChapters.map(chapter => (
                          <SelectItem key={chapter} value={chapter}>{chapter}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {chapterFilter !== '__all__' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setChapterFilter('__all__')}
                        className="absolute -top-2 -right-2 h-5 w-5 p-0 text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-full bg-white border border-gray-200"
                      >
                        ✕
                      </Button>
                    )}
                  </div>
                </div>
                {(regionFilter !== '__all__' || chapterFilter !== '__all__') && (
                  <div className="flex items-center w-full md:w-auto">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setRegionFilter('__all__');
                        setChapterFilter('__all__');
                      }}
                      className="h-8 px-3 text-xs text-gray-600 border-gray-300 hover:bg-red-50 hover:text-red-600 hover:border-red-300 w-full md:w-auto"
                    >
                      모든 필터 해제
                    </Button>
                  </div>
                )}
              </div>

              {/* 멤버 목록 안내 메시지 */}
              {regionFilter === '__all__' && chapterFilter === '__all__' && (
                <div className="border rounded-lg p-8 text-center bg-gray-50">
                  <div className="flex flex-col items-center space-y-3">
                    <Users className="w-12 h-12 text-gray-400" />
                    <div className="text-gray-700 font-medium">
                      멤버 목록을 보려면 필터를 선택하세요
                    </div>
                    <div className="text-gray-500 text-sm">
                      위의 필터에서 지역이나 챕터를 선택하면 해당 멤버 목록이 표시됩니다.
                    </div>
                  </div>
                </div>
              )}

              {/* 멤버 목록 테이블 - 필터 선택 시에만 표시 */}
              {(regionFilter !== '__all__' || chapterFilter !== '__all__') && (
                <div className="border rounded-lg overflow-hidden">
                  {/* 데스크탑 헤더 */}
                  <div className="hidden md:block bg-gray-50 px-4 py-3 border-b">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <h4 className="font-medium text-gray-900">활동중인 멤버 목록</h4>
                        <div className="text-sm text-gray-600">
                          총 {filteredActiveUsers.length}명 표시 (전체 {activeUsers.length}명 중)
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="select-all"
                          checked={filteredActiveUsers.length > 0 && filteredActiveUsers.every(user => selectedUsers.includes(user.email))}
                          onCheckedChange={handleSelectAll}
                        />
                        <label htmlFor="select-all" className="text-sm font-medium">
                          전체 선택 ({filteredActiveUsers.filter(user => selectedUsers.includes(user.email)).length}명 선택됨)
                        </label>
                      </div>
                    </div>
                  </div>
                  {/* 모바일 헤더 */}
                  <div className="md:hidden bg-gray-50 px-4 py-3 border-b">
                    <div className="space-y-3">
                      <h4 className="font-medium text-gray-900">활동중인 멤버 목록</h4>
                      <div className="text-sm text-gray-600">
                        총 {filteredActiveUsers.length}명 표시 (전체 {activeUsers.length}명 중)
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="select-all-mobile"
                          checked={filteredActiveUsers.length > 0 && filteredActiveUsers.every(user => selectedUsers.includes(user.email))}
                          onCheckedChange={handleSelectAll}
                        />
                        <label htmlFor="select-all-mobile" className="text-sm font-medium">
                          전체 선택 ({filteredActiveUsers.filter(user => selectedUsers.includes(user.email)).length}명 선택됨)
                        </label>
                      </div>
                    </div>
                  </div>
                  {/* 데스크탑 테이블 헤더 */}
                  <div className="hidden md:block bg-gray-100 py-2 border-b">
                    <div className="flex items-center">
                      <div className="w-[60px] flex-shrink-0"></div> {/* 체크박스 공간 */}
                      <div className="flex text-xs font-medium text-gray-600 uppercase tracking-wide">
                        <div className="w-[200px] text-left px-2">ID</div>
                        <div className="w-[120px] text-left px-2">지역</div>
                        <div className="w-[100px] text-left px-2">챕터</div>
                        <div className="w-[100px] text-left px-2">멤버명</div>
                        <div className="w-[100px] text-left px-2">산업군</div>
                        <div className="w-[100px] text-left px-2">회사</div>
                        <div className="w-[120px] text-left px-2">전문분야</div>
                        <div className="flex-1 text-left px-2">상태/파트너수</div>
                      </div>
                    </div>
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    {filteredActiveUsers.map((user) => (
                      <div key={user.email}>
                        {/* 데스크탑 테이블 행 */}
                        <div className="hidden md:flex items-center py-3 border-b last:border-b-0 hover:bg-gray-50">
                          <div className="w-[60px] flex-shrink-0 flex justify-center">
                            <Checkbox
                              checked={selectedUsers.includes(user.email)}
                              onCheckedChange={(checked) => handleUserSelection(user.email, checked as boolean)}
                            />
                          </div>
                          <div className="flex text-sm">
                            <div className="w-[200px] font-medium truncate text-left text-ellipsis overflow-hidden px-2" title={user.email}>{user.email}</div>
                            <div className="w-[120px] truncate text-left text-ellipsis overflow-hidden px-2" title={user.region}>{user.region}</div>
                            <div className="w-[100px] truncate text-left text-ellipsis overflow-hidden px-2" title={user.chapter}>{user.chapter}</div>
                            <div className="w-[100px] truncate text-left text-ellipsis overflow-hidden px-2" title={user.memberName}>{user.memberName}</div>
                            <div className="w-[100px] truncate text-left text-ellipsis overflow-hidden px-2" title={user.industry}>{user.industry}</div>
                            <div className="w-[100px] truncate text-left text-ellipsis overflow-hidden px-2" title={user.company}>{user.company}</div>
                            <div className="w-[120px] truncate text-left text-ellipsis overflow-hidden px-2" title={user.specialty}>{user.specialty}</div>
                            <div className="flex-1 flex items-center text-left space-x-1 px-2">
                              <Badge variant={user.status === '활동중' ? 'default' : 'secondary'} className="text-xs flex-shrink-0">
                                {user.status}
                              </Badge>
                              <span className="text-gray-500 text-xs flex-shrink-0">{user.totalPartners}명</span>
                            </div>
                          </div>
                        </div>
                        {/* 모바일 카드 레이아웃 */}
                        <div className="md:hidden border-b last:border-b-0 p-4 hover:bg-gray-50">
                          <div className="flex items-start space-x-3">
                            <Checkbox
                              checked={selectedUsers.includes(user.email)}
                              onCheckedChange={(checked) => handleUserSelection(user.email, checked as boolean)}
                              className="mt-1"
                            />
                            <div className="flex-1 space-y-1">
                              <div className="font-medium text-sm">{user.email}</div>
                              <div className="space-y-1 text-xs text-gray-600">
                                <div><span className="font-medium">지역:</span> {user.region}</div>
                                <div><span className="font-medium">챕터:</span> {user.chapter}</div>
                                <div><span className="font-medium">멤버:</span> {user.memberName}</div>
                                <div><span className="font-medium">회사:</span> {user.company}</div>
                                <div><span className="font-medium">전문분야:</span> {user.specialty}</div>
                              </div>
                              <div className="flex items-center space-x-2 pt-1">
                                <Badge variant={user.status === '활동중' ? 'default' : 'secondary'} className="text-xs">
                                  {user.status}
                                </Badge>
                                <span className="text-gray-500 text-xs">파트너 {user.totalPartners}명</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}


            </div>
          </div>
        </CardContent>
      </Card>

      {/* 탈퇴된 사용자 목록 */}
      {withdrawnUsers.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center space-x-2 mb-3">
              <UserX className="w-5 h-5 text-red-600" />
              <h3 className="text-lg font-medium">탈퇴 처리된 멤버 목록</h3>
            </div>
          </CardHeader>
          <CardContent>
            {/* 탈퇴 사용자 필터 */}
            <div className="flex flex-wrap gap-4 p-4 bg-gray-50 rounded-lg border mb-4">
              <div className="flex items-center space-x-2 w-full md:w-auto">
                <label className="text-sm font-medium text-gray-700 whitespace-nowrap">지역:</label>
                <div className="relative flex-1 md:w-40">
                  <Select value={withdrawnRegionFilter} onValueChange={setWithdrawnRegionFilter}>
                    <SelectTrigger className="w-full bg-white pr-8">
                      <SelectValue placeholder="전체" />
                    </SelectTrigger>
                    <SelectContent className="bg-white">
                      <SelectItem value="__all__">선택</SelectItem>
                      {withdrawnUniqueRegions.map((region) => (
                        <SelectItem key={region} value={region}>{region}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {withdrawnRegionFilter !== '__all__' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setWithdrawnRegionFilter('__all__')}
                      className="absolute -top-2 -right-2 h-5 w-5 p-0 text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-full bg-white border border-gray-200"
                    >
                      ✕
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex items-center space-x-2 w-full md:w-auto">
                <label className="text-sm font-medium text-gray-700 whitespace-nowrap">챕터:</label>
                <div className="relative flex-1 md:w-40">
                  <Select value={withdrawnChapterFilter} onValueChange={setWithdrawnChapterFilter}>
                    <SelectTrigger className="w-full bg-white pr-8">
                      <SelectValue placeholder="전체" />
                    </SelectTrigger>
                    <SelectContent className="bg-white">
                      <SelectItem value="__all__">선택</SelectItem>
                      {withdrawnUniqueChapters.map((chapter) => (
                        <SelectItem key={chapter} value={chapter}>{chapter}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {withdrawnChapterFilter !== '__all__' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setWithdrawnChapterFilter('__all__')}
                      className="absolute -top-2 -right-2 h-5 w-5 p-0 text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-full bg-white border border-gray-200"
                    >
                      ✕
                    </Button>
                  )}
                </div>
              </div>
              {(withdrawnRegionFilter !== '__all__' || withdrawnChapterFilter !== '__all__') && (
                <div className="flex items-center w-full md:w-auto">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setWithdrawnRegionFilter('__all__');
                      setWithdrawnChapterFilter('__all__');
                    }}
                    className="h-8 px-3 text-xs text-gray-600 border-gray-300 hover:bg-red-50 hover:text-red-600 hover:border-red-300 w-full md:w-auto"
                  >
                    모든 필터 해제
                  </Button>
                </div>
              )}
            </div>

            {/* 필터링된 결과 표시 */}
            {(withdrawnRegionFilter === '__all__' && withdrawnChapterFilter === '__all__') ? (
              <div className="border rounded-lg p-8 text-center bg-gray-50">
                <div className="flex flex-col items-center space-y-3">
                  <Users className="w-12 h-12 text-gray-400" />
                  <div className="text-gray-700 font-medium">
                    멤버 목록을 보려면 필터를 선택하세요
                  </div>
                  <div className="text-gray-500 text-sm">
                    위의 필터에서 지역이나 챕터를 선택하면 해당 멤버 목록이 표시됩니다.
                  </div>
                </div>
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                {/* 데스크탑 헤더 */}
                <div className="hidden md:block bg-gray-50 px-4 py-3 border-b">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <h4 className="font-medium text-gray-900">탈퇴 처리된 멤버 목록</h4>
                      <div className="text-sm text-gray-600">
                        총 {filteredWithdrawnUsers.length}명 표시 (전체 {withdrawnUsers.length}명 중)
                      </div>
                    </div>
                    <div className="flex items-center space-x-4">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="select-all-withdrawn"
                          checked={filteredWithdrawnUsers.length > 0 && filteredWithdrawnUsers.every(user => selectedWithdrawnUsers.includes(user.email))}
                          onCheckedChange={handleSelectAllWithdrawnUsers}
                        />
                        <label htmlFor="select-all-withdrawn" className="text-sm font-medium">
                          전체 선택 ({filteredWithdrawnUsers.filter(user => selectedWithdrawnUsers.includes(user.email)).length}명 선택됨)
                        </label>
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button 
                            variant="outline" 
                            disabled={selectedWithdrawnUsers.length === 0 || restoreUsersMutation.isPending}
                            className="bg-green-600 hover:bg-white hover:text-green-600 hover:border hover:border-green-600 text-white disabled:bg-gray-300 disabled:text-gray-500 disabled:border-gray-300 disabled:cursor-not-allowed"
                          >
                            <UserCheck className="mr-2 w-4 h-4" />
                            선택한 멤버 복원하기
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="alert-dialog-content">
                          <AlertDialogHeader>
                            <AlertDialogTitle className="alert-dialog-title">선택한 멤버 복원</AlertDialogTitle>
                            <AlertDialogDescription className="alert-dialog-description">
                              선택한 {selectedWithdrawnUsers.length}명의 멤버를 활동중 상태로 복원하시겠습니까?
                              이 작업으로 해당 멤버들이 다시 활성화됩니다.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="alert-dialog-cancel">취소</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={handleSelectedUsersRestore}
                              className="alert-dialog-action bg-green-600 hover:bg-green-700"
                            >
                              복원 실행
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </div>
                {/* 모바일 헤더 */}
                <div className="md:hidden bg-gray-50 px-4 py-3 border-b">
                  <div className="space-y-3">
                    <h4 className="font-medium text-gray-900">탈퇴 처리된 멤버 목록</h4>
                    <div className="text-sm text-gray-600">
                      총 {filteredWithdrawnUsers.length}명 표시 (전체 {withdrawnUsers.length}명 중)
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="select-all-withdrawn-mobile"
                        checked={filteredWithdrawnUsers.length > 0 && filteredWithdrawnUsers.every(user => selectedWithdrawnUsers.includes(user.email))}
                        onCheckedChange={handleSelectAllWithdrawnUsers}
                      />
                      <label htmlFor="select-all-withdrawn-mobile" className="text-sm font-medium">
                        전체 선택 ({filteredWithdrawnUsers.filter(user => selectedWithdrawnUsers.includes(user.email)).length}명 선택됨)
                      </label>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button 
                          variant="outline" 
                          disabled={selectedWithdrawnUsers.length === 0 || restoreUsersMutation.isPending}
                          className="w-full bg-green-600 hover:bg-white hover:text-green-600 hover:border hover:border-green-600 text-white disabled:bg-gray-300 disabled:text-gray-500 disabled:border-gray-300 disabled:cursor-not-allowed"
                        >
                          <UserCheck className="mr-2 w-4 h-4" />
                          선택한 멤버 복원하기
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="alert-dialog-content">
                        <AlertDialogHeader>
                          <AlertDialogTitle className="alert-dialog-title">선택한 멤버 복원</AlertDialogTitle>
                          <AlertDialogDescription className="alert-dialog-description">
                            선택한 {selectedWithdrawnUsers.length}명의 멤버를 활동중 상태로 복원하시겠습니까?
                            이 작업으로 해당 멤버들이 다시 활성화됩니다.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="alert-dialog-cancel">취소</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={handleSelectedUsersRestore}
                            className="alert-dialog-action bg-green-600 hover:bg-green-700"
                          >
                            복원 실행
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
                {/* 데스크탑 테이블 헤더 */}
                <div className="hidden md:block bg-gray-100 py-2 border-b">
                  <div className="flex items-center">
                    <div className="w-[60px] flex-shrink-0"></div> {/* 체크박스 공간 */}
                    <div className="flex text-xs font-medium text-gray-600 uppercase tracking-wide">
                      <div className="w-[200px] text-left px-2">ID</div>
                      <div className="w-[120px] text-left px-2">지역</div>
                      <div className="w-[100px] text-left px-2">챕터</div>
                      <div className="w-[100px] text-left px-2">멤버명</div>
                      <div className="w-[100px] text-left px-2">산업군</div>
                      <div className="w-[100px] text-left px-2">회사</div>
                      <div className="w-[120px] text-left px-2">전문분야</div>
                      <div className="flex-1 text-left px-2">상태/파트너수</div>
                    </div>
                  </div>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  {filteredWithdrawnUsers.map((user) => (
                    <div key={user.email}>
                      {/* 데스크탑 테이블 행 */}
                      <div className="hidden md:flex items-center py-3 border-b last:border-b-0 hover:bg-gray-50">
                        <div className="w-[60px] flex-shrink-0 flex justify-center">
                          <Checkbox
                            checked={selectedWithdrawnUsers.includes(user.email)}
                            onCheckedChange={(checked) => handleWithdrawnUserSelection(user.email, checked as boolean)}
                          />
                        </div>
                        <div className="flex text-sm">
                          <div className="w-[200px] font-medium truncate text-left text-ellipsis overflow-hidden px-2" title={user.email}>{user.email}</div>
                          <div className="w-[120px] truncate text-left text-ellipsis overflow-hidden px-2" title={user.region}>{user.region}</div>
                          <div className="w-[100px] truncate text-left text-ellipsis overflow-hidden px-2" title={user.chapter}>{user.chapter}</div>
                          <div className="w-[100px] truncate text-left text-ellipsis overflow-hidden px-2" title={user.memberName}>{user.memberName}</div>
                          <div className="w-[100px] truncate text-left text-ellipsis overflow-hidden px-2" title={user.industry}>{user.industry}</div>
                          <div className="w-[100px] truncate text-left text-ellipsis overflow-hidden px-2" title={user.company}>{user.company}</div>
                          <div className="w-[120px] truncate text-left text-ellipsis overflow-hidden px-2" title={user.specialty}>{user.specialty}</div>
                          <div className="flex-1 flex items-center text-left space-x-2 px-2">
                            <Badge variant="destructive" className="flex-shrink-0">탈퇴</Badge>
                            <span className="text-gray-500 flex-shrink-0">{user.totalPartners}명</span>
                          </div>
                        </div>
                      </div>
                      {/* 모바일 카드 레이아웃 */}
                      <div className="md:hidden border-b last:border-b-0 p-4 hover:bg-gray-50">
                        <div className="flex items-start space-x-3">
                          <Checkbox
                            checked={selectedWithdrawnUsers.includes(user.email)}
                            onCheckedChange={(checked) => handleWithdrawnUserSelection(user.email, checked as boolean)}
                            className="mt-1"
                          />
                          <div className="flex-1 space-y-1">
                            <div className="font-medium text-sm">{user.email}</div>
                            <div className="space-y-1 text-xs text-gray-600">
                              <div><span className="font-medium">지역:</span> {user.region}</div>
                              <div><span className="font-medium">챕터:</span> {user.chapter}</div>
                              <div><span className="font-medium">멤버:</span> {user.memberName}</div>
                              <div><span className="font-medium">회사:</span> {user.company}</div>
                              <div><span className="font-medium">전문분야:</span> {user.specialty}</div>
                            </div>
                            <div className="flex items-center space-x-2 pt-1">
                              <Badge variant="destructive" className="text-xs">탈퇴</Badge>
                              <span className="text-gray-500 text-xs">파트너 {user.totalPartners}명</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      </div>

      {/* 단일 사용자 추가 다이얼로그 */}
      <AlertDialog open={showAddUserDialog} onOpenChange={setShowAddUserDialog}>
        <AlertDialogContent className="max-w-6xl bg-white border border-gray-200 shadow-2xl admin-member-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>새로운 멤버 추가하기</AlertDialogTitle>
            <AlertDialogDescription>
              단일 멤버 추가 또는 CSV 파일로 일괄 추가할 수 있습니다.
              <br />
              <small className="text-gray-500">* 타겟고객(나의 핵심 고객층)은 멤버가 직접 입력하므로 관리자가 계정 생성 추가하는 정보에서 제외됩니다.</small>
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          <div className="space-y-6">
            {/* 탭 선택 */}
            <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg">
              <button
                onClick={() => setAddMode('single')}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                  addMode === 'single'
                    ? 'bg-red-600 text-white shadow border border-red-600'
                    : 'text-gray-600 hover:bg-white hover:text-red-600 hover:border hover:border-red-600'
                }`}
              >
                <Plus className="w-4 h-4 inline mr-2" />
                멤버 개별 추가
              </button>
              <button
                onClick={() => setAddMode('csv')}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                  addMode === 'csv'
                    ? 'bg-red-600 text-white shadow border border-red-600'
                    : 'text-gray-600 hover:bg-white hover:text-red-600 hover:border hover:border-red-600'
                }`}
              >
                <Plus className="w-4 h-4 inline mr-2" />
                일괄 등록
              </button>
            </div>

            {/* 개별 사용자 추가 폼 */}
            {addMode === 'single' && (
              <div className="bg-gray-50 p-4 rounded-lg space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">이메일 *</label>
                    <Input
                      placeholder="user@example.com"
                      value={newUser.email}
                      onChange={(e) => setNewUser({...newUser, email: e.target.value})}
                      className="bg-white border border-red-600 placeholder-gray-light admin-input-field"
                      style={{ "--placeholder-color": "rgb(107, 114, 128)" } as any}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">멤버명 *</label>
                    <Input
                      placeholder="홍길동"
                      value={newUser.memberName}
                      onChange={(e) => setNewUser({...newUser, memberName: e.target.value})}
                      className="bg-white border-gray-300 placeholder-gray-light"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">지역 *</label>
                    <Input
                      placeholder="서울"
                      value={newUser.region}
                      onChange={(e) => setNewUser({...newUser, region: e.target.value})}
                      className="bg-white border-gray-300 placeholder-gray-light"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">챕터 *</label>
                    <div className="relative" ref={chapterDropdownRef}>
                      <button
                        type="button"
                        onClick={() => setChapterDropdownOpen(!chapterDropdownOpen)}
                        className="flex h-10 w-full items-center justify-between rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2"
                      >
                        <span className={newUser.chapter ? 'text-gray-900' : 'text-gray-400'}>
                          {newUser.chapter || '챕터를 선택하세요'}
                        </span>
                        <ChevronDown className="h-4 w-4 opacity-50" />
                      </button>
                      {chapterDropdownOpen && (
                        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-y-auto">
                          {isChaptersLoading ? (
                            <div className="px-3 py-2 text-gray-500">챕터 목록을 불러오는 중...</div>
                          ) : chapters.length > 0 ? (
                            chapters.map((chapter: string) => (
                              <button
                                key={chapter}
                                type="button"
                                onClick={() => {
                                  setNewUser({...newUser, chapter});
                                  setChapterDropdownOpen(false);
                                }}
                                className="w-full px-3 py-2 text-left text-gray-900 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                              >
                                {chapter}
                              </button>
                            ))
                          ) : (
                            <div className="px-3 py-2 text-gray-500">챕터 목록이 없습니다</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">산업군 *</label>
                    <Input
                      placeholder="IT"
                      value={newUser.industry}
                      onChange={(e) => setNewUser({...newUser, industry: e.target.value})}
                      className="bg-white border-gray-300 placeholder-gray-light"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">회사 *</label>
                    <Input
                      placeholder="회사명"
                      value={newUser.company}
                      onChange={(e) => setNewUser({...newUser, company: e.target.value})}
                      className="bg-white border-gray-300 placeholder-gray-light"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">전문분야 *</label>
                    <Input
                      placeholder="디자인"
                      value={newUser.specialty}
                      onChange={(e) => setNewUser({...newUser, specialty: e.target.value})}
                      className="bg-white border-gray-300 placeholder-gray-light"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">비밀번호 (휴대전화 뒷 4자리) *</label>
                    <Input
                      placeholder="1234"
                      value={newUser.password}
                      onChange={(e) => setNewUser({...newUser, password: e.target.value})}
                      className="bg-white border-gray-300 placeholder:text-gray-400 text-gray-900"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">권한 *</label>
                  <div className="relative" ref={authDropdownRef}>
                    <button
                      type="button"
                      onClick={() => setAuthDropdownOpen(!authDropdownOpen)}
                      className="flex h-10 w-full items-center justify-between rounded-md border border-red-600 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2"
                    >
                      <span className={newUser.auth ? 'text-gray-900' : 'text-gray-400'}>
                        {newUser.auth ? 
                          (newUser.auth === 'Admin' ? 'Admin (관리자)' :
                           newUser.auth === 'Growth' ? 'Growth (성장팀)' :
                           newUser.auth === 'Member' ? 'Member (일반회원)' : newUser.auth) 
                          : '권한 지정하기'}
                      </span>
                      <ChevronDown className="h-4 w-4 opacity-50" />
                    </button>
                    {authDropdownOpen && (
                      <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg">
                        <div 
                          className="px-3 py-2 text-sm cursor-pointer hover:bg-red-600 hover:text-white transition-colors"
                          onClick={() => {
                            setNewUser({...newUser, auth: 'Admin'});
                            setAuthDropdownOpen(false);
                          }}
                        >
                          Admin (관리자)
                        </div>
                        <div 
                          className="px-3 py-2 text-sm cursor-pointer hover:bg-red-600 hover:text-white transition-colors"
                          onClick={() => {
                            setNewUser({...newUser, auth: 'Growth'});
                            setAuthDropdownOpen(false);
                          }}
                        >
                          Growth (성장팀)
                        </div>
                        <div 
                          className="px-3 py-2 text-sm cursor-pointer hover:bg-red-600 hover:text-white transition-colors"
                          onClick={() => {
                            setNewUser({...newUser, auth: 'Member'});
                            setAuthDropdownOpen(false);
                          }}
                        >
                          Member (일반회원)
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <Button 
                  onClick={handleAddUser}
                  disabled={addUserMutation.isPending}
                  className="w-full bg-red-600 hover:bg-white hover:text-red-600 hover:border hover:border-red-600 text-white"
                >
                  {addUserMutation.isPending ? "등록 중..." : "멤버 등록"}
                </Button>
              </div>
            )}

            {/* CSV 파일 업로드 섹션 */}
            {addMode === 'csv' && (
              <div className="bg-gray-50 p-4 rounded-lg space-y-4">
                <p className="text-sm text-red-800 mb-3">
                  하단의 '일괄 등록 양식의 CSV 파일을 업로드하시면, 새로운 멤버의 RPS Board가 생성됩니다.
                </p>
                <ObjectUploader
                  maxFileSize={5242880} // 5MB
                  onComplete={handleCSVFileSelected}
                  buttonClassName="w-full bg-red-600 hover:bg-white hover:text-red-600 hover:border hover:border-red-600 text-white mb-3"
                  allowedFileTypes={['.csv']}
                >
                  <FileText className="mr-2 w-4 h-4" />
                  CSV 파일 업로드
                </ObjectUploader>
                {csvProcessMutation.isPending && (
                  <div className="flex items-center text-red-600 mb-3">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-600 mr-2"></div>
                    CSV 파일 처리 중...
                  </div>
                )}
                
                {/* CSV 파일 형식 안내 */}
                <div className="bg-red-50 p-3 rounded border-l-4 border-red-400">
                  <p className="text-sm font-medium text-red-900 mb-2">CSV 파일 형식 안내</p>
                  <div className="text-xs text-red-700 space-y-1">
                    <p><strong>CSV 파일 형식 :</strong> 이메일 | 지역 | 챕터 | 멤버명 | 산업군 | 회사 | 전문분야 | 권한 | PW(숫자 4자리)</p>
                    <p>• 이메일 주소는 ID로 사용되며, BNI Connect 시스템에 등록된 정보와 동일합니다.</p>
                    <p>• PW는 BNI Connect 시스템에 등록된 멤버의 휴대전화 번호의 뒷 4자리(010-1234-****) 정보를 기본으로 합니다.</p>
                    <p>• 권한 : Admin(관리자) / Growth(성장팀) / Member(일반회원) 으로 총 3 단계로 구분되어 운영됩니다.</p>
                    <p>• 타겟고객(나의 핵심 고객층)은 멤버가 직접 설정하는 정보로, 관리자가 계정 생성 시 추가하는 정보에서 제외됩니다.</p>
                    <p>• 첫 번째 행은 헤더이므로, 두 번째 행부터 사용자 정보를 입력하세요.</p>
                  </div>
                  <div className="mt-3 pt-2 border-t border-red-200">
                    <button 
                      onClick={downloadCSVTemplate}
                      className="inline-flex items-center text-xs text-red-600 hover:text-red-800 hover:underline bg-transparent border-none cursor-pointer"
                    >
                      <Download className="w-3 h-3 mr-1" />
                      CSV 템플릿 파일 다운로드
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          
          <AlertDialogFooter>
            <AlertDialogCancel className="border border-red-600 text-red-600 hover:bg-red-50">취소</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


    </div>
  );
}