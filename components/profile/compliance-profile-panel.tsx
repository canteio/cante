"use client";

import { Check, Save } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { JurisdictionName } from "@/lib/countries";
import { CountryTabs } from "@/components/dashboard/country-tabs";
import { ChipInput } from "@/components/chip-input";

type CodeRow = { code: string; basis: string; confirmed: boolean };
type ProfileDraft = {
  legalName: string;
  facilityAddresses: string[];
  naicsCodes: CodeRow[];
  products: string[];
  skus: string[];
  materialsChemicals: string[];
  manufacturingProcesses: string[];
  wasteStreams: string[];
  distributionStates: string[];
  labelsClaims: string[];
  htsScheduleBCodes: CodeRow[];
  exportClassifications: CodeRow[];
  exportCountries: string[];
  regulatedProductFlags: string[];
};

const EMPTY: ProfileDraft = {
  legalName: "",
  facilityAddresses: [],
  naicsCodes: [],
  products: [],
  skus: [],
  materialsChemicals: [],
  manufacturingProcesses: [],
  wasteStreams: [],
  distributionStates: [],
  labelsClaims: [],
  htsScheduleBCodes: [],
  exportClassifications: [],
  exportCountries: [],
  regulatedProductFlags: [],
};

export function ComplianceProfilePanel({ country }: { country: JurisdictionName }) {
  const [draft, setDraft] = useState<ProfileDraft>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/profiles?country=${encodeURIComponent(country)}`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        // Same silent-failure class already fixed in catalogue/workqueue/checklist/suppliers:
        // a non-2xx response (e.g. 500) that still returns valid JSON previously slipped past
        // this .then chain, silently rendering an EMPTY profile with no indication anything
        // went wrong — indistinguishable from a genuinely blank profile. Now we check response.ok
        // first and surface the real error instead of quietly wiping the visible form state.
        if (!response.ok) {
          throw new Error(typeof data.error === "string" ? data.error : "Failed to load profile.");
        }
        setDraft(normalizeProfile(data.profile));
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setLoading(false));
  }, [country]);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const response = await fetch("/api/profiles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ country, profile: cleanDraft(draft) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "Profile could not be saved.");
      } else {
        setDraft(normalizeProfile(data.profile));
        setSaved(true);
        window.dispatchEvent(new Event("cante:checklist-updated"));
      }
    } catch (e: any) {
      setError(e.message || "Failed to save profile.");
    } finally {
      setSaving(false);
    }
  }

  // Count only visible fields and actual values, never example text or hidden schema fields.
  const complete = [draft.legalName.trim(), draft.facilityAddresses.length, draft.products.length,
    draft.naicsCodes.length, draft.materialsChemicals.length, draft.manufacturingProcesses.length,
    draft.wasteStreams.length, draft.htsScheduleBCodes.length, draft.exportCountries.length,
    draft.regulatedProductFlags.length].filter(Boolean).length;
  const isId = country === "Indonesia";

  return (
    <div className="main-scroll">
      <div className="profile-main">
        <div className="page-head">
          <div>
            <h1>{isId ? "Indonesia Company Profile" : "United States Company Profile"}</h1>
            <p className="page-sub">
              Start with your company, location, and products. Add details to make alerts more relevant.
            </p>
          </div>
          <div className="page-actions">
            <button className="btn btn-primary" onClick={save} disabled={saving || loading}>
              {saving ? "Saving…" : saved ? <><Check size={14} /> Saved</> : <><Save size={14} /> Save Profile</>}
            </button>
            <CountryTabs value={country} />
          </div>
        </div>

        {/* UI/UX friction sweep (a11y) continued: this is the compliance-profile
            ("screening") page — it screens Federal Register/CBP/EPA rules per
            the page-sub copy above, and was the last unaudited panel along with
            memory-panel.tsx. Same role="alert"/role="status" pattern already
            established in import-monitor, suppliers, workqueue, catalogue,
            and checklist panels. */}
        {error && <div className="pill pill-bad" role="alert" style={{ marginBottom: "1rem" }}>{error}</div>}

        {loading ? (
          <div className="empty" role="status">Loading profile...</div>
        ) : (
          <div className="profile-form" key={country} onChange={() => setSaved(false)}>
            <p className="profile-completion" role="status">{complete} of 10 fields complete · Examples are not saved data. Changes need Save Profile.</p>
            {/* Identity Section */}
            <ProfileSection
              title="Company essentials"
              eyebrow="Start here"
              description="Your legal name, primary location, and main product category."
            >
              <TextField
                label="Legal Entity Name"
                value={draft.legalName}
                placeholder={isId ? "PT MA Makmur Surabaya" : "MA Plastics USA LLC"}
                onChange={(legalName) => { setSaved(false); setDraft((current) => ({ ...current, legalName })); }}
              />
              <ListField
                label="Primary address, then other facilities"
                values={draft.facilityAddresses}
                placeholder={isId ? "Jl. Rungkut Industri No. 88, Kota Surabaya, Jawa Timur" : "1200 Industrial Blvd, Houston, TX 77001"}
                onChange={(facilityAddresses) => { setSaved(false); setDraft((current) => ({ ...current, facilityAddresses })); }}
              />
              <ListField
                label="Primary product category, then other products"
                values={draft.products}
                placeholder={isId ? "PVC tarpaulin" : "Industrial tarps"}
                onChange={(products) => { setSaved(false); setDraft((current) => ({ ...current, products })); }}
              />
            </ProfileSection>

            {/* Industry Classifications */}
            <ProfileSection
              optional hasData={draft.naicsCodes.length > 0}
              title={isId ? "Licensing details · KBLI" : "Industry details · NAICS"}
              eyebrow="Licensing"
              description={isId ? "5-digit KBLI codes registered on OSS RBA (e.g. 22210 Barang Plastik Lembaran, 13992 Kain Rajutan)." : "6-digit North American Industry Classification System codes."}
            >
              <CodeField
                label={isId ? "KBLI Codes" : "NAICS Codes"}
                values={draft.naicsCodes}
                codePlaceholder={isId ? "e.g. 22210" : "e.g. 326113"}
                onChange={(naicsCodes) => { setSaved(false); setDraft((current) => ({ ...current, naicsCodes })); }}
              />
            </ProfileSection>

            {/* Products & Raw Materials */}
            <ProfileSection
              optional hasData={!!(draft.materialsChemicals.length || draft.manufacturingProcesses.length || draft.wasteStreams.length)}
              title="Materials, processes & waste"
              eyebrow="Operations"
              description="Manufactured finished products and input materials monitored for tariffs, LARTAS quotas, and substance restrictions."
            >
              <ListField
                label="Raw Materials & Chemical Additives"
                values={draft.materialsChemicals}
                placeholder={isId ? "PVC resin" : "PVC resin"}
                onChange={(materialsChemicals) => { setSaved(false); setDraft((current) => ({ ...current, materialsChemicals })); }}
              />
              <ListField
                label="Manufacturing Processes"
                values={draft.manufacturingProcesses}
                placeholder="Extrusion coating"
                onChange={(manufacturingProcesses) => { setSaved(false); setDraft((current) => ({ ...current, manufacturingProcesses })); }}
              />
              <ListField
                label="Waste Streams (B3 / EPA)"
                values={draft.wasteStreams}
                placeholder={isId ? "Sludge IPAL" : "Wastewater sludge"}
                onChange={(wasteStreams) => { setSaved(false); setDraft((current) => ({ ...current, wasteStreams })); }}
              />
            </ProfileSection>

            {/* Tariff & Trade Classifications */}
            <ProfileSection
              optional hasData={!!(draft.htsScheduleBCodes.length || draft.exportCountries.length || draft.regulatedProductFlags.length)}
              title="Trade codes & certifications"
              eyebrow="Customs & Tariffs"
              description="Tariff lines used to calculate exact import taxes (Bea Masuk, PPN, PPh 22), US Section 301 tariffs, and export controls."
            >
              <CodeField
                label={isId ? "Raw Material HS Codes (BTKI)" : "HTSUS / Schedule B Codes"}
                values={draft.htsScheduleBCodes}
                codePlaceholder="e.g. 3904.10.00"
                onChange={(htsScheduleBCodes) => { setSaved(false); setDraft((current) => ({ ...current, htsScheduleBCodes })); }}
              />
              <ListField
                label="Import / Sourcing Origin Countries"
                values={draft.exportCountries}
                placeholder="South Korea"
                onChange={(exportCountries) => { setSaved(false); setDraft((current) => ({ ...current, exportCountries })); }}
              />
              <ListField
                label="Regulatory Certifications & Standards"
                values={draft.regulatedProductFlags}
                placeholder={isId ? "SNI" : "OSHA SDS"}
                onChange={(regulatedProductFlags) => { setSaved(false); setDraft((current) => ({ ...current, regulatedProductFlags })); }}
              />
            </ProfileSection>
          </div>
        )}
      </div>
    </div>
  );
}

// Optional sections start closed only when empty; saved evidence stays visible.
function ProfileSection({ title, description, children, optional = false, hasData = false }: {
  title: string; eyebrow: string; description?: string; children: React.ReactNode;
  optional?: boolean; hasData?: boolean;
}) {
  const [open, setOpen] = useState(hasData);
  const content = <><p className="page-sub">{description}</p><div className="profile-section-fields">{children}</div></>;
  return optional ? (
    <details className="card profile-disclosure" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{title}<span className="muted">Optional</span></summary>
      {content}
    </details>
  ) : <section className="card"><h2>{title}</h2>{content}</section>;
}

function TextField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="side-label" style={{ padding: 0, marginBottom: 4, display: "block" }}>{label}</label>
      <input
        id={id}
        className="input"
        type="text"
        value={value}
        placeholder={`e.g. ${placeholder}`}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

const ListField = ChipInput;

function CodeField({ label, values, codePlaceholder, onChange }: {
  label: string; values: CodeRow[]; codePlaceholder: string;
  onChange: (values: CodeRow[]) => void;
}) {
  return <div>
    <ChipInput label={label} values={values.map((row) => row.code)} placeholder={codePlaceholder}
      onChange={(codes) => onChange(codes.map((code) =>
        // Preserve evidence and confirmation when adding/removing neighbouring chips.
        values.find((row) => row.code === code) ?? { code, basis: "User stated in profile", confirmed: true }
      ))} />
    {values.map((row, index) => <label className="profile-code-basis" key={`${index}-${row.code}`}>
      <span>{row.code} · Evidence / description {row.confirmed ? "(confirmed)" : "(unconfirmed)"}</span>
      <input className="input" value={row.basis} placeholder="e.g. Company registration document"
        onChange={(event) => onChange(values.map((item, i) => i === index ? { ...item, basis: event.target.value } : item))} />
    </label>)}
  </div>;
}

function normalizeProfile(profile: any): ProfileDraft {
  if (!profile || typeof profile !== "object") return EMPTY;
  return {
    legalName: profile.legalName ?? "",
    facilityAddresses: Array.isArray(profile.facilityAddresses) ? profile.facilityAddresses : [],
    naicsCodes: Array.isArray(profile.naicsCodes) ? profile.naicsCodes : [],
    products: Array.isArray(profile.products) ? profile.products : [],
    skus: Array.isArray(profile.skus) ? profile.skus : [],
    materialsChemicals: Array.isArray(profile.materialsChemicals) ? profile.materialsChemicals : [],
    manufacturingProcesses: Array.isArray(profile.manufacturingProcesses) ? profile.manufacturingProcesses : [],
    wasteStreams: Array.isArray(profile.wasteStreams) ? profile.wasteStreams : [],
    distributionStates: Array.isArray(profile.distributionStates) ? profile.distributionStates : [],
    labelsClaims: Array.isArray(profile.labelsClaims) ? profile.labelsClaims : [],
    htsScheduleBCodes: Array.isArray(profile.htsScheduleBCodes) ? profile.htsScheduleBCodes : [],
    exportClassifications: Array.isArray(profile.exportClassifications) ? profile.exportClassifications : [],
    exportCountries: Array.isArray(profile.exportCountries) ? profile.exportCountries : [],
    regulatedProductFlags: Array.isArray(profile.regulatedProductFlags) ? profile.regulatedProductFlags : [],
  };
}

function cleanDraft(draft: ProfileDraft): Record<string, unknown> {
  return {
    legalName: draft.legalName || null,
    facilityAddresses: draft.facilityAddresses,
    naicsCodes: draft.naicsCodes,
    products: draft.products,
    skus: draft.skus,
    materialsChemicals: draft.materialsChemicals,
    manufacturingProcesses: draft.manufacturingProcesses,
    wasteStreams: draft.wasteStreams,
    distributionStates: draft.distributionStates,
    labelsClaims: draft.labelsClaims,
    htsScheduleBCodes: draft.htsScheduleBCodes,
    exportClassifications: draft.exportClassifications,
    exportCountries: draft.exportCountries,
    regulatedProductFlags: draft.regulatedProductFlags,
  };
}
