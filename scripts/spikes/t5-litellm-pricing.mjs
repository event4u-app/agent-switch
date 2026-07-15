#!/usr/bin/env node
// S5 — LiteLLM pricing fetch shape check. Confirms the canonical machine-readable
// pricing source is reachable and carries the fields the cost layer needs for
// current Claude models. Records the snapshot date. Network read only.

const URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const green = (s) => `\x1b[32m${s}\x1b[0m`, red = (s) => `\x1b[31m${s}\x1b[0m`;
const WANT = ["input_cost_per_token", "output_cost_per_token", "cache_read_input_token_cost", "cache_creation_input_token_cost", "max_input_tokens"];
const MODELS = ["claude-opus-4-8", "claude-fable-5", "claude-sonnet-4-5", "claude-sonnet-5"];

const res = await fetch(URL).catch((e) => { console.log(red(`NULL: fetch failed — ${e.message}`)); process.exit(2); });
if (!res.ok) { console.log(red(`NULL: HTTP ${res.status}`)); process.exit(2); }
const json = await res.json();
console.log(`fetched ${Object.keys(json).length} model entries; snapshot date: ${new Date().toISOString().slice(0, 10)}`);

let found = 0;
for (const m of MODELS) {
  // match exact or claude-provider-prefixed keys
  const key = Object.keys(json).find((k) => k === m || k.endsWith(`/${m}`) || k.includes(m));
  if (!key) { console.log(`  ${m}: NOT FOUND`); continue; }
  const e = json[key];
  const have = WANT.filter((w) => w in e);
  console.log(`  ${key}: ${have.length}/${WANT.length} fields · in=${e.input_cost_per_token} out=${e.output_cost_per_token} cacheRead=${e.cache_read_input_token_cost} win=${e.max_input_tokens}`);
  if (have.includes("input_cost_per_token") && have.includes("output_cost_per_token")) found++;
}

const pass = found >= 2;
console.log(pass ? green("\nPASS: LiteLLM pricing reachable with required cost fields") : red("\nFAIL: pricing fields missing"));
process.exit(pass ? 0 : 1);
