import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../legacy/budget.js';
const B = globalThis.GatherBudget;
const item = (values = {}, currency = 'USD') =>
  B.item(
    {
      title: 'School dance venue',
      estimate: '',
      committed: '',
      paid: '',
      owner: '',
      taskId: '',
      dueDate: '',
      status: 'active',
      ...values,
    },
    currency,
  );
test('exact decimal amounts: no floating-point addition, symbols, rounding or negative payments', () => {
  assert.equal(B.amount('0.10', 'USD') + B.amount('0.20', 'USD'), 30);
  assert.equal(B.amount('12', 'JPY'), 12);
  assert.equal(B.amount('12.345', 'KWD'), 12345);
  assert.equal(B.amount('', 'USD'), null);
  assert.equal(B.amount('0', 'USD'), 0);
  for (const value of [
    '-1',
    '1.001',
    '1e3',
    '1,000',
    'Infinity',
    ' 1',
    '.5',
    '1.',
    null,
    10,
    '1000000000001',
  ])
    assert.throws(() => B.amount(value, 'USD'));
  assert.throws(() => B.amount('1.0', 'JPY'));
  assert.throws(() => B.amount('1', 'ZZZ'));
});
test('strict fields, real due dates, finite precision and required titles', () => {
  assert.throws(() => item({ title: ' ' }));
  assert.throws(() => item({ dueDate: '2026-02-30' }));
  assert.throws(() => item({ cardNumber: 'not-supported' }));
  assert.throws(() => item({ status: 'approved' }));
  assert.equal(item({ dueDate: '2028-02-29' }).dueDate, '2028-02-29');
  for (const code of Object.keys(B.currencies))
    for (const value of [0, 1, 123456, 1000000000000])
      assert.equal(B.amount(B.inputAmount(value, code), code), value);
});
test('corporate budget totals never add commitments and payments twice', () => {
  const budget = {
    ...B.initial(),
    target: 100000,
    items: [
      item({ estimate: '500', committed: '450', paid: '100' }),
      item({ estimate: '100', committed: '', paid: '0' }),
    ],
  };
  assert.deepEqual(B.totals(budget), {
    estimate: { known: 60000, unknown: 0 },
    committed: { known: 45000, unknown: 1 },
    paid: { known: 10000, unknown: 0 },
    forecast: { known: 55000, unknown: 0 },
    remaining: 45000,
  });
});
test('unknown quotes stay unknown; archived costs remain included; cancellations retain net recorded payments', () => {
  const budget = {
    ...B.initial(),
    target: 100000,
    items: [
      {
        ...item({ estimate: '50', committed: '60', paid: '20' }),
        archivedAt: 'yesterday',
      },
      item({
        estimate: '100',
        committed: '100',
        paid: '30',
        status: 'cancelled',
      }),
      item(),
    ],
  };
  const totals = B.totals(budget);
  assert.equal(totals.estimate.known, 5000);
  assert.equal(totals.paid.known, 5000);
  assert.deepEqual(totals.forecast, { known: 9000, unknown: 1 });
  assert.equal(totals.remaining, null);
  budget.items.pop();
  assert.equal(B.totals(budget).remaining, 91000);
});
test('expected cost is never below a known recorded payment, even above the commitment', () => {
  assert.equal(
    B.totals({
      ...B.initial(),
      items: [item({ estimate: '10', committed: '20', paid: '30' })],
    }).forecast.known,
    3000,
  );
});
