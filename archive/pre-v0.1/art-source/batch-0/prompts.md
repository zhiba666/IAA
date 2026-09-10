# 批次 0 生成来源

日期：2026-09-09。工具：内置 image_gen（未用 CLI/API）。依据：计划列明的四张已选定图片；旧截图未作为风格输入。以下提示词使用已查看参考图归纳的体块、视角与配色。生成图以独立透明组件组交付，原始通道保留。导出采用连通区域分离、边缘两像素扩展和等比缩小，不重画主体。

## machine

```text
Use case: stylized-concept. Create a production sprite asset sheet for a cute clean 2D isometric popcorn factory game, NOT a concept screen. Style: soft simplified three-dimensional blocks, teal machinery (#248f94), dark teal sides, cool slate steel, small yellow highlights; orthographic isometric camera looking down 30 degrees, ground axes screen down-right and down-left at 30 degrees; light from upper left. The sheet is a single modular cup-filling machine asset, disassembled for compositing. Actual TRANSPARENT RGBA background, no ground plane, no glow, no shadow outside pieces, no text or numbers or labels. Landscape 1536x1024. Arrange exactly THREE separate non-overlapping pieces across the page, all facing the SAME camera and lit identically, plenty of empty transparent margin. LEFT half: large STATIC CUP FILLER BODY, teal U-shaped machine shell on a slate base, two sturdy side columns and a thick teal top housing, an empty working opening in the middle, no cup, no nozzle, no popcorn, no conveyor; the top and right side visible, clean broad surfaces. MIDDLE narrow region: SINGLE detached MOVABLE DISPENSER HEAD, a small silver cylinder/nozzle with teal mounting block and one yellow status cap, vertically oriented, full object visible; this inserts into the body's open center. RIGHT third: detached low SLATE FRONT GUARD with teal end caps, a simple isometric front lip, viewed from same angle, intended to overlap and hide the bottom of a cup at machine base. Only these three pieces; no assembled duplicate machine, no complete scene, no scenery or UI. Crisp edges. Keep the body about 650 pixels tall and pieces well separated for cutting. Reference direction is the approved simplified factory: no copper pot, no paper UI.
```

## products

```text
Use case: stylized-concept. Production modular sprite sheet for a single RED AND WHITE POPCORN CUP and its filling, cute clean mobile isometric factory. 1024x1024 TRANSPARENT RGBA background, no scenery, no glow, no ground shadow, no lettering, no badge, no labels. Top left: one EMPTY upright popcorn paper cup, red white vertical stripes, cream white rolled elliptical rim, visible empty interior, front and right side view, orthographic looking downward 30 degrees, light upper left, soft simple 3D blocks. Top right: ONLY a detached elliptical mound of golden yellow popcorn, about same width as cup mouth, its bottom shaped to sit inside the cup, no cup underneath. Bottom left: one individual golden puffed popcorn kernel. Bottom right: a second puffed popcorn kernel differing silhouette. Four nonoverlapping elements with large clean empty margins; about 100 px separation. Each object fully visible. Art direction: red white packaging is visual focus, bright buttery gold popcorn; simple broad highlights, crisp well-defined opaque silhouettes with only minimal anti-alias on edges. No glow or cast shadow, absolutely no background color.
```

## belts

```text
Use case: stylized-concept. Production sprite sheet for ONE modular slate-gray factory conveyor kit. Transparent RGBA background. Landscape 1536x1024, four separate objects in a neat 2 by 2 layout, wide empty margins, no text, labels or logos. Cute polished simplified 3D isometric blocks, orthographic camera down 30 degrees, top-left light, cool slate steel and small teal end caps. TOP LEFT: a short flat straight conveyor with axis down-right 30 degrees, rectangular parallelogram gray roller BELT SURFACE with back thin rail and two short support feet, NO front rail so moving products can be composited. TOP RIGHT: corresponding straight conveyor with axis down-left 30 degrees same scale and style, NO front rail. BOTTOM LEFT: detached low FRONT RAIL for first conveyor, one simple slate bar parallel to down-right axis with teal end cap, no legs. BOTTOM RIGHT: detached FRONT RAIL for second conveyor, simple slate bar parallel to down-left axis with teal end cap. All four pieces separate, fully visible. No machine, no popcorn or cups, no floor, no glow, no external drop shadow, true alpha background with crisp silhouettes.
```

## bin

```text
Use case: stylized-concept. One modular open bulk popcorn inventory bin DISASSEMBLED into two matching sprites. Actual transparent RGBA background, 1024x1024. No text, numbers, symbols or labels. Style cute simplified clean 3D isometric factory machinery, orthographic down 30 degrees, axes 30 degrees either side, top-left light. Top half centered: BACK SHELL of a low open rectangular teal hopper/tray, silver inner floor and teal back wall and side walls, no front wall, EMPTY no popcorn. Wide rectangular opening for later product layer clipping, no lid, no other machinery. Bottom half centered: corresponding detached low FRONT WALL, teal rectangular isometric lip same width and angle as the back shell front edge, with a small cream blank rectangle on front for runtime inventory number. Two pieces spaced apart, no overlap. Opaque clean broad surfaces, no ground, no cast shadow, no halo or glow. These will be layered back shell, golden popcorn, front wall in the game.
```

## ui

```text
Use case: ui-mockup. Production texture sheet for ONE six-piece GUI skin kit for a cozy popcorn factory. Transparent RGBA background; six fully separate BLANK rounded rectangles in a 2-column 3-row grid, landscape 1536x1024. Front facing perfectly horizontal orthographic UI, no perspective. Clear 70px empty transparent gutters; each rectangle about 550x200 pixels. TOP LEFT dark rich teal currency HUD rounded plate with lighter teal inset border, blank interior. TOP RIGHT cream ivory production-rate HUD rounded plate with dark teal border. MIDDLE LEFT warm cream panel plate with dark teal border, subtle internal highlight. MIDDLE RIGHT golden yellow primary button with warm ochre dark border, slight thick bottom edge and cream-yellow top highlight. BOTTOM LEFT pale mint secondary button with teal border and subtle top highlight. BOTTOM RIGHT gray-green disabled button with muted dark green border. Uniform rounded 32px corners so they can be nine-sliced; center and straight edge sections smooth with no texture detail. Absolutely NO letters, text, icons, amounts, currency symbols, arrows or decoration inside. No glow, no big shadows, only crisp anti-aliased edges; do not add a dark colored background. These are blank runtime skins matching cream/teal/gold approved UI.
```
