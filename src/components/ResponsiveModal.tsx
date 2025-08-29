import { ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";

interface ResponsiveModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  children: ReactNode;
  className?: string;
  position?: "top" | "bottom";
}

export function ResponsiveModal({ 
  open, 
  onOpenChange, 
  title, 
  children, 
  className = "max-w-sm mx-auto",
  position = "bottom"
}: ResponsiveModalProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent 
          className={`bg-white border-none shadow-lg ${
            position === "top" 
              ? "fixed !top-0 !bottom-auto !left-0 !right-0 !transform-none rounded-t-none rounded-b-[12px] !translate-y-0" 
              : "rounded-t-xl"
          }`}
        >
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