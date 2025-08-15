import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const openAIApiKey = Deno.env.get("OPENAI_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// UAE Supermarket Aisles (exact names as specified)
const UAE_AISLES = [
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
] as const;

interface ProcessedItem {
  input: string;
  normalized_name: string;
  category: string;
  qty: number;
  unit: string;
  notes: string;
  source: "text" | "url_page" | "url_video";
}

interface ProcessRequest {
  items?: string[];
  urls?: string[];
  content?: string; // For when URLs have been fetched and content provided
}

async function fetchUrlContent(url: string): Promise<{ content: string; type: "page" | "video" }> {
  try {
    console.log(`Fetching content from: ${url}`);
    
    // Check if it's a video URL (YouTube, etc.)
    const isVideo = /youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|tiktok\.com/i.test(url);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GroceryBot/1.0)',
      },
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status}`);
    }
    
    const content = await response.text();
    
    return {
      content,
      type: isVideo ? "video" : "page"
    };
  } catch (error) {
    console.error(`Error fetching URL ${url}:`, error);
    return { content: "", type: "page" };
  }
}

function createSystemPrompt(): string {
  return `You are the AI engine of a grocery list app for UAE supermarkets (Carrefour/LuLu style).
You must accept any input (free text list, OCR text, or content from web pages/videos) and return a categorized checklist suitable for in-store shopping.

CORE GOALS:
- If input contains recipe content: Extract ingredients/grocery items from recipes
- If input is a regular grocery list: categorize as usual
- Always group output by supermarket aisle using EXACT aisle names
- Preserve user's original wording for display while providing normalized English names

AISLE SET (use EXACT names):
${UAE_AISLES.map(aisle => `- ${aisle}`).join('\n')}

CLASSIFICATION RULES:
1. Context-first classification - consider entire phrase, not single keywords
   - "Grape juice" → Drinks & Beverages (not Fruits & Vegetables)
   - "Grilled chicken" → Meat & Poultry (ready-to-eat/cooked meat)
   - "Frozen chicken ham" → Frozen Food (packaged frozen)

2. Fresh vs processed distinction:
   - Fresh produce & fresh herbs → Fruits & Vegetables
   - Processed/canned/bottled versions go to appropriate packaged aisles
   - Tomato → Fruits & Vegetables; tomato paste → Pasta, Noodles & Tomato Products
   - Fresh tuna → Seafood; canned tuna → Canned & Jarred Food

3. Non-food override: toiletries/cleaning/pet items go to non-food aisles even with food words
   - "Lemon dishwashing liquid" → Cleaning & Household

4. Multi-language & regional synonyms (preserve original, normalize internally):
   - lauki/doodhi/sorakaya → bottle gourd → Fruits & Vegetables
   - brinjal/aubergine/baingan → eggplant → Fruits & Vegetables
   - lady's finger/bhindi → okra → Fruits & Vegetables
   - pudina → mint → Fruits & Vegetables
   - cilantro → coriander → Fruits & Vegetables
   - khubz → pita → Bakery
   - labneh → Dairy & Eggs

RECIPE EXTRACTION:
- Extract ingredient lists from recipes, ignoring cooking instructions
- Parse quantities, units, and notes from ingredient lines
- Handle ranges ("1-2 tsp"), fractions ("½ cup"), descriptors ("large onion")
- If no recipe/ingredients found, return status: "no_recipe_found"

QUANTITY & UNIT PARSING:
Recognize: kg, g, l, ml, pcs, pack, bunch, dozen, cup, tbsp, tsp
Patterns: 2 kg, 500 g, 1 l, 250 ml, 12 pcs, 1 pack, 1 bunch, fractions (1/2, ½)

OUTPUT FORMAT (JSON only):
{
  "status": "ok" | "no_recipe_found",
  "notice": "string (optional explanation; required if no_recipe_found)",
  "items": [
    {
      "input": "exact user/source text (preserve casing/spelling)",
      "normalized_name": "english canonical name (singular, lowercase)",
      "category": "one of the allowed categories above",
      "qty": number,
      "unit": "kg|g|l|ml|pcs|pack|bunch|dozen|cup|tbsp|tsp|",
      "notes": "extra descriptors (size, brand, prep hints)",
      "source": "text|url_page|url_video"
    }
  ]
}

