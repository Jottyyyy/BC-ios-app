#!/usr/bin/env node
/*
 * orientation_check.js — the video player may rotate; nothing else may, and it must be audible.
 *
 *     node tools/qa/orientation_check.js
 *
 * WHY THIS EXISTS. Two client bugs on 2026-10-08 — "yung video ayaw ma-landscape kapag maximize"
 * and "yung video wala daw audio" — and neither could have been caught by anything in tools/qa/.
 * A grep across all 44 checks for `AVAudioSession`, `.playback` or `UISupportedInterfaceOrientations`
 * returned nothing. Both bugs were, in the repo's own phrase, true in a comment and false in the
 * code: `VideoScreens.swift` claimed `AVPlayerViewController` and background audio while shipping
 * SwiftUI's `VideoPlayer` over an `.ambient` session.
 *
 * WHAT THIS CAN AND CANNOT DO. There is no Swift compiler on the Windows checkout and no way to
 * instantiate UIKit, so this asserts WIRING, not behaviour: that the declarations exist, agree with
 * each other, and reference each other. Whether iOS honours them is a device check, written down in
 * `docs/tutorial-videos.md`. That is a real limit and saying so is the point — the previous
 * situation was a comment asserting behaviour with nothing checking even the wiring.
 *
 * THE DRIFT THIS GUARDS IS NEWLY POSSIBLE. `ios/project.yml` is the source and
 * `ios/Biyaherong.xcodeproj/project.pbxproj` is generated from it by `xcodegen` — but the generated
 * file is COMMITTED. Editing the source alone changes nothing until someone runs xcodegen on a Mac,
 * and a build that skips it silently ships the old orientation list. §1 fails when they disagree.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

let passed = 0;
const failures = [];
const expect = (cond, what) => { cond ? passed++ : failures.push(what); };

/**
 * Source with `//` and `///` line comments removed.
 *
 * Needed because a doc comment that QUOTES the old broken code — and the one on
 * `VideoPlayerScreen.player` does, deliberately, so the next reader knows what not to do — would
 * otherwise satisfy a "that pattern is gone now" assertion. The check would pass while the bug sat
 * one line below it.
 */
const code = (src) => src.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

/**
 * One struct's source, not the whole file.
 *
 * `VideoLibraryScreen` has its own single-line `.onDisappear { task?.cancel(); task = nil }` and it
 * appears FIRST, so a file-wide match lands on it and the assertion passes having examined the
 * wrong screen entirely. That happened on the first run of this file.
 */
const sliceStruct = (src, name) =>
  (src.match(new RegExp('struct ' + name + ': View \\{[\\s\\S]*?\\n\\}')) || [''])[0];

// ---- 1. the plist list, in both files that declare it ------------------------
{
  const yml = read('ios', 'project.yml');
  const pbx = read('ios', 'Biyaherong.xcodeproj', 'project.pbxproj');

  const ymlMatch = yml.match(/^\s*INFOPLIST_KEY_UISupportedInterfaceOrientations:\s*(.+)$/m);
  expect(!!ymlMatch, 'project.yml declares UISupportedInterfaceOrientations');
  const ymlList = ymlMatch ? ymlMatch[1].trim().split(/\s+/).sort() : [];

  const pbxMatches = [...pbx.matchAll(
    /INFOPLIST_KEY_UISupportedInterfaceOrientations = "?([^";\n]+)"?;/g)];
  expect(pbxMatches.length === 2,
    `the generated project declares the key in 2 build configs, found ${pbxMatches.length}`);

  for (const [i, m] of pbxMatches.entries()) {
    const list = m[1].trim().split(/\s+/).sort();
    expect(JSON.stringify(list) === JSON.stringify(ymlList),
      `project.pbxproj config ${i + 1} has [${list}] but project.yml has [${ymlList}] — `
      + 'run `xcodegen generate`, or the Mac builds the old orientations');
  }

  // The whole point of widening it: without landscape in the plist nothing can ever rotate.
  expect(ymlList.includes('UIInterfaceOrientationLandscapeLeft')
    && ymlList.includes('UIInterfaceOrientationLandscapeRight'),
    'landscape is declared — the plist is an outer bound no runtime API can exceed');
  expect(ymlList.includes('UIInterfaceOrientationPortrait'),
    'and portrait is still declared, since it is what every other screen uses');
  // Widening to iPad is what trips ITMS-90474; this check keeps the pairing honest.
  expect(/TARGETED_DEVICE_FAMILY:\s*"1"/.test(yml),
    'the target is still iPhone-only — landscape plus iPad is the ITMS-90474 trap');
}

// ---- 2. the runtime narrowing, or every screen rotates -----------------------
{
  const app = read('ios', 'App', 'BiyaherongApp.swift');
  expect(/@UIApplicationDelegateAdaptor\(BiyaherongAppDelegate\.self\)/.test(app),
    'BiyaherongApp installs the app delegate — without it the widened plist is unguarded');
  expect(/func application\([\s\S]{0,200}supportedInterfaceOrientationsFor window: UIWindow\?\)/.test(app),
    'the delegate implements supportedInterfaceOrientationsFor');
  expect(/supportedInterfaceOrientationsFor[\s\S]{0,160}OrientationGate\.mask/.test(app),
    'and answers it from OrientationGate.mask, not a literal');

  const gate = read('DemoApp', 'Sources', 'BiyaherongUI', 'OrientationGate.swift');
  expect(/public private\(set\) static var allowsLandscape = false/.test(gate),
    'OrientationGate.allowsLandscape is private(set) and defaults to portrait');
  expect(/allowsLandscape \? \.landscape : \.portrait/.test(gate),
    'the mask is landscape-or-portrait — the source LOCKS landscape rather than permitting it');
  // Skipping this call is why the modern geometry API looks broken: the request is intersected
  // against the controller's cached, stale supported set and silently does nothing.
  expect(/setNeedsUpdateOfSupportedInterfaceOrientations\(\)[\s\S]{0,200}requestGeometryUpdate/.test(gate),
    'set(landscape:) invalidates the cached supported set BEFORE requesting the geometry update');
}

