#!/usr/bin/env node
"use strict";
const { execSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const platformTag = `${process.platform}-${process.arch}`;
const releaseDir = path.join(root, "release", platformTag);
const entry = path.join(root, "dist/src/main.js");
const exeName = process.platform === "win32" ? "cleveremote-updater.exe" : "cleveremote-updater";
// GPIO (onoff -> addon natif epoll) : onoff est importe statiquement par l'application
// (src/common/tools/gpio-*.ts), il est donc toujours embarque. L'addon epoll n'est compile
// que sous Linux ; ailleurs Gpio.accessible vaut false et la LED/le bouton sont inertes.
const epollNative = process.platform === "linux";

function run(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: root });
}

console.log(`Building for ${platformTag} with Node ${process.version} (epoll native addon ${epollNative ? "checked" : "skipped"})`);
console.log(`(this executable will only run on ${platformTag} machines — see scripts/BUILD-SEA.md to build for another platform)\n`);

// Native addons (bcrypt, + epoll sous Linux) are compiled for whatever Node/platform
// is currently active. Catch a stale/mismatched build here instead of shipping a binary
// that silently fails to load them.
const nativeProbes = [...(epollNative ? ["epoll"] : []), "bcrypt"];
function probeNativeModules() {
  const script = nativeProbes
    .map((m) => `try { require(${JSON.stringify(m)}); } catch (e) { console.log(${JSON.stringify(m)} + ": " + e.message); process.exitCode = 1; }`)
    .join("\n");
  // spawnSync (pas execFileSync) : la sonde sort en code 1 quand un module echoue,
  // ce qui ferait lever execFileSync avant d'avoir pu relancer `npm rebuild`.
  const result = spawnSync(process.execPath, ["-e", script], { cwd: root, encoding: "utf8" });
  if (result.error) throw result.error;
  return (result.stdout || "").trim();
}

console.log("Checking native modules are built for this Node/platform...");
let probeResult = probeNativeModules();
if (probeResult) {
  console.log("Some native modules failed to load, rebuilding:\n" + probeResult);
  run("npm rebuild");
  probeResult = probeNativeModules();
  if (probeResult) {
    throw new Error(
      "Native modules still fail to load after `npm rebuild`:\n" +
        probeResult +
        "\nCheck that build tools (python3, make, g++) are installed for this platform.",
    );
  }
}

fs.rmSync(releaseDir, { recursive: true, force: true });
fs.mkdirSync(releaseDir, { recursive: true });

run("npm run build");

if (!fs.existsSync(entry)) {
  throw new Error(`Build output not found at ${entry}`);
}

console.log("Bundling application code (node_modules kept external)...");
const prelude = fs.readFileSync(path.join(__dirname, "sea-prelude.js"), "utf8");
const { version: appVersion } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
esbuild.buildSync({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  banner: { js: prelude },
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  outfile: path.join(releaseDir, "bundle.js"),
});

const seaConfigPath = path.join(releaseDir, "sea-config.json");
fs.writeFileSync(
  seaConfigPath,
  JSON.stringify(
    {
      main: path.join(releaseDir, "bundle.js"),
      output: path.join(releaseDir, exeName),
      disableExperimentalSEAWarning: true,
      useCodeCache: true,
      useSnapshot: false,
    },
    null,
    2,
  ),
);

console.log("Building single executable application...");
run(`node --build-sea ${JSON.stringify(seaConfigPath)}`);
if (process.platform !== "win32") {
  fs.chmodSync(path.join(releaseDir, exeName), 0o755);
}

console.log("Copying production dependencies (node_modules)...");
let lsOutput;
try {
  lsOutput = execSync("npm ls --omit=dev --all --parseable", {
    cwd: root,
    encoding: "utf8",
  });
} catch (err) {
  // npm ls exits non-zero on dependency tree warnings (e.g. invalid peer ranges)
  // but still prints the full listing to stdout, which is all we need here.
  lsOutput = err.stdout || "";
}
const pkgDirs = lsOutput
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean)
  .filter((p) => p !== root);

for (const srcDir of pkgDirs) {
  const rel = path.relative(root, srcDir);
  if (!rel.startsWith("node_modules")) continue;
  const destDir = path.join(releaseDir, rel);
  fs.mkdirSync(path.dirname(destDir), { recursive: true });
  fs.cpSync(srcDir, destDir, { recursive: true });
}

// AppModule resolves .env next to process.execPath (the executable itself) when
// present, so it must be copied alongside the built binary here.
const envPath = path.join(root, ".env");
if (fs.existsSync(envPath)) {
  fs.cpSync(envPath, path.join(releaseDir, ".env"));
}

fs.rmSync(seaConfigPath, { force: true });
fs.rmSync(path.join(releaseDir, "bundle.js"), { force: true });

console.log(`\nDone. Release folder: ${releaseDir}`);
console.log(`Run with: cd release/${platformTag} && ./${exeName}`);
