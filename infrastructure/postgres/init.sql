-- Enable B-Tree GiST extension for temporal exclusion constraints (double booking prevention)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Enable UUID extension if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