// ---- 3. the player, and the two moments the gate opens and shuts -------------
{
  const vs = read('DemoApp', 'Sources', 'BiyaherongUI', 'VideoScreens.swift');
  const screen = sliceStruct(vs, 'VideoPlayerScreen');
  expect(screen.length > 0, 'VideoPlayerScreen is findable — the rest of §3 and §4 rest on it');

  // SwiftUI's VideoPlayer has no fullscreen callbacks, which is the entire reason for the wrapper.
  expect(/UIViewControllerRepresentable/.test(vs) && /AVPlayerViewController\(\)/.test(vs),
    'the player is AVPlayerViewController — VideoPlayer exposes no fullscreen callbacks');
  expect(/willBeginFullScreenPresentationWithAnimationCoordinator[\s\S]{0,260}OrientationGate\.set\(landscape: true\)/.test(vs),
    'entering fullscreen opens the orientation gate');
  expect(/willEndFullScreenPresentationWithAnimationCoordinator[\s\S]{0,260}OrientationGate\.set\(landscape: false\)/.test(vs),
    'leaving fullscreen shuts it');

  // The source restores portrait on unmount too (play.tsx:76-78): exiting the screen while still
  // fullscreen must not strand the rest of the app in landscape.
  const onDisappear = (screen.match(/\.onDisappear \{[\s\S]*?\n        \}/) || [''])[0];
  expect(onDisappear.includes('OrientationGate.set(landscape: false)'),
    'onDisappear restores portrait — leaving mid-fullscreen must not strand the app in landscape');

  // The player must survive a redraw. Built inline in `body`, every invalidation handed the view a
  // fresh AVPlayer seeked to zero.
  expect(/@State private var player: AVPlayer\?/.test(vs),
    'the AVPlayer is held in @State, not rebuilt inside body on every redraw');
  expect(!/VideoPlayer\(player: AVPlayer\(url:/.test(code(screen)),
    'and is not constructed inline — that is the "video restarts / stalls" bug');
  expect(/controller\.player !== player/.test(vs),
    'updateUIViewController compares by identity; AVPlayer is a reference type and swapping restarts it');
}

// ---- 4. audio: the category follows the screen -------------------------------
{
  const vs = read('DemoApp', 'Sources', 'BiyaherongUI', 'VideoScreens.swift');
  const sound = read('DemoApp', 'Sources', 'BiyaherongUI', 'Sound.swift');

  expect(/static func videoPlayback\(\)[\s\S]{0,300}setCategory\(\.playback\)/.test(sound),
    'AudioSession.videoPlayback sets .playback — .ambient is silenced by the Ring/Silent switch');
  expect(/static func ambient\(\)[\s\S]{0,300}setCategory\(\.ambient, options: \[\.mixWithOthers\]\)/.test(sound),
    'AudioSession.ambient is still the resting category for chess effects');

  const screen = sliceStruct(vs, 'VideoPlayerScreen');
  const onAppear = (screen.match(/\.onAppear \{[\s\S]*?\n        \}/) || [''])[0];
  expect(onAppear.includes('AudioSession.videoPlayback()'),
    'the player claims .playback when it appears');
  const onDisappear = (screen.match(/\.onDisappear \{[\s\S]*?\n        \}/) || [''])[0];
  expect(onDisappear.includes('AudioSession.ambient()'),
    'and gives it back when it leaves — .playback app-wide would play move sounds through a muted phone');

  // There must be exactly one owner of the category. A second setCategory site is how the
  // process-wide value became order-dependent in the first place.
  const uiDir = path.join(ROOT, 'DemoApp', 'Sources', 'BiyaherongUI');
  const offenders = fs.readdirSync(uiDir).filter((f) => f.endsWith('.swift'))
    .filter((f) => f !== 'Sound.swift')
    .filter((f) => /setCategory\(/.test(fs.readFileSync(path.join(uiDir, f), 'utf8')));
  expect(offenders.length === 0,
    `only Sound.swift may set the audio category; also found: ${offenders.join(', ')}`);

  // Background audio was asserted in three places and was never true: `.ambient` is not
  // background-capable and there is no UIBackgroundModes key anywhere in the project.
  const yml = read('ios', 'project.yml');
  const hasBackgroundModes = /UIBackgroundModes/.test(yml);
  expect(!hasBackgroundModes || /setCategory\(\.playback\)/.test(sound),
    'a UIBackgroundModes audio claim would need a background-capable category');
  expect(!/background audio/i.test(code(vs)),
    'VideoScreens no longer claims background audio — there is no UIBackgroundModes key');
}

const result = {
  passed,
  failures,
  ok: failures.length === 0,
  summary: failures.length === 0
    ? `Orientation+Audio: ${passed} wiring invariants hold`
    : `Orientation+Audio: ${passed} held, ${failures.length} FAILED\n`
      + failures.map((f) => '  ✗ ' + f).join('\n'),
};

if (require.main === module) {
  console.log(result.summary);
  process.exit(result.ok ? 0 : 1);
}

module.exports = { selfTest: () => result };
