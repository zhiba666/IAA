$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$artWorkspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$artRoot = Join-Path $artWorkspace 'art-source\six-gen'
$artDestination = Join-Path $artRoot 'delivery'
New-Item -ItemType Directory -Path $artDestination -Force | Out-Null
$artArchivePath = Join-Path $artDestination 'IAA_六代美术_仅资源_20260910.zip'
if (Test-Path -LiteralPath $artArchivePath) { throw 'Delivery archive already exists; use a new versioned name.' }
$artFiles = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$artReviewedFiles = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$artReview = Get-Content -LiteralPath (Join-Path $artRoot 'qa\final-independent-review.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($artReviewed in $artReview.reviewedArtifacts) {
    [void]$artReviewedFiles.Add([System.IO.Path]::GetFullPath((Join-Path $artWorkspace $artReviewed.file)))
    [void]$artReviewedFiles.Add([System.IO.Path]::GetFullPath((Join-Path $artWorkspace ([System.IO.Path]::ChangeExtension($artReviewed.file,'.json')))))
}
Get-ChildItem -LiteralPath $artRoot -Recurse -File | ForEach-Object {
    $artRel = $_.FullName.Substring($artRoot.Length + 1)
    $artPreviewSelected = $artRel -notmatch '^qa\\previews\\' -or $artReviewedFiles.Contains($_.FullName)
    if ($artRel -notmatch '^delivery\\|^qa\\compression-experiment\\' -and $_.Extension -ne '.svg' -and $artPreviewSelected) { [void]$artFiles.Add($_.FullName) }
}
$artManifest = Get-Content -LiteralPath (Join-Path $artRoot 'integration\manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($artAsset in $artManifest.assets) { [void]$artFiles.Add([System.IO.Path]::GetFullPath((Join-Path $artWorkspace $artAsset.sourceFile))) }
$artReferences = Get-Content -LiteralPath (Join-Path $artRoot 'references\reference-lock.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($artReference in $artReferences.files) { [void]$artFiles.Add([System.IO.Path]::GetFullPath((Join-Path $artWorkspace $artReference.path))) }
[void]$artFiles.Add((Join-Path $artWorkspace 'art-source\batch-0\STYLE_SPEC.md'))
$artRecords = @()
$artArchive = [System.IO.Compression.ZipFile]::Open($artArchivePath,[System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($artFile in ($artFiles | Sort-Object)) {
        if (-not $artFile.StartsWith($artWorkspace + '\',[System.StringComparison]::OrdinalIgnoreCase)) { throw ('Out of workspace: ' + $artFile) }
        if (-not (Test-Path -LiteralPath $artFile -PathType Leaf)) { throw ('Missing: ' + $artFile) }
        $artEntry = $artFile.Substring($artWorkspace.Length + 1).Replace('\','/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($artArchive,$artFile,$artEntry,[System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        $artRecords += @{ path=$artEntry; bytes=(Get-Item -LiteralPath $artFile).Length; sha256=(Get-FileHash -LiteralPath $artFile -Algorithm SHA256).Hash.ToLowerInvariant() }
    }
    $artStartEntry = $artArchive.CreateEntry('START_HERE.txt')
    $artStartWriter = [System.IO.StreamWriter]::new($artStartEntry.Open(),[System.Text.UTF8Encoding]::new($false))
    $artStartWriter.WriteLine('IAA 六代美术资源交付。先阅读 art-source/six-gen/README.md。最终84张PNG位于 art-source/six-gen/integration/exports；总览位于 art-source/six-gen/reports/gallery/contact-sheet.png。只做美术，无游戏代码接入。')
    $artStartWriter.Dispose()
} finally { $artArchive.Dispose() }
$artVerifyArchive = [System.IO.Compression.ZipFile]::OpenRead($artArchivePath)
$artZipErrors = @()
try {
    foreach ($artRecord in $artRecords) {
        $artEntry = $artVerifyArchive.GetEntry($artRecord.path)
        if ($null -eq $artEntry) { $artZipErrors += $artRecord.path; continue }
        $artStream = $artEntry.Open()
        $artHasher = [System.Security.Cryptography.SHA256]::Create()
        try { $artHash = ([BitConverter]::ToString($artHasher.ComputeHash($artStream))).Replace('-','').ToLowerInvariant() } finally { $artStream.Dispose(); $artHasher.Dispose() }
        if ($artHash -ne $artRecord.sha256) { $artZipErrors += $artRecord.path }
    }
} finally { $artVerifyArchive.Dispose() }
$artPackageReport = @{ archive=$artArchivePath; archiveBytes=(Get-Item -LiteralPath $artArchivePath).Length; sha256=(Get-FileHash -LiteralPath $artArchivePath -Algorithm SHA256).Hash.ToLowerInvariant(); fileCount=$artRecords.Count + 1; verificationErrors=$artZipErrors; files=$artRecords }
$artPackageReport | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $artDestination 'package-verification.json') -Encoding UTF8
$artPackageReport | Select-Object archive,archiveBytes,sha256,fileCount,verificationErrors | ConvertTo-Json -Depth 4
if ($artZipErrors.Count) { throw 'Archive verification failed.' }

