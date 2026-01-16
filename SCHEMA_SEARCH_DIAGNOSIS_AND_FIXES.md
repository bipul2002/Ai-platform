# Schema Search Diagnosis & Fixes

## Problem Statement

**User Query**: "count all contracts for each procuring entity"

**Current Behavior**:
- ❌ Vector search returns: `personal_access_token` table (completely irrelevant!)
- ✅ Keyword search finds: `contract` table
- ❌ Missing: `procuring_entities` table (or similar) needed for the JOIN
- ❌ Result: Partial query generated, LLM only sees `contract` table schema

**Root Cause**: Vector embeddings are **too short, too technical, and lack semantic context**.

---

## Current Embedding Quality Analysis

### How Embeddings Are Generated

**Location**: [admin-backend/src/modules/embeddings/embeddings.service.ts](admin-backend/src/modules/embeddings/embeddings.service.ts)

#### Table Embeddings (Lines 175-184)
```typescript
buildTableEmbeddingText(table):
  "Table: contract. Schema: public."
```

**Issues**:
- ❌ Only 4-5 words total
- ❌ No business context
- ❌ No use case examples
- ❌ No relationship information
- ❌ No synonyms

#### Column Embeddings (Lines 187-198)
```typescript
buildColumnEmbeddingText(column):
  "Column: procuring_entity_id in table contract. Type: uuid. Foreign Key."
```

**Issues**:
- ❌ Doesn't mention what table it references
- ❌ No semantic meaning of "procuring entity"
- ❌ Technical jargon (uuid, FK)

---

## Why Vector Search Fails

### Example: "count all contracts for each procuring entity"

**Query Embedding** (semantic meaning):
```
- Counting records
- Grouping by organization/entity
- Procurement/contracting domain
- Aggregation across entities
```

