import { MATERIAL_CATEGORIES } from './materials.js';

/**
 * Supplier and subcontractor helpers for the "Suppliers & parties" form.
 *
 * - SUPPLY_OPTIONS: what a party supplies (material categories and services) or which trade a
 *   subcontractor works in. Offered while typing in "Supplies / trade"; anything else can be typed.
 * - PARTY_PRESETS: well-known manufacturers and brands in Indian construction. Typing a name
 *   suggests them; picking one fills code, role and supplies. Contact person, phone, GSTIN and
 *   bank details are never preset: they differ per office and dealer, so the user enters them.
 *   A local dealer is simply typed as its own name.
 */
export const SERVICE_CATEGORIES: readonly string[] = ['Construction Equipment', 'Equipment Hire', 'Transport', 'Lift / Elevator', 'Testing Laboratory', 'Labour Supply', 'Survey', 'Security Services', 'Housekeeping'];

export const SUBCONTRACT_TRADES: readonly string[] = [
  'Civil & Structure',
  'Earthwork & Excavation',
  'Piling',
  'Shuttering / Formwork',
  'Bar Bending',
  'Masonry',
  'Plastering',
  'Tiling & Stone Laying',
  'Painting',
  'Waterproofing',
  'Plumbing',
  'Electrical',
  'HVAC',
  'Fire Fighting',
  'Structural Fabrication',
  'Aluminium & Glazing',
  'Carpentry & Interiors',
  'False Ceiling',
  'Flooring',
  'Road Works',
  'Landscaping',
  'Demolition',
  'Scaffolding Erection',
  'Anti-Termite Treatment',
  'STP / WTP',
  'Solar',
];

export const SUPPLY_OPTIONS: readonly string[] = [...new Set([...MATERIAL_CATEGORIES, ...SERVICE_CATEGORIES, ...SUBCONTRACT_TRADES])];

export interface PartyPreset {
  code: string;
  name: string;
  kinds: readonly string[];
  supplies: readonly string[];
}

const b = (supplies: string[], items: Array<[code: string, name: string]>): PartyPreset[] => items.map(([code, name]) => ({ code: `BR-${code}`, name, kinds: ['SUPPLIER'], supplies }));

