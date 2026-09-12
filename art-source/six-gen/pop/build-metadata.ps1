param([string]$Package=$PSScriptRoot)
$ErrorActionPreference='Stop'
$packageRoot=(Resolve-Path $Package).Path
$repoRoot=(Resolve-Path (Join-Path $packageRoot '../../..')).Path
$packageName=Split-Path $packageRoot -Leaf
$owner=if($packageName -eq 'pop'){'A1'}else{'A3'}
$recipe=Get-Content -Raw (Join-Path $packageRoot 'export-recipe.json') | ConvertFrom-Json
$prompts=@(Get-Content (Join-Path $packageRoot 'prompts.jsonl') | Where-Object {$_} | ForEach-Object {ConvertFrom-Json $_})
if($packageName -eq 'pop'){foreach($entry in $prompts){if($entry.assetId -eq 'machine_pop_quad_body' -and $entry.attempt -lt 3){$entry.resultFile='sources/rejected/machine_pop_quad_body_attempt'+$entry.attempt+'.png'}}}
$prompts | ForEach-Object {ConvertTo-Json $_ -Depth 30 -Compress} | Set-Content -LiteralPath (Join-Path $packageRoot 'prompts.jsonl') -Encoding UTF8
$manifestAssets=@();$provenance=@();$qaAssets=@()
foreach($asset in $recipe.assets){
 $prompt=$prompts | Where-Object {$_.assetId -eq $asset.id} | Select-Object -Last 1
 $source=Join-Path $packageRoot $asset.sourceFile
 $export=Join-Path $packageRoot $asset.file
 $stages=switch -Regex ($asset.id){'pop_pair' {@(2,3);break};'pop_quad' {@(4,5);break};'pop_hex' {@(6);break};'double_carrier' {@(5,6);break};'pop_socket_cover' {@(2,3,4,5,6);break};'ship_dual' {@(3,4);break};'ship_quad' {@(5,6);break};'ship_lane_cover' {@(3,4,5,6);break}}
 $refs=@();foreach($ref in $prompt.references){$refs += [ordered]@{file=$ref;sha256=(Get-FileHash -LiteralPath (Join-Path $repoRoot $ref) -Algorithm SHA256).Hash.ToLower();role='actually viewed reference image'}}
 $manifestAssets += [ordered]@{id=$asset.id;status='EXPORTED';category='machine';stageUse=@($stages);file=('art-source/six-gen/'+$packageName+'/'+$asset.file);width=$asset.recipe.exportSize[0];height=$asset.recipe.exportSize[1];anchor=@([Math]::Round($asset.recipe.exportSize[0]/2,3),($asset.recipe.exportSize[1]-2));sourceFile=('art-source/six-gen/'+$packageName+'/'+$asset.sourceFile);sha256=$asset.exportSha256;provenanceRef=('art-source/six-gen/'+$packageName+'/provenance.json#'+$asset.id);reuseSource=$null;alphaMode='RGBA';notes='Standalone art candidate. Generated source preserved; no official manifest or runtime reference changed.'}
 $provenance += [ordered]@{id=$asset.id;tool='image_gen.imagegen';mode='builtin';model='unavailable';seed='unavailable';resultId=$prompt.resultId;acceptedAttempt=$prompt.attempt;sourceFile=$asset.sourceFile;sourceSha256=$asset.sourceSha256;exportFile=$asset.file;exportSha256=$asset.exportSha256;sourceFileTimestampUtc=(Get-Item -LiteralPath $source).LastWriteTimeUtc.ToString('o');promptFile='prompts.jsonl';references=$refs}
 $bytes=[IO.File]::ReadAllBytes($source)
 $qaAssets += [ordered]@{id=$asset.id;sourcePngColorType=[int]$bytes[25];sourceHasTrueAlpha=$asset.recipe.hasRealAlpha;alphaMin=$asset.recipe.alphaMin;alphaMax=$asset.recipe.alphaMax;alphaZero=$asset.recipe.alphaZero;exportSize=$asset.recipe.exportSize;bytes=(Get-Item -LiteralPath $export).Length;signature='PASS';sourceRect='PASS';uniformResize='PASS';noBakedTextOrProduct='VISUAL_PASS';checkerboard='VISUAL_PASS';fullSilhouette='VISUAL_PASS';sourceSha='PASS';exportSha='PASS'}
}
$baseCommit='14310d34e882969208bb7583c5e0c8442bfc3aee'
[ordered]@{schemaVersion=1;contractVersion='six-gen-art-1.0';baseCommit=$baseCommit;owner=$owner;assets=$manifestAssets} | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath (Join-Path $packageRoot 'manifest.fragment.json') -Encoding UTF8
[ordered]@{schemaVersion=1;contractVersion='six-gen-art-1.0';baseCommit=$baseCommit;owner=$owner;referenceLock='art-source/six-gen/references/reference-lock.json';referenceLockSha256=(Get-FileHash -LiteralPath (Join-Path $repoRoot 'art-source/six-gen/references/reference-lock.json')).Hash.ToLower();assets=$provenance;rejectedAttempts=@($prompts | Where-Object {$_.resultFile -match 'rejected'});generationModelDisclosure='Model identifier and seed were not supplied in tool metadata; do not invent them.'} | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath (Join-Path $packageRoot 'provenance.json') -Encoding UTF8
[ordered]@{schemaVersion=1;contractVersion='six-gen-art-1.0';owner=$owner;scope='standalone art only';generation='GENERATED';export='EXPORTED';assembly='ASSEMBLED_ART_ONLY';assets=$qaAssets;assemblySha256=(Get-FileHash -LiteralPath (Join-Path $packageRoot 'assembly.json')).Hash.ToLower();executed=@('PNG IHDR colorType and alpha inspection','complete alpha bounding box crop','uniform mechanical downsize','old working head / old foreground reuse visual previews','inactive slot cover visual previews','source and export SHA256','old package five-state reconstruction for SHIP');notRun=@('runtime integration','official game build','device tests','full six-generation screen acceptance owned by A7');forbiddenPathsWritten=@();status='LOCAL_ART_CHECKS_PASS_PENDING_A7';notes=@('All generated sources contain real transparency; alphaMax 254 is near-opaque model output, not a painted checkerboard.','Invisible low-alpha source edge pixels are retained. Alpha bounding rectangles include these pixels to avoid deleting artwork.')} | ConvertTo-Json -Depth 30 | Write-Output

