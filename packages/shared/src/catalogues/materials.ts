/**
 * Ready-made list of common construction materials (Indian building practice).
 * Users pick from it on the Materials page ("Add from preset list") or get it as suggestions
 * while typing in the New material form; anything not in the list can still be typed by hand.
 *
 * Units are codes from the default unit list every organisation starts with
 * (NOS, M, RM, SQM, CUM, KG, MT, BAG, LTR, SET, LS). No rates are given: prices differ
 * by city and month, so the standard rate is entered by the user.
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
  ...p('Cement', 'BAG', [
    ['CEM-OPC43', 'Cement OPC 43 Grade', '50 kg bag, IS 269'],
    ['CEM-OPC53', 'Cement OPC 53 Grade', '50 kg bag, IS 269'],
    ['CEM-PPC', 'Cement PPC (Portland Pozzolana)', '50 kg bag, IS 1489'],
    ['CEM-PSC', 'Cement PSC (Portland Slag)', '50 kg bag, IS 455'],
  ]),
  ...p('Cement', 'KG', [['CEM-WHITE', 'White Cement', 'IS 8042']]),
  ...p('Steel', 'MT', [
    ['STL-TMT08', 'TMT Bar Fe500D 8 mm', 'IS 1786'],
    ['STL-TMT10', 'TMT Bar Fe500D 10 mm', 'IS 1786'],
    ['STL-TMT12', 'TMT Bar Fe500D 12 mm', 'IS 1786'],
    ['STL-TMT16', 'TMT Bar Fe500D 16 mm', 'IS 1786'],
    ['STL-TMT20', 'TMT Bar Fe500D 20 mm', 'IS 1786'],
    ['STL-TMT25', 'TMT Bar Fe500D 25 mm', 'IS 1786'],
    ['STL-TMT32', 'TMT Bar Fe500D 32 mm', 'IS 1786'],
    ['STL-STRUCT', 'Structural Steel (ISMB / ISMC / Angles)', 'IS 2062 E250'],
  ]),
  ...p('Steel', 'KG', [
    ['STL-BINDWIRE', 'Binding Wire 18 gauge', 'Annealed GI / black'],
    ['STL-MSPLATE', 'MS Plate', 'IS 2062, thickness as required'],
  ]),
  ...p('Aggregates & Sand', 'CUM', [
    ['AGG-MSAND', 'M-Sand (for concrete)', 'IS 383 Zone II'],
    ['AGG-PSAND', 'P-Sand (for plastering)', 'Fine, washed'],
    ['AGG-RSAND', 'River Sand', 'Washed, IS 383'],
    ['AGG-06MM', 'Coarse Aggregate 6 mm', 'Crushed granite'],
    ['AGG-12MM', 'Coarse Aggregate 12 mm', 'Crushed granite'],
    ['AGG-20MM', 'Coarse Aggregate 20 mm', 'Crushed granite'],
    ['AGG-40MM', 'Coarse Aggregate 40 mm', 'Crushed granite'],
    ['AGG-DUST', 'Quarry Dust'],
    ['AGG-GSB', 'Granular Sub-Base (GSB)', 'MoRTH grading'],
    ['AGG-WMM', 'Wet Mix Macadam (WMM)', 'MoRTH grading'],
    ['AGG-GRAVEL', 'Gravel / Earth for filling'],
  ]),
  ...p('Ready-Mix Concrete', 'CUM', [
    ['RMC-M15', 'Ready-Mix Concrete M15'],
    ['RMC-M20', 'Ready-Mix Concrete M20'],
    ['RMC-M25', 'Ready-Mix Concrete M25'],
    ['RMC-M30', 'Ready-Mix Concrete M30'],
    ['RMC-M35', 'Ready-Mix Concrete M35'],
    ['RMC-M40', 'Ready-Mix Concrete M40'],
  ]),
  ...p('Bricks & Blocks', 'NOS', [
    ['BRK-CLAY', 'Red Clay Brick', '230 x 110 x 75 mm'],
    ['BRK-FLYASH', 'Fly Ash Brick', '230 x 110 x 75 mm'],
    ['BLK-SOLID100', 'Solid Concrete Block 100 mm', '400 x 200 x 100 mm'],
    ['BLK-SOLID150', 'Solid Concrete Block 150 mm', '400 x 200 x 150 mm'],
    ['BLK-SOLID200', 'Solid Concrete Block 200 mm', '400 x 200 x 200 mm'],
  ]),
  ...p('Bricks & Blocks', 'CUM', [
    ['BLK-AAC100', 'AAC Block 100 mm', '600 x 200 x 100 mm'],
    ['BLK-AAC150', 'AAC Block 150 mm', '600 x 200 x 150 mm'],
    ['BLK-AAC200', 'AAC Block 200 mm', '600 x 200 x 200 mm'],
  ]),
  ...p('Admixtures & Chemicals', 'LTR', [
    ['CHM-PLAST', 'Plasticizer (concrete admixture)', 'IS 9103'],
    ['CHM-SUPERPLAST', 'Superplasticizer (PCE based)', 'IS 9103'],
    ['CHM-CURING', 'Curing Compound'],
    ['CHM-BONDING', 'Bonding Agent (SBR latex)'],
    ['CHM-IWPC', 'Integral Waterproofing Compound'],
    ['CHM-SHUTOIL', 'Shuttering / Mould Release Oil'],
  ]),
  ...p('Admixtures & Chemicals', 'KG', [
    ['CHM-WPCOAT', 'Cementitious Waterproof Coating (2-component)'],
    ['CHM-GROUT', 'Tile Grout'],
    ['CHM-NSGROUT', 'Non-Shrink Grout', 'Cementitious, free-flow'],
  ]),
  ...p('Admixtures & Chemicals', 'BAG', [
    ['CHM-TILEADH', 'Tile Adhesive', '20 kg bag'],
    ['CHM-BLOCKMORT', 'Block Jointing Mortar', '40 kg bag'],
  ]),
  ...p('Admixtures & Chemicals', 'SQM', [['CHM-WPMEMB', 'Waterproofing Membrane (APP / SBS)', '3 mm / 4 mm']]),
  ...p('Formwork & Shuttering', 'SQM', [
    ['FRM-PLY12', 'Shuttering Plywood 12 mm', 'Film faced'],
    ['FRM-PLY18', 'Shuttering Plywood 18 mm', 'Film faced'],
    ['FRM-MSPLATE', 'Steel Shuttering Plate'],
  ]),
  ...p('Formwork & Shuttering', 'NOS', [
    ['FRM-PROP', 'Adjustable Steel Prop'],
    ['FRM-COVERBLK', 'Concrete Cover Block', '25 / 40 / 50 mm'],
    ['FRM-TIEROD', 'Form Tie Rod with Wing Nut'],
  ]),
  ...p('Formwork & Shuttering', 'KG', [['FRM-NAILS', 'Nails (assorted)']]),
  ...p('Tiles & Stone', 'SQM', [
    ['TIL-VIT600', 'Vitrified Tile 600 x 600 mm'],
    ['TIL-VIT800', 'Vitrified Tile 800 x 800 mm'],
    ['TIL-VIT1200', 'Vitrified Tile 600 x 1200 mm'],
    ['TIL-CERWALL', 'Ceramic Wall Tile 300 x 600 mm'],
    ['TIL-ANTISKID', 'Anti-Skid Ceramic Floor Tile 300 x 300 mm'],
    ['STN-GRANITE', 'Granite Slab 18 mm'],
    ['STN-MARBLE', 'Marble Slab 18 mm'],
    ['STN-KOTA', 'Kota Stone 25 mm'],
    ['PAV-80MM', 'Interlocking Paver Block 80 mm', 'M35'],
  ]),
  ...p('Paint & Finishes', 'LTR', [
    ['PNT-PRIMINT', 'Interior Primer'],
    ['PNT-PRIMEXT', 'Exterior Primer'],
    ['PNT-EMULINT', 'Interior Emulsion Paint'],
    ['PNT-EMULEXT', 'Exterior Emulsion Paint'],
    ['PNT-ENAMEL', 'Synthetic Enamel Paint'],
    ['PNT-REDOXIDE', 'Red Oxide Metal Primer'],
  ]),
  ...p('Paint & Finishes', 'KG', [
    ['PNT-PUTTY', 'Wall Putty', 'White cement based'],
    ['PNT-POP', 'Plaster of Paris (POP)'],
  ]),
  ...p('Paint & Finishes', 'BAG', [['PNT-GYPPLAST', 'Gypsum Plaster', '25 kg bag']]),
  ...p('Paint & Finishes', 'SQM', [
    ['CEIL-GYPBOARD', 'Gypsum Board 12.5 mm (false ceiling)'],
    ['CEIL-GRID', 'False Ceiling Grid System', '600 x 600 mm'],
  ]),
  ...p('Plumbing & Sanitary', 'M', [
    ['PLB-CPVC15', 'CPVC Pipe 15 mm (1/2")', 'SDR 11'],
    ['PLB-CPVC20', 'CPVC Pipe 20 mm (3/4")', 'SDR 11'],
    ['PLB-CPVC25', 'CPVC Pipe 25 mm (1")', 'SDR 11'],
    ['PLB-UPVC75', 'UPVC SWR Pipe 75 mm', 'IS 13592'],
    ['PLB-UPVC110', 'UPVC SWR Pipe 110 mm', 'IS 13592'],
    ['PLB-HDPE', 'HDPE Pipe', 'PE 100, size as required'],
    ['PLB-GIPIPE', 'GI Pipe', 'Medium class, IS 1239'],
  ]),
  ...p('Plumbing & Sanitary', 'NOS', [
    ['PLB-BALLVALVE', 'Ball Valve', 'Brass, size as required'],
    ['PLB-TANK1000', 'Water Storage Tank 1000 L'],
    ['PLB-FLOORTRAP', 'Floor Trap / Nahani Trap'],
  ]),
  ...p('Plumbing & Sanitary', 'SET', [
    ['SAN-EWC', 'EWC (Western Closet) with Cistern'],
    ['SAN-WASHBASIN', 'Wash Basin with Pedestal'],
    ['SAN-CPFIT', 'CP Fittings Set (tap, shower, mixer)'],
  ]),
  ...p('Electrical', 'M', [
    ['ELE-WIRE1.5', 'FR Copper Wire 1.5 sq mm'],
    ['ELE-WIRE2.5', 'FR Copper Wire 2.5 sq mm'],
    ['ELE-WIRE4', 'FR Copper Wire 4 sq mm'],
    ['ELE-WIRE6', 'FR Copper Wire 6 sq mm'],
    ['ELE-CONDUIT20', 'PVC Conduit 20 mm'],
    ['ELE-CONDUIT25', 'PVC Conduit 25 mm'],
    ['ELE-ARMCABLE', 'Armoured Cable (XLPE)', 'Size as required'],
  ]),
  ...p('Electrical', 'NOS', [
    ['ELE-SWITCH', 'Modular Switch / Socket'],
    ['ELE-MCB', 'MCB', 'Rating as required'],
    ['ELE-DB8', 'Distribution Board 8-way'],
    ['ELE-LEDPANEL', 'LED Panel Light'],
  ]),
  ...p('Electrical', 'SET', [['ELE-EARTHING', 'Earthing Electrode with Pit']]),
  ...p('Doors, Windows & Glass', 'NOS', [
    ['DOR-FLUSH', 'Flush Door Shutter 35 mm'],
    ['DOR-HARDWARE', 'Door Hardware Set'],
  ]),
  ...p('Doors, Windows & Glass', 'SQM', [
    ['WIN-UPVC', 'UPVC Window'],
    ['WIN-ALU', 'Aluminium Window'],
    ['GLS-TOUGH12', 'Toughened Glass 12 mm'],
  ]),
  ...p('Doors, Windows & Glass', 'RM', [['DOR-FRAME', 'Door Frame (hard wood)']]),
  ...p('Fuel & Consumables', 'LTR', [['CON-DIESEL', 'Diesel']]),
  ...p('Fuel & Consumables', 'KG', [['CON-WELDROD', 'Welding Electrode']]),
  ...p('Fuel & Consumables', 'NOS', [['CON-CUTWHEEL', 'Cutting Wheel']]),
  ...p('Fuel & Consumables', 'SQM', [
    ['CON-POLYSHEET', 'Polythene Sheet'],
    ['CON-HESSIAN', 'Hessian Cloth (curing)'],
  ]),
  ...p('Safety (PPE)', 'NOS', [
    ['PPE-HELMET', 'Safety Helmet'],
    ['PPE-SHOES', 'Safety Shoes'],
    ['PPE-GLOVES', 'Safety Gloves (pair)'],
    ['PPE-JACKET', 'Reflective Safety Jacket'],
    ['PPE-HARNESS', 'Full Body Safety Harness'],
  ]),
];

/** Categories of the preset list, in list order. Offered as suggestions; any other category can be typed. */
export const MATERIAL_CATEGORIES: readonly string[] = [...new Set(MATERIAL_PRESETS.map((m) => m.category))];
