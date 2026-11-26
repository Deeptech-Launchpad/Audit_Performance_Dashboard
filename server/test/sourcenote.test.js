// The auditor's correction for one attribute, taken from the whole audit comment (only when the comment names it; nothing guessed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteFor, fetchSourcePdf, commentLinks, noteHints } from '../src/services/sources.js';

test('links the auditor wrote in a comment (the correct source); cut-off links are dropped', () => {
  assert.deepEqual(commentLinks('Found-https://www.clevelandcontrols.com/wp-content/uploads/x.pdf'), ['https://www.clevelandcontrols.com/wp-content/uploads/x.pdf']);
  assert.deepEqual(commentLinks('found partially “https://a.example/c.pdf’|https://b.example/p/, <Application> not valid'), ['https://a.example/c.pdf', 'https://b.example/p/']);
  assert.deepEqual(commentLinks('<Control Type> from manual pdf “https:/'), []);
  assert.deepEqual(commentLinks('Site Not Open'), []);
});

test('words from the note worth looking for on the source', () => {
  assert.deepEqual(noteHints('Capture “Water” only Refer PDF'), ['Water']);
  assert.deepEqual(noteHints('10 in'), ['10 in']);
  assert.deepEqual(noteHints('Pls Capture from Salsify URL'), []);
  assert.deepEqual(noteHints('100 psi from “https://x.example/a.pdf”'), []);
});

test('a link in the note for one attribute becomes that attribute’s source, with its page', () => {
  const c = '<Flow Rate – Maximum> missing page number 47 “https://h.example/cat.pdf” , , <Includes> x';
  assert.equal(noteFor(c, 'Flow Rate - Maximum'), 'missing page number 47 “https://h.example/cat.pdf”');
});

test('"Name>>note|Name2>>note" comments', () => {
  const c = 'Compatible Surface Material>>”metal, aluminum, masonry, concrete” Pls Refer Salsify|Container Size>>1 gal|Flash Point>>89 ºF pls Capture from PDF pgno 18|';
  assert.equal(noteFor(c, 'Container Size'), '1 gal');
  assert.equal(noteFor(c, 'Compatible Surface Material'), '”metal, aluminum, masonry, concrete” Pls Refer Salsify');
  assert.equal(noteFor(c, 'Flash Point'), '89 ºF pls Capture from PDF pgno 18');
});

test('"<Name> note, <Name2> note" comments and dash variants', () => {
  const c = '<Features> capture features & Specs tab, <Overall Width> 10 in, <Overall Height> 9 in, <Operating Pressure – Maximum> 100 PSI';
  assert.equal(noteFor(c, 'Overall Width'), '10 in');
  assert.equal(noteFor(c, 'Overall Height'), '9 in');
  assert.equal(noteFor(c, 'Operating Pressure - Maximum'), '100 PSI');
});

test('no note when the comment does not name the attribute, or only mentions it inside a sentence', () => {
  assert.equal(noteFor('Container Size>>1 gal', 'Color'), '');
  assert.equal(noteFor('please check the color on the page', 'Color'), '');
  assert.equal(noteFor('', 'Color'), '');
});

test('PDF fetch only for links saved for that record, never private addresses', async () => {
  const info = JSON.stringify({ attrs: { a: { value: 'x', links: [{ url: 'http://127.0.0.1/secret.pdf', page: 1 }] } }, product: [] });
  const db = { get: async () => ({ source_info: info }) };
  await assert.rejects(fetchSourcePdf(db, 1, 'https://other.example/file.pdf'), (e) => e.status === 404);
  await assert.rejects(fetchSourcePdf(db, 1, 'http://127.0.0.1/secret.pdf'), (e) => e.status === 400);
});
