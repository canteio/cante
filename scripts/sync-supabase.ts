import "./load-env";
import Database from "better-sqlite3";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import path from "node:path";

type SqliteRow = Record<string, unknown>;

type TableSpec = {
  name: string;
  json?: string[];
  booleans?: string[];
};

const TABLES: TableSpec[] = [
  { name: "sources" },
  { name: "source_packs" },
  {
    name: "customer_profiles",
    json: ["hs_codes", "kbli_codes", "destination_markets", "relevance_guidance"],
    booleans: ["hs_codes_confirmed", "destinations_confirmed"],
  },
  {
    name: "jurisdiction_profiles",
    json: [
      "facility_addresses",
      "naics_codes",
      "products",
      "skus",
      "materials_chemicals",
      "manufacturing_processes",
      "waste_streams",
      "distribution_states",
      "labels_claims",
      "hts_schedule_b_codes",
      "export_classifications",
      "export_countries",
      "regulated_product_flags",
    ],
  },
  { name: "kbli_records", json: ["required_certificates"], booleans: ["confirmed"] },
  { name: "check_runs" },
  { name: "source_results", booleans: ["success"] },
  { name: "source_documents" },
  { name: "findings" },
  { name: "alerts" },
  { name: "conversations" },
  { name: "chat_messages", json: ["activity"] },
  { name: "memories", booleans: ["confirmed"] },
  {
    name: "checklist_items",
    json: ["linked_facts", "linked_rules", "open_questions"],
  },
  { name: "products", json: ["materials"], booleans: ["active"] },
  { name: "product_classifications", json: ["supporting_refs"] },
  { name: "suppliers", booleans: ["active"] },
  { name: "trade_lanes", json: ["transit_countries"], booleans: ["active"] },
  { name: "supplier_documents" },
  { name: "trade_documents", json: ["extracted"] },
  { name: "document_findings", json: ["duty_basis"] },
  { name: "regulation_links" },
  { name: "product_components" },
  { name: "substances", json: ["synonyms"] },
  { name: "component_substances" },
  { name: "restricted_substance_lists" },
  { name: "restricted_substance_entries" },
  { name: "finding_actions" },
  { name: "impact_assessments", json: ["basis"] },
  { name: "screening_results", json: ["matches"] },
];

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const verifyOnly = args.has("--verify");
const pullInputs = args.has("--pull-inputs");
const batchSize = 200;

const CLOUD_INPUT_TABLES = new Set([
  "customer_profiles",
  "jurisdiction_profiles",
  "kbli_records",
  "memories",
  "checklist_items",
  "products",
  "suppliers",
  "trade_lanes",
  "trade_documents",
]);

