# /downloads

This folder is no longer used to host release binaries.

## Why

Early versions of this site planned to commit the installer/portable `.exe`/`.zip`
directly into this folder so GitHub Pages could serve them same-origin. That broke
down once the real Electron build turned out to be ~150 MB per file — well over
GitHub's 100 MB hard limit on committed files.

## Current setup: GitHub Releases

Release files now live on [GitHub Releases](https://github.com/AVAILOFF/TUOverlays/releases)
(up to 2 GB per file, no git history bloat). The site never hardcodes a version,
filename, size or checksum — `index.html`, `download.html` and `changelog.html`
(both `ru` and `en`) all fetch `https://api.github.com/repos/AVAILOFF/TUOverlays/releases`
client-side and render whatever the latest release contains. SHA-256 comes from
GitHub's own `asset.digest` field, computed automatically on upload.

## How publishing actually works: GitHub CLI, not git push

`scripts/release.ps1` (and any manual release) talks to GitHub through the **`gh`
CLI**, not through a git remote. `gh release create` calls the GitHub API directly
over HTTPS using your locally saved `gh auth login` token - it doesn't need this
folder (or the app source folder) to have a configured/working git remote at all.
That's also why it works regardless of which local project folder you run it from.

Requirements: `gh` installed ([cli.github.com](https://cli.github.com/)) and
`gh auth login` run once. If a future release ever needs doing manually instead of
via the script:

```bash
gh release create v0.1.0 "path\to\Setup.exe" "path\to\portable.zip" `
  --repo AVAILOFF/TUOverlays --title "TU Overlays v0.1.0" --notes "What changed."
```

## Changelog: write it as you go, not at release time

`../CHANGELOG.unreleased.md` is a running draft. Add one bullet line there right
after each notable change in the app - while it's still fresh, not when you're
about to ship. Example:

```
- Fixed iRating Changes card background
- Fixed Input overlay font scaling
```

## Shipping a new version

Build the installer + portable zip as usual (Electron Forge / Squirrel), then run:

```powershell
.\scripts\release.ps1 -Version 0.1.0 `
  -ExePath "C:\path\to\out\make\squirrel.windows\x64\TU Overlays-0.1.0 Setup.exe" `
  -ZipPath "C:\path\to\out\make\zip\win32\x64\TU Overlays-win32-x64-0.1.0.zip"
```

No `-Notes` needed - it reads `CHANGELOG.unreleased.md`, uses that as the release
description, and resets the file to empty right after a successful publish (commits
+ pushes that reset automatically). If the file is empty and you didn't pass
`-Notes`, it just asks you to type something on the spot, so a release never goes
out with no description.

That's the whole release process - it renames the files to the site's naming
convention, uploads them as a GitHub Release, and the site picks up the new
version on its own (usually within a minute, subject to browser/API caching).
No HTML file needs to be touched. See `scripts/release.ps1` for details and a
`-Draft` flag if you want to review on GitHub before it goes live (draft releases
don't clear the changelog draft).
