import { classifyVerificationError, TokenVerificationFailure } from './clerk.service';

describe('classifyVerificationError (precise 401 reasons)', () => {
  const cases: Array<[unknown, string]> = [
    [{ reason: { id: 'token-expired' } }, 'expired'],
    [{ reason: { id: 'token-not-active-yet' } }, 'not-active-yet'],
    [{ reason: { id: 'token-invalid-signature' } }, 'invalid-signature'],
    [{ reason: { id: 'token-invalid-authorized-parties' } }, 'unauthorized-party'],
    [{ reason: 'token-expired' }, 'expired'], // reason as a plain string
    [new Error('JWT is expired'), 'expired'], // fall back to message text
    [new Error('something odd'), 'invalid'], // default
  ];

  it.each(cases)('maps %o → %s', (input, expected) => {
    const failure = classifyVerificationError(input);
    expect(failure).toBeInstanceOf(TokenVerificationFailure);
    expect(failure.reason).toBe(expected);
  });
});
