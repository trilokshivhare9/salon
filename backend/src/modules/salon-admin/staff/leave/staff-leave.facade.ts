import { Injectable } from '@nestjs/common';
import { ApplyLeaveService } from './services/apply-leave.service';
import { CancelLeaveService } from './services/cancel-leave.service';
import { ExtendLeaveService } from './services/extend-leave.service';
import { GetLeaveHistoryService } from './services/get-leave-history.service';
import { PreviewLeaveService } from './services/preview-leave.service';
import { ApplyLeaveDto, ExtendLeaveDto, PreviewLeaveQueryDto, LeaveHistoryQueryDto } from './dto';

@Injectable()
export class StaffLeaveFacade {
  constructor(
    private readonly applyLeaveService: ApplyLeaveService,
    private readonly cancelLeaveService: CancelLeaveService,
    private readonly extendLeaveService: ExtendLeaveService,
    private readonly getLeaveHistoryService: GetLeaveHistoryService,
    private readonly previewLeaveService: PreviewLeaveService,
  ) {}

  // Semantic Modern Methods
  async applyLeave(salonId: string, stylistId: string, dto: ApplyLeaveDto, adminId?: string) {
    return this.applyLeaveService.applyLeave(salonId, stylistId, dto, adminId);
  }

  async cancelLeave(salonId: string, stylistId: string, leaveId: string, adminId?: string) {
    return this.cancelLeaveService.cancelLeave(salonId, stylistId, leaveId, adminId);
  }

  async extendLeave(salonId: string, stylistId: string, leaveId: string, dto: ExtendLeaveDto, adminId?: string) {
    return this.extendLeaveService.extendLeave(salonId, stylistId, leaveId, dto, adminId);
  }

  async getLeaveHistory(salonId: string, stylistId: string, query?: LeaveHistoryQueryDto) {
    return this.getLeaveHistoryService.getLeaveHistory(salonId, stylistId, query);
  }

  async previewLeave(salonId: string, stylistId: string, query: PreviewLeaveQueryDto) {
    return this.previewLeaveService.previewLeaveImpact(salonId, stylistId, query);
  }

  // Backward-Compatible Aliases matching legacy AbsenceService API
  async markStylistAbsent(salonId: string, stylistId: string, dto: ApplyLeaveDto, adminId?: string) {
    return this.applyLeave(salonId, stylistId, dto, adminId);
  }

  async cancelAbsence(salonId: string, stylistId: string, absenceId: string, adminId?: string) {
    return this.cancelLeave(salonId, stylistId, absenceId, adminId);
  }

  async extendStylistLeave(salonId: string, stylistId: string, absenceId: string, dto: ExtendLeaveDto, adminId?: string) {
    return this.extendLeave(salonId, stylistId, absenceId, dto, adminId);
  }

  async getStylistAbsences(salonId: string, stylistId: string, query?: LeaveHistoryQueryDto) {
    return this.getLeaveHistory(salonId, stylistId, query);
  }

  async previewAbsenceImpact(salonId: string, stylistId: string, query: PreviewLeaveQueryDto) {
    return this.previewLeave(salonId, stylistId, query);
  }
}
