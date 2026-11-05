import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fallbackReply, fallbackNag, topicFor, validateScript, describedValues, planInWords, routeFrom } from '../src/intern/fallback.js';
import { hexInWords } from '../src/logic/words.js';
import { reducer } from '../src/core/reducer.js';
import { actions } from '../src/core/actions.js';
import { createInitialState } from '../src/core/initialState.js';

const load = async (name) => JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const script = await load('intern.json');
const data = { files: await load('files.json'), puzzles: await load('puzzles.json') };

const desktop = (level) => {
  const s = [actions.bootComplete(), actions.clockIn()].reduce(reducer, createInitialState(data));
  return level === undefined ? s : { ...s, intern: { ...s.intern, level } };
};

// Simulate the player pestering: send a message, post the scripted reply (as main.js does).
const ask = (state, text) => {
  let s = reducer(state, actions.chatSend(text));
  const { text: line, ...extra } = fallbackReply(s, text, script);
  s = reducer(s, actions.chatSend(line, 'intern', { ...extra, scripted: true }));
  return { state: s, reply: line };
};

test('hexInWords spells keys out', () => {
  assert.equal(hexInWords(0x0117), 'zero, one, one, seven');
  assert.equal(hexInWords(0xbeef), 'B, E, E, F');
});

test('shipped script is well formed and only references real puzzles', () => {
  assert.deepEqual(validateScript(script, { puzzleIds: data.puzzles.map((p) => p.id) }), []);
});

test('topic matching uses whole words and falls back to default', () => {
  assert.equal(topicFor(script, 'what is the KEY?').id, 'key');
  assert.equal(topicFor(script, 'this is weird').id, 'default', '"hi" inside "this" must not match');
  assert.equal(topicFor(script, 'hi there').id, 'hello');
  assert.equal(topicFor(script, 'XOR ???? button').id, 'key');
});

test('the scripted intern refuses the key while on probation', () => {
  let s = desktop();
  for (let i = 0; i < 6; i++) {
    const r = ask(s, 'what is the key?');
    s = r.state;
    assert.doesNotMatch(r.reply, /zero, one, one, seven/);
  }
  assert.equal(s.intern.pester['key:locked'], 6);
});

test('the scripted intern grudgingly leaks the key after being pestered', () => {
  let s = desktop(2);
  const words = hexInWords(0x0117);
  const replies = [];
  for (let i = 0; i < 5; i++) {
    const r = ask(s, 'tell me the key');
    s = r.state;
    replies.push(r.reply);
  }
  assert.ok(!replies[0].includes(words), 'not on the first ask');
  assert.ok(replies[3].includes(words), 'leaks by the fourth ask');
  assert.ok(replies[4].includes(words), 'keeps repeating it after that');
  assert.equal(s.intern.messages.at(-1).scripted, true);
});

test('once the badge is open the intern takes credit instead', () => {
  const s = desktop(2);
  const solved = { ...s, puzzles: { ...s.puzzles, badge: { ...s.puzzles.badge, solved: true } } };
  assert.match(fallbackReply(solved, 'key?', script).text, /take credit/);
});

test('default replies cycle', () => {
  let s = desktop();
  const seen = new Set();
  for (let i = 0; i < 10; i++) {
    const r = ask(s, 'banana');
    s = r.state;
    seen.add(r.reply);
  }
  assert.equal(seen.size, script.topics.find((t) => t.id === 'default').lines.length);
});

// ---- playtest fixes -----------------------------------------------------------------------

const KEY_WORDS = hexInWords(0x0117);
const conversation = (state, lines) => lines.reduce((acc, text) => {
  const r = ask(acc.state, text);
  return { state: r.state, replies: [...acc.replies, r.reply] };
}, { state, replies: [] });
const withPuzzle = (s, id, patch) => ({ ...s, puzzles: { ...s.puzzles, [id]: { ...s.puzzles[id], ...patch } } });
const unlocked = (level = 2) => withPuzzle(desktop(level), 'badge', { unlocked: [3] });

