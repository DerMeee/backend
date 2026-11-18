import { csvCell, csvRow, safeSheetValue } from './csv';
import { dateRangeFilter, endOfLocalDay, startOfLocalDay } from './dates';
import { joinName, splitName } from './names';
import { likePattern } from './sql';
import {
  addDays,
  localToday,
  percentChange,
  previousPeriod,
  validateRange,
} from '../admin/stats/timeseries';
import { validateSettings } from '../settings/settings.service';

describe('csv', () => {
  it('quotes separators and quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvRow(['x', 1, null])).toBe('x,1,\r\n');
  });

  it('neutralises spreadsheet formulas but keeps negative numbers', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe(
      `"'=HYPERLINK(""http://evil"")"`,
    );
    expect(csvCell('+213555')).toBe("'+213555");
    expect(csvCell(-5)).toBe('-5');
    expect(safeSheetValue('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(safeSheetValue(42)).toBe(42);
  });
});

describe('dates (Algeria, UTC+1)', () => {
  it('maps local days to UTC instants', () => {
    expect(startOfLocalDay('2026-11-02').toISOString()).toBe(
      '2026-11-01T23:00:00.000Z',
    );
    expect(endOfLocalDay('2026-11-02').toISOString()).toBe(
      '2026-11-02T22:59:59.999Z',
    );
  });

  it('rejects inverted ranges', () => {
    expect(() => dateRangeFilter('2026-11-05', '2026-11-01')).toThrow();
    expect(dateRangeFilter()).toBeUndefined();
  });

  it('computes today in Algeria', () => {
    expect(localToday(new Date('2026-11-02T23:30:00Z'))).toBe('2026-11-03');
  });
});

describe('timeseries helpers', () => {
  it('previous period has the same length and ends the day before', () => {
    expect(previousPeriod('2026-10-01', '2026-10-31')).toEqual({
      from: '2026-08-31',
      to: '2026-09-30',
    });
    expect(previousPeriod('2026-11-02', '2026-11-02')).toEqual({
      from: '2026-11-01',
      to: '2026-11-01',
    });
  });

  it('caps the number of buckets', () => {
    expect(() => validateRange('2020-01-01', '2026-01-01', 'day')).toThrow(
      /Range too long/,
    );
    expect(() =>
      validateRange('2020-01-01', '2026-01-01', 'month'),
    ).not.toThrow();
  });

  it('percent change', () => {
    expect(percentChange(15, 10)).toBe(50);
    expect(percentChange(0, 0)).toBe(0);
    expect(percentChange(3, 0)).toBeNull();
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('names & search', () => {
  it('splits names on the first space', () => {
    expect(splitName('  Amina   Ben Ali ')).toEqual({
      firstName: 'Amina',
      lastName: 'Ben Ali',
    });
    expect(splitName('Karim')).toEqual({ firstName: 'Karim', lastName: null });
    expect(joinName('Amina', null)).toBe('Amina');
  });

  it('escapes LIKE wildcards typed by users', () => {
    expect(likePattern('50%_off')).toBe('%50\\%\\_off%');
  });
});

describe('settings validation', () => {
  it('requires mediumHours > urgentHours', () => {
    expect(() =>
      validateSettings({
        urgentHours: 24,
        mediumHours: 24,
        defaultLowStockThreshold: 5,
      }),
    ).toThrow();
    expect(() =>
      validateSettings({
        urgentHours: 24,
        mediumHours: 72,
        defaultLowStockThreshold: 5,
      }),
    ).not.toThrow();
  });
});
