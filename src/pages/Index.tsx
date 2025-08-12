import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import Tesseract from "tesseract.js";
import { supabase } from "@/integrations/supabase/client";
import { Camera, Image, ArrowRight, AlertTriangle, CheckCircle, Circle, Plus } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Separator } from '@/components/ui/separator';

// Simple aisle list used for ordering - matching the design
const DEFAULT_AISLES = [
  "Produce",
  "Dairy", 
  "Bakery",
  "Meat & Poultry",
  "Frozen Food",
  "Rice & Grains",
  "Drinks & Beverages",
  "Cleaning & Household",
  "Personal Care",
  "Other / Miscellaneous",
] as const;

type Aisle = (typeof DEFAULT_AISLES)[number];

type ChecklistItem = {
  id: string;
  name: string;
  aisle: Aisle | string;
  checked: boolean;
};

const LS_KEY = "checklister-current";

function parseLines(text: string): string[] {
  return text
    .split(/\r?\n|,|;/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^[-*\d.)\s]+/, ""))
    .filter((s) => s.length > 0);
}

function itemsFromAislesJson(json: any): ChecklistItem[] {
  // Handle new JSON format with items array
  if (Array.isArray(json?.items)) {
    return json.items.map((item: any) => ({
      id: crypto.randomUUID(),
      name: item.input || item.name || "",
      aisle: item.category || item.aisle || "Other / Miscellaneous",
      checked: false,
    }));
  }

  // Fallback to old format
  const aisles: Record<string, string[]> = json?.aisles || {};
  const out: ChecklistItem[] = [];
  for (const [aisle, list] of Object.entries(aisles)) {
    (list || []).forEach((name) => {
      out.push({ id: crypto.randomUUID(), name, aisle, checked: false });
    });
  }
  // Include uncategorized if provided separately
  if (Array.isArray(json?.uncategorized)) {
    json.uncategorized.forEach((name: string) =>
      out.push({ id: crypto.randomUUID(), name, aisle: "uncategorized", checked: false })
    );
  }
  // Deduplicate by name + aisle
  const seen = new Set<string>();
  return out.filter((i) => {
    const key = `${i.aisle}::${i.name.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function Index() {
  const [screen, setScreen] = useState<"input" | "output">("input");
  const [inputMode, setInputMode] = useState<"text" | "camera">("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [ocrProgress, setOcrProgress] = useState<number>(0);
  const [loading, setLoading] = useState<"idle" | "ocr" | "ai">("idle");
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [showClearDialog, setShowClearDialog] = useState(false);

  // Load/save local state
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setItems(parsed);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(items));
    } catch {}
  }, [items]);

  const grouped = useMemo(() => {
    const map = new Map<string, ChecklistItem[]>();
    for (const i of items) {
      if (!map.has(i.aisle)) map.set(i.aisle, []);
      map.get(i.aisle)!.push(i);
    }
    // Order aisles by DEFAULT_AISLES first, then the rest alphabetically
    const orderedKeys = [
      ...DEFAULT_AISLES.filter((a) => map.has(a)),
      ...Array.from(map.keys())
        .filter((k) => !DEFAULT_AISLES.includes(k as Aisle))
        .sort(),
    ];
    return orderedKeys.map((k) => ({ aisle: k, items: map.get(k)! }));
  }, [items]);

  const categorize = useCallback(async (rawItems: string[]) => {
    if (rawItems.length === 0) {
      toast.error("No items to categorize");
      return;
    }
    setLoading("ai");
    const t = toast.loading("Categorizing items…");
    try {
      const { data, error } = await supabase.functions.invoke("generate-with-ai", {
        body: { items: rawItems },
      });
      if (error) throw error;
      const next = itemsFromAislesJson(data);
      setItems(next);
      toast.success("Checklist ready", { id: t });
    } catch (err: any) {
      const msg = err?.message || "AI categorization failed";
      toast.error(`${msg}. Check function logs.`, { id: t });
      console.error('AI categorize error:', err);
    } finally {
      setLoading("idle");
    }
  }, []);

  const handleFromText = async () => {
    const list = parseLines(text);
    await categorize(list);
    if (list.length > 0) {
      setScreen("output");
    }
  };

  const handleFromImage = async () => {
    if (!file) return toast.error("Choose an image first");
    setLoading("ocr");
    setOcrProgress(0);
    const t = toast.loading("Extracting text from image…");
    try {
      const { data: { text: ocrText } } = await Tesseract.recognize(file, "eng", {
        logger: (m) => {
          if (m.status === "recognizing text" && m.progress) {
            setOcrProgress(Math.round(m.progress * 100));
          }
        },
      }) as any;
      const list = parseLines(ocrText || "");
      toast.success("Text extracted", { id: t });
      await categorize(list);
      if (list.length > 0) {
        setScreen("output");
      }
    } catch (e) {
      console.error(e);
      toast.error("OCR failed", { id: t });
    } finally {
      setLoading("idle");
    }
  };

  const toggleItem = (id: string, checked: boolean) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, checked } : i)));
  };

  const handleNewList = () => {
    setShowClearDialog(true);
  };

  const confirmNewList = () => {
    setItems([]);
    setText("");
    setFile(null);
    setScreen("input");
    setInputMode("text");
    setShowClearDialog(false);
  };

  const handleTextareaFocus = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const clipboardText = await navigator.clipboard.readText();
        if (clipboardText.trim() && !text.trim()) {
          setText(clipboardText);
          toast.success("Pasted from clipboard");
        }
      }
    } catch (error) {
      // Clipboard access denied or not available - fail silently
      console.log("Clipboard access not available");
    }
  };

  if (screen === "output") {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <div className="max-w-sm mx-auto px-4 py-6 space-y-6">
          {/* Warning Banner */}
          <div className="bg-muted/50 border border-border rounded-lg p-3 flex items-center gap-3">
            <AlertTriangle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <p className="text-sm text-muted-foreground">This list will be lost if you reload this page.</p>
          </div>

          {/* Checklist */}
          <div className="space-y-6 pb-20">
            {grouped.map(({ aisle, items }, index) => (
              <section key={aisle}>
                {index > 0 && (
                  <Separator className="mb-6 bg-[hsl(var(--separator))] h-[0.5px]" />
                )}
                <div className="space-y-2">
                  <h2 className="text-base font-medium text-foreground">{aisle}</h2>
                  <div className="space-y-0 mt-2">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className={`flex items-center space-x-3 p-3 transition-colors cursor-pointer ${
                          item.checked ? 'bg-[hsl(var(--checked-bg))]' : 'bg-transparent'
                        }`}
                        onClick={() => toggleItem(item.id, !item.checked)}
                      >
                        <div className="flex-shrink-0">
                          {item.checked ? (
                            <CheckCircle className="w-6 h-6 text-white" />
                          ) : (
                            <Circle className="w-6 h-6 text-white" />
                          )}
                        </div>
                        <span
                          className={`flex-1 text-sm ${
                            item.checked ? 'line-through text-white/70' : 'text-white'
                          }`}
                        >
                          {item.name}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            ))}
          </div>

          {/* Fixed New List Button */}
          <div className="fixed bottom-6 left-4 right-4">
            <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
              <AlertDialogTrigger asChild>
                <Button 
                  onClick={handleNewList}
                  className="w-full py-4 h-auto text-lg font-medium"
                >
                  <Plus className="w-5 h-5 mr-2" />
                  New List
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="bg-card border-border">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-foreground">Clear Shopping List</AlertDialogTitle>
                  <AlertDialogDescription className="text-muted-foreground">
                    Are you sure you want to clear your current shopping list? This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="text-foreground">Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={confirmNewList}>
                    Clear List
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="max-w-sm mx-auto px-6 py-12 space-y-8">
        {/* Header */}
        <div className="text-center space-y-3">
          <h1 className="text-4xl font-bold text-foreground">Checklister</h1>
          <p className="text-muted-foreground text-lg">
            Sort your groceries using AI ✨
          </p>
        </div>

        {/* Text Input Area */}
        <div className="space-y-6">
          <div className="bg-card border border-border rounded-[0.75rem] p-6 min-h-[240px]">
            <Textarea
              placeholder="Tap to paste"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onFocus={handleTextareaFocus}
              className="min-h-[200px] bg-transparent border-none p-0 text-lg placeholder:text-muted-foreground resize-none focus-visible:ring-0 focus:outline-none focus:ring-0 focus:border-none rounded-[0.75rem]"
            />
          </div>

          {/* Input Mode Selection */}
          <div className="flex items-center gap-4">
            {/* Image Input Button */}
            <div className="relative">
              <Button
                variant="secondary"
                size="lg"
                className="w-16 h-16 rounded-[0.75rem] bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all duration-200 border-0 p-0"
                onClick={() => {
                  if (inputMode === "camera") {
                    setInputMode("text");
                  } else {
                    setInputMode("camera");
                  }
                }}
              >
                <Image className="h-6 w-6 text-primary-foreground" />
              </Button>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
            </div>

            {/* Get Sorted Button */}
            <Button
              onClick={text.trim() ? handleFromText : handleFromImage}
              disabled={(!text.trim() && !file) || loading !== "idle"}
              className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all duration-200 py-4 h-16 rounded-[0.75rem] text-lg font-medium border-0"
            >
              {loading === "ai" ? "Sorting..." : loading === "ocr" ? `OCR: ${ocrProgress}%` : "Get sorted"}
              <ArrowRight className="ml-3 h-5 w-5" />
            </Button>
          </div>

          {/* Camera/Photos Selection (when image mode is active) */}
          {inputMode === "camera" && (
            <div className="bg-accent rounded-[0.75rem] p-4">
              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="secondary"
                  className="bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all duration-200 border-0 py-6 h-auto rounded-[0.75rem] text-lg font-medium flex flex-col items-center"
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.capture = 'environment';
                    input.onchange = (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (file) setFile(file);
                    };
                    input.click();
                  }}
                >
                  <Camera className="h-6 w-6 mb-2" />
                  Camera
                </Button>
                <Button
                  variant="secondary"
                  className="bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all duration-200 border-0 py-6 h-auto rounded-[0.75rem] text-lg font-medium flex flex-col items-center"
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.onchange = (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (file) setFile(file);
                    };
                    input.click();
                  }}
                >
                  <Image className="h-6 w-6 mb-2" />
                  Photos
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}