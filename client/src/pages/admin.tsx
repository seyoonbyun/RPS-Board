import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CACHE_CONFIG, FILE_CONFIG } from '@shared/constants';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Trash2, Users, AlertTriangle, Download, Upload, ArrowLeft, BarChart3, Plus, UserPlus, FileText, UserX, UserCheck, ChevronDown, UserMinus, Edit3, Search } from 'lucide-react';
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

function BoardWidget({ currentUser, adminPermission, boardSearch }: any) {
  const [newContent, setNewContent] = useState('');
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');
  const queryClient = useQueryClient();
  const isMaster = adminPermission?.auth === 'National';

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["/api/admin/board"],
    queryFn: async () => {
      const resp = await fetch('/api/admin/board');
      if (!resp.ok) return [];
      return resp.json();
    },
    refetchInterval: 30000,
  });

  const { data: masterNotices = [] } = useQuery({
    queryKey: ["/api/admin/master-notices"],
    queryFn: async () => {
      const resp = await fetch('/api/admin/master-notices');
      if (!resp.ok) return [];
      return resp.json();
    },
    refetchInterval: 30000,
  });

  const allQuestions = posts.filter((p: any) => p.type === '요청');
  const questions = boardSearch.trim()
    ? allQuestions.filter((q: any) => q.content?.toLowerCase().includes(boardSearch.toLowerCase()) || q.name?.toLowerCase().includes(boardSearch.toLowerCase()))
    : allQuestions;
  const replies = posts.filter((p: any) => p.type === '답변');

  const submitPost = async () => {
    if (!newContent.trim()) return;
    await fetch('/api/admin/board', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: currentUser?.email, name: currentUser?.email?.split('@')[0], role: adminPermission?.auth || 'Admin', content: newContent.trim() })
    });
    setNewContent('');
    queryClient.invalidateQueries({ queryKey: ['/api/admin/board'] });
  };

  const deletePost = async (rowIndex: number) => {
    if (!confirm('이 글을 삭제하시겠습니까?')) return;
    await fetch('/api/admin/board/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowIndex })
    });
    queryClient.invalidateQueries({ queryKey: ['/api/admin/board'] });
  };

  const updatePost = async (rowIndex: number) => {
    if (!editContent.trim()) return;
    await fetch('/api/admin/board/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowIndex, content: editContent.trim() })
    });
    setEditingIndex(null);
    setEditContent('');
    queryClient.invalidateQueries({ queryKey: ['/api/admin/board'] });
  };

  const submitReply = async (parentIndex: number) => {
    if (!replyContent.trim()) return;
    await fetch('/api/admin/board/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: currentUser?.email, name: currentUser?.email?.split('@')[0], role: adminPermission?.auth || 'Admin', content: replyContent.trim(), parentIndex })
    });
    setReplyContent('');
    setReplyTo(null);
    queryClient.invalidateQueries({ queryKey: ['/api/admin/board'] });
  };

  const renderContent = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    return parts.map((part, i) =>
      urlRegex.test(part) ? (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-all">{part}</a>
      ) : (
        <span key={i}>{part}</span>
      )
    );
  };

  return (
    <div className="flex flex-col flex-1">
      <div className="flex-1 overflow-y-auto max-h-[200px] divide-y divide-gray-100">
        {isLoading ? (
          <div className="p-4 text-center text-gray-400 text-xs">불러오는 중...</div>
        ) : (masterNotices.length === 0 && questions.length === 0) ? (
          <div className="p-4 text-center text-gray-400 text-xs py-6">등록된 글이 없습니다</div>
        ) : (<>
          {/* 마스터 공지 (MasterLog 시트에서 읽기, 상단 고정) */}
          {masterNotices.slice().reverse().map((n: any, i: number) => (
            <div key={`notice-${i}`} className="p-3 bg-red-50 border-b border-red-100">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] bg-red-600 text-white px-1.5 py-0.5 rounded font-semibold">공지</span>
                <span className="text-[10px] text-gray-400">{n.timestamp}</span>
              </div>
              <p className="text-xs text-gray-900 font-medium">{renderContent(n.content)}</p>
            </div>
          ))}
          {/* 어드민 요청 글 */}
          {questions.slice().reverse().map((q: any) => {
            const qReplies = replies.filter((r: any) => String(r.parentIndex) === String(q.index));
            return (
              <div key={q.index} className="p-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-gray-900">{q.name}</span>
                      <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded">{q.role}</span>
                      <span className="text-[10px] text-gray-400">{q.timestamp}</span>
                    </div>
                    {editingIndex === q.index ? (
                      <div className="flex gap-1 mt-1">
                        <input value={editContent} onChange={(e) => setEditContent(e.target.value)} className="flex-1 text-xs border border-gray-300 rounded px-2 py-1" onKeyDown={(e) => e.key === 'Enter' && updatePost(q.index)} />
                        <button onClick={() => updatePost(q.index)} className="text-[10px] bg-red-600 text-white px-2 py-1 rounded">저장</button>
                        <button onClick={() => setEditingIndex(null)} className="text-[10px] text-gray-500 px-1">취소</button>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-700">{renderContent(q.content)}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    {q.email === currentUser?.email && editingIndex !== q.index && (
                      <>
                        <button onClick={() => { setEditingIndex(q.index); setEditContent(q.content); }} className="text-gray-400 hover:text-gray-600 p-0.5"><Edit3 className="w-3 h-3" /></button>
                        <button onClick={() => deletePost(q.index)} className="text-gray-400 hover:text-red-600 p-0.5"><Trash2 className="w-3 h-3" /></button>
                      </>
                    )}
                    {isMaster && (
                      <button onClick={() => { setReplyTo(q.index); setReplyContent(''); }} className="text-[10px] text-red-600 hover:underline whitespace-nowrap">답변</button>
                    )}
                  </div>
                </div>
                {qReplies.map((r: any) => (
                  <div key={r.index} className="ml-4 mt-2 pl-3 border-l-2 border-red-200">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10px] font-semibold text-red-700">{r.name}</span>
                      <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">답변</span>
                      <span className="text-[10px] text-gray-400">{r.timestamp}</span>
                    </div>
                    <p className="text-xs text-gray-600">{renderContent(r.content)}</p>
                  </div>
                ))}
                {replyTo === q.index && (
                  <div className="ml-4 mt-2 flex gap-1">
                    <input value={replyContent} onChange={(e) => setReplyContent(e.target.value)} placeholder="답변 입력..." className="flex-1 text-xs border border-gray-300 rounded px-2 py-1" onKeyDown={(e) => e.key === 'Enter' && submitReply(q.index)} />
                    <button onClick={() => submitReply(q.index)} className="text-xs bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700">전송</button>
                    <button onClick={() => setReplyTo(null)} className="text-xs text-gray-500 px-1">취소</button>
                  </div>
                )}
              </div>
            );
          })}
          </>
        )}
      </div>
      <div className="p-3 border-t border-gray-100 flex gap-2">
        <input value={newContent} onChange={(e) => setNewContent(e.target.value)} placeholder="수정 건의 또는 질문을 입력하세요..." className="flex-1 text-xs border border-gray-300 rounded-md px-3 py-2" onKeyDown={(e) => e.key === 'Enter' && submitPost()} />
        <button onClick={submitPost} className="text-xs bg-red-600 text-white px-3 py-2 rounded-md hover:bg-red-700 whitespace-nowrap">등록</button>
      </div>
    </div>
  );
}

