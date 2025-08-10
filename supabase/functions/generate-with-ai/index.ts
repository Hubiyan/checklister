import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const openAIApiKey = Deno.env.get('OPENAI_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!openAIApiKey) {
      return new Response(JSON.stringify({ error: 'OPENAI_API_KEY is not set in Supabase secrets.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { items } = await req.json();
    if (!Array.isArray(items)) {
      return new Response(JSON.stringify({ error: 'Invalid payload. Expected { items: string[] }.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('OpenAI error response:', data);
      return new Response(JSON.stringify({ error: 'Upstream model error', details: data?.error || data }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const content = data?.choices?.[0]?.message?.content;

    let parsed: unknown;
    try {
      if (typeof content === 'string') {
        // Try direct parse first (expected with response_format)
        try {
          parsed = JSON.parse(content);
        } catch {
          // Fallback: extract JSON block between first { and last }
          const start = content.indexOf('{');
          const end = content.lastIndexOf('}');
          if (start !== -1 && end !== -1 && end > start) {
            parsed = JSON.parse(content.slice(start, end + 1));
          } else {
            throw new Error('No JSON object found in content');
          }
        }
      } else {
        throw new Error('Empty or invalid content from model');
      }
    } catch (e) {
      console.error('Failed to parse model JSON:', e, 'content:', content);
      return new Response(JSON.stringify({ error: 'Failed to parse model JSON', raw: content }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in generate-with-ai function:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
