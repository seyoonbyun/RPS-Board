import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { scoreboardFormSchema, type ScoreboardForm, type ScoreboardData } from "@shared/schema";
import { Save, Eye, Edit, UserCircle2, Lock } from "lucide-react";

interface PartnerFormProps {
  userId: string;
  initialData?: ScoreboardData | null;
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

export default function PartnerForm({ userId, initialData, onDataSaved }: PartnerFormProps) {
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
      region: userProfile?.region || initialData?.region || "",
      userIdField: userProfile?.targetCustomer || initialData?.userIdField || "",
      partner: userProfile?.chapter || initialData?.partner || "",
      memberName: userProfile?.memberName || initialData?.memberName || "",
      specialty: userProfile?.specialty || initialData?.specialty || "",
      targetCustomer: initialData?.targetCustomer || "",
      rpartner1: userProfile?.rpartner1 || initialData?.rpartner1 || "",
      rpartner1Specialty: userProfile?.rpartner1Specialty || initialData?.rpartner1Specialty || "",
      rpartner1Stage: userProfile?.rpartner1Stage || initialData?.rpartner1Stage || "",
      rpartner2: userProfile?.rpartner2 || initialData?.rpartner2 || "",
      rpartner2Specialty: userProfile?.rpartner2Specialty || initialData?.rpartner2Specialty || "",
      rpartner2Stage: userProfile?.rpartner2Stage || initialData?.rpartner2Stage || "",
      rpartner3: userProfile?.rpartner3 || initialData?.rpartner3 || "",
      rpartner3Specialty: userProfile?.rpartner3Specialty || initialData?.rpartner3Specialty || "",
      rpartner3Stage: userProfile?.rpartner3Stage || initialData?.rpartner3Stage || "",
      rpartner4: userProfile?.rpartner4 || initialData?.rpartner4 || "",
      rpartner4Specialty: userProfile?.rpartner4Specialty || initialData?.rpartner4Specialty || "",
      rpartner4Stage: userProfile?.rpartner4Stage || initialData?.rpartner4Stage || "",
    },
  });

  // Reset form when userProfile data is loaded
  React.useEffect(() => {
    if (userProfile && !isProfileLoading) {
      form.reset({
        region: userProfile.region || "",
        userIdField: userProfile.targetCustomer || "",
        partner: userProfile.chapter || "",
        memberName: userProfile.memberName || "",
        specialty: userProfile.specialty || "",
        targetCustomer: initialData?.targetCustomer || "",
        rpartner1: userProfile.rpartner1 || "",
        rpartner1Specialty: userProfile.rpartner1Specialty || "",
        rpartner1Stage: userProfile.rpartner1Stage || "",
        rpartner2: userProfile.rpartner2 || "",
        rpartner2Specialty: userProfile.rpartner2Specialty || "",
        rpartner2Stage: userProfile.rpartner2Stage || "",
        rpartner3: userProfile.rpartner3 || "",
        rpartner3Specialty: userProfile.rpartner3Specialty || "",
        rpartner3Stage: userProfile.rpartner3Stage || "",
        rpartner4: userProfile.rpartner4 || "",
        rpartner4Specialty: userProfile.rpartner4Specialty || "",
        rpartner4Stage: userProfile.rpartner4Stage || "",
      });
    }
  }, [userProfile, isProfileLoading, form, initialData]);

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
        description: "데이터가 성공적으로 저장되고 구글 시트에 자동 동기화되었습니다.",
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
    { value: "V", label: "V (Visibility) - 아는 단계" },
    { value: "C", label: "C (Credibility) - 신뢰 단계" },
    { value: "P", label: "P (Profit) - 수익 단계" },
  ];

  return (
    <Card className="shadow-lg print-friendly">
      <CardContent className="p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-6 flex items-center">
          <Edit className="text-blue-500 mr-3 w-5 h-5" />
          리퍼럴 파트너 정보 입력
        </h2>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            {/* Basic Info Section */}
            <div className="space-y-4">
              <h3 className="text-md font-medium text-gray-800 border-b pb-2 flex items-center">
                <UserCircle2 className="text-gray-500 mr-2 w-4 h-4" />
                기본 정보
              </h3>
              
              {/* Read-only profile information from Google Sheets */}
              {isProfileLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="animate-pulse h-10 bg-gray-200 rounded"></div>
                  <div className="animate-pulse h-10 bg-gray-200 rounded"></div>
                  <div className="animate-pulse h-10 bg-gray-200 rounded"></div>
                  <div className="animate-pulse h-10 bg-gray-200 rounded"></div>
                  <div className="animate-pulse h-10 bg-gray-200 rounded"></div>
                  <div className="animate-pulse h-10 bg-gray-200 rounded md:col-span-2 lg:col-span-3"></div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700 flex items-center">
                      <Lock className="w-3 h-3 mr-1 text-gray-400" />
                      지역 (구글 시트 연동)
                    </label>
                    <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-gray-600">
                      {userProfile?.region || '정보 없음'}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700 flex items-center">
                      <Lock className="w-3 h-3 mr-1 text-gray-400" />
                      챕터 (구글 시트 연동)
                    </label>
                    <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-gray-600">
                      {userProfile?.chapter || '정보 없음'}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700 flex items-center">
                      <Lock className="w-3 h-3 mr-1 text-gray-400" />
                      나의 리펀 서비스 (구글 시트 연동)
                    </label>
                    <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-gray-600">
                      {userProfile?.targetCustomer || '정보 없음'}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700 flex items-center">
                      <Lock className="w-3 h-3 mr-1 text-gray-400" />
                      멤버 (구글 시트 연동)
                    </label>
                    <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-gray-600">
                      {userProfile?.memberName || '정보 없음'}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700 flex items-center">
                      <Lock className="w-3 h-3 mr-1 text-gray-400" />
                      업태명 (구글 시트 연동)
                    </label>
                    <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-gray-600">
                      {userProfile?.specialty || '정보 없음'}
                    </div>
                  </div>

                  <FormField
                    control={form.control}
                    name="targetCustomer"
                    render={({ field }) => (
                      <FormItem className="md:col-span-2 lg:col-span-3">
                        <FormLabel>타겟고객</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="예: 중소기업 대표" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}
            </div>

            {/* Referral Partners Section */}
            <div className="space-y-6">
              <h3 className="text-md font-medium text-gray-800 border-b pb-2 flex items-center">
                <UserCircle2 className="text-gray-500 mr-2 w-4 h-4" />
                리퍼럴 파트너 정보
              </h3>

              {[1, 2, 3, 4].map((num) => (
                <div key={num} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                  <h4 className="font-medium text-gray-700 mb-4 flex items-center">
                    <span className="w-6 h-6 bni-blue text-white rounded-full flex items-center justify-center text-xs mr-2">
                      {num}
                    </span>
                    R파트너 {num}
                  </h4>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FormField
                      control={form.control}
                      name={`rpartner${num}` as keyof ScoreboardForm}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>파트너명</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value || ""} placeholder={`R파트너 ${num}`} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name={`rpartner${num}Specialty` as keyof ScoreboardForm}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>전문분야</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value || ""} placeholder="전문분야" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name={`rpartner${num}Stage` as keyof ScoreboardForm}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>관계 단계</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || undefined}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="선택하세요" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {stageOptions.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
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
              ))}
            </div>

            {/* Action Buttons */}
            <div className="pt-6 border-t flex flex-col sm:flex-row gap-4">
              <Button
                type="submit"
                className="flex-1 bni-blue hover:bni-dark text-white transition-all duration-200 transform hover:scale-105"
                disabled={saveMutation.isPending}
              >
                <Save className="mr-2 w-4 h-4" />
                {saveMutation.isPending ? "저장 중..." : "데이터 저장"}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
