$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Drawing2D;
public static class CoreExport {
  // Mechanical visible-bounds trim and uniform downsampling only. Original
  // alpha inside the bounds is retained, including translucent steam.
  public static int[] Export(string input,string output,int maxEdge,bool opaque) {
    using(var src=new Bitmap(input)) {
      int l=src.Width,t=src.Height,r=-1,b=-1;
      int threshold=input.Contains("fx_steam")?4:16;
      for(int y=0;y<src.Height;y++)for(int x=0;x<src.Width;x++)if(src.GetPixel(x,y).A>=threshold){l=Math.Min(l,x);t=Math.Min(t,y);r=Math.Max(r,x);b=Math.Max(b,y);}
      if(r<0)throw new Exception("Empty source: "+input);
      if(opaque){l=0;t=0;r=src.Width-1;b=src.Height-1;}
      else {int pad=(int)Math.Ceiling(4.0*Math.Max(r-l+1,b-t+1)/maxEdge);l=Math.Max(0,l-pad);t=Math.Max(0,t-pad);r=Math.Min(src.Width-1,r+pad);b=Math.Min(src.Height-1,b+pad);}
      int cw=r-l+1,ch=b-t+1; double scale=Math.Min(1.0,(double)maxEdge/Math.Max(cw,ch));
      int w=(int)Math.Round(cw*scale),h=(int)Math.Round(ch*scale);
      using(var result=new Bitmap(w,h,PixelFormat.Format32bppArgb)) {
        using(var g=Graphics.FromImage(result)) {g.CompositingMode=CompositingMode.SourceCopy;g.InterpolationMode=InterpolationMode.HighQualityBicubic;g.PixelOffsetMode=PixelOffsetMode.HighQuality;using(var attrs=new ImageAttributes()){attrs.SetWrapMode(WrapMode.TileFlipXY);g.DrawImage(src,new Rectangle(0,0,w,h),l,t,cw,ch,GraphicsUnit.Pixel,attrs);}}
        int zero=0,semi=0,solid=0,edge=0;
        for(int y=0;y<h;y++)for(int x=0;x<w;x++){int a=result.GetPixel(x,y).A;if(a==0)zero++;else if(a==255)solid++;else semi++;if((x==0||y==0||x==w-1||y==h-1)&&a>0)edge++;}
        result.Save(output,ImageFormat.Png);
        return new int[]{l,t,cw,ch,w,h,zero,semi,solid,edge};
      }
    }
  }
}
'@
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$recipes=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'export-recipe.json') -Raw | ConvertFrom-Json
$metrics=foreach($s in $recipes){
  $outputPath=Join-Path $taskRoot $s.path
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($outputPath)) | Out-Null
  $d=[CoreExport]::Export((Join-Path $PSScriptRoot $s.source),$outputPath,$s.maxEdge,($s.opaque -eq $true))
  [PSCustomObject]@{id=$s.id;path=$s.path;source=$s.source;sourceRect=@($d[0],$d[1],$d[2],$d[3]);width=$d[4];height=$d[5];bytes=(Get-Item -LiteralPath $outputPath).Length;decodedBytes=$d[4]*$d[5]*4;alpha=@{transparent=$d[6];translucent=$d[7];opaque=$d[8];nonzeroEdge=$d[9]}}
}
$metrics | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'export-metrics.json') -Encoding UTF8
$metrics | Select-Object id,width,height,bytes | Format-Table
