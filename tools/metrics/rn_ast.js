/*
 * rn_ast.js — the shared machinery for pulling real numbers out of React Native source.
 *
 * Extracted from `extract_board_styles.js` when the Puzzle Hub needed the same walk over eleven
 * more files. Nothing here is new: it is that file's evaluator, StyleSheet walker and
 * signed-term describer, parameterised over the seed constants and the source file.
 *
 * The refactor is safe by construction — `board_styles.json` must regenerate BYTE-IDENTICAL, and
 * the 371-assertion `analysis-metrics vs RN source` suite asserts the metrics layer against it.
 *
 * Why any of this exists: the written spec for these screens is prose, and prose loses
 * information. Two hand-typed copies of a number agreeing with each other is not verification —
 * that is how the annotation badge shipped in the wrong corner in both languages.
 */
'use strict';

const fs = require('fs');
const path = require('path');

/** Load the sibling repo's own TypeScript. No install, no network. */
function loadTypeScript(frontendRoot) {
  try {
    return require(path.join(frontendRoot, 'node_modules', 'typescript'));
  } catch (e) {
    console.error('FATAL: cannot load typescript from '
      + path.join(frontendRoot, 'node_modules', 'typescript'));
    console.error('The sibling BYAHERONG-COACH-FRONTEND repo (with node_modules) must be present.');
    process.exit(1);
  }
}

