import React from "react";
import { ResponsiveModal } from "@/components/ResponsiveModal";
import { Attachment } from "./AttachmentChips";

interface AttachmentPreviewProps {
  attachment: Attachment | null;
  onClose: () => void;
}

export function AttachmentPreview({ attachment, onClose }: AttachmentPreviewProps) {
  if (!attachment) return null;

  return (
    <ResponsiveModal
      open={!!attachment}
      onOpenChange={(open) => !open && onClose()}
      title={attachment.name}
      className="max-w-2xl mx-auto"
    >
      <div className="p-5">
        {attachment.type === "image" ? (
          <img
            src={attachment.preview || URL.createObjectURL(attachment.file)}
            alt={attachment.name}
            className="w-full h-auto max-h-[70vh] object-contain rounded-lg"
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-64 bg-muted rounded-lg">
            <div className="text-center">
              <p className="text-lg font-medium mb-2">{attachment.name}</p>
              <p className="text-muted-foreground">PDF preview not available</p>
              <p className="text-sm text-muted-foreground mt-2">
                File will be processed for text extraction
              </p>
            </div>
          </div>
        )}
      </div>
    </ResponsiveModal>
  );
}