RULES:
- Return valid JSON only, no markdown
- Use "Other / Miscellaneous" only as last resort
- Deduplicate identical items when possible
- Keep input as original text for display
- Use normalized_name for internal categorization only`;
}

function parseQuantityAndUnit(text: string): { qty: number; unit: string; notes: string } {
  // Clean the text
  const cleaned = text.toLowerCase().trim();
  
  // Common unit mappings
  const unitMap: Record<string, string> = {
    'kilogram': 'kg', 'kilograms': 'kg', 'kilo': 'kg', 'kilos': 'kg',
    'gram': 'g', 'grams': 'g', 'gm': 'g', 'gms': 'g',
    'liter': 'l', 'liters': 'l', 'litre': 'l', 'litres': 'l',
    'milliliter': 'ml', 'milliliters': 'ml', 'millilitre': 'ml', 'millilitres': 'ml',
    'piece': 'pcs', 'pieces': 'pcs', 'pc': 'pcs',
    'tablespoon': 'tbsp', 'tablespoons': 'tbsp', 'table spoon': 'tbsp',
    'teaspoon': 'tsp', 'teaspoons': 'tsp', 'tea spoon': 'tsp',
    'cups': 'cup', 'dozens': 'dozen', 'bunches': 'bunch', 'packs': 'pack', 'packets': 'pack',
    'bottle': 'pack', 'bottles': 'pack', 'jar': 'pack', 'jars': 'pack',
    'can': 'pack', 'cans': 'pack', 'box': 'pack', 'boxes': 'pack',
    'bag': 'pack', 'bags': 'pack', 'tub': 'pack', 'tubs': 'pack'
  };

  // Patterns to extract quantity and unit
  const patterns = [
    // Fractions: ½, 1/2, 1 1/2
    /(\d+\s*[½¼¾]|\d+\s*\/\s*\d+|\d+\s+\d+\s*\/\s*\d+)\s*(kg|g|l|ml|pcs|pack|bunch|dozen|cup|tbsp|tsp|kilogram|gram|liter|milliliter|piece|tablespoon|teaspoon|cups|dozens|bunches|packs|packets|bottle|bottles|jar|jars|can|cans|box|boxes|bag|bags|tub|tubs)/i,
    // Regular numbers: 2 kg, 500 g, etc.
    /(\d+(?:\.\d+)?)\s*(kg|g|l|ml|pcs|pack|bunch|dozen|cup|tbsp|tsp|kilogram|gram|liter|milliliter|piece|tablespoon|teaspoon|cups|dozens|bunches|packs|packets|bottle|bottles|jar|jars|can|cans|box|boxes|bag|bags|tub|tubs)/i,
    // Parentheses: (12), x3
    /[x×]\s*(\d+)|[\(（](\d+)[\)）]/i,
    // Just numbers at start
    /^(\d+(?:\.\d+)?)/
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match) {
      let qtyStr = match[1] || match[2] || '1';
      let unitStr = match[2] || match[3] || '';

      // Handle fractions
      if (qtyStr.includes('/')) {
        const parts = qtyStr.split(/\s+/);
        let total = 0;
        for (const part of parts) {
          if (part.includes('/')) {
            const [num, den] = part.split('/').map(Number);
            total += num / den;
          } else if (!isNaN(Number(part))) {
            total += Number(part);
          }
        }
        qtyStr = total.toString();
      } else if (qtyStr.includes('½')) {
        qtyStr = qtyStr.replace('½', '0.5');
      } else if (qtyStr.includes('¼')) {
        qtyStr = qtyStr.replace('¼', '0.25');
      } else if (qtyStr.includes('¾')) {
        qtyStr = qtyStr.replace('¾', '0.75');
      }

      const qty = parseFloat(qtyStr) || 1;
      const unit = unitMap[unitStr.toLowerCase()] || unitStr.toLowerCase() || '';
      const notes = text.replace(match[0], '').trim();

      return { qty, unit, notes };
    }
  }

  return { qty: 1, unit: '', notes: text };
}

async function processWithAI(content: string, sourceType: "text" | "url_page" | "url_video"): Promise<any> {
  try {
    const prompt = `${createSystemPrompt()}

