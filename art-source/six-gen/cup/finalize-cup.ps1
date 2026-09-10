$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$cupRoot='C:/Users/chenweilun/Documents/GitHub/IAA'
$cupDir=Join-Path $cupRoot 'art-source/six-gen/cup'
function Cup-Sha($p){(Get-FileHash -LiteralPath (Join-Path $cupRoot $p)).Hash.ToLowerInvariant()}
function Cup-Json($n,$v){$v|ConvertTo-Json -Depth 50|Set-Content -LiteralPath (Join-Path $cupDir $n) -Encoding utf8}
function Cup-Point($x,$y,$s){@((4+$x*$s),(4+$y*$s))}
function Cup-Rect($x,$y,$w,$h,$s){@((4+$x*$s),(4+$y*$s),($w*$s),($h*$s))}
function Cup-SlotSpec($hx,$hy,$hw,$cx,$cy,$cw,$fx,$fy,$fw){[ordered]@{hx=$hx;hy=$hy;hw=$hw;cx=$cx;cy=$cy;cw=$cw;fx=$fx;fy=$fy;fw=$fw}}
$cupPairSlots=@();for($i=0;$i -lt 2;$i++){$cupPairSlots+=Cup-SlotSpec (310+427*$i) (394+197*$i) 116 (313+427*$i) (671+197*$i) 110 (141+427*$i) (664+197*$i) 370}
$cupTripleSlots=@();for($i=0;$i -lt 3;$i++){$cupTripleSlots+=Cup-SlotSpec (280+338*$i) (335+152*$i) 96 (281+338*$i) (563+152*$i) 94 (121+338*$i) (578+152*$i) 300}
$cupQuadSlots=@((Cup-SlotSpec 548 248 84 564 422 52 406 445 266),(Cup-SlotSpec 858 389 84 874 563 52 716 586 266),(Cup-SlotSpec 341 747 84 357 925 52 203 941 266),(Cup-SlotSpec 652 888 84 668 1066 52 513 1082 266))
$cupHexSlots=@();for($i=0;$i -lt 3;$i++){$cupHexSlots+=Cup-SlotSpec (499+254*$i) (253+112*$i) 65 (511.5+254*$i) (414+112*$i) 40 (371+254*$i) (423+112*$i) 196};for($i=0;$i -lt 3;$i++){$cupHexSlots+=Cup-SlotSpec (278+253*$i) (670+112*$i) 65 (290.5+253*$i) (808+112*$i) 40 (155+253*$i) (816+112*$i) 196}
$cupDefinitions=@(
 [ordered]@{name='pair';version=3;stageUse=@(2,3);slots=$cupPairSlots;input=@(155,705);output=@(910,1150);anchor=@(603,1255);batch=1},
 [ordered]@{name='triple';version=3;stageUse=@(4);slots=$cupTripleSlots;input=@(145,629);output=@(1080,1090);anchor=@(630,1160);batch=1},
 [ordered]@{name='quad';version=2;stageUse=@(5);slots=$cupQuadSlots;input=@(420,469);output=@(823,1203);anchor=@(650,1260);batch=2},
 [ordered]@{name='hex';version=2;stageUse=@(6);slots=$cupHexSlots;input=@(371,455);output=@(903,1096);anchor=@(780,1162);batch=2}
)
$cupAssets=@();$cupRigs=@();$cupRecipes=@();$cupExportAudit=@();$cupMetaById=@{}
foreach($d in $cupDefinitions){
 $id='machine_cup_'+$d.name+'_body';$source='art-source/six-gen/cup/sources/'+$id+'_v'+$d.version+'.png';$file='art-source/six-gen/cup/exports/'+$id+'.png'
 $im=[System.Drawing.Bitmap]::FromFile((Join-Path $cupRoot $source));if($im.PixelFormat -ne [System.Drawing.Imaging.PixelFormat]::Format32bppArgb){throw "Non-RGBA source: $source"}
 $s=632.0/[Math]::Max($im.Width,$im.Height);$w=[int][Math]::Ceiling($im.Width*$s)+8;$h=[int][Math]::Ceiling($im.Height*$s)+8
 $out=New-Object System.Drawing.Bitmap($w,$h,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb);$g=[System.Drawing.Graphics]::FromImage($out);$g.CompositingMode=[System.Drawing.Drawing2D.CompositingMode]::SourceCopy;$g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic;$g.PixelOffsetMode=[System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality;$g.Clear([System.Drawing.Color]::Transparent);$g.DrawImage($im,[System.Drawing.RectangleF]::new(4,4,[float]($im.Width*$s),[float]($im.Height*$s)));$g.Dispose();$out.Save((Join-Path $cupRoot $file),[System.Drawing.Imaging.ImageFormat]::Png)
 $boundary=0;for($x=0;$x -lt $w;$x++){if($out.GetPixel($x,0).A -gt 0){$boundary++};if($out.GetPixel($x,$h-1).A -gt 0){$boundary++}};for($y=0;$y -lt $h;$y++){if($out.GetPixel(0,$y).A -gt 0){$boundary++};if($out.GetPixel($w-1,$y).A -gt 0){$boundary++}}
 $sha=Cup-Sha $file;$sourceSha=Cup-Sha $source
 $cupAssets+=[ordered]@{id=$id;status='EXPORTED';category='machine';stageUse=$d.stageUse;file=$file;width=$w;height=$h;anchor=(Cup-Point $d.anchor[0] $d.anchor[1] $s);sourceFile=$source;sha256=$sha;provenanceRef=('art-source/six-gen/cup/provenance.json#cup_'+$d.name+'_body_v'+$d.version);reuseSource=$null;alphaMode='RGBA';notes='Independent empty hull only; existing head, cup, tray, front and shared cover referenced separately. Static artwork only.'}
 $cupRecipes+=[ordered]@{id=$id;source=$source;sourceSha256=$sourceSha;sourceRect=@(0,0,$im.Width,$im.Height);scale=$s;translate=@(4,4);padding=4;output=$file;outputSize=@($w,$h);outputSha256=$sha;resample='GDI+ HighQualityBicubic';alpha='original generated alpha preserved';pixelRemoval='none'}
 $cupExportAudit+=[ordered]@{id=$id;file=$file;width=$w;height=$h;pixelFormat='Format32bppArgb';cornerAlpha=$out.GetPixel(0,0).A;perimeterNontransparentPixels=$boundary;sha256=$sha;bytes=(Get-Item -LiteralPath (Join-Path $cupRoot $file)).Length}
 $rig=[ordered]@{id=('cup_'+$d.name);stationId='cup';generationUse=$d.stageUse;status='ASSEMBLED_STATIC_ART';coordinateSpace='export-local pixels';size=@($w,$h);anchor=(Cup-Point $d.anchor[0] $d.anchor[1] $s);input=(Cup-Point $d.input[0] $d.input[1] $s);output=(Cup-Point $d.output[0] $d.output[1] $s);hitPolygon=@(@(4,4),@(($w-4),4),@(($w-4),($h-4)),@(4,($h-4)));hitPolygonStatus='artwork envelope, runtime touch-area validation NOT_RUN';contentClip=$null;maximumSlots=$d.slots.Count;maximumBatchSize=$d.batch;slots=@();layers=@([ordered]@{id=$id;rect=@(0,0,$w,$h);layer=10});stateBindings=[ordered]@{activeSlotCount='station.lanes';jobAmount='station.jobs[i].amount';progress='station.jobs[i].progress';complete='station.jobs[i].complete';inactive='show cover and hide head/content';waiting='head still, no invented product';running='per-job progress only';blocked='completed job retains its existing product'};sourceTransform=[ordered]@{scale=$s;translate=@(4,4)};notes='Each slot uses independent parts and content clip. Front guards are reusable instances. No products or heads are baked into hull.'}
 $i=0;foreach($ss in $d.slots){
  $head=[ordered]@{id='machine_cup_head';rect=(Cup-Rect $ss.hx $ss.hy $ss.hw ($ss.hw*256/150) $s);layer=(20+$i);pivot=(Cup-Point ($ss.hx+$ss.hw/2) $ss.hy $s);travel=@(0,(8*$s))}
  $cup=[ordered]@{id='product_cup_empty';rect=(Cup-Rect $ss.cx $ss.cy $ss.cw ($ss.cw*128/104) $s);layer=(30+$i)}
  $front=[ordered]@{id='machine_cup_front';rect=(Cup-Rect $ss.fx $ss.fy $ss.fw ($ss.fw*304/384) $s);layer=(50+$i)}
  $coverWidth=$ss.cw*1.8;$cover=[ordered]@{id='machine_pop_socket_cover';rect=(Cup-Rect ($ss.cx-$ss.cw*0.4) ($ss.cy+$ss.cw*0.8) $coverWidth ($coverWidth*180/192) $s);layer=(31+$i);placement='inactive bay floor service socket'}
  $packing=$null;if($d.batch -eq 2){$packingWidth=$ss.cw*4;$packingScale=$packingWidth/160;$packing= Cup-Rect ($ss.hx+$ss.hw/2-$packingWidth*0.59) ($ss.cy-62.461538*$packingScale) $packingWidth (154*$packingScale) $s}
  if($packing){$clip=@(@($packing[0],($packing[1]-8*$s)),@(($packing[0]+$packing[2]),($packing[1]-8*$s)),@(($packing[0]+$packing[2]),($packing[1]+$packing[3]+10*$s)),@($packing[0],($packing[1]+$packing[3]+10*$s)))}else{$clip=@((Cup-Point ($ss.cx-20) ($ss.cy-75) $s),(Cup-Point ($ss.cx+$ss.cw+20) ($ss.cy-75) $s),(Cup-Point ($ss.cx+$ss.cw+20) ($ss.cy+$ss.cw*128/104+15) $s),(Cup-Point ($ss.cx-20) ($ss.cy+$ss.cw*128/104+15) $s))}
  $rig.slots+=[ordered]@{id="lane_$i";jobIndex=$i;head=$head;cup=$cup;front=$front;cover=$cover;clip=$clip;contentClip=$clip;packagingRect=$packing;packagingRig='art-source/batch-1/core/assembly.json#doubleTray';frontOcclusion='near guard overlays products; tray uses its own inherited frontOcclusionClip'}
  $rig.layers+=$front;$i++
 }
 $cupRigs+=$rig;$cupMetaById[$id]=[ordered]@{image=$out;sourceImage=$im;rig=$rig;definition=$d;scale=$s}
}
$legacy=Get-Content -Raw -LiteralPath (Join-Path $cupRoot 'art-source/batch-0/assembly.json')|ConvertFrom-Json
$single=[ordered]@{id='cup_single';stationId='cup';generationUse=@(1);status='REUSE_EXISTING_STATIC_RIG';coordinateSpace='original 448x640 local pixels';size=@(448,640);anchor=$legacy.cupMachine.anchor;input=$legacy.cupMachine.input;output=$legacy.cupMachine.output;hitPolygon=@(@(0,0),@(448,0),@(448,640),@(0,640));contentClip=$legacy.cupMachine.contentClip;maximumSlots=1;maximumBatchSize=1;layers=@($legacy.cupMachine.body,$legacy.cupMachine.front);slots=@([ordered]@{id='lane_0';jobIndex=0;head=$legacy.cupMachine.head;cup=$legacy.cupMachine.cup;front=$legacy.cupMachine.front;cover=$null;clip=$legacy.cupMachine.contentClip;packagingRect=$null});sourceAssembly='art-source/batch-0/assembly.json';sourceAssemblySha256=(Cup-Sha 'art-source/batch-0/assembly.json');notes='Original coordinate space preserved; no new generation-one raster.'}
$cupRigs=@($single)+$cupRigs
Cup-Json 'manifest.fragment.json' ([ordered]@{schemaVersion=1;contractVersion='six-gen-art-1.0';baseCommit='14310d34e882969208bb7583c5e0c8442bfc3aee';owner='A2';assets=$cupAssets})
Cup-Json 'assembly.json' ([ordered]@{schemaVersion=1;contractVersion='six-gen-art-1.0';owner='A2';status='ASSEMBLED_STATIC_ART_NOT_RUNTIME';rigs=$cupRigs;reuse=[ordered]@{head='assets/art/machines/machine_cup_head.png';front='assets/art/machines/machine_cup_front.png';single='art-source/batch-0/assembly.json#cupMachine';doubleCarrier='art-source/batch-1/core/assembly.json#doubleTray';socketCover='art-source/six-gen/pop/exports/machine_pop_socket_cover.png'};cancelledCandidateIds=@('machine_cup_pair_front','machine_cup_triple_front','machine_cup_quad_front','machine_cup_hex_front','machine_cup_double_carrier','machine_cup_socket_cover');notes=@('All references are staging/legacy art only. No runtime files changed.','Slots determine active head count; generation maximum never creates owned machinery.','Single cup and double tray are selected by each real job amount; old batches must not be duplicated.')})
Cup-Json 'export-recipe.json' ([ordered]@{schemaVersion=1;owner='A2';status='EXPORTED';implementation='art-source/six-gen/cup/finalize-cup.ps1';executedTransforms=$cupRecipes;reuse='Original legacy sprites and shared POP cover referenced directly, not copied or renamed';warning='Sources with RGB checkerboards are rejected and excluded from export inputs.'})
Cup-Json 'export-audit.json' $cupExportAudit
$cupImages=@{}
foreach($p in @('assets/art/machines/machine_cup_head.png','assets/art/machines/machine_cup_front.png','assets/art/products/product_cup_empty.png','assets/art/products/product_double_tray.png','art-source/six-gen/pop/exports/machine_pop_socket_cover.png')){$cupImages[[IO.Path]::GetFileNameWithoutExtension($p)]=[System.Drawing.Bitmap]::FromFile((Join-Path $cupRoot $p))}
function Cup-DrawPart($graphics,$part,$offsetX,$offsetY,$scale){$rect=$part.rect;$graphics.DrawImage($cupImages[$part.id],[System.Drawing.RectangleF]::new([float]($offsetX+$rect[0]*$scale),[float]($offsetY+$rect[1]*$scale),[float]($rect[2]*$scale),[float]($rect[3]*$scale)))}
function Cup-DrawTray($graphics,$bounds,$offsetX,$offsetY,$scale){
 $trayScale=$bounds[2]/160;$bx=$offsetX+$bounds[0]*$scale;$by=$offsetY+$bounds[1]*$scale;$bs=$scale*$trayScale
 Cup-DrawPart $graphics ([ordered]@{id='product_double_tray';rect=@(16,68,128,80)}) $bx $by $bs
 Cup-DrawPart $graphics ([ordered]@{id='product_cup_empty';rect=@(36,62.461538,40,49.230769)}) $bx $by $bs
 Cup-DrawPart $graphics ([ordered]@{id='product_cup_empty';rect=@(84,77.461538,40,49.230769)}) $bx $by $bs
 $poly=New-Object System.Drawing.Drawing2D.GraphicsPath
 $pts=@(@(20,99),@(35,104),@(58,113),@(80,120),@(100,126),@(120,133),@(144,110),@(144,153),@(16,153),@(16,102))|ForEach-Object {[System.Drawing.PointF]::new([float]($bx+$_[0]*$bs),[float]($by+$_[1]*$bs))}
 $poly.AddPolygon([System.Drawing.PointF[]]$pts);$gs=$graphics.Save();$graphics.SetClip($poly);Cup-DrawPart $graphics ([ordered]@{id='product_double_tray';rect=@(16,68,128,80)}) $bx $by $bs;$graphics.Restore($gs);$poly.Dispose()
}
function Cup-DrawMachine($graphics,$meta,$x,$y,$scale,$mode){
 $graphics.DrawImage($meta.image,[System.Drawing.RectangleF]::new($x,$y,[float]($meta.image.Width*$scale),[float]($meta.image.Height*$scale)))
 foreach($slot in $meta.rig.slots){if($mode -eq 'entry' -and $slot.jobIndex -gt 0){Cup-DrawPart $graphics $slot.cover $x $y $scale}else{Cup-DrawPart $graphics $slot.head $x $y $scale;if(($mode -eq 'batch' -or ($mode -eq 'mixed' -and $slot.jobIndex -gt 0)) -and $slot.packagingRect){Cup-DrawTray $graphics $slot.packagingRect $x $y $scale}elseif($mode -ne 'empty'){Cup-DrawPart $graphics $slot.cup $x $y $scale}};Cup-DrawPart $graphics $slot.front $x $y $scale}
}
$font=New-Object System.Drawing.Font('Microsoft YaHei',13);$brush=New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#153a43'))
foreach($id in $cupMetaById.Keys){
 $meta=$cupMetaById[$id];$preview=New-Object System.Drawing.Bitmap(1800,720);$pg=[System.Drawing.Graphics]::FromImage($preview);$pg.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic;$pg.Clear([System.Drawing.ColorTranslator]::FromHtml('#f5efe0'));$db=New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#142f3b'));$pg.FillRectangle($db,600,0,600,720)
 for($yy=0;$yy -lt 720;$yy+=18){for($xx=1200;$xx -lt 1800;$xx+=18){$color=if((($xx-1200)/18+$yy/18)%2 -eq 0){'#eeeeee'}else{'#cfcfcf'};$tile=New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($color));$pg.FillRectangle($tile,$xx,$yy,18,18);$tile.Dispose()}}
 $ps=[Math]::Min(550.0/$meta.image.Width,600.0/$meta.image.Height);for($pi=0;$pi -lt 3;$pi++){$pg.DrawImage($meta.image,[System.Drawing.RectangleF]::new([float]($pi*600+25),50,[float]($meta.image.Width*$ps),[float]($meta.image.Height*$ps)))}
 $pg.DrawString($id+' · 真RGBA / 等比导出',$font,$brush,22,10);$pg.DrawString('美术预览，非真机验收 · 浅 / 深 / 棋盘底',$font,$brush,22,682);$preview.Save((Join-Path $cupDir ('previews/'+$meta.definition.name+'-three-backgrounds.png')),[System.Drawing.Imaging.ImageFormat]::Png);$pg.Dispose();$preview.Dispose()
 $preview=New-Object System.Drawing.Bitmap(1400,800);$pg=[System.Drawing.Graphics]::FromImage($preview);$pg.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic;$pg.Clear([System.Drawing.ColorTranslator]::FromHtml('#f5efe0'));$ps=[Math]::Min(650.0/$meta.image.Width,690.0/$meta.image.Height);Cup-DrawMachine $pg $meta 20 55 $ps 'active';Cup-DrawMachine $pg $meta 720 55 $ps 'entry';$pg.DrawString('独立头 / 杯 / 复用前挡',$font,$brush,22,10);$pg.DrawString('一头保留，其余空槽覆盖',$font,$brush,722,10);$pg.DrawString('美术预览，非真机验收 · 右图仅示范单头与盖板分层',$font,$brush,22,760);$preview.Save((Join-Path $cupDir ('previews/'+$meta.definition.name+'-assembly.png')),[System.Drawing.Imaging.ImageFormat]::Png);$pg.Dispose();$preview.Dispose()
 if($meta.definition.batch -eq 2){$preview=New-Object System.Drawing.Bitmap(1400,800);$pg=[System.Drawing.Graphics]::FromImage($preview);$pg.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic;$pg.Clear([System.Drawing.ColorTranslator]::FromHtml('#f5efe0'));Cup-DrawMachine $pg $meta 20 55 $ps 'batch';Cup-DrawMachine $pg $meta 720 55 $ps 'mixed';$pg.DrawString('双份批次 · 每槽独立双杯托',$font,$brush,22,10);$pg.DrawString('混合：首槽旧一份，其余新双份',$font,$brush,722,10);$pg.DrawString('美术预览，非真机验收 · 产品保持独立层 / 等比共享托具',$font,$brush,22,760);$preview.Save((Join-Path $cupDir ('previews/'+$meta.definition.name+'-two-portion-assembly.png')),[System.Drawing.Imaging.ImageFormat]::Png);$pg.Dispose();$preview.Dispose()}
}
foreach($im in $cupImages.Values){$im.Dispose()};foreach($meta in $cupMetaById.Values){$meta.image.Dispose();$meta.sourceImage.Dispose()}

