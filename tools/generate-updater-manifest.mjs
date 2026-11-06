import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    notes: { type: "string" },
    artifact: { type: "string" },
    repository: { type: "string" },
    platform: { type: "string", default: "windows-x86_64" },
    output: { type: "string" },
  },
});
if (!values.notes || !values.artifact || !values.repository || !/^[\w.-]+\/[\w.-]+$/.test(values.repository)) {
  throw new Error(
    "Provide --notes <Markdown file> --artifact <signed installer/AppImage> --repository <owner/repo> [--platform <updater target>] [--output <latest.json>].",
  );
}
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const artifact = resolve(values.artifact);
const { productName } = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
if (values.platform === "windows-x86_64" && basename(artifact) !== `${productName}_${version}_x64-setup.exe`)
  throw new Error("Windows artifact filename must match the current product name and version.");
if (values.platform.startsWith("linux-") && !/\.(AppImage|deb|rpm)$/.test(basename(artifact)))
  throw new Error(
    "Linux updater artifacts must be direct AppImage, deb or rpm files; compressed archives are unsupported.",
  );
if (!existsSync(artifact)) throw new Error("Build the release artifact before generating its manifest.");
if (!basename(artifact).includes(version))
  throw new Error("Artifact filename must contain the current application version.");
const notes = readFileSync(values.notes, "utf8")
  .replace(/^\uFEFF/, "")
  .trim();
const signature = readFileSync(`${artifact}.sig`, "utf8").trim();
if (!notes || !signature) throw new Error("Release notes and the matching updater signature must not be empty.");
const output = values.output ?? join(dirname(artifact), "latest.json");
const previous = existsSync(output) ? JSON.parse(readFileSync(output, "utf8")) : {};
const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    ...(previous.version === version ? previous.platforms : {}),
    [values.platform]: {
      signature,
      url: `https://github.com/${values.repository}/releases/download/v${version}/${encodeURIComponent(basename(artifact))}`,
    },
  },
};
writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(`Generated ${output}. Use the same --notes file as GitHub Release --notes-file.`);