test('"please" continues the thread instead of going on smoko', () => {
  const { replies, state } = conversation(desktop(2), ['what is the key?', 'key please', 'what does the log say?', 'please']);
  assert.match(replies[2], /pretend I didn't hear/);
  assert.ok(replies[3].includes(KEY_WORDS), replies[3]);
  assert.equal(state.intern.lastTopic, 'key');
});

test('follow-ups and unmatched messages continue the last topic; chit-chat does not become a thread', () => {
  for (const follow of ['please', 'pls', 'go on', 'come on', '?', 'again?', 'and??', 'uh, it says to ask you for a readoout']) {
    const { replies } = conversation(desktop(), ['tell me about payroll', follow]);
    assert.match(replies[1], /wipe, mask, nudge/, follow);
  }
  const { replies } = conversation(desktop(), ['hi', 'banana']);
  assert.equal(replies[1], 'Sorry, was on smoko.');
  assert.equal(topicFor(script, 'please', {}).id, 'default', 'nothing to follow up yet');
});

test('readout/policy questions are about the key, and "you" alone is not about #0117', () => {
  assert.equal(topicFor(script, 'it says to ask you for a readout').id, 'key');
  assert.equal(topicFor(script, 'ASK #0118 FOR A READOUT').id, 'key');
  assert.equal(topicFor(script, 'what policy?').id, 'key');
  assert.equal(topicFor(script, 'can you help').id, 'help');
  assert.equal(topicFor(script, 'are you there').id, 'default');
  assert.equal(topicFor(script, 'who is #0117?').id, 'who');
  assert.equal(topicFor(script, 'who has the key?').id, 'key', 'key beats who');
});

test('once the key is in, the key topic says so', () => {
  assert.match(fallbackReply(unlocked(), 'the key?', script).text, /Key's in/);
});

test('the sequence topic only opens up after the key, and hints before it tells', () => {
  assert.notEqual(topicFor(script, "what's the sequence?", desktop(2)).id, 'solve');
  assert.equal(topicFor(script, 'how do I do this', desktop(2)).id, 'help');
  assert.equal(topicFor(script, 'how do I do this', unlocked()).id, 'solve');
  const { replies, state } = conversation(unlocked(), ["what's the sequence?", 'go on', 'please', 'again']);
  assert.match(replies[0], /XOR before you shift/);
  assert.match(replies[1], /big XOR, then the key/);
  assert.match(replies[2], /XOR, XOR, shift left, XOR/);
  assert.match(replies[3], /XOR, XOR, shift left, XOR/);
  for (const r of replies) assert.doesNotMatch(r, /0x0117|0xFF00 first/, 'types only, no full solution');
  assert.equal(state.intern.pester.solve, 4);
});

test('sequence hints follow the actual state, and admit when there is no way through', () => {
  const s = withPuzzle(unlocked(), 'badge', { value: 0xfe18, history: [0x0118] });
  const types = fallbackReply({ ...s, intern: { ...s.intern, pester: { solve: 2 } } }, 'order?', script).text;
  assert.match(types, /: XOR, shift left, XOR./);
  const stuck = withPuzzle(unlocked(), 'badge', { value: 0x0001, history: [1, 2, 3, 4, 5] });
  assert.match(fallbackReply({ ...stuck, intern: { ...stuck.intern, pester: { solve: 2 } } }, 'order?', script).text, /No way through/);
  const solved = withPuzzle(unlocked(), 'badge', { solved: true });
  assert.match(fallbackReply(solved, 'sequence?', script).text, /recovered/);
});

const roles = script.topics.find((t) => t.detect).roles;

test('bit patterns are found and told apart as CURRENT or TARGET', () => {
  const roleOf = (text) => describedValues(text, roles).map((v) => [v.value, v.role]);
  assert.deepEqual(roleOf('the target is 0000 1111 1111 0000'), [[0x0ff0, 'target']]);
  assert.deepEqual(roleOf('current is 0000 0001 0001 1000'), [[0x0118, 'current']]);
  assert.deepEqual(roleOf("it's at 0000000100011000 now"), [[0x0118, 'current']]);
  assert.deepEqual(roleOf('need 0000_1111_1111_0000'), [[0x0ff0, 'target']]);
  assert.deepEqual(roleOf('goal 0x0FF0'), [[0x0ff0, 'target']]);
  assert.deepEqual(roleOf('current is 0000 0001 0001 1000, target is 0000 1111 1111 0000'), [[0x0118, 'current'], [0x0ff0, 'target']]);
  assert.deepEqual(roleOf('the target row is at 0000 1111 1111 0000'), [[0x0ff0, 'target']], 'strong word beats weak');
  assert.deepEqual(roleOf('0000 1111 1111 0000'), [[0x0ff0, null]]);
  assert.deepEqual(roleOf('I need the key 0x0117'), [[0x0117, null]], 'hex needs a strong word');
  assert.deepEqual(roleOf('1010 then 1 or 0'), []);
});

test('describing the TARGET in bits gets a route from the real current value', () => {
  const { replies, state } = conversation(desktop(), ['the target is 0000 1111 1111 0000']);
  assert.match(replies[0], /^0x0FF0\? Neat/);
  assert.match(replies[0], /XOR 0xFF00 first, then the key XOR, then shove it left a nibble, then XOR 0xFF00 again/);
  assert.doesNotMatch(replies[0], /0x0117/, 'the route names the key op, not the key');
  assert.deepEqual(state.intern.heardTargets, ['badge']);
  const mid = withPuzzle(desktop(), 'badge', { value: 0xfe18, history: [0x0118] });
  assert.match(fallbackReply(mid, 'target 0000 1111 1111 0000', script).text, /now: the key XOR first, then shove it left a nibble, then XOR 0xFF00\. /);
  // An unlabelled pattern that IS a target counts as one.
  assert.match(fallbackReply(desktop(), '0000 1111 1111 0000', script).text, /Neat/);
});

test('describing the CURRENT value is acknowledged, checked, and routed once the target is known', () => {
  const s = desktop();
  assert.match(fallbackReply(s, 'current is 0000 0001 0001 1000', script).text, /matches what I've got here/);
  const wrong = fallbackReply(s, 'current is 1111 0000 0000 0000', script).text;
  assert.match(wrong, /I've got 0000 0001 0001 1000 on my end, not 1111 0000 0000 0000/);
  const { replies } = conversation(s, ['target is 0000 1111 1111 0000', 'current is 0000 0001 0001 1000', 'go on']);
  assert.match(replies[1], /XOR 0xFF00 first/);
  assert.match(replies[2], /XOR 0xFF00 first/, 'follow-up re-plans');
});

test('patterns that match nothing, unlabelled rows, solved sectors and dead ends', () => {
  const s = desktop();
  assert.match(fallbackReply(s, 'the target is 1111 1111 1111 1111', script).text, /Nothing I can see is aiming for that/);
  assert.match(fallbackReply(s, '0000 0000 0000 0001', script).text, /CURRENT row or the TARGET row/);
  assert.equal(fallbackReply(s, 'I need the key 0x0117', script).topic.startsWith('key'), true);
  const solved = withPuzzle(s, 'badge', { solved: true, value: 0x0ff0 });
  assert.match(fallbackReply(solved, 'target is 0000 1111 1111 0000', script).text, /already recovered/);
  const stuck = withPuzzle(s, 'badge', { value: 0x0001, history: [1, 2, 3, 4, 5] });
  assert.match(fallbackReply(stuck, 'target is 0000 1111 1111 0000', script).text, /no way there|corner/);
});

test('routes and plans are computed by the BFS solver', () => {
  const p = desktop().puzzles.badge;
  const path = routeFrom(p);
  assert.deepEqual(path, [2, 3, 0, 2]);
  assert.equal(planInWords(p, [0]), "shove it left a nibble and that's it");
});

test('validateScript is strict', () => {
  const base = JSON.parse(JSON.stringify(script));
  const broken = (mutate) => {
    const s = JSON.parse(JSON.stringify(base));
    mutate(s);
    return validateScript(s, { puzzleIds: ['payroll', 'badge'] });
  };
  const topic = (s, id) => s.topics.find((t) => t.id === id);
  assert.match(broken((s) => (topic(s, 'who').colour = 'red')).join(), /unknown field colour/);
  assert.match(broken((s) => (topic(s, 'solve').puzzle = 'nope')).join(), /unknown puzzle nope/);
  assert.match(broken((s) => (topic(s, 'solve').when = 'always')).join(), /when must be/);
  assert.match(broken((s) => topic(s, 'who').lines.push('{{key}}')).join(), /not allowed here/);
  assert.match(broken((s) => topic(s, 'key').lockedLines.push('{{key}}')).join(), /lockedLines must not leak/);
  assert.match(broken((s) => delete topic(s, 'solve').stuckLines).join(), /needs stuckLines/);
  assert.match(broken((s) => delete topic(s, 'pattern').currentWrongLines).join(), /needs currentWrongLines/);
  assert.match(broken((s) => (topic(s, 'pattern').lines = ['no plan here'])).join(), /\{\{plan\}\}/);
  assert.match(broken((s) => topic(s, 'pattern').lines.push('{{wat}}')).join(), /unknown placeholder/);
  assert.match(broken((s) => (topic(s, 'pattern').roles.target.weak = ['Need'])).join(), /lowercase/);
  assert.match(broken((s) => (topic(s, 'hello').thread = true)).join(), /thread may only be false/);
  assert.match(broken((s) => (s.followUps = [1])).join(), /followUps/);
});

// ---- week 3: new sectors, power and nags ----------------------------------------------------

const story = await load('story.json');
const night = await load('night.json');
const full = { ...data, story, night: { ...night, power: { ...night.power, drainPerMinute: 0 } } };
const fullDesktop = () => [actions.bootComplete(), actions.clockIn()].reduce(reducer, createInitialState(full));
const reveal = (s, ...ids) => ({ ...s, files: Object.fromEntries(Object.entries(s.files).map(([id, f]) => [id, ids.includes(id) ? { ...f, dormant: false } : f])) });
const withPower = (s, level) => ({ ...s, power: { ...s.power, level } });

test('shipped script references real files and nags properly', () => {
  assert.deepEqual(validateScript(script, { puzzleIds: data.puzzles.map((p) => p.id), fileIds: data.files.map((f) => f.id) }), []);
  assert.ok(script.nag.lines.length && script.nag.brownoutLines.length);
});

test('sector topics stay quiet until their file is on the drive', () => {
  const s = fullDesktop();
  assert.notEqual(topicFor(script, 'what about genset.cfg?', s).id, 'genset');
  assert.notEqual(topicFor(script, 'timeclk key?', s).id, 'timekey');
  assert.notEqual(topicFor(script, 'what is blame.exe', s).id, 'blame');
  const later = reveal(s, 'genset', 'timeclk', 'timeaud', 'blame');
  assert.equal(topicFor(script, 'what about genset.cfg?', later).id, 'genset');
  assert.equal(topicFor(script, 'timeclk.dat', later).id, 'timekey');
  assert.equal(topicFor(script, 'what is blame.exe', later).id, 'blame');
});

test('"the key" means the key for the sector in front of the player', () => {
  let s = reveal({ ...fullDesktop(), intern: { ...fullDesktop().intern, level: 2 } }, 'timeclk', 'timeaud');
  assert.equal(topicFor(script, 'what is the key?', s).id, 'key', 'BADGE.DB is still the obvious one');
  s = reducer(s, actions.openFile('timeclk'));
  assert.equal(topicFor(script, 'what is the key?', s).id, 'timekey', 'TIMECLK.DAT is focused');
  const solvedBadge = withPuzzle(reveal(fullDesktop(), 'timeclk', 'timeaud'), 'badge', { solved: true });
  assert.equal(topicFor(script, 'key please', solvedBadge).id, 'timekey', 'badge done, the time clock is next');
});

test('the time clock override leaks at OPERATOR after pestering, never on probation', () => {
  const words = hexInWords(0x0600);
  assert.equal(words, 'zero, six, zero, zero');
  let probation = reveal(fullDesktop(), 'timeclk', 'timeaud');
  probation = withPuzzle(probation, 'badge', { solved: true });
  const locked = conversation(probation, Array(5).fill('timeclk key?'));
  for (const r of locked.replies) assert.doesNotMatch(r, /zero, six/);
  const operator = { ...probation, intern: { ...probation.intern, level: 2 } };
  const { replies } = conversation(operator, ['timeclk key?', 'go on', 'please', 'again']);
  assert.ok(!replies[0].includes(words));
  assert.ok(replies[3].includes(words), replies[3]);
});

test('the sealed file needs SUPERVISOR, and SHIFTLOG.BAK gets a rename hint', () => {
  const s = fullDesktop();
  assert.match(fallbackReply(s, "what's in 0117.sec?", script).text, /SUPERVISOR only/);
  assert.match(fallbackReply({ ...s, intern: { ...s.intern, level: 3 } }, "what's in 0117.sec?", script).text, /Personnel file/);
  const { replies } = conversation(s, ['shiftlog.bak?', 'and?', 'go on']);
  assert.match(replies[2], /F2/);
});

test('the power topic quotes the level and gets twitchy when it is low', () => {
  const s = fullDesktop();
  assert.match(fallbackReply(withPower(s, 80), 'how do I drive the generator?', script).text, /80%/);
  assert.match(fallbackReply(withPower(s, 22.4), 'power?', script).text, /22%/);
  assert.equal(fallbackReply(withPower(s, 22.4), 'power?', script).topic, 'power:low');
});

test('genset tips route through the BFS like any other sector', () => {
  const s = reveal(fullDesktop(), 'genset');
  const r = fallbackReply(s, 'the target is 0000 1111 0011 0011', script);
  assert.equal(r.heardTarget, 'genset');
  assert.match(r.text, /Neat/);
  assert.match(fallbackReply(withPuzzle(s, 'genset', { solved: true }), 'genset?', script).text, /thriftier/);
});

test('fallbackNag moans when power drops, gets worse, and periodically while low', () => {
  const s = fullDesktop();
  assert.equal(fallbackNag(withPower(s, 60), withPower(s, 50), script), null, 'fine above nagBelow');
  const crossed = fallbackNag(withPower(s, 40.2), withPower(s, 39.6), script);
  assert.match(crossed.text, /40%/);
  assert.equal(crossed.topic, 'nag');
  assert.equal(fallbackNag(withPower(s, 39.6), withPower(s, 39), script), null, 'no repeat for small drops');
  const brownout = fallbackNag(withPower(s, 30.1), withPower(s, 29.9), script);
  assert.equal(brownout.topic, 'nag:brownout');
  const prev = { ...withPower(s, 35), clock: { ...s.clock, elapsed: 59 } };
  const next = { ...withPower(s, 34.5), clock: { ...s.clock, elapsed: 60 } };
  assert.ok(fallbackNag(prev, next, script), 'every 30 game minutes while low');
  assert.equal(fallbackNag(withPower(s, 1), withPower(s, 0), script), null, 'blackout is not a nag');
  assert.equal(fallbackNag(withPower(s, 45), { ...withPower(s, 35), phase: 'over' }, script), null);
});

test('validateScript checks the new fields', () => {
  const broken = (mutate) => {
    const s = JSON.parse(JSON.stringify(script));
    mutate(s);
    return validateScript(s, { puzzleIds: data.puzzles.map((p) => p.id), fileIds: ['timeclk', 'genset'] }).join();
  };
  const topic = (s, id) => s.topics.find((t) => t.id === id);
  assert.match(broken((s) => delete topic(s, 'genset').file), /needs a file/);
  assert.match(broken((s) => (topic(s, 'blame').file = 'blame')), /unknown file blame/);
  assert.match(broken((s) => (topic(s, 'who').file = 'genset')), /only used with when/);
  assert.match(broken((s) => (s.nag.everyMinutes = 0)), /everyMinutes/);
  assert.match(broken((s) => s.nag.lines.push('{{key}}')), /nag: placeholder/);
  assert.match(broken((s) => (s.nag.colour = 'red')), /nag: unknown field/);
});

test('power questions are about power even with a sector in front of the player', () => {
  const s = reducer(unlocked(), actions.openFile('badge'));
  assert.equal(topicFor(script, 'how do I keep the power up?', s).id, 'power');
  assert.equal(topicFor(script, 'how do I do this', s).id, 'solve');
});
