<div align="center">

<img src="public/favicon.svg" alt="JSDecloak" width="120" height="120" />

# JSDecloak

**Beautify. Deobfuscate. Rename.**

A browser workbench for obfuscated JavaScript: pipeline passes, scope-aware renames, no backend.

<br />

<a href="https://jsdecloak.razkom.com" rel="noopener noreferrer" target="_blank" title="Open the hosted JSDecloak app">
  <img
    src="https://img.shields.io/badge/Open_live_app-jsdecloak.razkom.com-4f46e5?style=for-the-badge&logo=googlechrome&logoColor=white&labelColor=1e1b4b"
    alt="Open JSDecloak live app at jsdecloak.razkom.com"
  />
</a>

[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-ff5e5b?logo=ko-fi&logoColor=white)](https://ko-fi.com/razkom)

</div>

---

## How it works

1. Drop a `.js` / `.mjs` / `.cjs` / `.ts` file into the input pane, or paste code and set a filename hint for the parser.
2. Open **pipeline** (or **⌘/Ctrl + Shift + P**) and pick which steps run and in what order: formatter, deobfuscation engine, then AST parse and indexing.
3. **⌘/Ctrl + Enter** runs the pipeline in a Web Worker so the UI stays responsive.
4. Use the **rename queue** or **F2** in the output editor to rename one binding at a time; references update together and respect shadowing (Babel `scope.rename`, not text search).
5. Export a **rename map** (JSON) for reuse on similar files, or save a **project** (`.jsdecloak.json`) that bundles input, renames, pipeline-ish settings, and annotations.

---

## What you get

**Editors:** Monaco on both sides: syntax highlighting, formatting command on the output pane, and rename-in-place on the cleaned code.

**Pipeline:** Reorderable steps with toggles: js-beautify first, then optional deobfuscation, then parse/symbol index. Options cover print width, indent, JSX/TypeScript parse flags, optional **slim AST tree** in the AST tab, and Wakaru “aggressive” mode when that engine is selected.

**Deobfuscation engines:** All client-side; pick one when the deobfuscate step is on:

| Engine | Role |
|--------|------|
| **Webcrack** | Default. Unpacks webpack/browserify-style bundles and applies its own passes; strongest general-purpose choice here. |
| **Synchrony** | Aimed at obfuscator.io-style patterns; often more conservative than Webcrack or Wakaru. |
| **Wakaru** | Broad AST-level restoration; can be the most invasive. If it throws inside the worker, the run **falls back to Webcrack** (check the log). |
| **None** | Skip automated deobfuscation: beautify and parse only, then work manually. |

**Drawer:** Pipeline log, symbol table with reference counts, rename history, and (when enabled) a compact AST view after parse.

**Side panels:** **Strings** scan, **annotations** tied to bindings (they survive renames and save with the project), and a **diff** view between raw input and current output.

**Persistence:** Optional autosave to `localStorage`, session restore, and explicit **Open / Save project** for `.jsdecloak.json`.

---

## Security note

When **Webcrack** runs (either because you selected it or because another engine failed and the worker fell back), it may **evaluate decoder snippets from your input inside the worker**. Only analyze code you trust; treat unknown samples like running untrusted code (network access is still constrained by the browser, but CPU loops or surprising behavior are possible).

---

## Run locally

Requires a current **Node.js**.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build → dist/
npm run preview  # serve dist/
npm run lint
```

---

## Scripts (smoke / checks)

These exercise parsers, renames, engines, or shims without starting Vite:

```bash
node --experimental-vm-modules scripts/smoke.mjs
node scripts/test-webcrack.mjs
node scripts/probe-engines.mjs
node scripts/test-shims.mjs
```

`scripts/smoke-new.mjs` covers newer project/rename/annotation paths via TypeScript loaded with **jiti**; install `jiti` if you want to run that script.

---

## Keyboard

| Shortcut | Action |
|----------|--------|
| **⌘/Ctrl + Enter** | Run pipeline |
| **⌘/Ctrl + Shift + P** | Open pipeline configuration |
| **F2** | Rename binding at cursor (output pane) |
| **Esc** | Close modal |

---

## Heuristics (rename queue)

Identifiers are scored for the queue using patterns such as:

- `^_0x[a-f0-9]{3,}$` → high score  
- `^\$[a-f0-9]{4,}$` → high score  
- `^_{2,}\w*$` → elevated score  
- Very short names with several references in scope → flagged  

---

## Limitations

- **Large inputs** (hundreds of KB+) can take noticeable time; the UI may warn you.  
- **No cloud sync:** use rename-map export or a saved project file to move work between machines.  
- **Bundle size** is intentionally heavy (Babel, engines, Monaco); this is a specialist tool, not a tiny widget.  

---

## Stack

Vite, React 19, TypeScript, Tailwind CSS 4, Monaco, Babel, webcrack, `@wakaru/unminify`, and `deobfuscator` (Synchrony) in a dedicated worker with Node shims for browser compatibility.
