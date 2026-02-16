/**
 * Returns hardcoded pricing insights for mock transcripts (no OpenAI call).
 * Used when OPENAI_API_KEY is not set in fallback mode.
 */

const MOCK_INSIGHTS = [
  {
    pricing_discussed: true,
    conversation_type: 'Negotiation',
    discount_requested_percent: 15,
    budget_mentioned: 'needs approval',
    competitor_mentioned: 'CompetitorX',
    objection_category: 'Too Expensive',
    pricing_sentiment: 'Neutral',
    key_quotes: ['Your price is a bit higher than CompetitorX', 'hoping for something around 15% lower'],
    confidence_score: 0.9,
  },
  {
    pricing_discussed: true,
    conversation_type: 'Expansion',
    discount_requested_percent: null,
    budget_mentioned: 'approved for Q2',
    competitor_mentioned: null,
    objection_category: 'None',
    pricing_sentiment: 'Positive',
    key_quotes: ['Budget is approved for Q2', 'no objections on our side'],
    confidence_score: 0.95,
  },
  {
    pricing_discussed: true,
    conversation_type: 'Objection',
    discount_requested_percent: null,
    budget_mentioned: 'budget freeze until mid-year',
    competitor_mentioned: null,
    objection_category: 'Budget Freeze',
    pricing_sentiment: 'Negative',
    key_quotes: ['budget freeze until mid-year', 'comparing a few vendors'],
    confidence_score: 0.85,
  },
];

let index = 0;

/**
 * Returns next mock insight (cycles over MOCK_INSIGHTS). No API call.
 */
export function getMockInsight() {
  const insight = MOCK_INSIGHTS[index % MOCK_INSIGHTS.length];
  index += 1;
  return { ...insight };
}
