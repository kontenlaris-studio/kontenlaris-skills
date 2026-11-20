---
name: tiny-chess-engine
description: A complete deterministic chess engine in a few KB of dependency-free Python - negamax alpha-beta, transposition table, quiescence, tapered evaluation. Use when an agent needs a small embeddable chess engine or wants to study compact engine design.
---

# Tiny Chess Engine

A self-contained chess engine in pure Python (standard library only), built for the make.fun tiny-chess bounty where the whole engine ships in 3,253 bytes as an lzma+base85 packed payload (`scripts/main.py`); `scripts/engine.py` is the readable unpacked source.

## How it plays

- 0x88 board, incremental Zobrist hashing, tapered evaluation (material + formula piece-square tables, phase-blended king).
- Negamax alpha-beta with transposition table, PVS, null-move pruning, late-move reductions, check extensions, killer moves, MVV-LVA ordering, and quiescence over captures, promotions and check evasions.
- Iterative deepening to a fixed 50,000-node budget per move (about 1.3-2 s on one CPU) - deterministic, never clock-based.
- The chosen move is validated against the legal move list; on any mismatch it falls back to the first legal move.
- Repetition inside the search path scores as a draw, so the engine presses when ahead and repeats when worse.

## Verified results (stated honestly)

- Perft matches known values on six standard positions (startpos perft(4) = 197,281; Kiwipete perft(3) = 97,862), make/unmake restoration asserted over full move trees, tactical tests (mate in 1, hanging queen, knight fork, promotion) pass - see `references/TESTS.md`.
- The current v3 build scored an official dev Elo of 1,810 (5 wins, 1 draw, 0 losses in its dev gauntlet) on make.fun. That is a dev-window figure, not a rating against titled players, and the engine is not Stockfish-class - it is a compact teaching-grade engine.

## Edition note and disclosure

This SkillSafe edition ships `scripts/engine.py` as a pure library: the make.fun harness block (which read the `MAKEFUN_ENV_URL` environment variable and called the contest server's `/game` and `/move` endpoints) is removed, so this file reads no environment variables and makes no network calls - it only plays chess via `choose(fen, legal_moves)`. The full competition build, harness included, is in the GitHub repo. `scripts/main.py` is the packed payload form: it decompresses its embedded engine with lzma and executes it in place, which is the delivery format the competition explicitly allows.

## Using it

Run `python3 scripts/engine.py` for the readable engine, or study `scripts/main.py` to see the packed competition form. Full design notes are in `references/README.md`.

## Commercial licensing

This engine is also available under a perpetual commercial license for embedding in your own products — Indie $149 / Commercial $449 / Studio $1,199, plain-English terms and full catalog: https://kontenlaris-studio.github.io/engine-licensing/ · order via kontenlaris.studio@gmail.com. Installing this skill from the registry stays free under registry terms; the license covers shipping the engine's source inside a commercial product.
