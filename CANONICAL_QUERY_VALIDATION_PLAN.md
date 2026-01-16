# Canonical Query Validation & Semantic Correction Plan

## Problem Statement

The LLM sometimes generates canonical queries with table/column names that don't exist in the database, leading to execution errors. We need a validation and auto-correction mechanism **before** SQL generation.

## Solution Architecture

### Phase 1: Strict Validation (Immediate)
Add a new node `canonical_query_validator` between `query_builder` and `sql_generator`.

**Pipeline Flow:**
```
query_builder → canonical_query_validator → sql_generator → sql_validator → executor
                        ↓ (if corrections needed)
                   semantic_matcher
                        ↓ (if low confidence)
                   clarification_responder
```

---

## Implementation Plan

### Step 1: Create `CanonicalQueryValidator` Class

**Location**: `ai-runtime/agent/query_validator.py` (NEW FILE)

**Responsibilities:**
1. Validate all table references in canonical query
2. Validate all column references against their respective tables
3. Detect typos, case mismatches, and semantic variations
4. Apply corrections with confidence scoring
5. Log validation issues for learning

**Core Methods:**
```python
class CanonicalQueryValidator:
    def __init__(self, schema_metadata: Dict[str, Any]):
        self.schema = schema_metadata
        self.table_map = self._build_table_map()
        self.column_map = self._build_column_map()

    def validate_and_correct(
        self,
        canonical_query: Dict[str, Any]
    ) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
        """
        Validate canonical query and apply corrections.

        Returns:
            (corrected_query, validation_issues)
        """

    def _validate_table_reference(self, table_ref: Dict) -> ValidationResult
    def _validate_column_reference(self, table: str, column: str) -> ValidationResult
    def _find_best_match(self, target: str, candidates: List[str]) -> MatchResult
```

---

### Step 2: Build Entity Maps for Fast Lookup

```python
def _build_table_map(self) -> Dict[str, Dict]:
    """
    Build normalized table lookup map.

    Returns:
        {
            "userprofile": {"actual_name": "UserProfile", "metadata": {...}},
            "user_profile": {"actual_name": "UserProfile", ...},
            "user-profile": {"actual_name": "UserProfile", ...},
        }
    """
    table_map = {}

    for table in self.schema.get("tables", []):
        actual_name = table.get("name")

        # Add exact match
        table_map[actual_name.lower()] = {
            "actual_name": actual_name,
            "metadata": table
        }

        # Add variations
        variations = self._generate_variations(actual_name)
        for var in variations:
            if var not in table_map:
                table_map[var] = {
                    "actual_name": actual_name,
                    "metadata": table
                }

    return table_map

def _generate_variations(self, name: str) -> List[str]:
    """Generate common variations of a name"""
    variations = [
        name.lower(),                          # userprofile
        name.replace("_", ""),                 # remove underscores
        name.replace("-", ""),                 # remove hyphens
        name.replace("_", " "),                # user profile
        self._to_snake_case(name),             # user_profile
        self._to_kebab_case(name),             # user-profile
        self._pluralize(name),                 # userprofiles
        self._singularize(name),               # userprofile
    ]
    return [v.lower() for v in variations]
```

---

### Step 3: Implement Semantic Matching

**Three-Tier Matching Strategy:**

#### Tier 1: Exact Match (Confidence: 1.0)
- Direct lookup in normalized map
- Case-insensitive, underscore/hyphen agnostic

#### Tier 2: Fuzzy Match (Confidence: 0.7-0.95)
- Levenshtein distance for typos
- Edit distance threshold: 2-3 characters
- Examples:
  - "user_profle" → "user_profile" (typo)
  - "organisation" → "organizations" (spelling)

```python
def _fuzzy_match(self, target: str, candidates: List[str]) -> MatchResult:
    """Find best match using Levenshtein distance"""
    from Levenshtein import distance

    best_match = None
    best_distance = float('inf')

    for candidate in candidates:
        dist = distance(target.lower(), candidate.lower())

        # Adjust threshold based on string length
        max_distance = max(2, len(target) // 5)  # Allow 20% error

        if dist < best_distance and dist <= max_distance:
            best_distance = dist
            best_match = candidate

    if best_match:
        # Calculate confidence: closer distance = higher confidence
        confidence = 1.0 - (best_distance / len(target))
        return MatchResult(
            match=best_match,
            confidence=max(0.7, confidence),  # Min 0.7 for fuzzy
            method="fuzzy"
        )

    return None
```

#### Tier 3: Semantic Match (Confidence: 0.5-0.8)
- Use embeddings for semantic similarity
- Examples:
  - "customer" → "users" (semantically similar)
  - "product_items" → "products" (related)

