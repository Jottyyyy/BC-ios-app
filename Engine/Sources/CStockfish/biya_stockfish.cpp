/*
 * biya_stockfish.cpp — the whole C++ surface of this app, and it is deliberately this short.
 *
 * Read `include/biya_stockfish.h` first; the contract and the `exit(EXIT_FAILURE)` hazard are
 * documented there rather than here. This file only implements it.
 *
 * Stockfish 18 — Copyright (C) 2004-2026 The Stockfish developers — GPLv3.
 */

#include "include/biya_stockfish.h"

#include <algorithm>
#include <exception>
#include <fstream>
#include <memory>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include "sf/bitboard.h"
#include "sf/engine.h"
#include "sf/misc.h"
#include "sf/position.h"
#include "sf/score.h"
#include "sf/search.h"
#include "sf/tune.h"
#include "sf/types.h"
#include "sf/uci.h"
#include "sf/ucioption.h"

namespace {

/** The default net names compiled into this Stockfish. `sf/evaluate.h` is the single source. */
constexpr const char* kBigNet   = EvalFileDefaultNameBig;
constexpr const char* kSmallNet = EvalFileDefaultNameSmall;

/**
 * Everything below is serialised on this.
 *
 * Stockfish is process-global — `Bitboards::init()` fills static tables, `Engine` owns a thread pool
 * and a transposition table, and `Tune` registers into a static registry. Two concurrent searches
 * are not a thing that can be made to work by being careful at this layer.
 */
std::mutex                          g_lock;
std::unique_ptr<Stockfish::Engine>  g_engine;
std::string                         g_lastError;
bool                                g_staticsReady = false;

/** Raised by the verify listener so the unwind beats `exit(EXIT_FAILURE)`. */
struct NetworkRejected : std::runtime_error {
    using std::runtime_error::runtime_error;
};

void set_error(const std::string& message) { g_lastError = message; }

bool file_is_readable(const std::string& path) {
    std::ifstream stream(path, std::ios::binary);
    return stream.good();
}

std::string join_directory(const std::string& directory, const std::string& leaf) {
    if (directory.empty())
        return leaf;
    const char last = directory[directory.size() - 1];
    if (last == '/' || last == '\\')
        return directory + leaf;
    return directory + "/" + leaf;
}

/**
 * Push one option through the same path UCI uses.
 *
 * `OptionsMap` exposes no non-const `operator[]` (`sf/ucioption.h:83` is const-only), so `setoption`
 * is not a stylistic choice — it is the only public way to change a setting, and it is also the path
 * that fires the on-change hooks that resize the thread pool and the hash table.
 */
void set_option(Stockfish::Engine& engine, const std::string& name, const std::string& value) {
    engine.wait_for_search_finished();
    std::istringstream is("name " + name + " value " + value);
    engine.get_options().setoption(is);
}

/**
 * UCI's own score formatting, as numbers instead of text.
 *
 * Mirrors `UCIEngine::format_score` (`sf/uci.cpp:530`) exactly, including the asymmetric mate
 * rounding — `(plies + 1) / 2` when winning, `plies / 2` when losing. Getting that wrong reports a
 * mate in 3 as a mate in 1, which is the sort of thing that looks like a search bug for a week.
 *
 * `InternalUnits` is a misleading name: `Score::Score` (`sf/score.cpp:31`) already ran the value
 * through `UCIEngine::to_cp`, so it holds the normalised centipawns UCI prints.
 */
void fill_score(const Stockfish::Score& score, biya_sf_info& out) {
    using Stockfish::Score;

    if (score.is<Score::Mate>())
    {
        const auto mate = score.get<Score::Mate>();
        out.score_kind  = BIYA_SF_SCORE_MATE;
        out.score_value = (mate.plies > 0 ? (mate.plies + 1) : mate.plies) / 2;
        return;
    }

    if (score.is<Score::Tablebase>())
    {
        // No Syzygy tables are bundled, so this cannot currently fire. Mirrored anyway, because a
        // silently-wrong branch that only wakes up when someone adds tablebases is worse than a
        // branch that was never needed.
        constexpr int   kTablebaseCp = 20000;
        const auto      tb           = score.get<Score::Tablebase>();
        out.score_kind               = BIYA_SF_SCORE_CP;
        out.score_value = tb.win ? (kTablebaseCp - tb.plies) : (-kTablebaseCp - tb.plies);
        return;
    }

    out.score_kind  = BIYA_SF_SCORE_CP;
    out.score_value = score.get<Score::InternalUnits>().value;
}

}  // namespace

