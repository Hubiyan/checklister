import { ReactNode, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSmartToast } from "@/components/SmartToastProvider";

interface ResponsiveModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  children: ReactNode;
  className?: string;
  position?: "top" | "bottom";
  hasInputs?: boolean; // New prop to indicate if modal contains input fields
}

export function ResponsiveModal({ 
  open, 
  onOpenChange, 
  title, 
  children, 
  className = "max-w-sm mx-auto",
  position = "bottom",
  hasInputs = false
}: ResponsiveModalProps) {
  const isMobile = useIsMobile();
  const { setSheetState } = useSmartToast();

  // Apply positioning rule: if hasInputs and would be bottom sheet, force top sheet
  const effectivePosition = isMobile && hasInputs && position === "bottom" ? "top" : position;

  // Update toast positioning based on sheet state
  useEffect(() => {
    if (open) {
      setSheetState(isMobile ? effectivePosition : "none");
    } else {
      setSheetState("none");
    }
  }, [open, isMobile, effectivePosition, setSheetState]);

  if (isMobile && effectivePosition === "top") {
    return (
      <div className={`fixed inset-0 z-50 ${open ? 'block' : 'hidden'}`}>
        <div 
          className="fixed inset-0 bg-black/20" 
          onClick={() => onOpenChange(false)}
        />
        <div className="fixed top-0 left-0 right-0 bg-white rounded-b-[12px] shadow-lg z-50">
          {title && (
            <div className="py-3 px-4">
              <h2 className="text-base font-bold text-black">
                {title}
              </h2>
            </div>
          )}
          {children}
        </div>
      </div>
    );
  }

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="bg-white border-none shadow-lg rounded-t-xl">
          {title && (
            <DrawerHeader className="py-3">
              <DrawerTitle className="text-base font-bold text-black">
                {title}
              </DrawerTitle>
            </DrawerHeader>
          )}
          {children}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`bg-white border-none shadow-lg rounded-xl ${className}`}>
        {title && (
          <DialogHeader className="py-3">
            <DialogTitle className="text-base font-bold text-black">
              {title}
            </DialogTitle>
          </DialogHeader>
        )}
        {children}
      </DialogContent>
    </Dialog>
  );
}