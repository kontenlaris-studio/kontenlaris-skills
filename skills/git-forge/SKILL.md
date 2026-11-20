---
name: git-forge
description: A GitHub-compatible git forge in dependency-free TypeScript - git smart HTTP, REST v3, GraphQL v4 and an MCP endpoint over one in-memory store. Use when an agent needs to build, study or extend a git hosting backend with zero npm dependencies.
---

# Git Forge Gen 2

A GitHub-compatible forge written in pure TypeScript on the Node standard library only - no dependencies, no git binary. One process serves four surfaces over a single in-memory store. Local test evidence: 120/120 functional tests and 15/15 MCP tests passing; official make.fun dev score 937 (performance subscore 134, p50 502 microseconds).

## The four surfaces

- **Git smart HTTP** at `/{owner}/{repo}.git` - protocol v2 (capability advertisement, ls-refs, fetch with shallow/deepen) and v0 fetch fallback; receive-pack with report-status and fast-forward-only enforcement. Pure TypeScript object store: SHA-1 ids, packfile read/write with OFS/REF deltas.
- **REST v3** under `/api/v3` - repositories, contents backed by real commits, branches, refs, labels, issues, comments, and pull requests with real three-way merges (squash or merge commit).
- **GraphQL v4** at `/api/graphql` - a compact hand-written parser/executor covering the documents `gh` and github-mcp-server send, global node ids, cursor-paginated connections, mutations, batching, and the pinned introspection surface.
- **MCP** at `/mcp` - stateless JSON-RPC with six repository tools sharing the same store. The forge is also listed on Glama as a standalone MCP server (`server.ts` + Dockerfile in the repo).

## Layout

`store.ts` data model, `gitcore.ts` objects/packfiles/merges/diffs, `githttp.ts` smart HTTP, `repops.ts` shared repo operations, `rest.ts` REST, `gql.ts` GraphQL, `mcp.ts` MCP, `ids.ts` global ids. The HTTP listener layer (`app.ts`, `server.ts`, `main.ts`) is not shipped in this edition - it is in the GitHub repo, and the surfaces here are exactly what it routes.

## Network and write disclosure

The shipped modules are the forge's protocol surfaces and core: they keep every object in memory and write no files. The HTTP listener layer that writes responses to client sockets (`app.ts`, plus the `server.ts` and `main.ts` entrypoints) is not shipped in this edition; it lives in the GitHub repo.

## Honest limits

The store is in-memory and single-user (the bearer token's owner) by design for the contest harness; it is a protocol-complete reference implementation, not a production host. Full notes in `references/NOTES.md` and `references/README.md`.

## Commercial licensing

This engine is also available under a perpetual commercial license for embedding in your own products — Indie $149 / Commercial $449 / Studio $1,199, plain-English terms and full catalog: https://kontenlaris-studio.github.io/engine-licensing/ · order via kontenlaris.studio@gmail.com. Installing this skill from the registry stays free under registry terms; the license covers shipping the engine's source inside a commercial product.
