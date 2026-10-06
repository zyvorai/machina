# Choosing the controller's database: SQLite or PostgreSQL

## What it is
The controller keeps all of its state in one database. Two backends are supported from one source tree, chosen when the
controller is built:

- **SQLite (default).** Embedded, zero setup, one file. The right choice for 1 or 2 machines and for evaluations.
- **PostgreSQL.** For large fleets (hundreds of machines), several controllers on different hosts sharing one state store,
  and sites that already run and back up a PostgreSQL service. SQLite has a single writer and one file; PostgreSQL has neither
  limit.

**Status (be clear about what exists).** The PostgreSQL build compiles, and the controller's whole unit-test suite
passes on it against a real PostgreSQL 16 ([claims ledger](../claims.md), C24). It has **not** yet been run as a live controller
managing hosts, and the installer choice and managed Postgres pod described under *Planned* do not exist yet. Until they do,
SQLite is the supported way to run Machina.

## Configure
**SQLite (today, nothing to do).** `DATABASE_URL` defaults to `sqlite:///var/lib/machina/controller.db`. The file is created and
migrated on first start.

**PostgreSQL (development and evaluation of the build).** Build the controller with the `postgres` feature on a Linux host
and give it a `postgres://` URL. The database and role must exist; the controller creates the tables itself.

```bash
cargo build -p machina-controller --release --no-default-features --features postgres
DATABASE_URL=postgres://machina:PASSWORD@db.internal:5432/machina ./target/release/machina-controller
```

| Setting | Meaning |
|---|---|
| `DATABASE_URL` | `sqlite://...` for the default build, `postgres://user:password@host:port/db` for the PostgreSQL build. A build refuses a URL for the other backend and says which binary to run. Passwords are never written to logs. |
| `MACHINA_DB_MAX_CONNECTIONS` | PostgreSQL connection pool size, default 20. (SQLite stays at 4 on purpose: it has one writer.) |

**Planned, not built yet:** an installer choice (`--database sqlite|postgres-pod|postgres-package|postgres-external`), a
Podman-managed Postgres with a generated password and daily dumps, `machinactl db status|backup|switch|migrate-data`, and a
tool to copy an existing SQLite site into PostgreSQL. These are tracked in the database plan; this page will describe them when
they ship.

## Use
Nothing changes for operators or API clients: the REST API, the web UI and `machinactl` behave the same on both backends. The
controller reports which one it runs (planned: in `GET /api/v1/health` as `database_backend`).

For contributors, the rules that keep both backends working are in [CLAUDE.md](../../CLAUDE.md#database-backends): every query goes
through `crate::db::query*`, every schema change is written twice (`controller/migrations` and `controller/migrations_pg`), and
serialized check-then-write sections use `crate::db::begin_write`.

## Check it works
```bash
# SQLite (default build): the suite needs nothing else
cargo test -p machina-controller

# PostgreSQL build: point the tests at a server where the user may create databases
TEST_DATABASE_URL=postgres://machina:machina@127.0.0.1:5432/machina_test \
  cargo test -p machina-controller --no-default-features --features postgres
scripts/db/pg-test-clean.sh     # drop the per-test databases afterwards
```
Each test clones a migrated template database, so the PostgreSQL suite runs in a couple of minutes. Run the Rust build and tests on
a Linux host, not on macOS.

## Limits
- PostgreSQL has not run a live fleet yet; do not choose it for production until the live proof in the claims ledger exists.
- Switching an existing site from SQLite to PostgreSQL needs the data-copy tool, which is not built. Today a new PostgreSQL
  controller starts empty.
- The PostgreSQL build uses a patched copy of the `sqlx-postgres` driver (`vendor/sqlx-postgres/MACHINA_PATCHES.md`) that reads
  integers of any width, JSON and timestamps stored as TEXT, as SQLite does. It is small, reviewed, and must be re-applied when
  sqlx is upgraded.
- A few SQLite-only tests (hand-built tables, write-lock races) run on the SQLite build only.
- Backup and high availability differ: the Litestream pod in [controller-ha.md](../controller-ha.md) is for SQLite; PostgreSQL
  uses `pg_dump`, WAL archiving and the database's own replication.
