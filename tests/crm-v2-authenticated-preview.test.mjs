import assert from "node:assert/strict";
import fs from "node:fs";
import { assistedConsolidationPlans } from "../src/lib/assistedConsolidationPlans.js";

const page = fs.readFileSync(
  new URL("../src/components/ClientDuplicatesPage.jsx", import.meta.url),
  "utf8",
);
const repository = fs.readFileSync(
  new URL("../src/services/data/clientMergeRepository.js", import.meta.url),
  "utf8",
);
const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/202608030003_client_deduplication_and_merge.sql",
    import.meta.url,
  ),
  "utf8",
);
assert.match(page, /session\?\.user/);
assert.match(page, /if \(!canWrite\)/);
assert.match(page, /profile\?\.role/);
assert.match(page, /admin ou manager/);
assert.match(page, /disabled=\{!session\?\.user \|\| !canWrite\}/);
assert.match(repository, /db\(\)\.rpc\('preview_client_merge'/);
assert.doesNotMatch(repository, /service.role|service_role/i);
assert.match(
  migration,
  /revoke all on function public\.preview_client_merge\(uuid,uuid\[\]\) from public/i,
);
assert.match(
  migration,
  /grant execute on function public\.preview_client_merge\(uuid,uuid\[\]\) to authenticated/i,
);
assert.doesNotMatch(
  migration,
  /grant execute on function public\.preview_client_merge\([^;]+\) to public/i,
);
assert.match(migration, /auth\.uid\(\) is null or not public\.can_write\(\)/);
const gabi = assistedConsolidationPlans.find((plan) => plan.key === "gabi"),
  santo = assistedConsolidationPlans.find(
    (plan) => plan.key === "santo-circuito",
  );
assert.deepEqual([gabi.proposedMonthly, gabi.proposedBillingDay], [5000, 10]);
assert.deepEqual([santo.proposedMonthly, santo.proposedBillingDay], [5500, 15]);
console.log("CRM V2 authenticated merge preview permissions: ok");
