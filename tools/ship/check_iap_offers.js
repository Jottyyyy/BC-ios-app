#!/usr/bin/env node
/*
 * check_iap_offers.js — ask App Store Connect whether the free trial actually exists.
 *
 *     node tools/ship/check_iap_offers.js
 *     node tools/ship/check_iap_offers.js --territories USA,PHL,THA
 *
 * WHY THIS EXISTS. On 2026-09-08 the client reported "wala parin yung option na free 7 day trial"
 * and sent a screen recording: the paywall said **Subscribe** and *"$1.99 per month"*, with no
 * mention of a trial anywhere. The app was right. `PremiumStore.introOfferEligible` had asked
 * StoreKit and been told there was no free introductory offer to have, so every one of the nine
 * upsell surfaces degraded to price-only copy exactly as designed — because promising a trial the
 * store will not honour is a Guideline 3.1.2 misrepresentation.
 *
 * The offer was missing in App Store Connect. `CHANGELOG.md` had said so since 2026-08-18:
 * *"the 7-day introductory offer does not exist in App Store Connect yet … Until it does,
 * `trialEligible` is false."* Nobody could see it, because every one of the 44 checks in
 * `tools/qa/` is offline and reads the LOCAL `ios/Biyaherong.storekit` — which declares a perfect
 * `P1W` free trial and is used by the Debug scheme alone. `replay_premium.js` was green the entire
 * time. `docs/app-store-handoff.md` states the gap in as many words: *"nothing in this repo can
 * see App Store Connect — that half is on you."*
 *
 * This is that half. It is the only thing here that talks to Apple.
 *
 * It checks three things the App Store Connect UI will not tell you at a glance:
 *   1. that an introductory offer exists on BOTH products;
 *   2. that it is a FREE TRIAL — Apple has three kinds, and the two paid ones would make the app
 *      say "7 days free" for an offer that is neither free nor seven days;
 *   3. that it covers the territories you actually test and sell in. Offers are configured PER
 *      TERRITORY; one created for the Philippines alone is invisible to a US Apple Account, which
 *      is the storefront the client's recording was made on.
 *
 * Credentials: the same App Store Connect API key `ship_testflight.sh` needs.
 *     ~/.appstoreconnect/asc.env                       ASC_KEY_ID, ASC_ISSUER_ID
 *     ~/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8
 * A key with the **Developer** role is enough to read in-app purchases. NEVER put a .p8 in this
 * repo — *.p8 is gitignored for exactly that reason.
 *
 * Exit codes, so a caller can tell "this is broken" from "I could not look":
 *     0  every product has a free trial covering every required territory
 *     1  a real problem — missing offer, wrong kind, or a territory gap
 *     2  could not check — no credentials, no network, or an unexpected response shape
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const API = 'https://api.appstoreconnect.apple.com';

const BOLD = (s) => `\x1b[1m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const YELLOW = (s) => `\x1b[33m${s}\x1b[0m`;

const say = (s) => console.log(`\n${BOLD('==> ' + s)}`);
const note = (s) => console.log(`    ${s}`);

/** Could not look. Distinct from "looked, and it is wrong". */
function cannotCheck(why, hint) {
  console.error(`\n${YELLOW('SKIPPED: ' + why)}`);
  if (hint) console.error(`         ${hint}`);
  process.exit(2);
}

// ------------------------------------------------------------------ the repo's own values
// EXTRACT, DON'T TRANSCRIBE. A product ID typed here that drifts from the one the app asks
// StoreKit for would make this check green against products the app never requests.

function readOr(file, why) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    cannotCheck(`cannot read ${path.relative(ROOT, file)}`, why);
    return '';
  }
}

const projectYml = readOr(path.join(ROOT, 'ios', 'project.yml'), 'run this from the repo');
const storeSwift = readOr(
  path.join(ROOT, 'DemoApp', 'Sources', 'BiyaherongUI', 'PremiumStore.swift'),
  'run this from the repo'
);

const bundleMatch = projectYml.match(/PRODUCT_BUNDLE_IDENTIFIER:\s*([\w.-]+)/);
if (!bundleMatch) cannotCheck('no PRODUCT_BUNDLE_IDENTIFIER in ios/project.yml');
const BUNDLE_ID = bundleMatch[1];

const PRODUCTS = [...storeSwift.matchAll(/case \.(monthly|yearly):\s*return "([^"]+)"/g)]
  .map((m) => ({ plan: m[1], id: m[2] }));
if (PRODUCTS.length !== 2) {
  cannotCheck(`PremiumStore.Plan yielded ${PRODUCTS.length} product IDs, expected 2`);
}

