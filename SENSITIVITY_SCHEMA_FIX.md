# Sensitivity Schema Field Fix

## Issue
Build failed due to incorrect field names in the sensitivity service query.

## Root Cause
The `agent_columns` table schema only has:
- `sensitivityOverride` (not `sensitivityLevel`)
- `maskingStrategyOverride` (not `maskingStrategy`)

These are **override** fields that allow admins to override defaults when marking columns as sensitive.

## Fix Applied

### Backend Change
**File**: `/admin-backend/src/modules/sensitivity/sensitivity.service.ts`

**Changed**:
```typescript
// BEFORE (incorrect):
sensitivityLevel: agentColumns.sensitivityLevel,
maskingStrategy: agentColumns.maskingStrategy,
maskingStrategyOverride: agentColumns.maskingStrategyOverride,

// AFTER (correct):
sensitivityLevel: agentColumns.sensitivityOverride,
maskingStrategy: agentColumns.maskingStrategyOverride,
```

**Reasoning**: The schema fields are named as "overrides" because they allow customization beyond defaults.

### Frontend Change
**File**: `/frontend/src/pages/admin/components/AgentSensitivitySettings.tsx`

**Changed Interface**:
```typescript
interface SchemaSensitiveColumn {
    id: string
    tableName: string
    columnName: string
    dataType: string
    isSensitive: boolean
    sensitivityLevel?: 'low' | 'medium' | 'high' | 'critical'  // Now optional
    maskingStrategy?: 'full' | 'partial' | 'hash' | 'redact' | 'tokenize'  // Now optional
    adminDescription?: string
}
```

**Changed Display Logic**:
```typescript
// Now checks if values exist before displaying
{col.maskingStrategy && (
    <span>...</span>
)}
{col.sensitivityLevel && (
    <span>...</span>
)}
```

**Reasoning**:
- Fields are optional since admins might not set overrides
- Only display badges when values are present
- Prevents showing "undefined" in the UI

## Schema Design

The current schema design is:

```
agent_columns:
  - isSensitive: boolean (marks column as sensitive)
  - sensitivityOverride: enum (optional override for sensitivity level)
  - maskingStrategyOverride: enum (optional override for masking strategy)
```

**Default Behavior**:
- When `isSensitive = true` but no overrides are set:
  - System uses defaults from sensitivity registry
  - Column is still masked, just with default strategy

**Override Behavior**:
- Admin can set `sensitivityOverride` = "high"
- Admin can set `maskingStrategyOverride` = "partial"
- These take precedence over pattern-based rules

## Testing Notes

### Display Scenarios

**Scenario 1: Column marked sensitive without overrides**
```
Database: { isSensitive: true, sensitivityOverride: null, maskingStrategyOverride: null }
Display: users.email (varchar)
```

**Scenario 2: Column marked sensitive with overrides**
```
Database: { isSensitive: true, sensitivityOverride: 'high', maskingStrategyOverride: 'partial' }
Display: users.email (varchar) [partial] [high]
```

**Scenario 3: Column not marked sensitive**
```
Database: { isSensitive: false }
Display: (not shown in sensitivity rules list)
```

## Impact on Query Pipeline

The AI runtime still works correctly because:

1. **Nodes.py** extracts sensitive columns:
```python
def _extract_sensitive_columns(self, schema):
    for col in table.get("columns", []):
        if col.get("isSensitive", False):
            sensitive_cols.append({
                "table": table["name"],
                "column": col["name"],
                "sensitivityLevel": col.get("sensitivityLevel", "high"),  # Falls back to "high"
                "maskingStrategy": col.get("maskingStrategy", "full"),     # Falls back to "full"
                "source": "schema_admin"
            })
```

2. **Sensitivity Registry** applies defaults:
```python
def _get_column_masking(self, column_name):
    for schema_rule in self.schema_sensitive_columns:
        return {
            "strategy": schema_rule.get("maskingStrategy", "full"),  # Default to "full"
            "level": schema_rule.get("sensitivityLevel", "high")     # Default to "high"
        }
```

**✅ Result**: Even when overrides are null, the system applies sensible defaults.

## Build Status

✅ Backend builds successfully
✅ Frontend builds successfully
✅ Type errors resolved
✅ Optional field handling implemented

## Deployment Ready

The fix is complete and ready for deployment. The implementation correctly:
- Uses the actual schema field names (`sensitivityOverride`, `maskingStrategyOverride`)
- Handles optional values gracefully
- Provides defaults when overrides are not set
- Maintains backward compatibility
