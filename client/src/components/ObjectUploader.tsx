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

  // 모달이 열릴 때 아이콘 추가
  useEffect(() => {
    if (showModal) {
      const addIcon = () => {
        // 더 구체적인 선택자를 사용해서 드롭 영역 찾기
        const dropArea = document.querySelector('.uppy-Dashboard-AddFiles');
        const existingIcon = document.querySelector('.upload-icon');
        
        if (dropArea && !existingIcon) {
          const icon = document.createElement('div');
          icon.className = 'upload-icon';
          icon.innerHTML = '↑';
          icon.style.cssText = `
            width: 40px;
            height: 32px;
            background-color: #374151;
            border-radius: 6px;
            color: white;
            font-size: 18px;
            font-weight: bold;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 20px auto 10px auto;
            position: relative;
            z-index: 10;
          `;
          // 드롭 영역의 첫 번째 자식으로 삽입
          dropArea.insertBefore(icon, dropArea.firstChild);
          console.log('Upload icon added successfully');
        }
      };
      
      // DOM이 준비될 때까지 여러 번 시도
      const attempts = [300, 600, 1000];
      attempts.forEach(delay => {
        setTimeout(addIcon, delay);
      });
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