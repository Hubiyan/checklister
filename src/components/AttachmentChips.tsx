import React from "react";
import { X, FileText, Image } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface Attachment {
  id: string;
  name: string;
  file: File;
  type: "image" | "pdf";
  preview?: string;
}

interface AttachmentChipsProps {
  attachments: Attachment[];
  onRemove: (id: string) => void;
  onPreview: (attachment: Attachment) => void;
}

export function AttachmentChips({ attachments, onRemove, onPreview }: AttachmentChipsProps) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 p-4 pt-0">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="flex items-center gap-2 bg-muted rounded-lg p-2 pr-1 max-w-[200px]"
        >
          <button
            onClick={() => onPreview(attachment)}
            className="flex items-center gap-2 flex-1 min-w-0 text-left"
            aria-label={`Preview ${attachment.name}`}
          >
            {attachment.type === "image" ? (
              <Image className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            ) : (
              <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            )}
            <span className="text-sm text-foreground truncate">
              {attachment.name}
            </span>
          </button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRemove(attachment.id)}
            className="h-6 w-6 p-0 hover:bg-destructive/10 hover:text-destructive"
            aria-label={`Remove attachment ${attachment.name}`}
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}