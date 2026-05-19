param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$RemainingArgs
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Test-Path ".\node_modules")) {
  corepack pnpm install
}

if (-not (Test-Path ".\dist\shuiyuan-mcp.js")) {
  corepack pnpm build
}

node .\dist\shuiyuan-mcp.js @RemainingArgs