// The duration the app's own copy is built around, read off the local StoreKit config rather than
// typed, so this and `PremiumStore.trialDays` cannot disagree about what "7 days" means.
const storekit = readOr(path.join(ROOT, 'ios', 'Biyaherong.storekit'), 'run this from the repo');
const periodMatch = storekit.match(/"subscriptionPeriod"\s*:\s*"(P\d+[DWMY])"[^}]*\}/);
const EXPECTED_PERIOD = (storekit.match(/"introductoryOffer"[\s\S]{0,220}?"subscriptionPeriod"\s*:\s*"(P\d+[DWMY])"/) || [])[1]
  || (periodMatch || [])[1] || 'P1W';

// Apple's duration enum, as the API spells it, mapped to the ISO period the .storekit file uses.
const DURATIONS = {
  THREE_DAYS: 'P3D', ONE_WEEK: 'P1W', TWO_WEEKS: 'P2W', ONE_MONTH: 'P1M',
  TWO_MONTHS: 'P2M', THREE_MONTHS: 'P3M', SIX_MONTHS: 'P6M', ONE_YEAR: 'P1Y',
};

const argv = process.argv.slice(2);
const tIndex = argv.indexOf('--territories');
// USA because the client's own recording was made on a US storefront; PHL because that is the
// market. A trial missing in either is invisible to somebody who matters.
const REQUIRED_TERRITORIES = (tIndex >= 0 && argv[tIndex + 1] ? argv[tIndex + 1] : 'USA,PHL')
  .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

// ------------------------------------------------------------------ credentials + JWT
const HOME = process.env.HOME || process.env.USERPROFILE;
const ASC_DIR = path.join(HOME || '.', '.appstoreconnect');

