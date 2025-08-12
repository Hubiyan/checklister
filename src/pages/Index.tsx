import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import Tesseract from "tesseract.js";
import { supabase } from "@/integrations/supabase/client";
import { Camera, Image, ArrowRight, AlertTriangle } from "lucide-react";

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

  const newList = () => {
    setItems([]);
    setText("");
    setFile(null);
    setScreen("input");
    setInputMode("text");
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
          <div className="space-y-8">
            {grouped.map(({ aisle, items }) => (
              <section key={aisle} className="space-y-4">
                <h2 className="text-2xl font-semibold text-foreground">{aisle}</h2>
                <div className="space-y-3">
                  {items.map((item) => (
                    <div key={item.id} className={`p-4 rounded-lg border transition-all ${
                      item.checked 
                        ? 'bg-accent border-accent' 
                        : 'bg-card border-border'
                    }`}>
                      <label 
                        htmlFor={item.id} 
                        className="flex items-center gap-3 cursor-pointer select-none"
                      >
                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                          item.checked 
                            ? 'bg-accent border-accent' 
                            : 'border-muted-foreground'
                        }`}>
                          {item.checked && (
                            <div className="w-3 h-3 rounded-full bg-white"></div>
                          )}
                        </div>
                        <span className={`text-lg ${item.checked ? 'text-white' : 'text-foreground'}`}>
                          {item.name}
                        </span>
                      </label>
                      <input
                        type="checkbox"
                        id={item.id}
                        checked={item.checked}
                        onChange={(e) => toggleItem(item.id, e.target.checked)}
                        className="sr-only"
                      />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>

          {/* New List Button */}
          <div className="pt-4">
            <Button 
              onClick={newList}
              className="w-full bg-card hover:bg-muted border border-border text-foreground py-4 h-auto rounded-2xl text-lg font-medium"
            >
              New list
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
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
          <div className="bg-card border border-border rounded-2xl p-6 min-h-[240px]">
            <Textarea
              placeholder="Tap to paste"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="min-h-[200px] bg-transparent border-none p-0 text-lg placeholder:text-muted-foreground resize-none focus-visible:ring-0"
            />
          </div>

          {/* Input Mode Selection */}
          <div className="flex items-center gap-4">
            {/* Image Input Button */}
            <div className="relative">
              <Button
                variant="secondary"
                size="lg"
                className="w-16 h-16 rounded-2xl bg-card hover:bg-muted border border-border p-0"
                onClick={() => {
                  if (inputMode === "camera") {
                    setInputMode("text");
                  } else {
                    setInputMode("camera");
                  }
                }}
              >
                <Image className="h-6 w-6 text-foreground" />
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
              className="flex-1 bg-card hover:bg-muted border border-border text-foreground py-4 h-16 rounded-2xl text-lg font-medium"
            >
              {loading === "ai" ? "Sorting..." : loading === "ocr" ? `OCR: ${ocrProgress}%` : "Get sorted"}
              <ArrowRight className="ml-3 h-5 w-5" />
            </Button>
          </div>

          {/* Camera/Photos Selection (when image mode is active) */}
          {inputMode === "camera" && (
            <div className="bg-accent rounded-2xl p-4">
              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="secondary"
                  className="bg-card hover:bg-muted border-0 text-foreground py-6 h-auto rounded-xl text-lg font-medium flex flex-col items-center"
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
                  className="bg-card hover:bg-muted border-0 text-foreground py-6 h-auto rounded-xl text-lg font-medium flex flex-col items-center"
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