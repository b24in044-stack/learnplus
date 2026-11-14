// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { getMondayOfCurrentWeek } from './StudyPlanner';

describe('study planner week start', () => {
  it('keeps Sunday in the week that is ending', () => {
    const sunday = new Date(2026, 10, 1, 12);

    expect(getMondayOfCurrentWeek(sunday)).toEqual(new Date(2026, 9, 26, 12));
  });

  it('leaves Monday as the start of its own week', () => {
    const monday = new Date(2026, 9, 26, 12);

    expect(getMondayOfCurrentWeek(monday)).toEqual(monday);
  });
});
