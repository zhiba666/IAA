$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;using System.Drawing;
public static class AlphaReview {
public static int[] Inspect(string path){using(var b=new Bitmap(path)){int zero=0,semi=0,solid=0,edge=0,visible=0;for(int y=0;y<b.Height;y++)for(int x=0;x<b.Width;x++){int a=b.GetPixel(x,y).A;if(a==0)zero++;else if(a==255)solid++;else semi++;if(a>=128){visible++;if(x==0||y==0||x==b.Width-1||y==b.Height-1)edge++;}}return new int[]{b.Width,b.Height,zero,semi,solid,edge,visible};}}
}
'@
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$manifest=Get-Content -LiteralPath (Join-Path $taskRoot 'assets/art/manifest.json') -Raw | ConvertFrom-Json
$rows=foreach($e in $manifest.entries){
  $a=[AlphaReview]::Inspect((Join-Path $taskRoot $e.path))
  $background=$e.id -eq 'factory_room'
  [PSCustomObject]@{id=$e.id;batch=$e.batch;width=$a[0];height=$a[1];transparent=$a[2];translucent=$a[3];opaque=$a[4];opaqueBorder=$a[5];passed=($a[6] -gt 0 -and ($background -or ($a[2] -gt 0 -and $a[5] -eq 0)))}
}
$failures=@($rows | Where-Object {$_.batch -eq 1 -and -not $_.passed})
$legacy=@($rows | Where-Object {$_.batch -ne 1 -and -not $_.passed})
[PSCustomObject]@{scope='New batch PNG alpha and hard-edge clipping; prior batch is audited without changing its assets';count=$rows.Count;newBatchCount=@($rows|Where-Object {$_.batch -eq 1}).Count;passed=($failures.Count -eq 0);legacyFindings=$legacy;checks=$rows} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'alpha-audit.json') -Encoding UTF8
Write-Output ($rows.Count.ToString()+' PNG inspected; new batch failures: '+$failures.Count+'; prior batch findings: '+$legacy.Count)
if($failures.Count){$failures|Format-Table;exit 1}
