[![make.fun · github-core-clone-01](https://make.fun/badge/github-core-clone-01.svg)](https://make.fun/bounty/github-core-clone-01?utm_source=github&utm_medium=readme&utm_campaign=github-core-clone-01)
[![rank](https://make.fun/badge/github-core-clone-01/kontenlaris-studio/git-forge-02/rank.svg)](https://make.fun/bounty/github-core-clone-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=github-core-clone-01)
[![reward](https://make.fun/badge/github-core-clone-01/kontenlaris-studio/git-forge-02/reward.svg)](https://make.fun/bounty/github-core-clone-01?utm_source=github&utm_medium=readme&utm_campaign=github-core-clone-01)

# github-core-clone-01 — Git Forge, Gen 2

A GitHub-compatible git forge in dependency-free TypeScript (Node standard library
only), built for [the contest](https://make.fun/bounty/github-core-clone-01). One
process serves four surfaces over a single in-memory store:

- **Git smart HTTP** at `/{owner}/{repo}.git` — protocol v2 (capability advertisement,
  `ls-refs`, `fetch` with shallow/deepen support) and v0 fetch fallback; `receive-pack`
  with report-status, fast-forward-only enforcement and per-ref ok/ng lines. Pure
  TypeScript object store: SHA-1 ids, packfile read (OFS/REF deltas) and write, no git
  binary anywhere.
- **REST v3** under `/api/v3` — repositories, contents (real commits behind the API),
  branches, git refs, labels, issues, comments, pull requests with real three-way
  merges (squash or merge commit).
- **GraphQL v4** at `/api/graphql` — a compact hand-written parser/executor covering
  the documents `gh` and `github-mcp-server` send, global node ids, connections with
  cursor pagination, mutations, operation batching, and the pinned introspection
  surface.
- **MCP** at `/mcp` — stateless JSON-RPC: `server/discover`, `initialize`,
  `tools/list`, `tools/call` with six repository tools sharing the same store.

## Run it

```sh
node --experimental-strip-types main.ts
```

`main.ts` binds an ephemeral port, registers it with `$MAKEFUN_ENV_URL/register`,
long-polls `$MAKEFUN_ENV_URL/done`, and exits 0. Requests to the API surfaces carry
`Authorization: Bearer $MAKEFUN_SHOP_TOKEN`; the token's owner is the forge's only
user, and repositories live under that login. Timestamps come from a deterministic
logical clock, so replays are byte-stable.

## Layout

- `main.ts` — lifecycle harness (registration, done-poll, exit).
- `app.ts` — HTTP server and routing.
- `store.ts` — in-memory data model.
- `gitcore.ts` — object hashing, packfiles, trees/commits, ancestry, merges, diffs.
- `githttp.ts` — smart HTTP protocol (pkt-lines, advertisements, fetch, receive-pack).
- `repops.ts` — branch/contents/pull-request operations shared by all surfaces.
- `rest.ts` — REST v3 routes and serializers.
- `gql.ts` — GraphQL parser, executor, schema and introspection.
- `mcp.ts` — MCP JSON-RPC endpoint and tools.
- `ids.ts` — opaque global object ids.
