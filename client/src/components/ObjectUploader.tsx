import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import Uppy from "@uppy/core";
import { DashboardModal } from "@uppy/react";
import "@uppy/core/dist/style.min.css";
import "@uppy/dashboard/dist/style.min.css";
import AwsS3 from "@uppy/aws-s3";
import type { UploadResult } from "@uppy/core";
import { Button } from "@/components/ui/button";

interface ObjectUploaderProps {
  maxNumberOfFiles?: number;
  maxFileSize?: number;
  onGetUploadParameters: () => Promise<{
    method: "PUT";
    url: string;
  }>;
  onComplete?: (
    result: UploadResult<Record<string, unknown>, Record<string, unknown>>
  ) => void;
  buttonClassName?: string;
  children: ReactNode;
  allowedFileTypes?: string[];
}

/**
 * A file upload component that renders as a button and provides a modal interface for
 * file management.
 * 
 * Features:
 * - Renders as a customizable button that opens a file upload modal
 * - Provides a modal interface for:
 *   - File selection
 *   - File preview
 *   - Upload progress tracking
 *   - Upload status display
 * 
 * The component uses Uppy under the hood to handle all file upload functionality.
 * All file management features are automatically handled by the Uppy dashboard modal.
 * 
 * @param props - Component props
 * @param props.maxNumberOfFiles - Maximum number of files allowed to be uploaded
 *   (default: 1)
 * @param props.maxFileSize - Maximum file size in bytes (default: 10MB)
 * @param props.onGetUploadParameters - Function to get upload parameters (method and URL).
 *   Typically used to fetch a presigned URL from the backend server for direct-to-S3
 *   uploads.
 * @param props.onComplete - Callback function called when upload is complete. Typically
 *   used to make post-upload API calls to update server state and set object ACL
 *   policies.
 * @param props.buttonClassName - Optional CSS class name for the button
 * @param props.children - Content to be rendered inside the button
 * @param props.allowedFileTypes - Array of allowed file types (e.g., ['.csv', '.xlsx'])
 */
