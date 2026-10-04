import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const json = (path) => JSON.parse(read(path));
const requested = process.argv[2];
if (requested !== "--check") {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(requested ?? ""))
    throw new Error("Usage: npm run version:set -- <semver>");
  if (!process.env.npm_execpath) throw new Error("Run this command through npm run version:set.");
  // npm owns package-lock metadata; Cargo owns Cargo.lock. No repository-wide replacements.
  execFileSync(
    process.execPath,
    [
      process.env.npm_execpath,
      "version",
      requested,
      "--no-git-tag-version",
      "--ignore-scripts",
      "--allow-same-version",
    ],
    { cwd: root, stdio: "inherit" },
  );
  const version = json("package.json").version;
  const demo = json("docs/demo/shunhen-demo.json");
  demo.appVersion = version;
  writeFileSync(new URL("../docs/demo/shunhen-demo.json", import.meta.url), `${JSON.stringify(demo, null, 2)}\n`);
  const cargo = read("src-tauri/Cargo.toml");
  const updated = cargo.replace(/(\[package\][\s\S]*?^version\s*=\s*)"[^"]+"/m, `$1"${version}"`);
  if (cargo === updated && !cargo.includes(`version = "${version}"`))
    throw new Error("Cargo package version not found.");
  writeFileSync(new URL("../src-tauri/Cargo.toml", import.meta.url), updated);
  execFileSync("cargo", ["update", "--offline", "--workspace", "--manifest-path", "src-tauri/Cargo.toml"], {
    cwd: root,
    stdio: "inherit",
  });
}

const version = json("package.json").version;
const lock = json("package-lock.json");
const cargoVersion = read("src-tauri/Cargo.toml").match(/\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1];
const cargoLockVersion = read("src-tauri/Cargo.lock").match(
  /\[\[package\]\]\s+name = "focus"\s+version = "([^"]+)"/,
)?.[1];
if (
  [
    lock.version,
    lock.packages[""].version,
    cargoVersion,
    cargoLockVersion,
    json("docs/demo/shunhen-demo.json").appVersion,
  ].some((value) => value !== version) ||
  json("src-tauri/tauri.conf.json").version !== "../package.json"
)
  throw new Error("Application version drift: run npm run version:set -- <version>.");
console.log(`Application versions agree: ${version}`);
