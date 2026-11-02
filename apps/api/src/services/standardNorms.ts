/**
 * Standard library of per-day labour output norms, so every common kind of site work can be
 * measured (output % and profit / loss) without typing a norm first.
 *
 * Figures are typical Indian site output for one crew working an 8-hour day, taken from the middle
 * of the ranges in CPWD analysis-of-rates / IS 7272 based handbooks (checked Nov 2026). "Mason"
 * stands for the skilled worker of the trade (tiler, painter, carpenter, fitter, plumber,
 * electrician). Sites vary by ±20–30 %: each organisation can edit these rows (codes STD-…),
 * and its own norms always win over the standard ones when both describe the work.
 *
 * Rows are added once per organisation and never overwritten, so edits are kept.
 */
import type { Db } from '../lib/prisma.js';

export interface StandardNorm {
  code: string;
  name: string;
  /** Other words for the same work, comma separated. */
  keywords: string;
  unit: string;
  outputPerDay: number;
  masonsPerCrew: number;
  helpersPerCrew: number;
}

const n = (code: string, name: string, keywords: string, unit: string, outputPerDay: number, masonsPerCrew: number, helpersPerCrew: number): StandardNorm => ({ code: `STD-${code}`, name, keywords, unit, outputPerDay, masonsPerCrew, helpersPerCrew });

