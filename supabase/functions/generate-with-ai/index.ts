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
  return `Extract grocery items from the given text and organize them by supermarket aisles.

INSTRUCTIONS:
1. Extract each grocery item from the text exactly as written
2. Categorize items into these supermarket aisles:
   - Dairy & Eggs
   - Meat, Fish & Frozen  
   - Vegetables & Herbs
   - Fruits
   - Bakery & Breads
   - Pantry Staples
   - Grains, Rice & Pulses
   - Pasta & Noodles
   - Baking & Desserts
   - Beverages
   - Snacks
   - Spices & Condiments
   - Household & Cleaning
   - Personal Care
   - Baby
   - Pets
   - Unrecognized

3. If you cannot clearly identify which aisle an item belongs to, put it in "Unrecognized"
4. Keep the original text exactly as written
5. Ignore non-food items like URLs, bullets, or meaningless text

OUTPUT FORMAT (JSON only):
{
  "categories": [
    {
      "name": "aisle name",
      "items": [
        {
          "display_name": "exact original text",
          "source_line": "exact original text"
        }
      ]
    }
  ]
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

  items.forEach(item => {
    let category = "Unrecognized";
    const itemLower = item.toLowerCase().trim();
    
    // Skip empty or meaningless items
    if (!itemLower || itemLower.length < 2 || /^[\s\-\*\d\.]+$/.test(itemLower)) {
      return;
    }
    
    // Basic categorization - only for very obvious items
    if (/\b(milk|cheese|yogurt|butter|eggs|paneer|labneh)\b/i.test(itemLower)) {
      category = "Dairy & Eggs";
    }
    else if (/\b(chicken|beef|fish|meat|frozen)\b/i.test(itemLower)) {
      category = "Meat, Fish & Frozen";
    }
    else if (/\b(tomato|onion|potato|carrot|lettuce|spinach|garlic|mint|cilantro|vegetables?)\b/i.test(itemLower)) {
      category = "Vegetables & Herbs";
    }
    else if (/\b(apple|banana|orange|mango|fruits?)\b/i.test(itemLower)) {
      category = "Fruits";
    }
    else if (/\b(bread|bun|bakery)\b/i.test(itemLower)) {
      category = "Bakery & Breads";
    }
    else if (/\b(oil|sauce|ketchup|mayo|vinegar)\b/i.test(itemLower)) {
      category = "Pantry Staples";
    }
    else if (/\b(rice|flour|oats|beans|lentils|grains?)\b/i.test(itemLower)) {
      category = "Grains, Rice & Pulses";
    }
    else if (/\b(pasta|noodles|spaghetti)\b/i.test(itemLower)) {
      category = "Pasta & Noodles";
    }
    else if (/\b(sugar|baking|chocolate|vanilla|cocoa)\b/i.test(itemLower)) {
      category = "Baking & Desserts";
    }
    else if (/\b(juice|water|soda|coffee|tea|drinks?|beverages?)\b/i.test(itemLower)) {
      category = "Beverages";
    }
    else if (/\b(chips|nuts|snacks?|cookies)\b/i.test(itemLower)) {
      category = "Snacks";
    }
    else if (/\b(spice|salt|pepper|masala)\b/i.test(itemLower)) {
      category = "Spices & Condiments";
    }
    else if (/\b(detergent|soap|cleaning|tissue|paper)\b/i.test(itemLower)) {
      category = "Household & Cleaning";
    }
    else if (/\b(shampoo|toothpaste|personal|care)\b/i.test(itemLower)) {
      category = "Personal Care";
    }
    else if (/\b(baby|diapers|infant)\b/i.test(itemLower)) {
      category = "Baby";
    }
    else if (/\b(pet|dog|cat|food)\b/i.test(itemLower)) {
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