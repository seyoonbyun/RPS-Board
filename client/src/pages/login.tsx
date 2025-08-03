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
      });
      setLocation("/dashboard");
    },
    onError: (error: any) => {
      console.error('Login error:', error);
      toast({
        title: "로그인 실패",
        description: error.message || "로그인에 실패했습니다",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: LoginForm) => {
    console.log('Form submitted with data:', data);
    loginMutation.mutate(data);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bni-blue rounded-full flex items-center justify-center mx-auto mb-4">
              <Handshake className="text-white text-2xl w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold text-gray-800 mb-2">BNI 코리아</h1>
            <h2 className="text-lg text-blue-600 mb-4">파워팀 리퍼럴 파트너 스코어보드</h2>
            <div className="w-16 h-1 bni-blue mx-auto rounded"></div>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 login-form" noValidate>
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>이메일</FormLabel>
                    <FormControl>
                      <input
                        {...field}
                        type="email"
                        placeholder="이메일을 입력하세요"
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        style={{
                          letterSpacing: 'normal',
                          wordSpacing: 'normal',
                          fontFamily: 'Helvetica Neue, Helvetica, Arial, sans-serif',
                          fontFeatureSettings: 'kern 1',
                          fontKerning: 'auto'
                        }}
                      />
                    </FormControl>
                    <FormMessage />
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
                      <input
                        {...field}
                        type="password"
                        maxLength={4}
                        placeholder="4자리 숫자를 입력하세요"
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        style={{
                          letterSpacing: 'normal',
                          wordSpacing: 'normal',
                          fontFamily: 'Helvetica Neue, Helvetica, Arial, sans-serif',
                          fontFeatureSettings: 'kern 1',
                          fontKerning: 'auto'
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="w-full bni-blue hover:bni-dark text-white transition-all duration-200 transform hover:scale-105"
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

          <p className="text-xs text-gray-500 text-center mt-4">
            처음 방문하시면 이메일과 원하는 4자리 비밀번호로 가입됩니다.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
