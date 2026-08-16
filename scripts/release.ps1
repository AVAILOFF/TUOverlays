<#
.SYNOPSIS
  Publishes a new TU Overlays release: uploads the built installer + portable zip to
  GitHub Releases. The site (index.html, download.html, changelog.html, in both
  ru/en) reads GitHub Releases live via the API, so nothing on the site needs to be
  edited by hand after this script finishes - version badges, download links, file
  sizes, SHA-256 and the changelog all update themselves within a minute or two.

  Publishing goes through the "gh" CLI (GitHub API over HTTPS, using your saved
  "gh auth login" token) - NOT git push. No git remote needs to be configured or
  working in this folder or the app source folder; "gh" talks to --repo directly.
  Requires: gh installed (https://cli.github.com/) and "gh auth login" run once.

.PARAMETER Version
  New version number without the "v" prefix, e.g. "0.1.0".

.PARAMETER ExePath
  Path to the built Squirrel installer (...\out\make\squirrel.windows\x64\*.exe).

.PARAMETER ZipPath
  Path to the built portable zip (...\out\make\zip\win32\x64\*.zip).

.PARAMETER Notes
  Release description shown on GitHub and in the site's changelog. Optional - if
  omitted, the script uses CHANGELOG.unreleased.md instead (see below), and if that
  is empty too, it asks you to type something interactively so a release never goes
  out with an empty/placeholder description.

.PARAMETER Repo
  GitHub "owner/repo" to publish to. Defaults to AVAILOFF/TUOverlays.

.PARAMETER Draft
  Create the release as a draft (not visible on the site) so you can review it on
  GitHub before publishing. Run "gh release edit v<Version> --draft=false" when ready.
  CHANGELOG.unreleased.md is NOT cleared for a draft - only on a real publish.

.DESCRIPTION
  Running changelog, zero typing at release time:
  Add a line to CHANGELOG.unreleased.md (repo root) right after each notable change,
  while it's still fresh - e.g. "- Fixed iRating Changes card background". Next time
  you run this script without -Notes, that file's content becomes the release notes
  automatically, and the file is reset to empty right after a successful publish -
  ready for the next round.

.EXAMPLE
  .\scripts\release.ps1 -Version 0.1.0 `
    -ExePath "C:\...\out\make\squirrel.windows\x64\TU Overlays-0.1.0 Setup.exe" `
    -ZipPath "C:\...\out\make\zip\win32\x64\TU Overlays-win32-x64-0.1.0.zip"
#>
param(
  [Parameter(Mandatory)] [string]$Version,
  [Parameter(Mandatory)] [string]$ExePath,
  [Parameter(Mandatory)] [string]$ZipPath,
  [string]$Notes,
  [string]$Repo = "AVAILOFF/TUOverlays",
  [switch]$Draft
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "GitHub CLI (gh) not found. Install it from https://cli.github.com/ and run 'gh auth login' first."
}
if (-not (Test-Path $ExePath)) { throw "Installer not found: $ExePath" }
if (-not (Test-Path $ZipPath)) { throw "Portable zip not found: $ZipPath" }

$repoRoot = Split-Path -Parent $PSScriptRoot
$unreleasedPath = Join-Path $repoRoot "CHANGELOG.unreleased.md"

function Get-UnreleasedNotes {
  if (-not (Test-Path $unreleasedPath)) { return "" }
  $raw = Get-Content -Raw -Encoding UTF8 -Path $unreleasedPath
  # strip <!-- ... --> instructional comment block(s), then trim
  $stripped = [regex]::Replace($raw, "<!--.*?-->", "", "Singleline")
  return $stripped.Trim()
}

$usedUnreleasedFile = $false
if (-not $Notes) {
  $fromFile = Get-UnreleasedNotes
  if ($fromFile) {
    $Notes = $fromFile
    $usedUnreleasedFile = $true
    Write-Host "Using notes from CHANGELOG.unreleased.md:"
    Write-Host "---"
    Write-Host $Notes
    Write-Host "---"
  } else {
    Write-Host "CHANGELOG.unreleased.md is empty and -Notes was not given."
    $Notes = Read-Host "Type release notes now (what changed)"
    if (-not $Notes) { $Notes = "TU Overlays v$Version." }
  }
}

$staging = Join-Path $env:TEMP "tu-overlays-release-$Version"
New-Item -ItemType Directory -Force -Path $staging | Out-Null

$exeDest = Join-Path $staging "TU-Overlays-Setup-$Version.exe"
$zipDest = Join-Path $staging "TU-Overlays-$Version-portable.zip"
Copy-Item $ExePath $exeDest -Force
Copy-Item $ZipPath $zipDest -Force

$exeMb = [math]::Round((Get-Item $exeDest).Length / 1MB, 1)
$zipMb = [math]::Round((Get-Item $zipDest).Length / 1MB, 1)
Write-Host "Staged:"
Write-Host "  $exeDest  ($exeMb MB)"
Write-Host "  $zipDest  ($zipMb MB)"

$tag = "v$Version"
$ghArgs = @(
  "release", "create", $tag,
  $exeDest, $zipDest,
  "--repo", $Repo,
  "--title", "TU Overlays $tag",
  "--notes", $Notes
)
if ($Draft) { $ghArgs += "--draft" }

Write-Host "`nPublishing $tag to $Repo..."
& gh @ghArgs

Remove-Item $staging -Recurse -Force

if ($Draft) {
  Write-Host "`nCreated as DRAFT - not live yet. Review it on GitHub, then run:"
  Write-Host "  gh release edit $tag --repo $Repo --draft=false"
  Write-Host "CHANGELOG.unreleased.md left untouched (only cleared on a real publish)."
} else {
  Write-Host "`nDone. Site will pick up $tag automatically (index.html, download.html, changelog.html all read GitHub Releases live)."
  Write-Host "https://github.com/$Repo/releases/tag/$tag"

  if ($usedUnreleasedFile) {
    $template = @"
<!--
  Draft notes for the next release.
  Add one bullet line here right after each notable change in the app.

  Running scripts\release.ps1 without -Notes uses this file's content (minus
  this comment) as the GitHub release / changelog text, then resets it here
  automatically after a successful publish, ready for the next round.
-->
"@
    Set-Content -Path $unreleasedPath -Value $template -Encoding UTF8
    try {
      Push-Location $repoRoot
      git add CHANGELOG.unreleased.md
      git commit -m "chore: reset changelog draft after $tag" | Out-Null
      git push
      Write-Host "CHANGELOG.unreleased.md reset and pushed."
    } catch {
      Write-Warning "Could not auto-commit the changelog reset ($_). Commit/push CHANGELOG.unreleased.md manually."
    } finally {
      Pop-Location
    }
  }
}
