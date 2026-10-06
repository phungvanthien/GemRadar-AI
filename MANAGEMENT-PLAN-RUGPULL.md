# Management Plan: Rugpull Response & Prevention

**Version:** 1.0  
**Last Updated:** 2026-10-05  
**Status:** Active

---

## 1. Overview

This document outlines the procedures for detecting, responding to, and preventing rugpull incidents in the AlphaHunter AI Trading Bot system.

### 1.1 What is a Rugpull?

A rugpull occurs when a token project deliberately makes the token unsellable, typically by:
- Removing all liquidity from the pool
- Minting unlimited additional supply (infinite mint)
- Freezing all holder tokens
- Other malicious actions that prevent exits

In the AlphaHunter system, a position is marked as "rugpull" when the exit engine confirms the token cannot be sold through multiple consecutive failed attempts.

### 1.2 System Architecture

```
Entry Gate (spam-filter + token-safety) → Position Entry
                                          ↓
                                   Exit Engine (trade-exit.ts)
                                          ↓
                                   Sell Attempts → Fill Ledger
                                          ↓
                                   Rugpull Detection (consecutiveSellFails)
                                          ↓
                                   Write-off (if threshold met)
```

---

## 2. Detection Mechanism

### 2.1 Consecutive Sell Failures

The system tracks consecutive failed sell attempts using `consecutiveSellFails()`:

```typescript
export const RUGPULL_WRITEOFF_FAILS = 3;
```

**Trigger:** 3 consecutive failed sell attempts that are genuine "can't sell" signals.

### 2.2 Error Classification

NOT all errors indicate a rugpull. The system must distinguish:

| Error Type | Examples | Is Rug Signal? | Action |
|------------|----------|----------------|--------|
| **Rug Signals** | `quote-no-route`, `price-impact`, `failed:onchain:*` | YES | Count toward threshold |
| **Infrastructure Failures** | `unknown:fetch failed`, `unknown:confirm-timeout`, `unknown:status-null` | NO | Ignore/run reset |
| **HTTP Transient** | `quote-http`, `swap-http` (5xx) | NO | Ignore/run reset |
| **Swap Errors** | `swap-no-tx`, `missing-signer` | NO | Ignore/run reset |

### 2.3 Feed Gap Detection

Jupiter Price API v3 may temporarily omit a mint's price while the token remains sellable. The system uses **sell quote probing** to distinguish:

1. Price missing from Price API v3
2. Attempt a live sell quote (`quotePriceUsd`)
3. If quote returns valid route → token still sellable (feed gap, NOT rug)
4. If quote returns no-route → true rug signal

---

## 3. Response Procedures

### 3.1 Immediate Actions (When Rugpull Detected)

1. **Verify the detection:**
   - Check the fill ledger for `errorCode` on the last 3+ fails
   - Confirm they are genuine rug signals (not infrastructure)
   - Check `lastSellAttempt()` is itself a rug signal

2. **On-chain verification (if possible):**
   ```bash
   # Check if tokens remain in wallet
   solana balance <wallet> --token <mint>
   ```

3. **Log the write-off:**
   - Record `closedReason: "rugpull"`
   - Book realized loss: `realizedPnlSol -= lostSol`
   - Mark position as `soldPct: 100`, `status: "closed"`

### 3.2 False Positive Recovery

**Problem:** Token still in wallet but marked as rugpull (false positive).

**Recovery Steps:**

1. **Identify affected positions:**
   - Query ledger for positions with `closedReason === "rugpull"`
   - Check `soldPct === 100`
   - Verify on-chain balance > 0

2. **Reconcile from chain:**
   - Call `reconcileFromChain()` with current on-chain balance
   - Adjust `soldPct` to reflect actual state
   - Reverse incorrectly booked losses if applicable

3. **UI indication:**
   - Display `closed (rugpull — incorrectly flagged)` for recovered positions
   - Show token still held in wallet

### 3.3 Manual Write-off

When automatic detection doesn't trigger (e.g., only 1-2 failures), allow manual intervention:

1. Dashboard "Write-off" button on position card
2. Confirms: "Are you sure? This books a realized loss."
3. Sets `closedReason: "manual-writeoff"`
4. Follows same reconciliation process as automatic

---

## 4. Prevention Measures

### 4.1 Entry Gate — Token Safety Check

**File:** `src/lib/token-safety.ts`

**Hard Rejects (block entry completely):**
- Mint authority NOT revoked → infinite mint rug risk
- Liquidity below floor ($20-30k recommended)
- Token age < 300 seconds (survives initial snipe-and-rug window)
- Top holder > 20% (single wallet concentration)
- Top 10 holders > 50% (group concentration)

**Graded Risk Score (0-100):**
- Freeze authority not revoked (+30)
- LP locked < 50% (+25), < 90% (+10)
- Holder count < minimum (+20)
- Insider networks detected (+15 each)
- RugCheck score (30% weight)

**Rejection threshold:** `rugRisk >= 50` (configurable)

### 4.2 Configuration Recommendations

```typescript
// src/lib/trade-config.ts
{
  minLiquidityUsd: 25000,        // Minimum liquidity to allow entry
  minTokenAgeSeconds: 300,       // 5 minutes survival time
  maxTopHolderShare: 0.20,       // 20% single holder ceiling
  maxTop10Share: 0.50,           // 50% top-10 ceiling
  maxRugRiskScore: 50,           // Graded risk threshold
}
```

