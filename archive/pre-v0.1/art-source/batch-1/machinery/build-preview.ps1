$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$rig=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'assembly.json') -Raw | ConvertFrom-Json
$core=Get-Content -LiteralPath (Join-Path $PSScriptRoot '../core/assembly.json') -Raw | ConvertFrom-Json
$sprites=@{}
Get-ChildItem -LiteralPath (Join-Path $taskRoot 'assets/art/machines'),(Join-Path $taskRoot 'assets/art/scene'),(Join-Path $taskRoot 'assets/art/products') -Filter '*.png' | ForEach-Object {$sprites[$_.BaseName]=[Drawing.Bitmap]::new($_.FullName)}
$sheet=[Drawing.Bitmap]::new(1800,1610)
$g=[Drawing.Graphics]::FromImage($sheet)
$g.Clear([Drawing.ColorTranslator]::FromHtml('#f5f0e4'))
$g.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$ink=[Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#084d53'))
$card=[Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#fffaf0'))
$font=[Drawing.Font]::new('Microsoft YaHei',18)
$title=[Drawing.Font]::new('Microsoft YaHei',28,[Drawing.FontStyle]::Bold)
function DrawPart($id,$rect,$flip=$false){
  if(!$sprites.ContainsKey($id)){return}
  $im=$sprites[$id]
  if($flip){$im=$im.Clone();$im.RotateFlip([Drawing.RotateFlipType]::RotateNoneFlipX)}
  $g.DrawImage($im,[Drawing.RectangleF]::new([single]$rect[0],[single]$rect[1],[single]$rect[2],[single]$rect[3]))
  if($flip){$im.Dispose()}
}
function DrawCup($rect){
  DrawPart 'product_cup_empty' $rect
  DrawPart 'product_cup_fill' @(($rect[0]+$rect[2]*.03),($rect[1]-$rect[2]*.29),($rect[2]*.94),($rect[2]*.94*94/128))
}
function DrawPack($name,$x,$y,$scale){
 $pack=$core.$name;$saved=$g.Save();$g.TranslateTransform([single]$x,[single]$y);$g.ScaleTransform([single]$scale,[single]$scale)
 foreach($part in $pack.parts){if($part.layer -lt 20){DrawPart $part.id $part.rect}}
 foreach($slot in $pack.slots){DrawCup $slot.rect}
 foreach($part in $pack.parts){if($part.layer -ge 20 -and $part.state -ne 'closed'){
  $clipState=$g.Save()
  if($part.clip){$poly=[Drawing.Drawing2D.GraphicsPath]::new();$points=[Drawing.PointF[]]@($pack.($part.clip) | ForEach-Object {[Drawing.PointF]::new([single]$_[0],[single]$_[1])});$poly.AddPolygon($points);$g.SetClip($poly);$poly.Dispose()}
  DrawPart $part.id $part.rect
  $g.Restore($clipState)
 }}
 $g.Restore($saved)
}
function Contents($key,$state,$data){
 if($state -eq 'empty'){return}
 if($key -eq 'popMachine'){DrawPart 'product_cup_fill' $data.content.exampleFill}
 elseif($key -eq 'shipMachine'){
  if($state -eq 'double'){
   DrawPack 'doubleTray' 183 314 1.4
  }elseif($state -eq 'box'){
   DrawPack 'fourCupBox' 180 294 1.3
  }else{DrawCup $data.content.singleCup}
 }
 elseif($key -eq 'cupsBuffer'){
  $n=if($state -eq 'full'){6}else{1}
  for($j=0;$j -lt $n;$j++){DrawCup $data.content.slots[$j]}
 }elseif($key -eq 'conveyorTransfer'){DrawCup @(220,40,55,67.69)}
 elseif($key -eq 'conveyorInfeed'){DrawPart 'product_kernel_a' @(168,117,44,42);DrawPart 'product_kernel_b' @(260,162,44,43)}
 elseif($key -eq 'conveyorOutfeed'){DrawCup @(238,97,54,66.46)}
}
function DrawRig($key,$state,$x,$y,$scale){
 $data=$rig.$key;$saved=$g.Save();$g.TranslateTransform([single]$x,[single]$y);$g.ScaleTransform([single]$scale,[single]$scale)
 foreach($layer in $data.layers){if($layer.layer -lt 30){DrawPart $layer.id $layer.rect ([bool]$layer.flipX)}}
 Contents $key $state $data
 foreach($layer in $data.layers){if($layer.layer -ge 30){DrawPart $layer.id $layer.rect ([bool]$layer.flipX)}}
 $g.Restore($saved)
}
$g.DrawString('MACHINERY 01 / STATIC LAYER ASSEMBLY',$title,$ink,30,22)
$g.DrawString('Artwork only. Products and moving heads remain separate. No gameplay is connected.',$font,$ink,32,77)
$cases=@(@('popMachine','empty','POP / EMPTY'),@('popMachine','work','POP / WORKING'),@('shipMachine','single','SHIP / SINGLE CUP'),@('shipMachine','double','SHIP / DOUBLE TRAY'),@('shipMachine','box','SHIP / OPEN BOX'),@('conveyorTransfer','work','TRANSFER / CARGO'),@('conveyorInfeed','work','INFEED / KERNELS'),@('conveyorOutfeed','work','OUTFEED / CUP'),@('cupsBuffer','empty','BUFFER / EMPTY'),@('cupsBuffer','small','BUFFER / SMALL'),@('cupsBuffer','full','BUFFER / FULL'),@('shipMachine','empty','SHIP / EMPTY'))
for($i=0;$i -lt $cases.Count;$i++){
 $x=24+($i%4)*445;$y=124+[Math]::Floor($i/4)*482
 $g.FillRectangle($card,$x,$y,428,462)
 $g.DrawString($cases[$i][2],$font,$ink,$x+12,$y+12)
 $data=$rig.($cases[$i][0]);$scale=[Math]::Min(402/$data.size[0],386/$data.size[1]);$ox=$x+(428-$data.size[0]*$scale)/2;$oy=$y+61+(386-$data.size[1]*$scale)/2
 DrawRig $cases[$i][0] $cases[$i][1] $ox $oy $scale
}
$sheet.Save((Join-Path $PSScriptRoot 'assembly-preview.png'),[Drawing.Imaging.ImageFormat]::Png)
$g.Dispose();$sheet.Dispose();$ink.Dispose();$card.Dispose();$font.Dispose();$title.Dispose();foreach($im in $sprites.Values){$im.Dispose()}
