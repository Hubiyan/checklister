import React, { useRef } from "react";
import { Camera, Image, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResponsiveModal } from "@/components/ResponsiveModal";
import { toast } from "sonner";

interface MediaPickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAttachmentsSelected: (files: File[]) => void;
}

export function MediaPickerSheet({ 
  open, 
  onOpenChange, 
  onAttachmentsSelected 
}: MediaPickerSheetProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCameraClick = () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast.error("Camera not supported on this device");
      return;
    }
    cameraInputRef.current?.click();
  };

  const handlePhotosClick = () => {
    photoInputRef.current?.click();
  };

  const handleFilesClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelection = (files: FileList | null, type: string) => {
    if (!files || files.length === 0) return;
    
    const fileArray = Array.from(files);
    const validFiles: File[] = [];

    for (const file of fileArray) {
      // Validate file types
      if (type === "camera" && file.type.startsWith("image/")) {
        validFiles.push(file);
      } else if (type === "photos" && file.type.startsWith("image/")) {
        validFiles.push(file);
      } else if (type === "files" && (file.type.startsWith("image/") || file.type === "application/pdf")) {
        validFiles.push(file);
      } else {
        toast.error(`File type not supported: ${file.name}`);
      }
    }

    if (validFiles.length > 0) {
      onAttachmentsSelected(validFiles);
      onOpenChange(false);
    }
  };

  return (
    <>
      <ResponsiveModal
        open={open}
        onOpenChange={onOpenChange}
        title="Add Attachments"
        className="max-w-sm mx-auto"
      >
        <div className="p-5 space-y-3">
          <Button
            onClick={handleCameraClick}
            className="w-full h-12 justify-start gap-3 text-left bg-background hover:bg-muted border"
            variant="outline"
          >
            <Camera className="w-5 h-5" />
            <span className="font-medium">Open Camera</span>
          </Button>

          <Button
            onClick={handlePhotosClick}
            className="w-full h-12 justify-start gap-3 text-left bg-background hover:bg-muted border"
            variant="outline"
          >
            <Image className="w-5 h-5" />
            <span className="font-medium">Choose Photos</span>
          </Button>

          <Button
            onClick={handleFilesClick}
            className="w-full h-12 justify-start gap-3 text-left bg-background hover:bg-muted border"
            variant="outline"
          >
            <FileText className="w-5 h-5" />
            <span className="font-medium">Choose Files (PDF/Images)</span>
          </Button>
        </div>
      </ResponsiveModal>

      {/* Hidden file inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => handleFileSelection(e.target.files, "camera")}
      />
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => handleFileSelection(e.target.files, "photos")}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => handleFileSelection(e.target.files, "files")}
      />
    </>
  );
}