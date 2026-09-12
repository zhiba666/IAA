$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$sceneBase = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$sceneRepo = (Resolve-Path -LiteralPath (Join-Path $sceneBase '../..')).Path
$sceneOutDir = Join-Path $sceneRepo 'deliverables'
New-Item -ItemType Directory -Force -Path $sceneOutDir | Out-Null
$sceneZip = Join-Path $sceneOutDir 'IAA_v1.3_直售场景美术_20260912.zip'
if (Test-Path -LiteralPath $sceneZip) { throw 'Delivery ZIP already exists; choose a new versioned filename before rebuilding.' }
$sceneFiles = @((Get-ChildItem -LiteralPath $sceneBase -File -Recurse).FullName)
$sceneReuse = Get-Content -LiteralPath (Join-Path $sceneBase 'reuse-manifest.json') -Raw | ConvertFrom-Json
$sceneFiles += @($sceneReuse.assets | ForEach-Object { Join-Path $sceneRepo $_.path })
$sceneArchive = [System.IO.Compression.ZipFile]::Open($sceneZip, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($sceneFile in ($sceneFiles | Sort-Object -Unique)) {
    $sceneFull = (Resolve-Path -LiteralPath $sceneFile).Path
    if (-not $sceneFull.StartsWith($sceneRepo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'File outside workspace' }
    $sceneEntry = $sceneFull.Substring($sceneRepo.Length + 1).Replace('\','/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($sceneArchive, $sceneFull, $sceneEntry, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($sceneArchive, (Join-Path $sceneBase 'START_HERE.md'), 'START_HERE.md', [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
} finally { $sceneArchive.Dispose() }
$sceneCheck = [System.IO.Compression.ZipFile]::OpenRead($sceneZip)
try {
  $sceneExpected = 'art-source/v1.3-scenes/exports/scene_direct_sales_courtyard.png','art-source/v1.3-scenes/qa/scene-overview.png','art-source/v1.3-scenes/index.html','START_HERE.md'
  foreach ($sceneRequired in $sceneExpected) { if (-not $sceneCheck.GetEntry($sceneRequired)) { throw ('Missing ZIP entry: ' + $sceneRequired) } }
  [pscustomobject]@{path=$sceneZip; entries=$sceneCheck.Entries.Count; bytes=(Get-Item -LiteralPath $sceneZip).Length; sha256=(Get-FileHash -LiteralPath $sceneZip -Algorithm SHA256).Hash} | ConvertTo-Json
} finally { $sceneCheck.Dispose() }
