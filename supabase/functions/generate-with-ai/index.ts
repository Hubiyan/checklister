import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const openAIApiKey = Deno.env.get("OPENAI_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Simple rules-based fallback categorizer
function categorizeFallback(items: string[]) {
  const aisles = {
    "Produce": [] as string[],
    "Dairy": [] as string[],
    "Bakery": [] as string[],
    "Meat/Seafood": [] as string[],
    "Frozen": [] as string[],
    "Pantry": [] as string[],
    "Beverages": [] as string[],
    "Household": [] as string[],
    "Personal Care": [] as string[],
  };
  const uncategorized: string[] = [];

  const rules: Array<{ aisle: keyof typeof aisles; keywords: string[] }> = [
    { aisle: "Produce", keywords: ["apple", "banana", "lettuce", "tomato", "onion", "garlic", "spinach", "avocado", "carrot", "pepper", "cucumber", "broccoli", "herb", "cilantro", "parsley", "lime", "lemon", "berry", "grape", "mango", "potato", "sweet potato", "mushroom"] },
    { aisle: "Dairy", keywords: ["milk", "cheese", "yogurt", "butter", "cream", "half-and-half", "eggs"] },
    { aisle: "Bakery", keywords: ["bread", "bun", "bagel", "tortilla", "pastry", "roll", "croissant", "pita"] },
    { aisle: "Meat/Seafood", keywords: ["chicken", "beef", "pork", "turkey", "salmon", "fish", "shrimp", "steak", "thigh", "breast", "ground"] },
    { aisle: "Frozen", keywords: ["frozen", "ice cream", "pizza", "veggies", "fries", "nuggets", "waffles"] },
    { aisle: "Pantry", keywords: ["rice", "pasta", "noodles", "bean", "beans", "lentil", "flour", "sugar", "salt", "pepper", "oil", "olive", "vinegar", "spice", "sauce", "tomato sauce", "cereal", "oats", "oatmeal", "tuna", "broth", "stock", "baking", "yeast", "chip", "crackers", "nut", "peanut butter", "jam", "honey"] },
    { aisle: "Beverages", keywords: ["water", "soda", "juice", "coffee", "tea", "beer", "wine", "milk"] },
    { aisle: "Household", keywords: ["paper towel", "toilet paper", "foil", "wrap", "bag", "trash", "detergent", "cleaner", "soap", "dish", "sponge"] },
    { aisle: "Personal Care", keywords: ["shampoo", "conditioner", "toothpaste", "toothbrush", "deodorant", "soap", "razor", "lotion", "tissue"] },
  ];

  const norm = (s: string) => s.toLowerCase().trim();

  const placed = new Set<string>();
  for (const item of items) {
    const i = norm(item).replace(/^[-*\d.)\s]+/, "");
    if (!i) continue;
    let matched = false;
    for (const rule of rules) {
      if (rule.keywords.some((k) => i.includes(k))) {
        if (!placed.has(i)) aisles[rule.aisle].push(i);
        placed.add(i);
        matched = true;
        break;
      }
    }
    if (!matched) {
      if (!placed.has(i)) uncategorized.push(i);
      placed.add(i);
    }
  }

  // Deduplicate within aisles
  for (const key of Object.keys(aisles) as Array<keyof typeof aisles>) {
    const seen = new Set<string>();
    aisles[key] = aisles[key].filter((x) => (seen.has(x) ? false : (seen.add(x), true)));
  }

  return { aisles, uncategorized, source: "fallback" };
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

    const system = `You are a helpful assistant that groups grocery items into supermarket aisles.
Return STRICT JSON only with this shape (no markdown, no prose):\n\n{
  "aisles": {
    "Produce": string[],
    "Dairy": string[],
    "Bakery": string[],
    "Meat/Seafood": string[],
    "Frozen": string[],
    "Pantry": string[],
    "Beverages": string[],
    "Household": string[],
    "Personal Care": string[]
  },
  "uncategorized": string[]
}\n\nRules:\n- Normalize items (lowercase, singular where natural).\n- Remove duplicates.\n- Keep concise item names (e.g., "bananas", "2% milk").\n- Only use the aisles above; if unsure, put in uncategorized.`;

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
