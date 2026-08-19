"use client";

import { Check, Plus, Save, Trash2, Building2, ShieldCheck, Factory, FileCode } from "lucide-react";
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

  const isId = country === "Indonesia";

  return (
    <div className="main-scroll">
      <div className="profile-main">
        <div className="page-head">
          <div>
            <h1>{isId ? "Indonesia Company Profile" : "United States Company Profile"}</h1>
            <p className="page-sub">
              {isId
                ? "Your company identity, registered KBLI codes, factory locations, and raw materials used to evaluate Bea Cukai, INSW, and Ministry regulations."
                : "The evidence base used to screen Federal Register, CBP 19 CFR, EPA TSCA, and US trade remedy rules."}
            </p>
          </div>
          <div className="page-actions">
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : saved ? <><Check size={14} /> Saved</> : <><Save size={14} /> Save Profile</>}
            </button>
            <CountryTabs value={country} />
          </div>
        </div>

        {error && <div className="pill pill-bad" style={{ marginBottom: "1rem" }}>{error}</div>}

        {loading ? (
          <div className="empty">Loading profile...</div>
        ) : (
          <div className="profile-form">
            {/* Identity Section */}
            <ProfileSection
              title="Company Identity & Facilities"
              eyebrow="Corporate Entity"
              description={isId ? "Legal name, NIB, and manufacturing plant locations in Indonesia." : "Legal corporate entity name and U.S. facility locations."}
            >
              <TextField
                label="Legal Entity Name"
                value={draft.legalName}
                placeholder={isId ? "PT MA Makmur Surabaya" : "MA Plastics USA LLC"}
                onChange={(legalName) => setDraft((current) => ({ ...current, legalName }))}
              />
              <ListField
                label={isId ? "Factory & Warehouse Locations (Kabupaten/Kota)" : "Facilities and Warehouses"}
                values={draft.facilityAddresses}
                placeholder={isId ? "Jl. Rungkut Industri No. 88, Kota Surabaya, Jawa Timur" : "1200 Industrial Blvd, Houston, TX 77001"}
                onChange={(facilityAddresses) => setDraft((current) => ({ ...current, facilityAddresses }))}
              />
            </ProfileSection>

            {/* Industry Classifications */}
            <ProfileSection
              title={isId ? "Business Licenses & KBLI Codes" : "Industry Classifications (NAICS)"}
              eyebrow="Licensing"
              description={isId ? "5-digit KBLI codes registered on OSS RBA (e.g. 22210 Barang Plastik Lembaran, 13992 Kain Rajutan)." : "6-digit North American Industry Classification System codes."}
            >
              <CodeField
                label={isId ? "KBLI Codes" : "NAICS Codes"}
                values={draft.naicsCodes}
                codePlaceholder={isId ? "e.g. 22210" : "e.g. 326113"}
                onChange={(naicsCodes) => setDraft((current) => ({ ...current, naicsCodes }))}
              />
            </ProfileSection>

            {/* Products & Raw Materials */}
            <ProfileSection
              title="Products & Raw Materials"
              eyebrow="Operations"
              description="Manufactured finished products and input materials monitored for tariffs, LARTAS quotas, and substance restrictions."
            >
              <ListField
                label="Manufactured Products"
                values={draft.products}
                placeholder={isId ? "PVC Tarpaulin Sheeting, Vinyl Coated Fabrics" : "PVC Liners, Industrial Tarps"}
                onChange={(products) => setDraft((current) => ({ ...current, products }))}
              />
              <ListField
                label="Raw Materials & Chemical Additives"
                values={draft.materialsChemicals}
                placeholder={isId ? "PVC Resin (K-67), DOP Plasticizer (CAS 117-81-7), Calcium Zinc Stabilizers" : "PVC Resin, DINP Plasticizer, DecaBDE"}
                onChange={(materialsChemicals) => setDraft((current) => ({ ...current, materialsChemicals }))}
              />
              <ListField
                label="Manufacturing Processes"
                values={draft.manufacturingProcesses}
                placeholder="Calendering, Extrusion Coating, High-Frequency Welding"
                onChange={(manufacturingProcesses) => setDraft((current) => ({ ...current, manufacturingProcesses }))}
              />
              <ListField
                label="Waste Streams (B3 / EPA)"
                values={draft.wasteStreams}
                placeholder={isId ? "Sludge IPAL, Oli Bekas B3, Scrap Plastik PVC" : "Wastewater sludge, Spent solvents"}
                onChange={(wasteStreams) => setDraft((current) => ({ ...current, wasteStreams }))}
              />
            </ProfileSection>

            {/* Tariff & Trade Classifications */}
            <ProfileSection
              title={isId ? "HS Codes & Trade Lanes" : "Harmonized Tariff (HTSUS) & Export Controls"}
              eyebrow="Customs & Tariffs"
              description="Tariff lines used to calculate exact import taxes (Bea Masuk, PPN, PPh 22), US Section 301 tariffs, and export controls."
            >
              <CodeField
                label={isId ? "Raw Material HS Codes (BTKI)" : "HTSUS / Schedule B Codes"}
                values={draft.htsScheduleBCodes}
                codePlaceholder="e.g. 3904.10.00"
                onChange={(htsScheduleBCodes) => setDraft((current) => ({ ...current, htsScheduleBCodes }))}
              />
              <ListField
                label="Import / Sourcing Origin Countries"
                values={draft.exportCountries}
                placeholder="South Korea (KR), China (CN), Taiwan (TW), United States (US)"
                onChange={(exportCountries) => setDraft((current) => ({ ...current, exportCountries }))}
              />
              <ListField
                label="Regulatory Certifications & Standards"
                values={draft.regulatedProductFlags}
                placeholder={isId ? "SNI Wajib, TKDN Kemenperin, Halal, KLHK Non-B3" : "EPA TSCA Section 8, CA Prop 65, OSHA SDS"}
                onChange={(regulatedProductFlags) => setDraft((current) => ({ ...current, regulatedProductFlags }))}
              />
            </ProfileSection>
          </div>
        )}
      </div>
    </div>
  );
}

