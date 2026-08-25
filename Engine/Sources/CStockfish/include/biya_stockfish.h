/*
 * biya_stockfish.h — a pure-C door onto Stockfish 18.
 *
 * ## Why pure C, and why so small
 *
 * Swift can import a target whose SOURCES are C++ as long as its PUBLIC header is C. That is the
 * whole reason this file has no `class`, no `std::`, and no templates: it keeps
 * `.interoperabilityMode(.Cxx)` — and the toolchain-version coupling that comes with it — out of the
 * package entirely. `StockfishEngine` imports this the way it would import any C library.
 *
 * It is also small on purpose. Nothing in this repository can compile C++ (`CLAUDE.md`: Windows, no
 * Xcode, no Swift), so every line here is written blind and first proven on a Mac. Everything that
 * can live in Swift instead — score sign conventions, PV parsing, snapshot assembly, limit
 * translation — does, in `StockfishBridge.swift`, where a JS twin and `tools/qa/replay_stockfish.js`
 * can actually assert it. This layer only marshals.
 *
 * ## The one thing that will kill your app
 *
 * `sf/nnue/network.cpp:218` calls **`exit(EXIT_FAILURE)`** when the requested net is not the net that
 * loaded. That is reasonable in a command-line engine and fatal in an iOS app: the process is gone,
 * with no exception, no crash report that reads like a crash, and no way for the UI to say anything.
 * `Engine::go()` calls `verify_networks()` first, so the trigger is the user's FIRST analysis, long
 * after launch — the worst possible moment to discover it.
 *
 * Two things stop it, and both are in `biya_stockfish.cpp`:
 *   1. `biya_sf_start` opens both net files itself before handing Stockfish anything, and refuses
 *      with `BIYA_SF_ERR_NET_MISSING` if either will not open. That is the failure that actually
 *      happens (a resource dropped from the bundle).
 *   2. `verify_networks()` is then called AT STARTUP rather than being left to the first search, via
 *      an `on_verify_networks` listener that THROWS on a message beginning "ERROR:". The throw
 *      unwinds before `exit()` is reached, and start returns `BIYA_SF_ERR_NET_INVALID`.
 *
 * Net files are found by DIRECTORY, not by path: `biya_sf_start` takes the folder holding
 * `nn-c288c895ea92.nnue` and `nn-37f18f62d772.nnue`, and the `EvalFile`/`EvalFileSmall` options keep
 * their built-in defaults, which are exactly those two names. This deliberately avoids
 * `OptionsMap::setoption` for the paths: it re-joins a value on single spaces
 * (`sf/ucioption.cpp:52`), so any path containing a tab, a newline or a double space would be
 * silently rewritten into one that does not exist.
 *
 * Stockfish 18 — Copyright (C) 2004-2026 The Stockfish developers — GPLv3.
 * See Sources/CStockfish/sf/Copying.txt.
 */

#ifndef BIYA_STOCKFISH_H_INCLUDED
#define BIYA_STOCKFISH_H_INCLUDED

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* -- Result codes ------------------------------------------------------------------------------ */

#define BIYA_SF_OK 0
/** `biya_sf_start` was never called, or it failed. */
#define BIYA_SF_ERR_NOT_STARTED 1
/** One of the two net files could not be opened in the directory given. */
#define BIYA_SF_ERR_NET_MISSING 2
/** The net files opened but Stockfish rejected them (wrong version, truncated, corrupt). */
#define BIYA_SF_ERR_NET_INVALID 3
/** The FEN was rejected, or a move in the move list is not legal in the resulting position. */
#define BIYA_SF_ERR_BAD_POSITION 4
/** A C++ exception escaped. The message is available from `biya_sf_last_error`. */
#define BIYA_SF_ERR_INTERNAL 5
/** `biya_sf_start` called twice without a `biya_sf_shutdown`. */
#define BIYA_SF_ERR_ALREADY_STARTED 6

/* -- Score kinds ------------------------------------------------------------------------------- */

/** Centipawns. `score_value` is already normalised — Stockfish's own `cp` number. */
#define BIYA_SF_SCORE_CP 0
/** Mate. `score_value` is signed MOVES (not plies), converted exactly as UCI prints it. */
#define BIYA_SF_SCORE_MATE 1

/* -- One reported line ------------------------------------------------------------------------- */

/**
 * A single `info` report: one multi-PV line at one completed depth.
 *
 * **`score_value` is SIDE-TO-MOVE relative**, which is the UCI convention and NOT the convention of
 * `EngineScore`, which `AnalysisEngine.swift` documents as always White-relative. The flip is done
 * once, in Swift, in `StockfishBridge.whiteRelative(...)` — where a test can see it.
 *
 * `pv` points at storage owned by the callback frame and is invalid the moment the callback
 * returns. Copy it.
 */
