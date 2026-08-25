/*
 * sfconfig.h — the build switches Stockfish's Makefile would have set, for a build with no Makefile.
 *
 * SwiftPM compiles Stockfish's sources directly; `src/Makefile` never runs. That Makefile is where
 * `-DUSE_NEON=8`, `-DIS_64BIT` and friends come from, and **Stockfish does not auto-detect any of
 * them** (`nnue/simd.h:34` keys off `USE_NEON`, never `__ARM_NEON`; `types.h:76` self-defines
 * `IS_64BIT` only for `_WIN64 && _MSC_VER`). Without these, every NNUE evaluation runs the scalar
 * fallback — the engine still plays correct chess, several times slower, with nothing failing.
 *
 * ## Why this is a header and not `.define()` in Package.swift
 *
 * SwiftPM's `.define(..., .when(platforms:))` filters by PLATFORM, and there is no architecture
 * filter. `USE_NEON` on an x86_64 host makes `simd.h` include `<arm_neon.h>` and the build dies; the
 * iOS Simulator on an Intel Mac is exactly that build. Preprocessor `__aarch64__` is the only thing
 * that actually knows, so the decision has to live in C.
 *
 * `sf/types.h` includes this file — that is the ONE line of ours in the vendored tree, and
 * `tools/qa/stockfish_vendor_check.js` fails the gate if it goes missing, because an upgrade that
 * dropped it would look like a clean build and ship a quietly crippled engine.
 *
 * ## What is deliberately NOT enabled
 *
 * `USE_NEON_DOTPROD`. The Makefile pairs it with `-march=armv8.2-a+dotprod`, and a `-march` for an
 * Apple arm64 target has to go through `.unsafeFlags` — which SwiftPM bans outright in any package
 * consumed as a versioned dependency, and which nothing here can compile-test. It is worth roughly
 * 10-20% on NNUE; NEON versus scalar is worth several times that. Take the safe multiple.
 *
 * Stockfish 18 · https://github.com/official-stockfish/Stockfish · GPLv3.
 */

#ifndef BIYA_SFCONFIG_H_INCLUDED
#define BIYA_SFCONFIG_H_INCLUDED

// Release builds only. Stockfish asserts heavily in hot paths (`position.cpp`, `movepick.cpp`) and
// a Debug build of the app would otherwise carry all of them into the search.
#if !defined(DEBUG) && !defined(NDEBUG)
    #define NDEBUG
#endif

// The net is a bundled resource loaded by absolute path (see `biya_stockfish.cpp`), not linked into
// the binary by incbin. Without this, `network.cpp` tries to `INCBIN` a 71 MB file the compiler has
// no path to and the build fails.
#if !defined(NNUE_EMBEDDING_OFF)
    #define NNUE_EMBEDDING_OFF
#endif

#if defined(__aarch64__) || defined(__arm64__) || defined(_M_ARM64)

    #define IS_64BIT
    #define USE_POPCNT
    // 8 = ARMv8 (64-bit). `simd.h:355` and `:368` both test `USE_NEON >= 8`, so the VALUE matters,
    // not just the definition — `#define USE_NEON` alone would silently select the 32-bit paths.
    #define USE_NEON 8

#elif defined(__x86_64__) || defined(_M_X64)

    #define IS_64BIT
    #define USE_POPCNT
    // SSE2 is architecturally guaranteed on x86_64, so this needs no `-m` flag. Anything above it
    // (SSSE3/SSE41/AVX2) would, which is the same `.unsafeFlags` wall as dotprod. Intel Macs are a
    // dev-only path here — the shipping target is arm64 — so the guaranteed baseline is the right
    // trade.
    #define USE_SSE2

#else

    // 32-bit ARM or something unforeseen: correct, scalar, slow. Not a shipping configuration —
    // iOS 17 is arm64-only.
    #define NO_PEXT

#endif

// `pext` is a BMI2 instruction. `types.h` maps it to a no-op unless `USE_PEXT` is set, and nothing
// above sets it, but stating it keeps the intent legible next to the rest.
#if !defined(USE_PEXT) && !defined(NO_PEXT)
    #define NO_PEXT
#endif

#endif  // #ifndef BIYA_SFCONFIG_H_INCLUDED
