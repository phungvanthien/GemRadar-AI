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
