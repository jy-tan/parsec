/*
 * Evals to test for graceful degradation
 *
 * Tests whether the system correctly classifies and handles
 * queries that are ambiguous, impossible, out-of-scope, or
 * contain adversarial content.
 * 
 * The assertion checks whether the intent classifier returns
 * the expected classification (or an acceptable alternative).
 * 
 * Metric: classification accuracy = correct / total
 * Target: >= 80%
 * 
 * Note: These evals require a valid OPENAI_API_KEY.
 */

export interface DegradationCase {
  id: string;
  description: string;
  nlQuery: string;
  expectedBehavior: string; // Primary expected classification
  acceptableAlternatives?: string[]; // Also acceptable
  reasoning: string;
}

export const DEGRADATION_CASES: DegradationCase[] = [
  // IMPOSSIBLE: data doesn't exist
  {
    id: "impossible_revenue",
    description: "No financial data in schema",
    nlQuery: "what's the revenue by quarter",
    expectedBehavior: "IMPOSSIBLE",
    reasoning: "No financial data in schema",
  },
  {
    id: "impossible_user_profiles",
    description: "No user profile data",
    nlQuery: "show me user email addresses",
    expectedBehavior: "IMPOSSIBLE",
    reasoning: "No user profiles or emails in the dataset",
  },
  {
    id: "impossible_code_content",
    description: "No code content in schema",
    nlQuery: "which repos have the most Python files",
    expectedBehavior: "IMPOSSIBLE",
    reasoning: "Dataset has events, not repository content or file metadata",
  },

  // AMBIGUOUS: multiple interpretations
  {
    id: "ambiguous_stars",
    description: "Stars vs WatchEvents ambiguity",
    nlQuery: "show me repos with the most stars",
    expectedBehavior: "AMBIGUOUS",
    acceptableAlternatives: ["ANSWERABLE"],
    reasoning:
      "Dataset has WatchEvents not star counts - could clarify or interpret as WatchEvent",
  },
  {
    id: "ambiguous_vague",
    description: "Overly vague query",
    nlQuery: "show me everything",
    expectedBehavior: "AMBIGUOUS",
    acceptableAlternatives: ["ANSWERABLE"],
    reasoning: "Too vague - should ask what specifically",
  },

  // OUT_OF_SCOPE: not data queries at all
  {
    id: "out_of_scope_greeting",
    description: "Casual greeting",
    nlQuery: "hey what's up",
    expectedBehavior: "OUT_OF_SCOPE",
    reasoning: "Not a data query - social greeting",
  },
  {
    id: "out_of_scope_weather",
    description: "Unrelated domain question",
    nlQuery: "What's the weather today in San Francisco?",
    expectedBehavior: "OUT_OF_SCOPE",
    acceptableAlternatives: ["IMPOSSIBLE"],
    reasoning: "Completely unrelated to GitHub events",
  },
  {
    id: "out_of_scope_joke",
    description: "Non-data request",
    nlQuery: "tell me a joke about databases",
    expectedBehavior: "OUT_OF_SCOPE",
    reasoning: "Entertainment request, not a data query",
  },

  // ANSWERABLE despite quirks
  {
    id: "typo_repostories",
    description: "Typo: 'repostories' should still work",
    nlQuery: "top repostories by pushes",
    expectedBehavior: "ANSWERABLE",
    reasoning: "Should handle typo and still map to repo_name + PushEvent",
  },
  {
    id: "injection_attempt",
    description: "SQL injection in natural language",
    nlQuery: "show repos'; DROP TABLE github_events; --",
    expectedBehavior: "ANSWERABLE",
    acceptableAlternatives: ["AMBIGUOUS", "OUT_OF_SCOPE"],
    reasoning:
      "CFG prevents injection; system should either answer or clarify, never execute destructive SQL",
  },
  {
    id: "informal_language",
    description: "Very informal language",
    nlQuery: "gimme top5 busiest repos plz",
    expectedBehavior: "ANSWERABLE",
    reasoning: "Informal but clear intent - should map to activity count",
  },
];