export const STANDARD_LABOUR_NORMS: StandardNorm[] = [
  // Masonry
  n('BRICK-NOS', 'Brickwork', 'brick, bricks, brickwork, brick masonry, brick installation, brick laying', 'Nos', 500, 1, 2),
  n('BRICK-CUM', 'Brickwork (by volume)', 'brickwork cum, brick masonry cum', 'Cum', 1.25, 1, 2),
  n('BLOCK-SQFT', 'Block work', 'block, blocks, blockwork, block masonry, block wall, aac block, solid block, concrete block', 'Sq.ft', 110, 1, 1),
  n('BLOCK-NOS', 'Block laying (Nos)', 'block laying, aac block, solid block, block installation', 'Nos', 100, 1, 1),
  n('STONE-CUM', 'Stone masonry', 'stone masonry, rubble masonry, rr masonry', 'Cum', 1, 1, 2),
  // Plastering
  n('PLAS-INT', 'Internal plastering', 'plaster, plastering, internal plaster, wall plaster, wall plastering, inside plaster', 'Sq.ft', 120, 1, 1),
  n('PLAS-EXT', 'External plastering', 'external plaster, external plastering, outside plaster, exterior plaster', 'Sq.ft', 90, 1, 1),
  n('PLAS-CEIL', 'Ceiling plastering', 'ceiling plaster, ceiling plastering, soffit plaster', 'Sq.ft', 95, 1, 1),
  n('PUNNING', 'POP / gypsum punning', 'pop, punning, pop punning, gypsum plaster, gypsum punning', 'Sq.ft', 150, 1, 1),
  // Floors and walls
  n('SCREED', 'Floor screeding', 'screed, screeding, floor screed, floor screeding, levelling screed, leveling screed, pcc flooring, cement flooring, base coat flooring', 'Sq.ft', 250, 1, 2),
  n('ROOF-SCREED', 'Roof screed / terrace slope', 'roof screed, terrace screed, terrace slope, brickbat coba, brick bat coba', 'Sq.ft', 150, 1, 2),
  n('TILE-FLOOR', 'Floor tiling', 'tile, tiles, tiling, floor tile, floor tiling, vitrified, ceramic tile, tile laying, tile fixing', 'Sq.ft', 100, 1, 1),
  n('TILE-WALL', 'Wall tiling / dado', 'wall tile, wall tiling, dado, dado tile, toilet wall tile, kitchen dado', 'Sq.ft', 75, 1, 1),
  n('TILE-LARGE', 'Large format tile / slab', 'large format, slab tile, 1200, 800x1600, 1200x2400', 'Sq.ft', 60, 1, 2),
  n('GRANITE', 'Granite / marble flooring', 'granite, marble, stone flooring, kota, kotah', 'Sq.ft', 60, 1, 1),
  n('CLADDING', 'Stone / tile cladding', 'cladding, stone cladding, wall cladding, steps cladding, elevation cladding', 'Sq.ft', 40, 1, 1),
  n('SKIRTING', 'Skirting', 'skirting', 'Rft', 80, 1, 1),
  n('GROUT', 'Tile joint grouting', 'grout, grouting, joint filling, epoxy grout, tile joint', 'Sq.ft', 300, 1, 0),
  n('PAVER', 'Paver block laying', 'paver, paver block, interlock, interlocking', 'Sq.ft', 200, 1, 2),
  // Concrete and steel
  n('SHUTTER', 'Shuttering / formwork', 'shuttering, formwork, form work, centering, centring', 'Sq.ft', 90, 1, 1),
  n('BAR-BEND', 'Bar bending and fixing', 'bar bending, reinforcement, steel fixing, rebar, rod bending, binding', 'Kg', 250, 1, 1),
  n('CONCRETE', 'Concreting with mixer', 'concrete, concreting, rcc, pcc, casting, pour, pouring, slab casting', 'Cum', 6, 1, 6),
  n('EXCAVATION', 'Earth excavation (by hand)', 'excavation, earth work, earthwork, digging, trench, pit', 'Cum', 3, 0, 1),
  n('BACKFILL', 'Backfilling and compaction', 'backfill, backfilling, filling, refilling, compaction, soil filling', 'Cum', 4, 0, 1),
  // Painting
  n('PUTTY', 'Wall putty (two coats)', 'putty, wall putty, putty work', 'Sq.ft', 250, 1, 0),
  n('PRIMER', 'Primer coat', 'primer, priming, primer coat', 'Sq.ft', 375, 1, 0),
  n('PAINT-INT', 'Interior painting (two coats)', 'paint, painting, emulsion, interior paint, interior painting, ceiling paint, wall paint', 'Sq.ft', 240, 1, 0),
  n('PAINT-EXT', 'Exterior painting', 'exterior paint, exterior painting, external paint, external painting, elevation paint', 'Sq.ft', 200, 1, 0),
  n('TEXTURE', 'Texture paint', 'texture, texture paint, textured finish', 'Sq.ft', 120, 1, 0),
  n('ENAMEL', 'Enamel paint on steel / wood', 'enamel, metal paint, grill paint, oil paint, door paint', 'Sq.ft', 150, 1, 0),
  n('POLISH', 'Wood polish', 'polish, polishing, melamine, pu polish, wood polish', 'Sq.ft', 80, 1, 0),
  n('WATERPROOF', 'Waterproofing coating', 'waterproofing, water proofing, membrane, wp coating, brush bond', 'Sq.ft', 300, 1, 1),
  // Ceilings, partitions, joinery
  n('GYP-CEIL', 'Gypsum false ceiling', 'false ceiling, gypsum ceiling, gypsum board, board closing, board ceiling, grid ceiling, ceiling framing', 'Sq.ft', 100, 1, 1),
  n('PARTITION', 'Board partition / drywall', 'partition, drywall, dry wall, cement board, board partition', 'Sq.ft', 100, 1, 1),
  n('ALU-FRAME', 'Aluminium framing', 'aluminium, aluminum, alu frame, aluminium frame, frame work, framing', 'Rft', 100, 1, 1),
  n('GLAZING', 'Glass / glazing fixing', 'glass, glazing, glass fixing, glass partition', 'Sq.ft', 80, 1, 1),
  n('DOOR', 'Door frame / shutter fixing', 'door, door fixing, door frame, door shutter', 'Nos', 4, 1, 1),
  n('WINDOW', 'Window fixing', 'window, window fixing, upvc window, window frame', 'Nos', 4, 1, 1),
  n('MS-FAB', 'MS fabrication and welding', 'fabrication, welding, ms work, ms fabrication, grill, railing, structural steel', 'Kg', 150, 1, 1),
  n('WARDROBE', 'Carpentry / modular furniture fixing', 'carpentry, wardrobe, cupboard, kitchen cabinet, modular, furniture, panelling, paneling', 'Sq.ft', 40, 1, 1),
  // Services
  n('CONDUIT', 'Electrical conduit laying', 'conduit, conduiting, electrical conduit, electrical piping, concealed conduit', 'Rft', 150, 1, 1),
  n('WIRING', 'Electrical wiring points', 'wiring, wiring point, electrical point, light point, wire pulling', 'Nos', 10, 1, 1),
  n('CABLE', 'Cable laying', 'cable, cable laying, cable tray', 'Rmt', 60, 1, 1),
  n('LIGHT-FIX', 'Light / fixture fitting', 'light fitting, light fixing, fixture fitting, fan fixing, luminaire', 'Nos', 15, 1, 1),
  n('PIPE', 'Plumbing pipeline', 'pipe, pipes, pipeline, plumbing, cpvc, upvc, pvc pipe, pipe laying, pipe routing, water line, drain line', 'Rft', 80, 1, 1),
  n('SANITARY', 'Sanitary fixture fixing', 'sanitary, wc, closet, wash basin, washbasin, cp fitting, fixture installation', 'Nos', 4, 1, 1),
  n('CHASING', 'Wall chasing / groove cutting', 'chasing, wall chasing, wall cutting, groove cutting, cutting', 'Rft', 150, 1, 1),
  n('CORE-CUT', 'Core cutting', 'core cut, core cutting, core hole', 'Nos', 8, 1, 1),
  // General
  n('DEBRIS', 'Debris removal / shifting', 'debris, debris removal, shifting, material shifting, loading, unloading', 'Cum', 4, 0, 1),
];

/** Adds any standard norm the organisation does not have yet (by code). Existing rows are never changed. */
export async function ensureStandardNorms(db: Db, orgId: string) {
  const have = new Set((await db.labourNorm.findMany({ where: { orgId, code: { startsWith: 'STD-' } }, select: { code: true } })).map((x) => x.code));
  const add = STANDARD_LABOUR_NORMS.filter((x) => !have.has(x.code));
  if (add.length) {
    await db.labourNorm.createMany({
      data: add.map((x) => ({ ...x, outputPerDay: String(x.outputPerDay), orgId, notes: 'Standard library: typical Indian site output per day (CPWD / IS 7272 based, ±20–30 % by site). Edit to your own figures.' })),
      skipDuplicates: true,
    });
  }
}
