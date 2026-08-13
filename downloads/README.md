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

## Shipping a new version

Build the installer + portable zip as usual (Electron Forge / Squirrel), then run:

```powershell
.\scripts\release.ps1 -Version 0.1.0 `
  -ExePath "C:\path\to\out\make\squirrel.windows\x64\TU Overlays-0.1.0 Setup.exe" `
  -ZipPath "C:\path\to\out\make\zip\win32\x64\TU Overlays-win32-x64-0.1.0.zip" `
  -Notes "What changed in this release."
```

That's the whole release process — it renames the files to the site's naming
convention, uploads them as a GitHub Release, and the site picks up the new
version on its own (usually within a minute, subject to browser/API caching).
No HTML file needs to be touched. See `scripts/release.ps1` for details and a
`-Draft` flag if you want to review on GitHub before it goes live.
