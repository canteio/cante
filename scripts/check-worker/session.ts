import { AsyncLocalStorage } from "node:async_hooks";
import { createClient as supabaseClient } from "@supabase/supabase-js";

function makeClient(url: string, key: string, token: string) {
  return supabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
}
type Client = ReturnType<typeof makeClient>;
const context = new AsyncLocalStorage<Client>();
/** Bundler replacement for the Next cookie adapter in the isolated worker.
 * Every calculation keeps the caller's JWT/RLS, never the service client. */
export function withWorkerSession<T>(token: string, work: () => Promise<T>): Promise<T> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw Error("Worker authentication is not configured.");
  const db = makeClient(url, key, token);
  const getUser = db.auth.getUser.bind(db.auth);
  db.auth.getUser = jwt => getUser(jwt ?? token);
  return context.run(db, work);
}
/** Background work supplies the already authorized service client. Its caller
 * has claimed a tenant lease; product/archive queries still filter that tenant.
 * This binding also lets shared legal-rule readers use the same trusted client. */
export function withWorkerClient<T>(db: Client, work: () => Promise<T>): Promise<T> {
  return context.run(db, work);
}
export async function createRequestClient(): Promise<Client> {
  const db = context.getStore(); if (!db) throw Error("No authenticated worker session."); return db;
}
export const createClient = createRequestClient;
export async function getAuthenticatedWorkspace(customerId?: string | null) {
  const db = await createRequestClient();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) return null;
  let query = db.from("customer_users").select("customer_id,role").eq("user_id", data.user.id);
  if (customerId) query = query.eq("customer_id", customerId);
  const { data: membership, error: membershipError } = await query.order("customer_id", { ascending: true }).limit(1).maybeSingle();
  if (membershipError || !membership) return null;
  return { customerId: membership.customer_id as string, role: membership.role as "owner" | "admin" | "member" | "viewer", userId: data.user.id };
}
