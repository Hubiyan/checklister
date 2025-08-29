import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Image, Camera, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import Confetti from "react-confetti";
import { ResponsiveModal } from "@/components/ResponsiveModal";
import Tesseract from "tesseract.js";
import { supabase } from "@/integrations/supabase/client";

// Aisle categories in correct order
const DEFAULT_AISLES = ["Fresh Vegetables & Herbs", "Fresh Fruits", "Meat & Poultry", "Fish & Seafood", "Frozen Foods", "Dairy, Laban & Cheese", "Bakery & Khubz", "Oils, Ghee & Cooking Essentials", "Canned, Jarred & Preserved", "Sauces, Pastes & Condiments", "Spices & Masalas", "Rice, Atta, Flours & Grains", "Pulses & Lentils", "Pasta & Noodles", "Breakfast & Cereals", "Baking & Desserts", "Beverages & Juices", "Water & Carbonated Drinks", "Snacks, Sweets & Chocolates", "Deli & Ready-to-Eat", "Baby Care", "Personal Care", "Household & Cleaning", "Pets", "Unrecognized"] as const;
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
    "Fresh Vegetables & Herbs": "🥬",
    "Fresh Fruits": "🍎", 
    "Meat & Poultry": "🍗",
    "Fish & Seafood": "🐟",
    "Frozen Foods": "🧊",
    "Dairy, Laban & Cheese": "🥛",
    "Bakery & Khubz": "🍞",
    "Oils, Ghee & Cooking Essentials": "🫒",
    "Canned, Jarred & Preserved": "🥫",
    "Sauces, Pastes & Condiments": "🍯",
    "Spices & Masalas": "🌶️",
    "Rice, Atta, Flours & Grains": "🌾",
    "Pulses & Lentils": "🫘",
    "Pasta & Noodles": "🍝",
    "Breakfast & Cereals": "🥣",
    "Baking & Desserts": "🧁",
    "Beverages & Juices": "🧃",
    "Water & Carbonated Drinks": "💧",
    "Snacks, Sweets & Chocolates": "🍫",
    "Deli & Ready-to-Eat": "🥪",
    "Baby Care": "👶",
    "Personal Care": "🧴",
    "Household & Cleaning": "🧽",
    "Pets": "🐕",
    "Unrecognized": "❓"
  };
  return emojiMap[category] || generateEmojiForCategory(category);
}

