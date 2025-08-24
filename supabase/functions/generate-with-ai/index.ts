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
    
    if (isVideo) {
      // For video URLs, we'll extract the video ID and get metadata
      console.log(`Detected video URL: ${url}`);
      
      // Extract video ID from YouTube URLs
      let videoId = '';
      const youtubeMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
      if (youtubeMatch) {
        videoId = youtubeMatch[1];
        console.log(`Extracted YouTube video ID: ${videoId}`);
        
        // Get YouTube video title and description via oEmbed API
        try {
          const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
          const oembedResponse = await fetch(oembedUrl);
          if (oembedResponse.ok) {
            const oembedData = await oembedResponse.json();
            console.log(`YouTube oEmbed data:`, oembedData);
            return {
              content: `Video Title: ${oembedData.title}\nAuthor: ${oembedData.author_name}\nProvider: ${oembedData.provider_name}`,
              type: "video"
            };
          }
        } catch (oembedError) {
          console.error('oEmbed fetch failed:', oembedError);
        }
      }
      
      // Fallback: try to fetch the page content anyway
      console.log('Falling back to page content fetch for video URL');
    }
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GroceryBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
      },
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
    }
    
    const content = await response.text();
    console.log(`Fetched content length: ${content.length}`);
    
    // Extract meaningful content from HTML
    let extractedContent = content;
    if (content.includes('<html')) {
      // Basic HTML parsing to extract text content
      extractedContent = content
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
    
    return {
      content: extractedContent,
      type: isVideo ? "video" : "page"
    };
  } catch (error) {
    console.error(`Error fetching URL ${url}:`, error);
    return { content: "", type: "page" };
  }
}