function parse(ts, file) {
  return ts.createSourceFile(path.basename(file), fs.readFileSync(file, 'utf8'),
                             ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/** `...StyleSheet.absoluteFillObject` */
const ABSOLUTE_FILL = { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 };

/**
 * An evaluator over one source file's AST.
 *
 * `seed` supplies the free variables the source closes over (SQUARE_SIZE, width, …). Anything it
 * cannot resolve is pushed to `unresolved` rather than guessed — a silent `undefined` in a metrics
 * file is worse than a loud gap.
 */
function createEvaluator(ts, seed) {
  const unresolved = [];

  function evalNode(node, where) {
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;

    // `'relative' as const`
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      return evalNode(node.expression, where);
    }
    if (ts.isParenthesizedExpression(node)) return evalNode(node.expression, where);

    if (ts.isPrefixUnaryExpression(node)) {
      const v = evalNode(node.operand, where);
      if (typeof v !== 'number') return undefined;
      if (node.operator === ts.SyntaxKind.MinusToken) return -v;
      if (node.operator === ts.SyntaxKind.PlusToken) return v;
      return undefined;
    }

    // Pre-seeded module constants: SQUARE_SIZE, width, …
    if (ts.isIdentifier(node)) {
      if (Object.prototype.hasOwnProperty.call(seed, node.text)) return seed[node.text];
      unresolved.push({ where, kind: 'Identifier', text: node.getText() });
      return undefined;
    }

    if (ts.isBinaryExpression(node)) {
      const l = evalNode(node.left, where), r = evalNode(node.right, where);
      // String concatenation is how the RN source builds alpha: `mode.color + '22'`. Keep it —
      // dropping it would silently lose the 13%/33% tints on the hub's mode tiles.
      if (node.operatorToken.kind === ts.SyntaxKind.PlusToken
          && typeof l === 'string' && typeof r === 'string') return l + r;
      if (typeof l !== 'number' || typeof r !== 'number') return undefined;
      switch (node.operatorToken.kind) {
        case ts.SyntaxKind.AsteriskToken: return l * r;
        case ts.SyntaxKind.SlashToken: return l / r;
        case ts.SyntaxKind.PlusToken: return l + r;
        case ts.SyntaxKind.MinusToken: return l - r;
        default:
          unresolved.push({ where, kind: 'BinaryExpression', text: node.getText() });
          return undefined;
      }
    }

    // `Platform.OS === 'ios' ? A : B` — keep the iOS branch; this app ships on iOS.
    if (ts.isConditionalExpression(node)) {
      const cond = node.condition.getText();
      if (/Platform\.OS\s*===\s*'ios'/.test(cond)) return evalNode(node.whenTrue, where);
      if (/Platform\.OS\s*!==\s*'ios'/.test(cond)) return evalNode(node.whenFalse, where);
      unresolved.push({ where, kind: 'ConditionalExpression', text: node.getText().slice(0, 70) });
      return undefined;
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText();
      const m = /^Math\.(floor|round|ceil|abs|min|max)$/.exec(callee);
      if (m) {
        const args = node.arguments.map(a => evalNode(a, where));
        if (args.some(a => typeof a !== 'number')) return undefined;
        return Math[m[1]].apply(null, args);
      }
      unresolved.push({ where, kind: 'CallExpression', text: node.getText().slice(0, 70) });
      return undefined;
    }

    if (ts.isObjectLiteralExpression(node)) return objectOf(node, where);
    if (ts.isArrayLiteralExpression(node)) {
      const out = node.elements.map(e => evalNode(e, where));
      return out.some(v => v === undefined) ? undefined : out;
    }

    unresolved.push({ where, kind: ts.SyntaxKind[node.kind], text: node.getText().slice(0, 70) });
    return undefined;
  }

  function objectOf(obj, where) {
    const out = {};
    for (const p of obj.properties) {
      if (ts.isSpreadAssignment(p)) {
        if (/StyleSheet\.absoluteFillObject/.test(p.expression.getText())) {
          Object.assign(out, ABSOLUTE_FILL);
        } else {
          unresolved.push({ where, kind: 'Spread', text: p.getText() });
        }
        continue;
      }
      if (!ts.isPropertyAssignment(p)) continue;
      const key = p.name.getText().replace(/^['"]|['"]$/g, '');
      const v = evalNode(p.initializer, where + '.' + key);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }

  return { evalNode, objectOf, unresolved };
}

// ---- Signed additive terms --------------------------------------------------------------
//
// The reason this exists rather than a plain number: `renderAnnotationOverlay` puts the badge at
// `pos.y + SQUARE_SIZE * 0.29` — BELOW the centre, because `squareToPixel` returns the centre —
// and both metrics layers were written with a MINUS and then asserted each other's wrong answer.
// Flattening to signed terms lets a consumer assert the DIRECTION of an offset, not only its size.

/** `a + b*2 - c` → `[+a, +b*2, -c]`. */
function additiveTerms(ts, node, sign, out) {
  if (ts.isParenthesizedExpression(node)) return additiveTerms(ts, node.expression, sign, out);
  if (ts.isBinaryExpression(node)) {
    const k = node.operatorToken.kind;
    if (k === ts.SyntaxKind.PlusToken) {
      additiveTerms(ts, node.left, sign, out);
      additiveTerms(ts, node.right, sign, out);
      return out;
    }
    if (k === ts.SyntaxKind.MinusToken) {
      additiveTerms(ts, node.left, sign, out);
      additiveTerms(ts, node.right, -sign, out);
      return out;
    }
  }
  out.push({ sign: sign, node: node });
  return out;
}

/** Describe one leaf: a bare number, a reference, or `ref * k` / `ref / k` / `k * ref`. */
function describeTerm(ts, t) {
  const text = t.node.getText().replace(/\s+/g, ' ');
  const d = { sign: t.sign, text: text };
  if (ts.isNumericLiteral(t.node)) { d.value = Number(t.node.text); return d; }
  if (ts.isIdentifier(t.node) || ts.isPropertyAccessExpression(t.node)) {
    d.ref = text; d.ratio = 1; return d;
  }
  if (ts.isBinaryExpression(t.node)) {
    const op = t.node.operatorToken.kind;
    const l = t.node.left, r = t.node.right;
    const refText = n => (ts.isIdentifier(n) || ts.isPropertyAccessExpression(n)) ? n.getText() : null;
    if (op === ts.SyntaxKind.AsteriskToken) {
      if (refText(l) && ts.isNumericLiteral(r)) { d.ref = refText(l); d.ratio = Number(r.text); return d; }
      if (ts.isNumericLiteral(l) && refText(r)) { d.ref = refText(r); d.ratio = Number(l.text); return d; }
    }
    if (op === ts.SyntaxKind.SlashToken && refText(l) && ts.isNumericLiteral(r)) {
      d.ref = refText(l); d.ratio = 1 / Number(r.text); return d;
    }
  }
  return d;   // opaque: text only, still diffable
}

function describeExpr(ts, node) {
  if (ts.isParenthesizedExpression(node)) return describeExpr(ts, node.expression);
  if (ts.isConditionalExpression(node)) {
    return {
      text: node.getText().replace(/\s+/g, ' '),
      condition: node.condition.getText().replace(/\s+/g, ' '),
      whenTrue: describeExpr(ts, node.whenTrue),
      whenFalse: describeExpr(ts, node.whenFalse),
    };
  }
  return {
    text: node.getText().replace(/\s+/g, ' '),
    terms: additiveTerms(ts, node, 1, []).map(t => describeTerm(ts, t)),
  };
}

// ---- Walkers ------------------------------------------------------------------------------

/**
 * Collect every `const X = StyleSheet.create({…})` and every UPPER_SNAKE module constant.
 *
 * The binding name is kept as the block key, because the RN puzzle screens use both `styles` and
 * a bare `s` and a consumer needs to know which file it is reading.
 */
function collectStyleSheets(ts, sf, ev) {
  const stylesheets = {};
  const moduleConstants = {};

  (function visit(node) {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const name = node.name.getText();

      if (ts.isCallExpression(node.initializer)
          && node.initializer.expression.getText() === 'StyleSheet.create'
          && node.initializer.arguments.length === 1
          && ts.isObjectLiteralExpression(node.initializer.arguments[0])) {
        const block = {};
        for (const p of node.initializer.arguments[0].properties) {
          if (!ts.isPropertyAssignment(p)) continue;
          const key = p.name.getText().replace(/^['"]|['"]$/g, '');
          block[key] = ev.objectOf(p.initializer, name + '.' + key);
        }
        stylesheets[name] = block;
        return;   // do not descend; already consumed
      }

      if (/^[A-Z][A-Z0-9_]*$/.test(name)
          && (ts.isArrayLiteralExpression(node.initializer)
              || ts.isObjectLiteralExpression(node.initializer)
              || ts.isNumericLiteral(node.initializer)
              || ts.isStringLiteral(node.initializer))) {
        const v = ev.evalNode(node.initializer, 'const.' + name);
        if (v !== undefined) moduleConstants[name] = v;
        return;
      }
    }
    ts.forEachChild(node, visit);
  })(sf);

  return { stylesheets, moduleConstants };
}

/** Every `const NAME = <expr>`, every returned object property, and every braced JSX attribute. */
function collectRenderFunction(ts, body) {
  const found = {};
  const jsxCount = {};
  (function walk(n) {
    if (ts.isVariableDeclaration(n) && n.initializer && ts.isIdentifier(n.name)) {
      found[n.name.text] = describeExpr(ts, n.initializer);
    }
    if (ts.isReturnStatement(n) && n.expression && ts.isObjectLiteralExpression(n.expression)) {
      for (const p of n.expression.properties) {
        if (ts.isPropertyAssignment(p)) {
          found['return.' + p.name.getText()] = describeExpr(ts, p.initializer);
        }
      }
    }
    if (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) {
      const tag = n.tagName.getText();
      const idx = (jsxCount[tag] = (jsxCount[tag] || 0));
      jsxCount[tag] += 1;
      for (const a of n.attributes.properties) {
        if (!ts.isJsxAttribute(a) || !a.initializer) continue;
        const attr = a.name.getText();
        if (ts.isStringLiteral(a.initializer)) {
          found[tag + '[' + idx + '].' + attr] = { text: a.initializer.text, literal: a.initializer.text };
        } else if (ts.isJsxExpression(a.initializer) && a.initializer.expression) {
          found[tag + '[' + idx + '].' + attr] = describeExpr(ts, a.initializer.expression);
        }
      }
    }
    ts.forEachChild(n, walk);
  })(body);
  return found;
}

/**
 * Find named render helpers by name — both `const f = (…) => …` and `function f(…) { … }`.
 *
 * The declaration form was missing until the Play vs Coach extraction, and the omission was
 * invisible in the way this repo cares about: `CoachCard` is a function DECLARATION, so its
 * `avatarSize` / `ringSize = avatarSize + 6` / `haloSize = ringSize + 10` were never collected and
 * `renderConstants` came back `{}` for that screen. Nothing failed — the numbers simply were not
 * there to be used, and the stylesheet reached for hand-typed pixels instead.
 */
function findNamedFunctions(ts, sf, names) {
  const out = {};
  (function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
        && names.indexOf(node.name.text) !== -1
        && node.initializer
        && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      out[node.name.text] = collectRenderFunction(ts, node.initializer.body);
      return;
    }
    if (ts.isFunctionDeclaration(node) && node.name && ts.isIdentifier(node.name)
        && names.indexOf(node.name.text) !== -1 && node.body) {
      out[node.name.text] = collectRenderFunction(ts, node.body);
      return;
    }
    ts.forEachChild(node, visit);
  })(sf);
  return out;
}

/**
 * Find every `const renderX = (…) => …` and `squareToPixel`, without being told their names.
 *
 * `extract_board_styles.js` hardcodes its four; eleven puzzle screens with their own helpers each
 * would mean maintaining a list per file, and a helper omitted from that list is silently
 * unextracted — the failure mode is a number nobody notices is missing.
 */
function findRenderLikeFunctions(ts, sf) {
  const out = {};
  (function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
        && /^(render[A-Z]|squareToPixel$|formatTime$)/.test(node.name.text)
        && node.initializer
        && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      out[node.name.text] = collectRenderFunction(ts, node.initializer.body);
      return;
    }
    ts.forEachChild(node, visit);
  })(sf);
  return out;
}

/**
 * Every `style={{ … }}` and `style={[ …, { … } ]}` in the file.
 *
 * The puzzle screens carry 71 of these, and they never reach a StyleSheet, so the walk above is
 * blind to them. Most are genuinely dynamic — `{ color: ratingChange >= 0 ? '#43D97C' : '#FF6B6B' }`,
 * `{ backgroundColor: mode.color + '22' }` — and those are the ones a transcriber gets wrong,
 * because the value only exists as an expression. Each is recorded as signed terms or as a
 * described conditional, keyed by `Tag[n]`, so it is diffable rather than lost.
 */
function collectInlineStyles(ts, sf) {
  const out = {};
  const tagCount = {};
  (function walk(n) {
    if (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) {
      const tag = n.tagName.getText();
      const idx = (tagCount[tag] = (tagCount[tag] || 0));
      tagCount[tag] += 1;
      for (const a of n.attributes.properties) {
        if (!ts.isJsxAttribute(a) || a.name.getText() !== 'style') continue;
        if (!a.initializer || !ts.isJsxExpression(a.initializer) || !a.initializer.expression) continue;
        const e = a.initializer.expression;
        const objects = ts.isArrayLiteralExpression(e)
          ? e.elements.filter(x => ts.isObjectLiteralExpression(x))
          : (ts.isObjectLiteralExpression(e) ? [e] : []);
        objects.forEach((obj, oi) => {
          for (const p of obj.properties) {
            if (!ts.isPropertyAssignment(p)) continue;
            const key = tag + '[' + idx + ']' + (objects.length > 1 ? '{' + oi + '}' : '')
                      + '.' + p.name.getText().replace(/^['"]|['"]$/g, '');
            out[key] = describeExpr(ts, p.initializer);
          }
        });
      }
    }
    ts.forEachChild(n, walk);
  })(sf);
  return out;
}

/**
 * The name of the function a node sits inside, for the enclosing-scope stack.
 *
 * `const foo = () => …`, `function foo()` and `foo() {}` in a class all count; anything anonymous
 * does not push a frame, so the nearest *named* ancestor is what a call reports.
 */
function functionName(ts, n) {
  if (ts.isFunctionDeclaration(n) && n.name) return n.name.text;
  if (ts.isMethodDeclaration(n) && n.name) return n.name.getText();
  if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n))
      && n.parent && ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name)) {
    return n.parent.name.text;
  }
  // `useCallback(() => …, [])` — the name is on the variable the hook's result is assigned to,
  // which is how every handler in these screens is written.
  if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n))
      && n.parent && ts.isCallExpression(n.parent)
      && n.parent.parent && ts.isVariableDeclaration(n.parent.parent)
      && ts.isIdentifier(n.parent.parent.name)) {
    return n.parent.parent.name.text;
  }
  return null;
}

