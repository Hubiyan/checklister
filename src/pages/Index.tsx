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
import { Badge } from '@/components/ui/badge';

// Aisle categories in correct order
const DEFAULT_AISLES = ["Dairy & Eggs", "Meat, Fish & Frozen", "Vegetables & Herbs", "Fruits", "Bakery & Breads", "Pantry Staples", "Grains, Rice & Pulses", "Pasta & Noodles", "Baking & Desserts", "Beverages", "Snacks", "Spices & Condiments", "Household & Cleaning", "Personal Care", "Baby", "Pets", "Unrecognized"] as const;
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
    "Dairy & Eggs": "🥛",
    "Meat, Fish & Frozen": "🥩",
    "Vegetables & Herbs": "🥬",
    "Fruits": "🍎",
    "Bakery & Breads": "🍞",
    "Pantry Staples": "🥫",
    "Grains, Rice & Pulses": "🌾",
    "Pasta & Noodles": "🍝",
    "Baking & Desserts": "🧁",
    "Beverages": "🥤",
    "Snacks": "🍿",
    "Spices & Condiments": "🌶️",
    "Household & Cleaning": "🧽",
    "Personal Care": "🧴",
    "Baby": "👶",
    "Pets": "🐕",
    "Unrecognized": "❓"
  };
  return emojiMap[category] || "🛒";
}
function parseLines(text: string): string[] {
  return text.split(/\r?\n|,|;/).map(s => s.trim()).filter(Boolean).map(s => s.replace(/^[-*\d.)\s]+/, "")).filter(s => s.length > 0);
}
function itemsFromAislesJson(json: any): ChecklistItem[] {
  // Handle new categories format
  if (Array.isArray(json?.categories)) {
    const items: ChecklistItem[] = [];
    json.categories.forEach((category: any) => {
      if (category.items && Array.isArray(category.items)) {
        category.items.forEach((item: any) => {
          items.push({
            id: crypto.randomUUID(),
            name: item.display_name || item.name || "",
            aisle: category.name || "Other / Misc",
            checked: false
          });
        });
      }
    });
    return items;
  }

  // Handle legacy items array format
  if (Array.isArray(json?.items)) {
    return json.items.map((item: any) => ({
      id: crypto.randomUUID(),
      name: item.input || item.display_name || item.name || "",
      aisle: item.category || item.aisle || "Other / Misc",
      checked: false
    }));
  }

  // Fallback to old format
  const aisles: Record<string, string[]> = json?.aisles || {};
  const out: ChecklistItem[] = [];
  for (const [aisle, list] of Object.entries(aisles)) {
    (list || []).forEach(name => {
      out.push({
        id: crypto.randomUUID(),
        name,
        aisle,
        checked: false
      });
    });
  }
  // Include uncategorized if provided separately
  if (Array.isArray(json?.uncategorized)) {
    json.uncategorized.forEach((name: string) => out.push({
      id: crypto.randomUUID(),
      name,
      aisle: "uncategorized",
      checked: false
    }));
  }
  // Deduplicate by name + aisle
  const seen = new Set<string>();
  return out.filter(i => {
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
  const [showCongratulationsModal, setShowCongratulationsModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [itemToMove, setItemToMove] = useState<ChecklistItem | null>(null);
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null);
  const [tappedItem, setTappedItem] = useState<string | null>(null);
  const [showUnrecognizedModal, setShowUnrecognizedModal] = useState(false);
  const [selectedUnrecognizedItems, setSelectedUnrecognizedItems] = useState<Set<string>>(new Set());
  const [unrecognizedModalView, setUnrecognizedModalView] = useState<'items' | 'categories'>('items');

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

  // Function to check if an item is in the Unrecognized category
  const isUnrecognized = (aisle: string) => {
    return aisle === "Unrecognized";
  };
  const grouped = useMemo(() => {
    const map = new Map<string, ChecklistItem[]>();
    for (const i of items) {
      if (!map.has(i.aisle)) map.set(i.aisle, []);
      map.get(i.aisle)!.push(i);
    }

    // Order aisles by DEFAULT_AISLES first, then the rest alphabetically
    const orderedKeys = [...DEFAULT_AISLES.filter(a => map.has(a)), ...Array.from(map.keys()).filter(k => !DEFAULT_AISLES.includes(k as Aisle)).sort()];
    return orderedKeys.map(k => ({
      aisle: k,
      items: map.get(k)!
    }));
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
      const {
        data,
        error
      } = await supabase.functions.invoke("generate-with-ai", {
        body: requestBody
      });
      if (error) throw error;

      // Handle new response format
      if (data.status === "no_recipe_found") {
        toast.error(data.notice || "No recipe items found in the provided content", {
          id: t
        });
        return;
      }
      const next = itemsFromAislesJson(data);
      setItems(next);

      // Check if there are unrecognized items and show modal
      const hasUnrecognized = next.some(item => item.aisle === "Unrecognized");
      if (hasUnrecognized) {
        setTimeout(() => {
          setShowUnrecognizedModal(true);
        }, 500); // Small delay to let the UI render
      }
      toast.success("Checklist ready", {
        id: t
      });
    } catch (err: any) {
      const msg = err?.message || "AI categorization failed";
      toast.error(`${msg}. Check function logs.`, {
        id: t
      });
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
      const {
        data: {
          text: ocrText
        }
      } = (await Tesseract.recognize(file, "eng", {
        logger: m => {
          if (m.status === "recognizing text" && m.progress) {
            setOcrProgress(Math.round(m.progress * 100));
          }
        }
      })) as any;
      const list = parseLines(ocrText || "");
      toast.success("Text extracted", {
        id: t
      });
      await categorize(list);
      if (list.length > 0) {
        setScreen("output");
      }
    } catch (e) {
      console.error(e);
      toast.error("OCR failed", {
        id: t
      });
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
      setItems(prev => prev.map(i => i.id === item.id ? {
        ...i,
        checked: false,
        amount: undefined
      } : i));
    }
  };
  const saveAmount = () => {
    if (selectedItem && amountInput.trim()) {
      const amount = parseFloat(amountInput.trim());
      if (!isNaN(amount) && amount > 0) {
        setItems(prev => prev.map(i => i.id === selectedItem.id ? {
          ...i,
          checked: true,
          amount
        } : i));
        setShowAmountModal(false);
        setSelectedItem(null);
        setAmountInput("");
      } else {
        toast.error("Please enter a valid amount");
      }
    }
  };
  const totalAmount = useMemo(() => {
    return items.filter(item => item.checked && item.amount).reduce((sum, item) => sum + (item.amount || 0), 0);
  }, [items]);
  const checkedItemsCount = useMemo(() => {
    return items.filter(item => item.checked).length;
  }, [items]);
  const progressPercentage = useMemo(() => {
    if (items.length === 0) return 0;
    return checkedItemsCount / items.length * 100;
  }, [checkedItemsCount, items.length]);

  // Show confetti when all items are checked (only for lists with multiple items)
  useEffect(() => {
    if (items.length > 1 && checkedItemsCount === items.length) {
      setShowConfetti(true);
      setShowCongratulationsModal(true);
      const timer = setTimeout(() => setShowConfetti(false), 3000);
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

  // Long press handlers
  const handleLongPressStart = (item: ChecklistItem) => {
    setTappedItem(item.id);
    const timer = setTimeout(() => {
      setItemToMove(item);
      setShowCategoryModal(true);
      setTappedItem(null);
    }, 500); // 500ms long press
    setLongPressTimer(timer);
  };
  const handleLongPressEnd = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
    setTappedItem(null);
  };

  // Move item to new category
  const moveItemToCategory = (newAisle: string) => {
    if (itemToMove) {
      setItems(prev => prev.map(item => item.id === itemToMove.id ? {
        ...item,
        aisle: newAisle
      } : item));
      toast.success(`Moved "${itemToMove.name}" to ${newAisle}`);
      setShowCategoryModal(false);
      setItemToMove(null);
    }
  };

  // Move selected unrecognized items to new category
  const moveSelectedItemsToCategory = (newAisle: string) => {
    const selectedIds = Array.from(selectedUnrecognizedItems);
    if (selectedIds.length > 0) {
      setItems(prev => {
        const updatedItems = prev.map(item => selectedIds.includes(item.id) ? {
          ...item,
          aisle: newAisle
        } : item);

        // Check if there are remaining unrecognized items after the move
        const remainingUnrecognized = updatedItems.filter(item => item.aisle === "Unrecognized");

        // Reset selections and view
        setSelectedUnrecognizedItems(new Set());
        setUnrecognizedModalView('items');

        // Only close modal if no unrecognized items remain
        if (remainingUnrecognized.length === 0) {
          setShowUnrecognizedModal(false);
        }
        return updatedItems;
      });
      toast.success(`Moved ${selectedIds.length} item${selectedIds.length > 1 ? 's' : ''} to ${newAisle}`);
    }
  };

  // Delete selected unrecognized items
  const deleteSelectedItems = () => {
    const selectedIds = Array.from(selectedUnrecognizedItems);
    if (selectedIds.length > 0) {
      setItems(prev => prev.filter(item => !selectedIds.includes(item.id)));
      toast.success(`Deleted ${selectedIds.length} item${selectedIds.length > 1 ? 's' : ''}`);
      setSelectedUnrecognizedItems(new Set());

      // Close modal if no more unrecognized items
      const remainingUnrecognized = items.filter(item => item.aisle === "Unrecognized" && !selectedIds.includes(item.id));
      if (remainingUnrecognized.length === 0) {
        setShowUnrecognizedModal(false);
      }
    }
  };

  // Toggle selection of unrecognized item
  const toggleUnrecognizedItemSelection = (itemId: string) => {
    setSelectedUnrecognizedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  };
  if (screen === "output") {
    return <main className="min-h-screen bg-background text-foreground">
        {showConfetti && <Confetti recycle={false} gravity={0.3} />}
        <div className="max-w-sm mx-auto px-4 space-y-6" style={{
        paddingTop: totalAmount > 0 ? '80px' : '64px',
        paddingBottom: '64px'
      }}>
          {/* Warning Banner */}
          <div className="bg-muted/50 border border-border rounded-lg p-3 flex items-center gap-3">
            <AlertTriangle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <p className="text-sm text-muted-foreground">This list will be lost if you reload this page.</p>
          </div>

          {/* Checklist */}
          <div className="space-y-6 pb-20 no-select">
            {grouped.map(({
            aisle,
            items
          }, index) => <section key={aisle} className="bg-white border-[0.5px] border-[hsl(var(--category-border))] rounded-xl overflow-hidden shadow-[0_12px_42px_rgba(0,0,0,0.12)]">
                <div className="space-y-0 bg-transparent">
                   <h2 className="text-base font-bold text-black px-4 py-3 flex items-center justify-between bg-white border-b-[0.5px] border-[#D5D5D5]">
                     <div className="flex items-center gap-2">
                       <span className="text-lg">{getCategoryEmoji(aisle)}</span>
                       {aisle}
                     </div>
                     {aisle === "Unrecognized" && (
                       <button
                         onClick={(e) => {
                           e.stopPropagation();
                           setShowUnrecognizedModal(true);
                         }}
                         className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium text-base transition-colors bg-[#004200] text-[#E6F5E6] hover:bg-[#003000]"
                       >
                         Move to
                         <ArrowRight className="w-4 h-4" />
                       </button>
                     )}
                   </h2>
                  <div className="space-y-0">
                     {items.map(item => <div key={item.id} className={`flex items-center space-x-3 px-4 py-3 transition-all duration-200 cursor-pointer relative ${item.checked ? 'bg-[hsl(var(--checked-bg))]' : 'bg-white'} ${tappedItem === item.id ? 'tapped-state' : ''}`} onClick={() => toggleItem(item)} onTouchStart={() => handleLongPressStart(item)} onTouchEnd={handleLongPressEnd} onMouseDown={() => handleLongPressStart(item)} onMouseUp={handleLongPressEnd} onMouseLeave={handleLongPressEnd}>
                         <div className="flex-shrink-0">
                           <Checkbox checked={item.checked} />
                         </div>
                         <div className="flex-1 flex items-center gap-2">
                           <span className={`text-sm font-medium ${item.checked ? 'line-through text-white' : 'text-black'}`}>
                             {item.name}
                           </span>
                           {isUnrecognized(item.aisle) && <span className="unrecognized-chip">
                               unrecognized
                             </span>}
                         </div>
                         {item.checked && item.amount && <span className="text-sm text-white">
                             AED {item.amount.toFixed(2)}
                           </span>}
                       </div>)}
                  </div>
                </div>
              </section>)}
          </div>

          {/* Fixed Header with Total Amount */}
          <div className="fixed inset-x-0 top-0 z-50" style={{
          margin: 0,
          top: 0
        }}>
            <div className="bg-white w-full">
              {totalAmount > 0 && <div className="flex justify-between items-center text-black px-4 py-4">
                  <span className="text-lg font-medium">Total:</span>
                  <span className="text-xl font-bold">AED {totalAmount.toFixed(2)}</span>
                </div>}
            </div>
            {/* Progress Bar */}
            <div className="w-full h-[2px] bg-[#D5D5D5]">
              <div className="h-full bg-[#009C00] transition-all duration-300 ease-out" style={{
              width: `${progressPercentage}%`
            }} />
            </div>
          </div>

          {/* Floating Add Button */}
          <div className="fixed bottom-6 right-6 z-50">
            
          </div>

          {/* Clear List Confirmation Dialog */}
          <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
            <AlertDialogContent className="bg-white max-w-sm mx-auto">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-black">Start a new list?</AlertDialogTitle>
                <AlertDialogDescription className="text-gray-600">
                  This will clear your current list and start fresh. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="text-black border-gray-300">Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={confirmNewList} className="bg-red-500 hover:bg-red-600 text-white">
                  Clear list
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Amount Modal */}
          <Dialog open={showAmountModal} onOpenChange={setShowAmountModal}>
            <DialogContent className="bg-card border-border max-w-sm mx-auto">
              <DialogHeader>
                <DialogTitle className="text-foreground text-center">Add amount</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <Input type="number" inputMode="decimal" placeholder="Enter item amount" value={amountInput} onChange={e => setAmountInput(e.target.value)} onKeyDown={e => {
                if (e.key === 'Enter') {
                  saveAmount();
                }
              }} autoFocus className="bg-input text-foreground border-border" />
                <Button onClick={saveAmount} className="w-full py-3 text-lg font-semibold" disabled={!amountInput.trim()}>
                  Save amount
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Category Selection Modal (for long press) */}
          <Dialog open={showCategoryModal} onOpenChange={setShowCategoryModal}>
            <DialogContent className="bg-white border-none shadow-lg max-w-sm mx-auto rounded-2xl">
              <DialogHeader className="pb-2">
                <DialogTitle className="text-lg font-semibold text-black text-left">
                  Move {itemToMove?.name} to
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-0">
                {DEFAULT_AISLES.filter(aisle => aisle !== "Unrecognized").map(aisle => <button key={aisle} onClick={() => moveItemToCategory(aisle)} className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{getCategoryEmoji(aisle)}</span>
                      <span className="text-base font-medium text-black">{aisle}</span>
                    </div>
                    <ArrowRight className="h-5 w-5 text-gray-400" />
                  </button>)}
              </div>
            </DialogContent>
          </Dialog>

          {/* Unrecognized Items Modal */}
          <Dialog open={showUnrecognizedModal} onOpenChange={open => {
          setShowUnrecognizedModal(open);
          if (!open) {
            setUnrecognizedModalView('items');
          }
        }}>
            <DialogContent className="bg-white border-none shadow-lg max-w-sm mx-auto rounded-xl">
              <DialogHeader className="py-3">
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {unrecognizedModalView === 'categories' && <button onClick={() => setUnrecognizedModalView('items')} className="mr-2 text-[#009C00]">
                          ←
                        </button>}
                      <DialogTitle className="text-base font-bold text-black">
                        {unrecognizedModalView === 'items' ? 'Unrecognized items' : 'Move to'}
                      </DialogTitle>
                    </div>
                    {unrecognizedModalView === 'items' && <span className="text-base font-bold text-black">
                        ({items.filter(item => item.aisle === "Unrecognized").length})
                      </span>}
                  </div>
                  {unrecognizedModalView === 'items' && <p className="text-sm text-gray-600 mt-1">
                      These are items we couldn't sort. Select and move or delete items.
                    </p>}
                </div>
              </DialogHeader>
              
              {unrecognizedModalView === 'items' ? <>
                  <div className="space-y-0 max-h-96 overflow-y-auto">
                    {items.filter(item => item.aisle === "Unrecognized").map(item => <div key={item.id} onClick={() => toggleUnrecognizedItemSelection(item.id)} className={`flex items-center space-x-3 px-4 py-3 transition-all duration-200 relative cursor-pointer ${selectedUnrecognizedItems.has(item.id) ? 'bg-[#009C00]' : 'bg-white hover:bg-gray-50'}`}>
                        <div className="flex-shrink-0">
                          <Checkbox checked={selectedUnrecognizedItems.has(item.id)} onCheckedChange={() => toggleUnrecognizedItemSelection(item.id)} />
                        </div>
                        <div className="flex-1 flex items-center gap-2">
                          <span className={`text-sm font-medium ${selectedUnrecognizedItems.has(item.id) ? 'text-[#FFFFFF]' : 'text-black'}`}>
                            {item.name}
                          </span>
                        </div>
                      </div>)}
                  </div>
                  <div className="flex items-center justify-between px-4 py-3 border-t-[0.5px] border-[#D5D5D5]">
                    <button onClick={deleteSelectedItems} disabled={selectedUnrecognizedItems.size === 0} className={`flex-shrink-0 w-12 h-12 rounded-xl border flex items-center justify-center transition-colors ${selectedUnrecognizedItems.size > 0 ? 'bg-[#FFE9E9] border-white' : 'bg-[#F6F6F9] border-[#F6F6F9]'}`}>
                      <svg className={`w-5 h-5 ${selectedUnrecognizedItems.size > 0 ? 'text-red-500' : 'text-[#8E8E93]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                    <button onClick={() => setUnrecognizedModalView('categories')} disabled={selectedUnrecognizedItems.size === 0} className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium text-base transition-colors ${selectedUnrecognizedItems.size > 0 ? 'bg-[#004200] text-[#E6F5E6] hover:bg-[#003000]' : 'bg-[#F6F6F9] text-[#8E8E93] border border-[#F6F6F9]'}`}>
                      Move to
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </> : <div className="space-y-0 max-h-96 overflow-y-auto">
                  {DEFAULT_AISLES.filter(aisle => aisle !== "Unrecognized").map(aisle => <button key={aisle} onClick={() => moveSelectedItemsToCategory(aisle)} className="w-full flex items-center justify-between py-4 hover:bg-gray-50 transition-colors border-b-[0.5px] border-[#009C00] last:border-b-0">
                      <div className="flex items-center gap-3">
                        <span className="text-lg">{getCategoryEmoji(aisle)}</span>
                        <span className="text-base font-medium text-[#006428]">{aisle}</span>
                      </div>
                      <ArrowRight className="h-5 w-5 text-[#006428]" />
                    </button>)}
                </div>}
            </DialogContent>
          </Dialog>


          {/* Congratulations Modal */}
          <Dialog open={showCongratulationsModal} onOpenChange={setShowCongratulationsModal}>
            <DialogContent className="bg-card border-border max-w-sm mx-auto">
              <DialogHeader>
                <DialogTitle className="text-foreground text-center text-xl font-bold">
                  Congratulations
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-6 py-6">
                <p className="text-center text-muted-foreground">
                  You have gotten all your groceries. Now you can go home without worrying that you will be scolded for missing something!
                </p>
                <Button onClick={() => setShowCongratulationsModal(false)} className="w-full py-3 text-lg font-semibold">
                  Alright
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </main>;
  }
  return <main className="min-h-screen bg-background text-foreground">
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
            <Textarea placeholder="Tap to paste grocery list or recipe URLs..." value={text} onChange={e => setText(e.target.value)} onFocus={handleTextareaFocus} className="min-h-[200px] bg-transparent border-none p-0 text-lg placeholder:text-muted-foreground resize-none focus-visible:ring-0 focus:outline-none focus:ring-0 focus:border-none rounded-[0.75rem]" />
          </div>

          {/* Input Mode Selection */}
          <div className="flex items-center gap-4">
            {/* Image Input Button */}
            <div className="relative">
              <Button variant="secondary" size="lg" className="w-16 h-16 rounded-[0.75rem] bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all duration-200 border-0 p-0" onClick={() => {
              if (inputMode === "camera") {
                setInputMode("text");
              } else {
                setInputMode("camera");
              }
            }}>
                <Image className="h-6 w-6 text-primary-foreground" />
              </Button>
              <input type="file" accept="image/*" capture="environment" onChange={e => setFile(e.target.files?.[0] || null)} className="absolute inset-0 opacity-0 cursor-pointer" />
            </div>

            {/* Get Sorted Button */}
            <Button onClick={text.trim() ? handleFromText : handleFromImage} disabled={!text.trim() && !file || loading !== "idle"} className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all duration-200 py-4 h-16 rounded-[0.75rem] text-lg font-semibold border-0">
              {loading === "ai" ? "Sorting..." : loading === "ocr" ? `OCR: ${ocrProgress}%` : "Get sorted"}
              <ArrowRight className="ml-3 h-5 w-5" />
            </Button>
          </div>

          {/* Camera/Photos Selection (when image mode is active) */}
          {inputMode === "camera" && <div className="bg-accent rounded-[0.75rem] p-4">
              <div className="grid grid-cols-2 gap-3">
                <Button variant="secondary" className="bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all duration-200 border-0 py-6 h-auto rounded-[0.75rem] text-lg font-semibold flex flex-col items-center" onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'image/*';
              input.capture = 'environment';
              input.onchange = e => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) setFile(file);
              };
              input.click();
            }}>
                  <Camera className="h-6 w-6 mb-2" />
                  Camera
                </Button>
                <Button variant="secondary" className="bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all duration-200 border-0 py-6 h-auto rounded-[0.75rem] text-lg font-semibold flex flex-col items-center" onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'image/*';
              input.onchange = e => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) setFile(file);
              };
              input.click();
            }}>
                  <Image className="h-6 w-6 mb-2" />
                  Photos
                </Button>
              </div>
            </div>}
        </div>
      </div>
    </main>;
}