let keyId = process.env.ASC_KEY_ID;
let issuerId = process.env.ASC_ISSUER_ID;
const envFile = path.join(ASC_DIR, 'asc.env');
if (fs.existsSync(envFile)) {
  const env = fs.readFileSync(envFile, 'utf8');
  keyId = keyId || (env.match(/ASC_KEY_ID=([^\s"']+)/) || [])[1];
  issuerId = issuerId || (env.match(/ASC_ISSUER_ID=([^\s"']+)/) || [])[1];
}
if (!keyId || !issuerId) {
  cannotCheck('no App Store Connect API credentials',
    `expected ASC_KEY_ID and ASC_ISSUER_ID in ${envFile}, or in the environment.\n`
    + '         Create a key: App Store Connect -> Users and Access -> Integrations ->\n'
    + '         App Store Connect API -> Team Keys. The Developer role is enough to read IAPs.');
}
const keyFile = path.join(ASC_DIR, 'private_keys', `AuthKey_${keyId}.p8`);
if (!fs.existsSync(keyFile)) cannotCheck(`no private key at ${keyFile}`);

const b64url = (input) => Buffer.from(input).toString('base64')
  .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

function bearerToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: issuerId, iat: now, exp: now + 600, aud: 'appstoreconnect-v1',
  }));
  const input = `${header}.${payload}`;
  // ES256 wants the raw r||s pair, not the DER sequence `sign` returns by default. Node has done
  // this since 16 via dsaEncoding, which is why this file needs no dependency.
  const sig = crypto.sign('sha256', Buffer.from(input), {
    key: crypto.createPrivateKey(fs.readFileSync(keyFile, 'utf8')),
    dsaEncoding: 'ieee-p1363',
  });
  return `${input}.${b64url(sig)}`;
}

let TOKEN;
async function get(pathAndQuery) {
  const res = await fetch(API + pathAndQuery, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, body: text };
  }
  try {
    return { ok: true, json: JSON.parse(text) };
  } catch (e) {
    return { ok: false, status: res.status, body: text };
  }
}

// ------------------------------------------------------------------ the walk
async function main() {
  try {
    TOKEN = bearerToken();
  } catch (e) {
    cannotCheck(`could not sign the API token: ${e.message}`,
      'is the .p8 an unencrypted EC private key straight from App Store Connect?');
  }

  say(`Checking introductory offers for ${BUNDLE_ID}`);
  note(`required territories: ${REQUIRED_TERRITORIES.join(', ')}`);
  note(`expected trial period: ${EXPECTED_PERIOD} (from ios/Biyaherong.storekit)`);

  const app = await get(`/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}&limit=1`);
  if (!app.ok) {
    cannotCheck(`App Store Connect returned ${app.status}`, String(app.body).slice(0, 400));
  }
  const appId = app.json.data && app.json.data[0] && app.json.data[0].id;
  if (!appId) cannotCheck(`no app record for bundle ID ${BUNDLE_ID}`);
  note(`app record ${appId}`);

  const groups = await get(`/v1/apps/${appId}/subscriptionGroups?limit=50`);
  if (!groups.ok) cannotCheck(`subscriptionGroups returned ${groups.status}`, String(groups.body).slice(0, 400));

  // Collect every subscription across every group, then match on the product IDs the app asks for.
  const found = new Map();
  for (const group of (groups.json.data || [])) {
    const subs = await get(`/v1/subscriptionGroups/${group.id}/subscriptions?limit=200`);
    if (!subs.ok) continue;
    for (const sub of (subs.json.data || [])) {
      const productId = sub.attributes && sub.attributes.productId;
      if (productId) found.set(productId, sub);
    }
  }

  let problems = 0;
  const bad = (s) => { console.log(RED(`    X  ${s}`)); problems++; };

  for (const { plan, id } of PRODUCTS) {
    console.log('');
    const sub = found.get(id);
    if (!sub) {
      bad(`${plan}: no subscription with product ID ${id} in App Store Connect`);
      continue;
    }
    const state = (sub.attributes && sub.attributes.state) || 'UNKNOWN';
    note(`${BOLD(plan)}  ${id}  [${state}]`);

    let offers = await get(`/v1/subscriptions/${sub.id}/introductoryOffers?limit=200&include=territory`);
    if (!offers.ok) {
      // The relationship path is the JSON:API convention and is what this expects; the `include`
      // form is the documented alternative. If BOTH are refused, say so with the response rather
      // than guessing — a checker that silently reports "no offer" on a 404 is worse than none.
      const alt = await get(`/v1/subscriptions/${sub.id}?include=introductoryOffers`);
      if (!alt.ok) {
        cannotCheck(`could not read introductory offers for ${id} (${offers.status})`,
          String(offers.body).slice(0, 400));
      }
      offers = { ok: true, json: { data: (alt.json.included || [])
        .filter((r) => r.type === 'subscriptionIntroductoryOffers') } };
    }

    const list = offers.json.data || [];
    if (list.length === 0) {
      bad(`${plan}: NO introductory offer configured. This is the whole bug — the app asks `
        + `StoreKit for one, is told there is none, and correctly stops mentioning a trial.`);
      console.log(RED('       App Store Connect -> Subscriptions -> the product -> Introductory '
        + 'Offers.\n       It is a separate section from Subscription Prices.'));
      continue;
    }

    const territories = new Set();
    const modes = new Set();
    const durations = new Set();
    for (const offer of list) {
      const a = offer.attributes || {};
      if (a.offerMode) modes.add(a.offerMode);
      if (a.duration) durations.add(a.duration);
      const t = offer.relationships && offer.relationships.territory
        && offer.relationships.territory.data;
      if (t && t.id) territories.add(String(t.id).toUpperCase());
    }
    note(`${list.length} offer row(s), mode(s): ${[...modes].join(', ') || '?'}, `
      + `duration(s): ${[...durations].join(', ') || '?'}`);
    note(`territories: ${territories.size} (${[...territories].slice(0, 8).join(', ')}`
      + `${territories.size > 8 ? ', …' : ''})`);

    // 1 - the KIND. Apple has three; only one of them is a free trial.
    const notFree = [...modes].filter((m) => m !== 'FREE_TRIAL');
    if (notFree.length) {
      bad(`${plan}: offer mode is ${notFree.join(', ')}, not FREE_TRIAL. The app's copy says `
        + `"{days} days free" — a paid introductory offer makes that a 3.1.2 misrepresentation.`);
    }

    // 2 - the LENGTH, against the period the app's own copy is built around.
    const asIso = [...durations].map((d) => DURATIONS[d] || d);
    if (asIso.length && !asIso.includes(EXPECTED_PERIOD)) {
      bad(`${plan}: duration ${[...durations].join(', ')} (${asIso.join(', ')}) does not match `
        + `${EXPECTED_PERIOD}. The app reads the real length off the product, so the copy would `
        + `follow — but ios/Biyaherong.storekit would then be lying to every Debug run.`);
    }

    // 3 - the TERRITORIES. The failure mode with no symptom: everything looks right in the UI.
    const missing = REQUIRED_TERRITORIES.filter((t) => !territories.has(t));
    if (missing.length) {
      bad(`${plan}: no offer for ${missing.join(', ')}. Introductory offers are configured per `
        + `territory, so an Apple Account there sees no trial at all.`);
    }
  }

  console.log('');
  if (problems > 0) {
    console.error(RED(`${problems} problem(s). The app will not show a free trial until these are fixed.`));
    process.exit(1);
  }
  console.log(GREEN('    ok — both products carry a free trial in every required territory'));
  console.log(YELLOW('    NOTE: this says the offer EXISTS. It cannot tell you whether a given '
    + 'Apple Account\n          has already used it — eligibility is once per subscription group '
    + 'and never\n          resets. If a tester still sees "Subscribe", try an Apple ID that has '
    + 'never\n          started this trial before assuming the configuration is wrong.'));
}

main().catch((e) => cannotCheck(e.message));
