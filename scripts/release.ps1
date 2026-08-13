<#
.SYNOPSIS
  Publishes a new TU Overlays release: uploads the built installer + portable zip to
  GitHub Releases. The site (index.html, download.html, changelog.html, in both
  ru/en) reads GitHub Releases live via the API, so nothing on the site needs to be
  edited by hand after this script finishes - version badges, download links, file
  sizes, SHA-256 and the changelog all update themselves within a minute or two.

.PARAMETER Version
  New version number without the "v" prefix, e.g. "0.1.0".

.PARAMETER ExePath
  Path to the built Squirrel installer (...\out\make\squirrel.windows\x64\*.exe).

.PARAMETER ZipPath
  Path to the built portable zip (...\out\make\zip\win32\x64\*.zip).

.PARAMETER Notes
  Short release description shown on GitHub and in the site's changelog. Optional.

.PARAMETER Draft
  Create the release as a draft (not visible on the site) so you can review it on
  GitHub before publishing. Run "gh release edit v<Version> --draft=false" when ready.

.EXAMPLE
  .\scripts\release.ps1 -Version 0.1.0 `
    -ExePath "C:\...\out\make\squirrel.windows\x64\TU Overlays-0.1.0 Setup.exe" `
    -ZipPath "C:\...\out\make\zip\win32\x64\TU Overlays-win32-x64-0.1.0.zip" `
    -Notes "Added the Radar widget, fixed Fuel Calculator rounding."
#>
param(
  [Parameter(Mandatory)] [string]$Version,
  [Parameter(Mandatory)] [string]$ExePath,
  [Parameter(Mandatory)] [string]$ZipPath,
  [string]$Notes = "TU Overlays v$Version.",
  [string]$Repo = "AVAILOFF/TUOverlays",
  [switch]$Draft
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "GitHub CLI (gh) not found. Install it from https://cli.github.com/ and run 'gh auth login' first."
}
if (-not (Test-Path $ExePath)) { throw "Installer not found: $ExePath" }
if (-not (Test-Path $ZipPath)) { throw "Portable zip not found: $ZipPath" }

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
} else {
  Write-Host "`nDone. Site will pick up $tag automatically (index.html, download.html, changelog.html all read GitHub Releases live)."
  Write-Host "https://github.com/$Repo/releases/tag/$tag"
}
