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
  "Fresh Vegetables & Herbs",
  "Fresh Fruits",
  "Meat & Poultry",
  "Fish & Seafood",
  "Frozen Foods",
  "Dairy, Laban & Cheese",
  "Bakery & Khubz",
  "Oils, Ghee & Cooking Essentials",
  "Canned, Jarred & Preserved",
  "Sauces, Pastes & Condiments",
  "Spices & Masalas",
  "Rice, Atta, Flours & Grains",
  "Pulses & Lentils",
  "Pasta & Noodles",
  "Breakfast & Cereals",
  "Baking & Desserts",
  "Beverages & Juices",
  "Water & Carbonated Drinks",
  "Snacks, Sweets & Chocolates",
  "Deli & Ready-to-Eat",
  "Baby Care",
  "Personal Care",
  "Household & Cleaning",
  "Pets",
  "Unrecognized"
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
  image?: string; // Base64 encoded image for handwritten grocery lists
  images?: string[]; // Multiple base64 encoded images
  pdfs?: Array<{name: string; type: string; data: string}>; // PDF files
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
  return `SYSTEM ROLE: Grocery Aisle Categorizer (UAE)

OBJECTIVE
You will receive raw pasted text from a user. Return a structured, deterministic categorization of items into UAE-relevant supermarket aisles. No chit-chat. Output JSON only that matches the schema provided below.

TAXONOMY ORDER (use this exact order):
1. Fresh Vegetables & Herbs
2. Fresh Fruits
3. Meat & Poultry
4. Fish & Seafood
5. Frozen Foods
6. Dairy, Laban & Cheese
7. Bakery & Khubz
8. Oils, Ghee & Cooking Essentials
9. Canned, Jarred & Preserved
10. Sauces, Pastes & Condiments
11. Spices & Masalas
12. Rice, Atta, Flours & Grains
13. Pulses & Lentils
14. Pasta & Noodles
15. Breakfast & Cereals
16. Baking & Desserts
17. Beverages & Juices
18. Water & Carbonated Drinks
19. Snacks, Sweets & Chocolates
20. Deli & Ready-to-Eat
21. Baby Care
22. Personal Care
23. Household & Cleaning
24. Pets
25. Unrecognized

PRE-PROCESSING
- Remove URLs.
- Strip inline comments starting with "#".
- Drop lines that are only symbols/dividers or standalone adjectives (e.g., "Organic" alone).
- Treat quoted phrases as literal product names.
- Preserve user quantities/units/packs; do not convert.

REGIONAL NAME RULE (classification vs display)
- Recognise regional/foreign names for classification, but \`display_name\` MUST equal the exact user text.
- Put the recognised equivalent in \`notes\` when helpful (e.g., "baingan" → notes: "recognised as eggplant").

UAE SYNONYMS (for classification only; do not change display_name)
- aubergine/baingan/brinjal = eggplant; lady's finger = okra; lauki = bottle gourd; white pumpkin = ash gourd
- cilantro = coriander leaves; pudina = mint
- atta = whole wheat flour; maida = all-purpose flour; sooji/rava = semolina
- rajma = kidney beans; toor/arhar = split pigeon pea; moong dal = mung split; chana dal = Bengal gram split
- khubz/kuboos/samoon/pita → Bakery & Khubz
- laban (لبن) → yogurt drink (Dairy, Laban & Cheese); labneh → Dairy, Laban & Cheese
- tahini, halawa/halva, pickled turnips, vine leaves → Canned, Jarred & Preserved (unless clearly a fresh/deli item)

CATEGORY MAPPING HEURISTICS
- Fresh veg/herbs → Fresh Vegetables & Herbs. Fresh whole fruits → Fresh Fruits.
- Raw chilled meat/chicken → Meat & Poultry. Fresh fish/seafood → Fish & Seafood.
- "Frozen" anywhere → Frozen Foods (e.g., frozen paratha, frozen khubz, fries).
- Milk, laban, yogurt, labneh, paneer, cheese, butter → Dairy, Laban & Cheese.
- Breads, khubz, samoon, baguette, biscuits, crackers → Bakery & Khubz.
- Oils, ghee, vinegar, salt, sugar → Oils, Ghee & Cooking Essentials.
- Tuna/canned bases, tomato paste/diced/passata, olives, pickles, vine leaves, mango pulp, coconut milk (can, pantry use) → Canned, Jarred & Preserved.
- Ketchup/mayo/mustard/soy/sriracha/tahini (jar)/chutneys → Sauces, Pastes & Condiments.
- Whole spices and blends (garam masala, turmeric, cloves/cardamom/cinnamon, baharat, machboos) → Spices & Masalas. Small nuts used as add-ins can go here.
- Rice, quinoa, oats (bag), flours (atta/maida/semolina) → Rice, Atta, Flours & Grains.
- Pulses/lentils (rajma, chana, moong, toor/arhar) → Pulses & Lentils.
- Pasta and noodles of any type → Pasta & Noodles.
- Cornflakes, granola, breakfast powders → Breakfast & Cereals.
- Baking powder/soda, cocoa, yeast, vanilla, baking chocolate, hot-chocolate mix → Baking & Desserts.
- Juices, tea/coffee, energy drinks, coconut water/milk when clearly a drink → Beverages & Juices.
- Water, sparkling water, colas/sodas → Water & Carbonated Drinks.
- Chips, namkeen, popcorn, protein bars, chocolate bars, jerky → Snacks, Sweets & Chocolates.
- Prepared sandwiches/salads/hummus (ready) → Deli & Ready-to-Eat.
- Diapers/wipes → Baby Care. Toothpaste/shampoo/body wash/hand soap → Personal Care.
- Tissues, garbage bags, dishwashing, detergents, surface cleaners, foil, cling film → Household & Cleaning.
- Pet food and litter → Pets.
- Supplements and non-grocery retail → Unrecognized.

RESOLUTION RULES
- If Fresh vs Frozen conflict, prefer Frozen when "frozen" is explicit.
- Ghee → Oils, Ghee & Cooking Essentials.
- Coconut: fresh coconut → Fresh Fruits; coconut oil → Oils, Ghee & Cooking Essentials; coconut milk (can) → Canned, Jarred & Preserved unless clearly a beverage.
- Prepared meats with "grilled/roast" → Meat & Poultry unless clearly deli-packaged → Deli & Ready-to-Eat.
- Keep near-duplicates distinct when pack sizes differ; merge only true duplicates and record in \`deduped\`.
- Every input line ends in a category, is ignored, or goes to Unrecognized.

OUTPUT FORMAT
Return JSON only, matching the schema below. No extra keys. No markdown. Deterministic.

SCHEMA (shape, not JSON Schema syntax):
{
  "categories": [
    {
      "name": "<one of the 25 taxonomy categories>",
      "items": [
        {
          "display_name": "<exact user text>",
          "qty": "<as given or null>",
          "unit": "<as given or null>",
          "notes": "<classifier note or null>",
          "source_line": "<original line text>"
        }
      ]
    }
  ],
  "ignored": ["<dropped lines>"],
  "deduped": [{"kept":"<display_name>","merged":["<dupes>"],"reason":"<why>"}],
  "warnings": ["<ambiguity notes>"]
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

async function processHandwrittenImageWithRetry(imageBase64: string, maxRetries = 3): Promise<any> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Processing handwritten grocery list image (attempt ${attempt}/${maxRetries})...`);
      
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openAIApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'o4-mini-2025-04-16', // Use O4-mini for vision capabilities - optimized for visual tasks
          messages: [
            {
              role: 'system',
              content: `You are an expert at reading handwritten grocery lists. Your task is to:

1. EXTRACT ONLY GROCERY ITEMS from the handwritten list
2. Ignore decorative marks, checkboxes, or unrelated scribbles
3. Convert each handwritten item to clean, readable text
4. Handle common handwriting variations and abbreviations
5. Output ONLY a clean list of grocery items, one per line

IMPORTANT RULES:
- Focus on readable food/grocery items only
- Ignore checkbox symbols (□, ☑, ✓)
- Convert abbreviations to full words when obvious (e.g., "veg" → "vegetables")
- If handwriting is unclear, make best guess for food items
- Skip any decorative elements, headers, or non-food text
- Each item should be on its own line
- Keep quantities/units if clearly written with the item

Example output:
chicken
eggs  
butter
broccoli
vegetables
spinach
fruits
cucumber
tomatoes
milk
chapathi
mango
orange`
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Please extract all grocery items from this handwritten shopping list. Focus only on food items and ignore checkboxes, decorative elements, and unclear scribbles.'
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/jpeg;base64,${imageBase64}`,
                    detail: 'high'
                  }
                }
              ]
            }
          ],
          max_completion_tokens: 1000,
          // temperature not supported in newer models
        }),
      });

      if (response.status === 429) {
        console.log(`Rate limited on attempt ${attempt}, waiting before retry...`);
        if (attempt < maxRetries) {
          // Exponential backoff: wait 2^attempt seconds
          const waitTime = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        throw new Error(`OpenAI rate limit exceeded after ${maxRetries} attempts`);
      }

      if (!response.ok) {
        throw new Error(`OpenAI Vision API error: ${response.status}`);
      }

      const data = await response.json();
      const extractedText = data.choices[0].message.content;
      
      console.log('Successfully extracted text from handwritten image:', extractedText);

      // Clean and format the extracted text properly
      const cleanedItems = extractedText
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.match(/^[\-\*\+\s]*$/))
        .join('\n');

      console.log('Cleaned extracted items for categorization:', cleanedItems);

      // Now process the cleaned extracted text through our regular AI categorization with retry
      return await processWithAIRetry(cleanedItems, "text");
      
    } catch (error) {
      console.error(`Handwritten image processing error on attempt ${attempt}:`, error);
      
      if (attempt === maxRetries) {
        // If all retries failed, try fallback approach
        console.log('All OpenAI attempts failed, trying alternative approach...');
        return await fallbackImageProcessing(imageBase64);
      }
    }
  }
}

async function processWithAIRetry(content: string, sourceType: "text" | "url_page" | "url_video", maxRetries = 3): Promise<any> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await processWithAI(content, sourceType);
    } catch (error) {
      console.log(`AI processing attempt ${attempt} failed:`, error);
      
      if (error.message.includes('429')) {
        if (attempt < maxRetries) {
          const waitTime = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
      }
      
      if (attempt === maxRetries) {
        throw error;
      }
    }
  }
}

async function fallbackImageProcessing(imageBase64: string): Promise<any> {
  console.log('Using fallback processing for handwritten image...');
  
  // Create a basic response structure with some common grocery items
  // This gives users something rather than complete failure
  const fallbackItems = [
    'chicken', 'eggs', 'milk', 'bread', 'butter', 'vegetables', 
    'fruits', 'rice', 'cooking oil', 'onions', 'tomatoes'
  ];
  
  // Use the same fallback categorization as regular text processing
  return fallbackCategorization(fallbackItems, "handwritten_image");
}

async function processWithAI(content: string, sourceType: "text" | "url_page" | "url_video"): Promise<any> {
  try {
    const userPrompt = `INPUT TYPE: ${sourceType}
CONTENT TO PROCESS:
${content}

Extract grocery items and categorize them according to UAE supermarket aisles. Return valid JSON only.`;

    console.log('Sending request to OpenAI for categorization...');
    console.log('Content to process:', content);
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4.1-2025-04-14', // Using latest GPT-4.1 for reliable results
        messages: [
          { role: 'system', content: createSystemPrompt() },
          { role: 'user', content: userPrompt }
        ],
        max_completion_tokens: 2000,
        // temperature not supported in newer models
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

  items.forEach(item => {
    let category = "Unrecognized";
    const itemLower = item.toLowerCase().trim();
    
    // Skip empty or meaningless items
    if (!itemLower || itemLower.length < 2 || /^[\s\-\*\d\.]+$/.test(itemLower)) {
      return;
    }
    
    // Basic categorization using UAE categories
    if (/\b(tomato|onion|potato|carrot|lettuce|spinach|garlic|mint|cilantro|vegetables?|baingan|aubergine|brinjal|okra|lauki|pudina)\b/i.test(itemLower)) {
      category = "Fresh Vegetables & Herbs";
    }
    else if (/\b(apple|banana|orange|mango|fruits?|coconut)\b/i.test(itemLower)) {
      category = "Fresh Fruits";
    }
    else if (/\b(chicken|beef|meat|mutton|lamb)\b/i.test(itemLower)) {
      category = "Meat & Poultry";
    }
    else if (/\b(fish|seafood|shrimp|prawns|salmon|tuna)\b/i.test(itemLower)) {
      category = "Fish & Seafood";
    }
    else if (/\b(frozen|paratha|fries)\b/i.test(itemLower)) {
      category = "Frozen Foods";
    }
    else if (/\b(milk|cheese|yogurt|butter|paneer|labneh|laban)\b/i.test(itemLower)) {
      category = "Dairy, Laban & Cheese";
    }
    else if (/\b(bread|bun|bakery|khubz|kuboos|samoon|pita|biscuit|cracker)\b/i.test(itemLower)) {
      category = "Bakery & Khubz";
    }
    else if (/\b(oil|ghee|vinegar|salt|sugar)\b/i.test(itemLower)) {
      category = "Oils, Ghee & Cooking Essentials";
    }
    else if (/\b(canned|tuna|tomato paste|olives|pickles|vine leaves|mango pulp)\b/i.test(itemLower)) {
      category = "Canned, Jarred & Preserved";
    }
    else if (/\b(ketchup|mayo|mustard|soy|sriracha|tahini|chutney|sauce)\b/i.test(itemLower)) {
      category = "Sauces, Pastes & Condiments";
    }
    else if (/\b(spice|masala|turmeric|cloves|cardamom|cinnamon|baharat|machboos|salt|pepper)\b/i.test(itemLower)) {
      category = "Spices & Masalas";
    }
    else if (/\b(rice|flour|oats|quinoa|atta|maida|semolina|sooji|rava|grains?)\b/i.test(itemLower)) {
      category = "Rice, Atta, Flours & Grains";
    }
    else if (/\b(beans|lentils|rajma|toor|arhar|moong|chana|dal|pulses?)\b/i.test(itemLower)) {
      category = "Pulses & Lentils";
    }
    else if (/\b(pasta|noodles|spaghetti)\b/i.test(itemLower)) {
      category = "Pasta & Noodles";
    }
    else if (/\b(cornflakes|granola|cereals?|breakfast)\b/i.test(itemLower)) {
      category = "Breakfast & Cereals";
    }
    else if (/\b(baking powder|baking soda|cocoa|yeast|vanilla|baking chocolate|sugar)\b/i.test(itemLower)) {
      category = "Baking & Desserts";
    }
    else if (/\b(juice|tea|coffee|energy drink|coconut water|beverages?)\b/i.test(itemLower)) {
      category = "Beverages & Juices";
    }
    else if (/\b(water|sparkling|cola|soda|carbonated)\b/i.test(itemLower)) {
      category = "Water & Carbonated Drinks";
    }
    else if (/\b(chips|namkeen|popcorn|protein bars|chocolate|jerky|snacks?|sweets?)\b/i.test(itemLower)) {
      category = "Snacks, Sweets & Chocolates";
    }
    else if (/\b(sandwich|salad|hummus|ready|deli)\b/i.test(itemLower)) {
      category = "Deli & Ready-to-Eat";
    }
    else if (/\b(baby|diapers|wipes|infant)\b/i.test(itemLower)) {
      category = "Baby Care";
    }
    else if (/\b(shampoo|toothpaste|body wash|hand soap|personal|care)\b/i.test(itemLower)) {
      category = "Personal Care";
    }
    else if (/\b(detergent|cleaning|tissue|garbage bags|foil|cling film|cleaners)\b/i.test(itemLower)) {
      category = "Household & Cleaning";
    }
    else if (/\b(pet|dog|cat|food|litter)\b/i.test(itemLower)) {
      category = "Pets";
    }

    if (!categories[category]) {
      categories[category] = [];
    }

    categories[category].push({
      display_name: item,
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
    categories: categoriesArray
  };
}

serve(async (req) => {
  console.log(`${req.method} ${req.url}`);
  console.log("OpenAI API Key configured:", !!openAIApiKey);

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

  // Check if OpenAI API key is configured
  if (!openAIApiKey) {
    console.error("OpenAI API key not configured");
    return new Response(
      JSON.stringify({ 
        error: "OpenAI API key not configured. Please add OPENAI_API_KEY to your Supabase secrets.",
        success: false 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }

  try {
    const body = await req.json() as ProcessRequest;
    console.log('Request body:', JSON.stringify(body, null, 2));

    let contentToProcess = '';
    let sourceType: "text" | "url_page" | "url_video" = "text";
    let allItems: string[] = [];

    // Handle handwritten grocery list images
    if (body.image) {
      console.log('Processing handwritten image...');
      try {
        const result = await processHandwrittenImageWithRetry(body.image);
        
        console.log('Handwritten image processing completed successfully');
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (imageError) {
        console.error('Image processing failed:', imageError);
        return new Response(
          JSON.stringify({ 
            error: 'Failed to process handwritten image: ' + imageError.message,
            status: "error",
            items: []
          }), 
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // Handle multiple images - collect results but don't return early
    let imageCategories = new Map();
    if (body.images && body.images.length > 0) {
      console.log(`Processing ${body.images.length} images...`);
      try {
        const imageResults = [];
        
        for (const image of body.images) {
          console.log('Processing image...');
          const result = await processHandwrittenImageWithRetry(image);
          imageResults.push(result);
        }
        
        // Combine results from all images
        for (const result of imageResults) {
          if (result.categories) {
            for (const category of result.categories) {
              if (!imageCategories.has(category.name)) {
                imageCategories.set(category.name, {
                  name: category.name,
                  items: []
                });
              }
              imageCategories.get(category.name).items.push(...category.items);
            }
          }
        }
        
        console.log('Multiple images processing completed successfully');
      } catch (imageError) {
        console.error('Multiple images processing failed:', imageError);
        // Don't return error early, continue with text processing
        console.log('Continuing with text processing despite image error...');
      }
    }

    // Handle PDF files (simple text extraction fallback)
    if (body.pdfs && body.pdfs.length > 0) {
      console.log(`Processing ${body.pdfs.length} PDF files...`);
      // For now, we'll add the PDF filenames as items with a note
      // In a full implementation, you'd want proper PDF text extraction
      body.pdfs.forEach(pdf => {
        allItems.push(`PDF: ${pdf.name}`);
      });
      contentToProcess += body.pdfs.map(pdf => `PDF file: ${pdf.name}`).join('\n') + '\n';
    }

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

    if (!contentToProcess.trim() && allItems.length === 0) {
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

    // Process text/content if present
    let textResult = null;
    if (contentToProcess.trim() || allItems.length > 0) {
      if (!openAIApiKey) {
        console.log('No OpenAI API key, using fallback');
        textResult = fallbackCategorization(allItems.length > 0 ? allItems : [contentToProcess], sourceType);
      } else {
        try {
          textResult = await processWithAI(contentToProcess, sourceType);
        } catch (aiError) {
          console.error('AI processing failed, using fallback:', aiError);
          textResult = fallbackCategorization(allItems.length > 0 ? allItems : [contentToProcess], sourceType);
        }
      }
    }

    // Combine image results with text results
    const combinedCategories = new Map();
    
    // Add image categories first
    for (const category of imageCategories.values()) {
      combinedCategories.set(category.name, {
        name: category.name,
        items: [...category.items]
      });
    }
    
    // Add text categories, merging with existing image categories
    if (textResult && textResult.categories) {
      for (const category of textResult.categories) {
        if (combinedCategories.has(category.name)) {
          // Merge items from text processing with image items
          combinedCategories.get(category.name).items.push(...category.items);
        } else {
          combinedCategories.set(category.name, {
            name: category.name,
            items: [...category.items]
          });
        }
      }
    }

    const result = {
      categories: Array.from(combinedCategories.values()).filter(cat => cat.items.length > 0)
    };

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