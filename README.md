# Ledgerly — Portfolio Manager

A **self-hosted** portfolio tracker for cash, stocks and crypto. Ledgerly is a
Next.js 16 (App Router) app backed by PostgreSQL through Drizzle ORM: you run it
on your own machine, VPS, or home server, point it at your own database, and the
data stays there.

Prices are entered by hand, with optional one-click quotes from public exchange
APIs (crypto) and Yahoo Finance (stocks). There is no hosted account, no
analytics, and no proprietary backend. Ledgerly has **no authentication or per-user data isolation** — protect
the deployment before storing real portfolio data (see the
[self-hosting security checklist](#self-hosting-security-checklist)).

## Highlights

- Cash accounts (with a Cambodian bank picker), stocks, crypto, and other assets.
- Buys, sells, deposits, withdrawals, and income, with average cost and realized
  / unrealized P/L replayed from the full transaction history.
- Manual prices plus live crypto quotes from Bybit, OKX, Binance, Coinbase,
  Kraken, or DexScreener, and live stock/ETF quotes from Yahoo Finance — no API
  keys required. A crypto holding can be **added from a specific exchange**, and
  every later refresh keeps pricing it there.
- **Exchange balance import** from Binance, OKX and Bybit with read-only API
  keys: balances are fetched server-side, signed locally, and booked into the
  portfolio as deposits — re-syncing applies only what changed.
- **Add via wallet address**: paste a public address and DeBank detects every
  token on every EVM chain (prices and logos included) in one call, with a direct
  on-chain read of public RPCs as the fallback — and Solana, Bitcoin and Tron
  supported natively. Import one token or all of them at once.
- **Holdings folders**: group positions ("Long term", "Binance", "Play money"),
  give each folder an exchange logo or a custom emoji, colour and name, then drag
  a holding onto a folder to file it. Folder headers show their own total.
- Crypto asset search that falls back automatically between public data
  providers when one is rate-limited or down.
- Daily per-asset price snapshots and portfolio snapshots, allocation donut and
  history charts, per-asset pages, and an activity feed.
- Portable JSON export/import, so you can move providers without `pg_dump`.
- Optional guided database setup in the web UI.
- Background price refresh with threshold alerts over Web Push (browser or
  installed web clip) and Telegram, plus an optional daily whole-portfolio
  update (money and percent) at a time you choose.
- **One reporting currency: USD.** See below.

**Contents:** [Supported currencies](#supported-currencies) ·
[Add crypto from a wallet](#add-crypto-from-a-wallet) ·
[Arrange the dashboard](#arrange-the-dashboard) ·
[Holdings folders](#holdings-folders) · [Mobile layout](#mobile-layout) ·
[Background refresh and alerts](#background-refresh-and-alerts) ·
[Run locally](#run-locally) · [Self-host on your own server](#self-host-on-your-own-server) ·
[Connect a database from the web UI](#connect-a-database-from-the-web-ui) ·
[Export & import](#export-and-import-the-database) ·
[Deploy on Vercel](#deploy-on-vercel-optional) · [Scripts](#scripts) ·
[Runtime notes](#runtime-notes)

## Supported currencies

Ledgerly keeps a **single USD ledger**. USD is hard-coded as the reporting
currency (`CURRENCY` in [`src/lib/format.ts`](src/lib/format.ts)), and every
amount is rendered with
`Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })`. Totals,
cost basis, P/L, charts, snapshots, and the activity feed are therefore always
US dollars, shown with `$`.

| Where | What you enter | Currency behaviour |
| --- | --- | --- |
| Dashboard totals, charts, snapshots, P/L | — | Always USD |
| Cash accounts | balance + free-text currency/tag | Tag is a label only; the balance is added to USD totals **1:1** |
| Stocks / ETFs / other | quantity + price per unit | Price is USD |
| Crypto | quantity + price per unit | USD, or USDT when fetched from an exchange; USDT is treated as 1:1 with USD |
| Backup JSON | plain numbers | No currency metadata — the file is a USD ledger |

### What the cash “currency / tag” actually does

The field is stored in the asset’s `symbol` column and uppercased. It is used
for display (account/bank label), **not** for conversion:

- Cash is always valued at `1.00` per unit — `avgCost` and `currentPrice` are
  forced to `1` when a cash asset is created or replayed — so a cash holding’s
  value is simply its balance. No FX rate is looked up anywhere.
- Choosing a Cambodian bank pre-fills the tag as `USD`. You can overwrite it
  with `KHR`, `THB`, `VND`, `EUR`, etc., but the number beside it still lands in
  the USD total unchanged.
- Cash deposits, withdrawals, income, and the “pay from cash” option on a
  purchase all move that same raw number.

### Tracking KHR, THB, VND, or EUR balances

Because there is no conversion, enter the **USD value** of any non-USD balance
and keep the original amount in the notes so you can audit it later:

1. Add a cash account, pick the bank, and leave the tag as `USD`.
2. Convert the balance at the rate you want to record — for example
   `4,000,000 KHR ÷ 4,000 KHR/USD = 1,000.00`.
3. Put `KHR 4,000,000 @ 4,000` in **Notes**.
4. Re-value the account yourself when the rate moves by recording a deposit or
   withdrawal for the difference (cash balances change through transactions).

Do **not** add `4,000,000` and tag it `KHR`: Ledgerly would count it as
$4,000,000. If you keep one account per currency, treat them as USD accounts
whose tags record the original currency.

### Not supported

- FX rates, currency conversion, historical FX, or rate lookups.
- Per-currency subtotals, allocation by currency, or a currency selector.
- Per-asset currencies — every price is stored in USD (USDT is treated as
  equivalent). A stock quoted in another currency is converted once, when the
  quote is fetched (see [stock prices](#stock-prices-yahoo-finance)); there is no
  FX table, no historical FX, and no way to view an asset in its local currency.
- Changing the reporting currency. That needs a code change to `CURRENCY` plus
  reconciling every stored number; the schema deliberately has no currency
  column, which is also why backups move cleanly between instances.

> A true multi-currency ledger (KHR cash next to USD stocks) would need a
> currency on each account plus a dated FX-rate table, and every total/snapshot
> would have to convert at capture time. That is a feature, not a setting.

## Add crypto from a wallet

**Add asset → Crypto → Add via wallet address** takes a public address and fills
the form for you (or imports everything it finds):

1. Paste the address — `0x…` for any EVM chain, a Solana base58 address, a
   Bitcoin `bc1…` / `1…` address, or a Tron `T…` address — and pick a chain, or
   leave **All chains (DeBank)**.
2. Click **Scan wallet**. Every non-zero balance comes back with its quantity,
   USD price, value, chain and logo — across every chain DeBank indexes, not
   just the popular ones this app can read by itself.
3. Every token arrives **ticked**. Untick anything you do not want, or use
   *Select all* / *Select none*, then **Import selected (N)** books the ticked
   ones as holdings in one go. *Fill form* on a card copies it into the manual
   form instead. The import files them into a **folder** — name it in the
   *File into a folder* box, or leave the name blank and it is called after the
   address (`0x1234…abcd`). Untick the box to import without a folder. Importing
   the same wallet again reuses the same folder instead of making a second one.
4. **Skip tokens under $** (on by default, $1) keeps dust out of the list and out
   of *Import all* — the wash-trading airdrops and leftover cents that would
   otherwise become 40-row holdings. It is measured in **dollars**, not quantity,
   so a million near-worthless tokens count as dust too. Nothing is deleted: the
   line under the scan says how many tokens and how much value were hidden and
   offers a one-click *show them*, and setting the box to `0` turns the filter
   off. The same cut-off is re-applied server-side, so a stale page cannot slip
   dust into the portfolio, and the import message says what was skipped. A token
   the scan **could not price** is never counted as dust: it is kept, shown as
   *no price yet*, and imported at price 0 rather than a made-up $1 — otherwise a
   real holding with a rate-limited price lookup would silently disappear.
5. **Hide spam tokens** (on by default) keeps airdropped junk out of the list and
   out of *Import all*. Spam is not a value problem — scam tokens carry made-up
   prices, so one "worth" $40,000 would pass any dollar cut-off and sit at the
   top of the portfolio — so the test is the name itself: a website or `t.me`
   invite, airdrop marketing words (*claim*, *airdrop*, *visit*, *redeem*,
   *voucher*, *giveaway*, *promo*), a sentence addressed to the holder (*you have
   won…*, *claim your…*, *receive your…*), an amount of a real ticker printed in
   the name (*5,000 USDT*), zero-width/bidi characters used to fake a ticker, a
   name and symbol with no letters at all (*🎁🎁*), an impossibly long name or
   symbol, or a spam / `is_scam` flag the indexer sent. Real names are left alone
   — *Ethena USDe*, *Renzo Restaked ETH*, *First Digital USD*, *1inch*, *🐸 Pepe*
   and friends are checked in `tests/wallet-spam.test.ts`. It is a filter, never a
   delete: the scan line counts what was hidden and *show the suspects* brings
   them back, and unticking the box imports them anyway. Spam is also left out of
   every total — its price is invented, so counting it would put a fake $40,000
   position at the top of the portfolio — through `computeTotals`, which means the
   value header, the allocation donut, the daily snapshots and the alert
   thresholds all skip it together.
6. **Hide look-alike contracts** (on by default) is the official-address check.
   Anyone can deploy a token called `USDT`; what separates it from the real one is
   the contract. `src/lib/token-trust.ts` holds the issuers' own addresses for the
   well-known tokens on the chains this app prices (USDT, USDC, DAI, WETH, WBTC,
   cbBTC, LINK, UNI, AAVE, ARB, OP, AERO, BNB, AVAX, LayerZero's ZRO — which
   launches at one identical address on all seven of them — and the bridged
   `USDC.e` / `USDBTC` variants), keyed by chain. A scan balance is then:
   **official** (the address matches, and the card shows *official ✓*),
   **different** (right symbol, wrong contract — hidden and counted as a
   look-alike), or **unknown** (not in the table, which is most real tokens, and
   is never a reason to hide anything). The same check runs again server-side in
   `importWalletBalances`, so a stale page cannot import a fake `USDT`.
7. **Only tokens with a real market** (on by default) answers "is this actually a
   token anyone trades?". For each contract the scan asks DexScreener for its
   pairs and works out two things.

   *Volume* (`MIN_ORGANIC_VOLUME_USD`, $100/day): pools under $500 of liquidity
   are ignored — anyone can create one to fake activity — and volume above 200× a
   pool's own liquidity is dropped as wash trading, so what remains is organic.

   *Depth* (`src/lib/organic-volume.ts`): `liquidityUsd` is the pooled liquidity of
   the pools that count, and `deepestPoolUsd` is the deepest single one. A token
   is **real at $2,000** pooled (`MIN_LIQUIDITY_USD`) and **deep at $25,000** with
   one pool holding at least $5,000 (`DEEP_LIQUIDITY_USD` / `MIN_DEEPEST_POOL_USD`)
   — twenty $4,000 pools do not add up to depth, because liquidity is the part of a
   fake token that costs real money to manufacture. `liquidityDepth()` returns
   `deep` / `shallow` / `unknown`, and the card shows the number: `$41.2k liq ✓`,
   grey for a real-but-small market, amber when the pools are too thin to trust.

   Both floors hide a token, both are counted in the *Show them* line, and both are
   re-applied server-side. No answer from DexScreener means *unknown*, which is
   kept — a rate limit must never hide a real holding.

Each hidden bucket (look-alike, spam, no volume, dust) is counted in the line
under the scan with its own *Show them* link, so a filter never silently swallows
a token.

The same switch sits on the holdings table (*Hide spam*, on by default): rows
that look like spam are skipped with a count, a *Show them* link and a **Remove
them** button, and once shown each one carries a small **spam?** badge with its
value shown as *—* (it is not part of the total). Remove them is the clean-up for
junk that was imported before the rules existed — it deletes exactly the rows the
notice counted (same rule, `removeSpamHoldings`), re-records the snapshot and says
how many went; *Show them* stays, so nothing is deleted by accident. Arrange mode
ignores the filter so nothing becomes impossible to drag into a folder.

### How a scan finds tokens

The address decides the method; `src/lib/wallet-scanner.ts` is the only place
that talks to the network about a wallet.

| Address | How the tokens are found |
| --- | --- |
| `0x…` (EVM) | **Two reads in parallel, then merged.** DeBank covers every chain it indexes in one call; at the same time the direct read asks the public RPCs on Ethereum, BNB Chain, Arbitrum, Base, Polygon, Optimism and Avalanche for the native coin plus the known tickers, and asks **Blockscout → Routescan** for *every other ERC-20* the wallet holds (that is where the long tail comes from). |
| Solana | The public Solana RPC (`solana-rpc.publicnode.com`, then `api.mainnet-beta.solana.com`) reads the wallet's token accounts and the known mints. |
| Bitcoin | `mempool.space`, falling back to `blockstream.info`. |
| Tron | `apilist.tronscanapi.com/api/accountv2`. |

**Blockscan** is the second source you can pick in the dialog (*Scan via
Blockscan*, next to the chain menu). Blockscan is Etherscan's multichain explorer,
and its data comes from **Etherscan V2** (`https://api.etherscan.io/v2/api`) —
one key for 60+ chains, with `chainid` choosing the network. The scan asks
`module=account&action=addresstokenbalance` per chain (token balances *and*
`TokenPriceUSD`) and merges the answer with the direct read above, so a refusal
never turns into an empty wallet:

- **Needs a key.** `ETHERSCAN_API_KEY` (or `BLOCKSCAN_API_KEY`). Without one the
  sweep is skipped, the scan falls back to the direct read, and the dialog says so
  and names the fix.
- **Token holdings are a PRO endpoint.** A free key reads native balances only;
  Etherscan answers *"not available on your plan"*, which the dialog reports as
  such instead of *no tokens found*.
- **2 calls a second.** `src/lib/blockscan.ts` walks the 14 chains this app also
  prices, one token call per chain, 550 ms apart, inside a 12 s budget; chains the
  budget did not reach are counted in the note. A single-chain scan (pick the
  chain in the menu) also reads that chain's native coin.
- **Automatic fallback.** In a default scan, if DeBank cannot answer and an
  Etherscan key is configured, the same sweep runs instead of settling for the
  smaller direct read — the result then says `via Blockscan` and why.

Only chains with a public Blockscout or Routescan instance can be *discovered*
beyond the hand-listed tickers — today that is 14 Blockscout chains (Ethereum,
Base, Optimism, Arbitrum, Polygon, Gnosis, zkSync, Scroll, Linea, Mantle, Zora,
Mode, Celo, Aurora) and 56 Routescan ones, with Routescan as the fallback where
Blockscout has no public instance (Base, for example). A chain that has neither
still reports its native coin and the listed tickers over RPC; nothing is hidden
because a third party is missing.

The two reads run together, so a scan takes as long as the slower one:

1. **DeBank** (EVM only) — `pro-openapi.debank.com` with `DEBANK_ACCESS_KEY` when
   one is set, otherwise the keyless `api.debank.com` and `api.rabby.io` routes
   in turn. 6 s per request, 12 s total budget, at most 250 tokens.
2. **Direct read** — per chain, in parallel: `eth_getBalance` plus batched
   `balanceOf` calls for the known tickers, and the explorer discovery call
   (7 s Blockscout / 8 s Routescan, two pages of 100, at most 150 tokens per
   chain, spam-flagged tokens dropped).
3. **Merge** — the same token found twice is one row (chain + contract), and
   the index's live price (DeBank's, or Blockscan's `TokenPriceUSD`) wins over a
   locally looked-up one. Tokens only the direct
   read saw are priced from the market APIs, then from the built-in fallback
   table. The result says `via DeBank`, `via Blockscan` or `read directly from
   the chains`, and `directAdditions` counts what the index would have missed.
4. **Trust pass** (`/api/wallet/scan` → `wallet-trust`) — official contract
   address, organic 24 h volume and liquidity depth per contract, from the local
   table and one batched DexScreener call (30 contracts each). Failures leave a
   token *unknown*, never hidden.
5. **Filters in the dialog** — look-alike contracts, spam, no real market and
   dust are each counted with a *Show them*, and only ticked tokens are imported.

EVM addresses are read through **[DeBank](https://debank.com)**, which indexes
**every EVM chain it supports — 100+ of them**, from Ethereum, BNB Chain,
Arbitrum, Base and Polygon to Sonic, Zora, Berachain, Unichain, Ink, HyperEVM and
whatever it added last week. One call returns all of them together, with prices
and logos, so no per-chain RPC trip or per-token quote lookup is needed. The
result says **via DeBank** and counts the chains it found, so it is clear where
the numbers came from.

That list is not hard-coded here. A chain id this app has never seen is still
kept, listed and imported; its display name is read from DeBank's own
`/v1/chain/list` (cached for six hours) and falls back to the upper-cased id
(`AERO`) if even that is unavailable. Choosing a specific chain in the dropdown
filters the result, and the filter understands both spellings — `ethereum` and
DeBank's `eth` are the same chain.

DeBank's keyless routes get blocked, renamed and rate-limited, so three are tried
in order before giving up: DeBank's API gateway
(`api.debank.com/v1/user/token_list`), its legacy web route
(`api.debank.com/token/balance_list?user_id=…`) and Rabby's public API
(`api.rabby.io`), which reads the same indexer. If all three answer with an empty
list, one more call asks for *every* token (`is_all=true`) before the app
concludes the wallet really holds nothing.

Two things follow:

- Add a free **`DEBANK_ACCESS_KEY`** (from <https://cloud.debank.com>) to use the
  supported Open API and get the reliable path — one request, no fallbacks. See
  `.env.example`. **This is now the expected setup**: DeBank increasingly refuses
  the keyless routes, and then the app can only read the fifteen chains it knows
  how to read by itself.
- Without a key the scan still works, just smaller: it reads balances straight
  from public RPCs and the Blockscout / Routescan explorers and the dialog says so quietly — *"Read
  directly from the chains — DeBank only lists tokens with an access key … Add a
  free DEBANK_ACCESS_KEY to cover every chain DeBank indexes."* DeBank serves an
  **empty list** to unauthenticated callers even for a wallet full of tokens, so
  an empty keyless answer is now reported as "give DeBank a key", never as "this
  wallet is empty".

The direct read does not just look up a fixed ticker list. Each chain is read from
two sides at once:

- **RPC** gives the native coin balance and the handful of well-known tickers.
- **Explorers** give the wallet's whole ERC-20 portfolio — including tokens nobody
  hand-listed, such as LayerZero (`ZRO`) on Base. Two keyless sources are used per
  chain: public **[Blockscout](https://www.blockscout.com)** instances (`tokenlist`
  first, then `token-balances`), and **[Routescan](https://routescan.io)**'s
  Etherscan-compatible `addresstokenbalance` API, which covers chains Blockscout
  has no public instance for (BNB Chain, Avalanche, …) and steps in when
  Blockscout is rate-limited. Spam-marked tokens are dropped.

DeBank and the direct read run **together and are merged**, not "DeBank or
nothing": DeBank's prices win for the tokens it reports, and anything it missed —
another chain, a filtered token, a token it does not index — is added from the
direct read and priced by the app. That is what stops a scan from quietly
dropping a holding DeBank did not mention.

Every chain the dropdown offers is scanned, including the ones with no RPC token
list (zkSync, Linea, Scroll, Mantle, Blast, Fantom, Gnosis, Cronos, plus Zora,
Sonic, Celo, Mode, Unichain and Berachain): they are read through the explorers,
so they report ERC-20s but not their native coin.

A refusal is never reported as an empty wallet. DeBank answers `200 OK` with
`{ "error_code": 1, "error_message": … }` when it wants a key or is rate-limiting,
and that body is now read as a refusal (with DeBank's own wording in the note)
instead of "DeBank returned no tokens for that wallet". Only an explicit empty
list means the wallet is empty.

Notes:

- Read-only: no keys, signatures or approvals. The address is only used for the
  lookup and is written into the holding's note (`Wallet: 0x… (0x1234…abcd) ·
  Chain: Arbitrum · Contract: 0x…`) so you can tell two identical tokens on
  different chains apart.
- USD-pegged tickers (`USDT`, `USDC`, `DAI`, `USDe`, …) are filed as
  **Stablecoins** automatically; everything else is volatile crypto.
- Unpriced airdrop spam that DeBank does not recognise is skipped, so the picker
  stays readable. A token DeBank marks as verified but has no price for is still
  listed.

## Arrange the dashboard

The dashboard cards — **Portfolio stats** (the Cash / Invested / Unrealized /
Realized row), **Holdings**, **Value history**, **Allocation** and **Recent
activity** — can be moved up and down as whole blocks:

1. Click **⇅ Arrange layout** above the cards.
2. Drag a card's dashed header (the one with the grip dots), or use its **▲ / ▼**
   buttons — the touch-friendly and keyboard-accessible path.
3. Click **Save layout**. Nothing is written until you save; **Cancel** discards
   pending moves and **Reset to default** restores Portfolio stats → Holdings →
   Value history → Allocation → Recent activity.

The four stat cards can be shuffled **inside** their row and **renamed** at the
same time: each one gets its own small header with a grip and **◀ / ▶** buttons
plus an editable label field (up to 40 characters; clearing a label falls back
to its default heading), so Cash can sit last or be renamed to "Dry powder"
without moving the whole row. Both orders and any custom labels are saved by the
same **Save layout** click and restored by **Reset to default**.

The **Holdings** category tabs — **All**, **Cash**, **Stocks**, **Stablecoins**,
**Volatile crypto** and **Other** — are arranged in the same mode. Each tab turns
into a dashed pill with a grip and **◀ / ▶** buttons (dragging works too) and the
row wraps instead of scrolling, so every tab stays reachable on a phone. Put
**Stablecoins** or **Volatile crypto** first if that is what you check every
morning; the saved order is the order the tabs read in from then on. Arranging
only changes the order — clicking a tab still filters the table and the total
above it, and the counts on the tabs still update as holdings change.

**The holdings themselves are arranged in the same mode.** Every row gets an
**Order** column (on a phone: a dashed strip above the card) with the same grip
and **▲ / ▼** buttons. Drag a row over another one to drop it above or below, or
nudge it one place at a time — a screen reader announces the new position, and the
number next to the grip shows where the holding sits. The arrangement is the
table's default order from then on: it is what you see on the dashboard and in
the **Custom · my arrangement** option of the phone **Sort** menu, while the
column headers still sort by value, P/L, weight or name for a one-off look (they
become plain labels while you arrange, so they cannot fight the arrangement). It
is saved by the same **Save layout** click and cleared by **Reset to default**,
which puts the table back to largest-value-first.

Details:

- The layout is stored in `app_settings` under `dashboard.order` as a
  comma-separated list of card keys. Unknown keys are dropped, duplicates removed,
  and missing cards appended in their default spot, so a stale tab or a
  hand-edited setting cannot break the page. An order saved before the stat row
  became a block keeps that row at the top instead of pushing it to the bottom.
- The stat-card order lives beside it under `dashboard.statsOrder`
  (`cash,invested,unrealized,realized` by default), and custom headings live
  under `dashboard.statsLabels` as a JSON map of `{ cash, invested, unrealized, realized }`.
- The Holdings category order lives beside them under `holdings.categoriesOrder`
  (`all,cash,stock,stablecoin,volatile,other` by default) and is normalised the
  same way, so an unknown or half-written setting still renders all six tabs.
  **Save layout** stores it with the card and stat orders; **Reset to default**
  clears all three.
- The order of the holdings is stored under `holdings.order` as a comma-separated
  list of asset ids (empty or missing = the default order). Ids of holdings you
  have deleted are ignored, and a holding that is not in the list yet — anything
  added after the arrangement was saved — keeps its normal place at the end, so
  arranging can never hide a row. It is also saved and reset with the layout.
- The two charts stay side by side (Value history 3/5, Allocation 2/5) whenever
  they are next to each other, and full-width cards start a new row. On phones the
  cards stack in the saved order.
- Saving the layout does not touch any holdings, balances or snapshots.

## Holdings folders

Folders turn a long table into a few groups without changing any numbers:

1. Click **⇅ Arrange layout**, then **＋ New folder** in the strip above the
   table. Name it (28 characters), pick a colour, and choose an icon: the first
   letter, an exchange logo (Binance, OKX, Bybit, Coinbase, Kraken, DexScreener)
   or any emoji you type.
2. File holdings in: drag a row onto a folder chip, or use the **Folder** dropdown
   on every row. A holding can be in one folder; holdings with no folder are
   simply plain rows above the folder groups.
3. Pick *No folder* in a holding's dropdown to pull it out of its folder again.
4. Click **Save layout**. **Reset to default** removes the folders; the holdings
   themselves are never deleted, they just go back to being plain rows.

**Dragging works outside arrange mode too**, which is the quick way to tidy up:

- Every holding gets a grip on hover (always visible on touch screens, and the
  **Folder** dropdown next to it is the keyboard-friendly path). Drag it and the
  folder groups highlight.
- Drop it on a **folder group** — its header or anywhere in its rows — and it is
  filed there; drop it on another holding to put it in *that* holding's folder.
  To pull a holding back out, pick *No folder* in its dropdown. Empty folders
  show their own dashed *"drop a holding here"* row while you drag.
- Those drops save immediately (one small request per move, with the row moving
  optimistically and snapping back if the save fails). Arrange mode is the only
  place where moves stay pending until **Save layout**, because that is the click
  that stores the folders themselves.

The toolbar also has a **Hide under $** box (off by default) that hides holdings
worth less than the amount you type — the same rule as the wallet import, applied
to the table. Hidden rows are always counted in a note above the table ("3
holdings under $1.00 hidden ($0.42) · Show them"), and arrange mode ignores the
filter so a hidden holding can still be dragged.

Outside arrange mode the strip is a filter: **All** plus one chip per folder with
its count and value. Clicking a chip narrows the table (and the category tab +
search still apply on top). With folders in play the table lists holdings that are
in no folder as ordinary rows first, then a header per folder — icon, name, number
of holdings and the folder's own total — followed by that folder's rows. Each
header collapses, which is handy on a phone where the groups become stacked cards.
There is no *Unfiled* group or chip: a holding without a folder is not a category,
it is just a holding.

Importing a wallet from **Add via wallet address** creates a folder named after
the wallet (or whatever you type in *File into a folder*) and files the imported
holdings into it, so a wallet reads as one group you can collapse or rename.

Details:

- Folders and filing are stored in `app_settings` under `holdings.folders` and
  `holdings.folderAssignments`, are normalised on read (unknown ids, duplicates
  and nameless folders are dropped) and are saved by the same **Save layout**
  click as the cards, the tabs and the row order.
- A folder is a label, not a container: portfolio totals, weights, P/L and
  snapshots are unchanged, and a holding is never counted twice.
- Deleting a folder unfiles its holdings; renaming or recolouring it keeps them.
- Crypto holdings that are priced from a specific exchange show that exchange's
  mark next to the name, so Binance-priced BTC is distinguishable from an
  OKX-priced one at a glance.

## Mobile layout

Every screen is built to work on a phone as well as a desktop:

- **Navigation** keeps **Dashboard** and **Activity** directly in the top bar and
  groups **Exchanges**, **Refresh prices**, **Alerts** and **Database** inside a
  **Settings** submenu (which highlights whenever any of those pages is open);
  below 768 px the bar collapses into a single ☰ menu with an expandable
  **Settings** section. Only one menu is open at a time, it closes on a route
  change, an outside tap, **Escape**, or when the phone is rotated back to the
  desktop layout, and it scrolls inside itself instead of running off the
  screen.
- **Holdings** switches from a seven-column table to one card per holding below
  768 px, with value, P/L, quantity × price and the weight bar. Sorting moves to a
  **Sort** dropdown because the table header is not visible there.
- **Activity**, **Refresh prices** and an asset's **transaction history** use the
  same card pattern, so nothing requires horizontal scrolling to read.
- **Forms and dialogs** stack to one column, the add-asset dialog becomes a
  bottom sheet, and the page grid collapses from 4 → 2 → 1 columns.
- **Charts** scale to the container width and support touch scrubbing.
- Long names, notes and totals truncate or wrap instead of pushing the layout
  sideways; inputs use a 16 px font on small screens so iOS does not zoom.
- **Tap targets** are at least 44 px (menu button, theme toggle, menu rows), taps
  skip Safari's 300 ms delay, and the sticky header + menu respect the notch and
  home indicator through `env(safe-area-inset-*)`.

### Hiding and revealing balances

There is exactly **one** control that hides or reveals money, and it lives in the
navigation menu: **☰ → Privacy** on a phone and **Privacy ▾** in the header on
desktop (`src/components/PrivacyMenu.tsx`). The header itself has no eye button,
and the “balances are hidden” notice is informational only — it never offers a
second toggle that could fall out of sync. The same menu holds **Lock now**,
**Forget this device** and **Manage Face ID / PIN**; the lock screen still owns
unlocking, because that is a gate rather than a toggle.

#### First visit: Face ID once, then remembered

When a Face ID / Passkey lock is set up:

1. **A new device** (nothing in its cache) gets the lock screen with an automatic
   Face ID / Passkey attempt. Safari only shows a WebAuthn prompt after a tap, so
   the sheet also focuses the **Unlock with Face ID / Passkey** button — one tap
   or press of Enter unlocks.
2. A successful unlock is written to two places: an `HttpOnly` session cookie on
   the server (`ledgerly_privacy_session`, `PRIVACY_DEVICE_MAX_AGE` = 400 days,
   the longest lifetime browsers accept) **and** a small device record in the
   browser cache (`ledgerly-privacy-device` in `localStorage`, via
   `src/lib/device-memory.ts`). The record holds only a credential id, a label
   and a timestamp — never a PIN hash, token or signature.
3. Later launches on that device go straight to the dashboard; the lock screen is
   only shown again after **Lock now** or **Forget this device**, or when the
   server cookie is gone (cache cleared, private window, other browser).
4. **PIN fallback:** if the passkey prompt is cancelled or unavailable, “Use PIN
   instead” reveals the PIN form, so a device without a passkey can still get in.
   If no PIN is set and Face ID keeps failing, the portfolio stays locked — set a
   PIN when you enable Face ID if you want a way back in.

5. **Locking does not re-prompt:** tapping **Lock now** or **Forget this device**
   also sets a tab-scoped lock intent (`sessionStorage`), so the lock screen does
   not immediately pop Face ID and undo the lock. The first successful unlock
   clears it again.

Remembering a device is a *convenience* layer, not a second security boundary:
the server still decides whether a request is unlocked, and `/api/privacy`
supports `forgetDevice` so the browser can drop it on request.

### Install as an iPhone web clip

Add Ledgerly to the Home Screen from Safari, then open it from the icon:

- `display: "standalone"` + `statusBarStyle: "black-translucent"` with
  `viewport-fit=cover`, so the header gradient runs under the status bar and the
  controls are padded down by `env(safe-area-inset-top)`.
- A sticky header and a fixed-height phone menu (`100dvh` minus the header) keep
  navigation reachable and scrollable while the page behind it is frozen.
- The menu surface is opaque in both themes and animates on mount instead of
  keeping `will-change`/`backface-visibility` alive, which is what used to make
  Safari paint menu rows outside their own panel.

## Background refresh and alerts

Ledgerly can keep crypto prices fresh on its own, notify you when a holding
moves beyond a threshold, and send a scheduled summary of your **whole
portfolio** in money and percent. Alerts are delivered over **Web Push** (to a
browser or an installed web clip) and/or **Telegram**.

### What refreshes, and when

| Trigger | When it runs | Sends alerts |
| --- | --- | --- |
| **Refresh prices** button (`/prices`) | You click it | No |
| Open app tab | Every 5–120 minutes while a tab is visible (default 15) | Yes |
| `GET /api/cron/refresh-prices` | Your scheduler | Yes |
| `GET /api/cron/daily-snapshot` | Existing daily schedules / Vercel Cron | Yes |

- Each automatic run compares every stock and crypto holding over the configured
  **window**: **day** (the latest price snapshot before today, i.e. yesterday’s
  close) or **month** (the latest snapshot at least 30 days back). Holdings
  without enough history — including new buys — are compared with the price they
  had at the previous refresh, and a month rule with less than 30 days of history
  says so in the message (“the earliest recorded price (12 days ago)”).
- An alert fires when the move over that window is at least the configured
  threshold (default **±5 %**). Cash is never alerted.
- Alerts are deduplicated per asset, window, direction, day, and 5-point severity
  band (`price:2:2026-10-22:day:up:2`), so a 15-minute schedule sends one message
  when a coin jumps 6 % and a second only if it escalates past 10 %. Day and
  month rules keep separate histories and never suppress each other.
- If every price provider fails, one **“Price refresh failed”** alert is sent per
  day instead of silently keeping stale prices.
- The server decides whether a refresh is due (`refresh.intervalMinutes`), so
  many open tabs cannot multiply API calls or alerts.

### Portfolio update at a set time

Separate from per-holding thresholds, one message reports the whole portfolio’s
change in money **and** percent:

```text
Portfolio ▲ +2.35% (+$1,222.00)
Your portfolio moved from $52,000.00 to $53,222.00 since yesterday’s close: +$1,222.00 (+2.35%).
```

- Pick **how often** (daily, weekly and/or monthly — each one has its own
  switch), a **time of day** and a **time zone** on `/alerts`. All ticked
  cadences share that time; your device’s zone is selected by default.
- Every recap sends **once per period**, whatever runs the refresh: the dedupe
  keys are `portfolio:day:2026-10-22`, `portfolio:week:2026-10-22` (the scheduled
  weekday) and `portfolio:month:2026-10`, so a cron job and an open tab cannot
  double-send, and a weekly recap landing on the same day as the daily one still
  goes out. Changing the weekday or the day of the month re-arms that period.
- **The update belongs to its own day.** It is sent on the first refresh at or
  after the chosen time, and never before it: enabling an 18:00 update at 10:00
  stays quiet until 18:00, and the previous day’s update is never delivered the
  next morning. A later refresh the same day still sends it (a 22:00-only
  scheduler delivers the 18:00 update); a day with no refresh at all is skipped
  rather than sent stale.
- **The threshold is optional — the time is the point.** Leave *Only if it moves
  (%)* blank and the update arrives every day at that time, even when nothing
  moved (`Portfolio ▬ 0.00% ($0.00)`). Enter e.g. `2` to skip days with a
  smaller move.
- **“Also send when nothing changed (0.00 %)”** keeps the flat days even with a
  threshold set: the daily total still arrives when the portfolio did not move,
  while moves that are merely smaller than the threshold stay skipped. It is
  off by default, and it is unnecessary when the threshold is blank (that
  already sends everything). Stored as `alerts.portfolio.sendUnchanged`.
- **Each cadence compares with its own horizon:** daily vs yesterday’s total,
  weekly vs the total 7 days ago, monthly vs ~30 days ago. The baseline is the
  newest daily snapshot before that cutoff. Until one exists, the previous
  refresh total is used and labelled “the last refresh”; with no history at all,
  no message is invented. The weekly picker offers every weekday; the monthly
  one accepts the 1st–28th, so every month actually has that day (the 31st would
  skip February).
- The portfolio switch is **independent of Automatic price alerts** — you can
  keep the timed update while per-holding threshold alerts are off.
- Deposits, withdrawals and new buys move the total, so they count as part of the
  change. The message tells you how much the total moved, not why.
- **Send portfolio update now** on `/alerts` previews today’s message without
  waiting for the clock. The preview uses the comparison window and channels
  currently shown on the form, so it reflects unsaved changes; it ignores the
  optional threshold and works whether or not the schedule is switched on. On a
  portfolio with no earlier snapshot it still sends — the message compares
  against the newest snapshot (0.00 %) and says so, instead of refusing with
  “not enough history”.
- The same optional threshold applies to every cadence, and *Preview recap* on the
  form chooses which of the three messages the preview shows.
- **The Telegram copy can be reworded.** On `/alerts`, *Portfolio update → Custom
  Telegram message* replaces the standard two lines with your own text and
  placeholders, and *Extra note* appends one more line. Browser push always keeps
  the structured title/body, so the notification itself never changes.
- Test and preview results name only the channels that were used, e.g.
  `Preview sent — “Portfolio ▲ +2.94% (+$1,000.00)” · 1 browser notified.` A
  Telegram-only setup is never told “no browser subscribed”.

### Custom Telegram message for the portfolio update

The scheduled portfolio recap is the one message people forward to a chat or pin
in a group. On `/alerts`, under **Portfolio update**, the *Custom Telegram message*
box replaces the standard wording; leave it blank to keep the default.

```text
📊 2026-10-22 · 1 day
Portfolio ▲ +2.35% (+$1,222.00)
Now $53,222.00 (+2.35% from $52,000.00)

— sent from Ledgerly
```

That preview is produced by

```text
📊 {date} · {window}
{title}
Now {total} ({percent} from {from})
```

plus the note `— sent from Ledgerly`. The panel under the box is a live preview
of **your own** next message: the real totals, window and date are computed on
the server and every placeholder is filled in, so it matches what Telegram
receives and follows your edits (and the *Preview recap* picker) as you type. A
portfolio with nothing in it yet falls back to a clearly-labelled sample. The
buttons above the box insert placeholders at the cursor.

| Placeholder | Becomes |
| --- | --- |
| `{total}` | Portfolio value now — `$53,222.00` |
| `{percent}` | Signed change (capped at `±100%`) — `+2.35%` |
| `{gain}` | Gain in `%` up to `100%`, switching to `% (x)` above `100%` — `+150.00% (2.50x)` |
| `{x}` | Value multiple (`to ÷ from`) — `2.50x` |
| `{amount}` | Signed money change — `+$1,222.00` |
| `{from}` | Value it moved from — `$52,000.00` |
| `{arrow}` | `▲`, `▼`, or `▬` |
| `{direction}` | `up`, `down`, or `flat` |
| `{baseline}` | What it is compared with — `yesterday's close` |
| `{window}` | `1 day`, `7 days` or `30 days` — the cadence's horizon |
| `{date}` | Send date in the chosen zone — `2026-10-22` |
| `{time}` | Scheduled time — `18:00` |
| `{title}` | Standard title line |
| `{body}` | Standard body line |

- Placeholders are case- and space-insensitive (`{PERCENT}` works). Plain braces
  such as `{}` or `{2fa}` are left alone.
- **A typo is reported, never silently dropped.** Saving with `{btc}` shows
  “Saved, but {btc} is not a placeholder and will be sent literally.” The token
  is sent as typed, so nothing disappears from your message.
- **The note** is appended as the last line after a blank line, with or without a
  template.
- **Auto note** (ticked by default) adds one short quote or reminder to every
  recap, so the message reads differently each time without anyone writing it.
  It is generated **locally** — no API key, no network call, no cost — from a
  built-in list of short original lines, and it advances one step on **every
  delivered send** (`alerts.portfolio.autoNoteStep`) as well as each period, so
  consecutive sends never repeat the previous line, even within the same day.
  You can also click **↻ Change** in the settings panel to cycle the previewed
  line on the spot, and changing the scheduled alarm time clears the current
  dedupe lock so the rescheduled alarm can fire again the same day with a fresh
  line. It follows your own note when both are set. Stored as
  `alerts.portfolio.autoNote`.
- Limits: the message is capped at 1,000 characters and the note at 500. A
  rendered message longer than Telegram’s 4,096-character limit is cut with an
  ellipsis instead of failing to send.
- **Telegram only.** Web Push keeps the structured title and body (that is what
  the notification shade and the web clip display), and the alert log on
  `/alerts` keeps showing the standard text.
- **Send portfolio update now** uses the wording currently in the form — even
  before saving — and prints the exact Telegram text under the result, so a
  message can be checked without touching the schedule.
- Wording lives in `app_settings` (`alerts.portfolio.telegramTemplate`,
  `alerts.portfolio.telegramNote`) and is included in exports/imports.

### Set up Web Push (browser / web clip)

1. Open **Alerts** in the navigation (`/alerts`).
2. Click **Enable browser alerts** and allow notifications.
3. Click **Send test notification**.

- Works in Chrome, Edge, Firefox, and Safari 16.4+.
- **iOS/iPadOS:** Web Push is only available to web apps added to the Home
  Screen. In Safari use Share → **Add to Home Screen**, then open Ledgerly from
  the icon and enable alerts there. The page shows this hint automatically on
  iPhone/iPad.
- Android Chrome can also install the app from the menu.
- Subscriptions are stored in `push_subscriptions`. Endpoints that return `404`
  or `410` are deleted automatically, so reinstalling a browser self-heals.

**VAPID keys:** set `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` to use your own pair,
or leave both unset — a pair is generated once on first use and stored in
`app_settings`. Changing or clearing the database therefore requires re-enabling
alerts in each browser. `VAPID_SUBJECT` should be a `mailto:` or `https:` contact.

### Set up Telegram (no restart needed)

1. Create a bot: message [@BotFather](https://t.me/BotFather), send `/newbot`,
   copy the token.
2. Send your bot any message (a bot cannot start a chat with you).
3. Open **Alerts** → **Telegram bot**, paste the token and click **Connect bot**.

The chat id is filled in for you from the most recent message to the bot, so
tools like @userinfobot are optional. If you prefer to be explicit, paste a
numeric user id (`123456789`), a group id (`-1001234567890`) or `@channelname`
and that is used instead. Click **Send test message** to confirm delivery.

- The token is verified with Telegram's `getMe` before it is stored, so a typo is
  rejected immediately with a clear message rather than failing silently later.
- Credentials live in `app_settings` (`telegram.botToken`, `telegram.chatId`,
  `telegram.botUsername`). They are never sent to the browser — the page only
  shows a masked hint such as `123456789:••••Dsaw`.
- If the server cannot reach `api.telegram.org` while saving, the credentials are
  kept and the page warns you; send a test message once the network is back.
- **Disconnect** removes the bot added in the app. Environment variables still
  work exactly as before and are used whenever no bot is stored:

  ```bash
  TELEGRAM_BOT_TOKEN=123456789:AA…your-token…
  TELEGRAM_CHAT_ID=123456789          # or -100… for a group, or @channel
  ```

Messages are plain text through the Telegram Bot API (no HTML/Markdown to
escape). Failures are reported on the page — an invalid token says so, a wrong
chat id tells you to start the chat first, and rate limits are retried on the
next scheduled run. The token is never returned by an API or written to the
alert log.

### Settings

Configure on `/alerts`; values live in the `app_settings` table.

| Setting | Default | Range |
| --- | --- | --- |
| Automatic price alerts (holdings) | on | on/off (manual tests still work when off) |
| Holding threshold | 5 % | 0.5 – 50 % |
| Holding comparison window | day | day (vs yesterday’s close) or month (vs 30 days ago) |
| Portfolio update | off | on/off — sends one message per day at the chosen time |
| Portfolio time | 18:00 | any time of day, read in the chosen time zone |
| Portfolio time zone | device zone | any IANA zone (e.g. `Asia/Phnom_Penh`) |
| Portfolio threshold | blank (always send) | blank, or 0.5 – 50 % |
| Portfolio comparison window | day | day (vs yesterday’s total) or month (vs 30 days ago) |
| Portfolio Telegram message | blank (standard text) | up to 1,000 characters, placeholders like `{total}` |
| Portfolio Telegram note | blank | up to 500 characters, appended as the last line |
| Channels | push + telegram | any combination (used by both alert types) |
| Background refresh | 15 min | off, or 5 – 720 min |

Turning on a channel without configuring it is harmless: push with no
subscriptions and Telegram without credentials simply deliver nothing, and the
page shows each channel’s status.

### Scheduling options

**Host cron / systemd timer** — see
[self-hosting step 7](#7-refresh-prices-in-the-background).

**GitHub Actions** — `.github/workflows/refresh-prices.yml` runs every 15 minutes
once you set the repository variable `APP_URL` (e.g. `https://ledgerly.example.com`)
and the secret `CRON_SECRET`. Scheduled workflows only run from the default
branch.

**Vercel Cron** — add the route to `vercel.json`:

```json
{ "crons": [{ "path": "/api/cron/refresh-prices", "schedule": "*/15 * * * *" }] }
```

Hobby plans allow daily crons only; the bundled `/api/cron/daily-snapshot` entry
already sends alerts once a day. Because the portfolio update only fires at or
after the time you chose, a once-a-day cron must run at (or after) that time —
a daily 00:00 UTC run cannot deliver an 18:00 Phnom Penh update. Schedule
`/api/cron/refresh-prices` a few times a day (GitHub Actions or a Pro plan) for a
precise local time; minute-level schedules need Pro. The same rule covers the
weekly and monthly recaps: they need one refresh on their own day, and a day
with no run at all is skipped rather than delivered late with stale numbers.

**While someone is browsing** — no scheduler is needed as long as a tab is open;
the page triggers a throttled refresh on the interval above.

### Security and limits

- `/alerts` and its endpoints are **unauthenticated**, like the rest of Ledgerly.
  Anyone who can reach the app can enable alerts on their own browser, change the
  threshold, and send test messages (throttled to one test per 15 seconds).
  Restrict access to the deployment as described in the
  [security checklist](#self-hosting-security-checklist).
- Subscription and unsubscribe calls must be same-origin; payloads are size- and
  format-checked before they are stored.
- Push payloads contain the asset name, the price move, and an app link — never
  quantities, balances, or notes.
- The alert log (`alert_events`) is pruned after 90 days by scheduled runs.
- Web Push requires HTTPS in production (localhost is exempt in most browsers).

## Run locally

```bash
npm ci
cp .env.example .env.local   # edit DATABASE_URL to point at your Postgres
npm run dev                  # http://localhost:3000
```

The tables are created automatically the first time you open the dashboard
(`ensureSchema()` in `src/lib/portfolio.ts` is a safety net for fresh databases).
You can also create them ahead of time:

```bash
# drizzle-kit reads the shell environment and `.env`, not `.env.local`
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/app_db" npm run db:push
```

Check the database connection at `GET /api/health` → `{ "ok": true }`.

Requirements: Node.js 20.9 or newer (`.nvmrc` pins 22) and PostgreSQL 13+.

## Self-host on your own server

The app is a normal long-running Next.js server with one PostgreSQL database.
Nothing about it requires Vercel.

### Requirements

- Node.js 20.9+ and npm (or pnpm/yarn if you adjust the commands).
- PostgreSQL 13+ — on the same host, on your LAN, or managed.
- A domain and HTTPS if the instance is reachable by anyone else — the guided
  setup submits database credentials, and export/import moves portfolio data.

### 1. Get the code

```bash
git clone <your-fork-url> /srv/ledgerly
cd /srv/ledgerly
npm ci
```

### 2. Configure environment variables

```bash
cp .env.example .env.local
chmod 600 .env.local
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes at runtime | PostgreSQL connection string. `POSTGRES_URL` is accepted as a fallback. |
| `POSTGRES_URL` | No | Alternative name, used when `DATABASE_URL` is unset. |
| `DATABASE_SETUP_TOKEN` | No | Enables the web setup wizard and protects `/api/database`, export, and import. Must be at least 32 characters. |
| `ALLOW_DATABASE_SETUP_WRITE` | No | Set to `true` on a persistent self-hosted server to let the wizard write `.env.local`. Always disabled on Vercel. |
| `CRON_SECRET` | Recommended | Shared secret for `/api/cron/refresh-prices` and `/api/cron/daily-snapshot`, sent as `Authorization: Bearer …`. Without it the endpoints are unauthenticated (throttled per instance). |
| `TELEGRAM_BOT_TOKEN` | No | Telegram bot token from [@BotFather](https://t.me/BotFather). Optional — you can connect a bot on `/alerts` instead, which takes precedence. |
| `TELEGRAM_CHAT_ID` | No | Chat, group, or `@channel` id that receives alerts. Optional when the bot is connected from `/alerts`. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | No | Web Push key pair. When unset, a pair is generated once and stored in `app_settings`. |
| `VAPID_SUBJECT` | No | Contact for push services, `mailto:` or `https:` (default `mailto:ledgerly@localhost`). |

Generate secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Notes:

- Next.js loads `.env.local` for the running app. `drizzle-kit` (used by
  `db:push` / `db:migrate`) loads `.env` via `dotenv`, so pass `DATABASE_URL`
  inline or export it for those commands.
- Never commit `.env.local`; it is git-ignored. Restrict it to the service user.
- Remote PostgreSQL connections verify TLS certificates. For a self-signed or
  private-CA server, point `NODE_EXTRA_CA_CERTS` at the CA bundle instead of
  disabling verification. Certificate-file URL parameters are rejected.

### 3. Create the tables

Either let the app create them on first dashboard load, or run:

```bash
DATABASE_URL="postgresql://user:password@host:5432/ledgerly" npm run db:push
```

For versioned schema changes, generate and apply SQL migrations instead:

```bash
DATABASE_URL="…" npm run db:generate   # writes ./drizzle/*.sql — commit these
DATABASE_URL="…" npm run db:migrate
```

Use a dedicated database and database user for Ledgerly. The user needs
`USAGE` and `CREATE` on the public schema.

### 4. Build and start

```bash
npm run build
npm run start -- -H 127.0.0.1 -p 3000
```

`npm run start` runs the production build. Binding to `127.0.0.1` keeps the app
off the network; put a reverse proxy in front of it. Next.js also honors the
`PORT` environment variable when `-p` is omitted.

### 5. Put it behind HTTPS

The web setup endpoint rejects cross-origin requests by comparing the
`Origin` host with `Host` / `X-Forwarded-Host`, so preserve the original host and
forward `X-Forwarded-Proto`. Do not rewrite `Host` to `localhost`.

Caddy (automatic TLS):

```caddyfile
ledger.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
```

Nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name ledger.example.com;
    # ssl_certificate / ssl_certificate_key …

    client_max_body_size 12m;   # backup import limit is 10 MB

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### 6. Keep it running

A minimal systemd unit (`/etc/systemd/system/ledgerly.service`):

```ini
[Unit]
Description=Ledgerly portfolio manager
After=network.target postgresql.service

[Service]
Type=simple
User=ledgerly
WorkingDirectory=/srv/ledgerly
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run start -- -H 127.0.0.1 -p 3000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ledgerly
```

Adjust `User`, paths, and the npm path for your host. Journald keeps the logs:
`journalctl -u ledgerly -f`.

### 7. Refresh prices in the background

The dashboard captures today’s snapshot when it is opened, and the app refreshes
prices while a tab is open (see
[background refresh and alerts](#background-refresh-and-alerts)). For unattended
instances, call the scheduled endpoint from the host.

```bash
# /usr/local/bin/ledgerly-refresh  (chmod 700)
#!/usr/bin/env sh
set -eu
. /etc/ledgerly/cron.env        # CRON_SECRET=…
curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
  http://127.0.0.1:3000/api/cron/refresh-prices
```

```cron
*/15 * * * * /usr/local/bin/ledgerly-refresh
```

Every run refreshes live crypto and stock prices, records the daily snapshot, and sends
Web Push / Telegram alerts for moves beyond the threshold — and, at the time you
picked, the portfolio update. The daily `/api/cron/daily-snapshot` endpoint
remains for existing schedules and does the same thing.

The response is a summary such as
`{ "ok": true, "refreshedCrypto": 3, "priceMoves": 1, "alertsSent": 1 }`.
Alerts are deduplicated per asset, direction, and day, so a 15-minute schedule
does not repeat messages. If `CRON_SECRET` is unset, the endpoints are open and
throttled to one run per minute per app instance; set the secret on any instance
that reaches the internet.

A systemd timer works too:

```ini
# /etc/systemd/system/ledgerly-refresh.timer
[Unit]
Description=Refresh Ledgerly prices every 15 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=15min
Unit=ledgerly-refresh.service

[Install]
WantedBy=timers.target
```

```ini
# /etc/systemd/system/ledgerly-refresh.service
[Unit]
Description=Ledgerly price refresh

[Service]
Type=oneshot
ExecStart=/usr/local/bin/ledgerly-refresh
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ledgerly-refresh.timer
```

### 8. Update

```bash
cd /srv/ledgerly
git pull
npm ci
DATABASE_URL="…" npm run db:push   # only when the schema changed
npm run build
sudo systemctl restart ledgerly
```

Optional checks before restarting: `npm run typecheck`, `npm test`, `npm run lint`.

### 9. Back up

Two independent options:

- **In the app:** Database → **Export database** writes a portable JSON backup
  (all assets, transactions, and snapshots). Import accepts files up to 10 MB
  in merge or replace mode; validation is all-or-nothing in one transaction.
- **PostgreSQL level:**

  ```bash
  pg_dump "$DATABASE_URL" -Fc -f "ledgerly-$(date +%F).dump"
  pg_restore --clean --if-exists -d "$DATABASE_URL" ledgerly-YYYY-MM-DD.dump
  ```

Backups contain your full portfolio; store and transfer them accordingly. Keep
`.env.local` (or your environment configuration) in your own secret store — it
is not part of the database.

### Self-hosting security checklist

- **Ledgerly has no login.** Anyone who can reach it can read and change the
  entire portfolio. Keep it on a private network/VPN (e.g. Tailscale), or put
  basic authentication at the reverse proxy. Do not expose it to the open
  internet unauthenticated.
- There is **one shared dataset** for everyone using the instance; there are no
  user accounts or data isolation.
- Set `DATABASE_SETUP_TOKEN` to a random secret of at least 32 characters before
  starting if you want the web setup wizard; the same key protects export and
  import. **The setup key is not an app login.** If you remove it after setup,
  the wizard is disabled and export/import become unauthenticated — so keep the
  instance private either way.
- Enable `.env.local` writing only on a persistent server
  (`ALLOW_DATABASE_SETUP_WRITE=true`). It is always disabled on Vercel.
- Use a dedicated PostgreSQL database and least-privilege user; do not reuse a
  database that belongs to another app.
- Terminate TLS in front of the app. For remote databases, keep certificate
  verification on and install the CA via `NODE_EXTRA_CA_CERTS` if needed.
- Keep `.env.local` at mode `0600` and out of version control. Never prefix
  secrets with `NEXT_PUBLIC_`.
- File-based database setup applies to one server process. Other replicas must
  be restarted with the same configuration; for replicated deployments, manage
  environment variables centrally and disable web setup.
- Per-instance throttling on the setup API is not a distributed rate limiter.
  Use hosting-level protection if the instance is public.
- Alert settings and test sends are open to anyone who can reach the app. Keep
  `TELEGRAM_BOT_TOKEN` in the environment only, restrict who can reach `/alerts`,
  and remember that auto-generated VAPID keys live in the database (a database
  dump lets someone impersonate your push sender, so treat backups as secrets).

## Connect a database from the web UI

Open **Database** in the navigation (or `/database`). If no connection is
configured, the dashboard shows this same wizard.

1. Answer questions about hosting, budget, usage, and desired features. Optional
   notes become a checklist for you to verify with the provider; they are not
   automatically analyzed or sent to any external service.
2. Compare PostgreSQL, MySQL, SQLite, and MongoDB. **Only PostgreSQL is currently
   supported** by Ledgerly’s Drizzle schema. The other types are informational,
   not working database adapters.
3. Choose Neon, Supabase, or an existing PostgreSQL server. Recommendations are
   deterministic guidance, not provisioning or a guarantee about provider prices.
4. Set `DATABASE_SETUP_TOKEN` on the server to a strong random secret of at least
   32 characters, then restart/redeploy. Generate one with:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
   For local development, put it in `.env.local`; on Vercel, use a private
   environment variable. Never use a `NEXT_PUBLIC_` prefix.
5. Enter that administrator key and the PostgreSQL connection string in the
   connection form. **Test connection** checks connectivity and `USAGE` / `CREATE`
   permissions on the public schema without writing portfolio data. It does not
   verify compatibility of pre-existing tables. Use a dedicated database.
6. In local development, or on a self-hosted server with
   `ALLOW_DATABASE_SETUP_WRITE=true`, confirm the app-wide change and click
   **Save & connect**. This writes a mode-0600 `.env.local` file atomically,
   preserves unrelated assignments, and updates the running connection. Existing
   data is not migrated or deleted. Open the dashboard to create the tables.

File saving is disabled in production unless a persistent self-hosted server
explicitly sets `ALLOW_DATABASE_SETUP_WRITE=true`. It is **always disabled on
Vercel** because function filesystems are ephemeral. On Vercel, you can test
through the UI, then set the verified URL as `DATABASE_URL` in Project →
Settings → Environment Variables and redeploy. The wizard explains these steps;
it does not claim to save a temporary in-memory connection or provision a service.
Environment-variable configuration without the wizard remains supported.

### Setup security and limitations

- The setup key protects both test and save operations. Keep it private; disable
  web setup by removing it and restarting/redeploying once setup is complete.
- Requests must be same-origin. Testing is administrator-only because it makes
  outbound database connections. Only give the key to trusted administrators.
  Per-instance throttling is not a distributed rate limiter; use hosting-level
  protection for public deployments.
- Connection strings and keys are never returned by the API or saved to browser
  storage. Use HTTPS for hosted deployments. URL visibility is off by default.
- Remote connections verify TLS certificates. Self-signed/private-CA servers need
  a trusted CA configured on the app server (e.g. `NODE_EXTRA_CA_CERTS`), not a
  disabled certificate check. URL certificate-file parameters are rejected.
- Saving switches the database for the entire app. This is not per-user database
  selection, and Ledgerly does not yet implement user authentication/data isolation.
  Restrict access to your deployment before storing sensitive portfolio data.
- Self-hosted file saving applies to one server/process; restart other replicas
  with the same configuration. Prefer centrally managed environment variables
  for replicated production deployments.

## Export and import the database

Open **Database** → **Export & import database** (below the setup wizard):

- **Export database** downloads one portable JSON file
  (`ledgerly-backup-YYYY-MM-DD.json`, format version 1) containing every
  asset, transaction, and snapshot in the currently connected PostgreSQL
  database. It is plain JSON — store it, diff it, or move your portfolio
  between providers (e.g. Neon → Supabase) without depending on `pg_dump`
  or a specific PostgreSQL version.
- **Import database** accepts such a backup (up to 10 MB) in two modes:
  - **Merge** keeps existing data and inserts the backup with fresh asset
    ids (transactions are remapped; snapshots for dates already present
    are overwritten).
  - **Replace** deletes all current data and restores the backup exactly,
    including ids. It requires an explicit confirmation checkbox and a
    final browser confirmation — export a backup first.
- Imports are strictly validated before anything is written: unknown
  formats/versions, duplicate or dangling ids, invalid kinds/dates/numbers,
  and transaction histories that oversell an asset are rejected, and derived
  balances (quantity / average cost / realized PnL) are recomputed from the
  transactions rather than trusted from the file. The whole import runs in
  a single transaction, so a failed import leaves the database unchanged.
- If `DATABASE_SETUP_TOKEN` is set on the server, the same administrator
  key is required for export and import; otherwise (like the rest of this
  unauthenticated app) they are open — restrict access to your deployment
  before storing sensitive data, and treat backup files as sensitive too.
- Exchange sync baselines (`exchange_balances`) are exported and restored with
  everything else, so a restored database does not import every balance again on
  the next sync. **API keys are never written to a backup** — reconnect the
  exchanges afterwards.
- Backups contain no currency metadata: they are USD ledgers (see
  [Supported currencies](#supported-currencies)).

## Deploy on Vercel (optional)

The repo is also Vercel-ready (`vercel.json`, Node ≥ 20.9 — see `.nvmrc` /
`package.json` engines, functions pinned to `sin1` Singapore). Self-hosting does
not need any of this; use it only if you prefer managed hosting.

### 1. Create a hosted Postgres (required)

Vercel functions are serverless and cannot reach `localhost`. Use a managed
Postgres with a **pooled** connection string:

- **Neon** (recommended): [console.neon.tech](https://console.neon.tech) →
  create project → copy the *Pooled connection* string. Or in Vercel:
  your project → **Storage → Create Database → Neon Postgres**, which
  provisions `DATABASE_URL` / `POSTGRES_URL` automatically.
- **Supabase**: Settings → Database → *Connection pooling* string (port 6543).

### 2. Import the repo

[Vercel Dashboard](https://vercel.com/new) → **Import** this GitHub repo.
Framework preset **Next.js** is auto-detected; keep the defaults
(build `next build`, root `./`).

### 3. Set the environment variable

Project → **Settings → Environment Variables** (Production + Preview):

| Name           | Value                                  |
| -------------- | -------------------------------------- |
| `DATABASE_URL` | pooled Postgres connection string (step 1) |

`POSTGRES_URL` is also accepted (the Neon/Vercel integration sets both).
No env vars are needed for the build itself — the app only connects to the
database at request time.

> ⚠️ Never commit a real connection string. `.env*` is git-ignored; only
> `.env.example` (with a placeholder) is tracked.

### 4. Create the tables (once, against the production DB)

```bash
# from your machine, using the same production connection string:
DATABASE_URL="postgresql://…pooled…" npm run db:push
```

Or generate SQL migrations and commit them instead:

```bash
npm run db:generate   # writes ./drizzle/*.sql
npm run db:migrate    # applies them to DATABASE_URL
```

### 5. Deploy

Push to `main` (production) or open a PR (preview deployment — give Preview
its own branch database / `DATABASE_URL`, e.g. a Neon branch, so previews
don't write to production data). `vercel.json` schedules the daily snapshot
cron; add `/api/cron/refresh-prices` there (Pro, minute-level) or use the
bundled GitHub Actions workflow for more frequent refreshes. Verify after deploy:

```
https://<your-app>.vercel.app/api/health   →  { "ok": true }
```

### Deploy with the CLI instead

```bash
npm i -g vercel
vercel link
vercel env add DATABASE_URL production   # paste the pooled connection string
vercel --prod
```

## Scripts

| Script              | Purpose                                |
| ------------------- | -------------------------------------- |
| `npm run dev`       | Dev server                             |
| `npm run build`     | Production build (`next build`)        |
| `npm run start`     | Run the production build               |
| `npm run lint`      | ESLint                                 |
| `npm run typecheck` | `tsc --noEmit`                         |
| `npm test` | Database recommendations, URL validation, protected setup API tests (mocked PostgreSQL), backup format validation, crypto-search fallback, dashboard layout helpers, and alert rules/Telegram bot tests (token + chat validation, chat detection, mocked API calls) |
| `npm run db:push`   | Push schema to `DATABASE_URL`          |
| `npm run db:generate` / `db:migrate` | Generate / apply SQL migrations |
| `npm run db:studio` | Drizzle Studio                         |

## Runtime notes

- `src/db/index.ts` creates the `pg` pool lazily (first query, not import),
  reuses it across warm invocations / HMR via `globalThis`, caps it at 10
  connections (1 on Vercel), and enables TLS automatically for remote databases
  with certificate verification. Use a pooled endpoint for serverless hosting.
- `ensureSchema()` creates missing tables on first use, so a fresh database works
  without a manual migration step. Committed SQL migrations remain the
  recommended way to evolve an existing production database.
- All pages render dynamically (`force-dynamic`) since holdings change on
  every write.
- Currency formatting lives in `src/lib/format.ts` and is USD-only by design; all
  monetary fields in PostgreSQL are plain `double precision` amounts.
- Web Push uses the `web-push` library with VAPID keys from the environment or
  `app_settings`. `public/sw.js` is a minimal service worker that renders push
  payloads and focuses the matching page when a notification is clicked. It is
  registered by the alerts page, so notifications arrive even when the tab is
  backgrounded (a fully closed browser still depends on the browser/OS push
  service, which is outside the app’s control).

### Stock prices (Yahoo Finance)

Stocks and ETFs are priced through Yahoo Finance's public chart endpoint
(`/v8/finance/chart/<symbol>`). Like the crypto providers, it needs no API key
and no account.

- **Symbols are Yahoo's**: `AAPL`, `MSFT`, `VOO`, `BRK-B` (class shares),
  `7203.T` (Tokyo), `VOD.L` (London), `^GSPC` (indices). A dotted class share
  such as `BRK.B` is retried with a dash automatically, because Tokyo-style
  dotted suffixes must keep their dot.
- **Everything is stored in USD.** Yahoo reports the listing currency, so a
  London quote in pence (`GBp`) is divided by 100 and converted with Yahoo's
  `GBPUSD=X` rate; `ZAc` and `ILA` are handled the same way. If no FX rate can be
  fetched the quote is rejected with a clear message instead of storing a number
  that is wrong by 100×.
- **Which price**: `meta.regularMarketPrice`, falling back to the last close
  when a symbol has not traded that session. Quotes are delayed market data, not
  a real-time feed.
- **Politeness**: requests are serialised with a small gap and retried once on
  the second Yahoo host, so a portfolio of 30 holdings does not trip the rate
  limit. A `429` from Yahoo is reported ("try again in a minute") and the holding
  keeps its previous price until the next refresh.
- **Both refresh paths use it**: the one-click **Fetch live prices** button on
  `/prices` (crypto from your chosen exchange, stocks from Yahoo in the same
  click) and the scheduled/background refresh, which stores the daily price
  snapshot so stock price history and alerts work exactly like crypto.

> Yahoo's endpoint is unofficial and can change or rate-limit without notice.
> Failures never corrupt prices: the previous value is kept and the refresh
> summary reports how many holdings could not be priced.

### Import balances from Binance, OKX or Bybit

**Exchanges** in the header menu imports what you actually hold on an exchange,
instead of typing quantities by hand.

1. On the exchange, create an API key with **read-only** permission (no spot
   trading, no withdrawals, no transfers). An IP allowlist is worth setting.
2. Open **Exchanges**, paste the key and secret into that exchange's card and
   press **Connect & import**. OKX also asks for the passphrase you set on the
   key; Bybit asks which account type to read (`UNIFIED`, `SPOT` or `CONTRACT`).
3. The key is verified **before** it is saved — a wrong key shows the exchange's
   own complaint and stores nothing. A successful check is also the first
   import, so connecting costs one API call.

What a sync does:

- Each currency with a balance becomes a **crypto holding**. Unknown coins are
  created automatically, pinned to that exchange for pricing, and named by their
  ticker.
- Quantities are booked as **deposit / withdraw transactions**, not by
  overwriting the holding. So manual trades keep their cost basis, Activity
  shows exactly what the import did, and P/L still comes from the transaction
  history. Units removed from an exchange are booked at cost, so moving coins out
  does not invent realized profit.
- `exchange_balances` stores the last figure per exchange and asset. A re-sync
  books the **difference**, which is what makes repeated syncs safe. The same
  coin on two exchanges adds up (Binance 0.75 + OKX 0.3 = 1.05 BTC), and syncing
  one venue never touches the other's figures.
- A coin that disappears from an exchange (or drops to zero) is removed from the
  portfolio once, then the baseline is deleted, so a later re-deposit imports
  cleanly.
- **Sync all exchanges** runs every connected key; one failing key does not stop
  the others. Prices still come from the normal price refresh — a freshly
  imported coin without a quote is reported as a warning and valued at the next
  **Refresh prices**.

Keys and privacy:

- Keys are encrypted with **AES-256-GCM** (`src/lib/exchange-credentials.ts`)
  and never leave the server. The browser only receives a mask such as
  `••••••••7F3A`; no action returns the secret or the key.
- Set `EXCHANGE_CREDENTIALS_KEY` in production (see `.env.example`). Without it
  the encryption key is generated and stored in `app_settings`, so a database
  dump alone would be enough to decrypt the saved keys. Rotating or clearing the
  variable disconnects every exchange; holdings are kept.
- **Disconnect** deletes the key. Imported holdings stay in the portfolio as
  normal assets — delete or adjust them like any other holding.
- Only balance endpoints are called:

  | Exchange | Endpoint | Signature |
  | --- | --- | --- |
  | Binance | `GET /api/v3/account` | HMAC-SHA256 hex of `timestamp&recvWindow`, sent as `signature` |
  | OKX | `GET /api/v5/account/balance` | base64 HMAC-SHA256 of `timestamp + GET + path` |
  | Bybit | `GET /v5/account/wallet-balance?accountType=…` | HMAC-SHA256 hex of `timestamp + apiKey + recvWindow + query` |

- Scope: Binance **spot** balances (`free` + `locked`), OKX **trading account
  equity**, Bybit **wallet balance**. Staking/Earn positions, funding wallets,
  futures positions, and sub-accounts are not included; balances under `1e-10`
  are ignored as dust. Tokens whose name looks like airdrop bait (a website, promo
  wording, a fake ticker) are ignored as spam too.
- Errors are written for humans and never echo a key: rejected keys, missing
  read permission (Binance `-2015`, OKX `50113`, Bybit `10005`/`10010`), rate
  limits, and timeouts each get their own sentence.
- Backups include the per-exchange baselines but **never the API keys**. Restoring
  a backup therefore does not re-import every balance on the next sync.

### Adding a crypto asset from an exchange

**Add asset → Crypto → Price from** pins the holding to one exchange (Bybit,
OKX, Binance, Coinbase Exchange, or Kraken). **Fetch live price** calls the
exchange's public spot ticker and fills *Current price*; the choice is saved as
`assets.price_source` and reused by every later refresh, so the holding is not
silently priced from a different market.

- **Automatic** (the default, stored as an empty string) keeps the old
  behaviour: the fastest of the six public providers wins. Holdings created
  before this setting existed are automatic.
- A pinned exchange is asked **first and on its own**. If it does not list the
  pair — a long-tail token, a delisted pair, an outage — the remaining providers
  are raced in parallel, so a holding never goes stale just because the chosen
  exchange is missing it. The page shows which exchange is pinned
  (`Binance · updated Oct 23` on the asset page, and under each row on `/prices`).
- **Quote** is `USDT` or `USD`. Coinbase and Kraken always use USD pairs;
  Binance, OKX and Bybit map `USD` to their USDT market.
- **Change it later** with **Edit** on the asset page; `/prices` still has a
  page-level source selector, which is now the fallback for holdings without a
  pinned exchange.
- **Public APIs only** — the same endpoints as `/prices`, no keys or secrets.
  The dialogs call two routes:

  | Endpoint | Used by | Body / query |
  | --- | --- | --- |
  | `GET /api/prices/quote` | Add asset dialog (no asset id yet) | `?symbol=BTC&provider=binance&quote=USDT` → `{ symbol, provider, providerLabel, quote, price }` |
  | `POST /api/prices/live` | `/prices` bulk fetch | `{ provider, quote, assets: [{ id, symbol, type, provider? }] }` — a per-asset `provider` overrides the page default |

  Failures return a readable message (`No exchange returned a price for XYZ —
  Binance was tried first`) and never store a zero price.
- **Backups:** the field is part of the JSON export/import. Older backups without
  it import as automatic, and an unknown value in a hand-edited file is treated
  as automatic instead of failing the restore.

### Crypto search providers

`GET /api/prices/top` (used by **Add holding → Find any crypto asset**) never
relies on a single API. `src/lib/crypto-search.ts` tries providers in order and
uses the first one that answers:

| Request | Fallback chain |
| --- | --- |
| `?q=<name or symbol>` | CoinGecko → CoinPaprika → DexScreener |
| `?q=<token contract>` | DexScreener (contract lookup only) |
| no query (top assets) | CoinGecko → CoinPaprika → Binance (USDT markets by 24h volume) |

- HTTP `429` / `402` / `418` responses, timeouts, invalid JSON, and outages all
  advance to the next provider. A provider that reports a rate limit is skipped
  for 1–5 minutes (honouring `Retry-After`), then retried.
- Successful responses are cached in-process for 60 seconds (searches) or
  5 minutes (top assets), so repeated clicks do not burn free-tier quotas.
- The JSON response includes `source` (`coingecko`, `coinpaprika`,
  `dexscreener`, or `binance`); the dialog shows it under the results. If every
  provider is rate-limited the route returns `429`, otherwise `502`.
- Prices returned by every provider are USD; Binance quotes are `USDT`, treated
  as 1:1 with USD like the rest of the app.
- No API keys are used, so all providers are subject to their public rate
  limits. The cache is per server process — a multi-replica deployment makes its
  own requests per instance.
