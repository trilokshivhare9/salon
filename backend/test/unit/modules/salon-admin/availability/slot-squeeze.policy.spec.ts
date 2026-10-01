import { SlotSqueezePolicy } from '../../../../../src/modules/salon-admin/availability/policies/slot-squeeze.policy';

describe('SlotSqueezePolicy', () => {
  let policy: SlotSqueezePolicy;

  beforeEach(() => {
    policy = new SlotSqueezePolicy();
  });

  describe('calculateAllowedSqueeze', () => {
    it('should return 0 squeeze for quick services under 20 minutes', () => {
      expect(policy.calculateAllowedSqueeze(10)).toBe(0);
      expect(policy.calculateAllowedSqueeze(15)).toBe(0);
      expect(policy.calculateAllowedSqueeze(19)).toBe(0);
    });

    it('should return 5 min squeeze for medium services between 20 and 34 minutes', () => {
      expect(policy.calculateAllowedSqueeze(20)).toBe(5);
      expect(policy.calculateAllowedSqueeze(30)).toBe(5);
      expect(policy.calculateAllowedSqueeze(34)).toBe(5);
    });

    it('should return 10 min squeeze for standard/long services 35 minutes and above', () => {
      expect(policy.calculateAllowedSqueeze(35)).toBe(10);
      expect(policy.calculateAllowedSqueeze(45)).toBe(10);
      expect(policy.calculateAllowedSqueeze(60)).toBe(10);
      expect(policy.calculateAllowedSqueeze(90)).toBe(10);
    });
  });

  describe('canFit', () => {
    it('should fit comfortably when available window is greater than or equal to service duration', () => {
      const result = policy.canFit(60, 45);
      expect(result.fits).toBe(true);
      expect(result.isSqueezed).toBe(false);
      expect(result.effectiveDuration).toBe(45);
      expect(result.squeezedMinutes).toBe(0);
    });

    it('should squeeze 45-min haircut into a 40-min free gap', () => {
      const result = policy.canFit(40, 45);
      expect(result.fits).toBe(true);
      expect(result.isSqueezed).toBe(true);
      expect(result.effectiveDuration).toBe(40);
      expect(result.squeezedMinutes).toBe(5);
    });

    it('should squeeze 45-min haircut into a 35-min free gap (maximum 10 min squeeze)', () => {
      const result = policy.canFit(35, 45);
      expect(result.fits).toBe(true);
      expect(result.isSqueezed).toBe(true);
      expect(result.effectiveDuration).toBe(35);
      expect(result.squeezedMinutes).toBe(10);
    });

    it('should reject 45-min haircut in a 34-min gap (exceeds 10 min squeeze limit)', () => {
      const result = policy.canFit(34, 45);
      expect(result.fits).toBe(false);
      expect(result.isSqueezed).toBe(false);
      expect(result.effectiveDuration).toBe(45);
      expect(result.squeezedMinutes).toBe(0);
    });

    it('should squeeze 30-min beard trim into a 25-min gap', () => {
      const result = policy.canFit(25, 30);
      expect(result.fits).toBe(true);
      expect(result.isSqueezed).toBe(true);
      expect(result.effectiveDuration).toBe(25);
      expect(result.squeezedMinutes).toBe(5);
    });

    it('should reject 30-min beard trim in a 24-min gap (exceeds 5 min squeeze limit)', () => {
      const result = policy.canFit(24, 30);
      expect(result.fits).toBe(false);
    });

    it('should reject 15-min quick touchup in a 14-min gap (0 squeeze permitted for <20m)', () => {
      const result = policy.canFit(14, 15);
      expect(result.fits).toBe(false);
    });
  });
});
