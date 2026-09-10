Add-Type -AssemblyName System.Drawing
$packageRoot=$PSScriptRoot
$repoRoot=(Resolve-Path (Join-Path $packageRoot '../../..')).Path
$assembly=Get-Content -Raw (Join-Path $repoRoot 'art-source/batch-1/core/assembly.json') | ConvertFrom-Json
$images=@{}
foreach($id in @('product_double_tray','product_box_open','product_box_front','product_box_lid','product_cup_empty','product_cup_fill')){$images[$id]=[Drawing.Image]::FromFile((Join-Path $repoRoot ('assets/art/products/'+$id+'.png')))}
$canvas=[Drawing.Bitmap]::new(1600,490)
$graphics=[Drawing.Graphics]::FromImage($canvas)
$graphics.Clear([Drawing.ColorTranslator]::FromHtml('#f5efe0'))
$graphics.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
function Draw-Part($id,$rect){$graphics.DrawImage($images[$id],[Drawing.RectangleF]::new([single]$rect[0],[single]$rect[1],[single]$rect[2],[single]$rect[3]))}
function Get-Clip($points){$path=[Drawing.Drawing2D.GraphicsPath]::new();$array=@();foreach($p in $points){$array += [Drawing.PointF]::new([single]$p[0],[single]$p[1])};$path.AddPolygon([Drawing.PointF[]]$array);return $path}
function Draw-Cup($slot){
 $saved=$graphics.Save();$graphics.TranslateTransform([single]$slot.rect[0],[single]$slot.rect[1]);$scale=[single]$slot.width/104;$graphics.ScaleTransform($scale,$scale)
 Draw-Part 'product_cup_empty' @(0,0,104,128)
 $clip=Get-Clip $assembly.cupProduct.fillClip;$graphics.SetClip($clip,[Drawing.Drawing2D.CombineMode]::Intersect);Draw-Part 'product_cup_fill' $assembly.cupProduct.parts[1].rect;$clip.Dispose();$graphics.Restore($saved)
}
$states=@(@{title='TWO-CUP TRAY / EMPTY';rig='doubleTray';filled=$false;closed=$false},@{title='TWO-CUP TRAY / 2 CUPS';rig='doubleTray';filled=$true;closed=$false},@{title='FOUR-CUP BOX / EMPTY';rig='fourCupBox';filled=$false;closed=$false},@{title='FOUR-CUP BOX / 4 CUPS';rig='fourCupBox';filled=$true;closed=$false},@{title='FOUR-CUP BOX / CLOSED';rig='fourCupBox';filled=$false;closed=$true})
$font=[Drawing.Font]::new('Microsoft YaHei',10)
for($index=0;$index -lt $states.Count;$index++){
 $state=$states[$index];$rig=$assembly.($state.rig);$saved=$graphics.Save();$graphics.TranslateTransform([single]($index*320),54);$graphics.ScaleTransform(2,2)
 Draw-Part $rig.parts[0].id $rig.parts[0].rect
 if($state.filled){foreach($slot in $rig.slots){Draw-Cup $slot}}
 if($state.rig -eq 'doubleTray'){$frontSaved=$graphics.Save();$clip=Get-Clip $rig.frontOcclusionClip;$graphics.SetClip($clip,[Drawing.Drawing2D.CombineMode]::Intersect);Draw-Part 'product_double_tray' $rig.parts[1].rect;$clip.Dispose();$graphics.Restore($frontSaved)}else{Draw-Part 'product_box_front' $rig.parts[1].rect;if($state.closed){Draw-Part 'product_box_lid' $rig.parts[2].rect}}
 $graphics.Restore($saved);$graphics.DrawString($state.title,$font,[Drawing.Brushes]::DarkSlateGray,[single]($index*320+16),25)
}
$graphics.DrawString('REUSED ORIGINAL PNG LAYERS - ART PREVIEW ONLY, NOT RUNTIME VALIDATION',$font,[Drawing.Brushes]::DarkSlateGray,16,460)
$canvas.Save((Join-Path $packageRoot 'packaging-reuse-preview.png'),[Drawing.Imaging.ImageFormat]::Png)
$font.Dispose();$graphics.Dispose();$canvas.Dispose();foreach($image in $images.Values){$image.Dispose()}
