$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$recipe=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'export-recipe.json') -Raw | ConvertFrom-Json
$sheet=[Drawing.Bitmap]::new(1280,900,[Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g=[Drawing.Graphics]::FromImage($sheet)
$g.Clear([Drawing.ColorTranslator]::FromHtml('#f5efe0'))
$g.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode=[Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$font=[Drawing.Font]::new('Segoe UI',12)
$small=[Drawing.Font]::new('Segoe UI',10)
$ink=[Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#07505a'))
$dark=[Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#123f46'))
$pale=[Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#d9eeee'))
$g.DrawString('U02 | 16 icons | native 96 / 32 / 24 px | cream and dark alpha check',$font,$ink,24,14)
for($i=0;$i -lt $recipe.Count;$i++) {
  $item=$recipe[$i];$x=20+($i%4)*315;$y=54+[math]::Floor($i/4)*208
  $g.FillRectangle($pale,$x,$y,300,188)
  $g.DrawString($item.id,$small,$ink,$x+8,$y+6)
  $img=[Drawing.Image]::FromFile((Join-Path $taskRoot $item.path))
  $g.DrawImage($img,[Drawing.Rectangle]::new($x+8,$y+37,96,96))
  $g.DrawImage($img,[Drawing.Rectangle]::new($x+125,$y+46,32,32))
  $g.DrawImage($img,[Drawing.Rectangle]::new($x+181,$y+50,24,24))
  $g.FillRectangle($dark,$x+116,$y+93,100,48)
  $g.DrawImage($img,[Drawing.Rectangle]::new($x+124,$y+101,32,32))
  $g.DrawImage($img,[Drawing.Rectangle]::new($x+182,$y+105,24,24))
  $g.DrawString('96 px         32 px      24 px',$small,$ink,$x+10,$y+157)
  $img.Dispose()
}
$sheet.Save((Join-Path $PSScriptRoot 'contact-sheet.png'),[Drawing.Imaging.ImageFormat]::Png)
$g.Dispose();$sheet.Dispose();$font.Dispose();$small.Dispose();$ink.Dispose();$dark.Dispose();$pale.Dispose()
