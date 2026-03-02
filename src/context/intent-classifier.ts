import { IntentClass } from '../common/types/context.types.js';

const INTENT_PATTERNS: Array<{ intent: IntentClass; keywords: string[] }> = [
  {
    intent: IntentClass.ANALYTICS_QUERY,
    keywords: [
      'how many',
      'total',
      'revenue',
      'metric',
      'trend',
      'compare',
      'average',
      'count',
      'percentage',
      'growth',
      'decline',
      'kpi',
      'year over year',
      'month over month',
      'forecast',
    ],
  },
  {
    intent: IntentClass.DATA_EXPLORATION,
    keywords: [
      'show me',
      'what is',
      'explore',
      'list',
      'find',
      'related to',
      'connected',
      'linked',
      'browse',
      'which',
      'where is',
    ],
  },
  {
    intent: IntentClass.ACTION_INITIATION,
    keywords: [
      'create',
      'update',
      'run',
      'trigger',
      'automate',
      'send',
      'delete',
      'schedule',
      'execute',
      'start',
      'launch',
    ],
  },
  {
    intent: IntentClass.EXPLANATION,
    keywords: [
      'explain',
      'describe',
      'what does',
      'tell me about',
      'how does',
      'why does',
      'what are',
      'define',
      'meaning of',
    ],
  },
  {
    intent: IntentClass.SUMMARIZATION,
    keywords: [
      'summarize',
      'summary',
      'overview',
      'brief',
      'recap',
      'highlights',
      'key points',
      'top line',
    ],
  },
];

/**
 * Classify user input into an intent category using keyword matching.
 * Returns the first matching intent, or GENERAL if no patterns match.
 */
export function classifyIntent(input: string): IntentClass {
  const lower = input.toLowerCase();

  for (const { intent, keywords } of INTENT_PATTERNS) {
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        return intent;
      }
    }
  }

  return IntentClass.GENERAL;
}
