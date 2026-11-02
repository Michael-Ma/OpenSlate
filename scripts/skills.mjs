import { fileURLToPath } from 'node:url';
import { checkSkillReleases, draftSkillRelease, releaseSkills } from './lib/skill-releases.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export function parseSkillArguments(args) {
  const [command, ...flags] = args;
  if (!['draft', 'release', 'check'].includes(command)) throw new Error('Use skills:draft, skills:release [--minor|--major] [--note "..."] [--contract x.y.z] [--realign], or skills:check.');
  const options = {};
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    if (command !== 'release') throw new Error(`${command} accepts no options.`);
    if (flag === '--minor' || flag === '--major') {
      if (options.bump) throw new Error('Choose only one of --minor or --major.');
      options.bump = flag.slice(2);
    } else if (flag === '--realign') {
      if (options.realign) throw new Error('Duplicate --realign.');
      options.realign = true;
    } else if (flag === '--note' || flag === '--contract') {
      const key = flag.slice(2), value = flags[++i];
      if (options[key] !== undefined || !value || value.startsWith('--')) throw new Error(`${flag} needs one value and may only be specified once.`);
      options[key] = value;
    } else throw new Error(`Unknown option: ${flag}`);
  }
  return { command, options };
}
export function runSkills(args, repositoryRoot = root) {
  const { command, options } = parseSkillArguments(args);
  if (command === 'draft') return draftSkillRelease(repositoryRoot);
  if (command === 'check') return checkSkillReleases(repositoryRoot).message;
  const plan = releaseSkills(repositoryRoot, options);
  return `Released ${plan.row.guidanceVersion} into ${plan.directory}: ${plan.changed.length} changed packages${plan.row.realign ? ', versions realigned' : ''}.`;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { console.log(runSkills(process.argv.slice(2))); }
  catch (error) { console.error(`${error.code ? `${error.code}: ` : ''}${error.message}`); process.exitCode = 1; }
}