```python
async def _semantic_match(
    self,
    target: str,
    candidates: List[str],
    embedding_service: EmbeddingService
) -> MatchResult:
    """Find best match using semantic similarity"""

    # Generate embedding for target
    target_embedding = await embedding_service.generate_single_embedding(target)

    best_match = None
    best_similarity = 0.0

    for candidate in candidates:
        # Generate embedding for candidate
        candidate_embedding = await embedding_service.generate_single_embedding(candidate)

        # Calculate cosine similarity
        similarity = self._cosine_similarity(target_embedding, candidate_embedding)

        if similarity > best_similarity and similarity > 0.75:  # Threshold
            best_similarity = similarity
            best_match = candidate

    if best_match and best_similarity > 0.75:
        return MatchResult(
            match=best_match,
            confidence=min(0.8, best_similarity),  # Cap at 0.8 for semantic
            method="semantic"
        )

    return None
```

---

### Step 4: Validation Logic

```python
def validate_and_correct(
    self,
    canonical_query: Dict[str, Any]
) -> Tuple[Dict[str, Any], List[ValidationIssue]]:
    """Main validation entry point"""

    corrected_query = canonical_query.copy()
    issues = []

    # 1. Validate Primary Table
    primary_table = canonical_query.get("primary_table", {})
    table_name = primary_table.get("name")

    validation = self._validate_table_reference(table_name)

    if not validation.is_valid:
        # Try to find match
        match = self._find_best_table_match(table_name)

        if match and match.confidence >= 0.7:
            # Auto-correct with high confidence
            corrected_query["primary_table"]["name"] = match.actual_name
            issues.append(ValidationIssue(
                type="table_corrected",
                original=table_name,
                corrected=match.actual_name,
                confidence=match.confidence,
                method=match.method,
                severity="info"
            ))
            logger.info(
                "Auto-corrected table name",
                original=table_name,
                corrected=match.actual_name,
                confidence=match.confidence
            )
        else:
            # Low confidence - flag for clarification
            issues.append(ValidationIssue(
                type="table_not_found",
                original=table_name,
                candidates=self._get_similar_tables(table_name, top_k=3),
                severity="error"
            ))

    # 2. Validate Columns
    for col_ref in canonical_query.get("columns", []):
        col_name = col_ref.get("column")

        # Extract table from column reference (format: "table.column")
        if "." in col_name:
            table_part, col_part = col_name.split(".", 1)
        else:
            table_part = primary_table.get("alias") or primary_table.get("name")
            col_part = col_name

        # Resolve table alias to actual table name
        actual_table = self._resolve_table_alias(table_part, corrected_query)

        # Validate column exists in this table
        validation = self._validate_column_in_table(actual_table, col_part)

        if not validation.is_valid:
            # Try to find match
            match = self._find_best_column_match(actual_table, col_part)

            if match and match.confidence >= 0.7:
                # Auto-correct
                corrected_col = f"{table_part}.{match.actual_name}"
                col_ref["column"] = corrected_col
                issues.append(ValidationIssue(
                    type="column_corrected",
                    table=actual_table,
                    original=col_part,
                    corrected=match.actual_name,
                    confidence=match.confidence,
                    severity="info"
                ))
            else:
                # Flag for clarification
                issues.append(ValidationIssue(
                    type="column_not_found",
                    table=actual_table,
                    column=col_part,
                    candidates=self._get_similar_columns(actual_table, col_part, top_k=3),
                    severity="error"
                ))

    # 3. Validate JOINs
    for join in canonical_query.get("joins", []):
        # Validate joined table
        join_table = join.get("table")
        validation = self._validate_table_reference(join_table)
        # ... similar logic

        # Validate JOIN condition columns
        left_col = join["on"]["left_column"]
        right_col = join["on"]["right_column"]
        # ... validate both columns exist

    # 4. Validate Filters
    for filter_cond in canonical_query.get("filters", []):
        col_ref = filter_cond.get("column")
        # ... validate column exists

    return corrected_query, issues
```

---

### Step 5: Decision Logic - Auto-correct vs Clarify

```python
def should_auto_correct(self, issues: List[ValidationIssue]) -> bool:
    """
    Decide whether to auto-correct or ask for clarification.

    Auto-correct if:
    - All issues have confidence >= 0.7
    - No critical errors (e.g., multiple table candidates with similar confidence)

    Otherwise, ask for clarification.
    """

    error_issues = [i for i in issues if i.severity == "error"]

    if not error_issues:
        # All issues corrected with high confidence
        return True

    # Check if any critical errors
    for issue in error_issues:
        if issue.type in ["table_not_found", "column_not_found"]:
            # Can't proceed without knowing which entity
            return False

    return True
```