INPUT TYPE: ${sourceType}
CONTENT TO PROCESS:
${content}

Extract grocery items and categorize them according to UAE supermarket aisles. Return valid JSON only.`;

    console.log('Sending request to OpenAI...');
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // Using legacy model for reliable results
        messages: [
          { role: 'system', content: createSystemPrompt() },
          { role: 'user', content: prompt }
        ],
        max_tokens: 2000,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const aiResponse = data.choices[0].message.content;

    console.log('AI Response:', aiResponse);

    // Parse the JSON response
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No valid JSON found in AI response');
    }

    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error('AI processing error:', error);
    throw error;
  }
}

function fallbackCategorization(items: string[], sourceType: "text" | "url_page" | "url_video"): any {
  console.log('Using fallback categorization');
  
  const processedItems: ProcessedItem[] = items.map(item => {
    const { qty, unit, notes } = parseQuantityAndUnit(item);
    
    // Simple keyword-based categorization
    let category = "Other / Miscellaneous";
    const itemLower = item.toLowerCase();
    
    // Basic categorization rules
    if (/tomato|onion|potato|carrot|cucumber|lettuce|spinach|broccoli|apple|banana|orange|lemon|garlic|ginger|mint|coriander|lauki|brinjal|bhindi|okra|capsicum|pepper/i.test(itemLower)) {
      category = "Fruits & Vegetables";
    } else if (/chicken|beef|mutton|lamb|meat|fish|salmon|tuna|shrimp|prawns/i.test(itemLower)) {
      category = "Meat & Poultry";
    } else if (/milk|cheese|yogurt|butter|eggs|paneer|labneh/i.test(itemLower)) {
      category = "Dairy & Eggs";
    } else if (/bread|naan|roti|pita|khubz/i.test(itemLower)) {
      category = "Bakery";
    } else if (/rice|wheat|dal|lentils|quinoa|oats|atta|flour/i.test(itemLower)) {
      category = "Rice & Grains";
    } else if (/oil|vinegar|sauce|ketchup|mustard|spice|masala|salt|pepper/i.test(itemLower)) {
      category = "Sauces, Oils & Condiments";
    }

    return {
      input: item,
      normalized_name: item.toLowerCase().replace(/[^\w\s]/g, '').trim(),
      category,
      qty,
      unit,
      notes,
      source: sourceType
    };
  });

  return {
    status: "ok",
    items: processedItems
  };
}

serve(async (req) => {
  console.log(`${req.method} ${req.url}`);

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { 
      status: 405, 
      headers: corsHeaders 
    });
  }

  try {
    const body = await req.json() as ProcessRequest;
    console.log('Request body:', JSON.stringify(body, null, 2));

    let contentToProcess = '';
    let sourceType: "text" | "url_page" | "url_video" = "text";
    let allItems: string[] = [];

    // Handle text items
    if (body.items && body.items.length > 0) {
      allItems = [...body.items];
      contentToProcess += body.items.join('\n') + '\n';
    }

    // Handle URLs
    if (body.urls && body.urls.length > 0) {
      for (const url of body.urls) {
        console.log(`Processing URL: ${url}`);
        const { content, type } = await fetchUrlContent(url);
        if (content) {
          contentToProcess += `\nContent from ${url}:\n${content}\n`;
          sourceType = type === "video" ? "url_video" : "url_page";
        }
      }
    }

    // Handle pre-fetched content
    if (body.content) {
      contentToProcess += body.content;
    }

    if (!contentToProcess.trim()) {
      return new Response(
        JSON.stringify({
          status: "no_recipe_found",
          notice: "No content provided to process",
          items: []
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    let result;
    
    if (!openAIApiKey) {
      console.log('No OpenAI API key, using fallback');
      result = fallbackCategorization(allItems.length > 0 ? allItems : [contentToProcess], sourceType);
    } else {
      try {
        result = await processWithAI(contentToProcess, sourceType);
      } catch (aiError) {
        console.error('AI processing failed, using fallback:', aiError);
        result = fallbackCategorization(allItems.length > 0 ? allItems : [contentToProcess], sourceType);
      }
    }

    console.log('Final result:', JSON.stringify(result, null, 2));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in generate-with-ai function:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        status: "error",
        items: []
      }), 
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});