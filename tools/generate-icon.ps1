# Rebuild the editable SVG and its 600 x 600 PNG with Windows System.Drawing.
# The primitive shapes and palette extend src/renderer.js; no external assets.
param([string]$OutputDirectory = (Join-Path $PSScriptRoot '..\assets'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$outputPath = [IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($outputPath) | Out-Null
$bitmap = [Drawing.Bitmap]::new(1200, 1200)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$graphics.ScaleTransform(2, 2)
$svg = [Text.StringBuilder]::new()
[void]$svg.AppendLine('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600" role="img" aria-labelledby="title desc">')
[void]$svg.AppendLine('<title id="title">Tiny Popcorn Factory app icon</title><desc id="desc">An overflowing caramel-striped popcorn bucket in front of a small copper cooking pot, on a mint square background.</desc>')
function Color([string]$Hex) { return [Drawing.ColorTranslator]::FromHtml($Hex) }
function Paint($Path, [string]$Fill, [string]$Stroke = '', [single]$Width = 1) {
    $brush = [Drawing.SolidBrush]::new((Color $Fill))
    $graphics.FillPath($brush, $Path); $brush.Dispose()
    if ($Stroke) { $pen = [Drawing.Pen]::new((Color $Stroke), $Width); $pen.LineJoin = 'Round'; $graphics.DrawPath($pen, $Path); $pen.Dispose() }
    $Path.Dispose()
}
function Rect([single]$X, [single]$Y, [single]$W, [single]$H, [single]$Radius, [string]$Fill, [string]$Stroke = '', [single]$Width = 1) {
    $path = [Drawing.Drawing2D.GraphicsPath]::new()
    if ($Radius -eq 0) { $path.AddRectangle([Drawing.RectangleF]::new($X,$Y,$W,$H)) }
    else { $d=$Radius*2; $path.AddArc($X,$Y,$d,$d,180,90); $path.AddArc(($X+$W-$d),$Y,$d,$d,270,90); $path.AddArc(($X+$W-$d),($Y+$H-$d),$d,$d,0,90); $path.AddArc($X,($Y+$H-$d),$d,$d,90,90); $path.CloseFigure() }
    Paint $path $Fill $Stroke $Width
    [void]$svg.AppendLine("<rect x=`"$X`" y=`"$Y`" width=`"$W`" height=`"$H`" rx=`"$Radius`" fill=`"$Fill`" stroke=`"$(if($Stroke){$Stroke}else{'none'})`" stroke-width=`"$Width`"/>")
}
function Ellipse([single]$X, [single]$Y, [single]$W, [single]$H, [string]$Fill, [string]$Stroke = '', [single]$Width = 1) {
    $path=[Drawing.Drawing2D.GraphicsPath]::new(); $path.AddEllipse($X,$Y,$W,$H); Paint $path $Fill $Stroke $Width
    [void]$svg.AppendLine("<ellipse cx=`"$($X+$W/2)`" cy=`"$($Y+$H/2)`" rx=`"$($W/2)`" ry=`"$($H/2)`" fill=`"$Fill`" stroke=`"$(if($Stroke){$Stroke}else{'none'})`" stroke-width=`"$Width`"/>")
}
function Circle([single]$X, [single]$Y, [single]$R, [string]$Fill, [string]$Stroke = '', [single]$Width = 1) { Ellipse ($X-$R) ($Y-$R) ($R*2) ($R*2) $Fill $Stroke $Width }
function Polygon([single[]]$Coords,[string]$Fill,[string]$Stroke='',[single]$Width=1) {
    $points=[Drawing.PointF[]]::new($Coords.Length/2); $textPoints=@()
    for($i=0;$i -lt $Coords.Length;$i+=2) { $points[$i/2]=[Drawing.PointF]::new($Coords[$i],$Coords[$i+1]); $textPoints += "$($Coords[$i]),$($Coords[$i+1])" }
    $path=[Drawing.Drawing2D.GraphicsPath]::new(); $path.AddPolygon($points); Paint $path $Fill $Stroke $Width
    [void]$svg.AppendLine("<polygon points=`"$($textPoints -join ' ')`" fill=`"$Fill`" stroke=`"$(if($Stroke){$Stroke}else{'none'})`" stroke-width=`"$Width`" stroke-linejoin=`"round`"/>")
}
function Puff([single]$X,[single]$Y,[single]$R) {
    # The same four-lobed popcorn construction used by the in-game renderer.
    $lobes=@(@(-.50,0,.66),@(.40,-.35,.70),@(.45,.50,.65),@(-.40,.55,.58))
    foreach($l in $lobes) { Circle ($X+$R*$l[0]) ($Y+$R*$l[1]) ($R*$l[2]+1.7) '#d6b672' }
    $colors=@('#fff8d5','#fffce9','#ffeab0','#fff5c8')
    for($i=0;$i -lt $lobes.Count;$i++){ $l=$lobes[$i]; Circle ($X+$R*$l[0]) ($Y+$R*$l[1]) ($R*$l[2]) $colors[$i] }
    Circle ($X-$R*.05) ($Y+$R*.13) ($R*.30) '#f0c867'
    Ellipse ($X-$R*.15) ($Y-$R*.05) ($R*.26) ($R*.18) '#dbaa4b'
}
try {
    # Full-bleed square; the host platform applies its own icon mask.
    Rect 0 0 600 600 0 '#deebd5'
    Circle 304 276 229 '#edf2df'
    Circle 295 260 183 '#f8f6e5'
    Ellipse 91 522 432 33 '#c6d5b9'
    # The starter cooking pot peeks out from behind the main bucket.
    Rect 359 390 148 20 9 '#9fae88'
    Rect 375 405 18 45 6 '#809475'
    Rect 473 405 18 45 6 '#809475'
    Rect 343 257 177 141 28 '#d2a567'
    Rect 358 273 147 76 18 '#f5dfb1'
    Rect 369 284 125 12 6 '#fff0c8'
    Rect 333 242 197 25 12 '#8c7753'
    Rect 397 225 70 18 9 '#bd9b5b'
    Rect 508 286 44 14 7 '#78674c'
    Rect 538 267 14 32 7 '#78674c'
    Rect 530 254 30 20 8 '#4c6b50'
    Circle 472 373 10 '#5c765a'
    Circle 473 370 3 '#e9edcf'
    # Popcorn hull, then gently tapered cream and caramel stripes.
    Polygon @(131,311,433,311,391,521,173,521) '#d0b888'
    Polygon @(134,311,430,311,388,516,176,516) '#fff9e8'
    Polygon @(155,316,192,316,220,516,184,516) '#d89465'
    Polygon @(230,316,267,316,275,516,241,516) '#d89465'
    Polygon @(305,316,342,316,330,516,295,516) '#d89465'
    Polygon @(379,316,417,316,382,516,346,516) '#d89465'
    # Shallow caramel foot and highlights preserve readability at 64 px.
    Rect 176 511 212 12 6 '#c8865c'
    Rect 195 517 173 6 3 '#b77750'
    # The mound uses individual kernels in front-to-back rows.
    Puff 169 280 34; Puff 383 282 33
    Puff 194 235 36; Puff 347 232 37
    Puff 240 198 37; Puff 295 184 38
    Puff 283 235 41; Puff 228 257 40; Puff 332 270 39
    Puff 175 307 32; Puff 219 316 34; Puff 268 305 35
    Puff 317 318 34; Puff 372 314 33
    Rect 123 324 319 20 10 '#f9df9f'
    Rect 123 319 319 17 8 '#fffbee'
    Rect 145 324 271 4 2 '#ffffff'
    # An embossed kernel rather than lettering keeps the small icon legible.
    Ellipse 229 388 103 80 '#fff9e8'
    Puff 280 423 24
    # Airborne kernels and compact four-point bursts imply the free pot burst.
    Puff 136 166 22
    Puff 387 142 23
    Puff 444 200 14
    Polygon @(482,121,488,137,504,143,488,149,482,165,476,149,460,143,476,137) '#d2a567'
    Polygon @(102,245,106,256,117,260,106,264,102,275,98,264,87,260,98,256) '#97af82'
    Circle 199 131 6 '#abc29a'
    Circle 463 455 7 '#c69e63'
    Circle 131 446 5 '#abc29a'
    [void]$svg.AppendLine('</svg>')
    $svgPath=Join-Path $outputPath 'app-icon.svg'
    [IO.File]::WriteAllText($svgPath,$svg.ToString(),[Text.UTF8Encoding]::new($false))
    $png=[Drawing.Bitmap]::new(600,600)
    $outGraphics=[Drawing.Graphics]::FromImage($png)
    $outGraphics.Clear((Color '#deebd5'))
    $outGraphics.InterpolationMode='HighQualityBicubic'
    $outGraphics.DrawImage($bitmap,0,0,600,600)
    $pngPath=Join-Path $outputPath 'app-icon.png'
    $png.Save($pngPath,[Drawing.Imaging.ImageFormat]::Png)
    $outGraphics.Dispose(); $png.Dispose()
    $check=[Drawing.Image]::FromFile($pngPath)
    if($check.Width -ne 600 -or $check.Height -ne 600){ throw 'Unexpected icon dimensions' }
    $check.Dispose()
    $pngFile=Get-Item -LiteralPath $pngPath
    if($pngFile.Length -ge 6MB){ throw 'Icon exceeds platform size limit' }
    Write-Output "Created $pngPath (600 x 600 PNG, $($pngFile.Length) bytes)"
    Write-Output "Editable vector: $svgPath"
} finally { $graphics.Dispose(); $bitmap.Dispose() }
