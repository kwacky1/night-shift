// Prints how a set of scripted drivers fare over a full night with the current data.
// Usage: node scripts/balance.js   (tuning aid for data/gearbox.json and data/night.json)
import { readFile } from 'node:fs/promises';
import { fixedGearBot, idleBot, playNight, shifterBot } from '../game/tests/night-bots.js';

const load = async (name) => JSON.parse(await readFile(new URL(`../game/data/${name}`, import.meta.url), 'utf8'));
const data = { files: await load('files.json'), puzzles: await load('puzzles.json'), night: await load('night.json'), story: await load('story.json') };
const gearbox = await load('gearbox.json');

const bots = [['idle', idleBot()], ...[1, 2, 3, 4, 5].map((g) => [`fixed ${g}`, fixedGearBot(g)]), ['shifter', shifterBot()]];
const rows = bots.map(([name, bot]) => {
  const r = playNight(data, gearbox, bot);
  return {
    bot: name,
    end: r.end,
    minutes: r.minutes,
    final: r.final.toFixed(1),
    lowest: r.lowest.toFixed(1),
    mean: r.mean.toFixed(1),
    late: r.lateMean.toFixed(1),
    'above70%': Math.round(r.above70 * 100),
    stalls: r.stalls,
    'shift every s': r.shiftEvery === Infinity ? '-' : r.shiftEvery.toFixed(1),
    km: r.km.toFixed(1),
  };
});
console.table(rows);
