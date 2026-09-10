param([string]$Package=$PSScriptRoot)
Add-Type -AssemblyName System.Drawing
$packageRoot=(Resolve-Path $Package).Path
$repoRoot=(Resolve-Path (Join-Path $packageRoot '../../..')).Path
$assembly=Get-Content -Raw (Join-Path $packageRoot 'assembly.json') | ConvertFrom-Json
$images=@{}
function Get-Art($id){if(!$images.ContainsKey($id)){$file=Join-Path $packageRoot ('exports/'+$id+'.png');if(!(Test-Path -LiteralPath $file)){$file=Join-Path $repoRoot ('assets/art/machines/'+$id+'.png')};if(!(Test-Path -LiteralPath $file)){$file=Join-Path $repoRoot ('assets/art/products/'+$id+'.png')};$images[$id]=[Drawing.Image]::FromFile($file)};return $images[$id]}
function Draw-Art($part){if(!$part){return};$rect=$part.rect;$g.DrawImage((Get-Art $part.id),[Drawing.RectangleF]::new([single]$rect[0],[single]$rect[1],[single]$rect[2],[single]$rect[3]))}
$font=[Drawing.Font]::new('Microsoft YaHei',13)
foreach($rig in $assembly.rigs){
 if($rig.id -match 'single$'){continue}
 $preview=[Drawing.Bitmap]::new([int]$rig.size[0]*2,[int]$rig.size[1]+80)
 $g=[Drawing.Graphics]::FromImage($preview);$g.Clear([Drawing.ColorTranslator]::FromHtml('#f5efe0'));$g.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
 for($panel=0;$panel -lt 2;$panel++){
  $saved=$g.Save();$g.TranslateTransform([single]($panel*$rig.size[0]),50)
  $parts=@($rig.body)
  foreach($slot in $rig.slots){if($panel -eq 0 -or $slot.id -eq 'slot_1'){$parts += $slot.head}else{$parts += $slot.cover}}
  $parts += $rig.fronts
  foreach($part in ($parts | Sort-Object layer)){Draw-Art $part}
  $g.Restore($saved)
 }
 $g.DrawString(($rig.id+' / all heads        |        one head + inactive covers / art only'),$font,[Drawing.Brushes]::DarkSlateGray,15,15)
 $preview.Save((Join-Path $packageRoot ($rig.id+'-rig-preview.png')),[Drawing.Imaging.ImageFormat]::Png)
 $g.Dispose();$preview.Dispose()
}
$font.Dispose();foreach($art in $images.Values){$art.Dispose()}
