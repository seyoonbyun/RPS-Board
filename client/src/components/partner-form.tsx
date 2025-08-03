import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { scoreboardFormSchema, type ScoreboardForm, type ScoreboardData } from "@shared/schema";
import { Save, Eye, Edit, UserCircle2 } from "lucide-react";

interface PartnerFormProps {
  userId: string;
  initialData?: ScoreboardData | null;
  onDataSaved: () => void;
}

export default function PartnerForm({ userId, initialData, onDataSaved }: PartnerFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<ScoreboardForm>({
    resolver: zodResolver(scoreboardFormSchema),
    defaultValues: {
      region: initialData?.region || "",
      userIdField: initialData?.userIdField || "",
      partner: initialData?.partner || "",
      memberName: initialData?.memberName || "",
      specialty: initialData?.specialty || "",
      targetCustomer: initialData?.targetCustomer || "",
      rpartner1: initialData?.rpartner1 || "",
      rpartner1Specialty: initialData?.rpartner1Specialty || "",
      rpartner1Stage: initialData?.rpartner1Stage || "",
      rpartner2: initialData?.rpartner2 || "",
      rpartner2Specialty: initialData?.rpartner2Specialty || "",
      rpartner2Stage: initialData?.rpartner2Stage || "",
      rpartner3: initialData?.rpartner3 || "",
      rpartner3Specialty: initialData?.rpartner3Specialty || "",
      rpartner3Stage: initialData?.rpartner3Stage || "",
      rpartner4: initialData?.rpartner4 || "",
      rpartner4Specialty: initialData?.rpartner4Specialty || "",
      rpartner4Stage: initialData?.rpartner4Stage || "",
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: ScoreboardForm) => {
      const response = await apiRequest("POST", `/api/scoreboard/${userId}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scoreboard", userId] });
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
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="region"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>지역 <span className="text-red-500">*</span></FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="예: 서울" />
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
                        <Input {...field} value={field.value || ""} placeholder="챕터명" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="userIdField"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>나의 리펀 서비스</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="나의 리펀 서비스" />
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
                      <FormLabel>멤버 <span className="text-red-500">*</span></FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="멤버명" />
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
                      <FormLabel>업태명 <span className="text-red-500">*</span></FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="예: 마케팅" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="targetCustomer"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2 lg:col-span-3">
                      <FormLabel>타겟고객 <span className="text-red-500">*</span></FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="예: 중소기업 대표" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
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
