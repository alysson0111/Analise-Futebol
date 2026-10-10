# Odds Kalshi

The server enriches analyzed TotalCorner games with public Kalshi quotes.
Scanners, scores and settlement rules remain unchanged. The price is the
selected contract side's current ask in dollars; decimal odds are 1 / ask,
before Kalshi fees. Zero, absent, closed or expired quotes are not displayed.

Matching requires exact normalized team names, the same scheduled date in the
event ticker, and the same market and line. No fuzzy team matching is used.
ML uses only the predicted side. Totals use YES for Over and NO for Under.
Corners require a single explicit signal line. Handicap supports equivalent
half-goal lines only; integer and quarter-goal lines have different settlement
rules and receive no Kalshi quote.

Default series cover Brasileiro A/B, Argentina Premier Division, EPL,
La Liga, Serie A/B, MLS, USL, Liga MX and EFL Championship. Availability varies.
Set KALSHI_SERIES_TICKERS on the server to override the comma-separated series
list. Only full-match GAME, TOTAL, SPREAD and CORNERS series are supported.
Use the official Kalshi series catalogue to identify valid tickers.

Requests have a 12-second overall timeout, six concurrent workers and up to
three 1000-market pages per series. Successful responses are cached for 30
seconds. Missing series or provider errors leave games available without odds.
New saved signals retain the quote source, ticker, side and fetch time.
Historical signals are not repriced.

Verification: node --test api/_lib/kalshiOdds.test.js