function createSystemPrompt(): string {
  return `You are the AI engine of a grocery list app for UAE supermarkets (Carrefour/LuLu style).

INPUT PARSING TASKS:
1. Parse pasted text into distinct grocery items
2. Split multiple items on one line ("milk, bread, eggs")
3. Ignore non-item noise (bullets, dividers, comments like "for cake")
4. Ignore meaningless standalone words ("Organic", "—")
5. Classify items by aisle using exact names only

AISLE SET (use EXACT names only):
${UAE_AISLES.map(aisle => `- ${aisle}`).join('\n')}

CORE PARSING RULES:
1. Preserve original text exactly as input - show user's wording (e.g., "lauki")
2. Provide normalized_name (English canonical form) internally
3. Apply context-first classification:
   - Look at whole phrase, not single keywords
   - Fresh vs processed → aisle depends on product form
   - Non-food override → Personal Care, Cleaning, Pet
   - Brand-only items → infer aisle by product type
   - Prepared/compound dishes ("chicken salad", "egg sandwich") → Other/Misc

MULTI-LANGUAGE & SYNONYMS:
Handle regional terms and typos:
- lauki/doodhi/sorakaya = bottle gourd → Fruits & Vegetables
- brinjal/aubergine/baingan = eggplant → Fruits & Vegetables  
- lady's finger/bhindi = okra → Fruits & Vegetables
- pudina = mint → Fruits & Vegetables
- cilantro = coriander → Fruits & Vegetables
- khubz = pita bread → Bakery
- labneh → Dairy & Eggs
- laban → yogurt/buttermilk → Dairy & Eggs
- Common typos: brocoli = broccoli, aubergine = eggplant

QUANTITY & UNIT EXTRACTION:
Recognize: kg, g, l, ml, pcs, pack, bunch, dozen, cup, tbsp, tsp
Patterns: "x3", "(12)", fractions (½ cup), ranges (1–2 tsp)
Store descriptors like "organic", "large", "small" in notes

CLASSIFICATION EXAMPLES:
✓ "grape juice" → Drinks & Beverages (not Fruits & Vegetables)
✓ "fresh salmon fillet" → Seafood (fresh)
✓ "salmon (smoked)" → Seafood (processed but still fish product)
✓ "canned tuna" → Canned & Jarred Food (processed/packaged)
✓ "shampoo bottle" → Personal Care (non-food override)
✓ "lemon dishwashing liquid" → Cleaning & Household (cleaning override)
✓ "chicken salad bowl" → Other / Miscellaneous (prepared dish)

DEDUPLICATION:
Merge identical items where possible (sum quantities if units match)

OUTPUT FORMAT (JSON only):
{
  "status": "ok",
  "items": [
    {
      "input": "user's original text",
      "normalized_name": "english canonical name",
      "category": "one of the allowed categories",
      "qty": 2,
      "unit": "kg",
      "notes": "any extra description",
      "source": "text|url_page|url_video"
    }
  ]
}

CRITICAL RULES:
- Never invent new categories
- Use "Other / Miscellaneous" only when no aisle fits
- Return valid JSON only, no prose or markdown
- Ensure final output is valid JSON only`;
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
  console.log('Using fallback categorization for items:', items);
  
  const processedItems: ProcessedItem[] = items.map(item => {
    const { qty, unit, notes } = parseQuantityAndUnit(item);
    
    let category = "Other / Miscellaneous";
    const itemLower = item.toLowerCase();
    
    // Comprehensive categorization rules
    // Fruits & Vegetables (including regional names)
    if (/\b(tomato|onion|potato|carrot|cucumber|lettuce|spinach|broccoli|apple|banana|orange|lemon|lime|garlic|ginger|mint|coriander|cilantro|parsley|dhania|pudina|lauki|doodhi|sorakaya|bottle gourd|brinjal|aubergine|baingan|eggplant|lady finger|ladyfinger|bhindi|okra|capsicum|bell pepper|pepper|cauliflower|cabbage|beetroot|radish|turnip|sweet potato|pumpkin|squash|zucchini|avocado|mango|pineapple|watermelon|grapes|strawberry|blueberry|kiwi|papaya|guava|pomegranate|dates|figs|coconut|mushroom|herbs|basil|oregano|thyme|rosemary|celery|asparagus|green beans|peas|corn|artichoke|kale|arugula|chard|bok choy|scallions|shallots|leeks|fennel|brussels sprouts|baby corn|fresh)\b/i.test(itemLower)) {
      category = "Fruits & Vegetables";
    }
    // Meat & Poultry
    else if (/\b(chicken|beef|mutton|lamb|goat|pork|turkey|duck|meat|steak|ground beef|ground chicken|wings|thighs|breast|drumsticks|bacon|ham|sausage|salami|pepperoni|hot dogs|ribs|tenderloin|roast|brisket|mince)\b/i.test(itemLower)) {
      category = "Meat & Poultry";
    }
    // Seafood
    else if (/\b(fish|salmon|tuna|cod|tilapia|shrimp|prawns|crab|lobster|mussels|clams|oysters|scallops|squid|octopus|sea bass|mackerel|sardines|anchovies|halibut|sole|flounder|snapper|grouper|catfish|trout)\b/i.test(itemLower)) {
      category = "Seafood";
    }
    // Dairy & Eggs
    else if (/\b(milk|cheese|yogurt|yoghurt|butter|cream|eggs|paneer|labneh|curd|cottage cheese|mozzarella|cheddar|parmesan|feta|goat cheese|cream cheese|sour cream|heavy cream|buttermilk|ice cream|gelato)\b/i.test(itemLower)) {
      category = "Dairy & Eggs";
    }
    // Bakery
    else if (/\b(bread|bun|bagel|roll|croissant|pita|khubz|naan|roti|chapati|paratha|baguette|sourdough|whole wheat|white bread|dinner roll|hamburger bun|english muffin|muffin|cake|cookie|pastry|donut|danish|pie|tart|scone|biscuit)\b/i.test(itemLower)) {
      category = "Bakery";
    }
    // Rice & Grains
    else if (/\b(rice|basmati|jasmine|brown rice|white rice|wheat|quinoa|oats|barley|dal|lentils|beans|rajma|moong|toor|chana|chickpeas|black beans|kidney beans|pinto beans|atta|flour|sooji|rava|semolina|bulgur|couscous|farro|millet|buckwheat)\b/i.test(itemLower)) {
      category = "Rice & Grains";
    }
    // Pasta, Noodles & Tomato Products
    else if (/\b(pasta|spaghetti|penne|fusilli|macaroni|noodles|ramen|udon|shirataki|vermicelli|linguine|fettuccine|lasagna|ravioli|tomato paste|tomato sauce|marinara|pizza sauce|pasta sauce|crushed tomatoes|diced tomatoes)\b/i.test(itemLower)) {
      category = "Pasta, Noodles & Tomato Products";
    }
    // Spices & Masalas
    else if (/\b(spice|masala|turmeric|cumin|coriander|garam masala|chili powder|red chili|black pepper|white pepper|salt|paprika|cinnamon|cardamom|cloves|nutmeg|bay leaves|oregano|basil|thyme|rosemary|sage|dill|curry powder|tandoori|biryani masala|chat masala)\b/i.test(itemLower)) {
      category = "Spices & Masalas";
    }
    // Sauces, Oils & Condiments
    else if (/\b(oil|olive oil|coconut oil|vegetable oil|sesame oil|vinegar|balsamic|sauce|ketchup|mustard|mayo|mayonnaise|soy sauce|fish sauce|hot sauce|barbecue sauce|teriyaki|tahini|hummus|pesto|salsa|ranch|caesar|honey mustard|sriracha|wasabi|horseradish)\b/i.test(itemLower)) {
      category = "Sauces, Oils & Condiments";
    }
    // Canned & Jarred Food
    else if (/\b(canned|jarred|can of|jar of|preserves|jam|jelly|marmalade|pickles|olives|canned tomatoes|canned beans|canned corn|canned tuna|canned salmon|broth|stock|soup|applesauce|coconut milk)\b/i.test(itemLower)) {
      category = "Canned & Jarred Food";
    }
    // Tea, Coffee & Hot Drinks
    else if (/\b(tea|coffee|chai|green tea|black tea|herbal tea|chamomile|peppermint|earl grey|espresso|cappuccino|latte|instant coffee|ground coffee|coffee beans|hot chocolate|cocoa|matcha)\b/i.test(itemLower)) {
      category = "Tea, Coffee & Hot Drinks";
    }
    // Breakfast & Spreads
    else if (/\b(cereal|oatmeal|granola|muesli|pancake mix|waffle|honey|maple syrup|peanut butter|almond butter|nutella|jam|jelly|marmalade|corn flakes|cheerios|oats|steel cut oats)\b/i.test(itemLower)) {
      category = "Breakfast & Spreads";
    }
    // Snacks & Confectionery
    else if (/\b(chips|crackers|cookies|chocolate|candy|nuts|almonds|peanuts|cashews|walnuts|pistachios|popcorn|pretzels|trail mix|granola bars|energy bars|protein bars|chocolate bar|gummy|dried fruit|raisins)\b/i.test(itemLower)) {
      category = "Snacks & Confectionery";
    }
    // Frozen Food
    else if (/\b(frozen|ice cream|frozen vegetables|frozen fruit|frozen pizza|nuggets|fish sticks|frozen berries|frozen peas|frozen corn|frozen chicken|frozen meals|popsicles|sorbet|gelato)\b/i.test(itemLower)) {
      category = "Frozen Food";
    }
    // Baking Supplies
    else if (/\b(baking powder|baking soda|vanilla extract|cocoa powder|chocolate chips|powdered sugar|brown sugar|white sugar|cake mix|icing|frosting|food coloring|cornstarch|gelatin)\b/i.test(itemLower)) {
      category = "Baking Supplies";
    }
    // Drinks & Beverages
    else if (/\b(juice|soda|water|sparkling water|energy drink|sports drink|lemonade|iced tea|soft drink|cola|orange juice|apple juice|cranberry juice|grape juice|coconut water|smoothie)\b/i.test(itemLower)) {
      category = "Drinks & Beverages";
    }
    // Cleaning & Household
    else if (/\b(detergent|soap|shampoo|conditioner|toothpaste|toilet paper|paper towels|napkins|aluminum foil|plastic wrap|garbage bags|cleaning supplies|dish soap|laundry|fabric softener|bleach|disinfectant)\b/i.test(itemLower)) {
      category = "Cleaning & Household";
    }
    // Personal Care
    else if (/\b(shampoo|conditioner|body wash|lotion|moisturizer|deodorant|perfume|toothbrush|toothpaste|mouthwash|razor|shaving cream|sunscreen|makeup|lipstick|nail polish)\b/i.test(itemLower)) {
      category = "Personal Care";
    }
    // Baby Products
    else if (/\b(baby|infant|diapers|baby food|formula|baby lotion|baby shampoo|pacifier|baby wipes|nursing|bottle)\b/i.test(itemLower)) {
      category = "Baby Products";
    }
    // Pet Products
    else if (/\b(pet|dog|cat|bird|fish|pet food|dog food|cat food|bird seed|fish food|pet treats|litter|pet toys)\b/i.test(itemLower)) {
      category = "Pet Products";
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