---

### Step 6: Add Node to Pipeline

**In `query_pipeline.py`:**

```python
def _build_graph(self) -> StateGraph:
    workflow = StateGraph(QueryState)

    # ... existing nodes ...
    workflow.add_node("query_builder", self.nodes.query_builder)
    workflow.add_node("canonical_query_validator", self.nodes.canonical_query_validator)  # NEW
    workflow.add_node("sql_generator", self.nodes.sql_generator)

    # ... edges ...
    workflow.add_edge("query_builder", "canonical_query_validator")

    # Conditional edge from validator
    workflow.add_conditional_edges(
        "canonical_query_validator",
        self._check_validation_result,
        {
            "valid": "sql_generator",
            "corrected": "sql_generator",  # Auto-corrected, proceed
            "needs_clarification": "validation_clarifier"  # NEW node
        }
    )
```

**In `nodes.py`:**

```python
async def canonical_query_validator(self, state: QueryState) -> Dict:
    """Validate and correct canonical query before SQL generation"""

    validator = CanonicalQueryValidator(
        schema_metadata=state["schema_metadata"],
        embedding_service=self.embedding_service
    )

    corrected_query, issues = await validator.validate_and_correct(
        state["canonical_query"]
    )

    # Log all issues
    for issue in issues:
        logger.info(
            "Validation issue",
            type=issue.type,
            severity=issue.severity,
            details=issue.to_dict()
        )

    # Separate by severity
    errors = [i for i in issues if i.severity == "error"]
    warnings = [i for i in issues if i.severity in ["warning", "info"]]

    if errors:
        # Critical issues - need clarification
        return {
            "validation_result": {
                "is_valid": False,
                "requires_clarification": True,
                "errors": [e.to_dict() for e in errors]
            },
            "current_step": "validation_failed"
        }

    if warnings:
        # Auto-corrected - log and proceed
        logger.info(
            "Auto-corrected canonical query",
            correction_count=len(warnings),
            corrections=[w.to_dict() for w in warnings]
        )

    return {
        "canonical_query": corrected_query,
        "validation_result": {
            "is_valid": True,
            "auto_corrected": len(warnings) > 0,
            "corrections": [w.to_dict() for w in warnings]
        },
        "current_step": "query_validated"
    }


async def validation_clarifier(self, state: QueryState) -> Dict:
    """Ask user for clarification on validation errors"""

    errors = state["validation_result"]["errors"]

    # Build clarification message
    message_parts = ["I found some issues with the query:"]

    for error in errors:
        if error["type"] == "table_not_found":
            message_parts.append(
                f"\n• Table '{error['original']}' not found. Did you mean one of these?"
            )
            for candidate in error.get("candidates", [])[:3]:
                message_parts.append(f"  - {candidate}")

        elif error["type"] == "column_not_found":
            message_parts.append(
                f"\n• Column '{error['column']}' not found in table '{error['table']}'. Did you mean:"
            )
            for candidate in error.get("candidates", [])[:3]:
                message_parts.append(f"  - {candidate}")

    message_parts.append("\nPlease clarify which you meant, or rephrase your question.")

    return {
        "final_response": "\n".join(message_parts),
        "current_step": "complete"
    }
```

---

## Phase 2: Learning from Corrections (Future)

### Track Validation Issues
Store validation corrections in database for analysis:

```sql
CREATE TABLE query_validation_logs (
    id UUID PRIMARY KEY,
    agent_id UUID,
    user_query TEXT,
    original_entity VARCHAR(255),
    corrected_entity VARCHAR(255),
    entity_type VARCHAR(50),  -- 'table' or 'column'
    confidence FLOAT,
    method VARCHAR(50),  -- 'exact', 'fuzzy', 'semantic'
    was_auto_corrected BOOLEAN,
    user_feedback VARCHAR(50),  -- 'correct', 'incorrect', 'clarified'
    created_at TIMESTAMP DEFAULT NOW()
);
```

### Use Corrections to Improve
1. **Build synonym map**: If "customers" → "users" correction happens frequently, add to custom dictionary
2. **Refine embeddings**: Fine-tune embeddings based on confirmed corrections
3. **Update prompts**: Add common mistakes to examples in QUERY_BUILDER_PROMPT

---

## Phase 3: Advanced Features (Future)

### 1. Context-Aware Validation
If user asks "show me customer emails", and there's no "customers" table:
- Check if previous query mentioned "users"
- Suggest: "Did you mean 'users' table?"

