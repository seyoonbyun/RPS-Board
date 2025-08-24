import React, { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { scoreboardFormSchema, type ScoreboardForm, type ScoreboardData } from "@shared/schema";
import { Save, Edit, User, ExternalLink, Trash2, ChevronDown } from "lucide-react";

interface PartnerFormProps {
  userId: string;
  initialData?: ScoreboardData | null;
  achievementData?: {
    percentage: number;
    profitable: number;
    credible: number;
    visible: number;
    total: number;
  };
  onDataSaved: () => void;
}

interface UserProfile {
  email: string;
  region: string;
  chapter: string;
  memberName: string;
  industry: string;
  company: string;
  specialty: string;
  targetCustomer: string;
  rpartner1: string;
  rpartner1Specialty: string;
  rpartner1Stage: string;
  rpartner2: string;
  rpartner2Specialty: string;
  rpartner2Stage: string;
  rpartner3: string;
  rpartner3Specialty: string;
  rpartner3Stage: string;
  rpartner4: string;
  rpartner4Specialty: string;
  rpartner4Stage: string;
  totalPartners: string;
  achievement: string;
}

export default function PartnerForm({ userId, initialData, achievementData, onDataSaved }: PartnerFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [stageDropdowns, setStageDropdowns] = useState<{[key: string]: boolean}>({});
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const dropdownRefs = useRef<{[key: string]: HTMLDivElement | null}>({});

  // ESC 키 감지를 위한 useEffect
  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (deleteDialogOpen && event.key === 'Escape') {
        setDeleteDialogOpen(false);
      }
    };

    if (deleteDialogOpen) {
      document.addEventListener('keydown', handleEscapeKey);
    }

    return () => {
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [deleteDialogOpen]);

  // 드롭다운 바깥 영역 클릭 감지
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      Object.keys(stageDropdowns).forEach((key) => {
        if (stageDropdowns[key] && dropdownRefs.current[key] && !dropdownRefs.current[key]?.contains(event.target as Node)) {
          setStageDropdowns(prev => ({ ...prev, [key]: false }));
        }
      });
    };

    const hasOpenDropdown = Object.values(stageDropdowns).some(isOpen => isOpen);
    if (hasOpenDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [stageDropdowns]);

  // Fetch user profile from Google Sheets
  const { data: userProfile, isLoading: isProfileLoading } = useQuery<UserProfile>({
    queryKey: ["/api/user-profile", userId],
    retry: false,
  });

  const form = useForm<ScoreboardForm>({
    resolver: zodResolver(scoreboardFormSchema),
    defaultValues: {
      region: "",
      userIdField: "",
      partner: "",
      memberName: "",
      industry: "",
      company: "",
      specialty: "",
      targetCustomer: "",
      rpartner1: "",
      rpartner1Specialty: "",
      rpartner1Stage: "",
      rpartner2: "",
      rpartner2Specialty: "",
      rpartner2Stage: "",
      rpartner3: "",
      rpartner3Specialty: "",
      rpartner3Stage: "",
      rpartner4: "",
      rpartner4Specialty: "",
      rpartner4Stage: "",
    },
  });

  // Reset form when userProfile data is loaded
  React.useEffect(() => {
    if (userProfile && !isProfileLoading) {
      // Convert full stage names back to short forms for the form
      const convertStageToShort = (stage: string) => {
        if (stage?.includes('Profit')) return 'P';
        if (stage?.includes('Credibility')) return 'C';
        if (stage?.includes('Visibility')) return 'V';
        return stage || 'none';
      };

      form.reset({
        region: userProfile.region || "",
        userIdField: userProfile.targetCustomer || "",
        partner: userProfile.chapter || "",
        memberName: userProfile.memberName || "",
        industry: userProfile.industry || "",
        company: userProfile.company || "",
        specialty: userProfile.specialty || "",
        targetCustomer: userProfile.targetCustomer || "",
        rpartner1: userProfile.rpartner1 || "",
        rpartner1Specialty: userProfile.rpartner1Specialty || "",
        rpartner1Stage: convertStageToShort(userProfile.rpartner1Stage),
        rpartner2: userProfile.rpartner2 || "",
        rpartner2Specialty: userProfile.rpartner2Specialty || "",
        rpartner2Stage: convertStageToShort(userProfile.rpartner2Stage),
        rpartner3: userProfile.rpartner3 || "",
        rpartner3Specialty: userProfile.rpartner3Specialty || "",
        rpartner3Stage: convertStageToShort(userProfile.rpartner3Stage),
        rpartner4: userProfile.rpartner4 || "",
        rpartner4Specialty: userProfile.rpartner4Specialty || "",
        rpartner4Stage: convertStageToShort(userProfile.rpartner4Stage),
      });
    }
  }, [userProfile, isProfileLoading, form]);



  const saveMutation = useMutation({
    mutationFn: async (data: ScoreboardForm) => {
      console.log('🔄 Saving form data:', data);
      const response = await apiRequest("POST", `/api/scoreboard/${userId}`, data);
      return response.json();
    },
    onSuccess: (data) => {
      console.log('✅ Save successful! Response data:', {
        specialty: data.specialty,
        targetCustomer: data.targetCustomer,
        updatedAt: data.updatedAt
      });
      
      // 저장 완료 팝업 표시 - 3초 후 자동 사라짐
      toast({
        title: "저장 완료 ✅",
        description: "파워팀 데이터가 대표님의 RPS 보드에 성공적으로 업데이트 되었습니다.",
        duration: 2500, // 2.5초로 설정하여 3초 이내 보장
      });
      
      // 백그라운드에서 데이터 새로고침 (팝업 표시에 영향주지 않음)
      onDataSaved();
    },
    onError: (error: any) => {
      const errorMessage = error.message || "데이터 저장에 실패했습니다";
      toast({
        title: "저장 실패",
        description: errorMessage.includes("Google Sheets") 
          ? "데이터는 저장되었지만 구글 시트 동기화에 실패했습니다" 
          : errorMessage,
        variant: "destructive",
        duration: 2500, // 2.5초로 설정하여 3초 이내 보장
      });
    },
  });

  const withdrawalMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("DELETE", `/api/user-withdrawal/${userId}`, {});
      return response.json();
    },
    onSuccess: (data) => {
      toast({ 
        title: "대표님의 파워팀 RPS 계정이 삭제되었습니다", 
        description: "소중한 시간을 함께 나눌 수 있어 감사했습니다.\n앞으로의 모든 여정이 평안하고 따뜻하길 바랍니다 :)",
        duration: 2500
      });
      
      // 3초 후 로그인 창으로 리다이렉트
      setTimeout(() => {
        localStorage.removeItem('user');
        window.location.href = '/';
      }, 3000);
    },
    onError: (error) => {
      console.error("Withdrawal error:", error);
      toast({ 
        title: "탈퇴 실패", 
        description: "탈퇴 처리 중 오류가 발생했습니다.",
        variant: "destructive",
        duration: 2500 
      });
    },
  });

  // 수동 저장 방식으로 변경

  const onSubmit = (data: ScoreboardForm) => {
    console.log('🔄 Form submission:', {
      specialty: data.specialty,
      targetCustomer: data.targetCustomer
    });
    saveMutation.mutate(data);
  };

  const stageOptions = [
    { value: "V", label: "Visibility : 아는단계" },
    { value: "C", label: "Credibility : 신뢰단계" },
    { value: "P", label: "Profit : 수익단계" },
  ];

  const renderPartnerSection = (partnerNumber: number) => (
    <div className={`bg-red-50 p-4 rounded-lg border mb-4 ${partnerNumber === 3 ? 'rpartner-3-section' : ''}`} style={{ borderColor: '#f5c2c7' }}>
      <div className="flex items-center mb-3">
        <div className="w-6 h-6 text-white rounded-full flex items-center justify-center text-sm font-bold mr-2" style={{ backgroundColor: '#d12031' }}>
          {partnerNumber}
        </div>
        <h3 className="text-sm font-medium" style={{ color: '#d12031' }}>R파트너 {partnerNumber}</h3>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <FormField
          control={form.control}
          name={`rpartner${partnerNumber}` as keyof ScoreboardForm}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-gray-600">파트너명</FormLabel>
              <FormControl>
                <Input 
                  {...field} 
                  value={field.value || ""}
                  placeholder="홍길동" 
                  className="h-9 placeholder-gray-400 bg-white"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name={`rpartner${partnerNumber}Specialty` as keyof ScoreboardForm}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-gray-600">전문분야</FormLabel>
              <FormControl>
                <Input 
                  {...field} 
                  value={field.value || ""}
                  placeholder="디자이너" 
                  className="h-9 placeholder-gray-400 bg-white"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name={`rpartner${partnerNumber}Stage` as keyof ScoreboardForm}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-gray-600">관계 단계</FormLabel>
              <FormControl>
                <div className="relative" ref={(el) => dropdownRefs.current[`stage${partnerNumber}`] = el}>
                  <button
                    type="button"
                    onClick={() => setStageDropdowns(prev => ({...prev, [`stage${partnerNumber}`]: !prev[`stage${partnerNumber}`]}))}
                    className="flex h-9 w-full items-center justify-between rounded-md border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2"
                    style={{borderColor: '#d12031'}}
                  >
                    <span className={field.value ? 'text-gray-900' : 'text-gray-400'}>
                      {field.value ? 
                        (field.value === 'none' ? '선택 안함' :
                         stageOptions.find(opt => opt.value === field.value)?.label || field.value) 
                        : ''}
                    </span>
                    <ChevronDown className="h-4 w-4 opacity-50" />
                  </button>
                  {stageDropdowns[`stage${partnerNumber}`] && (
                    <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg">
                      <div 
                        className="px-3 py-2 text-sm cursor-pointer hover:bg-red-600 hover:text-white transition-colors text-gray-500"
                        onClick={() => {
                          field.onChange('none');
                          setStageDropdowns(prev => ({...prev, [`stage${partnerNumber}`]: false}));
                        }}
                      >
                        선택 안함
                      </div>
                      {stageOptions.map((option) => (
                        <div 
                          key={option.value}
                          className="px-3 py-2 text-sm cursor-pointer hover:bg-red-600 hover:text-white transition-colors text-gray-900"
                          onClick={() => {
                            field.onChange(option.value);
                            setStageDropdowns(prev => ({...prev, [`stage${partnerNumber}`]: false}));
                          }}
                        >
                          {option.label}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </div>
  );

  return (
    <Card className="w-full border" style={{ borderColor: '#d12031' }}>
      <CardHeader className="pb-3">
        <div className="flex items-center space-x-2">
          <Edit className="w-5 h-5 text-blue-600" />
          <CardTitle className="text-lg">나의 파워팀 정보</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* 인쇄용 섹션 제목 2: 나의 파워팀 정보 - 나의 정보 */}
            <div className="print-only print-section-title print-my-info-section">2. 나의 파워팀 정보 - 나의 정보</div>
            
            {/* 기본 정보 섹션 */}
            <div className="space-y-4">
              <div className="flex items-center space-x-2 mb-4">
                <User className="w-4 h-4 text-gray-600" />
                <h3 className="text-base font-medium text-gray-800">나의 정보</h3>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="region"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>지역</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="작성예) 서울" readOnly className="bg-gray-50 cursor-not-allowed" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="partner"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>챕터</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="작성예) 하이" readOnly className="bg-gray-50 cursor-not-allowed" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="memberName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>멤버명</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="작성예) JOY" readOnly className="bg-gray-50 cursor-not-allowed" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="industry"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>산업군 <span className="text-xs text-gray-500">_BNI 커넥트 기준</span></FormLabel>
                      <FormControl>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Input 
                                {...field} 
                                value={field.value || ""} 
                                placeholder="BNI Connect 산업 대분류" 
                                readOnly 
                                className="bg-gray-50 cursor-not-allowed truncate"
                              />
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">
                              <p className="whitespace-normal">{field.value || "BNI Connect 산업 대분류"}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="company"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>회사명</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="회사명" readOnly className="bg-gray-50 cursor-not-allowed" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 specialty-section">
                <FormField
                  control={form.control}
                  name="specialty"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>전문분야 <span className="text-xs text-gray-500">_※챕터 경청표에 기재하는 나의 전문분야.</span></FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="챕터 경청표_나의 전문분야" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="targetCustomer"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>나의 핵심 고객층</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="나의 핵심 고객 전문분야" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              
              {/* 저장 안내 메시지 */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-4">
                <p className="text-sm text-blue-800">
                  💡 <strong>저장 방법:</strong> 모든 정보 수정 후 아래 "제출하기" 버튼을 눌러야 변경사항이 저장됩니다.
                </p>
              </div>
              

            </div>

            {/* 인쇄용 섹션 제목 3: 나의 리퍼럴 파트너 정보 입력 */}
            <div className="print-only print-section-title print-partner-form-section">3. 나의 리퍼럴 파트너 정보 입력</div>
            
            {/* 나의 리퍼럴 파트너 정보 섹션 */}
            <div className="space-y-4 pt-6 border-t">
              <div className="flex items-center space-x-2 mb-4">
                <User className="w-4 h-4 text-gray-600" />
                <h3 className="text-base font-medium text-gray-800">나의 리퍼럴 파트너 정보 입력</h3>
              </div>
              
              <div className="space-y-0">
                {[1, 2, 3, 4].map((partnerNumber) => (
                  <div key={partnerNumber}>
                    {renderPartnerSection(partnerNumber)}
                  </div>
                ))}
              </div>
            </div>
            
            {/* 저장 버튼 */}
            <div className="pt-4 border-t submit-button-section">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                <p className="text-sm text-amber-800">
                  ⚠️ <strong>중요:</strong> 위의 모든 정보를 수정한 후 반드시 "제출하기" 버튼을 눌러야 변경사항이 저장됩니다.
                </p>
              </div>
              <Button
                type="submit"
                disabled={saveMutation.isPending}
                variant="outline"
                className="w-full border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300"
              >
                {saveMutation.isPending ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-600 mr-2"></div>
                    나의 RPS 보드에 업데이트 중...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 w-4 h-4" />
                    제출하기
                  </>
                )}
              </Button>
            </div>
            
            {/* Achievement Section */}
            {/* 인쇄용 섹션 제목 4: 달성률 */}
            <div className="print-only print-section-title print-achievement-section">4. 달성률</div>
            
            {achievementData && (
              <div className="mt-2">
                <div className="bg-white p-6 rounded-lg shadow">
                  <h2 className="text-lg font-semibold text-gray-800 mb-4">달성률</h2>
                  
                  {/* 데스크톱 레이아웃: Achievement Ring + Stats */}
                  <div className="hidden md:flex items-start gap-8 mb-6">
                    {/* Left: Achievement Ring (a이미지) */}
                    <div className="flex-shrink-0">
                      <div className="relative w-32 h-32">
                        <svg className="w-32 h-32" viewBox="0 0 36 36">
                          {/* Background circle */}
                          <path
                            d="M18 2.0845
                              a 15.9155 15.9155 0 0 1 0 31.831
                              a 15.9155 15.9155 0 0 1 0 -31.831"
                            fill="none"
                            stroke="#f3f4f6"
                            strokeWidth="2"
                            transform="rotate(-90 18 18)"
                          />
                          {/* Progress circle */}
                          <path
                            d="M18 2.0845
                              a 15.9155 15.9155 0 0 1 0 31.831
                              a 15.9155 15.9155 0 0 1 0 -31.831"
                            fill="none"
                            stroke="#d12031"
                            strokeWidth="2"
                            strokeDasharray={`${achievementData.percentage}, 100`}
                            transform="rotate(-90 18 18)"
                            className="drop-shadow-sm"
                          />
                          {/* SVG text elements - guaranteed to print */}
                          <text 
                            x="18" 
                            y="15" 
                            textAnchor="middle" 
                            dominantBaseline="central"
                            fill="black" 
                            fontSize="7.5" 
                            fontWeight="bold"
                            style={{ 
                              fill: 'black',
                              WebkitPrintColorAdjust: 'exact',
                              printColorAdjust: 'exact'
                            }}
                          >
                            {achievementData.percentage}%
                          </text>
                          <text 
                            x="18" 
                            y="22" 
                            textAnchor="middle" 
                            dominantBaseline="central"
                            fill="black" 
                            fontSize="3.75"
                            style={{ 
                              fill: 'black',
                              WebkitPrintColorAdjust: 'exact',
                              printColorAdjust: 'exact'
                            }}
                          >
                            {achievementData.profitable}/4
                          </text>
                        </svg>
                      </div>
                    </div>
                    
                    {/* Right: Partner Stats (b이미지) */}
                    <div className="flex-1 space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600 text-sm">수익 파트너 (P)</span>
                        <span className="font-medium text-emerald-600">{achievementData.profitable}명</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600 text-sm">신뢰 파트너 (C)</span>
                        <span className="font-medium text-orange-600">{achievementData.credible}명</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600 text-sm">인지 파트너 (V)</span>
                        <span className="font-medium text-yellow-600">{achievementData.visible}명</span>
                      </div>
                    </div>
                  </div>
                  
                  {/* 모바일 레이아웃: 원형 차트 중앙, 그 아래 V,C,P 한 줄로 배치 */}
                  <div className="md:hidden mb-6 space-y-4">
                    {/* 원형 차트 중앙 배치 */}
                    <div className="flex justify-center">
                      <div className="relative w-32 h-32">
                        <svg className="w-32 h-32" viewBox="0 0 36 36">
                          {/* Background circle */}
                          <path
                            d="M18 2.0845
                              a 15.9155 15.9155 0 0 1 0 31.831
                              a 15.9155 15.9155 0 0 1 0 -31.831"
                            fill="none"
                            stroke="#f3f4f6"
                            strokeWidth="2"
                            transform="rotate(-90 18 18)"
                          />
                          {/* Progress circle */}
                          <path
                            d="M18 2.0845
                              a 15.9155 15.9155 0 0 1 0 31.831
                              a 15.9155 15.9155 0 0 1 0 -31.831"
                            fill="none"
                            stroke="#d12031"
                            strokeWidth="2"
                            strokeDasharray={`${achievementData.percentage}, 100`}
                            transform="rotate(-90 18 18)"
                            className="drop-shadow-sm"
                          />
                          {/* SVG text elements - guaranteed to print */}
                          <text 
                            x="18" 
                            y="15" 
                            textAnchor="middle" 
                            dominantBaseline="central"
                            fill="black" 
                            fontSize="7.5" 
                            fontWeight="bold"
                            style={{ 
                              fill: 'black',
                              WebkitPrintColorAdjust: 'exact',
                              printColorAdjust: 'exact'
                            }}
                          >
                            {achievementData.percentage}%
                          </text>
                          <text 
                            x="18" 
                            y="22" 
                            textAnchor="middle" 
                            dominantBaseline="central"
                            fill="black" 
                            fontSize="3.75"
                            style={{ 
                              fill: 'black',
                              WebkitPrintColorAdjust: 'exact',
                              printColorAdjust: 'exact'
                            }}
                          >
                            {achievementData.profitable}/4
                          </text>
                        </svg>
                      </div>
                    </div>
                    
                    {/* V, C, P 단계 한 줄로 배치 */}
                    <div className="grid grid-cols-3 gap-0.5">
                      <div className="text-center py-2 px-1 bg-emerald-50 rounded-lg border border-emerald-100 min-h-[60px] flex flex-col justify-center">
                        <div className="text-[10px] leading-tight text-emerald-600 mb-0.5">
                          (P) {achievementData.profitable} 명
                        </div>
                        <div className="text-[9px] leading-tight text-gray-600">수익 파트너</div>
                      </div>
                      <div className="text-center py-2 px-1 bg-orange-50 rounded-lg border border-orange-100 min-h-[60px] flex flex-col justify-center">
                        <div className="text-[10px] leading-tight text-orange-600 mb-0.5">
                          (C) {achievementData.credible} 명
                        </div>
                        <div className="text-[9px] leading-tight text-gray-600">신뢰 파트너</div>
                      </div>
                      <div className="text-center py-2 px-1 bg-yellow-50 rounded-lg border border-yellow-100 min-h-[60px] flex flex-col justify-center">
                        <div className="text-[10px] leading-tight text-yellow-600 mb-0.5">
                          (V) {achievementData.visible} 명
                        </div>
                        <div className="text-[9px] leading-tight text-gray-600">인지 파트너</div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Bottom row: Total Partners (c이미지) */}
                  <div className="pt-4 border-t">
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                          <span className="text-white font-bold text-sm">R</span>
                        </div>
                        <span className="text-green-800 font-medium">나의 총 리퍼럴 파트너 수</span>
                      </div>
                      <span className="font-bold text-xl text-green-800">{achievementData.profitable}명</span>
                    </div>
                    
                    {/* RPI 확인하기 버튼 */}
                    <div className="mt-4 space-y-3 footer-buttons">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => window.open('https://www.powerteam-bnikorea.com/RPI', '_blank')}
                        className="w-full border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300"
                      >
                        <ExternalLink className="mr-2 w-4 h-4" />
                        <span className="hidden md:inline">나의 챕터 RPI (Referral Partner Index) 확인하기</span>
                        <span className="md:hidden">나의 챕터 RPI 확인하기</span>
                      </Button>
                      
                      {/* 탈퇴 버튼 */}
                      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                        <AlertDialogTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full border-gray-300 text-gray-600 hover:bg-gray-50 hover:border-gray-400"
                          >
                            <Trash2 className="mr-2 w-4 h-4" />
                            나의 RPS 계정 삭제하기
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent 
                          className="alert-dialog-content max-w-md border border-gray-300" 
                          style={{borderWidth: '1px'}}
                          onOverlayClick={() => setDeleteDialogOpen(false)}
                        >
                          <AlertDialogHeader>
                            <AlertDialogTitle className="alert-dialog-title">
                              파워팀 계정 삭제
                            </AlertDialogTitle>
                            <AlertDialogDescription className="alert-dialog-description">
                              정말로 계정을 삭제하시겠습니까?
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <div className="py-4">
                            <div className="bg-gray-100 border border-gray-200 rounded-lg p-4">
                              <h4 className="font-semibold text-gray-800 mb-2">
                                계정 삭제 시 다음 작업이 수행됩니다 :
                              </h4>
                              <div className="text-sm text-gray-700 mb-3">
                                지금까지 기록하신 대표님의 모든 R파트너 데이터가 삭제됩니다.
                              </div>
                              <div className="font-semibold text-center" style={{ color: '#d12031' }}>
                                ⚠️ 이 작업은 되돌릴 수 없습니다
                              </div>
                            </div>
                          </div>
                          <AlertDialogFooter>
                            <AlertDialogCancel 
                              className="alert-dialog-cancel"
                              onClick={() => setDeleteDialogOpen(false)}
                            >
                              취소
                            </AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => {
                                withdrawalMutation.mutate();
                                setDeleteDialogOpen(false);
                              }}
                              disabled={withdrawalMutation.isPending}
                              className="alert-dialog-action-destructive"
                            >
                              {withdrawalMutation.isPending ? "처리 중..." : "계정 삭제 계속하기"}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}