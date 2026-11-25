// The real CvSU Imus campus locations: the single source of truth used by the
// seed and by prisma/sync-locations.ts. Names are copied exactly from the GSO
// list (already cleaned: trimmed, "HM 302" fixed, duplicate rooms removed).
// Each block is one building and floor, rooms in display order.

export interface LocationRow {
  building: string;
  floor: string;
  room: string;
}

// Sample buildings from before the real list existed. Their rows are deleted,
// or kept but marked inactive when reports still point to them.
export const RETIRED_BUILDINGS = ['Main Building', 'Science Building'];

const BLOCKS: [building: string, floor: string, rooms: string[]][] = [
  ['Learning Room (Beside Old Bldg.)', '1st Floor', ['LR 5', 'LR 6', 'LR 7', 'LR 8', 'LR 9', 'LR 10']],
  ['Madam Lao Lai Wing (Smart Rooms)', '1st Floor', ['New Room 1', 'New Room 2']],
  ['Gymnasium (Back)', '1st Floor', ['Stage', 'Sports Department', 'ROTC Office']],
  [
    'CTMO Building',
    '1st Floor',
    [
      'CTMO-1',
      'CTMO-2',
      'CTMO-3',
      'Gender and Development and Knowledge Management Center Office',
      'Research Development and Extension Office',
    ],
  ],
  ['HM Building', '1st Floor', ['HM 101', 'HM 102', 'Old Kitchen', 'HM Lobby', 'Male CR', 'Female CR']],
  ['HM Building', '2nd Floor', ['HM 201', 'HM 202']],
  ['HM Building', '3rd Floor', ['HM 301', 'HM 302']],
  [
    'Old Building',
    '1st Floor',
    [
      'Female CR',
      'Male CR',
      'Civil Security Unit and DRRM Office',
      'Clinic',
      'Office of Student Affairs and Services (OSAS)',
      'Admission Office',
      'Computer Access Laboratory',
      'Conference Room',
      'Department of Biological and Physical Sciences',
      'Department of Hospitality Management',
      'Discipline Office and Campus Inspector Office',
      'HRM Stock Room',
      'Radio Room',
      'Room 101',
      'Room 102',
      'Room 103',
      'Room 104',
      'Room 105',
      'Room 106',
      'Room 107',
      'Room 112',
      'Room 113',
      'Room 114 / BM Laboratory',
      'Room 115',
      'Room 116',
      'Room 117',
      'Room 118',
      'Room 119',
      'Room 120 / Chemistry Laboratory',
      'Room 121 / Health Science Laboratory',
      'Room 122 / Biology Laboratory',
      'Science Laboratory Equipment Storage Room',
      'TV Room',
      'SINAGTALA Room',
    ],
  ],
  [
    'Old Building',
    '2nd Floor (Front)',
    ['Department of Computer Studies (DCS)', 'Library', 'Student Center', 'The Flare Office', 'Student Org Office', 'CSG Office'],
  ],
  [
    'Old Building',
    '2nd Floor (Back)',
    ['CL1', 'CL2', 'CL3', 'CL4', 'CL5', 'CL6', 'CL7', 'CL8', 'Function Hall', 'Room 212', 'Room 213'],
  ],
  [
    'New Building',
    '1st Floor',
    [
      'Male CR',
      'Female CR',
      'Department of Management',
      'Department of Physical Education',
      'Guidance Office and Counselling',
      'Institutional Development Office',
      'Management Information System Unit',
      'Office of the Accounting Unit',
      'Office of the Campus Administrator',
      'Office of the Campus Registrar',
      'Resource Generation Office',
    ],
  ],
  [
    'New Building',
    '2nd Floor',
    ['Male CR', 'Female CR', 'A-201', 'A-202', 'A-203', 'A-204', 'A-205', 'Department of Teacher Education'],
  ],
  [
    'New Building',
    '3rd Floor',
    [
      'Male CR',
      'Female CR',
      'A-301 / Office Laboratory',
      'A-302 / Entrep Lab',
      'A-303',
      'A-304',
      'A-305',
      'Department of Management Office Administration Cluster',
      'Department of Management Entrepreneurship Cluster',
    ],
  ],
  [
    'New Building',
    '4th Floor',
    ['Male CR', 'Female CR', 'A-401', 'A-402', 'A-403', 'A-404', 'A-405', 'Department of Language and Mass Communication'],
  ],
  [
    'New Building',
    '5th Floor',
    ['Male CR', 'Female CR', 'A-501', 'A-502', 'A-503', 'A-504', 'A-505', 'Department of Social Sciences and Humanities'],
  ],
];

export const LOCATIONS: LocationRow[] = BLOCKS.flatMap(([building, floor, rooms]) =>
  rooms.map((room) => ({ building, floor, room })),
);

// Checked when the module loads, so a typo stops the seed / sync before any
// database write.
function validate(rows: LocationRow[]) {
  const problems: string[] = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    for (const [field, value] of Object.entries(r)) {
      const where = `location #${i + 1} (${r.building} / ${r.floor} / ${r.room}) ${field}`;
      if (!value) problems.push(`${where} is empty`);
      else if (value !== value.trim()) problems.push(`${where} has leading or trailing whitespace`);
      else if (value.includes('  ')) problems.push(`${where} has a double space`);
    }
    const key = `${r.building}\u0000${r.floor}\u0000${r.room}`;
    if (seen.has(key)) problems.push(`duplicate location: ${r.building} / ${r.floor} / ${r.room}`);
    seen.add(key);
  });
  if (problems.length) throw new Error(`Invalid location data:\n- ${problems.join('\n- ')}`);
}

validate(LOCATIONS);
