import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const openAIApiKey = Deno.env.get("OPENAI_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// TAXONOMY (ORDER MATTERS — USE THIS ORDER)
const TAXONOMY_CATEGORIES = [
  "Dairy & Eggs",
  "Meat, Fish & Frozen",
  "Vegetables & Herbs",
  "Fruits",
  "Bakery & Breads",
  "Pantry Staples",
  "Grains, Rice & Pulses",
  "Pasta & Noodles",
  "Baking & Desserts",
  "Beverages",
  "Snacks",
  "Spices & Condiments",
  "Household & Cleaning",
  "Personal Care",
  "Baby",
  "Pets",
  "Other / Misc"
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
  return `SYSTEM ROLE: Grocery Aisle Categorizer

OBJECTIVE
You receive raw pasted text from a user. Return a structured, deterministic categorization of grocery items by supermarket aisle using the taxonomy and rules below. No chit-chat. Output JSON only.

TAXONOMY (ORDER MATTERS — USE THIS ORDER)
${TAXONOMY_CATEGORIES.map((cat, index) => `${index + 1}. ${cat}`).join('\n')}

PRE-PROCESSING RULES
- Remove all URLs.
- Ignore lines that are only symbols, dividers, or stray adjectives (e.g., "—", "Organic" alone).
- Strip inline comments starting with "# …".
- Treat quoted phrases as literal product names.
- Preserve user-provided quantities, packs, and units; do not convert.
- Translate or map non-English grocery words to English for classification purposes ONLY, but keep original user text as the visible name.

NORMALISATION RULES
- Recognise formats like "x3", "(12)", "1 kg", "500 g", "1 l".
- Keep descriptors only if they change meaning (e.g., "unsalted butter" meaningful; drop "ripe" from bananas).
- **Regional Name Rule**: Regional synonyms (Arabic, Hindi, Tamil, Urdu, UK vs US food terms) must be RECOGNISED for correct aisle categorisation, but the \`display_name\` shown back to the user must remain EXACTLY as they typed it.
- Record the recognised equivalent in \`notes\`. Example: \`"aubergine"\` → category Vegetables & Herbs, \`display_name\` = "aubergine", \`notes\` = "recognised as eggplant".

EXAMPLES OF SYNONYMS (for classification only, not for display)
- aubergine / baingan / brinjal = eggplant
- lady's finger = okra
- lauki = bottle gourd / calabash
- white pumpkin = ash gourd
- cilantro = coriander leaves
- pudina = mint
- atta = whole wheat flour
- maida = all-purpose flour
- sooji / rava = semolina
- rajma = kidney beans
- toor dal / arhar dal = split pigeon pea
- moong dal = mung bean split
- chana dal = Bengal gram split
- دقيق = flour
- خبز = khubz / bread
- لبن = laban (yogurt drink)

CATEGORY MAPPING HEURISTICS
- Refrigerated dairy: milk, yogurt, labneh, Greek yogurt, paneer, cheese, butter → Dairy & Eggs.
- Eggs always → Dairy & Eggs.
- Fresh proteins and all frozen foods (nuggets, fries, paratha) → Meat, Fish & Frozen. Prefer Frozen here when "frozen" is present.
- Fresh veg/herbs → Vegetables & Herbs.
- Fresh & dried whole fruits → Fruits.
- Breads, khubz, baguettes, biscuits, crackers, deli sandwiches/salads → Bakery & Breads.
- Oils, sauces, condiments, pickles, canned bases (paste, passata, diced tomatoes), peanut butter, jams, spreads → Pantry Staples.
- Rice, cereals, pulses, flours, oats, quinoa → Grains, Rice & Pulses.
- Pasta, noodles of any type → Pasta & Noodles.
- Baking agents and dessert ingredients: baking powder/soda, cocoa powder, yeast, vanilla, baking chocolate, hot-chocolate mix → Baking & Desserts.
- Beverages: juices, sodas, water, coffee/tea, energy drinks, laban, coconut milk (canned) → Beverages.
- Ready-to-eat and munching items: chips, popcorn, protein bars, granola, cornflakes, jerky → Snacks.
- Whole spices and blends: garam masala, turmeric, cloves/cardamom/cinnamon; small nuts used as add-ins (walnuts small qty) → Spices & Condiments.
- Foil, wraps, detergents, tissue, garbage bags, cleaners → Household & Cleaning.
- Toothpaste, shampoo, body wash, hand soap → Personal Care.
- Diapers, wipes → Baby.
- Pet food, litter → Pets.
- Supplements and non-grocery retail (e.g., multivitamin gummies) → Other / Misc.

RESOLUTION RULES
- If item fits Fresh and Frozen, prefer Frozen if marked.
- Ghee → Pantry Staples (not Dairy).
- Coconut variants:
  - "coconut (fresh)" → Fruits
  - "coconut milk (can)" → Beverages
  - "coconut oil" → Pantry Staples
- Prepared meats (e.g., "grilled chicken half") → Meat, Fish & Frozen.
- Keep near-duplicates distinct when pack sizes differ.
- Merge pure synonyms only when identical intent and no size/count difference. Record merges in \`deduped\`.
- Everything must end up in one of: category, ignored, or misc.

OUTPUT FORMAT (JSON ONLY)
{
  "categories": [
    {
      "name": "<taxonomy category>",
      "items": [
        {
          "display_name": "<exact user text, no rewriting>",
          "qty": "<as given or null>",
          "unit": "<as given or null>",
          "notes": "<if a regional/foreign name was recognised, note its equivalent>",
          "source_line": "<original line text>"
        }
      ]
    }
  ],
  "ignored": [],
  "deduped": [],
  "warnings": []
}`;
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
  
  const categories: Record<string, any[]> = {};
  const ignored: string[] = [];
  const deduped: string[] = [];
  const warnings: string[] = [];

  items.forEach(item => {
    const { qty, unit, notes } = parseQuantityAndUnit(item);
    
    let category = "Other / Misc";
    const itemLower = item.toLowerCase();
    
    // Dairy & Eggs
    if (/\b(milk|cheese|yogurt|yoghurt|butter|cream|eggs|paneer|labneh|laban|curd|cottage cheese|mozzarella|cheddar|parmesan|feta|goat cheese|cream cheese|sour cream|heavy cream|buttermilk)\b/i.test(itemLower)) {
      category = "Dairy & Eggs";
    }
    // Meat, Fish & Frozen (includes all proteins and frozen items)
    else if (/\b(chicken|beef|mutton|lamb|goat|pork|turkey|duck|meat|steak|ground beef|ground chicken|wings|thighs|breast|drumsticks|bacon|ham|sausage|fish|salmon|tuna|cod|tilapia|shrimp|prawns|crab|lobster|frozen|nuggets|fish sticks|frozen chicken|frozen meals|ice cream|popsicles|sorbet|gelato)\b/i.test(itemLower)) {
      category = "Meat, Fish & Frozen";
    }
    // Vegetables & Herbs
    else if (/\b(tomato|onion|potato|carrot|cucumber|lettuce|spinach|broccoli|garlic|ginger|mint|coriander|cilantro|parsley|dhania|pudina|lauki|doodhi|sorakaya|bottle gourd|brinjal|aubergine|baingan|eggplant|lady finger|ladyfinger|bhindi|okra|capsicum|bell pepper|pepper|cauliflower|cabbage|beetroot|radish|turnip|sweet potato|pumpkin|squash|zucchini|mushroom|herbs|basil|oregano|thyme|rosemary|celery|asparagus|green beans|peas|corn|artichoke|kale|arugula|chard|bok choy|scallions|shallots|leeks|fennel|brussels sprouts|baby corn)\b/i.test(itemLower)) {
      category = "Vegetables & Herbs";
    }
    // Fruits
    else if (/\b(apple|banana|orange|lemon|lime|avocado|mango|pineapple|watermelon|grapes|strawberry|blueberry|kiwi|papaya|guava|pomegranate|dates|figs|coconut|dried fruit|raisins)\b/i.test(itemLower)) {
      category = "Fruits";
    }
    // Bakery & Breads
    else if (/\b(bread|bun|bagel|roll|croissant|pita|khubz|naan|roti|chapati|paratha|baguette|sourdough|whole wheat|white bread|dinner roll|hamburger bun|english muffin|muffin|cake|cookie|pastry|donut|danish|pie|tart|scone|biscuit|crackers)\b/i.test(itemLower)) {
      category = "Bakery & Breads";
    }
    // Pantry Staples (oils, sauces, condiments, canned goods, spreads)
    else if (/\b(oil|olive oil|coconut oil|vegetable oil|sesame oil|vinegar|balsamic|sauce|ketchup|mustard|mayo|mayonnaise|soy sauce|fish sauce|hot sauce|barbecue sauce|teriyaki|tahini|hummus|pesto|salsa|ranch|caesar|honey mustard|sriracha|wasabi|horseradish|canned|jarred|can of|jar of|preserves|jam|jelly|marmalade|pickles|olives|canned tomatoes|canned beans|canned corn|canned tuna|canned salmon|broth|stock|soup|applesauce|coconut milk|peanut butter|almond butter|nutella|ghee)\b/i.test(itemLower)) {
      category = "Pantry Staples";
    }
    // Grains, Rice & Pulses
    else if (/\b(rice|basmati|jasmine|brown rice|white rice|wheat|quinoa|oats|barley|dal|lentils|beans|rajma|moong|toor|chana|chickpeas|black beans|kidney beans|pinto beans|atta|flour|maida|sooji|rava|semolina|bulgur|couscous|farro|millet|buckwheat|cereal|oatmeal|granola|muesli|corn flakes|cheerios)\b/i.test(itemLower)) {
      category = "Grains, Rice & Pulses";
    }
    // Pasta & Noodles
    else if (/\b(pasta|spaghetti|penne|fusilli|macaroni|noodles|ramen|udon|shirataki|vermicelli|linguine|fettuccine|lasagna|ravioli)\b/i.test(itemLower)) {
      category = "Pasta & Noodles";
    }
    // Baking & Desserts
    else if (/\b(baking powder|baking soda|vanilla extract|cocoa powder|chocolate chips|powdered sugar|brown sugar|white sugar|cake mix|icing|frosting|food coloring|cornstarch|gelatin|yeast|chocolate|candy|hot chocolate|cocoa|matcha)\b/i.test(itemLower)) {
      category = "Baking & Desserts";
    }
    // Beverages
    else if (/\b(juice|soda|water|sparkling water|energy drink|sports drink|lemonade|iced tea|soft drink|cola|orange juice|apple juice|cranberry juice|grape juice|coconut water|smoothie|tea|coffee|chai|green tea|black tea|herbal tea|chamomile|peppermint|earl grey|espresso|cappuccino|latte|instant coffee|ground coffee|coffee beans)\b/i.test(itemLower)) {
      category = "Beverages";
    }
    // Snacks
    else if (/\b(chips|cookies|nuts|almonds|peanuts|cashews|walnuts|pistachios|popcorn|pretzels|trail mix|granola bars|energy bars|protein bars|chocolate bar|gummy)\b/i.test(itemLower)) {
      category = "Snacks";
    }
    // Spices & Condiments
    else if (/\b(spice|masala|turmeric|cumin|coriander|garam masala|chili powder|red chili|black pepper|white pepper|salt|paprika|cinnamon|cardamom|cloves|nutmeg|bay leaves|oregano|basil|thyme|rosemary|sage|dill|curry powder|tandoori|biryani masala|chat masala)\b/i.test(itemLower)) {
      category = "Spices & Condiments";
    }
    // Household & Cleaning
    else if (/\b(detergent|soap|dish soap|laundry|fabric softener|bleach|disinfectant|toilet paper|paper towels|napkins|aluminum foil|plastic wrap|garbage bags|cleaning supplies)\b/i.test(itemLower)) {
      category = "Household & Cleaning";
    }
    // Personal Care
    else if (/\b(shampoo|conditioner|body wash|lotion|moisturizer|deodorant|perfume|toothbrush|toothpaste|mouthwash|razor|shaving cream|sunscreen|makeup|lipstick|nail polish)\b/i.test(itemLower)) {
      category = "Personal Care";
    }
    // Baby
    else if (/\b(baby|infant|diapers|baby food|formula|baby lotion|baby shampoo|pacifier|baby wipes|nursing|bottle)\b/i.test(itemLower)) {
      category = "Baby";
    }
    // Pets
    else if (/\b(pet|dog|cat|bird|fish|pet food|dog food|cat food|bird seed|fish food|pet treats|litter|pet toys)\b/i.test(itemLower)) {
      category = "Pets";
    }

    if (!categories[category]) {
      categories[category] = [];
    }

    categories[category].push({
      display_name: item,
      qty: qty !== 1 ? qty : null,
      unit: unit || null,
      notes: notes !== item ? notes : null,
      source_line: item
    });
  });

  // Convert to the required format
  const categoriesArray = TAXONOMY_CATEGORIES.map(categoryName => {
    if (categories[categoryName] && categories[categoryName].length > 0) {
      return {
        name: categoryName,
        items: categories[categoryName]
      };
    }
    return null;
  }).filter(Boolean);

  return {
    categories: categoriesArray,
    ignored,
    deduped,
    warnings
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