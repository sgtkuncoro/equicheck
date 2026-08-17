import { useEffect, useState } from 'react';

/**
 * One live region, present from the moment the panel mounts, whose text switches
 * once at 35 seconds. A region that arrives already holding its text is commonly
 * not spoken at all, because there is no prior content to diff against, so the
 * announcement has to come from a change inside a region that already exists.
 *
 * The elapsed counter is `aria-hidden`. A one hertz counter inside a live region
 * is thirty interruptions and is the most common live-region mistake there is.
 *
 * The progress bar carries no `aria-valuenow`, which is the correct indeterminate
 * representation: the server cannot report progress, and a bar that invents 90%
 * is worse than an honest one. No `aria-busy` either, since that tells assistive
 * technology to ignore the subtree, which is the opposite of the intent.
 */
export function ScanProgress({ target }: { target: string }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <section className="panel" aria-labelledby="progress-heading">
      <h2 className="sr-only" id="progress-heading">
        Scan in progress
      </h2>
      <p className="progress__note" role="status">
        {seconds > 35
          ? 'Still working. A large page can take the full 45 seconds.'
          : `Scanning ${target}. This usually takes 10 to 30 seconds.`}
      </p>
      <div className="progress__bar" role="progressbar" aria-label="Scan progress" />
      <p className="progress__secs" aria-hidden="true">
        {seconds}s elapsed
      </p>
    </section>
  );
}
