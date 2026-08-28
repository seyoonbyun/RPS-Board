import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { loginSchema, type LoginForm } from "@shared/schema";
import { BRAND_COLORS, CACHE_CONFIG } from "@shared/constants";
import { Handshake, LogIn } from "lucide-react";
import rpsLogoPath from "@assets/RPS logo 4_1755761676803.png";


/** 서버가 준 실패 사유를 그대로 들고 다니는 오류. */
class LoginError extends Error {
  constructor(public code: string, public serverMessage: string, public status: number) {
    super(serverMessage || code);
    this.name = 'LoginError';
  }
}

/**
 * 실패를 사유별로 안내한다.
 * 예전에는 다섯 가지 실패가 전부 "회원 정보가 확인되지 않습니다" 하나로 나가서,
 * 회원도 오피스도 원인을 말할 수 없었고 그대로 컴플레인이 됐다.
 */
function describeLoginError(error: any): { title: string; description: string } {
  switch (error?.code as string | undefined) {
    case 'BAD_PASSWORD':
      return {
        title: "비밀번호를 확인해주세요",
        description: "4자리 비밀번호가 일치하지 않습니다.\n기억나지 않으시면 담당 오피스에서 바로 확인해드립니다 ! :)",
      };
    case 'NOT_REGISTERED':
      return {
        title: "잠깐 !",
        description: "대표님의 회원 정보가 확인되지 않습니다.\n담당 오피스로 문의해주시면 바로 안내해드리겠습니다 ! :)",
      };
    case 'WITHDRAWN':
      return {
        title: "탈퇴한 계정입니다",
        description: "담당 오피스에 계정 복구를 요청해주세요.",
      };
    case 'RATE_LIMITED':
      return {
        title: "잠시만 기다려주세요",
        description: "같은 장소에서 여러 분이 동시에 로그인하면 잠깐 제한됩니다.\n10초 뒤에 다시 눌러주세요.",
      };
    case 'INVALID_INPUT':
      return {
        title: "입력을 확인해주세요",
        description: "이메일 형식과 4자리 비밀번호를 확인해주세요.",
      };
    case 'SHEET_UNAVAILABLE':
      return {
        title: "일시적인 오류입니다",
        description: "회원 정보를 불러오지 못했습니다. 대표님 계정 문제가 아닙니다.\n잠시 후 다시 시도해주세요.",
      };
    default:
      return {
        title: "연결이 원활하지 않습니다",
        description: "네트워크 상태를 확인하시고 잠시 후 다시 시도해주세요.\n계속되면 담당 오피스로 알려주세요.",
      };
  }
}

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const loginMutation = useMutation({
    mutationFn: async (data: LoginForm) => {
      // 비밀번호는 콘솔에도 남기지 않는다
      console.log('Sending login request for:', data.email);
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        // 서버가 사유(code)를 준다. 이걸 버리면 다시 '원인 모를 실패'로 돌아간다.
        let code = 'UNKNOWN';
        let message = '';
        try {
          const body = await response.json();
          code = body?.code || code;
          message = body?.message || '';
        } catch {
          /* 본문이 JSON 이 아닌 경우(프록시 오류 등) */
        }
        throw new LoginError(code, message, response.status);
      }

      return await response.json();
    },
    onSuccess: (data) => {
      console.log('Login successful:', data);
      localStorage.setItem("bni_user", JSON.stringify(data.user));

      // 관리자 계정도 일반 멤버와 동일하게 /dashboard로 착지.
      // 관리자 패널 진입은 대시보드 우상단 버튼으로만.
      toast({
        title: "로그인 성공",
        description: "BNI 코리아 파워팀 스코어보드에 오신 것을 환영합니다!",
        duration: CACHE_CONFIG.TOAST_DURATION,
      });

      if (data?.degraded) {
        toast({
          title: "읽기 전용으로 접속했습니다",
          description: "지금은 저장 서버 점검 중이라 조회만 됩니다. 입력하신 내용은 저장되지 않습니다.",
          duration: CACHE_CONFIG.TOAST_DURATION,
        });
      }

      setLocation("/dashboard");
    },
    onError: (error: any) => {
      console.error('Login error:', error?.code, error);
      const { title, description } = describeLoginError(error);
      toast({
        title,
        description,
        variant: "destructive",
        duration: CACHE_CONFIG.TOAST_DURATION,
      });
    },
  });



  const onSubmit = (data: LoginForm) => {
    console.log('Form submitted for:', data.email);
    loginMutation.mutate(data);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-4 shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:scale-105" style={{ border: '1px solid #d12031' }}>
        <CardContent className="pt-6">
          <div className="text-center mb-8">
            <div className="w-16 h-8 mx-auto mb-4"></div>
            <div className="mb-2">
              <img 
                src={rpsLogoPath} 
                alt="BNI RPS 로고" 
                className="mx-auto h-16 w-auto object-contain"
              />
            </div>
            <div className="mb-4">
              <p className="font-bold" style={{ fontFamily: 'Arial, sans-serif', color: '#000000', fontSize: '20px' }}>
                <span style={{ color: BRAND_COLORS.PRIMARY }}>R</span>eferral <span style={{ color: BRAND_COLORS.PRIMARY }}>P</span>artner <span style={{ color: BRAND_COLORS.PRIMARY }}>S</span>core Board
              </p>
            </div>
            <div className="w-16 h-1 mx-auto rounded" style={{ backgroundColor: BRAND_COLORS.PRIMARY }}></div>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 login-form" noValidate>
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>이메일 (ID)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="email"
                        placeholder="이메일을 입력하세요"
                        className="login-input"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>비밀번호 (4자리)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="password"
                        maxLength={4}
                        placeholder="4자리 숫자를 입력하세요"
                        className="login-input"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="w-full text-white transition-all duration-200 transform hover:scale-105"
                style={{ backgroundColor: BRAND_COLORS.PRIMARY }}
                disabled={loginMutation.isPending}
              >
                {loginMutation.isPending ? (
                  "로그인 중..."
                ) : (
                  <>
                    <LogIn className="mr-2 w-4 h-4" />
                    로그인
                  </>
                )}
              </Button>
            </form>
          </Form>

          <div className="text-xs text-gray-500 text-center mt-4 space-y-1">
            <p>※ 로그인 정보는 BNI Connect에 등록된 이메일주소를 포함합니다.</p>
            <p>BNI Connect 계정 정보를 토대로 RPS Board가 생성된 멤버에 한해 이용이 가능합니다.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
