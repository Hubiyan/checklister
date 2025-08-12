import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const openAIApiKey = Deno.env.get("OPENAI_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Simple rules-based fallback categorizer with multilingual support
function categorizeFallback(items: string[]) {
  const categories = [
    "Fruits & Vegetables",
    "Meat & Poultry", 
    "Seafood",
    "Dairy & Eggs",
    "Bakery",
    "Rice & Grains",
    "Pasta, Noodles & Tomato Products",
    "Spices & Masalas",
    "Sauces, Oils & Condiments",
    "Canned & Jarred Food",
    "Tea, Coffee & Hot Drinks",
    "Breakfast & Spreads",
    "Snacks & Confectionery",
    "Frozen Food",
    "Baking Supplies",
    "Drinks & Beverages",
    "Cleaning & Household",
    "Personal Care",
    "Baby Products",
    "Pet Products",
    "Other / Miscellaneous"
  ];

  const rules: Array<{ category: string; keywords: string[] }> = [
    { category: "Fruits & Vegetables", keywords: ["apple", "banana", "lettuce", "tomato", "onion", "garlic", "spinach", "avocado", "carrot", "pepper", "cucumber", "broccoli", "lauki", "doodhi", "sorakaya", "bottle gourd", "brinjal", "aubergine", "baingan", "eggplant", "bhindi", "okra", "capsicum", "bell pepper", "coriander", "cilantro", "dhania", "mint", "pudina", "karela", "bitter gourd"] },
    { category: "Meat & Poultry", keywords: ["chicken", "beef", "pork", "turkey", "mutton", "lamb", "goat"] },
    { category: "Seafood", keywords: ["fish", "salmon", "shrimp", "prawns", "crab", "lobster"] },
    { category: "Dairy & Eggs", keywords: ["milk", "cheese", "yogurt", "butter", "cream", "eggs", "paneer", "labneh", "curd"] },
    { category: "Bakery", keywords: ["bread", "bun", "bagel", "tortilla", "pastry", "roll", "croissant", "pita", "khubz"] },
    { category: "Rice & Grains", keywords: ["rice", "wheat", "quinoa", "oats", "barley", "dal", "lentils", "beans", "rajma", "moong", "toor", "chana", "atta", "sooji", "rava", "semolina"] },
    { category: "Pasta, Noodles & Tomato Products", keywords: ["pasta", "noodles", "spaghetti", "macaroni", "shirataki", "tomato paste", "tomato sauce"] },
    { category: "Spices & Masalas", keywords: ["spice", "masala", "turmeric", "cumin", "coriander", "garam masala", "chili", "pepper"] },
    { category: "Sauces, Oils & Condiments", keywords: ["oil", "olive oil", "vinegar", "sauce", "ketchup", "mustard", "mayo", "hummus", "tahini", "achar", "pickles"] },
    { category: "Canned & Jarred Food", keywords: ["canned", "jarred", "pickled", "preserves", "jam"] },
    { category: "Tea, Coffee & Hot Drinks", keywords: ["tea", "coffee", "chai", "cocoa", "hot chocolate"] },
    { category: "Breakfast & Spreads", keywords: ["cereal", "oatmeal", "jam", "honey", "peanut butter", "nutella"] },
    { category: "Snacks & Confectionery", keywords: ["chips", "crackers", "biscuits", "cookies", "chocolate", "candy", "nuts", "mixture", "namkeen"] },
    { category: "Frozen Food", keywords: ["frozen", "ice cream", "pizza", "nuggets", "fries"] },
    { category: "Baking Supplies", keywords: ["flour", "maida", "sugar", "salt", "baking powder", "yeast", "vanilla"] },
    { category: "Drinks & Beverages", keywords: ["water", "juice", "soda", "beer", "wine", "soft drink"] },
    { category: "Cleaning & Household", keywords: ["detergent", "soap", "cleaner", "paper towel", "toilet paper", "trash bag"] },
    { category: "Personal Care", keywords: ["shampoo", "toothpaste", "deodorant", "lotion", "razor"] },
    { category: "Baby Products", keywords: ["baby", "diaper", "formula", "baby food"] },
    { category: "Pet Products", keywords: ["pet food", "dog food", "cat food", "pet"] }
  ];

  function extractQuantityAndUnit(text: string): { qty?: number; unit?: string; cleanText: string } {
    const qtyPatterns = [
      /(\d+(?:\.\d+)?)\s*(kg|g|l|ml|pcs|pack|bunch|dozen)/i,
      /x(\d+)/i,
      /\((\d+)\)/,
      /(\d+(?:\.\d+)?)\s*$/
    ];

    for (const pattern of qtyPatterns) {
      const match = text.match(pattern);
      if (match) {
        const qty = parseFloat(match[1]);
        let unit = match[2]?.toLowerCase() || "";
        if (pattern.source.includes("x")) unit = "pack";
        if (pattern.source.includes("\\(")) unit = "pcs";
        
        const cleanText = text.replace(pattern, "").trim().replace(/[-\s]+$/, "");
        return { qty, unit, cleanText };
      }
    }
    
    return { cleanText: text.trim() };
  }

  function categorizeItem(item: string) {
    const { qty, unit, cleanText } = extractQuantityAndUnit(item);
    const norm = cleanText.toLowerCase().trim();
    
    if (!norm) return null;

    for (const rule of rules) {
      if (rule.keywords.some(keyword => norm.includes(keyword.toLowerCase()))) {
        return {
          input: item,
          normalized_name: cleanText.toLowerCase(),
          category: rule.category,
          ...(qty && { qty }),
          ...(unit && { unit })
        };
      }
    }

    return {
      input: item,
      normalized_name: cleanText.toLowerCase(),
      category: "Other / Miscellaneous"
    };
  }

  const processedItems = items
    .map(item => categorizeItem(item))
    .filter(item => item !== null);

  return { items: processedItems };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { items } = await req.json();
    if (!Array.isArray(items)) {
      return new Response(
        JSON.stringify({ error: "Invalid payload. Expected { items: string[] }." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If no API key, fallback to rules-based categorization
    if (!openAIApiKey) {
      console.warn("OPENAI_API_KEY not set – using fallback categorizer");
      const result = categorizeFallback(items);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const system = `You understand grocery items in Arabic, Hindi, Urdu, Tagalog, Malayalam, Tamil, and regional names. 

ALLOWED CATEGORIES (use EXACT spelling):
Fruits & Vegetables, Meat & Poultry, Seafood, Dairy & Eggs, Bakery, Rice & Grains, Pasta, Noodles & Tomato Products, Spices & Masalas, Sauces, Oils & Condiments, Canned & Jarred Food, Tea, Coffee & Hot Drinks, Breakfast & Spreads, Snacks & Confectionery, Frozen Food, Baking Supplies, Drinks & Beverages, Cleaning & Household, Personal Care, Baby Products, Pet Products, Other / Miscellaneous

Return STRICT JSON only matching this schema:
{
  "items": [
    {
      "input": "exact user text",
      "normalized_name": "english canonical name", 
      "category": "one of the allowed categories",
      "qty": number (if found),
      "unit": "kg|g|l|ml|pcs|pack|bunch|dozen" (if found),
      "notes": "additional descriptors" (if any)
    }
  ]
}

Rules:
- Keep original input exactly as typed for display
- Create normalized_name in English (singular, lowercase unless common plural like "eggs")
- Extract quantities: "2 kg", "x3" means qty 3, "(12)" means qty 12
- Regional mappings: lauki→bottle gourd, bhindi→okra, paneer→paneer, khubz→pita, etc.
- If uncertain category, use "Other / Miscellaneous"
- Omit qty/unit/notes if not present`;

    const user = `Items to categorize (JSON array):\n${JSON.stringify(items)}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAIApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("OpenAI error response:", data);
      const result = categorizeFallback(items);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const content = data?.choices?.[0]?.message?.content;

    let parsed: unknown;
    try {
      if (typeof content === "string") {
        try {
          parsed = JSON.parse(content);
        } catch {
          const start = content.indexOf("{");
          const end = content.lastIndexOf("}");
          if (start !== -1 && end !== -1 && end > start) {
            parsed = JSON.parse(content.slice(start, end + 1));
          } else {
            throw new Error("No JSON object found in content");
          }
        }
      } else {
        throw new Error("Empty or invalid content from model");
      }
    } catch (e) {
      console.error("Failed to parse model JSON:", e, "content:", content);
      const result = categorizeFallback(items);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in generate-with-ai function:", error);
    // Even if unexpected, do a best-effort fallback to keep UX flowing
    try {
      const { items } = await req.json();
      const result = Array.isArray(items) ? categorizeFallback(items) : { error: "Unexpected error" };
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch {
      return new Response(JSON.stringify({ error: "Unexpected error" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }
});
