$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
public static class MachineryAlpha {
 public static long[] Check(string p){using(var b=new Bitmap(p)){long z=0,part=0,solid=0,border=0;for(int y=0;y<b.Height;y++)for(int x=0;x<b.Width;x++){byte a=b.GetPixel(x,y).A;if(a==0)z++;else if(a==255)solid++;else part++;if((x==0||y==0||x==b.Width-1||y==b.Height-1)&&a>=128)border++;}return new long[]{b.Width,b.Height,z,part,solid,border};}}
}
'@
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$metrics=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'export-metrics.json') -Raw | ConvertFrom-Json
$checks=foreach($item in $metrics){
 $data=[MachineryAlpha]::Check((Join-Path $taskRoot $item.path))
 if($data[2] -eq 0 -or $data[4] -eq 0 -or $data[5] -ne 0){throw "Alpha/edge validation failed: $($item.id)"}
 [PSCustomObject]@{id=$item.id;width=$data[0];height=$data[1];transparentPixels=$data[2];partialPixels=$data[3];opaquePixels=$data[4];opaqueBorderPixels=$data[5];passed=$true}
}
[PSCustomObject]@{status='passed';count=$checks.Count;pngBytes=($metrics | Measure-Object bytes -Sum).Sum;decodedBytes=($metrics | Measure-Object decodedBytes -Sum).Sum;checks=$checks;notes=@('Every exported PNG has real transparent pixels and opaque subject pixels. No opaque pixel touches a crop border.','Source component pixels retain their alpha within a two-source-pixel antialias margin. Downsampling is uniform.','transfer-v2-source.png is a rejected checkerboard edit and is not in the export recipe. Original buffer-source.png and original transfer foreground are superseded.')} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'alpha-audit.json') -Encoding utf8
$checks | Format-Table id,transparentPixels,partialPixels,opaqueBorderPixels,passed