export function ObjectUploader({
  maxNumberOfFiles = 1,
  maxFileSize = 10485760, // 10MB default
  onGetUploadParameters,
  onComplete,
  buttonClassName,
  children,
  allowedFileTypes = [],
}: ObjectUploaderProps) {
  const [showModal, setShowModal] = useState(false);

  // Uppy 모달 텍스트를 한국어로 변경
  useEffect(() => {
    if (showModal) {
      const translateTexts = () => {
        // "Drop files here or" 텍스트를 찾아서 변경
        const allElements = document.querySelectorAll('*');
        allElements.forEach(element => {
          const textNodes = Array.from(element.childNodes).filter(node => 
            node.nodeType === Node.TEXT_NODE && 
            node.textContent?.includes('Drop files here or')
          );
          
          textNodes.forEach(node => {
            if (node.textContent?.includes('Drop files here or')) {
              node.textContent = '여기에 파일 끌어다 놓기 또는 ';
            }
          });
        });

        // 드래그 앤 드롭 힌트 텍스트 변경
        const dropHint = document.querySelector('.uppy-Dashboard-dropFilesHereHint');
        console.log('Drop hint found:', dropHint);
        console.log('Drop hint text:', dropHint?.textContent);
        
        if (dropHint) {
          console.log('Processing drop hint for Korean...');
          
          // 텍스트 변경만 처리 (한 번만)
          if (dropHint.textContent?.includes('Drop files here') || dropHint.textContent?.includes('Drop your files here')) {
            dropHint.textContent = '여기에 파일 끌어다 놓기 또는';
            
            // 강제로 스타일 적용
            (dropHint as HTMLElement).style.fontSize = '9px';
            (dropHint as HTMLElement).style.color = '#6b7280';
            (dropHint as HTMLElement).style.fontWeight = '600';
            (dropHint as HTMLElement).style.position = 'relative';
            // 원래 디자인 복원 - marginTop 제거
            (dropHint as HTMLElement).style.marginTop = '50px';
            
            console.log('Text changed to Korean and style applied');
          }
          
          // 아이콘을 텍스트 바로 위에 배치 (marginTop 제거로 텍스트가 위로 올라감)
          const parentContainer = dropHint.parentElement;
          if (parentContainer) {
            // 기존 아이콘 제거
            const existingIcon = document.querySelector('.custom-upload-icon');
            if (existingIcon) {
              existingIcon.remove();
            }
            
            parentContainer.style.position = 'relative';
            
            const icon = document.createElement('div');
            icon.className = 'custom-upload-icon';
            icon.innerHTML = '↑';
            
            icon.style.cssText = `
              position: absolute !important;
              left: 50% !important;
              transform: translateX(-50%) !important;
              width: 40px !important;
              height: 32px !important;
              background-color: #374151 !important;
              border: 2px solid #6b7280 !important;
              border-radius: 6px !important;
              color: #ffffff !important;
              font-size: 18px !important;
              font-weight: bold !important;
              line-height: 28px !important;
              text-align: center !important;
              z-index: 9999 !important;
              display: block !important;
              visibility: visible !important;
              opacity: 1 !important;
              top: 9px !important;
            `;
            
            parentContainer.insertBefore(icon, parentContainer.firstChild);
            console.log('Icon positioned at top: 9px (original design restored)');
          }
        }
        
        // 파일 선택 버튼 스타일 강제 적용
        const browseButton = document.querySelector('.uppy-Dashboard-browse');
        if (browseButton) {
          (browseButton as HTMLElement).style.color = '#ffffff';
          console.log('Browse button color changed to white');
        }
        
        // 파일 선택 버튼 텍스트 변경
        const browse = document.querySelector('.uppy-Dashboard-browse');
        if (browse && browse.textContent?.includes('browse files')) {
          browse.textContent = 'CSV 파일 선택';
        }
      };

      // 아이콘과 텍스트 설정 후 interval 중단
      let isSetup = false;
      
      const setupOnce = () => {
        translateTexts();
        if (document.querySelector('.custom-upload-icon')) {
          isSetup = true;
          clearInterval(interval);
          console.log('Setup complete - interval stopped');
        }
      };
      
      const timer = setTimeout(setupOnce, 200);
      const interval = setInterval(() => {
        if (!isSetup) {
          setupOnce();
        }
      }, 100);
      
      // 5초 후 강제 정리
      const cleanup = setTimeout(() => {
        clearInterval(interval);
        isSetup = true;
      }, 5000);

      return () => {
        clearTimeout(timer);
        clearInterval(interval);
        clearTimeout(cleanup);
      };
    }
  }, [showModal]);
  const [uppy] = useState(() =>
    new Uppy({
      restrictions: {
        maxNumberOfFiles,
        maxFileSize,
        allowedFileTypes: allowedFileTypes.length > 0 ? allowedFileTypes : undefined,
      },
      autoProceed: false,
      locale: {
        strings: {
          dropHereOr: '여기에 파일 끌어다 놓기 또는',
          browse: 'CSV 파일 선택',
          dropPasteBoth: '여기에 파일 끌어다 놓기 또는 %{browse}',
          dropPaste: '여기에 파일 끌어다 놓기',
          addMoreFiles: '파일 더 추가',
          uploadComplete: '업로드 완료!',
          uploadFailed: '업로드 실패',
          cancel: '취소',
          removeFile: '파일 제거',
          exceedsSize: '파일이 최대 허용 크기를 초과합니다'
        },
        pluralize: (count: number) => count === 1 ? 0 : 1
      }
    })
      .use(AwsS3, {
        shouldUseMultipart: false,
        getUploadParameters: onGetUploadParameters,
      })
      .on("complete", (result) => {
        onComplete?.(result);
        setShowModal(false); // Close modal after completion
      })
  );

  return (
    <div>
      <Button onClick={() => setShowModal(true)} className={buttonClassName}>
        {children}
      </Button>

      <DashboardModal
        uppy={uppy}
        open={showModal}
        onRequestClose={() => setShowModal(false)}
        proudlyDisplayPoweredByUppy={false}
        showProgressDetails={true}
        note="CSV 형식의 파일만 업로드 가능합니다"
        closeModalOnClickOutside={true}
        disableStatusBar={false}
        disableInformer={false}
        disableThumbnailGenerator={true}
      />
    </div>
  );
}