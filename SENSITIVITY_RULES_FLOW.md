# Sensitivity Rules Flow - Complete Verification

## Overview
This document verifies that all 3 levels of sensitivity rules are properly integrated and sent to the query pipeline and LLM.

---

## Three Levels of Sensitivity Rules

### 1. **Global Rules (Pattern-Based)**
- **Source**: `sensitive_field_registry_global` table
- **Scope**: System-wide, inherited by all agents
- **Examples**: password, token, ssn, credit_card
- **Type**: Pattern matching on column names

### 2. **Schema-Based Rules (Database Metadata)**
- **Source**: `agent_columns` table where `isSensitive = true`
- **Scope**: Specific columns marked by admins in schema metadata
- **Examples**: users.email, orders.credit_card_number
- **Type**: Explicit column marking with masking strategy

### 3. **Agent-Specific Rules (Pattern-Based)**
- **Source**: `sensitive_field_registry_agent` table
- **Scope**: Custom rules for specific agent
- **Examples**: customer_id, phone_number (agent-specific patterns)
- **Type**: Pattern matching on column names

---

## Data Flow Through the System

### Step 1: Admin Backend API (Data Collection)

**File**: `/admin-backend/src/modules/sensitivity/sensitivity.service.ts`

**Method**: `getCombinedRules(agentId: string)`

**Returns**:
```typescript
{
  globalRules: [
    {
      id, patternType, patternValue, patternRegex,
      sensitivityLevel, maskingStrategy, description, isActive
    }
  ],
  agentRules: [
    {
      id, patternType, patternValue, patternRegex,
      sensitivityLevel, maskingStrategy, description, isActive
    }
  ],
  schemaSensitiveColumns: [
    {
      id, tableName, columnName, dataType,
      isSensitive, sensitivityLevel, maskingStrategy,
      maskingStrategyOverride, adminDescription
    }
  ],
  forbiddenFields: [
    { id, tablePattern, columnPattern, reason }
  ]
}
```

**✅ Verified**: All 3 levels are now returned by the API

---

### Step 2: Frontend Display (User Visibility)

**File**: `/frontend/src/pages/admin/components/AgentSensitivitySettings.tsx`

**Display Order**:
1. 🌐 **Global Rules (Inherited)** - Read-only
2. 📊 **Database-Level Sensitivity Rules** - Read-only (link to schema editor)
3. 🔒 **Agent-Specific Rules** - Editable

**✅ Verified**: UI shows all 3 levels in order of precedence

---

### Step 3: AI Runtime Data Fetch

**File**: `/ai-runtime/services/system_db.py`

**Method**: `get_agent_sensitivity(agent_id: str)`

**Current Implementation**:
- ✅ Fetches `globalRules` from `sensitive_field_registry_global`
- ✅ Fetches `agentRules` from `sensitive_field_registry_agent`
- ✅ Fetches `forbiddenFields` from `forbidden_fields`
- ❌ **DOES NOT** fetch schema-based sensitive columns directly

**Why**: Schema-based sensitivity is extracted from `get_agent_enriched_metadata()` instead

---

### Step 4: Query Pipeline Integration

**File**: `/ai-runtime/agent/nodes.py`

**Method**: `load_config(state: QueryState)`

**Process**:
```python
# 1. Load agent config and schema
config = await self.system_db.get_agent_config(state["agent_id"])
schema = await self.system_db.get_agent_enriched_metadata(state["agent_id"])  # Contains ALL columns
sensitivity = await self.system_db.get_agent_sensitivity(state["agent_id"])   # Pattern-based rules

# 2. Extract schema-based sensitive columns from schema metadata
schema_sensitive_fields = self._extract_sensitive_columns(schema)

# 3. Merge all 3 levels
enhanced_sensitivity = {
    "globalRules": sensitivity.get("globalRules", []),        # Level 1
    "agentRules": sensitivity.get("agentRules", []),          # Level 3
    "schemaSensitiveColumns": schema_sensitive_fields,         # Level 2
    "forbiddenFields": sensitivity.get("forbiddenFields", [])
}

# 4. Load into sensitivity registry
self.sensitivity_registry.load_rules(enhanced_sensitivity)
```

**✅ Verified**: All 3 levels are merged and loaded into the sensitivity registry

---

### Step 5: Sensitivity Registry Processing

**File**: `/ai-runtime/mcp_tools/sensitivity_registry.py`

**Method**: `_get_column_masking(column_name: str)`

**Priority Order**:
```python
# PRIORITY 1: Schema-based sensitive columns (highest priority)
for schema_rule in self.schema_sensitive_columns:
    if column matches schema_rule:
        return schema_rule masking strategy

# PRIORITY 2: Pattern-based rules (global + agent-specific)
for rule in self.global_rules + self.agent_rules:
    if column matches pattern:
        return pattern masking strategy

# PRIORITY 3: Common sensitive keywords (fallback)
for keyword in ['password', 'ssn', 'token', ...]:
    if keyword in column:
        return full masking
```

