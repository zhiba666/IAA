$ErrorActionPreference = 'Stop'
# System.Drawing C# compilation uses the Windows PowerShell 5.1 framework assembly.
if ($PSVersionTable.PSEdition -eq 'Core') {
  & "$env:WINDIR/System32/WindowsPowerShell/v1.0/powershell.exe" -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath
  exit $LASTEXITCODE
}
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Drawing2D;
public static class BatchOneIconExport {
  public static int[] Export(string input, string output, int canvas, int maxEdge, int threshold, int pad) {
    using(var source = new Bitmap(input)) {
      int l=source.Width,t=source.Height,r=-1,b=-1;
      int srcTransparent=0,srcOpaque=0;
      for(int y=0;y<source.Height;y++) for(int x=0;x<source.Width;x++) {
        int a=source.GetPixel(x,y).A;
        if(a==0) srcTransparent++;
        if(a==255) srcOpaque++;
        if(a>=threshold) { l=Math.Min(l,x);t=Math.Min(t,y);r=Math.Max(r,x);b=Math.Max(b,y); }
      }
      if(r<0 || srcTransparent==0) throw new Exception("Missing real alpha or subject: "+input);
      l=Math.Max(0,l-pad);t=Math.Max(0,t-pad);r=Math.Min(source.Width-1,r+pad);b=Math.Min(source.Height-1,b+pad);
      int sw=r-l+1,sh=b-t+1;
      double scale=Math.Min(1.0,(double)maxEdge/Math.Max(sw,sh));
      int dw=(int)Math.Round(sw*scale),dh=(int)Math.Round(sh*scale),dx=(canvas-dw)/2,dy=(canvas-dh)/2;
      using(var target=new Bitmap(canvas,canvas,PixelFormat.Format32bppArgb)) {
        using(var g=Graphics.FromImage(target)) {
          g.CompositingMode=CompositingMode.SourceCopy;
          g.InterpolationMode=InterpolationMode.HighQualityBicubic;
          g.PixelOffsetMode=PixelOffsetMode.HighQuality;
          g.Clear(Color.Transparent);
          g.DrawImage(source,new Rectangle(dx,dy,dw,dh),l,t,sw,sh,GraphicsUnit.Pixel);
        }
        int zero=0,opaque=0,partial=0;
        for(int y=0;y<canvas;y++) for(int x=0;x<canvas;x++) {
          int a=target.GetPixel(x,y).A; if(a==0)zero++;else if(a==255)opaque++;else partial++;
        }
        if(zero==0 || opaque==0)throw new Exception("Invalid exported alpha: "+output);
        target.Save(output,ImageFormat.Png);
        return new int[]{l,t,sw,sh,dw,dh,dx,dy,zero,opaque,partial,source.Width,source.Height,srcTransparent,srcOpaque};
      }
    }
  }
}
'@
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$recipe = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'export-recipe.json') -Raw | ConvertFrom-Json
$results = foreach($item in $recipe) {
  $inputPath = Join-Path $PSScriptRoot $item.source
  $outputPath = Join-Path $taskRoot $item.path
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($outputPath)) | Out-Null
  $m=[BatchOneIconExport]::Export($inputPath,$outputPath,$item.canvas[0],$item.contentMaxEdge,$item.alphaBoundsThreshold,$item.paddingSource)
  [PSCustomObject]@{
    id=$item.id;path=$item.path;source=$item.source;sourceRect=@($m[0],$m[1],$m[2],$m[3]);
    width=$item.canvas[0];height=$item.canvas[1];contentRect=@($m[6],$m[7],$m[4],$m[5]);
    bytes=(Get-Item -LiteralPath $outputPath).Length;decodedBytes=$item.canvas[0]*$item.canvas[1]*4;
    alpha=@{transparent=$m[8];opaque=$m[9];partial=$m[10]};
    sourceSize=@($m[11],$m[12]);sourceAlpha=@{transparent=$m[13];opaque=$m[14]};
    sha256=(Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash.ToLower()
  }
}
$results | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'export-metrics.json') -Encoding UTF8
$results | Format-Table id,width,height,bytes,decodedBytes
