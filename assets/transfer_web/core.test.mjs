/**
 * Zero-dependency tests for the pure helpers in index.html.
 *
 *   node assets/transfer_web/core.test.mjs
 *
 * The Studio ships as one self-contained file (WebView friendly), so the core
 * block is extracted from the HTML and evaluated here rather than duplicated.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
const coreBlock = html.match(/<script>\s*\/\* =+\s*\n\s*Core/);
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

if (!coreBlock || scripts.length < 2) {
  throw new Error('Could not locate the core script block in index.html');
}

new Function(scripts[0])();
const Core = globalThis.AudenicCore;

if (!Core) throw new Error('AudenicCore was not registered');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
    process.exitCode = 1;
  }
}

console.log('\nAudenic AI Studio — core');

console.log('\n time');
test('lrcStamp pads to mm:ss.cc', () => {
  assert.equal(Core.lrcStamp(0), '00:00.00');
  assert.equal(Core.lrcStamp(74.5), '01:14.50');
  assert.equal(Core.lrcStamp(9.4), '00:09.40');
});
test('lrcStamp rolls over cleanly', () => {
  assert.equal(Core.lrcStamp(59.999), '01:00.00');
});
test('formatClock is m:ss', () => {
  assert.equal(Core.formatClock(0), '0:00');
  assert.equal(Core.formatClock(74.5), '1:14');
  assert.equal(Core.formatClock(605), '10:05');
});

console.log('\n parsing');
test('stripFences removes code fences only', () => {
  assert.equal(Core.stripFences('```lrc\n[00:01.00] hi\n```'), '[00:01.00] hi');
  assert.equal(Core.stripFences('plain'), 'plain');
});
test('extractJSON survives prose and fences', () => {
  const value = Core.extractJSON('Here you go:\n```json\n{"a":1,"b":{"c":"}"}}\n```\nEnjoy.');
  assert.deepEqual(value, { a: 1, b: { c: '}' } });
});
test('extractJSON returns null on garbage', () => {
  assert.equal(Core.extractJSON('no json here'), null);
  assert.equal(Core.extractJSON('{ broken'), null);
});

console.log('\n LRC');
test('parses header and timed lines', () => {
  const parsed = Core.parseLRC('[ti:Song]\n[ar:Artist]\n[00:01.00] one\n[00:02.50] two');
  assert.equal(parsed.meta.ti, 'Song');
  assert.equal(parsed.meta.ar, 'Artist');
  assert.equal(parsed.lines.length, 2);
  assert.equal(parsed.lines[0].time, 1);
  assert.equal(parsed.lines[1].time, 2.5);
  assert.equal(parsed.lines[1].text, 'two');
});
test('expands multiple timestamps on one line', () => {
  const parsed = Core.parseLRC('[00:03.00][00:05.00] chorus');
  assert.deepEqual(parsed.lines.map((l) => l.time), [3, 5]);
  assert.ok(parsed.lines.every((l) => l.text === 'chorus'));
});
test('honours the offset tag', () => {
  const parsed = Core.parseLRC('[offset:+500]\n[00:01.00] later');
  assert.equal(parsed.lines[0].time, 1.5);
});
test('accepts colon centiseconds', () => {
  const parsed = Core.parseLRC('[00:01:50] colon');
  assert.equal(parsed.lines[0].time, 1.5);
});
test('drops untimed prose when timed lines exist', () => {
  const parsed = Core.parseLRC('some chatter\n[00:01.00] real line');
  assert.equal(parsed.lines.length, 1);
});
test('detects cue lines', () => {
  assert.equal(Core.isCueLine('(Verse 1)'), true);
  assert.equal(Core.isCueLine('[Chorus]'), true);
  assert.equal(Core.isCueLine('Instrumental intro'), true);
  assert.equal(Core.isCueLine('We lift our voices'), false);
});

console.log('\n curator');
test('normalises a JSON setlist', () => {
  const result = Core.normaliseCurator({
    playlistTitle: 'Night Drive',
    description: 'Slow burn',
    tracks: [{ title: 'A', artist: 'B', genre: 'C', bpm: 102, durationSec: 215, why: 'because' }]
  });
  assert.equal(result.title, 'Night Drive');
  assert.equal(result.description, 'Slow burn');
  assert.equal(result.tracks.length, 1);
  assert.equal(result.tracks[0].bpm, '102');
  assert.equal(result.tracks[0].duration, '3:35');
  assert.equal(result.tracks[0].why, 'because');
});
test('splits string tracks into artist/title', () => {
  const result = Core.normaliseCurator({ tracks: ['Burna Boy - City Boys'] });
  assert.equal(result.tracks[0].artist, 'Burna Boy');
  assert.equal(result.tracks[0].title, 'City Boys');
});
test('keeps prose when there are no tracks', () => {
  const result = Core.normaliseCurator(null, 'Just a paragraph.');
  assert.equal(result.tracks.length, 0);
  assert.equal(result.description, 'Just a paragraph.');
});

console.log('\n playlist export');
test('writes a valid m3u with durations', () => {
  const text = Core.m3uFrom({
    title: 'Sunday',
    description: 'Warm',
    tracks: [
      { artist: 'A', title: 'One', duration: '4:12' },
      { artist: '', title: 'Two', duration: '' }
    ]
  });
  assert.match(text, /^#EXTM3U\n#PLAYLIST:Sunday\n/);
  assert.match(text, /#EXTINF:252,A - One\nA - One\.mp3/);
  assert.match(text, /#EXTINF:-1,Two\nTwo\.mp3/);
});

console.log('\n branding & models');
test('credits Mwijay in the document, the footer and the Engine tab', () => {
  assert.match(html, /<meta name="author" content="Mwijay">/);
  assert.match(html, /<title>Audenic AI Studio · by Mwijay<\/title>/);
  assert.match(html, /<p class="foot-credit">Made by <strong>Mwijay<\/strong><\/p>/);
  assert.match(html, /class="about-ver">AI Studio 2\.0</);
});
test('keeps the engine and privacy line in the footer', () => {
  const foot = html.slice(html.indexOf('<footer class="foot">'), html.indexOf('</footer>'));
  assert.match(foot, /Gemini 2\.5 Flash → Groq/);
  assert.match(foot, /Keys stay on your device/);
});
test('removes the non-working equalizer tab and uses live model IDs', () => {
  assert.doesNotMatch(html, /id="tab-eq"|id="pane-eq"/);
  assert.match(html, /gemini-2\.5-flash/);
  assert.match(html, /llama-3\.3-70b-versatile/);
  assert.doesNotMatch(html, /gemini-3\.8-flash|qwen\/qwen3\.8-27b/);
});
test('ships no leftover build placeholders', () => {
  assert.doesNotMatch(html, /\bTODO\b|\bFIXME\b|localhost:3000/);
});

console.log(`\n${passed} checks passed${process.exitCode ? ' (with failures)' : ''}\n`);
