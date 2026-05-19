param(
  [switch]$SelfContained
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$OutDir = Join-Path $Root "dist-win"
$Project = Join-Path $Root "packaging\ShuiyuanLauncher\ShuiyuanLauncher.csproj"

Set-Location $Root

if (-not (Test-Path ".\node_modules")) {
  corepack pnpm install
}

corepack pnpm build

if (Test-Path $OutDir) {
  Remove-Item $OutDir -Recurse -Force
}

$publishArgs = @(
  "publish",
  $Project,
  "-c",
  "Release",
  "-r",
  "win-x64",
  "-p:PublishSingleFile=true",
  "-o",
  $OutDir
)

if ($SelfContained) {
  $publishArgs += "--self-contained"
  $publishArgs += "true"
} else {
  $publishArgs += "--self-contained"
  $publishArgs += "false"
}

dotnet @publishArgs

$launcher = Join-Path $OutDir "ShuiyuanLauncher.exe"
Copy-Item $launcher (Join-Path $OutDir "shuiyuan-mcp-login.exe") -Force
Copy-Item $launcher (Join-Path $OutDir "shuiyuan-mcp.exe") -Force
Remove-Item $launcher -Force

Write-Host "Built launchers:"
Write-Host "  $(Join-Path $OutDir 'shuiyuan-mcp-login.exe')"
Write-Host "  $(Join-Path $OutDir 'shuiyuan-mcp.exe')"
