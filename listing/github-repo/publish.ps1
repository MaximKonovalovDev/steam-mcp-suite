# Owner-gated publish (token: $env:GITHUB_TOKEN — never committed)
$ErrorActionPreference = "Stop"
if (-not $env:GITHUB_TOKEN) { Write-Error "GITHUB_TOKEN missing"; exit 1 }
gh repo create studioai/steam-mcp-suite --public --source . --push --description "Steam Mcp Suite."
gh repo edit studioai/steam-mcp-suite --add-topic steam,mcp,suite
Write-Output "pushed: https://github.com/studioai/steam-mcp-suite"
