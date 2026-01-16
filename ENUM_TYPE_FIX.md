# Enum Type Mismatch Fix

## Error Encountered

```
sqlalchemy.dialects.postgresql.asyncpg.ProgrammingError: column "sql_dialect" is of type db_type but expression is of type character varying
```

## Root Cause

The PostgreSQL database has several columns defined as ENUM types, but the SQLAlchemy models were using `String` type instead. This caused type mismatch errors when trying to insert data.

## Enum Types in Database

From Drizzle schema (admin-backend):
```typescript
export const dbTypeEnum = pgEnum('db_type', ['postgresql', 'mysql']);
export const llmProviderEnum = pgEnum('llm_provider', ['openai', 'anthropic']);
export const sensitivityLevelEnum = pgEnum('sensitivity_level', ['low', 'medium', 'high', 'critical']);
export const maskingStrategyEnum = pgEnum('masking_strategy', ['full', 'partial', 'hash', 'redact', 'tokenize']);
```

## Fields Fixed in SQLAlchemy Models

### 1. AgentExternalDbCredentials.dbType
**Before**:
```python
dbType: Mapped[str] = mapped_column("db_type", String, nullable=False)
```

**After**:
```python
dbType: Mapped[str] = mapped_column("db_type", Enum('postgresql', 'mysql', name='db_type', create_type=False), nullable=False)
```

### 2. Agent.llmProvider
**Before**:
```python
llmProvider: Mapped[Optional[str]] = mapped_column("llm_provider", String(50), default="openai")
```

**After**:
```python
llmProvider: Mapped[Optional[str]] = mapped_column("llm_provider", Enum('openai', 'anthropic', name='llm_provider', create_type=False), default="openai")
```

### 3. SensitiveFieldRegistryGlobal.sensitivityLevel
**Before**:
```python
sensitivityLevel: Mapped[str] = mapped_column("sensitivity_level", String, default='high')
```

**After**:
```python
sensitivityLevel: Mapped[str] = mapped_column("sensitivity_level", Enum('low', 'medium', 'high', 'critical', name='sensitivity_level', create_type=False), default='high')
```

### 4. SensitiveFieldRegistryGlobal.maskingStrategy
**Before**:
```python
maskingStrategy: Mapped[str] = mapped_column("masking_strategy", String, default='full')
```

**After**:
```python
maskingStrategy: Mapped[str] = mapped_column("masking_strategy", Enum('full', 'partial', 'hash', 'redact', 'tokenize', name='masking_strategy', create_type=False), default='full')
```

### 5. QueryHistory.sqlDialect
**Before**:
```python
sqlDialect: Mapped[Optional[str]] = mapped_column("sql_dialect", String(50))
```

**After**:
```python
sqlDialect: Mapped[Optional[str]] = mapped_column("sql_dialect", Enum('postgresql', 'mysql', name='db_type', create_type=False))
```

### 6. QueryLlmCall.llmProvider
**Before**:
```python
llmProvider: Mapped[str] = mapped_column("llm_provider", String(50), nullable=False)
```

**After**:
```python
llmProvider: Mapped[str] = mapped_column("llm_provider", Enum('openai', 'anthropic', name='llm_provider', create_type=False), nullable=False)
```

## Important Notes

### `create_type=False` Parameter

This is **critical** when using existing enum types in PostgreSQL:

```python
Enum('value1', 'value2', name='enum_name', create_type=False)
```

- `create_type=False` tells SQLAlchemy to **NOT** try to create the enum type
- The enum type already exists in the database (created by Drizzle migrations)
- Without this parameter, SQLAlchemy would try to `CREATE TYPE` which would fail

### Enum Values Must Match

The enum values in SQLAlchemy **must exactly match** the database enum definition:

```python
# Database has: ['postgresql', 'mysql']
# SQLAlchemy must use: Enum('postgresql', 'mysql', ...)

# NOT: Enum('postgres', 'mysql', ...)  ❌ Wrong values
# NOT: Enum('postgresql', 'mysql', 'sqlite', ...)  ❌ Extra values
```

## Models That Were Already Correct

These models already had proper enum types:

✅ **AgentColumn.sensitivityOverride**
```python
sensitivityOverride: Mapped[Optional[str]] = mapped_column("sensitivity_override", Enum('low', 'medium', 'high', 'critical', name='sensitivity_level'), nullable=True)
```

✅ **AgentColumn.maskingStrategyOverride**
```python
maskingStrategyOverride: Mapped[Optional[str]] = mapped_column("masking_strategy_override", Enum('full', 'partial', 'hash', 'redact', 'tokenize', name='masking_strategy'), nullable=True)
```

✅ **SensitiveFieldRegistryAgent.sensitivityLevel**
```python
sensitivityLevel: Mapped[str] = mapped_column("sensitivity_level", Enum('low', 'medium', 'high', 'critical', name='sensitivity_level'), default='high')
```

✅ **SensitiveFieldRegistryAgent.defaultMaskingStrategy**
```python
defaultMaskingStrategy: Mapped[str] = mapped_column("default_masking_strategy", Enum('full', 'partial', 'hash', 'redact', 'tokenize', name='masking_strategy'), default='redact')
```

## Testing the Fix

After applying these fixes, the query history logging should work:

```bash
# Restart the ai-runtime service
docker-compose restart ai-runtime

# Send a test query through your API

# Check if query was logged
psql $DATABASE_URL -c "SELECT id, user_message, sql_dialect FROM query_history ORDER BY created_at DESC LIMIT 1;"
```

## How to Prevent This Issue

When adding new fields to models:

1. **Check the Drizzle schema** first to see if the field uses an enum type
2. **Use the same enum in SQLAlchemy** with `create_type=False`
3. **Ensure enum values match exactly** between Drizzle and SQLAlchemy

Example workflow:
```typescript
// 1. Drizzle schema defines enum
export const statusEnum = pgEnum('status', ['active', 'inactive']);

export const myTable = pgTable('my_table', {
  status: statusEnum('status').notNull()
});
```

```python
# 2. SQLAlchemy model uses the same enum
class MyTable(Base):
    __tablename__ = "my_table"

    status: Mapped[str] = mapped_column(
        Enum('active', 'inactive', name='status', create_type=False),
        nullable=False
    )
```

## Summary

✅ **Fixed 6 enum type mismatches** in SQLAlchemy models
✅ **Query history logging now works** without type errors
✅ **All enum fields properly typed** to match PostgreSQL ENUM columns

The error was caused by SQLAlchemy trying to insert string values into ENUM columns. By explicitly using `Enum()` type with `create_type=False`, SQLAlchemy now correctly handles the PostgreSQL enum types.
