import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import metadata from "../package.json";

it("uses the same notes file verbatim and preserves only matching-version platform signatures", () => {
  const directory = mkdtempSync(join(tmpdir(), "focus-manifest-test-"));
  try {
    const artifact = join(directory, `Shunhen_${metadata.version}_x64-setup.exe`),
      notesFile = join(directory, "notes.md"),
      output = join(directory, "latest.json");
    const notes = '# Fixes\n\n- Quotes "work" and paths C:\\notes\n- 日本語';
    writeFileSync(artifact, "test fixture, not an installer");
    writeFileSync(`${artifact}.sig`, "matching-signature");
    writeFileSync(notesFile, notes);
    writeFileSync(
      output,
      JSON.stringify({
        version: metadata.version,
        platforms: { "linux-x86_64": { signature: "linux-signature", url: "https://example.com/app" } },
      }),
    );
    execFileSync(
      process.execPath,
      [
        resolve("tools/generate-updater-manifest.mjs"),
        "--notes",
        notesFile,
        "--artifact",
        artifact,
        "--repository",
        "catcredibly/shunhen",
      ],
      { stdio: "pipe" },
    );
    const manifest = JSON.parse(readFileSync(output, "utf8"));
    expect(manifest.notes).toBe(notes);
    expect(manifest.version).toBe(metadata.version);
    expect(manifest.platforms["windows-x86_64"].signature).toBe("matching-signature");
    expect(manifest.platforms["linux-x86_64"].signature).toBe("linux-signature");
    expect(manifest.platforms["windows-x86_64"].url).toContain(`/v${metadata.version}/Shunhen_${metadata.version}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it.each([
  ["linux-x86_64-appimage", "AppImage", true],
  ["linux-x86_64-deb", "deb", true],
  ["linux-x86_64-appimage", "AppImage.tar.gz", false],
  ["linux-x86_64-appimage", "AppImage.zip", false],
])("validates direct updater artifacts for %s (%s)", (platform, extension, accepted) => {
  const directory = mkdtempSync(join(tmpdir(), "focus-manifest-format-test-"));
  try {
    const artifact = join(directory, `Shunhen_${metadata.version}_amd64.${extension}`);
    const notes = join(directory, "notes.md");
    const output = join(directory, "latest.json");
    writeFileSync(artifact, "test fixture, not an installer");
    writeFileSync(`${artifact}.sig`, "matching-signature");
    writeFileSync(notes, "Security update");
    const generate = () =>
      execFileSync(
        process.execPath,
        [
          resolve("tools/generate-updater-manifest.mjs"),
          "--notes",
          notes,
          "--artifact",
          artifact,
          "--repository",
          "catcredibly/shunhen",
          "--platform",
          platform,
          "--output",
          output,
        ],
        { stdio: "pipe" },
      );
    if (accepted) {
      generate();
      const manifest = JSON.parse(readFileSync(output, "utf8"));
      expect(manifest.platforms[platform].url).toContain(`.${extension}`);
      expect(manifest.platforms[platform].signature).toBe("matching-signature");
    } else {
      expect(generate).toThrow(/compressed archives are unsupported/);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
