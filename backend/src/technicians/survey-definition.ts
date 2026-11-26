// The technician skills survey. Questions are asked once per trade unit, so a
// trade unit added later automatically appears in the survey.
//
// Bump SURVEY_VERSION whenever questions or scoring change; it is stored with
// each submitted survey so older results stay interpretable.
export const SURVEY_VERSION = 1;

export const PROFICIENCY_LEVELS = [
  { value: 0, label: 'None', hint: "I don't do this work" },
  { value: 1, label: 'Basic', hint: 'Simple tasks with guidance' },
  { value: 2, label: 'Intermediate', hint: 'Common repairs on my own' },
  { value: 3, label: 'Advanced', hint: 'Hard repairs and diagnosis' },
  { value: 4, label: 'Expert', hint: 'Any job; I can train others' },
] as const;

export const EXPERIENCE_LEVELS = [
  { value: 0, label: 'Less than 1 year' },
  { value: 1, label: '1 to 2 years' },
  { value: 2, label: '3 to 5 years' },
  { value: 3, label: 'More than 5 years' },
] as const;

export interface SurveyTask {
  id: string;
  label: string;
}

// Task checklists per trade unit, matched by trade unit name (as seeded).
// A trade unit with no checklist is scored on proficiency and experience only.
const TASKS: Record<string, SurveyTask[]> = {
  Electrical: [
    { id: 'electrical.fixtures', label: 'Replace light fixtures and bulbs' },
    { id: 'electrical.outlets', label: 'Repair outlets and switches' },
    { id: 'electrical.wiring', label: 'Trace and fix wiring faults' },
    { id: 'electrical.panels', label: 'Work on breakers and panel boards' },
    { id: 'electrical.circuits', label: 'Install new circuits' },
  ],
  Plumbing: [
    { id: 'plumbing.leaks', label: 'Fix leaking faucets and pipes' },
    { id: 'plumbing.clogs', label: 'Unclog toilets and drains' },
    { id: 'plumbing.pipes', label: 'Replace pipes and fittings' },
    { id: 'plumbing.pumps', label: 'Repair water pumps and tanks' },
    { id: 'plumbing.fixtures', label: 'Install sinks and toilets' },
  ],
  Carpentry: [
    { id: 'carpentry.furniture', label: 'Repair chairs and tables' },
    { id: 'carpentry.doors', label: 'Fix doors, hinges and locks' },
    { id: 'carpentry.windows', label: 'Repair or replace windows' },
    { id: 'carpentry.build', label: 'Build shelves and cabinets' },
    { id: 'carpentry.ceilings', label: 'Repair wooden partitions and ceilings' },
  ],
  Masonry: [
    { id: 'masonry.patch', label: 'Patch cracked walls and ceilings' },
    { id: 'masonry.blocks', label: 'Lay bricks and hollow blocks' },
    { id: 'masonry.tiles', label: 'Tile floors and walls' },
    { id: 'masonry.concrete', label: 'Concrete and plaster work' },
    { id: 'masonry.stairs', label: 'Repair stairs and pavements' },
  ],
  Painting: [
    { id: 'painting.prep', label: 'Prepare surfaces (scraping, sanding)' },
    { id: 'painting.walls', label: 'Paint walls and ceilings' },
    { id: 'painting.mold', label: 'Treat mold and water stains' },
    { id: 'painting.metalwood', label: 'Paint metal and wood' },
    { id: 'painting.waterproof', label: 'Apply waterproofing' },
  ],
  Welding: [
    { id: 'welding.gates', label: 'Repair gates and railings' },
    { id: 'welding.arc', label: 'Arc welding' },
    { id: 'welding.gas', label: 'Gas cutting and welding' },
    { id: 'welding.fabricate', label: 'Fabricate metal frames' },
    { id: 'welding.furniture', label: 'Repair metal furniture' },
  ],
  Mechanical: [
    { id: 'mechanical.fans', label: 'Repair electric fans' },
    { id: 'mechanical.acservice', label: 'Clean and service air conditioners' },
    { id: 'mechanical.acrepair', label: 'Diagnose aircon faults and refrigerant' },
    { id: 'mechanical.motors', label: 'Repair motors and pumps' },
    { id: 'mechanical.generators', label: 'Maintain generators' },
  ],
  Utility: [
    { id: 'utility.grounds', label: 'Clean and maintain grounds' },
    { id: 'utility.waste', label: 'Remove debris and waste' },
    { id: 'utility.plants', label: 'Trim plants and trees' },
    { id: 'utility.moving', label: 'Move furniture and equipment' },
    { id: 'utility.upkeep', label: 'General cleaning and upkeep' },
  ],
};

export function tasksFor(tradeUnitName: string): SurveyTask[] {
  return TASKS[tradeUnitName] ?? [];
}