function AdminListBody({ currentUserEmail, queryClient, toast, apiRequest }: any) {
  const { data: admins = [], isLoading } = useQuery({
    queryKey: ["/api/admin/list-admins"],
    queryFn: async () => {
      const resp = await fetch('/api/admin/list-admins');
      if (!resp.ok) return [];
      return resp.json();
    },
  });

  const filteredAdmins = admins.filter((a: any) => {
    const auth = a.auth?.toLowerCase() || '';
    return auth === 'admin' || auth === 'master' || auth === 'national' || auth === 'growth';
  });

  if (isLoading) return <tbody><tr><td colSpan={5} className="px-3 py-4 text-center text-gray-400">불러오는 중...</td></tr></tbody>;

  return (
    <tbody>
      {filteredAdmins.length === 0 ? (
        <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-400">등록된 관리자가 없습니다</td></tr>
      ) : filteredAdmins.map((admin: any) => (
        <tr key={admin.email} className="border-t hover:bg-gray-50">
          <td className="px-3 py-2">{admin.memberName}</td>
          <td className="px-3 py-2 text-gray-600 text-xs">{admin.email}</td>
          <td className="px-3 py-2 text-gray-600 text-xs">{admin.region}</td>
          <td className="px-3 py-2"><span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">{admin.auth}</span></td>
          <td className="px-3 py-2 text-right">
            {admin.email.toLowerCase() !== currentUserEmail.toLowerCase() && (
              <button
                className="text-red-500 hover:text-red-700 p-1"
                onClick={async () => {
                  if (!confirm(`'${admin.memberName}' (${admin.email}) 관리자를 삭제하시겠습니까?`)) return;
                  try {
                    const resp = await apiRequest('DELETE', '/api/admin/delete-admin', {
                      email: admin.email,
                      adminEmail: currentUserEmail,
                    });
                    const data = await resp.json();
                    if (data.success) {
                      toast({ title: data.message });
                      queryClient.invalidateQueries({ queryKey: ['/api/admin/list-admins'] });
                    } else {
                      alert(data.message || '삭제 실패');
                    }
                  } catch (err: any) {
                    alert(err.message || '삭제 중 오류');
                  }
                }}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </td>
        </tr>
      ))}
    </tbody>
  );
}

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

interface WithdrawalHistoryItem {
  withdrawalTime: string;
  email: string;
  region: string;
  chapter: string;
  memberName: string;
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
  const [showAddChapterDialog, setShowAddChapterDialog] = useState(false);
  const [boardSearch, setBoardSearch] = useState('');
  const [newChapterName, setNewChapterName] = useState('');
  const [newChapterRegion, setNewChapterRegion] = useState('');
  const [addMode, setAddMode] = useState<'single' | 'csv'>('single');
  const [regionFilter, setRegionFilter] = useState<string>('__all__');
  const [chapterFilter, setChapterFilter] = useState<string>('__all__');
  // showWithdrawalHistory replaced by activeModal === 'history'
  const [historySearchTerm, setHistorySearchTerm] = useState("");
  const [historyRegionFilter, setHistoryRegionFilter] = useState("전체");
  const [historyChapterFilter, setHistoryChapterFilter] = useState("전체");
  const [memberNameSearch, setMemberNameSearch] = useState<string>('');
  const [withdrawnRegionFilter, setWithdrawnRegionFilter] = useState<string>('__all__');
  const [withdrawnChapterFilter, setWithdrawnChapterFilter] = useState<string>('__all__');
  const [chapterDropdownOpen, setChapterDropdownOpen] = useState(false);
  const chapterDropdownRef = useRef<HTMLDivElement>(null);
  const [regionDropdownOpen, setRegionDropdownOpen] = useState(false);
  const regionDropdownRef = useRef<HTMLDivElement>(null);
  const [authDropdownOpen, setAuthDropdownOpen] = useState(false);
  const authDropdownRef = useRef<HTMLDivElement>(null);
  const [selectedWithdrawnUsers, setSelectedWithdrawnUsers] = useState<string[]>([]);
  const [showWithdrawalProgress, setShowWithdrawalProgress] = useState(false);
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [withdrawalMethod, setWithdrawalMethod] = useState<'email' | 'list'>('list');
  const [editSearchTerm, setEditSearchTerm] = useState('');
  const [editingUser, setEditingUser] = useState<UserData | null>(null);
  const [editFormData, setEditFormData] = useState({
    region: '',
    chapter: '',
    memberName: '',
    industry: '',
    company: '',
    password: '',
    auth: 'Member'
  });
  const [newUser, setNewUser] = useState({
    email: '',
    region: '',
    chapter: '',
    memberName: '',
    industry: '',
    company: '',
    password: '',
    auth: 'Member'
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
    staleTime: CACHE_CONFIG.ADMIN_PERMISSION_STALE_TIME, // 1분간 캐시
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
    staleTime: CACHE_CONFIG.SHEETS_DATA_STALE_TIME, // 5분간 캐시
  });

  // 지역 목록 가져오기
  const { data: regions = [], isLoading: isRegionsLoading } = useQuery({
    queryKey: ["/api/admin/regions"],
    queryFn: async () => {
      const response = await fetch('/api/admin/regions');
      if (!response.ok) {
        throw new Error('지역 목록을 가져올 수 없습니다');
      }
      return response.json();
    },
    enabled: !!adminPermission?.isAdmin,
    staleTime: CACHE_CONFIG.SHEETS_DATA_STALE_TIME, // 5분간 캐시
  });

  // 탈퇴 히스토리 가져오기 - Google Sheets 삭제 즉시 반영을 위해 실시간 동기화
  const { data: withdrawalHistory = [], isLoading: isHistoryLoading, refetch: refetchHistory } = useQuery({
    queryKey: ["/api/admin/withdrawal-history"],
    queryFn: async () => {
      const response = await fetch('/api/admin/withdrawal-history', {
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      if (!response.ok) {
        throw new Error('탈퇴 히스토리를 가져올 수 없습니다');
      }
      return response.json();
    },
    enabled: !!adminPermission?.isAdmin, // 관리자 권한이 있으면 항상 로드
    staleTime: CACHE_CONFIG.NO_CACHE, // 캐시 없음 - Google Sheets 변경사항 즉시 반영
    refetchInterval: CACHE_CONFIG.ADMIN_REFRESH_INTERVAL, // 30초마다 자동 새로고침
  });

  // 드롭다운 바깥 영역 클릭 감지
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (chapterDropdownRef.current && !chapterDropdownRef.current.contains(event.target as Node)) {
        setChapterDropdownOpen(false);
      }
      if (regionDropdownRef.current && !regionDropdownRef.current.contains(event.target as Node)) {
        setRegionDropdownOpen(false);
      }
      if (authDropdownRef.current && !authDropdownRef.current.contains(event.target as Node)) {
        setAuthDropdownOpen(false);
      }
    };

    if (chapterDropdownOpen || regionDropdownOpen || authDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [chapterDropdownOpen, regionDropdownOpen, authDropdownOpen]);

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

  // 필터가 변경될 때마다 선택된 사용자 목록 초기화
  useEffect(() => {
    setSelectedUsers([]);
  }, [regionFilter, chapterFilter, memberNameSearch]);

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
    staleTime: CACHE_CONFIG.NO_CACHE, // 항상 새로운 데이터 가져오기
    refetchInterval: CACHE_CONFIG.FAST_REFRESH_INTERVAL, // 3초마다 자동 새로고침
    refetchOnWindowFocus: true, // 윈도우 포커스 시 새로고침
    refetchOnMount: true // 마운트 시 새로고침
  });

  // 일괄 탈퇴 처리 mutation
  const bulkWithdrawalMutation = useMutation({
    mutationFn: async (userEmails: string[]) => {
      const response = await apiRequest('POST', '/api/admin/bulk-withdrawal', { userEmails });
      return response.json();
    },
    onMutate: () => {
      // 탈퇴 처리 시작 시 진행중 팝업 표시
      setShowWithdrawalProgress(true);
    },
    onSuccess: (data) => {
      // 진행중 팝업 닫기
      setShowWithdrawalProgress(false);
      
      if (data.processedCount === 0) {
        // Case 2: 탈퇴 대상이 없는 경우
        toast({
          title: '탈퇴 대상 없음',
          description: '이미 삭제되었거나 존재하지 않는 사용자입니다.',
          variant: 'destructive',
          duration: CACHE_CONFIG.LONG_TOAST_DURATION
        });
      } else {
        // Case 1: 탈퇴 처리가 진행된 경우
        toast({
          title: '탈퇴 처리 완료',
          description: `선택한 멤버 탈퇴가 정상적으로 완료되었습니다. (${data.processedCount}명)`,
          duration: CACHE_CONFIG.TOAST_DURATION
        });
      }
      setSelectedUsers([]);
      setBulkEmails('');
      // 탈퇴 처리 완료 후 모든 필터 초기화 (활성 멤버와 탈퇴된 멤버 모두)
      setRegionFilter('__all__');
      setChapterFilter('__all__');
      setMemberNameSearch('');
      setWithdrawnRegionFilter('__all__');
      setWithdrawnChapterFilter('__all__');
      // 강제로 사용자 목록 다시 가져오기
      // 탈퇴 처리 후 사용자 목록과 탈퇴 히스토리 강제 새로고침
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/withdrawal-history'] });
      queryClient.refetchQueries({ queryKey: ['/api/admin/users'] });
      queryClient.refetchQueries({ queryKey: ['/api/admin/withdrawal-history'] });
      refetchHistory();
    },
    onError: (error: any) => {
      // 진행중 팝업 닫기
      setShowWithdrawalProgress(false);
      
      toast({
        title: '일괄 탈퇴 처리 실패',
        description: error.message || '처리 중 오류가 발생했습니다.',
        variant: 'destructive',
        duration: CACHE_CONFIG.TOAST_DURATION
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

  // 멤버 정보 수정 mutation
  const updateUserMutation = useMutation({
    mutationFn: async (data: { 
      email: string; 
      region?: string; 
      chapter?: string; 
      memberName?: string; 
      industry?: string; 
      company?: string; 
      password?: string;
    }) => {
      const response = await apiRequest('PUT', '/api/admin/update-user', data);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      queryClient.refetchQueries({ queryKey: ['/api/admin/users'] });
      setEditingUser(null);
      setEditFormData({ region: '', chapter: '', memberName: '', industry: '', company: '', password: '', auth: 'Member' });
      toast({
        title: "정보 수정 완료",
        description: data.message || "멤버 정보가 성공적으로 수정되었습니다.",
        className: "bg-white text-gray-900",
        duration: 2500
      });
    },
    onError: (error: any) => {
      toast({
        title: "정보 수정 오류",
        description: error.message || "멤버 정보 수정 중 오류가 발생했습니다",
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
      
      // CSV 업로드 성공 시에도 다이얼로그 닫기 (개별 추가와 동일)
      setShowAddUserDialog(false);
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
      'ID_BNI커넥트 등록 이메일,지역,챕터,멤버명,산업군,회사,PW_H.P. 뒷 4자리',
      'example@test.com,Seoul1 서울1,테스트챕터,홍길동,IT,테스트회사,1234'
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
    if (!newUser.email || !newUser.memberName || !newUser.region || !newUser.chapter || !newUser.industry || !newUser.company || !newUser.password || !newUser.auth) {
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

  const handleAddAdmin = async () => {
    if (!newUser.region || !newUser.memberName || !newUser.email || !newUser.password) {
      toast({
        title: "입력 오류",
        description: "지역명, 담당자명, 이메일, 비밀번호는 필수 입력 사항입니다",
        variant: "destructive",
        className: "bg-white text-gray-900"
      });
      return;
    }

    try {
      const response = await fetch('/api/admin/add-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          region: newUser.region,
          memberName: newUser.memberName,
          email: newUser.email,
          password: newUser.password,
          auth: newUser.auth || 'Admin'
        })
      });

      if (response.ok) {
        toast({
          title: "관리자 등록 완료",
          description: `${newUser.email} 관리자가 Admin 시트에 등록되었습니다.`,
          duration: 2500
        });
        queryClient.invalidateQueries({ queryKey: ['/api/admin/list-admins'] });
        setNewUser({ email: '', region: '', chapter: '', memberName: '', industry: '', company: '', password: '', auth: 'Admin' });
      } else {
        const error = await response.json();
        toast({
          title: "등록 실패",
          description: error.message || "관리자 등록에 실패했습니다.",
          variant: "destructive"
        });
      }
    } catch (error) {
      toast({
        title: "등록 실패",
        description: "서버 오류가 발생했습니다.",
        variant: "destructive"
      });
    }
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
    
    // 멤버명 검색 - 정확한 매칭만
    let nameMatch = true;
    if (memberNameSearch !== '') {
      const searchTerm = memberNameSearch.toLowerCase().trim();
      const memberName = user.memberName.toLowerCase().trim();
      
      // 정확한 이름 매칭만 허용 (완전 일치)
      nameMatch = memberName === searchTerm;
    }
    
    return regionMatch && chapterMatch && nameMatch;
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

  // 탈퇴 히스토리 필터링 로직 - 필터가 선택되었을 때만 결과 표시
  const hasActiveFilter = historyRegionFilter !== "전체" || historyChapterFilter !== "전체" || historySearchTerm !== "";
  
  const filteredWithdrawalHistory = hasActiveFilter ? withdrawalHistory.filter((item: WithdrawalHistoryItem) => {
    const matchesSearchTerm = historySearchTerm === "" || 
      item.email.toLowerCase().includes(historySearchTerm.toLowerCase()) ||
      item.memberName.toLowerCase().includes(historySearchTerm.toLowerCase());
    
    const matchesRegion = historyRegionFilter === "전체" || item.region === historyRegionFilter;
    const matchesChapter = historyChapterFilter === "전체" || item.chapter === historyChapterFilter;
    
    return matchesSearchTerm && matchesRegion && matchesChapter;
  }) : [];

  // 탈퇴 히스토리에서 고유한 지역과 챕터 목록 추출
  const historyRegions = ["전체", ...Array.from(new Set(withdrawalHistory.map((item: WithdrawalHistoryItem) => item.region).filter(Boolean)))];
  const historyChapters = ["전체", ...Array.from(new Set(withdrawalHistory.map((item: WithdrawalHistoryItem) => item.chapter).filter(Boolean)))];

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
                <h1 className="text-xl font-bold text-red-600">COMMAND CENTER</h1>
                <span className="text-sm text-gray-500">BNI Korea 파워팀 관리자 대시보드</span>
              </div>
            </div>
            <div className="flex items-center space-x-3">
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
                onClick={() => {
                  localStorage.removeItem('currentUser');
                  setLocation('/');
                }}
                className="text-gray-600 border-gray-300 hover:bg-red-600 hover:text-white hover:border-red-600"
              >
                로그아웃
              </Button>
            </div>
          </div>

          {/* 모바일 레이아웃 */}
          <div className="md:hidden py-4">
            <div className="flex items-center mb-4">
              <div className="w-10 h-10 bg-red-600 rounded-full flex items-center justify-center mr-3">
                <Users className="text-white w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-red-600">COMMAND CENTER</h1>
                <span className="text-sm text-gray-500">BNI Korea 관리자 대시보드</span>
              </div>
            </div>
            <div className="space-y-2">
              {adminPermission?.auth === 'National' && (
                <Button
                  onClick={exportUserList}
                  variant="outline"
                  size="sm"
                  className="border-gray-300 text-gray-700 hover:bg-red-600 hover:text-white hover:border-red-600 w-full"
                >
                  <Download className="mr-1 w-4 h-4" />
                  RPS 목록 내보내기
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  localStorage.removeItem('currentUser');
                  setLocation('/');
                }}
                className="text-gray-600 border-gray-300 hover:bg-red-600 hover:text-white hover:border-red-600 w-full"
              >
                로그아웃
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-3">

        {/* 통계 카드 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* 총 멤버수 */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 transition-all duration-300 hover:shadow-lg hover:scale-[1.02] hover:border-gray-300 cursor-default">
            <p className="text-xs font-semibold text-gray-400 tracking-wider mb-3">멤버 ALL(탈퇴포함)</p>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold text-gray-900">{(allUsers?.length || 0).toLocaleString()}</span>
              <span className="text-sm font-medium text-gray-400">ALL MEMBERS</span>
            </div>
            <p className="text-xs text-gray-400 mt-3">전체 등록 멤버 현황</p>
          </div>
          {/* 활동중 멤버 */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 relative transition-all duration-300 hover:shadow-lg hover:scale-[1.02] hover:border-red-300 cursor-default">
            <div className="absolute left-0 top-4 bottom-4 w-1 bg-red-600 rounded-r"></div>
            <p className="text-xs font-semibold text-gray-400 tracking-wider mb-3">활동중 멤버</p>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold text-red-600">{activeUsers.length.toLocaleString()}</span>
              <span className="text-sm font-medium text-gray-400">ACTIVE MEMBERS</span>
            </div>
            <p className="text-xs text-gray-400 mt-3">
              <span className="inline-block w-2 h-2 bg-green-500 rounded-full mr-1"></span>
              {allUsers?.length ? Math.round((activeUsers.length / allUsers.length) * 100) : 0}% RETENTION INDEX
            </p>
          </div>
          {/* 탈퇴 멤버 */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 transition-all duration-300 hover:shadow-lg hover:scale-[1.02] hover:border-gray-300 cursor-default">
            <p className="text-xs font-semibold text-gray-400 tracking-wider mb-3">탈퇴 멤버</p>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold text-gray-900">{withdrawalHistory.length.toLocaleString()}</span>
              <span className="text-sm font-medium text-gray-400">INACTIVE</span>
            </div>
            <p className="text-xs text-gray-400 mt-3">시스템 운영 이후 누적 기록</p>
          </div>
        </div>

        {/* Feature Cards Grid */}
        <div>
          <h2 className="text-sm font-semibold text-gray-900 tracking-wider mb-3 pl-2">Administrative Protocol</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* Card: 새로운 멤버 추가 */}
          <div
            onClick={() => setActiveModal('add')}
            className="bg-white rounded-lg shadow-sm border border-gray-200 cursor-pointer transition-all duration-200 hover:shadow-md hover:border-red-300 p-5 flex flex-col justify-between min-h-[200px]"
          >
            <div>
              <UserPlus className="w-5 h-5 text-red-600 mb-3" />
              <h3 className="font-bold text-gray-900 mb-2">새로운 멤버 추가</h3>
              <p className="text-xs text-gray-500 leading-relaxed">개별 멤버 추가 또는 CSV 파일로 일괄 등록합니다. 챕터 인증서 및 승인 문서가 필요합니다.</p>
            </div>
            <button className="mt-4 w-full bg-red-600 hover:bg-red-700 text-white text-xs font-semibold py-2.5 px-4 rounded-md flex items-center justify-center gap-1 transition-colors">
              OPEN APPLICATION →
            </button>
          </div>

          {/* Card: 멤버 관리 */}
          <div
            onClick={() => setActiveModal('edit')}
            className="bg-white rounded-lg shadow-sm border border-gray-200 cursor-pointer transition-all duration-200 hover:shadow-md hover:border-gray-400 p-5 flex flex-col justify-between min-h-[200px]"
          >
            <div>
              <Users className="w-5 h-5 text-gray-700 mb-3" />
              <h3 className="font-bold text-gray-900 mb-2">멤버 관리</h3>
              <p className="text-xs text-gray-500 leading-relaxed">멤버의 연락처, 산업군, 챕터 배정 등 기존 멤버 정보를 조회하고 수정합니다.</p>
            </div>
            <button className="mt-4 w-full border border-gray-300 hover:border-gray-500 text-gray-700 text-xs font-semibold py-2.5 px-4 rounded-md flex items-center justify-center gap-1 transition-colors bg-white">
              ACCESS RECORDS 📋
            </button>
          </div>

          {/* Card: 탈퇴 멤버 삭제 */}
          <div
            onClick={() => setActiveModal('withdrawal')}
            className="bg-white rounded-lg shadow-sm border border-gray-200 cursor-pointer transition-all duration-200 hover:shadow-md hover:border-red-300 p-5 flex flex-col justify-between min-h-[200px]"
          >
            <div>
              <UserMinus className="w-5 h-5 text-red-600 mb-3" />
              <h3 className="font-bold text-gray-900 mb-2">탈퇴 멤버 삭제</h3>
              <p className="text-xs text-gray-500 leading-relaxed">멤버를 비활성 상태로 전환합니다. 탈퇴 면담 확인 및 책임 해제 절차가 필요합니다.</p>
            </div>
            <button className="mt-4 w-full border border-red-600 hover:bg-red-50 text-red-600 text-xs font-semibold py-2.5 px-4 rounded-md flex items-center justify-center gap-1 transition-colors bg-white">
              INITIATE EXIT ↗
            </button>
          </div>

          {/* Card: 챕터 관리 */}
          <div
            onClick={() => setShowAddChapterDialog(true)}
            className="bg-white rounded-lg shadow-sm border border-gray-200 cursor-pointer transition-all duration-200 hover:shadow-md hover:border-gray-400 p-5 flex flex-col justify-between min-h-[200px]"
          >
            <div>
              <Plus className="w-5 h-5 text-gray-700 mb-3" />
              <h3 className="font-bold text-gray-900 mb-2">챕터 관리</h3>
              <p className="text-xs text-gray-500 leading-relaxed">새로운 챕터를 생성하거나 기존 챕터를 삭제합니다.</p>
            </div>
            <button className="mt-4 w-full border border-gray-300 hover:border-gray-500 text-gray-700 text-xs font-semibold py-2.5 px-4 rounded-md flex items-center justify-center gap-1 transition-colors bg-white">
              MANAGE CHAPTERS 📋
            </button>
          </div>

          {/* Card: 관리자 관리 */}
          <div
            onClick={() => setShowAddUserDialog(true)}
            className="bg-white rounded-lg shadow-sm border border-gray-200 cursor-pointer transition-all duration-200 hover:shadow-md hover:border-gray-400 p-5 flex flex-col justify-between min-h-[200px]"
          >
            <div>
              <UserCheck className="w-5 h-5 text-gray-700 mb-3" />
              <h3 className="font-bold text-gray-900 mb-2">관리자 관리</h3>
              <p className="text-xs text-gray-500 leading-relaxed">관리자를 추가하거나 기존 관리자를 삭제합니다.</p>
            </div>
            <button className="mt-4 w-full border border-gray-300 hover:border-gray-500 text-gray-700 text-xs font-semibold py-2.5 px-4 rounded-md flex items-center justify-center gap-1 transition-colors bg-white">
              MANAGE ADMINS 📋
            </button>
          </div>

          {/* Card: 탈퇴 히스토리 */}
          <div
            onClick={() => setActiveModal('history')}
            className="bg-white rounded-lg shadow-sm border border-gray-200 cursor-pointer transition-all duration-200 hover:shadow-md hover:border-gray-400 p-5 flex flex-col justify-between min-h-[200px]"
          >
            <div>
              <FileText className="w-5 h-5 text-gray-700 mb-3" />
              <h3 className="font-bold text-gray-900 mb-2">탈퇴 히스토리</h3>
              <p className="text-xs text-gray-500 leading-relaxed">탈퇴 이력을 조회하고 멤버를 복원할 수 있습니다.</p>
            </div>
            <button className="mt-4 w-full border border-gray-300 hover:border-gray-500 text-gray-700 text-xs font-semibold py-2.5 px-4 rounded-md flex items-center justify-center gap-1 transition-colors bg-white">
              VIEW HISTORY 📋
            </button>
          </div>
        </div>

        {/* 하단 섹션: 매뉴얼 영상 + 공지사항 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 !mt-8">
          {/* 매뉴얼 영상 */}
          <div className="bg-gray-900 rounded-xl overflow-hidden shadow-lg">
            <div className="p-4">
              <h3 className="text-white font-bold text-sm mb-0.5">관리자 매뉴얼</h3>
              <p className="text-gray-400 text-xs">시스템 사용 가이드 영상</p>
            </div>
            <div className="aspect-[2.25/1]">
              <iframe
                className="w-full h-full"
                src="https://www.youtube.com/embed/vZcyOdyu6bg?autoplay=1&mute=1&loop=1&playlist=vZcyOdyu6bg&controls=1"
                title="관리자 매뉴얼"
                allow="autoplay; encrypted-media"
                allowFullScreen
              />
            </div>
          </div>

          {/* 요청/답변 게시판 */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-gray-900 text-sm mb-0.5">Admin Board</h3>
                <p className="text-gray-500 text-xs">시스템 관련 공지 & 수정 건의 및 질문 게시판</p>
              </div>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                <input
                  value={boardSearch}
                  onChange={(e) => setBoardSearch(e.target.value)}
                  placeholder="검색..."
                  className="text-xs border border-gray-300 rounded-md pl-7 pr-2 py-1.5 w-32"
                />
              </div>
            </div>
            <BoardWidget currentUser={currentUser} adminPermission={adminPermission} boardSearch={boardSearch} />
          </div>
        </div>
      </div>

      {/* ========== MODAL: 새로운 멤버 추가 ========== */}
      <Dialog open={activeModal === 'add'} onOpenChange={(open) => setActiveModal(open ? 'add' : null)}>
        <DialogContent className="max-w-4xl bg-white max-h-[90vh] overflow-y-auto w-[95vw] sm:w-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center text-xl text-red-600">
              <UserPlus className="mr-2 w-6 h-6" />
              새로운 멤버 추가하기
            </DialogTitle>
            <DialogDescription>
              단일 멤버 추가 또는 CSV 파일로 일괄 추가할 수 있습니다.
              <br />
              <span className="text-xs text-gray-400">* 전문분야 & 타겟고객(나의 핵심 고객층)은 멤버가 직접 관리하는 정보로, 관리자가 계정 생성 추가하는 정보에서 제외됩니다.</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6">
            {/* 탭 버튼 */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setAddMode('single')}
                className={`py-3 px-4 font-medium transition-colors flex items-center justify-center gap-2 rounded-lg whitespace-nowrap border-2 ${
                  addMode === 'single'
                    ? 'bg-red-600 text-white border-red-700'
                    : 'bg-white text-red-600 border-red-600 hover:bg-red-50'
                }`}
              >
                <Plus className="w-4 h-4 flex-shrink-0" />
                멤버 개별 추가
              </button>
              <button
                onClick={() => setAddMode('csv')}
                className={`py-3 px-4 font-medium transition-colors flex items-center justify-center gap-2 rounded-lg whitespace-nowrap border-2 ${
                  addMode === 'csv'
                    ? 'bg-red-600 text-white border-red-700'
                    : 'bg-white text-red-600 border-red-600 hover:bg-red-50'
                }`}
              >
                <Plus className="w-4 h-4 flex-shrink-0" />
                일괄 등록
              </button>
            </div>

            {/* 개별 추가 폼 */}
            {addMode === 'single' && (
              <div className="space-y-6">
                <div className="border border-red-200 rounded-lg p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <Label className="text-sm font-medium text-gray-700">이메일 *</Label>
                      <Input
                        type="email"
                        value={newUser.email}
                        onChange={(e) => setNewUser({...newUser, email: e.target.value})}
                        placeholder="user@example.com"
                        className="mt-1 border-red-200 focus:border-red-500"
                      />
                    </div>
                    <div>
                      <Label className="text-sm font-medium text-gray-700">멤버명 *</Label>
                      <Input
                        value={newUser.memberName}
                        onChange={(e) => setNewUser({...newUser, memberName: e.target.value})}
                        placeholder="홍길동"
                        className="mt-1 border-red-200 focus:border-red-500"
                      />
                    </div>
                    <div>
                      <Label className="text-sm font-medium text-gray-700">지역 *</Label>
                      <Select value={newUser.region} onValueChange={(value) => setNewUser({...newUser, region: value})}>
                        <SelectTrigger className="mt-1 bg-white border-red-200">
                          <SelectValue placeholder="지역을 선택하세요" />
                        </SelectTrigger>
                        <SelectContent className="bg-white">
                          {(regions as string[]).map((region: string) => (
                            <SelectItem key={region} value={region}>{region}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-sm font-medium text-gray-700">챕터 *</Label>
                      <Select value={newUser.chapter} onValueChange={(value) => setNewUser({...newUser, chapter: value})}>
                        <SelectTrigger className="mt-1 bg-white border-red-200">
                          <SelectValue placeholder="챕터를 선택하세요" />
                        </SelectTrigger>
                        <SelectContent className="bg-white">
                          {(chapters as string[]).map((chapter: string) => (
                            <SelectItem key={chapter} value={chapter}>{chapter}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-sm font-medium text-gray-700">산업군 _BNI 커넥트 기준 *</Label>
                      <Input
                        value={newUser.industry}
                        onChange={(e) => setNewUser({...newUser, industry: e.target.value})}
                        placeholder="IT"
                        className="mt-1 border-red-200 focus:border-red-500"
                      />
                    </div>
                    <div>
                      <Label className="text-sm font-medium text-gray-700">회사 *</Label>
                      <Input
                        value={newUser.company}
                        onChange={(e) => setNewUser({...newUser, company: e.target.value})}
                        placeholder="회사명"
                        className="mt-1 border-red-200 focus:border-red-500"
                      />
                    </div>
                    <div>
                      <Label className="text-sm font-medium text-gray-700">비밀번호 (휴대전화 뒷 4자리) *</Label>
                      <Input
                        type="text"
                        maxLength={4}
                        value={newUser.password}
                        onChange={(e) => setNewUser({...newUser, password: e.target.value.replace(/\D/g, '').slice(0, 4)})}
                        placeholder="1234"
                        className="mt-1 border-red-200 focus:border-red-500"
                      />
                    </div>
                    <div>
                      <Label className="text-sm font-medium text-gray-700">권한 *</Label>
                      <Select value={newUser.auth} onValueChange={(value) => setNewUser({...newUser, auth: value})}>
                        <SelectTrigger className="mt-1 bg-white border-red-200">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-white">
                          <SelectItem value="Member">Member (일반회원)</SelectItem>
                          <SelectItem value="Growth">Growth</SelectItem>
                          <SelectItem value="Admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button
                    onClick={handleAddUser}
                    disabled={addUserMutation.isPending || !newUser.email || !newUser.region || !newUser.chapter || !newUser.memberName || newUser.password.length !== 4}
                    className="w-full mt-6 bg-red-600 hover:bg-red-700 text-white py-3"
                  >
                    {addUserMutation.isPending ? '추가 중...' : '멤버 등록'}
                  </Button>
                </div>
              </div>
            )}

            {/* CSV 일괄 등록 */}
            {addMode === 'csv' && (
              <div className="space-y-6">
                <p className="text-gray-700">하단의 '일괄 등록' 양식의 <span className="text-red-600 font-medium">CSV 파일</span>을 업로드하시면, 새로운 멤버의 <span className="text-red-600 font-medium">RPS Board</span>가 생성됩니다.</p>

                <Button
                  variant="outline"
                  className="w-full py-6 border-red-600 text-red-600 hover:bg-red-50"
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = '.csv';
                    input.onchange = (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (file) {
                        console.log('CSV uploaded:', file.name);
                      }
                    };
                    input.click();
                  }}
                >
                  <FileText className="w-5 h-5 mr-2" />
                  CSV 파일 업로드
                </Button>

                <div className="border-l-4 border-red-200 bg-red-50 p-4 rounded-r-lg">
                  <h4 className="font-medium text-gray-900 mb-3">CSV 파일 형식 안내</h4>
                  <p className="text-red-600 font-medium mb-2">CSV 파일 형식 : 이메일 | 지역 | 챕터 | 멤버명 | 산업군 | 회사 | 권한(선택) | PW(숫자 4자리)</p>
                  <ul className="text-sm text-gray-700 space-y-1">
                    <li>• 이메일 주소는 ID로 사용되며, BNI Connect 시스템에 등록된 정보와 동일합니다.</li>
                    <li>• 지역 형식: BNI Connect 시스템의 지역명 형식으로 입력해주세요.</li>
                    <li className="ml-4 text-gray-500">_(ex)"Seoul1 서울1" (영어+숫자 + 한글)</li>
                    <li>• PW는 BNI Connect 시스템에 등록된 멤버의 휴대전화 번호의 뒷 4자리(010-1234-****) 정보를 기본으로 합니다.</li>
                    <li>• 권한(선택사항): Admin, Member 중 선택 - 생략하면 Member로 설정됩니다.</li>
                    <li className="text-red-600 font-medium">• 중요: 전문분야 & 타겟고객(나의 핵심 고객층)은 멤버가 직접 관리하므로 CSV에서 제외됩니다.</li>
                    <li>• 첫 번째 행은 헤더이므로, 두 번째 행부터 사용자 정보를 입력하세요.</li>
                  </ul>
                  <button
                    onClick={() => {
                      const csvContent = "이메일,지역,챕터,멤버명,산업군,회사,권한,비밀번호\nexample@email.com,Seoul1 서울1,하이,홍길동,IT,테크회사,Member,1234";
                      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                      const link = document.createElement('a');
                      link.href = URL.createObjectURL(blob);
                      link.download = 'member_template.csv';
                      link.click();
                    }}
                    className="flex items-center text-red-600 hover:text-red-700 mt-4 text-sm font-medium"
                  >
                    <Download className="w-4 h-4 mr-1" />
                    CSV 템플릿 파일 다운로드
                  </button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ========== MODAL: 멤버 관리 (정보 수정) ========== */}
      <Dialog open={activeModal === 'edit'} onOpenChange={(open) => setActiveModal(open ? 'edit' : null)}>
        <DialogContent className="max-w-7xl bg-white max-h-[90vh] overflow-y-auto w-[95vw]">
          <DialogHeader>
            <DialogTitle className="flex items-center text-lg text-red-700">
              <Edit3 className="mr-2 w-5 h-5" />
              멤버 관리 - 정보 수정
            </DialogTitle>
            <DialogDescription>
              이메일 또는 멤버명으로 검색하여 멤버 정보를 수정할 수 있습니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* 검색 */}
            <div className="flex gap-4">
              <div className="flex-1">
                <Input
                  placeholder="이메일 또는 멤버명으로 검색..."
                  value={editSearchTerm}
                  onChange={(e) => setEditSearchTerm(e.target.value)}
                  className="w-full"
                />
              </div>
              <Button variant="outline" className="border-gray-300">
                <Search className="w-4 h-4 mr-2" />
                검색
              </Button>
            </div>

            {/* 검색 결과 */}
            {editSearchTerm && (
              <div className="space-y-3">
                {activeUsers
                  .filter(user =>
                    user.email.toLowerCase().includes(editSearchTerm.toLowerCase()) ||
                    user.memberName.toLowerCase().includes(editSearchTerm.toLowerCase())
                  )
                  .slice(0, 10)
                  .map(user => (
                    <div
                      key={user.email}
                      className={`p-4 border rounded-lg ${
                        editingUser?.email === user.email ? 'border-red-500 bg-red-50' : 'border-gray-200 hover:border-red-300'
                      }`}
                    >
                      {editingUser?.email === user.email ? (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between mb-4">
                            <h4 className="font-medium text-red-700">정보 수정 중: {user.memberName}</h4>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingUser(null)}
                            >
                              취소
                            </Button>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <Label className="text-sm">지역</Label>
                              <Select
                                value={editFormData.region}
                                onValueChange={(value) => setEditFormData({...editFormData, region: value})}
                              >
                                <SelectTrigger className="mt-1 bg-white">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-white">
                                  {(regions as string[]).map((region: string) => (
                                    <SelectItem key={region} value={region}>{region}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label className="text-sm">챕터</Label>
                              <Select
                                value={editFormData.chapter}
                                onValueChange={(value) => setEditFormData({...editFormData, chapter: value})}
                              >
                                <SelectTrigger className="mt-1 bg-white">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-white">
                                  {(chapters as string[]).map((chapter: string) => (
                                    <SelectItem key={chapter} value={chapter}>{chapter}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label className="text-sm">멤버명</Label>
                              <Input
                                value={editFormData.memberName}
                                onChange={(e) => setEditFormData({...editFormData, memberName: e.target.value})}
                                className="mt-1"
                              />
                            </div>
                            <div>
                              <Label className="text-sm">산업군</Label>
                              <Input
                                value={editFormData.industry}
                                onChange={(e) => setEditFormData({...editFormData, industry: e.target.value})}
                                className="mt-1"
                              />
                            </div>
                            <div>
                              <Label className="text-sm">회사명</Label>
                              <Input
                                value={editFormData.company}
                                onChange={(e) => setEditFormData({...editFormData, company: e.target.value})}
                                className="mt-1"
                              />
                            </div>
                            <div>
                              <Label className="text-sm">비밀번호 재설정 (4자리)</Label>
                              <Input
                                type="text"
                                maxLength={4}
                                value={editFormData.password}
                                onChange={(e) => setEditFormData({...editFormData, password: e.target.value.replace(/\D/g, '').slice(0, 4)})}
                                placeholder="변경 시 입력"
                                className="mt-1"
                              />
                            </div>
                          </div>
                          <div className="flex gap-2 pt-4">
                            <Button
                              onClick={() => {
                                if (editingUser) {
                                  updateUserMutation.mutate({
                                    email: editingUser.email,
                                    region: editFormData.region,
                                    chapter: editFormData.chapter,
                                    memberName: editFormData.memberName,
                                    industry: editFormData.industry,
                                    company: editFormData.company,
                                    password: editFormData.password || undefined
                                  });
                                }
                              }}
                              disabled={updateUserMutation.isPending}
                              className="bg-red-600 hover:bg-red-700 text-white"
                            >
                              {updateUserMutation.isPending ? '저장 중...' : '저장'}
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => setEditingUser(null)}
                            >
                              취소
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium text-gray-900">{user.memberName}</div>
                            <div className="text-sm text-gray-500">
                              {user.region} / {user.chapter} - {user.email}
                            </div>
                            <div className="text-sm text-gray-400">
                              {user.industry} / {user.company}
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditingUser(user);
                              setEditFormData({
                                region: user.region,
                                chapter: user.chapter,
                                memberName: user.memberName,
                                industry: user.industry,
                                company: user.company,
                                password: '',
                                auth: 'Member'
                              });
                            }}
                            className="border-red-300 text-red-600 hover:bg-red-50"
                          >
                            <Edit3 className="w-4 h-4 mr-1" />
                            정보 수정
                          </Button>
                        </div>
                      )}
                    </div>
                  ))
                }
                {activeUsers.filter(user =>
                  user.email.toLowerCase().includes(editSearchTerm.toLowerCase()) ||
                  user.memberName.toLowerCase().includes(editSearchTerm.toLowerCase())
                ).length === 0 && (
                  <div className="p-8 text-center text-gray-500">
                    검색 결과가 없습니다
                  </div>
                )}
              </div>
            )}

            {!editSearchTerm && (
              <div className="p-8 text-center text-gray-500 bg-gray-50 rounded-lg">
                <Search className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                <p>수정할 멤버를 검색해주세요</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ========== MODAL: 탈퇴 멤버 삭제 ========== */}
      <Dialog open={activeModal === 'withdrawal'} onOpenChange={(open) => setActiveModal(open ? 'withdrawal' : null)}>
        <DialogContent className="max-w-4xl bg-white max-h-[90vh] w-[95vw] sm:w-auto overflow-visible">
          <DialogHeader>
            <DialogTitle className="flex items-center text-lg text-red-700">
              <UserMinus className="mr-2 w-5 h-5" />
              탈퇴 멤버 삭제
            </DialogTitle>
            <DialogDescription>
              이메일 직접 입력 또는 멤버 목록에서 선택하여 탈퇴 처리할 수 있습니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto max-h-[calc(90vh-120px)]">
            {/* 방법 선택 */}
            <div className="flex gap-4 p-4 bg-gray-50 rounded-lg">
              <label className="flex items-center cursor-pointer">
                <input
                  type="radio"
                  name="withdrawalMethod"
                  checked={withdrawalMethod === 'email'}
                  onChange={() => setWithdrawalMethod('email')}
                  className="mr-2 accent-red-600"
                />
                <span className={withdrawalMethod === 'email' ? 'font-medium text-red-600' : 'text-gray-600'}>
                  이메일 직접 입력
                </span>
              </label>
              <label className="flex items-center cursor-pointer">
                <input
                  type="radio"
                  name="withdrawalMethod"
                  checked={withdrawalMethod === 'list'}
                  onChange={() => setWithdrawalMethod('list')}
                  className="mr-2 accent-red-600"
                />
                <span className={withdrawalMethod === 'list' ? 'font-medium text-red-600' : 'text-gray-600'}>
                  멤버 목록에서 선택
                </span>
              </label>
            </div>

            {/* 방법 1: 이메일 직접 입력 */}
            {withdrawalMethod === 'email' && (
              <div className="space-y-4">
                <div>
                  <Label className="text-sm font-medium text-gray-700">
                    탈퇴할 멤버 이메일 (여러 명은 줄바꿈으로 구분)
                  </Label>
                  <textarea
                    value={bulkEmails}
                    onChange={(e) => setBulkEmails(e.target.value)}
                    placeholder="user1@example.com&#10;user2@example.com&#10;user3@example.com"
                    className="w-full mt-2 p-3 border rounded-lg h-32 resize-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  />
                  {bulkEmails.trim() && (
                    <div className="mt-2 text-sm">
                      {emailValidation.isValid ? (
                        <span className="text-green-600">입력된 이메일: {emailValidation.validCount}개</span>
                      ) : (
                        <span className="text-red-600">
                          잘못된 이메일 형식: {emailValidation.invalidEmails?.join(', ')}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      className="bg-red-600 hover:bg-red-700 text-white"
                      disabled={!emailValidation.isValid || bulkWithdrawalMutation.isPending}
                    >
                      <UserMinus className="w-4 h-4 mr-2" />
                      {bulkWithdrawalMutation.isPending ? '처리 중...' : '입력한 탈퇴 멤버 삭제'}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>멤버 탈퇴 확인</AlertDialogTitle>
                      <AlertDialogDescription>
                        {emailValidation.validCount}명의 멤버를 탈퇴 처리하시겠습니까?
                        이 작업은 되돌릴 수 있습니다.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>취소</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          const emails = bulkEmails.trim().split('\n').map(e => e.trim()).filter(e => e);
                          bulkWithdrawalMutation.mutate(emails);
                        }}
                        className="bg-red-600 hover:bg-red-700"
                      >
                        탈퇴 처리
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}

            {/* 방법 2: 멤버 목록에서 선택 */}
            {withdrawalMethod === 'list' && (
              <div className="space-y-4">
                {/* 필터 */}
                <div className="flex flex-wrap gap-4 p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <Label className="text-sm whitespace-nowrap">지역:</Label>
                    <select
                      value={regionFilter}
                      onChange={(e) => { setRegionFilter(e.target.value); setChapterFilter("__all__"); setMemberNameSearch(""); }}
                      className="h-10 w-32 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="__all__">전체</option>
                      {uniqueRegions.map(region => (
                        <option key={region} value={region}>{region}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Label className="text-sm whitespace-nowrap">챕터:</Label>
                    <select
                      value={chapterFilter}
                      onChange={(e) => { setChapterFilter(e.target.value); setRegionFilter("__all__"); setMemberNameSearch(""); }}
                      className="h-10 w-32 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="__all__">전체</option>
                      {uniqueChapters.map(chapter => (
                        <option key={chapter} value={chapter}>{chapter}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center space-x-2 flex-1">
                    <Label className="text-sm whitespace-nowrap">검색:</Label>
                    <Input
                      placeholder="멤버명 검색..."
                      value={memberNameSearch}
                      onChange={(e) => { setMemberNameSearch(e.target.value); setRegionFilter("__all__"); setChapterFilter("__all__"); }}
                      className="max-w-xs"
                    />
                  </div>
                </div>

                {/* 필터 선택 전 안내 메시지 */}
                {regionFilter === '__all__' && chapterFilter === '__all__' && !memberNameSearch && (
                  <div className="border rounded-lg p-8 text-center bg-gray-50">
                    <div className="flex flex-col items-center space-y-3">
                      <Users className="w-12 h-12 text-gray-400" />
                      <div className="text-gray-700 font-medium">
                        멤버 목록을 보려면 필터를 선택하세요
                      </div>
                      <div className="text-gray-500 text-sm">
                        위의 필터에서 지역, 챕터를 선택하거나 멤버명을 검색하면 해당 멤버 목록이 표시됩니다.
                      </div>
                    </div>
                  </div>
                )}

                {/* 선택 현황 및 전체 선택 */}
                {(regionFilter !== '__all__' || chapterFilter !== '__all__' || memberNameSearch) && (
                  <>
                    <div className="flex items-center justify-between p-3 bg-white border rounded-lg">
                      <div className="flex items-center space-x-3">
                        <Checkbox
                          checked={filteredActiveUsers.length > 0 && filteredActiveUsers.every(u => selectedUsers.includes(u.email))}
                          onCheckedChange={handleSelectAll}
                        />
                        <span className="text-sm text-gray-600">전체 선택</span>
                      </div>
                      <Badge variant="secondary">
                        선택됨: {selectedUsers.length}명
                      </Badge>
                    </div>

                    <div className="max-h-80 overflow-y-auto border rounded-lg">
                      {filteredActiveUsers.length === 0 ? (
                        <div className="p-8 text-center text-gray-500">
                          조건에 맞는 멤버가 없습니다
                        </div>
                      ) : (
                        filteredActiveUsers.map(user => (
                          <div
                            key={user.email}
                            className={`flex items-center p-3 border-b last:border-b-0 hover:bg-gray-50 ${
                              selectedUsers.includes(user.email) ? 'bg-red-50' : ''
                            }`}
                          >
                            <Checkbox
                              checked={selectedUsers.includes(user.email)}
                              onCheckedChange={(checked) => handleUserSelection(user.email, checked === true)}
                              className="mr-3"
                            />
                            <div className="flex-1">
                              <div className="font-medium text-gray-900">{user.memberName}</div>
                              <div className="text-sm text-gray-500">
                                {user.region} / {user.chapter} - {user.email}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          className="bg-red-600 hover:bg-red-700 text-white"
                          disabled={selectedUsers.length === 0 || bulkWithdrawalMutation.isPending}
                        >
                          <UserMinus className="w-4 h-4 mr-2" />
                          {bulkWithdrawalMutation.isPending ? '처리 중...' : `선택한 ${selectedUsers.length}명 탈퇴 처리`}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="bg-white border-2 border-gray-300 shadow-2xl">
                        <AlertDialogHeader>
                          <AlertDialogTitle className="text-gray-900">멤버 탈퇴 확인</AlertDialogTitle>
                          <AlertDialogDescription className="text-gray-600">
                            {selectedUsers.length}명의 멤버를 탈퇴 처리하시겠습니까?
                            이 작업은 되돌릴 수 있습니다.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="bg-gray-100 hover:bg-gray-200 text-gray-700 border-gray-300">취소</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={handleSelectedUsersWithdrawal}
                            className="bg-red-600 hover:bg-red-700 text-white"
                          >
                            탈퇴 처리
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </>
                )}
              </div>
            )}

            {/* 탈퇴 멤버 복원 링크 */}
            <Separator className="my-4" />
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-600">
                탈퇴된 멤버를 다시 활성화하려면 히스토리를 확인하세요
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setActiveModal('history')}
                className="border-gray-300"
              >
                <FileText className="w-4 h-4 mr-1" />
                탈퇴 히스토리 보기
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ========== MODAL: 탈퇴 히스토리 + 탈퇴된 사용자 복원 ========== */}
      <Dialog open={activeModal === 'history'} onOpenChange={(open) => setActiveModal(open ? 'history' : null)}>
        <DialogContent className="max-w-7xl bg-white max-h-[90vh] w-[95vw] overflow-visible">
          <DialogHeader>
            <DialogTitle className="flex items-center text-lg">
              <FileText className="mr-2 w-5 h-5 text-gray-600" />
              탈퇴 히스토리
              <Badge variant="secondary" className="ml-2 text-sm">
                {withdrawalHistory.length}건
              </Badge>
            </DialogTitle>
            <DialogDescription>
              탈퇴 이력을 조회하고 멤버를 복원할 수 있습니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 overflow-y-auto max-h-[calc(90vh-120px)]">
            {isHistoryLoading ? (
              <div className="flex justify-center py-8">
                <div className="text-gray-500">탈퇴 히스토리를 불러오는 중...</div>
              </div>
            ) : withdrawalHistory.length === 0 ? (
              <div className="flex justify-center py-8">
                <div className="text-gray-500">탈퇴 히스토리가 없습니다</div>
              </div>
            ) : (
              <>
                {/* 검색 필터 */}
                <div className="flex flex-wrap gap-4 p-4 bg-gray-50 rounded-lg border">
                  <div className="flex items-center space-x-2 w-full md:w-auto">
                    <label className="text-sm font-medium text-gray-700 whitespace-nowrap">지역:</label>
                    <div className="flex-1 md:w-40">
                      <select
                        value={historyRegionFilter}
                        onChange={(e) => { setHistoryRegionFilter(e.target.value); setHistoryChapterFilter("전체"); setHistorySearchTerm(""); }}
                        className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                      >
                        <option value="전체">전체</option>
                        {historyRegions.filter(region => region !== "전체").map(region => (
                          <option key={region} value={region}>{region}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2 w-full md:w-auto">
                    <label className="text-sm font-medium text-gray-700 whitespace-nowrap">챕터:</label>
                    <div className="flex-1 md:w-40">
                      <select
                        value={historyChapterFilter}
                        onChange={(e) => { setHistoryChapterFilter(e.target.value); setHistoryRegionFilter("전체"); setHistorySearchTerm(""); }}
                        className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                      >
                        <option value="전체">전체</option>
                        {historyChapters.filter(chapter => chapter !== "전체").map(chapter => (
                          <option key={chapter} value={chapter}>{chapter}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2 w-full md:w-auto">
                    <label className="text-sm font-medium text-gray-700 whitespace-nowrap">성함:</label>
                    <div className="relative flex-1 md:w-40">
                      <input
                        type="text"
                        value={historySearchTerm}
                        onChange={(e) => { setHistorySearchTerm(e.target.value); setHistoryRegionFilter("전체"); setHistoryChapterFilter("전체"); }}
                        placeholder="멤버명 검색"
                        className="w-full bg-white text-sm px-3 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                        style={{ border: '1px solid #d12031' }}
                      />
                      {historySearchTerm && (
                        <button
                          onClick={() => setHistorySearchTerm('')}
                          className="absolute -top-1 -right-1 w-5 h-5 bg-white border border-gray-300 rounded-full flex items-center justify-center text-gray-600 hover:text-red-600 text-xs"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                  {hasActiveFilter && (
                    <div className="flex items-center w-full md:w-auto">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setHistoryRegionFilter("전체");
                          setHistoryChapterFilter("전체");
                          setHistorySearchTerm("");
                        }}
                        className="h-8 px-3 text-xs text-gray-600 border-gray-300 hover:bg-red-50 hover:text-red-600 hover:border-red-300 w-full md:w-auto"
                      >
                        모든 필터 해제
                      </Button>
                    </div>
                  )}
                </div>

                {!hasActiveFilter ? (
                  <div className="border rounded-lg p-8 text-center bg-gray-50">
                    <div className="flex flex-col items-center space-y-3">
                      <UserX className="w-12 h-12 text-gray-400" />
                      <div className="text-gray-700 font-medium text-sm md:text-base">
                        탈퇴 멤버 목록을 보려면 필터를 선택하세요
                      </div>
                      <div className="text-gray-500 text-xs md:text-sm">
                        위의 필터에서 지역, 챕터를 선택하거나 멤버명을 검색하면 해당 멤버 목록이 표시됩니다.
                      </div>
                    </div>
                  </div>
                ) : filteredWithdrawalHistory.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8">
                    <Users className="w-12 h-12 text-gray-400 mb-4" />
                    <p className="text-gray-600 font-medium">검색 결과가 없습니다</p>
                    <p className="text-gray-500 text-sm mt-1">다른 조건으로 검색해보세요.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* 데스크톱: 테이블 형태 */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-3 px-4 font-medium text-gray-700">탈퇴일시</th>
                            <th className="text-left py-3 px-4 font-medium text-gray-700">이메일</th>
                            <th className="text-left py-3 px-4 font-medium text-gray-700">지역</th>
                            <th className="text-left py-3 px-4 font-medium text-gray-700">챕터</th>
                            <th className="text-left py-3 px-4 font-medium text-gray-700">멤버명</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredWithdrawalHistory.map((item: WithdrawalHistoryItem, index: number) => (
                            <tr key={`withdrawal-${item.email}-${index}`} className="border-b hover:bg-gray-50">
                              <td className="py-3 px-4 text-sm">{item.withdrawalTime}</td>
                              <td className="py-3 px-4 text-sm">{item.email}</td>
                              <td className="py-3 px-4 text-sm">{item.region}</td>
                              <td className="py-3 px-4 text-sm">{item.chapter}</td>
                              <td className="py-3 px-4 text-sm">
                                <div className="flex items-center gap-2">
                                  {item.memberName}
                                  <button
                                    onClick={async () => {
                                      if (!confirm(`'${item.memberName}' (${item.email}) 멤버를 복원하시겠습니까?`)) return;
                                      try {
                                        const resp = await apiRequest('POST', '/api/admin/restore-member', {
                                          email: item.email,
                                          region: item.region,
                                          chapter: item.chapter,
                                          memberName: item.memberName,
                                        });
                                        const data = await resp.json();
                                        if (data.success) {
                                          toast({ title: `${item.memberName} 멤버가 복원되었습니다` });
                                          queryClient.invalidateQueries({ queryKey: ['/api/admin/withdrawal-history'] });
                                          queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
                                        } else {
                                          alert(data.message || '복원 실패');
                                        }
                                      } catch (err: any) {
                                        alert(err.message || '복원 중 오류');
                                      }
                                    }}
                                    className="text-[10px] bg-green-600 hover:bg-green-700 text-white px-2 py-0.5 rounded font-semibold transition-colors"
                                  >
                                    복원
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* 모바일: 카드 형태 */}
                    <div className="md:hidden space-y-3">
                      {filteredWithdrawalHistory.map((item: WithdrawalHistoryItem, index: number) => (
                        <div key={`withdrawal-mobile-${item.email}-${index}`} className="bg-gray-50 rounded-lg p-4 border">
                          <div className="space-y-2">
                            <p className="text-sm"><span className="text-gray-500">탈퇴일시:</span> {item.withdrawalTime}</p>
                            <p className="text-sm"><span className="text-gray-500">이메일:</span> {item.email}</p>
                            <p className="text-sm"><span className="text-gray-500">지역:</span> {item.region}</p>
                            <p className="text-sm"><span className="text-gray-500">챕터:</span> {item.chapter}</p>
                            <p className="text-sm"><span className="text-gray-500">멤버명:</span> {item.memberName}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* 탈퇴된 사용자 복원 섹션 */}
            {withdrawnUsers.length > 0 && (
              <>
                <Separator />
                <div>
                  <div className="flex items-center space-x-2 mb-4">
                    <UserX className="w-5 h-5 text-red-600" />
                    <h3 className="text-lg font-medium">탈퇴 처리된 멤버 복원</h3>
                  </div>

                  {/* 탈퇴 사용자 필터 */}
                  <div className="flex flex-wrap gap-4 p-4 bg-gray-50 rounded-lg border mb-4">
                    <div className="flex items-center space-x-2 w-full md:w-auto">
                      <label className="text-sm font-medium text-gray-700 whitespace-nowrap">지역:</label>
                      <div className="flex-1 md:w-40">
                        <select
                          value={withdrawnRegionFilter}
                          onChange={(e) => { setWithdrawnRegionFilter(e.target.value); setWithdrawnChapterFilter("__all__"); }}
                          className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                        >
                          <option value="__all__">전체</option>
                          {withdrawnUniqueRegions.map((region) => (
                            <option key={region} value={region}>{region}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2 w-full md:w-auto">
                      <label className="text-sm font-medium text-gray-700 whitespace-nowrap">챕터:</label>
                      <div className="flex-1 md:w-40">
                        <select
                          value={withdrawnChapterFilter}
                          onChange={(e) => { setWithdrawnChapterFilter(e.target.value); setWithdrawnRegionFilter("__all__"); }}
                          className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                        >
                          <option value="__all__">전체</option>
                          {withdrawnUniqueChapters.map((chapter) => (
                            <option key={chapter} value={chapter}>{chapter}</option>
                          ))}
                        </select>
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

                  {(withdrawnRegionFilter === '__all__' && withdrawnChapterFilter === '__all__') ? (
                    <div className="border rounded-lg p-8 text-center bg-gray-50">
                      <div className="flex flex-col items-center space-y-3">
                        <Users className="w-12 h-12 text-gray-400" />
                        <div className="text-gray-700 font-medium text-sm md:text-base">
                          멤버 목록을 보려면 필터를 선택하세요
                        </div>
                        <div className="text-gray-500 text-xs md:text-sm">
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
                          <div className="w-[60px] flex-shrink-0"></div>
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
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* 챕터 관리 다이얼로그 (생성 + 삭제) */}
      <Dialog open={showAddChapterDialog} onOpenChange={setShowAddChapterDialog}>
        <DialogContent className="max-w-lg bg-white">
          <DialogHeader>
            <DialogTitle className="flex items-center text-lg">
              <Plus className="mr-2 w-5 h-5 text-red-600" />
              챕터 관리
            </DialogTitle>
            <DialogDescription className="text-gray-500">챕터를 생성하거나 기존 챕터를 삭제합니다</DialogDescription>
          </DialogHeader>

          {/* 기존 챕터 목록 */}
          <div className="border rounded-md max-h-48 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">챕터명</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {(chapters as string[]).length === 0 ? (
                  <tr><td colSpan={2} className="px-3 py-4 text-center text-gray-400">등록된 챕터가 없습니다</td></tr>
                ) : (chapters as string[]).map((ch: string) => (
                  <tr key={ch} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2">{ch}</td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 h-7 px-2"
                        onClick={async () => {
                          if (!confirm(`'${ch}' 챕터를 삭제하시겠습니까?`)) return;
                          try {
                            const resp = await apiRequest('DELETE', '/api/admin/delete-chapter', {
                              chapter: ch,
                              adminEmail: currentUser?.email || 'admin',
                            });
                            const data = await resp.json();
                            if (data.success) {
                              toast({ title: data.message });
                              queryClient.invalidateQueries({ queryKey: ['/api/admin/chapters'] });
                            } else {
                              alert(data.message || '삭제 실패');
                            }
                          } catch (err: any) {
                            alert(err.message || '삭제 중 오류');
                          }
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 새 챕터 생성 폼 */}
          <div className="border-t pt-4 mt-2 space-y-3">
            <p className="text-sm font-medium text-gray-700">새 챕터 생성</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">지역 *</label>
                <select
                  value={newChapterRegion}
                  onChange={(e) => setNewChapterRegion(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                >
                  <option value="">선택</option>
                  {(regions as string[]).map((r: string) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">챕터명 *</label>
                <input
                  type="text"
                  value={newChapterName}
                  onChange={(e) => setNewChapterName(e.target.value)}
                  placeholder="챕터명"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
              </div>
            </div>
            <Button
              className="w-full bg-red-600 hover:bg-red-700 text-white"
              onClick={async () => {
                if (!newChapterName.trim() || !newChapterRegion) {
                  alert('챕터명과 지역을 모두 입력해주세요');
                  return;
                }
                try {
                  const resp = await apiRequest('POST', '/api/admin/add-chapter', {
                    chapter: newChapterName.trim(),
                    region: newChapterRegion,
                    adminEmail: currentUser?.email || 'admin',
                  });
                  const data = await resp.json();
                  if (data.success) {
                    toast({ title: data.message });
                    queryClient.invalidateQueries({ queryKey: ['/api/admin/chapters'] });
                    setNewChapterName('');
                    setNewChapterRegion('');
                  } else {
                    alert(data.message || '챕터 추가 실패');
                  }
                } catch (err: any) {
                  alert(err.message || '챕터 추가 중 오류');
                }
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              챕터 생성
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 단일 사용자 추가 다이얼로그 */}
      <AlertDialog open={showAddUserDialog} onOpenChange={setShowAddUserDialog}>
        <AlertDialogContent className="max-w-2xl bg-white border border-gray-200 shadow-2xl admin-member-dialog max-h-[90vh] overflow-y-auto w-[95vw] sm:w-auto">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center">
              <UserPlus className="mr-2 w-5 h-5 text-red-600" />
              관리자 관리
            </AlertDialogTitle>
            <AlertDialogDescription>
              관리자를 추가하거나 기존 관리자를 삭제합니다.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* 기존 관리자 목록 */}
          <div className="border rounded-md max-h-48 overflow-y-auto mb-4">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">이름</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">이메일</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">지역</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">권한</th>
                  <th className="w-16"></th>
                </tr>
              </thead>
              <AdminListBody currentUserEmail={currentUser?.email || ''} queryClient={queryClient} toast={toast} apiRequest={apiRequest} />
            </table>
          </div>

          <Separator />
          <p className="text-sm font-medium text-gray-700 mt-2">새 관리자 추가</p>
          <div className="space-y-6">
            {/* 관리자 추가 폼 */}
              <div className="bg-gray-50 p-4 rounded-lg space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">지역명 *</label>
                    <div className="relative" ref={regionDropdownRef}>
                      <button
                        type="button"
                        onClick={() => setRegionDropdownOpen(!regionDropdownOpen)}
                        className="flex h-10 w-full items-center justify-between rounded-md border border-red-600 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2"
                      >
                        <span className={newUser.region ? 'text-gray-900' : 'text-gray-400'}>
                          {newUser.region || '지역을 선택하세요'}
                        </span>
                        <ChevronDown className="h-4 w-4 opacity-50" />
                      </button>
                      {regionDropdownOpen && (
                        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-y-auto">
                          {isRegionsLoading ? (
                            <div className="px-3 py-2 text-gray-500">지역 목록을 불러오는 중...</div>
                          ) : regions.length > 0 ? (
                            regions.map((region: string) => (
                              <button
                                key={region}
                                type="button"
                                onClick={() => {
                                  setNewUser({...newUser, region});
                                  setRegionDropdownOpen(false);
                                }}
                                className="w-full px-3 py-2 text-left text-gray-900 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                              >
                                {region}
                              </button>
                            ))
                          ) : (
                            <div className="px-3 py-2 text-gray-500">지역 목록이 없습니다</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">담당자명 *</label>
                    <Input
                      placeholder="홍길동"
                      value={newUser.memberName}
                      onChange={(e) => setNewUser({...newUser, memberName: e.target.value})}
                      className="bg-white border-gray-300 placeholder-gray-light"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">ID/이메일 *</label>
                    <Input
                      placeholder="admin@example.com"
                      value={newUser.email}
                      onChange={(e) => setNewUser({...newUser, email: e.target.value})}
                      className="bg-white border-gray-300 placeholder-gray-light"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">PW/비밀번호 (4자리) *</label>
                    <Input
                      placeholder="1234"
                      value={newUser.password}
                      onChange={(e) => setNewUser({...newUser, password: e.target.value})}
                      className="bg-white border-gray-300 placeholder:text-gray-400 text-gray-900"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">AUTH/권한 *</label>
                    <div className="relative" ref={authDropdownRef}>
                      <button
                        type="button"
                        onClick={() => setAuthDropdownOpen(!authDropdownOpen)}
                        className="flex h-10 w-full items-center justify-between rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2"
                      >
                        <span className={newUser.auth ? 'text-gray-900' : 'text-gray-400'}>
                          {newUser.auth === 'Admin' ? 'Admin' : 'Admin'}
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
                            Admin
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <Button 
                  onClick={handleAddAdmin}
                  disabled={addUserMutation.isPending}
                  className="w-full bg-red-600 hover:bg-white hover:text-red-600 hover:border hover:border-red-600 text-white"
                >
                  {addUserMutation.isPending ? "등록 중..." : "관리자 등록"}
                </Button>
              </div>

            {/* CSV 파일 업로드 섹션 - 관리자 추가에서는 미사용 */}
            {false && (
              <div className="bg-gray-50 p-4 rounded-lg space-y-4">
                <p className="text-sm text-red-800 mb-3">
                  하단의 '일괄 등록 양식의 CSV 파일을 업로드하시면, 새로운 멤버의 RPS Board가 생성됩니다.
                </p>
                <ObjectUploader
                  maxFileSize={FILE_CONFIG.MAX_FILE_SIZE_5MB}
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
                    <p><strong>CSV 파일 형식 :</strong> 이메일 | 지역 | 챕터 | 멤버명 | 산업군 | 회사 | 권한(선택) | PW(숫자 4자리)</p>
                    <p>• 이메일 주소는 ID로 사용되며, BNI Connect 시스템에 등록된 정보와 동일합니다.</p>
                    <p>• 지역 형식: BNI Connect 시스템의 지역명 형식으로 입력해주세요.<br />
                      _(ex)"Seoul1 서울1" (영어+숫자 + 한글)</p>
                    <p>• PW는 BNI Connect 시스템에 등록된 멤버의 휴대전화 번호의 뒷 4자리(010-1234-****) 정보를 기본으로 합니다.</p>
                    <p>• 권한(선택사항): Admin, Member 중 선택 - 생략하면 Member로 설정됩니다.</p>
                    <p>• <strong>중요:</strong> 전문분야 & 타겟고객(나의 핵심 고객층)은 멤버가 직접 관리하므로 CSV에서 제외됩니다.</p>
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

      {/* 탈퇴 멤버 삭제 진행중 팝업 */}
      <Dialog open={showWithdrawalProgress} onOpenChange={setShowWithdrawalProgress}>
        <DialogContent className="sm:max-w-md bg-white border border-gray-200 shadow-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-gray-900 font-semibold">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-red-600"></div>
              선택된 멤버 탈퇴 진행중
            </DialogTitle>
            <DialogDescription className="text-gray-600 mt-2">
              선택하신 멤버들의 탈퇴 처리를 진행하고 있습니다.<br />
              잠시만 기다려 주세요...
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>

    </div>
  );
}