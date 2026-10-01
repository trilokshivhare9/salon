describe('Today 5-Minute Anchor Snapping Logic', () => {
  // Evaluates candidateStart snapping when an ongoing free interval starts at or before current time
  function calculateTodayAnchor(intervalStartMin: number, nowMinuteOfDay: number): number {
    let candidateStart = intervalStartMin;
    if (candidateStart <= nowMinuteOfDay) {
      const targetMinute = nowMinuteOfDay + 1;
      const next5MinMark = Math.ceil(targetMinute / 5) * 5;
      candidateStart = Math.max(intervalStartMin, next5MinMark);
    }
    return candidateStart;
  }

  function formatMin(mins: number): string {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const period = h >= 12 ? 'PM' : 'AM';
    const displayH = h % 12 === 0 ? 12 : h % 12;
    return `${displayH}:${m < 10 ? '0' : ''}${m} ${period}`;
  }

  it('Customer opens at 3:59 PM (interval starts at 4:00 PM) -> returns 4:00 PM', () => {
    // 3:59 PM = 15 * 60 + 59 = 959
    // Interval starts at 4:00 PM = 16 * 60 = 960
    const slot = calculateTodayAnchor(960, 959);
    expect(slot).toBe(960);
    expect(formatMin(slot)).toBe('4:00 PM');
  });

  it('Customer opens at 4:00 PM (clock touches 4:00 PM) -> returns 4:05 PM', () => {
    // 4:00 PM = 960
    const slot = calculateTodayAnchor(960, 960);
    expect(slot).toBe(965);
    expect(formatMin(slot)).toBe('4:05 PM');
  });

  it('Customer opens at 4:03 PM (stylist free from 4:00 PM) -> returns 4:05 PM', () => {
    // 4:03 PM = 963
    const slot = calculateTodayAnchor(960, 963);
    expect(slot).toBe(965);
    expect(formatMin(slot)).toBe('4:05 PM');
  });

  it('Customer opens at 4:05 PM (clock touches 4:05 PM) -> returns 4:10 PM', () => {
    // 4:05 PM = 965
    const slot = calculateTodayAnchor(960, 965);
    expect(slot).toBe(970);
    expect(formatMin(slot)).toBe('4:10 PM');
  });

  it('Customer opens at 4:06 PM -> returns 4:10 PM', () => {
    // 4:06 PM = 966
    const slot = calculateTodayAnchor(960, 966);
    expect(slot).toBe(970);
    expect(formatMin(slot)).toBe('4:10 PM');
  });

  it('Customer opens at 4:10 PM -> returns 4:15 PM', () => {
    // 4:10 PM = 970
    const slot = calculateTodayAnchor(960, 970);
    expect(slot).toBe(975);
    expect(formatMin(slot)).toBe('4:15 PM');
  });

  it('Subsequent slots step by exact service duration (e.g. 45 min)', () => {
    // Starting at 4:05 PM (965) with 45m service
    const start = 965; // 4:05 PM
    const duration = 45;
    const slots = [start, start + duration, start + duration * 2, start + duration * 3];
    expect(slots.map(formatMin)).toEqual([
      '4:05 PM',
      '4:50 PM',
      '5:35 PM',
      '6:20 PM',
    ]);
  });
});
