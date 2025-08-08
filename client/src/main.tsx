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
  
  // 새 스타일 시트 생성
  const styleSheet = document.createElement('style');
  styleSheet.id = 'force-placeholder-color';
  styleSheet.textContent = `
    /* 최강 우선순위 placeholder 색상 강제 적용 */
    input::placeholder,
    input::-webkit-input-placeholder,
    input::-moz-placeholder,
    input:-ms-input-placeholder,
    textarea::placeholder,
    textarea::-webkit-input-placeholder,
    textarea::-moz-placeholder,
    textarea:-ms-input-placeholder {
      color: rgb(107, 114, 128) !important;
      opacity: 1 !important;
    }
    
    /* 특별히 중요한 규칙들 */
    input[class*="input"]::placeholder,
    input[class*="Input"]::placeholder,
    .placeholder-gray-500::placeholder {
      color: rgb(107, 114, 128) !important;
      opacity: 1 !important;
    }
  `;
  
  document.head.appendChild(styleSheet);
  console.log('✅ placeholder 색상 스타일 강제 적용 완료');
  
  // DOM 변경 감지하여 동적으로 재적용
  const observer = new MutationObserver(() => {
    document.head.appendChild(styleSheet.cloneNode(true));
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
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