### 2. Multi-Entity Disambiguation
If "order" could match "Orders" OR "OrderItems":
- Ask: "Which table did you mean: Orders or OrderItems?"
- Remember choice for session context

### 3. Column Purpose Inference
If user asks for "email" in "users" table:
- Found columns: "email_address", "contact_email", "primary_email"
- Use semantic similarity to pick most likely

---

## Implementation Priority

### Immediate (Week 1):
- ✅ Create `CanonicalQueryValidator` class
- ✅ Implement exact and fuzzy matching
- ✅ Add validation node to pipeline
- ✅ Basic clarification responder

### Short-term (Week 2-3):
- ✅ Add semantic matching with embeddings
- ✅ Implement confidence-based auto-correction
- ✅ Add validation logging for analysis

### Medium-term (Month 1-2):
- ✅ Build validation logs database
- ✅ Create admin dashboard for validation issues
- ✅ Implement learning from corrections
- ✅ Add synonym map to custom dictionary

### Long-term (Month 3+):
- ✅ Context-aware validation
- ✅ Multi-entity disambiguation UI
- ✅ Fine-tune embeddings based on corrections
- ✅ Predictive entity suggestion

---

## Success Metrics

Track these metrics to measure improvement:

1. **Validation Error Rate**: % of queries with entity mismatches
   - **Target**: < 5% after 1 month

2. **Auto-correction Accuracy**: % of auto-corrections that were correct
   - **Target**: > 90%

3. **Clarification Rate**: % of queries requiring user clarification
   - **Target**: < 10%

4. **Correction Confidence Distribution**: How confident are we in corrections?
   - **Target**: 80% of corrections with confidence > 0.8

5. **Repeated Errors**: Same entity mistakes happening multiple times
   - **Target**: Add to synonym map, reduce by 50% month-over-month

---

## Example Scenarios

### Scenario 1: Typo Correction (Auto-fix)
```
User Query: "Show me all user_profles"
Generated Entity: "user_profles"
Validation: Table not found
Fuzzy Match: "user_profiles" (confidence: 0.92)
Action: Auto-correct
Result: Query executes successfully
Log: "Auto-corrected 'user_profles' → 'user_profiles' (typo)"
```

### Scenario 2: Ambiguous Entity (Clarify)
```
User Query: "Show me orders"
Generated Entity: "orders"
Validation: Table not found
Candidates: "Orders", "OrderItems", "OrderHistory" (all confidence ~0.6)
Action: Ask for clarification
Response: "Did you mean: Orders, OrderItems, or OrderHistory?"
```

### Scenario 3: Semantic Match (Auto-fix)
```
User Query: "Show me customer emails"
Generated Entity: "customers"
Validation: Table not found
Semantic Match: "users" (confidence: 0.78)
Action: Auto-correct
Result: Query executes successfully
Log: "Auto-corrected 'customers' → 'users' (semantic match)"
```

### Scenario 4: Missing Column (Suggest alternatives)
```
User Query: "Show me user email addresses"
Generated Entity: "users.email_address"
Validation: Column not found in users
Available Columns: "email", "contact_email"
Fuzzy Match: "email" (confidence: 0.81)
Action: Auto-correct to "email"
Result: Query executes successfully
```

---

## Integration with Existing System

The validator integrates seamlessly:

```
Current Flow:
query_builder → sql_generator → sql_validator → executor
                                        ↓
                                (catches SQL errors)

New Flow:
query_builder → canonical_validator → sql_generator → sql_validator → executor
                        ↓
                (catches entity errors BEFORE SQL generation)
```

**Benefits:**
- ✅ Catch errors earlier in pipeline
- ✅ Provide better error messages (entity-level, not SQL-level)
- ✅ Reduce failed query executions
- ✅ Learn from corrections to improve over time
- ✅ No breaking changes to existing pipeline

---

## Code Structure

```
ai-runtime/
├── agent/
│   ├── nodes.py                           # Add validation node
│   ├── query_pipeline.py                  # Add validation edge
│   ├── query_validator.py                 # NEW: Validator class
│   └── validation_models.py               # NEW: ValidationIssue, MatchResult
├── services/
│   └── validation_logger.py               # NEW: Log validation issues
└── tests/
    └── test_query_validator.py            # NEW: Validator tests
```

---

## Conclusion

This validation and correction system will:
1. **Prevent errors** before SQL generation
2. **Auto-fix** common mistakes with confidence scoring
3. **Learn** from corrections to improve over time
4. **Provide clear feedback** when clarification is needed
5. **Track metrics** to measure and optimize performance

The phased approach allows immediate value (basic validation) while building toward a learning system that gets smarter over time.
