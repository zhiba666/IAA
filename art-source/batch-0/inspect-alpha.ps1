Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
public static class AlphaInspect {
  public static string Check(string path) {
    using(var b=new Bitmap(path)) {
      long zero=0,partial=0,solid=0; int[] thresholds={1,128,250};
      string s=System.IO.Path.GetFileName(path)+" "+b.Width+"x"+b.Height;
      foreach(int t in thresholds) {
        int l=b.Width,r=0,top=b.Height,bot=0;
        for(int y=0;y<b.Height;y++)for(int x=0;x<b.Width;x++) {
          var a=b.GetPixel(x,y).A;
          if(t==1){if(a==0)zero++;else if(a==255)solid++;else partial++;}
          if(a>=t){l=Math.Min(l,x);r=Math.Max(r,x);top=Math.Min(top,y);bot=Math.Max(bot,y);}
        }
        s+=" alpha>="+t+":"+l+","+top+","+(r-l+1)+","+(bot-top+1);
      }
      return s+" zero="+zero+" partial="+partial+" solid="+solid;
    }
  }
}
'@
Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*-source.png' | ForEach-Object { [AlphaInspect]::Check($_.FullName) }
