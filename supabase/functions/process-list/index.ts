import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  console.log('=== PROCESS-LIST FUNCTION CALLED ===');
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  
  if (req.method === 'OPTIONS') {
    console.log('Handling CORS preflight');
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Step 1: Check environment (Lovable AI)
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    console.log('Lovable AI Key exists:', !!lovableApiKey);
    
    if (!lovableApiKey) {
      console.error('LOVABLE_API_KEY not found in environment');
      return new Response(
        JSON.stringify({ 
          error: 'AI not configured',
          details: 'LOVABLE_API_KEY environment variable is missing. Enable Lovable AI in project settings.'
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500
        }
      );
    }

    // Step 2: Parse request and validate inputs (be forgiving)
    const body = await req.json();
    console.log('Request body:', JSON.stringify(body, null, 2));

    const items = Array.isArray(body?.items) ? body.items : [];
    const urls = Array.isArray(body?.urls) ? body.urls : [];
    const images = Array.isArray(body?.images) ? body.images : [];
    const pdfs = Array.isArray(body?.pdfs) ? body.pdfs : [];

    if (items.length === 0) {
      console.warn('No text items provided. URLs or attachments present?', { hasUrls: urls.length > 0, hasImages: images.length > 0, hasPdfs: pdfs.length > 0 });
      // Gracefully return a friendly message instead of 400 to let the UI inform the user
      return new Response(
        JSON.stringify({ 
          status: 'no_recipe_found',
          notice: 'Please paste a list of items as text. URL and attachment parsing is not supported yet.'
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      );
    }

    // Step 3: Process with Lovable AI Gateway (Gemini)
    const itemsText = items.join('\n');
    console.log('Processing items:', itemsText);

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `You are a grocery categorization assistant. Categorize grocery items into UAE supermarket aisles.

Categories:
- Fresh Vegetables & Herbs
- Fresh Fruits  
- Meat & Poultry
- Fish & Seafood
- Frozen Foods
- Dairy, Laban & Cheese
- Bakery & Khubz
- Oils, Ghee & Cooking Essentials
- Canned, Jarred & Preserved
- Sauces, Pastes & Condiments
- Spices & Masalas
- Rice, Atta, Flours & Grains
- Pulses & Lentils
- Pasta & Noodles
- Breakfast & Cereals
- Baking & Desserts
- Beverages & Juices
- Water & Carbonated Drinks
- Snacks, Sweets & Chocolates
- Deli & Ready-to-Eat
- Baby Care
- Personal Care
- Household & Cleaning
- Pets
- Unrecognized

Return JSON only in this format:
{
  "categories": [
    {
      "name": "category name",
      "items": [
        {
          "display_name": "item name",
          "qty": 1,
          "unit": "",
          "notes": "",
          "source_line": "original text"
        }
      ]
    }
  ]
}`
          },
          {
            role: 'user',
            content: `Categorize these grocery items:\n${itemsText}`
          }
        ]
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI gateway error:', response.status, errorText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limits exceeded, please try again later.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: 'Payment required, please add funds to your Lovable AI workspace.' }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({ error: 'AI gateway error', details: errorText }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    const data = await response.json();
    console.log('AI response:', JSON.stringify(data, null, 2));

    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      console.error('AI response missing content');
      return new Response(
        JSON.stringify({ error: 'Empty response from AI' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    // Normalize to raw JSON (strip markdown fences or extract JSON object)
    let jsonText = String(content).trim();
    const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) {
      jsonText = fenceMatch[1].trim();
    } else {
      const firstBrace = jsonText.indexOf('{');
      const lastBrace = jsonText.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        jsonText = jsonText.slice(firstBrace, lastBrace + 1).trim();
      }
    }

    let result;
    try {
      result = JSON.parse(jsonText);
    } catch (e) {
      console.error('Failed to parse model output as JSON:', content);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to parse model output',
          details: String(e),
          preview: String(content).slice(0, 300)
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    console.log('Parsed result:', JSON.stringify(result, null, 2));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Function error:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        details: 'An unexpected error occurred while processing your request'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});