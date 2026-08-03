import assert from "node:assert/strict";
import fs from "node:fs";
const sql = fs.readFileSync(
  new URL(
    "../supabase/migrations/202608030005_real_data_correction_rpcs.sql",
    import.meta.url,
  ),
  "utf8",
);
for (const signature of [
  "apply_contract_future_change",
  "create_prospective_contract",
  "mark_contract_ended",
  "validate_real_data_correction",
])
  assert.match(
    sql,
    new RegExp(`create or replace function public\\.${signature}\\(`, "i"),
  );
for (const guarantee of [
  "auth.uid() is null",
  "public.can_write()",
  "public.current_organization_id()",
  "pg_advisory_xact_lock",
  "request_key",
  "security definer set search_path=''",
  "received_amount",
  "paid_at",
  "installment_type",
  "commercial_events",
])
  assert.ok(sql.includes(guarantee), `Garantia ausente: ${guarantee}`);
assert.doesNotMatch(sql, /\bdelete\s+from\b/i);
assert.doesNotMatch(sql, /service.role|service_role/i);
assert.doesNotMatch(sql, /grant execute[^;]+to public/i);
for (const signature of [
  "apply_contract_future_change\\(uuid,date,numeric,integer,text,text\\)",
  "create_prospective_contract\\(uuid,date,numeric,integer,text,text,text\\)",
  "mark_contract_ended\\(uuid,date,text,text\\)",
  "validate_real_data_correction\\(text\\)",
]) {
  assert.match(
    sql,
    new RegExp(`revoke all on function public\\.${signature} from public`, "i"),
  );
  assert.match(
    sql,
    new RegExp(
      `grant execute on function public\\.${signature} to authenticated`,
      "i",
    ),
  );
}
const executable = sql.replace(/as \$\$[\s\S]*?\$\$;/gi, "as $$body$$;");
assert.doesNotMatch(
  executable,
  /\b(insert|update|delete)\s+(into|public\.|from)/i,
  "A aplicação da migration não pode alterar dados",
);
console.log("CRM V2 real data correction RPC contracts: ok");
