# List Command Enhancements

## Summary

Enhance the `list` command to subsume the `ready` command's functionality through composable filter flags. After implementation, delete the `ready` command.

## Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--job <name>` | string (required) | — | Job name |
| `--project-root <path>` | string | `cwd()` | Project root |
| `--after <task-id>` | string | — | Scope to transitive downstream of task |
| `--before <task-id>` | string | — | Scope to transitive upstream of task |
| `--ready` | boolean | `false` | Filter to only ready tasks (pending + all deps terminal) |
| `--status <statuses>` | string (comma-separated) | — | Filter by status(es) |
| `--include-content` | boolean | `false` | Include markdown file content in output |
| `--json` | boolean | `false` | Output as JSON |

`--after` and `--before` are mutually exclusive. All other filters compose via intersection.

## Filter Pipeline

```
all tasks
  → scope by --after/--before (if provided)
  → filter by --status (if provided)
  → filter by --ready (if provided)
  → format output
```

## Output Shape

### JSON

Array of objects:

```typescript
{
  id: string;
  title: string;
  status: TaskStatus;
  complexity: Complexity;
  model: string;             // always included, computed from complexity
  dependencies: string[];
  content?: string;          // only when --include-content
}
```

Model assignment: `low` → `claude-sonnet-4-6`, `medium`/`high` → `claude-opus-4-6`.

### Text

- Default: one-liner per task — `T002: Build foundation [pending] (medium → claude-opus-4-6)`
- With `--include-content`: multi-line with `--- T002: Title [status] ---` header followed by file content

## Backward Compatibility

The old `list` required `--after` or `--before` and always included content. After this change, `list --after T001 --include-content` produces equivalent output. Callers of the old API need to add `--include-content`.

## Ready Command Deprecation

After implementation:
- `ready --job foo --json` becomes `list --job foo --ready --json`
- Delete `ready.ts` and `ready.test.ts`
- Remove registration from `cli.ts`
- Migrate ready tests into `list.test.ts`

## Test Coverage

- No flags → lists all tasks
- `--status pending` → filters correctly
- `--status pending,failed` → multiple statuses
- `--ready` → matches old ready command output
- `--after` + `--ready` → composition works
- `--include-content` → content field present/absent
- `--json` variants for each flag combo
- Empty results messaging
- Model always present in output