extern "C" {

const char* biya_sf_version(void) {
    static const std::string version = Stockfish::engine_version_info();
    return version.c_str();
}

const char* biya_sf_last_error(void) { return g_lastError.c_str(); }

int32_t biya_sf_is_started(void) {
    std::lock_guard<std::mutex> guard(g_lock);
    return g_engine ? 1 : 0;
}

int32_t biya_sf_start(const char* nets_directory, int32_t threads, int32_t hash_mb) {
    std::lock_guard<std::mutex> guard(g_lock);
    set_error("");

    if (g_engine)
    {
        set_error("biya_sf_start called twice; call biya_sf_shutdown first");
        return BIYA_SF_ERR_ALREADY_STARTED;
    }

    const std::string directory = nets_directory ? nets_directory : "";

    // Checked here rather than left to Stockfish, because Stockfish's answer to a missing net is to
    // terminate the process. See the header.
    const std::string bigPath   = join_directory(directory, kBigNet);
    const std::string smallPath = join_directory(directory, kSmallNet);

    if (!file_is_readable(bigPath))
    {
        set_error("cannot open " + bigPath);
        return BIYA_SF_ERR_NET_MISSING;
    }
    if (!file_is_readable(smallPath))
    {
        set_error("cannot open " + smallPath);
        return BIYA_SF_ERR_NET_MISSING;
    }

    try
    {
        if (!g_staticsReady)
        {
            Stockfish::Bitboards::init();
            Stockfish::Position::init();
            g_staticsReady = true;
        }

        // `Engine`'s argument is treated as a path to an EXECUTABLE and reduced to its directory
        // (`CommandLine::get_binary_directory`, `sf/misc.cpp:482`), so a leaf name has to be there
        // for the directory to survive. Nothing ever opens this name.
        auto engine = std::make_unique<Stockfish::Engine>(join_directory(directory, "stockfish"));

        Stockfish::Tune::init(engine->get_options());

        set_option(*engine, "Threads", std::to_string(std::min(std::max(threads, 1), 8)));
        set_option(*engine, "Hash", std::to_string(std::min(std::max(hash_mb, 1), 256)));

        // `EvalFile`/`EvalFileSmall` keep their defaults on purpose — they are already exactly
        // `kBigNet`/`kSmallNet`, and the directory above is what points at them. Assigning a full
        // path here instead would route it through `setoption`, which rewrites whitespace runs.

        engine->set_on_verify_networks([](std::string_view message) {
            const std::string text(message);
            if (text.rfind("ERROR:", 0) == 0)
                throw NetworkRejected(text);
        });

        // Deliberately at STARTUP. `Engine::go` would otherwise run this on the user's first
        // analysis, and the failure mode there is the process disappearing.
        engine->verify_networks();

        g_engine = std::move(engine);
        return BIYA_SF_OK;
    }
    catch (const NetworkRejected& rejected)
    {
        set_error(rejected.what());
        return BIYA_SF_ERR_NET_INVALID;
    }
    catch (const std::exception& failure)
    {
        set_error(failure.what());
        return BIYA_SF_ERR_INTERNAL;
    }
    catch (...)
    {
        set_error("unknown failure starting Stockfish");
        return BIYA_SF_ERR_INTERNAL;
    }
}

void biya_sf_shutdown(void) {
    std::lock_guard<std::mutex> guard(g_lock);
    if (!g_engine)
        return;
    g_engine->stop();
    g_engine->wait_for_search_finished();
    g_engine.reset();
    set_error("");
}

void biya_sf_new_game(void) {
    std::lock_guard<std::mutex> guard(g_lock);
    if (!g_engine)
        return;
    g_engine->search_clear();
}

int32_t biya_sf_search(const char*        fen,
                       const char* const* moves,
                       int32_t            move_count,
                       int32_t            depth,
                       int32_t            multi_pv,
                       int64_t            movetime_ms,
                       int64_t            max_nodes,
                       void*              ctx,
                       biya_sf_info_cb    cb) {
    std::lock_guard<std::mutex> guard(g_lock);
    set_error("");

    if (!g_engine)
    {
        set_error("engine not started");
        return BIYA_SF_ERR_NOT_STARTED;
    }
    if (fen == nullptr || *fen == '\0')
    {
        set_error("empty FEN");
        return BIYA_SF_ERR_BAD_POSITION;
    }
    if (depth <= 0 && movetime_ms <= 0 && max_nodes <= 0)
    {
        // An unbounded search on a phone is a flat battery, so this is an error rather than an
        // "infinite" mode nobody asked for.
        set_error("no depth, time or node limit given");
        return BIYA_SF_ERR_BAD_POSITION;
    }

    try
    {
        std::vector<std::string> moveList;
        moveList.reserve(move_count > 0 ? static_cast<size_t>(move_count) : 0);
        for (int32_t i = 0; i < move_count; ++i)
            if (moves != nullptr && moves[i] != nullptr)
                moveList.emplace_back(moves[i]);

        set_option(*g_engine, "MultiPV", std::to_string(std::min(std::max(multi_pv, 1), 8)));

        // `Engine::set_position` (`sf/engine.cpp:200`) BREAKS out of its loop on the first move it
        // cannot play, leaving a shorter history rather than failing. Callers pass moves from their
        // own legal-move generator, and `tools/qa/replay_stockfish.js` holds them to it.
        g_engine->set_position(fen, moveList);

        struct Relay {
            void*           ctx;
            biya_sf_info_cb cb;
            bool            cancelled;
        } relay{ctx, cb, false};

        Stockfish::Engine* engine = g_engine.get();

        engine->set_on_update_full([&relay, engine](const Stockfish::Engine::InfoFull& info) {
            if (relay.cb == nullptr || relay.cancelled)
                return;

            const std::string pv(info.pv);

            biya_sf_info out{};
            out.depth          = info.depth;
            out.sel_depth      = info.selDepth;
            out.multi_pv       = static_cast<int32_t>(info.multiPV);
            out.is_lower_bound = info.bound == "lowerbound" ? 1 : 0;
            out.is_upper_bound = info.bound == "upperbound" ? 1 : 0;
            out.nodes          = static_cast<uint64_t>(info.nodes);
            out.time_ms        = static_cast<uint64_t>(info.timeMs);
            out.nps            = static_cast<uint64_t>(info.nps);
            out.hashfull       = info.hashfull;
            out.pv             = pv.c_str();
            fill_score(info.score, out);

            if (relay.cb(relay.ctx, &out) != 0)
            {
                relay.cancelled = true;
                engine->stop();
            }
        });

        Stockfish::Search::LimitsType limits;
        // `UCIEngine::parse_limits` (`sf/uci.cpp:185`) sets this before reading anything, and time
        // management measures from it. Leaving it at zero makes every search believe it is already
        // massively overdue.
        limits.startTime = Stockfish::now();
        if (depth > 0)
            limits.depth = std::min(depth, 245);
        if (movetime_ms > 0)
            limits.movetime = static_cast<Stockfish::TimePoint>(movetime_ms);
        if (max_nodes > 0)
            limits.nodes = static_cast<uint64_t>(max_nodes);

        engine->go(limits);
        engine->wait_for_search_finished();

        // The listener captured `relay` and `engine` by reference; both die with this frame.
        engine->set_on_update_full([](const Stockfish::Engine::InfoFull&) {});

        return BIYA_SF_OK;
    }
    catch (const NetworkRejected& rejected)
    {
        set_error(rejected.what());
        return BIYA_SF_ERR_NET_INVALID;
    }
    catch (const std::exception& failure)
    {
        set_error(failure.what());
        return BIYA_SF_ERR_INTERNAL;
    }
    catch (...)
    {
        set_error("unknown failure during search");
        return BIYA_SF_ERR_INTERNAL;
    }
}

}  // extern "C"