typedef struct {
    int32_t  depth;
    int32_t  sel_depth;
    /** 1-based, matching UCI's `multipv`. */
    int32_t  multi_pv;
    /** `BIYA_SF_SCORE_CP` or `BIYA_SF_SCORE_MATE`. */
    int32_t  score_kind;
    int32_t  score_value;
    /** Non-zero when Stockfish flagged this score as a bound rather than an exact value. */
    int32_t  is_lower_bound;
    int32_t  is_upper_bound;
    uint64_t nodes;
    uint64_t time_ms;
    uint64_t nps;
    int32_t  hashfull;
    /** Space-separated UCI moves, NUL-terminated. Never NULL; may be empty. */
    const char* pv;
} biya_sf_info;

/**
 * Called on Stockfish's search thread — NOT the caller's, and never the main thread.
 *
 * Return non-zero to ask the search to stop; it will wind down and `biya_sf_search` will return
 * normally with whatever it had. This is the ONLY cancellation path that reacts faster than
 * `movetime_ms`, so a caller with a responsive-UI deadline should set both.
 */
typedef int32_t (*biya_sf_info_cb)(void* ctx, const biya_sf_info* info);

/* -- Lifecycle --------------------------------------------------------------------------------- */

/**
 * Start the one engine.
 *
 * Stockfish keeps process-wide state (`Bitboards::init`, `Position::init`, a thread pool, a
 * transposition table), so there is exactly one instance per process and every entry point below is
 * serialised on a single lock.
 *
 * @param nets_directory  Folder containing `nn-c288c895ea92.nnue` and `nn-37f18f62d772.nnue`. A
 *                        trailing separator is optional.
 * @param threads         Search threads. Clamped to 1…8. On a phone, 2 is the sane ceiling.
 * @param hash_mb         Transposition table size. Clamped to 1…256. iOS jetsams a hungry app long
 *                        before a desktop would, so keep it small.
 * @return `BIYA_SF_OK`, or one of the `BIYA_SF_ERR_*` codes above.
 */
int32_t biya_sf_start(const char* nets_directory, int32_t threads, int32_t hash_mb);

/** Stop and destroy the engine. Safe to call when not started. */
void biya_sf_shutdown(void);

/** Non-zero once `biya_sf_start` has returned `BIYA_SF_OK`. */
int32_t biya_sf_is_started(void);

/** Stockfish's own version banner, e.g. "Stockfish 18". Valid for the life of the process. */
const char* biya_sf_version(void);

/**
 * The message behind the last non-OK return, or "" if there is none.
 *
 * Valid until the next call into this library. Copy it before doing anything else.
 */
const char* biya_sf_last_error(void);

/* -- Search ------------------------------------------------------------------------------------ */

/**
 * Search one position, blocking until the search ends.
 *
 * The position is given as a FEN plus a list of UCI moves played from it, exactly like UCI's
 * `position fen <fen> moves ...`. Passing the move list rather than a pre-advanced FEN is what lets
 * Stockfish see repetitions, so a draw by repetition scores as one.
 *
 * @param fen           Starting FEN. Must be legal.
 * @param moves         Array of `move_count` UCI move strings, or NULL when `move_count` is 0.
 * @param depth         Depth ceiling, 1…245. 0 means no depth limit (then set a time or node limit).
 * @param multi_pv      Number of lines to report, clamped to 1…8.
 * @param movetime_ms   Wall-clock budget. 0 means none.
 * @param max_nodes     Node budget. 0 means none.
 * @param ctx           Passed back to `cb` untouched.
 * @param cb            May be NULL, in which case the search runs to its limits unreported.
 *
 * At least one of `depth`, `movetime_ms` and `max_nodes` must be non-zero, or this returns
 * `BIYA_SF_ERR_BAD_POSITION` rather than searching until the phone dies.
 */
int32_t biya_sf_search(const char*        fen,
                       const char* const* moves,
                       int32_t            move_count,
                       int32_t            depth,
                       int32_t            multi_pv,
                       int64_t            movetime_ms,
                       int64_t            max_nodes,
                       void*              ctx,
                       biya_sf_info_cb    cb);

/**
 * Drop the transposition table and history between unrelated positions.
 *
 * Analysing a fresh game with a table warmed by a different one is not wrong, but it makes results
 * depend on what was analysed before — and `AnalysisEngine.swift` promises the same request twice
 * returns the same lines. Call this whenever the caller's notion of "a new search" begins.
 */
void biya_sf_new_game(void);

#ifdef __cplusplus
}
#endif

#endif /* BIYA_STOCKFISH_H_INCLUDED */
