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
import { Handshake, LogIn } from "lucide-react";
import rpsLogoPath from "@assets/RPS logo 4_1755761676803.png";


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
      console.log('Sending login request with:', data);
      try {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(data),
        });

        console.log('Response status:', response.status);
        console.log('Response headers:', Object.fromEntries(response.headers.entries()));

        if (!response.ok) {
          const errorText = await response.text();
          console.error('Error response body:', errorText);
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const result = await response.json();
        console.log('Login response:', result);
        return result;
      } catch (fetchError) {
        console.error('Fetch error:', fetchError);
        throw fetchError;
      }
    },
    onSuccess: (data) => {
      console.log('Login successful:', data);
      localStorage.setItem("bni_user", JSON.stringify(data.user));
      toast({
        title: "로그인 성공",
        description: "BNI 코리아 파워팀 스코어보드에 오신 것을 환영합니다!",
        duration: 3000,
      });
      setLocation("/dashboard");
    },
    onError: (error: any) => {
      console.error('Login error:', error);
      toast({
        title: "잠깐 !",
        description: "대표님의 회원 정보가 확인되지 않습니다.\n담당 오피스로 문의해주시면 바로 안내해드리겠습니다 ! :)",
        variant: "destructive",
        duration: 3000,
      });
    },
  });



  const onSubmit = (data: LoginForm) => {
    console.log('Form submitted with data:', data);
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
              <p className="text-lg text-gray-600 font-bold" style={{ fontFamily: 'Arial, sans-serif' }}>
                <span style={{ color: '#d12031' }}>R</span>eferral <span style={{ color: '#d12031' }}>P</span>artner <span style={{ color: '#d12031' }}>S</span>core Board
              </p>
            </div>
            <div className="w-16 h-1 mx-auto rounded" style={{ backgroundColor: '#d12031' }}></div>
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
                style={{ backgroundColor: '#d12031' }}
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
            <p>로그인 오류 문의는 각 지역의 오피스를 통해 문의 부탁드립니다.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
