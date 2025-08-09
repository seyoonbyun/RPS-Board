import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// placeholder 색상 강제 적용을 위한 JavaScript 직접 개입
const forcePlaceholderColors = () => {
  console.log('🎨 강제 placeholder 색상 적용 시작...');
  
  // 기존 스타일 시트 제거
  const existingStyle = document.getElementById('force-placeholder-color');
  if (existingStyle) {
    existingStyle.remove();
  }
  
  // 새 스타일 시트 생성 - 더 강력한 선택자 사용
  const styleSheet = document.createElement('style');
  styleSheet.id = 'force-placeholder-color';
  styleSheet.textContent = `
    /* 궁극적인 placeholder 색상 강제 적용 */
    input::placeholder,
    input::-webkit-input-placeholder,
    input::-moz-placeholder,
    input:-ms-input-placeholder,
    textarea::placeholder,
    textarea::-webkit-input-placeholder,
    textarea::-moz-placeholder,
    textarea:-ms-input-placeholder,
    input[type="text"]::placeholder,
    input[type="email"]::placeholder,
    input[type="password"]::placeholder,
    input[class*="h-10"]::placeholder,
    input[class*="border"]::placeholder,
    .form-control::placeholder,
    form input::placeholder,
    div input::placeholder {
      color: rgb(107, 114, 128) !important;
      opacity: 1 !important;
      -webkit-text-fill-color: rgb(107, 114, 128) !important;
    }
    
    /* Password 특별 처리 - 추가 강제 규칙 */
    input[type="password"]::placeholder,
    input[type="password"]::-webkit-input-placeholder,
    input[type="password"]::-moz-placeholder,
    input[type="password"]:-ms-input-placeholder {
      color: rgb(107, 114, 128) !important;
      opacity: 1 !important;
      -webkit-text-fill-color: rgb(107, 114, 128) !important;
    }
  `;
  
  document.head.appendChild(styleSheet);
  console.log('✅ placeholder 색상 스타일 강제 적용 완료');
  
  // 개별 input 요소에 직접 스타일 적용 + 디버깅
  setTimeout(() => {
    const inputs = document.querySelectorAll('input');
    inputs.forEach((input, index) => {
      input.style.setProperty('--placeholder-color', 'rgb(107, 114, 128)', 'important');
      
      // 디버깅: 실제 적용된 색상 확인
      const computedStyle = window.getComputedStyle(input, '::placeholder');
      console.log(`📍 Input ${index + 1} (${input.placeholder}, type: ${input.type}):`);
      console.log('  - Computed placeholder color:', computedStyle.color);
      console.log('  - All applied styles:', computedStyle.cssText);
      
      // 강제로 속성 재설정
      input.style.cssText += ';--placeholder-color: rgb(107, 114, 128) !important;';
      
      // Password 타입 특별 처리
      if (input.type === 'password') {
        console.log('🔒 Password input 특별 처리 중...');
        
        // 직접 placeholder 색상 확인 및 강제 설정
        const passwordComputedStyle = window.getComputedStyle(input, '::placeholder');
        console.log('  - Password placeholder 현재 색상:', passwordComputedStyle.color);
        
        // 극강 우선순위 스타일 직접 삽입
        const passwordStyleId = 'password-placeholder-force-' + index;
        let existingPasswordStyle = document.getElementById(passwordStyleId);
        if (existingPasswordStyle) existingPasswordStyle.remove();
        
        const passwordStyle = document.createElement('style');
        passwordStyle.id = passwordStyleId;
        passwordStyle.textContent = `
          input[type="password"][placeholder="${input.placeholder}"]::placeholder,
          input[type="password"][placeholder="${input.placeholder}"]::-webkit-input-placeholder,
          input[type="password"][placeholder="${input.placeholder}"]::-moz-placeholder,
          input[type="password"][placeholder="${input.placeholder}"]:-ms-input-placeholder {
            color: rgb(107, 114, 128) !important;
            opacity: 1 !important;
            -webkit-text-fill-color: rgb(107, 114, 128) !important;
          }
          
          /* 추가 우선순위 증가 */
          html body input[type="password"][placeholder="${input.placeholder}"]::placeholder {
            color: rgb(107, 114, 128) !important;
            opacity: 1 !important;
            -webkit-text-fill-color: rgb(107, 114, 128) !important;
          }
        `;
        document.head.appendChild(passwordStyle);
        
        // 재확인
        setTimeout(() => {
          const recheck = window.getComputedStyle(input, '::placeholder');
          console.log('  - Password placeholder 수정 후 색상:', recheck.color);
        }, 50);
      }
    });
    
    // 참조 텍스트 색상도 확인
    const refText = document.querySelector('.text-gray-500');
    if (refText) {
      const refStyle = window.getComputedStyle(refText);
      console.log('📍 Reference text color:', refStyle.color);
    }
  }, 100);
};

// 페이지 제목 변경 함수
const setPageTitle = () => {
  document.title = "My RPS Board Report - BNI KOREA";
};

// 여러 시점에서 실행
forcePlaceholderColors();
setPageTitle();
document.addEventListener('DOMContentLoaded', () => {
  forcePlaceholderColors();
  setPageTitle();
});
window.addEventListener('load', () => {
  forcePlaceholderColors();
  setPageTitle();
});

// React 앱 렌더링 후에도 실행
setTimeout(() => {
  forcePlaceholderColors();
  setPageTitle();
}, 100);
setTimeout(() => {
  forcePlaceholderColors();
  setPageTitle();
}, 500);
setTimeout(() => {
  forcePlaceholderColors();
  setPageTitle();
}, 1000);

createRoot(document.getElementById("root")!).render(<App />);
