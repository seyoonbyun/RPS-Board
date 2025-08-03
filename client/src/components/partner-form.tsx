import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { scoreboardFormSchema, type ScoreboardForm, type ScoreboardData } from "@shared/schema";
import { Save, Edit, User } from "lucide-react";

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
  const [activeTab, setActiveTab] = useState("basic");

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
        return stage || '';
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
    { value: "", label: "단계 선택" },
    { value: "V", label: "Visibility : 아는단계" },
    { value: "C", label: "Credibility : 신뢰단계" },
    { value: "P", label: "Profit : 수익단계" },
  ];

  const renderPartnerSection = (partnerNumber: number) => (
    <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
      <div className="flex items-center mb-3">
        <div className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold mr-2">
          {partnerNumber}
        </div>
        <h3 className="text-sm font-medium text-blue-800">R파트너 {partnerNumber}</h3>
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
                  placeholder="홍길동" 
                  className="h-9"
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
                  placeholder="디자이너" 
                  className="h-9"
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
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="단계 선택" />
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
  );

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-center space-x-2">
          <Edit className="w-5 h-5 text-blue-600" />
          <CardTitle className="text-lg">리퍼럴 파트너 정보 입력</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="basic">기본 정보</TabsTrigger>
                <TabsTrigger value="partners">리퍼럴 파트너 정보</TabsTrigger>
              </TabsList>
              
              <TabsContent value="basic" className="space-y-4 mt-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <FormField
                    control={form.control}
                    name="region"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>지역 (구분 시트 연동)</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="서울" />
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
                        <FormLabel>챕터 (구분 시트 연동)</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="하이" />
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
                        <FormLabel>나의 리퍼럴 서비스 (구분 시트 연동)</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="디자이너스" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="memberName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>멤버 (구분 시트 연동)</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="JOY" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="specialty"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>업태명 (구분 시트 연동)</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="디자인" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                
                <div>
                  <FormField
                    control={form.control}
                    name="userIdField"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>타겟고객</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="예: 중소기업 대표" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </TabsContent>
              
              <TabsContent value="partners" className="space-y-4 mt-6">
                <div className="space-y-4">
                  {[1, 2, 3, 4].map((partnerNumber) => (
                    <div key={partnerNumber}>
                      {renderPartnerSection(partnerNumber)}
                    </div>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
            
            <div className="flex justify-end pt-4 border-t">
              <Button
                type="submit"
                disabled={saveMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Save className="mr-2 w-4 h-4" />
                {saveMutation.isPending ? "저장 중..." : "저장하기"}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}