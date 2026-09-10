param([string]$Package = $PSScriptRoot)
Add-Type -AssemblyName System.Drawing
if (-not ('SixGenAlphaExport' -as [type])) {
 Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
public class SixGenAlphaExport {
 public static object Export(string source,string target,int limit) {
  using(var input=new Bitmap(source)) {
   var data=input.LockBits(new Rectangle(0,0,input.Width,input.Height),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
   byte[] bytes=new byte[Math.Abs(data.Stride)*input.Height];Marshal.Copy(data.Scan0,bytes,0,bytes.Length);
   int x0=input.Width,y0=input.Height,x1=-1,y1=-1,min=255,max=0;long zero=0,semi=0;
   for(int y=0;y<input.Height;y++)for(int x=0;x<input.Width;x++) {
    int alpha=bytes[y*Math.Abs(data.Stride)+x*4+3];min=Math.Min(min,alpha);max=Math.Max(max,alpha);
    if(alpha==0)zero++;else {x0=Math.Min(x0,x);y0=Math.Min(y0,y);x1=Math.Max(x1,x);y1=Math.Max(y1,y);if(alpha<255)semi++;}
   }
   input.UnlockBits(data);if(x1<0)throw new Exception("Empty sprite");
   x0=Math.Max(0,x0-5);y0=Math.Max(0,y0-5);x1=Math.Min(input.Width-1,x1+5);y1=Math.Min(input.Height-1,y1+5);
   int gutter=source.EndsWith("machine_ship_lane_cover.png",StringComparison.OrdinalIgnoreCase)?2:0;
   var crop=new Rectangle(x0,y0,x1-x0+1,y1-y0+1);double scale=Math.Min(1.0,(double)(limit-2*gutter)/Math.Max(crop.Width,crop.Height));
   int width=Math.Max(1,(int)Math.Round(crop.Width*scale))+2*gutter,height=Math.Max(1,(int)Math.Round(crop.Height*scale))+2*gutter;
   using(var output=new Bitmap(width,height,PixelFormat.Format32bppArgb))using(var g=Graphics.FromImage(output)){
    g.Clear(Color.Transparent);g.CompositingMode=CompositingMode.SourceCopy;g.InterpolationMode=InterpolationMode.HighQualityBicubic;
    g.DrawImage(input,new Rectangle(gutter,gutter,width-2*gutter,height-2*gutter),crop,GraphicsUnit.Pixel);output.Save(target,ImageFormat.Png);
   }
   return new {sourceSize=new[]{input.Width,input.Height},sourceRect=new[]{crop.X,crop.Y,crop.Width,crop.Height},exportSize=new[]{width,height},uniformScale=scale,contentOffset=new[]{gutter,gutter},alphaMin=min,alphaMax=max,alphaZero=zero,alphaSemi=semi,hasRealAlpha=zero>0&&max>0,format="PNG/RGBA",cropPolicy="alpha>0 bounding box plus five source pixels; complete source preserved",resize="uniform HighQualityBicubic; rounded raster dimensions; lane cover adds two-pixel transparent gutter"};
  }
 }
}
'@
}
$packageRoot=(Resolve-Path $Package).Path
$repoRoot=(Resolve-Path (Join-Path $packageRoot '../../..')).Path
$exports=Join-Path $packageRoot 'exports'
New-Item -ItemType Directory -Force $exports | Out-Null
$recipes=@()
foreach($sourceFile in Get-ChildItem -LiteralPath (Join-Path $packageRoot 'sources') -Filter '*.png'){
 $limit=if($sourceFile.BaseName -match 'body$'){640}else{192}
 $target=Join-Path $exports $sourceFile.Name
 $info=[SixGenAlphaExport]::Export($sourceFile.FullName,$target,$limit)
 $recipes += [ordered]@{id=$sourceFile.BaseName;sourceFile=('sources/'+$sourceFile.Name);file=('exports/'+$sourceFile.Name);sourceSha256=(Get-FileHash -LiteralPath $sourceFile.FullName -Algorithm SHA256).Hash.ToLower();exportSha256=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLower();recipe=$info}
}
[ordered]@{schemaVersion=1;contractVersion='six-gen-art-1.0';mode='mechanical crop and uniform resize only';assets=$recipes} | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $packageRoot 'export-recipe.json') -Encoding UTF8
$recipes | ForEach-Object {[pscustomobject]@{id=$_.id;size=($_.recipe.exportSize -join 'x');realAlpha=$_.recipe.hasRealAlpha}}
