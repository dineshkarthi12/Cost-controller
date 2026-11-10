/**
 * Ready-made list of construction materials for a building site (Indian practice): civil, structure,
 * finishes, MEP, external works, consumables, small tools and safety.
 * Users pick from it on the Materials page ("Add from preset list") or get it as suggestions
 * while typing in the New material form; anything not in the list can still be typed by hand.
 *
 * Units are codes from the default unit list every organisation starts with
 * (NOS, M, RM, SQM, CUM, KG, MT, BAG, LTR, SET, LS). No rates are given: prices differ
 * by city and month, so the standard rate is entered by the user.
 * Codes already published are never renamed, because organisations may have added them.
 */
export interface MaterialPreset {
  code: string;
  name: string;
  category: string;
  unit: string;
  specification?: string;
}

const p = (category: string, unit: string, items: Array<[code: string, name: string, specification?: string]>): MaterialPreset[] =>
  items.map(([code, name, specification]) => ({ code, name, category, unit, ...(specification ? { specification } : {}) }));

export const MATERIAL_PRESETS: readonly MaterialPreset[] = [
  // ── Cement & mortar ──────────────────────────────────────────────
  ...p('Cement', 'BAG', [
    ['CEM-OPC43', 'Cement OPC 43 Grade', '50 kg bag, IS 269'],
    ['CEM-OPC53', 'Cement OPC 53 Grade', '50 kg bag, IS 269'],
    ['CEM-PPC', 'Cement PPC (Portland Pozzolana)', '50 kg bag, IS 1489'],
    ['CEM-PSC', 'Cement PSC (Portland Slag)', '50 kg bag, IS 455'],
    ['CEM-SRC', 'Sulphate Resisting Cement', '50 kg bag, IS 12330'],
    ['CEM-RMPLASTER', 'Ready-Mix Plaster', '40 kg bag'],
    ['CEM-RMMORTAR', 'Ready-Mix Masonry Mortar', '40 kg bag'],
  ]),
  ...p('Cement', 'KG', [['CEM-WHITE', 'White Cement', 'IS 8042']]),
  ...p('Cement', 'MT', [
    ['CEM-BULK', 'Cement in Bulk (OPC 53)', 'Bulker supply'],
    ['CEM-FLYASH', 'Fly Ash (for concrete)', 'IS 3812'],
    ['CEM-GGBS', 'GGBS (Ground Granulated Blast-furnace Slag)', 'IS 16714'],
  ]),
  ...p('Cement', 'KG', [['CEM-MICROSILICA', 'Micro Silica (Silica Fume)', 'IS 15388']]),

  // ── Steel & metals ───────────────────────────────────────────────
  ...p('Steel', 'MT', [
    ['STL-TMT06', 'TMT Bar Fe500D 6 mm', 'IS 1786'],
    ['STL-TMT08', 'TMT Bar Fe500D 8 mm', 'IS 1786'],
    ['STL-TMT10', 'TMT Bar Fe500D 10 mm', 'IS 1786'],
    ['STL-TMT12', 'TMT Bar Fe500D 12 mm', 'IS 1786'],
    ['STL-TMT16', 'TMT Bar Fe500D 16 mm', 'IS 1786'],
    ['STL-TMT20', 'TMT Bar Fe500D 20 mm', 'IS 1786'],
    ['STL-TMT25', 'TMT Bar Fe500D 25 mm', 'IS 1786'],
    ['STL-TMT28', 'TMT Bar Fe500D 28 mm', 'IS 1786'],
    ['STL-TMT32', 'TMT Bar Fe500D 32 mm', 'IS 1786'],
    ['STL-TMT36', 'TMT Bar Fe500D 36 mm', 'IS 1786'],
    ['STL-STRUCT', 'Structural Steel (ISMB / ISMC / Angles)', 'IS 2062 E250'],
    ['STL-ISMB', 'MS Beam ISMB', 'IS 2062, size as required'],
    ['STL-ISMC', 'MS Channel ISMC', 'IS 2062, size as required'],
    ['STL-ANGLE', 'MS Angle', 'IS 2062, size as required'],
    ['STL-FLAT', 'MS Flat', 'IS 2062, size as required'],
    ['STL-ROUNDBAR', 'MS Round Bar', 'IS 2062, size as required'],
    ['STL-SHS', 'MS Square Hollow Section (SHS)', 'IS 4923'],
    ['STL-RHS', 'MS Rectangular Hollow Section (RHS)', 'IS 4923'],
    ['STL-CHS', 'MS Circular Hollow Section (pipe)', 'IS 1161'],
    ['STL-PURLIN', 'Cold-Formed Purlin (C / Z section)', 'Galvanised'],
  ]),
  ...p('Steel', 'KG', [
    ['STL-BINDWIRE', 'Binding Wire 18 gauge', 'Annealed GI / black'],
    ['STL-MSPLATE', 'MS Plate', 'IS 2062, thickness as required'],
    ['STL-CHEQPLATE', 'MS Chequered Plate', 'IS 3502'],
    ['STL-GISHEET', 'GI Plain Sheet', 'Gauge as required'],
    ['STL-SSSHEET', 'Stainless Steel Sheet (SS 304)'],
    ['STL-PPFIBRE', 'Polypropylene Fibre (for concrete / plaster)', '12 mm'],
    ['STL-STEELFIBRE', 'Steel Fibre (for concrete)', 'Hooked end'],
  ]),
  ...p('Steel', 'SQM', [
    ['STL-WWMESH', 'Welded Wire Mesh', 'Size and spacing as required'],
    ['STL-CHICKENMESH', 'Chicken Mesh (plaster joints)', 'GI, 24 gauge'],
    ['STL-EXPMETAL', 'Expanded Metal Lath'],
  ]),
  ...p('Steel', 'NOS', [
    ['STL-COUPLER', 'Rebar Coupler (mechanical splice)', 'Size as required'],
    ['STL-ANCHORBOLT', 'Foundation Anchor Bolt with Nut', 'Size as required'],
  ]),

  // ── Aggregates, sand & filling ───────────────────────────────────
  ...p('Aggregates & Sand', 'CUM', [
    ['AGG-MSAND', 'M-Sand (for concrete)', 'IS 383 Zone II'],
    ['AGG-PSAND', 'P-Sand (for plastering)', 'Fine, washed'],
    ['AGG-RSAND', 'River Sand', 'Washed, IS 383'],
    ['AGG-FILLSAND', 'Sand for Filling'],
    ['AGG-06MM', 'Coarse Aggregate 6 mm', 'Crushed granite'],
    ['AGG-10MM', 'Coarse Aggregate 10 mm', 'Crushed granite'],
    ['AGG-12MM', 'Coarse Aggregate 12 mm', 'Crushed granite'],
    ['AGG-20MM', 'Coarse Aggregate 20 mm', 'Crushed granite'],
    ['AGG-40MM', 'Coarse Aggregate 40 mm', 'Crushed granite'],
    ['AGG-DUST', 'Quarry Dust'],
    ['AGG-GSB', 'Granular Sub-Base (GSB)', 'MoRTH grading'],
    ['AGG-WMM', 'Wet Mix Macadam (WMM)', 'MoRTH grading'],
    ['AGG-GRAVEL', 'Gravel / Earth for filling'],
    ['AGG-MURRUM', 'Murrum / Red Earth'],
    ['AGG-RUBBLE', 'Rubble / Size Stone', 'For foundation masonry'],
    ['AGG-BOULDER', 'Boulders (soling)'],
    ['AGG-BRICKBAT', 'Brick Bats (for filling / brickbat coba)'],
  ]),

  // ── Concrete ─────────────────────────────────────────────────────
  ...p('Ready-Mix Concrete', 'CUM', [
    ['RMC-M10', 'Ready-Mix Concrete M10 (PCC)'],
    ['RMC-M15', 'Ready-Mix Concrete M15'],
    ['RMC-M20', 'Ready-Mix Concrete M20'],
    ['RMC-M25', 'Ready-Mix Concrete M25'],
    ['RMC-M30', 'Ready-Mix Concrete M30'],
    ['RMC-M35', 'Ready-Mix Concrete M35'],
    ['RMC-M40', 'Ready-Mix Concrete M40'],
    ['RMC-M45', 'Ready-Mix Concrete M45'],
    ['RMC-M50', 'Ready-Mix Concrete M50'],
    ['RMC-SCC', 'Self-Compacting Concrete (SCC)', 'Grade as required'],
    ['RMC-FOAM', 'Foam Concrete / CLC (filling)'],
  ]),
  ...p('Precast Items', 'NOS', [
    ['PRC-KERB', 'Precast Kerb Stone', 'M30'],
    ['PRC-MHCOVER', 'Precast RCC Manhole Cover with Frame', 'Size as required'],
    ['PRC-LINTEL', 'Precast Lintel'],
    ['PRC-WALLPANEL', 'Precast Compound Wall Panel'],
    ['PRC-COVERSLAB', 'Precast Drain Cover Slab'],
  ]),
  ...p('Precast Items', 'M', [['PRC-HUMEPIPE', 'RCC Hume Pipe', 'NP2 / NP3, diameter as required']]),

  // ── Masonry ──────────────────────────────────────────────────────
  ...p('Bricks & Blocks', 'NOS', [
    ['BRK-CLAY', 'Red Clay Brick', '230 x 110 x 75 mm'],
    ['BRK-WIRECUT', 'Wire-Cut Brick', '230 x 110 x 75 mm'],
    ['BRK-FLYASH', 'Fly Ash Brick', '230 x 110 x 75 mm'],
    ['BLK-SOLID100', 'Solid Concrete Block 100 mm', '400 x 200 x 100 mm'],
    ['BLK-SOLID150', 'Solid Concrete Block 150 mm', '400 x 200 x 150 mm'],
    ['BLK-SOLID200', 'Solid Concrete Block 200 mm', '400 x 200 x 200 mm'],
    ['BLK-HOLLOW200', 'Hollow Concrete Block 200 mm', '400 x 200 x 200 mm'],
    ['BLK-GLASS', 'Glass Block', '190 x 190 x 80 mm'],
  ]),
  ...p('Bricks & Blocks', 'CUM', [
    ['BLK-AAC075', 'AAC Block 75 mm', '600 x 200 x 75 mm'],
    ['BLK-AAC100', 'AAC Block 100 mm', '600 x 200 x 100 mm'],
    ['BLK-AAC150', 'AAC Block 150 mm', '600 x 200 x 150 mm'],
    ['BLK-AAC200', 'AAC Block 200 mm', '600 x 200 x 200 mm'],
  ]),

  // ── Chemicals & waterproofing ────────────────────────────────────
  ...p('Admixtures & Chemicals', 'LTR', [
    ['CHM-PLAST', 'Plasticizer (concrete admixture)', 'IS 9103'],
    ['CHM-SUPERPLAST', 'Superplasticizer (PCE based)', 'IS 9103'],
    ['CHM-RETARDER', 'Retarder Admixture', 'IS 9103'],
    ['CHM-ACCEL', 'Accelerator Admixture', 'IS 9103'],
    ['CHM-CURING', 'Curing Compound'],
    ['CHM-BONDING', 'Bonding Agent (SBR latex)'],
    ['CHM-IWPC', 'Integral Waterproofing Compound'],
    ['CHM-SHUTOIL', 'Shuttering / Mould Release Oil'],
    ['CHM-ANTITERMITE', 'Anti-Termite Chemical', 'Chlorpyrifos 20% EC'],
    ['CHM-EPOXYBOND', 'Epoxy Bonding Agent (old to new concrete)'],
    ['CHM-HARDENER', 'Floor Hardener (liquid densifier)'],
  ]),
  ...p('Admixtures & Chemicals', 'KG', [
    ['CHM-WPCOAT', 'Cementitious Waterproof Coating (2-component)'],
    ['CHM-GROUT', 'Tile Grout'],
    ['CHM-EPOXYGROUT', 'Epoxy Tile Grout'],
    ['CHM-NSGROUT', 'Non-Shrink Grout', 'Cementitious, free-flow'],
    ['CHM-CRYSTAL', 'Crystalline Waterproofing'],
    ['CHM-INJECTION', 'Injection Grout (PU / epoxy)'],
  ]),
  ...p('Admixtures & Chemicals', 'BAG', [
    ['CHM-TILEADH', 'Tile Adhesive', '20 kg bag'],
    ['CHM-BLOCKMORT', 'Block Jointing Mortar', '40 kg bag'],
    ['CHM-MICROCONC', 'Micro Concrete (repair)', '25 kg bag'],
    ['CHM-REPAIRMORT', 'Polymer Repair Mortar', '25 kg bag'],
    ['CHM-SCREED', 'Self-Levelling Screed', '25 kg bag'],
  ]),
  ...p('Waterproofing & Sealants', 'SQM', [
    ['CHM-WPMEMB', 'Waterproofing Membrane (APP / SBS)', '3 mm / 4 mm'],
    ['WPF-HDPEMEMB', 'HDPE Waterproofing Membrane (basement)'],
    ['WPF-PUCOAT', 'PU Liquid Waterproofing (terrace)', 'Coverage per SQM'],
    ['WPF-DRAINCELL', 'Drainage Cell / Protection Board'],
  ]),
  ...p('Waterproofing & Sealants', 'KG', [
    ['WPF-BITUMEN', 'Bitumen 85/25 (waterproofing)'],
    ['WPF-BITUPRIMER', 'Bituminous Primer'],
  ]),
  ...p('Waterproofing & Sealants', 'M', [
    ['WPF-PVCSTOP', 'PVC Waterstop', '150 / 230 mm'],
    ['WPF-SWELLSTRIP', 'Hydrophilic Swellable Strip'],
    ['WPF-BACKERROD', 'Backer Rod', 'Diameter as required'],
  ]),
  ...p('Waterproofing & Sealants', 'SQM', [['WPF-JOINTFILLER', 'Expansion Joint Filler Board', '20 / 25 mm']]),
  ...p('Waterproofing & Sealants', 'NOS', [
    ['WPF-SILICONE', 'Silicone Sealant (cartridge)', '300 ml'],
    ['WPF-PUSEALANT', 'PU Sealant (sausage / cartridge)', '600 ml'],
  ]),
  ...p('Waterproofing & Sealants', 'LTR', [['WPF-POLYSULPHIDE', 'Polysulphide Sealant']]),

  // ── Formwork & scaffolding ───────────────────────────────────────
  ...p('Formwork & Shuttering', 'SQM', [
    ['FRM-PLY12', 'Shuttering Plywood 12 mm', 'Film faced'],
    ['FRM-PLY18', 'Shuttering Plywood 18 mm', 'Film faced'],
    ['FRM-MSPLATE', 'Steel Shuttering Plate'],
    ['FRM-ALUMINIUM', 'Aluminium Formwork (system)', 'Hire / purchase'],
  ]),
  ...p('Formwork & Shuttering', 'NOS', [
    ['FRM-PROP', 'Adjustable Steel Prop'],
    ['FRM-COVERBLK', 'Concrete Cover Block', '25 / 40 / 50 mm'],
    ['FRM-PVCSPACER', 'PVC Cover Spacer / Chair'],
    ['FRM-TIEROD', 'Form Tie Rod with Wing Nut'],
    ['FRM-CONE', 'Tie Rod Cone (PVC)'],
    ['FRM-HBEAM', 'Timber H-Beam (formwork)'],
    ['FRM-COLCLAMP', 'Column Clamp'],
  ]),
  ...p('Formwork & Shuttering', 'M', [['FRM-PVCSLEEVE', 'PVC Sleeve for Tie Rod']]),
  ...p('Formwork & Shuttering', 'KG', [['FRM-NAILS', 'Nails (assorted)']]),
  ...p('Formwork & Shuttering', 'CUM', [['FRM-BATTEN', 'Wooden Battens / Runners (formwork)', 'Country wood']]),
  ...p('Scaffolding', 'M', [['SCF-PIPE', 'Scaffolding Pipe (GI / MS)', '40 NB']]),
  ...p('Scaffolding', 'NOS', [
    ['SCF-COUPLER', 'Scaffolding Coupler (fixed / swivel)'],
    ['SCF-CUPVERT', 'Cup-Lock Vertical'],
    ['SCF-CUPLEDGER', 'Cup-Lock Ledger'],
    ['SCF-BASEJACK', 'Base Jack'],
    ['SCF-UJACK', 'U-Head Jack'],
    ['SCF-PLANK', 'Scaffolding Walkway Plank (steel)'],
    ['SCF-LADDER', 'Scaffolding Ladder'],
  ]),

  // ── Timber & boards ──────────────────────────────────────────────
  ...p('Timber & Boards', 'CUM', [
    ['TMB-TEAK', 'Teak Wood (sawn)'],
    ['TMB-SAL', 'Sal Wood (sawn)'],
    ['TMB-COUNTRY', 'Country Wood (sawn)'],
  ]),
  ...p('Timber & Boards', 'SQM', [
    ['TMB-PLY19', 'Commercial Plywood 19 mm', 'IS 303 MR grade'],
    ['TMB-PLY12', 'Commercial Plywood 12 mm', 'IS 303 MR grade'],
    ['TMB-MARINEPLY', 'Marine Plywood 19 mm', 'IS 710 BWP'],
    ['TMB-BLOCKBOARD', 'Block Board 19 mm', 'IS 1659'],
    ['TMB-MDF', 'MDF Board 18 mm'],
    ['TMB-LAMINATE', 'Decorative Laminate 1 mm'],
    ['TMB-VENEER', 'Decorative Veneer'],
  ]),
  ...p('Timber & Boards', 'RM', [['TMB-LIPPING', 'Wooden Edge Lipping / Beading']]),

  // ── Flooring & stone ─────────────────────────────────────────────
  ...p('Tiles & Stone', 'SQM', [
    ['TIL-VIT600', 'Vitrified Tile 600 x 600 mm'],
    ['TIL-VIT800', 'Vitrified Tile 800 x 800 mm'],
    ['TIL-VIT1200', 'Vitrified Tile 600 x 1200 mm'],
    ['TIL-CERWALL', 'Ceramic Wall Tile 300 x 600 mm'],
    ['TIL-CERFLOOR', 'Ceramic Floor Tile 400 x 400 mm'],
    ['TIL-ANTISKID', 'Anti-Skid Ceramic Floor Tile 300 x 300 mm'],
    ['TIL-PARKING', 'Heavy-Duty Parking Tile', '300 x 300 mm'],
    ['TIL-CLADDING', 'Wall Cladding Tile (elevation)'],
    ['STN-GRANITE', 'Granite Slab 18 mm'],
    ['STN-MARBLE', 'Marble Slab 18 mm'],
    ['STN-KOTA', 'Kota Stone 25 mm'],
    ['STN-SANDSTONE', 'Sandstone (cladding / paving)'],
    ['STN-QUARTZ', 'Quartz Slab (counter top)', '15 / 20 mm'],
    ['PAV-80MM', 'Interlocking Paver Block 80 mm', 'M35'],
    ['PAV-60MM', 'Interlocking Paver Block 60 mm', 'M30'],
    ['PAV-GRASS', 'Grass Paver Block'],
    ['FLR-WOODEN', 'Engineered Wooden Flooring'],
    ['FLR-VINYL', 'Vinyl / LVT Flooring'],
    ['FLR-CARPET', 'Carpet Tile'],
    ['FLR-EPOXY', 'Epoxy Floor Coating (system)', 'Thickness as specified'],
  ]),
  ...p('Tiles & Stone', 'RM', [
    ['TIL-SKIRTING', 'Skirting Tile', '100 mm high'],
    ['STN-STEPRISER', 'Granite Step and Riser'],
  ]),

  // ── Painting & ceilings ──────────────────────────────────────────
  ...p('Paint & Finishes', 'LTR', [
    ['PNT-PRIMINT', 'Interior Primer'],
    ['PNT-PRIMEXT', 'Exterior Primer'],
    ['PNT-EMULINT', 'Interior Emulsion Paint'],
    ['PNT-EMULEXT', 'Exterior Emulsion Paint'],
    ['PNT-ENAMEL', 'Synthetic Enamel Paint'],
    ['PNT-REDOXIDE', 'Red Oxide Metal Primer'],
    ['PNT-WOODPRIMER', 'Wood Primer'],
    ['PNT-PUPOLISH', 'PU Wood Polish'],
    ['PNT-THINNER', 'Thinner'],
    ['PNT-EPOXY', 'Epoxy Paint'],
    ['PNT-ROADMARK', 'Road Marking Paint'],
    ['PNT-TEXTURE', 'Texture Paint (exterior)'],
  ]),
  ...p('Paint & Finishes', 'KG', [
    ['PNT-PUTTY', 'Wall Putty', 'White cement based'],
    ['PNT-POP', 'Plaster of Paris (POP)'],
    ['PNT-DISTEMPER', 'Oil-Bound Distemper'],
    ['PNT-CEMENTPAINT', 'Cement Paint'],
  ]),
  ...p('Paint & Finishes', 'BAG', [['PNT-GYPPLAST', 'Gypsum Plaster', '25 kg bag']]),
  ...p('Paint & Finishes', 'NOS', [
    ['PNT-SANDPAPER', 'Sand Paper / Emery Paper'],
    ['PNT-MASKTAPE', 'Masking Tape (roll)'],
    ['PNT-ROLLER', 'Paint Roller'],
    ['PNT-BRUSH', 'Paint Brush'],
  ]),
  ...p('Ceilings & Partitions', 'SQM', [
    ['CEIL-GYPBOARD', 'Gypsum Board 12.5 mm (false ceiling)'],
    ['CEIL-GRID', 'False Ceiling Grid System', '600 x 600 mm'],
    ['CEIL-MINFIBRE', 'Mineral Fibre Ceiling Tile', '600 x 600 mm'],
    ['CEIL-METAL', 'Metal Ceiling (clip-in / baffle)'],
    ['CEIL-CALSIL', 'Calcium Silicate Board'],
    ['PRT-CEMENTBOARD', 'Fibre Cement Board'],
    ['PRT-DRYWALL', 'Gypsum Drywall Partition (system)'],
    ['PRT-GLASS', 'Glass Partition (frameless)'],
  ]),

  // ── Doors, windows, glazing, railings ────────────────────────────
  ...p('Doors, Windows & Glass', 'NOS', [
    ['DOR-FLUSH', 'Flush Door Shutter 35 mm'],
    ['DOR-STEEL', 'Steel Door with Frame'],
    ['DOR-FIRE', 'Fire-Rated Door', '2-hour rating'],
    ['DOR-HARDWARE', 'Door Hardware Set'],
    ['HDW-HINGE', 'Butt Hinge (SS)'],
    ['HDW-TOWERBOLT', 'Tower Bolt'],
    ['HDW-CLOSER', 'Door Closer'],
    ['HDW-MORTISE', 'Mortise Lock with Handle'],
    ['HDW-STOPPER', 'Door Stopper'],
  ]),
  ...p('Doors, Windows & Glass', 'SQM', [
    ['WIN-UPVC', 'UPVC Window'],
    ['WIN-ALU', 'Aluminium Window'],
    ['WIN-ALUDOOR', 'Aluminium Sliding Door'],
    ['GLS-TOUGH12', 'Toughened Glass 12 mm'],
    ['GLS-CLEAR5', 'Clear Float Glass 5 mm'],
    ['GLS-CLEAR8', 'Clear Float Glass 8 mm'],
    ['GLS-DGU', 'Double Glazed Unit (DGU)'],
    ['GLS-MIRROR', 'Mirror 5 mm'],
    ['FAC-ACP', 'Aluminium Composite Panel (ACP) 4 mm'],
    ['FAC-GLAZING', 'Structural Glazing (system)'],
    ['DOR-SHUTTER', 'Rolling Shutter (MS)'],
  ]),
  ...p('Doors, Windows & Glass', 'RM', [
    ['DOR-FRAME', 'Door Frame (hard wood)'],
    ['DOR-WPCFRAME', 'WPC Door Frame'],
    ['RLG-SS', 'SS Handrail / Railing'],
    ['RLG-GLASS', 'Glass Railing with SS Fittings'],
  ]),
  ...p('Doors, Windows & Glass', 'KG', [
    ['RLG-MS', 'MS Railing / Grill Fabrication'],
    ['WIN-ALUSECTION', 'Aluminium Section'],
  ]),

  // ── Roofing & insulation ─────────────────────────────────────────
  ...p('Roofing & Insulation', 'SQM', [
    ['ROF-COLOURSHEET', 'Colour-Coated Roofing Sheet', '0.5 mm'],
    ['ROF-GISHEET', 'GI Corrugated Roofing Sheet'],
    ['ROF-POLYCARB', 'Polycarbonate Sheet'],
    ['ROF-PUFPANEL', 'PUF Sandwich Panel'],
    ['INS-XPS', 'XPS Insulation Board', '50 mm'],
    ['INS-EPS', 'EPS / Thermocol Sheet'],
    ['INS-GLASSWOOL', 'Glass Wool Insulation'],
    ['INS-ROCKWOOL', 'Rock Wool Insulation'],
    ['ROF-UNDERDECK', 'Under-Deck Insulation (reflective)'],
  ]),
  ...p('Roofing & Insulation', 'NOS', [
    ['ROF-MANGALORE', 'Mangalore Roof Tile'],
    ['ROF-TURBO', 'Turbo Ventilator'],
  ]),
  ...p('Roofing & Insulation', 'RM', [
    ['ROF-GUTTER', 'Rain Water Gutter'],
    ['ROF-RIDGE', 'Ridge Cap / Flashing'],
  ]),

  // ── Plumbing & sanitary ──────────────────────────────────────────
  ...p('Plumbing & Sanitary', 'M', [
    ['PLB-CPVC15', 'CPVC Pipe 15 mm (1/2")', 'SDR 11'],
    ['PLB-CPVC20', 'CPVC Pipe 20 mm (3/4")', 'SDR 11'],
    ['PLB-CPVC25', 'CPVC Pipe 25 mm (1")', 'SDR 11'],
    ['PLB-CPVC32', 'CPVC Pipe 32 mm (1 1/4")', 'SDR 11'],
    ['PLB-UPVC75', 'UPVC SWR Pipe 75 mm', 'IS 13592'],
    ['PLB-UPVC110', 'UPVC SWR Pipe 110 mm', 'IS 13592'],
    ['PLB-UPVC160', 'UPVC SWR Pipe 160 mm', 'IS 13592'],
    ['PLB-UPVCPRESS', 'UPVC Pressure Pipe', 'IS 4985, size as required'],
    ['PLB-PPR', 'PPR Pipe', 'PN 16, size as required'],
    ['PLB-HDPE', 'HDPE Pipe', 'PE 100, size as required'],
    ['PLB-GIPIPE', 'GI Pipe', 'Medium class, IS 1239'],
    ['PLB-DWC', 'DWC Pipe (sewer)', 'Size as required'],
    ['PLB-RWP', 'Rain Water Pipe (UPVC) 110 mm'],
  ]),
  ...p('Plumbing & Sanitary', 'NOS', [
    ['PLB-BALLVALVE', 'Ball Valve', 'Brass, size as required'],
    ['PLB-GATEVALVE', 'Gate Valve', 'Size as required'],
    ['PLB-NRV', 'Non-Return Valve', 'Size as required'],
    ['PLB-CPVCFIT', 'CPVC Fittings (elbow, tee, coupler)'],
    ['PLB-UPVCFIT', 'UPVC / SWR Fittings (bend, tee, door elbow)'],
    ['PLB-GIFIT', 'GI Fittings'],
    ['PLB-CLAMP', 'Pipe Clamp / Saddle'],
    ['PLB-TANK1000', 'Water Storage Tank 1000 L'],
    ['PLB-TANK500', 'Water Storage Tank 500 L'],
    ['PLB-FLOORTRAP', 'Floor Trap / Nahani Trap'],
    ['PLB-GULLYTRAP', 'Gully Trap'],
    ['PLB-MHCOVER', 'Manhole Cover (CI / FRP)'],
    ['PLB-CHAMBER', 'Inspection Chamber (PVC)'],
    ['PLB-WATERMETER', 'Water Meter'],
    ['PLB-PUMP', 'Water Pump (monoblock / submersible)'],
    ['PLB-TEFLON', 'Teflon Tape'],
  ]),
  ...p('Plumbing & Sanitary', 'LTR', [['PLB-SOLVENT', 'Solvent Cement (CPVC / UPVC)']]),
  ...p('Plumbing & Sanitary', 'SET', [
    ['SAN-EWC', 'EWC (Western Closet) with Cistern'],
    ['SAN-IWC', 'IWC (Indian Closet)'],
    ['SAN-WASHBASIN', 'Wash Basin with Pedestal'],
    ['SAN-URINAL', 'Urinal with Flush Valve'],
    ['SAN-SINK', 'Kitchen Sink (SS) with Waste'],
    ['SAN-CPFIT', 'CP Fittings Set (tap, shower, mixer)'],
    ['SAN-HEALTHFAUCET', 'Health Faucet'],
    ['SAN-ACCESSORIES', 'Bathroom Accessories Set'],
  ]),

  // ── Fire fighting ────────────────────────────────────────────────
  ...p('Fire Fighting', 'NOS', [
    ['FIR-SPRINKLER', 'Sprinkler Head', '68 °C'],
    ['FIR-EXTINGUISHER', 'Fire Extinguisher (ABC)', '6 kg'],
    ['FIR-HOSEREEL', 'Fire Hose Reel Drum'],
    ['FIR-HYDRANT', 'Landing / Hydrant Valve'],
    ['FIR-SMOKEDET', 'Smoke Detector'],
    ['FIR-MCP', 'Manual Call Point'],
    ['FIR-HOOTER', 'Fire Alarm Hooter'],
  ]),
  ...p('Fire Fighting', 'M', [
    ['FIR-MSPIPE', 'MS Pipe Heavy Class (fire line)', 'IS 1239'],
    ['FIR-HOSE', 'RRL Fire Hose', '63 mm'],
  ]),

  // ── Electrical ───────────────────────────────────────────────────
  ...p('Electrical', 'M', [
    ['ELE-WIRE1.5', 'FR Copper Wire 1.5 sq mm'],
    ['ELE-WIRE2.5', 'FR Copper Wire 2.5 sq mm'],
    ['ELE-WIRE4', 'FR Copper Wire 4 sq mm'],
    ['ELE-WIRE6', 'FR Copper Wire 6 sq mm'],
    ['ELE-WIRE10', 'FR Copper Wire 10 sq mm'],
    ['ELE-FLEX3C', 'Flexible Cable 3-Core'],
    ['ELE-CONDUIT20', 'PVC Conduit 20 mm'],
    ['ELE-CONDUIT25', 'PVC Conduit 25 mm'],
    ['ELE-ARMCABLE', 'Armoured Cable (XLPE)', 'Size as required'],
    ['ELE-CABLETRAY', 'Cable Tray (perforated / ladder)', 'Size as required'],
    ['ELE-EARTHSTRIP', 'GI / Copper Earthing Strip'],
    ['ELE-DATACABLE', 'Data Cable CAT6'],
    ['ELE-TVCABLE', 'TV / Coaxial Cable'],
  ]),
  ...p('Electrical', 'NOS', [
    ['ELE-SWITCH', 'Modular Switch / Socket'],
    ['ELE-MODBOX', 'Modular Box / Concealed Box'],
    ['ELE-JUNCTION', 'Junction Box'],
    ['ELE-MCB', 'MCB', 'Rating as required'],
    ['ELE-RCCB', 'RCCB / ELCB', 'Rating as required'],
    ['ELE-MCCB', 'MCCB', 'Rating as required'],
    ['ELE-DB8', 'Distribution Board 8-way'],
    ['ELE-DB12', 'Distribution Board 12-way'],
    ['ELE-LEDPANEL', 'LED Panel Light'],
    ['ELE-LEDTUBE', 'LED Tube Light'],
    ['ELE-DOWNLIGHT', 'LED Down Light'],
    ['ELE-FLOOD', 'LED Flood Light'],
    ['ELE-STREET', 'LED Street Light with Pole'],
    ['ELE-FAN', 'Ceiling Fan'],
    ['ELE-EXHAUST', 'Exhaust Fan'],
    ['ELE-LUGS', 'Cable Lugs and Glands'],
    ['ELE-TAPE', 'Insulation Tape'],
  ]),
  ...p('Electrical', 'SET', [
    ['ELE-EARTHING', 'Earthing Electrode with Pit'],
    ['ELE-LTPANEL', 'LT Panel / Main Distribution Panel'],
    ['ELE-LIGHTNING', 'Lightning Arrester System'],
  ]),

  // ── HVAC ─────────────────────────────────────────────────────────
  ...p('HVAC', 'NOS', [
    ['HVC-SPLITAC', 'Split Air Conditioner', 'Capacity as required'],
    ['HVC-DIFFUSER', 'Air Diffuser / Grille'],
  ]),
  ...p('HVAC', 'M', [['HVC-CUPIPE', 'Copper Refrigerant Pipe (insulated)']]),
  ...p('HVAC', 'SQM', [['HVC-DUCT', 'GI Ducting', 'Gauge as required']]),

  // ── Road & external works ────────────────────────────────────────
  ...p('Road & External Works', 'MT', [
    ['ROD-VG30', 'Bitumen VG-30'],
    ['ROD-DBM', 'Dense Bituminous Macadam (DBM)'],
    ['ROD-BC', 'Bituminous Concrete (BC)'],
  ]),
  ...p('Road & External Works', 'LTR', [['ROD-EMULSION', 'Bitumen Emulsion (prime / tack coat)']]),
  ...p('Road & External Works', 'SQM', [
    ['ROD-GEOTEXTILE', 'Geotextile Fabric'],
    ['ROD-TURF', 'Lawn / Turf Grass'],
  ]),
  ...p('Road & External Works', 'NOS', [
    ['ROD-SIGNBOARD', 'Road Sign Board'],
    ['ROD-STUD', 'Road Stud / Cat Eye'],
    ['ROD-PLANT', 'Plant / Sapling'],
  ]),
  ...p('Road & External Works', 'CUM', [['ROD-GARDENSOIL', 'Garden Soil / Red Soil']]),

  // ── Fasteners ────────────────────────────────────────────────────
  ...p('Fasteners & Fixings', 'NOS', [
    ['FIX-ANCHOR', 'Anchor Fastener (sleeve / wedge)', 'Size as required'],
    ['FIX-CHEMANCHOR', 'Chemical Anchor (capsule / cartridge)'],
    ['FIX-SCREW', 'Screws (box of 100)'],
    ['FIX-WALLPLUG', 'Wall Plug / Rawl Plug'],
    ['FIX-RIVET', 'Blind Rivet'],
    ['FIX-SDS', 'Self-Drilling Screw (roofing)'],
  ]),
  ...p('Fasteners & Fixings', 'KG', [['FIX-BOLTNUT', 'Bolts, Nuts and Washers']]),

  // ── Fuel, consumables, site facilities ───────────────────────────
  ...p('Fuel & Consumables', 'LTR', [
    ['CON-DIESEL', 'Diesel'],
    ['CON-PETROL', 'Petrol'],
    ['CON-ENGINEOIL', 'Engine Oil'],
    ['CON-HYDOIL', 'Hydraulic Oil'],
  ]),
  ...p('Fuel & Consumables', 'KG', [
    ['CON-WELDROD', 'Welding Electrode'],
    ['CON-GREASE', 'Grease'],
    ['CON-COTTONWASTE', 'Cotton Waste'],
  ]),
  ...p('Fuel & Consumables', 'NOS', [
    ['CON-CUTWHEEL', 'Cutting Wheel'],
    ['CON-GRINDDISC', 'Grinding Disc'],
    ['CON-DRILLBIT', 'Drill Bit'],
    ['CON-OXYGEN', 'Oxygen Cylinder (refill)'],
    ['CON-LPG', 'LPG / DA Cylinder (refill)'],
    ['CON-GUNNY', 'Gunny Bag'],
    ['CON-WATERTANKER', 'Water Tanker (construction water)', 'Per load'],
  ]),
  ...p('Fuel & Consumables', 'SQM', [
    ['CON-POLYSHEET', 'Polythene Sheet'],
    ['CON-HESSIAN', 'Hessian Cloth (curing)'],
    ['CON-TARPAULIN', 'Tarpaulin'],
    ['CON-BARRICADE', 'Barricading Sheet (GI / colour-coated)'],
    ['CON-GREENNET', 'Green Shade Net'],
  ]),
  ...p('Fuel & Consumables', 'M', [['CON-ROPE', 'Nylon / Manila Rope']]),

  // ── Small tools ──────────────────────────────────────────────────
  ...p('Small Tools', 'NOS', [
    ['TLS-SHOVEL', 'Shovel / Spade'],
    ['TLS-PAN', 'Mortar Pan (ghamela)'],
    ['TLS-BARROW', 'Wheel Barrow'],
    ['TLS-TROWEL', 'Trowel'],
    ['TLS-LEVEL', 'Spirit Level'],
    ['TLS-TAPE', 'Measuring Tape'],
    ['TLS-HAMMER', 'Hammer'],
    ['TLS-CROWBAR', 'Crow Bar'],
    ['TLS-PLUMB', 'Plumb Bob'],
    ['TLS-LADDER', 'Aluminium Ladder'],
    ['TLS-VIBNEEDLE', 'Vibrator Needle'],
    ['TLS-PICKAXE', 'Pick Axe'],
    ['TLS-BUCKET', 'Bucket'],
    ['TLS-CUBEMOULD', 'Cube Mould 150 mm'],
    ['TLS-SLUMPCONE', 'Slump Cone Set'],
  ]),

  // ── Safety ───────────────────────────────────────────────────────
  ...p('Safety (PPE)', 'NOS', [
    ['PPE-HELMET', 'Safety Helmet'],
    ['PPE-SHOES', 'Safety Shoes'],
    ['PPE-GLOVES', 'Safety Gloves (pair)'],
    ['PPE-JACKET', 'Reflective Safety Jacket'],
    ['PPE-HARNESS', 'Full Body Safety Harness'],
    ['PPE-GOGGLES', 'Safety Goggles'],
    ['PPE-EARPLUG', 'Ear Plug (pair)'],
    ['PPE-MASK', 'Dust Mask'],
    ['PPE-GUMBOOT', 'Gum Boots (pair)'],
    ['PPE-RAINCOAT', 'Rain Coat'],
    ['SAF-SIGNAGE', 'Safety Signage Board'],
    ['SAF-CONE', 'Traffic Cone'],
  ]),
  ...p('Safety (PPE)', 'SQM', [['SAF-NET', 'Safety Net']]),
  ...p('Safety (PPE)', 'M', [
    ['SAF-LIFELINE', 'Life Line Rope'],
    ['SAF-TAPE', 'Barricade Tape'],
  ]),
  ...p('Safety (PPE)', 'SET', [['SAF-FIRSTAID', 'First Aid Kit']]),
];

/** Categories of the preset list, in list order. Offered as suggestions; any other category can be typed. */
export const MATERIAL_CATEGORIES: readonly string[] = [...new Set(MATERIAL_PRESETS.map((m) => m.category))];
