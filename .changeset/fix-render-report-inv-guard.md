---
"@openagentaudit/core": patch
---

fix: guard inventoryReport iteration on Array.isArray(inv.tools) to prevent crash on malformed input
