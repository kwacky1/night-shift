import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fallbackReply, topicFor, validateScript } from '../src/intern/fallback.js';
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
  const reply = fallbackReply(s, text, script);
  s = reducer(s, actions.chatSend(reply.text, 'intern', { scripted: true, topic: reply.topic }));
  return { state: s, reply: reply.text };
};

test('hexInWords spells keys out', () => {
  assert.equal(hexInWords(0x0117), 'zero, one, one, seven');
  assert.equal(hexInWords(0xbeef), 'B, E, E, F');
});

test('shipped script is well formed', () => {
  assert.deepEqual(validateScript(script), []);
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
