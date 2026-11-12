export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — most accurate (default)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — about half the cost' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 — cheapest, least accurate' },
];
/** Models that support server-side refusal fallback. */
export const FALLBACK_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5'];
