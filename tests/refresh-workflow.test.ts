import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/refresh-prices.yml", import.meta.url), "utf8");

test("the scheduled refresh is not skipped when APP_URL is unset", () => {
  // Production previously missed every Telegram alert because this job had
  // `if: vars.APP_URL != ''` and the repository variable was not configured.
  assert.doesNotMatch(workflow, /^\s+if:\s*vars\.APP_URL\s*!=\s*''\s*$/m);
  assert.match(
    workflow,
    /APP_URL:\s*\$\{\{\s*vars\.APP_URL\s*\|\|\s*'https:\/\/portfolio2-king\.vercel\.app'\s*\}\}/,
  );
  assert.match(workflow, /"\$\{APP_URL%\/\}\/api\/cron\/refresh-prices"/);
});

test("the scheduled workflow still supports self-hosted URL and cron-secret overrides", () => {
  assert.match(workflow, /vars\.APP_URL\s*\|\|/);
  assert.match(workflow, /CRON_SECRET:\s*\$\{\{\s*secrets\.CRON_SECRET\s*\}\}/);
  assert.match(workflow, /cron:\s*"\*\/15 \* \* \* \*"/);
});
