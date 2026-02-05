import type { GeminiExtraction, GeminiValidation, Event } from './types.js';

interface GeminiConfig {
  apiKey: string;
  model: string;
  apiUrl: string;
}

let config: GeminiConfig | null = null;

export function initGemini(cfg: GeminiConfig): void {
  config = cfg;
  console.log('✅ Gemini initialized:', cfg.model);
}

function getConfig(): GeminiConfig {
  if (!config) {
    throw new Error('Gemini not initialized. Call initGemini() first.');
  }
  return config;
}

async function callGemini(prompt: string, jsonMode = true): Promise<string> {
  const cfg = getConfig();
  
  const response = await fetch(`${cfg.apiUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 2000,
      ...(jsonMode && { response_format: { type: 'json_object' } }),
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${error}`);
  }

  const data = await response.json() as { choices: Array<{ message?: { content?: string } }> };
  return data.choices[0]?.message?.content || '';
}

export async function extractEvents(
  message: string,
  context: string[] = [],
  currentDate: string = new Date().toISOString()
): Promise<GeminiExtraction> {
  const contextBlock = context.length > 0 
    ? `\nPrevious messages in this chat (for context):\n${context.map((m, i) => `${i + 1}. "${m}"`).join('\n')}\n`
    : '';

  const prompt = `Extract events/tasks/reminders from this WhatsApp message. Return JSON only.
Current date: ${currentDate}
${contextBlock}
Message to analyze:
"${message}"

Return JSON with this exact schema:
{
  "events": [
    {
      "type": "meeting" | "deadline" | "reminder" | "travel" | "task" | "subscription" | "recommendation" | "other",
      "title": "short title",
      "description": "full details or null",
      "event_time": "ISO datetime or null",
      "location": "place name or URL/service name for subscriptions (e.g. netflix.com)",
      "participants": ["names mentioned"],
      "keywords": ["searchable", "keywords"],
      "confidence": 0.0 to 1.0
    }
  ]
}

Rules:
- Understand informal/broken English and Hinglish (Hindi+English mix)
- Handle typos: "cancle" = "cancel", "tomoro" = "tomorrow"
- "kal" = tomorrow, "aaj" = today, "parso" = day after tomorrow
- "this week" = within 7 days, use end of week as event_time
- Extract times like "5pm", "shaam ko" (evening), "subah" (morning)
- For subscriptions (Netflix, Amazon Prime, gym, etc):
  - type = "subscription"
  - location = service domain (netflix.com, amazon.com, etc)
  - title = action to take (Cancel Netflix, Renew subscription, etc)
- Intent phrases like "want to", "need to", "have to", "should" indicate tasks
- If no event/task found, return: {"events": []}
- Keywords should include location, people, topics for future search
- Confidence < 0.5 if uncertain
- Even casual mentions of tasks/intentions should be captured with lower confidence`;

  const response = await callGemini(prompt);
  
  try {
    const parsed = JSON.parse(response);
    return {
      events: parsed.events || [],
    };
  } catch {
    console.error('Failed to parse Gemini response:', response);
    return { events: [] };
  }
}

export async function validateRelevance(
  url: string,
  title: string,
  candidates: Event[]
): Promise<GeminiValidation> {
  if (candidates.length === 0) {
    return { relevant: [], confidence: 0 };
  }

  const prompt = `User is browsing this webpage. Determine which saved events are relevant RIGHT NOW.

Current URL: ${url}
Page Title: ${title}

Candidate events from user's WhatsApp history:
${candidates.map((e, i) => `[${i}] ${e.title}: ${e.description || 'no description'} (location: ${e.location || 'none'}, keywords: ${e.keywords})`).join('\n')}

Return JSON with:
{
  "relevant": [0, 2, 5],  // indices of relevant events
  "confidence": 0.85      // overall confidence 0-1
}

Rules:
- Only mark events that user would find USEFUL to be reminded about NOW
- Travel booking site + travel event = relevant
- Shopping site + gift/purchase mention = relevant  
- Be conservative - fewer false positives is better
- If nothing relevant, return: {"relevant": [], "confidence": 0}`;

  const response = await callGemini(prompt);
  
  try {
    const parsed = JSON.parse(response);
    return {
      relevant: parsed.relevant || [],
      confidence: parsed.confidence || 0,
    };
  } catch {
    console.error('Failed to parse validation response:', response);
    return { relevant: [], confidence: 0 };
  }
}

export async function classifyMessage(message: string): Promise<{ hasEvent: boolean; confidence: number }> {
  // Quick heuristic check first - include common typos and variations
  const eventKeywords = /\b(meet|meeting|call|tomorrow|kal|today|aaj|deadline|reminder|book|flight|hotel|birthday|party|event|task|todo|buy|get|bring|send|submit|complete|finish|cancel|cancle|unsubscribe|subscription|netflix|amazon|prime|pay|payment|order|deliver|pickup|pick up|doctor|dentist|appointment|gym|class|lesson|exam|test|interview|plan|plans|planning|want to|need to|have to|should|must|gonna|going to|will)\b/i;
  const timePatterns = /\b(\d{1,2}:\d{2}|\d{1,2}\s*(am|pm)|morning|evening|night|subah|shaam|raat|monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month|next|this|tonight|today|tomorrow|kal|parso)\b/i;
  const intentPatterns = /\b(want|need|have|should|must|gonna|going|will|planning|plan|remind|remember|don't forget|dont forget)\s+(to|me)\b/i;
  
  const hasKeyword = eventKeywords.test(message);
  const hasTime = timePatterns.test(message);
  const hasIntent = intentPatterns.test(message);
  
  // If message has intent + keyword, it's likely an event
  if (hasIntent && hasKeyword) {
    return { hasEvent: true, confidence: 0.85 };
  }
  
  if (!hasKeyword && !hasTime && !hasIntent) {
    return { hasEvent: false, confidence: 0.9 };
  }
  
  if ((hasKeyword && hasTime) || (hasIntent && hasTime)) {
    return { hasEvent: true, confidence: 0.85 };
  }
  
  // Single signal - still worth checking with Gemini
  return { hasEvent: hasKeyword || hasTime || hasIntent, confidence: 0.6 };
}