/**
 * Every `playSound('key')` and `playMoveSound(x)`, with the function each sits in.
 *
 * The enclosing name is the whole point: `playSound('gameOver')` means opposite things in
 * `finishPuzzle` and in the failure branch of a move handler, and "which branch" is exactly what
 * the port kept getting wrong. Recording the scope makes "on solve" vs "on run end" checkable
 * instead of remembered.
 */
function collectSoundCalls(ts, sf) {
  const out = [];
  const stack = [];
  (function walk(n) {
    const name = functionName(ts, n);
    if (name) stack.push(name);
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)
        && /^play(Sound|MoveSound)$/.test(n.expression.text)) {
      const a0 = n.arguments[0];
      out.push({
        call: n.expression.text,
        key: a0 && ts.isStringLiteral(a0) ? a0.text : null,
        arg: a0 && !ts.isStringLiteral(a0) ? a0.getText() : null,
        enclosing: stack.length ? stack[stack.length - 1] : null,
        line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
      });
    }
    ts.forEachChild(n, walk);
    if (name) stack.pop();
  })(sf);
  return out;
}

/**
 * Every `setTimeout`/`setInterval`, with its delay.
 *
 * A literal delay resolves to `ms` directly; a named one (`COMPUTER_MOVE_DELAY`) records `msRef`
 * for the caller to resolve against the file's module constants. **Both forms are collected.**
 * Matching only literals looks like it works — four of the five screens use them — and silently
 * drops the one screen that names its constant, which is the exact shape of "the helper omitted
 * from the list is silently unextracted."
 *
 * `abort` marks the network timeouts (`() => controller.abort()`). Recorded rather than skipped so
 * the extraction stays a faithful picture of the source: this app has no network, and the absence
 * of those call sites in the port is itself worth being able to check.
 */