### 4.3 Exit Engine Tuning

**Current issue:** 60-minute poll interval causes delayed stop-loss.

**Recommendation:** Separate poll intervals:

| Component | Current | Recommended | Reason |
|-----------|---------|-------------|--------|
| Social scanning | 60 min | 60 min | Infrequent updates needed |
| Exit engine | 60 min | 15-30 sec | Rapid response for stop-loss |
| Price feed | 60 min | Real-time WS | Immediate price updates |

---

## 5. Monitoring & Alerting

### 5.1 Key Metrics to Track

| Metric | Alert Threshold | Action |
|--------|-----------------|--------|
| Positions with `closedReason: "rugpull"` | > 2 per hour | Investigate token quality |
| `unknown:*` error rate | > 5% of all sells | Check Jupiter/host health |
| Price feed gaps | > 3 mints missing | Check Price API v3 status |
| Manual write-offs | > 10% of total closes | Review detection thresholds |

### 5.2 Log Patterns to Monitor

```bash
# Rugpull write-offs
grep "WRITE-OFF" logs/alpha.log

# False positive candidates (unknown errors during sell)
grep "unknown:" logs/alpha.log | grep "sell"

# Price feed gaps
grep "price-gap fallback" logs/alpha.log

# Reconcile actions
grep "reconciled" logs/alpha.log
```

---

## 6. Implementation Checklist

### Phase 1: Error Classification (Immediate)

- [ ] Implement `isRugSellSignal()` helper in `position-store.ts`
- [ ] Update `consecutiveSellFails()` to only count rug signals
- [ ] Add `errorCode` field to `Fill` type for explicit error tracking
- [ ] Unit tests for error classification logic

### Phase 2: On-chain Verification (Short-term)

- [ ] Add balance check before `writeOffPosition()` in `maybeWriteOffRugpull()`
- [ ] Require `quote-no-route` AND balance ~0 before write-off
- [ ] Log verification result in write-off message

### Phase 3: Price Feed Fallback (Medium-term)

- [ ] Complete `rugpull-probe` logic when Price v3 missing mint
- [ ] Use sell quote as definitive sellability test
- [ ] Log distinction between "feed gap" and "true unsellable"

### Phase 4: UI Improvements (Medium-term)

- [ ] Separate display for "closed (rugpull)" vs "temporarily unsellable"
- [ ] Recovery button for false-positive positions
- [ ] History of "why closed" with detailed reasons

### Phase 5: Exit Engine Optimization (Medium-term)

- [ ] Separate exit polling from social polling
- [ ] Implement 15-30 second exit interval
- [ ] Add websocket price feed option

---

## 7. Testing Requirements

### 7.1 Unit Tests

```typescript
// position-store.test.ts
test("consecutiveSellFails: unknown errors don't count as rug signals", () => {
  const pos = mockPositionWithFills([
    { error: "unknown:fetch failed" },
    { error: "unknown:confirm-timeout" },
    { error: "quote-http 503" },
  ]);
  expect(consecutiveSellFails(pos)).toBe(0);
});

test("consecutiveSellFails: quote-no-route counts as rug signal", () => {
  const pos = mockPositionWithFills([
    { errorCode: "quote-no-route" },
    { errorCode: "quote-no-route" },
    { errorCode: "quote-no-route" },
  ]);
  expect(consecutiveSellFails(pos)).toBe(3);
});

test("consecutiveSellFails: infra failure in middle of rug run doesn't reset", () => {
  const pos = mockPositionWithFills([
    { errorCode: "quote-no-route" },
    { error: "unknown:fetch failed" }, // ignored
    { errorCode: "quote-no-route" },
    { errorCode: "quote-no-route" },
  ]);
  expect(consecutiveSellFails(pos)).toBe(3); // infra skipped, not break
});
```

### 7.2 Integration Tests

- **Scenario:** Jupiter host down for 2 minutes
  - Expected: No positions written off as rugpull
- **Scenario:** Price API missing a mint temporarily
  - Expected: Sell quote fallback detects token still sellable
- **Scenario:** Token actually rugs (no route, no liquidity)
  - Expected: Position written off after 3 fails

---

## 8. Roles & Responsibilities

| Role | Responsibility |
|------|----------------|
| **System** | Automatic rugpull detection and write-off |
| **DevOps** | Monitor error logs, adjust thresholds, verify false positives |
| **Trading Lead** | Review weekly rugpull report, adjust configuration |
| **Engineer** | Implement fixes, add tests, improve detection logic |

---

## 9. References

- [Post-mortem: False Rugpull](POST-MORTEM-false-rugpull.md) — Error classification details
- [Post-mortem: 3 Live Trades](POST-MORTEM-3-trades.md) — Initial issues and recommendations
- [`src/lib/trade-exit.ts`](src/lib/trade-exit.ts) — Exit engine implementation
- [`src/lib/token-safety.ts`](src/lib/token-safety.ts) — Entry token safety gate
- [`src/lib/position-store.ts`](src/lib/position-store.ts) — Fill ledger and consecutive fail tracking

---

## 10. Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-10-05 | Initial document — covers detection, response, prevention |
