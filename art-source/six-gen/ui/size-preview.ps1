Add-Type -AssemblyName System.Drawing
$canvas=[Drawing.Bitmap]::new(760,350)
$g=[Drawing.Graphics]::FromImage($canvas);$g.Clear([Drawing.ColorTranslator]::FromHtml('#f5efe0'));$g.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$font=[Drawing.Font]::new('Microsoft YaHei',11)
$ids=@('ui_icon_automation','ui_badge_generation','ui_badge_complete')
for($row=0;$row -lt 3;$row++){
 $img=[Drawing.Image]::FromFile((Join-Path $PSScriptRoot ('exports/'+$ids[$row]+'.png')))
 $g.DrawString($ids[$row],$font,[Drawing.Brushes]::DarkSlateGray,12,[single]($row*110+35))
 for($col=0;$col -lt 3;$col++){$edge=@(32,48,96)[$col];$scale=$edge/[Math]::Max($img.Width,$img.Height);$g.DrawImage($img,[Drawing.RectangleF]::new([single](275+$col*140),[single]($row*110+8),[single]($img.Width*$scale),[single]($img.Height*$scale)))}
 $img.Dispose()
}
$g.DrawString('32 px                    48 px                    96 px   / art preview',$font,[Drawing.Brushes]::DarkSlateGray,270,327)
$canvas.Save((Join-Path $PSScriptRoot 'ui-size-preview.png'),[Drawing.Imaging.ImageFormat]::Png)
$font.Dispose();$g.Dispose();$canvas.Dispose()