function collectDelays(ts, sf) {
  const out = [];
  (function walk(n) {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)
        && /^set(Timeout|Interval)$/.test(n.expression.text)
        && n.arguments.length >= 2) {
      const d = n.arguments[1];
      const lit = ts.isNumericLiteral(d);
      if (lit || ts.isIdentifier(d)) {
        out.push({
          call: n.expression.text,
          ms: lit ? Number(d.text) : null,
          msRef: lit ? null : d.text,
          callee: calleeLabel(ts, n.arguments[0]),
          abort: /\.abort\s*\(/.test(n.arguments[0].getText()),
          line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
        });
      }
    }
    ts.forEachChild(n, walk);
  })(sf);
  return out;
}

/** What a scheduled callback actually calls — `setTimeout(() => makeComputerMove(…), 500)`. */
function calleeLabel(ts, node) {
  if (!node) return null;
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const body = node.body;
    if (body && ts.isCallExpression(body)) return body.expression.getText();
    if (body && ts.isBlock(body)) {
      // The first call in the block is the one the delay is really for; the rest is bookkeeping.
      for (const st of body.statements) {
        if (ts.isExpressionStatement(st) && ts.isCallExpression(st.expression)) {
          return st.expression.expression.getText();
        }
      }
      return 'block';
    }
  }
  return 'anonymous';
}

