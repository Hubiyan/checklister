import React, { useCallback, useEffect, useMemo, useState } from "react";
import Confetti from 'react-confetti';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import Tesseract from "tesseract.js";
import { supabase } from "@/integrations/supabase/client";
import { Camera, Image, ArrowRight, AlertTriangle, CheckCircle, Circle, Plus } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';

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
  amount?: number;
};

const LS_KEY = "checklister-current";

function getCategoryEmoji(category: string): string {
  const emojiMap: Record<string, string> = {
    "Produce": "🥬",
    "Dairy": "🥛", 
    "Bakery": "🍞",
    "Meat & Poultry": "🥩",
    "Frozen Food": "🧊",
    "Rice & Grains": "🌾",
    "Drinks & Beverages": "🥤",
    "Cleaning & Household": "🧽",
    "Personal Care": "🧴",
    "Other / Miscellaneous": "🛒",
    // Additional comprehensive mappings
    "Fruits": "🍎",
    "Vegetables": "🥕",
    "Meat": "🥩",
    "Poultry": "🍗",
    "Fish": "🐟",
    "Seafood": "🦐",
    "Milk": "🥛",
    "Cheese": "🧀",
    "Eggs": "🥚",
    "Bread": "🍞",
    "Pastries": "🥐",
    "Cakes": "🎂",
    "Frozen": "❄️",
    "Ice Cream": "🍦",
    "Cereals": "🥣",
    "Pasta": "🍝",
    "Spices": "🌶️",
    "Condiments": "🍯",
    "Snacks": "🍿",
    "Candy": "🍭",
    "Beverages": "🥤",
    "Coffee": "☕",
    "Tea": "🍵",
    "Alcohol": "🍷",
    "Water": "💧",
    "Juice": "🧃",
    "Soda": "🥤",
    "Energy Drinks": "⚡",
    "Cleaning": "🧽",
    "Detergent": "🧴",
    "Paper Products": "🧻",
    "Toiletries": "🚿",
    "Cosmetics": "💄",
    "Medicine": "💊",
    "Health": "🏥",
    "Baby": "👶",
    "Pet": "🐕",
    "Electronics": "📱",
    "Stationery": "📝",
    "Tools": "🔧",
    "Garden": "🌱",
    "Automotive": "🚗",
    "Sports": "⚽",
    "Books": "📚",
    "Toys": "🧸",
    "Clothing": "👕",
    "Shoes": "👟"
  };
  
  // Direct match
  if (emojiMap[category]) {
    return emojiMap[category];
  }
  
  // Fuzzy matching for partial matches
  const categoryLower = category.toLowerCase();
  for (const [key, emoji] of Object.entries(emojiMap)) {
    if (categoryLower.includes(key.toLowerCase()) || key.toLowerCase().includes(categoryLower)) {
      return emoji;
    }
  }
  
  // Default fallback
  return "🛒";
}

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
  const [showAmountModal, setShowAmountModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ChecklistItem | null>(null);
  const [amountInput, setAmountInput] = useState("");
  const [showConfetti, setShowConfetti] = useState(false);

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

  const categorize = useCallback(async (rawItems: string[], urls: string[] = []) => {
    if (rawItems.length === 0 && urls.length === 0) {
      toast.error("No items or URLs to categorize");
      return;
    }
    setLoading("ai");
    const t = toast.loading(urls.length > 0 ? "Processing URL and categorizing items…" : "Categorizing items…");
    try {
      const requestBody: any = {};
      if (rawItems.length > 0) requestBody.items = rawItems;
      if (urls.length > 0) requestBody.urls = urls;
      
      const { data, error } = await supabase.functions.invoke("generate-with-ai", {
        body: requestBody,
      });
      if (error) throw error;
      
      // Handle new response format
      if (data.status === "no_recipe_found") {
        toast.error(data.notice || "No recipe items found in the provided content", { id: t });
        return;
      }
      
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
    const inputText = text.trim();
    if (!inputText) return;

    // Check if input contains URLs
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = inputText.match(urlRegex) || [];
    
    if (urls.length > 0) {
      // If there are URLs, extract them and get remaining text
      const remainingText = inputText.replace(urlRegex, '').trim();
      const textItems = remainingText ? parseLines(remainingText) : [];
      
      await categorize(textItems, urls);
    } else {
      // No URLs, process as regular text
      const list = parseLines(inputText);
      await categorize(list);
    }
    
    if (inputText.length > 0) {
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

  const toggleItem = (item: ChecklistItem) => {
    if (!item.checked) {
      // Item is being checked - show amount modal
      setSelectedItem(item);
      setAmountInput("");
      setShowAmountModal(true);
    } else {
      // Item is being unchecked - remove amount and uncheck
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, checked: false, amount: undefined } : i)));
    }
  };

  const saveAmount = () => {
    if (selectedItem && amountInput.trim()) {
      const amount = parseFloat(amountInput.trim());
      if (!isNaN(amount) && amount > 0) {
        setItems((prev) => prev.map((i) => 
          i.id === selectedItem.id ? { ...i, checked: true, amount } : i
        ));
        setShowAmountModal(false);
        setSelectedItem(null);
        setAmountInput("");
      } else {
        toast.error("Please enter a valid amount");
      }
    }
  };

  const totalAmount = useMemo(() => {
    return items
      .filter(item => item.checked && item.amount)
      .reduce((sum, item) => sum + (item.amount || 0), 0);
  }, [items]);

  const checkedItemsCount = useMemo(() => {
    return items.filter(item => item.checked).length;
  }, [items]);

  const progressPercentage = useMemo(() => {
    if (items.length === 0) return 0;
    return (checkedItemsCount / items.length) * 100;
  }, [checkedItemsCount, items.length]);

  // Show confetti when all items are checked
  useEffect(() => {
    if (items.length > 0 && checkedItemsCount === items.length) {
      setShowConfetti(true);
      const timer = setTimeout(() => setShowConfetti(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [checkedItemsCount, items.length]);

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
        {showConfetti && <Confetti recycle={false} gravity={0.3} />}
        <div className="max-w-sm mx-auto px-4 py-16 space-y-6">
          {/* Warning Banner */}
          <div className="bg-muted/50 border border-border rounded-lg p-3 flex items-center gap-3">
            <AlertTriangle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <p className="text-sm text-muted-foreground">This list will be lost if you reload this page.</p>
          </div>

          {/* Checklist */}
          <div className="space-y-6 pb-20">
            {grouped.map(({ aisle, items }, index) => (
              <section key={aisle} className="bg-white border-[0.5px] border-[hsl(var(--category-border))] rounded-xl overflow-hidden shadow-[0_12px_42px_rgba(0,0,0,0.12)]">
                <div className="space-y-0 bg-transparent">
                  <h2 className="text-base font-bold text-black px-4 py-3 flex items-center gap-2 bg-white border-b-[0.5px] border-[#D5D5D5]">
                    {aisle}
                    <span className="text-lg">{getCategoryEmoji(aisle)}</span>
                  </h2>
                  <div className="space-y-0">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className={`flex items-center space-x-3 px-4 py-3 transition-colors cursor-pointer ${
                          item.checked ? 'bg-[hsl(var(--checked-bg))]' : 'bg-white'
                        }`}
                        onClick={() => toggleItem(item)}
                      >
                        <div className="flex-shrink-0">
                          <Checkbox checked={item.checked} />
                        </div>
                        <span
                          className={`flex-1 text-sm font-medium ${
                            item.checked ? 'line-through text-white' : 'text-black'
                          }`}
                        >
                          {item.name}
                        </span>
                        {item.checked && item.amount && (
                          <span className="text-sm text-white">
                            AED {item.amount.toFixed(2)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            ))}
          </div>

          {/* Fixed Header with Total Amount */}
          <div className="fixed top-0 left-0 right-0 z-50">
            <div className="bg-white w-full">
              {totalAmount > 0 && (
                <div className="flex justify-between items-center text-black px-4 py-4">
                  <span className="text-lg font-medium">Total:</span>
                  <span className="text-xl font-bold">AED {totalAmount.toFixed(2)}</span>
                </div>
              )}
            </div>
            {/* Progress Bar */}
            <div className="w-full h-[2px] bg-[#D5D5D5]">
              <div 
                className="h-full bg-[#009C00] transition-all duration-300 ease-out"
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
          </div>

          {/* Amount Modal */}
          <Dialog open={showAmountModal} onOpenChange={setShowAmountModal}>
            <DialogContent className="bg-card border-border max-w-sm mx-auto">
              <DialogHeader>
                <DialogTitle className="text-foreground text-center">Add amount</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <Input
                  type="number"
                  inputMode="decimal"
                  placeholder="Enter item amount"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      saveAmount();
                    }
                  }}
                  autoFocus
                  className="bg-input text-foreground border-border"
                />
                <Button 
                  onClick={saveAmount}
                  className="w-full py-3 text-lg font-semibold"
                  disabled={!amountInput.trim()}
                >
                  Save amount
                </Button>
              </div>
            </DialogContent>
          </Dialog>
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
              placeholder="Tap to paste grocery list or recipe URLs..."
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
              className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all duration-200 py-4 h-16 rounded-[0.75rem] text-lg font-semibold border-0"
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
                  className="bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all duration-200 border-0 py-6 h-auto rounded-[0.75rem] text-lg font-semibold flex flex-col items-center"
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
                  className="bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all duration-200 border-0 py-6 h-auto rounded-[0.75rem] text-lg font-semibold flex flex-col items-center"
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