**Table Embedding** (what's actually stored):
```
contract table: "Table: contract. Schema: public."
procuring_entities table: "Table: procuring_entities. Schema: public."
```

**Similarity Scores** (hypothetical):
```
personal_access_token: 0.32 (passes 0.3 threshold!) ← FALSE POSITIVE
contract: 0.45 ← CORRECT
procuring_entities: 0.28 (below threshold) ← MISSED!
```

**Why `personal_access_token` scored high?**
- Contains "token" which might weakly relate to "entity" or "contract" in embedding space
- Short, generic embeddings lead to random matches

**Why `procuring_entities` missed?**
- "procuring entity" not in embedding text
- No synonyms like "buyer", "organization", "contracting entity"
- Threshold 0.3 too low, but this table still below it

---

## Root Causes

### 1. Poor Embedding Quality

**Current**:
```
Table: contract. Schema: public.
```

**Should Be**:
```
Contract: Table storing procurement contracts and tender awards.
Tracks contracts between procuring entities (government agencies, organizations)
and suppliers/vendors. Includes contract details, amounts, dates, and status.
Related to procuring entities, suppliers, and tender documents.
Common queries: contracts by organization, contracts by date, active contracts,
contract amounts, contracts by supplier.
```

**Token Count**:
- Current: ~6 tokens
- Improved: ~80+ tokens
- **10-15x more semantic information!**

### 2. No Relationship Context

**Problem**: FK columns don't mention what they reference

**Current**:
```
Column: procuring_entity_id in table contract. Type: uuid. Foreign Key.
```

**Should Be**:
```
Column: procuring_entity_id in table contract. Links to procuring_entities table.
Represents the government agency or organization making the procurement.
Used for grouping contracts by entity, analyzing entity spending patterns.
```

### 3. Similarity Threshold Too Low

**Current**: 0.3 (30% similarity)
**Problem**: Allows very poor matches

**Recommendations**:
- **Table matches**: 0.5+ (50% similarity)
- **Column matches**: 0.4+ (40% similarity)

### 4. Result Limit Too Low

**Current**: limit=10
**Problem**: Might miss relevant tables in large schemas

**Recommendation**: limit=20-30

### 5. No Multi-Hop Relationship Discovery

**Problem**: Even if `contract` table found, doesn't automatically include related tables

**Example**:
```
Found: contract table
Should Also Fetch:
  - procuring_entities (via procuring_entity_id FK)
  - suppliers (via supplier_id FK)
  - tender_documents (via tender_id FK)
```

---

## Proposed Solutions

### Solution 1: Enrich Table Embeddings ⭐ **CRITICAL**

**Update**: [embeddings.service.ts:175-184](admin-backend/src/modules/embeddings/embeddings.service.ts#L175-L184)

```typescript
private buildTableEmbeddingText(table: any, columns?: any[]): string {
  const parts = [];

  // 1. Table name (important for keyword matching)
  parts.push(`Table name: ${table.tableName}`);

  // 2. Business description (from admin or auto-generated)
  if (table.adminDescription || table.originalComment) {
    parts.push(this.cleanText(table.adminDescription || table.originalComment));
  }

  // 3. Purpose/domain (if available)
  parts.push(`Schema: ${table.schemaName || 'public'}`);

  // 4. Related entities (FK relationships)
  if (columns && columns.length > 0) {
    const fkColumns = columns.filter(c => c.isForeignKey);
    if (fkColumns.length > 0) {
      const relationships = fkColumns
        .map(c => this.extractRelatedTableName(c.columnName))
        .filter(Boolean)
        .join(', ');
      if (relationships) {
        parts.push(`Related to: ${relationships}`);
      }
    }
  }

  // 5. Common use cases (from semantic hints or auto-generate)
  if (table.semanticHints) {
    parts.push(`Common queries: ${this.cleanText(table.semanticHints)}`);
  }

  // 6. Admin notes (additional context)
  if (table.adminNotes) {
    parts.push(this.cleanText(table.adminNotes));
  }

  return parts.filter(Boolean).join('. ');
}

// Helper: Extract related table name from FK column name
// procuring_entity_id → procuring_entity
// supplier_id → supplier
private extractRelatedTableName(columnName: string): string {
  return columnName
    .replace(/_id$/i, '')
    .replace(/_/g, ' ')
    .trim();
}
```

**Example Output**:
```
Table name: contract.
Procurement contract records tracking agreements between buyers and sellers.
Schema: public.
Related to: procuring entity, supplier, tender.
Common queries: contracts by organization, contracts by date, active contracts, contract value analysis.
```

**Token Count**: ~40-60 tokens (8-10x improvement)

### Solution 2: Enrich Column Embeddings

**Update**: [embeddings.service.ts:187-198](admin-backend/src/modules/embeddings/embeddings.service.ts#L187-L198)

```typescript
private buildColumnEmbeddingText(column: any, tableName: string, referencedTable?: string): string {
  const parts = [];

  // 1. Column name and table
  parts.push(`Column: ${column.columnName} in ${tableName} table`);

  // 2. Data type (in plain language)
  const friendlyType = this.getFriendlyType(column.dataType);
  parts.push(`Type: ${friendlyType}`);

  // 3. Key information with relationship
  if (column.isPrimaryKey) {
    parts.push('Primary identifier');
  } else if (column.isForeignKey && referencedTable) {
    parts.push(`Links to ${referencedTable} table`);
    parts.push(`Represents the ${referencedTable.replace(/_/g, ' ')}`);
  }

  // 4. Business description
  if (column.adminDescription || column.originalComment) {
    parts.push(this.cleanText(column.adminDescription || column.originalComment));
  }

  // 5. Semantic hints (use cases)
  if (column.semanticHints) {
    parts.push(this.cleanText(column.semanticHints));
  }

  // 6. Example usage
  if (column.isForeignKey && referencedTable) {
    parts.push(`Used for grouping by ${referencedTable.replace(/_/g, ' ')}, joining with ${referencedTable} data`);
  }

  return parts.filter(Boolean).join('. ');
}

private getFriendlyType(dataType: string): string {
  const typeMap: Record<string, string> = {
    'uuid': 'unique identifier',
    'varchar': 'text',
    'text': 'long text',
    'integer': 'whole number',
    'bigint': 'large number',
    'timestamp': 'date and time',
    'date': 'date',
    'boolean': 'yes/no flag',
    'decimal': 'decimal number',
    'numeric': 'precise number'
  };
  return typeMap[dataType.toLowerCase()] || dataType;
}
```

**Example Output**:
```
Column: procuring_entity_id in contract table.
Type: unique identifier.
Links to procuring_entities table.
Represents the procuring entities (government agency or organization).
Used for grouping by procuring entities, joining with procuring_entities data.
```

### Solution 3: Increase Similarity Thresholds

**Update**: [nodes.py:686](ai-runtime/agent/nodes.py#L686)

```python
# Current
SIMILARITY_THRESHOLD = 0.3  # Too low!

# Proposed - Differentiate by type
TABLE_SIMILARITY_THRESHOLD = 0.5   # Tables need strong match
COLUMN_SIMILARITY_THRESHOLD = 0.4  # Columns slightly lower
```

**Filter logic**:
```python
for r in raw_vector_results:
    target_type = r.get("target_type", "")
    similarity = r.get("similarity", 0)

    threshold = (
        TABLE_SIMILARITY_THRESHOLD if target_type == "table"
        else COLUMN_SIMILARITY_THRESHOLD
    )

    if similarity >= threshold:
        vector_results.append(r)
```

### Solution 4: Increase Result Limit

**Update**: [nodes.py:682](ai-runtime/agent/nodes.py#L682)

```python
# Current
raw_vector_results = await self.system_db.search_similar_vectors(
    state["agent_id"],
    query_embedding,
    limit=10  # Too low for complex schemas
)

# Proposed
raw_vector_results = await self.system_db.search_similar_vectors(
    state["agent_id"],
    query_embedding,
    limit=30  # Fetch more candidates, filter by threshold
)
```

### Solution 5: Multi-Hop Relationship Discovery ⭐ **ADVANCED**

**New Feature**: Automatically include related tables

**Add to** [nodes.py](ai-runtime/agent/nodes.py) after line 815:

```python
async def _expand_with_related_tables(
    self,
    initial_tables: List[Dict],
    all_tables: List[Dict],
    schema_metadata: Dict
) -> List[Dict]:
    """
    Expand table list by including tables related via FK relationships.
    Example: If 'contract' found, also include 'procuring_entities', 'suppliers'.
    """
    expanded_table_names = {t.get("name") for t in initial_tables}
    relationships = schema_metadata.get("relationships", [])

    # For each found table, find related tables via FKs
    for table in initial_tables:
        table_name = table.get("name")

        # Find relationships where this table is involved
        for rel in relationships:
            related_table = None

            if rel.get("source_table") == table_name:
                # This table has FK to another table
                related_table = rel.get("target_table")
            elif rel.get("target_table") == table_name:
                # Another table has FK to this table
                related_table = rel.get("source_table")

            # Add the related table if not already included
            if related_table and related_table not in expanded_table_names:
                related_table_obj = next(
                    (t for t in all_tables if t.get("name") == related_table),
                    None
                )
                if related_table_obj:
                    expanded_table_names.add(related_table)
                    initial_tables.append(related_table_obj)
                    logger.info(
                        "Added related table via FK",
                        from_table=table_name,
                        to_table=related_table
                    )

    return initial_tables
```

**Usage in schema_search** (after line 801):
```python
logger.info(
    "Hybrid search complete",
    vector_count=len(vector_results),
    keyword_count=len(keyword_matches),
    merged_count=len(final_relevant_tables),
    tables=[t.get("name") for t in final_relevant_tables]
)

# NEW: Expand with related tables
final_relevant_tables = await self._expand_with_related_tables(
    final_relevant_tables,
    all_tables,
    state["schema_metadata"]
)

logger.info(
    "After FK expansion",
    final_count=len(final_relevant_tables),
    tables=[t.get("name") for t in final_relevant_tables]
)
```

### Solution 6: Improve Keyword Matching

**Update**: [nodes.py:698-716](ai-runtime/agent/nodes.py#L698-L716)

```python
# Current keyword matching is basic
# Enhance to match:
# - "procuring entity" → "procuring_entities", "procuring_entity_id"
# - "contract" → "contracts", "contract_items"

def _enhanced_keyword_match(self, tokens: Set[str], table_name: str, table: Dict) -> bool:
    """
    Enhanced keyword matching with:
    - Plural/singular normalization
    - Underscore/space handling
    - Column name matching
    """
    table_name_lower = table_name.lower()

    # 1. Exact match (already handled)
    if table_name_lower in tokens:
        return True

    # 2. Multi-word phrase matching
    # "procuring entity" matches "procuring_entities"
    user_phrases = self._extract_phrases(tokens)
    for phrase in user_phrases:
        normalized_phrase = phrase.replace(' ', '_')
        if normalized_phrase in table_name_lower or table_name_lower in normalized_phrase:
            return True

    # 3. Singular/plural normalization
    table_singular = table_name_lower.rstrip('s')
    for token in tokens:
        token_singular = token.rstrip('s')
        if token_singular == table_singular:
            return True

    # 4. Match against important column names
    # If query mentions "procuring entity", match table with "procuring_entity_id" column
    columns = table.get("columns", [])
    for col in columns:
        col_name = col.get("name", "").lower()
        for token in tokens:
            if token in col_name and len(token) >= 4:
                return True

    return False

def _extract_phrases(self, tokens: Set[str]) -> List[str]:
    """
    Extract 2-3 word phrases from original query
    Example: "count contracts for procuring entity" → ["procuring entity", "count contracts"]
    """
    # This requires access to original query, not just tokens
    # Implementation depends on storing original query
    pass
```

---

## Implementation Priority

### Phase 1: Quick Wins (1-2 hours)
1. ✅ Increase similarity thresholds (0.3 → 0.5 for tables)
2. ✅ Increase result limit (10 → 30)
3. ✅ Add basic relationship context to embeddings

### Phase 2: Embedding Enhancement (2-4 hours)
4. ✅ Enrich table embedding text (Solution 1)
5. ✅ Enrich column embedding text (Solution 2)
6. ✅ Regenerate embeddings for all agents

### Phase 3: Advanced Features (4-8 hours)
7. ✅ Multi-hop FK relationship discovery (Solution 5)
8. ✅ Enhanced keyword matching (Solution 6)
9. ✅ Add logging/metrics for debugging

---

## Expected Impact

### Before Fixes

**Query**: "count all contracts for each procuring entity"

**Vector Results**:
```
1. personal_access_token (similarity: 0.32) ← Wrong!
2. contract (similarity: 0.45) ← Correct
```

**Keyword Results**:
```
1. contract (exact match)
```

**Final Schema Sent to LLM**:
```
contract table only
Missing: procuring_entities table
Result: Partial/incorrect query ❌
```

### After Fixes

**Query**: "count all contracts for each procuring entity"

**Vector Results** (with better embeddings + higher threshold):
```
1. contract (similarity: 0.72) ← Strong match
2. procuring_entities (similarity: 0.65) ← Found via enriched embedding!
3. suppliers (similarity: 0.52) ← Bonus related table
```

**FK Expansion**:
```
contract found → Also add procuring_entities (FK relationship)
```

**Final Schema Sent to LLM**:
```
contract table + procuring_entities table + relationships
Result: Correct JOIN query ✅
```

---

## Testing Plan

### Test Case 1: Multi-Table Query
**Query**: "count all contracts for each procuring entity"

**Expected**:
- ✅ Vector search finds: `contract`, `procuring_entities`
- ✅ FK expansion adds any missing tables
- ✅ LLM generates: `SELECT ... FROM contract JOIN procuring_entities ...`

### Test Case 2: Single Table Query
**Query**: "show all active users"

**Expected**:
- ✅ Vector search finds: `users` table
- ✅ No unnecessary tables included
- ✅ LLM generates: `SELECT ... FROM users WHERE active = true`

### Test Case 3: Complex Multi-Hop
**Query**: "show contracts with supplier details and procuring entity names"

**Expected**:
- ✅ Vector search finds: `contract`
- ✅ FK expansion adds: `suppliers`, `procuring_entities`
- ✅ LLM generates: 3-way JOIN

### Test Case 4: Irrelevant Query
**Query**: "what's the weather today?"

**Expected**:
- ✅ Vector search finds: nothing above threshold
- ✅ Keyword search finds: nothing
- ✅ Routes to: off_topic or no_match

---

## Monitoring & Metrics

### Add Logging

```python
logger.info(
    "Vector search quality",
    query=search_query,
    results_count=len(vector_results),
    top_3_tables=[(r.get("metadata", {}).get("table_name"), r.get("similarity"))
                  for r in vector_results[:3]],
    threshold=SIMILARITY_THRESHOLD,
    any_relevant=any(r.get("similarity") > 0.6 for r in vector_results)
)
```

### Metrics to Track

1. **Vector Search Hit Rate**: % of queries where vector search finds relevant tables
2. **FK Expansion Rate**: % of queries where FK expansion adds tables
3. **Keyword Fallback Rate**: % relying only on keyword matching
4. **False Positive Rate**: % of queries with irrelevant tables (similarity < 0.4)
5. **Query Success Rate**: % of queries generating correct SQL

---

## Rollback Plan

If embeddings quality decreases:

```bash
# Restore old embedding generation
git checkout admin-backend/src/modules/embeddings/embeddings.service.ts

# Re-deploy admin backend
cd admin-backend && npm run build && pm2 restart admin-backend

# Regenerate embeddings with old logic
curl -X POST http://localhost:3001/api/embeddings/generate/<agent_id>
```

---

## Summary

**Problem**: Vector search returns irrelevant tables due to poor embedding quality

**Root Cause**: Embeddings are too short (6 tokens) and lack semantic context

**Solution**:
1. Enrich embeddings with business descriptions, relationships, use cases (60+ tokens)
2. Increase similarity threshold (0.3 → 0.5)
3. Add multi-hop FK relationship discovery
4. Increase result limit (10 → 30)

**Expected Result**:
- Vector search finds ALL relevant tables
- Fewer tokens sent to LLM (focused schema, not full schema)
- Higher query accuracy
- No need for full schema workaround

**Implementation Time**: 4-8 hours total

**Files to Modify**:
1. [admin-backend/src/modules/embeddings/embeddings.service.ts](admin-backend/src/modules/embeddings/embeddings.service.ts) - Embedding generation
2. [ai-runtime/agent/nodes.py](ai-runtime/agent/nodes.py) - Schema search logic

---

**Status**: ⚠️ **READY FOR IMPLEMENTATION**
