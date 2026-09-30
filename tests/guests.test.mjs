import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../legacy/guests.js';
const G = globalThis.GatherGuests;

test('guest normalization keeps contacts distinct from project identities', () => {
  const guest = G.normalize({
    name: '  Avery  ',
    email: ' AVery@Example.com ',
    type: 'Speaker',
  });
  assert.equal(guest.name, 'Avery');
  assert.equal(guest.email, 'avery@example.com');
  assert.equal(guest.type, 'speaker');
  assert.throws(() => G.normalize({ name: 'A', role: 'admin' }));
  assert.throws(() => G.normalize({ name: 'A', email: 'invalid' }));
  assert.throws(() => G.normalize({ name: 'A', notes: 'x'.repeat(501) }));
  assert.throws(() => G.normalize({ name: '' }));
});
test('CSV supports BOM, CRLF, quoted commas and multiline notes', () => {
  const result = G.preview(
    '\uFEFFName,Email,Notes\r\n"Chen, Avery",A@EXAMPLE.COM,"Line 1\nLine ""2"""\r\n',
  );
  assert.equal(result.added, 1);
  assert.equal(result.rows[0].guest.notes, 'Line 1\nLine "2"');
  assert.equal(result.rows[0].guest.name, 'Chen, Avery');
});
test('CSV preserves record numbers and skips duplicate emails, including archived contacts', () => {
  const result = G.preview(
    'Name,Email\n\nA,not-email\nB,ARCHIVED@example.com\nC,c@example.com\nD,C@example.com\nSame,\nSame,',
    [{ email: 'archived@example.com', archivedAt: 'yesterday' }],
  );
  assert.equal(result.rows[0].line, 3);
  assert.equal(result.invalid, 1);
  assert.equal(result.duplicates, 2);
  assert.equal(result.added, 3);
});
test('CSV rejects malformed structure and enforces byte and row limits', () => {
  for (const csv of [
    'Name,Name\nA,B',
    'Email\na@example.com',
    'Name\n"Unclosed',
    'Name\n"A"text',
    'Name\nA"B',
  ])
    assert.throws(() => G.preview(csv));
  assert.equal(G.preview('Name,Email\nA').invalid, 1);
  assert.throws(() =>
    G.preview(
      'Name\n' + Array.from({ length: 101 }, (_, i) => 'Guest ' + i).join('\n'),
    ),
  );
  assert.throws(() => G.preview('Name\n' + '字'.repeat(14000)));
  assert.equal(G.preview('Name,Notes\nA,=2+3').invalid, 0);
});
