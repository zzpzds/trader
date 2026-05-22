# Strategy Rename Design

**Date:** 2026-05-22  
**Scope:** Strategy detail page — inline name editing

## Summary

Allow users to rename a strategy from the detail page by clicking the edit icon next to the strategy name. The name switches to an editable input, which saves on Enter or blur, and cancels on Esc.

## UI Behavior

- Detail page header currently shows: `[back] <h1>name</h1> [badges] ... [trigger button]`
- After this change: `[back] <h1>name</h1> [Edit2 icon] [badges] ... [trigger button]`
- Clicking `Edit2` replaces `<h1>` with an `<Input>` pre-filled with the current name, auto-focused
- **Save:** Press Enter or blur (click away) → calls `PUT /api/strategies/[id]` with `{ name }`
- **Cancel:** Press Esc → discard changes, revert to original name
- **Loading state:** Input is disabled while saving; Edit2 icon hidden
- **Error state:** On API failure, revert to original name and show `alert()` with error message

## State

Two new state variables in `StrategyDetailPage`:

```
editingName: boolean          // whether the name input is visible
nameInput: string             // current value of the name input
```

`nameInput` is initialized from `strategy.name` when editing starts.

## API

Reuses existing `PUT /api/strategies/[id]` — already accepts `{ name?: string }` as a partial update.

## Files Changed

- `apps/web/app/strategies/[id]/page.tsx` — only file touched
  - Add `editingName`, `nameInput` state
  - Add `handleRenameSave()` and `handleRenameKeyDown()` handlers
  - Replace static `<h1>` with conditional render: Input when editing, h1 when not
  - Wire `Edit2` icon's `onClick` to enter edit mode

## Out of Scope

- Renaming from the strategy list page
- Validation beyond non-empty check (trimmed)
- Optimistic updates (wait for API response before updating UI)
