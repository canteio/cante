import { AlertTriangle, CheckCircle2, CircleSlash, ExternalLink } from "lucide-react";
import { RunButton } from "@/components/dashboard/run-button";
import { Sidebar } from "@/components/dashboard/sidebar";
import { getDefaultCustomerId, getRunHistory, type RunHistoryEntry } from "@/lib/db/queries";
import { normalizeJurisdiction } from "@/lib/countries";
import { CountryTabs } from "@/components/dashboard/country-tabs";

export const dynamic = "force-dynamic";

export default async function ChecksPage({ searchParams }: { searchParams: Promise<{ country?: string }> }) {
  const params = await searchParams;
  const jurisdiction = normalizeJurisdiction(params.country);
  const customerId = await getDefaultCustomerId();
  const history = customerId ? await getRunHistory(customerId, 30, jurisdiction) : [];

  return (
    <div className="shell">
      <Sidebar active="checks" jurisdiction={jurisdiction} />
      <main className="main">
        <div className="main-scroll">
          <div className="main-inner">
            <div className="page-head">
              <div>
                <h1>Daily Checks &amp; Regulatory Feeds</h1>
                <p className="page-sub">
                  Automated monitoring across official government gazettes (JDIH, INSW, Federal Register, eCFR, and Trade.gov CSL) to detect amendments affecting your operations.
                </p>
              </div>
              <div className="page-actions">
                <CountryTabs value={jurisdiction} />
                <RunButton customerId={customerId} country={jurisdiction} />
              </div>
            </div>

            {!customerId ? (
              <div className="empty">
                No customer yet. Run{" "}
                <code className="mono">npm run db:push &amp;&amp; npm run db:seed</code>.
              </div>
            ) : history.length === 0 ? (
              <div className="empty">
                No checks yet. Press <strong>Run check now</strong> to fetch the live
                {jurisdiction === "Indonesia" ? "Indonesian" : "United States"} sources.
              </div>
            ) : (
              history.map((entry) => <RunCard key={entry.run.id} entry={entry} />)
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

/** Recorded as a failure, but never actually tried — see fetchAllSources. */
function isSkipped(errorMessage: string | null): boolean {
  return Boolean(errorMessage?.startsWith("Not attempted —"));
}

function RunCard({ entry }: { entry: RunHistoryEntry }) {
  const { run, sourceResults, findings, alert } = entry;
  const flagged = findings.filter((f) => f.relevance === "flagged");
  const noted = findings.filter((f) => f.relevance === "noted");
  const broken = sourceResults.filter((r) => !r.success || r.entriesParsed === 0);
  // A dead domain is one fact, not five. Views skipped because a sibling on the
  // same domain already failed are still shown as unchecked in the source list,
  // but the coverage gap says it once.
  const attempted = broken.filter((r) => !isSkipped(r.errorMessage));
  const skippedByDomain = new Map<string, typeof broken>();
  for (const r of broken) {
    if (!isSkipped(r.errorMessage)) continue;
    const key = r.domain ?? r.sourceId;
    skippedByDomain.set(key, [...(skippedByDomain.get(key) ?? []), r]);
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">{new Date(run.startedAt).toLocaleString()}</div>
          <div className="mono" style={{ color: "var(--text-faint)", marginTop: 2 }}>
            {run.id.slice(0, 8)} · {findings.length} judged
          </div>
        </div>
        <div className="row">
          <span
            className={`pill ${
              run.status === "complete"
                ? "pill-ok"
                : run.status === "failed"
                  ? "pill-bad"
                  : "pill-muted"
            }`}
          >
            {run.status}
          </span>
          {run.status === "complete" && (
            <span className={`pill ${flagged.length ? "pill-bad" : "pill-muted"}`}>
              {flagged.length ? `${flagged.length} flagged` : "nothing relevant"}
            </span>
          )}
        </div>
      </div>

      {run.errorMessage && <div className="callout callout-bad">{run.errorMessage}</div>}

      {/* Sources first, deliberately: you should see what was actually reachable
          before reading any conclusion drawn from it. */}
      <div className="side-label" style={{ padding: 0 }}>
        Sources
      </div>
      <div>
        {sourceResults.map((r) => {
          const state = !r.success
            ? isSkipped(r.errorMessage)
              ? "skipped"
              : "failed"
            : r.entriesParsed === 0
              ? "zero"
              : "ok";
          return (
            <div key={r.id} className="source-line">
              <span className="row" style={{ gap: 7 }}>
                {state === "ok" && <CheckCircle2 size={13} color="var(--ok)" />}
                {state === "zero" && <AlertTriangle size={13} color="var(--warn)" />}
                {(state === "failed" || state === "skipped") && (
                  <CircleSlash
                    size={13}
                    color={state === "failed" ? "var(--danger)" : "var(--text-faint)"}
                  />
                )}
                {r.sourceName ?? r.sourceId}
                {r.view && (
                  <span className="mono" style={{ color: "var(--text-faint)" }}>
                    {r.view}
                  </span>
                )}
              </span>
              <span
                className="mono"
                style={{
                  color:
                    state === "ok"
                      ? "var(--text-muted)"
                      : state === "zero"
                        ? "var(--warn)"
                        : state === "skipped"
                          ? "var(--text-faint)"
                          : "var(--danger)",
                }}
              >
                {state === "ok"
                  ? `${r.entriesParsed} entries`
                  : state === "zero"
                    ? "parsed 0 — unchecked"
                    : state === "skipped"
                      ? "not attempted — unchecked"
                      : "failed"}
              </span>
            </div>
          );
        })}
      </div>

      {broken.length > 0 && (
        <div className="callout callout-warn">
          <strong>Coverage gap</strong>
          <ul>
            {attempted.map((r) => (
              <li key={r.id}>
                {r.sourceName ?? r.sourceId} — {r.errorMessage ?? r.parseWarning}
              </li>
            ))}
            {[...skippedByDomain].map(([domain, rows]) => (
              <li key={domain}>
                {domain} — {rows.length} further view{rows.length > 1 ? "s" : ""} not attempted
                after the first failure, also unchecked
              </li>
            ))}
          </ul>
        </div>
      )}

      {(flagged.length > 0 || noted.length > 0) && (
        <>
          <div className="side-label" style={{ padding: 0, marginTop: 16 }}>
            Findings
          </div>
          {[...flagged, ...noted].map((f) => (
            <div key={f.id} className="finding" data-relevance={f.relevance}>
              <div className="row">
                <span className={`pill ${f.relevance === "flagged" ? "pill-bad" : "pill-warn"}`}>
                  {f.relevance}
                </span>
                <span className="mono" style={{ color: "var(--text-secondary)" }}>
                  {f.regulationRef}
                </span>
                {f.enactedOn && (
                  <span className="mono" style={{ color: "var(--text-faint)" }}>
                    enacted {f.enactedOn}
                  </span>
                )}
              </div>
              <h4>{f.title}</h4>
              {f.summaryId && <p>{f.summaryId}</p>}
              {f.summaryEn && <p style={{ fontStyle: "italic" }}>{f.summaryEn}</p>}
              {f.reasoning && (
                <p style={{ color: "var(--text-faint)", fontSize: "0.75rem" }}>{f.reasoning}</p>
              )}
              {f.url && (
                <p>
                  <a href={f.url} target="_blank" rel="noreferrer" className="mono">
                    Source <ExternalLink size={11} style={{ display: "inline", marginBottom: -1 }} />
                  </a>
                </p>
              )}
            </div>
          ))}
        </>
      )}

      {alert && (
        <>
          <div className="side-label" style={{ padding: 0, marginTop: 16 }}>
            Ready to send
          </div>
          <div className="deliverable">{alert.body}</div>
        </>
      )}
    </div>
  );
}