**✅ Verified**: Three-tier priority system ensures schema-based rules take precedence

---

### Step 6: SQL Execution and Result Sanitization

**File**: `/ai-runtime/agent/nodes.py`

**Method**: `sanitizer(state: QueryState)`

**Process**:
```python
async def sanitizer(self, state: QueryState) -> Dict:
    sanitized = self.sensitivity_registry.sanitize_results(
        state["raw_results"],
        state["sensitivity_rules"]  # Contains all 3 levels
    )
    return {"sanitized_results": sanitized, "current_step": "sanitized"}
```

**✅ Verified**: Sanitization uses the combined sensitivity rules

---

## Verification Checklist

### Backend API
- ✅ `getCombinedRules()` returns `globalRules`
- ✅ `getCombinedRules()` returns `agentRules`
- ✅ `getCombinedRules()` returns `schemaSensitiveColumns` (NEW)
- ✅ `getCombinedRules()` returns `forbiddenFields`

### Frontend Display
- ✅ Shows Global Rules section
- ✅ Shows Database-Level Sensitivity Rules section (NEW)
- ✅ Shows Agent-Specific Rules section
- ✅ Proper visual hierarchy and styling

### AI Runtime Integration
- ✅ `get_agent_enriched_metadata()` includes column sensitivity flags
- ✅ `get_agent_sensitivity()` fetches pattern-based rules
- ✅ `load_config()` extracts schema-based sensitivity from metadata
- ✅ `load_config()` merges all 3 levels into `enhanced_sensitivity`
- ✅ `sensitivity_registry.load_rules()` receives all 3 levels

### Sensitivity Registry
- ✅ `__init__` stores `schema_sensitive_columns`
- ✅ `load_rules()` loads `schemaSensitiveColumns`
- ✅ `_get_column_masking()` checks schema-based rules first (highest priority)
- ✅ `_get_column_masking()` checks pattern-based rules second
- ✅ `_get_column_masking()` checks keyword-based rules last (fallback)

### Query Pipeline
- ✅ Schema-based sensitivity loaded in `load_config()` node
- ✅ Sensitivity rules available throughout pipeline
- ✅ `sanitizer()` node applies all rules to results
- ✅ Final response contains masked data

---

## Example Flow

### Scenario: User queries "Show me all customer emails"

#### Input Query
```
User: "Show me all customer emails"
```

#### Pipeline Processing

**1. Load Config Node**
```python
# Loads:
globalRules = [
  { pattern: "email", maskingStrategy: "partial", level: "medium" }  # Global
]
agentRules = [
  { pattern: "customer", maskingStrategy: "hash", level: "low" }     # Agent
]
schemaSensitiveColumns = [
  { table: "customers", column: "email", maskingStrategy: "partial", level: "high" }  # Schema
]
```

**2. Query Builder Node**
- Generates SQL: `SELECT email FROM customers`

**3. SQL Executor Node**
- Returns raw results: `[{email: "john@example.com"}, {email: "jane@example.com"}]`

**4. Sanitizer Node**
- Column: `email`
- Check priority 1 (schema-based): ✅ MATCH - `customers.email` is marked sensitive
- Apply masking: `partial` strategy with `high` level
- Result: `[{email: "jo***@example.com"}, {email: "ja***@example.com"}]`

**5. Response Composer Node**
- Returns: "Found 2 customer emails: jo***@example.com, ja***@example.com"

---

## Summary

### ✅ All 3 Levels Are Integrated

1. **Global Rules**: Loaded from `sensitive_field_registry_global` → Applied via pattern matching
2. **Schema-Based Rules**: Extracted from `agent_columns.isSensitive` → Applied with highest priority
3. **Agent Rules**: Loaded from `sensitive_field_registry_agent` → Applied via pattern matching

### ✅ Proper Priority Order

Schema-Based > Pattern-Based (Global + Agent) > Keyword-Based

### ✅ Complete Data Flow

Admin Backend → Frontend Display → AI Runtime → Sensitivity Registry → Result Sanitization

### ✅ No Gaps

- All rules are fetched
- All rules are displayed to users
- All rules are sent to query pipeline
- All rules are applied during sanitization

---

## Implementation Complete

**Files Modified**:
1. `/admin-backend/src/modules/sensitivity/sensitivity.service.ts` - Added schema-based sensitivity fetch
2. `/frontend/src/pages/admin/components/AgentSensitivitySettings.tsx` - Added UI display
3. `/ai-runtime/agent/nodes.py` - Already integrated (from previous implementation)
4. `/ai-runtime/mcp_tools/sensitivity_registry.py` - Already integrated (from previous implementation)

**Result**: All 3 levels of sensitivity rules are now visible to users and properly integrated into the query pipeline with correct priority ordering.
