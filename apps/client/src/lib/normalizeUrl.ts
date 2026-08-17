export type UrlCheck = { ok: true; url: string } | { ok: false; message: string };

/**
 * Client-side validation is for immediate feedback only. The server re-validates
 * and owns the actual policy, including which addresses may be reached.
 *
 * Normalisation is written back into the field on blur, because silently
 * scanning something other than what the user typed is a trust bug.
 */
export function normalizeUrl(raw: string): UrlCheck {
  const trimmed = raw.trim().replace(/^[\u200b\ufeff]+/, '');
  if (trimmed === '') return { ok: false, message: 'Enter a web address to scan.' };

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return {
      ok: false,
      message: `"${trimmed}" is not a valid web address. For example: https://example.com/page`,
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      message: `Only http:// and https:// addresses can be scanned, not ${parsed.protocol}`,
    };
  }
  if (parsed.hostname === '') {
    return { ok: false, message: 'That address is missing a domain name.' };
  }
  if (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost') {
    return {
      ok: false,
      message: `"${parsed.hostname}" does not look like a domain name. Did you mean ${parsed.hostname}.com?`,
    };
  }

  // A fragment means nothing to a headless scan of the whole document.
  parsed.hash = '';
  return { ok: true, url: parsed.toString() };
}
