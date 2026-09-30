(function (root) {
  'use strict';
  const fields = [
    'name',
    'email',
    'phone',
    'type',
    'group',
    'attendance',
    'notes',
  ];
  const types = ['attendee', 'speaker', 'volunteer', 'vendor'];
  const attendance = ['unknown', 'attending', 'tentative', 'not attending'];
  const limits = {
    name: 120,
    email: 254,
    phone: 40,
    group: 80,
    notes: 500,
    type: 30,
    attendance: 30,
  };
  function normalize(input) {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some((key) => !fields.includes(key))
    )
      throw new Error('Use only the listed guest fields.');
    const result = {};
    for (const field of fields) {
      if (input[field] !== undefined && typeof input[field] !== 'string')
        throw new Error(field + ' must be text.');
      result[field] = (input[field] || '').trim();
      if (
        result[field].length > limits[field] ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result[field])
      )
        throw new Error(
          field + ' is too long or contains unsupported characters.',
        );
    }
    if (!result.name) throw new Error('Name is required.');
    result.email = result.email.toLowerCase();
    if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email))
      throw new Error('Enter a valid email or leave it empty.');
    result.type = result.type.toLowerCase() || 'attendee';
    result.attendance = result.attendance.toLowerCase() || 'unknown';
    if (!types.includes(result.type))
      throw new Error('Type must be attendee, speaker, volunteer or vendor.');
    if (!attendance.includes(result.attendance))
      throw new Error(
        'Attendance must be unknown, attending, tentative or not attending.',
      );
    return result;
  }
  function parseCSV(raw) {
    if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > 40000)
      throw new Error('Use a CSV up to 40 KB, with at most 100 guests.');
    const text = raw.replace(/^\uFEFF/, ''),
      rows = [];
    let row = [],
      cell = '',
      quoted = false,
      ended = false,
      recordNumber = 1;
    const pushCell = () => {
      row.push(cell);
      cell = '';
      ended = false;
    };
    const pushRow = () => {
      pushCell();
      if (row.some((value) => value.trim()))
        rows.push({ values: row, line: recordNumber });
      recordNumber++;
      row = [];
      if (rows.length > 101)
        throw new Error('Import at most 100 guests at a time.');
    };
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            cell += '"';
            i++;
          } else {
            quoted = false;
            ended = true;
          }
        } else cell += c;
        continue;
      }
      if (c === '"') {
        if (cell || ended) throw new Error('Invalid quote in the CSV.');
        quoted = true;
      } else if (c === ',') pushCell();
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        pushRow();
      } else {
        if (ended) throw new Error('Unexpected text after a quoted field.');
        cell += c;
      }
    }
    if (quoted) throw new Error('A quoted field is not closed.');
    if (cell || row.length || ended) pushRow();
    if (rows.length < 2)
      throw new Error('Include a header row and at least one guest.');
    const headers = rows
      .shift()
      .values.map((value) => value.trim().toLowerCase());
    if (
      !headers.includes('name') ||
      headers.some((key) => !fields.includes(key)) ||
      new Set(headers).size !== headers.length
    )
      throw new Error(
        'Use unique columns: Name, Email, Phone, Type, Group, Attendance, Notes. Name is required.',
      );
    return rows.map(({ values, line }) => ({
      line,
      input:
        values.length === headers.length
          ? Object.fromEntries(headers.map((key, i) => [key, values[i]]))
          : null,
    }));
  }
  function preview(csv, existing = []) {
    const emails = new Set(
      existing.filter((g) => g.email).map((g) => g.email.toLowerCase()),
    );
    const rows = parseCSV(csv).map(({ line, input }) => {
      try {
        if (!input)
          throw new Error('The number of columns does not match the header.');
        const guest = normalize(input);
        if (guest.email && emails.has(guest.email))
          return {
            line,
            guest,
            status: 'duplicate',
            message: 'Email already listed; no changes will be made.',
          };
        if (guest.email) emails.add(guest.email);
        return { line, guest, status: 'new', message: '' };
      } catch (error) {
        return { line, status: 'invalid', message: error.message };
      }
    });
    return {
      rows,
      added: rows.filter((r) => r.status === 'new').length,
      duplicates: rows.filter((r) => r.status === 'duplicate').length,
      invalid: rows.filter((r) => r.status === 'invalid').length,
    };
  }
  root.GatherGuests = {
    fields,
    types,
    attendance,
    normalize,
    parseCSV,
    preview,
  };
})(typeof window !== 'undefined' ? window : globalThis);
