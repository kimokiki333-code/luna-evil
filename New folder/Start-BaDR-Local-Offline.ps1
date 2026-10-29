$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath($PSScriptRoot)
$prefix = 'http://127.0.0.1:8787/'
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
$mime = @{
  '.html'='text/html; charset=utf-8'; '.htm'='text/html; charset=utf-8'; '.css'='text/css; charset=utf-8';
  '.js'='application/javascript; charset=utf-8'; '.json'='application/json; charset=utf-8'; '.svg'='image/svg+xml';
  '.png'='image/png'; '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'; '.webp'='image/webp'; '.gif'='image/gif';
  '.ico'='image/x-icon'; '.txt'='text/plain; charset=utf-8'; '.md'='text/markdown; charset=utf-8';
  '.woff'='font/woff'; '.woff2'='font/woff2'; '.ttf'='font/ttf'; '.mp4'='video/mp4'; '.mp3'='audio/mpeg';
  '.webm'='video/webm'; '.pdf'='application/pdf'; '.zip'='application/zip'
}
try {
  $listener.Start()
  Write-Host "BaDR local offline site: $prefix" -ForegroundColor Cyan
  Write-Host 'Serving this folder only, bound to 127.0.0.1 (not your network).' -ForegroundColor Gray
  Write-Host 'Keep this window open. Press Ctrl+C to stop.' -ForegroundColor Gray
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
      $request = $context.Request
      $response = $context.Response
      if ($request.HttpMethod -notin @('GET','HEAD')) { $response.StatusCode = 405; $response.Close(); continue }
      $relative = [Uri]::UnescapeDataString($request.Url.AbsolutePath.TrimStart('/')).Replace('/', [IO.Path]::DirectorySeparatorChar)
      if ([string]::IsNullOrWhiteSpace($relative)) { $relative = 'index.html' }
      $file = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $relative))
      if (-not $file.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and $file -ne (Join-Path $root 'index.html')) {
        $response.StatusCode = 403; $response.Close(); continue
      }
      if (Test-Path -LiteralPath $file -PathType Container) { $file = Join-Path $file 'index.html' }
      if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { $response.StatusCode = 404; $response.Close(); continue }
      $ext = [IO.Path]::GetExtension($file).ToLowerInvariant()
      if ($mime.ContainsKey($ext)) { $response.ContentType = $mime[$ext] } else { $response.ContentType = 'application/octet-stream' }
      $bytes = [IO.File]::ReadAllBytes($file)
      $response.ContentLength64 = $bytes.Length
      $response.Headers.Add('Cache-Control','no-cache')
      if ($request.HttpMethod -eq 'GET' -and $bytes.Length -gt 0) { $response.OutputStream.Write($bytes,0,$bytes.Length) }
      $response.Close()
    } catch {
      try { $context.Response.StatusCode = 500; $context.Response.Close() } catch {}
      Write-Host ("Request error: " + $_.Exception.Message) -ForegroundColor Yellow
    }
  }
} catch {
  Write-Host ("Could not start local server: " + $_.Exception.Message) -ForegroundColor Red
  Write-Host 'If port 8787 is already in use, close the other local server first.' -ForegroundColor Yellow
  Read-Host 'Press Enter to close'
} finally {
  if ($listener.IsListening) { $listener.Stop() }
  $listener.Close()
}
