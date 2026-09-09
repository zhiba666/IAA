$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Drawing2D;
using System.Collections.Generic;
public static class SpriteExport {
  // Separate an opaque connected component. Keep the original alpha within a
  // two-source-pixel edge margin; detached near-transparent generation residue
  // is deliberately excluded. No matte colour is introduced.
  public static string Export(string input,string output,int px,int py,int maxEdge) {
    using(var source=new Bitmap(input)) {
      int w=source.Width,h=source.Height;
      var alpha=new byte[w*h];var keep=new bool[w*h];var mask=new bool[w*h];
      for(int y=0;y<h;y++)for(int x=0;x<w;x++)alpha[y*w+x]=source.GetPixel(x,y).A;
      if(alpha[py*w+px]<128)throw new Exception("Seed outside opaque sprite: "+output);
      var q=new Queue<int>();q.Enqueue(py*w+px);keep[py*w+px]=true;
      int l=px,t=py,r=px,b=py;
      while(q.Count>0){int p=q.Dequeue(),x=p%w,y=p/w;
        l=Math.Min(l,x);r=Math.Max(r,x);t=Math.Min(t,y);b=Math.Max(b,y);
        for(int yy=Math.Max(0,y-1);yy<=Math.Min(h-1,y+1);yy++)for(int xx=Math.Max(0,x-1);xx<=Math.Min(w-1,x+1);xx++){
          int n=yy*w+xx;if(!keep[n]&&alpha[n]>=128){keep[n]=true;q.Enqueue(n);}
        }
      }
      for(int y=t;y<=b;y++)for(int x=l;x<=r;x++)if(keep[y*w+x])
        for(int yy=Math.Max(0,y-2);yy<=Math.Min(h-1,y+2);yy++)for(int xx=Math.Max(0,x-2);xx<=Math.Min(w-1,x+2);xx++)mask[yy*w+xx]=true;
      l=Math.Max(0,l-3);t=Math.Max(0,t-3);r=Math.Min(w-1,r+3);b=Math.Min(h-1,b+3);
      using(var crop=new Bitmap(r-l+1,b-t+1,PixelFormat.Format32bppArgb)){
        for(int y=t;y<=b;y++)for(int x=l;x<=r;x++)if(mask[y*w+x])crop.SetPixel(x-l,y-t,source.GetPixel(x,y));
        double scale=Math.Min(1.0,(double)maxEdge/Math.Max(crop.Width,crop.Height));
        int ow=(int)Math.Round(crop.Width*scale),oh=(int)Math.Round(crop.Height*scale);
        using(var result=new Bitmap(ow,oh,PixelFormat.Format32bppArgb)){
          using(var g=Graphics.FromImage(result)){
            g.CompositingMode=CompositingMode.SourceCopy;g.InterpolationMode=InterpolationMode.HighQualityBicubic;g.PixelOffsetMode=PixelOffsetMode.HighQuality;
            g.DrawImage(crop,new Rectangle(0,0,ow,oh),0,0,crop.Width,crop.Height,GraphicsUnit.Pixel);
          }
          result.Save(output,ImageFormat.Png);
        }
        return l+","+t+","+crop.Width+","+crop.Height+","+ow+","+oh;
      }
    }
  }
}
'@
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$recipe = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'export-recipe.json') -Raw | ConvertFrom-Json
$results = foreach($item in $recipe) {
  $inputPath=Join-Path $PSScriptRoot $item.source
  $outputPath=Join-Path $taskRoot $item.path
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($outputPath)) | Out-Null
  $dims = [SpriteExport]::Export($inputPath,$outputPath,$item.seed[0],$item.seed[1],$item.maxEdge).Split(',') | ForEach-Object { [int]$_ }
  [PSCustomObject]@{id=$item.id;path=$item.path;source=$item.source;sourceRect=@($dims[0],$dims[1],$dims[2],$dims[3]);width=$dims[4];height=$dims[5];bytes=(Get-Item -LiteralPath $outputPath).Length;decodedBytes=$dims[4]*$dims[5]*4}
}
$results | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'export-metrics.json') -Encoding UTF8
$results | Format-Table id,width,height,bytes,decodedBytes