function ProfileSection({
  title,
  eyebrow,
  description,
  children,
}: {
  title: string;
  eyebrow: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <span className="side-label" style={{ padding: 0 }}>{eyebrow}</span>
          <h2 style={{ margin: "2px 0 0" }}>{title}</h2>
          {description && <p className="page-sub" style={{ margin: "4px 0 0" }}>{description}</p>}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "1rem" }}>
        {children}
      </div>
    </section>
  );
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
  return (
    <div>
      <label className="side-label" style={{ padding: 0, marginBottom: 4, display: "block" }}>{label}</label>
      <input
        className="input"
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function ListField({
  label,
  values,
  placeholder,
  onChange,
}: {
  label: string;
  values: string[];
  placeholder: string;
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function append() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onChange([...values, trimmed]);
    setDraft("");
  }

  return (
    <div>
      <label className="side-label" style={{ padding: 0, marginBottom: 4, display: "block" }}>{label}</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: values.length ? "0.5rem" : 0 }}>
        {values.map((item, index) => (
          <span key={index} className="pill pill-muted" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {item}
            <button
              type="button"
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--danger)" }}
              onClick={() => onChange(values.filter((_, i) => i !== index))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <input
          className="input"
          type="text"
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              append();
            }
          }}
        />
        <button type="button" className="btn btn-small" onClick={append}>
          <Plus size={14} /> Add
        </button>
      </div>
    </div>
  );
}

function CodeField({
  label,
  values,
  codePlaceholder,
  onChange,
}: {
  label: string;
  values: CodeRow[];
  codePlaceholder: string;
  onChange: (values: CodeRow[]) => void;
}) {
  const [code, setCode] = useState("");
  const [basis, setBasis] = useState("");

  function append() {
    const trimmedCode = code.trim();
    if (!trimmedCode) return;
    onChange([...values, { code: trimmedCode, basis: basis.trim() || "User stated in profile", confirmed: true }]);
    setCode("");
    setBasis("");
  }

  return (
    <div>
      <label className="side-label" style={{ padding: 0, marginBottom: 4, display: "block" }}>{label}</label>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: values.length ? "0.5rem" : 0 }}>
        {values.map((item, index) => (
          <div key={index} className="meta-row" style={{ justifyContent: "space-between", background: "var(--card-bg)", padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border)" }}>
            <span className="mono strong" style={{ fontSize: "0.85rem" }}>{item.code}</span>
            <span className="muted" style={{ fontSize: "0.8rem" }}>{item.basis}</span>
            <button
              type="button"
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--danger)" }}
              onClick={() => onChange(values.filter((_, i) => i !== index))}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "140px 1fr auto", gap: "0.5rem" }}>
        <input
          className="input mono"
          type="text"
          value={code}
          placeholder={codePlaceholder}
          onChange={(e) => setCode(e.target.value)}
        />
        <input
          className="input"
          type="text"
          value={basis}
          placeholder="Description or classification basis"
          onChange={(e) => setBasis(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              append();
            }
          }}
        />
        <button type="button" className="btn btn-small" onClick={append}>
          <Plus size={14} /> Add
        </button>
      </div>
    </div>
  );
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
