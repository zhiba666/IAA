$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$items=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'export-metrics.json') -Raw | ConvertFrom-Json
$sheet=[Drawing.Bitmap]::new(1600,1460)
$g=[Drawing.Graphics]::FromImage($sheet)
$g.Clear([Drawing.ColorTranslator]::FromHtml('#f5f0e4'))
$g.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$ink=[Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#084d53'))
$muted=[Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#54706f'))
$cream=[Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#fffaf0'))
$check=[Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#e6e7df'))
$font=[Drawing.Font]::new('Microsoft YaHei',15)
$small=[Drawing.Font]::new('Consolas',12)
$title=[Drawing.Font]::new('Microsoft YaHei',30,[Drawing.FontStyle]::Bold)
$g.DrawString('POPCORN FACTORY / MACHINERY 01',$title,$ink,30,24)
$g.DrawString('14 transparent parts | 2 machines / 3 conveyor modules / finished-cup buffer',$font,$muted,34,88)
$i=0
foreach($entry in $items){
  $x=24+($i%4)*394;$y=144+[Math]::Floor($i/4)*313
  $g.FillRectangle($cream,$x,$y,370,295)
  for($yy=0;$yy -lt 224;$yy+=16){for($xx=0;$xx -lt 352;$xx+=16){if((($xx+$yy)/16)%2 -eq 0){$g.FillRectangle($check,$x+8+$xx,$y+8+$yy,16,16)}}}
  $image=[Drawing.Bitmap]::new((Join-Path $taskRoot $entry.path))
  $scale=[Math]::Min(326/$image.Width,212/$image.Height)
  $w=[int]($image.Width*$scale);$h=[int]($image.Height*$scale)
  $g.DrawImage($image,[Drawing.Rectangle]::new([int]($x+(370-$w)/2),[int]($y+12+(212-$h)/2),$w,$h))
  $g.DrawString($entry.id,$small,$ink,$x+12,$y+243)
  $g.DrawString("$($entry.width) x $($entry.height) px / RGBA",$small,$muted,$x+12,$y+265)
  $image.Dispose();$i++
}
$g.DrawString('ARTWORK ONLY - independent exports; no game integration. Editable layout and source sheets included.',$font,$muted,34,1430)
$sheet.Save((Join-Path $PSScriptRoot 'contact-sheet.png'),[Drawing.Imaging.ImageFormat]::Png)
$g.Dispose();$sheet.Dispose();$font.Dispose();$small.Dispose();$title.Dispose();$ink.Dispose();$muted.Dispose();$cream.Dispose();$check.Dispose()
