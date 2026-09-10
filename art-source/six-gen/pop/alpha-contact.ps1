param([string]$Package=$PSScriptRoot)
Add-Type -AssemblyName System.Drawing
$packageRoot=(Resolve-Path $Package).Path
$files=@(Get-ChildItem -LiteralPath (Join-Path $packageRoot 'exports') -Filter '*.png')
$canvas=[Drawing.Bitmap]::new(1170,$files.Count*270)
$g=[Drawing.Graphics]::FromImage($canvas)
$g.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$font=[Drawing.Font]::new('Microsoft YaHei',10)
for($row=0;$row -lt $files.Count;$row++){
 $src=[Drawing.Bitmap]::FromFile($files[$row].FullName)
 for($col=0;$col -lt 3;$col++){
  $x=$col*390;$y=$row*270;$g.FillRectangle($(if($col -eq 1){[Drawing.Brushes]::DarkSlateGray}else{[Drawing.Brushes]::White}),$x,$y,390,270)
  if($col -eq 2){for($iy=0;$iy -lt 270;$iy+=18){for($ix=0;$ix -lt 390;$ix+=18){if((([int]($ix/18)+[int]($iy/18))%2) -eq 0){$g.FillRectangle([Drawing.Brushes]::LightGray,($x+$ix),($y+$iy),18,18)}}}}
  $scale=[Math]::Min(350.0/$src.Width,224.0/$src.Height);$dw=[single]($src.Width*$scale);$dh=[single]($src.Height*$scale)
  $g.DrawImage($src,[Drawing.RectangleF]::new([single]($x+(390-$dw)/2),[single]($y+32+(228-$dh)/2),$dw,$dh))
  $g.DrawString($files[$row].BaseName,$font,$(if($col -eq 1){[Drawing.Brushes]::White}else{[Drawing.Brushes]::Black}),[single]($x+8),[single]($y+7))
 }
 $src.Dispose()
}
$canvas.Save((Join-Path $packageRoot 'alpha-three-backgrounds.png'),[Drawing.Imaging.ImageFormat]::Png)
$font.Dispose();$g.Dispose();$canvas.Dispose()
