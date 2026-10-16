import * as fs from 'fs';
import * as path from 'path';

/**
 * Architectural Integrity Guard: Appointment Next-Action Engine Access
 *
 * RULE:
 * `AppointmentNextActionService` is a private calculation engine whose usage is
 * EXCLUSIVELY RESTRICTED to `AppointmentModifierService`.
 *
 * NO OTHER service, controller, helper, or worker is permitted to import,
 * instantiate, inject, or call `AppointmentNextActionService`.
 *
 * Any state modification needing next-action calculation must go through
 * `AppointmentModifierService.modifyStatus()` or `syncAlarm()`.
 */
describe('Architectural Guard: Appointment Next-Action Engine Access Invariant', () => {
  const srcDir = path.resolve(__dirname, '../../../../src');

  // ONLY appointment-modifier.service.ts and the module provider registration are allowed
  const ALLOWED_FILES = [
    'appointment-next-action.service.ts',
    'appointment-modifier.service.ts',
    'appointments.module.ts',
  ];

  function getAllTsFiles(dir: string, fileList: string[] = []): string[] {
    if (!fs.existsSync(dir)) return fileList;
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        getAllTsFiles(fullPath, fileList);
      } else if (file.endsWith('.ts') && !file.endsWith('.spec.ts')) {
        fileList.push(fullPath);
      }
    }
    return fileList;
  }

  it('should verify that ONLY AppointmentModifierService consumes AppointmentNextActionService', () => {
    const tsFiles = getAllTsFiles(srcDir);
    const violations: { file: string; line: number; snippet: string }[] = [];

    const importRegex = /AppointmentNextActionService/;

    for (const filePath of tsFiles) {
      const fileName = path.basename(filePath);
      if (ALLOWED_FILES.includes(fileName)) {
        continue;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        if (importRegex.test(lines[i])) {
          violations.push({
            file: path.relative(srcDir, filePath),
            line: i + 1,
            snippet: lines[i].trim(),
          });
        }
      }
    }

    if (violations.length > 0) {
      const report = violations
        .map((v) => `  - ${v.file}:${v.line} -> "${v.snippet}"`)
        .join('\n');
      throw new Error(
        `Architectural Invariant Violation!\n` +
          `AppointmentNextActionService is private to AppointmentModifierService.\n` +
          `The following files improperly reference AppointmentNextActionService:\n${report}`,
      );
    }

    expect(violations).toHaveLength(0);
  });
});
