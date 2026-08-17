import type { ErrorCode } from 'shared/wire';

interface Props {
  code: string;
  message: string;
}

interface NextStep {
  text: string;
  /** Rendered in a code element, so a command is never shown wrapped in literal backticks. */
  command?: string;
  after?: string;
}

/**
 * Every failure arrives as a machine code plus a sentence the server already
 * wrote for a human. The only thing added here is the next action, because "what
 * do I do now" is not something the API should guess.
 *
 * Typed against the wire contract rather than `Record<string, string>`, so a
 * mistyped code fails the build instead of silently offering no next step.
 */
const NEXT_STEP: Partial<Record<ErrorCode | 'NETWORK', NextStep>> = {
  BROWSER_MISSING: {
    text: 'Run ',
    command: 'pnpm setup:browser',
    after: ' in the project root, then scan again.',
  },
  BLOCKED_HOST: {
    text: 'Scan a public address instead. To scan a local address on purpose, set ALLOW_PRIVATE_TARGETS=true in .env and restart the server.',
  },
  DNS_FAILURE: { text: 'Check the spelling of the domain.' },
  SCAN_TIMEOUT: {
    text: 'Try a specific page rather than a heavy landing page.',
  },
  TOO_MANY_SCANS: { text: 'Wait for the running scans to finish, then try again.' },
  RATE_LIMITED: { text: 'Wait for the window to reset, then try again.' },
  SNIPPET_TOO_LARGE: { text: 'Paste a smaller fragment, or scan the live page instead.' },
  NETWORK: { text: 'Start the dev servers with ', command: 'pnpm dev', after: ' in the project root.' },
  LLM_CONFIG: {
    text: 'Set GEMINI_API_KEY in .env and restart the server. Scanning works without it.',
  },
};

export function ErrorBanner({ code, message }: Props) {
  const next = NEXT_STEP[code as ErrorCode | 'NETWORK'];
  return (
    <div className="banner" role="alert">
      <h2 className="banner__h">The scan could not run</h2>
      <p>{message}</p>
      {next ? (
        <p>
          {next.text}
          {next.command ? <code>{next.command}</code> : null}
          {next.after}
        </p>
      ) : null}
      <p className="banner__code">Error code: {code}</p>
    </div>
  );
}