function generateEmojiForCategory(category: string): string {
  const categoryLower = category.toLowerCase();
  
  // Food categories
  if (categoryLower.includes('fruit') || categoryLower.includes('produce')) return "🍎";
  if (categoryLower.includes('vegetable') || categoryLower.includes('veggie')) return "🥬";
  if (categoryLower.includes('meat') || categoryLower.includes('protein')) return "🥩";
  if (categoryLower.includes('dairy') || categoryLower.includes('milk') || categoryLower.includes('cheese')) return "🥛";
  if (categoryLower.includes('bread') || categoryLower.includes('bakery') || categoryLower.includes('bake')) return "🍞";
  if (categoryLower.includes('frozen') || categoryLower.includes('ice')) return "🧊";
  if (categoryLower.includes('snack') || categoryLower.includes('chip')) return "🍿";
  if (categoryLower.includes('drink') || categoryLower.includes('beverage') || categoryLower.includes('juice')) return "🥤";
  if (categoryLower.includes('candy') || categoryLower.includes('sweet') || categoryLower.includes('dessert')) return "🍭";
  if (categoryLower.includes('spice') || categoryLower.includes('seasoning') || categoryLower.includes('herb')) return "🌶️";
  if (categoryLower.includes('oil') || categoryLower.includes('condiment')) return "🫗";
  if (categoryLower.includes('grain') || categoryLower.includes('rice') || categoryLower.includes('pasta')) return "🌾";
  if (categoryLower.includes('seafood') || categoryLower.includes('fish')) return "🐟";
  
  // Non-food categories
  if (categoryLower.includes('clean') || categoryLower.includes('detergent') || categoryLower.includes('soap')) return "🧽";
  if (categoryLower.includes('health') || categoryLower.includes('beauty') || categoryLower.includes('care')) return "🧴";
  if (categoryLower.includes('baby') || categoryLower.includes('infant')) return "👶";
  if (categoryLower.includes('pet') || categoryLower.includes('dog') || categoryLower.includes('cat')) return "🐕";
  if (categoryLower.includes('paper') || categoryLower.includes('tissue')) return "🧻";
  if (categoryLower.includes('medicine') || categoryLower.includes('pharmacy')) return "💊";
  if (categoryLower.includes('electronic') || categoryLower.includes('battery')) return "🔋";
  
  // Default fallback
  return "📦";
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
            aisle: category.name || "Unrecognized",
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
      aisle: item.category || item.aisle || "Unrecognized",
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
  const [unrecognizedModalView, setUnrecognizedModalView] = useState<'items' | 'categories' | 'add-category'>('items');
  const [newCategoryName, setNewCategoryName] = useState("");
  const [showAddCategoryForMove, setShowAddCategoryForMove] = useState(false);

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
    
    setLoading("ai");
    const t = toast.loading("Reading handwritten grocery list with AI...");
    
    try {
      // Convert file to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // Remove data:image/jpeg;base64, prefix
          const base64String = result.split(',')[1];
          resolve(base64String);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      // Send to our enhanced OCR edge function
      const response = await supabase.functions.invoke('generate-with-ai', {
        body: { 
          image: base64
        }
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      const result = response.data;
      console.log('AI categorization result:', result);

      // Use the same categorization logic as text flow
      const next = itemsFromAislesJson(result);
      setItems(next);
      
      // Check if there are unrecognized items and show modal
      const hasUnrecognized = next.some(item => item.aisle === "Unrecognized");
      if (hasUnrecognized) {
        setTimeout(() => {
          setShowUnrecognizedModal(true);
        }, 500); // Small delay to let the UI render
      }
      
      toast.success(`Successfully extracted ${next.length} items from handwritten list!`, { id: t });
      
      if (next.length > 0) {
        setScreen("output");
      }

    } catch (e) {
      console.error('Handwriting OCR error:', e);
      
      // Check if it's a rate limiting issue
      if (e.message && e.message.includes('rate limit')) {
        toast.error("OpenAI is temporarily busy. Please wait a moment and try again.", { id: t });
      } else if (e.message && e.message.includes('429')) {
        toast.error("Service is temporarily busy. Please wait a few seconds and try again.", { id: t });
      } else {
        toast.error("Unable to process the handwritten list right now. Please try again in a moment.", { id: t });
      }
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

  const addNewCategory = () => {
    if (!newCategoryName.trim()) return;
    
    moveSelectedItemsToCategory(newCategoryName.trim());
    setNewCategoryName("");
    setUnrecognizedModalView('items');
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
          <ResponsiveModal 
            open={showAmountModal} 
            onOpenChange={setShowAmountModal}
            title={selectedItem ? `Enter price of ${selectedItem.name}` : "Enter price"}
            position="top"
            className="max-w-sm mx-auto bg-white rounded-b-[20px]"
          >
            <div className="pb-5 px-5">
              <div className="relative bg-[#E6F5E6] border border-[#8AD18A] rounded-xl p-4 mb-6">
                <div className="flex items-center">
                  <img src="/lovable-uploads/4083dbc8-767b-4278-9ad6-0d3a989bf171.png" alt="AED" className="w-8 h-8" />
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amountInput}
                    onChange={e => setAmountInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        saveAmount();
                      }
                    }}
                    autoFocus
                    onFocus={e => {
                      e.target.select();
                      // Ensure keyboard opens on mobile
                      setTimeout(() => e.target.focus(), 100);
                    }}
                    onTouchStart={() => {
                      // Additional trigger for mobile keyboard
                    }}
                    className="bg-transparent border-none outline-none text-[#006F00] font-bold text-[32px] leading-[100%] font-[Manrope] placeholder:text-[#006F00] placeholder:opacity-60 ml-2 w-full p-[8px]"
                  />
                </div>
              </div>
            </div>
          </ResponsiveModal>

          {/* Category Selection Modal (for long press) */}
          <ResponsiveModal 
            open={showCategoryModal} 
            onOpenChange={setShowCategoryModal}
            title={`Move ${itemToMove?.name} to`}
          >
            <div className="space-y-0 max-h-80 overflow-y-auto">
              {grouped.filter(({aisle}) => aisle !== "Unrecognized").map(({aisle}) => <button key={aisle} onClick={() => moveItemToCategory(aisle)} className="w-full flex items-center justify-between py-4 hover:bg-gray-50 transition-colors border-b-[0.5px] border-[#009C00] last:border-b-0">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{getCategoryEmoji(aisle)}</span>
                    <span className="text-base font-medium text-[#006428]">{aisle}</span>
                  </div>
                  <ArrowRight className="h-5 w-5 text-[#006428]" />
                </button>)}
            </div>
            <button onClick={() => {
              setNewCategoryName("");
              setShowCategoryModal(false);
              setShowAddCategoryForMove(true);
            }} className="w-full flex items-center justify-between py-4 hover:bg-gray-50 transition-colors border-t-[0.5px] border-[#009C00] mt-2">
              <div className="flex items-center gap-3">
                <span className="text-lg">➕</span>
                <span className="text-base font-medium text-[#006428]">Add new category</span>
              </div>
              <ArrowRight className="h-5 w-5 text-[#006428]" />
            </button>
          </ResponsiveModal>

          {/* Unrecognized Items Modal */}
          <ResponsiveModal 
            open={showUnrecognizedModal} 
            onOpenChange={open => {
              setShowUnrecognizedModal(open);
              if (!open) {
                setUnrecognizedModalView('items');
                setNewCategoryName("");
              }
            }}
          >
            <div className="py-3 px-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {(unrecognizedModalView === 'categories' || unrecognizedModalView === 'add-category') && <button onClick={() => setUnrecognizedModalView(unrecognizedModalView === 'add-category' ? 'categories' : 'items')} className="mr-2 text-[#009C00]">
                      ←
                    </button>}
                  <h2 className="text-base font-bold text-black">
                    {unrecognizedModalView === 'items' ? 'Unrecognized items' : 
                     unrecognizedModalView === 'categories' ? 'Move to' : 'Add new category'}
                  </h2>
                </div>
                {unrecognizedModalView === 'items' && <span className="text-base font-bold text-black">
                    ({items.filter(item => item.aisle === "Unrecognized").length})
                  </span>}
              </div>
              {unrecognizedModalView === 'items' && <p className="text-sm text-gray-600 mt-1 text-left">
                  These are items we couldn't sort. Select and move or delete items.
                </p>}
            </div>
              
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
                  <div className="flex items-center justify-between px-4 py-3 border-t-[0.5px] border-[#D5D5D5] gap-3">
                    <button onClick={deleteSelectedItems} disabled={selectedUnrecognizedItems.size === 0} className={`flex-shrink-0 w-12 h-12 rounded-xl border flex items-center justify-center transition-colors ${selectedUnrecognizedItems.size > 0 ? 'bg-[#FFE9E9] border-white' : 'bg-[#F6F6F9] border-[#F6F6F9]'}`}>
                      <svg className={`w-5 h-5 ${selectedUnrecognizedItems.size > 0 ? 'text-red-500' : 'text-[#8E8E93]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                    <button onClick={() => setUnrecognizedModalView('add-category')} disabled={selectedUnrecognizedItems.size === 0} className={`flex items-center justify-center gap-2 px-3 py-3 rounded-xl font-medium text-sm transition-colors ${selectedUnrecognizedItems.size > 0 ? 'bg-[#E6F5E6] text-[#004200] border border-[#B8E6B8] hover:bg-[#D4F4D4]' : 'bg-[#F6F6F9] text-[#8E8E93] border border-[#F6F6F9]'}`}>
                      Add category
                    </button>
                    <button onClick={() => setUnrecognizedModalView('categories')} disabled={selectedUnrecognizedItems.size === 0} className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium text-base transition-colors ${selectedUnrecognizedItems.size > 0 ? 'bg-[#004200] text-[#E6F5E6] hover:bg-[#003000]' : 'bg-[#F6F6F9] text-[#8E8E93] border border-[#F6F6F9]'}`}>
                      Move to
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </> : unrecognizedModalView === 'categories' ? <div className="space-y-0">
                  <div className="max-h-80 overflow-y-auto">
                    {grouped.filter(({aisle}) => aisle !== "Unrecognized").map(({aisle}) => <button key={aisle} onClick={() => moveSelectedItemsToCategory(aisle)} className="w-full flex items-center justify-between py-4 hover:bg-gray-50 transition-colors border-b-[0.5px] border-[#009C00] last:border-b-0">
                        <div className="flex items-center gap-3">
                          <span className="text-lg">{getCategoryEmoji(aisle)}</span>
                          <span className="text-base font-medium text-[#006428]">{aisle}</span>
                        </div>
                        <ArrowRight className="h-5 w-5 text-[#006428]" />
                      </button>)}
                  </div>
                </div> : <div className="space-y-4 p-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">Enter category name</label>
                    <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg">
                      <span className="text-lg">{newCategoryName ? generateEmojiForCategory(newCategoryName) : "📦"}</span>
                      <input
                        type="text"
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        placeholder="Category name"
                        className="flex-1 bg-transparent border-none outline-none text-base"
                        onKeyDown={(e) => e.key === 'Enter' && addNewCategory()}
                        autoFocus
                      />
                    </div>
                  </div>
                  <button 
                    onClick={addNewCategory}
                    disabled={!newCategoryName.trim()}
                    className={`w-full py-3 px-4 rounded-lg font-medium text-base transition-colors ${
                      newCategoryName.trim() 
                        ? 'bg-[#004200] text-white hover:bg-[#003000]' 
                        : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    Add ➕
                  </button>
                </div>}
          </ResponsiveModal>

          {/* Add Category Modal (for long press) */}
          <ResponsiveModal 
            open={showAddCategoryForMove} 
            onOpenChange={setShowAddCategoryForMove}
            title="Add new category"
          >
            <div className="space-y-4 p-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Enter category name</label>
                <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg">
                  <span className="text-lg">{newCategoryName ? generateEmojiForCategory(newCategoryName) : "📦"}</span>
                  <input
                    type="text"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    placeholder="Category name"
                    className="flex-1 bg-transparent border-none outline-none text-base"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newCategoryName.trim() && itemToMove) {
                        moveItemToCategory(newCategoryName.trim());
                        setNewCategoryName("");
                        setShowAddCategoryForMove(false);
                      }
                    }}
                    autoFocus
                  />
                </div>
              </div>
              <button 
                onClick={() => {
                  if (newCategoryName.trim() && itemToMove) {
                    moveItemToCategory(newCategoryName.trim());
                    setNewCategoryName("");
                    setShowAddCategoryForMove(false);
                  }
                }}
                disabled={!newCategoryName.trim()}
                className={`w-full py-3 px-4 rounded-lg font-medium text-base transition-colors ${
                  newCategoryName.trim() 
                    ? 'bg-[#004200] text-white hover:bg-[#003000]' 
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}
              >
                Add ➕
              </button>
            </div>
          </ResponsiveModal>

          {/* Congratulations Modal */}
          <ResponsiveModal 
            open={showCongratulationsModal} 
            onOpenChange={setShowCongratulationsModal}
            title="Congratulations"
          >
            <div className="space-y-6 py-6 px-4">
              <p className="text-center text-muted-foreground">
                You have gotten all your groceries. Now you can go home without worrying that you will be scolded for missing something!
              </p>
              <Button onClick={() => setShowCongratulationsModal(false)} className="w-full py-3 text-lg font-semibold">
                Alright
              </Button>
            </div>
          </ResponsiveModal>
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