(function (root) {
  'use strict';
  // Explicitly supported currencies: never guess precision or convert money.
  const currencies = Object.freeze({
    USD: 2,
    CAD: 2,
    EUR: 2,
    GBP: 2,
    AUD: 2,
    JPY: 0,
    KWD: 3,
  });
  const MAX_MINOR = 1_000_000_000_000;
  function keys(value, allowed) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((k) => !allowed.includes(k))
    )
      throw new Error('Unsupported budget field.');
  }
  function text(value, max) {
    if (
      typeof value !== 'string' ||
      value.length > max ||
      /[\u0000-\u001f\u007f]/.test(value)
    )
      throw new Error('Invalid budget text.');
    return value.trim();
  }
  function currency(value) {
    if (!Object.hasOwn(currencies, value))
      throw new Error('Choose a supported budget currency.');
    return value;
  }
  function amount(value, code) {
    const digits = currencies[currency(code)];
    if (value === '') return null;
    if (
      typeof value !== 'string' ||
      !new RegExp(
        '^\\d{1,13}' + (digits ? '(?:\\.\\d{1,' + digits + '})?' : '') + '$',
      ).test(value)
    )
      throw new Error(
        'Enter a non-negative amount with up to ' +
          digits +
          ' decimal places, without commas or symbols.',
      );
    const [whole, fraction = ''] = value.split('.');
    const minor =
      Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0'));
    if (!Number.isSafeInteger(minor) || minor > MAX_MINOR)
      throw new Error('This amount is too large.');
    return minor;
  }
  function inputAmount(minor, code) {
    if (minor === null || minor === undefined) return '';
    const digits = currencies[currency(code)];
    return (minor / 10 ** digits).toFixed(digits);
  }
  function format(minor, code) {
    if (minor === null || minor === undefined) return 'Not recorded';
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency(code),
    }).format(minor / 10 ** currencies[code]);
  }
  const initial = () => ({
    enabled: false,
    currency: 'USD',
    target: null,
    items: [],
    history: [],
  });
  function settings(value) {
    keys(value, ['enabled', 'currency', 'target']);
    if (typeof value.enabled !== 'boolean')
      throw new Error('Choose whether to use the budget tracker.');
    const code = currency(value.currency);
    return {
      enabled: value.enabled,
      currency: code,
      target: amount(value.target, code),
    };
  }
  function item(value, code) {
    keys(value, [
      'title',
      'estimate',
      'committed',
      'paid',
      'owner',
      'taskId',
      'dueDate',
      'status',
    ]);
    const title = text(value.title, 120),
      owner = text(value.owner, 100),
      taskId = text(value.taskId, 100),
      dueDate = text(value.dueDate, 10);
    if (!title) throw new Error('Give this cost a name.');
    if (!['active', 'cancelled'].includes(value.status))
      throw new Error('Choose active or cancelled.');
    if (
      dueDate &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) ||
        !Number.isFinite(Date.parse(dueDate)) ||
        new Date(dueDate + 'T00:00:00Z').toISOString().slice(0, 10) !== dueDate)
    )
      throw new Error('Choose a valid due date.');
    return {
      title,
      estimate: amount(value.estimate, code),
      committed: amount(value.committed, code),
      paid: amount(value.paid, code),
      owner,
      taskId,
      dueDate,
      status: value.status,
    };
  }
  function totals(budget) {
    const result = Object.fromEntries(
      ['estimate', 'committed', 'paid', 'forecast'].map((key) => [
        key,
        { known: 0, unknown: 0 },
      ]),
    );
    // Archiving hides a row, never its costs. Cancelled rows retain recorded payments.
    for (const row of budget.items) {
      for (const key of ['estimate', 'committed', 'paid']) {
        if (row.status === 'cancelled' && key !== 'paid') continue;
        if (row[key] === null) result[key].unknown++;
        else result[key].known += row[key];
      }
      const planned =
        row.status === 'cancelled' ? row.paid : (row.committed ?? row.estimate);
      if (planned === null) result.forecast.unknown++;
      else result.forecast.known += Math.max(planned, row.paid ?? 0);
    }
    result.remaining =
      budget.target !== null && result.forecast.unknown === 0
        ? budget.target - result.forecast.known
        : null;
    return result;
  }
  root.GatherBudget = {
    currencies,
    initial,
    settings,
    item,
    amount,
    inputAmount,
    format,
    totals,
  };
})(typeof window !== 'undefined' ? window : globalThis);