/**
 * `hooks/usePuzzleSound.ts` — the puzzle path's whole sound vocabulary.
 *
 * Deliberately narrower than `SoundManager`: four keys, and `playMoveSound` is capture-or-move with
 * no check or castle case. Extracting the union means a screen asking for a fifth name is a test
 * failure rather than a silent no-op.
 */
function collectSoundHook(ts, file) {
  const sf = parse(ts, file);
  const out = { keys: [], assets: {}, moveSoundFlags: [] };
  (function walk(n) {
    if (ts.isTypeAliasDeclaration(n) && n.name.text === 'SoundKey'
        && ts.isUnionTypeNode(n.type)) {
      out.keys = n.type.types
        .filter(t => ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal))
        .map(t => t.literal.text);
    }
    // `gameStart: s0.sound` pairs the key with the require()'d asset in the same object.
    if (ts.isCallExpression(n) && /(^|\.)require$/.test(n.expression.getText())
        && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) {
      const m = /([a-z-]+)\.mp3$/.exec(n.arguments[0].text);
      if (m) out.assets[m[1]] = n.arguments[0].text;
    }
    // `flags.includes('c') || flags.includes('e')` — the capture test, verbatim.
    if (ts.isCallExpression(n) && /\.includes$/.test(n.expression.getText())
        && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) {
      out.moveSoundFlags.push(n.arguments[0].text);
    }
    ts.forEachChild(n, walk);
  })(sf);
  return out;
}

module.exports = {
  ABSOLUTE_FILL, loadTypeScript, parse, createEvaluator,
  additiveTerms, describeTerm, describeExpr,
  collectStyleSheets, collectRenderFunction, findNamedFunctions,
  findRenderLikeFunctions, collectInlineStyles,
  collectSoundCalls, collectDelays, collectSoundHook,
};
