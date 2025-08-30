import React, { createContext, useContext, useState, ReactNode } from "react";
import { Toaster } from "sonner";

type SheetState = "none" | "bottom" | "top";
type ToastPosition = "top" | "bottom";

interface SmartToastContextType {
  setSheetState: (state: SheetState) => void;
  getToastPosition: () => ToastPosition;
}

const SmartToastContext = createContext<SmartToastContextType | undefined>(undefined);

export function useSmartToast() {
  const context = useContext(SmartToastContext);
  if (!context) {
    throw new Error("useSmartToast must be used within SmartToastProvider");
  }
  return context;
}

interface SmartToastProviderProps {
  children: ReactNode;
}

export function SmartToastProvider({ children }: SmartToastProviderProps) {
  const [sheetState, setSheetState] = useState<SheetState>("none");

  const getToastPosition = (): ToastPosition => {
    // When bottom sheet is visible → show toasts at top
    // When top sheet is visible → show toasts at bottom  
    // When no sheet is visible → show toasts at top (default)
    if (sheetState === "bottom") return "top";
    if (sheetState === "top") return "bottom";
    return "top";
  };

  const contextValue: SmartToastContextType = {
    setSheetState,
    getToastPosition,
  };

  const toastPosition = getToastPosition();

  return (
    <SmartToastContext.Provider value={contextValue}>
      {children}
      <Toaster
        position={toastPosition === "top" ? "top-center" : "bottom-center"}
        expand={true}
        richColors
        closeButton
        toastOptions={{
          style: {
            marginTop: toastPosition === "bottom" ? "0" : "env(safe-area-inset-top, 0px)",
            marginBottom: toastPosition === "top" ? "0" : "env(safe-area-inset-bottom, 0px)",
          }
        }}
      />
    </SmartToastContext.Provider>
  );
}