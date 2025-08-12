import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import Tesseract from "tesseract.js";
import { supabase } from "@/integrations/supabase/client";

// Simple aisle list used for ordering
const DEFAULT_AISLES = [
  "Produce",
  "Dairy",
  "Bakery",
  "Meat/Seafood",
  "Frozen",
  "Pantry",
  "Beverages",
  "Household",
  "Personal Care",
  "uncategorized",
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
  const [tab, setTab] = useState("type");
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
    } catch (e) {
      console.error(e);
      toast.error("OCR failed", { id: t });
    } finally {
      setLoading("idle");
    }
  };

  const markAll = (checked: boolean) => {
    setItems((prev) => prev.map((i) => ({ ...i, checked })));
  };

  const toggleItem = (id: string, checked: boolean) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, checked } : i)));
  };

  const clearAll = () => {
    setItems([]);
    setText("");
    setFile(null);
  };

  return (
    <main className="min-h-screen bg-background">
      <section className="mx-auto max-w-2xl p-4 sm:p-6 space-y-6">
        <header className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">Checklister — Smart Grocery Checklist</h1>
          <p className="text-sm text-muted-foreground">Paste or type your list, or extract from an image. We’ll sort it by aisle.</p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Import</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs value={tab} onValueChange={setTab} className="w-full">
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="type">Type / Paste</TabsTrigger>
                <TabsTrigger value="image">Image</TabsTrigger>
              </TabsList>
              <TabsContent value="type" className="space-y-3">
                <Textarea
                  placeholder="e.g.\nbananas\n2% milk\nbread\nchicken thighs\nfrozen peas\n…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="min-h-[160px]"
                />
                <div className="flex gap-2 justify-end">
                  <Button onClick={handleFromText} disabled={!text.trim() || loading !== "idle"}>
                    Generate checklist
                  </Button>
                </div>
              </TabsContent>
              <TabsContent value="image" className="space-y-3">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
                {loading === "ocr" && (
                  <p className="text-sm text-muted-foreground">OCR progress: {ocrProgress}%</p>
                )}
                <div className="flex gap-2 justify-end">
                  <Button onClick={handleFromImage} disabled={!file || loading !== "idle"}>
                    Extract & generate
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {items.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Your checklist</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => markAll(true)}>Mark all</Button>
                <Button variant="outline" onClick={() => markAll(false)}>Uncheck all</Button>
                <Button variant="destructive" onClick={clearAll}>Clear</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {grouped.map(({ aisle, items }) => (
                <section key={aisle} className="space-y-3">
                  <h2 className="text-lg font-medium">{aisle}</h2>
                  <ul className="space-y-2">
                    {items.map((it) => (
                      <li key={it.id} className="flex items-center gap-3">
                        <Checkbox id={it.id} checked={it.checked} onCheckedChange={(v) => toggleItem(it.id, Boolean(v))} />
                        <label htmlFor={it.id} className="text-sm leading-none cursor-pointer select-none">
                          {it.name}
                        </label>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </CardContent>
          </Card>
        )}
      </section>
    </main>
  );
}
