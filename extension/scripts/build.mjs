// Bundles the TypeScript sources into dist/ for "Load unpacked".
// tsc alone cannot produce this: content scripts and MV3 service workers must be
// single classic scripts (no import statements in the page context).
import { build } from "esbuild";
import { cp, mkdir, rm, readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const watch = process.argv.includes("--watch");

/** @type {import("esbuild").BuildOptions} */
const common = {
  bundle: true,
  format: "iife",
  target: ["chrome116"],
  platform: "browser",
  sourcemap: false,
  minify: !watch,
  // "info" makes esbuild write its timing summary to stderr, which PowerShell
  // surfaces as a scary NativeCommandError even on a successful build.
  logLevel: "warning",
  legalComments: "none",
  define: { __DEV__: String(watch) },
};

async function bundle(entry, outfile, extra = {}) {
  await build({
    ...common,
    ...extra,
    entryPoints: [path.join(root, entry)],
    outfile: path.join(dist, outfile),
  });
  const { size } = await stat(path.join(dist, outfile));
  console.log(`bundled  ${outfile}  (${(size / 1024).toFixed(1)} kb)`);
}

async function copyStatic() {
  const manifest = JSON.parse(
    await readFile(path.join(root, "public", "manifest.json"), "utf8"),
  );
  const pkg = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  manifest.version = pkg.version;
  await writeFile(
    path.join(dist, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  await cp(
    path.join(root, "public", "popup.html"),
    path.join(dist, "popup.html"),
  );
  if (existsSync(path.join(root, "public", "popup.css"))) {
    await cp(
      path.join(root, "public", "popup.css"),
      path.join(dist, "popup.css"),
    );
  }
}

async function main() {
  if (watch) {
    await mkdir(dist, { recursive: true });
  } else {
    await rm(dist, { recursive: true, force: true });
    await mkdir(dist, { recursive: true });
  }
  await Promise.all([
    bundle("src/content.ts", "content.js"),
    bundle("src/background.ts", "background.js"),
    bundle("src/popup/popup.ts", "popup.js"),
  ]);
  await copyStatic();
  console.log("Build complete -> dist/ (Load unpacked: extension/dist)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
