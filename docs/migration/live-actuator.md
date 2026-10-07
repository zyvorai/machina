# Live Migration Actuator

The adaptive engine ([adaptive-engine.md](adaptive-engine.md)) only decides. The actuator applies a decision to a migration that is already running.

## What it does

- `GetMigrationStatus` (agent RPC): job statistics from `virsh domjobinfo --rawstats`.
- `ControlMigration` (agent RPC): bandwidth (`migrate-setspeed`), maximum downtime (`migrate-setmaxdowntime`), switch to post-copy, abort (`domjobabort`), a bounded vCPU quota (`schedinfo`) and restore of the original quota.
- `POST /api/v1/migrations/adaptive/step`: the controller takes a decision from the engine and sends it to the host that owns the VM.

## What it does not do

- **Compression is not applied during a job.** This transport has no safe runtime toggle, so a decision to enable compression is reported, not applied.
- It does not start migrations; the migration itself is still `MigrateVm`.

## Status

Compiled and unit-tested. It has not been run against a real migration, so treat the controls as untested until a drill on a disposable guest has been recorded in `docs/claims.md` (C29).
