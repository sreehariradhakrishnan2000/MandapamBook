-- Extensions required by the core schema. All are available on Neon and stock Postgres 16.
CREATE EXTENSION IF NOT EXISTS citext;      -- case-insensitive emails
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- fuzzy search on venue names
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- equality operators inside the booking exclusion constraint
