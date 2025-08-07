import { useState, useRef } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogTrigger, AlertDialogTitle, AlertDialogDescription } from "@/components/ui/alert-dialog";
import { X } from "lucide-react";

interface ObjectUploaderProps {
  maxNumberOfFiles?: number;
  maxFileSize?: number;
  onComplete?: (file: File) => void;
  buttonClassName?: string;
  children: ReactNode;
  allowedFileTypes?: string[];
}

export function ObjectUploader({
  maxFileSize = 10485760, // 10MB default
  onComplete,
  buttonClassName,
  children,
  allowedFileTypes = ['.csv'],
}: ObjectUploaderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (file: File) => {
    // 파일 크기 검증
    if (file.size > maxFileSize) {
      alert(`파일 크기가 너무 큽니다. 최대 ${Math.round(maxFileSize / 1024 / 1024)}MB까지 업로드 가능합니다.`);
      return;
    }

    // 파일 타입 검증
    if (allowedFileTypes.length > 0) {
      const isValidType = allowedFileTypes.some(type => 
        file.name.toLowerCase().endsWith(type.toLowerCase())
      );
      if (!isValidType) {
        alert(`허용된 파일 형식이 아닙니다. ${allowedFileTypes.join(', ')} 파일만 업로드 가능합니다.`);
        return;
      }
    }

    onComplete?.(file);
    setIsOpen(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
    // input 값 리셋
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <>
      <Button onClick={() => setIsOpen(true)} className={buttonClassName}>
        {children}
      </Button>

      <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
        <AlertDialogContent className="max-w-md p-0 bg-white">
          <AlertDialogTitle className="sr-only">CSV 파일 업로드</AlertDialogTitle>
          <AlertDialogDescription className="sr-only">CSV 파일을 업로드하여 사용자 정보를 일괄 등록할 수 있습니다.</AlertDialogDescription>
          
          <div className="relative p-6">
            {/* 닫기 버튼 */}
            <button
              onClick={() => setIsOpen(false)}
              className="absolute top-4 right-4 p-1 rounded-sm opacity-70 hover:opacity-100 transition-opacity"
            >
              <X className="h-4 w-4" />
            </button>

            {/* 업로드 영역 */}
            <div className="text-center">
              {/* 아이콘 */}
              <div className="mx-auto mb-6 w-10 h-8 bg-gray-600 rounded-md flex items-center justify-center">
                <span className="text-white text-lg font-bold">↑</span>
              </div>

              {/* 드롭 영역 */}
              <div
                className={`border-2 border-dashed rounded-lg p-8 transition-colors ${
                  isDragOver 
                    ? 'border-red-500 bg-red-50' 
                    : 'border-gray-300 hover:border-gray-400'
                }`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
              >
                <p className="text-gray-600 mb-4">
                  여기에 파일 끌어다 놓기 또는
                </p>
                
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-md"
                >
                  + CSV 파일 선택
                </Button>
              </div>

              {/* 안내 메시지 */}
              <p className="text-sm text-gray-500 mt-4">
                CSV 형식의 파일만 업로드 가능합니다
              </p>

              {/* 숨겨진 파일 입력 */}
              <input
                ref={fileInputRef}
                type="file"
                accept={allowedFileTypes.join(',')}
                onChange={handleFileInputChange}
                className="hidden"
              />
            </div>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}