$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $root ".env.local"

if (-not (Test-Path $envFile)) {
  throw ".env.local bulunamadı. STREAM_KEY satırını içeren dosya gerekli."
}

$streamKey = (Get-Content $envFile | Where-Object { $_ -match "^STREAM_KEY=" } | Select-Object -First 1) -replace "^STREAM_KEY=", ""

if ([string]::IsNullOrWhiteSpace($streamKey)) {
  throw ".env.local içinde STREAM_KEY boş görünüyor."
}

docker build -t nobkfilm-live $root

docker run --rm `
  -e STREAM_KEY="$streamKey" `
  -p 7860:7860 `
  -p 8189:8189/tcp `
  -p 8189:8189/udp `
  nobkfilm-live