function parseJson(value: unknown, table: string, column: string) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${table}.${column} contains invalid JSON and was not migrated.`);
  }
}

function transformRow(
  row: SqliteRow,
  spec: TableSpec,
  customerIds: Map<string, string>,
): SqliteRow {
  const transformed = { ...row };
  if (typeof transformed.customer_id === "string") {
    const mapped = customerIds.get(transformed.customer_id);
    if (!mapped) throw new Error(`${spec.name} references an unmapped customer.`);
    transformed.customer_id = mapped;
  }
  for (const column of spec.json ?? []) {
    transformed[column] = parseJson(transformed[column], spec.name, column);
  }
  for (const column of spec.booleans ?? []) {
    const value = transformed[column];
    if (value !== null && value !== undefined) transformed[column] = Boolean(value);
  }
  return transformed;
}

async function requireCloudClient(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) {
    throw new Error(
      "Cloud sync requires NEXT_PUBLIC_SUPABASE_URL and a local-only " +
        "SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY).",
    );
  }
  return createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function mapCustomers(db: Database.Database, cloud: SupabaseClient | null) {
  const localCustomers = db.prepare("select * from customers order by created_at").all() as SqliteRow[];
  if (localCustomers.length === 0) throw new Error("The local database has no customers.");

  const mapping = new Map<string, string>();
  const preferredSlug = process.env.CANTE_SUPABASE_CUSTOMER_SLUG ?? "pt-ma";

  for (const [index, customer] of localCustomers.entries()) {
    const localId = String(customer.id);
    const slug = index === 0 ? preferredSlug : String(customer.name).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    if (!cloud) {
      mapping.set(localId, `[Supabase customer:${slug}]`);
      continue;
    }

    const { data: bySlug, error: findError } = await cloud
      .from("customers")
      .select("id, slug")
      .eq("slug", slug)
      .maybeSingle();
    if (findError) throw new Error(`Could not resolve customer ${slug}: ${findError.message}`);

    let existing = bySlug;
    if (!existing) {
      const { data: byName, error: nameError } = await cloud
        .from("customers")
        .select("id, slug")
        .eq("name", customer.name)
        .limit(2);
      if (nameError) throw new Error(`Could not resolve customer ${customer.name}: ${nameError.message}`);
      if ((byName ?? []).length > 1) {
        throw new Error(
          `More than one Supabase customer is named ${customer.name}; set a unique ` +
            "CANTE_SUPABASE_CUSTOMER_SLUG before syncing.",
        );
      }
      existing = byName?.[0] ?? null;
    }

    let cloudId = existing?.id as string | undefined;
    if (!cloudId) {
      const { data: inserted, error: insertError } = await cloud
        .from("customers")
        .insert({
          slug,
          name: customer.name,
          country: customer.country,
          city: customer.city,
        })
        .select("id")
        .single();
      if (insertError) throw new Error(`Could not create customer ${slug}: ${insertError.message}`);
      cloudId = inserted.id as string;
    } else {
      const { error: updateError } = await cloud
        .from("customers")
        .update({ name: customer.name, country: customer.country, city: customer.city })
        .eq("id", cloudId);
      if (updateError) throw new Error(`Could not update customer ${slug}: ${updateError.message}`);
    }
    mapping.set(localId, cloudId);
  }
  return mapping;
}

function localRows(db: Database.Database, table: string): SqliteRow[] {
  return db.prepare(`select * from "${table}"`).all() as SqliteRow[];
}

async function upsertTable(
  cloud: SupabaseClient,
  table: string,
  rows: SqliteRow[],
) {
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const { error } = await cloud.from(table).upsert(batch, { onConflict: "id" });
    if (error) throw new Error(`${table} failed at row ${start + 1}: ${error.message}`);
  }
}

function sqliteColumns(db: Database.Database, table: string): string[] {
  return (db.prepare(`pragma table_info("${table}")`).all() as Array<{ name: string }>).map(
    (column) => column.name,
  );
}

function sqliteValue(value: unknown, spec: TableSpec, column: string): unknown {
  if (value === null || value === undefined) return value;
  if (spec.json?.includes(column)) return JSON.stringify(value);
  if (spec.booleans?.includes(column)) return value ? 1 : 0;
  return value;
}

async function pullCustomerInputs(
  db: Database.Database,
  cloud: SupabaseClient,
  customerIds: Map<string, string>,
) {
  for (const spec of TABLES.filter((table) => CLOUD_INPUT_TABLES.has(table.name))) {
    const columns = sqliteColumns(db, spec.name);
    const quoted = columns.map((column) => `"${column}"`).join(", ");
    const placeholders = columns.map(() => "?").join(", ");
    const updates = columns
      .filter((column) => column !== "id")
      .map((column) => `"${column}" = excluded."${column}"`)
      .join(", ");
    const upsert = db.prepare(
      `insert into "${spec.name}" (${quoted}) values (${placeholders}) ` +
        `on conflict(id) do update set ${updates}`,
    );

    for (const [localCustomerId, cloudCustomerId] of customerIds) {
      const { data, error } = await cloud
        .from(spec.name)
        .select("*")
        .eq("customer_id", cloudCustomerId);
      if (error) throw new Error(`Could not pull ${spec.name}: ${error.message}`);
      const rows: SqliteRow[] = (data ?? []).map((row: Record<string, unknown>) => ({
        ...row,
        customer_id: localCustomerId,
      }));
      const ids = rows.map((row) => String(row.id));

      db.transaction(() => {
        for (const row of rows) {
          upsert.run(...columns.map((column) => sqliteValue(row[column], spec, column)));
        }
        if (ids.length === 0) {
          db.prepare(`delete from "${spec.name}" where customer_id = ?`).run(localCustomerId);
        } else {
          const marks = ids.map(() => "?").join(", ");
          db.prepare(
            `delete from "${spec.name}" where customer_id = ? and id not in (${marks})`,
          ).run(localCustomerId, ...ids);
        }
      })();
      console.log(`pulled   ${spec.name.padEnd(30)} ${rows.length}`);
    }
  }
}

async function verify(
  db: Database.Database,
  cloud: SupabaseClient,
  customerIds: Map<string, string>,
) {
  let mismatches = 0;
  for (const spec of TABLES) {
    const localIds = localRows(db, spec.name).map((row) => String(row.id));
    const local = localIds.length;
    let query = cloud.from(spec.name).select("*", { count: "exact", head: true });
    const firstCloudCustomerId = [...customerIds.values()][0];
    const columns = db.prepare(`pragma table_info("${spec.name}")`).all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === "customer_id") && firstCloudCustomerId) {
      query = query.eq("customer_id", firstCloudCustomerId);
    }
    const { count, error } = await query;
    if (error) throw new Error(`Could not verify ${spec.name}: ${error.message}`);
    let found = 0;
    for (let start = 0; start < localIds.length; start += batchSize) {
      const { data: rows, error: idError } = await cloud
        .from(spec.name)
        .select("id")
        .in("id", localIds.slice(start, start + batchSize));
      if (idError) throw new Error(`Could not verify ${spec.name} IDs: ${idError.message}`);
      found += rows?.length ?? 0;
    }
    const state = found === local ? "ok" : "MISMATCH";
    if (state === "MISMATCH") mismatches += 1;
    console.log(
      `${state.padEnd(8)} ${spec.name.padEnd(30)} ` +
        `local=${local} present=${found} cloud=${count ?? 0}`,
    );
  }
  if (mismatches > 0) throw new Error(`${mismatches} table(s) are missing local record IDs.`);
}

async function main() {
  const dbPath = process.env.CANTE_DB_PATH || path.join(process.cwd(), "cante.db");
  const db = new Database(dbPath, { readonly: !pullInputs });
  db.pragma("foreign_keys = ON");

  try {
    const cloud = dryRun ? null : await requireCloudClient();
    const customerIds = await mapCustomers(db, cloud);

    if (dryRun) {
      console.log(`Dry run: ${dbPath}`);
      for (const spec of TABLES) {
        const rows = localRows(db, spec.name).map((row) => transformRow(row, spec, customerIds));
        console.log(`${spec.name.padEnd(30)} ${rows.length}`);
      }
      console.log("Dry run complete. No network writes were attempted.");
      return;
    }

    if (verifyOnly) {
      await verify(db, cloud!, customerIds);
      return;
    }

    if (pullInputs) {
      await pullCustomerInputs(db, cloud!, customerIds);
      console.log("Supabase customer inputs pulled into SQLite.");
      return;
    }

    for (const spec of TABLES) {
      const rows = localRows(db, spec.name).map((row) => transformRow(row, spec, customerIds));
      if (rows.length > 0) await upsertTable(cloud!, spec.name, rows);
      console.log(`synced   ${spec.name.padEnd(30)} ${rows.length}`);
    }
    await verify(db, cloud!, customerIds);
    console.log("Supabase sync complete and verified.");
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(`Supabase sync failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
