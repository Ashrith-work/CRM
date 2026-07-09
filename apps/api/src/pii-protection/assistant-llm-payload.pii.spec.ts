import { AssistantOrchestrator } from '../assistant/orchestrator';
import type { ToolContext } from '../assistant/tools/tool.types';
import { assertNoRawPII, type PiiFixtures } from './assert-no-raw-pii';

/**
 * TEST 1 & TEST 3 — the AI assistant NEVER receives raw PII.
 *
 * We mock the Anthropic client (`createMessage`) so we capture the EXACT payload
 * the orchestrator sends to the LLM on every call — the routing/tool-selection
 * calls AND the final compose call. For each captured payload we assert:
 *   • assertNoRawPII passes (no email / phone / fixture name/email/phone), and
 *   • the pseudonym + non-identifying fields ARE present (it still works).
 *
 * The customer behind pseudonym "Customer #8842" has a known real name/email/
 * phone (FIXTURES). Those must appear in NO payload — because the assistant only
 * ever sees SafeCustomers from the AI-safe repo (mocked here to return exactly
 * that shape).
 */
const FIXTURES: PiiFixtures = {
  emails: ['jane@nerige.co'],
  phones: ['+919876543210'],
  names: ['Jane Doe'],
};

// What the AI-safe repo yields for #8842 — pseudonym + non-identifying fields only.
const SAFE_ROW = {
  customerId: 'cust_abc8842',
  pseudonym: 'Customer #8842',
  emailDomain: 'nerige.co',
  rfmSegment: 'Loyal',
  clvBand: 'High',
  churnBand: 'High',
  vipTier: 'Gold',
  orderCount: 7,
  netRevenueMinor: 450000,
};

const config = {
  get: (k: string) =>
    (
      ({
        ASSISTANT_ROUTING_MODEL: 'routing-model',
        ASSISTANT_COMPOSER_MODEL: 'composer-model',
        ASSISTANT_MAX_TOOL_STEPS: 2,
        ASSISTANT_MAX_OUTPUT_TOKENS: 512,
      }) as Record<string, unknown>
    )[k],
} as never;

function makeCtx(aiSafe: Partial<Record<string, jest.Mock>>): ToolContext {
  return {
    organizationId: 'org_1',
    actorUserId: 'user_1',
    permissions: [],
    unmaskedPii: false,
    prisma: {} as never,
    analytics: {} as never,
    segments: {} as never,
    aiSafe: {
      topCustomers: jest.fn().mockResolvedValue([]),
      customerSummary: jest.fn().mockResolvedValue(null),
      churnWatchlist: jest.fn().mockResolvedValue([]),
      forCustomerIds: jest.fn().mockResolvedValue([]),
      ...aiSafe,
    } as never,
  };
}

/**
 * Drive the orchestrator through one full round-trip while capturing every LLM
 * payload. The mocked model selects `toolName` on its first routing turn, then
 * stops; the orchestrator runs that (safe) tool and composes.
 */
async function capturePayloads(
  question: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  aiSafe: Partial<Record<string, jest.Mock>>,
): Promise<{ params: Record<string, unknown> }[]> {
  let routingTurns = 0;
  const createMessage = jest.fn(async (params: { tool_choice?: { type: string } }) => {
    const isRouting = params.tool_choice?.type === 'auto';
    if (isRouting) {
      routingTurns += 1;
      if (routingTurns === 1) {
        return { content: [{ type: 'tool_use', id: 'tu_1', name: toolName, input: toolInput }], stop_reason: 'tool_use' };
      }
      return { content: [{ type: 'text', text: 'done selecting tools' }], stop_reason: 'end_turn' };
    }
    // Composer call (tool_choice: none).
    return { content: [{ type: 'text', text: 'Here is a grounded summary of Customer #8842.' }], stop_reason: 'end_turn' };
  });
  const anthropic = { isAvailable: () => true, createMessage } as never;

  const orch = new AssistantOrchestrator(anthropic, config);
  await orch.run(question, makeCtx(aiSafe), []);

  return createMessage.mock.calls.map((c) => ({ params: c[0] as Record<string, unknown> }));
}

describe('TEST 1 — assistant LLM payloads contain no raw PII', () => {
  const cases: Array<{ q: string; tool: string; input: Record<string, unknown>; aiSafe: Partial<Record<string, jest.Mock>> }> = [
    { q: 'who are our top at-risk VIPs?', tool: 'churn_watchlist', input: { limit: 20 }, aiSafe: { churnWatchlist: jest.fn().mockResolvedValue([SAFE_ROW]) } },
    { q: 'give me customer 8842 summary', tool: 'customer_summary', input: { customerId: 'cust_abc8842' }, aiSafe: { customerSummary: jest.fn().mockResolvedValue(SAFE_ROW) } },
    { q: 'who spent the most?', tool: 'top_customers', input: { by: 'net_revenue', n: 10 }, aiSafe: { topCustomers: jest.fn().mockResolvedValue([SAFE_ROW]) } },
  ];

  it.each(cases)('question "$q" → every LLM payload is PII-free', async ({ q, tool, input, aiSafe }) => {
    const calls = await capturePayloads(q, tool, input, aiSafe);
    expect(calls.length).toBeGreaterThan(0);
    calls.forEach((call, i) => assertNoRawPII(call.params, FIXTURES, `LLM call #${i} for "${q}"`));
  });

  it('the payload DOES carry the pseudonym + non-identifying fields (still works)', async () => {
    const calls = await capturePayloads('who are our top at-risk VIPs?', 'churn_watchlist', { limit: 20 }, {
      churnWatchlist: jest.fn().mockResolvedValue([SAFE_ROW]),
    });
    // The compose call is the one with tool_choice: 'none'.
    const composer = calls.find((c) => (c.params as { tool_choice?: { type: string } }).tool_choice?.type === 'none');
    expect(composer).toBeDefined();
    const blob = JSON.stringify(composer!.params);
    expect(blob).toContain('Customer #8842'); // pseudonym present
    expect(blob).toContain('nerige.co'); // email DOMAIN (non-identifying) present
    expect(blob).not.toContain('@nerige.co'); // but never a real address
  });
});

describe('TEST 3 — asking the assistant to reveal PII still leaks nothing', () => {
  it('a direct "what is customer 8842\'s email and phone?" produces PII-free payloads', async () => {
    // The safe repo can only return a pseudonymized summary — the raw email/phone
    // were never available to answer with, regardless of what the model replies.
    const calls = await capturePayloads(
      "what is customer 8842's email address and phone number?",
      'customer_summary',
      { customerId: 'cust_abc8842' },
      { customerSummary: jest.fn().mockResolvedValue(SAFE_ROW) },
    );
    expect(calls.length).toBeGreaterThan(0);
    calls.forEach((call, i) => assertNoRawPII(call.params, FIXTURES, `reveal-attempt LLM call #${i}`));
  });
});
