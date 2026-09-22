import assert from "node:assert/strict";
import test from "node:test";
import { generateActionDrafts } from "./draft";

test("generateActionDrafts creates tailored Indonesian drafts for PPJK, internal ops, and suppliers", () => {
  const drafts = generateActionDrafts(
    {
      customerName: "Example Company",
      productDescription: "PVC Resin & Plasticizers",
      regulationRef: "Permendag 12/2026",
      title: "Kebijakan Impor Barang Industri",
      hsCode: "3904.10",
      sideOfTrade: "import",
    },
    "Indonesia",
  );

  // PPJK Draft
  assert.equal(drafts.brokerDraft.channel, "whatsapp");
  assert.match(drafts.brokerDraft.body, /Permendag 12/);
  assert.match(drafts.brokerDraft.body, /3904/);
  assert.match(drafts.brokerDraft.body, /Persetujuan Impor/);

  // Internal Ops Checklist (No PPJK)
  assert.ok(drafts.internalOpsDraft.checklist.length >= 3);
  assert.match(drafts.internalOpsDraft.body, /Checklist Operasional/);
  assert.match(drafts.internalOpsDraft.body, /INSW/);

  // Supplier Draft
  assert.match(drafts.supplierDraft.subject, /Technical Documentation Required/);
  assert.match(drafts.supplierDraft.body, /Certificate of Analysis/);
  assert.match(drafts.supplierDraft.body, /Certificate of Origin/);
  assert.match(drafts.supplierDraft.body, /MSDS/);
});

test("generateActionDrafts creates US compliance drafts for CHB broker, internal operations, and suppliers", () => {
  const drafts = generateActionDrafts(
    {
      customerName: "Acme Vinyl",
      productDescription: "PVC Coated Fabric",
      regulationRef: "19 CFR Part 133",
      title: "Enforcement of Trade Remedies and Section 301",
      hsCode: "5903.10",
      sideOfTrade: "import",
    },
    "United States",
  );

  assert.equal(drafts.brokerDraft.channel, "email");
  assert.match(drafts.brokerDraft.body, /Section 301/);
  assert.match(drafts.brokerDraft.body, /19 CFR Part 133/);

  assert.match(drafts.internalOpsDraft.body, /purchase orders/);
  assert.match(drafts.supplierDraft.body, /UFLPA compliance/);
  assert.match(drafts.supplierDraft.body, /TSCA/);
});
