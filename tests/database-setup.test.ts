import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DatabaseSetup from "../src/components/DatabaseSetup";

test("quick connect is available without completing the optional provider guide", () => {
  const html = renderToStaticMarkup(createElement(DatabaseSetup));
  const form = html.indexOf("PostgreSQL connection string");
  const providerHelp = html.indexOf('id="provider-help"');
  assert.ok(
    form !== -1 && providerHelp > form,
    "connection form comes before provider help",
  );
  assert.match(html, /Administrator setup key/);
  assert.match(html, /Test connection/);
  assert.match(html, /Need help choosing a database/);
  assert.match(html, /<details id="provider-help"/);
  assert.doesNotMatch(html, /<details id="provider-help"[^>]* open/);
});
