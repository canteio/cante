"use client";

import { Check, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { JurisdictionName } from "@/lib/countries";
import { CountryTabs } from "@/components/dashboard/country-tabs";

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
    fetch(`/api/profiles?country=${encodeURIComponent(country)}`)
      .then((response) => response.json())
      .then((data) => setDraft(normalizeProfile(data.profile)))
      .catch((cause) => setError(String(cause)))
      .finally(() => setLoading(false));
  }, [country]);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    const response = await fetch("/api/profiles", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country, profile: cleanDraft(draft) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setError(typeof data.error === "string" ? data.error : "Profile could not be saved.");
    else {
      setDraft(normalizeProfile(data.profile));
      setSaved(true);
      window.dispatchEvent(new Event("cante:checklist-updated"));
    }
    setSaving(false);
  }

  if (country === "Indonesia") {
    return (
      <div className="main-scroll">
        <div className="profile-main">
          <div className="page-head">
            <div>
              <h1>Company profile</h1>
              <p>Structured facts used to determine which rules actually apply.</p>
            </div>
            <CountryTabs value={country} />
          </div>
          <div className="empty">
            Indonesia currently uses the seeded exporter profile plus confirmed Memory facts for
            HS, KBLI, products, markets, and location.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="main-scroll">
      <div className="profile-main">
        <div className="page-head">
          <div>
            <h1>United States profile</h1>
            <p>The evidence base for domestic, distribution, and export compliance.</p>
          </div>
          <CountryTabs value={country} />
        </div>

        {loading ? (
          <div className="empty">Loading profile...</div>
        ) : (
          <div className="profile-form">
            <ProfileSection title="Company and facilities" eyebrow="Identity">
              <TextField
                label="Legal name"
                value={draft.legalName}
                placeholder="Legal entity name"
                onChange={(legalName) => setDraft((current) => ({ ...current, legalName }))}
              />
              <ListField
                label="Facilities and warehouses"
                values={draft.facilityAddresses}
                placeholder="Street, city, state, ZIP - activity at site"
                onChange={(facilityAddresses) => setDraft((current) => ({ ...current, facilityAddresses }))}
              />
              <CodeField
                label="NAICS codes"
                values={draft.naicsCodes}
                codePlaceholder="NAICS"
                onChange={(naicsCodes) => setDraft((current) => ({ ...current, naicsCodes }))}
              />
            </ProfileSection>

            <ProfileSection title="Products and operations" eyebrow="Domestic manufacturing">
              <ListField label="Products" values={draft.products} placeholder="Product or product family" onChange={(products) => setDraft((current) => ({ ...current, products }))} />
              <ListField label="SKUs" values={draft.skus} placeholder="SKU or model" onChange={(skus) => setDraft((current) => ({ ...current, skus }))} />
              <ListField label="Materials and chemicals" values={draft.materialsChemicals} placeholder="Material, chemical, or mixture" onChange={(materialsChemicals) => setDraft((current) => ({ ...current, materialsChemicals }))} />
              <ListField label="Manufacturing processes" values={draft.manufacturingProcesses} placeholder="Process, equipment, or operation" onChange={(manufacturingProcesses) => setDraft((current) => ({ ...current, manufacturingProcesses }))} />
              <ListField label="Waste streams" values={draft.wasteStreams} placeholder="Waste stream and known classification" onChange={(wasteStreams) => setDraft((current) => ({ ...current, wasteStreams }))} />
              <ListField label="Regulated product flags" values={draft.regulatedProductFlags} placeholder="Consumer product, chemical, electronics, defense..." onChange={(regulatedProductFlags) => setDraft((current) => ({ ...current, regulatedProductFlags }))} />
            </ProfileSection>

            <ProfileSection title="Distribution" eyebrow="Where products go">
              <ListField label="Distribution states" values={draft.distributionStates} placeholder="State" onChange={(distributionStates) => setDraft((current) => ({ ...current, distributionStates }))} />
              <ListField label="Labels and marketing claims" values={draft.labelsClaims} placeholder="Made in USA, recyclable, performance, safety..." onChange={(labelsClaims) => setDraft((current) => ({ ...current, labelsClaims }))} />
            </ProfileSection>

            <ProfileSection title="Exports" eyebrow="Trade controls">
              <CodeField label="HTS and Schedule B" values={draft.htsScheduleBCodes} codePlaceholder="HTS / Schedule B" onChange={(htsScheduleBCodes) => setDraft((current) => ({ ...current, htsScheduleBCodes }))} />
              <CodeField label="ECCN or EAR99" values={draft.exportClassifications} codePlaceholder="ECCN / EAR99" onChange={(exportClassifications) => setDraft((current) => ({ ...current, exportClassifications }))} />
              <ListField label="Export countries" values={draft.exportCountries} placeholder="Destination country" onChange={(exportCountries) => setDraft((current) => ({ ...current, exportCountries }))} />
            </ProfileSection>

            <div className="profile-savebar">
              <div>{error ? <span className="form-error">{error}</span> : saved ? <span className="form-saved"><Check size={13} /> Saved and checklist refreshed</span> : null}</div>
              <button className="btn" onClick={save} disabled={saving}>
                <Save size={14} />
                {saving ? "Saving..." : "Save profile"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProfileSection({ title, eyebrow, children }: { title: string; eyebrow: string; children: React.ReactNode }) {
  return <section className="profile-section"><div className="profile-section-head"><span>{eyebrow}</span><h2>{title}</h2></div><div className="profile-fields">{children}</div></section>;
}

function TextField({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return <label className="profile-field"><span>{label}</span><input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

function ListField({ label, values, placeholder, onChange }: { label: string; values: string[]; placeholder: string; onChange: (values: string[]) => void }) {
  function update(index: number, value: string) { onChange(values.map((entry, entryIndex) => entryIndex === index ? value : entry)); }
  return <div className="profile-field"><span>{label}</span><div className="profile-list">{values.map((value, index) => <div className="profile-list-row" key={`${label}-${index}`}><input value={value} placeholder={placeholder} onChange={(event) => update(index, event.target.value)} /><button type="button" className="icon-btn subtle" aria-label={`Remove ${label} row`} onClick={() => onChange(values.filter((_, entryIndex) => entryIndex !== index))}><Trash2 size={13} /></button></div>)}<button type="button" className="add-row" onClick={() => onChange([...values, ""])}><Plus size={13} /> Add</button></div></div>;
}

function CodeField({ label, values, codePlaceholder, onChange }: { label: string; values: CodeRow[]; codePlaceholder: string; onChange: (values: CodeRow[]) => void }) {
  function update(index: number, patch: Partial<CodeRow>) { onChange(values.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...patch } : entry)); }
  return <div className="profile-field"><span>{label}</span><div className="profile-list">{values.map((value, index) => <div className="profile-code-row" key={`${label}-${index}`}><input value={value.code} placeholder={codePlaceholder} onChange={(event) => update(index, { code: event.target.value })} /><input value={value.basis} placeholder="Evidence or classification basis" onChange={(event) => update(index, { basis: event.target.value })} /><label className="confirm-code"><input type="checkbox" checked={value.confirmed} onChange={(event) => update(index, { confirmed: event.target.checked })} /> Confirmed</label><button type="button" className="icon-btn subtle" aria-label={`Remove ${label} row`} onClick={() => onChange(values.filter((_, entryIndex) => entryIndex !== index))}><Trash2 size={13} /></button></div>)}<button type="button" className="add-row" onClick={() => onChange([...values, { code: "", basis: "", confirmed: false }])}><Plus size={13} /> Add</button></div></div>;
}

function cleanDraft(draft: ProfileDraft): ProfileDraft {
  const strings = (values: string[]) => values.map((value) => value.trim()).filter(Boolean);
  const codes = (values: CodeRow[]) => values.map((value) => ({ ...value, code: value.code.trim(), basis: value.basis.trim() || "entered in profile" })).filter((value) => value.code);
  return { ...draft, legalName: draft.legalName.trim(), facilityAddresses: strings(draft.facilityAddresses), naicsCodes: codes(draft.naicsCodes), products: strings(draft.products), skus: strings(draft.skus), materialsChemicals: strings(draft.materialsChemicals), manufacturingProcesses: strings(draft.manufacturingProcesses), wasteStreams: strings(draft.wasteStreams), distributionStates: strings(draft.distributionStates), labelsClaims: strings(draft.labelsClaims), htsScheduleBCodes: codes(draft.htsScheduleBCodes), exportClassifications: codes(draft.exportClassifications), exportCountries: strings(draft.exportCountries), regulatedProductFlags: strings(draft.regulatedProductFlags) };
}

function normalizeProfile(profile: Partial<ProfileDraft> | null | undefined): ProfileDraft {
  return { ...EMPTY, ...(profile ?? {}), legalName: profile?.legalName ?? "" };
}
