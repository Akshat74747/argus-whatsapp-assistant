import { searchEventsByKeywords, searchEventsByLocation } from './db.js';
import { validateRelevance } from './gemini.js';
import type { Event, ContextCheckResponse } from './types.js';

// Common URL patterns to extract context
const URL_PATTERNS: Array<{ pattern: RegExp; activity: string; keywords: (match: RegExpMatchArray) => string[] }> = [
  // Travel
  { pattern: /makemytrip\.com.*\/(flights?|hotels?|trains?)\/?(.*)$/i, activity: 'travel_booking', keywords: m => extractUrlKeywords(m[2]) },
  { pattern: /goibibo\.com.*\/(flights?|hotels?)\/?(.*)$/i, activity: 'travel_booking', keywords: m => extractUrlKeywords(m[2]) },
  { pattern: /booking\.com.*\/(.*)$/i, activity: 'hotel_booking', keywords: m => extractUrlKeywords(m[1]) },
  { pattern: /airbnb\.(com|co\.in).*\/(.*)$/i, activity: 'accommodation', keywords: m => extractUrlKeywords(m[2]) },
  { pattern: /skyscanner\.(com|co\.in).*\/(.*)$/i, activity: 'flight_search', keywords: m => extractUrlKeywords(m[2]) },
  { pattern: /tripadvisor\.(com|in).*\/(.*)$/i, activity: 'travel_research', keywords: m => extractUrlKeywords(m[2]) },
  
  // Shopping
  { pattern: /amazon\.(com|in).*\/s\?.*k=([^&]+)/i, activity: 'shopping_search', keywords: m => [decodeURIComponent(m[2]).replace(/\+/g, ' ')] },
  { pattern: /amazon\.(com|in).*\/dp\/\w+/i, activity: 'shopping_product', keywords: () => [] },
  { pattern: /amazon\.(com|in)/i, activity: 'shopping', keywords: () => ['amazon', 'shopping', 'gift', 'buy'] },
  { pattern: /flipkart\.com.*\/search\?q=([^&]+)/i, activity: 'shopping_search', keywords: m => [decodeURIComponent(m[1])] },
  { pattern: /flipkart\.com/i, activity: 'shopping', keywords: () => ['flipkart', 'shopping', 'gift', 'buy'] },
  { pattern: /myntra\.com.*\/(.*)$/i, activity: 'fashion_shopping', keywords: m => extractUrlKeywords(m[1]) },
  { pattern: /myntra\.com/i, activity: 'fashion_shopping', keywords: () => ['myntra', 'fashion', 'shoes', 'sneakers', 'clothes', 'gift'] },
  { pattern: /nykaa\.com/i, activity: 'beauty_shopping', keywords: () => ['nykaa', 'beauty', 'makeup', 'cosmetics', 'skincare', 'gift'] },
  { pattern: /ajio\.com/i, activity: 'fashion_shopping', keywords: () => ['ajio', 'fashion', 'clothes', 'shoes', 'gift'] },
  { pattern: /tatacliq\.com/i, activity: 'shopping', keywords: () => ['tatacliq', 'shopping', 'electronics', 'fashion', 'gift'] },
  
  // Subscriptions
  { pattern: /netflix\.com/i, activity: 'streaming', keywords: () => ['netflix', 'subscription', 'streaming'] },
  { pattern: /spotify\.com/i, activity: 'music', keywords: () => ['spotify', 'subscription', 'music'] },
  { pattern: /primevideo\.com/i, activity: 'streaming', keywords: () => ['prime', 'amazon', 'subscription'] },
  { pattern: /hotstar\.com|disney\+/i, activity: 'streaming', keywords: () => ['hotstar', 'disney', 'subscription'] },
  { pattern: /canva\.com/i, activity: 'design', keywords: () => ['canva', 'design', 'subscription'] },
  
  // Finance
  { pattern: /policybazaar\.com.*\/(car|bike|health|life)/i, activity: 'insurance', keywords: m => [m[1], 'insurance'] },
  { pattern: /bankbazaar\.com/i, activity: 'finance', keywords: () => ['loan', 'credit', 'bank'] },
  
  // Calendar/Productivity
  { pattern: /calendar\.google\.com/i, activity: 'calendar', keywords: () => ['meeting', 'event', 'schedule'] },
  { pattern: /outlook\.(com|office)/i, activity: 'email', keywords: () => ['email', 'meeting'] },
];

function extractUrlKeywords(path: string): string[] {
  if (!path) return [];
  return path
    .split(/[/\-_?&=]+/)
    .filter(s => s.length > 2 && !/^\d+$/.test(s))
    .map(s => decodeURIComponent(s).toLowerCase())
    .slice(0, 5);
}

export function extractContextFromUrl(url: string, title?: string): { activity: string; keywords: string[] } {
  // Try URL patterns
  for (const { pattern, activity, keywords } of URL_PATTERNS) {
    const match = url.match(pattern);
    if (match) {
      const kws = keywords(match);
      // Also extract from URL path
      const urlObj = new URL(url);
      const pathKeywords = extractUrlKeywords(urlObj.pathname);
      return { 
        activity, 
        keywords: [...new Set([...kws, ...pathKeywords])].filter(Boolean),
      };
    }
  }

  // Fallback: extract from URL and title
  const urlObj = new URL(url);
  const pathKeywords = extractUrlKeywords(urlObj.pathname);
  const titleKeywords = title 
    ? title.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 5)
    : [];

  return {
    activity: 'browsing',
    keywords: [...new Set([...pathKeywords, ...titleKeywords])].filter(Boolean),
  };
}

export async function matchContext(
  url: string,
  title?: string,
  hotWindowDays = 90
): Promise<ContextCheckResponse> {
  const start = Date.now();
  
  // Step 1: Extract context from URL
  const { keywords } = extractContextFromUrl(url, title);
  
  if (keywords.length === 0) {
    return { matched: false, events: [], confidence: 0 };
  }

  console.log(`🔍 Context check: ${url}`);
  console.log(`   Keywords: ${keywords.join(', ')}`);

  // Step 2: SQL search (cascading queries)
  let candidates: Event[] = [];

  // Try exact location match first
  for (const kw of keywords) {
    candidates = searchEventsByLocation(kw, hotWindowDays, 10);
    if (candidates.length > 0) break;
  }

  // If no location match, try FTS
  if (candidates.length === 0) {
    candidates = searchEventsByKeywords(keywords, hotWindowDays, 10);
  }

  if (candidates.length === 0) {
    console.log(`   No candidates found (${Date.now() - start}ms)`);
    return { matched: false, events: [], confidence: 0 };
  }

  console.log(`   Found ${candidates.length} candidates`);

  // Step 3: Gemini validation (only top 10)
  const validation = await validateRelevance(url, title || '', candidates);

  if (validation.relevant.length === 0) {
    console.log(`   No relevant events (${Date.now() - start}ms)`);
    return { matched: false, events: [], confidence: validation.confidence };
  }

  // Get matched events
  const matchedEvents = validation.relevant
    .map(idx => candidates[idx])
    .filter((e): e is Event => e !== undefined);

  console.log(`   Matched ${matchedEvents.length} events (${Date.now() - start}ms)`);

  return {
    matched: true,
    events: matchedEvents,
    confidence: validation.confidence,
  };
}

// Quick check without Gemini (for real-time triggers)
export function quickMatchByUrl(url: string): Event[] {
  const { keywords } = extractContextFromUrl(url);
  if (keywords.length === 0) return [];
  
  return searchEventsByKeywords(keywords.slice(0, 3), 90, 5);
}
