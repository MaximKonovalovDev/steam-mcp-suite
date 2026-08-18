# Glama MCP submit (key: $env:GLAMA_API_KEY — owner-env, never committed)
# Docs: https://glama.ai/docs/api
if (-not $env:GLAMA_API_KEY) { Write-Error "GLAMA_API_KEY missing"; exit 1 }
$body = @{
  name = "steam-mcp-suite"
  repository = "https://github.com/studioai/steam-mcp-suite"
  description = "Steam Mcp Suite — an MCP server."
  keywords = @("steam", "mcp", "suite")
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "https://api.glama.ai/mcp/servers" `
  -Headers @{ Authorization = "Bearer $env:GLAMA_API_KEY" } -Body $body -ContentType "application/json"
