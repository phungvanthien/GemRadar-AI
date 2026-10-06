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
