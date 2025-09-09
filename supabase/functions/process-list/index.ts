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
    // Step 1: Check environment
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    console.log('OpenAI API Key exists:', !!openAIApiKey);
    
    if (!openAIApiKey) {
      console.error('OpenAI API key not found in environment');
      return new Response(
        JSON.stringify({ 
          error: 'OpenAI API key not configured. Please check your Supabase secrets.',
          details: 'OPENAI_API_KEY environment variable is missing'
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500
        }
      );
    }

    // Step 2: Parse request
    const body = await req.json();
    console.log('Request body:', JSON.stringify(body, null, 2));
    
    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      console.error('No items provided in request');
      return new Response(
        JSON.stringify({ 
          error: 'No items provided',
          details: 'Request must include an items array with at least one item'
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400
        }
      );
    }

    // Step 3: Process with OpenAI
    const itemsText = body.items.join('\n');
    console.log('Processing items:', itemsText);
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4.1-2025-04-14',
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
        ],
        max_completion_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);
      return new Response(
        JSON.stringify({ 
          error: `OpenAI API error: ${response.status}`,
          details: errorText
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500
        }
      );
    }

    const data = await response.json();
    console.log('OpenAI response:', JSON.stringify(data, null, 2));
    
    const result = JSON.parse(data.choices[0].message.content);
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