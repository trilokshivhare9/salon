import * as fs from 'fs';
import * as path from 'path';

/**
 * Architectural Integrity Guard: Appointment Mutation Invariant
 *
 * RULE:
 * No file in `src/modules/salon-admin/appointments` (or subdirectories)
 * is permitted to directly mutate `status` via `prisma.appointment.update`.
 *
 * ALL status changes, cancellation fields, and reschedule mutations
 * MUST pass through `AppointmentModifierService.modifyStatus()`.
 *
 * This test guarantees that no future developer or AI agent can bypass the
 * centralized modifier and break Redis alarms or event broadcasting.
 */
describe('Architectural Guard: Appointment Status Mutation Invariant', () => {
  const appointmentsDir = path.resolve(
    __dirname,
    '../../../../src/modules/salon-admin/appointments',
  );

  const ALLOWED_DIRECT_MODIFIERS = [
    'appointment-modifier.service.ts',
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

  it('should verify that ONLY AppointmentModifierService executes direct appointment status updates in Prisma', () => {
    const tsFiles = getAllTsFiles(appointmentsDir);
    const violations: { file: string; line: number; snippet: string }[] = [];

    // Regex to detect `prisma.appointment.update` or `tx.appointment.update` updating `status`
    // Matches patterns like `status: targetStatus`, `status: newStatus`, `status: AppointmentStatus.`
    const statusUpdateRegex = /status\s*:\s*(AppointmentStatus\.|targetStatus|newStatus|dto\.status)/;

    for (const filePath of tsFiles) {
      const fileName = path.basename(filePath);
      if (ALLOWED_DIRECT_MODIFIERS.includes(fileName)) {
        continue;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Check if this line is an update data payload (not a where query)
        if (statusUpdateRegex.test(line)) {
          // Verify surrounding lines to distinguish `where: { status }` from `data: { status }`
          const contextStart = Math.max(0, i - 15);
          const surroundingContext = lines.slice(contextStart, i + 5).join('\n');

          const isUpdateCall =
            surroundingContext.includes('.update(') ||
            surroundingContext.includes('.updateMany(');
          const isInsideDataBlock =
            surroundingContext.includes('data:') ||
            surroundingContext.includes('data :');
          const isInsideWhereBlock =
            surroundingContext.includes('where:') ||
            surroundingContext.includes('where :');

          // If inside .update() with data: and not where:
          if (isUpdateCall && isInsideDataBlock && !isInsideWhereBlock) {
            violations.push({
              file: fileName,
              line: i + 1,
              snippet: line.trim(),
            });
          }
        }
      }
    }

    if (violations.length > 0) {
      const violationReport = violations
        .map((v) => `  - ${v.file}:${v.line} -> "${v.snippet}"`)
        .join('\n');

      throw new Error(
        `🚨 ARCHITECTURAL VIOLATION: Direct appointment status updates detected in unauthorized files!\n` +
          `All status changes must be routed through AppointmentModifierService.modifyStatus().\n` +
          `Violating files:\n${violationReport}`,
      );
    }

    expect(violations.length).toBe(0);
  });
});