export const PARTY_PRESETS: readonly PartyPreset[] = [
  ...b(['Cement'], [
    ['ULTRATECH', 'UltraTech Cement'],
    ['ACC', 'ACC Cement'],
    ['AMBUJA', 'Ambuja Cements'],
    ['SHREE', 'Shree Cement'],
    ['DALMIA', 'Dalmia Bharat Cement'],
    ['RAMCO', 'The Ramco Cements'],
    ['CHETTINAD', 'Chettinad Cement'],
    ['INDIACEM', 'The India Cements'],
    ['JKCEMENT', 'JK Cement'],
    ['JKLAKSHMI', 'JK Lakshmi Cement'],
    ['BIRLACORP', 'Birla Corporation (MP Birla Cement)'],
    ['NUVOCO', 'Nuvoco Vistas'],
    ['ORIENT', 'Orient Cement'],
    ['PENNA', 'Penna Cement'],
    ['BHARATHI', 'Bharathi Cement'],
    ['MAHA', 'Maha Cement (My Home Industries)'],
    ['SAGAR', 'Sagar Cements'],
    ['STARCEM', 'Star Cement'],
    ['PRISM', 'Prism Johnson'],
    ['ZUARI', 'Zuari Cement'],
  ]),
  ...b(['Ready-Mix Concrete'], [
    ['RDC', 'RDC Concrete'],
    ['ULTRARMC', 'UltraTech Ready Mix Concrete'],
    ['ACCRMC', 'ACC Ready Mix Concrete'],
    ['NUVOCORMC', 'Nuvoco Ready Mix Concrete'],
    ['PRISMRMC', 'Prism RMC'],
  ]),
  ...b(['Steel'], [
    ['TATASTEEL', 'Tata Steel (Tata Tiscon)'],
    ['JSW', 'JSW Steel (JSW Neosteel)'],
    ['SAIL', 'Steel Authority of India (SAIL)'],
    ['JSPL', 'Jindal Steel & Power (Jindal Panther)'],
    ['RINL', 'RINL Vizag Steel'],
    ['KAMDHENU', 'Kamdhenu Steel'],
    ['ARS', 'ARS Steels'],
    ['AGNI', 'Agni Steels'],
    ['SHYAM', 'Shyam Steel'],
    ['SRMB', 'SRMB Srijan'],
    ['APOLLO', 'APL Apollo Tubes'],
    ['JINDALSS', 'Jindal Stainless'],
  ]),
  ...b(['Bricks & Blocks'], [
    ['MAGICRETE', 'Magicrete Building Solutions'],
    ['BILTECH', 'Biltech Building Elements'],
    ['SIPOREX', 'Siporex India'],
  ]),
  ...b(['Admixtures & Chemicals', 'Waterproofing & Sealants'], [
    ['FOSROC', 'Fosroc'],
    ['SIKA', 'Sika India'],
    ['PIDILITE', 'Pidilite (Dr. Fixit / Roff)'],
    ['MBS', 'Master Builders Solutions'],
    ['LATICRETE', 'MYK Laticrete'],
    ['ARDEX', 'Ardex Endura'],
    ['CICO', 'CICO Technologies'],
    ['STP', 'STP Limited'],
    ['WEBER', 'Saint-Gobain Weber'],
  ]),
  ...b(['Formwork & Shuttering', 'Scaffolding'], [
    ['DOKA', 'Doka India'],
    ['PERI', 'PERI India'],
    ['KUMKANG', 'Kumkang Kind India'],
    ['MIVAN', 'Mivan'],
  ]),
  ...b(['Timber & Boards'], [
    ['GREENPLY', 'Greenply Industries'],
    ['CENTURYPLY', 'Century Plyboards (CenturyPly)'],
    ['KITPLY', 'Kitply Industries'],
    ['MERINO', 'Merino Laminates'],
    ['GREENLAM', 'Greenlam Industries'],
    ['ACTIONTESA', 'Action TESA'],
    ['ARCHIDPLY', 'Archidply Industries'],
  ]),
  ...b(['Tiles & Stone'], [
    ['KAJARIA', 'Kajaria Ceramics'],
    ['SOMANY', 'Somany Ceramics'],
    ['HRJOHNSON', 'H & R Johnson (Johnson Tiles)'],
    ['ORIENTBELL', 'Orientbell Tiles'],
    ['NITCO', 'Nitco Tiles'],
    ['AGL', 'Asian Granito (AGL)'],
    ['SIMPOLO', 'Simpolo Vitrified'],
    ['RAK', 'RAK Ceramics India'],
    ['VARMORA', 'Varmora Granito'],
  ]),
  ...b(['Paint & Finishes'], [
    ['ASIANPAINTS', 'Asian Paints'],
    ['BERGER', 'Berger Paints'],
    ['NEROLAC', 'Kansai Nerolac Paints'],
    ['NIPPON', 'Nippon Paint India'],
    ['INDIGO', 'Indigo Paints'],
    ['JSWPAINTS', 'JSW Paints'],
    ['BIRLAWHITE', 'Birla White (wall putty)'],
  ]),
  ...b(['Ceilings & Partitions'], [
    ['GYPROC', 'Saint-Gobain Gyproc'],
    ['ARMSTRONG', 'Armstrong World Industries'],
    ['USGBORAL', 'USG Boral'],
  ]),
  ...b(['Roofing & Insulation', 'Ceilings & Partitions'], [
    ['EVEREST', 'Everest Industries'],
    ['VISAKA', 'Visaka Industries'],
  ]),
  ...b(['Roofing & Insulation'], [
    ['BLUESCOPE', 'Tata BlueScope Steel'],
    ['LLOYD', 'Lloyd Insulations'],
    ['OWENSCORNING', 'Owens Corning India'],
    ['TWIGA', 'UP Twiga Fiberglass'],
  ]),
  ...b(['Doors, Windows & Glass'], [
    ['FENESTA', 'Fenesta Windows'],
    ['AIS', 'AIS Glass (Asahi India Glass)'],
    ['SGGLASS', 'Saint-Gobain Glass'],
    ['JINDALALU', 'Jindal Aluminium'],
    ['HINDALCO', 'Hindalco Industries'],
    ['GODREJLOCKS', 'Godrej Locks'],
    ['DORMAKABA', 'dormakaba India'],
    ['HETTICH', 'Hettich India'],
    ['HAFELE', 'Häfele India'],
    ['OZONE', 'Ozone Overseas'],
  ]),
  ...b(['Plumbing & Sanitary'], [
    ['SUPREME', 'Supreme Industries'],
    ['ASHIRVAD', 'Ashirvad Pipes'],
    ['ASTRAL', 'Astral Pipes'],
    ['FINOLEXIND', 'Finolex Industries (pipes)'],
    ['PRINCE', 'Prince Pipes and Fittings'],
    ['APOLLOPIPES', 'Apollo Pipes'],
    ['SINTEX', 'Sintex (water tanks)'],
    ['JAQUAR', 'Jaquar'],
    ['HINDWARE', 'Hindware'],
    ['PARRYWARE', 'Parryware'],
    ['CERA', 'Cera Sanitaryware'],
    ['KOHLER', 'Kohler India'],
    ['GROHE', 'Grohe India'],
    ['KIRLOSKAR', 'Kirloskar Brothers (pumps)'],
    ['CRI', 'CRI Pumps'],
    ['GRUNDFOS', 'Grundfos Pumps India'],
    ['TEXMO', 'Texmo Pumps'],
  ]),
  ...b(['Fire Fighting'], [
    ['HDFIRE', 'HD Fire Protect'],
    ['CEASEFIRE', 'Ceasefire Industries'],
    ['SAFEX', 'Safex Fire Services'],
    ['NEWAGE', 'Newage Fire Protection'],
  ]),
  ...b(['Electrical'], [
    ['POLYCAB', 'Polycab India'],
    ['HAVELLS', 'Havells India'],
    ['FINOLEXCAB', 'Finolex Cables'],
    ['KEI', 'KEI Industries'],
    ['RRKABEL', 'RR Kabel'],
    ['ANCHOR', 'Anchor by Panasonic'],
    ['LEGRAND', 'Legrand India'],
    ['SCHNEIDER', 'Schneider Electric India'],
    ['SIEMENS', 'Siemens India'],
    ['ABB', 'ABB India'],
    ['LK', 'Lauritz Knudsen (L&T Switchgear)'],
    ['PHILIPS', 'Philips Lighting (Signify)'],
    ['WIPRO', 'Wipro Lighting'],
    ['SYSKA', 'Syska LED'],
    ['CROMPTON', 'Crompton Greaves Consumer Electricals'],
    ['ORIENTELEC', 'Orient Electric'],
    ['BAJAJ', 'Bajaj Electricals'],
    ['GM', 'GM Modular'],
    ['HAGER', 'Hager India'],
  ]),
  ...b(['HVAC'], [
    ['DAIKIN', 'Daikin India'],
    ['BLUESTAR', 'Blue Star'],
    ['VOLTAS', 'Voltas'],
    ['MITSUBISHI', 'Mitsubishi Electric India'],
  ]),
  ...b(['Road & External Works', 'Fuel & Consumables'], [
    ['IOCL', 'Indian Oil Corporation'],
    ['HPCL', 'Hindustan Petroleum'],
    ['BPCL', 'Bharat Petroleum'],
  ]),
  ...b(['Road & External Works'], [
    ['GARWARE', 'Garware Technical Fibres'],
    ['STRATA', 'Strata Geosystems'],
  ]),
  ...b(['Fasteners & Fixings'], [
    ['HILTI', 'Hilti India'],
    ['FISCHER', 'Fischer India'],
  ]),
  ...b(['Small Tools'], [
    ['BOSCH', 'Bosch Power Tools'],
    ['STANLEY', 'Stanley Black & Decker'],
    ['TAPARIA', 'Taparia Tools'],
    ['MAKITA', 'Makita India'],
  ]),
  ...b(['Safety (PPE)'], [
    ['KARAM', 'Karam Industries'],
    ['UDYOGI', 'Udyogi Safety'],
    ['ALLENCOOPER', 'Allen Cooper'],
    ['3M', '3M India'],
  ]),
  ...b(['Lift / Elevator'], [
    ['OTIS', 'Otis Elevator India'],
    ['SCHINDLER', 'Schindler India'],
    ['KONE', 'KONE Elevator India'],
    ['JOHNSONLIFTS', 'Johnson Lifts'],
  ]),
  ...b(['Construction Equipment', 'Equipment Hire'], [
    ['JCB', 'JCB India'],
    ['SCHWING', 'Schwing Stetter India'],
    ['ACE', 'Action Construction Equipment (ACE)'],
    ['TATAHITACHI', 'Tata Hitachi Construction Machinery'],
  ]),
];
