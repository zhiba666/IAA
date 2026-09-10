Add-Type -AssemblyName System.Drawing
$packageRoot = $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $packageRoot '../../..')).Path
$preview = [Drawing.Bitmap]::new(860,760)
$graphics = [Drawing.Graphics]::FromImage($preview)
$graphics.Clear([Drawing.ColorTranslator]::FromHtml('#f5efe0'))
$graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$body = [Drawing.Image]::FromFile((Join-Path $packageRoot 'exports/machine_pop_pair_body.png'))
$head = [Drawing.Image]::FromFile((Join-Path $repoRoot 'assets/art/machines/machine_pop_head.png'))
$front = [Drawing.Image]::FromFile((Join-Path $repoRoot 'assets/art/machines/machine_pop_front.png'))
$graphics.DrawImage($body,[Drawing.RectangleF]::new(46,190,768,506))
$graphics.DrawImage($head,[Drawing.RectangleF]::new(157,138,262,253.8125))
$graphics.DrawImage($head,[Drawing.RectangleF]::new(432,238,262,253.8125))
$graphics.DrawImage($front,[Drawing.RectangleF]::new(169,376,248,132.3871))
$graphics.DrawImage($front,[Drawing.RectangleF]::new(448,476,248,132.3871))
$font = [Drawing.Font]::new('Microsoft YaHei',14)
$graphics.DrawString('POP pair - reused heads / guards - art preview only',$font,[Drawing.Brushes]::DarkSlateGray,24,20)
$preview.Save((Join-Path $packageRoot 'pair-head-reuse-preview.png'),[Drawing.Imaging.ImageFormat]::Png)
$font.Dispose();$graphics.Dispose();$preview.Dispose();$body.Dispose();$head.Dispose();$front.Dispose()
