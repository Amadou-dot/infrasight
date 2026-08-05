/**
 * CLAUDE.md's "Adding a New Device / Reading Type" checklist must stay complete.
 *
 * The reading/device type list is copied by hand into fourteen source files.
 * Several of those copies fail SILENTLY when they are missed — the type is
 * simply absent from a dropdown, or stored with unit `'raw'`, or given no
 * alert-rule bucket at all. The checklist in CLAUDE.md is what a future agent
 * follows, and CLAUDE.md is loaded into every session in this repo, so an
 * incomplete checklist propagates the mistake rather than preventing it. It was
 * already incomplete once: this PR added copies in `AlertRuleV2.READING_TYPES`
 * and `ReadingTypeName` without the four-step list being updated.
 *
 * This test derives the file set by SCANNING, not by restating it — a file
 * "carries a copy" if all fifteen type names appear in it. Add a fifteenth
 * copy of the list anywhere under models/, lib/, types/, app/, components/ or
 * scripts/ without naming it in the checklist and this fails.
 */

import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');

/**
 * Deliberately spelled out rather than imported from `READING_TYPES`. This test
 * is about the DOCUMENTATION of the copies; importing one of the copies to find
 * the others would make a shrunken list scan for fewer names and quietly pass.
 */
const TYPE_NAMES = [
  'temperature',
  'humidity',
  'occupancy',
  'power',
  'co2',
  'pressure',
  'light',
  'motion',
  'air_quality',
  'water_flow',
  'gas',
  'vibration',
  'voltage',
  'current',
  'energy',
];

const SOURCE_ROOTS = ['models', 'lib', 'types', 'app', 'components', 'scripts'];

/**
 * Tests restate the list constantly, and every deprecated tree (`_deprecated`,
 * `_v1-deprecated`, `v1 (deprecated)`) is excluded from compilation by
 * tsconfig.json — a copy in there is archaeology, not a maintenance burden.
 */
const EXCLUDED = /node_modules|[\\/]\.next|deprecated|__tests__|[\\/]e2e[\\/]/i;

const SECTION_HEADING = '### Adding a New Device / Reading Type';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (EXCLUDED.test(full)) continue;
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Every source file that spells out all fifteen type names. */
function filesCarryingTheList(): string[] {
  const matchers = TYPE_NAMES.map(name => new RegExp(`\\b${name}\\b`));

  return SOURCE_ROOTS.filter(root => fs.existsSync(path.join(REPO_ROOT, root)))
    .flatMap(root => sourceFiles(path.join(REPO_ROOT, root)))
    .filter(file => {
      const source = fs.readFileSync(file, 'utf8');
      return matchers.every(matcher => matcher.test(source));
    })
    .map(file => path.relative(REPO_ROOT, file).split(path.sep).join('/'))
    .sort();
}

/** The checklist section of CLAUDE.md, up to the next `### ` heading. */
function checklistSection(): string {
  const claudeMd = fs.readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
  const start = claudeMd.indexOf(SECTION_HEADING);
  if (start === -1)
    throw new Error(
      `CLAUDE.md has no "${SECTION_HEADING}" section. It is the only place the ` +
        'silent copies of the reading type list are enumerated — do not remove it.'
    );

  const rest = claudeMd.slice(start + SECTION_HEADING.length);
  const end = rest.indexOf('\n### ');
  return end === -1 ? rest : rest.slice(0, end);
}

describe('CLAUDE.md reading-type checklist', () => {
  it('names every source file that carries a copy of the type list', () => {
    const section = checklistSection();
    const carriers = filesCarryingTheList();

    // Sanity floor: if the scan finds almost nothing, the scan is broken and
    // the assertion below would pass vacuously.
    expect(carriers.length).toBeGreaterThan(8);

    const undocumented = carriers.filter(file => !section.includes(file));

    expect(undocumented).toEqual([]);
  });

  it('does not point at files that no longer exist', () => {
    const linked = [...checklistSection().matchAll(/\]\(([^)]+)\)/g)].map(match => match[1]);

    expect(linked.length).toBeGreaterThan(8);

    const missing = linked.filter(target => !fs.existsSync(path.join(REPO_ROOT, target)));

    expect(missing).toEqual([]);
  });

  it('explains the silent failure mode rather than just listing files', () => {
    const section = checklistSection();

    // The distinction between "tsc catches it" and "nothing catches it" is the
    // reason the section is a table and not four bullet points.
    expect(section).toContain('Silent');
    expect(section).toContain('rule-cache.ts');
  });
});
