import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { scoreboardFormSchema, type ScoreboardForm, type ScoreboardData } from "@shared/schema";
import { Save, Edit, User } from "lucide-react";

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
      const response = await apiRequest("POST", `/api/scoreboard/${userId}`, data);
      return response.json();
    },
    onSuccess: () => {
      // 스코어보드와 프로필 데이터 모두 새로고침
      queryClient.invalidateQueries({ queryKey: ["/api/scoreboard", userId] });
      queryClient.invalidateQueries({ queryKey: ["/api/user-profile", userId] });
      toast({
        title: "저장 완료",
        description: "데이터가 성공적으로 저장되었습니다.",
      });
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
      });
    },
  });

  const onSubmit = (data: ScoreboardForm) => {
    saveMutation.mutate(data);
  };

  const stageOptions = [
    { value: "V", label: "Visibility : 아는단계" },
    { value: "C", label: "Credibility : 신뢰단계" },
    { value: "P", label: "Profit : 수익단계" },
  ];

  const renderPartnerSection = (partnerNumber: number) => (
    <div className="bg-red-50 p-4 rounded-lg border mb-4" style={{ borderColor: '#f5c2c7' }}>
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
                  placeholder="작성예) 홍길동" 
                  className="h-9 placeholder-gray-400"
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
                  placeholder="작성예) 디자이너" 
                  className="h-9 placeholder-gray-400"
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
              <Select onValueChange={field.onChange} value={field.value || ""}>
                <FormControl>
                  <SelectTrigger 
                    className={`h-9 bg-white select-trigger-text ${field.value ? 'has-value' : ''}`} 
                    style={{borderColor: '#d12031'}}
                    data-has-value={field.value ? 'true' : 'false'}
                  >
                    <SelectValue placeholder="" className="select-placeholder" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent className="bg-white border border-gray-200 shadow-lg">
                  <SelectItem value="none" className="text-gray-500 hover:bg-gray-100">
                    선택 안함
                  </SelectItem>
                  {stageOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value} className="text-gray-900 hover:bg-gray-100">
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                        <Input {...field} placeholder="작성예) 서울" readOnly className="bg-gray-50 cursor-not-allowed" />
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
                        <Input {...field} placeholder="작성예) 하이" readOnly className="bg-gray-50 cursor-not-allowed" />
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
                        <Input {...field} placeholder="작성예) JOY" readOnly className="bg-gray-50 cursor-not-allowed" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="specialty"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>전문분야</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="작성예) 디자인" readOnly className="bg-gray-50 cursor-not-allowed" />
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
                        <Input {...field} placeholder="작성예) 디자이너스" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              

            </div>

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
            
            <div className="flex justify-end pt-4 border-t">
              <Button
                type="submit"
                disabled={saveMutation.isPending}
                className="bni-blue hover:bni-dark text-white"
              >
                <Save className="mr-2 w-4 h-4" />
                {saveMutation.isPending ? "저장 중..." : "저장하기"}
              </Button>
            </div>
            
            {/* Achievement Section */}
            {achievementData && (
              <div className="mt-6 pt-6 border-t">
                <div className="bg-white p-6 rounded-lg shadow">
                  <h2 className="text-lg font-semibold text-gray-800 mb-4">달성률</h2>
                  
                  {/* Top row: Achievement Ring + Stats */}
                  <div className="flex items-start gap-8 mb-6">
                    {/* Left: Achievement Ring (a이미지) */}
                    <div className="flex-shrink-0">
                      <div className="relative w-32 h-32">
                        <svg className="w-32 h-32 transform -rotate-90" viewBox="0 0 36 36">
                          <path
                            d="M18 2.0845
                              a 15.9155 15.9155 0 0 1 0 31.831
                              a 15.9155 15.9155 0 0 1 0 -31.831"
                            fill="none"
                            stroke="#f3f4f6"
                            strokeWidth="2"
                          />
                          <path
                            d="M18 2.0845
                              a 15.9155 15.9155 0 0 1 0 31.831
                              a 15.9155 15.9155 0 0 1 0 -31.831"
                            fill="none"
                            stroke="#d12031"
                            strokeWidth="2"
                            strokeDasharray={`${achievementData.percentage}, 100`}
                            className="drop-shadow-sm"
                          />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="text-center">
                            <div className="text-2xl font-bold text-gray-800">{achievementData.percentage}%</div>
                            <div className="text-xs text-gray-500 mt-1">
                              {achievementData.profitable}/4
                            </div>
                          </div>
                        </div>
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