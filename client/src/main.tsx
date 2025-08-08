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
      console.log(`📍 Input ${index + 1} (${input.placeholder}):`);
      console.log('  - Computed placeholder color:', computedStyle.color);
      console.log('  - All applied styles:', computedStyle.cssText);
      
      // 강제로 속성 재설정
      input.style.cssText += ';--placeholder-color: rgb(107, 114, 128) !important;';
    });
    
    // 참조 텍스트 색상도 확인
    const refText = document.querySelector('.text-gray-500');
    if (refText) {
      const refStyle = window.getComputedStyle(refText);
      console.log('📍 Reference text color:', refStyle.color);
    }
  }, 100);
};

// 여러 시점에서 실행
forcePlaceholderColors();
document.addEventListener('DOMContentLoaded', forcePlaceholderColors);
window.addEventListener('load', forcePlaceholderColors);

// React 앱 렌더링 후에도 실행
setTimeout(forcePlaceholderColors, 100);
setTimeout(forcePlaceholderColors, 500);
setTimeout(forcePlaceholderColors, 1000);

createRoot(document.getElementById("root")!).render(<App />);
