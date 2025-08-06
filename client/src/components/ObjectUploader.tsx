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

  // Uppy 모달 텍스트를 한국어로 간단히 변경
  useEffect(() => {
    if (showModal) {
      const timer = setTimeout(() => {
        const dropHint = document.querySelector('.uppy-Dashboard-dropFilesHereHint');
        if (dropHint) {
          dropHint.textContent = 'CSV 파일을 여기에 끌어다 놓거나 파일 선택해주세요';
        }
        
        const browse = document.querySelector('.uppy-Dashboard-browse');
        if (browse) {
          browse.textContent = '파일 선택';
        }
      }, 300);

      return () => clearTimeout(timer);
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
          // 가장 중요한 메시지들만 한국어로 번역
          dropHereOr: 'CSV 파일을 여기에 끌어다 놓거나 %{browse}해주세요',
          browse: '파일 선택',
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